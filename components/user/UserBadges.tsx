import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Props = {
  isPremium?: boolean;
  isAdmin?: boolean;
  compact?: boolean;
};

export function UserBadges({ isPremium, isAdmin, compact }: Props) {
  if (!isPremium && !isAdmin) return null;

  const fontSize = compact ? 7 : 8;
  const padH = compact ? 5 : 6;

  return (
    <View style={styles.row}>
      {isAdmin ? (
        <View style={[styles.pill, styles.adminPill, { paddingHorizontal: padH }]}>
          <Text style={[styles.pillText, styles.adminText, { fontSize }]}>ADMIN</Text>
        </View>
      ) : null}
      {isPremium ? (
        <View style={[styles.pill, styles.premiumPill, { paddingHorizontal: padH }]}>
          <Text style={[styles.pillText, styles.premiumText, { fontSize }]}>PREMIUM</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  pill: { borderRadius: 8, borderWidth: 1, paddingVertical: 2 },
  adminPill: { backgroundColor: '#7C3AED20', borderColor: '#7C3AED50' },
  adminText: { fontFamily: 'Orbitron', color: '#A78BFA', fontWeight: '700' },
  premiumPill: { backgroundColor: '#FFD70020', borderColor: '#FFD70040' },
  premiumText: { fontFamily: 'Orbitron', color: '#FFD700', fontWeight: '700' },
  pillText: { letterSpacing: 0.5 },
});
