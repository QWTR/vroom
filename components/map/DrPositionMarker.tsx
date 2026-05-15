import React, { memo, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Mapbox from '@rnmapbox/maps';
import type { LocationState } from '../../constants/types';
import { normalizeMediaUri } from '../../lib/mediaUri';

const DR_STALE_MS = 4_000;
const MARKER_SIZE = 40;
const AVATAR_INNER = 34;
const MARKER_BORDER = 2;
const FALLBACK_DOT = 18;

export interface DrPositionMarkerProps {
  active: boolean;
  drLatRef: React.MutableRefObject<number>;
  drLngRef: React.MutableRefObject<number>;
  drHdgRef: React.MutableRefObject<number>;
  drLastFrameAtRef: React.MutableRefObject<number>;
  userLocation: LocationState;
  fallbackHeading: number;
  /** ViewShot PNG (strzałka / legacy). */
  imageUri?: string | null;
  /** Bezpośredni URL avatara — preferowany dla markera profilowego. */
  avatarUrl?: string | null;
}

export const DrPositionMarker = memo(function DrPositionMarker({
  active,
  drLatRef,
  drLngRef,
  drHdgRef,
  drLastFrameAtRef,
  userLocation,
  fallbackHeading,
  imageUri,
  avatarUrl,
}: DrPositionMarkerProps) {
  const [snapshotFailed, setSnapshotFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const mediaAvatar = normalizeMediaUri(avatarUrl);

  useEffect(() => {
    setSnapshotFailed(false);
  }, [imageUri]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [mediaAvatar]);

  const drFresh =
    active &&
    Number.isFinite(drLatRef.current) &&
    Number.isFinite(drLngRef.current) &&
    drLatRef.current !== 0 &&
    drLngRef.current !== 0 &&
    Date.now() - drLastFrameAtRef.current <= DR_STALE_MS;

  const lat = drFresh ? drLatRef.current : userLocation.latitude;
  const lng = drFresh ? drLngRef.current : userLocation.longitude;

  const hdg =
    drFresh && drHdgRef.current !== 0
      ? drHdgRef.current
      : fallbackHeading;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const showAvatar = !!mediaAvatar && !avatarFailed;
  const showSnapshot = !!imageUri && !snapshotFailed && !showAvatar;

  const markerTransform = { transform: [{ rotate: `${hdg}deg` }] as const };

  return (
    <Mapbox.MarkerView
      coordinate={[lng, lat]}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlapWithPuck
      allowOverlap
    >
      {showAvatar ? (
        <View style={[{ width: MARKER_SIZE, height: MARKER_SIZE, alignItems: 'center', justifyContent: 'center' }, markerTransform]}>
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
        </View>
      ) : showSnapshot ? (
        <Image
          source={{ uri: imageUri! }}
          style={{ width: MARKER_SIZE, height: MARKER_SIZE, ...markerTransform }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
          onError={() => setSnapshotFailed(true)}
        />
      ) : (
        <View
          style={{
            width: FALLBACK_DOT,
            height: FALLBACK_DOT,
            borderRadius: FALLBACK_DOT / 2,
            backgroundColor: '#e33835',
            borderWidth: 1.5,
            borderColor: '#fff',
            ...markerTransform,
          }}
        />
      )}
    </Mapbox.MarkerView>
  );
});
