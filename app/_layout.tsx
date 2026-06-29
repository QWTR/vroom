import { DarkTheme, DefaultTheme as NavLightTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { useFonts }   from 'expo-font';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar }  from 'expo-status-bar';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, StyleSheet, Animated, Easing,
  Text,
  Image,
  Dimensions,
  AppState,
  type AppStateStatus,
} from 'react-native';
import * as SplashScreen    from 'expo-splash-screen';
import { LinearGradient }   from 'expo-linear-gradient';
import AsyncStorage         from '@react-native-async-storage/async-storage';
import * as Notifications   from 'expo-notifications';
import Toast from 'react-native-toast-message';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons    from '@expo/vector-icons/MaterialCommunityIcons';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { SettingsProvider, useSettings } from '../contexts/SettingsContext';
import { PremiumProvider } from '../contexts/PremiumContext';
import { StartupGatesProvider, useStartupGates } from '../contexts/StartupGatesContext';
import { API_URL } from '../constants/config';
import { BackgroundLocationDisclosureModal } from '../components/privacy/BackgroundLocationDisclosureModal';
import { UgcTermsGate } from '../components/ugc/UgcTermsGate';
import { MaintenanceGate } from '../components/maintenance/MaintenanceGate';
import { UpdateModal } from '../components/modals/UpdateModal';
import { fetchMaintenanceStatus, shouldBlockApp } from '../lib/maintenance';
import { useAppUpdate } from '../hooks/useAppUpdate';
import {
  hasAcceptedBackgroundLocationDisclosure,
  requestBackgroundLocationPermissionAfterDisclosure,
} from '../lib/backgroundLocationConsent';
import { initMapbox } from '../lib/mapboxInit';
import { initNavDriveTraceStore } from '../lib/navDriveTraceStore';
import { vroomGpsLogPing } from '../lib/vroomGpsLog';
import { useAppPresence } from '../hooks/useAppPresence';
import { AdsConsentBootstrap } from '../components/ads/AdsConsentBootstrap';
import { createVroomToastConfig } from '../components/ui/VroomToastConfig';
import {
  setBgTrackingEndHandler,
  wireBgTrackingNotificationControl,
} from '../lib/bgTrackingNotificationControl';
import { stopVroomBgForegroundNotification } from '../lib/vroomBgForegroundService';
import { useAppAnimations } from '../hooks/useAppAnimations';
import { preloadAppAnimations } from '../lib/appAnimationPreload';
import type { AppAnimationSlot } from '../constants/appAnimations';
import { StaticHudGrid } from '../components/motion/vroomHudPrimitives';

/** Heartbeat lastSeen + polling licznika online dla zalogowanych użytkowników. */
function AppPresenceHeartbeat() {
  useAppPresence();
  return null;
}

SplashScreen.preventAutoHideAsync().catch(() => {});

const R = '#e33835';
const R_DARK = '#120202';
const R_LINE = 'rgba(227,56,53,0.72)';
const { width: WIN_W, height: WIN_H } = Dimensions.get('window');

/** Custom VROOM boot splash — keep short; native expo splash hides as soon as fonts load. */
const SPLASH_LOGO_MS = 320;
const SPLASH_CARD_DELAY_MS = 140;
const SPLASH_CARD_MS = 280;
const SPLASH_FADE_MS = 380;

const STARTUP_ANIMATION_SLOTS: AppAnimationSlot[] = [
  'home_streak',
  'home_premium_badge',
  'home_announcement',
  'community_daily_duel_vs',
  'community_quick_access',
  'community_module_icon',
  'tab_active_icon',
  'app_loading_logo',
  'screen_entrance_duel',
  'screen_entrance_grid',
  'screen_entrance_public',
  'screen_entrance_club',
  'screen_entrance_market',
  'screen_entrance_support',
  'achievement_unlock',
];

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

const CLEAN_STATUS_LINES = [
  'Ladowanie modulow',
  'Synchronizacja ustawien',
  'Laczenie z animacjami',
  'Przygotowanie Lottie',
  'Gotowy',
];
const BOOT_STATUS_LINES = CLEAN_STATUS_LINES.length === STATUS_LINES.length
  ? CLEAN_STATUS_LINES
  : STATUS_LINES;

function StatusLine({ label, done }: { label: string; done: boolean }) {
  const previousLabelRef = useRef(label);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (previousLabelRef.current === label) return;
    previousLabelRef.current = label;
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    });
  }, [label, opacity]);

  return (
    <Animated.View style={[s.statusRow, { opacity }]}>
      <View style={[s.statusDot, done && s.statusDotDone]} />
      <Text style={[s.statusTxt, done && s.statusTxtDone]}>
        {label.toUpperCase()}
      </Text>
    </Animated.View>
  );
}

// ─── INNER ────────────────────────────────────────────────
function RootLayoutInner() {
  const { isDark, theme } = useTheme();
  const { updateSetting, settings, loading: settingsLoading } = useSettings();
  const { gatesSettled, setGatesSettled, setLayoutGateOpen, homeOverlayOpen } = useStartupGates();
  const { animations: startupAnimations, loading: startupAnimationsLoading } = useAppAnimations(STARTUP_ANIMATION_SLOTS);
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
  const [maintenanceVisible, setMaintenanceVisible] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [ugcTermsVisible, setUgcTermsVisible] = useState(false);
  const [bgDisclosureVisible, setBgDisclosureVisible] = useState(false);
  const bgDisclosureDismissedRef = useRef(false);
  const bgDisclosureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapAfterUpdateRef = useRef<(() => Promise<void>) | null>(null);
  const bootstrapStartedRef = useRef(false);
  const splashStartedRef = useRef(false);
  const updateDismissedRef = useRef(false);
  const lastForegroundUpdateCheckRef = useRef(0);
  const [animationAssetsReady, setAnimationAssetsReady] = useState(false);

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
  const scanAnim      = useRef(new Animated.Value(0)).current;
  const laneAnim      = useRef(new Animated.Value(0)).current;
  const bootGlowAnim  = useRef(new Animated.Value(0)).current;
  const flickerAnim   = useRef(new Animated.Value(0)).current;
  const splashOpacity = useRef(new Animated.Value(1)).current;

  const notifListener    = useRef<any>(null);
  const responseListener = useRef<any>(null);
  const lastNotifRouteRef = useRef<{ key: string; ts: number } | null>(null);
  const bootReady = (loaded || !!error)
    && !settingsLoading
    && !startupAnimationsLoading
    && animationAssetsReady;
  const bootProgressTarget = useMemo(() => {
    if (!loaded && !error) return 0.06;
    if (settingsLoading) return 0.28;
    if (startupAnimationsLoading) return 0.58;
    if (!animationAssetsReady) return 0.82;
    return 1;
  }, [animationAssetsReady, error, loaded, settingsLoading, startupAnimationsLoading]);
  const bootStatusLabel = useMemo(() => {
    if (!loaded && !error) return BOOT_STATUS_LINES[0];
    if (settingsLoading) return BOOT_STATUS_LINES[1];
    if (startupAnimationsLoading) return BOOT_STATUS_LINES[2];
    if (!animationAssetsReady) return BOOT_STATUS_LINES[3];
    return BOOT_STATUS_LINES[4];
  }, [animationAssetsReady, error, loaded, settingsLoading, startupAnimationsLoading]);
  const startupAnimationAssets = useMemo(
    () => [
      ...startupAnimations,
      ...(settings.globalPremiumAnimations ?? []),
    ],
    [settings.globalPremiumAnimations, startupAnimations],
  );

  useEffect(() => {
    if (startupAnimationsLoading) {
      setAnimationAssetsReady(false);
      return undefined;
    }

    let cancelled = false;
    setAnimationAssetsReady(false);
    preloadAppAnimations(startupAnimationAssets)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAnimationAssetsReady(true);
      });

    return () => { cancelled = true; };
  }, [startupAnimationAssets, startupAnimationsLoading]);

  useEffect(() => {
    initMapbox().catch(() => {});
    void initNavDriveTraceStore();
    vroomGpsLogPing('app_layout_mount');
  }, []);

  useEffect(() => {
    setBgTrackingEndHandler(async () => {
      await stopVroomBgForegroundNotification();
      await updateSetting('backgroundTracking', false);
    });
    const unwire = wireBgTrackingNotificationControl();
    return () => {
      setBgTrackingEndHandler(null);
      unwire();
    };
  }, [updateSetting]);

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
    if (splashStartedRef.current) return;
    splashStartedRef.current = true;

    SplashScreen.hideAsync();
    refreshUserData();

    // 1. Logo wpada
    Animated.parallel([
      Animated.timing(masterFade, { toValue: 1, duration: SPLASH_LOGO_MS, useNativeDriver: true }),
      Animated.spring(logoScale,  { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
      Animated.timing(logoFade,   { toValue: 1, duration: SPLASH_LOGO_MS + 60, useNativeDriver: true }),
    ]).start();

    // 2. Karta wjeżdża po chwili
    const cardTimer = setTimeout(() => {
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

    Animated.loop(
      Animated.timing(scanAnim, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
    ).start();

    Animated.loop(
      Animated.timing(laneAnim, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true })
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(bootGlowAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bootGlowAnim, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(flickerAnim, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(flickerAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.delay(850),
      ])
    ).start();

    // Pasek postępu
    return () => clearTimeout(cardTimer);
  }, [
    bootGlowAnim,
    cardFade,
    cardSlide,
    error,
    flickerAnim,
    laneAnim,
    loaded,
    logoFade,
    logoScale,
    masterFade,
    progressAnim,
    pulseAnim,
    scanAnim,
    spinAnim,
    splashOpacity,
  ]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: bootProgressTarget,
      duration: bootProgressTarget >= 1 ? 260 : 420,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [bootProgressTarget, progressAnim]);

  useEffect(() => {
    if (!bootReady || phase !== 'splash') return;
    setPhase('fadeout');
    Animated.timing(splashOpacity, {
      toValue: 0,
      duration: SPLASH_FADE_MS,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(() => setPhase('done'));
  }, [bootReady, phase, splashOpacity]);

  useEffect(() => {
    setLayoutGateOpen(
      updatePromptVisible || maintenanceVisible || ugcTermsVisible || bgDisclosureVisible,
    );
  }, [updatePromptVisible, maintenanceVisible, ugcTermsVisible, bgDisclosureVisible, setLayoutGateOpen]);

  const continueAfterMaintenance = useCallback(async () => {
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

  const continueAppBootstrap = useCallback(async () => {
    try {
      const status = await fetchMaintenanceStatus();
      if (shouldBlockApp(status)) {
        setMaintenanceMessage(status.message);
        setMaintenanceVisible(true);
        return;
      }
      setMaintenanceVisible(false);
    } catch {
      setMaintenanceVisible(false);
    }
    await continueAfterMaintenance();
  }, [continueAfterMaintenance]);

  const handleMaintenanceCleared = useCallback(() => {
    setMaintenanceVisible(false);
    void continueAfterMaintenance();
  }, [continueAfterMaintenance]);

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
        if (maintenanceVisible) {
          const status = await fetchMaintenanceStatus();
          if (!shouldBlockApp(status)) {
            handleMaintenanceCleared();
          }
          return;
        }
        const status = await fetchMaintenanceStatus();
        if (shouldBlockApp(status)) {
          setMaintenanceMessage(status.message);
          setMaintenanceVisible(true);
          setGatesSettled(false);
          return;
        }
        const available = await checkForUpdate({ retries: 2 });
        if (available && !updateDismissedRef.current) {
          setUpdatePromptVisible(true);
        }
      })();
    });
    return () => sub.remove();
  }, [
    phase,
    checkForUpdate,
    updatePromptVisible,
    updateDownloading,
    maintenanceVisible,
    handleMaintenanceCleared,
    setGatesSettled,
  ]);

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
    if (maintenanceVisible) return;
    if (ugcTermsVisible) return;
    if (homeOverlayOpen) return;

    if (bgDisclosureTimerRef.current) clearTimeout(bgDisclosureTimerRef.current);

    bgDisclosureTimerRef.current = setTimeout(() => {
      (async () => {
        const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
        if (!token) return;
        if (bgDisclosureDismissedRef.current) return;
        if (!settings.isPremium) return;
        const accepted = await hasAcceptedBackgroundLocationDisclosure();
        if (!accepted) setBgDisclosureVisible(true);
      })().catch(() => {});
    }, 1200);

    return () => {
      if (bgDisclosureTimerRef.current) clearTimeout(bgDisclosureTimerRef.current);
    };
  }, [loaded, error, pathname, phase, maintenanceVisible, ugcTermsVisible, gatesSettled, homeOverlayOpen, settings.isPremium]);

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
      if (!granted) {
        (Toast as any).show({
          type: 'error',
          text1: 'Brak zgody systemu',
          text2: 'Włącz lokalizację w tle w ustawieniach telefonu',
        });
      }
    }, 350);
  };

  const insets = useSafeAreaInsets();
  const barWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const spinDeg = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scanY = scanAnim.interpolate({ inputRange: [0, 1], outputRange: [-120, WIN_H + 120] });
  const laneX = laneAnim.interpolate({ inputRange: [0, 1], outputRange: [-WIN_W * 0.8, WIN_W * 1.2] });
  const laneXReverse = laneAnim.interpolate({ inputRange: [0, 1], outputRange: [WIN_W * 1.2, -WIN_W * 0.8] });
  const bootGlowScale = bootGlowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.18] });
  const bootGlowOpacity = bootGlowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.82] });
  const flickerOpacity = flickerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.02, 0.16] });
  const toastConfig = useMemo(() => createVroomToastConfig(isDark), [isDark]);

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
      <AdsConsentBootstrap />
      <StatusBar style={isDark ? 'light' : 'dark'} translucent={false} backgroundColor={theme.bg} />
      <Toast config={toastConfig} topOffset={insets.top + 8} visibilityTime={4000} />
      <UpdateModal
        visible={updatePromptVisible && updateAvailable}
        loading={updateDownloading}
        progress={downloadProgress}
        error={updateError}
        onUpdate={applyUpdate}
        onDismiss={handleUpdateLater}
      />

      <MaintenanceGate
        visible={maintenanceVisible}
        message={maintenanceMessage}
        onCleared={handleMaintenanceCleared}
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
          style={[s.splash, { opacity: splashOpacity, backgroundColor: '#000000' }]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={['#000000', R_DARK, '#050101', '#000000']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, opacity: masterFade }}>
            <StaticHudGrid isDark primary={R} opacity={0.85} />
          </Animated.View>

          {[0, 1].map(i => (
            <Animated.View
              key={`lane-${i}`}
              pointerEvents="none"
              style={[
                s.bootLane,
                {
                  top: `${24 + i * 22}%` as `${number}%`,
                  width: 190 + (i % 2) * 70,
                  opacity: masterFade.interpolate({ inputRange: [0, 1], outputRange: [0, i % 2 ? 0.14 : 0.24] }),
                  transform: [
                    { translateX: i % 2 ? laneXReverse : laneX },
                    { rotate: i % 2 ? '13deg' : '-13deg' },
                  ],
                },
              ]}
            >
              <LinearGradient
                colors={i % 2 ? ['rgba(255,255,255,0.20)', R_LINE, 'transparent'] : ['transparent', R, 'rgba(255,255,255,0.18)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          ))}

          <Animated.View pointerEvents="none" style={[s.bootScan, { opacity: masterFade, transform: [{ translateY: scanY }] }]}>
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.08)', 'rgba(227,56,53,0.46)', 'transparent']}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: R, opacity: flickerOpacity }]} />

          <Animated.View style={[s.inner, { opacity: masterFade }]}>

            <Animated.View style={[s.logoWrap, { opacity: logoFade, transform: [{ scale: logoScale }] }]}>
              <Animated.View style={[s.outerRing, { opacity: bootGlowOpacity, transform: [{ rotate: spinDeg }, { scale: bootGlowScale }] }]} />
              <Animated.View style={[s.innerRing, { opacity: bootGlowOpacity, transform: [{ rotate: spinDeg }] }]} />
              <Animated.View style={[s.iconBox, { transform: [{ scale: pulseAnim }] }]}>
                <LinearGradient
                  colors={['rgba(255,255,255,0.10)', 'rgba(227,56,53,0.14)', 'rgba(0,0,0,0.08)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <View style={s.iconBoxInner} />
                <Image
                  source={require('../assets/images/logotypRed.png')}
                  style={s.logoImg}
                />
              </Animated.View>
            </Animated.View>

            <Animated.Text style={[s.title, { opacity: logoFade }]}>
              VROOM
            </Animated.Text>
            <Animated.Text style={[s.subtitle, { opacity: logoFade }]}>
              VROOM SYSTEM
            </Animated.Text>
            <Animated.View style={[s.titleAccent, { opacity: logoFade }]} />

            <Animated.View style={[s.hudPanel, {
              opacity: cardFade,
              transform: [{ translateY: cardSlide }],
            }]}>
              <View style={s.hudTop}>
                <Text style={s.hudLabel}>INICJALIZACJA</Text>
                <StatusLine label={bootStatusLabel} done={bootReady} />
              </View>

              <View style={s.progressTrack}>
                <Animated.View style={[s.progressFill, { width: barWidth }]}>
                  <View style={s.progressTip} />
                </Animated.View>
              </View>

              <View style={s.hudBottom}>
                <View style={s.secureRow}>
                  <MaterialCommunityIcons name="shield-check-outline" size={11} color="rgba(227, 56, 53, 0.8)" />
                  <Text style={s.secureTxt}>SECURE BOOT</Text>
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
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  bootGrid: {
    ...StyleSheet.absoluteFillObject,
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(227,56,53,0.8)',
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(227,56,53,0.24)',
  },
  bootLane: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  bootScan: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 96,
  },

  inner: {
    width: '100%',
    alignItems: 'center',
  },

  logoWrap: {
    width: 152,
    height: 152,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  outerRing: {
    position: 'absolute',
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 2,
    borderColor: 'rgba(227,56,53,0.72)',
    borderLeftColor: 'rgba(255,255,255,0.18)',
    borderBottomColor: 'rgba(227,56,53,0.22)',
    shadowColor: R,
    shadowOpacity: 0.85,
    shadowRadius: 22,
  },
  innerRing: {
    position: 'absolute',
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 1,
    borderColor: 'rgba(227,56,53,0.32)',
    borderRightColor: 'rgba(255,255,255,0.28)',
  },
  iconBox: {
    width: 96,
    height: 96,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(227, 56, 53, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 0, 0, 0.85)',
    shadowColor: '#e33835',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 35,
    elevation: 15,
    overflow: 'hidden',
  },
  iconBoxInner: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    backgroundColor: 'rgba(227, 56, 53, 0.08)',
  },
  logoImg: {
    width: 54,
    height: 54,
    resizeMode: 'contain',
  },

  title: {
    fontFamily: 'OrbitronBold',
    fontSize: 50,
    color: '#ffffff',
    letterSpacing: 14,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: 'Orbitron',
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 6,
  },
  titleAccent: {
    width: 120,
    height: 1,
    backgroundColor: '#e33835',
    opacity: 0.5,
    marginTop: 10,
    marginBottom: 36,
  },

  hudPanel: {
    alignSelf: 'stretch',
    marginHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.36)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(227, 56, 53, 0.3)',
    paddingVertical: 18,
    paddingHorizontal: 10,
    shadowColor: R,
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  hudTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  hudLabel: {
    fontFamily: 'Orbitron',
    fontSize: 9,
    color: 'rgba(227, 56, 53, 0.8)',
    letterSpacing: 4,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 4,
    height: 4,
    borderRadius: 0,
    backgroundColor: 'rgba(227, 56, 53, 0.6)',
  },
  statusDotDone: {
    backgroundColor: '#ffffff',
  },
  statusTxt: {
    fontFamily: 'Orbitron',
    fontSize: 7,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 2,
  },
  statusTxtDone: {
    color: '#ffffff',
  },

  progressTrack: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 0,
    overflow: 'visible',
    marginBottom: 16,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 8,
    backgroundColor: R,
    borderRadius: 0,
    overflow: 'visible',
    shadowColor: '#ff0000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 15,
    elevation: 10,
  },
  progressTip: {
    position: 'absolute',
    right: -2,
    top: -4,
    width: 4,
    height: 14,
    backgroundColor: '#fff',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 8,
  },

  hudBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secureTxt: {
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: 'rgba(227, 56, 53, 0.8)',
    letterSpacing: 4,
  },
  versionTxt: {
    fontFamily: 'Orbitron',
    fontSize: 7,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 3,
  },
});
