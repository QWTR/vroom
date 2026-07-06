import React, { useEffect, useState, useRef, useCallback } from "react";
import Toast from "react-native-toast-message";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useFocusEffect } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { DeviceEventEmitter } from "react-native";
import { FRIEND_INVITE_HANDLED } from "../../lib/friendInviteEvents";
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
	InteractionManager,
} from "react-native";
import { Text } from "@react-navigation/elements";
import { LinearGradient } from "expo-linear-gradient";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { API_URL } from "../../constants/config";
import { useTheme } from "../../contexts/ThemeContext";
import { getThemeChrome, withAlpha } from "../../constants/theme";
import { pickAppAnimationForValue } from "../../constants/appAnimations";
import AppAnimationLayer from "../../components/animations/AppAnimationLayer";
import { useAppAnimations } from "../../hooks/useAppAnimations";
import { AnnouncementsModal } from "../../components/modals/AnnouncementsModal";
import { useAnnouncements } from "../../hooks/useAnnouncements";
import { usePolls } from "../../hooks/usePolls";
import { useGifts } from "../../hooks/useGifts";
import { PollModal } from "../../components/modals/PollModal";
import { GiftModal } from "../../components/modals/GiftModal";
import { CampaignFlowModal } from "../../components/modals/CampaignFlowModal";
import { useEntryCampaign } from "../../hooks/useEntryCampaign";
import { AdSlot } from "../../components/ads/AdSlot";
import { usePremium } from "../../contexts/PremiumContext";
import { useEffectivePremium } from "../../hooks/useEffectivePremium";
import { useStartupGates } from "../../contexts/StartupGatesContext";
import { PartnerBannersSection } from "../../components/home/PartnerBannersSection";
import { QuestTrackSection } from "../../components/home/QuestTrackSection";
import { LiveCountdownText } from "../../components/home/LiveCountdownText";
import { useAppPresence, STREAK_UPDATED } from "../../hooks/useAppPresence";
import { getNextStreakResetIso } from "../../lib/streakDeadline";
import { StreakUnlockFx } from "../../components/motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width, height } = Dimensions.get("window");

type MainCar = { brand: string; specs: string; photo: string | null };
type Achievement = { type: string; label: string; unlockedAt: string };
type User = {
	username: string;
	email: string;
	userId: string;
	isPremium?: boolean;
	premiumExpiresAt?: string | null;
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
	streakResetAt?: string | null;
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
	status: "open" | "active";
	entriesCount: number;
	resetAt: string | null;
	resetKind: "round" | "registration" | null;
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
			streakResetAt: fresh.streakResetAt ?? old.streakResetAt ?? getNextStreakResetIso(),
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
	const isFocused = useIsFocused();
	const { theme, isDark } = useTheme();
	const insets = useSafeAreaInsets();
	const {
		isLoading: premiumLoading,
		refreshPremiumStatus,
		premiumStatus,
	} = usePremium();
	const { gatesSettled, layoutGateOpen, setHomeOverlayOpen } = useStartupGates();
	const onlineCount = useAppPresence();
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [user, setUser] = useState<User | null>(null);
	const [streakFxVisible, setStreakFxVisible] = useState(false);
	const prevStreakRef = useRef(0);
	const { unseenCount, load: loadAnnouncements } = useAnnouncements();
	const [showAnnouncements, setShowAnnouncements] = useState(false);

	const [activeGridVotes, setActiveGridVotes] = useState<ActiveGridVote[]>([]);
	const [gridCarouselIndex, setGridCarouselIndex] = useState(0);

	const handleQuestTrackSynced = useCallback(() => {
		void fetchFreshUser().then((fresh) => {
			if (fresh) setUser(fresh);
		});
	}, []);

	const [pollVisible, setPollVisible] = useState(false);
	const [giftVisible, setGiftVisible] = useState(false);
	const [campaignVisible, setCampaignVisible] = useState(false);
	const [currentGiftIdx, setCurrentGiftIdx] = useState(0);
	const [notifUnread, setNotifUnread] = useState(0);
	const { animations: appAnimations } = useAppAnimations([
		"home_streak",
		"home_premium_badge",
		"home_announcement",
		"app_loading_logo",
	]);
	const giftAutoShownRef = useRef(false);
	const pollAutoShownRef = useRef(false);
	const campaignAutoShownRef = useRef(false);

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
			void fetchFreshUser().then((fresh) => {
				if (fresh) setUser(fresh);
			});
		}, [fetchNotifUnread]),
	);

	useEffect(() => {
		const sub = DeviceEventEmitter.addListener(
			STREAK_UPDATED,
			(payload: { streak?: number; streakResetAt?: string | null }) => {
				if (typeof payload?.streak !== 'number') return;
				setUser((prev) => {
					if (!prev) return prev;
					return {
						...prev,
						streak: payload.streak!,
						streakResetAt: payload.streakResetAt ?? prev.streakResetAt ?? getNextStreakResetIso(),
					};
				});
			},
		);
		return () => sub.remove();
	}, []);

	useEffect(() => {
		const s = user?.streak ?? 0;
		const prev = prevStreakRef.current;
		if (s > prev && (s === 7 || s === 30 || s === 100 || (s > 0 && s % 50 === 0))) {
			setStreakFxVisible(true);
		}
		prevStreakRef.current = s;
	}, [user?.streak]);

	useEffect(() => {
		const sub = DeviceEventEmitter.addListener(FRIEND_INVITE_HANDLED, () => {
			void fetchNotifUnread();
		});
		return () => sub.remove();
	}, [fetchNotifUnread]);

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
	const {
		campaign,
		fetchActiveCampaign,
		completeCampaign,
		claimCampaignGift,
		voteCampaignPoll,
	} = useEntryCampaign();
	const pollRef = useRef(poll);
	const votedRef = useRef(voted);

	useEffect(() => {
		if (!isFocused) {
			pulseAnim.setValue(1);
			return;
		}
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(pulseAnim, {
					toValue: 1.15,
					duration: 3200,
					useNativeDriver: true,
				}),
				Animated.timing(pulseAnim, {
					toValue: 1,
					duration: 3200,
					useNativeDriver: true,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [isFocused, pulseAnim]);

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
					registrationEndsAt?: string;
					roundEndsAt?: string | null;
					nextResetAt?: string | null;
					nextResetKind?: "round" | "registration";
					_count?: { entries?: number };
				}[];
			}[];
			const votes: ActiveGridVote[] = [];
			for (const cat of categories ?? []) {
				const evs = Array.isArray(cat.events) ? cat.events : [];
				for (const ev of evs) {
					const entriesCount =
						typeof ev?._count?.entries === "number" ? ev._count.entries : 0;
					const shouldShow =
						ev.status === "active" || ev.status === "open";
					if (shouldShow) {
						const resetKind: "round" | "registration" | null =
							ev.nextResetKind
								? ev.nextResetKind
								: (ev.status === "active" ? "round" : "registration");
						const resetAt =
							ev.nextResetAt
								? ev.nextResetAt
								: (
									ev.status === "active"
										? (ev.roundEndsAt ?? null)
										: (ev.registrationEndsAt ?? null)
								);
						votes.push({
							eventId: ev.id,
							categoryName: cat.name,
							categorySlug: cat.slug,
							categoryIcon: cat.icon ?? "🏁",
							currentRound: ev.currentRound ?? 1,
							status: ev.status === "active" ? "active" : "open",
							entriesCount,
							resetAt,
							resetKind,
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

	useEffect(() => {
		setHomeOverlayOpen(campaignVisible || giftVisible || pollVisible);
	}, [campaignVisible, giftVisible, pollVisible, setHomeOverlayOpen]);

	// Kampanie powitalne — priorytet nad legacy gift/poll
	useEffect(() => {
		if (!isFocused) return;
		if (loading) return;
		if (!gatesSettled) return;
		if (layoutGateOpen) return;
		if (campaignAutoShownRef.current) return;

		let cancelled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const task = InteractionManager.runAfterInteractions(() => {
			timeoutId = setTimeout(async () => {
				if (cancelled || campaignAutoShownRef.current) return;
				const needsUgc = await AsyncStorage.getItem("needsUgcTerms");
				if (needsUgc === "1") return;
				const active = await fetchActiveCampaign();
				if (cancelled || !active) return;
				campaignAutoShownRef.current = true;
				setCampaignVisible(true);
			}, 600);
		});

		return () => {
			cancelled = true;
			task.cancel();
			if (timeoutId) clearTimeout(timeoutId);
		};
	}, [isFocused, loading, gatesSettled, layoutGateOpen, fetchActiveCampaign]);

	// GIFTY — po globalnych zgodach (pomiń gdy kampania powitalna)
	useEffect(() => {
		if (!isFocused) return;
		if (loading) return;
		if (!gatesSettled) return;
		if (layoutGateOpen) return;
		if (campaignAutoShownRef.current || campaignVisible) return;
		if (gifts.length === 0) return;
		if (giftAutoShownRef.current) return;

		let cancelled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const task = InteractionManager.runAfterInteractions(() => {
			timeoutId = setTimeout(async () => {
				if (cancelled || giftAutoShownRef.current) return;
				const needsUgc = await AsyncStorage.getItem("needsUgcTerms");
				if (needsUgc === "1") return;
				giftAutoShownRef.current = true;
				setCurrentGiftIdx(0);
				setGiftVisible(true);
			}, 600);
		});

		return () => {
			cancelled = true;
			task.cancel();
			if (timeoutId) clearTimeout(timeoutId);
		};
	}, [isFocused, loading, gifts.length, gatesSettled, layoutGateOpen, campaignVisible]);

	// ANKIETA — pokaż gdy brak giftów lub po zamknięciu giftów (pomiń gdy kampania)
	useEffect(() => {
		if (!isFocused) return;
		if (loading) return;
		if (!poll) return;
		if (voted) return;
		if (giftVisible) return;
		if (campaignVisible || campaignAutoShownRef.current) return;
		if (gifts.length > 0) return;
		if (pollAutoShownRef.current) return;
		pollAutoShownRef.current = true;
		setPollVisible(true);
	}, [isFocused, loading, poll?.id, voted, giftVisible, gifts.length, campaignVisible]);

	const handleCampaignClose = () => {
		setCampaignVisible(false);
	};

	const handleCampaignComplete = async () => {
		if (campaign) await completeCampaign(campaign.id);
	};

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
		refreshPremiumAccess().catch(() => {});
		loadAnnouncements();
		fetchActiveGridVotes();
		fetchNotifUnread();
		loadUser(false);
	};

	const { isPremium: effectivePremium, refresh: refreshPremiumAccess } = useEffectivePremium(
		user ? { isPremium: !!user.isPremium, premiumExpiresAt: user.premiumExpiresAt ?? null } : null,
	);
	const t = theme;
	const chrome = getThemeChrome(t, isDark);
	const streakAnimation = pickAppAnimationForValue(appAnimations, "home_streak", user?.streak ?? 0);
	const premiumBadgeAnimation = pickAppAnimationForValue(appAnimations, "home_premium_badge");
	const announcementAnimation = pickAppAnimationForValue(appAnimations, "home_announcement");
	const loadingAnimation = pickAppAnimationForValue(appAnimations, "app_loading_logo");
  const premiumEndDateRaw = premiumStatus.currentPeriodEnd ?? user?.premiumExpiresAt ?? null;
  const premiumEndLabel = premiumEndDateRaw
    ? new Date(premiumEndDateRaw).toLocaleDateString("pl-PL")
    : null;
	const gridVoteBannerW = width - 40;

	const pageBg = chrome.pageGradient;
	const glassCardFill = chrome.glassCard;
	const glassBorder = chrome.glassBorder;
	const pillBg = glassCardFill;
	const iconGlowStyle = {
		width: 44,
		height: 44,
		borderRadius: 22,
		backgroundColor: chrome.subtleIconGlow,
		alignItems: "center" as const,
		justifyContent: "center" as const,
	};
	const animatedIconGlowStyle = {
		...iconGlowStyle,
		backgroundColor: "#050505",
		borderWidth: 1,
		borderColor: withAlpha(t.primary, "55"),
		overflow: "hidden" as const,
	};
	const goldGlowStyle = {
		...iconGlowStyle,
		backgroundColor: withAlpha(t.gold, isDark ? "26" : "18"),
	};
	const sectionAccent = {
		width: 3,
		height: 12,
		backgroundColor: t.primary,
		borderRadius: 2,
		marginRight: 8,
	};
	const statNumColor = t.text;
	const statDivider = chrome.statDivider;
	const glassShadow = {
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 } as const,
		shadowOpacity: 0.4,
		shadowRadius: 10,
		elevation: 4,
	};
	const mapTextColor = t.text;
	const mapSubtextColor = t.textDim;

	if (loading || !user) {
		return (
			<LinearGradient
				colors={pageBg}
				style={{
					flex: 1,
					justifyContent: "center",
					alignItems: "center",
					gap: 12,
				}}>
					<Animated.View style={{ width: 72, height: 72, transform: [{ scale: pulseAnim }], alignItems: "center", justifyContent: "center" }}>
					{loadingAnimation ? (
						<AppAnimationLayer
							animation={loadingAnimation}
							style={{ width: 72, height: 72 }}
							fallbackIcon={<MaterialCommunityIcons name='car-sports' size={52} color={t.primary} />}
						/>
					) : (
						<MaterialCommunityIcons name='car-sports' size={52} color={t.primary} />
					)}
				</Animated.View>
				<Text
					style={{
						fontFamily: "Orbitron",
						fontSize: 28,
						color: t.primary,
						letterSpacing: 10,
						fontWeight: "900",
					}}>
					VROOM
				</Text>
				<ActivityIndicator
					size='small'
					color={withAlpha(t.primary, "80")}
					style={{ marginTop: 16 }}
				/>
			</LinearGradient>
		);
	}

	return (
		<>
			<StatusBar
				barStyle={isDark ? "light-content" : "dark-content"}
				backgroundColor='transparent'
				translucent
			/>
			<LinearGradient colors={pageBg} style={{ flex: 1 }}>
			<ScrollView
				style={{ flex: 1, backgroundColor: "transparent" }}
				contentContainerStyle={{ paddingBottom: 40 }}
				showsVerticalScrollIndicator={false}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={onRefresh}
						tintColor={t.primary}
						colors={[t.primary]}
					/>
				}>
				{/* ══════════════════════════════════════════════ */}
				{/* CINEMATIC HERO                                 */}
				{/* ══════════════════════════════════════════════ */}
				<View
					style={{
						height: height * 0.52,
						position: "relative",
					}}>
					{/* Tło hero — overflow tylko na dekoracjach, nie na pasku z avatarem */}
					<View
						pointerEvents="none"
						style={[StyleSheet.absoluteFillObject, { overflow: "hidden" }]}>
					{/* BG gradient */}
					<LinearGradient
						colors={
							chrome.heroGradient
						}
						start={{ x: 0.2, y: 0 }}
						end={{ x: 1, y: 1 }}
						style={StyleSheet.absoluteFill}
					/>

					{/* Decorative glass orbs */}
					<View
						pointerEvents="none"
						style={{
							position: "absolute",
							top: -80,
							right: -80,
							width: 320,
							height: 320,
							borderRadius: 160,
							backgroundColor: withAlpha(t.primary, isDark ? "12" : "10"),
							borderWidth: 1,
							borderColor: t.border2,
						}}
					/>
					<View
						pointerEvents="none"
						style={{
							position: "absolute",
							top: -40,
							right: -40,
							width: 200,
							height: 200,
							borderRadius: 100,
							backgroundColor: withAlpha(t.surface4, isDark ? "25" : "55"),
							borderWidth: 1,
							borderColor: t.border,
						}}
					/>
					<View
						pointerEvents="none"
						style={{
							position: "absolute",
							bottom: -60,
							left: -60,
							width: 240,
							height: 240,
							borderRadius: 120,
							backgroundColor: withAlpha(t.primary, isDark ? "0d" : "0a"),
						}}
					/>

					{/* Scan line effect */}
					<View
						pointerEvents='none'
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
									backgroundColor: chrome.scanLine,
								}}
							/>
						))}
					</View>
					</View>

					{/* TOP BAR */}
					<Animated.View
						style={{
							opacity: fadeAnim,
							zIndex: 10,
							paddingTop: insets.top + 10,
							paddingLeft: 16,
							paddingRight: Math.max(16, insets.right + 6),
							flexDirection: "row",
							alignItems: "center",
							gap: 8,
						}}>
						{/* Logo */}
						<View
							style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
							<View
								style={{
									backgroundColor: t.surface3,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: glassBorder,
									padding: 5,
								}}>
								<MaterialCommunityIcons
									name='car-sports'
									size={16}
									color={t.primary}
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
							style={{
								flex: 1,
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "flex-end",
								gap: 8,
								minWidth: 0,
							}}>
							<TouchableOpacity
								onPress={() => router.push("/premium" as any)}
								activeOpacity={0.85}
								accessibilityLabel="VROOM Premium"
								style={{
									width: 36,
									height: 36,
									borderRadius: 18,
									backgroundColor: t.surface3,
									borderWidth: 1,
									borderColor: effectivePremium ? withAlpha(t.gold, "66") : glassBorder,
									alignItems: "center",
									justifyContent: "center",
									overflow: "hidden",
								}}>
								{premiumBadgeAnimation ? (
									<AppAnimationLayer
										animation={premiumBadgeAnimation}
										style={{ width: 30, height: 30 }}
										fallbackIcon={
											<MaterialIcons
												name="workspace-premium"
												size={22}
												color={effectivePremium ? "#FFD700" : t.primary}
											/>
										}
									/>
								) : (
									<MaterialIcons
										name="workspace-premium"
										size={22}
										color={effectivePremium ? "#FFD700" : t.primary}
									/>
								)}
							</TouchableOpacity>
							<TouchableOpacity
								onPress={() => router.push("/notifications")}
								activeOpacity={0.85}
								style={{
									width: 36,
									height: 36,
									borderRadius: 18,
									backgroundColor: t.surface3,
									borderWidth: 1,
									borderColor: glassBorder,
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
									flexShrink: 1,
									minWidth: 0,
									backgroundColor: "rgba(77, 233, 38, 0.15)", // Green background with opacity
									borderWidth: 1,
									borderColor: "rgba(77, 233, 38, 0.3)", // Light green border
									paddingHorizontal: 8,
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
									numberOfLines={1}
									style={{
										fontFamily: "Orbitron",
										fontSize: 8,
										color: "#4de926",
										fontWeight: "700",
										letterSpacing: 1,
										flexShrink: 1,
									}}>
									{onlineCount != null ? `${onlineCount} ONLINE` : "ONLINE"}
								</Text>
							</View>
							{/* Avatar */}
							<TouchableOpacity
								onPress={() => router.navigate('/(tabs)/account' as any)}
								style={{
									width: 36,
									height: 36,
									borderRadius: 18,
									flexShrink: 0,
									backgroundColor: t.surface3,
									borderWidth: 1,
									borderColor: glassBorder,
									overflow: "hidden",
									alignItems: "center",
									justifyContent: "center",
								}}>
								{user.avatar ? (
									<Image
										source={{ uri: user.avatar }}
										style={{ width: 36, height: 36 }}
									/>
								) : (
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 14,
											color: t.primary,
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
								fontSize: 9,
								color: t.textDim,
								letterSpacing: 4,
								marginBottom: 6,
								textTransform: "uppercase",
							}}>
							Witamy z powrotem
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
									backgroundColor: t.surface3,
									borderWidth: 1,
									borderColor: glassBorder,
									paddingHorizontal: 12,
									paddingVertical: 6,
									borderRadius: 20,
								}}>
								<MaterialCommunityIcons
									name='car-sports'
									size={12}
									color={t.primary}
								/>
								<Text
									style={{
										fontSize: 10,
										color: t.textDim,
									}}>
									{user.mainCar.brand} · {user.mainCar.specs}
								</Text>
							</View>
						)}

						{/* STATS ROW — glass dividers */}
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								marginTop: 28,
								paddingVertical: 8,
								overflow: "visible",
							}}>
							<View style={{ flex: 1, alignItems: "center", gap: 4 }}>
								<MaterialIcons name="leaderboard" size={14} color={t.primary} />
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 22,
										color: statNumColor,
										fontWeight: "900",
									}}>
									#{user.position ?? "—"}
								</Text>
								<Text
									style={{
										fontSize: 8,
										color: t.textDim,
										letterSpacing: 2,
										textTransform: "uppercase",
									}}>
									Pozycja
								</Text>
							</View>
							<View style={{ width: 1, height: 44, backgroundColor: statDivider }} />
							<View style={{ flex: 1, alignItems: "center", gap: 4 }}>
								<MaterialIcons name="stars" size={14} color={t.primary} />
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 22,
										color: statNumColor,
										fontWeight: "900",
									}}>
									{user.points ?? 0}
								</Text>
								<Text
									style={{
										fontSize: 8,
										color: t.textDim,
										letterSpacing: 2,
										textTransform: "uppercase",
									}}>
									Punkty
								</Text>
							</View>
							<View style={{ width: 1, height: 44, backgroundColor: statDivider }} />
							<View style={{ flex: 1, alignItems: "center", overflow: "visible", minHeight: 72 }}>
								<AppAnimationLayer
									animation={streakAnimation}
									layout="behind"
									style={{ width: "100%", minHeight: 72, overflow: "visible" }}
									fallbackIcon={
										<MaterialIcons name="local-fire-department" size={14} color={t.primary} />
									}>
									<View style={{ alignItems: "center", gap: 4, paddingTop: 2 }}>
										{!streakAnimation ? (
											<MaterialIcons name="local-fire-department" size={14} color={t.primary} />
										) : null}
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 22,
												color: statNumColor,
												fontWeight: "900",
											}}>
											{user.streak ?? 0}
										</Text>
										<Text
											style={{
												fontSize: 8,
												color: t.textDim,
												letterSpacing: 2,
												textTransform: "uppercase",
											}}>
											Streak
										</Text>
										<LiveCountdownText
											targetIso={user.streakResetAt ?? getNextStreakResetIso()}
											prefix="reset za "
											fallback="reset za chwilę"
											style={{
												fontSize: 7,
												color: t.primary,
												fontFamily: "Orbitron",
												letterSpacing: 0.5,
												marginTop: 2,
												textAlign: "center",
											}}
										/>
									</View>
								</AppAnimationLayer>
							</View>
						</View>
					</Animated.View>

					{/* Bottom fade */}
					<LinearGradient
						colors={chrome.bottomFade}
						pointerEvents="none"
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
						<View
							style={{
								backgroundColor: glassCardFill,
								borderRadius: 20,
								borderWidth: 1,
								borderColor: glassBorder,
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
								...glassShadow,
							}}>
							<View style={announcementAnimation ? animatedIconGlowStyle : iconGlowStyle}>
								{announcementAnimation ? (
									<AppAnimationLayer
										animation={announcementAnimation}
										style={{ width: 32, height: 32 }}
										fallbackIcon={<MaterialIcons name="campaign" size={22} color={t.primary} />}
									/>
								) : (
									<MaterialIcons name="campaign" size={22} color={t.primary} />
								)}
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
										fontSize: 10,
										color: t.textDim,
									}}>
									Nowości · Aktualizacje · Eventy
								</Text>
							</View>

							{unseenCount > 0 && (
								<View
									style={{
										backgroundColor: t.primary,
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

							<MaterialIcons
								name='arrow-forward-ios'
								size={13}
								color={t.primary}
							/>
						</View>
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
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								marginBottom: 8,
								marginLeft: 2,
							}}>
							<View style={sectionAccent} />
							<Text
								style={{
									fontFamily: "Orbitron",
									fontSize: 8,
									letterSpacing: 3,
									color: t.textDim,
								}}>
								THE GRID · GŁOSOWANIE
							</Text>
						</View>
						{activeGridVotes.length === 1 ? (
							<TouchableOpacity
								activeOpacity={0.85}
								onPress={() =>
									activeGridVotes[0].status === "active"
										? router.push(
												`/Community/grid/vote?eventId=${activeGridVotes[0].eventId}` as any,
										  )
										: router.push(
												`/Community/grid/category?slug=${activeGridVotes[0].categorySlug}` as any,
										  )
								}>
								<View
									style={{
										backgroundColor: glassCardFill,
										borderRadius: 20,
										borderWidth: 1,
										borderColor: glassBorder,
										padding: 18,
										flexDirection: "row",
										alignItems: "center",
										gap: 14,
										overflow: "hidden",
										...glassShadow,
									}}>
									<View style={iconGlowStyle}>
										<Text style={{ fontSize: 22 }}>
											{activeGridVotes[0].categoryIcon}
										</Text>
									</View>
									<View style={{ flex: 1 }}>
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 8,
												color: t.primary,
												letterSpacing: 2,
												marginBottom: 4,
											}}>
											{activeGridVotes[0].status === "active"
												? `RUNDA ${activeGridVotes[0].currentRound}`
												: `ZGŁOSZENIA · ${activeGridVotes[0].entriesCount}`}
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
											{activeGridVotes[0].status === "active"
												? "1v1 Arena · oddaj głos teraz"
												: "Są aktywne zgłoszenia · sprawdź kategorię"}
										</Text>
										<LiveCountdownText
											targetIso={activeGridVotes[0].resetAt}
											style={{
												fontFamily: "Orbitron",
												fontSize: 8,
												color: t.textDim,
												marginTop: 3,
											}}
											formatLabel={(countdown) => {
												if (!countdown) return "Brak danych o resecie";
												return activeGridVotes[0].resetKind === "round"
													? `Reset rundy za: ${countdown}`
													: `Koniec zapisów za: ${countdown}`;
											}}
										/>
									</View>
									<MaterialIcons
										name={
											activeGridVotes[0].status === "active"
												? "how-to-vote"
												: "playlist-add-check"
										}
										size={18}
										color={t.primary}
									/>
								</View>
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
												item.status === "active"
													? router.push(
															`/Community/grid/vote?eventId=${item.eventId}` as any,
													  )
													: router.push(
															`/Community/grid/category?slug=${item.categorySlug}` as any,
													  )
											}>
											<View
												style={{
													backgroundColor: glassCardFill,
													borderRadius: 20,
													borderWidth: 1,
													borderColor: glassBorder,
													padding: 18,
													flexDirection: "row",
													alignItems: "center",
													gap: 14,
													overflow: "hidden",
													...glassShadow,
												}}>
												<View style={iconGlowStyle}>
													<Text style={{ fontSize: 22 }}>
														{item.categoryIcon}
													</Text>
												</View>
												<View style={{ flex: 1 }}>
													<Text
														style={{
															fontFamily: "Orbitron",
															fontSize: 8,
															color: t.primary,
															letterSpacing: 2,
															marginBottom: 4,
														}}>
														{item.status === "active"
															? `RUNDA ${item.currentRound}`
															: `ZGŁOSZENIA · ${item.entriesCount}`}
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
														{item.status === "active"
															? "Przesuń palcem · zagłosuj"
															: "Przesuń palcem · zobacz zgłoszenia"}
													</Text>
													<LiveCountdownText
														targetIso={item.resetAt}
														style={{
															fontFamily: "Orbitron",
															fontSize: 8,
															color: t.textDim,
															marginTop: 3,
														}}
														formatLabel={(countdown) => {
															if (!countdown) return "Brak danych o resecie";
															return item.resetKind === "round"
																? `Reset rundy za: ${countdown}`
																: `Koniec zapisów za: ${countdown}`;
														}}
													/>
												</View>
												<MaterialIcons
													name={
														item.status === "active"
															? "how-to-vote"
															: "playlist-add-check"
													}
													size={18}
													color={t.primary}
												/>
											</View>
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
														? t.primary
														: isDark
															? "rgba(255,255,255,0.15)"
															: "rgba(0,0,0,0.12)",
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
						<View
							style={{
								backgroundColor: glassCardFill,
								borderRadius: 20,
								borderWidth: 1,
								borderColor: glassBorder,
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
								...glassShadow,
							}}>
							<View
								style={
									premiumLoading
										? { ...iconGlowStyle, backgroundColor: "rgba(227, 56, 53, 0.15)" }
										: goldGlowStyle
								}>
								{premiumBadgeAnimation ? (
									<AppAnimationLayer
										animation={premiumBadgeAnimation}
										style={{ width: 36, height: 36 }}
										fallbackIcon={
											<MaterialIcons
												name={effectivePremium ? "workspace-premium" : "lock-open"}
												size={22}
												color={
													premiumLoading
														? t.textDim
														: "#FFD700"
												}
											/>
										}
									/>
								) : (
									<MaterialIcons
										name={effectivePremium ? "workspace-premium" : "lock-open"}
										size={22}
										color={
											premiumLoading
												? t.textDim
												: "#FFD700"
										}
									/>
								)}
							</View>

							<View style={{ flex: 1 }}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 8,
										color: premiumLoading ? t.textDim : "#FFD700",
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
										fontSize: 10,
										color: t.textDim,
									}}>
									{effectivePremium
										? "Dziękujemy za wsparcie projektu"
										: "Dotknij, aby przejść do zakupu"}
								</Text>
								{effectivePremium && (
									<Text
										style={{
											fontSize: 9,
											color: t.textDim,
											marginTop: 4,
										}}>
										{premiumEndLabel
											? `Koniec okresu: ${premiumEndLabel}`
											: "Korzyści Premium aktywne"}
									</Text>
								)}
							</View>

							<MaterialIcons
								name={effectivePremium ? "check" : "arrow-forward-ios"}
								size={13}
								color={premiumLoading ? t.textDim : "#FFD700"}
							/>
						</View>
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
						<View
							style={{
								backgroundColor: glassCardFill,
								borderRadius: 20,
								borderWidth: 1,
								borderColor: glassBorder,
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
								...glassShadow,
							}}>
							<View style={goldGlowStyle}>
								<Text style={{ fontSize: 20 }}>☕</Text>
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
										fontSize: 10,
										color: t.textDim,
									}}>
									Podoba Ci się VROOM? Wesprzyj projekt!
								</Text>
							</View>
							<MaterialIcons
								name='arrow-forward-ios'
								size={13}
								color='#FFD700'
							/>
						</View>
					</TouchableOpacity>
				</Animated.View>

				{/* ══════════════════════════════════════════════ */}
				{/* AD BANNER                                      */}
				{/* ══════════════════════════════════════════════ */}
				<Animated.View style={{ opacity: fadeAnim }}>
					<AdSlot placement="home_banner" variant="banner" enabled={isFocused} />
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
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							marginBottom: 14,
						}}>
						<View style={sectionAccent} />
						<Text
							style={{
								fontFamily: "Orbitron",
								fontSize: 8,
								color: t.textDim,
								letterSpacing: 4,
							}}>
							SZYBKA NAWIGACJA
						</Text>
					</View>

					{/* MAPA — szklana karta */}
					<TouchableOpacity
						onPress={() => router.push("/map")}
						activeOpacity={0.85}
						style={{ marginBottom: 10 }}>
						<View
							style={{
								backgroundColor: glassCardFill,
								borderRadius: 20,
								borderWidth: 1,
								borderColor: glassBorder,
								padding: 22,
								flexDirection: "row",
								alignItems: "center",
								gap: 16,
								overflow: "hidden",
								...glassShadow,
							}}>
							<View style={iconGlowStyle}>
								<MaterialIcons name='map' size={26} color={t.primary} />
							</View>
							<View style={{ flex: 1 }}>
								<Text
									style={{
										fontFamily: "Orbitron",
										fontSize: 18,
										color: mapTextColor,
										fontWeight: "900",
										letterSpacing: 1,
									}}>
									MAPA
								</Text>
								<Text
									style={{
										fontSize: 10,
										color: mapSubtextColor,
										marginTop: 3,
									}}>
									Nawigacja · Live tracking · Trasy
								</Text>
							</View>
							<MaterialIcons
								name='arrow-forward-ios'
								size={18}
								color={t.primary}
							/>
						</View>
					</TouchableOpacity>

					{/* Rząd 3 pigułek */}
					<View style={{ flexDirection: "row", gap: 10 }}>
						{[
							{
								icon: "flag-checkered",
								lib: "mci",
								label: "MEETY",
								sub: "Wydarzenia",
								route: "/Community/meets/events",
							},
							{
								icon: "smart-display",
								lib: "mi",
								label: "VROOMKI",
								sub: "Rolki aut",
								route: { pathname: "/Community/community/community", params: { tab: "vroomki" } },
							},
							{
								icon: "chat-bubble",
								lib: "mi",
								label: "CZAT",
								sub: "Znajomi",
								route: "/Community/chats/chats",
							},
						].map(item => (
							<TouchableOpacity
								key={item.label}
								onPress={() => router.push(item.route as any)}
								activeOpacity={0.8}
								style={{
									flex: 1,
									backgroundColor: pillBg,
									borderRadius: 20,
									borderWidth: 1,
									borderColor: glassBorder,
									paddingVertical: 16,
									paddingHorizontal: 8,
									alignItems: "center",
									gap: 8,
								}}>
								<View style={iconGlowStyle}>
									{item.lib === "mci" ? (
										<MaterialCommunityIcons
											name={item.icon as any}
											size={22}
											color={t.primary}
										/>
									) : (
										<MaterialIcons
											name={item.icon as any}
											size={22}
											color={t.primary}
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
										fontSize: 8,
										color: t.textDim,
									}}>
									{item.sub}
								</Text>
							</TouchableOpacity>
						))}
					</View>
				</Animated.View>

				<Animated.View
					style={{
						opacity: fadeAnim,
						paddingHorizontal: 20,
						marginBottom: 12,
					}}>
					<TouchableOpacity
						onPress={() => router.push({ pathname: "/profile/settings", params: { openBug: "1" } })}
						activeOpacity={0.85}>
						<View
							style={{
								backgroundColor: glassCardFill,
								borderRadius: 20,
								borderWidth: 1,
								borderColor: glassBorder,
								padding: 14,
								flexDirection: "row",
								alignItems: "center",
								gap: 10,
								...glassShadow,
							}}>
							<View style={iconGlowStyle}>
								<MaterialIcons name="bug-report" size={20} color={t.primary} />
							</View>
							<View style={{ flex: 1 }}>
								<Text style={{ fontFamily: "Orbitron", fontSize: 11, color: t.text, fontWeight: "700" }}>
									Zgłoś błąd
								</Text>
								<Text style={{ fontSize: 10, color: t.textDim, marginTop: 2 }}>
									Stały skrót do formularza zgłoszeń
								</Text>
							</View>
							<MaterialIcons name="arrow-forward-ios" size={12} color={t.primary} />
						</View>
					</TouchableOpacity>
				</Animated.View>

				{/* Modal ogłoszeń */}
				<AnnouncementsModal
					visible={showAnnouncements}
					onClose={() => setShowAnnouncements(false)}
				/>

				<PartnerBannersSection theme={t} isDark={isDark} fadeAnim={fadeAnim} />

				<QuestTrackSection
					theme={t}
					fadeAnim={fadeAnim}
					onSynced={handleQuestTrackSynced}
				/>

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
							onPress={() => router.navigate('/(tabs)/account' as any)}
							activeOpacity={0.85}>
							<View
								style={{
									backgroundColor: glassCardFill,
									borderRadius: 20,
									borderWidth: 1,
									borderColor: glassBorder,
									padding: 18,
									flexDirection: "row",
									alignItems: "center",
									gap: 14,
									...glassShadow,
								}}>
								<View style={goldGlowStyle}>
									<MaterialIcons
										name='emoji-events'
										size={26}
										color='#FFD700'
									/>
								</View>
								<View style={{ flex: 1 }}>
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 8,
											color: "#FFD700",
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
									color='#FFD700'
								/>
							</View>
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
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							marginBottom: 4,
						}}>
						<View style={sectionAccent} />
						<Text
							style={{
								fontFamily: "Orbitron",
								fontSize: 8,
								color: t.textDim,
								letterSpacing: 4,
							}}>
							SPOŁECZNOŚĆ
						</Text>
					</View>

					<TouchableOpacity
						onPress={() => router.push("/(tabs)/community")}
						activeOpacity={0.85}>
						<View
							style={{
								backgroundColor: glassCardFill,
								borderRadius: 20,
								borderWidth: 1,
								borderColor: glassBorder,
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
								...glassShadow,
							}}>
							<View style={iconGlowStyle}>
								<MaterialIcons
									name='chat-bubble-outline'
									size={24}
									color={t.primary}
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
										fontSize: 10,
										color: t.textDim,
									}}>
									Napisz do kogoś · Sprawdź co słychać
								</Text>
							</View>
							<MaterialIcons
								name='arrow-forward-ios'
								size={13}
								color={t.primary}
							/>
						</View>
					</TouchableOpacity>

					<TouchableOpacity
						onPress={() => router.push("/(tabs)/spotmap")}
						activeOpacity={0.85}>
						<View
							style={{
								backgroundColor: glassCardFill,
								borderRadius: 20,
								borderWidth: 1,
								borderColor: glassBorder,
								padding: 18,
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								overflow: "hidden",
								...glassShadow,
							}}>
							<View style={iconGlowStyle}>
								<MaterialIcons
									name='place'
									size={24}
									color={t.primary}
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
										fontSize: 10,
										color: t.textDim,
									}}>
									Znajdź miejsca · Dodaj nowy spot
								</Text>
							</View>
							<MaterialIcons
								name='arrow-forward-ios'
								size={13}
								color={t.primary}
							/>
						</View>
					</TouchableOpacity>
				</Animated.View>
			</ScrollView>
			</LinearGradient>

			{campaign && campaignVisible && (
				<CampaignFlowModal
					visible
					campaign={campaign}
					onClaimGift={claimCampaignGift}
					onVotePoll={voteCampaignPoll}
					onComplete={handleCampaignComplete}
					onClose={handleCampaignClose}
				/>
			)}

			{poll && pollVisible && (
				<PollModal
					visible
					poll={poll}
					onVote={async optionIdx => {
						const ok = await vote(poll.id, optionIdx);
						return ok;
					}}
					onClose={() => setPollVisible(false)}
				/>
			)}

			{gifts[currentGiftIdx] && giftVisible && (
				<GiftModal
					visible
					gift={gifts[currentGiftIdx]}
					onClaim={handleGiftClaim}
					onClose={handleGiftClose}
				/>
			)}

			<StreakUnlockFx
				visible={streakFxVisible}
				streak={user?.streak ?? 0}
				onDone={() => setStreakFxVisible(false)}
			/>

		</>
	);
}

