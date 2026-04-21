import React from 'react';
import { View, Text } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { FuelStation } from '../../hooks/useFuelStations';

interface Props {
  station:   FuelStation;
  onCapture: (uri: string) => void;
}

export function FuelStationRenderer({ station, onCapture }: Props) {
  const pb95 = station.prices?.[0]?.pb95;

  return (
    <View style={{
      position: 'absolute', top: 0, left: 0,
      opacity: 0, zIndex: -999, pointerEvents: 'none',
    }}>
      <ViewShot
        onCapture={uri => onCapture(uri)}
        captureMode="mount"
        options={{ format: 'png', quality: 1.0 }}
      >
        <View style={{
          alignItems: 'center',
          paddingHorizontal: 4,
          paddingTop: 4,
          paddingBottom: 4,
          backgroundColor: 'transparent',
        }}>
          {/* Circle icon */}
          <View style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: '#00bfff20',
            borderWidth: 2.5,
            borderColor: '#00bfff',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <MaterialCommunityIcons name="gas-station" size={22} color="#00bfff" />
          </View>

          {/* PB95 price label */}
          {pb95 != null && (
            <View style={{
              backgroundColor: '#0a0a0aee',
              borderRadius: 6,
              paddingHorizontal: 6,
              paddingVertical: 2,
              marginTop: 3,
            }}>
              <Text style={{ color: '#00bfff', fontSize: 9, fontWeight: '700' }}>
                {pb95.toFixed(2)}
              </Text>
            </View>
          )}
        </View>
      </ViewShot>
    </View>
  );
}
