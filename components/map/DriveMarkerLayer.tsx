import React, { memo, useMemo, useState } from 'react';
import { View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import Animated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import type { DriveMarkerValues } from '../../hooks/useDriveMarker';
import {
  DRIVE_MARKER_IMAGE_KEY,
  DriveMarkerSpriteCapture,
} from './DriveMarkerSpriteCapture';
import {
  DRIVE_MARKER_SPRITE_SIZE,
  type DriveMarkerSpriteData,
} from './DriveMarkerSpriteVisual';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);

/** Mapbox iconSize = mnożnik względem rozmiaru tekstury (1.0 = natywny rozmiar PNG). */
const ICON_SIZE = 1.0;

const EMPTY_SHAPE = JSON.stringify({
  type: 'FeatureCollection',
  features: [],
});

/** Min. zmiana współrzędnych zanim odświeżamy GeoJSON (unika zbędnych parse w Mapbox). */
const COORD_EPS = 1e-7;

type Props = {
  enabled: boolean;
  marker: DriveMarkerValues;
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
  const [capturedUri, setCapturedUri] = useState<string | null>(null);

  const spriteData = useMemo<DriveMarkerSpriteData>(() => ({
    avatarUrl,
    imageUri,
    cursorSkin,
  }), [avatarUrl, imageUri, cursorSkin?.imageUrl, cursorSkin?.borderColor]);

  const lastShape = useSharedValue(EMPTY_SHAPE);
  const lastLat = useSharedValue(NaN);
  const lastLng = useSharedValue(NaN);
  const lastHdg = useSharedValue(NaN);

  const animatedShapeProps = useAnimatedProps(() => {
    'worklet';
    const la = marker.lat.value;
    const ln = marker.lng.value;
    const h = marker.heading.value;
    if (
      !Number.isFinite(la)
      || !Number.isFinite(ln)
      || (Math.abs(la) < 1e-6 && Math.abs(ln) < 1e-6)
    ) {
      if (lastShape.value !== EMPTY_SHAPE) {
        lastShape.value = EMPTY_SHAPE;
      }
      return { shape: EMPTY_SHAPE };
    }
    const hdg = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
    const prevLa = lastLat.value;
    const prevLn = lastLng.value;
    const prevH = lastHdg.value;
    if (
      Number.isFinite(prevLa)
      && Number.isFinite(prevLn)
      && Math.abs(la - prevLa) <= COORD_EPS
      && Math.abs(ln - prevLn) <= COORD_EPS
      && Math.abs(hdg - prevH) < 0.15
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
          onCapture={setCapturedUri}
        />
      </View>

      {textureUri ? (
        <>
          <Mapbox.Images
            images={{
              [DRIVE_MARKER_IMAGE_KEY]: { uri: textureUri },
            }}
          />

          <ReanimatedShapeSource
            id="tripDriveMarkerSource"
            animatedProps={animatedShapeProps}
          >
            <Mapbox.SymbolLayer
              id="tripDriveMarkerSymbol"
              style={{
                iconImage: DRIVE_MARKER_IMAGE_KEY,
                iconSize: ICON_SIZE,
                iconRotate: ['get', 'heading'],
                iconRotationAlignment: 'map',
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                iconAnchor: 'center',
                iconOptional: false,
              }}
            />
          </ReanimatedShapeSource>
        </>
      ) : null}
    </>
  );
});

export { DRIVE_MARKER_SPRITE_SIZE };
