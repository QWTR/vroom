import Mapbox from '@rnmapbox/maps';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { formatLiveMarkerUsername, liveUserMarkerMetrics } from '../../lib/liveUserMarkerUi';
import {
  useLiveUserMeta,
  useLiveUserPosition,
  type LiveMapStore,
} from '../../hooks/liveMapStore';

type Props = {
  store: LiveMapStore;
  userId: number;
  zoom: number;
  onPress: (userId: number) => void;
};

function useSmoothCoordinate(
  target: [number, number] | null,
  animate: boolean,
): [number, number] | null {
  const [displayed, setDisplayed] = useState<[number, number] | null>(target);
  const displayedRef = useRef<[number, number] | null>(target);
  const targetLng = target?.[0] ?? null;
  const targetLat = target?.[1] ?? null;

  useEffect(() => {
    if (targetLng == null || targetLat == null) {
      displayedRef.current = null;
      setDisplayed(null);
      return;
    }
    const nextTarget: [number, number] = [targetLng, targetLat];
    const start = displayedRef.current;
    if (!start || !animate) {
      displayedRef.current = nextTarget;
      setDisplayed(nextTarget);
      return;
    }
    if (start[0] === nextTarget[0] && start[1] === nextTarget[1]) return;

    let frame = 0;
    let cancelled = false;
    let lastCommit = 0;
    const startedAt = Date.now();
    const durationMs = 520;

    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - ((1 - progress) ** 3);
      const next: [number, number] = [
        start[0] + ((nextTarget[0] - start[0]) * eased),
        start[1] + ((nextTarget[1] - start[1]) * eased),
      ];
      displayedRef.current = next;
      if (progress >= 1 || now - lastCommit >= 34) {
        lastCommit = now;
        setDisplayed(next);
      }
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [animate, targetLat, targetLng]);

  return displayed;
}

export const LiveUserMapMarker = memo(function LiveUserMapMarker({
  store,
  userId,
  zoom,
  onPress,
}: Props) {
  const meta = useLiveUserMeta(store, userId);
  const position = useLiveUserPosition(store, userId);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarUri = normalizeMediaUri(meta?.avatarUrl);
  const frameUri = normalizeMediaUri(meta?.avatarFrameUrl);
  const targetCoordinate = position
    ? [position.lng, position.lat] as [number, number]
    : null;
  const coordinate = useSmoothCoordinate(
    targetCoordinate,
    meta?.motionTier === 'full' || meta?.isFriend === true,
  );

  useEffect(() => setAvatarFailed(false), [avatarUri]);

  const metrics = useMemo(() => liveUserMarkerMetrics(zoom), [zoom]);
  const username = formatLiveMarkerUsername(meta?.username ?? 'Użytkownik');
  const initials = username.slice(0, 2).toUpperCase();
  const premium = meta?.isPremium === true;
  const friend = meta?.isFriend === true;
  const stale = meta?.stale === true;
  const accentColors = premium && meta?.premiumVisual?.accentColors?.length === 2
    ? meta.premiumVisual.accentColors
    : friend
      ? ['#4DE926', '#21B93B'] as [string, string]
      : ['#AAB3C2', '#697386'] as [string, string];
  const nameColor = premium
    ? (meta?.premiumVisual?.nickColor ?? '#FFD447')
    : '#F7FAFF';
  const frameItem: ShopCosmeticItem | null = frameUri
    ? {
        id: `live_${userId}`,
        name: 'Ozdoba Nitro',
        category: 'avatar_frame',
        assetUrl: frameUri,
      }
    : null;
  const ringSize = metrics.avatar + 5;
  const decorationStage = metrics.avatar * 1.3;
  const handlePress = useCallback(() => onPress(userId), [onPress, userId]);

  if (!meta || !coordinate) return null;

  return (
    <Mapbox.MarkerView
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.34 }}
      allowOverlap
      allowOverlapWithPuck
    >
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={handlePress}
        style={[styles.touchTarget, stale && styles.stale]}
      >
        <View style={[styles.avatarStage, { width: decorationStage, height: decorationStage }]}>
          <LinearGradient
            colors={accentColors}
            start={meta.premiumVisual?.ringGradient?.start ?? { x: 0, y: 0 }}
            end={meta.premiumVisual?.ringGradient?.end ?? { x: 1, y: 1 }}
            style={{
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              padding: premium ? 2.2 : 1.5,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: metrics.avatar,
                height: metrics.avatar,
                borderRadius: metrics.avatar / 2,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#141922',
              }}
            >
              <Text style={[styles.initials, { fontSize: metrics.avatar * 0.29, color: nameColor }]}>
                {initials}
              </Text>
              {avatarUri && !avatarFailed ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={100}
                  onError={() => setAvatarFailed(true)}
                />
              ) : null}
            </View>
          </LinearGradient>
          <ShopAvatarDecoration item={frameItem} size={metrics.avatar} />
          <View style={[styles.onlineDot, stale && styles.staleDot]} />
        </View>

        <View
          style={[
            styles.label,
            {
              width: metrics.labelWidth,
              borderColor: premium ? `${accentColors[0]}90` : friend ? '#4DE92670' : '#FFFFFF22',
            },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[styles.name, { color: nameColor, fontSize: metrics.nameSize }]}
          >
            {username}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, stale && styles.staleDot]} />
            <Text
              numberOfLines={1}
              style={[
                styles.status,
                {
                  color: stale ? '#8D96A4' : premium ? '#FFD447' : '#4DE926',
                  fontSize: metrics.statusSize,
                },
              ]}
            >
              {stale ? 'OSTATNIO' : premium ? 'PREMIUM · LIVE' : 'LIVE'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});

const styles = StyleSheet.create({
  touchTarget: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  stale: {
    opacity: 0.58,
  },
  avatarStage: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  initials: {
    fontFamily: 'Manrope_700Bold',
    fontWeight: '800',
  },
  onlineDot: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#070A0E',
    backgroundColor: '#38E54D',
    zIndex: 20,
  },
  staleDot: {
    backgroundColor: '#7D8794',
  },
  label: {
    marginTop: -1,
    minHeight: 27,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#070A0EEB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  name: {
    width: '100%',
    fontFamily: 'Manrope_700Bold',
    fontWeight: '800',
    lineHeight: 13,
    textAlign: 'center',
  },
  statusRow: {
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  statusDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#38E54D',
  },
  status: {
    fontFamily: 'Manrope_700Bold',
    fontWeight: '900',
    letterSpacing: 0.45,
    lineHeight: 10,
  },
});
