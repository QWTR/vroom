import React from 'react';
import { StyleSheet, View, type ImageStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import LottieView from 'lottie-react-native';
import type { AppAnimation } from '../../constants/appAnimations';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { isNativeLottieAvailable } from '../../lib/nativeLottie';

type Props = {
  animation: AppAnimation | null | undefined;
  style?: ViewStyle;
  contentStyle?: ImageStyle;
  fallbackIcon?: React.ReactNode;
};

function numberMeta(animation: AppAnimation | null | undefined, key: string, fallback: number) {
  const raw = animation?.metadata && typeof animation.metadata === 'object'
    ? (animation.metadata as Record<string, unknown>)[key]
    : undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export default function AppAnimationLayer({ animation, style, contentStyle, fallbackIcon }: Props) {
  const uri = normalizeMediaUri(animation?.assetUrl);
  if (!animation || !uri) return null;
  const kind = String(animation.assetKind || '').toLowerCase();
  const loop = animation.metadata?.loop !== false;
  const frameStyle: ImageStyle = {
    width: `${numberMeta(animation, 'widthPct', 100)}%` as `${number}%`,
    height: `${numberMeta(animation, 'heightPct', 100)}%` as `${number}%`,
    opacity: numberMeta(animation, 'opacity', 1),
    alignSelf: 'center',
    marginTop: `${numberMeta(animation, 'topPct', 0)}%` as `${number}%`,
    marginLeft: `${numberMeta(animation, 'leftPct', 0)}%` as `${number}%`,
  };

  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      {kind === 'lottie' && isNativeLottieAvailable() ? (
        <LottieView
          source={{ uri } as any}
          autoPlay
          loop={loop}
          resizeMode="contain"
          style={[frameStyle, contentStyle]}
        />
      ) : kind === 'gif' || kind === 'image' ? (
        <Image
          source={{ uri }}
          style={[frameStyle, contentStyle]}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      ) : (
        fallbackIcon ?? null
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
