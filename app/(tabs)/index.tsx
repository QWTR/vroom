import React, { useEffect, useState, useRef } from 'react';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator, Dimensions, Image, Modal, ScrollView,
  StyleSheet, TouchableOpacity, View, StatusBar,
  RefreshControl, Linking, Animated,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { usePremium } from '../../contexts/PremiumContext';
import { AnnouncementsModal } from '../../components/modals/AnnouncementsModal';
import { useAnnouncements } from '../../hooks/useAnnouncements';
import { usePolls }   from '../../hooks/usePolls';
import { useGifts }   from '../../hooks/useGifts';
import { PollModal }  from '../../components/modals/PollModal';
import { GiftModal }  from '../../components/modals/GiftModal';
import { useAppUpdate } from '../../hooks/useAppUpdate';
import { UpdateModal }  from '../../components/modals/UpdateModal';
import { AdBanner }     from '../../components/ads/AdBanner';
import { PartnerBannersSection } from '../../components/home/PartnerBannersSection';

const GOLD = '#FFD700';
const R    = '#e33835';

const { width, height } = Dimensions.get('window');

type MainCar     = { brand: string; specs: string; photo: string | null };
type Achievement = { type: string; label: string; unlockedAt: string };
type User = {
  username: string; email: string; userId: string;
  avatar?: string; bio?: string; location?: string; createdAt?: string;
  position: number; points: number;
  totalDistance: number; monthlyDistance: number; weeklyDistance: number; dailyDistance: number;
  topSpeed: number; avgSpeed: string | number; avgMaxSpeed: string | number;
  totalRides: number; monthlyRides: number;
  streak: number; meetCount: number; cityCount: number; carCount: number;
  mainCar?: MainCar | null; spotCount: number;
  achievementCount: number; latestAchievement?: Achievement | null;
};

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

async function fetchFreshUser(): Promise<User | null> {
  try {
    const token = await getToken();
    if (!token) return null;
    const meRes = await fetch(`${API_URL}/api/profile/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) return null;
    const fresh  = await meRes.json();
    const raw    = await AsyncStorage.getItem('user');
    if (!raw) return null;
    const old    = JSON.parse(raw);
    const merged = { ...old, ...fresh, avatar: fresh.avatarUrl ?? fresh.avatar ?? old.avatar ?? null };
    delete merged.avatarUrl;
    await AsyncStorage.setItem('user', JSON.stringify(merged));
    return merged;
  } catch { return null; }
}

export default function HomeScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { isPremium, getOfferings, purchasePremium, restorePurchases } = usePremium();
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [user,       setUser]       = useState<User | null>(null);
  const { unseenCount, load: loadAnnouncements } = useAnnouncements();
  const [showAnnouncements, setShowAnnouncements] = useState(false);

  const [showPremiumModal, setShowPremiumModal]   = useState(false);
  const [offerings,        setOfferings]          = useState<any>(null);
  const [loadingOffers,    setLoadingOffers]       = useState(false);
  const [buying,           setBuying]             = useState<string | null>(null);
  const [restoring,        setRestoring]          = useState(false);

  const [pollVisible,    setPollVisible]    = useState(false);
  const [giftVisible,    setGiftVisible]    = useState(false);
  const [currentGiftIdx, setCurrentGiftIdx] = useState(0);


  // Animacje
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const slideAnim  = useRef(new Animated.Value(40)).current;
  const scaleAnim  = useRef(new Animated.Value(0.92)).current;
  const pulseAnim  = useRef(new Animated.Value(1)).current;

  const pollRef  = useRef(poll);
  const votedRef = useRef(voted);

  useEffect(() => { loadAnnouncements(); }, []);

  const { poll, voted, fetchActivePoll, vote } = usePolls();
  const { gifts, fetchAvailableGifts, claimGift } = useGifts();

  const { updateAvailable, downloading, applyUpdate, dismiss } = useAppUpdate();

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 1800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const runEntrance = () => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 7,   useNativeDriver: true }),
    ]).start();
  };

  const loadUser = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) { router.replace('/login'); return; }
      const cached = JSON.parse(raw) as User;
      setUser(cached);
      setLoading(false);
      runEntrance();
      const fresh = await fetchFreshUser();
      if (fresh) setUser(fresh);
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD SESJI' });
      router.replace('/login');
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

  useEffect(() => { pollRef.current  = poll;  }, [poll]);
  useEffect(() => { votedRef.current = voted; }, [voted]);

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

  const onRefresh = () => { setRefreshing(true); loadUser(false); };

  const openPremiumModal = async () => {
    setShowPremiumModal(true);
    if (offerings) return;
    setLoadingOffers(true);
    try {
      const off = await getOfferings();
      setOfferings(off);
    } finally {
      setLoadingOffers(false);
    }
  };

  const handlePurchase = async (pkg: any) => {
    setBuying(pkg.identifier);
    const ok = await purchasePremium(pkg);
    setBuying(null);
    if (ok) {
      Toast.show({ type: 'success', text1: '🏆 VROOM PREMIUM aktywny!', text2: 'Ciesz się pełnymi możliwościami', visibilityTime: 3500 });
      setShowPremiumModal(false);
    } else {
      Toast.show({ type: 'error', text1: 'Zakup nie powiódł się', text2: 'Spróbuj ponownie.' });
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    const ok = await restorePurchases();
    setRestoring(false);
    if (ok) {
      Toast.show({ type: 'success', text1: 'Zakupy przywrócone!', text2: 'Premium aktywne ✓' });
      setShowPremiumModal(false);
    } else {
      Toast.show({ type: 'info', text1: 'Brak zakupów do przywrócenia', visibilityTime: 3000 });
    }
  };

  const t = theme;

  if (loading || !user) {
    return (
      <View style={{ flex: 1, backgroundColor: '#080808', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <MaterialCommunityIcons name="car-sports" size={52} color="#e33835" />
        </Animated.View>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 28, color: '#e33835', letterSpacing: 10, fontWeight: '900' }}>VROOM</Text>
        <ActivityIndicator size="small" color="#e3383560" style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e33835" colors={['#e33835']} />}
      >

        {/* ══════════════════════════════════════════════ */}
        {/* CINEMATIC HERO                                 */}
        {/* ══════════════════════════════════════════════ */}
        <View style={{ height: height * 0.42, position: 'relative', overflow: 'hidden' }}>
          {/* BG gradient */}
          <LinearGradient
            colors={isDark
              ? ['#1a0404', '#0d0d0d', '#080808']
              : ['#fce8e8', '#f5f5f5', t.bg]}
            start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* Decorative circles */}
          <View style={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, borderRadius: 160, backgroundColor: '#e3383508', borderWidth: 1, borderColor: '#e3383520' }} />
          <View style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: '#e3383512', borderWidth: 1, borderColor: '#e3383530' }} />
          <View style={{ position: 'absolute', bottom: -60, left: -60, width: 240, height: 240, borderRadius: 120, backgroundColor: '#e3383506' }} />

          {/* Scan line effect */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * (height * 0.42 / 10), height: 1, backgroundColor: isDark ? '#ffffff04' : '#00000004' }} />
            ))}
          </View>

          {/* TOP BAR */}
          <Animated.View style={{ opacity: fadeAnim, paddingTop: 58, paddingHorizontal: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* Logo */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ backgroundColor: '#e33835', borderRadius: 8, padding: 5 }}>
                <MaterialCommunityIcons name="car-sports" size={16} color="#fff" />
              </View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: t.text, fontWeight: '900', letterSpacing: 4 }}>VROOM</Text>
            </View>

            {/* Right side */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {/* Online pill */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#4de92612', borderWidth: 1, borderColor: '#4de92635', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}>
                <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#4de926', transform: [{ scale: pulseAnim }] }} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#4de926', letterSpacing: 2 }}>ONLINE</Text>
              </View>
              {/* Avatar */}
              <TouchableOpacity onPress={() => router.push('/account')}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.primaryBg, borderWidth: 2, borderColor: '#e33835', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
              >
                {user.avatar
                  ? <Image source={{ uri: user.avatar }} style={{ width: 40, height: 40 }} />
                  : <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: '#e33835', fontWeight: '900' }}>{user.username.charAt(0).toUpperCase()}</Text>
                }
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* MAIN HERO CONTENT — anchored to bottom */}
          <Animated.View style={{
            flex: 1, paddingHorizontal: 22, justifyContent: 'flex-end', paddingBottom: 48,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
          }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#e33835', letterSpacing: 4, marginBottom: 6 }}>WITAMY Z POWROTEM</Text>

            <Text style={{ fontFamily: 'Orbitron', fontSize: Math.min(42, width * 0.1), color: t.text, fontWeight: '900', letterSpacing: -1, lineHeight: Math.min(48, width * 0.115) }} numberOfLines={2}>
              {user.username}
            </Text>

            {user.mainCar && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383535', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 }}>
                <MaterialCommunityIcons name="car-sports" size={12} color="#e33835" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#e33835aa' }}>
                  {user.mainCar.brand} · {user.mainCar.specs}
                </Text>
              </View>
            )}

            {/* Quick stats row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <MaterialCommunityIcons name="road-variant" size={12} color={t.textDim} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: t.textDim }}>
                  <Text style={{ color: t.text, fontWeight: '700' }}>{Math.round(user.totalDistance)}</Text> km
                </Text>
              </View>
              <View style={{ width: 1, height: 10, backgroundColor: isDark ? '#ffffff20' : '#00000020' }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <MaterialCommunityIcons name="speedometer" size={12} color={t.textDim} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: t.textDim }}>
                  <Text style={{ color: t.text, fontWeight: '700' }}>{Math.round(user.topSpeed)}</Text> top
                </Text>
              </View>
              <View style={{ width: 1, height: 10, backgroundColor: isDark ? '#ffffff20' : '#00000020' }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <MaterialIcons name="route" size={12} color={t.textDim} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: t.textDim }}>
                  <Text style={{ color: t.text, fontWeight: '700' }}>{user.totalRides}</Text> tras
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Bottom fade */}
          <LinearGradient
            colors={['transparent', t.bg]}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60 }}
          />
        </View>

        {/* ══════════════════════════════════════════════ */}
        {/* PREMIUM BANNER / STATUS                       */}
        {/* ══════════════════════════════════════════════ */}
        <Animated.View style={{ opacity: fadeAnim, paddingHorizontal: 20, marginBottom: 20 }}>
          {isPremium ? (
            /* ── Premium aktywny — złoty status ── */
            <View style={{
              borderRadius: 18, borderWidth: 1, borderColor: `${GOLD}40`,
              padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
              overflow: 'hidden', backgroundColor: `${GOLD}08`,
            }}>
              <LinearGradient
                colors={[`${GOLD}18`, `${GOLD}06`, 'transparent']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={{ position: 'absolute', right: -20, top: -20, width: 100, height: 100, borderRadius: 50, backgroundColor: `${GOLD}08` }} />
              <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: `${GOLD}20`, borderWidth: 1, borderColor: `${GOLD}40`, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="workspace-premium" size={24} color={GOLD} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: GOLD, fontWeight: '700', marginBottom: 3 }}>VROOM PREMIUM AKTYWNY</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: `${GOLD}90` }}>Nieograniczony dostęp · Zero reklam · GPX export</Text>
              </View>
              <View style={{ backgroundColor: `${GOLD}15`, borderRadius: 10, padding: 8, borderWidth: 1, borderColor: `${GOLD}30` }}>
                <MaterialIcons name="check-circle" size={16} color={GOLD} />
              </View>
            </View>
          ) : (
            /* ── Promo — kup premium ── */
            <TouchableOpacity onPress={openPremiumModal} activeOpacity={0.85}>
              <LinearGradient
                colors={['#2a0f00', '#1a0a00', '#0e0808']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 18, borderWidth: 1, borderColor: `${GOLD}40`, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' }}
              >
                <View style={{ position: 'absolute', right: -20, top: -20, width: 120, height: 120, borderRadius: 60, backgroundColor: `${GOLD}08` }} />
                <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: `${GOLD}20`, borderWidth: 1, borderColor: `${GOLD}40`, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="workspace-premium" size={24} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#fff', fontWeight: '700', marginBottom: 3 }}>VROOM PREMIUM</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: `${GOLD}90` }}>Garaż · Trasy · Eksport GPX · Zero reklam</Text>
                </View>
                <View style={{ backgroundColor: `${GOLD}15`, borderRadius: 10, padding: 8, borderWidth: 1, borderColor: `${GOLD}40` }}>
                  <MaterialIcons name="arrow-forward-ios" size={13} color={GOLD} />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </Animated.View>

        {/* ══════════════════════════════════════════════ */}
        {/* SUPPORT BANNER                                 */}
        {/* ══════════════════════════════════════════════ */}
        <Animated.View style={{ opacity: fadeAnim, paddingHorizontal: 20, marginBottom: 20 }}>
          <TouchableOpacity onPress={() => Linking.openURL('https://buycoffee.to/vroom')} activeOpacity={0.85}>
            <LinearGradient
              colors={['#f5c51820', '#f5c51808', 'transparent']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ borderRadius: 18, borderWidth: 1, borderColor: '#f5c51840', padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' }}
            >
              <View style={{ position: 'absolute', left: -10, top: -10, width: 80, height: 80, borderRadius: 40, backgroundColor: '#f5c51808' }} />
              <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: '#f5c51820', borderWidth: 1, borderColor: '#f5c51840', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 22 }}>☕</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: t.text, fontWeight: '700', marginBottom: 3 }}>Postaw nam kawę</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim }}>Podoba Ci się VROOM? Wesprzyj projekt!</Text>
              </View>
              <View style={{ backgroundColor: '#f5c51815', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#f5c51835' }}>
                <MaterialIcons name="arrow-forward-ios" size={13} color="#f5c518" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>

        {/* ══════════════════════════════════════════════ */}
        {/* AD BANNER                                      */}
        {/* ══════════════════════════════════════════════ */}
        <Animated.View style={{ opacity: fadeAnim }}>
          <AdBanner
            BANNERID="ca-app-pub-1660420496578702/2956669151"
          />
        </Animated.View>

        {/* ══════════════════════════════════════════════ */}
        {/* QUICK NAV — DUŻE PRZYCISKI                    */}
        {/* ═════════════════════════���════════════════════ */}
        <Animated.View style={{ opacity: fadeAnim, paddingHorizontal: 20, marginBottom: 16 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim, letterSpacing: 4, marginBottom: 14 }}>SZYBKA NAWIGACJA</Text>

          {/* MAPA — duży przycisk */}
          <TouchableOpacity onPress={() => router.push('/map')} activeOpacity={0.85} style={{ marginBottom: 10 }}>
            <LinearGradient
              colors={['#e33835', '#c02020']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ borderRadius: 20, padding: 22, flexDirection: 'row', alignItems: 'center', gap: 16, overflow: 'hidden' }}
            >
              <View style={{ position: 'absolute', right: -20, top: -20, width: 130, height: 130, borderRadius: 65, backgroundColor: '#ffffff15' }} />
              <View style={{ position: 'absolute', right: 20, top: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: '#ffffff10' }} />
              <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="map" size={28} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: '#fff', fontWeight: '900', letterSpacing: 1 }}>MAPA </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff80', marginTop: 3 }}>Nawigacja · Live tracking · Trasy</Text>
              </View>
              <MaterialIcons name="arrow-forward-ios" size={18} color="#ffffff60" />
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
        {/* ══════════════════════════════════════════════ */}
        {/* ANNOUNCEMENTS BANNER                           */}
        {/* ══════════════════════════════════════════════ */}
        <Animated.View style={{ opacity: fadeAnim, paddingHorizontal: 20, marginBottom: 20 }}>
          <TouchableOpacity onPress={() => setShowAnnouncements(true)} activeOpacity={0.85}>
            <LinearGradient
              colors={isDark ? ['#1a0a1a', '#0f0f0f'] : ['#f8f0ff', '#f5f5f5']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 18, borderWidth: 1,
                borderColor: unseenCount > 0 ? '#a855f750' : t.border2,
                padding: 18, flexDirection: 'row', alignItems: 'center',
                gap: 14, overflow: 'hidden',
              }}
            >
              <View style={{ position: 'absolute', right: -20, top: -20, width: 100, height: 100, borderRadius: 50, backgroundColor: '#a855f710' }} />

              <View style={{
                width: 46, height: 46, borderRadius: 14,
                backgroundColor: '#a855f720', borderWidth: 1, borderColor: '#a855f740',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ fontSize: 22 }}>📢</Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: t.text, fontWeight: '700', marginBottom: 3 }}>
                  Ogłoszenia
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim }}>
                  Nowości · Aktualizacje · Eventy
                </Text>
              </View>

              {/* Badge z liczbą nieprzeczytanych */}
              {unseenCount > 0 && (
                <View style={{
                  backgroundColor: '#a855f7', borderRadius: 10,
                  paddingHorizontal: 8, paddingVertical: 4,
                  minWidth: 24, alignItems: 'center',
                }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#fff', fontWeight: '900' }}>
                    {unseenCount}
                  </Text>
                </View>
              )}

              <View style={{
                backgroundColor: '#a855f715', borderRadius: 10,
                padding: 8, borderWidth: 1, borderColor: '#a855f730',
              }}>
                <MaterialIcons name="arrow-forward-ios" size={13} color="#a855f7" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>

        {/* Modal ogłoszeń */}
        <AnnouncementsModal
          visible={showAnnouncements}
          onClose={() => setShowAnnouncements(false)}
        />

        {/* ══════════════════════════════════════════════ */}
        {/* PARTNER BANNERS                                */}
        {/* ══════════════════════════════════════════════ */}
        <PartnerBannersSection theme={t} isDark={isDark} fadeAnim={fadeAnim} />

        {/* ══════════════════════════════════════════════ */}
        {/* ACHIEVEMENT BANNER                             */}
        {/* ══════════════════════════════════════════════ */}
        {user.latestAchievement && (
          <Animated.View style={{ opacity: fadeAnim, paddingHorizontal: 20, marginBottom: 16 }}>
            <TouchableOpacity onPress={() => router.push('/account')} activeOpacity={0.85}>
              <LinearGradient
                colors={['#f5c51820', '#f5c51808', 'transparent']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 18, borderWidth: 1, borderColor: '#f5c51840', padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }}
              >
                <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: '#f5c51820', borderWidth: 2, borderColor: '#f5c51840', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="emoji-events" size={26} color="#f5c518" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#f5c518', letterSpacing: 3, marginBottom: 4 }}>OSTATNIE OSIĄGNIĘCIE</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: t.text, fontWeight: '700' }}>{user.latestAchievement.label}</Text>
                </View>
                <MaterialIcons name="arrow-forward-ios" size={14} color="#f5c51860" />
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* COMMUNITY + SPOTS BANNERS                      */}
        {/* ══════════════════════════════════════════════ */}
        <Animated.View style={{ opacity: fadeAnim, paddingHorizontal: 20, gap: 10, marginBottom: 16 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim, letterSpacing: 4, marginBottom: 4 }}>SPOŁECZNOŚĆ</Text>

          <TouchableOpacity onPress={() => router.push('/(tabs)/community')} activeOpacity={0.85}>
            <LinearGradient
              colors={['#268bff18', '#268bff08', 'transparent']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ borderRadius: 18, borderWidth: 1, borderColor: '#268bff30', padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' }}
            >
              <View style={{ position: 'absolute', right: -20, top: -20, width: 100, height: 100, borderRadius: 50, backgroundColor: '#268bff08' }} />
              <View style={{ width: 50, height: 50, borderRadius: 16, backgroundColor: '#268bff20', borderWidth: 1, borderColor: '#268bff40', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="chat-bubble-outline" size={24} color="#268bff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: t.text, fontWeight: '700', marginBottom: 3 }}>Czat & Znajomi</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim }}>Napisz do kogoś · Sprawdź co słychać</Text>
              </View>
              <View style={{ backgroundColor: '#268bff15', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#268bff30' }}>
                <MaterialIcons name="arrow-forward-ios" size={13} color="#268bff" />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/(tabs)/spotmap')} activeOpacity={0.85}>
            <View style={{ borderRadius: 18, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', right: -20, top: -20, width: 100, height: 100, borderRadius: 50, backgroundColor: isDark ? '#ffffff05' : '#00000005' }} />
              <View style={{ width: 50, height: 50, borderRadius: 16, backgroundColor: t.primaryBg, borderWidth: 1, borderColor: t.primaryBorder, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="place" size={24} color={t.primary ?? '#e33835'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: t.text, fontWeight: '700', marginBottom: 3 }}>Mapa Spotów</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim }}>Znajdź miejsca · Dodaj nowy spot</Text>
              </View>
              <View style={{ backgroundColor: t.surface, borderRadius: 10, padding: 8, borderWidth: 1, borderColor: t.border }}>
                <MaterialIcons name="arrow-forward-ios" size={13} color={t.textDim} />
              </View>
            </View>
          </TouchableOpacity>
        </Animated.View>



      </ScrollView>

      {poll && (
        <PollModal
          visible={pollVisible}
          poll={poll}
          onVote={async (optionIdx) => {       
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

      {/* ══════════════════════════════════════════════ */}
      {/* PREMIUM MODAL (bottom sheet)                   */}
      {/* ══════════════════════════════════════════════ */}
      <Modal
        visible={showPremiumModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPremiumModal(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowPremiumModal(false)} />
          <View style={{
            backgroundColor: '#0e0808',
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
            borderColor: `${GOLD}30`,
            maxHeight: '90%',
          }}>
            {/* Handle */}
            <View style={{ width: 40, height: 4, backgroundColor: `${GOLD}40`, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />

            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: `${GOLD}20`, borderWidth: 1, borderColor: `${GOLD}40`, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <MaterialIcons name="workspace-premium" size={20} color={GOLD} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: '#fff', fontWeight: '900', letterSpacing: 3 }}>VROOM PREMIUM</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: `${GOLD}80`, letterSpacing: 1 }}>Odblokuj pełne możliwości</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPremiumModal(false)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#ffffff10', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="close" size={18} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
              {/* Benefity */}
              <View style={{ backgroundColor: '#1a0a0a', borderRadius: 16, borderWidth: 1, borderColor: `${R}30`, padding: 16, marginBottom: 20, overflow: 'hidden' }}>
                <View style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: 50, backgroundColor: `${R}08` }} />
                {[
                  { icon: '🚗', text: 'Nieograniczony garaż',          sub: 'Free: max 3 auta' },
                  { icon: '🛣️', text: 'Nieograniczone prywatne trasy', sub: 'Free: max 5' },
                  { icon: '🏠', text: 'Nieograniczona liczba klubów',   sub: 'Free: 1 klub' },
                  { icon: '📊', text: 'Pełna historia aktywności',     sub: 'Free: 30 dni' },
                  { icon: '🛒', text: '5 ogłoszeń/mies + promowanie',  sub: 'Free: 1 ogłoszenie' },
                  { icon: '📤', text: 'Eksport GPX/CSV tras',          sub: '' },
                  { icon: '🗺️', text: 'Tryb prywatny na mapie',        sub: '' },
                  { icon: '🚫', text: 'Zero reklam',                   sub: '' },
                ].map((b, i, arr) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: '#ffffff08' }}>
                    <Text style={{ fontSize: 18, width: 26, textAlign: 'center' }}>{b.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#fff', fontWeight: '700' }}>{b.text}</Text>
                      {!!b.sub && <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#ffffff50', marginTop: 2 }}>{b.sub}</Text>}
                    </View>
                    <MaterialIcons name="check-circle" size={14} color={GOLD} />
                  </View>
                ))}
              </View>

              {/* Plany */}
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: R, letterSpacing: 4, textAlign: 'center', marginBottom: 14 }}>WYBIERZ PLAN</Text>

              {loadingOffers ? (
                <ActivityIndicator color={R} style={{ marginVertical: 24 }} />
              ) : (offerings?.current?.availablePackages ?? []).length > 0 ? (
                (offerings.current.availablePackages as any[]).map((pkg: any) => (
                  <TouchableOpacity
                    key={pkg.identifier}
                    style={{ borderRadius: 14, borderWidth: 1, borderColor: `${R}40`, padding: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden', backgroundColor: '#1a0404' }}
                    onPress={() => handlePurchase(pkg)}
                    activeOpacity={0.85}
                    disabled={buying !== null}
                  >
                    <LinearGradient colors={['#2a0707', '#1a0404']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '900', letterSpacing: 1, marginBottom: 3 }}>{pkg.product?.title ?? pkg.packageType}</Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff70' }}>{pkg.product?.priceString ?? '—'}</Text>
                    </View>
                    {buying === pkg.identifier
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <MaterialIcons name="arrow-forward-ios" size={16} color={R} />
                    }
                  </TouchableOpacity>
                ))
              ) : (
                /* Placeholder gdy brak ofert */
                <>
                  <TouchableOpacity style={{ borderRadius: 14, borderWidth: 1, borderColor: `${R}40`, padding: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' }} activeOpacity={0.85}>
                    <LinearGradient colors={['#2a0707', '#1a0404']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '900', letterSpacing: 1, marginBottom: 3 }}>PREMIUM MIESIĘCZNY</Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff70' }}>ok. 19,99 zł/mies</Text>
                    </View>
                    <MaterialIcons name="arrow-forward-ios" size={16} color={R} />
                  </TouchableOpacity>
                  <TouchableOpacity style={{ borderRadius: 14, borderWidth: 1, borderColor: `${GOLD}50`, padding: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' }} activeOpacity={0.85}>
                    <LinearGradient colors={['#3a0a0a', '#220505']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '900', letterSpacing: 1, marginBottom: 3 }}>PREMIUM ROCZNY</Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff70' }}>ok. 149,99 zł/rok · oszczędzasz 40%</Text>
                    </View>
                    <View style={{ backgroundColor: `${GOLD}20`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: `${GOLD}40` }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: GOLD, fontWeight: '900' }}>BEST</Text>
                    </View>
                  </TouchableOpacity>
                </>
              )}

              {/* Restore + full screen link */}
              <TouchableOpacity style={{ paddingVertical: 14, alignItems: 'center' }} onPress={handleRestore} activeOpacity={0.75} disabled={restoring}>
                {restoring
                  ? <ActivityIndicator color="#ffffff60" size="small" />
                  : <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff40', letterSpacing: 2 }}>PRZYWRÓĆ ZAKUPY</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity style={{ paddingVertical: 10, alignItems: 'center' }} onPress={() => { setShowPremiumModal(false); router.push('/premium' as any); }} activeOpacity={0.75}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: `${GOLD}60`, letterSpacing: 1 }}>WIĘCEJ SZCZEGÓŁÓW →</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── StatBigCard removed (no longer used)