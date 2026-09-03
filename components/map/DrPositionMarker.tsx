import React, { memo, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Mapbox from '@rnmapbox/maps';
import { normalizeMediaUri } from '../../lib/mediaUri';

const MARKER_SIZE = 40;
const AVATAR_INNER = 34;
const MARKER_BORDER = 2;
const FALLBACK_DOT = 22;

export interface CursorSkinOverlay {
  imageUrl?: string | null;
  borderColor?: string;
}

export interface DrPositionMarkerProps {
  latitude: number;
  longitude: number;
  heading: number;
  /** ViewShot PNG (strzałka / legacy). */
  imageUri?: string | null;
  /** Bezpośredni URL avatara — preferowany dla markera profilowego. */
  avatarUrl?: string | null;
  /** Skórka z API (premium / odblokowane) — nad avatar/strzałką. */
  cursorSkin?: CursorSkinOverlay | null;
  compact?: boolean;
}

export const DrPositionMarker = memo(function DrPositionMarker({
  latitude,
  longitude,
  heading,
  imageUri,
  avatarUrl,
  cursorSkin,
  compact = false,
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

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) < 1e-6 && Math.abs(longitude) < 1e-6) return null;

  const skinUri = normalizeMediaUri(cursorSkin?.imageUrl);
  const skinBorder = cursorSkin?.borderColor ?? '#e33835';
  const showAvatar = !!mediaAvatar && !avatarFailed && !skinUri;
  const showSnapshot = !!imageUri && !snapshotFailed && !showAvatar && !skinUri;
  const showSkin = !!skinUri;
  const hdg = Number.isFinite(heading) ? heading : 0;
  const markerTransform = { transform: [{ rotate: `${hdg}deg` }] as const };

  if (compact) {
    return (
      <Mapbox.MarkerView coordinate={[longitude, latitude]} anchor={{ x: 0.5, y: 0.5 }} allowOverlapWithPuck allowOverlap>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#e33835', borderWidth: 2.5, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 3, elevation: 4 }} />
      </Mapbox.MarkerView>
    );
  }

  return (
    <Mapbox.MarkerView
      coordinate={[longitude, latitude]}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlapWithPuck
      allowOverlap
    >
      {showSkin ? (
        <View style={[{ width: MARKER_SIZE, height: MARKER_SIZE, alignItems: 'center', justifyContent: 'center' }, markerTransform]}>
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
        </View>
      ) : showAvatar ? (
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
            borderWidth: 2,
            borderColor: '#fff',
            shadowColor: '#000',
            shadowOpacity: 0.35,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
            elevation: 4,
            ...markerTransform,
          }}
        />
      )}
    </Mapbox.MarkerView>
  );
});
