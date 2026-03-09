import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@react-navigation/elements';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

interface Props {
  icon: string;
  label: string;
  active: boolean;
}

export default function AchievementBox({ icon, label, active }: Props) {
  return (
    <View style={[styles.achievementBox, !active && { opacity: 0.4 }]}>
      <MaterialIcons name={icon as any} size={30} color={active ? '#ffb300' : '#ffffff40'} />
      <Text style={styles.achievementLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  achievementBox: {
    width: '31%', backgroundColor: '#1a1a1a', aspectRatio: 1,
    justifyContent: 'center', alignItems: 'center',
    borderRadius: 12, padding: 10,
  },
  achievementLabel: { fontFamily: 'Orbitron', color: '#fff', fontSize: 8, marginTop: 10, textAlign: 'center' },
});