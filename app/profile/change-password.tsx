import React, { useState } from 'react';
import {
  View, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Text,
} from 'react-native';
import { useRouter }  from 'expo-router';
import MaterialIcons  from '@expo/vector-icons/MaterialIcons';
import AsyncStorage   from '@react-native-async-storage/async-storage';
import Toast          from 'react-native-toast-message';
import { API_URL }    from '../../constants/config';
import { useTheme }   from '../../contexts/ThemeContext';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { theme } = useTheme();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading,         setLoading]         = useState(false);
  const [showCurrent,     setShowCurrent]     = useState(false);
  const [showNew,         setShowNew]         = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);

  const isReady = currentPassword && newPassword && confirmPassword && newPassword === confirmPassword;

  const handleSave = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wypełnij wszystkie pola.' }); return; }
    if (newPassword.length < 6)                               { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nowe hasło musi mieć min. 6 znaków.' }); return; }
    if (newPassword !== confirmPassword)                      { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasła nie są identyczne.' }); return; }
    if (newPassword === currentPassword)                      { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nowe hasło musi być inne niż obecne.' }); return; }
    setLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/auth/change-password`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Błąd');
      Toast.show({ type: 'success', text1: '✅ HASŁO ZMIENIONE', text2: 'Twoje hasło zostało zaktualizowane.' });
      router.back();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie można zmienić hasła.' });
    } finally { setLoading(false); }
  };

  const inputBase = { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: theme.surface3, borderRadius: 12, borderWidth: 1, borderColor: theme.border2 };
  const inputStyle = { flex: 1, color: theme.text, fontFamily: 'Orbitron' as const, fontSize: 12, paddingHorizontal: 10, paddingVertical: 14 };
  const labelStyle = { fontFamily: 'Orbitron' as const, color: theme.textDim, fontSize: 8, letterSpacing: 2, marginBottom: 4 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%' }} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">

      {/* NAGŁÓWEK */}
      <View style={{ marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 12 }}>← Wróć</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 15, color: theme.text, letterSpacing: 2 }}>ZMIEŃ HASŁO</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* INFO */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.primaryBg, borderRadius: 12, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: theme.primaryBorder }}>
        <MaterialIcons name="lock-outline" size={20} color={theme.primary} />
        <Text style={{ fontFamily: 'Orbitron', color: theme.textMuted, fontSize: 10, flex: 1 }}>Hasło musi mieć minimum 6 znaków.</Text>
      </View>

      {/* FORMULARZ */}
      <View style={{ backgroundColor: theme.surface3, borderRadius: 16, padding: 20, gap: 10, borderWidth: 1, borderColor: theme.border, marginBottom: 24 }}>

        <Text style={labelStyle}>OBECNE HASŁO</Text>
        <View style={inputBase}>
          <MaterialIcons name="lock-outline" size={18} color={theme.textDim} style={{ marginLeft: 12 }} />
          <TextInput style={inputStyle} value={currentPassword} onChangeText={setCurrentPassword} placeholder="Wpisz obecne hasło" placeholderTextColor={theme.textFaint} secureTextEntry={!showCurrent} autoCapitalize="none" />
          <TouchableOpacity onPress={() => setShowCurrent(v => !v)} style={{ padding: 12 }}>
            <MaterialIcons name={showCurrent ? 'visibility' : 'visibility-off'} size={18} color={theme.textDim} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 1, backgroundColor: theme.border2, marginVertical: 6 }} />

        <Text style={labelStyle}>NOWE HASŁO</Text>
        <View style={inputBase}>
          <MaterialIcons name="lock-reset" size={18} color={theme.textDim} style={{ marginLeft: 12 }} />
          <TextInput style={inputStyle} value={newPassword} onChangeText={setNewPassword} placeholder="Wpisz nowe hasło" placeholderTextColor={theme.textFaint} secureTextEntry={!showNew} autoCapitalize="none" />
          <TouchableOpacity onPress={() => setShowNew(v => !v)} style={{ padding: 12 }}>
            <MaterialIcons name={showNew ? 'visibility' : 'visibility-off'} size={18} color={theme.textDim} />
          </TouchableOpacity>
        </View>

        {/* Siła hasła */}
        {newPassword.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
            {[1, 2, 3, 4].map(i => (
              <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: newPassword.length >= i * 3 ? (newPassword.length >= 10 ? '#4CAF50' : newPassword.length >= 6 ? '#FF9800' : theme.primary) : theme.border2 }} />
            ))}
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginLeft: 6 }}>
              {newPassword.length < 6 ? 'Za krótkie' : newPassword.length < 10 ? 'Słabe' : 'Silne'}
            </Text>
          </View>
        )}

        <View style={{ height: 1, backgroundColor: theme.border2, marginVertical: 6 }} />

        <Text style={labelStyle}>POTWIERDŹ NOWE HASŁO</Text>
        <View style={[inputBase, confirmPassword && newPassword !== confirmPassword && { borderColor: '#e33835' }]}>
          <MaterialIcons name="check-circle-outline" size={18} color={theme.textDim} style={{ marginLeft: 12 }} />
          <TextInput style={inputStyle} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Powtórz nowe hasło" placeholderTextColor={theme.textFaint} secureTextEntry={!showConfirm} autoCapitalize="none" />
          <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={{ padding: 12 }}>
            <MaterialIcons name={showConfirm ? 'visibility' : 'visibility-off'} size={18} color={theme.textDim} />
          </TouchableOpacity>
        </View>
        {confirmPassword && newPassword !== confirmPassword && (
          <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9, marginTop: 4 }}>Hasła nie są identyczne</Text>
        )}
        {confirmPassword && newPassword === confirmPassword && (
          <Text style={{ fontFamily: 'Orbitron', color: '#4CAF50', fontSize: 9, marginTop: 4 }}>✓ Hasła są identyczne</Text>
        )}
      </View>

      {/* PRZYCISK */}
      <TouchableOpacity
        style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 }, !isReady && { opacity: 0.4 }]}
        onPress={handleSave} disabled={!isReady || loading} activeOpacity={0.85}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <><MaterialIcons name="lock" size={18} color="#fff" /><Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>ZMIEŃ HASŁO</Text></>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}