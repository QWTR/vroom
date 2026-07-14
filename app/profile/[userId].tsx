import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Text, Animated,
  StyleSheet, Modal, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons      from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage       from '@react-native-async-storage/async-storage';
import Toast              from 'react-native-toast-message';
import { API_URL }        from '../../constants/config';
import AchievementsPreviewSection from '../../components/profile/AchievementsPreviewSection';
import type { Achievement } from '../../hooks/useAchievements';
import SpotPreviewCard    from '../../components/profile/SpotPreviewCard';
import { SpotDetailModal } from '../../components/spots/SpotDetailModal';
import type { GamificationProfileSummary, SpotPreview, SpotifyProfileTrack } from '../../constants/profile';
import type { Spot }       from '../../constants/spotTypes';
import { useChat }         from '../../hooks/useChats';
import { hasValidCustomHeroColors, resolveProfilePalette } from '../../constants/profileThemes';
import { linearGradientFromSpec } from '../../components/profile/profileGradientUtils';
import { useTheme } from '../../contexts/ThemeContext';
import { mergeProfilePremiumExtras } from '../../constants/profilePremiumExtras';
import ProfileHeroBannerFrame from '../../components/profile/ProfileHeroBannerFrame';
import { GLASS_BORDER, GLASS_SHADOW, glassSurface } from '../../components/profile/profileCardTheme';
import { getHeroBannerHeight } from '../../lib/profileBanner';
import { formatExplorationPercent } from '../../lib/explorationPercent';
import type { ProfileBannerFocusPoint } from '../../constants/profilePremiumExtras';
import VisitEntranceFx from '../../components/profile/VisitEntranceFx';
import { ShopAvatarDecoration } from '../../components/shop/ShopAvatarDecoration';
import ShopEntranceOverlay from '../../components/shop/ShopEntranceOverlay';
import type { UserShopCosmetics } from '../../constants/shopCosmetics';
import ProfileBackgroundAnimation from '../../components/profile/ProfileBackgroundAnimation';
import ProfileHeroMotionLayer, { ProfileHeroKenBurnsWrapper } from '../../components/profile/ProfileHeroMotionLayer';
import { UserBadges } from '../../components/user/UserBadges';
import { SpotifyProfileTrackRow } from '../../components/profile/SpotifyProfileTrackRow';
import { ExplorationCoverageMap } from '../../components/profile/ExplorationCoverageMap';
import { useScreenHeaderTop, useScreenScrollBottomPadding } from '../../lib/screenHeaderInsets';

const RED = '#e33835';

/** Hero bez banera — te same klucze co wcześniej w komponencie (hooks muszą być przed early return). */
const HERO_PRESET_GRADIENTS: Record<string, string[]> = {
  default: ['#1a0404', '#0e0202', '#090909'],
  midnight: ['#060d1a', '#08080d', '#090909'],
  sunset: ['#2a0a02', '#1b0705', '#090909'],
  neon: ['#031a12', '#071211', '#090909'],
  royal: ['#1a0630', '#0f0818', '#090909'],
  cyber: ['#031a3a', '#061525', '#090909'],
  gold: ['#2a1f06', '#151005', '#090909'],
  forest: ['#052e12', '#071a0c', '#090909'],
  custom: ['#12121c', '#08080c', '#090909'],
};

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface PublicProfile {
  id: number; username: string; location: string | null;
  bio: string | null; avatarUrl: string | null; createdAt: string;
  totalDistance: number; points: number; meetCount: number;
  cityCount: number; position: number | null;
  topSpeed?: number;
  avgSpeed?: number;
  streak?: number;
  weeklyDistance?: number;
  monthlyDistance?: number;
  totalRides?: number;
  isPremium?: boolean;
  isAdmin?: boolean;
  bannerUrl?: string | null;
  nickColor?: string | null;
  profileThemePreset?: string;
  avatarFramePreset?: string;
  profilePremiumExtras?: unknown;
  spotifyProfileTrack?: SpotifyProfileTrack | null;
  shopCosmetics?: UserShopCosmetics | null;
  gamificationSummary?: GamificationProfileSummary | null;
}
interface PublicCar { id: number; brand: string; specs: string; isMain: boolean; photos: string[] }
interface PublicSpot {
  id:            number;
  name:          string;
  category:      string;
  photos:        string[];
  likesCount:    number;
  commentsCount: number;
  description?:  string;
  latitude?:     number;
  longitude?:    number;
  author?:       string;
  createdAt?:    string;
  isLiked?:      boolean;
}
type FriendStatus = 'none' | 'pending_sent' | 'pending_received' | 'accepted';

function toSpot(s: PublicSpot): Spot {
  return {
    id:            String(s.id),
    name:          s.name,
    description:   s.description ?? '',
    category:      s.category as any,
    latitude:      s.latitude,
    longitude:     s.longitude,
    photos:        s.photos ?? [],
    author:        s.author ?? 'Nieznany',
    createdAt:     s.createdAt?.split('T')[0] ?? '',
    likesCount:    s.likesCount ?? 0,
    commentsCount: s.commentsCount ?? 0,
    isLiked:       s.isLiked ?? false,
  };
}

export default function PublicProfileScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { isDark } = useTheme();
  const headerTop = useScreenHeaderTop(8);
  const scrollBottomPad = useScreenScrollBottomPadding();

  const [profile,       setProfile]       = useState<PublicProfile | null>(null);
  const [cars,          setCars]          = useState<PublicCar[]>([]);
  const [localSpots,    setLocalSpots]    = useState<PublicSpot[]>([]);
  const [achievements,  setAchievements]  = useState<Achievement[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [myUserId,       setMyUserId]       = useState<number | null>(null);
  const [friendStatus,   setFriendStatus]   = useState<FriendStatus>('none');
  const [friendshipId,   setFriendshipId]   = useState<number | null>(null);
  const [friendLoading,  setFriendLoading]  = useState(false);
  const [selectedSpot,   setSelectedSpot]   = useState<Spot | null>(null);
  const [chatLoading,    setChatLoading]     = useState(false);
  const [isFollowing,    setIsFollowing]    = useState(false);
  const [followLoading,  setFollowLoading]  = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [statsModalVisible,    setStatsModalVisible]    = useState(false);
  const [topSpeedModalVisible, setTopSpeedModalVisible] = useState(false);
  const [visitFx, setVisitFx] = useState(false);
  const [shopVisitFx, setShopVisitFx] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [profileMusicMuted, setProfileMusicMuted] = useState(false);

  const { startConversation } = useChat();

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(28)).current;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/community');
  }, [router]);

  const runEntrance = () => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 55, useNativeDriver: true }),
    ]).start();
  };

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('user');
      if (raw) { const u = JSON.parse(raw); setMyUserId(u.userId ?? u.id); }
      await loadAll();
    })();
  }, [userId]);

  const loadAll = async () => {
    setLoading(true);
    setProfileMusicMuted(false);
    try {
      const token = await getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [profileRes, carsRes, spotsRes, achRes, fsRes, followRes, followCountRes, blocksRes] = await Promise.all([
        fetch(`${API_URL}/api/profile/${userId}`,              { headers }),
        fetch(`${API_URL}/api/profile/${userId}/cars`,         { headers }),
        fetch(`${API_URL}/api/profile/${userId}/spots`,        { headers }),
        fetch(`${API_URL}/api/profile/${userId}/achievements`, { headers }),
        fetch(`${API_URL}/api/chat/friends/status/${userId}`,  { headers }),
        fetch(`${API_URL}/api/follow/status/${userId}`,        { headers }),
        fetch(`${API_URL}/api/follow/counts/${userId}`,        { headers }),
        fetch(`${API_URL}/api/moderation/blocks`,              { headers }),
      ]);

      // Accumulate follow counts from whichever endpoint(s) provide them
      let resolvedFollowers = 0;
      let resolvedFollowing = 0;
      let resolvedIsFollowing = false;

      if (profileRes.ok) {
        const pd = await profileRes.json();
        setProfile(pd);
        // Profile endpoint may embed follower counts
        if (typeof pd.followersCount === 'number') resolvedFollowers = pd.followersCount;
        else if (typeof pd.followers === 'number') resolvedFollowers = pd.followers;
        if (typeof pd.followingCount === 'number') resolvedFollowing = pd.followingCount;
        else if (typeof pd.following === 'number') resolvedFollowing = pd.following;
      }
      if (carsRes.ok)    setCars(await carsRes.json());
      if (spotsRes.ok) {
        const s = await spotsRes.json();
        setLocalSpots(s);
      }
      if (achRes.ok) {
        const data = await achRes.json();
        const list = Array.isArray(data) ? data : [];
        setAchievements(list.map((a: any) => ({
          ...a,
          active:         true,
          unlocked:       true,
          progress:       100,
          currentValue:   a.conditionValue ?? 0,
          conditionValue: a.conditionValue ?? 0,
          conditionField: a.conditionField ?? '',
        })));
      }
      if (fsRes.ok) {
        const s = await fsRes.json();
        let mappedStatus: FriendStatus = 'none';
        if (s.status === 'accepted') {
          mappedStatus = 'accepted';
        } else if (s.status === 'pending') {
          mappedStatus = s.isSender ? 'pending_sent' : 'pending_received';
        }
        setFriendStatus(mappedStatus);
        setFriendshipId(s.friendshipId ?? null);
      }
      if (followRes.ok) {
        const f = await followRes.json();
        resolvedIsFollowing = f.isFollowing ?? false;
        // Status endpoint may also carry counts
        if (typeof f.followersCount === 'number') resolvedFollowers = f.followersCount;
        else if (typeof f.followers === 'number') resolvedFollowers = f.followers;
        if (typeof f.followingCount === 'number') resolvedFollowing = f.followingCount;
        else if (typeof f.following === 'number') resolvedFollowing = f.following;
      }
      if (followCountRes.ok) {
        const fc = await followCountRes.json();
        const fc_followers = fc.followers ?? fc.followersCount ?? fc.count;
        const fc_following = fc.following ?? fc.followingCount;
        if (typeof fc_followers === 'number') resolvedFollowers = fc_followers;
        if (typeof fc_following === 'number') resolvedFollowing = fc_following;
      } else {
        // Fallback: legacy single endpoint (followers only)
        try {
          const legacyRes = await fetch(`${API_URL}/api/follow/count/${userId}`, { headers });
          if (legacyRes.ok) {
            const lc = await legacyRes.json();
            const lc_followers = lc.followersCount ?? lc.count;
            if (typeof lc_followers === 'number') resolvedFollowers = lc_followers;
          }
        } catch {}
      }
      if (blocksRes.ok) {
        const b = await blocksRes.json();
        const ids: number[] = Array.isArray(b?.blockedUserIds) ? b.blockedUserIds : [];
        setIsBlocked(ids.includes(Number(userId)));
      }

      // Safety floor: if the current user is following this person, they have at least 1 follower
      if (resolvedIsFollowing && resolvedFollowers === 0) resolvedFollowers = 1;

      setIsFollowing(resolvedIsFollowing);
      setFollowersCount(resolvedFollowers);
      setFollowingCount(resolvedFollowing);
      runEntrance();
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można załadować profilu.' });
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (myUserId && profile && myUserId === profile.id) router.replace('/(tabs)/account');
  }, [myUserId, profile]);

  useEffect(() => {
    const entrance = profile?.shopCosmetics?.entranceEffect ?? profile?.shopCosmetics?.globalEntranceEffect ?? null;
    if (entrance?.assetUrl) {
      setShopVisitFx(true);
      setVisitFx(false);
      return;
    }
    setShopVisitFx(false);
    if (!profile?.isPremium) {
      setVisitFx(false);
      return;
    }
    const ex = mergeProfilePremiumExtras(profile.profilePremiumExtras);
    if (ex.visitEntranceAnim && ex.visitEntranceAnim !== 'none') setVisitFx(true);
    else setVisitFx(false);
  }, [
    profile?.id,
    profile?.isPremium,
    profile?.profilePremiumExtras,
    profile?.shopCosmetics?.entranceEffect?.assetUrl,
    profile?.shopCosmetics?.globalEntranceEffect?.assetUrl,
  ]);

  // ── Like toggle (aktualizuje lokalnie bez przeładowania) ─
  const handleLikeToggle = useCallback((spotId: string, liked: boolean, count: number) => {
    setLocalSpots(prev => prev.map(s =>
      String(s.id) === spotId ? { ...s, isLiked: liked, likesCount: count } : s
    ));
    setSelectedSpot(prev =>
      prev?.id === spotId ? { ...prev, isLiked: liked, likesCount: count } : prev
    );
  }, []);

  const handleSendRequest = useCallback(async () => {
    setFriendLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/chat/friends/request`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(userId) }),
      });
      const data = await res.json();
      if (res.ok) {
        setFriendStatus('pending_sent');
        setFriendshipId(data.id ?? null);
        Toast.show({ type: 'success', text1: '✅ Zaproszenie wysłane!' });
      } else {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Spróbuj ponownie' });
      }
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' }); }
    finally { setFriendLoading(false); }
  }, [userId]);

  const handleRemove = useCallback(async () => {
    if (!friendshipId) return;
    setFriendLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/chat/friends/${friendshipId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setFriendStatus('none');
        setFriendshipId(null);
        Toast.show({ type: 'success', text1: '✅ Usunięto znajomego' });
      }
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' }); }
    finally { setFriendLoading(false); }
  }, [friendshipId]);

  const handleAccept = useCallback(async () => {
    if (!friendshipId) return;
    setFriendLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/chat/friends/${friendshipId}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setFriendStatus('accepted');
        Toast.show({ type: 'success', text1: '✅ Jesteście znajomymi!' });
        await loadAll();
      }
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' }); }
    finally { setFriendLoading(false); }
  }, [friendshipId]);

  const handleStartChat = useCallback(async () => {
    setChatLoading(true);
    try {
      const convId = await startConversation([Number(userId)], false);
      router.push({ pathname: '/Community/chats/[id]', params: { id: String(convId) } });
    } catch (err: unknown) {
      const e = err as Error & { code?: string | null };
      if (e?.code === 'FRIENDS_ONLY_MESSAGES') {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Użytkownik przyjmuje wiadomości tylko od znajomych' });
      } else {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' });
      }
    } finally { setChatLoading(false); }
  }, [userId, startConversation, router]);

  const handleFollowToggle = useCallback(async () => {
    setFollowLoading(true);
    try {
      const token = await getToken();
      if (isFollowing) {
        const res = await fetch(`${API_URL}/api/follow/${userId}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setIsFollowing(false);
          setFollowersCount(prev => Math.max(0, prev - 1));
          Toast.show({ type: 'success', text1: '✅ Przestałeś obserwować' });
        }
      } else {
        const res = await fetch(`${API_URL}/api/follow/${userId}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setIsFollowing(true);
          setFollowersCount(prev => prev + 1);
          Toast.show({ type: 'success', text1: '✅ Obserwujesz!' });
        }
      }
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' }); }
    finally { setFollowLoading(false); }
  }, [userId, isFollowing]);

  const handleBlockUser = useCallback(() => {
    if (!profile?.id || !myUserId || profile.id === myUserId) return;
    Alert.alert(
      'Zablokuj użytkownika',
      `Treści użytkownika @${profile.username} znikną z Twojego feedu dyskusji i listy czatów (1:1). Zgłoszenie trafi do zespołu VROOM.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Zablokuj',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await getToken();
              const res = await fetch(`${API_URL}/api/moderation/block/${profile.id}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'abusive_or_objectionable' }),
              });
              if (!res.ok) throw new Error();
              setIsBlocked(true);
              Toast.show({ type: 'success', text1: 'Zablokowano', text2: 'Profil został ukryty w Twojej aplikacji.' });
              router.back();
            } catch {
              Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie udało się zablokować użytkownika.' });
            }
          },
        },
      ],
    );
  }, [profile, myUserId, router]);

  const handleUnblockUser = useCallback(async () => {
    if (!profile?.id || !isBlocked) return;
    setBlockBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/moderation/block/${profile.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      setIsBlocked(false);
      Toast.show({ type: 'success', text1: 'Odblokowano użytkownika' });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie udało się odblokować użytkownika.' });
    } finally {
      setBlockBusy(false);
    }
  }, [profile?.id, isBlocked]);

  const premiumActive = !!profile?.isPremium;
  const resolvedPreset = premiumActive ? (profile?.profileThemePreset ?? 'default') : 'default';
  const resolvedNickColor = premiumActive ? (profile?.nickColor ?? null) : null;
  const resolvedFramePreset = premiumActive ? (profile?.avatarFramePreset ?? 'vroom') : 'vroom';
  const resolvedBannerUrl = premiumActive ? (profile?.bannerUrl ?? null) : null;
  const shopBannerUri = profile?.shopCosmetics?.profileBanner?.assetUrl ?? null;
  const heroBannerUri = shopBannerUri || resolvedBannerUrl;
  const activeEntranceEffect = profile?.shopCosmetics?.entranceEffect ?? profile?.shopCosmetics?.globalEntranceEffect ?? null;
  const activeBackgroundAnimation = profile?.shopCosmetics?.backgroundAnimation ?? profile?.shopCosmetics?.globalBackgroundAnimation ?? null;
  const resolvedPremiumUi = premiumActive
    ? mergeProfilePremiumExtras(profile?.profilePremiumExtras)
    : null;
  const heroBannerFocus: ProfileBannerFocusPoint = shopBannerUri
    ? 'center'
    : (resolvedPremiumUi?.bannerFocusPoint ?? 'center');

  const palette = useMemo(
    () =>
      resolveProfilePalette(resolvedPreset, {
        isDark,
        customHeroGradient: resolvedPremiumUi?.customHeroGradient ?? null,
        applySavedCustomTint:
          resolvedPreset === 'custom' &&
          !!profile?.isPremium &&
          hasValidCustomHeroColors(resolvedPremiumUi?.customHeroGradient),
      }),
    [resolvedPreset, isDark, profile?.isPremium, resolvedPremiumUi?.customHeroGradient],
  );

  const heroLinResolved = useMemo(() => {
    const fallback = HERO_PRESET_GRADIENTS[resolvedPreset] || HERO_PRESET_GRADIENTS.default;
    if (!profile) {
      const lin = linearGradientFromSpec(null, fallback);
      return lin ?? { colors: ['#080808', '#1A0404'], start: { x: 0.2, y: 0 }, end: { x: 1, y: 1 } };
    }
    const noBanner = !resolvedBannerUrl;
    if (noBanner && resolvedPremiumUi?.customHeroGradient) {
      const custom = linearGradientFromSpec(resolvedPremiumUi.customHeroGradient, []);
      if (custom) return custom;
    }
    const lin = linearGradientFromSpec(null, fallback);
    if (lin) return lin;
    return linearGradientFromSpec(null, ['#080808', '#1A0404', '#0D0808'])!;
  }, [profile, resolvedPreset, resolvedBannerUrl, resolvedPremiumUi?.customHeroGradient]);

  // ── LOADING ──────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#090909', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
        <MaterialCommunityIcons name="car-sports" size={44} color={RED} />
        <ActivityIndicator color={RED} />
        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: RED + '80', letterSpacing: 4 }}>ŁADOWANIE PROFILU</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: '#090909', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
        <MaterialIcons name="person-off" size={52} color="#ffffff20" />
        <Text style={{ fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 13 }}>Nie znaleziono profilu</Text>
        <TouchableOpacity
          onPress={handleBack}
          style={{ backgroundColor: RED + '20', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: RED + '40' }}
        >
          <Text style={{ fontFamily: 'Orbitron', color: RED, fontSize: 11 }}>← WRÓĆ</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initials    = profile.username.slice(0, 2).toUpperCase();
  const joinedLabel = new Date(profile.createdAt).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  const isFriend    = friendStatus === 'accepted';
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

  const HERO_BANNER_HEIGHT = getHeroBannerHeight();
  const cardTheme = {
    text: palette.text,
    textDim: palette.textDim,
    surface: palette.surface,
    border: palette.border,
    bg: palette.bg,
  };
  const profileLabel = { fontFamily: 'Orbitron' as const, fontSize: 10, color: palette.textDim, letterSpacing: 1.5 };
  const widgetGlass = (extra?: Record<string, unknown>) => ({
    backgroundColor: glassSurface(palette.surface, 'cc'),
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    ...GLASS_SHADOW,
    ...extra,
  });
  const glassSection = (extra?: Record<string, unknown>) => ({
    backgroundColor: glassSurface(palette.surface, 'cc'),
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    marginBottom: 16,
    ...GLASS_SHADOW,
    ...extra,
  });
  const pillDivider = { width: 1, height: 22, backgroundColor: GLASS_BORDER, marginHorizontal: 2 };
  const pillBtn = (
    onPress: () => void,
    icon: React.ComponentProps<typeof MaterialIcons>['name'],
    label: string,
    opts?: { disabled?: boolean; loading?: boolean; active?: boolean; danger?: boolean },
  ) => {
    const accent = opts?.danger
      ? palette.text
      : opts?.active
        ? palette.text
        : palette.textDim;
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={opts?.disabled || opts?.loading}
        activeOpacity={0.75}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 22 }}
      >
        {opts?.loading
          ? <ActivityIndicator size="small" color={accent} />
          : <MaterialIcons name={icon} size={15} color={accent} />
        }
        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: accent, fontWeight: '700', letterSpacing: 0.5 }} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };
  const exploration = profile.gamificationSummary ?? null;
  const fogOfWar = exploration?.explorationMap ?? exploration?.fogOfWar;
  const turf = exploration?.turf;
  const passport = exploration?.passport;
  const explorationCellsRevealed = Number(
    fogOfWar?.totalRevealedCells
    ?? fogOfWar?.country?.cellsRevealed
    ?? 0,
  );
  const explorationPercent = Number(
    fogOfWar?.averagePercent
    ?? fogOfWar?.country?.percentComplete
    ?? 0,
  );
  const explorationPercentText = formatExplorationPercent(explorationCellsRevealed, explorationPercent);

  const renderFriendPillAction = () => {
    if (friendLoading) {
      return pillBtn(() => {}, 'person-add', '...', { loading: true, disabled: true });
    }
    if (friendStatus === 'accepted') {
      return pillBtn(handleRemove, 'favorite', 'Znajomy', { active: true });
    }
    if (friendStatus === 'pending_sent') {
      return pillBtn(handleRemove, 'schedule', 'Wysłano', { disabled: false });
    }
    if (friendStatus === 'pending_received') {
      return (
        <>
          {pillBtn(handleAccept, 'check', 'Akceptuj', { active: true })}
          <View style={pillDivider} />
          {pillBtn(handleRemove, 'close', 'Odrzuć')}
        </>
      );
    }
    return pillBtn(handleSendRequest, 'person-add', 'Dodaj');
  };

  return (
    <>
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {/* ══ KINOWY BANER — absolute, 70% ekranu ══ */}
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
          <ProfileHeroKenBurnsWrapper motion={resolvedPremiumUi?.heroMotion} style={{ flex: 1 }}>
            <ProfileHeroBannerFrame
              fixedHeight={HERO_BANNER_HEIGHT}
              uri={heroBannerUri ?? undefined}
              gradient={!heroBannerUri ? heroLinResolved : null}
              focusPoint={heroBannerFocus}
              overlayColors={heroBannerUri ? (heroBannerOverlays[resolvedPreset] || heroBannerOverlays.default) : null}
            />
          </ProfileHeroKenBurnsWrapper>
          {premiumActive && activeBackgroundAnimation ? (
            <ProfileBackgroundAnimation item={activeBackgroundAnimation} />
          ) : null}
          {premiumActive && resolvedPremiumUi?.heroMotion && resolvedPremiumUi.heroMotion !== 'none' ? (
            <ProfileHeroMotionLayer motion={resolvedPremiumUi.heroMotion} isDark={isDark} bannerHeight={HERO_BANNER_HEIGHT} />
          ) : null}
          <LinearGradient
            colors={['transparent', palette.bg]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

        <ScrollView
          style={{ flex: 1, backgroundColor: 'transparent', zIndex: 1 }}
          contentContainerStyle={{ paddingBottom: scrollBottomPad }}
          showsVerticalScrollIndicator={false}
        >
          {/* ══ HERO — wyśrodkowana tożsamość ══ */}
          <Animated.View
            style={{
              minHeight: HERO_BANNER_HEIGHT,
              position: 'relative',
              justifyContent: 'flex-end',
              alignItems: 'center',
              paddingTop: headerTop,
              paddingBottom: 28,
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            }}
          >
            {/* Top bar */}
            <View style={{ position: 'absolute', top: headerTop, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', zIndex: 2 }}>
              <TouchableOpacity
                onPress={handleBack}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  borderWidth: 1,
                  borderColor: GLASS_BORDER,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons name="arrow-back" size={20} color={palette.text} />
              </TouchableOpacity>
            </View>

            {/* Avatar + nick */}
            <View style={{ alignItems: 'center', paddingHorizontal: 24, width: '100%' }}>
              <View style={{ position: 'relative', width: 96, height: 96, marginBottom: 14, alignItems: 'center', justifyContent: 'center' }}>
                {premiumActive ? (
                  <LinearGradient
                    colors={(frameGradients[resolvedFramePreset] || frameGradients.vroom) as [string, string, ...string[]]}
                    style={{ width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', padding: 2 }}
                  >
                    <View style={{
                      width: 88,
                      height: 88,
                      borderRadius: 44,
                      backgroundColor: palette.surface,
                      overflow: 'hidden',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {profile.avatarUrl
                        ? <Image source={{ uri: profile.avatarUrl }} style={{ width: 88, height: 88 }} />
                        : <Text style={{ fontFamily: 'Orbitron', fontSize: 28, color: palette.text, fontWeight: '900' }}>{initials}</Text>
                      }
                    </View>
                  </LinearGradient>
                ) : (
                  <View style={{
                    width: 88,
                    height: 88,
                    borderRadius: 44,
                    borderWidth: 1.5,
                    borderColor: palette.border,
                    backgroundColor: palette.surface,
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {profile.avatarUrl
                      ? <Image source={{ uri: profile.avatarUrl }} style={{ width: 88, height: 88 }} />
                      : <Text style={{ fontFamily: 'Orbitron', fontSize: 28, color: palette.text, fontWeight: '900' }}>{initials}</Text>
                    }
                  </View>
                )}
                <ShopAvatarDecoration item={profile.shopCosmetics?.avatarFrame} size={96} />
                {isFriend && (
                  <View style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: palette.textDim,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: palette.bg,
                  }}>
                    <MaterialIcons name="favorite" size={10} color={palette.bg} />
                  </View>
                )}
              </View>

              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: palette.textDim, letterSpacing: 2.5, marginBottom: 6 }}>
                PROFIL GRACZA
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text
                  style={{ fontFamily: 'Orbitron', fontSize: 22, color: resolvedNickColor || palette.text, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center' }}
                  numberOfLines={1}
                >
                  {profile.username}
                </Text>
                <UserBadges isAdmin={profile.isAdmin} isPremium={profile.isPremium} compact />
              </View>
              {!!profile.location && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
                  <MaterialIcons name="location-on" size={12} color={palette.textDim} />
                  <Text style={{ ...profileLabel, textAlign: 'center' }}>{profile.location}</Text>
                </View>
              )}
              {!!profile.position && (
                <View style={{
                  marginTop: 10,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: GLASS_BORDER,
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <MaterialCommunityIcons name="podium" size={14} color={palette.text} />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: palette.text, fontWeight: '900' }}>#{profile.position}</Text>
                  <Text style={profileLabel}>RANKING</Text>
                </View>
              )}

              {/* ══ Pływająca pigułka akcji społecznościowych ══ */}
              <View style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: 30,
                padding: 4,
                marginTop: 16,
                maxWidth: '100%',
              }}>
                {renderFriendPillAction()}
                <View style={pillDivider} />
                {pillBtn(
                  handleFollowToggle,
                  isFollowing ? 'visibility' : 'visibility-off',
                  isFollowing ? 'Obserwujesz' : 'Obserwuj',
                  { loading: followLoading, disabled: followLoading, active: isFollowing },
                )}
                <View style={pillDivider} />
                {pillBtn(handleStartChat, 'chat', 'Napisz', { loading: chatLoading, disabled: chatLoading })}
                {myUserId != null && profile.id !== myUserId && (
                  <>
                    <View style={pillDivider} />
                    {pillBtn(
                      isBlocked ? handleUnblockUser : handleBlockUser,
                      isBlocked ? 'lock-open' : 'block',
                      isBlocked ? 'Odblokuj' : 'Zablokuj',
                      { loading: blockBusy, disabled: blockBusy, danger: !isBlocked },
                    )}
                  </>
                )}
              </View>
            </View>
          </Animated.View>

          {/* ══ CONTENT ══ */}
          <Animated.View style={{ paddingHorizontal: 20, marginTop: -28, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

            {/* O MNIE + Spotify + społeczność */}
            <View style={{ ...widgetGlass(), padding: 16, marginBottom: 16 }}>
              {(!!profile.bio || !!profile.spotifyProfileTrack) && (
                <Text style={{ ...profileLabel, marginBottom: 10 }}>O MNIE</Text>
              )}
              {!!profile.bio && (
                <Text style={{ color: palette.text, fontSize: 13, lineHeight: 20, marginBottom: profile.spotifyProfileTrack ? 4 : 12 }}>
                  {profile.bio}
                </Text>
              )}
              {!!profile.spotifyProfileTrack && (
                <SpotifyProfileTrackRow
                  track={profile.spotifyProfileTrack}
                  theme={{ text: palette.text, textDim: palette.textDim, surface: palette.surface, border: palette.border }}
                  embedded
                  autoplayOnVisit={
                    !!profile.spotifyProfileTrack.previewAutoplay && !!profile.spotifyProfileTrack.previewUrl
                  }
                  showVisitorMuteBar={
                    !!profile.spotifyProfileTrack.previewAutoplay && !!profile.spotifyProfileTrack.previewUrl
                  }
                  visitorMuted={profileMusicMuted}
                  onVisitorMute={() => setProfileMusicMuted(true)}
                />
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: GLASS_BORDER }}>
                <MaterialIcons name="calendar-today" size={14} color={palette.textDim} />
                <Text style={profileLabel}>Dołączył {joinedLabel}</Text>
              </View>
              <View style={{ flexDirection: 'row', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: GLASS_BORDER }}>
                {[
                  { label: 'Obserwujący', value: followersCount, icon: 'visibility' as const },
                  { label: 'Obserwacje', value: followingCount, icon: 'person-add' as const },
                ].map((item, idx) => (
                  <View key={item.label} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: idx === 0 ? 0 : 12 }}>
                    {idx === 1 && <View style={{ width: 1, height: 32, backgroundColor: GLASS_BORDER, marginRight: 12 }} />}
                    <MaterialIcons name={item.icon} size={18} color={palette.textDim} />
                    <View>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: palette.text, fontWeight: '900' }}>{item.value}</Text>
                      <Text style={profileLabel}>{item.label}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* ══ BENTO STATS GRID 2×2 ══ */}
            <View style={{ marginBottom: 16, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setStatsModalVisible(true)}
                  activeOpacity={0.82}
                  style={{ flex: 1, aspectRatio: 1, ...widgetGlass(), padding: 14, justifyContent: 'space-between' }}
                >
                  <MaterialIcons name="straighten" size={22} color={palette.textDim} />
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 22, color: palette.text, fontWeight: '900', letterSpacing: -0.5 }}>
                      {Math.round(profile.totalDistance).toLocaleString('pl-PL')}
                    </Text>
                    <Text style={{ ...profileLabel, marginTop: 4 }}>Kilometry</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setTopSpeedModalVisible(true)}
                  activeOpacity={0.82}
                  style={{ flex: 1, aspectRatio: 1, ...widgetGlass(), padding: 14, justifyContent: 'space-between' }}
                >
                  <MaterialCommunityIcons name="speedometer" size={22} color={palette.textDim} />
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 22, color: palette.text, fontWeight: '900', letterSpacing: -0.5 }}>
                      {Math.round(profile.topSpeed ?? 0)}
                    </Text>
                    <Text style={{ ...profileLabel, marginTop: 4 }}>KM/H</Text>
                  </View>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, aspectRatio: 1, ...widgetGlass(), padding: 14, justifyContent: 'space-between' }}>
                  <MaterialIcons name="flag" size={22} color={palette.textDim} />
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 22, color: palette.text, fontWeight: '900', letterSpacing: -0.5 }}>
                      {profile.meetCount}
                    </Text>
                    <Text style={{ ...profileLabel, marginTop: 4 }}>Meety</Text>
                  </View>
                </View>
                <View style={{ flex: 1, aspectRatio: 1, ...widgetGlass(), padding: 14, justifyContent: 'space-between' }}>
                  <MaterialIcons name="location-city" size={22} color={palette.textDim} />
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 22, color: palette.text, fontWeight: '900', letterSpacing: -0.5 }}>
                      {profile.cityCount}
                    </Text>
                    <Text style={{ ...profileLabel, marginTop: 4 }}>Miasta</Text>
                  </View>
                </View>
              </View>
            </View>

            {!!profile.streak && (
              <View style={{ ...widgetGlass(), padding: 14, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 22 }}>🔥</Text>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: palette.text, fontWeight: '900' }}>{profile.streak}</Text>
                  <Text style={profileLabel}>Streak dni</Text>
                </View>
              </View>
            )}

            {/* ══ AUTA ══ */}
            <View style={glassSection()}>
              <SectionHeader title="AUTA" count={cars.length} icon="directions-car" palette={palette} />
              {cars.length === 0
                ? <EmptyState text="Brak dodanych aut" palette={palette} />
                : cars.map(car => (
                    <TouchableOpacity
                      key={car.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 14,
                        backgroundColor: glassSurface(palette.surface, '80'),
                        borderRadius: 16,
                        padding: 12,
                        marginBottom: 10,
                        borderWidth: 1,
                        borderColor: palette.border,
                      }}
                      onPress={() => router.push({ pathname: '/profile/car-detail', params: { id: String(car.id) } })}
                      activeOpacity={0.8}
                    >
                      <View style={{
                        width: 72,
                        height: 72,
                        borderRadius: 12,
                        backgroundColor: palette.bg,
                        overflow: 'hidden',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: palette.border,
                      }}>
                        {car.photos[0]
                          ? <Image source={{ uri: car.photos[0] }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                          : <MaterialIcons name="directions-car" size={22} color={palette.textDim} />
                        }
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <Text style={{ fontFamily: 'Orbitron', color: palette.text, fontSize: 13, fontWeight: '700' }}>{car.brand}</Text>
                          {car.isMain && (
                            <View style={{ backgroundColor: glassSurface(palette.surface, '80'), paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: palette.border }}>
                              <Text style={{ fontFamily: 'Orbitron', color: palette.textDim, fontSize: 7 }}>GŁÓWNE</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontFamily: 'Orbitron', color: palette.textDim, fontSize: 10 }}>{car.specs}</Text>
                      </View>
                      <MaterialIcons name="arrow-forward-ios" size={13} color={palette.textDim} />
                    </TouchableOpacity>
                  ))
              }
            </View>

            {/* ══ OSIĄGNIĘCIA ══ */}
            <View style={glassSection()}>
              <SectionHeader title="EKSPLORACJA MAPY" count={explorationPercentText} icon="map" palette={palette} />
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                {[
                  { label: 'Mapa', value: explorationPercentText, icon: 'map-search-outline' as const, color: RED },
                  { label: 'Rewiry', value: `${turf?.crownCount ?? 0}`, icon: 'crown-outline' as const, color: '#f5c518' },
                  { label: 'Pieczątki', value: `${passport?.totalStamps ?? 0}`, icon: 'passport' as const, color: palette.textDim },
                ].map(item => (
                  <View key={item.label} style={{ flex: 1, minHeight: 78, backgroundColor: glassSurface(palette.surface, '80'), borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: 10, justifyContent: 'space-between' }}>
                    <MaterialCommunityIcons name={item.icon} size={18} color={item.color} />
                    <View>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 17, color: item.color, fontWeight: '900' }}>{item.value}</Text>
                      <Text style={profileLabel}>{item.label}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={{ marginBottom: 14 }}>
                <ExplorationCoverageMap userId={profile.id} height={220} limit={1200} interactive />
              </View>

              {(fogOfWar?.topRegions?.length ?? 0) > 0 ? (
                <View style={{ gap: 10 }}>
                  {fogOfWar!.topRegions.slice(0, 3).map(region => (
                    <View key={region.slug} style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: palette.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{region.name}</Text>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: RED, fontWeight: '900' }}>{region.percentComplete}%</Text>
                      </View>
                      <View style={{ height: 7, borderRadius: 99, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.10)' }}>
                        <View style={{ width: `${Math.min(100, region.percentComplete)}%`, height: '100%', backgroundColor: RED, borderRadius: 99 }} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <EmptyState text="Brak odkrytych dzielnic" palette={palette} />
              )}

              {(turf?.crowns?.length ?? 0) > 0 && (
                <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: GLASS_BORDER }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#f5c518', fontWeight: '800', letterSpacing: 2, marginBottom: 8 }}>
                    REWIRY NALEŻĄCE DO {profile.username.toUpperCase()}
                  </Text>
                  {turf!.crowns.slice(0, 3).map(crown => (
                    <View key={crown.regionSlug} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
                      <MaterialCommunityIcons name="crown" size={16} color="#f5c518" />
                      <Text style={{ color: palette.text, fontWeight: '800', flex: 1 }}>{crown.regionName}</Text>
                      <Text style={profileLabel}>{Number(crown.distanceKm || 0).toFixed(1)} km</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={glassSection()}>
              <SectionHeader title="OSIĄGNIĘCIA" count={achievements.length} icon="emoji-events" palette={palette} />
              <AchievementsPreviewSection
                achievements={achievements}
                theme={cardTheme}
                loading={loading && achievements.length === 0}
                onSeeAll={() => router.push({ pathname: '/profile/achievements', params: { userId: String(profile.id) } } as any)}
              />
            </View>

            {/* ══ SPOTY ══ */}
            <View style={glassSection({ marginBottom: 0 })}>
              <SectionHeader title="SPOTY" count={localSpots.length} icon="place" palette={palette} />
              {localSpots.length === 0
                ? <EmptyState text="Brak dodanych spotów" palette={palette} />
                : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
                    {localSpots.map(spot => (
                      <SpotPreviewCard
                        key={spot.id}
                        spot={spot as unknown as SpotPreview}
                        isOwner={false}
                        onPress={() => setSelectedSpot(toSpot(spot))}
                      />
                    ))}
                  </View>
                )
              }
            </View>

          </Animated.View>
        </ScrollView>

        {shopVisitFx && activeEntranceEffect && (
          <ShopEntranceOverlay item={activeEntranceEffect} onDone={() => setShopVisitFx(false)} />
        )}
        {visitFx && !shopVisitFx && resolvedPremiumUi?.visitEntranceAnim && resolvedPremiumUi.visitEntranceAnim !== 'none' && (
          <VisitEntranceFx kind={resolvedPremiumUi.visitEntranceAnim} onDone={() => setVisitFx(false)} />
        )}
      </View>

      {/* ══ MODAL SZCZEGÓŁÓW SPOTU ══ */}
      <SpotDetailModal
        visible={selectedSpot !== null}
        spot={selectedSpot}
        onClose={() => setSelectedSpot(null)}
        getDistance={() => 0}
        onLikeToggle={handleLikeToggle}
      />

      {/* ══ STATS MODAL ══ */}
      <Modal
        visible={statsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStatsModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#111', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, paddingBottom: 48 }}>
            <View style={{ width: 40, height: 4, backgroundColor: '#ffffff20', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: RED, letterSpacing: 4, marginBottom: 16 }}>STATYSTYKI DYSTANSU</Text>
            <View style={{ backgroundColor: RED + '12', borderRadius: 18, borderWidth: 1, borderColor: RED + '30', padding: 20, marginBottom: 12, alignItems: 'center' }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 48, color: RED, fontWeight: '900', letterSpacing: -2 }}>
                {Math.round(profile?.totalDistance ?? 0).toLocaleString('pl-PL')}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: RED + '80' }}>KM ŁĄCZNIE</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              {[
                { label: 'TEN TYDZIEŃ', value: Math.round(profile?.weeklyDistance ?? 0), color: '#268bff' },
                { label: 'TEN MIESIĄC', value: Math.round(profile?.monthlyDistance ?? 0), color: '#a855f7' },
              ].map(item => (
                <View key={item.label} style={{ flex: 1, backgroundColor: item.color + '12', borderRadius: 14, borderWidth: 1, borderColor: item.color + '30', padding: 16, alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 24, color: item.color, fontWeight: '900' }}>{item.value}</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: item.color + '80', letterSpacing: 1 }}>KM</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: '#ffffff40', letterSpacing: 1, marginTop: 4 }}>{item.label}</Text>
                </View>
              ))}
            </View>
            <View style={{ backgroundColor: '#ffffff08', borderRadius: 14, borderWidth: 1, borderColor: '#ffffff10', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#ffffff60' }}>ŁĄCZNIE TRAS</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: '#fff', fontWeight: '900' }}>{profile?.totalRides ?? 0}</Text>
            </View>
            <TouchableOpacity
              style={{ marginTop: 20, backgroundColor: RED + '18', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: RED + '30' }}
              onPress={() => setStatsModalVisible(false)}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: RED, fontWeight: '700' }}>ZAMKNIJ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ══ TOP SPEED MODAL ══ */}
      <Modal
        visible={topSpeedModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTopSpeedModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#111', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, paddingBottom: 48 }}>
            <View style={{ width: 40, height: 4, backgroundColor: '#ffffff20', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ff6b35', letterSpacing: 4, marginBottom: 16 }}>STATYSTYKI PRĘDKOŚCI</Text>
            <View style={{ backgroundColor: '#ff6b3512', borderRadius: 18, borderWidth: 1, borderColor: '#ff6b3530', padding: 20, marginBottom: 12, alignItems: 'center' }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 72, color: '#ff6b35', fontWeight: '900', letterSpacing: -3, lineHeight: 78 }}>
                {Math.round(profile?.topSpeed ?? 0)}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: '#ff6b3580' }}>KM/H REKORD</Text>
            </View>
            <View style={{ backgroundColor: '#ffffff08', borderRadius: 14, borderWidth: 1, borderColor: '#ffffff10', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#ffffff60' }}>ŚREDNIA PRĘDKOŚĆ</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: '#fff', fontWeight: '900' }}>{Math.round(profile?.avgSpeed ?? 0)} km/h</Text>
            </View>
            <TouchableOpacity
              style={{ marginTop: 8, backgroundColor: '#ff6b3518', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#ff6b3530' }}
              onPress={() => setTopSpeedModalVisible(false)}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#ff6b35', fontWeight: '700' }}>ZAMKNIJ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── SectionHeader ─────────────────────────────────────────
function SectionHeader({ title, count, icon, palette }: {
  title: string; count: number; icon: string;
  palette: { text: string; textDim: string; surface: string; border: string };
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <View style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        backgroundColor: glassSurface(palette.surface, '80'),
        borderWidth: 1,
        borderColor: palette.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <MaterialIcons name={icon as any} size={14} color={palette.textDim} />
      </View>
      <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: palette.text, fontWeight: '700', flex: 1, letterSpacing: 1 }}>{title}</Text>
      <View style={{
        backgroundColor: glassSurface(palette.surface, '80'),
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderWidth: 1,
        borderColor: palette.border,
      }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: palette.textDim }}>{count}</Text>
      </View>
    </View>
  );
}

// ── EmptyState ────────────────────────────────────────────
function EmptyState({ text, palette }: {
  text: string;
  palette: { textDim: string; surface: string; border: string };
}) {
  return (
    <View style={{
      backgroundColor: glassSurface(palette.surface, '80'),
      borderRadius: 16,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: 'center',
      paddingVertical: 20,
    }}>
      <Text style={{ fontFamily: 'Orbitron', color: palette.textDim, fontSize: 10, letterSpacing: 1.5 }}>{text}</Text>
    </View>
  );
}
