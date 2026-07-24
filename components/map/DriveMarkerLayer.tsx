import React, { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import type { DriveMarkerV3Values } from '../../hooks/useDriveMarkerV3';
import { MAP_LAYER_IDS } from '../../lib/mapScreen/mapLayerContract';
import {
  DRIVE_MARKER_IMAGE_KEY,
  DriveMarkerSpriteCapture,
} from './DriveMarkerSpriteCapture';
import {
  DRIVE_MARKER_SPRITE_SIZE,
  type DriveMarkerSpriteData,
} from './DriveMarkerSpriteVisual';

const EMPTY_SHAPE = { type: 'FeatureCollection' as const, features: [] };

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

type VisualLayersProps = {
  textureUri: string | null;
  sourceID?: string;
};

function MarkerVisualLayers({ textureUri, sourceID }: VisualLayersProps) {
  const sourceProps = sourceID ? { sourceID } : {};
  return (
    <>
      {textureUri ? (
        <Mapbox.SymbolLayer
          id={MAP_LAYER_IDS.vehicleSymbol}
          {...sourceProps}
          aboveLayerID={MAP_LAYER_IDS.warningCount}
          style={{
            iconImage: DRIVE_MARKER_IMAGE_KEY,
            iconSize: 1,
            iconRotate: ['get', 'heading'],
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
  imageUri,
  avatarUrl,
  cursorSkin,
}: Props) {
  const spriteData = useMemo<DriveMarkerSpriteData>(() => ({
    avatarUrl,
    imageUri,
    cursorSkin,
  }), [avatarUrl, imageUri, cursorSkin]);

  const cacheKey = spriteCacheKey(spriteData);
  const [capturedUri, setCapturedUri] = useState<string | null>(() => (
    lastSpriteCache?.key === cacheKey ? lastSpriteCache.uri : null
  ));
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
        <DriveMarkerSpriteCapture data={spriteData} onCapture={handleCapture} />
      </View>
      {textureUri ? (
        <Mapbox.Images images={{ [DRIVE_MARKER_IMAGE_KEY]: { uri: textureUri } }} />
      ) : null}
      <Mapbox.ShapeSource id="tripDriveMarkerSource" shape={EMPTY_SHAPE}>
        <MarkerVisualLayers textureUri={textureUri} />
      </Mapbox.ShapeSource>
    </>
  );
});

export { DRIVE_MARKER_SPRITE_SIZE };
