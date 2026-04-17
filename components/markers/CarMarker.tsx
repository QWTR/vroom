import React, { memo } from 'react';
import { View, Image } from 'react-native';
import Mapbox from '@rnmapbox/maps';

interface CarMarkerProps {
  latitude:  number;
  longitude: number;
  heading:   number;
  imageUri:  string | null;
  zIndex?:   number;
}

export const CarMarker = memo(({ latitude, longitude, heading, imageUri }: CarMarkerProps) => (
  <Mapbox.MarkerView coordinate={[longitude, latitude]} anchor={{ x: 0.5, y: 0.5 }} allowOverlapWithPuck>
    <View style={{ transform: [{ rotate: `${heading}deg` }] }}>
      {imageUri
        ? <Image source={{ uri: imageUri }} style={{ width: 48, height: 48 }} resizeMode="contain" />
        : <View style={{ width: 48, height: 48, backgroundColor: 'transparent' }} />
      }
    </View>
  </Mapbox.MarkerView>
), (prev, next) =>
  prev.imageUri  === next.imageUri  &&
  prev.heading   === next.heading   &&
  prev.latitude  === next.latitude  &&
  prev.longitude === next.longitude
);