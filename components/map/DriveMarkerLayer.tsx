import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Mapbox from '@rnmapbox/maps';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';
import type { DriveMarkerValues } from '../../hooks/useDriveMarker';
import { normalizeMediaUri } from '../../lib/mediaUri';

const MARKER_SIZE = 40;
const AVATAR_INNER = 34;
const MARKER_BORDER = 2;
const FALLBACK_DOT = 22;
const COORD_EPS = 1e-7;

type Props = {
  enabled: boolean;
  marker: DriveMarkerValues;
  imageUri?: string | null;
  avatarUrl?: string | null;
  cursorSkin?: { imageUrl?: string; borderColor?: string } | null;
};

/**
 * MarkerView 40px — stabilny wygląd (avatar / skin / snapshot).
 * Pozycja: useAnimatedReaction + COORD_EPS; rotacja: useAnimatedStyle.
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
  const lastRef = useRef({ lat: 0, lng: 0 });

  const commitCoordinate = useCallback((la: number, ln: number) => {
    const prev = lastRef.current;
    if (Math.abs(la - prev.lat) <= COORD_EPS && Math.abs(ln - prev.lng) <= COORD_EPS) {
      return;
    }
    lastRef.current = { lat: la, lng: ln };
    setCoordinate([ln, la]);
    setHasCoord(true);
  }, []);

  useAnimatedReaction(
    () => {
      if (!enabled) return null;
      const la = marker.lat.value;
      const ln = marker.lng.value;
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
      return { lat: la, lng: ln };
    },
    (next, prev) => {
      if (!next) return;
      if (
        prev
        && Math.abs(next.lat - prev.lat) <= COORD_EPS
        && Math.abs(next.lng - prev.lng) <= COORD_EPS
      ) {
        return;
      }
      runOnJS(commitCoordinate)(next.lat, next.lng);
    },
    [enabled, commitCoordinate],
  );

  useEffect(() => {
    if (!enabled) {
      setHasCoord(false);
      return;
    }
    const la = marker.lat.value;
    const ln = marker.lng.value;
    if (Number.isFinite(la) && Number.isFinite(ln)) {
      commitCoordinate(la, ln);
    }
  }, [enabled, marker.lat, marker.lng, commitCoordinate]);

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
