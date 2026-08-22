import React, { useMemo, useCallback, useRef } from 'react';
import Mapbox from '@rnmapbox/maps';
import type { Spot } from '../../constants/spotTypes';
import { CATEGORY_COLORS, CATEGORY_IMAGE_KEYS } from '../../constants/spotTypes';
import { spotPinIconSize } from './SpotCategorySpriteGenerator';
import { useTheme } from '../../contexts/ThemeContext';

/** Klastry do tego zoomu — potem pojedyncze piny. */
const CLUSTER_MAX_ZOOM = 12;
const CLUSTER_RADIUS = 52;

/** Etykiety nazw dopiero od tego zoomu (bez overlapu). */
const LABEL_MIN_ZOOM = 13.5;

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
  onZoomTo: (center: [number, number], zoomLevel: number) => void;
};

/**
 * Spoty na mapie — ShapeSource z clusteringiem.
 * Daleko: klastry z liczbą. Blisko: piny kategorii. Etykiety tylko przy zoomie.
 */
function SpotMapLayersComponent({
  spots,
  categorySprites,
  onSelectSpot,
  onZoomTo,
}: Props) {
  const { theme, isDark } = useTheme();
  const sourceRef = useRef<Mapbox.ShapeSource>(null);

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
    async (e: {
      features?: Array<{
        type?: string;
        geometry?: { coordinates?: number[] };
        properties?: { id?: string; point_count?: number; cluster_id?: number };
      }>;
    }) => {
      const feature = e.features?.[0];
      if (!feature?.properties) return;

      // Klastr → zoom do ekspansji
      if (feature.properties.point_count != null) {
        const coords = feature.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const center: [number, number] = [coords[0], coords[1]];
        try {
          const expansionZoom =
            (await sourceRef.current?.getClusterExpansionZoom(feature as any)) ??
            CLUSTER_MAX_ZOOM + 1;
          onZoomTo(center, Math.min(expansionZoom + 0.4, 16));
        } catch {
          onZoomTo(center, Math.min(CLUSTER_MAX_ZOOM + 1.5, 16));
        }
        return;
      }

      const id = feature.properties.id;
      if (id == null) return;
      const spot = spotById.get(String(id));
      if (spot) onSelectSpot(spot);
    },
    [spotById, onSelectSpot, onZoomTo],
  );

  if (shape.features.length === 0) return null;

  const hasSprites = !!mapboxImages && Object.keys(mapboxImages).length > 0;
  const pinSize = spotPinIconSize();

  return (
    <>
      {hasSprites && <Mapbox.Images images={mapboxImages!} />}

      <Mapbox.ShapeSource
        ref={sourceRef}
        id="vroom-spots"
        shape={shape}
        cluster
        clusterRadius={CLUSTER_RADIUS}
        clusterMaxZoomLevel={CLUSTER_MAX_ZOOM}
        onPress={handlePress}
        hitbox={{ width: 36, height: 44 }}
      >
        {/* Klastry — czerwone bąbelki z liczbą */}
        <Mapbox.CircleLayer
          id="vroom-spots-cluster"
          filter={['has', 'point_count']}
          style={{
            circleColor: '#e33835',
            circleRadius: [
              'step',
              ['get', 'point_count'],
              15,
              8,
              18,
              25,
              22,
              60,
              28,
              150,
              34,
            ],
            circleStrokeWidth: 2.5,
            circleStrokeColor: '#ffffff',
            circleOpacity: 0.94,
          }}
        />
        <Mapbox.SymbolLayer
          id="vroom-spots-cluster-count"
          filter={['has', 'point_count']}
          style={{
            textField: ['get', 'point_count_abbreviated'],
            textSize: [
              'step',
              ['get', 'point_count'],
              11,
              25,
              12,
              60,
              13,
            ],
            textColor: '#ffffff',
            textFont: ['Open Sans Bold', 'Arial Unicode MS Bold'],
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />

        {/* Pojedyncze spoty — lekki glow */}
        <Mapbox.CircleLayer
          id="vroom-spots-glow"
          filter={['!', ['has', 'point_count']]}
          style={{
            circleRadius: 6,
            circleColor: ['get', 'color'],
            circleOpacity: 0.16,
            circleBlur: 0.35,
            circlePitchAlignment: 'map',
          }}
        />

        {hasSprites ? (
          <Mapbox.SymbolLayer
            id="vroom-spots-icon"
            filter={['!', ['has', 'point_count']]}
            style={{
              iconImage: ['get', 'iconKey'],
              iconSize: pinSize,
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconAnchor: 'bottom',
              iconOptional: false,
            }}
          />
        ) : (
          <Mapbox.CircleLayer
            id="vroom-spots-fallback"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleRadius: 7,
              circleColor: ['get', 'color'],
              circleStrokeWidth: 2,
              circleStrokeColor: '#ffffff',
              circleOpacity: 0.95,
            }}
          />
        )}

        {/* Nazwy — tylko blisko, bez nakładania */}
        <Mapbox.SymbolLayer
          id="vroom-spots-label"
          filter={['!', ['has', 'point_count']]}
          minZoomLevel={LABEL_MIN_ZOOM}
          style={{
            textField: ['get', 'name'],
            textSize: 10,
            textColor: isDark ? theme.mapLabelText : theme.text,
            textHaloColor: isDark ? theme.bg : theme.surface,
            textHaloWidth: 1.4,
            textOffset: hasSprites ? [0, -2.35] : [0, -1.5],
            textAnchor: 'bottom',
            textMaxWidth: 7,
            textAllowOverlap: false,
            textIgnorePlacement: false,
            textOptional: true,
            textPadding: 4,
            textFont: ['Open Sans Semibold', 'Arial Unicode MS Regular'],
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
}

export const SpotMapLayers = React.memo(SpotMapLayersComponent);
