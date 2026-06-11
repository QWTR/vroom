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
  const { theme, isDark } = useTheme();
  return (
    <View style={{
      paddingHorizontal: 20,
      marginBottom: 16,
      marginTop: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    }}>
      {icon ? (
        iconLib === 'material'
          ? <MaterialCommunityIcons name={icon as any} size={13} color={theme.textDim} />
          : <Feather name={icon as any} size={13} color={theme.textDim} />
      ) : null}
      <Text style={{
        fontSize: 11,
        color: theme.textDim,
        fontWeight: '600',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
      }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#ffffff08' : theme.border2, marginLeft: 4 }} />
    </View>
  );
}
