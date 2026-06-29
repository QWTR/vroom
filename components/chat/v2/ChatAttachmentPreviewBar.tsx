import React from 'react';
import { View, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { VROOM_RED } from './constants';

type Props = {
  uris: string[];
  onRemove: (index: number) => void;
};

export function ChatAttachmentPreviewBar({ uris, onRemove }: Props) {
  const { theme } = useTheme();
  if (!uris.length) return null;

  return (
    <View style={[styles.row, { backgroundColor: theme.surface }]}>
      {uris.map((uri, i) => (
        <View key={`${uri}-${i}`} style={styles.thumbWrap}>
          <Image source={{ uri }} style={[styles.thumb, { borderColor: theme.border }]} />
          <TouchableOpacity
            style={[styles.remove, { backgroundColor: VROOM_RED, borderColor: theme.surface }]}
            onPress={() => onRemove(i)}
          >
            <Feather name="x" size={10} color="#fff" />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, gap: 8 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 58, height: 58, borderRadius: 10, borderWidth: 1 },
  remove: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
