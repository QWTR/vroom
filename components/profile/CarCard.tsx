import React from 'react';
import { TouchableOpacity, View, Image, Text } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  brand:      string;
  specs:      string;
  isMain:     boolean;
  firstPhoto?: string;
  onPress?:   () => void;
}

export default function CarCard({ brand, specs, isMain, firstPhoto, onPress }: Props) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      style={{ backgroundColor: theme.surface3, borderRadius: 12, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: theme.border }}
      onPress={onPress}
    >
      <View style={{ backgroundColor: theme.surface4, width: 48, height: 48, borderRadius: 10, marginRight: 15, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        {firstPhoto
          ? <Image source={{ uri: firstPhoto }} style={{ width: 48, height: 48 }} />
          : <MaterialIcons name="directions-car" size={24} color={isMain ? theme.primary : theme.textDim} />
        }
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14 }}>{brand}</Text>
          {isMain && (
            <View style={{ backgroundColor: theme.primaryBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginLeft: 10, borderWidth: 1, borderColor: theme.primaryBorder }}>
              <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 8 }}>GŁÓWNE</Text>
            </View>
          )}
        </View>
        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 11, marginTop: 4 }}>{specs}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={24} color={theme.textDim} />
    </TouchableOpacity>
  );
}