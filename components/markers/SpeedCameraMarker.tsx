import React, { memo } from 'react';
import { Image, TouchableOpacity } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import type { SpeedCamera } from '../../hooks/useSpeedCameras';

interface Props {
  camera:   SpeedCamera;
  imageUri: string | null;
  onPress?: () => void;
}

export const SpeedCameraMarker = memo(({ camera, imageUri, onPress }: Props) => {
  if (!imageUri) return null;

  const lat = camera.latitude ?? camera.lat;
  const lng = camera.longitude ?? camera.lng;

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

  return (
    <Mapbox.MarkerView coordinate={[lng, lat]} anchor={{ x: 0.5, y: 0.5 }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <Image source={{ uri: imageUri }} style={{ width: 48, height: 48 }} resizeMode="contain" />
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});