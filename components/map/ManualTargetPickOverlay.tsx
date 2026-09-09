import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMapHudTheme as useTheme } from './useMapHudTheme';

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
          marginTop: 88,
          marginHorizontal: 16,
          alignSelf: 'center',
          backgroundColor: theme.mapOverlay,
          paddingHorizontal: 14,
          paddingVertical: 14,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: theme.border2,
        }}
      >
        <Text style={{
          fontFamily: 'Manrope_600SemiBold',
          fontSize: 14,
          color: theme.mapOverlayText,
          textAlign: 'center',
          letterSpacing: 0.5,
        }}>
          Przytrzymaj mapę, aby wskazać cel
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
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: theme.text, fontWeight: '700' }}>
            Anuluj wybór punktu
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
