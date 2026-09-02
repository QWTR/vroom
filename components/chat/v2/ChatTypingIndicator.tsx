import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AppText as Text } from '../../ui/AppText';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';

type Props = {
  text: string;
  position?: 'header' | 'composer';
};

export function ChatTypingIndicator({ text, position = 'composer' }: Props) {
  const { theme } = useTheme();

  if (position === 'header') {
    return (
      <View style={styles.headerRow}>
        <MaterialCommunityIcons name="dots-horizontal" size={14} color={theme.primary} />
        <Text style={[styles.headerText, { color: theme.primary }]}>{text}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.composerBar, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
      <MaterialCommunityIcons name="dots-horizontal" size={16} color={theme.primary} />
      <Text style={[styles.composerText, { color: theme.textDim }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontStyle: 'italic' },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  composerText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
});
