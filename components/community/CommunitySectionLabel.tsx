import React from 'react';
import { View, Text } from 'react-native';
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
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    }}>
      {icon ? (
        iconLib === 'material'
          ? <MaterialCommunityIcons name={icon as any} size={12} color={theme.textDim} />
          : <Feather name={icon as any} size={12} color={theme.textDim} />
      ) : null}
      <Text style={{
        fontFamily: 'Orbitron',
        fontSize: 9,
        color: theme.textDim,
        letterSpacing: 2,
      }}>
        {label}
      </Text>
    </View>
  );
}
