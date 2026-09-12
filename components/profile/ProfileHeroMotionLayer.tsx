import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { ProfileHeroMotion } from '../../constants/profilePremiumExtras';
import {
  AuroraSkiaEffect,
  EmbersSkiaEffect,
  GlitchSkiaOverlay,
  PulseSkiaEffect,
  ShimmerSkiaEffect,
  SkiaHeroCanvas,
  VortexSkiaEffect,
} from './motion/heroSkiaEffects';
import HeroLegacyEffects, { isLegacyHeroMotion } from './motion/heroLegacyEffects';
import { RefinedHeroMotion, REFINED_HERO_KINDS } from './motion/refinedProfileEffects';

const SCREEN_W = Dimensions.get('window').width;

type LayerProps = {
  motion: ProfileHeroMotion | undefined;
  isDark?: boolean;
  style?: StyleProp<ViewStyle>;
  screenWidth?: number;
  bannerHeight?: number;
};

function renderSkiaHero(motion: ProfileHeroMotion, size: { width: number; height: number }, isDark: boolean) {
  switch (motion) {
    case 'aurora':  return <AuroraSkiaEffect {...size} />;
    case 'vortex':  return <VortexSkiaEffect {...size} />;
    case 'embers':  return <EmbersSkiaEffect {...size} />;
    case 'glitch':  return <GlitchSkiaOverlay width={size.width} height={size.height} />;
    case 'shimmer': return <ShimmerSkiaEffect {...size} />;
    case 'pulse':   return <PulseSkiaEffect {...size} />;
    default:        return null;
  }
}

function renderPremiumHero(motion: ProfileHeroMotion) {
  return REFINED_HERO_KINDS.has(motion) ? <RefinedHeroMotion motion={motion} /> : null;
}

/** Float transform for hero container when motion === 'float'. */
export function useProfileHeroFloat(motion: ProfileHeroMotion | undefined) {
  const y = useSharedValue(0);

  useEffect(() => {
    if (motion !== 'float') return;
    y.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [motion, y]);

  return useAnimatedStyle(() => ({
    transform: motion === 'float' ? [{ translateY: y.value * -5 }] : [],
  }));
}

/** Ken Burns — Reanimated scale + pan on banner content. */
export function ProfileHeroKenBurnsWrapper({
  motion,
  children,
  style,
}: {
  motion: ProfileHeroMotion | undefined;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (motion !== 'kenburns') return;
    progress.value = withRepeat(
      withTiming(1, { duration: 18000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [motion, progress]);

  const animStyle = useAnimatedStyle(() => {
    if (motion !== 'kenburns') return {};
    return {
      flex: 1,
      transform: [
        { scale: 1 + progress.value * 0.035 },
        { translateX: progress.value * -7 },
        { translateY: progress.value * -4 },
      ],
    };
  });

  if (motion !== 'kenburns') {
    return <View style={[{ flex: 1, overflow: 'hidden' }, style]}>{children}</View>;
  }

  return (
    <View style={[{ flex: 1, overflow: 'hidden' }, style]}>
      <Animated.View style={animStyle}>{children}</Animated.View>
    </View>
  );
}

/** Premium hero motion — Skia glow + Reanimated (Discord Nitro tier). */
export default function ProfileHeroMotionLayer({
  motion,
  isDark = true,
  style,
  screenWidth = SCREEN_W,
  bannerHeight,
}: LayerProps) {
  if (!motion || motion === 'none' || motion === 'float') return null;

  const w = screenWidth;
  const premiumHero = renderPremiumHero(motion);

  if (premiumHero) {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${isDark ? 0.10 : 0.05})` }]} />
        {premiumHero}
      </View>
    );
  }

  if (isLegacyHeroMotion(motion)) {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
        <HeroLegacyEffects motion={motion} screenWidth={w} />
      </View>
    );
  }

  const skiaMotions: ProfileHeroMotion[] = ['aurora', 'vortex', 'embers', 'glitch', 'shimmer', 'pulse'];
  if (!skiaMotions.includes(motion)) return null;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${isDark ? 0.12 : 0.06})` }]} />
      <SkiaHeroCanvas width={w} height={bannerHeight}>
        {size => renderSkiaHero(motion, size, isDark)}
      </SkiaHeroCanvas>
    </View>
  );
}
