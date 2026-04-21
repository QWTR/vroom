import React, { memo } from 'react';
import { Image, TouchableOpacity } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import type { FuelStation } from '../../hooks/useFuelStations';

interface Props {
  station:  FuelStation;
  imageUri: string | null;
  onPress?: () => void;
}

export const FuelStationMarker = memo(({ station, imageUri, onPress }: Props) => {
  if (!imageUri) return null;

  const { lat, lng } = station;

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

  return (
    <Mapbox.MarkerView coordinate={[lng, lat]} anchor={{ x: 0.5, y: 0.5 }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <Image source={{ uri: imageUri }} style={{ width: 56, height: 56 }} resizeMode="contain" />
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});
