import React, { memo } from 'react';
import { View } from 'react-native';
import { Marker } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { Spot, CATEGORY_COLORS, CATEGORY_ICONS } from '../../constants/spotTypes';
import { useTheme } from '../../contexts/ThemeContext';

interface SpotMarkerProps {
  spot: Spot;
  onPress: (spot: Spot) => void;
}

export const SpotMarker = memo(({ spot, onPress }: SpotMarkerProps) => {
  const { theme } = useTheme();
  const color = CATEGORY_COLORS[spot.category];

  return (
    <Marker
      coordinate={{ latitude: spot.latitude, longitude: spot.longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
      onPress={() => onPress(spot)}
    >
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: theme.surface3, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: color }}>
          <MaterialIcons name={CATEGORY_ICONS[spot.category] as any} size={18} color={color} />
        </View>
        <View style={{ width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8, borderStyle: 'solid', borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
      </View>
    </Marker>
  );
});