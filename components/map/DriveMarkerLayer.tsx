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
import { driveTraceMarkerUi } from '../../lib/driveSessionTrace';
import { normalizeMediaUri } from '../../lib/mediaUri';

const MARKER_SIZE = 40;
const AVATAR_INNER = 34;
const MARKER_BORDER = 2;
const FALLBACK_DOT = 22;
/** W trybie jazdy — aktualizuj współrzędne co ~16 ms (bez COORD_EPS). */
const COORD_COMMIT_MIN_MS = 16;

type Props = {
  enabled: boolean;
  marker: DriveMarkerValues;
  imageUri?: string | null;
  avatarUrl?: string | null;
  cursorSkin?: { imageUrl?: string; borderColor?: string } | null;
};

/**
 * MarkerView 40px — pozycja + rotacja z Reanimated SharedValues (SSOT V2).
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
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [snapshotFailed, setSnapshotFailed] = useState(false);
  const lastRef = useRef({ lat: 0, lng: 0 });
  const lastCommitAtRef = useRef(0);

  const commitCoordinate = useCallback((la: number, ln: number) => {
    const now = Date.now();
    if (now - lastCommitAtRef.current < COORD_COMMIT_MIN_MS) return;
    const prev = lastRef.current;
    if (Math.abs(la - prev.lat) < 1e-9 && Math.abs(ln - prev.lng) < 1e-9) {
      return;
    }
    const prevCommitAt = lastCommitAtRef.current;
    lastCommitAtRef.current = now;
    const moveM = Math.sqrt(
      ((la - prev.lat) * 111320) ** 2
      + ((ln - prev.lng) * 111320 * Math.cos((la * Math.PI) / 180)) ** 2,
    );
    lastRef.current = { lat: la, lng: ln };
    setCoordinate([ln, la]);
    setHasCoord(true);
    driveTraceMarkerUi({
      lat: la,
      lng: ln,
      moveM,
      msSinceLast: prevCommitAt > 0 ? now - prevCommitAt : null,
    });
  }, []);

  useAnimatedReaction(
    () => {
      if (!enabled) return null;
      const la = marker.lat.value;
      const ln = marker.lng.value;
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
      return { lat: la, lng: ln };
    },
    (next) => {
      if (!next) return;
      runOnJS(commitCoordinate)(next.lat, next.lng);
    },
    [enabled, commitCoordinate],
  );

  useEffect(() => {
    if (!enabled) {
      setHasCoord(false);
      lastCommitAtRef.current = 0;
      return;
    }
    const la = marker.lat.value;
    const ln = marker.lng.value;
    if (Number.isFinite(la) && Number.isFinite(ln)) {
      lastCommitAtRef.current = 0;
      commitCoordinate(la, ln);
    }
  }, [enabled, marker.lat, marker.lng, commitCoordinate]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  useEffect(() => {
    setSnapshotFailed(false);
  }, [imageUri]);

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
  const showAvatar = !!mediaAvatar && !avatarFailed && !showSkin;
  const showSnapshot = !!imageUri && !snapshotFailed && !showAvatar && !showSkin;

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
            onError={() => setAvatarFailed(true)}
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
          onError={() => setSnapshotFailed(true)}
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
