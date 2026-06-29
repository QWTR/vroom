import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type ImageStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import LottieView from 'lottie-react-native';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import { useRemoteLottieJson } from '../../hooks/useRemoteLottieJson';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { isNativeLottieAvailable } from '../../lib/nativeLottie';
import WebLottieView from '../animations/WebLottieView';

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

function readRenderMode(meta: unknown) {
  if (!meta || typeof meta !== 'object') return null;
  return (meta as Record<string, unknown>).renderMode === 'web' ? 'web' : null;
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
  const kind = String(item?.assetKind || '').toLowerCase();
  const canRenderNativeLottie = kind === 'lottie' && isNativeLottieAvailable();
  const preferWebLottie = kind === 'lottie' && readRenderMode(item?.metadata) === 'web';
  const [lottieFailed, setLottieFailed] = useState(false);
  const lottie = useRemoteLottieJson(uri, !!uri && (canRenderNativeLottie || preferWebLottie));

  useEffect(() => {
    setLottieFailed(false);
  }, [uri]);

  if (!item || !uri) return null;
  const meta = getAnimationMeta(item);
  const frameStyle: ImageStyle = {
    width: `${meta.widthPct}%` as `${number}%`,
    height: `${meta.heightPct}%` as `${number}%`,
    alignSelf: 'center',
    marginTop: `${meta.topPct}%` as `${number}%`,
  };

  return (
    <View pointerEvents={pointerEvents} style={[StyleSheet.absoluteFill, style]}>
      {kind === 'lottie' && (canRenderNativeLottie || preferWebLottie) && lottie.data && !lottie.failed && !lottieFailed ? (
        <View style={[frameStyle, contentStyle]}>
          {preferWebLottie ? (
            <WebLottieView data={lottie.data} loop={meta.loop} style={StyleSheet.absoluteFill} />
          ) : (
            <LottieView
              key={uri}
              source={lottie.data as any}
              autoPlay
              loop={meta.loop}
              resizeMode="contain"
              enableMergePathsAndroidForKitKatAndAbove
              enableSafeModeAndroid={Platform.OS === 'android'}
              onAnimationFailure={() => setLottieFailed(true)}
              style={StyleSheet.absoluteFill}
            />
          )}
        </View>
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
