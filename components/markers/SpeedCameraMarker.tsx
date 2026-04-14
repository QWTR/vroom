import React, { memo } from 'react';
import { Marker }      from 'react-native-maps';
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
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={600}
      image={{ uri: imageUri }}
      onPress={onPress}
    />
  );
});