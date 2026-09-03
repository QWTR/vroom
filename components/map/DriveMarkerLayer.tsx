import React, { memo, useCallback, useMemo, useState } from 'react';
import { PixelRatio, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import type { DriveMarkerV3Values } from '../../hooks/useDriveMarkerV3';
import { MAP_LAYER_IDS } from '../../lib/mapScreen/mapLayerContract';
import {
  DRIVE_MARKER_IMAGE_KEY,
  NATIVE_ARROW_IMAGE_KEY,
  DriveMarkerSpriteCapture,
} from './DriveMarkerSpriteCapture';
import {
  DRIVE_MARKER_SPRITE_SIZE,
  type DriveMarkerSpriteData,
} from './DriveMarkerSpriteVisual';

const EMPTY_SHAPE = { type: 'FeatureCollection' as const, features: [] };
/** Logical sprite is captured at PixelRatio× size; Mapbox scales by iconSize. */
const SPRITE_PIXEL_SIZE = Math.round(DRIVE_MARKER_SPRITE_SIZE * Math.max(2, PixelRatio.get()));
const SPRITE_ICON_SIZE = DRIVE_MARKER_SPRITE_SIZE / SPRITE_PIXEL_SIZE;
/** Native VectorDrawable/CG arrow already carries the correct device scale metadata. */
const NATIVE_ARROW_ICON_SIZE = 1;

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
  /** Keep the native trip pose source mounted without rendering the 2D fallback. */
  showVisual?: boolean;
  marker: DriveMarkerV3Values;
  imageUri?: string | null;
  avatarUrl?: string | null;
  cursorSkin?: { imageUrl?: string; borderColor?: string } | null;
  /** Use native hi-DPI arrow registered by VroomMapCameraFollower (no ViewShot). */
  useNativeArrow?: boolean;
};

type VisualLayersProps = {
  iconImage: string | null;
  iconSize: number;
  sourceID?: string;
};

function MarkerVisualLayers({ iconImage, iconSize, sourceID }: VisualLayersProps) {
  const sourceProps = sourceID ? { sourceID } : {};
  return (
    <>
      {iconImage ? (
        <Mapbox.SymbolLayer
          id={MAP_LAYER_IDS.vehicleSymbol}
          {...sourceProps}
          aboveLayerID={MAP_LAYER_IDS.warningCount}
          style={{
            iconImage,
            iconSize,
            // World heading + map alignment lets Mapbox compensate its exact,
            // current bearing atomically. It cannot drift a frame behind camera.
            iconRotate: ['coalesce', ['get', 'worldHeading'], ['get', 'heading'], 0],
            iconPitchAlignment: 'viewport',
            iconRotationAlignment: 'map',
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconAnchor: 'center',
            iconOptional: false,
          }}
        />
      ) : (
        <Mapbox.CircleLayer
          id={MAP_LAYER_IDS.vehicleFallback}
          {...sourceProps}
          aboveLayerID={MAP_LAYER_IDS.warningCount}
          style={{
            circleRadius: 32,
            circleColor: '#e33835',
            circleStrokeWidth: 3,
            circleStrokeColor: '#ffffff',
            circlePitchAlignment: 'viewport',
          }}
        />
      )}
    </>
  );
}

/** Trip marker rendered entirely as Mapbox style layers. */
export const DriveMarkerLayer = memo(function DriveMarkerLayer({
  enabled,
  showVisual = true,
  imageUri,
  avatarUrl,
  cursorSkin,
  useNativeArrow = false,
}: Props) {
  const hasCustomVisual = Boolean(avatarUrl || cursorSkin?.imageUrl);
  const preferNativeArrow = useNativeArrow && !hasCustomVisual;

  const spriteData = useMemo<DriveMarkerSpriteData>(() => ({
    avatarUrl,
    imageUri: preferNativeArrow ? null : imageUri,
    cursorSkin,
  }), [avatarUrl, imageUri, cursorSkin, preferNativeArrow]);

  const cacheKey = spriteCacheKey(spriteData);
  const [capturedUri, setCapturedUri] = useState<string | null>(() => (
    lastSpriteCache?.key === cacheKey ? lastSpriteCache.uri : null
  ));
  const handleCapture = useCallback((uri: string) => {
    lastSpriteCache = { key: cacheKey, uri };
    setCapturedUri(uri);
  }, [cacheKey]);
  const textureUri = preferNativeArrow ? null : (capturedUri ?? imageUri ?? null);
  const iconImage = preferNativeArrow
    ? NATIVE_ARROW_IMAGE_KEY
    : (textureUri ? DRIVE_MARKER_IMAGE_KEY : null);
  const iconSize = preferNativeArrow ? NATIVE_ARROW_ICON_SIZE : SPRITE_ICON_SIZE;

  if (!enabled) return null;

  return (
    <>
      {showVisual && !preferNativeArrow ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden' }}
        >
          <DriveMarkerSpriteCapture data={spriteData} onCapture={handleCapture} />
        </View>
      ) : null}
      {showVisual && textureUri ? (
        <Mapbox.Images images={{ [DRIVE_MARKER_IMAGE_KEY]: { uri: textureUri } }} />
      ) : null}
      <Mapbox.ShapeSource id="tripDriveMarkerSource" shape={EMPTY_SHAPE}>
        {showVisual ? <MarkerVisualLayers iconImage={iconImage} iconSize={iconSize} /> : <></>}
      </Mapbox.ShapeSource>
    </>
  );
});

export { DRIVE_MARKER_SPRITE_SIZE };
