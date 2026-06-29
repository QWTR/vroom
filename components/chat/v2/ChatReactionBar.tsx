import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import type { UnifiedChatReaction } from './types';
import { VROOM_RED } from './constants';

type Props = {
  reactions: UnifiedChatReaction[];
  onReact?: (emoji: string) => void;
};

export function ChatReactionBar({ reactions, onReact }: Props) {
  const { theme } = useTheme();
  if (!reactions.length) return null;

  return (
    <View style={styles.row}>
      {reactions.map(r => (
        <TouchableOpacity
          key={r.emoji}
          onPress={() => onReact?.(r.emoji)}
          style={[
            styles.chip,
            {
              backgroundColor: r.myReaction ? `${VROOM_RED}30` : theme.surface2,
              borderColor: r.myReaction ? VROOM_RED : theme.border,
            },
          ]}
          activeOpacity={0.8}
        >
          <Text style={styles.emoji}>{r.emoji}</Text>
          <Text
            style={[
              styles.count,
              { color: r.myReaction ? VROOM_RED : theme.textDim },
            ]}
          >
            {r.count}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, paddingHorizontal: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
  },
  emoji: { fontSize: 12 },
  count: { fontSize: 10, fontFamily: 'Orbitron', fontWeight: '700' },
});
