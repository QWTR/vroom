import React, { useState, useEffect } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../components/ui/AppText';
import { useRouter }    from 'expo-router';
import MaterialIcons    from '@expo/vector-icons/MaterialIcons';
import AsyncStorage     from '@react-native-async-storage/async-storage';
import Toast            from 'react-native-toast-message';
import { API_URL }      from '../../constants/config';
import { useTheme }     from '../../contexts/ThemeContext';
import { useFormKeyboardPadding } from '../../hooks/useKeyboardInset';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function ChangeEmailScreen() {
  const router = useRouter();
  const { theme } = useTheme();

  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail,     setNewEmail]     = useState('');
  const [password,     setPassword]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [showPass,     setShowPass]     = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) { const u = JSON.parse(raw); setCurrentEmail(u.email ?? ''); }
    });
  }, []);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const isReady = newEmail && password && isValidEmail(newEmail) && newEmail !== currentEmail;

  const handleSave = async () => {
    if (!isValidEmail(newEmail))          { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj prawidłowy adres e-mail.' }); return; }
    if (newEmail === currentEmail)        { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nowy e-mail musi być inny niż obecny.' }); return; }
    if (!password)                        { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wpisz hasło aby potwierdzić.' }); return; }
    setLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/auth/change-email`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Błąd');
      const raw = await AsyncStorage.getItem('user');
      if (raw) await AsyncStorage.setItem('user', JSON.stringify({ ...JSON.parse(raw), email: newEmail }));
      Toast.show({ type: 'success', text1: '✅ E-MAIL ZMIENIONY', text2: newEmail });
      router.back();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie można zmienić e-maila.' });
    } finally { setLoading(false); }
  };

  const inputBase = { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: theme.surface3, borderRadius: 12, borderWidth: 1, borderColor: theme.border2 };
  const { scrollPaddingBottom } = useFormKeyboardPadding(80);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%' }} contentContainerStyle={{ paddingBottom: scrollPaddingBottom }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

      {/* NAGŁÓWEK */}
      <View style={{ marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.primary, fontSize: 12 }}>← Wróć</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: theme.text, letterSpacing: 1 }}>ZMIEŃ E-MAIL</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* OBECNY EMAIL */}
      <View style={{ backgroundColor: theme.surface3, borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: theme.border }}>
        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textFaint, fontSize: 12, letterSpacing: 1, marginBottom: 6 }}>OBECNY E-MAIL</Text>
        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.primary, fontSize: 13 }}>{currentEmail || '...'}</Text>
      </View>

      {/* FORMULARZ */}
      <View style={{ backgroundColor: theme.surface3, borderRadius: 16, padding: 20, gap: 10, borderWidth: 1, borderColor: theme.border, marginBottom: 24 }}>

        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, letterSpacing: 1, marginBottom: 4 }}>NOWY E-MAIL</Text>
        <View style={[inputBase,
          newEmail && !isValidEmail(newEmail)                          && { borderColor: '#e33835' },
          newEmail && isValidEmail(newEmail) && newEmail !== currentEmail && { borderColor: '#4CAF5050' },
        ]}>
          <MaterialIcons name="email" size={18} color={theme.textDim} style={{ marginLeft: 12 }} />
          <TextInput style={{ flex: 1, color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, paddingHorizontal: 10, paddingVertical: 14 }} value={newEmail} onChangeText={setNewEmail} placeholder="nowy@email.com" placeholderTextColor={theme.textFaint} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          {newEmail && isValidEmail(newEmail) && newEmail !== currentEmail && (
            <MaterialIcons name="check-circle" size={18} color="#4CAF50" style={{ marginRight: 12 }} />
          )}
        </View>
        {newEmail && !isValidEmail(newEmail) && (
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#e33835', fontSize: 12, marginTop: 4 }}>Nieprawidłowy format e-mail</Text>
        )}
        {newEmail && newEmail === currentEmail && (
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#e33835', fontSize: 12, marginTop: 4 }}>Nowy e-mail musi być inny niż obecny</Text>
        )}

        <View style={{ height: 1, backgroundColor: theme.border2, marginVertical: 6 }} />

        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, letterSpacing: 1, marginBottom: 4 }}>POTWIERDŹ HASŁEM</Text>
        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textFaint, fontSize: 12, marginBottom: 8, marginTop: -4 }}>Ze względów bezpieczeństwa wymagamy hasła</Text>
        <View style={inputBase}>
          <MaterialIcons name="lock-outline" size={18} color={theme.textDim} style={{ marginLeft: 12 }} />
          <TextInput style={{ flex: 1, color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, paddingHorizontal: 10, paddingVertical: 14 }} value={password} onChangeText={setPassword} placeholder="Wpisz swoje hasło" placeholderTextColor={theme.textFaint} secureTextEntry={!showPass} autoCapitalize="none" />
          <TouchableOpacity onPress={() => setShowPass(v => !v)} style={{ padding: 12 }}>
            <MaterialIcons name={showPass ? 'visibility' : 'visibility-off'} size={18} color={theme.textDim} />
          </TouchableOpacity>
        </View>
      </View>

      {/* PRZYCISK */}
      <TouchableOpacity
        style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 }, !isReady && { opacity: 0.4 }]}
        onPress={handleSave} disabled={!isReady || loading} activeOpacity={0.85}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <><MaterialIcons name="email" size={18} color="#fff" /><Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>ZMIEŃ E-MAIL</Text></>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}