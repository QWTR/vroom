import React from 'react';
import { View, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { AppText as Text } from '../../ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../contexts/ThemeContext';
import { REACTION_EMOJIS } from './constants';
import type { ChatMenuAction } from './types';

type Props = {
  visible: boolean;
  onClose: () => void;
  actions: ChatMenuAction[];
  showReactions?: boolean;
  onReact?: (emoji: string) => void;
};

export function ChatMessageMenu({
  visible,
  onClose,
  actions,
  showReactions = true,
  onReact,
}: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={e => e.stopPropagation()}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border2,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: theme.border3 }]} />

            {showReactions && onReact && (
              <View style={[styles.emojiRow, { borderBottomColor: theme.border }]}>
                {REACTION_EMOJIS.map(emoji => (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => { onReact(emoji); onClose(); }}
                    style={[styles.emojiBtn, { backgroundColor: theme.surface2 }]}
                  >
                    <Text style={styles.emoji}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {actions.map(action => (
              <TouchableOpacity
                key={action.id}
                style={styles.actionRow}
                onPress={() => { action.onPress(); onClose(); }}
              >
                <View
                  style={[
                    styles.actionIcon,
                    {
                      backgroundColor: action.destructive
                        ? `${theme.danger}18`
                        : action.color
                          ? `${action.color}18`
                          : theme.surface2,
                    },
                  ]}
                >
                  <MaterialIcons
                    name={action.icon as any}
                    size={18}
                    color={action.color ?? (action.destructive ? theme.danger : theme.textDim)}
                  />
                </View>
                <Text
                  style={[
                    styles.actionLabel,
                    { color: action.destructive ? theme.danger : theme.text },
                  ]}
                >
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  emojiBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' },
});
