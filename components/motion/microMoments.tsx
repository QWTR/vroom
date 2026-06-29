import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type Props = {
  visible: boolean;
  color?: string;
  onDone?: () => void;
};

/** Micro shockwave pulse on voted card — ~200ms */
export function VoteCastPulse({ visible, color = '#e33835', onDone }: Props) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0.4);
    opacity.setValue(0.8);
    Animated.parallel([
      Animated.timing(scale, { toValue: 2.2, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => onDone?.());
  }, [visible, scale, opacity, onDone]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={{
          position: 'absolute',
          alignSelf: 'center',
          top: '40%',
          width: 120,
          height: 120,
          borderRadius: 60,
          borderWidth: 3,
          borderColor: color,
          opacity,
          transform: [{ scale }],
        }}
      />
    </View>
  );
}

type NavProps = {
  visible: boolean;
  onDone?: () => void;
};

/** Top HUD bar flash when navigation starts */
export function NavStartHudBar({ visible, onDone }: NavProps) {
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(-80);
    opacity.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]),
      Animated.delay(400),
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => onDone?.());
  }, [visible, translateY, opacity, onDone]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 56,
        opacity,
        transform: [{ translateY }],
        zIndex: 999,
      }}
    >
      <LinearGradient
        colors={['#e3383540', '#e3383510', 'transparent']}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

type StreakProps = {
  visible: boolean;
  streak: number;
  onDone?: () => void;
};

/** Milestone unlock flash for streak 7/30/100 */
export function StreakUnlockFx({ visible, streak, onDone }: StreakProps) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const isMilestone = streak === 7 || streak === 30 || streak === 100 || streak % 50 === 0;
    if (!isMilestone) {
      onDone?.();
      return;
    }
    scale.setValue(0.3);
    opacity.setValue(0.9);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1.8, useNativeDriver: true, damping: 8, stiffness: 120 }),
      Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start(() => onDone?.());
  }, [visible, streak, scale, opacity, onDone]);

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
      <Animated.View
        style={{
          width: 160,
          height: 160,
          borderRadius: 80,
          borderWidth: 3,
          borderColor: '#FFD700',
          opacity,
          transform: [{ scale }],
        }}
      />
    </View>
  );
}
