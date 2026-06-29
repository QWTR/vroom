import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type SizeProps = { width: number; height: number };
type EntranceProps = SizeProps & { onDone: () => void };

const RED = '#ff3434';
const GOLD = '#ffd400';
const CYAN = '#10f5ff';
const PURPLE = '#8b5cf6';
const WHITE = '#ffffff';

const SPEED_LINES = Array.from({ length: 18 }, (_, i) => ({
  top: `${6 + ((i * 7) % 84)}%`,
  width: 90 + (i % 5) * 34,
  delay: i * 42,
  side: i % 2 === 0 ? 'left' : 'right',
  color: [RED, GOLD, CYAN, WHITE][i % 4],
}));

const SPARKS = Array.from({ length: 28 }, (_, i) => ({
  left: `${5 + ((i * 13) % 90)}%`,
  top: `${10 + ((i * 17) % 75)}%`,
  size: 3 + (i % 4),
  delay: i * 28,
  color: [GOLD, RED, CYAN, WHITE, PURPLE][i % 5],
}));

function useProgress(duration: number, onDone?: () => void) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onDone?.();
    });
  }, [duration, onDone, progress]);

  return progress;
}

function useLoop(duration: number, delay = 0) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, duration, progress]);

  return progress;
}

function AmbientGrid({ color = RED, opacity = 0.42 }: { color?: string; opacity?: number }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      {Array.from({ length: 8 }).map((_, i) => (
        <View
          key={`h-${i}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${12 + i * 11}%`,
            height: 1,
            backgroundColor: color,
            opacity: 0.12,
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
            backgroundColor: color,
            opacity: 0.09,
          }}
        />
      ))}
    </View>
  );
}

function SpeedLine({ line, progress, width }: { line: (typeof SPEED_LINES)[number]; progress: Animated.Value; width: number }) {
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: line.side === 'left' ? [-line.width - 40, width + 40] : [width + 40, -line.width - 40],
  });
  const opacity = progress.interpolate({ inputRange: [0, 0.12, 0.78, 1], outputRange: [0, 1, 0.75, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: line.top as any,
        width: line.width,
        height: 3,
        opacity,
        transform: [{ translateX }],
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

function Spark({ spark, progress }: { spark: (typeof SPARKS)[number]; progress: Animated.Value }) {
  const scale = progress.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1.7, 1, 0] });
  const opacity = progress.interpolate({ inputRange: [0, 0.18, 0.8, 1], outputRange: [0, 1, 0.85, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [18, -42] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: spark.left as any,
        top: spark.top as any,
        width: spark.size,
        height: spark.size,
        borderRadius: spark.size,
        backgroundColor: spark.color,
        opacity,
        shadowColor: spark.color,
        shadowOpacity: 1,
        shadowRadius: 10,
        transform: [{ translateY }, { scale }],
      }}
    />
  );
}

export function ApexRevealEntrance({ width, height, onDone }: EntranceProps) {
  const p = useProgress(1850, onDone);
  const lineP = useMemo(() => SPEED_LINES.map(() => new Animated.Value(0)), []);
  const sparkP = useMemo(() => SPARKS.map(() => new Animated.Value(0)), []);

  useEffect(() => {
    Animated.stagger(32, lineP.map(v => Animated.timing(v, { toValue: 1, duration: 920, easing: Easing.out(Easing.cubic), useNativeDriver: true }))).start();
    Animated.stagger(18, sparkP.map(v => Animated.timing(v, { toValue: 1, duration: 1180, easing: Easing.out(Easing.quad), useNativeDriver: true }))).start();
  }, [lineP, sparkP]);

  const veilOpacity = p.interpolate({ inputRange: [0, 0.16, 0.78, 1], outputRange: [0.92, 0.78, 0.18, 0] });
  const coreScale = p.interpolate({ inputRange: [0, 0.32, 1], outputRange: [0.3, 1.18, 2.6] });
  const coreOpacity = p.interpolate({ inputRange: [0, 0.22, 0.72, 1], outputRange: [0, 1, 0.45, 0] });
  const titleY = p.interpolate({ inputRange: [0, 0.42, 1], outputRange: [24, 0, -18] });
  const titleOpacity = p.interpolate({ inputRange: [0, 0.22, 0.82, 1], outputRange: [0, 1, 1, 0] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#020202', opacity: veilOpacity }]} />
      <AmbientGrid color={CYAN} opacity={0.55} />
      <Animated.View
        style={{
          position: 'absolute',
          left: width * 0.5 - 130,
          top: height * 0.42 - 130,
          width: 260,
          height: 260,
          borderRadius: 130,
          opacity: coreOpacity,
          transform: [{ scale: coreScale }],
          shadowColor: GOLD,
          shadowOpacity: 1,
          shadowRadius: 36,
        }}
      >
        <LinearGradient
          colors={[`${GOLD}00`, `${GOLD}dd`, `${RED}aa`, `${CYAN}55`, `${GOLD}00`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {SPEED_LINES.map((line, i) => <SpeedLine key={i} line={line} progress={lineP[i]} width={width} />)}
      {SPARKS.map((spark, i) => <Spark key={i} spark={spark} progress={sparkP[i]} />)}
      <Animated.Text
        style={{
          position: 'absolute',
          top: height * 0.37,
          left: 0,
          right: 0,
          textAlign: 'center',
          color: WHITE,
          fontFamily: 'Orbitron',
          fontSize: 22,
          fontWeight: '900',
          letterSpacing: 6,
          opacity: titleOpacity,
          textShadowColor: GOLD,
          textShadowRadius: 18,
          transform: [{ translateY: titleY }],
        }}
      >
        VROOM
      </Animated.Text>
    </View>
  );
}

export function GarageIgnitionEntrance({ width, height, onDone }: EntranceProps) {
  const p = useProgress(1700, onDone);
  const flash = p.interpolate({ inputRange: [0, 0.08, 0.18, 1], outputRange: [0, 1, 0.22, 0] });
  const shutter = p.interpolate({ inputRange: [0, 0.42, 1], outputRange: [0, -height * 0.62, -height] });
  const glowScale = p.interpolate({ inputRange: [0, 0.24, 1], outputRange: [0.6, 1.3, 2.4] });
  const glowOpacity = p.interpolate({ inputRange: [0, 0.28, 0.82, 1], outputRange: [0, 0.9, 0.45, 0] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: p.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.75, 0.22, 0] }) }]} />
      <Animated.View
        style={{
          position: 'absolute',
          left: width * 0.5 - 160,
          top: height * 0.5 - 160,
          width: 320,
          height: 320,
          borderRadius: 160,
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
        }}
      >
        <LinearGradient colors={[`${RED}00`, `${RED}ee`, `${GOLD}dd`, `${RED}00`]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: height * 0.5,
          backgroundColor: '#060606',
          transform: [{ translateY: shutter }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: height * 0.5,
          backgroundColor: '#060606',
          transform: [{ translateY: Animated.multiply(shutter, -1) }],
        }}
      />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: WHITE, opacity: flash }]} />
    </View>
  );
}

export function NeonImpactEntrance({ width, height, onDone }: EntranceProps) {
  const p = useProgress(1600, onDone);
  const ringScale = p.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0.1, 1, 4.2] });
  const ringOpacity = p.interpolate({ inputRange: [0, 0.2, 0.72, 1], outputRange: [0, 1, 0.4, 0] });
  const beamRotate = p.interpolate({ inputRange: [0, 1], outputRange: ['-18deg', '10deg'] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: p.interpolate({ inputRange: [0, 0.9, 1], outputRange: [0.55, 0.12, 0] }) }]} />
      {[RED, GOLD, CYAN].map((color, i) => (
        <Animated.View
          key={color}
          style={{
            position: 'absolute',
            left: width * 0.5 - 95 - i * 12,
            top: height * 0.42 - 95 - i * 12,
            width: 190 + i * 24,
            height: 190 + i * 24,
            borderRadius: 110,
            borderWidth: 4,
            borderColor: color,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          }}
        />
      ))}
      <Animated.View
        style={{
          position: 'absolute',
          left: -width * 0.2,
          top: height * 0.38,
          width: width * 1.4,
          height: 42,
          opacity: ringOpacity,
          transform: [{ rotate: beamRotate }],
        }}
      >
        <LinearGradient colors={['transparent', `${CYAN}ee`, `${WHITE}ff`, `${RED}ee`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

export function HyperTunnelEntrance({ width, height, onDone }: EntranceProps) {
  const p = useProgress(1500, onDone);
  const lineP = useMemo(() => SPEED_LINES.map(() => new Animated.Value(0)), []);

  useEffect(() => {
    Animated.stagger(20, lineP.map(v => Animated.timing(v, { toValue: 1, duration: 980, easing: Easing.out(Easing.exp), useNativeDriver: true }))).start();
  }, [lineP]);

  const zoom = p.interpolate({ inputRange: [0, 0.28, 1], outputRange: [0.65, 1.06, 1.24] });
  const fade = p.interpolate({ inputRange: [0, 0.18, 0.85, 1], outputRange: [0.85, 0.55, 0.08, 0] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#020202', opacity: fade }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: zoom }] }]}>
        {SPEED_LINES.map((line, i) => <SpeedLine key={i} line={line} progress={lineP[i]} width={width} />)}
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute',
          left: width * 0.5 - 100,
          top: height * 0.42 - 100,
          width: 200,
          height: 200,
          borderRadius: 100,
          borderWidth: 2,
          borderColor: GOLD,
          opacity: fade,
          transform: [{ scale: zoom }],
        }}
      />
    </View>
  );
}

function LoopBeam({ progress, color, top, rotate, delayWidth = 180 }: { progress: Animated.Value; color: string; top: string; rotate: string; delayWidth?: number }) {
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-260, 620] });
  const opacity = progress.interpolate({ inputRange: [0, 0.2, 0.82, 1], outputRange: [0, 0.75, 0.45, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: top as any,
        left: 0,
        width: delayWidth,
        height: 52,
        opacity,
        transform: [{ translateX }, { rotate }],
      }}
    >
      <LinearGradient colors={['transparent', `${color}cc`, `${WHITE}cc`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

export function ApexGridHeroMotion() {
  const a = useLoop(2600);
  const b = useLoop(3400, 450);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <AmbientGrid color={CYAN} opacity={0.7} />
      <LoopBeam progress={a} color={GOLD} top="20%" rotate="-16deg" delayWidth={210} />
      <LoopBeam progress={b} color={CYAN} top="54%" rotate="12deg" delayWidth={170} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `${CYAN}10` }]} />
    </View>
  );
}

export function IgnitionHeroMotion() {
  const p = useLoop(2400);
  const glowScale = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.85, 1.28, 0.85] });
  const glowOpacity = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.28, 0.72, 0.28] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={{
          position: 'absolute',
          left: '8%',
          right: '8%',
          bottom: '-36%',
          height: '84%',
          borderRadius: 999,
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
        }}
      >
        <LinearGradient colors={[`${RED}00`, `${RED}aa`, `${GOLD}dd`, `${RED}00`]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <AmbientGrid color={RED} opacity={0.32} />
    </View>
  );
}

export function NeonRainHeroMotion() {
  const a = useLoop(1800);
  const b = useLoop(2200, 360);
  const c = useLoop(2600, 700);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LoopBeam progress={a} color={CYAN} top="8%" rotate="22deg" delayWidth={130} />
      <LoopBeam progress={b} color={PURPLE} top="36%" rotate="22deg" delayWidth={180} />
      <LoopBeam progress={c} color={GOLD} top="68%" rotate="22deg" delayWidth={150} />
      <AmbientGrid color={PURPLE} opacity={0.3} />
    </View>
  );
}

export function TurboPulseHeroMotion() {
  const p = useLoop(1600);
  const scale = p.interpolate({ inputRange: [0, 1], outputRange: [0.55, 2.4] });
  const opacity = p.interpolate({ inputRange: [0, 0.22, 1], outputRange: [0, 0.74, 0] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={{
          position: 'absolute',
          left: '36%',
          top: '20%',
          width: '28%',
          height: '42%',
          borderRadius: 999,
          borderWidth: 3,
          borderColor: GOLD,
          opacity,
          transform: [{ scale }],
        }}
      />
      <LoopBeam progress={p} color={WHITE} top="44%" rotate="0deg" delayWidth={240} />
      <AmbientGrid color={GOLD} opacity={0.25} />
    </View>
  );
}

