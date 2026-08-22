import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type ImageStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import LottieView from 'lottie-react-native';
import type { AppAnimation, AppAnimationLayoutMode } from '../../constants/appAnimations';
import { resolveAnimationLayoutMode } from '../../constants/appAnimations';
import { useRemoteLottieJson } from '../../hooks/useRemoteLottieJson';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { isNativeLottieAvailable } from '../../lib/nativeLottie';
import WebLottieView from './WebLottieView';
import { usePerformanceMotion } from '../../hooks/usePerformanceMotion';

type Props = {
  animation: AppAnimation | null | undefined;
  style?: ViewStyle;
  contentStyle?: ImageStyle;
  fallbackIcon?: React.ReactNode;
  /** inline = ikona; behind = warstwa pod children (tekst na wierzchu). */
  layout?: AppAnimationLayoutMode;
  children?: React.ReactNode;
};

function numberMeta(animation: AppAnimation | null | undefined, key: string, fallback: number) {
  const raw = animation?.metadata && typeof animation.metadata === 'object'
    ? (animation.metadata as Record<string, unknown>)[key]
    : undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function shouldPreferWebLottie(animation: AppAnimation | null | undefined) {
  const renderMode = animation?.metadata && typeof animation.metadata === 'object'
    ? (animation.metadata as Record<string, unknown>).renderMode
    : null;
  if (renderMode === 'web') return true;
  return [
    'home_streak',
    'community_module_icon',
    'community_daily_duel_vs',
    'home_announcement',
    'home_system_news',
    'home_buy_coffee',
    'home_premium_badge',
    'tab_active_icon',
    'app_loading_logo',
    'screen_entrance_duel',
    'screen_entrance_grid',
    'screen_entrance_public',
    'achievement_unlock',
  ].includes(String(animation?.slot || ''));
}

export default function AppAnimationLayer({
  animation,
  style,
  contentStyle,
  fallbackIcon,
  layout = 'inline',
  children,
}: Props) {
  const motion = usePerformanceMotion();
  const uri = normalizeMediaUri(animation?.assetUrl);
  const behind = resolveAnimationLayoutMode(animation, layout) === 'behind';
  const kind = String(animation?.assetKind || '').toLowerCase();
  const loop = animation?.metadata?.loop !== false;
  const canRenderNativeLottie = kind === 'lottie' && isNativeLottieAvailable();
  const preferWebLottie = kind === 'lottie' && shouldPreferWebLottie(animation);
  const [lottieFailed, setLottieFailed] = useState(false);
  const lottie = useRemoteLottieJson(
    uri,
    motion.enabled && !!animation && !!uri && (canRenderNativeLottie || preferWebLottie),
  );

  useEffect(() => {
    setLottieFailed(false);
  }, [uri]);

  if (!animation || !uri) {
    if (behind && children) {
      return <View style={[styles.wrapBehind, style]}>{children}</View>;
    }
    return <>{fallbackIcon ?? null}</>;
  }

  const widthPct = numberMeta(animation, 'widthPct', behind ? 160 : 100);
  const heightPct = numberMeta(animation, 'heightPct', behind ? 160 : 100);
  const topPct = numberMeta(animation, 'topPct', behind ? -20 : 0);
  const opacity = numberMeta(animation, 'opacity', 1);

  const inlineFrameStyle: ImageStyle = {
    width: `${widthPct}%` as `${number}%`,
    height: `${heightPct}%` as `${number}%`,
    opacity,
    alignSelf: 'center',
    marginTop: `${topPct}%` as `${number}%`,
    marginLeft: `${numberMeta(animation, 'leftPct', 0)}%` as `${number}%`,
  };

  const behindFrameStyle: ImageStyle = {
    width: widthPct,
    height: heightPct,
    opacity,
  };

  const renderAsset = (frameStyle: ImageStyle) => {
    if (!motion.enabled && (kind === 'lottie' || kind === 'gif')) return fallbackIcon ?? null;
    if (kind === 'lottie' && (canRenderNativeLottie || preferWebLottie)) {
      if (!lottie.data || lottie.failed || lottieFailed) return fallbackIcon ?? null;
      if (preferWebLottie) {
        return (
          <View style={[frameStyle, contentStyle]}>
            <WebLottieView data={lottie.data} loop={loop} style={StyleSheet.absoluteFill} />
          </View>
        );
      }
      return (
        <View style={[frameStyle, contentStyle]}>
          <LottieView
            key={uri}
            source={lottie.data as any}
            autoPlay
            loop={loop}
            resizeMode="contain"
            enableMergePathsAndroidForKitKatAndAbove
            enableSafeModeAndroid={Platform.OS === 'android'}
            onAnimationFailure={() => setLottieFailed(true)}
            style={StyleSheet.absoluteFill}
          />
        </View>
      );
    }
    if (kind === 'gif' || kind === 'image') {
      return (
        <Image
          source={{ uri }}
          style={[frameStyle, contentStyle]}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      );
    }
    return fallbackIcon ?? null;
  };

  if (behind) {
    return (
      <View pointerEvents="box-none" style={[styles.wrapBehind, style]}>
        <View pointerEvents="none" style={styles.behindLayer}>
          <View
            style={{
              position: 'absolute',
              top: `${topPct}%`,
              left: 0,
              right: 0,
              alignItems: 'center',
              overflow: 'visible',
            }}
          >
            {renderAsset(behindFrameStyle)}
          </View>
        </View>
        {children ? (
          <View pointerEvents="box-none" style={styles.foreground}>
            {children}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={[styles.wrapInline, style]}>
      {renderAsset(inlineFrameStyle)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapInline: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wrapBehind: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  behindLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'visible',
    zIndex: 0,
  },
  foreground: {
    zIndex: 2,
    alignItems: 'center',
    width: '100%',
  },
});
