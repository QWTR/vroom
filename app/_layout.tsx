import { DarkTheme, DefaultTheme as NavLightTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { useFonts }   from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { StatusBar }  from 'expo-status-bar';
import React, { useEffect, useState, useRef } from 'react';
import {
  View, StyleSheet, Animated, Easing,
  Dimensions, Text,
  Image,
} from 'react-native';
import * as SplashScreen    from 'expo-splash-screen';
import { LinearGradient }   from 'expo-linear-gradient';
import AsyncStorage         from '@react-native-async-storage/async-storage';
import * as Notifications   from 'expo-notifications';
import Toast, { BaseToast, ErrorToast } from 'react-native-toast-message';
import { SafeAreaProvider }      from 'react-native-safe-area-context';
import MaterialIcons             from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons    from '@expo/vector-icons/MaterialCommunityIcons';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { PremiumProvider, usePremium } from '../contexts/PremiumContext';
import { API_URL } from '../constants/config';
import MobileAds from 'react-native-google-mobile-ads';

SplashScreen.preventAutoHideAsync().catch(() => {});

const { width, height } = Dimensions.get('window');
const R = '#e33835';

// ─── NOTIFICATIONS ────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // Foreground: brak systemowych popupów/listy/dźwięku.
    shouldShowAlert: false, shouldPlaySound: false,
    shouldSetBadge: true, shouldShowBanner: false, shouldShowList: false,
  }),
});
Notifications.setNotificationChannelAsync('default', {
  name: 'Powiadomienia', importance: Notifications.AndroidImportance.MAX,
  sound: 'default', vibrationPattern: [0, 250, 250, 250],
  lightColor: R, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
});
Notifications.setNotificationChannelAsync('navigation', {
  name: 'Nawigacja', importance: Notifications.AndroidImportance.HIGH,
  sound: null, vibrationPattern: [0],
  lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, bypassDnd: true,
});

// ─── TOAST ────────────────────────────────────────────────
const toastConfig = {
  success: (props: any) => (
    <BaseToast {...props}
      style={{ marginTop: 10, borderBottomColor: R, borderBottomWidth: 5, borderLeftWidth: 0, backgroundColor: '#141414', height: 70, zIndex: 999990, borderRadius: 12 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: '#fff', fontSize: 13, fontFamily: 'OrbitronBold' }}
      text2Style={{ color: '#ffffff55', fontSize: 11, fontFamily: 'Orbitron' }}
      renderLeadingIcon={() => (
        <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
          <MaterialIcons name="check-circle" size={26} color={R} />
        </View>
      )}
    />
  ),
  info: (props: any) => (
    <BaseToast {...props}
      style={{ marginTop: 10, borderBottomColor: '#268bff', borderBottomWidth: 5, borderLeftWidth: 0, backgroundColor: '#141414', height: 70, zIndex: 999990, borderRadius: 12 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: '#fff', fontSize: 13, fontFamily: 'OrbitronBold' }}
      text2Style={{ color: '#ffffff55', fontSize: 11, fontFamily: 'Orbitron' }}
      renderLeadingIcon={() => (
        <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
          <MaterialIcons name="info-outline" size={26} color="#268bff" />
        </View>
      )}
    />
  ),
  error: (props: any) => (
    <ErrorToast {...props}
      style={{ marginTop: 10, borderBottomColor: '#fa0400', borderBottomWidth: 5, borderLeftWidth: 0, backgroundColor: '#141414', height: 70, zIndex: 999990, borderRadius: 12 }}
      text1Style={{ color: '#fff', fontSize: 13, fontFamily: 'OrbitronBold' }}
      text2Style={{ color: '#ffffff55', fontSize: 11, fontFamily: 'Orbitron' }}
      renderLeadingIcon={() => (
        <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
          <MaterialIcons name="error-outline" size={28} color="#fa0400" />
        </View>
      )}
    />
  ),
};

// ─── REFRESH USER ─────────────────────────────────────────
async function refreshUserData() {
  try {
    const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
    if (!token) return;
    const meRes = await fetch(`${API_URL}/api/profile/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meRes.ok) return;
    const fresh  = await meRes.json();
    const raw    = await AsyncStorage.getItem('user');
    if (!raw) return;
    const old    = JSON.parse(raw);
    const merged = { ...old, ...fresh, avatar: fresh.avatarUrl ?? fresh.avatar ?? old.avatar ?? null };
    delete merged.avatarUrl;
    await AsyncStorage.setItem('user', JSON.stringify(merged));
  } catch {}
}

// ─── ROOT ─────────────────────────────────────────────────
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SettingsProvider>
          <PremiumProvider>
            <RootLayoutInner />
          </PremiumProvider>
        </SettingsProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// ─── STATUS LINE ──────────────────────────────────────────
const STATUS_LINES = [
  'Ładowanie modułów',
  'Synchronizacja GPS',
  'Łączenie z serwerem',
  'Weryfikacja sesji',
  'Gotowy',
];

function StatusLine() {
  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const iv = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setIdx(i => Math.min(i + 1, STATUS_LINES.length - 1));
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, 700);
    return () => clearInterval(iv);
  }, []);

  const isDone = idx === STATUS_LINES.length - 1;

  return (
    <Animated.View style={[s.statusRow, { opacity }]}>
      <View style={[s.statusDot, isDone && { backgroundColor: '#4de926' }]} />
      <Text style={[s.statusTxt, isDone && { color: '#4de926' }]}>{STATUS_LINES[idx]}</Text>
    </Animated.View>
  );
}

// ─── INNER ────────────────────────────────────────────────
function RootLayoutInner() {
  const { isDark }     = useTheme();
  const { isPremium }  = usePremium();
  const router         = useRouter();
  const [phase, setPhase] = useState<'splash' | 'fadeout' | 'done'>('splash');
  const adsInitialized = useRef(false);

  const [loaded, error] = useFonts({
    Orbitron:     require('../assets/fonts/Orbitron/Orbitron-VariableFont_wght.ttf'),
    OrbitronBold: require('../assets/fonts/Orbitron/static/Orbitron-Bold.ttf'),
  });

  // Inicjalizacja MobileAds tylko dla użytkowników bez premium (tylko raz)
  useEffect(() => {
    if (!isPremium && !adsInitialized.current) {
      MobileAds().initialize().catch(() => {});
      adsInitialized.current = true;
    }
  }, [isPremium]);

  // Anim values
  const masterFade    = useRef(new Animated.Value(0)).current;
  const logoScale     = useRef(new Animated.Value(0.88)).current;
  const logoFade      = useRef(new Animated.Value(0)).current;
  const cardSlide     = useRef(new Animated.Value(28)).current;
  const cardFade      = useRef(new Animated.Value(0)).current;
  const progressAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim     = useRef(new Animated.Value(1)).current;
  const spinAnim      = useRef(new Animated.Value(0)).current;
  const splashOpacity = useRef(new Animated.Value(1)).current;

  const notifListener    = useRef<any>();
  const responseListener = useRef<any>();

  // Notifications
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response?.notification?.request?.content?.data) {
          handleNotificationNavigation(response.notification.request.content.data as any);
        }
      })
      .catch(() => {});

    notifListener.current = Notifications.addNotificationReceivedListener(notification => {
      // Foreground: nie pokazujemy toastów z pushy (żadnych popupów w trakcie używania appki).
      // Powiadomienia dalej zapisują się w bazie i są w centrum powiadomień in-app.
    });
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      handleNotificationNavigation(response.notification.request.content.data as any);
    });
    return () => { notifListener.current?.remove(); responseListener.current?.remove(); };
  }, []);

  const handleNotificationNavigation = async (data: any) => {
    if (!data?.type) return;
    try {
      setTimeout(async () => {
        if (data.type === 'new_message' && data.conversationId)
          router.push(`/Community/chats/${data.conversationId}` as any);
        else if (
          (data.type === 'like_post' ||
            data.type === 'comment_post' ||
            data.type === 'new_follow_post' ||
            data.type === 'mention_discussion') &&
          data.postId
        ) {
          await AsyncStorage.setItem('open_post_id', String(data.postId));
          router.push(`/Community/community/community` as any);
        } else if ((data.type === 'club_chat' || data.type === 'mention_club') && data.clubId) {
          const channelQuery = data.channelId ? `?channelId=${data.channelId}` : '';
          router.push(`/Community/clubs/${data.clubId}${channelQuery}` as any);
        } else if ((data.type === 'like_spot' || data.type === 'comment_spot') && data.spotId)
          router.push(`/(tabs)/map` as any);
        else if ((data.type === 'like_car' || data.type === 'comment_car') && data.carId)
          router.push(`(tabs)/account` as any);
        else if (data.type === 'friend_request' || data.type === 'friend_accepted')
          router.push(`/Community/chats` as any);
        else if (data.type === 'achievement')
          router.push(`/(tabs)/account` as any);
      }, 300);
    } catch (e) { console.error('Navigation error:', e); }
  };

  useEffect(() => {
    if (!loaded && !error) return;

    SplashScreen.hideAsync();
    refreshUserData();

    // 1. Logo wpada
    Animated.parallel([
      Animated.timing(masterFade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(logoScale,  { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(logoFade,   { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();

    // 2. Karta wjeżdża po chwili
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(cardFade,  { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(cardSlide, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }, 350);

    // Pulse ikony
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();

    // Spin pierścień
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true })
    ).start();

    // Pasek postępu
    Animated.timing(progressAnim, {
      toValue: 1, duration: 3400,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();

    // Znika
    const t = setTimeout(() => {
      setPhase('fadeout');
      Animated.timing(splashOpacity, {
        toValue: 0, duration: 750,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start(() => setPhase('done'));
    }, 4800);

    return () => clearTimeout(t);
  }, [loaded, error]);

  const spinDeg  = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const barWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  if (!loaded && !error) return null;

  return (
    <NavThemeProvider value={isDark ? DarkTheme : NavLightTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
        <Stack.Screen name="Community/clubs/[id]" />
      </Stack>
      <StatusBar style="light" translucent={false} backgroundColor="#0a0a0a" />
      <Toast config={toastConfig} />

      {phase !== 'done' && (
        <Animated.View
          style={[s.splash, { opacity: splashOpacity }]}
          pointerEvents={phase === 'fadeout' ? 'none' : 'auto'}
        >
          {/* ── Tło ── */}
          <LinearGradient
            colors={['#160303', '#0e0202', '#080808', '#050505']}
            start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* Dekoracyjne kółka — ten sam trick co w HomeScreen */}
          <View style={s.deco1} />
          <View style={s.deco2} />
          <View style={s.deco3} />

          {/* Subtelne poziome linie (jak w hero) */}
          {Array.from({ length: 10 }).map((_, i) => (
            <View key={i} style={[s.scanLine, { top: (height / 10) * i }]} />
          ))}

          <Animated.View style={[s.inner, { opacity: masterFade }]}>

            {/* ── LOGO AREA ── */}
            <Animated.View style={[s.logoWrap, { opacity: logoFade, transform: [{ scale: logoScale }] }]}>

              {/* Obracający się pierścień */}
              <Animated.View style={[s.ring, { transform: [{ rotate: spinDeg }] }]}>
                <View style={s.ringDot} />
                <View style={[s.ringDot, { top: undefined, bottom: -5 }]} />
              </Animated.View>

              {/* Ikona — styl identyczny z HomeScreen logo box */}
              <Animated.View style={[s.iconBox, { transform: [{ scale: pulseAnim }] }]}>
                <LinearGradient
                  colors={['#2a0707', '#160303', '#0a0a0a']}
                  style={StyleSheet.absoluteFill}
                />
                <Image
                    source={require('../assets/images/logotypRed.png')}
                    style={{ width: 54, height: 54, resizeMode: 'contain' }}
                  />
              {/* wewnętrzny blask */}
                <View style={s.iconGlow} />
              </Animated.View>
            </Animated.View>

            {/* ── TYTUŁ ── */}
            <Animated.Text style={[s.title, { opacity: logoFade }]}>
              VROOM
            </Animated.Text>
            <Animated.Text style={[s.subtitle, { opacity: logoFade }]}>
              AUTOMOTIVE OS
            </Animated.Text>

            {/* ── KARTA — styl 1:1 z kartami z HomeScreen ── */}
            <Animated.View style={[s.card, {
              opacity: cardFade,
              transform: [{ translateY: cardSlide }],
            }]}>
              <LinearGradient
                colors={['#1a0808', '#100404', '#0a0a0a']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              {/* dekoracja w rogu karty */}
              <View style={s.cardDeco1} />
              <View style={s.cardDeco2} />

              {/* Status */}
              <View style={s.cardTop}>
                <View style={s.cardLabel}>
                  <View style={s.cardLabelDot} />
                  <Text style={s.cardLabelTxt}>INICJALIZACJA</Text>
                </View>
                <StatusLine />
              </View>

              {/* Pasek postępu — ten sam look co w TopSpeed card */}
              <View style={s.progressTrack}>
                <Animated.View style={[s.progressFill, { width: barWidth }]}>
                  <LinearGradient
                    colors={[R, '#c02020']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                  {/* Świecący tip */}
                  <View style={s.progressTip} />
                </Animated.View>
              </View>

              {/* Bottom row */}
              <View style={s.cardBottom}>
                <View style={s.onlinePill}>
                  <MaterialCommunityIcons name="shield-check-outline" size={10} color={`${R}99`} />
                  <Text style={s.onlineTxt}>SECURE BOOT</Text>
                </View>
                <Text style={s.versionTxt}>v1.0</Text>
              </View>
            </Animated.View>

          </Animated.View>
        </Animated.View>
      )}
    </NavThemeProvider>
  );
}

// ─── STYLES ───────────────────────────────────────────────
const s = StyleSheet.create({
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#080808',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },

  // Dekoracje tła (identyczne proporcje jak w HomeScreen hero)
  deco1: {
    position: 'absolute', top: -100, right: -80,
    width: 380, height: 380, borderRadius: 190,
    backgroundColor: '#e3383506', borderWidth: 1, borderColor: '#e3383518',
  },
  deco2: {
    position: 'absolute', top: -50, right: -30,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: '#e3383510', borderWidth: 1, borderColor: '#e3383828',
  },
  deco3: {
    position: 'absolute', bottom: -80, left: -60,
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: '#e3383506',
  },
  scanLine: {
    position: 'absolute', left: 0, right: 0,
    height: 1, backgroundColor: '#ffffff04',
  },

  inner: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 28,
  },

  // Logo
  logoWrap: {
    width: 130, height: 130,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 28,
  },
  ring: {
    position: 'absolute',
    width: 128, height: 128, borderRadius: 64,
    borderWidth: 1, borderColor: '#e3383535',
    borderStyle: 'dashed',
  },
  ringDot: {
    position: 'absolute', top: -5, left: '50%',
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: R, marginLeft: -5,
  },
  iconBox: {
    width: 90, height: 90, borderRadius: 26,
    borderWidth: 1.5, borderColor: '#e3383545',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  iconGlow: {
    position: 'absolute',
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: R, opacity: 0.06,
  },

  // Tytuł
  title: {
    fontFamily: 'OrbitronBold',
    fontSize: 48, color: '#fff',
    letterSpacing: 14, marginBottom: 6,
  },
  subtitle: {
    fontFamily: 'Orbitron',
    fontSize: 9, color: '#ffffff30',
    letterSpacing: 5, marginBottom: 40,
  },

  // Karta — bliźniaczka kart z HomeScreen
  card: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1, borderColor: '#e3383535',
    padding: 20,
    overflow: 'hidden',
  },
  cardDeco1: {
    position: 'absolute', top: -30, right: -30,
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: '#e3383510',
  },
  cardDeco2: {
    position: 'absolute', top: -10, right: -10,
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: '#e3383518',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  cardLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
  },
  cardLabelDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: R,
  },
  cardLabelTxt: {
    fontFamily: 'Orbitron', fontSize: 8,
    color: '#e33835bb', letterSpacing: 3,
  },

  // Status row (prawa strona karty)
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  statusDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: R,
  },
  statusTxt: {
    fontFamily: 'Orbitron', fontSize: 8,
    color: '#ffffff55', letterSpacing: 1,
  },

  // Pasek postępu — styl jak w TopSpeed card
  progressTrack: {
    height: 4, backgroundColor: '#ffffff0d',
    borderRadius: 2, overflow: 'visible',
    marginBottom: 18,
  },
  progressFill: {
    position: 'absolute', left: 0, top: 0,
    height: 4, borderRadius: 2, overflow: 'hidden',
  },
  progressTip: {
    position: 'absolute', right: -1, top: -3,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#fff', opacity: 0.7,
  },

  // Dół karty
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  onlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#e3383512', borderWidth: 1,
    borderColor: '#e3383530', paddingHorizontal: 10,
    paddingVertical: 5, borderRadius: 20,
  },
  onlineTxt: {
    fontFamily: 'Orbitron', fontSize: 8,
    color: `${R}99`, letterSpacing: 2,
  },
  versionTxt: {
    fontFamily: 'Orbitron', fontSize: 8,
    color: '#ffffff20', letterSpacing: 2,
  },
});