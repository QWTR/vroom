import React, { memo } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { FuelStation } from '../../hooks/useFuelStations';
import { resolveStationDisplayPrice } from '../../lib/fuelDisplayPrice';

interface Props {
  station:  FuelStation;
  onPress?: () => void;
  compact?: boolean;
  preferredFuel?: string | null;
}

export const FuelStationMarker = memo(({ station, onPress, compact = false, preferredFuel = null }: Props) => {
  const { lat, lng, prices, brandLogoUrl, brand } = station;

  if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return null;

  const display = resolveStationDisplayPrice(prices, preferredFuel);

  return (
    <Mapbox.MarkerView coordinate={[lng, lat]} anchor={{ x: 0.5, y: 1 }} allowOverlap allowOverlapWithPuck>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <View style={{ alignItems: 'center' }}>
          <View style={{
            minWidth: compact ? 34 : 52,
            maxWidth: compact ? 34 : 88,
            backgroundColor: '#121820',
            paddingHorizontal: compact ? 4 : 6,
            paddingVertical: compact ? 4 : 5,
            borderRadius: compact ? 17 : 12,
            borderWidth: 1.2,
            borderColor: '#2b8cff',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.22,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}>
            <View style={{
              width: compact ? 18 : 24,
              height: compact ? 18 : 24,
              borderRadius: compact ? 9 : 12,
              backgroundColor: '#ffffff',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: compact ? 0 : 2,
            }}>
              {brandLogoUrl ? (
                <Image
                  source={{ uri: brandLogoUrl }}
                  style={{ width: compact ? 13 : 17, height: compact ? 13 : 17 }}
                  resizeMode="contain"
                />
              ) : (
                <MaterialCommunityIcons name="gas-station" size={compact ? 11 : 14} color="#2b8cff" />
              )}
            </View>
            {!compact && (
              <>
                <Text
                  numberOfLines={1}
                  style={{ color: '#d8e9ff', fontSize: 9, fontWeight: '900', marginBottom: 1 }}
                >
                  {(brand || station.name || 'Stacja').toUpperCase()}
                </Text>
                {display ? (
                  <Text style={{ color: '#7dd3fc', fontSize: 9, fontWeight: '900' }}>
                    {display.label} {display.value.toFixed(2)}
                  </Text>
                ) : (
                  <Text style={{ color: '#6b7280', fontSize: 9, fontWeight: '700' }}>
                    BRAK CENY
                  </Text>
                )}
              </>
            )}
          </View>
          {/* pin tip */}
          {!compact && (
            <View style={{
              width: 0,
              height: 0,
              borderLeftWidth: 5,
              borderRightWidth: 5,
              borderTopWidth: 6,
              borderStyle: 'solid',
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderTopColor: '#2b8cff',
            }} />
          )}
        </View>
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});
