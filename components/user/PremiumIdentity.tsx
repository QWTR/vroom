import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../contexts/ThemeContext';

export type PremiumVisual = {
  preset: string;
  accentColors: [string, string];
  nickColor: string;
  avatarFramePreset: string;
  ringGradient: { colors: [string, string]; start?: { x: number; y: number }; end?: { x: number; y: number } };
  ringAnimation: 'none' | 'rotate' | 'pulse' | 'breathe';
  shopFrameId?: string | null;
  visualVersion: string;
};

export type PublicUserIdentity = {
  id: number;
  username: string;
  avatarUrl?: string | null;
  isPremium?: boolean;
  isAdmin?: boolean;
  premiumVisual?: PremiumVisual | null;
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => active && setReduced(value));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

function colors(user: Partial<PublicUserIdentity>, fallback: string): [string, string] {
  const value = user.premiumVisual?.accentColors;
  return user.isPremium && Array.isArray(value) && value.length === 2 ? value : [fallback, fallback];
}

export const PremiumAvatar = memo(function PremiumAvatar({
  user,
  size = 42,
  representative = false,
  style,
}: {
  user: PublicUserIdentity;
  size?: number;
  representative?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const reducedMotion = useReducedMotion();
  const animation = useRef(new Animated.Value(0)).current;
  const accent = colors(user, user.isPremium && !user.isAdmin ? theme.primary : theme.border2);
  const animate = representative && user.isPremium && !reducedMotion && user.premiumVisual?.ringAnimation !== 'none';

  useEffect(() => {
    if (!animate) { animation.stopAnimation(); animation.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(animation, { toValue: 1, duration: 1300, useNativeDriver: true }),
      Animated.timing(animation, { toValue: 0, duration: 1300, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animate, animation, user.premiumVisual?.visualVersion]);

  const animatedStyle = animate ? {
    opacity: animation.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }),
    transform: [{ scale: animation.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] }) }],
  } : undefined;
  return (
    <Animated.View style={[{ width: size + 6, height: size + 6 }, animatedStyle, style]}>
      <LinearGradient
        colors={accent}
        start={user.premiumVisual?.ringGradient?.start ?? { x: 0, y: 0 }}
        end={user.premiumVisual?.ringGradient?.end ?? { x: 1, y: 1 }}
        style={[styles.ring, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, padding: user.isPremium ? 2.5 : 1.5 }]}
      >
        <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.surface2 }]}>
          {user.avatarUrl ? <Image source={{ uri: user.avatarUrl }} style={{ width: size, height: size }} /> : (
            <Text style={{ color: user.premiumVisual?.nickColor ?? theme.text, fontWeight: '800', fontSize: Math.max(10, size * 0.3) }}>
              {(user.username || '?').slice(0, 2).toUpperCase()}
            </Text>
          )}
        </View>
      </LinearGradient>
    </Animated.View>
  );
});

export const PremiumName = memo(function PremiumName({ user, style, numberOfLines = 1, suffix = '' }: {
  user: PublicUserIdentity;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  suffix?: string;
}) {
  const { theme } = useTheme();
  const premiumColor = user.isPremium && !user.isAdmin ? (user.premiumVisual?.nickColor ?? theme.text) : null;
  return <Text numberOfLines={numberOfLines} style={[style, premiumColor ? { color: premiumColor } : null]}>{user.username}{suffix}</Text>;
});

export function PremiumUserSurface({ user, children, style, representative = false }: {
  user: PublicUserIdentity;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  representative?: boolean;
}) {
  const { theme } = useTheme();
  const accent = colors(user, theme.border2)[0];
  const surface = user.isPremium && !user.isAdmin
    ? { borderColor: `${accent}55`, borderWidth: 1, backgroundColor: `${accent}0B` }
    : undefined;
  return <View style={[style, surface, representative && user.isPremium ? styles.representative : undefined]}>{children}</View>;
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
  avatar: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  representative: { shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
});
