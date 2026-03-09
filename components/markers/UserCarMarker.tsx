import React, { memo, useState } from 'react';
import { Marker } from 'react-native-maps';
import { User } from '../../constants/types';

interface UserCarMarkerProps {
  user: User;
  distance: number;
  onPress: () => void;
  imageUri: string | null;
}

export const UserCarMarker = memo(({ user, distance, onPress, imageUri }: UserCarMarkerProps) => {
  if (!imageUri) {
    return (
      <Marker
        coordinate={{ latitude: user.latitude, longitude: user.longitude }}
        onPress={onPress}
        zIndex={999}
        title={`${user.avatar} ${user.name}`}
        description={`${distance.toFixed(1)} km`}
        pinColor={user.isFriend ? '#00d26a' : '#00bfff'}
        tracksViewChanges={false}
      />
    );
  }

  return (
    <Marker
      coordinate={{ latitude: user.latitude, longitude: user.longitude }}
      onPress={onPress}
      anchor={{ x: 0.5, y: 1 }}
      zIndex={999}
      tracksViewChanges={false}
      image={{ uri: imageUri }}
    />
  );
});