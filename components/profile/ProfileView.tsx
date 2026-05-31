import React, { useState, useRef, useEffect } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, RefreshControl,
  Image, Animated, Dimensions, StatusBar, Modal, Switch, ActivityIndicator, StyleSheet, Easing,
} from 'react-native';
import { LinearGradient }           from 'expo-linear-gradient';
import MaterialIcons                from '@expo/vector-icons/MaterialIcons';
import Ionicons                     from '@expo/vector-icons/Ionicons';
import { MaterialCommunityIcons }   from '@expo/vector-icons';
import { useRouter }                from 'expo-router';
import { useTheme }                 from '../../contexts/ThemeContext';

import { UserBadges }               from '../user/UserBadges';
import AvatarCircle                 from './AvatarCircle';
import StatBox                      from './StatBox';
import CarCard                      from './CarCard';
import AchievementBox               from './AchievementBox';
import SpotPreviewCard              from './SpotPreviewCard';
import { SpotDetailModal }          from '../spots/SpotDetailModal';
import type { Achievement }         from '../../hooks/useAchievements';
import type { UserProfile, Car, SpotPreview } from '../../constants/profile';
import type { Spot }                from '../../constants/spotTypes';
import RouteCard                    from './RouteCard';
import type { MyRoute }             from '../../hooks/useMyRoutes';
import { RoutesListModal }          from '../modals/RoutesListModal';
import { RouteLeaderboardModal }    from '../modals/RouteLeaderboardModal';
import { useRouteLeaderboard }      from '../../hooks/useRouteLeaderboard';
import ParticipatedRoutesSection    from './ParticipatedRouteCard';
import type { ParticipatedRoute }   from '../../hooks/useParticipatedRoutes';
import { useChat }                  from '../../hooks/useChats';
import { FriendsModal }             from '../modals/FriendsModal';
import { FriendRequestsModal }      from '../modals/FriendRequestsModal';
import { useFollowCounts }          from '../../hooks/useFollowCounts';
import { useSettings } from '../../hooks/useSettings';
import { hasValidCustomHeroColors, resolveProfilePalette } from '../../constants/profileThemes';
import { mergeProfilePremiumExtras } from '../../constants/profilePremiumExtras';
import type { ProfilePremiumExtras } from '../../constants/profilePremiumExtras';
import VisitEntranceFx from './VisitEntranceFx';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import ShopEntranceOverlay from '../shop/ShopEntranceOverlay';
import { NitroShopPromoCard } from '../shop/NitroShopPromoCard';
import type { UserShopCosmetics } from '../../constants/shopCosmetics';
import { useNitroWallet } from '../../hooks/useNitroWallet';
import { linearGradientFromSpec } from './profileGradientUtils';
import { SpotifyProfileTrackRow } from './SpotifyProfileTrackRow';

const RARITY_ORDER: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
const RARITY_META: Record<string, { label: string; color: string; border: string }> = {
  legendary: { label: 'LEGENDARY', color: '#f5c518', border: '#f5c51840' },
  epic:      { label: 'EPIC',      color: '#a338e3', border: '#a338e340' },
  rare:      { label: 'RARE',      color: '#38a5e3', border: '#38a5e340' },
  common:    { label: 'COMMON',    color: '#ff0202b2', border: '#ff020240' },
};

function sortByRarity(list: Achievement[]) {
  return [...list].sort((a, b) => (RARITY_ORDER[a.rarity ?? 'common'] ?? 3) - (RARITY_ORDER[b.rarity ?? 'common'] ?? 3));
}
function groupByRarity(list: Achievement[]) {
  return ['legendary', 'epic', 'rare', 'common'].reduce((acc, rarity) => {
    const items = list.filter(a => (a.rarity ?? 'common') === rarity);
    return items.length ? [...acc, { rarity, items }] : acc;
  }, [] as { rarity: string; items: Achievement[] }[]);
}


interface Props {
  profile:                   UserProfile | null;
  cars:                      Car[];
  achievements:              Achievement[];
  spots:                     SpotPreview[];
  loading:                   boolean;
  isOwner:                   boolean;
  initials:                  string;
  joinedLabel:               string;
  avatarUploading?:          boolean;
  routes:                    MyRoute[];
  routesLoading:             boolean;
  participatedRoutes:        ParticipatedRoute[];
  participatedRoutesLoading: boolean;
  onNavigateParticipated:    (r: ParticipatedRoute) => void;
  onNavigateRoute:           (route: MyRoute) => void;
  onShareRoute:              (route: MyRoute) => void;
  onDeleteRoute:             (id: number) => void;
  onRefresh:                 () => void;
  onSettings:                () => void;
  onEdit:                    () => void;
  onAddCar:                  () => void;
  onAvatarChange?:           (uri: string) => void;
  onCarPress:                (id: number) => void;
  onSpotPress:               (id: number) => void;
  onBack?:                   () => void;
  carLimitBanner?:           React.ReactNode;
  isPremium?:                boolean;
  isAdmin?:                  boolean;
  locationFriendsOnly?:      boolean;
  onLocationFriendsOnlyChange?: (v: boolean) => void;
  onBannerChange?:           (uri: string) => void;
  bannerUploading?:          boolean;
  activityHistory?:          any[];
  monthlyStats?:             any[];
  monthlyCompare?:           any | null;
}

function toSpot(s: SpotPreview): Spot {
  return {
    id: String(s.id), name: s.name, description: s.description ?? '',
    category: s.category as any, latitude: s.latitude, longitude: s.longitude,
    photos: s.photos ?? [], author: s.author ?? 'Nieznany',
    createdAt: s.createdAt?.split('T')[0] ?? '',
    likesCount: s.likesCount ?? 0, commentsCount: s.commentsCount ?? 0,
    isLiked: s.isLiked ?? false,
  };
}

export default function ProfileView({
  profile, cars, achievements, spots, loading,
  isOwner, initials, joinedLabel, avatarUploading = false,
  routes, routesLoading, participatedRoutes, participatedRoutesLoading,
  onNavigateParticipated, onDeleteRoute, onRefresh, onSettings, onEdit,
  onAddCar, onCarPress, onBack, onNavigateRoute, onShareRoute, carLimitBanner,
  isPremium, isAdmin, locationFriendsOnly, onLocationFriendsOnlyChange,
  onBannerChange, bannerUploading = false,
  activityHistory = [], monthlyStats = [], monthlyCompare = null,
}: Props) {
  const { theme: appTheme, isDark } = useTheme();
  const { settings } = useSettings();
  const premiumActive = !!isPremium;
  /** Właściciel edytuje personalizację w Ustawieniach — zawsze stan z settings, nie /me. */
  const rawProfileThemePreset = (
    isOwner
      ? (settings.profileThemePreset ?? profile?.profileThemePreset)
      : profile?.profileThemePreset
  ) ?? 'default';
  const rawAvatarFramePreset = (
    isOwner
      ? (settings.avatarFramePreset ?? profile?.avatarFramePreset)
      : profile?.avatarFramePreset
  ) ?? 'vroom';
  const rawProfileNickColor = (
    isOwner
      ? (settings.nickColor ?? profile?.nickColor)
      : profile?.nickColor
  ) ?? null;
  const hasPremiumProfileUi = premiumActive;
  const premiumBannerUrl = hasPremiumProfileUi ? ((profile as { bannerUrl?: string | null })?.bannerUrl ?? null) : null;
  const profileThemePreset = hasPremiumProfileUi ? rawProfileThemePreset : 'default';
  const avatarFramePreset = hasPremiumProfileUi ? rawAvatarFramePreset : 'vroom';
  const profileNickColor = hasPremiumProfileUi ? rawProfileNickColor : null;
  const premiumUi: ProfilePremiumExtras | null = hasPremiumProfileUi
    ? mergeProfilePremiumExtras(
        isOwner ? settings.profilePremiumExtras : profile?.profilePremiumExtras,
      )
    : null;

  const profilePalette = React.useMemo(
    () =>
      resolveProfilePalette(profileThemePreset, {
        isDark,
        customHeroGradient: premiumUi?.customHeroGradient ?? null,
        applySavedCustomTint:
          profileThemePreset === 'custom' &&
          hasPremiumProfileUi &&
          hasValidCustomHeroColors(premiumUi?.customHeroGradient),
      }),
    [profileThemePreset, isDark, hasPremiumProfileUi, premiumUi?.customHeroGradient],
  );

  const theme = React.useMemo(() => ({
    ...appTheme,
    bg: profilePalette.bg,
    surface: profilePalette.surface,
    border: profilePalette.border,
    border2: profilePalette.borderStrong,
    border3: profilePalette.borderStrong,
    text: profilePalette.text,
    textDim: profilePalette.textDim,
    primaryBg: profilePalette.surfaceAlt,
    primaryBorder: profilePalette.borderStrong,
    primary: '#e33835',
  }), [appTheme, profilePalette]);

  const pillAccentColors = React.useMemo(() => {
    if (!premiumUi) return ['#e33835', '#268bff', '#4de926', '#e33835'];
    if (premiumUi.sectionAccentMode === 'solid' && premiumUi.sectionAccentSolid) {
      const c = premiumUi.sectionAccentSolid;
      return [c, c, c, c];
    }
    if (premiumUi.sectionAccentMode === 'gradient' && premiumUi.sectionAccentGradient?.colors?.length) {
      const cols = premiumUi.sectionAccentGradient.colors;
      return [
        cols[0],
        cols[1 % cols.length],
        cols[2 % cols.length],
        cols[Math.min(3, cols.length - 1)],
      ];
    }
    return ['#e33835', '#268bff', '#4de926', '#e33835'];
  }, [premiumUi]);

  const sectionAccentStrip = React.useMemo(() => {
    if (!premiumUi) return undefined;
    if (premiumUi.sectionAccentMode === 'gradient' && premiumUi.sectionAccentGradient?.colors?.length >= 2) {
      return { kind: 'gradient' as const, spec: premiumUi.sectionAccentGradient };
    }
    if (premiumUi.sectionAccentMode === 'solid' && premiumUi.sectionAccentSolid) {
      return { kind: 'solid' as const, color: premiumUi.sectionAccentSolid };
    }
    return undefined;
  }, [premiumUi]);

  const heroPresetGradients = React.useMemo((): Record<string, string[]> => ({
    default: isDark ? ['#1a0404', '#0d0808', '#080808'] : ['#fce8e8', '#f5f0f0', theme.bg],
    midnight: isDark ? ['#060d1a', '#08080d', '#080808'] : ['#eaf0ff', '#eef2ff', theme.bg],
    sunset: isDark ? ['#2a0a02', '#1b0705', '#080808'] : ['#ffe9dc', '#fff0e8', theme.bg],
    neon: isDark ? ['#031a12', '#071211', '#080808'] : ['#ddfff3', '#e8fff7', theme.bg],
    royal: isDark ? ['#1a0630', '#0f0818', '#080808'] : ['#f3e8ff', '#ede9fe', theme.bg],
    cyber: isDark ? ['#031a3a', '#061525', '#080808'] : ['#e0f2fe', '#dbeafe', theme.bg],
    gold: isDark ? ['#2a1f06', '#151005', '#080808'] : ['#fffbeb', '#fef3c7', theme.bg],
    forest: isDark ? ['#052e12', '#071a0c', '#080808'] : ['#ecfccb', '#dcfce7', theme.bg],
    custom: isDark ? ['#12121c', '#08080c', '#080808'] : ['#e8e8f0', '#f0f0f8', theme.bg],
  }), [isDark, theme.bg]);

  const heroBannerOverlays: Record<string, string[]> = {
    default: ['#00000066', '#00000022'],
    midnight: ['#06132599', '#0a0f2055'],
    sunset: ['#2a0a0288', '#2b120855'],
    neon: ['#03201688', '#0a201855'],
    royal: ['#1a063099', '#0c061855'],
    cyber: ['#031a3a99', '#06152555'],
    gold: ['#2a1f0688', '#15100555'],
    forest: ['#052e1288', '#071a0c55'],
    custom: ['#12121c99', '#08080c55'],
  };
  const frameGradients: Record<string, string[]> = {
    vroom: ['#e33835', '#268bff', '#4de926', '#e33835'],
    sunrise: ['#ff6b35', '#f5c518', '#ff6b35'],
    ocean: ['#38a5e3', '#1b6eff', '#38a5e3'],
    lime: ['#4de926', '#a6ff4d', '#4de926'],
  };
  const router = useRouter();
  const { wallet: nitroWallet } = useNitroWallet();
  const { friends, fetchFriends, requests, fetchRequests, acceptRequest, rejectRequest, removeFriend } = useChat();
  const { counts: followCounts } = useFollowCounts(profile?.id);

  const [selectedSpot,        setSelectedSpot]        = useState<Spot | null>(null);
  const [localSpots,          setLocalSpots]          = useState<SpotPreview[]>([]);
  const [showAllAchs,         setShowAllAchs]         = useState(false);
  const [routesModalVisible,  setRoutesModalVisible]  = useState(false);
  const [lbVisible,           setLbVisible]           = useState(false);
  const [lbRouteId,           setLbRouteId]           = useState<number | null>(null);
  const [lbRouteName,         setLbRouteName]         = useState('');
  const [friendsModalVisible, setFriendsModalVisible] = useState(false);
  const [invitesModalVisible, setInvitesModalVisible] = useState(false);
  const [statsModalVisible,   setStatsModalVisible]   = useState(false);
  const [showAllSpots,        setShowAllSpots]        = useState(false);
  const statsSlide = useRef(new Animated.Value(0)).current;
  const ROUTES_PREVIEW = 0;
  const SPOTS_PREVIEW  = 4;

  const avatarRingLin = React.useMemo(() => {
    const fb = frameGradients[avatarFramePreset] || frameGradients.vroom;
    return linearGradientFromSpec(premiumUi?.avatarRingGradient ?? null, fb);
  }, [premiumUi?.avatarRingGradient, avatarFramePreset]);

  const avatarSpin = useRef(new Animated.Value(0)).current;
  const avatarPulse = useRef(new Animated.Value(1)).current;
  const avatarBreathe = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!premiumActive || !premiumUi) return;
    const mode = premiumUi.avatarRingAnim ?? 'none';
    avatarSpin.setValue(0);
    avatarPulse.setValue(1);
    avatarBreathe.setValue(1);
    let loop: Animated.CompositeAnimation | undefined;
    if (mode === 'rotate') {
      loop = Animated.loop(
        Animated.timing(avatarSpin, { toValue: 1, duration: 6400, useNativeDriver: true, easing: Easing.linear }),
      );
    } else if (mode === 'pulse') {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(avatarPulse, { toValue: 0.48, duration: 650, useNativeDriver: true }),
        Animated.timing(avatarPulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]));
    } else if (mode === 'breathe') {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(avatarBreathe, { toValue: 1.07, duration: 1100, useNativeDriver: true }),
        Animated.timing(avatarBreathe, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ]));
    }
    loop?.start();
    return () => {
      loop?.stop();
      avatarSpin.setValue(0);
      avatarPulse.setValue(1);
      avatarBreathe.setValue(1);
    };
  }, [premiumActive, premiumUi?.avatarRingAnim, avatarSpin, avatarPulse, avatarBreathe]);

  const heroShim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!premiumUi || premiumUi.heroMotion !== 'shimmer') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(heroShim, { toValue: 1, duration: 2800, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(heroShim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [premiumUi?.heroMotion, heroShim]);

  const heroFloat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!premiumUi || premiumUi.heroMotion !== 'float') return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(heroFloat, { toValue: 1, duration: 2400, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
      Animated.timing(heroFloat, { toValue: 0, duration: 2400, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [premiumUi?.heroMotion, heroFloat]);

  const heroPulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!premiumUi || premiumUi.heroMotion !== 'pulse') return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(heroPulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      Animated.timing(heroPulseAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [premiumUi?.heroMotion, heroPulseAnim]);

  const heroFloatY = heroFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  const shopCosmetics = (profile as { shopCosmetics?: UserShopCosmetics | null })?.shopCosmetics ?? null;
  const shopBannerUri = shopCosmetics?.profileBanner?.assetUrl ?? null;
  const heroBannerUri = shopBannerUri || premiumBannerUrl;

  const heroLinResolved = React.useMemo(() => {
    const fallback = heroPresetGradients[profileThemePreset] || heroPresetGradients.default;
    const noBanner = !heroBannerUri;
    if (noBanner && premiumUi?.customHeroGradient) {
      const custom = linearGradientFromSpec(premiumUi.customHeroGradient, []);
      if (custom) return custom;
    }
    const lin = linearGradientFromSpec(null, fallback);
    if (lin) return lin;
    const emergency = linearGradientFromSpec(null, ['#080808', '#1A0404', '#0D0808']);
    return emergency ?? { colors: ['#080808', '#1A0404'], start: { x: 0.2, y: 0 }, end: { x: 1, y: 1 } };
  }, [heroBannerUri, premiumUi?.customHeroGradient, profileThemePreset, heroPresetGradients]);

  const [visitFx, setVisitFx] = useState(false);
  const [shopVisitFx, setShopVisitFx] = useState(false);
  useEffect(() => {
    if (isOwner) {
      setVisitFx(false);
      setShopVisitFx(false);
      return;
    }
    if (shopCosmetics?.entranceEffect?.assetUrl) {
      setShopVisitFx(true);
      setVisitFx(false);
      return;
    }
    if (!premiumUi?.visitEntranceAnim || premiumUi.visitEntranceAnim === 'none') {
      setVisitFx(false);
      setShopVisitFx(false);
      return;
    }
    setVisitFx(true);
    setShopVisitFx(false);
  }, [isOwner, profile?.id, premiumUi?.visitEntranceAnim, shopCosmetics?.entranceEffect?.assetUrl]);

  const openStats = () => {
    setStatsModalVisible(true);
    statsSlide.setValue(1);
    Animated.spring(statsSlide, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
  };
  const closeStats = () => {
    Animated.timing(statsSlide, { toValue: 1, duration: 220, useNativeDriver: true }).start(() => setStatsModalVisible(false));
  };

  const { data: lbData, runsData: lbRunsData, loading: lbLoading, fetchLeaderboard, fetchRuns } = useRouteLeaderboard();

  const handleLeaderboard = async (route: { id: number; name: string }) => {
    setLbRouteId(route.id); setLbRouteName(route.name); setLbVisible(true);
    await Promise.all([fetchLeaderboard(route.id), fetchRuns(route.id)]);
  };

  React.useEffect(() => { setLocalSpots(spots); }, [spots]);
  React.useEffect(() => {
    if (isOwner) { fetchFriends(); fetchRequests(); }
  }, [isOwner]);

  const handleLikeToggle = (spotId: string, liked: boolean, count: number) => {
    setLocalSpots(prev => prev.map(s => String(s.id) === spotId ? { ...s, isLiked: liked, likesCount: count } : s));
    setSelectedSpot(prev => prev?.id === spotId ? { ...prev, isLiked: liked, likesCount: count } : prev);
  };

  const unlocked       = sortByRarity(achievements.filter(a => a.active));
  const locked         = sortByRarity(achievements.filter(a => !a.active));
  const unlockedGroups = groupByRarity(unlocked);
  const lockedGroups   = groupByRarity(locked);

  // 30-day activity filter for non-premium owners
  const FREE_ACTIVITY_HISTORY_DAYS = 30;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - FREE_ACTIVITY_HISTORY_DAYS);
  const displayRoutes = (isOwner && !premiumActive)
    ? routes.filter(r => new Date(r.createdAt) >= thirtyDaysAgo)
    : routes;
  const hiddenRoutesCount = routes.length - displayRoutes.length;
  const historyWithRoute = activityHistory.filter((a: any) => (a?.routePoints?.length ?? 0) > 1);

  // Club data
  const club = (profile as any)?.club as {
    id: number; name: string; avatarUrl: string | null;
    memberCount: number; myRole: string;
    myRank?: { name: string; color: string } | null;
  } | null | undefined;

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#e33835" colors={['#e33835']} />}
      >

        {/* ══════════════════════════════════════════════ */}
        {/* HERO HEADER                                    */}
        {/* ══════════════════════════════════════════════ */}
        <Animated.View
          style={{
            height:                  240,
            position:              'relative',
            overflow:              'hidden',
            transform:             premiumUi?.heroMotion === 'float' ? [{ translateY: heroFloatY }] : [],
          }}
        >
          {heroBannerUri ? (
            <Image
              source={{ uri: heroBannerUri }}
              style={{ ...StyleSheet.absoluteFillObject }}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={heroLinResolved.colors as [string, string, ...string[]]}
              start={heroLinResolved.start}
              end={heroLinResolved.end}
              style={{ ...StyleSheet.absoluteFillObject }}
            />
          )}
          {!!heroBannerUri && (
            <LinearGradient
              colors={(heroBannerOverlays[profileThemePreset] || heroBannerOverlays.default) as any}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ ...StyleSheet.absoluteFillObject }}
            />
          )}
          {/* Decorative rings */}
          <View style={{ position: 'absolute', top: -60, right: -60, width: 260, height: 260, borderRadius: 130, borderWidth: 1, borderColor: '#e3383518' }} />
          <View style={{ position: 'absolute', top: -20, right: -20, width: 150, height: 150, borderRadius: 75, borderWidth: 1, borderColor: '#e3383530', backgroundColor: '#e3383508' }} />
          {/* Scanlines */}
          {Array.from({ length: 8 }).map((_, i) => (
            <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * 30, height: 1, backgroundColor: isDark ? '#ffffff04' : '#00000003' }} />
          ))}
          {premiumUi?.heroMotion === 'shimmer' && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                width: 100,
                opacity: 0.28,
                transform: [{
                  translateX: heroShim.interpolate({
                    inputRange:  [0, 1],
                    outputRange: [-160, Dimensions.get('window').width + 120],
                  }),
                }],
              }}
            >
              <LinearGradient
                colors={['transparent', 'rgba(255,255,255,0.75)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ flex: 1 }}
              />
            </Animated.View>
          )}
          {premiumUi?.heroMotion === 'pulse' && (
            <Animated.View
              pointerEvents="none"
              style={{
                ...StyleSheet.absoluteFillObject,
                backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                opacity: heroPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.85] }),
              }}
            />
          )}

          {/* Top bar */}
          <View style={{ position: 'absolute', top: 52, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {onBack ? (
                <TouchableOpacity
                  onPress={onBack}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isDark ? '#ffffff12' : '#00000012', alignItems: 'center', justifyContent: 'center' }}
                >
                  <MaterialIcons name="arrow-back" size={20} color={theme.text} />
                </TouchableOpacity>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ backgroundColor: '#e33835', borderRadius: 7, padding: 5 }}>
                    <MaterialCommunityIcons name="account" size={14} color="#fff" />
                  </View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '900', letterSpacing: 3 }}>PROFIL</Text>
                </View>
              )}
            </View>
            {isOwner && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {premiumActive && onBannerChange && (
                  <>
                    {!!premiumBannerUrl && (
                      <TouchableOpacity
                        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ff3b3020', borderWidth: 1, borderColor: '#ff3b3040', alignItems: 'center', justifyContent: 'center' }}
                        onPress={() => onBannerChange('delete' as any)}
                        disabled={bannerUploading}
                      >
                        {bannerUploading
                          ? <ActivityIndicator size="small" color="#ff3b30" />
                          : <MaterialIcons name="delete-outline" size={18} color="#ff3b30" />
                        }
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFD70020', borderWidth: 1, borderColor: '#FFD70040', alignItems: 'center', justifyContent: 'center' }}
                      onPress={() => onBannerChange('' as any)}
                      disabled={bannerUploading}
                    >
                      {bannerUploading
                        ? <ActivityIndicator size="small" color="#FFD700" />
                        : <MaterialIcons name="add-photo-alternate" size={18} color="#FFD700" />
                      }
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFD70022', borderWidth: 1, borderColor: '#FFD70044', alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => router.push('/shop' as any)}
                >
                  <MaterialIcons name="bolt" size={18} color="#FFD700" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isDark ? '#ffffff10' : '#00000010', borderWidth: 1, borderColor: isDark ? '#ffffff20' : '#00000015', alignItems: 'center', justifyContent: 'center' }}
                  onPress={onSettings}
                >
                  <Ionicons name="settings-outline" size={18} color={theme.textDim} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Avatar + Name */}
          <View style={{ position: 'absolute', bottom: 24, left: 20, right: 20, flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
            {/* Avatar */}
            <View style={{ position: 'relative', width: 80, height: 80 }}>
              {premiumActive && avatarRingLin ? (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    width: 80,
                    height: 80,
                    borderRadius: 40,
                    opacity: premiumUi?.avatarRingAnim === 'pulse' ? avatarPulse : 1,
                    transform: [
                      ...(premiumUi?.avatarRingAnim === 'rotate'
                        ? [{
                          rotate: avatarSpin.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '360deg'],
                          }),
                        }] as const
                        : []),
                      ...(premiumUi?.avatarRingAnim === 'breathe'
                        ? [{ scale: avatarBreathe }] as const
                        : []),
                    ],
                  }}
                >
                  <LinearGradient
                    colors={avatarRingLin.colors as [string, string, ...string[]]}
                    start={avatarRingLin.start}
                    end={avatarRingLin.end}
                    style={{ width: 80, height: 80, borderRadius: 40 }}
                  />
                </Animated.View>
              ) : null}
              <View style={{
                width: 74,
                height: 74,
                borderRadius: 37,
                margin: 3,
                borderWidth: 1.5,
                borderColor: premiumActive ? '#0f0f0fcc' : '#e33835',
                overflow: 'hidden',
                backgroundColor: theme.surface,
              }}>
                {profile?.avatarUrl
                  ? <Image key={profile.avatarUrl} source={{ uri: profile.avatarUrl }} style={{ width: 74, height: 74 }} />
                  : (
                    <View style={{ flex: 1, backgroundColor: '#e3383515', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 24, color: '#e33835', fontWeight: '900' }}>{initials}</Text>
                    </View>
                  )
                }
              </View>
              <ShopAvatarDecoration item={shopCosmetics?.avatarFrame} size={80} />
            </View>

            {/* Name + info */}
            <View style={{ flex: 1, paddingBottom: 4 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#e33835', letterSpacing: 3, marginBottom: 3 }}>
                {isOwner ? 'TWÓJ PROFIL' : 'PROFIL GRACZA'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: profileNickColor || theme.text, fontWeight: '900', letterSpacing: 0.5 }} numberOfLines={1}>
                  {profile?.username ?? '—'}
                </Text>
                <UserBadges isAdmin={isAdmin ?? profile?.isAdmin} isPremium={premiumActive} compact />
              </View>
              {!!profile?.location && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                  <MaterialIcons name="location-on" size={11} color={theme.textDim} />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>{profile.location}</Text>
                </View>
              )}
            </View>

            {/* Pozycja badge */}
            {!!profile?.position && (
              <View style={{ backgroundColor: '#e3383518', borderRadius: 12, borderWidth: 1, borderColor: '#e3383540', paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: '#e33835', fontWeight: '900' }}>#{profile.position}</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, letterSpacing: 2, marginTop: 1 }}>RANKING</Text>
              </View>
            )}
          </View>

          {/* Bottom fade */}
          <LinearGradient colors={['transparent', theme.bg]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 50 }} />
        </Animated.View>

        <View style={{ paddingHorizontal: 20 }}>

          {/* BIO */}
          {!!profile?.bio && (
            <View style={{ marginBottom: 20, backgroundColor: theme.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 3, marginBottom: 8 }}>O MNIE</Text>
              <Text style={{ color: theme.text, fontSize: 13, lineHeight: 20 }}>{profile.bio}</Text>
            </View>
          )}

          {!!profile?.spotifyProfileTrack && (
            <SpotifyProfileTrackRow
              track={profile.spotifyProfileTrack}
              theme={{ text: theme.text, textDim: theme.textDim, surface: theme.surface }}
            />
          )}

          {/* Dołączył */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surface, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: theme.border, marginBottom: 20 }}>
            <MaterialIcons name="calendar-today" size={13} color={theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, flex: 1 }}>Dołączył: {joinedLabel}</Text>
          </View>

          {/* ══ 3 KEY STAT PILLS + ACTION BUTTONS ══ */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {/* Pts pill */}
            <TouchableOpacity
              onPress={openStats} activeOpacity={0.75}
              style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: `${pillAccentColors[0]}40`, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 3 }}
            >
              <Text style={{ fontSize: 14 }}>🏆</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: pillAccentColors[0], fontWeight: '900' }}>{unlocked.length}</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, letterSpacing: 1 }}>OSIĄGN.</Text>
            </TouchableOpacity>
            {/* km pill */}
            <TouchableOpacity
              onPress={openStats} activeOpacity={0.75}
              style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: `${pillAccentColors[1]}40`, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 3 }}
            >
              <Text style={{ fontSize: 14 }}>🛣️</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: pillAccentColors[1], fontWeight: '900' }}>{Math.round(profile?.totalDistance ?? 0)}</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, letterSpacing: 1 }}>KM</Text>
            </TouchableOpacity>
            {/* ranking pill */}
            <TouchableOpacity
              onPress={openStats} activeOpacity={0.75}
              style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: `${pillAccentColors[2]}40`, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 3 }}
            >
              <Text style={{ fontSize: 14 }}>📍</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: pillAccentColors[2], fontWeight: '900' }}>
                {profile?.position ? `#${profile.position}` : '—'}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, letterSpacing: 1 }}>RANKING</Text>
            </TouchableOpacity>
            {/* Stats button */}
            <TouchableOpacity
              onPress={openStats} activeOpacity={0.75}
              style={{ flex: 1.2, backgroundColor: `${pillAccentColors[3]}15`, borderRadius: 14, borderWidth: 1, borderColor: `${pillAccentColors[3]}40`, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', gap: 3 }}
            >
              <MaterialIcons name="bar-chart" size={18} color={pillAccentColors[3]} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: pillAccentColors[3], letterSpacing: 1, textAlign: 'center' }}>STATYSTYKI</Text>
            </TouchableOpacity>
          </View>

          {isOwner && (
            <NitroShopPromoCard
              nitroBalance={nitroWallet?.nitroBalance ?? profile?.nitroBalance ?? 0}
              onPress={() => router.push('/shop' as any)}
            />
          )}

          {/* ══ ACTION BUTTONS ROW ══ */}
          {isOwner && (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onPress={onEdit} activeOpacity={0.85}
              >
                <MaterialIcons name="edit" size={13} color="#fff" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>EDYTUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onPress={onSettings} activeOpacity={0.85}
              >
                <Ionicons name="settings-outline" size={13} color={theme.textDim} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, fontWeight: '700' }}>USTAWIENIA</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#4de92615', borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: '#4de92630', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onPress={onAddCar} activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="car-plus" size={13} color="#4de926" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#4de926', fontWeight: '700' }}>DODAJ AUTO</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ══ OBSERWACJE ══ */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'OBSERWUJĄCY', value: profile?.followersCount ?? 0, color: '#4de926', icon: 'visibility'   as const },
              { label: 'OBSERWACJE',  value: profile?.followingCount ?? 0, color: '#a855f7', icon: 'person-add'   as const },
            ].map(item => (
              <View key={item.label} style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: item.color + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name={item.icon} size={16} color={item.color} />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: theme.text, fontWeight: '900' }}>{item.value}</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: item.color, letterSpacing: 1, marginTop: 2 }}>{item.label}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* ══ KLUB ══ */}
          {!club ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isDark ? '#ffffff08' : '#00000008', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="shield-off-outline" size={18} color={theme.textDim} />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>KLUB</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>
                    {isOwner ? 'Nie należysz do żadnego klubu' : 'Brak klubu'}
                  </Text>
                </View>
              </View>
              {isOwner && (
                <TouchableOpacity
                  style={{ backgroundColor: '#e33835', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}
                  onPress={() => router.push('/Community/clubs/clubs' as any)}
                >
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>ZNAJDŹ KLUB</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <TouchableOpacity
              style={{ backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: '#e3383530', marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              onPress={() => router.push('/Community/clubs/clubs' as any)}
              activeOpacity={0.85}
            >
              <View style={{ width: 46, height: 46, borderRadius: 13, overflow: 'hidden', backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530', alignItems: 'center', justifyContent: 'center' }}>
                {club.avatarUrl
                  ? <Image source={{ uri: club.avatarUrl }} style={{ width: 46, height: 46 }} />
                  : <MaterialCommunityIcons name="shield-crown-outline" size={22} color="#e33835" />
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '700', marginBottom: 5 }} numberOfLines={1}>{club.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ backgroundColor: (club.myRole === 'owner' ? '#e33835' : club.myRank?.color ?? '#4de926') + '20', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: (club.myRole === 'owner' ? '#e33835' : club.myRank?.color ?? '#4de926') + '40' }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: club.myRole === 'owner' ? '#e33835' : club.myRank?.color ?? '#4de926', fontWeight: '700' }}>
                      {club.myRole === 'owner' ? 'ZAŁOŻYCIEL' : (club.myRank?.name?.toUpperCase() ?? 'CZŁONEK')}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>{club.memberCount} członków</Text>
                </View>
              </View>
              <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
            </TouchableOpacity>
          )}

          {/* ══ ZAPROSZENIA ══ */}
          {isOwner && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: requests.length > 0 ? '#e3383530' : theme.border, marginBottom: 12 }}
              onPress={() => setInvitesModalVisible(true)} activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="person-add" size={18} color="#e33835" />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '700' }}>ZAPROSZENIA DO ZNAJOMYCH</Text>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2 }}>{requests.length} oczekujących</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {requests.length > 0 && (
                  <View style={{ backgroundColor: '#e3383520', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: '#e3383540' }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#e33835', fontWeight: '700' }}>{requests.length}</Text>
                  </View>
                )}
                <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
              </View>
            </TouchableOpacity>
          )}

          {/* ══ ZNAJOMI ══ */}
          {isOwner && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 20 }}
              onPress={() => setFriendsModalVisible(true)} activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#268bff15', borderWidth: 1, borderColor: '#268bff30', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="people" size={18} color="#268bff" />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '700' }}>ZNAJOMI</Text>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2 }}>{friends.length} osób</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ backgroundColor: '#268bff15', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: '#268bff30' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#268bff', fontWeight: '700' }}>{friends.length}</Text>
                </View>
                <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
              </View>
            </TouchableOpacity>
          )}

          {/* ══ LOKALIZACJA TYLKO DLA ZNAJOMYCH (Premium) ══ */}
          {isOwner && premiumActive && onLocationFriendsOnlyChange && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: '#FFD70030', marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFD70015', borderWidth: 1, borderColor: '#FFD70030', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="location-on" size={18} color="#FFD700" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 10, fontWeight: '700' }}>LOK. TYLKO DLA ZNAJOMYCH</Text>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 7, marginTop: 2 }}>Twoja pozycja widoczna tylko dla znajomych</Text>
                </View>
              </View>
              <Switch
                value={!!locationFriendsOnly}
                onValueChange={onLocationFriendsOnlyChange}
                trackColor={{ false: theme.border2, true: '#FFD70060' }}
                thumbColor={locationFriendsOnly ? '#FFD700' : theme.textDim}
              />
            </View>
          )}

          {/* ══ AUTA ══ */}
          <Section
            surfaceTheme={theme}
            accentStrip={sectionAccentStrip}
            title={isOwner ? 'MOJE AUTA' : 'AUTA'}
            count={cars.length}
            right={isOwner ? (
              <TouchableOpacity onPress={onAddCar} style={{ backgroundColor: '#e33835', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>+ DODAJ</Text>
              </TouchableOpacity>
            ) : null}
          >
            {cars.length === 0
              ? <EmptyState surfaceTheme={theme} text="Brak dodanych aut" />
              : cars.map(car => <CarCard key={car.id} brand={car.brand} specs={car.specs} isMain={car.isMain} firstPhoto={car.photos?.[0]} onPress={() => onCarPress(car.id)} />)
            }
          </Section>
          {isOwner && carLimitBanner}

          {/* ══ OSIĄGNIĘCIA ══ */}
          <Section surfaceTheme={theme} accentStrip={sectionAccentStrip} title="OSIĄGNIĘCIA" count={`${unlocked.length}/${achievements.length}`}>
            {achievements.length === 0
              ? <EmptyState surfaceTheme={theme} text="Ładowanie osiągnięć..." />
              : (
                <>
                  {unlocked.length === 0
                    ? <EmptyState surfaceTheme={theme} text="Brak odblokowanych osiągnięć" />
                    : unlockedGroups.map(({ rarity, items }) => {
                        const meta = RARITY_META[rarity] ?? RARITY_META.common;
                        return (
                          <View key={rarity} style={{ marginBottom: 16 }}>
                            <RarityDivider surfaceTheme={theme} meta={meta} count={items.length} />
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                              {items.map(a => <AchievementBox key={a.key} icon={a.icon} label={a.label} active rarity={a.rarity} progress={100} points={a.points} description={a.description} category={a.category} currentValue={a.currentValue} conditionValue={a.conditionValue} conditionField={a.conditionField} unlockedAt={a.unlockedAt} />)}
                            </View>
                          </View>
                        );
                      })
                  }
                  {locked.length > 0 && (
                    <>
                      <TouchableOpacity
                        style={{ marginVertical: 10, paddingVertical: 12, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                        onPress={() => setShowAllAchs(p => !p)} activeOpacity={0.75}
                      >
                        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, letterSpacing: 1 }}>
                          {showAllAchs ? '▲  UKRYJ ZABLOKOWANE' : `▼  ZABLOKOWANE (${locked.length})`}
                        </Text>
                      </TouchableOpacity>
                      {showAllAchs && lockedGroups.map(({ rarity, items }) => {
                        const meta = RARITY_META[rarity] ?? RARITY_META.common;
                        return (
                          <View key={rarity} style={{ marginBottom: 16 }}>
                            <RarityDivider surfaceTheme={theme} meta={meta} count={items.length} />
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                              {items.map(a => <AchievementBox key={a.key} icon={a.icon} label={a.label} active={false} rarity={a.rarity} progress={a.progress} points={a.points} description={a.description} category={a.category} currentValue={a.currentValue} conditionValue={a.conditionValue} conditionField={a.conditionField} unlockedAt={a.unlockedAt} />)}
                            </View>
                          </View>
                        );
                      })}
                    </>
                  )}
                </>
              )
            }
          </Section>

          {/* ══ PRZEJECHANE TRASY ══ */}
          <Section surfaceTheme={theme} accentStrip={sectionAccentStrip} title="PRZEJECHANE TRASY" count={participatedRoutes.length}>
            {participatedRoutesLoading
              ? <EmptyState surfaceTheme={theme} text="Ładowanie..." />
              : participatedRoutes.length === 0
              ? <EmptyState surfaceTheme={theme} text="Brak przejechanych tras" />
              : <ParticipatedRoutesSection routes={participatedRoutes} myId={null} onNavigate={onNavigateParticipated} onLeaderboard={handleLeaderboard} />
            }
          </Section>

          {/* ══ MOJE TRASY ══ */}
          <Section surfaceTheme={theme} accentStrip={sectionAccentStrip} title={isOwner ? 'MOJE TRASY' : 'TRASY'} count={displayRoutes.length}>
            {isOwner && !premiumActive && hiddenRoutesCount > 0 && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFD70010', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#FFD70030', marginBottom: 10 }}
                onPress={() => router.push('/premium' as any)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="workspace-premium" size={18} color="#FFD700" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#FFD700', fontWeight: '700' }}>HISTORIA OGRANICZONA DO 30 DNI</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 2 }}>
                    {hiddenRoutesCount} {hiddenRoutesCount === 1 ? 'trasa ukryta' : 'tras ukrytych'} · Odblokuj Premium
                  </Text>
                </View>
                <MaterialIcons name="arrow-forward-ios" size={12} color="#FFD700" />
              </TouchableOpacity>
            )}
            {displayRoutes.length === 0
              ? <EmptyState surfaceTheme={theme} text={routesLoading ? 'Ładowanie...' : 'Brak zapisanych tras'} />
              : (
                <>
                  {displayRoutes.slice(0, ROUTES_PREVIEW).map(route => (
                    <RouteCard key={route.id} route={route} isOwner={isOwner} onDelete={onDeleteRoute} onNavigate={onNavigateRoute} onShare={onShareRoute} onLeaderboard={handleLeaderboard} />
                  ))}
                  {displayRoutes.length > ROUTES_PREVIEW && (
                    <TouchableOpacity
                      style={{ marginVertical: 10, paddingVertical: 14, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                      onPress={() => setRoutesModalVisible(true)} activeOpacity={0.75}
                    >
                      <MaterialIcons name="route" size={16} color="#e33835" />
                      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 9, letterSpacing: 1 }}>WSZYSTKIE TRASY ({displayRoutes.length})</Text>
                    </TouchableOpacity>
                  )}
                </>
              )
            }
          </Section>

          {/* ══ HISTORIA PRZEJAZDÓW (ŚLAD) ══ */}
          <Section surfaceTheme={theme} accentStrip={sectionAccentStrip} title="HISTORIA PRZEJAZDÓW" count={activityHistory.length}>
            {activityHistory.length === 0 ? (
              <EmptyState surfaceTheme={theme} text="Brak zapisanych przejazdów z trasą." />
            ) : (
              <TouchableOpacity
                style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                onPress={() => router.push('/profile/history-rides' as any)}
                activeOpacity={0.8}
              >
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#268bff18', borderWidth: 1, borderColor: '#268bff30', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="map" size={17} color="#268bff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.text, fontWeight: '700' }}>
                    OTWÓRZ HISTORIĘ PRZEJAZDÓW
                  </Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 3 }}>
                    Trasy z mapą: {historyWithRoute.length} · otwórz pełny ekran historii.
                  </Text>
                </View>
                <MaterialIcons name="arrow-forward-ios" size={13} color={theme.textDim} />
              </TouchableOpacity>
            )}
          </Section>

          {/* ══ SPOTY ══ */}
          <Section surfaceTheme={theme} accentStrip={sectionAccentStrip} title={isOwner ? 'MOJE SPOTY' : 'SPOTY'} count={localSpots.length}>
            {localSpots.length === 0
              ? <EmptyState surfaceTheme={theme} text="Brak spotów" />
              : (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
                    {(showAllSpots ? localSpots : localSpots.slice(0, SPOTS_PREVIEW)).map(spot => (
                      <SpotPreviewCard key={spot.id} spot={spot} isOwner={isOwner} onPress={() => setSelectedSpot(toSpot(spot))} onDeleted={id => setLocalSpots(prev => prev.filter(s => s.id !== id))} />
                    ))}
                  </View>
                  {localSpots.length > SPOTS_PREVIEW && (
                    <TouchableOpacity
                      style={{ marginTop: 10, paddingVertical: 12, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                      onPress={() => setShowAllSpots(p => !p)} activeOpacity={0.75}
                    >
                      <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, letterSpacing: 1 }}>
                        {showAllSpots ? '▲  UKRYJ' : `▼  ZOBACZ WIĘCEJ (${localSpots.length - SPOTS_PREVIEW})`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )
            }
          </Section>

        </View>

        <SpotDetailModal visible={selectedSpot !== null} spot={selectedSpot} onClose={() => setSelectedSpot(null)} getDistance={() => 0} onLikeToggle={handleLikeToggle} />
        <RoutesListModal visible={routesModalVisible} routes={displayRoutes} onClose={() => setRoutesModalVisible(false)} onNavigate={onNavigateRoute} onShare={onShareRoute} onDelete={onDeleteRoute} onLeaderboard={route => { setRoutesModalVisible(false); setTimeout(() => handleLeaderboard(route), 350); }} isOwner={isOwner} isPremium={premiumActive} />
      </ScrollView>
      {shopVisitFx && !isOwner && shopCosmetics?.entranceEffect && (
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 500, elevation: 50 }]} pointerEvents="box-none">
          <ShopEntranceOverlay item={shopCosmetics.entranceEffect} onDone={() => setShopVisitFx(false)} />
        </View>
      )}
      {visitFx && !isOwner && !shopVisitFx && premiumUi?.visitEntranceAnim && premiumUi.visitEntranceAnim !== 'none' && (
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 500, elevation: 50 }]} pointerEvents="box-none">
          <VisitEntranceFx kind={premiumUi.visitEntranceAnim} onDone={() => setVisitFx(false)} />
        </View>
      )}
      </View>

      <RouteLeaderboardModal visible={lbVisible} routeId={lbRouteId} routeName={lbRouteName} data={lbData} runsData={lbRunsData} loading={lbLoading} onClose={() => { setLbVisible(false); setLbRouteId(null); setLbRouteName(''); }} />
      <FriendsModal visible={friendsModalVisible} friends={friends} loading={false} isOwner={isOwner} onClose={() => setFriendsModalVisible(false)} onRemove={async (f) => { await removeFriend((f as any).friendshipId ?? f.id); fetchFriends(); }} />
      <FriendRequestsModal
        visible={invitesModalVisible}
        requests={requests}
        onClose={() => setInvitesModalVisible(false)}
        onAccept={async (id) => { await acceptRequest(id); fetchRequests(); fetchFriends(); }}
        onReject={async (id) => { await rejectRequest(id); fetchRequests(); }}
      />

      {/* ══ STATS MODAL ══ */}
      <Modal visible={statsModalVisible} transparent animationType="none" onRequestClose={closeStats} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeStats} />
          <Animated.View
            style={{
              transform: [{ translateY: statsSlide.interpolate({ inputRange: [0, 1], outputRange: [0, Dimensions.get('window').height] }) }],
              backgroundColor: isDark ? '#111' : '#f8f8f8',
              borderTopLeftRadius: 28, borderTopRightRadius: 28,
              borderWidth: 1, borderBottomWidth: 0, borderColor: isDark ? '#ffffff10' : '#00000010',
              maxHeight: '92%',
            }}
          >
            {/* Modal handle */}
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: isDark ? '#ffffff25' : '#00000020' }} />
            </View>

            {/* Modal header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: isDark ? '#ffffff0a' : '#0000000a' }}>
              <View style={{ backgroundColor: '#e3383515', borderRadius: 10, padding: 8, marginRight: 12 }}>
                <MaterialIcons name="bar-chart" size={18} color="#e33835" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: theme.text, fontWeight: '900', letterSpacing: 1 }}>STATYSTYKI</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#e33835', letterSpacing: 2, marginTop: 2 }}>{profile?.username ?? ''}</Text>
              </View>
              <TouchableOpacity onPress={closeStats} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="close" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {/* PRĘDKOŚĆ */}
              <StatsModalSection title="PRĘDKOŚĆ" color="#e33835" icon="speedometer">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <StatsModalItem label="TOP SPEED" value={`${Math.round(profile?.topSpeed ?? 0)}`} unit="km/h" color="#e33835" isDark={isDark} />
                  <StatsModalItem label="ŚR. PRĘDKOŚĆ" value={`${Math.round((profile as any)?.avgSpeed ?? 0)}`} unit="km/h" color="#ff6b35" isDark={isDark} />
                  <StatsModalItem label="ŚR. MAX" value={`${Math.round((profile as any)?.avgMaxSpeed ?? 0)}`} unit="km/h" color="#ff922b" isDark={isDark} />
                </View>
              </StatsModalSection>

              {/* DYSTANS */}
              <StatsModalSection title="DYSTANS" color="#268bff" icon="road-variant">
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                  <View style={{ flex: 1, backgroundColor: isDark ? '#ffffff08' : '#00000006', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: isDark ? '#268bff35' : '#268bff25' }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#268bff', letterSpacing: 2 }}>TYDZIEŃ</Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 22, fontWeight: '900', color: theme.text, marginTop: 6 }}>
                      {Number((profile as any)?.weeklyDistance ?? 0).toFixed(1)}
                    </Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginTop: 2 }}>km</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: isDark ? '#ffffff08' : '#00000006', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: isDark ? '#ffffff15' : '#00000012' }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 2 }}>ŁĄCZNIE</Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 22, fontWeight: '900', color: theme.text, marginTop: 6 }}>
                      {Number(profile?.totalDistance ?? 0).toFixed(1)}
                    </Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginTop: 2 }}>km</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                  <StatsModalItem label="MIESIĘCZNY" value={`${Math.round((profile as any)?.monthlyDistance ?? 0)}`} unit="km" color="#268bff" isDark={isDark} />
                  <StatsModalItem label="DZIENNY" value={`${Math.round((profile as any)?.dailyDistance ?? 0)}`} unit="km" color="#268bff" isDark={isDark} />
                </View>
                {(() => {
                  const pts = Number(profile?.points ?? 0);
                  const milestones = [500, 1500, 3000, 6000, 12000, 25000, 50000, 100000];
                  const nextIdx = milestones.findIndex(m => m > pts);
                  const nextAt = nextIdx >= 0 ? milestones[nextIdx] : pts;
                  const prevAt = nextIdx > 0 ? milestones[nextIdx - 1] : 0;
                  const span = Math.max(1, nextAt - prevAt);
                  const barPct = nextIdx < 0 ? 100 : Math.min(100, Math.round(((pts - prevAt) / span) * 100));
                  return (
                    <View style={{ marginTop: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, letterSpacing: 1 }}>POSTĘP DO KOLEJNEGO PROGU PKT</Text>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#e33835' }}>{pts.toLocaleString('pl-PL')} / {nextAt.toLocaleString('pl-PL')}</Text>
                      </View>
                      <View style={{ height: 8, borderRadius: 4, backgroundColor: isDark ? '#ffffff10' : '#00000010', overflow: 'hidden' }}>
                        <View style={{ width: `${barPct}%`, height: '100%', backgroundColor: '#e33835', borderRadius: 4 }} />
                      </View>
                      {!!profile?.position && (
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 8 }}>
                          Aktualna pozycja w rankingu: #{profile.position}
                        </Text>
                      )}
                    </View>
                  );
                })()}
              </StatsModalSection>

              {/* AKTYWNOŚĆ */}
              <StatsModalSection title="AKTYWNOŚĆ" color="#4de926" icon="fire">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <StatsModalItem label="PRZEJAZDY ŁĄCZNIE" value={`${profile?.totalRides ?? 0}`} unit="szt." color="#4de926" isDark={isDark} />
                  <StatsModalItem label="PRZEJAZDY MIES." value={`${profile?.monthlyRides ?? 0}`} unit="szt." color="#4de926" isDark={isDark} />
                  <StatsModalItem label="TRASY ZAPISANE" value={`${routes.length}`} unit="szt." color="#4de926" isDark={isDark} />
                  <StatsModalItem label="MEETY" value={`${profile?.meetCount ?? 0}`} unit="szt." color="#ff6b35" isDark={isDark} />
                  <StatsModalItem label="STREAK" value={`${(profile as any)?.streak ?? 0}`} unit="🔥" color="#ff922b" isDark={isDark} />
                  <StatsModalItem label="MIASTA" value={`${profile?.cityCount ?? 0}`} unit="odw." color="#a855f7" isDark={isDark} />
                  <StatsModalItem label="SPOTY" value={`${localSpots.length}`} unit="szt." color="#4de926" isDark={isDark} />
                  <StatsModalItem label="SAMOCHODY" value={`${cars.length}`} unit="szt." color="#268bff" isDark={isDark} />
                </View>
              </StatsModalSection>

              {/* OSIĄGNIĘCIA */}
              <StatsModalSection title="OSIĄGNIĘCIA" color="#f5c518" icon="trophy">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <StatsModalItem label="ODBLOKOWANE" value={`${unlocked.length}`} unit="szt." color="#f5c518" isDark={isDark} />
                  <StatsModalItem label="WSZYSTKIE" value={`${achievements.length}`} unit="szt." color="#f5c518" isDark={isDark} />
                  <StatsModalItem label="OBSERWUJĄCY" value={`${profile?.followersCount ?? 0}`} unit="os." color="#4de926" isDark={isDark} />
                  {!!profile?.position && (
                    <StatsModalItem label="RANKING" value={`#${profile.position}`} color="#e33835" isDark={isDark} />
                  )}
                </View>
              </StatsModalSection>

              <StatsModalSection title="WYKRESY MIESIĘCZNE" color="#a855f7" icon="chart-bar">
                {!premiumActive ? (
                  <TouchableOpacity
                    style={{ backgroundColor: '#FFD70010', borderWidth: 1, borderColor: '#FFD70030', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    onPress={() => router.push('/premium' as any)}
                  >
                    <MaterialIcons name="workspace-premium" size={16} color="#FFD700" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#FFD700', flex: 1 }}>
                      Wykresy miesięczne i porównanie m/m odblokujesz w Premium.
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 10 }}>
                      {(monthlyStats || []).length === 0 ? (
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>Brak danych miesięcznych.</Text>
                      ) : (
                        <>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 140 }}>
                            {(monthlyStats || []).slice(-8).map((m: any) => {
                              const max = Math.max(1, ...(monthlyStats || []).map((x: any) => Number(x.totalDistance || 0)));
                              const h = Math.max(8, Math.round((Number(m.totalDistance || 0) / max) * 120));
                              return (
                                <View key={`${m.year}-${m.month}`} style={{ flex: 1, alignItems: 'center' }}>
                                  <View style={{ width: '80%', height: h, backgroundColor: '#e33835', borderRadius: 6 }} />
                                  <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, marginTop: 4 }}>
                                    {m.month}/{String(m.year).slice(-2)}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                          <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 8 }}>
                            Dystans miesięczny (km)
                          </Text>
                        </>
                      )}
                    </View>
                    {monthlyCompare && (
                      <View style={{ marginTop: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12 }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.text, marginBottom: 6 }}>PORÓWNANIE MIESIĄC DO MIESIĄCA</Text>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>
                          Dystans: {Math.round(monthlyCompare.delta?.totalDistance || 0)} km ({Math.round(monthlyCompare.pct?.totalDistance || 0)}%)
                        </Text>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 4 }}>
                          Przejazdy: {Math.round(monthlyCompare.delta?.ridesCount || 0)} ({Math.round(monthlyCompare.pct?.ridesCount || 0)}%)
                        </Text>
                      </View>
                    )}
                  </>
                )}
              </StatsModalSection>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────

type ProfileSurface = { text: string; textDim: string; surface: string; border: string; bg: string };

function Section({
  title,
  count,
  right,
  children,
  surfaceTheme,
  accentStrip,
}: {
  title: string;
  count?: number | string;
  right?: React.ReactNode;
  children: React.ReactNode;
  surfaceTheme?: ProfileSurface;
  accentStrip?: { kind: 'gradient'; spec: ProfileGradientSpec } | { kind: 'solid'; color: string };
}) {
  const { theme } = useTheme();
  const t = surfaceTheme ?? theme;
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 }}>
        {accentStrip?.kind === 'gradient' ? (
          <LinearGradient
            colors={accentStrip.spec.colors as [string, string, ...string[]]}
            start={accentStrip.spec.start ?? { x: 0, y: 0 }}
            end={accentStrip.spec.end ?? { x: 0, y: 1 }}
            style={{ width: 4, height: 22, borderRadius: 2 }}
          />
        ) : accentStrip?.kind === 'solid' ? (
          <View style={{ width: 4, height: 22, borderRadius: 2, backgroundColor: accentStrip.color }} />
        ) : null}
        <Text style={{ fontFamily: 'Orbitron', color: t.text, fontSize: 13, fontWeight: '700', letterSpacing: 1, flex: 1 }}>{title}</Text>
        {count !== undefined && (
          <View style={{ backgroundColor: t.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: t.border }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: t.textDim }}>{count}</Text>
          </View>
        )}
        {right}
      </View>
      {children}
    </View>
  );
}

function EmptyState({ text, surfaceTheme }: { text: string; surfaceTheme?: ProfileSurface }) {
  const { theme } = useTheme();
  const t = surfaceTheme ?? theme;
  return (
    <View style={{ paddingVertical: 20, alignItems: 'center', backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.border }}>
      <Text style={{ fontFamily: 'Orbitron', color: t.textDim, fontSize: 10 }}>{text}</Text>
    </View>
  );
}

function RarityDivider({ meta, count, surfaceTheme }: { meta: { label: string; color: string; border: string }; count: number; surfaceTheme?: ProfileSurface }) {
  const { theme } = useTheme();
  const t = surfaceTheme ?? theme;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
      <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: meta.border, backgroundColor: (t as { bg?: string }).bg ?? '#090909' }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 2, color: meta.color }}>{meta.label}</Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: meta.color }}>{count}</Text>
    </View>
  );
}

function StatsModalSection({ title, color, icon, children }: { title: string; color: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: color + '20', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={icon as any} size={14} color={color} />
        </View>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color, letterSpacing: 3, fontWeight: '700' }}>{title}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: color + '25', marginLeft: 4 }} />
      </View>
      {children}
    </View>
  );
}

function StatsModalItem({ label, value, unit, color, isDark }: { label: string; value: string; unit?: string; color: string; isDark: boolean }) {
  return (
    <View style={{ minWidth: '30%', flex: 1, backgroundColor: isDark ? '#1a1a1a' : '#f0f0f0', borderRadius: 14, borderWidth: 1, borderColor: color + '30', padding: 12, alignItems: 'center', gap: 3 }}>
      <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color, fontWeight: '900', letterSpacing: -0.5 }}>{value}</Text>
      {!!unit && <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: color + 'bb', letterSpacing: 1 }}>{unit}</Text>}
      <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: isDark ? '#ffffff50' : '#00000050', letterSpacing: 0.5, textAlign: 'center', marginTop: 2 }}>{label}</Text>
    </View>
  );
}