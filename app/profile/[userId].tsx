import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Text, Animated,
  Dimensions, StyleSheet, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons      from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage       from '@react-native-async-storage/async-storage';
import Toast              from 'react-native-toast-message';
import { API_URL }        from '../../constants/config';
import AchievementBox     from '../../components/profile/AchievementBox';
import type { Achievement } from '../../hooks/useAchievements';
import SpotPreviewCard    from '../../components/profile/SpotPreviewCard';
import { SpotDetailModal } from '../../components/spots/SpotDetailModal';
import type { SpotPreview } from '../../constants/profile';
import type { Spot }       from '../../constants/spotTypes';
import { useChat }         from '../../hooks/useChats';
import { getProfileThemePalette } from '../../constants/profileThemes';

const { width, height } = Dimensions.get('window');
const RED = '#e33835';

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
  bannerUrl?: string | null;
  nickColor?: string | null;
  profileThemePreset?: string;
  avatarFramePreset?: string;
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

  const { startConversation } = useChat();

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(28)).current;

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
    try {
      const token = await getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [profileRes, carsRes, spotsRes, achRes, fsRes, followRes, followCountRes] = await Promise.all([
        fetch(`${API_URL}/api/profile/${userId}`,              { headers }),
        fetch(`${API_URL}/api/profile/${userId}/cars`,         { headers }),
        fetch(`${API_URL}/api/profile/${userId}/spots`,        { headers }),
        fetch(`${API_URL}/api/profile/${userId}/achievements`, { headers }),
        fetch(`${API_URL}/api/chat/friends/status/${userId}`,  { headers }),
        fetch(`${API_URL}/api/follow/status/${userId}`,        { headers }),
        fetch(`${API_URL}/api/follow/counts/${userId}`,        { headers }),
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
        setAchievements(data.map((a: any) => ({
          ...a, active: true, unlocked: true, progress: 100, currentValue: a.conditionValue ?? 0,
        })));
      }
      if (fsRes.ok) {
        const s = await fsRes.json();
        setFriendStatus(s.status ?? 'none');
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
          onPress={() => router.back()}
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
  const profileThemePreset = profile.profileThemePreset ?? 'default';
  const palette = getProfileThemePalette(profileThemePreset);
  const heroPresetGradients: Record<string, string[]> = {
    default: ['#1a0404', '#0e0202', '#090909'],
    midnight: ['#060d1a', '#08080d', '#090909'],
    sunset: ['#2a0a02', '#1b0705', '#090909'],
    neon: ['#031a12', '#071211', '#090909'],
  };
  const heroBannerOverlays: Record<string, string[]> = {
    default: ['#00000066', '#00000022'],
    midnight: ['#06132599', '#0a0f2055'],
    sunset: ['#2a0a0288', '#2b120855'],
    neon: ['#03201688', '#0a201855'],
  };
  const frameGradients: Record<string, string[]> = {
    vroom: ['#e33835', '#268bff', '#4de926', '#e33835'],
    sunrise: ['#ff6b35', '#f5c518', '#ff6b35'],
    ocean: ['#38a5e3', '#1b6eff', '#38a5e3'],
    lime: ['#4de926', '#a6ff4d', '#4de926'],
  };

  // ── FRIEND BUTTON ────────────────────────────────────────
  const FriendButton = () => {
    if (friendLoading) return (
      <View style={[s.friendBtn, { justifyContent: 'center' }]}>
        <ActivityIndicator size="small" color={RED} />
      </View>
    );
    if (friendStatus === 'accepted') return (
      <TouchableOpacity style={[s.friendBtn, { borderColor: '#ff6b9d40', backgroundColor: '#ff6b9d10' }]} onPress={handleRemove} activeOpacity={0.8}>
        <MaterialIcons name="favorite" size={16} color="#ff6b9d" />
        <Text style={[s.friendBtnTxt, { color: '#ff6b9d' }]}>ZNAJOMY · Usuń</Text>
      </TouchableOpacity>
    );
    if (friendStatus === 'pending_sent') return (
      <TouchableOpacity style={s.friendBtn} onPress={handleRemove} activeOpacity={0.8}>
        <MaterialIcons name="schedule" size={16} color="#ffffff40" />
        <Text style={[s.friendBtnTxt, { color: '#ffffff40' }]}>ZAPROSZENIE WYSŁANE · Cofnij</Text>
      </TouchableOpacity>
    );
    if (friendStatus === 'pending_received') return (
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
        <TouchableOpacity style={[s.friendBtn, { flex: 1, marginBottom: 0, backgroundColor: RED + '18', borderColor: RED + '50' }]} onPress={handleAccept} activeOpacity={0.8}>
          <MaterialIcons name="check" size={16} color={RED} />
          <Text style={[s.friendBtnTxt, { color: RED }]}>AKCEPTUJ</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.friendBtn, { flex: 1, marginBottom: 0 }]} onPress={handleRemove} activeOpacity={0.8}>
          <MaterialIcons name="close" size={16} color="#ffffff40" />
          <Text style={[s.friendBtnTxt, { color: '#ffffff40' }]}>ODRZUĆ</Text>
        </TouchableOpacity>
      </View>
    );
    return (
      <TouchableOpacity style={[s.friendBtn, { backgroundColor: RED + '18', borderColor: RED + '50' }]} onPress={handleSendRequest} activeOpacity={0.8}>
        <MaterialIcons name="person-add" size={16} color={RED} />
        <Text style={[s.friendBtnTxt, { color: RED }]}>DODAJ ZNAJOMEGO</Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: palette.bg }}
        contentContainerStyle={{ paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ══ HERO HEADER ══════════════════════════════════ */}
        <View style={{ height: height * 0.36, position: 'relative', overflow: 'hidden' }}>
          {profile.bannerUrl ? (
            <Image
              source={{ uri: profile.bannerUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={(heroPresetGradients[profileThemePreset] || heroPresetGradients.default) as any}
              start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          )}
          {!!profile.bannerUrl && (
            <LinearGradient
              colors={(heroBannerOverlays[profileThemePreset] || heroBannerOverlays.default) as any}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          )}

          {/* Dekoracje */}
          <View style={{ position: 'absolute', top: -70, right: -70, width: 260, height: 260, borderRadius: 130, backgroundColor: RED + '10', borderWidth: 1, borderColor: RED + '20' }} />
          <View style={{ position: 'absolute', top: -20, right: -20, width: 140, height: 140, borderRadius: 70, backgroundColor: RED + '18' }} />
          <View style={{ position: 'absolute', bottom: -50, left: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: RED + '06' }} />

          {/* Scan lines */}
          {Array.from({ length: 10 }).map((_, i) => (
            <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * (height * 0.36 / 10), height: 1, backgroundColor: '#ffffff04' }} />
          ))}

          {/* HUD corners */}
          <View style={[s.cTL]}><View style={s.cH} /><View style={s.cV} /></View>
          <View style={[s.cTR]}><View style={s.cH} /><View style={[s.cV, { left: undefined, right: 0 }]} /></View>

          {/* Nawigacja */}
          <View style={{ position: 'absolute', top: 52, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <TouchableOpacity
              style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: '#ffffff10', borderWidth: 1, borderColor: '#ffffff15', alignItems: 'center', justifyContent: 'center' }}
              onPress={() => router.back()}
            >
              <MaterialIcons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff12', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 }}>
              <View style={{ backgroundColor: RED, borderRadius: 6, padding: 4 }}>
                <MaterialCommunityIcons name="car-sports" size={11} color="#fff" />
              </View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '900', letterSpacing: 3 }}>VROOM</Text>
            </View>
            <View style={{ width: 38 }} />
          </View>

          {/* Avatar + nazwa */}
          <Animated.View style={{
            position: 'absolute', bottom: 32, left: 20, right: 20,
            opacity: fadeAnim, transform: [{ translateY: slideAnim }],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
              <View style={{ position: 'relative' }}>
                {profile.isPremium ? (
                  <LinearGradient
                    colors={(frameGradients[profile.avatarFramePreset || 'vroom'] || frameGradients.vroom) as any}
                    style={{ width: 84, height: 84, borderRadius: 24, alignItems: 'center', justifyContent: 'center', padding: 2 }}
                  >
                    <View style={{ width: 80, height: 80, borderRadius: 22, backgroundColor: '#1a0808', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                      {profile.avatarUrl
                        ? <Image source={{ uri: profile.avatarUrl }} style={{ width: 80, height: 80 }} />
                        : <Text style={{ fontFamily: 'Orbitron', fontSize: 26, color: RED, fontWeight: '900' }}>{initials}</Text>
                      }
                    </View>
                  </LinearGradient>
                ) : (
                  <View style={{ width: 80, height: 80, borderRadius: 22, backgroundColor: '#1a0808', borderWidth: 2.5, borderColor: RED, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                    {profile.avatarUrl
                    ? <Image source={{ uri: profile.avatarUrl }} style={{ width: 80, height: 80 }} />
                    : <Text style={{ fontFamily: 'Orbitron', fontSize: 26, color: RED, fontWeight: '900' }}>{initials}</Text>
                    }
                  </View>
                )}
                {isFriend && (
                  <View style={{ position: 'absolute', bottom: -4, right: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: '#ff6b9d', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#090909' }}>
                    <MaterialIcons name="favorite" size={10} color="#fff" />
                  </View>
                )}
              </View>
              <View style={{ flex: 1, paddingBottom: 4 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: RED, letterSpacing: 4, marginBottom: 4 }}>PROFIL UŻYTKOWNIKA</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 22, color: profile.nickColor || '#fff', fontWeight: '900', letterSpacing: 0.5 }} numberOfLines={1}>
                    {profile.username}
                  </Text>
                  {profile.isPremium && <MaterialIcons name="workspace-premium" size={18} color="#FFD700" />}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 }}>
                  {!!profile.location && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <MaterialIcons name="location-on" size={11} color={RED + 'aa'} />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff50' }}>{profile.location}</Text>
                    </View>
                  )}
                  {!!profile.position && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: RED + '18', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: RED + '35' }}>
                      <MaterialIcons name="emoji-events" size={10} color={RED} />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: RED }}>#{profile.position}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </Animated.View>

          <LinearGradient colors={['transparent', palette.bg]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 70 }} />
        </View>

        {/* ══ CONTENT ══════════════════════════════════════ */}
        <Animated.View style={{ paddingHorizontal: 20, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* Bio */}
          {!!profile.bio && (
            <View style={{ backgroundColor: palette.surface, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: palette.border, marginTop: 8 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: RED, letterSpacing: 3, marginBottom: 8 }}>BIO</Text>
              <Text style={{ fontFamily: 'Orbitron', color: palette.textDim, fontSize: 11, lineHeight: 20 }}>{profile.bio}</Text>
            </View>
          )}

          {/* Joined */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20, marginTop: profile.bio ? 0 : 12 }}>
            <MaterialIcons name="calendar-today" size={12} color={palette.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: palette.textDim, letterSpacing: 1 }}>Dołączył {joinedLabel}</Text>
          </View>

          {/* Stats — klikalne karty */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            {/* Dystans — klikalny, otwiera StatsModal */}
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: palette.surface, borderRadius: 14, padding: 12, alignItems: 'center', gap: 5, borderWidth: 1, borderColor: palette.border, overflow: 'hidden' }}
              onPress={() => setStatsModalVisible(true)}
              activeOpacity={0.8}
            >
              <View style={{ position: 'absolute', top: -14, right: -14, width: 50, height: 50, borderRadius: 25, backgroundColor: RED + '10' }} />
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: RED + '18', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="straighten" size={15} color={RED} />
              </View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: palette.text, fontWeight: '900', letterSpacing: -0.5 }}>
                {Math.round(profile.totalDistance).toLocaleString('pl-PL')}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: RED + 'aa', letterSpacing: 1 }}>KM</Text>
              <MaterialIcons name="expand-more" size={12} color={RED + '60'} style={{ marginTop: 2 }} />
            </TouchableOpacity>

            {/* Top Speed — klikalny, otwiera TopSpeedModal */}
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: palette.surface, borderRadius: 14, padding: 12, alignItems: 'center', gap: 5, borderWidth: 1, borderColor: palette.border, overflow: 'hidden' }}
              onPress={() => setTopSpeedModalVisible(true)}
              activeOpacity={0.8}
            >
              <View style={{ position: 'absolute', top: -14, right: -14, width: 50, height: 50, borderRadius: 25, backgroundColor: '#ff6b3510' }} />
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#ff6b3518', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="speedometer" size={15} color="#ff6b35" />
              </View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: palette.text, fontWeight: '900', letterSpacing: -0.5 }}>
                {Math.round(profile.topSpeed ?? 0)}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#ff6b35aa', letterSpacing: 1 }}>KM/H</Text>
              <MaterialIcons name="expand-more" size={12} color={'#ff6b3560'} style={{ marginTop: 2 }} />
            </TouchableOpacity>

            {/* Meety */}
            <View style={{ flex: 1, backgroundColor: palette.surface, borderRadius: 14, padding: 12, alignItems: 'center', gap: 5, borderWidth: 1, borderColor: palette.border, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', top: -14, right: -14, width: 50, height: 50, borderRadius: 25, backgroundColor: '#ff6b3510' }} />
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#ff6b3518', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="flag" size={15} color="#ff6b35" />
              </View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: palette.text, fontWeight: '900', letterSpacing: -0.5 }}>{profile.meetCount}</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#ff6b35aa', letterSpacing: 1 }}>MEETY</Text>
            </View>

            {/* Miasta */}
            <View style={{ flex: 1, backgroundColor: palette.surface, borderRadius: 14, padding: 12, alignItems: 'center', gap: 5, borderWidth: 1, borderColor: palette.border, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', top: -14, right: -14, width: 50, height: 50, borderRadius: 25, backgroundColor: '#268bff10' }} />
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#268bff18', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="location-city" size={15} color="#268bff" />
              </View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: palette.text, fontWeight: '900', letterSpacing: -0.5 }}>{profile.cityCount}</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#268bffaa', letterSpacing: 1 }}>MIASTA</Text>
            </View>
          </View>

          {/* Streak + Pozycja */}
          {(!!profile.streak || !!profile.position) && (
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              {!!profile.streak && (
                <View style={{ flex: 1, backgroundColor: '#ff922b12', borderRadius: 14, borderWidth: 1, borderColor: '#ff922b30', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 20 }}>🔥</Text>
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: '#ff922b', fontWeight: '900' }}>{profile.streak}</Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: '#ff922b80', letterSpacing: 1 }}>STREAK</Text>
                  </View>
                </View>
              )}
              {!!profile.position && (
                <View style={{ flex: 1, backgroundColor: RED + '12', borderRadius: 14, borderWidth: 1, borderColor: RED + '30', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <MaterialIcons name="emoji-events" size={20} color={RED} />
                  <View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: RED, fontWeight: '900' }}>#{profile.position}</Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: RED + '80', letterSpacing: 1 }}>RANKING</Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Follow counts */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'OBSERWUJĄCY', value: followersCount, color: '#4de926', icon: 'visibility'  as const },
              { label: 'OBSERWACJE',  value: followingCount, color: '#a855f7', icon: 'person-add'  as const },
            ].map(item => (
              <View key={item.label} style={{ flex: 1, backgroundColor: palette.surface, borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: item.color + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name={item.icon} size={16} color={item.color} />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: palette.text, fontWeight: '900', letterSpacing: -0.5 }}>{item.value}</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: item.color, letterSpacing: 1, marginTop: 2 }}>{item.label}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Friend Button */}
          <FriendButton />

          {/* ══ NAPISZ + OBSERWUJ ══ */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            {/* Napisz */}
            <TouchableOpacity
              style={[s.friendBtn, { flex: 1, marginBottom: 0, backgroundColor: '#268bff18', borderColor: '#268bff40' }]}
              onPress={handleStartChat}
              activeOpacity={0.8}
              disabled={chatLoading}
            >
              {chatLoading
                ? <ActivityIndicator size="small" color="#268bff" />
                : <>
                    <MaterialIcons name="chat" size={16} color="#268bff" />
                    <Text style={[s.friendBtnTxt, { color: '#268bff' }]}>NAPISZ</Text>
                  </>
              }
            </TouchableOpacity>

            {/* Obserwuj */}
            <TouchableOpacity
              style={[s.friendBtn, { flex: 1, marginBottom: 0,
                backgroundColor: isFollowing ? '#4de92618' : '#ffffff08',
                borderColor:     isFollowing ? '#4de92640' : '#ffffff18',
              }]}
              onPress={handleFollowToggle}
              activeOpacity={0.8}
              disabled={followLoading}
            >
              {followLoading
                ? <ActivityIndicator size="small" color={isFollowing ? '#4de926' : '#ffffff60'} />
                : <>
                    <MaterialIcons
                      name={isFollowing ? 'visibility' : 'visibility-off'}
                      size={16}
                      color={isFollowing ? '#4de926' : '#ffffff60'}
                    />
                    <Text style={[s.friendBtnTxt, { color: isFollowing ? '#4de926' : '#ffffff60' }]}>
                      {isFollowing ? 'OBSERWUJESZ' : 'OBSERWUJ'}
                    </Text>
                  </>
              }
            </TouchableOpacity>
          </View>

          {/* ══ AUTA ══ */}
          <SectionHeader title="AUTA" count={cars.length} icon="directions-car" />
          {cars.length === 0
            ? <EmptyState text="Brak dodanych aut" />
            : cars.map(car => (
                <TouchableOpacity
                  key={car.id}
                  style={s.carRow}
                  onPress={() => router.push({ pathname: '/profile/car-detail', params: { id: String(car.id) } })}
                  activeOpacity={0.8}
                >
                  <View style={s.carThumb}>
                    {car.photos[0]
                      ? <Image source={{ uri: car.photos[0] }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      : <MaterialIcons name="directions-car" size={22} color={RED + '80'} />
                    }
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Text style={{ fontFamily: 'Orbitron', color: palette.text, fontSize: 13, fontWeight: '700' }}>{car.brand}</Text>
                      {car.isMain && (
                        <View style={{ backgroundColor: RED + '20', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: RED + '40' }}>
                          <Text style={{ fontFamily: 'Orbitron', color: RED, fontSize: 7 }}>GŁÓWNE</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontFamily: 'Orbitron', color: RED + 'aa', fontSize: 10 }}>{car.specs}</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={13} color="#ffffff20" />
                </TouchableOpacity>
              ))
          }

          {/* ══ OSIĄGNIĘCIA ══ */}
          <SectionHeader title="OSIĄGNIĘCIA" count={achievements.length} icon="emoji-events" color="#f5c518" />
          {achievements.length === 0
            ? <EmptyState text="Brak odblokowanych osiągnięć" />
            : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {achievements.map(a => (
                  <AchievementBox
                    key={a.key} icon={a.icon} label={a.label} active={a.active}
                    rarity={a.rarity} progress={a.progress} points={a.points}
                    description={a.description} category={a.category}
                    currentValue={a.currentValue} conditionValue={a.conditionValue}
                    conditionField={a.conditionField} unlockedAt={a.unlockedAt}
                  />
                ))}
              </View>
            )
          }

          {/* ══ SPOTY ══ */}
          <SectionHeader title="SPOTY" count={localSpots.length} icon="place" color="#4de926" />
          {localSpots.length === 0
            ? <EmptyState text="Brak dodanych spotów" />
            : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 16 }}>
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

        </Animated.View>
      </ScrollView>

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
function SectionHeader({ title, count, icon, color = '#e33835' }: {
  title: string; count: number; icon: string; color?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 28, marginBottom: 14 }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: color + '18', borderWidth: 1, borderColor: color + '35', alignItems: 'center', justifyContent: 'center' }}>
        <MaterialIcons name={icon as any} size={14} color={color} />
      </View>
      <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#fff', fontWeight: '700', flex: 1, letterSpacing: 1 }}>{title}</Text>
      <View style={{ backgroundColor: color + '18', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: color + '30' }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: color }}>{count}</Text>
      </View>
    </View>
  );
}

// ── EmptyState ────────────────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 20, marginBottom: 8 }}>
      <Text style={{ fontFamily: 'Orbitron', color: '#ffffff20', fontSize: 10 }}>{text}</Text>
    </View>
  );
}

// ── STYLES ────────────────────────────────────────────────
const s = StyleSheet.create({
  cTL: { position: 'absolute', top: 20, left: 20 },
  cTR: { position: 'absolute', top: 20, right: 20, alignItems: 'flex-end' },
  cH:  { width: 18, height: 2, backgroundColor: RED, opacity: 0.5 },
  cV:  { position: 'absolute', top: 0, left: 0, width: 2, height: 18, backgroundColor: RED, opacity: 0.5 },

  friendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#141414', borderRadius: 14, height: 50,
    borderWidth: 1, borderColor: '#ffffff12', marginBottom: 16,
  },
  friendBtnTxt: { fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' },

  carRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#141414', borderRadius: 16, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: '#ffffff0a',
  },
  carThumb: {
    width: 72, height: 72, borderRadius: 12,
    backgroundColor: '#1a0808', overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: RED + '20',
  },
});