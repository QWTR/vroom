import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  label: string;
  icon?: string;
  iconLib?: 'feather' | 'material';
}

export function CommunitySectionLabel({ label, icon, iconLib = 'feather' }: Props) {
  const { theme } = useTheme();
  return (
    <View style={{
      paddingHorizontal: 20,
      marginBottom: 14,
      marginTop: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    }}>
      {icon ? (
        iconLib === 'material'
          ? <MaterialCommunityIcons name={icon as any} size={13} color={theme.primary} />
          : <Feather name={icon as any} size={13} color={theme.primary} />
      ) : null}
      <Text style={{
        fontSize: 11,
        color: 'rgba(255,255,255,0.55)',
        fontWeight: '900',
        letterSpacing: 2,
        textTransform: 'uppercase',
      }}>
        {label}
      </Text>
      <LinearGradient
        colors={['rgba(227, 56, 53, 0.5)', 'rgba(255,255,255,0.06)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ flex: 1, height: 1, marginLeft: 6 }}
      />
    </View>
  );
}
