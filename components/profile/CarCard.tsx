import React from 'react';
import { TouchableOpacity, View, Image } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { GLASS_SHADOW, resolveProfileCardTheme, type ProfileCardTheme } from './profileCardTheme';

interface Props {
  brand:      string;
  specs:      string;
  isMain:     boolean;
  firstPhoto?: string;
  onPress?:   () => void;
  theme?:     ProfileCardTheme;
}

export default function CarCard({ brand, specs, isMain, firstPhoto, onPress, theme: profileTheme }: Props) {
  const { theme: globalTheme } = useTheme();
  const theme = resolveProfileCardTheme(globalTheme, profileTheme);

  return (
    <TouchableOpacity
      style={{
        backgroundColor: theme.surface,
        borderRadius: 20,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
        borderWidth: 1,
        borderColor: theme.border,
        ...GLASS_SHADOW,
      }}
      onPress={onPress}
    >
      <View style={{
        backgroundColor: theme.surface3,
        width: 48,
        height: 48,
        borderRadius: 12,
        marginRight: 14,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.border,
      }}>
        {firstPhoto
          ? <Image source={{ uri: firstPhoto }} style={{ width: 48, height: 48 }} />
          : <MaterialIcons name="directions-car" size={24} color={isMain ? theme.primary : theme.textDim} />
        }
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 14 }}>{brand}</Text>
          {isMain && (
            <View style={{
              backgroundColor: theme.primaryBg,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 8,
              marginLeft: 10,
              borderWidth: 1,
              borderColor: theme.primaryBorder,
            }}>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.primary, fontSize: 12, letterSpacing: 1 }}>GŁÓWNE</Text>
            </View>
          )}
        </View>
        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, marginTop: 4 }}>{specs}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={theme.textDim} />
    </TouchableOpacity>
  );
}
