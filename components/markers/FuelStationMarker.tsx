import React, { memo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { FuelStation } from '../../hooks/useFuelStations';

interface Props {
  station: FuelStation;
  onPress?: () => void;
}

export const FuelStationMarker = memo(({ station, onPress }: Props) => {
  const { lat, lng, prices } = station;

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

  const latestPrice = prices?.[0];
  const pb95        = latestPrice?.pb95;

  return (
    <Mapbox.MarkerView coordinate={[lng, lat]} anchor={{ x: 0.5, y: 1.0 }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <View style={{ alignItems: 'center', gap: 2 }}>
          {/* Icon bubble */}
          <View style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: '#00bfff20',
            borderWidth: 2, borderColor: '#00bfff',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#00bfff', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6,
          }}>
            <MaterialCommunityIcons name="gas-station" size={22} color="#00bfff" />
          </View>

          {/* PB95 price label */}
          {pb95 != null && (
            <View style={{
              backgroundColor: '#0a0a0aee',
              borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
              borderWidth: 1, borderColor: '#00bfff40',
            }}>
              <Text style={{ color: '#00bfff', fontSize: 9, fontWeight: '700', fontFamily: 'Orbitron' }}>
                {pb95.toFixed(2)}
              </Text>
            </View>
          )}

          {/* Pin tail */}
          <View style={{ width: 2, height: 6, backgroundColor: '#00bfff80', borderRadius: 1 }} />
        </View>
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});
