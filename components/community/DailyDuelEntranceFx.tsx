import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { COMMUNITY_ACCENTS } from './communityTheme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const INTRO_MS = 2850;
const RED = COMMUNITY_ACCENTS.duelAlt;
const GOLD = COMMUNITY_ACCENTS.duel;
const CYAN = '#10f5ff';
const WHITE = '#ffffff';

type Props = {
  onDone: () => void;
};

const LANES = Array.from({ length: 12 }, (_, i) => ({
  top: `${10 + i * 7}%`,
  width: 110 + (i % 5) * 48,
  delay: i * 38,
  side: i % 2 === 0 ? 'left' : 'right',
  color: [RED, GOLD, CYAN, WHITE][i % 4],
}));

const SPARKS = Array.from({ length: 34 }, (_, i) => ({
  left: `${4 + ((i * 17) % 92)}%`,
  top: `${8 + ((i * 23) % 80)}%`,
  size: 3 + (i % 5),
  delay: 420 + i * 22,
  color: [GOLD, RED, CYAN, WHITE][i % 4],
}));

function useAnimatedValues(count: number) {
  return useMemo(() => Array.from({ length: count }, () => new Animated.Value(0)), [count]);
}

function LaneLine({ line, progress }: { line: (typeof LANES)[number]; progress: Animated.Value }) {
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
        top: line.top as any,
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

function Spark({ spark, progress }: { spark: (typeof SPARKS)[number]; progress: Animated.Value }) {
  const opacity = progress.interpolate({ inputRange: [0, 0.16, 0.82, 1], outputRange: [0, 1, 0.86, 0] });
  const scale = progress.interpolate({ inputRange: [0, 0.22, 0.75, 1], outputRange: [0.2, 1.8, 1, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [26, -54] });

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
        shadowRadius: 14,
        transform: [{ translateY }, { scale }],
      }}
    />
  );
}

function GridLayer({ progress }: { progress: Animated.Value }) {
  const opacity = progress.interpolate({ inputRange: [0, 0.22, 1], outputRange: [0, 0.38, 0.18] });
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
            backgroundColor: i % 2 === 0 ? RED : GOLD,
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
            backgroundColor: CYAN,
            opacity: 0.24,
          }}
        />
      ))}
    </Animated.View>
  );
}

export function DailyDuelEntranceFx({ onDone }: Props) {
  const intro = useRef(new Animated.Value(0)).current;
  const gate = useRef(new Animated.Value(0)).current;
  const logo = useRef(new Animated.Value(0)).current;
  const clash = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const exitFade = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const laneProgress = useAnimatedValues(LANES.length);
  const sparkProgress = useAnimatedValues(SPARKS.length);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  const runExit = useCallback(() => {
    Animated.parallel([
      Animated.timing(exitFade, { toValue: 0, duration: 360, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0.82, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => finish());
  }, [exitFade, finish, flash]);

  useEffect(() => {
    const laneAnims = laneProgress.map((value, i) => Animated.sequence([
      Animated.delay(LANES[i].delay),
      Animated.timing(value, { toValue: 1, duration: 980, easing: Easing.out(Easing.exp), useNativeDriver: true }),
    ]));
    const sparkAnims = sparkProgress.map((value, i) => Animated.sequence([
      Animated.delay(SPARKS[i].delay),
      Animated.timing(value, { toValue: 1, duration: 1180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]));

    Animated.parallel([
      Animated.timing(intro, { toValue: 1, duration: 1650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(gate, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(620),
        Animated.timing(gate, { toValue: 2, duration: 540, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(260),
        Animated.spring(logo, { toValue: 1, damping: 9, stiffness: 115, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(760),
        Animated.parallel([
          Animated.timing(clash, { toValue: 1, duration: 680, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(shake, { toValue: 1, duration: 45, useNativeDriver: true }),
            Animated.timing(shake, { toValue: -1, duration: 45, useNativeDriver: true }),
            Animated.timing(shake, { toValue: 0.7, duration: 45, useNativeDriver: true }),
            Animated.timing(shake, { toValue: 0, duration: 55, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(flash, { toValue: 0.62, duration: 80, useNativeDriver: true }),
            Animated.timing(flash, { toValue: 0, duration: 260, useNativeDriver: true }),
          ]),
        ]),
      ]),
      Animated.stagger(18, laneAnims),
      Animated.stagger(12, sparkAnims),
    ]).start();

    const t = setTimeout(runExit, INTRO_MS);
    return () => clearTimeout(t);
  }, [clash, flash, gate, intro, laneProgress, logo, runExit, shake, sparkProgress]);

  const gateLeftX = gate.interpolate({ inputRange: [0, 1, 2], outputRange: [-SCREEN_W * 0.52, 0, -SCREEN_W * 0.72] });
  const gateRightX = gate.interpolate({ inputRange: [0, 1, 2], outputRange: [SCREEN_W * 0.52, 0, SCREEN_W * 0.72] });
  const logoScale = logo.interpolate({ inputRange: [0, 0.72, 1], outputRange: [2.4, 0.9, 1] });
  const logoOpacity = logo.interpolate({ inputRange: [0, 0.12, 0.88, 1], outputRange: [0, 1, 1, 0.95] });
  const logoY = intro.interpolate({ inputRange: [0, 1], outputRange: [24, -12] });
  const shakeX = shake.interpolate({ inputRange: [-1, 0, 1], outputRange: [-10, 0, 10] });
  const ringScale = clash.interpolate({ inputRange: [0, 0.24, 1], outputRange: [0.2, 1, 4.4] });
  const ringOpacity = clash.interpolate({ inputRange: [0, 0.2, 0.82, 1], outputRange: [0, 1, 0.38, 0] });
  const laneOpacity = intro.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.75, 0.96] });
  const scanY = intro.interpolate({ inputRange: [0, 1], outputRange: [-80, SCREEN_H + 80] });

  return (
    <Pressable style={styles.root} onPress={runExit}>
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 900, opacity: exitFade, backgroundColor: '#010101' }]}>
        <LinearGradient
          colors={['#1f0505', '#030303', '#0d0700']}
          style={StyleSheet.absoluteFill}
        />
        <GridLayer progress={intro} />

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
            colors={['transparent', 'rgba(255,255,255,0.18)', `${CYAN}88`, 'transparent']}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {LANES.map((line, i) => <LaneLine key={i} line={line} progress={laneProgress[i]} />)}
        {SPARKS.map((spark, i) => <Spark key={i} spark={spark} progress={sparkProgress[i]} />)}

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
          <LinearGradient colors={['#250606', '#060606', '#000000']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 3, backgroundColor: RED }} />
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
          <LinearGradient colors={['#000000', '#070707', '#2c2300']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: GOLD }} />
        </Animated.View>

        <View style={styles.center}>
          <Animated.View
            style={{
              alignItems: 'center',
              opacity: logoOpacity,
              transform: [{ translateX: shakeX }, { translateY: logoY }, { scale: logoScale }],
            }}
          >
            <Text style={styles.eyebrow}>VROOM ARENA</Text>
            <View style={styles.vsRow}>
              <LinearGradient colors={[RED, `${RED}66`]} style={[styles.sideBadge, { borderColor: RED }]}>
                <MaterialCommunityIcons name="car-sports" size={22} color={WHITE} />
              </LinearGradient>
              <LinearGradient colors={[RED, GOLD]} style={styles.vsCore}>
                <Text style={styles.vsText}>VS</Text>
              </LinearGradient>
              <LinearGradient colors={[`${GOLD}66`, GOLD]} style={[styles.sideBadge, { borderColor: GOLD }]}>
                <MaterialCommunityIcons name="car-sports" size={22} color="#111" />
              </LinearGradient>
            </View>
            <Text style={styles.title}>POJEDYNEK DNIA</Text>
            <Text style={styles.subtitle}>ODPAL ARENE I WYBIERZ ZWYCIĘZCĘ</Text>
          </Animated.View>

          {[GOLD, RED, CYAN].map((color, i) => (
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
        </View>

        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: WHITE, opacity: flash }]} />

        <Text style={styles.skip}>DOTKNIJ, ABY POMINĄĆ</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    color: '#ffffff88',
    fontFamily: 'Orbitron',
    fontSize: 10,
    letterSpacing: 4,
    marginBottom: 16,
  },
  vsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  sideBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  vsCore: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GOLD,
    shadowOpacity: 0.9,
    shadowRadius: 24,
  },
  vsText: {
    color: WHITE,
    fontFamily: 'Orbitron',
    fontSize: 28,
    fontWeight: '900',
    fontStyle: 'italic',
    textShadowColor: '#000',
    textShadowRadius: 8,
  },
  title: {
    color: WHITE,
    fontFamily: 'Orbitron',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
    textShadowColor: RED,
    textShadowRadius: 18,
  },
  subtitle: {
    color: '#ffffff88',
    fontFamily: 'Orbitron',
    fontSize: 9,
    letterSpacing: 2,
    marginTop: 10,
    textAlign: 'center',
  },
  skip: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    color: '#ffffff55',
    fontFamily: 'Orbitron',
    fontSize: 8,
    letterSpacing: 2,
  },
});
