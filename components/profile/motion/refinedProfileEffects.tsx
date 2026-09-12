import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useReducedMotion } from 'react-native-reanimated';
import type { ProfileHeroMotion, ProfileVisitEntranceAnim } from '../../../constants/profilePremiumExtras';

type EntranceProps = {
  kind: ProfileVisitEntranceAnim;
  width: number;
  height: number;
  onDone: () => void;
};

const INK = '#070809';
const PEARL = '#f4f0e9';
const CHAMPAGNE = '#c8aa78';
const STEEL = '#9fb1be';
const BRAND = '#d94848';

export const REFINED_VISIT_KINDS = new Set<ProfileVisitEntranceAnim>([
  'apex-reveal',
  'garage-ignition',
  'neon-impact',
  'hyper-tunnel',
  'portal',
  'turbo',
  'lightning',
  'chromaburst',
  'iris',
]);

export const REFINED_HERO_KINDS = new Set<ProfileHeroMotion>([
  'apex-grid',
  'ignition',
  'neon-rain',
  'turbo-pulse',
  'aurora',
  'vortex',
  'embers',
  'glitch',
  'kenburns',
]);

export function isRefinedVisitKind(kind: string): kind is ProfileVisitEntranceAnim {
  return REFINED_VISIT_KINDS.has(kind as ProfileVisitEntranceAnim);
}

function useEntranceProgress(duration: number, onDone: () => void) {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 160 : duration,
      easing: Easing.bezier(0.22, 0.72, 0.18, 1),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) onDoneRef.current();
    });
    return () => animation.stop();
  }, [duration, progress, reduceMotion]);

  return progress;
}

function useAmbientProgress(duration: number) {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(0.45);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [duration, progress, reduceMotion]);

  return progress;
}

function Veil({ progress }: { progress: Animated.Value }) {
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: INK,
          opacity: progress.interpolate({
            inputRange: [0, 0.68, 1],
            outputRange: [0.68, 0.12, 0],
          }),
        },
      ]}
    />
  );
}

function VelvetReveal({ progress, width }: { progress: Animated.Value; width: number }) {
  const leftX = progress.interpolate({ inputRange: [0, 0.72, 1], outputRange: [0, -width * 0.52, -width * 0.56] });
  const rightX = progress.interpolate({ inputRange: [0, 0.72, 1], outputRange: [0, width * 0.52, width * 0.56] });
  const seamOpacity = progress.interpolate({ inputRange: [0, 0.15, 0.64, 1], outputRange: [0, 0.65, 0.22, 0] });
  return (
    <>
      <Animated.View style={[styles.velvetPanel, styles.velvetLeft, { transform: [{ translateX: leftX }] }]}>
        <LinearGradient colors={['#08090b', '#15171a', '#090a0c']} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[styles.velvetPanel, styles.velvetRight, { transform: [{ translateX: rightX }] }]}>
        <LinearGradient colors={['#090a0c', '#15171a', '#08090b']} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[styles.verticalSeam, { opacity: seamOpacity, transform: [{ scaleY: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.08, 1, 1] }) }] }]} />
    </>
  );
}

function HorizonReveal({ progress, height }: { progress: Animated.Value; height: number }) {
  const open = progress.interpolate({ inputRange: [0, 0.78, 1], outputRange: [0, height * 0.54, height * 0.58] });
  const lineOpacity = progress.interpolate({ inputRange: [0, 0.2, 0.76, 1], outputRange: [0, 0.8, 0.2, 0] });
  return (
    <>
      <Animated.View style={[styles.shutter, { top: 0, transform: [{ translateY: Animated.multiply(open, -1) }] }]} />
      <Animated.View style={[styles.shutter, { bottom: 0, transform: [{ translateY: open }] }]} />
      <Animated.View style={[styles.horizonGlow, { top: height * 0.48, opacity: lineOpacity, transform: [{ scaleX: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.08, 1, 1.12] }) }] }]}>
        <LinearGradient colors={['transparent', `${CHAMPAGNE}44`, PEARL, `${CHAMPAGNE}44`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </>
  );
}

function HaloReveal({ progress, width, height }: { progress: Animated.Value; width: number; height: number }) {
  return (
    <>
      {[0, 1, 2].map(index => {
        const size = 112 + index * 30;
        return (
          <Animated.View
            key={index}
            style={{
              position: 'absolute',
              left: width / 2 - size / 2,
              top: height * 0.44 - size / 2,
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: index === 0 ? 1.5 : 1,
              borderColor: index === 0 ? `${PEARL}cc` : `${STEEL}88`,
              opacity: progress.interpolate({ inputRange: [0, 0.18 + index * 0.06, 0.78, 1], outputRange: [0, 0.66 - index * 0.1, 0.16, 0] }),
              transform: [{ scale: progress.interpolate({ inputRange: [0, 0.24 + index * 0.05, 1], outputRange: [0.65, 1, 2.7 + index * 0.22] }) }],
            }}
          />
        );
      })}
      <Animated.View style={[styles.centerDot, { left: width / 2 - 3, top: height * 0.44 - 3, opacity: progress.interpolate({ inputRange: [0, 0.25, 0.65, 1], outputRange: [0, 0.9, 0.34, 0] }) }]} />
    </>
  );
}

function DepthReveal({ progress, width, height }: { progress: Animated.Value; width: number; height: number }) {
  return (
    <>
      {[0, 1, 2, 3].map(index => (
        <Animated.View
          key={index}
          style={{
            position: 'absolute',
            left: width * 0.13,
            top: height * 0.21,
            width: width * 0.74,
            height: height * 0.48,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: index % 2 ? `${CHAMPAGNE}72` : `${PEARL}68`,
            opacity: progress.interpolate({ inputRange: [0, 0.15 + index * 0.06, 0.78, 1], outputRange: [0, 0.42, 0.1, 0] }),
            transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.52 - index * 0.08, 1.4 + index * 0.24] }) }],
          }}
        />
      ))}
    </>
  );
}

function ApertureReveal({ progress, width, height }: { progress: Animated.Value; width: number; height: number }) {
  const shift = progress.interpolate({ inputRange: [0, 0.76, 1], outputRange: [0, width * 0.9, width] });
  return (
    <>
      {[-1, 1].map(side => (
        <Animated.View
          key={side}
          style={{
            position: 'absolute',
            left: width * 0.5 - width * 0.72,
            top: height * 0.5 - height * 0.52,
            width: width * 1.44,
            height: height * 1.04,
            backgroundColor: '#0b0c0e',
            transform: [{ translateX: Animated.multiply(shift, side) }, { rotate: `${side * 12}deg` }],
          }}
        />
      ))}
      <Animated.View style={[styles.apertureLine, { left: width * 0.18, right: width * 0.18, top: height * 0.48, opacity: progress.interpolate({ inputRange: [0, 0.18, 0.72, 1], outputRange: [0, 0.6, 0.15, 0] }), transform: [{ scaleX: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.1, 1, 1.2] }) }] }]} />
    </>
  );
}

function VelocityReveal({ progress, width, height }: { progress: Animated.Value; width: number; height: number }) {
  const lines = useMemo(() => Array.from({ length: 7 }, (_, index) => ({
    top: height * (0.24 + index * 0.075),
    width: width * (0.18 + (index % 3) * 0.08),
    side: index % 2 ? 1 : -1,
  })), [height, width]);
  return (
    <>
      {lines.map((line, index) => (
        <Animated.View
          key={index}
          style={{
            position: 'absolute',
            top: line.top,
            left: width / 2 - line.width / 2,
            width: line.width,
            height: 1,
            backgroundColor: index % 3 === 0 ? CHAMPAGNE : PEARL,
            opacity: progress.interpolate({ inputRange: [0, 0.2 + index * 0.025, 0.78, 1], outputRange: [0, 0.5, 0.14, 0] }),
            transform: [{ translateX: Animated.multiply(progress.interpolate({ inputRange: [0, 1], outputRange: [0, width * 0.78] }), line.side) }, { scaleX: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 1, 0.5] }) }],
          }}
        />
      ))}
    </>
  );
}

function TraceReveal({ progress, width, height }: { progress: Animated.Value; width: number; height: number }) {
  const opacity = progress.interpolate({ inputRange: [0, 0.18, 0.72, 1], outputRange: [0, 0.72, 0.2, 0] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity, transform: [{ rotate: '-8deg' }] }]}>
      <View style={[styles.trace, { left: width * 0.12, top: height * 0.4, width: width * 0.76 }]}>
        <LinearGradient colors={['transparent', `${STEEL}99`, PEARL, `${CHAMPAGNE}99`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </View>
      <Animated.View style={[styles.traceNode, { left: width * 0.5 - 4, top: height * 0.4 - 3, transform: [{ scale: progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.2, 1.2, 3] }) }] }]} />
    </Animated.View>
  );
}

function PrismReveal({ progress, width, height }: { progress: Animated.Value; width: number; height: number }) {
  return (
    <>
      {[STEEL, CHAMPAGNE, BRAND].map((color, index) => (
        <Animated.View
          key={color}
          style={{
            position: 'absolute',
            left: -width * 0.46 + index * width * 0.24,
            top: -height * 0.2,
            width: width * 0.44,
            height: height * 1.4,
            borderRadius: 999,
            opacity: progress.interpolate({ inputRange: [0, 0.18 + index * 0.05, 0.72, 1], outputRange: [0, 0.2, 0.08, 0] }),
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, width * 1.2] }) }, { rotate: '18deg' }],
          }}
        >
          <LinearGradient colors={['transparent', `${color}99`, 'transparent']} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ))}
    </>
  );
}

function FocusReveal({ progress, width, height }: { progress: Animated.Value; width: number; height: number }) {
  const opacity = progress.interpolate({ inputRange: [0, 0.2, 0.76, 1], outputRange: [0, 0.6, 0.16, 0] });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: width * 0.12,
        top: height * 0.18,
        width: width * 0.76,
        height: height * 0.55,
        borderRadius: 26,
        borderWidth: 1,
        borderColor: `${PEARL}bb`,
        opacity,
        transform: [{ scale: progress.interpolate({ inputRange: [0, 0.38, 1], outputRange: [1.22, 1, 0.92] }) }],
      }}
    >
      <View style={styles.focusCornerTop} />
      <View style={styles.focusCornerBottom} />
    </Animated.View>
  );
}

export function RefinedEntranceEffect({ kind, width, height, onDone }: EntranceProps) {
  const progress = useEntranceProgress(kind === 'hyper-tunnel' ? 1450 : 1650, onDone);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Veil progress={progress} />
      {kind === 'apex-reveal' && <VelvetReveal progress={progress} width={width} />}
      {kind === 'garage-ignition' && <HorizonReveal progress={progress} height={height} />}
      {kind === 'neon-impact' && <HaloReveal progress={progress} width={width} height={height} />}
      {kind === 'hyper-tunnel' && <DepthReveal progress={progress} width={width} height={height} />}
      {kind === 'portal' && <ApertureReveal progress={progress} width={width} height={height} />}
      {kind === 'turbo' && <VelocityReveal progress={progress} width={width} height={height} />}
      {kind === 'lightning' && <TraceReveal progress={progress} width={width} height={height} />}
      {kind === 'chromaburst' && <PrismReveal progress={progress} width={width} height={height} />}
      {kind === 'iris' && <FocusReveal progress={progress} width={width} height={height} />}
    </View>
  );
}

function GuideGrid({ opacity = 0.14 }: { opacity?: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { opacity }]}>
      {[0.22, 0.5, 0.78].map(position => <View key={`v-${position}`} style={[styles.guideVertical, { left: `${position * 100}%` }]} />)}
      {[0.28, 0.58, 0.84].map(position => <View key={`h-${position}`} style={[styles.guideHorizontal, { top: `${position * 100}%` }]} />)}
    </View>
  );
}

function GlassDrift({ progress }: { progress: Animated.Value }) {
  return (
    <>
      <GuideGrid opacity={0.3} />
      <Animated.View style={[styles.slowSweep, { opacity: 0.58, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-240, 460] }) }, { rotate: '-12deg' }] }]}>
        <LinearGradient colors={['transparent', `${PEARL}cc`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </>
  );
}

function Afterglow({ progress }: { progress: Animated.Value }) {
  return (
    <>
      <Animated.View style={[styles.ambientOrb, { left: '-18%', top: '26%', opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.6] }), transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.16] }) }] }]}>
        <LinearGradient colors={['#d9484800', BRAND, '#d9484800']} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[styles.ambientOrb, { right: '-22%', top: '-18%', opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.28] }), transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1.12, 0.94] }) }] }]}>
        <LinearGradient colors={['#c8aa7800', CHAMPAGNE, '#c8aa7800']} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </>
  );
}

function SatinDrift({ progress }: { progress: Animated.Value }) {
  return (
    <>
      {[0, 1, 2].map(index => (
        <Animated.View key={index} style={[styles.satinBand, { left: `${-45 + index * 37}%`, opacity: 0.32 + index * 0.08, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-45 + index * 12, 95 + index * 10] }) }, { rotate: '16deg' }] }]}>
          <LinearGradient colors={['transparent', index === 1 ? `${CHAMPAGNE}dd` : `${STEEL}c0`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ))}
    </>
  );
}

function QuietOrbit({ progress }: { progress: Animated.Value }) {
  return (
    <View style={styles.orbitCenter}>
      {[150, 220, 300].map((size, index) => (
        <Animated.View key={size} style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: index === 1 ? 2 : 1.5, borderColor: index === 1 ? CHAMPAGNE : PEARL, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.38 + index * 0.07, 0.7 - index * 0.06] }), transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: [`${index * 24}deg`, `${80 + index * 24}deg`] }) }, { scaleY: 0.46 }] }}>
          <View style={[styles.orbitDot, { left: size * 0.16, top: size * 0.06, backgroundColor: index === 1 ? CHAMPAGNE : PEARL }]} />
        </Animated.View>
      ))}
    </View>
  );
}

function AuroraMist({ progress }: { progress: Animated.Value }) {
  return (
    <>
      {[STEEL, CHAMPAGNE, BRAND].map((color, index) => (
        <Animated.View key={color} style={[styles.mist, { left: `${-28 + index * 34}%`, backgroundColor: color, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: index % 2 ? [0.16, 0.34] : [0.3, 0.14] }), transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-18 + index * 7, 35 - index * 5] }) }, { rotate: `${-9 + index * 8}deg` }] }]} />
      ))}
    </>
  );
}

function Contour({ progress }: { progress: Animated.Value }) {
  return (
    <View style={styles.orbitCenter}>
      {[120, 172, 232, 300].map((size, index) => (
        <Animated.View key={size} style={{ position: 'absolute', width: size, height: size * 0.58, borderRadius: size / 2, borderWidth: index === 1 ? 2 : 1.25, borderColor: index % 2 ? STEEL : PEARL, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.3 + index * 0.035, 0.58 - index * 0.035] }), transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.93, 1.1] }) }, { rotate: `${index * 7 - 10}deg` }] }} />
      ))}
    </View>
  );
}

function FloatingDust({ progress }: { progress: Animated.Value }) {
  const particles = useMemo(() => Array.from({ length: 18 }, (_, index) => ({ left: `${5 + ((index * 29) % 91)}%`, top: `${8 + ((index * 17) % 82)}%`, size: index % 4 === 0 ? 4 : 2 })), []);
  return (
    <>
      {particles.map((particle, index) => (
        <Animated.View key={index} style={{ position: 'absolute', left: particle.left as any, top: particle.top as any, width: particle.size, height: particle.size, borderRadius: 3, backgroundColor: index % 5 === 0 ? CHAMPAGNE : PEARL, opacity: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: index % 2 ? [0.18, 0.68, 0.24] : [0.6, 0.16, 0.46] }), transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14 + index, -22 - index] }) }] }} />
      ))}
    </>
  );
}

function FilmScan({ progress }: { progress: Animated.Value }) {
  return (
    <>
      <View style={[StyleSheet.absoluteFill, { opacity: 0.22 }]}>
        {Array.from({ length: 12 }, (_, index) => <View key={index} style={[styles.scanHairline, { top: `${index * 9}%` }]} />)}
      </View>
      <Animated.View style={[styles.scanHighlight, { opacity: 0.48, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-80, 230] }) }] }]}>
        <LinearGradient colors={['transparent', `${PEARL}aa`, 'transparent']} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </>
  );
}

function CinemaLight({ progress }: { progress: Animated.Value }) {
  return (
    <>
      <Animated.View style={[styles.cinemaBeam, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.46] }), transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-90, 210] }) }, { rotate: '-18deg' }] }]}>
        <LinearGradient colors={['transparent', `${CHAMPAGNE}bb`, `${PEARL}dd`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View style={styles.cinemaFrame} />
    </>
  );
}

export function RefinedHeroMotion({ motion }: { motion: ProfileHeroMotion }) {
  const duration = motion === 'turbo-pulse' ? 6000 : 8000;
  const progress = useAmbientProgress(duration);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {motion === 'apex-grid' && <GlassDrift progress={progress} />}
      {motion === 'ignition' && <Afterglow progress={progress} />}
      {motion === 'neon-rain' && <SatinDrift progress={progress} />}
      {motion === 'turbo-pulse' && <QuietOrbit progress={progress} />}
      {motion === 'aurora' && <AuroraMist progress={progress} />}
      {motion === 'vortex' && <Contour progress={progress} />}
      {motion === 'embers' && <FloatingDust progress={progress} />}
      {motion === 'glitch' && <FilmScan progress={progress} />}
      {motion === 'kenburns' && <CinemaLight progress={progress} />}
    </View>
  );
}

const styles = StyleSheet.create({
  velvetPanel: { position: 'absolute', top: 0, bottom: 0, width: '51%' },
  velvetLeft: { left: 0 },
  velvetRight: { right: 0 },
  verticalSeam: { position: 'absolute', left: '50%', top: '14%', bottom: '14%', width: 1, backgroundColor: PEARL },
  shutter: { position: 'absolute', left: 0, right: 0, height: '51%', backgroundColor: '#0a0b0d' },
  horizonGlow: { position: 'absolute', left: '8%', right: '8%', height: 1 },
  centerDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: PEARL },
  apertureLine: { position: 'absolute', height: 1, backgroundColor: `${CHAMPAGNE}bb` },
  trace: { position: 'absolute', height: 1 },
  traceNode: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: PEARL },
  focusCornerTop: { position: 'absolute', left: -1, top: -1, width: 34, height: 34, borderLeftWidth: 2, borderTopWidth: 2, borderColor: CHAMPAGNE, borderTopLeftRadius: 26 },
  focusCornerBottom: { position: 'absolute', right: -1, bottom: -1, width: 34, height: 34, borderRightWidth: 2, borderBottomWidth: 2, borderColor: CHAMPAGNE, borderBottomRightRadius: 26 },
  guideVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: PEARL },
  guideHorizontal: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: PEARL },
  slowSweep: { position: 'absolute', left: -120, top: '-30%', width: 180, height: '170%' },
  ambientOrb: { position: 'absolute', width: '88%', height: '78%', borderRadius: 999, overflow: 'hidden' },
  satinBand: { position: 'absolute', top: '-65%', width: '30%', height: '230%', borderRadius: 999 },
  orbitCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  orbitDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4 },
  mist: { position: 'absolute', top: '-80%', width: '54%', height: '260%', borderRadius: 999 },
  scanHairline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: PEARL },
  scanHighlight: { position: 'absolute', top: -50, left: 0, right: 0, height: 62 },
  cinemaBeam: { position: 'absolute', left: -120, top: '-55%', width: 150, height: '220%' },
  cinemaFrame: { position: 'absolute', left: '7%', right: '7%', top: '12%', bottom: '16%', borderWidth: 1, borderColor: `${PEARL}66`, borderRadius: 18 },
});
