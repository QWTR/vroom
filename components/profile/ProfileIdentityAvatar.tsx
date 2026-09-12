import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '../ui/AppText';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import type { ProfilePremiumExtras } from '../../constants/profilePremiumExtras';
import { linearGradientFromSpec } from './profileGradientUtils';

const frames: Record<string, string[]> = {
  vroom: ['#e33835', '#268bff', '#4de926', '#e33835'],
  sunrise: ['#ff6b35', '#f5c518', '#ff6b35'],
  ocean: ['#38a5e3', '#1b6eff', '#38a5e3'],
  lime: ['#4de926', '#a6ff4d', '#4de926'],
};

/** The same saved ring and shop decoration in owner and visitor views. */
export function ProfileIdentityAvatar({ uri, username, premium, preset, extras, decoration, theme }: {
  uri?: string | null;
  username: string;
  premium: boolean;
  preset?: string;
  extras?: ProfilePremiumExtras | null;
  decoration?: ShopCosmeticItem | null;
  theme: { text: string; surface: string; border: string };
}) {
  const motion = useRef(new Animated.Value(0)).current;
  const mode = premium ? extras?.avatarRingAnim : 'none';
  const ring = linearGradientFromSpec(extras?.avatarRingGradient, frames[preset ?? 'vroom'] ?? frames.vroom);
  useEffect(() => {
    motion.setValue(0);
    if (!mode || mode === 'none') return;
    const loop = Animated.loop(mode === 'rotate'
      ? Animated.timing(motion, { toValue: 1, duration: 6400, easing: Easing.linear, useNativeDriver: true })
      : Animated.sequence([
        Animated.timing(motion, { toValue: 1, duration: mode === 'pulse' ? 650 : 1100, useNativeDriver: true }),
        Animated.timing(motion, { toValue: 0, duration: mode === 'pulse' ? 650 : 1100, useNativeDriver: true }),
      ]));
    loop.start();
    return () => loop.stop();
  }, [mode, motion]);
  return (
    <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {premium && ring && <Animated.View pointerEvents="none" style={{ position: 'absolute', width: 96, height: 96, borderRadius: 48,
        opacity: mode === 'pulse' ? motion.interpolate({ inputRange: [0, 1], outputRange: [1, 0.48] }) : 1,
        transform: [
          { rotate: mode === 'rotate' ? motion.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) : '0deg' },
          { scale: mode === 'breathe' ? motion.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) : 1 },
        ] }}>
        <LinearGradient colors={ring.colors as [string, string, ...string[]]} start={ring.start} end={ring.end} style={{ width: 96, height: 96, borderRadius: 48 }} />
      </Animated.View>}
      <View style={{ width: 88, height: 88, borderRadius: 44, overflow: 'hidden', backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.border }}>
        {uri ? <Image accessibilityLabel={`Avatar ${username}`} source={{ uri }} style={{ width: 88, height: 88 }} />
          : <Text style={{ color: theme.text, fontSize: 28, fontWeight: '800' }}>{username.slice(0, 2).toUpperCase()}</Text>}
      </View>
      <ShopAvatarDecoration item={decoration} size={96} />
    </View>
  );
}
