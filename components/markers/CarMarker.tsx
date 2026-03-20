import React, { memo } from 'react';
import { View } from 'react-native';
import { Marker } from 'react-native-maps';

interface CarMarkerProps {
  latitude:  number;
  longitude: number;
  heading:   number;
  imageUri:  string | null;
}

export const CarMarker = memo(({ latitude, longitude, heading, imageUri }: CarMarkerProps) => {
  if (!imageUri) {
    // Zanim obrazek będzie gotowy — niewidoczny placeholder
    return (
      <Marker
        coordinate={{ latitude, longitude }}
        anchor={{ x: 0.5, y: 0.5 }}
        flat={true}
        rotation={heading}
        zIndex={1000}
        tracksViewChanges={false}
      >
        <View style={{ width: 48, height: 48, backgroundColor: 'transparent' }} />
      </Marker>
    );
  }

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      flat={true}
      rotation={heading}
      zIndex={1000}
      tracksViewChanges={false}
      image={{ uri: imageUri }}
    />
  );
}, (prev, next) =>
  prev.imageUri  === next.imageUri  &&
  prev.heading   === next.heading   &&
  prev.latitude  === next.latitude  &&
  prev.longitude === next.longitude
);