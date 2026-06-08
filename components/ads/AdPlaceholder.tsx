import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  variant: 'banner' | 'native';
}

export function AdPlaceholder({ variant }: Props) {
  const { theme } = useTheme();

  if (variant === 'native') {
    return (
      <View
        style={{
          marginHorizontal: 12,
          marginBottom: 10,
          backgroundColor: theme.surface,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: '#e3383530',
          borderStyle: 'dashed',
          paddingVertical: 10,
          paddingHorizontal: 12,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 40,
        }}
      >
        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, textAlign: 'center', letterSpacing: 1 }}>
          TU POWINNA BYĆ REKLAMA
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        marginHorizontal: 20,
        marginVertical: 6,
        minHeight: 44,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e3383530',
        borderStyle: 'dashed',
        backgroundColor: theme.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: 'Orbitron',
          color: theme.textDim,
          fontSize: 8,
          textAlign: 'center',
          letterSpacing: 1,
        }}
      >
        TU POWINNA BYĆ REKLAMA
      </Text>
    </View>
  );
}
