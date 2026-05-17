import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Pressable, Platform, TextInput, ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';

interface Props {
  visible: boolean;
  latitude: number | null;
  longitude: number | null;
  onClose: () => void;
  onSubmit: (data: { name: string; brand?: string; lat: number; lng: number; address?: string }) => Promise<boolean>;
}

export function AddFuelStationModal({ visible, latitude, longitude, onClose, onSubmit }: Props) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset(visible);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setBrand('');
      setAddress('');
    }
  }, [visible, latitude, longitude]);

  if (latitude == null || longitude == null) return null;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      Toast.show({ type: 'error', text1: 'Podaj nazwę stacji' });
      return;
    }
    setSaving(true);
    try {
      const ok = await onSubmit({
        name: trimmed,
        brand: brand.trim() || undefined,
        address: address.trim() || undefined,
        lat: latitude,
        lng: longitude,
      });
      if (ok) {
        Toast.show({ type: 'success', text1: 'Stacja dodana', text2: trimmed });
        onClose();
      } else {
        Toast.show({ type: 'error', text1: 'Nie udało się dodać stacji' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderTopWidth: 1,
          borderColor: isDark ? '#1e1e1e' : '#e0e0e0',
          padding: 20,
          paddingBottom: keyboardInset > 0
            ? keyboardInset + 12
            : Math.max(insets.bottom, Platform.OS === 'ios' ? 34 : 20),
        }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: isDark ? '#333' : '#ddd', alignSelf: 'center', marginBottom: 16 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <MaterialCommunityIcons name="gas-station" size={28} color="#00bfff" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: theme.text, fontWeight: '700' }}>DODAJ STACJĘ</Text>
              <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 4 }}>
                {latitude.toFixed(5)}, {longitude.toFixed(5)}
              </Text>
            </View>
          </View>

          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 1, marginBottom: 6 }}>NAZWA *</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="np. Orlen Centrum"
            placeholderTextColor={theme.textDim}
            style={{
              color: theme.text, backgroundColor: theme.surface2, borderRadius: 12,
              borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
            }}
          />

          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 1, marginBottom: 6 }}>MARKA (OPCJONALNIE)</Text>
          <TextInput
            value={brand}
            onChangeText={setBrand}
            placeholder="Orlen, BP, Shell…"
            placeholderTextColor={theme.textDim}
            style={{
              color: theme.text, backgroundColor: theme.surface2, borderRadius: 12,
              borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
            }}
          />

          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 1, marginBottom: 6 }}>ADRES (OPCJONALNIE)</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Ulica, miasto"
            placeholderTextColor={theme.textDim}
            style={{
              color: theme.text, backgroundColor: theme.surface2, borderRadius: 12,
              borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18,
            }}
          />

          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={{
              paddingVertical: 14, borderRadius: 14, backgroundColor: '#00bfff',
              alignItems: 'center', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '700' }}>ZAPISZ NA MAPIE</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
