import React, { memo, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Mapbox from '@rnmapbox/maps';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import type { DriveMarkerValues } from '../../hooks/useDriveMarker';
import { normalizeMediaUri } from '../../lib/mediaUri';

const MARKER_SIZE = 40;
const AVATAR_INNER = 34;
const MARKER_BORDER = 2;
const FALLBACK_DOT = 22;

type Props = {
  enabled: boolean;
  marker: DriveMarkerValues;
  imageUri?: string | null;
  avatarUrl?: string | null;
  cursorSkin?: { imageUrl?: string; borderColor?: string } | null;
};

/**
 * Pozycja: rAF odczyt SharedValue (~60 FPS) → MarkerView — bez GeoJSON / stringify.
 * Rotacja: useAnimatedStyle na dziecku (UI thread).
 */
export const DriveMarkerLayer = memo(function DriveMarkerLayer({
  enabled,
  marker,
  imageUri,
  avatarUrl,
  cursorSkin,
}: Props) {
  const [coordinate, setCoordinate] = useState<[number, number]>([0, 0]);
  const [hasCoord, setHasCoord] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let rafId = 0;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      const la = marker.lat.value;
      const ln = marker.lng.value;
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        setCoordinate((prev) => {
          const eps = 1e-8;
          if (Math.abs(prev[0] - ln) < eps && Math.abs(prev[1] - la) < eps) {
            return prev;
          }
          return [ln, la];
        });
        setHasCoord((v) => (v ? v : true));
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, marker.lat, marker.lng]);

  const rotateStyle = useAnimatedStyle(() => {
    'worklet';
    const h = marker.heading.value;
    const deg = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
    return { transform: [{ rotate: `${deg}deg` }] };
  }, [marker.heading]);

  const mediaAvatar = normalizeMediaUri(avatarUrl);
  const skinUri = normalizeMediaUri(cursorSkin?.imageUrl);
  const skinBorder = cursorSkin?.borderColor ?? '#e33835';
  const showSkin = !!skinUri;
  const showAvatar = !!mediaAvatar && !showSkin;
  const showSnapshot = !!imageUri && !showAvatar && !showSkin;

  if (!enabled || !hasCoord) return null;

  let markerBody: React.ReactNode;
  if (showSkin) {
    markerBody = (
      <Animated.View
        style={[
          { width: MARKER_SIZE, height: MARKER_SIZE, alignItems: 'center', justifyContent: 'center' },
          rotateStyle,
        ]}
      >
        <View
          style={{
            width: MARKER_SIZE,
            height: MARKER_SIZE,
            borderRadius: MARKER_SIZE / 2,
            backgroundColor: '#111',
            borderWidth: MARKER_BORDER + 1,
            borderColor: skinBorder,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Image
            source={{ uri: skinUri }}
            style={{ width: AVATAR_INNER, height: AVATAR_INNER }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
        </View>
      </Animated.View>
    );
  } else if (showAvatar) {
    markerBody = (
      <Animated.View
        style={[
          { width: MARKER_SIZE, height: MARKER_SIZE, alignItems: 'center', justifyContent: 'center' },
          rotateStyle,
        ]}
      >
        <View
          style={{
            width: MARKER_SIZE,
            height: MARKER_SIZE,
            borderRadius: MARKER_SIZE / 2,
            backgroundColor: '#111',
            borderWidth: MARKER_BORDER,
            borderColor: '#e33835',
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Image
            source={{ uri: mediaAvatar }}
            style={{ width: AVATAR_INNER, height: AVATAR_INNER, borderRadius: AVATAR_INNER / 2 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
          />
        </View>
      </Animated.View>
    );
  } else if (showSnapshot) {
    markerBody = (
      <Animated.View style={rotateStyle}>
        <Image
          source={{ uri: imageUri! }}
          style={{ width: MARKER_SIZE, height: MARKER_SIZE }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
        />
      </Animated.View>
    );
  } else {
    markerBody = (
      <Animated.View
        style={[
          {
            width: FALLBACK_DOT,
            height: FALLBACK_DOT,
            borderRadius: FALLBACK_DOT / 2,
            backgroundColor: '#e33835',
            borderWidth: 2,
            borderColor: '#fff',
          },
          rotateStyle,
        ]}
      />
    );
  }

  return (
    <Mapbox.MarkerView
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlapWithPuck
      allowOverlap
    >
      {markerBody}
    </Mapbox.MarkerView>
  );
});
