import Mapbox from '@rnmapbox/maps';
import React, { useCallback, useMemo } from 'react';
import type { SpeedCamera } from '../../hooks/useSpeedCamera';
import { MAP_POI_MIN_ZOOM } from '../../lib/mapViewport';
import { MAP_MARKER_IMAGE_KEYS, MAP_SPEED_CAMERA_MARKER_IMAGES } from './mapMarkerSprites';

function isValidCameraCoord(camera: SpeedCamera): boolean {
  const lat = camera.latitude ?? camera.lat;
  const lng = camera.longitude ?? camera.lng;
  return (
    Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
  );
}

type Props = {
  cameras: SpeedCamera[];
  onSelectCamera: (camera: SpeedCamera) => void;
};

/** Każdy fotoradar pozostaje osobnym symbolem; źródło nie używa klastrów. */
export function SpeedCameraMapLayers({ cameras, onSelectCamera }: Props) {
  const { shape, cameraById } = useMemo(() => {
    const byId = new Map<number, SpeedCamera>();
    const features = cameras.filter(isValidCameraCoord).map((camera) => {
      byId.set(camera.id, camera);
      return {
        type: 'Feature' as const,
        id: camera.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [camera.longitude ?? camera.lng, camera.latitude ?? camera.lat],
        },
        properties: {
          id: camera.id,
          type: camera.type ?? 'fixed',
          isSystem: camera.isSystemData ? 1 : 0,
        },
      };
    });

    return {
      cameraById: byId,
      shape: { type: 'FeatureCollection' as const, features },
    };
  }, [cameras]);

  const handlePress = useCallback((event: any) => {
    const camera = cameraById.get(Number(event.features?.[0]?.properties?.id));
    if (camera) onSelectCamera(camera);
  }, [cameraById, onSelectCamera]);

  return (
    <>
      <Mapbox.Images images={MAP_SPEED_CAMERA_MARKER_IMAGES} />
      <Mapbox.ShapeSource
        id="vroom-speed-cameras"
        shape={shape as any}
        onPress={handlePress}
        hitbox={{ width: 48, height: 48 }}
      >
        <Mapbox.SymbolLayer
          id="vroom-speed-cameras-point"
          minZoomLevel={MAP_POI_MIN_ZOOM}
          style={{
            iconImage: MAP_MARKER_IMAGE_KEYS.speedCameraCompact,
            iconSize: ['interpolate', ['linear'], ['zoom'], MAP_POI_MIN_ZOOM, 0.82, 16, 0.98],
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconAnchor: 'bottom',
            iconOptional: false,
            iconPitchAlignment: 'viewport',
            iconRotationAlignment: 'viewport',
            symbolSortKey: 80,
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
}
