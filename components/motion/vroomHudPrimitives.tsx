import React, { useMemo } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { EntranceFxAccentColors, EntranceFxTier } from './entranceFxTypes';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const WHITE = '#ffffff';

export type HudLaneDef = {
  top: string;
  width: number;
  delay: number;
  side: 'left' | 'right';
  color: string;
};

export type HudSparkDef = {
  left: string;
  top: string;
  size: number;
  delay: number;
  color: string;
};

export function buildHudLanes(
  accents: EntranceFxAccentColors,
  tier: EntranceFxTier,
): HudLaneDef[] {
  const count = tier === 'lite' ? 6 : 12;
  const palette = [accents.primary, accents.secondary, accents.cyan ?? '#10f5ff', WHITE];
  return Array.from({ length: count }, (_, i) => ({
    top: `${10 + i * (tier === 'lite' ? 14 : 7)}%`,
    width: 110 + (i % 5) * 48,
    delay: i * 38,
    side: i % 2 === 0 ? 'left' : 'right',
    color: palette[i % palette.length],
  }));
}

export function buildHudSparks(
  accents: EntranceFxAccentColors,
  tier: EntranceFxTier,
): HudSparkDef[] {
  const count = tier === 'lite' ? 14 : 34;
  const palette = [accents.secondary, accents.primary, accents.cyan ?? '#10f5ff', WHITE];
  return Array.from({ length: count }, (_, i) => ({
    left: `${4 + ((i * 17) % 92)}%`,
    top: `${8 + ((i * 23) % 80)}%`,
    size: 3 + (i % 5),
    delay: 420 + i * 22,
    color: palette[i % palette.length],
  }));
}

export function useAnimatedValues(count: number) {
  return useMemo(() => Array.from({ length: count }, () => new Animated.Value(0)), [count]);
}

export function HudLaneLine({ line, progress }: { line: HudLaneDef; progress: Animated.Value }) {
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: line.side === 'left'
      ? [-line.width - 80, SCREEN_W + 80]
      : [SCREEN_W + 80, -line.width - 80],
  });
  const opacity = progress.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 1, 0.72, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: line.top as `${number}%`,
        left: 0,
        width: line.width,
        height: 4,
        opacity,
        transform: [{ translateX }, { rotate: line.side === 'left' ? '-10deg' : '10deg' }],
      }}
    >
      <LinearGradient
        colors={line.side === 'left' ? ['transparent', line.color, WHITE] : [WHITE, line.color, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export function HudSpark({ spark, progress }: { spark: HudSparkDef; progress: Animated.Value }) {
  const opacity = progress.interpolate({ inputRange: [0, 0.16, 0.82, 1], outputRange: [0, 1, 0.86, 0] });
  const scale = progress.interpolate({ inputRange: [0, 0.22, 0.75, 1], outputRange: [0.2, 1.8, 1, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [26, -54] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: spark.left as `${number}%`,
        top: spark.top as `${number}%`,
        width: spark.size,
        height: spark.size,
        borderRadius: spark.size,
        backgroundColor: spark.color,
        opacity,
        shadowColor: spark.color,
        shadowOpacity: 1,
        shadowRadius: 14,
        transform: [{ translateY }, { scale }],
      }}
    />
  );
}

export function HudGridLayer({
  progress,
  accents,
}: {
  progress: Animated.Value;
  accents: EntranceFxAccentColors;
}) {
  const opacity = progress.interpolate({ inputRange: [0, 0.22, 1], outputRange: [0, 0.38, 0.18] });
  const cyan = accents.cyan ?? '#10f5ff';
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      {Array.from({ length: 10 }).map((_, i) => (
        <View
          key={`h-${i}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${8 + i * 10}%`,
            height: 1,
            backgroundColor: i % 2 === 0 ? accents.primary : accents.secondary,
            opacity: 0.32,
          }}
        />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <View
          key={`v-${i}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${8 + i * 18}%`,
            width: 1,
            backgroundColor: cyan,
            opacity: 0.24,
          }}
        />
      ))}
    </Animated.View>
  );
}

export function HudScanLine({
  intro,
  laneOpacity,
  scanY,
  cyan = '#10f5ff',
}: {
  intro: Animated.Value;
  laneOpacity: Animated.AnimatedInterpolation<number>;
  scanY: Animated.AnimatedInterpolation<number>;
  cyan?: string;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height: 90,
        opacity: laneOpacity,
        transform: [{ translateY: scanY }],
      }}
    >
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.18)', `${cyan}88`, 'transparent']}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export function HudGatePanels({
  gateLeftX,
  gateRightX,
  leftGradient,
  rightGradient,
  leftBorder,
  rightBorder,
}: {
  gateLeftX: Animated.AnimatedInterpolation<number>;
  gateRightX: Animated.AnimatedInterpolation<number>;
  leftGradient: [string, string, string];
  rightGradient: [string, string, string];
  leftBorder: string;
  rightBorder: string;
}) {
  return (
    <>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: SCREEN_W * 0.52,
          transform: [{ translateX: gateLeftX }, { skewX: '-8deg' }],
        }}
      >
        <LinearGradient colors={leftGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 3, backgroundColor: leftBorder }} />
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: SCREEN_W * 0.52,
          transform: [{ translateX: gateRightX }, { skewX: '8deg' }],
        }}
      >
        <LinearGradient colors={rightGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: rightBorder }} />
      </Animated.View>
    </>
  );
}

export function HudClashRings({
  colors,
  ringOpacity,
  ringScale,
}: {
  colors: string[];
  ringOpacity: Animated.AnimatedInterpolation<number>;
  ringScale: Animated.AnimatedInterpolation<number>;
}) {
  return (
    <>
      {colors.map((color, i) => (
        <Animated.View
          key={color}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: 130 + i * 38,
            height: 130 + i * 38,
            borderRadius: 120,
            borderWidth: 3,
            borderColor: color,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          }}
        />
      ))}
    </>
  );
}

export function hudScanY(intro: Animated.Value) {
  return intro.interpolate({ inputRange: [0, 1], outputRange: [-80, SCREEN_H + 80] });
}

export function hudGateInterpolations(gate: Animated.Value) {
  return {
    gateLeftX: gate.interpolate({ inputRange: [0, 1, 2], outputRange: [-SCREEN_W * 0.52, 0, -SCREEN_W * 0.72] }),
    gateRightX: gate.interpolate({ inputRange: [0, 1, 2], outputRange: [SCREEN_W * 0.52, 0, SCREEN_W * 0.72] }),
  };
}

/** Static HUD grid for chat shells — optional animated opacity */
export function StaticHudGrid({
  isDark,
  primary = '#e33835',
  opacity = 1,
}: {
  isDark: boolean;
  primary?: string;
  opacity?: number;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, { opacity, overflow: 'hidden' }]} pointerEvents="none">
      {[...Array(6)].map((_, i) => (
        <View
          key={`h-${i}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${(i + 1) * 16}%`,
            height: 1,
            backgroundColor: isDark ? `${primary}08` : `${primary}10`,
          }}
        />
      ))}
      {[...Array(4)].map((_, i) => (
        <View
          key={`v-${i}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${(i + 1) * 20}%`,
            width: 1,
            backgroundColor: isDark ? `${primary}06` : `${primary}08`,
          }}
        />
      ))}
    </View>
  );
}
