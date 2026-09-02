import React, { memo } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import Mapbox from '@rnmapbox/maps';
import { MaterialIcons } from '@expo/vector-icons';
import { Spot, CATEGORY_COLORS, CATEGORY_ICONS } from '../../constants/spotTypes';
import { useTheme } from '../../contexts/ThemeContext';

interface SpotMarkerProps {
  spot: Spot;
  onPress: (spot: Spot) => void;
}

/** Pojedynczy pin (np. podgląd) — ten sam styl co sprite na mapie. */
export const SpotMarker = memo(({ spot, onPress }: SpotMarkerProps) => {
  const { theme } = useTheme();
  const color = CATEGORY_COLORS[spot.category] ?? '#e33835';

  return (
    <Mapbox.MarkerView
      coordinate={[spot.longitude, spot.latitude]}
      anchor={{ x: 0.5, y: 1 }}
      allowOverlap
      allowOverlapWithPuck
    >
      <TouchableOpacity onPress={() => onPress(spot)} activeOpacity={0.8}>
        <View style={{ alignItems: 'center' }} collapsable={false}>
          <View style={{
            backgroundColor: '#111111ee',
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 4,
            marginBottom: 5,
            borderWidth: 1,
            borderColor: color + '60',
            maxWidth: 140,
          }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: 'Manrope_600SemiBold',
                fontSize: 12,
                color: '#fff',
                fontWeight: '700',
                letterSpacing: 0.5,
              }}
            >
              {spot.name}
            </Text>
          </View>
          <View style={{
            width: 42, height: 42, borderRadius: 11,
            backgroundColor: theme.surface3,
            justifyContent: 'center', alignItems: 'center',
            borderWidth: 2.5, borderColor: color,
          }}>
            <MaterialIcons name={CATEGORY_ICONS[spot.category] as any} size={22} color={color} />
          </View>
          <View style={{
            width: 0, height: 0,
            borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 9,
            borderStyle: 'solid',
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: color,
          }} />
        </View>
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});
