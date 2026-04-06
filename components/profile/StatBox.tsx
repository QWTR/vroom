import React from 'react';
import { View, Text } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  icon:  string;
  label: string;
  value: string;
}

export default function StatBox({ icon, label, value }: Props) {
  const { theme } = useTheme();
  return (
    <View style={{
      width: '48%', backgroundColor: theme.surface3, padding: 15, borderRadius: 12,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderWidth: 1, borderColor: theme.border,
    }}>
      <View style={{ backgroundColor: theme.primaryBg, padding: 8, borderRadius: 8 }}>
        <MaterialIcons name={icon as any} size={20} color={theme.primary} />
      </View>
      <View>
        <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 15 }}>{value}</Text>
        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9 }}>{label}</Text>
      </View>
    </View>
  );
}