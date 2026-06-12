import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  getHeroBannerAspectRatio,
  resolveBannerContentPosition,
} from '../../lib/profileBanner';
import type { ProfileBannerFocusPoint } from '../../constants/profilePremiumExtras';

type GradientSpec = {
  colors: string[];
  start: { x: number; y: number };
  end: { x: number; y: number };
};

type Props = {
  uri?: string | null;
  gradient?: GradientSpec | null;
  focusPoint?: ProfileBannerFocusPoint | null;
  overlayColors?: string[] | null;
  /** Pełnoekranowy hero — ignoruje aspectRatio 21:9 (np. 70% wysokości ekranu). */
  fixedHeight?: number;
  style?: ViewStyle;
};

/** Kontener banera profilu — cover + focus point; 21:9 w podglądzie, fixedHeight w hero. */
export function ProfileHeroBannerFrame({
  uri,
  gradient,
  focusPoint = 'center',
  overlayColors,
  fixedHeight,
  style,
}: Props) {
  const frameStyle = fixedHeight != null
    ? { width: '100%' as const, height: fixedHeight, overflow: 'hidden' as const }
    : { width: '100%' as const, aspectRatio: getHeroBannerAspectRatio(), overflow: 'hidden' as const };

  return (
    <View style={[frameStyle, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition={resolveBannerContentPosition(focusPoint)}
          cachePolicy="memory-disk"
          transition={200}
        />
      ) : gradient ? (
        <LinearGradient
          colors={gradient.colors as [string, string, ...string[]]}
          start={gradient.start}
          end={gradient.end}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {!!uri && !!overlayColors?.length && (
        <LinearGradient
          colors={overlayColors as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
}

export default ProfileHeroBannerFrame;
