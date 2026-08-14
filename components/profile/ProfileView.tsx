import React, { useState, useRef, useEffect } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, RefreshControl,
  Image, Animated, Dimensions, StatusBar, Modal, Switch, ActivityIndicator, StyleSheet, Easing, FlatList, Alert, Platform,
} from 'react-native';
import { LinearGradient }           from 'expo-linear-gradient';
import MaterialIcons                from '@expo/vector-icons/MaterialIcons';
import Ionicons                     from '@expo/vector-icons/Ionicons';
import { MaterialCommunityIcons }   from '@expo/vector-icons';
import { useRouter }                from 'expo-router';
import { useTheme }                 from '../../contexts/ThemeContext';
import { formatExplorationPercent } from '../../lib/explorationPercent';

import { UserBadges }               from '../user/UserBadges';
import { ProvinceBadge }            from '../user/ProvinceBadge';
import CarCard                      from './CarCard';
import { GLASS_SHADOW, GLASS_BORDER, glassSurface } from './profileCardTheme';
import AchievementsPreviewSection     from './AchievementsPreviewSection';
import SpotPreviewCard              from './SpotPreviewCard';
import { SpotifyProfileTrackRow }   from './SpotifyProfileTrackRow';
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
import type { ProfileGradientSpec, ProfilePremiumExtras } from '../../constants/profilePremiumExtras';
import VisitEntranceFx from './VisitEntranceFx';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import ShopEntranceOverlay from '../shop/ShopEntranceOverlay';
import { NitroShopPromoCard } from '../shop/NitroShopPromoCard';
import type { UserShopCosmetics } from '../../constants/shopCosmetics';
import { useNitroWallet } from '../../hooks/useNitroWallet';
import { linearGradientFromSpec } from './profileGradientUtils';
import ProfileHeroBannerFrame from './ProfileHeroBannerFrame';
import { getHeroBannerHeight } from '../../lib/profileBanner';
import ProfileHeroMotionLayer, { ProfileHeroKenBurnsWrapper, useProfileHeroFloat } from './ProfileHeroMotionLayer';
import Reanimated from 'react-native-reanimated';
import type { ProfileBannerFocusPoint } from '../../constants/profilePremiumExtras';
import { ExplorationCoverageMap } from './ExplorationCoverageMap';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../../constants/config';
import { useScreenHeaderTop, useScreenScrollBottomPadding } from '../../lib/screenHeaderInsets';

type ProfileSurface = { text: string; textDim: string; surface: string; border: string; bg: string; border2?: string; primaryBg?: string };
type ProfileVroomkiPost = {
  id: number;
  caption: string;
  photos: string[];
  videos: string[];
  mediaType: string;
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  car?: { id: number; brand: string; specs: string; photos: string[] } | null;
};

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

function glassCard(t: ProfileSurface, extra?: Record<string, unknown>) {
  return {
    backgroundColor: t.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 16,
    ...GLASS_SHADOW,
    ...extra,
  };
}

function profileLabel(t: ProfileSurface) {
  return { fontFamily: 'Orbitron' as const, fontSize: 10, color: t.textDim, letterSpacing: 1.5 };
}

function widgetGlass(t: ProfileSurface, extra?: Record<string, unknown>) {
  return {
    backgroundColor: glassSurface(t.surface, '80'),
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    ...GLASS_SHADOW,
    ...extra,
  };
}

function socialRowDivider(isLast: boolean) {
  return isLast ? {} : { borderBottomWidth: 1, borderBottomColor: GLASS_BORDER };
}

function ProfileVroomkiModal({
  visible,
  posts,
  loading,
  username,
  theme,
  isOwner,
  onClose,
  onOpenCar,
  onOpenPost,
  onDeletePost,
}: {
  visible: boolean;
  posts: ProfileVroomkiPost[];
  loading: boolean;
  username: string;
  theme: ProfileSurface;
  isOwner: boolean;
  onClose: () => void;
  onOpenCar: (id: number) => void;
  onOpenPost: (id: number) => void;
  onDeletePost: (id: number) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={{ maxHeight: '88%', backgroundColor: theme.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderBottomWidth: 0, borderColor: theme.border }}>
          <View style={{ alignItems: 'center', paddingTop: 12 }}>
            <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <View style={{ width: 38, height: 38, borderRadius: 14, backgroundColor: '#e3383518', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <MaterialIcons name="smart-display" size={19} color="#e33835" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14, fontWeight: '900', letterSpacing: 1 }}>VROOMKI</Text>
              <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 8, letterSpacing: 2, marginTop: 2 }}>@{username}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="close" size={18} color={theme.text} />
            </TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator color="#e33835" style={{ marginVertical: 42 }} />
          ) : (
            <FlatList
              data={posts}
              keyExtractor={item => String(item.id)}
              contentContainerStyle={{ padding: 16, paddingBottom: 34, gap: 14 }}
              ListEmptyComponent={<Text style={{ fontFamily: 'Orbitron', color: theme.textDim, textAlign: 'center', marginVertical: 36 }}>BRAK VROOMEK</Text>}
              renderItem={({ item }) => {
                const cover = item.photos?.[0] ?? item.car?.photos?.[0] ?? null;
                const hasVideo = (item.videos?.length ?? 0) > 0;
                return (
                  <TouchableOpacity
                    activeOpacity={0.88}
                    onPress={() => onOpenPost(item.id)}
                    style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg }}
                  >
                    {cover ? (
                      <Image source={{ uri: cover }} style={{ width: '100%', height: 220 }} resizeMode="cover" />
                    ) : (
                      <View style={{ height: 220, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050505' }}>
                        <MaterialIcons name={hasVideo ? 'videocam' : 'directions-car'} size={54} color="#e33835" />
                      </View>
                    )}
                    {hasVideo && (
                      <View style={{ position: 'absolute', top: 12, right: 12, borderRadius: 999, backgroundColor: '#000000aa', paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <MaterialIcons name="videocam" size={13} color="#fff" />
                        <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 9 }}>WIDEO</Text>
                      </View>
                    )}
                    {isOwner && (
                      <TouchableOpacity
                        onPress={() => {
                          Alert.alert('Usuń VROOMKĘ?', 'Ta rolka zniknie z VROOMKI.', [
                            { text: 'Anuluj', style: 'cancel' },
                            { text: 'Usuń', style: 'destructive', onPress: () => onDeletePost(item.id) },
                          ]);
                        }}
                        style={{ position: 'absolute', top: 12, left: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: '#000000aa', alignItems: 'center', justifyContent: 'center' }}
                        activeOpacity={0.82}
                      >
                        <MaterialIcons name="delete-outline" size={20} color="#fff" />
                      </TouchableOpacity>
                    )}
                    <View style={{ padding: 12 }}>
                      {item.car && (
                        <TouchableOpacity onPress={() => onOpenCar(item.car!.id)} style={{ alignSelf: 'flex-start', backgroundColor: '#e3383518', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 }}>
                          <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 }}>{item.car.brand} · {item.car.specs}</Text>
                        </TouchableOpacity>
                      )}
                      {!!item.caption && <Text style={{ color: theme.text, fontSize: 13, lineHeight: 18 }}>{item.caption}</Text>}
                      <View style={{ flexDirection: 'row', gap: 14, marginTop: 10 }}>
                        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9 }}>♥ {item.likesCount}</Text>
                        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9 }}>💬 {item.commentsCount}</Text>
                        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9 }}>👁 {item.viewsCount}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
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
  const headerTop = useScreenHeaderTop(8);
  const scrollBottomPad = useScreenScrollBottomPadding({ inTab: !onBack });
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
    if (premiumUi.sectionAccentMode === 'gradient' && (premiumUi.sectionAccentGradient?.colors?.length ?? 0) >= 2) {
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
  const { friends, fetchFriends, requests, fetchRequests, acceptRequest, rejectRequest, removeFriend } = useChat({ realtime: false });
  const { counts: followCounts } = useFollowCounts(profile?.id);

  const [selectedSpot,        setSelectedSpot]        = useState<Spot | null>(null);
  const [localSpots,          setLocalSpots]          = useState<SpotPreview[]>([]);
  const [routesModalVisible,  setRoutesModalVisible]  = useState(false);
  const [lbVisible,           setLbVisible]           = useState(false);
  const [lbRouteId,           setLbRouteId]           = useState<number | null>(null);
  const [lbRouteName,         setLbRouteName]         = useState('');
  const [friendsModalVisible, setFriendsModalVisible] = useState(false);
  const [invitesModalVisible, setInvitesModalVisible] = useState(false);
  const [statsModalVisible,   setStatsModalVisible]   = useState(false);
  const [vroomkiModalVisible, setVroomkiModalVisible] = useState(false);
  const [vroomkiPosts,        setVroomkiPosts]        = useState<ProfileVroomkiPost[]>([]);
  const [vroomkiLoading,      setVroomkiLoading]      = useState(false);
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

  const heroMotion = hasPremiumProfileUi ? premiumUi?.heroMotion : undefined;
  const heroFloatStyle = useProfileHeroFloat(heroMotion);

  const shopCosmetics = (profile as { shopCosmetics?: UserShopCosmetics | null })?.shopCosmetics ?? null;
  const shopBannerUri = shopCosmetics?.profileBanner?.assetUrl ?? null;
  const heroBannerUri = shopBannerUri || premiumBannerUrl;

  const bannerFocusPoint = React.useMemo((): ProfileBannerFocusPoint => {
    if (!hasPremiumProfileUi) return 'center';
    const extras = mergeProfilePremiumExtras(
      isOwner ? settings.profilePremiumExtras : profile?.profilePremiumExtras,
    );
    return extras.bannerFocusPoint ?? 'center';
  }, [hasPremiumProfileUi, isOwner, settings.profilePremiumExtras, profile?.profilePremiumExtras]);

  /** Focus point dotyczy wgranego banera użytkownika — banery Nitro Shop zawsze center. */
  const heroBannerFocus = shopBannerUri ? 'center' as ProfileBannerFocusPoint : bannerFocusPoint;

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

  const openVroomkiModal = async () => {
    if (!profile?.id) return;
    setVroomkiModalVisible(true);
    setVroomkiLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/vroomki/user/${profile.id}?limit=60`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setVroomkiPosts(Array.isArray(data?.posts) ? data.posts : []);
    } catch {
      setVroomkiPosts([]);
    } finally {
      setVroomkiLoading(false);
    }
  };

  const deleteVroomkiPost = async (id: number) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/vroomki/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error();
      setVroomkiPosts(prev => prev.filter(post => post.id !== id));
    } catch {
      Alert.alert('Błąd', 'Nie udało się usunąć VROOMKI.');
    }
  };

  React.useEffect(() => { setLocalSpots(spots); }, [spots]);
  React.useEffect(() => {
    if (isOwner) { fetchFriends(); fetchRequests(); }
  }, [isOwner]);

  const handleLikeToggle = (spotId: string, liked: boolean, count: number) => {
    setLocalSpots(prev => prev.map(s => String(s.id) === spotId ? { ...s, isLiked: liked, likesCount: count } : s));
    setSelectedSpot(prev => prev?.id === spotId ? { ...prev, isLiked: liked, likesCount: count } : prev);
  };

  const unlocked = achievements.filter(a => a.active);
  const exploration = profile?.gamificationSummary ?? null;
  const fogOfWar = exploration?.explorationMap ?? exploration?.fogOfWar;
  const explorationStats = fogOfWar as any;
  const turf = exploration?.turf;
  const passport = exploration?.passport;
  const explorationCellsRevealed = Number(
    explorationStats?.totalRevealedCells
    ?? explorationStats?.country?.cellsRevealed
    ?? 0,
  );
  const explorationPercent = Number(
    explorationStats?.averagePercent
    ?? explorationStats?.country?.percentComplete
    ?? 0,
  );
  const explorationPercentText = formatExplorationPercent(explorationCellsRevealed, explorationPercent);

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

  const HERO_BANNER_HEIGHT = getHeroBannerHeight();

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent={Platform.OS === 'android'} />
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* ══ KINOWY BANER — 70% ekranu, absolute, fade w theme.bg ══ */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: HERO_BANNER_HEIGHT,
          zIndex: 0,
          overflow: 'hidden',
        }}
        pointerEvents="none"
      >
        <ProfileHeroKenBurnsWrapper motion={heroMotion} style={{ flex: 1 }}>
          <ProfileHeroBannerFrame
            fixedHeight={HERO_BANNER_HEIGHT}
            uri={heroBannerUri ?? undefined}
            gradient={!heroBannerUri ? heroLinResolved : null}
            focusPoint={heroBannerFocus}
            overlayColors={heroBannerUri ? (heroBannerOverlays[profileThemePreset] || heroBannerOverlays.default) : null}
          />
        </ProfileHeroKenBurnsWrapper>
        <ProfileHeroMotionLayer motion={heroMotion} isDark={isDark} bannerHeight={HERO_BANNER_HEIGHT} />
        <LinearGradient
          colors={['transparent', theme.bg]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent', zIndex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottomPad }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#e33835" colors={['#e33835']} />}
      >

        {/* ══ HERO — avatar nad banerem, dolna część kadru ══ */}
        <Reanimated.View
          style={[
            {
              minHeight:             HERO_BANNER_HEIGHT,
              position:              'relative',
              justifyContent:        'flex-end',
              alignItems:            'center',
              paddingTop:            headerTop,
              paddingBottom:         28,
            },
            heroFloatStyle,
          ]}
        >
          {/* Top bar */}
          <View style={{ position: 'absolute', top: headerTop, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {onBack ? (
                <TouchableOpacity
                  onPress={onBack}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: GLASS_BORDER, alignItems: 'center', justifyContent: 'center' }}
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
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: GLASS_BORDER, alignItems: 'center', justifyContent: 'center' }}
                  onPress={onSettings}
                >
                  <Ionicons name="settings-outline" size={18} color={theme.textDim} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Avatar + tożsamość — nad fade, przy dolnej krawędzi banera */}
          <View style={{ alignItems: 'center', paddingHorizontal: 24, width: '100%' }}>
            <View style={{ position: 'relative', width: 96, height: 96, marginBottom: 14, alignItems: 'center', justifyContent: 'center' }}>
              {premiumActive && avatarRingLin ? (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    width: 96,
                    height: 96,
                    borderRadius: 48,
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
                    style={{ width: 96, height: 96, borderRadius: 48 }}
                  />
                </Animated.View>
              ) : null}
              <View style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                margin: 4,
                borderWidth: 1.5,
                borderColor: premiumActive ? '#0f0f0fcc' : '#e33835',
                overflow: 'hidden',
                backgroundColor: theme.surface,
              }}>
                {profile?.avatarUrl
                  ? <Image key={profile.avatarUrl} source={{ uri: profile.avatarUrl }} style={{ width: 88, height: 88 }} />
                  : (
                    <View style={{ flex: 1, backgroundColor: '#e3383515', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 28, color: '#e33835', fontWeight: '900' }}>{initials}</Text>
                    </View>
                  )
                }
              </View>
              <ShopAvatarDecoration item={shopCosmetics?.avatarFrame} size={96} />
            </View>

            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: pillAccentColors[0], letterSpacing: 2.5, marginBottom: 6 }}>
              {isOwner ? 'TWÓJ PROFIL' : 'PROFIL GRACZA'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 22, color: profileNickColor || theme.text, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center' }} numberOfLines={1}>
                {profile?.username ?? '—'}
              </Text>
              <UserBadges isAdmin={isAdmin ?? profile?.isAdmin} isPremium={premiumActive} compact />
            </View>
            {!!profile?.location && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
                <MaterialIcons name="location-on" size={12} color={theme.textDim} />
                <Text style={{ ...profileLabel(theme), textAlign: 'center' }}>{profile.location}</Text>
              </View>
            )}
            {!!profile?.province && (
              <View style={{ marginTop: 8 }}>
                <ProvinceBadge province={profile.province} compact theme={theme} />
              </View>
            )}
            {!!profile?.position && (
              <View style={{ marginTop: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, borderWidth: 1, borderColor: GLASS_BORDER, paddingHorizontal: 14, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialCommunityIcons name="podium" size={14} color={pillAccentColors[2]} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: pillAccentColors[2], fontWeight: '900' }}>#{profile.position}</Text>
                <Text style={{ ...profileLabel(theme) }}>RANKING</Text>
              </View>
            )}
          </View>
        </Reanimated.View>

        <View style={{ paddingHorizontal: 20, marginTop: -28 }}>

          {/* ══ O MNIE + SPOTIFY + QUICK ACTIONS ══ */}
          <View style={{ ...widgetGlass(theme), padding: 16, marginBottom: 16 }}>
            {(!!profile?.bio || !!profile?.spotifyProfileTrack) && (
              <Text style={{ ...profileLabel(theme), marginBottom: 10 }}>O MNIE</Text>
            )}
            {!!profile?.bio && (
              <Text style={{ color: theme.text, fontSize: 13, lineHeight: 20, marginBottom: profile?.spotifyProfileTrack ? 4 : 12 }}>{profile.bio}</Text>
            )}
            {!!profile?.spotifyProfileTrack && (
              <SpotifyProfileTrackRow
                track={profile.spotifyProfileTrack}
                theme={{ text: theme.text, textDim: theme.textDim, surface: theme.surface, border: theme.border }}
                embedded
              />
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: GLASS_BORDER }}>
              <MaterialIcons name="calendar-today" size={14} color={theme.textDim} />
              <Text style={{ ...profileLabel(theme) }}>Dołączył {joinedLabel}</Text>
            </View>
            {isOwner && (
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 14,
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: 30,
                borderWidth: 1,
                borderColor: theme.border,
                overflow: 'hidden',
              }}>
                {([
                  { icon: 'edit' as const, label: 'Edytuj', onPress: onEdit, lib: 'material' as const },
                  { icon: 'settings-outline' as const, label: 'Ustawienia', onPress: onSettings, lib: 'ion' as const },
                  { icon: 'car-plus' as const, label: 'Auto', onPress: onAddCar, lib: 'mci' as const },
                ]).map((action, idx, arr) => (
                  <React.Fragment key={action.label}>
                    <TouchableOpacity
                      onPress={action.onPress}
                      activeOpacity={0.8}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11 }}
                    >
                      {action.lib === 'material' && <MaterialIcons name={action.icon as any} size={16} color={theme.textDim} />}
                      {action.lib === 'ion' && <Ionicons name={action.icon as any} size={16} color={theme.textDim} />}
                      {action.lib === 'mci' && <MaterialCommunityIcons name={action.icon as any} size={16} color={pillAccentColors[2]} />}
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: action.lib === 'mci' ? pillAccentColors[2] : theme.textDim, letterSpacing: 1 }}>{action.label}</Text>
                    </TouchableOpacity>
                    {idx < arr.length - 1 && (
                      <View style={{ width: 1, height: 22, backgroundColor: GLASS_BORDER }} />
                    )}
                  </React.Fragment>
                ))}
              </View>
            )}
          </View>

          {/* ══ BENTO STATS GRID ══ */}
          <View style={{ marginBottom: 16, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {([
                { icon: 'trophy' as const, value: String(unlocked.length), label: 'Osiągnięcia', color: pillAccentColors[0], tall: true },
                { icon: 'map-marker-distance' as const, value: String(Math.round(profile?.totalDistance ?? 0)), label: 'Kilometry', color: pillAccentColors[1], tall: true },
              ]).map(w => (
                <TouchableOpacity
                  key={w.label}
                  onPress={openStats}
                  activeOpacity={0.82}
                  style={{
                    flex: 1,
                    height: 118,
                    ...widgetGlass(theme),
                    padding: 14,
                    justifyContent: 'space-between',
                  }}
                >
                  <MaterialCommunityIcons name={w.icon} size={22} color={w.color} />
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 24, color: w.color, fontWeight: '900', letterSpacing: -0.5 }}>{w.value}</Text>
                    <Text style={{ ...profileLabel(theme), marginTop: 4 }}>{w.label}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {([
                { icon: 'podium' as const, value: profile?.position ? `#${profile.position}` : '—', label: 'Ranking', color: pillAccentColors[2] },
                { icon: 'chart-bar' as const, value: '→', label: 'Statystyki', color: pillAccentColors[3] },
              ]).map(w => (
                <TouchableOpacity
                  key={w.label}
                  onPress={openStats}
                  activeOpacity={0.82}
                  style={{
                    flex: 1,
                    height: 88,
                    ...widgetGlass(theme),
                    padding: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: w.color, fontWeight: '900' }}>{w.value}</Text>
                    <Text style={{ ...profileLabel(theme), marginTop: 4 }}>{w.label}</Text>
                  </View>
                  <MaterialCommunityIcons name={w.icon} size={20} color={w.color} />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {isOwner && (
            <NitroShopPromoCard
              nitroBalance={nitroWallet?.nitroBalance ?? profile?.nitroBalance ?? 0}
              onPress={() => router.push('/shop' as any)}
            />
          )}

          <TouchableOpacity
            activeOpacity={0.84}
            onPress={() => isOwner
              ? router.push('/profile/inventory' as any)
              : router.push({ pathname: '/profile/inventory', params: { userId: String(profile?.id) } } as any)}
            style={{ ...widgetGlass(theme), minHeight: 78, marginBottom: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}
          >
            <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(242,25,51,.14)', alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="package-variant-closed" size={24} color="#ff5368" /></View>
            <View style={{ flex: 1 }}><Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '900' }}>{isOwner ? 'Mój ekwipunek' : `Ekwipunek @${profile?.username}`}</Text><Text style={{ color: theme.textDim, fontSize: 10, marginTop: 5 }}>Itemy, modele 3D i kosmetyki VROOM</Text></View>
            <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
          </TouchableOpacity>

          {/* ══ SPOŁECZNOŚĆ — jedna karta ══ */}
          <View style={{ ...widgetGlass(theme), padding: 0, marginBottom: 16, overflow: 'hidden' }}>
            <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700', letterSpacing: 2 }}>SPOŁECZNOŚĆ</Text>
            </View>

            <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, ...socialRowDivider(false) }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <MaterialIcons name="visibility" size={18} color={pillAccentColors[2]} />
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: theme.text, fontWeight: '900' }}>{profile?.followersCount ?? 0}</Text>
                  <Text style={{ ...profileLabel(theme) }}>Obserwujący</Text>
                </View>
              </View>
              <View style={{ width: 1, backgroundColor: GLASS_BORDER, marginHorizontal: 8 }} />
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <MaterialIcons name="person-add" size={18} color={pillAccentColors[1]} />
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: theme.text, fontWeight: '900' }}>{profile?.followingCount ?? 0}</Text>
                  <Text style={{ ...profileLabel(theme) }}>Obserwacje</Text>
                </View>
              </View>
            </View>

            {!club ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, ...socialRowDivider(isOwner) }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                  <MaterialCommunityIcons name="shield-off-outline" size={20} color={theme.textDim} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>Klub</Text>
                    <Text style={{ ...profileLabel(theme), marginTop: 2 }}>{isOwner ? 'Nie należysz do klubu' : 'Brak klubu'}</Text>
                  </View>
                </View>
                {isOwner && (
                  <TouchableOpacity
                    onPress={() => router.push('/Community/clubs/clubs' as any)}
                    style={{ backgroundColor: pillAccentColors[0] + '22', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: pillAccentColors[0] + '40' }}
                  >
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: pillAccentColors[0], fontWeight: '700' }}>Szukaj</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, ...socialRowDivider(isOwner) }}
                onPress={() => router.push('/Community/clubs/clubs' as any)}
                activeOpacity={0.85}
              >
                <View style={{ width: 40, height: 40, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: GLASS_BORDER, alignItems: 'center', justifyContent: 'center' }}>
                  {club.avatarUrl
                    ? <Image source={{ uri: club.avatarUrl }} style={{ width: 40, height: 40 }} />
                    : <MaterialCommunityIcons name="shield-crown-outline" size={20} color={pillAccentColors[0]} />
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700' }} numberOfLines={1}>{club.name}</Text>
                  <Text style={{ ...profileLabel(theme), marginTop: 2 }}>{club.memberCount} członków · {club.myRole === 'owner' ? 'Założyciel' : (club.myRank?.name ?? 'Członek')}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={18} color={theme.textDim} />
              </TouchableOpacity>
            )}

            {isOwner && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, ...socialRowDivider(true) }}
                onPress={() => setInvitesModalVisible(true)}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <MaterialIcons name="person-add" size={20} color={pillAccentColors[0]} />
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>Zaproszenia</Text>
                    <Text style={{ ...profileLabel(theme), marginTop: 2 }}>{requests.length} oczekujących</Text>
                  </View>
                </View>
                {requests.length > 0 && (
                  <View style={{ backgroundColor: pillAccentColors[0] + '22', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: pillAccentColors[0] + '40' }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: pillAccentColors[0], fontWeight: '700' }}>{requests.length}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {isOwner && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, ...socialRowDivider(!!(premiumActive && onLocationFriendsOnlyChange)) }}
                onPress={() => setFriendsModalVisible(true)}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <MaterialIcons name="people" size={20} color={pillAccentColors[1]} />
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>Znajomi</Text>
                    <Text style={{ ...profileLabel(theme), marginTop: 2 }}>{friends.length} osób</Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={18} color={theme.textDim} />
              </TouchableOpacity>
            )}

            {isOwner && premiumActive && onLocationFriendsOnlyChange && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                  <MaterialIcons name="location-on" size={20} color="#FFD700" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>Lok. tylko dla znajomych</Text>
                    <Text style={{ ...profileLabel(theme), marginTop: 2 }}>Pozycja widoczna tylko dla znajomych</Text>
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
          </View>

          {/* ══ AUTA ══ */}
          <Section
            surfaceTheme={theme}
            accentStrip={sectionAccentStrip}
            title={isOwner ? 'MOJE AUTA' : 'AUTA'}
            count={cars.length}
            right={isOwner ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={openVroomkiModal} style={{ backgroundColor: theme.primaryBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: theme.primaryBorder }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.primary, fontWeight: '700', letterSpacing: 1 }}>VROOMKI</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onAddCar} style={{ backgroundColor: '#e33835', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#fff', fontWeight: '700', letterSpacing: 1 }}>+ DODAJ</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          >
            {cars.length === 0
              ? <EmptyState surfaceTheme={theme} text="Brak dodanych aut" />
              : cars.map(car => (
                <CarCard
                  key={car.id}
                  brand={car.brand}
                  specs={car.specs}
                  isMain={car.isMain}
                  firstPhoto={car.photos?.[0]}
                  onPress={() => onCarPress(car.id)}
                  theme={theme}
                />
              ))
            }
          </Section>
          {isOwner && carLimitBanner}

          <Section
            surfaceTheme={theme}
            accentStrip={sectionAccentStrip}
            title="EKSPLORACJA MAPY"
            count={explorationPercentText}
            right={isOwner ? (
              <TouchableOpacity
                onPress={() => router.push('/gamification' as any)}
                style={{ backgroundColor: theme.primaryBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: theme.primaryBorder }}
              >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.primary, fontWeight: '700', letterSpacing: 1 }}>OTWORZ</Text>
              </TouchableOpacity>
            ) : null}
          >
            <View style={{ ...widgetGlass(theme), padding: 16, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                {[
                  { label: 'Mapa odkryta', value: explorationPercentText, icon: 'map-search-outline' as const, color: pillAccentColors[0] },
                  { label: 'Rewiry', value: `${turf?.crownCount ?? 0}`, icon: 'crown-outline' as const, color: '#f5c518' },
                  { label: 'Pieczątki', value: `${passport?.totalStamps ?? 0}`, icon: 'passport' as const, color: pillAccentColors[1] },
                ].map(item => (
                  <View key={item.label} style={{ flex: 1, minHeight: 86, borderRadius: 16, borderWidth: 1, borderColor: GLASS_BORDER, backgroundColor: glassSurface(theme.surface, '72'), padding: 10, justifyContent: 'space-between' }}>
                    <MaterialCommunityIcons name={item.icon} size={18} color={item.color} />
                    <View>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: item.color, fontWeight: '900' }}>{item.value}</Text>
                      <Text style={{ ...profileLabel(theme), marginTop: 3 }}>{item.label}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={{ marginBottom: 14 }}>
                <ExplorationCoverageMap
                  userId={isOwner ? undefined : profile?.id}
                  height={220}
                  limit={1200}
                  interactive
                  autoRefreshMs={isOwner ? 60_000 : 0}
                />
              </View>

              {(fogOfWar?.topRegions?.length ?? 0) > 0 ? (
                <View style={{ gap: 10 }}>
                  {fogOfWar!.topRegions.slice(0, 3).map(region => (
                    <View key={region.slug} style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                        <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '800', flex: 1 }} numberOfLines={1}>{region.name}</Text>
                        <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 11, fontWeight: '900' }}>{region.percentComplete}%</Text>
                      </View>
                      <View style={{ height: 7, borderRadius: 99, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.10)' }}>
                        <View style={{ width: `${Math.min(100, region.percentComplete)}%`, height: '100%', borderRadius: 99, backgroundColor: theme.primary }} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={{ ...profileLabel(theme), lineHeight: 18 }}>
                  Po jeździe profil pokaże procent odblokowanej mapy i najlepsze rewiry.
                </Text>
              )}
            </View>

            {(turf?.crowns?.length ?? 0) > 0 && (
              <View style={{ ...widgetGlass(theme), padding: 14, marginBottom: 12 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#f5c518', letterSpacing: 2, fontWeight: '800', marginBottom: 10 }}>REWIRY NALEŻĄCE DO {profile?.username?.toUpperCase?.() ?? 'GRACZA'}</Text>
                {turf!.crowns.slice(0, 3).map(crown => (
                  <View key={crown.regionSlug} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 }}>
                    <MaterialCommunityIcons name="crown" size={17} color="#f5c518" />
                    <Text style={{ color: theme.text, fontWeight: '800', flex: 1 }}>{crown.regionName}</Text>
                    <Text style={{ ...profileLabel(theme) }}>{Number(crown.distanceKm || 0).toFixed(1)} km</Text>
                  </View>
                ))}
              </View>
            )}

            {(passport?.latestStamps?.length ?? 0) > 0 && (
              <View style={{ ...widgetGlass(theme), padding: 14, marginBottom: 0 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: pillAccentColors[1], letterSpacing: 2, fontWeight: '800', marginBottom: 10 }}>PASZPORT MOTORYZACYJNY</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(passport?.latestStamps ?? []).slice(0, 4).map(stamp => (
                    <View key={`${stamp.slug}-${stamp.firstSeenAt}`} style={{ borderRadius: 99, borderWidth: 1, borderColor: GLASS_BORDER, backgroundColor: glassSurface(theme.surface, '80'), paddingHorizontal: 10, paddingVertical: 6 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.text, fontWeight: '800' }}>{stamp.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </Section>

          {/* ══ OSIĄGNIĘCIA ══ */}
          <Section surfaceTheme={theme} accentStrip={sectionAccentStrip} title="OSIĄGNIĘCIA" count={`${unlocked.length}/${achievements.length}`}>
            <AchievementsPreviewSection
              achievements={achievements}
              theme={theme}
              loading={achievements.length === 0}
              isOwner={isOwner}
              onSeeAll={() => router.push('/profile/achievements' as any)}
            />
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
                style={{ ...glassCard(theme, { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: '#FFD70030', backgroundColor: '#FFD70010' }) }}
                onPress={() => router.push('/premium' as any)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="workspace-premium" size={18} color="#FFD700" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#FFD700', fontWeight: '700', letterSpacing: 1 }}>HISTORIA OGRANICZONA DO 30 DNI</Text>
                  <Text style={{ ...profileLabel(theme), marginTop: 2 }}>
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
                      style={{ ...glassCard(theme, { marginVertical: 0, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }) }}
                      onPress={() => setRoutesModalVisible(true)} activeOpacity={0.75}
                    >
                      <MaterialIcons name="route" size={16} color="#e33835" />
                      <Text style={{ ...profileLabel(theme), color: theme.text }}>WSZYSTKIE TRASY ({displayRoutes.length})</Text>
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
                style={{ ...glassCard(theme, { marginBottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }) }}
                onPress={() => router.push('/profile/history-rides' as any)}
                activeOpacity={0.8}
              >
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: `${pillAccentColors[1]}18`, borderWidth: 1, borderColor: `${pillAccentColors[1]}30`, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="map" size={17} color={pillAccentColors[1]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '700', letterSpacing: 1 }}>
                    OTWÓRZ HISTORIĘ PRZEJAZDÓW
                  </Text>
                  <Text style={{ ...profileLabel(theme), marginTop: 3 }}>
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
                      <SpotPreviewCard
                        key={spot.id}
                        spot={spot}
                        isOwner={isOwner}
                        onPress={() => setSelectedSpot(toSpot(spot))}
                        onDeleted={id => setLocalSpots(prev => prev.filter(s => s.id !== id))}
                        theme={theme}
                      />
                    ))}
                  </View>
                  {localSpots.length > SPOTS_PREVIEW && (
                    <TouchableOpacity
                      style={{ ...glassCard(theme, { marginTop: 0, marginBottom: 0, alignItems: 'center' }) }}
                      onPress={() => setShowAllSpots(p => !p)} activeOpacity={0.75}
                    >
                      <Text style={{ ...profileLabel(theme), textAlign: 'center' }}>
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
      <ProfileVroomkiModal
        visible={vroomkiModalVisible}
        posts={vroomkiPosts}
        loading={vroomkiLoading}
        username={profile?.username ?? ''}
        theme={theme}
        isOwner={isOwner}
        onClose={() => setVroomkiModalVisible(false)}
        onOpenCar={(id) => {
          setVroomkiModalVisible(false);
          onCarPress(id);
        }}
        onOpenPost={(id) => {
          setVroomkiModalVisible(false);
          router.push({ pathname: '/Community/vroomki', params: { vroomkiId: String(id) } } as any);
        }}
        onDeletePost={deleteVroomkiPost}
      />
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
                <TouchableOpacity
                  onPress={() => router.push('/gamification' as any)}
                  style={{ marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#7c3aed22', borderWidth: 1, borderColor: '#7c3aed55' }}
                >
                  <Text style={{ color: '#c4b5fd', fontWeight: '700', fontSize: 13 }}>Eksploracja i Paszport</Text>
                </TouchableOpacity>
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
                  <PremiumMonthlyCharts
                    monthlyStats={monthlyStats || []}
                    monthlyCompare={monthlyCompare}
                    theme={theme}
                    isDark={isDark}
                  />
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
  accentStrip?: { kind: 'gradient'; spec: ProfileGradientSpec | null | undefined } | { kind: 'solid'; color: string };
}) {
  const { theme } = useTheme();
  const t = surfaceTheme ?? theme;
  const gradientSpec = accentStrip?.kind === 'gradient' && (accentStrip.spec?.colors?.length ?? 0) >= 2
    ? accentStrip.spec
    : null;
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 }}>
        {gradientSpec ? (
          <LinearGradient
            colors={gradientSpec.colors as [string, string, ...string[]]}
            start={gradientSpec.start ?? { x: 0, y: 0 }}
            end={gradientSpec.end ?? { x: 0, y: 1 }}
            style={{ width: 4, height: 22, borderRadius: 2 }}
          />
        ) : accentStrip?.kind === 'solid' ? (
          <View style={{ width: 4, height: 22, borderRadius: 2, backgroundColor: accentStrip.color }} />
        ) : null}
        <Text style={{ fontFamily: 'Orbitron', color: t.text, fontSize: 13, fontWeight: '700', letterSpacing: 1, flex: 1 }}>{title}</Text>
        {count !== undefined && (
          <View style={{ backgroundColor: t.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: t.border, ...GLASS_SHADOW }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: t.textDim, letterSpacing: 1 }}>{count}</Text>
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
    <View style={{ ...widgetGlass(t), paddingVertical: 24, alignItems: 'center', marginBottom: 16 }}>
      <Text style={{ fontFamily: 'Orbitron', color: t.textDim, fontSize: 10, letterSpacing: 1.5 }}>{text}</Text>
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

type MonthlyStatPoint = {
  year?: number;
  month?: number;
  totalDistance?: number | string | null;
  ridesCount?: number | string | null;
};

function formatCompactKm(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `${Math.round(value)}`;
}

function formatSignedValue(value: number, unit = ''): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value).toLocaleString('pl-PL')}${unit}`;
}

function niceChartMax(value: number): number {
  const safe = Math.max(1, value);
  const magnitude = 10 ** Math.floor(Math.log10(safe));
  const normalized = safe / magnitude;
  const rounded = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
}

function PremiumMonthlyCharts({
  monthlyStats,
  monthlyCompare,
  theme,
  isDark,
}: {
  monthlyStats: MonthlyStatPoint[];
  monthlyCompare: any | null;
  theme: ProfileSurface;
  isDark: boolean;
}) {
  const data = (monthlyStats || [])
    .slice(-8)
    .map((m) => ({
      key: `${m.year ?? 'r'}-${m.month ?? 'm'}`,
      month: Number(m.month ?? 0),
      year: Number(m.year ?? 0),
      distance: Math.max(0, Number(m.totalDistance || 0)),
      rides: Math.max(0, Number(m.ridesCount || 0)),
    }));
  const maxDistance = niceChartMax(Math.max(1, ...data.map((m) => m.distance)));
  const yTicks = [maxDistance, maxDistance / 2, 0];
  const latest = data[data.length - 1];
  const previous = data[data.length - 2];
  const deltaDistance = Number(monthlyCompare?.delta?.totalDistance ?? ((latest?.distance ?? 0) - (previous?.distance ?? 0)));
  const deltaRides = Number(monthlyCompare?.delta?.ridesCount ?? ((latest?.rides ?? 0) - (previous?.rides ?? 0)));
  const pctDistance = Number(monthlyCompare?.pct?.totalDistance ?? 0);
  const pctRides = Number(monthlyCompare?.pct?.ridesCount ?? 0);
  const distancePositive = deltaDistance >= 0;
  const ridesPositive = deltaRides >= 0;

  if (!data.length) {
    return (
      <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 14 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '800' }}>Brak danych miesięcznych</Text>
        <Text style={{ fontSize: 12, color: theme.textDim, marginTop: 6, lineHeight: 17 }}>
          Wykres pojawi się po zapisaniu przejazdów w kolejnych miesiącach.
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '900' }}>
              Dystans miesięczny
            </Text>
            <Text style={{ fontSize: 11, color: theme.textDim, marginTop: 4, lineHeight: 16 }}>
              Słupki pokazują sumę kilometrów przejechanych w danym miesiącu.
            </Text>
          </View>
          <View style={{ borderRadius: 10, borderWidth: 1, borderColor: '#e3383540', backgroundColor: '#e3383512', paddingHorizontal: 9, paddingVertical: 6 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#e33835', fontWeight: '900' }}>KM</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
          <View style={{ width: 34, height: 172, justifyContent: 'space-between', paddingBottom: 22 }}>
            {yTicks.map((tick) => (
              <Text key={tick} style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, textAlign: 'right' }}>
                {formatCompactKm(tick)}
              </Text>
            ))}
          </View>

          <View style={{ flex: 1, marginLeft: 8 }}>
            <View style={{ height: 150, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: isDark ? '#ffffff1a' : '#00000018', justifyContent: 'flex-end' }}>
              {[0, 0.5, 1].map((line) => (
                <View
                  key={line}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 150 * line,
                    height: 1,
                    backgroundColor: isDark ? '#ffffff10' : '#00000010',
                  }}
                />
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 7, height: '100%', paddingHorizontal: 7 }}>
                {data.map((m) => {
                  const height = Math.max(7, Math.round((m.distance / maxDistance) * 126));
                  const label = m.month > 0 ? `${m.month}/${String(m.year || '').slice(-2)}` : '--';
                  return (
                    <View key={m.key} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', minWidth: 24 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.text, marginBottom: 5 }} numberOfLines={1}>
                        {formatCompactKm(m.distance)}
                      </Text>
                      <View style={{ width: '82%', height, borderRadius: 5, backgroundColor: '#e33835' }} />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 6 }} numberOfLines={1}>
                        {label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ fontSize: 10, color: theme.textDim }}>miesiąc</Text>
              <Text style={{ fontSize: 10, color: theme.textDim }}>skala: 0-{formatCompactKm(maxDistance)} km</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <View style={{ flex: 1, borderRadius: 10, backgroundColor: isDark ? '#ffffff08' : '#00000006', padding: 10 }}>
            <Text style={{ fontSize: 10, color: theme.textDim }}>Ostatni miesiąc</Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '900', marginTop: 4 }}>
              {formatCompactKm(latest?.distance ?? 0)} km
            </Text>
          </View>
          <View style={{ flex: 1, borderRadius: 10, backgroundColor: isDark ? '#ffffff08' : '#00000006', padding: 10 }}>
            <Text style={{ fontSize: 10, color: theme.textDim }}>Przejazdy</Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '900', marginTop: 4 }}>
              {(latest?.rides ?? 0).toLocaleString('pl-PL')} szt.
            </Text>
          </View>
        </View>
      </View>

      <View style={{ marginTop: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 14 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.text, fontWeight: '900', marginBottom: 10 }}>
          Porównanie miesiąc do miesiąca
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, borderRadius: 12, borderWidth: 1, borderColor: (distancePositive ? '#4de926' : '#e33835') + '35', padding: 11 }}>
            <Text style={{ fontSize: 10, color: theme.textDim }}>Dystans</Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: distancePositive ? '#4de926' : '#e33835', fontWeight: '900', marginTop: 5 }}>
              {formatSignedValue(deltaDistance, ' km')}
            </Text>
            <Text style={{ fontSize: 10, color: theme.textDim, marginTop: 4 }}>
              {Math.round(pctDistance)}% względem poprzedniego
            </Text>
          </View>
          <View style={{ flex: 1, borderRadius: 12, borderWidth: 1, borderColor: (ridesPositive ? '#4de926' : '#e33835') + '35', padding: 11 }}>
            <Text style={{ fontSize: 10, color: theme.textDim }}>Przejazdy</Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: ridesPositive ? '#4de926' : '#e33835', fontWeight: '900', marginTop: 5 }}>
              {formatSignedValue(deltaRides)}
            </Text>
            <Text style={{ fontSize: 10, color: theme.textDim, marginTop: 4 }}>
              {Math.round(pctRides)}% względem poprzedniego
            </Text>
          </View>
        </View>
      </View>
    </>
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
