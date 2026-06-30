import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';

type Props = {
  visible: boolean;
  onCancel: () => void;
};

export function ManualTargetPickOverlay({ visible, onCancel }: Props) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, { zIndex: 51 }]}>
      <View
        pointerEvents="none"
        style={{
          marginTop: 48,
          alignSelf: 'center',
          backgroundColor: theme.mapOverlay,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.border2,
        }}
      >
        <Text style={{
          fontFamily: 'Orbitron',
          fontSize: 9,
          color: theme.mapOverlayText,
          textAlign: 'center',
          letterSpacing: 0.5,
        }}>
          PRZYTRZYMAJ MAPĘ W MIEJSCU DOCELOWYM
        </Text>
      </View>
      <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 88 }}>
        <TouchableOpacity
          onPress={onCancel}
          style={{
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: isDark ? theme.surface3 : theme.surface2,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>
            ANULUJ TRYB PUNKTU
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
