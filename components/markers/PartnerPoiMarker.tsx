import React, { memo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PartnerPoi } from '../../hooks/usePartnerPois';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  poi: PartnerPoi;
  onPress?: () => void;
}

export const PartnerPoiMarker = memo(({ poi, onPress }: Props) => {
  const { theme } = useTheme();
  const { lat, lng, logoUrl, name } = poi;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const logo = normalizeMediaUri(logoUrl);

  return (
    <Mapbox.MarkerView coordinate={[lng, lat]} anchor={{ x: 0.5, y: 1 }} allowOverlap allowOverlapWithPuck>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <View style={{ alignItems: 'center', maxWidth: 88 }}>
          <View style={{
            backgroundColor: theme.mapLabelBg,
            paddingHorizontal: 6,
            paddingVertical: 5,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: '#FFD700',
            alignItems: 'center',
            minWidth: 40,
          }}>
            {logo ? (
              <Image source={{ uri: logo }} style={{ width: 28, height: 28 }} contentFit="contain" />
            ) : (
              <MaterialCommunityIcons name="store" size={20} color="#FFD700" />
            )}
            <Text numberOfLines={1} style={{ color: '#FFD700', fontSize: 7, fontWeight: '700', marginTop: 2 }}>
              {name}
            </Text>
          </View>
          <View style={{
            width: 0,
            height: 0,
            borderLeftWidth: 5,
            borderRightWidth: 5,
            borderTopWidth: 7,
            borderStyle: 'solid',
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: '#FFD700',
          }} />
        </View>
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});
