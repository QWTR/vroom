import React, { useEffect, useState, useRef, useCallback } from "react";
import Toast from "react-native-toast-message";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useFocusEffect } from "expo-router";
import {
	ActivityIndicator,
	Dimensions,
	FlatList,
	Image,
	ScrollView,
	StyleSheet,
	TouchableOpacity,
	View,
	StatusBar,
	RefreshControl,
	Linking,
	Animated,
} from "react-native";
import { Text } from "@react-navigation/elements";
import { LinearGradient } from "expo-linear-gradient";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { API_URL } from "../../constants/config";
import { useTheme } from "../../contexts/ThemeContext";
import { AnnouncementsModal } from "../../components/modals/AnnouncementsModal";
import { useAnnouncements } from "../../hooks/useAnnouncements";
import { usePolls } from "../../hooks/usePolls";
import { useGifts } from "../../hooks/useGifts";
import { PollModal } from "../../components/modals/PollModal";
import { GiftModal } from "../../components/modals/GiftModal";
import { useAppUpdate } from "../../hooks/useAppUpdate";
import { UpdateModal } from "../../components/modals/UpdateModal";
import { AdBanner } from "../../components/ads/AdBanner";
import { usePremium } from "../../contexts/PremiumContext";
import { PartnerBannersSection } from "../../components/home/PartnerBannersSection";
import { QuestTrackSection } from "../../components/home/QuestTrackSection";

const { width, height } = Dimensions.get("window");

type MainCar = { brand: string; specs: string; photo: string | null };
type Achievement = { type: string; label: string; unlockedAt: string };
type User = {
	username: string;
	email: string;
	userId: string;
	isPremium?: boolean;
	avatar?: string;
	bio?: string;
	location?: string;
	createdAt?: string;
	position: number;
	points: number;
	totalDistance: number;
	monthlyDistance: number;
	weeklyDistance: number;
	dailyDistance: number;
	topSpeed: number;
	avgSpeed: string | number;
	avgMaxSpeed: string | number;
	totalRides: number;
	monthlyRides: number;
	streak: number;
	meetCount: number;
	cityCount: number;
	carCount: number;
	mainCar?: MainCar | null;
	spotCount: number;
	achievementCount: number;
	latestAchievement?: Achievement | null;
};

const getToken = async () =>
	(await AsyncStorage.getItem("userToken")) ??
	(await AsyncStorage.getItem("token"));

type ActiveGridVote = {
	eventId: number;
	categoryName: string;
	categorySlug: string;
	categoryIcon: string;
	currentRound: number;
};

async function fetchFreshUser(): Promise<User | null> {
	try {
		const token = await getToken();
		if (!token) return null;
		const meRes = await fetch(`${API_URL}/api/profile/me`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!meRes.ok) return null;
		const fresh = await meRes.json();
		const raw = await AsyncStorage.getItem("user");
		if (!raw) return null;
		const old = JSON.parse(raw);
		const merged = {
			...old,
			...fresh,
			avatar: fresh.avatarUrl ?? fresh.avatar ?? old.avatar ?? null,
		};
		delete merged.avatarUrl;
		await AsyncStorage.setItem("user", JSON.stringify(merged));
		return merged;
	} catch {
		return null;
	}
}

export default function HomeScreen() {
	const router = useRouter();
	const { theme, isDark } = useTheme();
	const {
		isPremium,
		isLoading: premiumLoading,
		refreshPremiumStatus,
	} = usePremium();
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [user, setUser] = useState<User | null>(null);
	const { unseenCount, load: loadAnnouncements } = useAnnouncements();
	const [showAnnouncements, setShowAnnouncements] = useState(false);

	const [activeGridVotes, setActiveGridVotes] = useState<ActiveGridVote[]>([]);
	const [gridCarouselIndex, setGridCarouselIndex] = useState(0);

	const [pollVisible, setPollVisible] = useState(false);
	const [giftVisible, setGiftVisible] = useState(false);
	const [currentGiftIdx, setCurrentGiftIdx] = useState(0);
	const [notifUnread, setNotifUnread] = useState(0);

	const fetchNotifUnread = useCallback(async () => {
		try {
			const token = await getToken();
			if (!token) return;
			const r = await fetch(`${API_URL}/api/notifications?limit=1&page=1`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!r.ok) return;
			const j = await r.json();
			setNotifUnread(typeof j.unreadCount === "number" ? j.unreadCount : 0);
		} catch {
			/* ignore */
		}
	}, []);

	useFocusEffect(
		useCallback(() => {
			fetchNotifUnread();
		}, [fetchNotifUnread]),
	);

	// Animacje
	const fadeAnim = useRef(new Animated.Value(0)).current;
	const slideAnim = useRef(new Animated.Value(40)).current;
	const scaleAnim = useRef(new Animated.Value(0.92)).current;
	const pulseAnim = useRef(new Animated.Value(1)).current;

	useEffect(() => {
		loadAnnouncements();
	}, []);

	useEffect(() => {
		refreshPremiumStatus().catch(() => {});
	}, [refreshPremiumStatus]);

	const { poll, voted, fetchActivePoll, vote } = usePolls();
	const { gifts, fetchAvailableGifts, claimGift } = useGifts();
	const pollRef = useRef(poll);
	const votedRef = useRef(voted);

	const { updateAvailable, downloading, applyUpdate, dismiss } = useAppUpdate();

	useEffect(() => {
		Animated.loop(
			Animated.sequence([
				Animated.timing(pulseAnim, {
					toValue: 1.15,
					duration: 1800,
					useNativeDriver: true,
				}),
				Animated.timing(pulseAnim, {
					toValue: 1,
					duration: 1800,
					useNativeDriver: true,
				}),
			]),
		).start();
	}, []);

	const runEntrance = () => {
		Animated.parallel([
			Animated.timing(fadeAnim, {
				toValue: 1,
				duration: 600,
				useNativeDriver: true,
			}),
			Animated.timing(slideAnim, {
				toValue: 0,
				duration: 600,
				useNativeDriver: true,
			}),
			Animated.spring(scaleAnim, {
				toValue: 1,
				friction: 7,
				useNativeDriver: true,
			}),
		]).start();
	};

	const loadUser = async (showSpinner = true) => {
		if (showSpinner) setLoading(true);
		try {
			const raw = await AsyncStorage.getItem("user");
			if (!raw) {
				router.replace("/login");
				return;
			}
			const cached = JSON.parse(raw) as User;
			setUser(cached);
			setLoading(false);
			runEntrance();
			const fresh = await fetchFreshUser();
			if (fresh) setUser(fresh);
		} catch {
			Toast.show({ type: "error", text1: "BŁĄD SESJI" });
			router.replace("/login");
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	};

	const fetchActiveGridVotes = useCallback(async () => {
		try {
			const token = await getToken();
			if (!token) {
				setActiveGridVotes([]);
				return;
			}
			const res = await fetch(`${API_URL}/api/grid/categories`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) {
				setActiveGridVotes([]);
				return;
			}
			const categories = (await res.json()) as {
				id: number;
				name: string;
				slug: string;
				icon: string;
				events?: {
					id: number;
					status: string;
					currentRound?: number;
				}[];
			}[];
			const votes: ActiveGridVote[] = [];
			for (const cat of categories ?? []) {
				const evs = Array.isArray(cat.events) ? cat.events : [];
				for (const ev of evs) {
					if (ev.status === "active") {
						votes.push({
							eventId: ev.id,
							categoryName: cat.name,
							categorySlug: cat.slug,
							categoryIcon: cat.icon ?? "🏁",
							currentRound: ev.currentRound ?? 1,
						});
					}
				}
			}
			setActiveGridVotes(votes);
		} catch {
			setActiveGridVotes([]);
		}
	}, []);

	useEffect(() => {
		loadUser();
		fetchActivePoll();
		fetchAvailableGifts();
		fetchActiveGridVotes();
	}, [fetchActiveGridVotes]);

	useEffect(() => {
		setGridCarouselIndex(0);
	}, [activeGridVotes.length]);

	useEffect(() => {
		pollRef.current = poll;
	}, [poll]);
	useEffect(() => {
		votedRef.current = voted;
	}, [voted]);

	// GIFTY — pokaż gdy załadowane
	useEffect(() => {
		if (loading) return;
		if (gifts.length === 0) return;
		setCurrentGiftIdx(0);
		setGiftVisible(true);
	}, [loading, gifts.length]);

	// ANKIETA — pokaż gdy brak giftów lub po zamknięciu giftów
	useEffect(() => {
		if (loading) return;
		if (!poll) return;
		if (voted) return;
		if (giftVisible) return;
		if (gifts.length > 0) return;
		setPollVisible(true);
	}, [loading, poll?.id, voted, giftVisible, gifts.length]);

	const handleGiftClose = () => {
		const nextIdx = currentGiftIdx + 1;
		if (nextIdx < gifts.length) {
			setCurrentGiftIdx(nextIdx);
		} else {
			setGiftVisible(false);
			setTimeout(() => {
				if (pollRef.current && !votedRef.current) {
					setPollVisible(true);
				}
			}, 400);
		}
	};

	const handleGiftClaim = async (giftId: number) => {
		return await claimGift(giftId);
	};

	const onRefresh = () => {
		setRefreshing(true);
		refreshPremiumStatus().catch(() => {});
		loadAnnouncements();
		fetchActiveGridVotes();
		fetchNotifUnread();
		loadUser(false);
	};

	const t = theme;
	const effectivePremium = !!(isPremium || user?.isPremium);
	const gridVoteBannerW = width - 40;

	if (loading || !user) {
		return (
			<View
				style={{
					flex: 1,
					backgroundColor: "#080808",
					justifyContent: "center",
					alignItems: "center",
					gap: 12,
				}}>
				<Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
					<MaterialCommunityIcons name='car-sports' size={52} color='#e33835' />
				</Animated.View>
				<Text
					style={{
						fontFamily: "Orbitron",
						fontSize: 28,
						color: "#e33835",
						letterSpacing: 10,
						fontWeight: "900",
					}}>
					VROOM
				</Text>
				<ActivityIndicator
					size='small'
					color='#e3383560'
					style={{ marginTop: 16 }}
				/>
			</View>
		);
	}

	return (
		<>
			<StatusBar
				barStyle='light-content'
				backgroundColor='transparent'
				translucent
			/>
			<ScrollView
				style={{ flex: 1, backgroundColor: t.bg }}
				contentContainerStyle={{ paddingBottom: 40 }}
				showsVerticalScrollIndicator={false}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={onRefresh}
						tintColor='#e33835'
						colors={["#e33835"]}
					/>
				}>
				{/* ══════════════════════════════════════════════ */}
				{/* CINEMATIC HERO                                 */}
				{/* ══════════════════════════════════════════════ */}
				<View
					style={{
						height: height * 0.52,
						position: "relative",
						overflow: "hidden",
					}}>
					{/* BG gradient */}
					<LinearGradient
						colors={
							isDark
								? ["#1a0404", "#0d0d0d", "#080808"]
								: ["#fce8e8", "#f5f5f5", t.bg]
						}
						start={{ x: 0.2, y: 0 }}
						end={{ x: 1, y: 1 }}
						style={StyleSheet.absoluteFill}
					/>

					{/* Decorative circles */}
					<View
						style={{
							position: "absolute",
							top: -80,
							right: -80,
							width: 320,
							height: 320,
							borderRadius: 160,
							backgroundColor: "#e3383508",
							borderWidth: 1,
							borderColor: "#e3383520",
						}}
					/>
					<View
						style={{
							position: "absolute",
							top: -40,
							right: -40,
							width: 200,
							height: 200,
							borderRadius: 100,
							backgroundColor: "#e3383512",
							borderWidth: 1,
							borderColor: "#e3383530",
						}}
					/>
					<View
						style={{
							position: "absolute",
							bottom: -60,
							left: -60,
							width: 240,
							height: 240,
							borderRadius: 120,
							backgroundColor: "#e3383506",
						}}
					/>

					{/* Scan line effect */}
					<View
						style={{
							position: "absolute",
							top: 0,
							left: 0,
							right: 0,
							bottom: 0,
						}}>
						{Array.from({ length: 12 }).map((_, i) => (
							<View
								key={i}
								style={{
									position: "absolute",
									left: 0,
									right: 0,
									top: i * ((height * 0.52) / 12),
									height: 1,
									backgroundColor: isDark ? "#ffffff04" : "#00000004",
								}}
							/>
						))}
					</View>

					{/* TOP BAR */}
					<Animated.View
						style={{
							opacity: fadeAnim,
							paddingTop: 58,
							paddingHorizontal: 22,
							flexDirection: "row",
							justifyContent: "space-between",
							alignItems: "center",
						}}>
						{/* Logo */}
						<View
							style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
							<View
								style={{
									backgroundColor: "#e33835",
									borderRadius: 8,
									padding: 5,
								}}>
								<MaterialCommunityIcons
									name='car-sports'
									size={16}
									color='#fff'
								/>
							</View>
							<Text
								style={{
									fontFamily: "Orbitron",
									fontSize: 16,
									color: t.text,
									fontWeight: "900",
									letterSpacing: 4,
								}}>
								VROOM
							</Text>
						</View>

						{/* Right side */}
						<View
							style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
							<TouchableOpacity
								onPress={() => router.push("/notifications")}
								activeOpacity={0.85}
								style={{
									width: 40,
									height: 40,
									borderRadius: 20,
									backgroundColor: t.surface,
									borderWidth: 1,
									borderColor: t.border2,
									alignItems: "center",
									justifyContent: "center",
								}}>
								<MaterialIcons name="notifications-none" size={22} color={t.text} />
								{notifUnread > 0 && (
									<View
										style={{
											position: "absolute",
											top: 4,
											right: 4,
											minWidth: 16,
											height: 16,
											borderRadius: 8,
											backgroundColor: "#e33835",
											alignItems: "center",
											justifyContent: "center",
											paddingHorizontal: 4,
										}}>
											<Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>
												{notifUnread > 99 ? "99+" : notifUnread}
											</Text>
										</View>
								)}
							</TouchableOpacity>
							{/* Online pill */}
							<View
								style={{
									flexDirection: "row",
									alignItems: "center",
									gap: 5,
									backgroundColor: "#4de92612",
									borderWidth: 1,
									borderColor: "#4de92635",
									paddingHorizontal: 10,
									paddingVertical: 5,
									borderRadius: 20,
								}}>
								<Animated.View
									style={{
										width: 6,
										height: 6,
										borderRadius: 3,
										backgroundColor: "#4de926",
										transform: [{ scale: pulseAnim }],
									}}
								/>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 8,
										color: "#4de926",
										letterSpacing: 2,
									}}>
									ONLINE
								</Text>
							</View>
							{/* Avatar */}
							<TouchableOpacity
								onPress={() => router.push("/account")}
								style={{
									width: 40,
									height: 40,
									borderRadius: 20,
									backgroundColor: t.primaryBg,
									borderWidth: 2,
									borderColor: "#e33835",
									overflow: "hidden",
									alignItems: "center",
									justifyContent: "center",
								}}>
								{user.avatar ? (
									<Image
										source={{ uri: user.avatar }}
										style={{ width: 40, height: 40 }}
									/>
								) : (
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 14,
											color: "#e33835",
											fontWeight: "900",
										}}>
										{user.username.charAt(0).toUpperCase()}
									</Text>
								)}
							</TouchableOpacity>
						</View>
					</Animated.View>

					{/* MAIN HERO CONTENT */}
					<Animated.View
						style={{
							flex: 1,
							paddingHorizontal: 22,
							justifyContent: "center",
							paddingTop: 16,
							opacity: fadeAnim,
							transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
						}}>
						<Text
							style={{
								fontFamily: "Orbitron",
								fontSize: 10,
								color: "#e33835",
								letterSpacing: 4,
								marginBottom: 6,
							}}>
							WITAMY Z POWROTEM
						</Text>

						<Text
							style={{
								fontFamily: "Orbitron",
								fontSize: Math.min(42, width * 0.1),
								color: t.text,
								fontWeight: "900",
								letterSpacing: -1,
								lineHeight: Math.min(48, width * 0.115),
							}}
							numberOfLines={2}>
							{user.username}
						</Text>

						{user.mainCar && (
							<View
								style={{
									flexDirection: "row",
									alignItems: "center",
									gap: 6,
									marginTop: 10,
									alignSelf: "flex-start",
									backgroundColor: "#e3383515",
									borderWidth: 1,
									borderColor: "#e3383535",
									paddingHorizontal: 12,
									paddingVertical: 6,
									borderRadius: 20,
								}}>
								<MaterialCommunityIcons
									name='car-sports'
									size={12}
									color='#e33835'
								/>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 9,
										color: "#e33835aa",
									}}>
									{user.mainCar.brand} · {user.mainCar.specs}
								</Text>
							</View>
						)}

						{/* MEGA STATS ROW */}
						<View style={{ flexDirection: "row", gap: 10, marginTop: 24 }}>
							{/* Position */}
							<View
								style={{
									flex: 1,
									backgroundColor: "#e3383512",
									borderRadius: 16,
									borderWidth: 1,
									borderColor: "#e3383530",
									padding: 14,
									alignItems: "center",
								}}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 22,
										color: "#e33835",
										fontWeight: "900",
									}}>
									#{user.position ?? "—"}
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 7,
										color: t.textDim,
										letterSpacing: 2,
										marginTop: 3,
									}}>
									POZYCJA
								</Text>
							</View>
							{/* Points */}
							<View
								style={{
									flex: 1,
									backgroundColor: isDark ? "#ffffff08" : "#00000008",
									borderRadius: 16,
									borderWidth: 1,
									borderColor: isDark ? "#ffffff12" : "#00000012",
									padding: 14,
									alignItems: "center",
								}}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 22,
										color: t.text,
										fontWeight: "900",
									}}>
									{user.points ?? 0}
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 7,
										color: t.textDim,
										letterSpacing: 2,
										marginTop: 3,
									}}>
									PUNKTY
								</Text>
							</View>
							{/* Streak */}
							<View
								style={{
									flex: 1,
									backgroundColor:
										user.streak > 0
											? "#ff922b12"
											: isDark
												? "#ffffff08"
												: "#00000008",
									borderRadius: 16,
									borderWidth: 1,
									borderColor:
										user.streak > 0
											? "#ff922b35"
											: isDark
												? "#ffffff12"
												: "#00000012",
									padding: 14,
									alignItems: "center",
								}}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 22,
										color: user.streak > 0 ? "#ff922b" : t.text,
										fontWeight: "900",
									}}>
									{user.streak ?? 0}
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 7,
										color: t.textDim,
										letterSpacing: 2,
										marginTop: 3,
									}}>
									🔥 STREAK
								</Text>
							</View>
						</View>
					</Animated.View>

					{/* Bottom fade */}
					<LinearGradient
						colors={["transparent", t.bg]}
						style={{
							position: "absolute",
							bottom: 0,
							left: 0,
							right: 0,
							height: 60,
						}}
					/>
				</View>
				{/* ══════════════════════════════════════════════ */}
				{/* ANNOUNCEMENTS BANNER                           */}
				{/* ══════════════════════════════════════════════ */}
				<Animated.View
					style={{
						opacity: fadeAnim,
						paddingHorizontal: 20,
						marginBottom: 20,
					}}>
					<TouchableOpacity
						onPress={() => setShowAnnouncements(true)}
						activeOpacity={0.85}>
						<LinearGradient
							colors={isDark ? ["#1a0a1a", "#0f0f0f"] : ["#f8f0ff", "#f5f5f5"]}
							start={{ x: 0, y: 0 }}
							end={{ x: 1, y: 1 }}
							style={{
								borderRadius: 18,
								borderWidth: 1,
								borderColor: unseenCount > 0 ? "#a855f750" : t.border2,
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
							}}>
							<View
								style={{
									position: "absolute",
									right: -20,
									top: -20,
									width: 100,
									height: 100,
									borderRadius: 50,
									backgroundColor: "#a855f710",
								}}
							/>

							<View
								style={{
									width: 46,
									height: 46,
									borderRadius: 14,
									backgroundColor: "#a855f720",
									borderWidth: 1,
									borderColor: "#a855f740",
									alignItems: "center",
									justifyContent: "center",
								}}>
								<Text style={{ fontSize: 22 }}>📢</Text>
							</View>

							<View style={{ flex: 1 }}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 13,
										color: t.text,
										fontWeight: "700",
										marginBottom: 3,
									}}>
									Ogłoszenia
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 8,
										color: t.textDim,
									}}>
									Nowości · Aktualizacje · Eventy
								</Text>
							</View>

							{/* Badge z liczbą nieprzeczytanych */}
							{unseenCount > 0 && (
								<View
									style={{
										backgroundColor: "#a855f7",
										borderRadius: 10,
										paddingHorizontal: 8,
										paddingVertical: 4,
										minWidth: 24,
										alignItems: "center",
									}}>
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 10,
											color: "#fff",
											fontWeight: "900",
										}}>
										{unseenCount}
									</Text>
								</View>
							)}

							<View
								style={{
									backgroundColor: "#a855f715",
									borderRadius: 10,
									padding: 8,
									borderWidth: 1,
									borderColor: "#a855f730",
								}}>
								<MaterialIcons
									name='arrow-forward-ios'
									size={13}
									color='#a855f7'
								/>
							</View>
						</LinearGradient>
					</TouchableOpacity>
				</Animated.View>
				{/* ══════════════════════════════════════════════ */}
				{/* THE GRID — aktywne głosowanie                  */}
				{/* ══════════════════════════════════════════════ */}
				{activeGridVotes.length > 0 && (
					<Animated.View
						style={{
							opacity: fadeAnim,
							paddingHorizontal: 20,
							marginBottom: 20,
						}}>
						<Text
							style={{
								fontFamily: "Orbitron",
								fontSize: 8,
								letterSpacing: 3,
								color: t.textDim,
								marginBottom: 8,
								marginLeft: 2,
							}}>
							THE GRID · GŁOSOWANIE
						</Text>
						{activeGridVotes.length === 1 ? (
							<TouchableOpacity
								activeOpacity={0.85}
								onPress={() =>
									router.push(
										`/Community/grid/vote?eventId=${activeGridVotes[0].eventId}` as any,
									)
								}>
								<LinearGradient
									colors={
										isDark
											? ["#2a1f05", "#161208", "#0c0c0c"]
											: ["#fff9e8", "#fff3d0", "#faf6ef"]
									}
									start={{ x: 0, y: 0 }}
									end={{ x: 1, y: 1 }}
									style={{
										borderRadius: 18,
										borderWidth: 1,
										borderColor: `${t.gold}55`,
										padding: 18,
										flexDirection: "row",
										alignItems: "center",
										gap: 14,
										overflow: "hidden",
									}}>
									<View
										style={{
											position: "absolute",
											right: -24,
											top: -24,
											width: 100,
											height: 100,
											borderRadius: 50,
											backgroundColor: `${t.gold}14`,
										}}
									/>
									<View
										style={{
											width: 48,
											height: 48,
											borderRadius: 14,
											backgroundColor: `${t.gold}22`,
											borderWidth: 1,
											borderColor: `${t.gold}44`,
											alignItems: "center",
											justifyContent: "center",
										}}>
										<Text style={{ fontSize: 22 }}>
											{activeGridVotes[0].categoryIcon}
										</Text>
									</View>
									<View style={{ flex: 1 }}>
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 8,
												color: t.gold,
												letterSpacing: 2,
												marginBottom: 4,
											}}>
											RUNDA {activeGridVotes[0].currentRound}
										</Text>
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 13,
												color: t.text,
												fontWeight: "700",
												marginBottom: 3,
											}}>
											{activeGridVotes[0].categoryName.toUpperCase()}
										</Text>
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 8,
												color: t.textDim,
											}}>
											1v1 Arena · oddaj głos teraz
										</Text>
									</View>
									<View
										style={{
											backgroundColor: `${t.gold}18`,
											borderRadius: 10,
											padding: 8,
											borderWidth: 1,
											borderColor: `${t.gold}40`,
										}}>
										<MaterialIcons
											name='how-to-vote'
											size={18}
											color={t.gold}
										/>
									</View>
								</LinearGradient>
							</TouchableOpacity>
						) : (
							<View>
								<FlatList
									data={activeGridVotes}
									horizontal
									pagingEnabled
									showsHorizontalScrollIndicator={false}
									keyExtractor={(it: ActiveGridVote) =>
										String(it.eventId)
									}
									style={{ width: gridVoteBannerW, alignSelf: "center" }}
									onMomentumScrollEnd={(e: {
										nativeEvent: { contentOffset: { x: number } };
									}) => {
										const idx = Math.round(
											e.nativeEvent.contentOffset.x / gridVoteBannerW,
										);
										setGridCarouselIndex(
											Math.min(
												Math.max(0, idx),
												activeGridVotes.length - 1,
											),
										);
									}}
									renderItem={({
										item,
									}: {
										item: ActiveGridVote;
									}) => (
										<TouchableOpacity
											activeOpacity={0.85}
											style={{ width: gridVoteBannerW }}
											onPress={() =>
												router.push(
													`/Community/grid/vote?eventId=${item.eventId}` as any,
												)
											}>
											<LinearGradient
												colors={
													isDark
														? ["#2a1f05", "#161208", "#0c0c0c"]
														: ["#fff9e8", "#fff3d0", "#faf6ef"]
												}
												start={{ x: 0, y: 0 }}
												end={{ x: 1, y: 1 }}
												style={{
													borderRadius: 18,
													borderWidth: 1,
													borderColor: `${t.gold}55`,
													padding: 18,
													flexDirection: "row",
													alignItems: "center",
													gap: 14,
													overflow: "hidden",
												}}>
												<View
													style={{
														position: "absolute",
														right: -24,
														top: -24,
														width: 100,
														height: 100,
														borderRadius: 50,
														backgroundColor: `${t.gold}14`,
													}}
												/>
												<View
													style={{
														width: 48,
														height: 48,
														borderRadius: 14,
														backgroundColor: `${t.gold}22`,
														borderWidth: 1,
														borderColor: `${t.gold}44`,
														alignItems: "center",
														justifyContent: "center",
													}}>
													<Text style={{ fontSize: 22 }}>
														{item.categoryIcon}
													</Text>
												</View>
												<View style={{ flex: 1 }}>
													<Text
														style={{
															fontFamily: "Orbitron",
															fontSize: 8,
															color: t.gold,
															letterSpacing: 2,
															marginBottom: 4,
														}}>
														RUNDA {item.currentRound}
													</Text>
													<Text
														style={{
															fontFamily: "Orbitron",
															fontSize: 13,
															color: t.text,
															fontWeight: "700",
															marginBottom: 3,
														}}>
														{item.categoryName.toUpperCase()}
													</Text>
													<Text
														style={{
															fontFamily: "Orbitron",
															fontSize: 8,
															color: t.textDim,
														}}>
														Przesuń palcem · zagłosuj
													</Text>
												</View>
												<View
													style={{
														backgroundColor: `${t.gold}18`,
														borderRadius: 10,
														padding: 8,
														borderWidth: 1,
														borderColor: `${t.gold}40`,
													}}>
													<MaterialIcons
														name='how-to-vote'
														size={18}
														color={t.gold}
													/>
												</View>
											</LinearGradient>
										</TouchableOpacity>
									)}
								/>
								<View
									style={{
										flexDirection: "row",
										justifyContent: "center",
										alignItems: "center",
										gap: 6,
										marginTop: 12,
									}}>
									{activeGridVotes.map((_: ActiveGridVote, i: number) => (
										<View
											key={i}
											style={{
												width: gridCarouselIndex === i ? 18 : 7,
												height: 7,
												borderRadius: 4,
												backgroundColor:
													gridCarouselIndex === i
														? t.gold
														: isDark
															? "#ffffff28"
															: "#00000028",
											}}
										/>
									))}
								</View>
							</View>
						)}
					</Animated.View>
				)}
				{/* ══════════════════════════════════════════════ */}
				{/* PREMIUM STATUS BANNER                          */}
				{/* ══════════════════════════════════════════════ */}
				<Animated.View
					style={{
						opacity: fadeAnim,
						paddingHorizontal: 20,
						marginTop: -10,
						marginBottom: 16,
					}}>
					<TouchableOpacity
						onPress={() => router.push("/premium" as any)}
						activeOpacity={0.86}>
						<LinearGradient
							colors={
								premiumLoading
									? isDark
										? ["#141414", "#0d0d0d"]
										: ["#f5f5f5", "#efefef"]
									: effectivePremium
										? ["#2a2000", "#1a1500", "#0a0a0a"]
										: isDark
											? ["#1a0808", "#100404", "#0a0a0a"]
											: ["#fff5f5", "#fff0f0", "#fafafa"]
							}
							start={{ x: 0, y: 0 }}
							end={{ x: 1, y: 1 }}
							style={{
								borderRadius: 20,
								borderWidth: 1,
								borderColor: premiumLoading
									? t.border
									: effectivePremium
										? "#FFD70040"
										: "#e3383540",
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
							}}>
							<View
								style={{
									position: "absolute",
									right: -18,
									top: -22,
									width: 110,
									height: 110,
									borderRadius: 55,
									backgroundColor: premiumLoading
										? isDark
											? "#ffffff08"
											: "#00000006"
										: effectivePremium
											? "#FFD70018"
											: "#e3383510",
								}}
							/>

							<View
								style={{
									width: 48,
									height: 48,
									borderRadius: 14,
									backgroundColor: premiumLoading
										? isDark
											? "#ffffff10"
											: "#00000010"
										: effectivePremium
											? "#FFD70020"
											: "#e3383520",
									borderWidth: 1,
									borderColor: premiumLoading
										? isDark
											? "#ffffff20"
											: "#00000020"
										: effectivePremium
											? "#FFD70040"
											: "#e3383540",
									alignItems: "center",
									justifyContent: "center",
								}}>
								<MaterialIcons
									name={effectivePremium ? "workspace-premium" : "lock-open"}
									size={22}
									color={
										premiumLoading
											? t.textDim
											: effectivePremium
												? "#FFD700"
												: "#e33835"
									}
								/>
							</View>

							<View style={{ flex: 1 }}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 8,
										color: premiumLoading
											? t.textDim
											: effectivePremium
												? "#FFD700"
												: "#e33835",
										letterSpacing: 2.2,
										marginBottom: 4,
									}}>
									{premiumLoading
										? "SPRAWDZANIE PREMIUM"
										: effectivePremium
											? "VROOM PREMIUM"
											: "DOSTĘP PREMIUM"}
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 12,
										color: t.text,
										fontWeight: "700",
										marginBottom: 3,
									}}>
									{premiumLoading
										? "Ładowanie statusu konta..."
										: effectivePremium
											? "Premium jest aktywne na tym koncie"
											: "Odblokuj Premium i dodatkowe funkcje"}
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 8,
										color: t.textDim,
									}}>
									{effectivePremium
										? "Dziękujemy za wsparcie projektu"
										: "Dotknij, aby przejść do zakupu"}
								</Text>
							</View>

							<View
								style={{
									backgroundColor: premiumLoading
										? isDark
											? "#ffffff10"
											: "#00000010"
										: effectivePremium
											? "#FFD70018"
											: "#e3383515",
									borderRadius: 10,
									padding: 8,
									borderWidth: 1,
									borderColor: premiumLoading
										? isDark
											? "#ffffff20"
											: "#00000020"
										: effectivePremium
											? "#FFD70040"
											: "#e3383535",
								}}>
								<MaterialIcons
									name={effectivePremium ? "check" : "arrow-forward-ios"}
									size={13}
									color={
										premiumLoading
											? t.textDim
											: effectivePremium
												? "#FFD700"
												: "#e33835"
									}
								/>
							</View>
						</LinearGradient>
					</TouchableOpacity>
				</Animated.View>

				{/* ══════════════════════════════════════════════ */}
				{/* SUPPORT BANNER                                 */}
				{/* ══════════════════════════════════════════════ */}
				<Animated.View
					style={{
						opacity: fadeAnim,
						paddingHorizontal: 20,
						marginBottom: 20,
					}}>
					<TouchableOpacity
						onPress={() => Linking.openURL("https://buycoffee.to/vroom")}
						activeOpacity={0.85}>
						<LinearGradient
							colors={["#f5c51820", "#f5c51808", "transparent"]}
							start={{ x: 0, y: 0 }}
							end={{ x: 1, y: 1 }}
							style={{
								borderRadius: 18,
								borderWidth: 1,
								borderColor: "#f5c51840",
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
							}}>
							<View
								style={{
									position: "absolute",
									left: -10,
									top: -10,
									width: 80,
									height: 80,
									borderRadius: 40,
									backgroundColor: "#f5c51808",
								}}
							/>
							<View
								style={{
									width: 46,
									height: 46,
									borderRadius: 14,
									backgroundColor: "#f5c51820",
									borderWidth: 1,
									borderColor: "#f5c51840",
									alignItems: "center",
									justifyContent: "center",
								}}>
								<Text style={{ fontSize: 22 }}>☕</Text>
							</View>
							<View style={{ flex: 1 }}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 13,
										color: t.text,
										fontWeight: "700",
										marginBottom: 3,
									}}>
									Postaw nam kawę
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 8,
										color: t.textDim,
									}}>
									Podoba Ci się VROOM? Wesprzyj projekt!
								</Text>
							</View>
							<View
								style={{
									backgroundColor: "#f5c51815",
									borderRadius: 10,
									padding: 8,
									borderWidth: 1,
									borderColor: "#f5c51835",
								}}>
								<MaterialIcons
									name='arrow-forward-ios'
									size={13}
									color='#f5c518'
								/>
							</View>
						</LinearGradient>
					</TouchableOpacity>
				</Animated.View>

				{/* ══════════════════════════════════════════════ */}
				{/* AD BANNER                                      */}
				{/* ══════════════════════════════════════════════ */}
				<Animated.View style={{ opacity: fadeAnim }}>
					<AdBanner />
				</Animated.View>

				{/* ══════════════════════════════════════════════ */}
				{/* QUICK NAV — DUŻE PRZYCISKI                    */}
				{/* ═════════════════════════���════════════════════ */}
				<Animated.View
					style={{
						opacity: fadeAnim,
						paddingHorizontal: 20,
						marginBottom: 16,
					}}>
					<Text
						style={{
							fontFamily: "Orbitron",
							fontSize: 8,
							color: t.textDim,
							letterSpacing: 4,
							marginBottom: 14,
						}}>
						SZYBKA NAWIGACJA
					</Text>

					{/* MAPA — duży przycisk */}
					<TouchableOpacity
						onPress={() => router.push("/map")}
						activeOpacity={0.85}
						style={{ marginBottom: 10 }}>
						<LinearGradient
							colors={["#e33835", "#c02020"]}
							start={{ x: 0, y: 0 }}
							end={{ x: 1, y: 1 }}
							style={{
								borderRadius: 20,
								padding: 22,
								flexDirection: "row",
								alignItems: "center",
								gap: 16,
								overflow: "hidden",
							}}>
							<View
								style={{
									position: "absolute",
									right: -20,
									top: -20,
									width: 130,
									height: 130,
									borderRadius: 65,
									backgroundColor: "#ffffff15",
								}}
							/>
							<View
								style={{
									position: "absolute",
									right: 20,
									top: 20,
									width: 60,
									height: 60,
									borderRadius: 30,
									backgroundColor: "#ffffff10",
								}}
							/>
							<View
								style={{
									width: 54,
									height: 54,
									borderRadius: 16,
									backgroundColor: "#ffffff20",
									alignItems: "center",
									justifyContent: "center",
								}}>
								<MaterialIcons name='map' size={28} color='#fff' />
							</View>
							<View style={{ flex: 1 }}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 18,
										color: "#fff",
										fontWeight: "900",
										letterSpacing: 1,
									}}>
									MAPA{" "}
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 9,
										color: "#ffffff80",
										marginTop: 3,
									}}>
									Nawigacja · Live tracking · Trasy
								</Text>
							</View>
							<MaterialIcons
								name='arrow-forward-ios'
								size={18}
								color='#ffffff60'
							/>
						</LinearGradient>
					</TouchableOpacity>

					{/* Rząd 3 przycisków */}
					<View style={{ flexDirection: "row", gap: 10 }}>
						{[
							{
								icon: "flag-checkered",
								lib: "mci",
								label: "MEETY",
								sub: "Wydarzenia",
								route: "/Community/meets/events",
								color: "#ff6b35",
							},
							{
								icon: "leaderboard",
								lib: "mi",
								label: "RANKING",
								sub: "Top gracze",
								route: "/Community/Ranks/stats",
								color: "#4de926",
							},
							{
								icon: "chat-bubble",
								lib: "mi",
								label: "CZAT",
								sub: "Znajomi",
								route: "/(tabs)/community",
								color: "#268bff",
							},
						].map(item => (
							<TouchableOpacity
								key={item.label}
								onPress={() => router.push(item.route as any)}
								activeOpacity={0.8}
								style={{
									flex: 1,
									backgroundColor: t.surface,
									borderRadius: 18,
									borderWidth: 1,
									borderColor: t.border,
									padding: 16,
									alignItems: "center",
									gap: 8,
								}}>
								<View
									style={{
										width: 42,
										height: 42,
										borderRadius: 12,
										backgroundColor: item.color + "20",
										alignItems: "center",
										justifyContent: "center",
									}}>
									{item.lib === "mci" ? (
										<MaterialCommunityIcons
											name={item.icon as any}
											size={20}
											color={item.color}
										/>
									) : (
										<MaterialIcons
											name={item.icon as any}
											size={20}
											color={item.color}
										/>
									)}
								</View>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 9,
										color: t.text,
										fontWeight: "700",
										letterSpacing: 0.5,
									}}>
									{item.label}
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 7,
										color: t.textDim,
									}}>
									{item.sub}
								</Text>
							</TouchableOpacity>
						))}
					</View>
				</Animated.View>

				{/* Modal ogłoszeń */}
				<AnnouncementsModal
					visible={showAnnouncements}
					onClose={() => setShowAnnouncements(false)}
				/>

				<PartnerBannersSection theme={t} isDark={isDark} fadeAnim={fadeAnim} />

				<QuestTrackSection theme={t} fadeAnim={fadeAnim} />

				{/* ══════════════════════════════════════════════ */}
				{/* ACHIEVEMENT BANNER                             */}
				{/* ══════════════════════════════════════════════ */}
				{user.latestAchievement && (
					<Animated.View
						style={{
							opacity: fadeAnim,
							paddingHorizontal: 20,
							marginBottom: 16,
						}}>
						<TouchableOpacity
							onPress={() => router.push("/account")}
							activeOpacity={0.85}>
							<LinearGradient
								colors={["#f5c51820", "#f5c51808", "transparent"]}
								start={{ x: 0, y: 0 }}
								end={{ x: 1, y: 1 }}
								style={{
									borderRadius: 18,
									borderWidth: 1,
									borderColor: "#f5c51840",
									padding: 18,
									flexDirection: "row",
									alignItems: "center",
									gap: 14,
								}}>
								<View
									style={{
										width: 50,
										height: 50,
										borderRadius: 25,
										backgroundColor: "#f5c51820",
										borderWidth: 2,
										borderColor: "#f5c51840",
										alignItems: "center",
										justifyContent: "center",
									}}>
									<MaterialIcons
										name='emoji-events'
										size={26}
										color='#f5c518'
									/>
								</View>
								<View style={{ flex: 1 }}>
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 8,
											color: "#f5c518",
											letterSpacing: 3,
											marginBottom: 4,
										}}>
										OSTATNIE OSIĄGNIĘCIE
									</Text>
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 14,
											color: t.text,
											fontWeight: "700",
										}}>
										{user.latestAchievement.label}
									</Text>
								</View>
								<MaterialIcons
									name='arrow-forward-ios'
									size={14}
									color='#f5c51860'
								/>
							</LinearGradient>
						</TouchableOpacity>
					</Animated.View>
				)}

				{/* ══════════════════════════════════════════════ */}
				{/* COMMUNITY + SPOTS BANNERS                      */}
				{/* ══════════════════════════════════════════════ */}
				<Animated.View
					style={{
						opacity: fadeAnim,
						paddingHorizontal: 20,
						gap: 10,
						marginBottom: 16,
					}}>
					<Text
						style={{
							fontFamily: "Orbitron",
							fontSize: 8,
							color: t.textDim,
							letterSpacing: 4,
							marginBottom: 4,
						}}>
						SPOŁECZNOŚĆ
					</Text>

					<TouchableOpacity
						onPress={() => router.push("/(tabs)/community")}
						activeOpacity={0.85}>
						<LinearGradient
							colors={["#268bff18", "#268bff08", "transparent"]}
							start={{ x: 0, y: 0 }}
							end={{ x: 1, y: 1 }}
							style={{
								borderRadius: 18,
								borderWidth: 1,
								borderColor: "#268bff30",
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
							}}>
							<View
								style={{
									position: "absolute",
									right: -20,
									top: -20,
									width: 100,
									height: 100,
									borderRadius: 50,
									backgroundColor: "#268bff08",
								}}
							/>
							<View
								style={{
									width: 50,
									height: 50,
									borderRadius: 16,
									backgroundColor: "#268bff20",
									borderWidth: 1,
									borderColor: "#268bff40",
									alignItems: "center",
									justifyContent: "center",
								}}>
								<MaterialIcons
									name='chat-bubble-outline'
									size={24}
									color='#268bff'
								/>
							</View>
							<View style={{ flex: 1 }}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 14,
										color: t.text,
										fontWeight: "700",
										marginBottom: 3,
									}}>
									Czat & Znajomi
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 8,
										color: t.textDim,
									}}>
									Napisz do kogoś · Sprawdź co słychać
								</Text>
							</View>
							<View
								style={{
									backgroundColor: "#268bff15",
									borderRadius: 10,
									padding: 8,
									borderWidth: 1,
									borderColor: "#268bff30",
								}}>
								<MaterialIcons
									name='arrow-forward-ios'
									size={13}
									color='#268bff'
								/>
							</View>
						</LinearGradient>
					</TouchableOpacity>

					<TouchableOpacity
						onPress={() => router.push("/(tabs)/spotmap")}
						activeOpacity={0.85}>
						<View
							style={{
								borderRadius: 18,
								borderWidth: 1,
								borderColor: t.border,
								backgroundColor: t.surface,
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
							}}>
							<View
								style={{
									position: "absolute",
									right: -20,
									top: -20,
									width: 100,
									height: 100,
									borderRadius: 50,
									backgroundColor: isDark ? "#ffffff05" : "#00000005",
								}}
							/>
							<View
								style={{
									width: 50,
									height: 50,
									borderRadius: 16,
									backgroundColor: t.primaryBg,
									borderWidth: 1,
									borderColor: t.primaryBorder,
									alignItems: "center",
									justifyContent: "center",
								}}>
								<MaterialIcons
									name='place'
									size={24}
									color={t.primary ?? "#e33835"}
								/>
							</View>
							<View style={{ flex: 1 }}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 14,
										color: t.text,
										fontWeight: "700",
										marginBottom: 3,
									}}>
									Mapa Spotów
								</Text>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 8,
										color: t.textDim,
									}}>
									Znajdź miejsca · Dodaj nowy spot
								</Text>
							</View>
							<View
								style={{
									backgroundColor: t.surface,
									borderRadius: 10,
									padding: 8,
									borderWidth: 1,
									borderColor: t.border,
								}}>
								<MaterialIcons
									name='arrow-forward-ios'
									size={13}
									color={t.textDim}
								/>
							</View>
						</View>
					</TouchableOpacity>
				</Animated.View>
			</ScrollView>

			{poll && (
				<PollModal
					visible={pollVisible}
					poll={poll}
					onVote={async optionIdx => {
						const ok = await vote(poll.id, optionIdx);
						return ok;
					}}
					onClose={() => setPollVisible(false)}
				/>
			)}

			{gifts[currentGiftIdx] && (
				<GiftModal
					visible={giftVisible}
					gift={gifts[currentGiftIdx]}
					onClaim={handleGiftClaim}
					onClose={handleGiftClose}
				/>
			)}

			<UpdateModal
				visible={updateAvailable}
				loading={downloading}
				onUpdate={applyUpdate}
				onDismiss={dismiss}
			/>
		</>
	);
}

