import React, { memo, useCallback, useMemo, useState } from 'react';
import { View, PixelRatio, Platform } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import type { DriveMarkerV3Values } from '../../hooks/useDriveMarkerV3';
import {
  DRIVE_MARKER_IMAGE_KEY,
  DriveMarkerSpriteCapture,
} from './DriveMarkerSpriteCapture';
import {
  DRIVE_MARKER_SPRITE_SIZE,
  type DriveMarkerSpriteData,
} from './DriveMarkerSpriteVisual';

/** Tekstura capture: DRIVE_MARKER_SPRITE_SIZE × PixelRatio (px urządzenia). */
const MARKER_TEXTURE_PX = DRIVE_MARKER_SPRITE_SIZE * PixelRatio.get();
/** Docelowy rozmiar markera na ekranie [pt] — ~40 pt. */
const MARKER_SCREEN_PT = DRIVE_MARKER_SPRITE_SIZE;
/** Twardy sufit przy zoom out — nigdy więcej niż ~44 pt na ekranie. */
const ICON_SIZE_NORMAL = MARKER_SCREEN_PT / MARKER_TEXTURE_PX;
const TRIP_MARKER_ICON_SIZE = ICON_SIZE_NORMAL;

const EMPTY_SHAPE = {
  type: 'FeatureCollection' as const,
  features: [],
};

/** Min. zmiana pozycji (~2 cm) zanim odświeżamy GeoJSON — płynny slide bez ~1 m skoków. */
function spriteCacheKey(data: DriveMarkerSpriteData): string {
  return [
    data.avatarUrl ?? '',
    data.imageUri ?? '',
    data.cursorSkin?.imageUrl ?? '',
    data.cursorSkin?.borderColor ?? '',
  ].join('|');
}

let lastSpriteCache: { key: string; uri: string } | null = null;

type Props = {
  enabled: boolean;
  marker: DriveMarkerV3Values;
  imageUri?: string | null;
  avatarUrl?: string | null;
  cursorSkin?: { imageUrl?: string; borderColor?: string } | null;
};

/**
 * Trip marker — ShapeSource + SymbolLayer + dynamiczny sprite (ViewShot → Mapbox.Images).
 * Bez MarkerView; współrzędne z SharedValues przez animatedProps.
 */
export const DriveMarkerLayer = memo(function DriveMarkerLayer({
  enabled,
  imageUri,
  avatarUrl,
  cursorSkin,
}: Props) {
  const spriteData = useMemo<DriveMarkerSpriteData>(() => ({
    avatarUrl,
    imageUri,
    cursorSkin,
  }), [avatarUrl, imageUri, cursorSkin?.imageUrl, cursorSkin?.borderColor]);

  const cacheKey = spriteCacheKey(spriteData);
  const [capturedUri, setCapturedUri] = useState<string | null>(() => {
    if (lastSpriteCache?.key === cacheKey) return lastSpriteCache.uri;
    return null;
  });

  const handleCapture = useCallback((uri: string) => {
    lastSpriteCache = { key: cacheKey, uri };
    setCapturedUri(uri);
  }, [cacheKey]);

  const textureUri = capturedUri ?? imageUri ?? null;

  if (!enabled) return null;

  return (
    <>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden' }}
      >
        <DriveMarkerSpriteCapture
          data={spriteData}
          onCapture={handleCapture}
        />
      </View>

      {textureUri ? (
        <Mapbox.Images
          images={{
            [DRIVE_MARKER_IMAGE_KEY]: { uri: textureUri },
          }}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        textureUri ? (
          <Mapbox.SymbolLayer
            id="tripDriveMarkerSymbol"
            sourceID="tripDriveMarkerSource"
            style={{
              iconImage: DRIVE_MARKER_IMAGE_KEY,
              iconSize: TRIP_MARKER_ICON_SIZE,
              /** map: heading aligns with the map roads */
              iconRotate: ['get', 'heading'],
              iconPitchAlignment: 'map',
              iconRotationAlignment: 'map',
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconAnchor: 'center',
              iconOptional: false,
            }}
          />
        ) : null
      ) : (
        <Mapbox.ShapeSource
          id="tripDriveMarkerSource"
          shape={EMPTY_SHAPE}
        >
          {textureUri ? (
            <Mapbox.SymbolLayer
              id="tripDriveMarkerSymbol"
              style={{
                iconImage: DRIVE_MARKER_IMAGE_KEY,
                iconSize: TRIP_MARKER_ICON_SIZE,
                iconRotate: ['get', 'heading'],
                iconPitchAlignment: 'map',
                iconRotationAlignment: 'map',
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                iconAnchor: 'center',
                iconOptional: false,
              }}
            />
          ) : (
          <Mapbox.CircleLayer
            id="tripDriveMarkerFallback"
            style={{
              circleRadius: 9,
              circleColor: '#e33835',
              circleStrokeWidth: 2.5,
              circleStrokeColor: '#ffffff',
              circlePitchAlignment: 'map',
            }}
          />
          )}
        </Mapbox.ShapeSource>
      )}
    </>
  );
});

export { DRIVE_MARKER_SPRITE_SIZE };
