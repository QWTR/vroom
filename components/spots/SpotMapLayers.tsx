import React, { useMemo, useCallback } from 'react';
import Mapbox from '@rnmapbox/maps';
import type { Spot } from '../../constants/spotTypes';
import { CATEGORY_COLORS, CATEGORY_IMAGE_KEYS } from '../../constants/spotTypes';
import { spotPinIconSize } from './SpotCategorySpriteGenerator';

function isValidSpotCoord(spot: Spot): boolean {
  const { latitude, longitude } = spot;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function toMapboxImageUri(uri: string): string {
  if (uri.startsWith('file://') || uri.startsWith('http')) return uri;
  return `file://${uri}`;
}

type Props = {
  spots: Spot[];
  categorySprites: Record<string, string> | null;
  onSelectSpot: (spot: Spot) => void;
};

/**
 * Spoty na mapie — ShapeSource + ikony kategorii (PNG) + etykiety.
 * Wydajne przy setkach punktów; każdy pin widoczny (allowOverlap).
 */
export function SpotMapLayers({ spots, categorySprites, onSelectSpot }: Props) {
  const mapboxImages = useMemo(() => {
    if (!categorySprites) return null;
    const images: Record<string, { uri: string }> = {};
    for (const [key, uri] of Object.entries(categorySprites)) {
      images[key] = { uri: toMapboxImageUri(uri) };
    }
    return images;
  }, [categorySprites]);

  const { shape, spotById } = useMemo(() => {
    const byId = new Map<string, Spot>();
    const features = spots.filter(isValidSpotCoord).map(spot => {
      byId.set(spot.id, spot);
      const iconKey =
        CATEGORY_IMAGE_KEYS[spot.category] ?? CATEGORY_IMAGE_KEYS.Inne;
      return {
        type: 'Feature' as const,
        id: spot.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [spot.longitude, spot.latitude],
        },
        properties: {
          id: spot.id,
          name: spot.name ?? '',
          color: CATEGORY_COLORS[spot.category] ?? '#e33835',
          iconKey,
        },
      };
    });

    return {
      spotById: byId,
      shape: { type: 'FeatureCollection' as const, features },
    };
  }, [spots]);

  const handlePress = useCallback(
    (e: { features?: Array<{ properties?: { id?: string } }> }) => {
      const id = e.features?.[0]?.properties?.id;
      if (id == null) return;
      const spot = spotById.get(String(id));
      if (spot) onSelectSpot(spot);
    },
    [spotById, onSelectSpot],
  );

  if (shape.features.length === 0) return null;

  const hasSprites = !!mapboxImages && Object.keys(mapboxImages).length > 0;

  return (
    <>
      {hasSprites && <Mapbox.Images images={mapboxImages!} />}

      <Mapbox.ShapeSource
        id="vroom-spots"
        shape={shape}
        onPress={handlePress}
        hitbox={{ width: 32, height: 40 }}
      >
        <Mapbox.CircleLayer
          id="vroom-spots-glow"
          style={{
            circleRadius: 7,
            circleColor: ['get', 'color'],
            circleOpacity: 0.18,
            circleBlur: 0.2,
          }}
        />

        {hasSprites ? (
          <Mapbox.SymbolLayer
            id="vroom-spots-icon"
            style={{
              iconImage: ['get', 'iconKey'],
              iconSize: spotPinIconSize(),
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconAnchor: 'bottom',
              iconOptional: false,
            }}
          />
        ) : (
          <Mapbox.CircleLayer
            id="vroom-spots-fallback"
            style={{
              circleRadius: 7,
              circleColor: ['get', 'color'],
              circleStrokeWidth: 2,
              circleStrokeColor: '#ffffff',
              circleOpacity: 0.95,
            }}
          />
        )}

        <Mapbox.SymbolLayer
          id="vroom-spots-label"
          style={{
            textField: ['get', 'name'],
            textSize: 9,
            textColor: '#ffffff',
            textHaloColor: '#0a0a0a',
            textHaloWidth: 1.2,
            textOffset: hasSprites ? [0, -2.1] : [0, -1.4],
            textAnchor: 'bottom',
            textMaxWidth: 6,
            textAllowOverlap: true,
            textIgnorePlacement: true,
            textOptional: false,
            textPadding: 1,
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
}
