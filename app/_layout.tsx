import { DarkTheme, DefaultTheme as NavLightTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { useFonts }   from 'expo-font';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar }  from 'expo-status-bar';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, StyleSheet, Animated, Easing,
  Dimensions, Text,
  Image,
  NativeModules,
  AppState,
  type AppStateStatus,
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
import { SettingsProvider, useSettings } from '../contexts/SettingsContext';
import { PremiumProvider } from '../contexts/PremiumContext';
import { StartupGatesProvider, useStartupGates } from '../contexts/StartupGatesContext';
import { API_URL } from '../constants/config';
import { BackgroundLocationDisclosureModal } from '../components/privacy/BackgroundLocationDisclosureModal';
import { UgcTermsGate } from '../components/ugc/UgcTermsGate';
import { UpdateModal } from '../components/modals/UpdateModal';
import { useAppUpdate } from '../hooks/useAppUpdate';
import {
  hasAcceptedBackgroundLocationDisclosure,
  requestBackgroundLocationPermissionAfterDisclosure,
} from '../lib/backgroundLocationConsent';
import { initMapbox } from '../lib/mapboxInit';
import { initNavDriveTraceStore } from '../lib/navDriveTraceStore';
import { useAppPresence } from '../hooks/useAppPresence';

/** Heartbeat lastSeen + polling licznika online dla zalogowanych użytkowników. */
function AppPresenceHeartbeat() {
  useAppPresence();
  return null;
}

SplashScreen.preventAutoHideAsync().catch(() => {});

const { width, height } = Dimensions.get('window');
const R = '#e33835';
const { UsersModule } = NativeModules;

/** Custom VROOM boot splash — keep short; native expo splash hides as soon as fonts load. */
const SPLASH_LOGO_MS = 320;
const SPLASH_CARD_DELAY_MS = 140;
const SPLASH_CARD_MS = 280;
const SPLASH_PROGRESS_MS = 1500;
const SPLASH_HOLD_MS = 1900;
const SPLASH_FADE_MS = 380;

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
const createToastConfig = (isDark: boolean) => {
  const bg = isDark ? '#141414' : '#ffffff';
  const textMain = isDark ? '#ffffff' : '#151515';
  const textSecondary = isDark ? '#ffffff70' : '#4a4a4a';
  return {
  success: (props: any) => (
    <BaseToast {...props}
      style={{ marginTop: 10, borderBottomColor: R, borderBottomWidth: 5, borderLeftWidth: 0, backgroundColor: bg, height: 70, zIndex: 999990, borderRadius: 12 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: textMain, fontSize: 13, fontFamily: 'OrbitronBold' }}
      text2Style={{ color: textSecondary, fontSize: 11, fontFamily: 'Orbitron' }}
      renderLeadingIcon={() => (
        <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
          <MaterialIcons name="check-circle" size={26} color={R} />
        </View>
      )}
    />
  ),
  info: (props: any) => (
    <BaseToast {...props}
      style={{ marginTop: 10, borderBottomColor: '#268bff', borderBottomWidth: 5, borderLeftWidth: 0, backgroundColor: bg, height: 70, zIndex: 999990, borderRadius: 12 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: textMain, fontSize: 13, fontFamily: 'OrbitronBold' }}
      text2Style={{ color: textSecondary, fontSize: 11, fontFamily: 'Orbitron' }}
      renderLeadingIcon={() => (
        <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
          <MaterialIcons name="info-outline" size={26} color="#268bff" />
        </View>
      )}
    />
  ),
  error: (props: any) => (
    <ErrorToast {...props}
      style={{ marginTop: 10, borderBottomColor: '#fa0400', borderBottomWidth: 5, borderLeftWidth: 0, backgroundColor: bg, height: 70, zIndex: 999990, borderRadius: 12 }}
      text1Style={{ color: textMain, fontSize: 13, fontFamily: 'OrbitronBold' }}
      text2Style={{ color: textSecondary, fontSize: 11, fontFamily: 'Orbitron' }}
      renderLeadingIcon={() => (
        <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
          <MaterialIcons name="error-outline" size={28} color="#fa0400" />
        </View>
      )}
    />
  ),
};
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
            <StartupGatesProvider>
              <RootLayoutInner />
            </StartupGatesProvider>
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
  const { updateSetting } = useSettings();
  const { gatesSettled, setGatesSettled, setLayoutGateOpen, homeOverlayOpen } = useStartupGates();
  const {
    updateAvailable,
    downloading: updateDownloading,
    downloadProgress,
    error: updateError,
    checkForUpdate,
    applyUpdate,
    dismiss: dismissUpdate,
  } = useAppUpdate();
  const router         = useRouter();
  const pathname       = usePathname();
  const [phase, setPhase] = useState<'splash' | 'fadeout' | 'done'>('splash');
  const [updatePromptVisible, setUpdatePromptVisible] = useState(false);
  const [ugcTermsVisible, setUgcTermsVisible] = useState(false);
  const [bgDisclosureVisible, setBgDisclosureVisible] = useState(false);
  const bgDisclosureDismissedRef = useRef(false);
  const bgDisclosureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapAfterUpdateRef = useRef<(() => Promise<void>) | null>(null);
  const bootstrapStartedRef = useRef(false);
  const updateDismissedRef = useRef(false);
  const lastForegroundUpdateCheckRef = useRef(0);

  const [loaded, error] = useFonts({
    Orbitron:     require('../assets/fonts/Orbitron/Orbitron-VariableFont_wght.ttf'),
    OrbitronBold: require('../assets/fonts/Orbitron/static/Orbitron-Bold.ttf'),
  });

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
  const lastNotifRouteRef = useRef<{ key: string; ts: number } | null>(null);

  useEffect(() => {
    initMapbox().catch(() => {});
    void initNavDriveTraceStore();
  }, []);

  useEffect(() => {
    if (!UsersModule?.saveAuthTokenForAuto) return;
    (async () => {
      try {
        const token =
          (await AsyncStorage.getItem('userToken')) ??
          (await AsyncStorage.getItem('token'));
        if (!token) return;
        UsersModule.saveAuthTokenForAuto(token);
      } catch {
      }
    })();
  }, [pathname]);

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
      const navKey = `${String(data.type)}:${String(data.conversationId ?? data.postId ?? data.clubId ?? data.spotId ?? data.carId ?? data.meetId ?? data.userId ?? 'none')}`;
      const now = Date.now();
      if (lastNotifRouteRef.current && lastNotifRouteRef.current.key === navKey && now - lastNotifRouteRef.current.ts < 2500) {
        console.log('[Notifications] Skip duplicate navigation:', navKey);
        return;
      }
      lastNotifRouteRef.current = { key: navKey, ts: now };

      setTimeout(async () => {
        let target: string | null = null;

        if (data.type === 'new_message' && data.conversationId) {
          target = `/Community/chats/${data.conversationId}`;
        } else if (data.type === 'market_message' && data.conversationId) {
          target = `/Community/market/chat/${data.conversationId}`;
        } else if (
          (data.type === 'like_post' ||
            data.type === 'comment_post' ||
            data.type === 'new_follow_post' ||
            data.type === 'mention_discussion' ||
            data.type === 'discussion_post_new') &&
          data.postId
        ) {
          await AsyncStorage.setItem('open_post_id', String(data.postId));
          target = `/Community/community/community`;
        } else if ((data.type === 'club_chat' || data.type === 'mention_club') && data.clubId) {
          const channelQuery = data.channelId ? `?channelId=${data.channelId}` : '';
          target = `/Community/clubs/${data.clubId}${channelQuery}`;
        } else if (data.type === 'mention_public_chat' || data.type === 'public_chat_message') {
          target = '/Community/public/public';
        } else if ((data.type === 'like_spot' || data.type === 'comment_spot') && data.spotId) {
          target = `/(tabs)/map`;
        } else if ((data.type === 'like_car' || data.type === 'comment_car') && data.carId) {
          target = `/(tabs)/account`;
        } else if (data.type === 'friend_request' || data.type === 'friend_accepted') {
          target = `/Community/chats/chats`;
        } else if (data.type === 'achievement') {
          target = `/(tabs)/account`;
        }

        if (target) {
          console.log('[Notifications] Navigate:', { type: data.type, target });
          router.push(target as any);
          return;
        }

        if ((data.type === 'meet_nearby_invite' || data.type === 'meet_joined') && data.meetId) {
          console.log('[Notifications] Navigate meet:', { type: data.type, meetId: data.meetId });
          router.push({ pathname: '/Community/meets/meet', params: { id: String(data.meetId) } } as any);
        }
      }, 350);
    } catch (e) { console.error('Navigation error:', e); }
  };

  useEffect(() => {
    if (!loaded && !error) return;

    SplashScreen.hideAsync();
    refreshUserData();

    // 1. Logo wpada
    Animated.parallel([
      Animated.timing(masterFade, { toValue: 1, duration: SPLASH_LOGO_MS, useNativeDriver: true }),
      Animated.spring(logoScale,  { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
      Animated.timing(logoFade,   { toValue: 1, duration: SPLASH_LOGO_MS + 60, useNativeDriver: true }),
    ]).start();

    // 2. Karta wjeżdża po chwili
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(cardFade,  { toValue: 1, duration: SPLASH_CARD_MS, useNativeDriver: true }),
        Animated.timing(cardSlide, { toValue: 0, duration: SPLASH_CARD_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }, SPLASH_CARD_DELAY_MS);

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
      toValue: 1, duration: SPLASH_PROGRESS_MS,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();

    // Znika
    const t = setTimeout(() => {
      setPhase('fadeout');
      Animated.timing(splashOpacity, {
        toValue: 0, duration: SPLASH_FADE_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start(() => setPhase('done'));
    }, SPLASH_HOLD_MS);

    return () => clearTimeout(t);
  }, [loaded, error]);

  useEffect(() => {
    setLayoutGateOpen(updatePromptVisible || ugcTermsVisible || bgDisclosureVisible);
  }, [updatePromptVisible, ugcTermsVisible, bgDisclosureVisible, setLayoutGateOpen]);

  const continueAppBootstrap = useCallback(async () => {
    const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
    if (!token) {
      setGatesSettled(true);
      return;
    }

    const needsUgc = await AsyncStorage.getItem('needsUgcTerms');
    if (needsUgc === '1') {
      setUgcTermsVisible(true);
      return;
    }
    setGatesSettled(true);
  }, [setGatesSettled]);

  useEffect(() => {
    bootstrapAfterUpdateRef.current = continueAppBootstrap;
  }, [continueAppBootstrap]);

  /** Po splash: sprawdź OTA → modal → dopiero regulamin / reszta (bez auto-apply). */
  useEffect(() => {
    if (!loaded && !error) return;
    if (phase !== 'done') return;
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;

    let cancelled = false;
    (async () => {
      const available = await checkForUpdate({ retries: 3 });
      if (cancelled) return;
      if (available) {
        setUpdatePromptVisible(true);
        return;
      }
      await bootstrapAfterUpdateRef.current?.();
    })().catch(() => {
      if (!cancelled) void bootstrapAfterUpdateRef.current?.();
    });

    return () => { cancelled = true; };
  }, [loaded, error, phase, checkForUpdate]);

  /** Ponowne sprawdzenie OTA po powrocie do apki (słaba sieć przy starcie, „Później” wcześniej). */
  useEffect(() => {
    if (phase !== 'done') return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (updatePromptVisible || updateDownloading) return;
      const now = Date.now();
      if (now - lastForegroundUpdateCheckRef.current < 45_000) return;
      lastForegroundUpdateCheckRef.current = now;
      void (async () => {
        const available = await checkForUpdate({ retries: 2 });
        if (available && !updateDismissedRef.current) {
          setUpdatePromptVisible(true);
        }
      })();
    });
    return () => sub.remove();
  }, [phase, checkForUpdate, updatePromptVisible, updateDownloading]);

  const handleUpdateLater = () => {
    updateDismissedRef.current = true;
    setUpdatePromptVisible(false);
    dismissUpdate();
    void bootstrapAfterUpdateRef.current?.();
  };

  const finishUgcTerms = async () => {
    await AsyncStorage.setItem('needsUgcTerms', '0');
    setUgcTermsVisible(false);
    setGatesSettled(true);
  };

  /** Zgoda na lokalizację w tle — dopiero po regulaminie, z opóźnieniem (nie koliduje z gift modalem). */
  useEffect(() => {
    if (phase !== 'done') return;
    if (!gatesSettled) return;
    if (pathname === '/login') return;
    if (ugcTermsVisible) return;
    if (homeOverlayOpen) return;

    if (bgDisclosureTimerRef.current) clearTimeout(bgDisclosureTimerRef.current);

    bgDisclosureTimerRef.current = setTimeout(() => {
      (async () => {
        const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
        if (!token) return;
        if (bgDisclosureDismissedRef.current) return;
        const accepted = await hasAcceptedBackgroundLocationDisclosure();
        if (!accepted) setBgDisclosureVisible(true);
      })().catch(() => {});
    }, 1200);

    return () => {
      if (bgDisclosureTimerRef.current) clearTimeout(bgDisclosureTimerRef.current);
    };
  }, [loaded, error, pathname, phase, ugcTermsVisible, gatesSettled, homeOverlayOpen]);

  const closeBgDisclosure = async () => {
    bgDisclosureDismissedRef.current = true;
    setBgDisclosureVisible(false);
    await updateSetting('backgroundTracking', false);
  };

  const acceptBgDisclosure = async () => {
    bgDisclosureDismissedRef.current = true;
    setBgDisclosureVisible(false);
    setTimeout(async () => {
      const granted = await requestBackgroundLocationPermissionAfterDisclosure();
      await updateSetting('backgroundTracking', granted);
      if (!granted) {
        (Toast as any).show({
          type: 'error',
          text1: 'Brak zgody systemu',
          text2: 'Włącz lokalizację w tle w ustawieniach telefonu',
        });
      }
    }, 350);
  };

  const spinDeg  = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const barWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const toastConfig = useMemo(() => createToastConfig(isDark), [isDark]);

  if (!loaded && !error) return null;

  return (
    <NavThemeProvider value={isDark ? DarkTheme : NavLightTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
        <Stack.Screen name="Community/clubs/[id]" />
        <Stack.Screen name="notifications" />
      </Stack>
      <AppPresenceHeartbeat />
      <StatusBar style={isDark ? 'light' : 'dark'} translucent={false} backgroundColor={isDark ? '#0a0a0a' : '#efefef'} />
      <Toast config={toastConfig} />
      <UpdateModal
        visible={updatePromptVisible && updateAvailable}
        loading={updateDownloading}
        progress={downloadProgress}
        error={updateError}
        onUpdate={applyUpdate}
        onDismiss={handleUpdateLater}
      />

      <UgcTermsGate visible={ugcTermsVisible} onAccepted={finishUgcTerms} />

      {bgDisclosureVisible && (
        <BackgroundLocationDisclosureModal
          visible
          onCancel={closeBgDisclosure}
          onAccept={acceptBgDisclosure}
        />
      )}

      {phase !== 'done' && (
        <Animated.View
          style={[s.splash, { opacity: splashOpacity }]}
          pointerEvents="none"
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
                <Text style={s.versionTxt}>V1.0.21</Text>
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