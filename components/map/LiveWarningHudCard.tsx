import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { formatWarningDistance, type UpcomingWarning } from '../../lib/warnings/warningAhead';
import { WARNING_CATALOG, warningSubtypeLabel } from '../../lib/warnings/warningCatalog';

export const LiveWarningHudCard = memo(function LiveWarningHudCard({
  upcoming,
  onPress,
}: {
  upcoming: UpcomingWarning;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const meta = WARNING_CATALOG[upcoming.warning.type] ?? WARNING_CATALOG.kosmici;
  const subtype = warningSubtypeLabel(upcoming.warning.type, upcoming.warning.subtype);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${meta.label}, ${formatWarningDistance(upcoming.distanceM)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: meta.color,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <View pointerEvents="none" style={[styles.icon, { backgroundColor: `${meta.color}22`, borderColor: meta.color }]}>
        <MaterialCommunityIcons name={meta.icon as any} size={22} color={meta.color} />
      </View>
      <View pointerEvents="none" style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
          {subtype ?? meta.label}
        </Text>
        <Text style={[styles.distance, { color: meta.color }]}>
          {formatWarningDistance(upcoming.distanceM)}
        </Text>
      </View>
      {upcoming.additionalCount > 0 ? (
        <View pointerEvents="none" style={[styles.count, { backgroundColor: meta.color }]}>
          <Text style={styles.countText}>+{upcoming.additionalCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    height: 48,
    minWidth: 220,
    maxWidth: 270,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 250,
    elevation: 24,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 11, fontWeight: '800' },
  distance: { fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900', marginTop: 1 },
  count: { minWidth: 28, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#fff', fontSize: 11, fontWeight: '900' },
});
