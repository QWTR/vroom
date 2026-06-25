import React, { memo } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Mapbox from '@rnmapbox/maps';
import type { VehicleModelMeta } from '../../constants/shopCosmetics';
import { normalizeMediaUri } from '../../lib/mediaUri';

const MARKER_SIZE = 88;

type Props = {
  latitude: number;
  longitude: number;
  heading: number;
  previewUrl?: string | null;
  metadata?: VehicleModelMeta | null;
};

/** Marker 2.5D — preview PNG w MarkerView (stabilne, bez expo-gl). */
function VehicleMarkerView3DInner({
  latitude,
  longitude,
  heading,
  previewUrl,
  metadata,
}: Props) {
  const hdg = ((Number.isFinite(heading) ? heading : 0) + (Number(metadata?.rotationOffset) || 0) + 360) % 360;
  const previewUri = normalizeMediaUri(previewUrl);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) < 1e-6 && Math.abs(longitude) < 1e-6) return null;

  return (
    <Mapbox.MarkerView
      coordinate={[longitude, latitude]}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlap
      allowOverlapWithPuck
    >
      <View
        style={{
          width: MARKER_SIZE,
          height: MARKER_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: `${hdg}deg` }],
        }}
      >
        {previewUri ? (
          <Image
            source={{ uri: previewUri }}
            style={{
              width: MARKER_SIZE,
              height: MARKER_SIZE,
              shadowColor: '#000',
              shadowOpacity: 0.45,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
            }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : (
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: '#1a1a1a',
              borderWidth: 2,
              borderColor: '#e33835',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="car-sports" size={32} color="#e33835" />
          </View>
        )}
      </View>
    </Mapbox.MarkerView>
  );
}

export const VehicleMarkerView3D = memo(VehicleMarkerView3DInner);
