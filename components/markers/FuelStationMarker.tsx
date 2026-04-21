import React, { memo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { FuelStation } from '../../hooks/useFuelStations';

interface Props {
  station:  FuelStation;
  onPress?: () => void;
}

export const FuelStationMarker = memo(({ station, onPress }: Props) => {
  const { lat, lng, prices } = station;

  if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return null;

  const pb95 = prices?.[0]?.pb95;

  return (
    <Mapbox.MarkerView coordinate={[lng, lat]} anchor={{ x: 0.5, y: 1 }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <View style={{ alignItems: 'center' }}>
          <View style={{
            backgroundColor: '#0a0a0a',
            paddingHorizontal: 6,
            paddingVertical: 5,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: '#00bfff',
            alignItems: 'center',
          }}>
            <MaterialCommunityIcons name="gas-station" size={18} color="#00bfff" />
            {pb95 != null && (
              <Text style={{ color: '#00bfff', fontSize: 8, fontWeight: '700', marginTop: 1 }}>
                {pb95.toFixed(2)}
              </Text>
            )}
          </View>
          {/* pin tip */}
          <View style={{
            width: 0,
            height: 0,
            borderLeftWidth: 5,
            borderRightWidth: 5,
            borderTopWidth: 7,
            borderStyle: 'solid',
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: '#00bfff',
          }} />
        </View>
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});
