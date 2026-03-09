import React, { useState } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../constants/config';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function ChangePasswordScreen() {
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading,         setLoading]         = useState(false);
  const [showCurrent,     setShowCurrent]     = useState(false);
  const [showNew,         setShowNew]         = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);

  const handleSave = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wypełnij wszystkie pola.' });
      return;
    }
    if (newPassword.length < 6) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nowe hasło musi mieć min. 6 znaków.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasła nie są identyczne.' });
      return;
    }
    if (newPassword === currentPassword) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nowe hasło musi być inne niż obecne.' });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/auth/change-password`, {
        method:  'PATCH',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Błąd');

      Toast.show({ type: 'success', text1: '✅ HASŁO ZMIENIONE', text2: 'Twoje hasło zostało zaktualizowane.' });
      router.back();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie można zmienić hasła.' });
    } finally {
      setLoading(false);
    }
  };

  const isReady = currentPassword && newPassword && confirmPassword && newPassword === confirmPassword;

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">

      {/* NAGŁÓWEK */}
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backBtn}>← Wróć</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>ZMIEŃ HASŁO</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* INFO */}
      <View style={s.infoCard}>
        <MaterialIcons name="lock-outline" size={20} color="#e33835" />
        <Text style={s.infoText}>Hasło musi mieć minimum 6 znaków.</Text>
      </View>

      {/* FORMULARZ */}
      <View style={s.form}>

        {/* Obecne hasło */}
        <Text style={s.label}>OBECNE HASŁO</Text>
        <View style={s.inputWrap}>
          <MaterialIcons name="lock-outline" size={18} color="#ffffff30" style={s.inputIcon} />
          <TextInput
            style={s.input}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Wpisz obecne hasło"
            placeholderTextColor="#ffffff25"
            secureTextEntry={!showCurrent}
            autoCapitalize="none"
          />
          <TouchableOpacity onPress={() => setShowCurrent(v => !v)} style={s.eyeBtn}>
            <MaterialIcons name={showCurrent ? 'visibility' : 'visibility-off'} size={18} color="#ffffff30" />
          </TouchableOpacity>
        </View>

        <View style={s.separator} />

        {/* Nowe hasło */}
        <Text style={s.label}>NOWE HASŁO</Text>
        <View style={s.inputWrap}>
          <MaterialIcons name="lock-reset" size={18} color="#ffffff30" style={s.inputIcon} />
          <TextInput
            style={s.input}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Wpisz nowe hasło"
            placeholderTextColor="#ffffff25"
            secureTextEntry={!showNew}
            autoCapitalize="none"
          />
          <TouchableOpacity onPress={() => setShowNew(v => !v)} style={s.eyeBtn}>
            <MaterialIcons name={showNew ? 'visibility' : 'visibility-off'} size={18} color="#ffffff30" />
          </TouchableOpacity>
        </View>

        {/* Siła hasła */}
        {newPassword.length > 0 && (
          <View style={s.strengthRow}>
            {[1, 2, 3, 4].map(i => (
              <View
                key={i}
                style={[
                  s.strengthBar,
                  {
                    backgroundColor:
                      newPassword.length >= i * 3
                        ? newPassword.length >= 10 ? '#4CAF50'
                          : newPassword.length >= 6 ? '#FF9800'
                          : '#e33835'
                        : '#ffffff10',
                  },
                ]}
              />
            ))}
            <Text style={s.strengthLabel}>
              {newPassword.length < 6 ? 'Za krótkie' : newPassword.length < 10 ? 'Słabe' : 'Silne'}
            </Text>
          </View>
        )}

        <View style={s.separator} />

        {/* Potwierdź hasło */}
        <Text style={s.label}>POTWIERDŹ NOWE HASŁO</Text>
        <View style={[s.inputWrap, confirmPassword && newPassword !== confirmPassword && s.inputError]}>
          <MaterialIcons name="check-circle-outline" size={18} color="#ffffff30" style={s.inputIcon} />
          <TextInput
            style={s.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Powtórz nowe hasło"
            placeholderTextColor="#ffffff25"
            secureTextEntry={!showConfirm}
            autoCapitalize="none"
          />
          <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={s.eyeBtn}>
            <MaterialIcons name={showConfirm ? 'visibility' : 'visibility-off'} size={18} color="#ffffff30" />
          </TouchableOpacity>
        </View>
        {confirmPassword && newPassword !== confirmPassword && (
          <Text style={s.errorText}>Hasła nie są identyczne</Text>
        )}
        {confirmPassword && newPassword === confirmPassword && (
          <Text style={s.successText}>✓ Hasła są identyczne</Text>
        )}

      </View>

      {/* PRZYCISK */}
      <TouchableOpacity
        style={[s.saveBtn, !isReady && { opacity: 0.4 }]}
        onPress={handleSave}
        disabled={!isReady || loading}
        activeOpacity={0.85}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <>
              <MaterialIcons name="lock" size={18} color="#fff" />
              <Text style={s.saveBtnText}>ZMIEŃ HASŁO</Text>
            </>
        }
      </TouchableOpacity>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  headerRow:     { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  headerTitle:   { fontFamily: 'Orbitron', fontSize: 15, color: '#fff', letterSpacing: 2 },
  backBtn:       { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },

  infoCard:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#e3383512', borderRadius: 12, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: '#e3383530' },
  infoText:      { fontFamily: 'Orbitron', color: '#ffffff80', fontSize: 10, flex: 1 },

  form:          { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20, gap: 10, borderWidth: 1, borderColor: '#ffffff08', marginBottom: 24 },
  label:         { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 8, letterSpacing: 2, marginBottom: 4 },
  separator:     { height: 1, backgroundColor: '#ffffff08', marginVertical: 6 },

  inputWrap:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#252525', borderRadius: 12, borderWidth: 1, borderColor: '#ffffff10' },
  inputError:    { borderColor: '#e33835' },
  inputIcon:     { marginLeft: 12 },
  input:         { flex: 1, color: '#fff', fontFamily: 'Orbitron', fontSize: 12, paddingHorizontal: 10, paddingVertical: 14 },
  eyeBtn:        { padding: 12 },

  strengthRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  strengthBar:   { flex: 1, height: 3, borderRadius: 2 },
  strengthLabel: { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 8, marginLeft: 6 },

  errorText:     { fontFamily: 'Orbitron', color: '#e33835', fontSize: 9, marginTop: 4 },
  successText:   { fontFamily: 'Orbitron', color: '#4CAF50', fontSize: 9, marginTop: 4 },

  saveBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#e33835', borderRadius: 14, paddingVertical: 16, elevation: 6, shadowColor: '#e33835', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  saveBtnText:   { fontFamily: 'Orbitron', color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
});