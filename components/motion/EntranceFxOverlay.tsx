import React, { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import type { EntranceFxPresetId, EntranceFxTier } from './entranceFxTypes';
import { getEntrancePreset } from './entranceFxRegistry';
import {
  HudClashRings,
  HudGatePanels,
  HudGridLayer,
  HudLaneLine,
  HudScanLine,
  HudSpark,
  buildHudLanes,
  buildHudSparks,
  hudGateInterpolations,
  hudScanY,
  useAnimatedValues,
} from './vroomHudPrimitives';

const WHITE = '#ffffff';

type Props = {
  presetId: EntranceFxPresetId;
  onDone: () => void;
  tier?: EntranceFxTier;
  titleOverride?: string;
  subtitleOverride?: string;
  eyebrowOverride?: string;
  centerContent?: ReactNode;
  hapticsOnClash?: boolean;
};

export function EntranceFxOverlay({
  presetId,
  onDone,
  tier = 'full',
  titleOverride,
  subtitleOverride,
  eyebrowOverride,
  centerContent,
  hapticsOnClash = true,
}: Props) {
  const preset = getEntrancePreset(presetId);
  const durationMs = tier === 'lite' ? Math.round(preset.durationMs * 0.72) : preset.durationMs;
  const { primary: RED, secondary: GOLD, cyan: CYAN = '#10f5ff' } = preset.accents;

  const LANES = useMemo(() => buildHudLanes(preset.accents, tier), [preset.accents, tier]);
  const SPARKS = useMemo(() => buildHudSparks(preset.accents, tier), [preset.accents, tier]);

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
  const hapticFiredRef = useRef(false);

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

    const parallel: Animated.CompositeAnimation[] = [
      Animated.timing(intro, { toValue: 1, duration: 1650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.stagger(tier === 'lite' ? 28 : 18, laneAnims),
      Animated.stagger(tier === 'lite' ? 18 : 12, sparkAnims),
    ];

    if (preset.showGates) {
      parallel.push(
        Animated.sequence([
          Animated.timing(gate, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.delay(620),
          Animated.timing(gate, { toValue: 2, duration: 540, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        ]),
      );
    }

    parallel.push(
      Animated.sequence([
        Animated.delay(260),
        Animated.spring(logo, { toValue: 1, damping: 9, stiffness: 115, useNativeDriver: true }),
      ]),
    );

    if (preset.showClash) {
      parallel.push(
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
      );
    }

    Animated.parallel(parallel).start();

    if (preset.showClash && hapticsOnClash) {
      const hapticTimer = setTimeout(() => {
        if (!hapticFiredRef.current) {
          hapticFiredRef.current = true;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }, 760);
      const t = setTimeout(runExit, durationMs);
      return () => { clearTimeout(t); clearTimeout(hapticTimer); };
    }

    const t = setTimeout(runExit, durationMs);
    return () => clearTimeout(t);
  }, [
    LANES, SPARKS, clash, durationMs, flash, gate, hapticsOnClash, intro,
    laneProgress, logo, preset.showClash, preset.showGates, runExit, shake, sparkProgress, tier,
  ]);

  const { gateLeftX, gateRightX } = hudGateInterpolations(gate);
  const logoScale = logo.interpolate({ inputRange: [0, 0.72, 1], outputRange: [2.4, 0.9, 1] });
  const logoOpacity = logo.interpolate({ inputRange: [0, 0.12, 0.88, 1], outputRange: [0, 1, 1, 0.95] });
  const logoY = intro.interpolate({ inputRange: [0, 1], outputRange: [24, -12] });
  const shakeX = shake.interpolate({ inputRange: [-1, 0, 1], outputRange: [-10, 0, 10] });
  const ringScale = clash.interpolate({ inputRange: [0, 0.24, 1], outputRange: [0.2, 1, 4.4] });
  const ringOpacity = clash.interpolate({ inputRange: [0, 0.2, 0.82, 1], outputRange: [0, 1, 0.38, 0] });
  const laneOpacity = intro.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.75, 0.96] });
  const scanY = hudScanY(intro);

  const eyebrow = eyebrowOverride ?? preset.eyebrow;
  const title = titleOverride ?? preset.title;
  const subtitle = subtitleOverride ?? preset.subtitle;
  const iconLeft = preset.iconLeft ?? 'car-sports';
  const iconRight = preset.iconRight ?? 'car-sports';

  return (
    <Pressable style={styles.root} onPress={runExit}>
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 900, opacity: exitFade, backgroundColor: '#010101' }]}>
        <LinearGradient colors={preset.bgGradient} style={StyleSheet.absoluteFill} />
        <HudGridLayer progress={intro} accents={preset.accents} />
        <HudScanLine intro={intro} laneOpacity={laneOpacity} scanY={scanY} cyan={CYAN} />

        {LANES.map((line, i) => <HudLaneLine key={i} line={line} progress={laneProgress[i]} />)}
        {SPARKS.map((spark, i) => <HudSpark key={i} spark={spark} progress={sparkProgress[i]} />)}

        {preset.showGates && (
          <HudGatePanels
            gateLeftX={gateLeftX}
            gateRightX={gateRightX}
            leftGradient={preset.gateLeftGradient}
            rightGradient={preset.gateRightGradient}
            leftBorder={RED}
            rightBorder={GOLD}
          />
        )}

        <View style={styles.center}>
          <Animated.View
            style={{
              alignItems: 'center',
              opacity: logoOpacity,
              transform: [{ translateX: shakeX }, { translateY: logoY }, { scale: logoScale }],
            }}
          >
            {centerContent ?? (
              <>
                <Text style={styles.eyebrow}>{eyebrow}</Text>
                {preset.showVsRow && (
                  <View style={styles.vsRow}>
                    <LinearGradient colors={[RED, `${RED}66`]} style={[styles.sideBadge, { borderColor: RED }]}>
                      <MaterialCommunityIcons name={iconLeft as any} size={22} color={WHITE} />
                    </LinearGradient>
                    <LinearGradient colors={[RED, GOLD]} style={styles.vsCore}>
                      <Text style={styles.vsText}>VS</Text>
                    </LinearGradient>
                    <LinearGradient colors={[`${GOLD}66`, GOLD]} style={[styles.sideBadge, { borderColor: GOLD }]}>
                      <MaterialCommunityIcons name={iconRight as any} size={22} color="#111" />
                    </LinearGradient>
                  </View>
                )}
                <Text style={[styles.title, { textShadowColor: RED }]}>{title}</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
              </>
            )}
          </Animated.View>

          {preset.showClash && (
            <HudClashRings colors={[GOLD, RED, CYAN]} ringOpacity={ringOpacity} ringScale={ringScale} />
          )}
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
    shadowColor: '#FFD700',
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
