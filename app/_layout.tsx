import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { LinearGradient } from 'expo-linear-gradient';

import Toast, { BaseToast, ErrorToast } from 'react-native-toast-message';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

SplashScreen.preventAutoHideAsync().catch(() => {});

const { width } = Dimensions.get('window');

// ─── TOAST CONFIG ─────────────────────────────────────────
const toastConfig = {
  success: (props: any) => (
    <BaseToast
      {...props}
      style={{ marginTop: 10, borderBottomColor: '#e33835', borderBottomWidth: 5, borderLeftWidth: 0, backgroundColor: '#141414', height: 70, zIndex: 999990, borderRadius: 12 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: '#fff', fontSize: 13, fontFamily: 'OrbitronBold' }}
      text2Style={{ color: '#ffffff55', fontSize: 11, fontFamily: 'Orbitron' }}
      renderLeadingIcon={() => (
        <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
          <MaterialIcons name="check-circle" size={26} color="#e33835" />
        </View>
      )}
    />
  ),
  info: (props: any) => (
    <BaseToast
      {...props}
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
    <ErrorToast
      {...props}
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

// ─── ROOT ─────────────────────────────────────────────────
export default function RootLayout() {
  // 'splash'    = custom splash widoczny
  // 'fadeout'   = splash robi fade-out (apka już wyrenderowana pod spodem)
  // 'done'      = splash zniknął całkowicie
  const [phase, setPhase] = useState<'splash' | 'fadeout' | 'done'>('splash');

  const [loaded, error] = useFonts({
    Orbitron:     require('../assets/fonts/Orbitron/Orbitron-VariableFont_wght.ttf'),
    OrbitronBold: require('../assets/fonts/Orbitron/static/Orbitron-Bold.ttf'),
  });

  // Splash anims
  const spinAnim     = useRef(new Animated.Value(0)).current;
  const counterSpin  = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeIn       = useRef(new Animated.Value(0)).current;
  const titleScale   = useRef(new Animated.Value(0.85)).current;
  const pulseAnim    = useRef(new Animated.Value(1)).current;

  // Fade-out overlay
  const splashOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!loaded && !error) return;

    SplashScreen.hideAsync();

    // ── Wejście ──
    Animated.parallel([
      Animated.timing(fadeIn,     { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(titleScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
    ]).start();

    // ── Ringi ──
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true })
    ).start();
    Animated.loop(
      Animated.timing(counterSpin, { toValue: 1, duration: 5000, easing: Easing.linear, useNativeDriver: true })
    ).start();

    // ── Puls ──
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();

    // ── Progress ──
    Animated.timing(progressAnim, {
      toValue: 1, duration: 2800, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: false,
    }).start();

    // ── Po 3s → fade-out ──
    const fadeOutTimer = setTimeout(() => {
      setPhase('fadeout');
      Animated.timing(splashOpacity, {
        toValue: 0,
        duration: 700,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setPhase('done');
      });
    }, 4500);

    return () => clearTimeout(fadeOutTimer);
  }, [loaded, error]);

  const spinDeg    = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg',  '360deg'] });
  const counterDeg = counterSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });
  const barWidth   = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  if (!loaded && !error) return null;

  return (
    <ThemeProvider value={DarkTheme}>
      {/* ── APKA — zawsze wyrenderowana pod spodem ── */}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="light" />
      <Toast config={toastConfig} />

      {/* ── SPLASH OVERLAY — przykrywa apkę, potem znika ── */}
      {phase !== 'done' && (
        <Animated.View
          style={[s.splash, { opacity: splashOpacity }]}
          pointerEvents={phase === 'fadeout' ? 'none' : 'auto'}
        >
          <LinearGradient
            colors={['#180505', '#0f0303', '#0a0a0a']}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* BG BLOBS */}
          <View style={[s.blob, { top: -120, right: -80,  width: 320, height: 320, opacity: 0.12 }]} />
          <View style={[s.blob, { bottom: -80, left: -60, width: 220, height: 220, opacity: 0.07 }]} />

          <Animated.View style={{ opacity: fadeIn, alignItems: 'center', width: '100%' }}>

            {/* ── RINGS ── */}
            <View style={s.ringsContainer}>
              <Animated.View style={[s.ringOuter, { transform: [{ rotate: spinDeg }] }]}>
                <View style={s.ringDot} />
              </Animated.View>
              <Animated.View style={[s.ringInner, { transform: [{ rotate: counterDeg }] }]}>
                <View style={[s.ringDot, { backgroundColor: '#e3383560', width: 5, height: 5, top: -2.5 }]} />
                <View style={[s.ringDot, { backgroundColor: '#e3383560', width: 5, height: 5, bottom: -2.5, top: undefined, left: undefined, right: -2.5 }]} />
              </Animated.View>
              <Animated.View style={[s.iconCenter, { transform: [{ scale: pulseAnim }] }]}>
                <LinearGradient colors={['#2a0808', '#1a0404']} style={StyleSheet.absoluteFill} />
                <MaterialIcons name="speed" size={42} color="#e33835" />
              </Animated.View>
            </View>

            {/* ── TITLE ── */}
            <Animated.Text style={[s.title, { transform: [{ scale: titleScale }] }]}>
              VROOM
            </Animated.Text>
            <View style={s.titleUnderline} />
            <Animated.Text style={[s.subtitle, {
              opacity: progressAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
            }]}>
              INICJACJA SYSTEMÓW
            </Animated.Text>

            {/* ── STATUS ── */}
            <StatusLine />

            {/* ── PROGRESS BAR ── */}
            <View style={s.progressTrack}>
              <Animated.View style={[s.progressGlow, { width: barWidth }]} />
              <Animated.View style={[s.progressFill, { width: barWidth }]} />
              <Animated.View style={[s.progressDot,  { left: barWidth }]} />
            </View>

            {/* ── BOTTOM ── */}
            <View style={s.bottomRow}>
              <MaterialCommunityIcons name="shield-check-outline" size={11} color="#ffffff18" />
              <Animated.Text style={[s.versionTxt, {
                opacity: progressAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }),
              }]}>
                VROOM OS v1.0 · INICJOWANIE...
              </Animated.Text>
            </View>

          </Animated.View>
        </Animated.View>
      )}
    </ThemeProvider>
  );
}

// ─── STATUS LINE ──────────────────────────────────────────
const STATUS_LINES = [
  'ŁADOWANIE MODUŁÓW...',
  'SYNCHRONIZACJA GPS...',
  'ŁĄCZENIE Z SERWEREM...',
  'WERYFIKACJA SESJI...',
  'GOTOWY ✓',
];

function StatusLine() {
  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const iv = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
        setIdx(i => Math.min(i + 1, STATUS_LINES.length - 1));
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      });
    }, 560);
    return () => clearInterval(iv);
  }, []);

  return (
    <Animated.Text style={[s.statusLine, { opacity }]}>
      {STATUS_LINES[idx]}
    </Animated.Text>
  );
}

// ─── STYLES ───────────────────────────────────────────────
const R = '#e33835';

const s = StyleSheet.create({
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: R },

  ringsContainer: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  ringOuter: {
    position: 'absolute', width: 136, height: 136, borderRadius: 68,
    borderWidth: 1, borderColor: '#e3383540', borderStyle: 'dashed',
  },
  ringInner: {
    position: 'absolute', width: 108, height: 108, borderRadius: 54,
    borderWidth: 1, borderColor: '#e3383525',
  },
  ringDot: {
    position: 'absolute', top: -4, left: '50%',
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: R, marginLeft: -4,
  },
  iconCenter: {
    width: 88, height: 88, borderRadius: 44,
    borderWidth: 1, borderColor: '#e3383545',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },

  title: { fontFamily: 'OrbitronBold', fontSize: 42, color: '#fff', letterSpacing: 12, marginBottom: 8 },
  titleUnderline: { width: 60, height: 2, backgroundColor: R, marginBottom: 14, borderRadius: 1 },
  subtitle: { fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff35', letterSpacing: 5, marginBottom: 32 },
  statusLine: { fontFamily: 'Orbitron', fontSize: 9, color: '#e3383580', letterSpacing: 2, marginBottom: 14, height: 16 },

  progressTrack: {
    width: width * 0.65, height: 2,
    backgroundColor: '#ffffff08', borderRadius: 1,
    overflow: 'visible', position: 'relative', marginBottom: 32,
  },
  progressGlow: { position: 'absolute', height: 8, top: -3, left: 0, backgroundColor: R, opacity: 0.15, borderRadius: 4 },
  progressFill: { position: 'absolute', height: 2, left: 0, backgroundColor: R, borderRadius: 1 },
  progressDot:  { position: 'absolute', top: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: R, marginLeft: -4 },

  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  versionTxt: { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff18', letterSpacing: 1.5 },
});