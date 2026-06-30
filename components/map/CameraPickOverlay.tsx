import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';

type Props = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CameraPickOverlay({ visible, onCancel, onConfirm }: Props) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFillObject, { zIndex: 52 }]}
    >
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
          PRZESUŃ MAPĘ · ŚRODEK = MIEJSCE FOTORADARU
        </Text>
      </View>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}
      >
        <MaterialCommunityIcons
          name="crosshairs-gps"
          size={58}
          color={isDark ? '#ffffffaa' : theme.textDim}
          style={{ marginTop: -28 }}
        />
      </View>
      <View style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: insets.bottom + 88,
        flexDirection: 'row',
        gap: 10,
      }}
      >
        <TouchableOpacity
          onPress={onCancel}
          style={{
            flex: 1,
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: isDark ? theme.surface3 : theme.surface2,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>
            ANULUJ
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onConfirm}
          style={{
            flex: 1,
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: '#e33835',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.onPrimary, fontWeight: '700' }}>
            DODAJ
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
