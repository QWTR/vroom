import React, { memo, useCallback, useMemo, useState } from 'react';
import { View, PixelRatio } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import Animated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import type { DriveMarkerV3Values } from '../../hooks/useDriveMarkerV3';
import {
  DRIVE_MARKER_IMAGE_KEY,
  DriveMarkerSpriteCapture,
} from './DriveMarkerSpriteCapture';
import {
  DRIVE_MARKER_SPRITE_SIZE,
  type DriveMarkerSpriteData,
} from './DriveMarkerSpriteVisual';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);

/** Tekstura capture: DRIVE_MARKER_SPRITE_SIZE × PixelRatio (px urządzenia). */
const MARKER_TEXTURE_PX = DRIVE_MARKER_SPRITE_SIZE * PixelRatio.get();
/** Docelowy rozmiar markera na ekranie [pt] — ~40 pt. */
const MARKER_SCREEN_PT = DRIVE_MARKER_SPRITE_SIZE;
/** Twardy sufit przy zoom out — nigdy więcej niż ~44 pt na ekranie. */
const ICON_SIZE_NORMAL = MARKER_SCREEN_PT / MARKER_TEXTURE_PX;
const TRIP_MARKER_ICON_SIZE = ICON_SIZE_NORMAL;

const EMPTY_SHAPE = JSON.stringify({
  type: 'FeatureCollection',
  features: [],
});

/** Min. zmiana pozycji (~2 cm) zanim odświeżamy GeoJSON — płynny slide bez ~1 m skoków. */
const COORD_QUANT = 2e-7;
const COORD_EPS = 3e-7;

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
  marker,
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

  const lastShape = useSharedValue(EMPTY_SHAPE);
  const lastLat = useSharedValue(NaN);
  const lastLng = useSharedValue(NaN);
  const lastHdg = useSharedValue(NaN);

  const animatedShapeProps = useAnimatedProps(() => {
    'worklet';
    let la = marker.lat.value;
    let ln = marker.lng.value;
    let hdg = marker.heading.value;

    const hasValidCoords = Number.isFinite(la) && Number.isFinite(ln)
      && !(Math.abs(la) < 1e-6 && Math.abs(ln) < 1e-6);
    const hasLastCoords = Number.isFinite(lastLat.value) && Number.isFinite(lastLng.value)
      && !(Math.abs(lastLat.value) < 1e-6 && Math.abs(lastLng.value) < 1e-6);

    if (!hasValidCoords) {
      if (hasLastCoords) {
        la = lastLat.value;
        ln = lastLng.value;
      } else {
        if (lastShape.value !== EMPTY_SHAPE) {
          lastShape.value = EMPTY_SHAPE;
        }
        return { shape: EMPTY_SHAPE };
      }
    }

    la = Math.round(la / COORD_QUANT) * COORD_QUANT;
    ln = Math.round(ln / COORD_QUANT) * COORD_QUANT;
    hdg = Number.isFinite(hdg) ? Math.round(hdg * 10) / 10 : 0;

    const prevLa = lastLat.value;
    const prevLn = lastLng.value;
    const prevHdg = lastHdg.value;
    if (
      Number.isFinite(prevLa)
      && Number.isFinite(prevLn)
      && Number.isFinite(prevHdg)
      && Math.abs(la - prevLa) <= COORD_EPS
      && Math.abs(ln - prevLn) <= COORD_EPS
      && Math.abs(hdg - prevHdg) <= 0.1
    ) {
      return { shape: lastShape.value };
    }
    lastLat.value = la;
    lastLng.value = ln;
    lastHdg.value = hdg;
    const nextShape = JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ln, la] },
        properties: { heading: hdg },
      }],
    });
    lastShape.value = nextShape;
    return { shape: nextShape };
  });

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

      <ReanimatedShapeSource
        id="tripDriveMarkerSource"
        animatedProps={animatedShapeProps}
      >
        {textureUri ? (
          <Mapbox.SymbolLayer
            id="tripDriveMarkerSymbol"
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
      </ReanimatedShapeSource>
    </>
  );
});

export { DRIVE_MARKER_SPRITE_SIZE };
