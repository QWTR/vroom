import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { AppText as Text } from '../../ui/AppText';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { VROOM_RED } from './constants';

type Props = {
  username: string;
  preview: string;
  mode?: 'reply' | 'edit';
  onDismiss: () => void;
};

export function ChatReplyPreview({ username, preview, mode = 'reply', onDismiss }: Props) {
  const { theme } = useTheme();

  return (
    <View style={[styles.wrap, { borderBottomColor: theme.border, backgroundColor: theme.surface }]}>
      <View style={[styles.accent, { backgroundColor: VROOM_RED }]} />
      <View style={styles.content}>
        <Text style={[styles.label, { color: VROOM_RED }]}>
          {mode === 'edit' ? 'EDYCJA' : username}
        </Text>
        <Text style={[styles.preview, { color: theme.textDim }]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <View style={[styles.close, { backgroundColor: theme.surface2 }]}>
          <Feather name="x" size={12} color={theme.textDim} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  accent: { width: 3, borderRadius: 2, alignSelf: 'stretch' },
  content: { flex: 1 },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  preview: { fontSize: 12 },
  close: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
