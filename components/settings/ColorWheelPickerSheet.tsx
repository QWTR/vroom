import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import ColorPicker from 'react-native-wheel-color-picker';
import { useTheme } from '../../contexts/ThemeContext';

export function normalizePickerHex(raw: string): string {
  if (!raw || typeof raw !== 'string') return '#888888';
  const t = raw.trim();
  if (/^#[0-9A-Fa-f]{6}$/i.test(t)) return t.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/i.test(t)) {
    const a = t.slice(1).split('');
    return `#${a[0]}${a[0]}${a[1]}${a[1]}${a[2]}${a[2]}`.toUpperCase();
  }
  return '#888888';
}

type Props = {
  visible: boolean;
  title: string;
  color: string;
  onClose: () => void;
  onConfirm: (hex: string) => void;
};

export function ColorWheelPickerSheet({ visible, title, color, onClose, onConfirm }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [temp, setTemp] = useState(normalizePickerHex(color));

  useEffect(() => {
    if (visible) setTemp(normalizePickerHex(color));
  }, [visible, color]);

  const apply = () => {
    onConfirm(normalizePickerHex(temp));
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000cc', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingTop: 16,
          paddingBottom: insets.bottom + 16,
          borderTopWidth: 1,
          borderColor: theme.border2,
        }}>
          <View style={{ width: 40, height: 4, backgroundColor: theme.border3, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 }}>
            <View style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              backgroundColor: normalizePickerHex(temp),
              borderWidth: 2,
              borderColor: theme.border3,
              marginRight: 12,
            }} />
            <Text style={{ flex: 1, fontFamily: 'Orbitron', fontSize: 11, color: theme.text, letterSpacing: 0.5 }} numberOfLines={2}>
              {title}
            </Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>
              {normalizePickerHex(temp)}
            </Text>
          </View>

          <View style={{ height: 280, paddingHorizontal: 20 }}>
            <ColorPicker
              color={temp}
              onColorChange={(c: string) => setTemp(c)}
              thumbSize={30}
              sliderSize={30}
              noSnap
              row={false}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 16 }}>
            <TouchableOpacity
              style={{
                flex: 1,
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
                backgroundColor: theme.surface2,
                borderWidth: 1,
                borderColor: theme.border2,
              }}
              onPress={onClose}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim }}>ANULUJ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                flex: 2,
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
                backgroundColor: theme.primary,
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
              onPress={apply}
            >
              <MaterialIcons name="check" size={18} color="#fff" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '700' }}>
                WYBIERZ
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type RowProps = {
  label: string;
  value: string;
  onOpen: () => void;
  swatchBorder: string;
  rowBg: string;
  textMain: string;
  textDim: string;
};

export function ColorPickTriggerRow({ label, value, onOpen, swatchBorder, rowBg, textMain, textDim }: RowProps) {
  const safe = normalizePickerHex(value);
  return (
    <TouchableOpacity
      onPress={onOpen}
      activeOpacity={0.75}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        backgroundColor: rowBg,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: swatchBorder,
      }}
    >
      <View style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: safe,
        borderWidth: 2,
        borderColor: swatchBorder,
      }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: textMain, fontWeight: '600' }}>{label}</Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: textDim, marginTop: 3 }}>{safe}</Text>
      </View>
      <MaterialIcons name="colorize" size={22} color={textDim} />
    </TouchableOpacity>
  );
}
