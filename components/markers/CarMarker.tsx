import React, { memo } from 'react';
import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface CarMarkerProps {
  heading: number;
}

export const CarMarker = memo(({ heading }: CarMarkerProps) => (
  <View style={{
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#e33835',
  }}>
    <MaterialIcons name="directions-car" size={28} color="#e33835" />
  </View>
));