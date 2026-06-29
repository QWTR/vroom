import React from 'react';
import { StyleSheet, View, type ImageStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import LottieView from 'lottie-react-native';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { isNativeLottieAvailable } from '../../lib/nativeLottie';

type Props = {
  item: ShopCosmeticItem | null | undefined;
  pointerEvents?: 'none' | 'auto';
  style?: ViewStyle;
  contentStyle?: ImageStyle;
  fallbackIcon?: React.ReactNode;
};

function readNumber(meta: unknown, key: string, fallback: number) {
  if (!meta || typeof meta !== 'object') return fallback;
  const value = (meta as Record<string, unknown>)[key];
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readLoop(meta: unknown, fallback = true) {
  if (!meta || typeof meta !== 'object') return fallback;
  const value = (meta as Record<string, unknown>).loop;
  return value === false || value === 'false' ? false : fallback;
}

export function getAnimationMeta(item: ShopCosmeticItem | null | undefined) {
  const meta = item?.metadata;
  return {
    durationMs: readNumber(meta, 'durationMs', item?.assetKind === 'gif' ? 2200 : 1800),
    widthPct: readNumber(meta, 'widthPct', 100),
    heightPct: readNumber(meta, 'heightPct', 55),
    topPct: readNumber(meta, 'topPct', 18),
    dimOpacity: readNumber(meta, 'dimOpacity', 0.55),
    loop: readLoop(meta, true),
  };
}

export default function ProfileAnimationLayer({
  item,
  pointerEvents = 'none',
  style,
  contentStyle,
  fallbackIcon,
}: Props) {
  const uri = normalizeMediaUri(item?.assetUrl);
  if (!item || !uri) return null;
  const kind = String(item.assetKind || '').toLowerCase();
  const meta = getAnimationMeta(item);
  const frameStyle: ImageStyle = {
    width: `${meta.widthPct}%` as `${number}%`,
    height: `${meta.heightPct}%` as `${number}%`,
    alignSelf: 'center',
    marginTop: `${meta.topPct}%` as `${number}%`,
  };

  return (
    <View pointerEvents={pointerEvents} style={[StyleSheet.absoluteFill, style]}>
      {kind === 'lottie' && isNativeLottieAvailable() ? (
        <LottieView
          source={{ uri } as any}
          autoPlay
          loop={meta.loop}
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
