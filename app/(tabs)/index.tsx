import React, { useEffect, useState, useRef, useCallback } from "react";
import Toast from "react-native-toast-message";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useFocusEffect } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { FRIEND_INVITE_HANDLED } from "../../lib/friendInviteEvents";
import {
	ActivityIndicator,
	AccessibilityInfo,
	DeviceEventEmitter,
	ScrollView,
	TouchableOpacity,
	View,
	StatusBar,
	RefreshControl,
	Animated,
	InteractionManager,
} from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { LinearGradient } from "expo-linear-gradient";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { API_URL } from "../../constants/config";
import { useTheme } from "../../contexts/ThemeContext";
import { getThemeChrome, withAlpha } from "../../constants/theme";
import { pickAppAnimationForValue } from "../../constants/appAnimations";
import AppAnimationLayer from "../../components/animations/AppAnimationLayer";
import { useAppAnimations } from "../../hooks/useAppAnimations";
import { usePolls } from "../../hooks/usePolls";
import { useGifts } from "../../hooks/useGifts";
import { PollModal } from "../../components/modals/PollModal";
import { GiftModal } from "../../components/modals/GiftModal";
import { CampaignFlowModal } from "../../components/modals/CampaignFlowModal";
import { useEntryCampaign } from "../../hooks/useEntryCampaign";
import { AdSlot } from "../../components/ads/AdSlot";
import { useEffectivePremium } from "../../hooks/useEffectivePremium";
import { useStartupGates } from "../../contexts/StartupGatesContext";
import { QuestTrackSection } from "../../components/home/QuestTrackSection";
import { HomeDiscoverySection } from "../../components/home/HomeDiscoverySection";
import { HomeCockpit } from "../../components/home/HomeCockpit";
import { usePerformanceMotion } from "../../hooks/usePerformanceMotion";
import { PartnerBannersSection } from "../../components/home/PartnerBannersSection";
import { VroomShopCard } from "../../components/home/VroomShopCard";
import { SeasonSpotlightCard } from "../../components/seasons/SeasonSpotlightCard";
import { LiveCountdownText } from "../../components/home/LiveCountdownText";
import { apiRequest } from "../../lib/api/client";
import { queryClient } from "../../lib/query/client";
import { useAppPresence, STREAK_UPDATED } from "../../hooks/useAppPresence";
import { getNextStreakResetIso } from "../../lib/streakDeadline";
import { StreakUnlockFx } from "../../components/motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTabScrollBottomPadding } from "../../lib/screenHeaderInsets";

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
	const [reduceMotion, setReduceMotion] = useState(true);
	useEffect(() => {
		let active = true;
		AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => {});
		const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
		return () => { active = false; subscription.remove(); };
	}, []);
	const insets = useSafeAreaInsets();
	const tabScrollBottomPad = useTabScrollBottomPadding(16);
	const { gatesSettled, layoutGateOpen, setHomeOverlayOpen } = useStartupGates();
	const homeMotion = usePerformanceMotion(true, layoutGateOpen);
	const onlineCount = useAppPresence();
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [user, setUser] = useState<User | null>(null);
	const [streakFxVisible, setStreakFxVisible] = useState(false);
	const prevStreakRef = useRef(0);
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
		"app_loading_logo",
	]);
	const giftAutoShownRef = useRef(false);
	const pollAutoShownRef = useRef(false);
	const campaignAutoShownRef = useRef(false);

	const fetchNotifUnread = useCallback(async () => {
		try {
			type Bootstrap = { counters?: { unreadNotifications?: number } };
			const cached = queryClient.getQueryData<Bootstrap>(['bootstrap']);
			if (typeof cached?.counters?.unreadNotifications === 'number') {
				setNotifUnread(cached.counters.unreadNotifications);
			}
			const bootstrap = await queryClient.fetchQuery({
				queryKey: ['bootstrap'],
				queryFn: () => apiRequest<Bootstrap>('/v2/bootstrap', { priority: 'background' }),
				staleTime: 30_000,
			});
			setNotifUnread(bootstrap.counters?.unreadNotifications ?? 0);
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
	const pulseAnim = useRef(new Animated.Value(1)).current;

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
		if (!homeMotion.enabled || reduceMotion || !loading) {
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
	}, [homeMotion.enabled, loading, pulseAnim, reduceMotion]);

	const runEntrance = () => {
		if (reduceMotion) { fadeAnim.setValue(1); return; }
		Animated.timing(fadeAnim, {
				toValue: 1,
				duration: 600,
				useNativeDriver: true,
			}).start();
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
			// Typ paczki toast jest lokalnie uszkodzony (`isDrivingtext1`), runtime używa `text1`.
			Toast.show({ type: "error", text1: "BŁĄD SESJI" } as any);
			router.replace("/login");
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	};

	useEffect(() => {
		loadUser();
		fetchActivePoll();
		fetchAvailableGifts();
	}, []);

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
		refreshPremiumAccess().catch(() => {});
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
	const loadingAnimation = pickAppAnimationForValue(appAnimations, "app_loading_logo");

	const pageBg = chrome.pageGradient;
	const glassCardFill = chrome.glassCard;
	const glassBorder = chrome.glassBorder;
	const iconGlowStyle = {
		width: 44,
		height: 44,
		borderRadius: 22,
		backgroundColor: chrome.subtleIconGlow,
		alignItems: "center" as const,
		justifyContent: "center" as const,
	};
	const goldGlowStyle = {
		...iconGlowStyle,
		backgroundColor: withAlpha(t.gold, isDark ? "26" : "18"),
	};
	const glassShadow = {
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 } as const,
		shadowOpacity: 0.4,
		shadowRadius: 10,
		elevation: 4,
	};

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
						fontFamily: "Manrope_600SemiBold",
						fontSize: 28,
						color: t.primary,
						letterSpacing: 1,
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
				contentContainerStyle={{ paddingBottom: tabScrollBottomPad }}
				showsVerticalScrollIndicator={false}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={onRefresh}
						tintColor={t.primary}
						colors={[t.primary]}
					/>
				}>
				<HomeCockpit
					user={user}
					topInset={insets.top}
					onlineCount={onlineCount}
					unread={notifUnread}
					premium={effectivePremium}
					active={homeMotion.enabled}
					reduceMotion={reduceMotion}
					premiumBadge={
						<AppAnimationLayer
							animation={reduceMotion || !isFocused ? undefined : premiumBadgeAnimation}
							style={{ width: 30, height: 30 }}
							fallbackIcon={<MaterialIcons name="workspace-premium" size={22} color={effectivePremium ? t.gold : t.primary} />}
						/>
					}
					streak={
						<AppAnimationLayer
							animation={reduceMotion || !isFocused ? undefined : streakAnimation}
							layout="behind"
							style={{ width: "100%", minHeight: 72, overflow: "visible" }}>
							<View style={{ alignItems: "center", gap: 5 }}>
								<MaterialIcons name="local-fire-department" size={17} color={t.primary} />
								<Text style={{ fontSize: 25, color: t.text, fontWeight: "900" }}>{user.streak ?? 0}</Text>
								<Text style={{ fontSize: 10, color: t.textDim, letterSpacing: 1, fontWeight: "800" }}>SERIA DNI</Text>
								<LiveCountdownText targetIso={user.streakResetAt ?? getNextStreakResetIso()} prefix="reset za " fallback="reset za chwilę" style={{ fontSize: 10, color: t.primary, textAlign: "center" }} />
							</View>
						</AppAnimationLayer>
					}
				/>
				<SeasonSpotlightCard active={isFocused} />

				<HomeDiscoverySection active={isFocused} showMap={false} />

				<VroomShopCard theme={t} />

				<PartnerBannersSection theme={t} isDark={isDark} fadeAnim={fadeAnim} />

				{/* AD BANNER                                      */}
				{/* ══════════════════════════════════════════════ */}
				<Animated.View style={{ opacity: fadeAnim }}>
					<AdSlot placement="home_banner" variant="banner" enabled={isFocused} />
				</Animated.View>

				{/* ══════════════════════════════════════════════ */}
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
											fontFamily: "Manrope_600SemiBold",
											fontSize: 12,
											color: "#FFD700",
											letterSpacing: 1,
											marginBottom: 4,
										}}>
										OSTATNIE OSIĄGNIĘCIE
									</Text>
									<Text
										style={{
											fontFamily: "Manrope_600SemiBold",
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
				visible={streakFxVisible && !reduceMotion}
				streak={user?.streak ?? 0}
				onDone={() => setStreakFxVisible(false)}
			/>

		</>
	);
}

