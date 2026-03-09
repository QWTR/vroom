import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@react-navigation/elements';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

interface Props {
  icon: string;
  label: string;
  value: string;
}

export default function StatBox({ icon, label, value }: Props) {
  return (
    <View style={styles.statBox}>
      <View style={styles.statIconCircle}>
        <MaterialIcons name={icon as any} size={20} color="#e33835ce" />
      </View>
      <View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statBox: {
    width: '48%', backgroundColor: '#1a1a1a', padding: 15, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: '#ffffff05',
  },
  statIconCircle: { backgroundColor: '#e3383515', padding: 8, borderRadius: 8 },
  statValue:      { fontFamily: 'Orbitron', color: '#fff', fontSize: 15 },
  statLabel:      { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9 },
});