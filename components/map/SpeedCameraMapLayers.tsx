import React, { useMemo, useCallback } from 'react';
import { View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SpeedCamera } from '../../hooks/useSpeedCamera';
import {
  SPEED_CAMERA_MAP_ICON,
  SPEED_CAMERA_CLUSTER_MAX_ZOOM,
  SPEED_CAMERA_CLUSTER_RADIUS,
  SPEED_CAMERA_ICON_SIZE,
  SPEED_CAMERA_CLUSTER_ICON_SIZE,
} from '../../constants/speedCameraMap';

function SpeedCameraMapIconSprite() {
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#e33835',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#fff',
      }}
    >
      <MaterialCommunityIcons name="cctv" size={18} color="#fff" />
    </View>
  );
}

function isValidCameraCoord(camera: SpeedCamera): boolean {
  const lat = camera.latitude ?? camera.lat;
  const lng = camera.longitude ?? camera.lng;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

type Props = {
  cameras: SpeedCamera[];
  onSelectCamera: (camera: SpeedCamera) => void;
};

/**
 * Fotoradary OSM — ShapeSource + SymbolLayer (+ clustering).
 * Ikona: wektorowy View → natywna tekstura przez Mapbox.Image (bez zewnętrznych PNG).
 */
export function SpeedCameraMapLayers({ cameras, onSelectCamera }: Props) {
  const { shape, cameraById } = useMemo(() => {
    const byId = new Map<number, SpeedCamera>();
    const features = cameras.filter(isValidCameraCoord).map((camera) => {
      byId.set(camera.id, camera);
      const lat = camera.latitude ?? camera.lat;
      const lng = camera.longitude ?? camera.lng;
      return {
        type: 'Feature' as const,
        id: camera.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat],
        },
        properties: {
          id: camera.id,
          type: camera.type ?? 'fixed',
        },
      };
    });

    return {
      cameraById: byId,
      shape: { type: 'FeatureCollection' as const, features },
    };
  }, [cameras]);

  const handlePress = useCallback(
    (e: { features?: Array<{ properties?: { id?: number; point_count?: number } }> }) => {
      const props = e.features?.[0]?.properties;
      if (!props || props.point_count != null) return;
      const camera = cameraById.get(Number(props.id));
      if (camera) onSelectCamera(camera);
    },
    [cameraById, onSelectCamera],
  );

  if (shape.features.length === 0) return null;

  return (
    <>
      <Mapbox.Images>
        <Mapbox.Image name={SPEED_CAMERA_MAP_ICON}>
          <SpeedCameraMapIconSprite />
        </Mapbox.Image>
      </Mapbox.Images>

      <Mapbox.ShapeSource
        id="vroom-speed-cameras"
        shape={shape}
        cluster
        clusterRadius={SPEED_CAMERA_CLUSTER_RADIUS}
        clusterMaxZoomLevel={SPEED_CAMERA_CLUSTER_MAX_ZOOM}
        onPress={handlePress}
        hitbox={{ width: 36, height: 36 }}
      >
        <Mapbox.SymbolLayer
          id="vroom-speed-cameras-cluster"
          filter={['has', 'point_count']}
          style={{
            iconImage: SPEED_CAMERA_MAP_ICON,
            iconSize: SPEED_CAMERA_CLUSTER_ICON_SIZE,
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconAnchor: 'center',
            textField: ['get', 'point_count_abbreviated'],
            textSize: 11,
            textColor: '#ffffff',
            textFont: ['Open Sans Bold', 'Arial Unicode MS Bold'],
            textOffset: [0, 0],
            textAnchor: 'center',
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />

        <Mapbox.SymbolLayer
          id="vroom-speed-cameras-point"
          filter={['!', ['has', 'point_count']]}
          style={{
            iconImage: SPEED_CAMERA_MAP_ICON,
            iconSize: SPEED_CAMERA_ICON_SIZE,
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconAnchor: 'center',
            iconOptional: false,
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
}
