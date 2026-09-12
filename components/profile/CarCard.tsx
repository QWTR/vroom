import React from 'react';
import { TouchableOpacity, View, Image } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
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
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={brand + ', ' + specs + (isMain ? ', główne auto' : '')}
      activeOpacity={0.88} onPress={onPress}
      style={{ backgroundColor: theme.surface, borderRadius: 26, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: theme.border, ...GLASS_SHADOW }}>
      <View style={{ width: '100%', aspectRatio: 1.6, backgroundColor: theme.surface3 }}>
        {firstPhoto ? <Image source={{ uri: firstPhoto }} resizeMode="cover" style={{ width: '100%', height: '100%' }} /> : (
          <LinearGradient colors={[theme.surface3, theme.surface]} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <MaterialIcons name="directions-car" size={66} color={theme.textDim} />
            <Text style={{ color: theme.textDim, fontSize: 13 }}>Samochód czeka na swoje zdjęcie</Text>
          </LinearGradient>
        )}
        {isMain && <View style={{ position: 'absolute', top: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#111111E6', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 }}>
          <MaterialIcons name="star" size={14} color="#FFD479" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Główne auto</Text>
        </View>}
      </View>
      <View style={{ padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: theme.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.5 }}>{brand}</Text>
          {!!specs && <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 21 }}>{specs}</Text>}
        </View>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface3, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border }}>
          <MaterialIcons name="arrow-outward" size={21} color={theme.text} />
        </View>
      </View>
    </TouchableOpacity>
  );
}
