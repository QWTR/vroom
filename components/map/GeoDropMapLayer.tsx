import Mapbox from '@rnmapbox/maps';
import React, { useCallback, useMemo } from 'react';
import type { GeoDropNearby } from '../../lib/gamificationClient';
import { MAP_POI_MIN_ZOOM } from '../../lib/mapViewport';
import { MAP_DROP_MARKER_IMAGES, MAP_MARKER_IMAGE_KEYS } from './mapMarkerSprites';

type Props = {
  drops: GeoDropNearby[];
  onSelectDrop?: (drop: GeoDropNearby) => void;
};

export function GeoDropMapLayer({ drops, onSelectDrop }: Props) {
  const { shape, byId } = useMemo(() => {
    const index = new Map<string, GeoDropNearby>();
    const features = drops.flatMap((drop) => {
      if (!Number.isFinite(drop.lat) || !Number.isFinite(drop.lng)) return [];
      index.set(String(drop.id), drop);
      return [{
        type: 'Feature' as const,
        id: String(drop.id),
        geometry: { type: 'Point' as const, coordinates: [drop.lng, drop.lat] },
        properties: { id: String(drop.id) },
      }];
    });
    return { shape: { type: 'FeatureCollection' as const, features }, byId: index };
  }, [drops]);

  const onPress = useCallback((event: any) => {
    const drop = byId.get(String(event.features?.[0]?.properties?.id ?? ''));
    if (drop) onSelectDrop?.(drop);
  }, [byId, onSelectDrop]);

  return (
    <>
      <Mapbox.Images images={MAP_DROP_MARKER_IMAGES} />
      <Mapbox.ShapeSource
        id="geoDropsSource"
        shape={shape as any}
        onPress={onPress}
        hitbox={{ width: 48, height: 48 }}
      >
        <Mapbox.SymbolLayer
          id="geoDropsIcons"
          minZoomLevel={MAP_POI_MIN_ZOOM}
          style={{
            iconImage: MAP_MARKER_IMAGE_KEYS.dropCompact,
            iconSize: ['interpolate', ['linear'], ['zoom'], MAP_POI_MIN_ZOOM, 0.82, 16, 0.98],
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconAnchor: 'bottom',
            iconOptional: false,
            iconPitchAlignment: 'viewport',
            iconRotationAlignment: 'viewport',
            symbolSortKey: 90,
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
}
