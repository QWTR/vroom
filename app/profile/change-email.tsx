import React, { useState, useEffect } from 'react';
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

export default function ChangeEmailScreen() {
  const router = useRouter();

  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail,     setNewEmail]     = useState('');
  const [password,     setPassword]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [showPass,     setShowPass]     = useState(false);

  // Wczytaj obecny email
  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) {
        const u = JSON.parse(raw);
        setCurrentEmail(u.email ?? '');
      }
    });
  }, []);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const isReady = newEmail && password && isValidEmail(newEmail) && newEmail !== currentEmail;

  const handleSave = async () => {
    if (!isValidEmail(newEmail)) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj prawidłowy adres e-mail.' });
      return;
    }
    if (newEmail === currentEmail) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nowy e-mail musi być inny niż obecny.' });
      return;
    }
    if (!password) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wpisz hasło aby potwierdzić.' });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/auth/change-email`, {
        method:  'PATCH',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newEmail, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Błąd');

      // Zaktualizuj lokalny cache
      const raw = await AsyncStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        await AsyncStorage.setItem('user', JSON.stringify({ ...u, email: newEmail }));
      }

      Toast.show({ type: 'success', text1: '✅ E-MAIL ZMIENIONY', text2: newEmail });
      router.back();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie można zmienić e-maila.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">

      {/* NAGŁÓWEK */}
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backBtn}>← Wróć</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>ZMIEŃ E-MAIL</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* OBECNY EMAIL */}
      <View style={s.currentCard}>
        <Text style={s.currentLabel}>OBECNY E-MAIL</Text>
        <Text style={s.currentValue}>{currentEmail || '...'}</Text>
      </View>

      {/* FORMULARZ */}
      <View style={s.form}>

        {/* Nowy email */}
        <Text style={s.label}>NOWY E-MAIL</Text>
        <View style={[
          s.inputWrap,
          newEmail && !isValidEmail(newEmail) && s.inputError,
          newEmail && isValidEmail(newEmail) && newEmail !== currentEmail && s.inputSuccess,
        ]}>
          <MaterialIcons name="email" size={18} color="#ffffff30" style={s.inputIcon} />
          <TextInput
            style={s.input}
            value={newEmail}
            onChangeText={setNewEmail}
            placeholder="nowy@email.com"
            placeholderTextColor="#ffffff25"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {newEmail && isValidEmail(newEmail) && newEmail !== currentEmail && (
            <MaterialIcons name="check-circle" size={18} color="#4CAF50" style={{ marginRight: 12 }} />
          )}
        </View>
        {newEmail && !isValidEmail(newEmail) && (
          <Text style={s.errorText}>Nieprawidłowy format e-mail</Text>
        )}
        {newEmail && newEmail === currentEmail && (
          <Text style={s.errorText}>Nowy e-mail musi być inny niż obecny</Text>
        )}

        <View style={s.separator} />

        {/* Potwierdź hasłem */}
        <Text style={s.label}>POTWIERDŹ HASŁEM</Text>
        <Text style={s.sublabel}>Ze względów bezpieczeństwa wymagamy hasła</Text>
        <View style={s.inputWrap}>
          <MaterialIcons name="lock-outline" size={18} color="#ffffff30" style={s.inputIcon} />
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Wpisz swoje hasło"
            placeholderTextColor="#ffffff25"
            secureTextEntry={!showPass}
            autoCapitalize="none"
          />
          <TouchableOpacity onPress={() => setShowPass(v => !v)} style={s.eyeBtn}>
            <MaterialIcons name={showPass ? 'visibility' : 'visibility-off'} size={18} color="#ffffff30" />
          </TouchableOpacity>
        </View>

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
              <MaterialIcons name="email" size={18} color="#fff" />
              <Text style={s.saveBtnText}>ZMIEŃ E-MAIL</Text>
            </>
        }
      </TouchableOpacity>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  headerRow:    { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  headerTitle:  { fontFamily: 'Orbitron', fontSize: 15, color: '#fff', letterSpacing: 2 },
  backBtn:      { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },

  currentCard:  { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#ffffff08' },
  currentLabel: { fontFamily: 'Orbitron', color: '#ffffff30', fontSize: 8, letterSpacing: 2, marginBottom: 6 },
  currentValue: { fontFamily: 'Orbitron', color: '#e33835', fontSize: 13 },

  form:         { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20, gap: 10, borderWidth: 1, borderColor: '#ffffff08', marginBottom: 24 },
  label:        { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 8, letterSpacing: 2, marginBottom: 4 },
  sublabel:     { fontFamily: 'Orbitron', color: '#ffffff25', fontSize: 8, marginBottom: 8, marginTop: -4 },
  separator:    { height: 1, backgroundColor: '#ffffff08', marginVertical: 6 },

  inputWrap:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#252525', borderRadius: 12, borderWidth: 1, borderColor: '#ffffff10' },
  inputError:   { borderColor: '#e33835' },
  inputSuccess: { borderColor: '#4CAF5050' },
  inputIcon:    { marginLeft: 12 },
  input:        { flex: 1, color: '#fff', fontFamily: 'Orbitron', fontSize: 12, paddingHorizontal: 10, paddingVertical: 14 },
  eyeBtn:       { padding: 12 },

  errorText:    { fontFamily: 'Orbitron', color: '#e33835', fontSize: 9, marginTop: 4 },

  saveBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#e33835', borderRadius: 14, paddingVertical: 16, elevation: 6, shadowColor: '#e33835', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  saveBtnText:  { fontFamily: 'Orbitron', color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
});