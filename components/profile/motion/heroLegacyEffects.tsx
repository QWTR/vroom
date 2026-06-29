/**
 * Legacy hero motion effects — Reanimated v3 (no Skia dependency).
 * Used for motions that don't require Skia: prism, matrix, storm, hologram, neon-grid.
 */
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { ProfileHeroMotion } from '../../../constants/profilePremiumExtras';

const SCREEN_W = Dimensions.get('window').width;

const LEGACY = new Set<ProfileHeroMotion>(['prism', 'matrix', 'storm', 'hologram', 'neon-grid']);

export function isLegacyHeroMotion(motion: ProfileHeroMotion | undefined): boolean {
  return !!motion && LEGACY.has(motion);
}

// ─── PRISM ────────────────────────────────────────────────────────
// Six neon beams rotate like a lighthouse — very visible.
function PrismEffect({ width }: { width: number }) {
  const spin = useSharedValue(0);
  const pulse = useSharedValue(0.6);

  useEffect(() => {
    spin.value  = withRepeat(withTiming(360, { duration: 8000, easing: Easing.linear }), -1, false);
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [spin, pulse]);

  const rotStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + pulse.value * 0.35,
  }));

  const beamLength = width * 0.7;
  const BEAM_COLORS = ['#ff0044', '#FFD700', '#00ff88', '#38bdf8', '#a855f7', '#ff8c42'];

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
    >
      <Animated.View style={[{ position: 'absolute', width: 0, height: 0 }, rotStyle, pulseStyle]}>
        {BEAM_COLORS.map((color, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: 4,
              height: beamLength,
              borderRadius: 2,
              marginLeft: -2,
              marginTop: -beamLength,
              backgroundColor: color,
              opacity: 0.85,
              shadowColor: color,
              shadowOpacity: 1,
              shadowRadius: 12,
              transform: [{ rotate: `${i * 60}deg` }],
            }}
          />
        ))}
      </Animated.View>
      {/* Central glow */}
      <Animated.View
        style={[{
          position: 'absolute',
          width: 90,
          height: 90,
          borderRadius: 45,
          backgroundColor: '#ffffff22',
          shadowColor: '#FFD700',
          shadowOpacity: 1,
          shadowRadius: 30,
        }, pulseStyle]}
      />
    </Animated.View>
  );
}

// ─── MATRIX ───────────────────────────────────────────────────────
// 14 bright green code columns cascade — The Matrix, but neon.
const MATRIX_COLS = [...Array(14)].map((_, i) => ({
  key:   i,
  left:  `${3 + i * 6.8}%` as `${number}%`,
  delay: i * 160,
  h:     40 + (i % 5) * 18,
  speed: 900 + (i % 4) * 200,
}));

function MatrixColumn({ col }: { col: typeof MATRIX_COLS[0] }) {
  const y = useSharedValue(-col.h);
  const op = useSharedValue(0);

  useEffect(() => {
    const loop = () => {
      y.value  = -col.h;
      op.value = 0;
      y.value  = withDelay(col.delay, withTiming(220, { duration: col.speed, easing: Easing.linear }));
      op.value = withDelay(col.delay, withSequence(
        withTiming(1,   { duration: 80 }),
        withTiming(0.8, { duration: col.speed - 200 }),
        withTiming(0,   { duration: 120 }),
      ));
    };
    loop();
    const id = setInterval(loop, col.speed + col.delay + 400);
    return () => clearInterval(id);
  }, [col, y, op]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity:   op.value,
  }));

  return (
    <Animated.View style={[{
      position:        'absolute',
      left:            col.left,
      top:             0,
      width:           3,
      height:          col.h,
      backgroundColor: '#4de926',
      borderRadius:    2,
      shadowColor:     '#4de926',
      shadowOpacity:   1,
      shadowRadius:    8,
    }, style]} />
  );
}

function MatrixEffect() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {MATRIX_COLS.map(col => <MatrixColumn key={col.key} col={col} />)}
      {/* Green overlay tint */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#001a0033' }]} />
    </View>
  );
}

// ─── STORM ────────────────────────────────────────────────────────
// Dark clouds drift + 22 diagonal rain drops + lightning flashes.
const STORM_DROPS = [...Array(22)].map((_, i) => ({
  key:   i,
  left:  `${(i * 18 + 5) % 96}%` as `${number}%`,
  delay: (i % 7) * 95,
  h:     18 + (i % 6) * 10,
  speed: 500 + (i % 5) * 80,
}));

function StormDrop({ drop }: { drop: typeof STORM_DROPS[0] }) {
  const y  = useSharedValue(-drop.h);
  const op = useSharedValue(0);

  useEffect(() => {
    const loop = () => {
      y.value  = -drop.h;
      op.value = 0;
      y.value  = withDelay(drop.delay, withTiming(250, { duration: drop.speed, easing: Easing.linear }));
      op.value = withDelay(drop.delay, withSequence(
        withTiming(0.9, { duration: 60 }),
        withTiming(0.6, { duration: drop.speed - 80 }),
        withTiming(0,   { duration: 80 }),
      ));
    };
    loop();
    const id = setInterval(loop, drop.speed + drop.delay + 200);
    return () => clearInterval(id);
  }, [drop, y, op]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { rotate: '14deg' }],
    opacity:   op.value,
  }));

  return (
    <Animated.View style={[{
      position:        'absolute',
      left:            drop.left,
      top:             0,
      width:           2,
      height:          drop.h,
      backgroundColor: '#88ccff',
      borderRadius:    1,
      shadowColor:     '#88ccff',
      shadowOpacity:   0.8,
      shadowRadius:    4,
    }, style]} />
  );
}

function StormEffect({ width }: { width: number }) {
  const cloudX  = useSharedValue(-width * 0.2);
  const flash   = useSharedValue(0);

  useEffect(() => {
    cloudX.value = withRepeat(
      withSequence(
        withTiming(width * 0.15, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
        withTiming(-width * 0.2, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
      ), -1, false,
    );
    const doFlash = () => {
      flash.value = withSequence(
        withTiming(1,   { duration: 50 }),
        withTiming(0.3, { duration: 80 }),
        withTiming(0.8, { duration: 40 }),
        withTiming(0,   { duration: 300 }),
      );
    };
    doFlash();
    const id = setInterval(doFlash, 3500 + Math.random() * 2000);
    return () => clearInterval(id);
  }, [cloudX, flash, width]);

  const cloudStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cloudX.value }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Cloud layer */}
      <Animated.View style={[{
        position: 'absolute', top: 0, left: 0,
        width: width * 1.5, height: '55%', opacity: 0.55,
      }, cloudStyle]}>
        <LinearGradient colors={['#0a0a20ee', '#1a1a4488', 'transparent']} style={{ flex: 1 }} />
      </Animated.View>
      {/* Rain */}
      {STORM_DROPS.map(d => <StormDrop key={d.key} drop={d} />)}
      {/* Lightning flash */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#cce6ff' }, flashStyle]} pointerEvents="none" />
    </View>
  );
}

// ─── HOLOGRAM ─────────────────────────────────────────────────────
// Sci-fi hologram scanline + cyan shimmer flicker.
function HologramEffect() {
  const scan     = useSharedValue(0);
  const flicker  = useSharedValue(0.15);
  const shift    = useSharedValue(0);

  useEffect(() => {
    scan.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.linear }), -1, false);
    flicker.value = withRepeat(
      withSequence(
        withTiming(0.6,  { duration: 80  }),
        withTiming(0.15, { duration: 120 }),
        withTiming(0.5,  { duration: 60  }),
        withTiming(0.1,  { duration: 80  }),
        withTiming(0.45, { duration: 100 }),
        withTiming(0.15, { duration: 600 }),
      ), -1, false,
    );
    shift.value = withRepeat(
      withSequence(
        withTiming(6,  { duration: 70 }),
        withTiming(-4, { duration: 50 }),
        withTiming(0,  { duration: 60 }),
        withTiming(0,  { duration: 800 }),
      ), -1, false,
    );
  }, [scan, flicker, shift]);

  const scanStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scan.value * 290 - 8 }],
  }));
  const bgStyle    = useAnimatedStyle(() => ({ opacity: flicker.value }));
  const shiftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#38bdf828' }, bgStyle]} />
      {/* Scan line */}
      <Animated.View style={[{
        position: 'absolute', left: 0, right: 0, height: 5,
        backgroundColor: '#38bdf8cc',
        shadowColor: '#38bdf8', shadowOpacity: 1, shadowRadius: 10,
      }, scanStyle]} />
      {/* RGB shift ghost */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#ff004418' }, shiftStyle]} />
      {/* Grid lines */}
      {[0.2, 0.4, 0.6, 0.8].map(f => (
        <View key={f} style={{
          position: 'absolute', left: 0, right: 0,
          top: `${f * 100}%` as `${number}%`,
          height: 1, backgroundColor: '#38bdf822',
        }} />
      ))}
    </View>
  );
}

// ─── NEON-GRID ────────────────────────────────────────────────────
// Vanishing-point perspective grid pulses upward — synthwave aesthetic.
const GRID_COLS = 8;
const GRID_ROWS = 6;

function NeonGridEffect({ width }: { width: number }) {
  const pulse = useSharedValue(0);
  const scan  = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }), -1, true);
    scan.value  = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1, false);
  }, [pulse, scan]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + pulse.value * 0.45,
  }));
  const scanStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scan.value * 200 - 40 }],
  }));

  const cellW = width / GRID_COLS;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, overlayStyle]}>
        {/* Vertical lines */}
        {[...Array(GRID_COLS + 1)].map((_, i) => (
          <View key={`v${i}`} style={{
            position:        'absolute',
            left:            i * cellW,
            top:             0,
            bottom:          0,
            width:           i === 0 || i === GRID_COLS ? 2 : 1,
            backgroundColor: i % 2 === 0 ? '#e3383888' : '#FFD70055',
          }} />
        ))}
        {/* Horizontal lines */}
        {[...Array(GRID_ROWS + 1)].map((_, i) => (
          <View key={`h${i}`} style={{
            position:        'absolute',
            left:            0,
            right:           0,
            top:             `${(i / GRID_ROWS) * 100}%` as `${number}%`,
            height:          1,
            backgroundColor: '#a855f744',
          }} />
        ))}
        {/* Bottom gradient */}
        <LinearGradient
          colors={['transparent', '#e3383533', '#FFD70044']}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
      {/* Scan line */}
      <Animated.View style={[{
        position: 'absolute', left: 0, right: 0, height: 4,
        backgroundColor: '#FFD700cc',
        shadowColor: '#FFD700', shadowOpacity: 1, shadowRadius: 12,
      }, scanStyle]} />
    </View>
  );
}

// ─── Orchestrator ─────────────────────────────────────────────────
export default function HeroLegacyEffects({
  motion,
  screenWidth = SCREEN_W,
}: {
  motion: ProfileHeroMotion;
  screenWidth?: number;
}) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {motion === 'prism'     && <PrismEffect     width={screenWidth} />}
      {motion === 'matrix'    && <MatrixEffect />}
      {motion === 'storm'     && <StormEffect     width={screenWidth} />}
      {motion === 'hologram'  && <HologramEffect />}
      {motion === 'neon-grid' && <NeonGridEffect  width={screenWidth} />}
    </View>
  );
}
