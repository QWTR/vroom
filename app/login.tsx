import React, { useState } from 'react';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

const API_URL  = 'https://v-room.app/api/auth';
const SAPI_URL = 'https://v-room.app/sapi';

type Screen    = 'login' | 'register' | 'forgot';
type ResetStep = 'email' | 'code' | 'password';

export default function LoginScreen() {
  const router = useRouter();

  // ── Ekran ──────────────────────────────────────────────────────────────
  const [screen,        setScreen]        = useState<Screen>('login');

  // ��─ Login / Register ───────────────────────────────────────────────────
  const [email,         setEmail]         = useState('');
  const [password,      setPassword]      = useState('');
  const [username,      setUsername]      = useState('');
  const [confirmPass,   setConfirmPass]   = useState('');
  const [showPassword,  setShowPassword]  = useState(false);
  const [showConfirm,   setShowConfirm]   = useState(false);

  // ── Forgot / Reset ─────────────────────────────────────────────────────
  const [resetStep,     setResetStep]     = useState<ResetStep>('email');
  const [forgotEmail,   setForgotEmail]   = useState('');
  const [resetCode,     setResetCode]     = useState('');
  const [resetToken,    setResetToken]    = useState('');
  const [newPassword,   setNewPassword]   = useState('');
  const [showNewPass,   setShowNewPass]   = useState(false);

  // ── Loading ────────────────────────────────────────────────────────────
  const [loading,       setLoading]       = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────
  const goToLogin = () => {
    setScreen('login');
    setResetStep('email');
    setForgotEmail('');
    setResetCode('');
    setResetToken('');
    setNewPassword('');
  };

  const strengthColor = (len: number) =>
    len >= 10 ? '#4CAF50' : len >= 6 ? '#FF9800' : '#e33835';

  const strengthLabel = (len: number) =>
    len < 6 ? 'Za krótkie' : len < 10 ? 'Słabe' : 'Silne';

  // ════════════════════════════════════════════════════════════════════════
  // LOGOWANIE
  // ════════════════════════════════════════════════════════════════════════
  const handleLogin = async () => {
    if (!email || !password) {
      Toast.show({ type: 'error', text1: 'ODMOWA DOSTĘPU', text2: 'Wypełnij wszystkie pola.' });
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (res.ok) {
        await AsyncStorage.setItem('userToken', data.token);
        await AsyncStorage.setItem('token',     data.token);
        await AsyncStorage.setItem('user',      JSON.stringify(data.user));
        router.replace('/(tabs)');
      } else {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Nieprawidłowe dane.' });
      }
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można połączyć się z serwerem.' });
    } finally {
      setLoading(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // REJESTRACJA
  // ════════════════════════════════════════════════════════════════════════
  const handleRegister = async () => {
    if (!email || !password || !username) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wypełnij wszystkie pola.' });
      return;
    }
    if (password.length < 6) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasło musi mieć min. 6 znaków.' });
      return;
    }
    if (password !== confirmPass) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasła nie są identyczne.' });
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password, username: username.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        Toast.show({ type: 'success', text1: '🚗 WITAJ W VROOM!', text2: 'Konto utworzone. Zaloguj się.' });
        setScreen('login');
        setPassword('');
        setConfirmPass('');
      } else {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Nie można utworzyć konta.' });
      }
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można połączyć się z serwerem.' });
    } finally {
      setLoading(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // RESET HASŁA – KROK 1: wyślij email
  // ════════════════════════════════════════════════════════════════════════
  const handleForgot = async () => {
    if (!forgotEmail) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj adres e-mail.' });
      return;
    }
    setLoading(true);
    try {
      await fetch(`${SAPI_URL}/auth/forgot-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: forgotEmail.trim() }),
      });
      setResetStep('code');
      Toast.show({ type: 'success', text1: '📧 KOD WYSŁANY', text2: 'Sprawdź swoją skrzynkę.' });
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Błąd serwera. Spróbuj ponownie.' });
    } finally {
      setLoading(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // RESET HASŁA – KROK 2: weryfikuj kod
  // ════════════════════════════════════════════════════════════════════════
  const handleVerifyCode = async () => {
    if (resetCode.length !== 6) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wpisz 6-cyfrowy kod.' });
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${SAPI_URL}/auth/verify-reset-code`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: forgotEmail.trim(), code: resetCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setResetToken(data.token);
      setResetStep('password');
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nieprawidłowy kod.' });
    } finally {
      setLoading(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // RESET HASŁA – KROK 3: ustaw nowe hasło
  // ════════════════════════════════════════════════════════════════════════
  const handleResetPassword = async () => {
    if (newPassword.length < 6) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasło musi mieć min. 6 znaków.' });
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${SAPI_URL}/auth/reset-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: resetToken, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      Toast.show({ type: 'success', text1: '✅ HASŁO ZMIENIONE', text2: 'Możesz się teraz zalogować.' });
      goToLogin();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Błąd serwera.' });
    } finally {
      setLoading(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // RENDER – FORGOT PASSWORD
  // ════════════════════════════════════════════════════════════════════════
  if (screen === 'forgot') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.container}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <TouchableOpacity style={s.backRow} onPress={goToLogin}>
            <MaterialIcons name="arrow-back" size={20} color="#e33835" />
            <Text style={s.backText}>Wróć do logowania</Text>
          </TouchableOpacity>

          <View style={s.logoWrap}>
            <Image source={require('../assets/images/logo-RED.png')} style={s.logo} resizeMode="contain" />
          </View>

          {/* KROKI */}
          <View style={s.stepsRow}>
            {(['email', 'code', 'password'] as ResetStep[]).map((step, i) => {
              const isDone   = (step === 'email' && (resetStep === 'code' || resetStep === 'password'))
                            || (step === 'code'  && resetStep === 'password');
              const isActive = resetStep === step;
              return (
                <React.Fragment key={step}>
                  <View style={[s.stepDot, isActive && s.stepDotActive, isDone && s.stepDotDone]}>
                    {isDone
                      ? <MaterialIcons name="check" size={14} color="#4CAF50" />
                      : <Text style={[s.stepNum, isActive && { color: '#e33835' }]}>{i + 1}</Text>
                    }
                  </View>
                  {i < 2 && <View style={[s.stepLine, isDone && s.stepLineDone]} />}
                </React.Fragment>
              );
            })}
          </View>

          {/* ── KROK 1: Email ── */}
          {resetStep === 'email' && (
            <>
              <View style={s.titleWrap}>
                <Text style={s.title}>RESET HASŁA</Text>
                <Text style={s.subtitle}>Podaj e-mail powiązany z kontem.{'\n'}Wyślemy 6-cyfrowy kod weryfikacyjny.</Text>
              </View>

              <View style={s.card}>
                <Text style={s.fieldLabel}>ADRES E-MAIL</Text>
                <View style={s.inputRow}>
                  <MaterialIcons name="email" size={18} color="#e33835" style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    placeholder="twoj@email.com"
                    placeholderTextColor="#ffffff25"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={forgotEmail}
                    onChangeText={setForgotEmail}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[s.mainBtn, (!forgotEmail || loading) && { opacity: 0.5 }]}
                onPress={handleForgot}
                disabled={!forgotEmail || loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <><MaterialIcons name="send" size={18} color="#fff" /><Text style={s.mainBtnText}>WYŚLIJ KOD</Text></>
                }
              </TouchableOpacity>
            </>
          )}

          {/* ── KROK 2: Kod ── */}
          {resetStep === 'code' && (
            <>
              <View style={s.titleWrap}>
                <Text style={s.title}>WPISZ KOD</Text>
                <Text style={s.subtitle}>
                  Wysłaliśmy 6-cyfrowy kod na{'\n'}
                  <Text style={{ color: '#e33835' }}>{forgotEmail}</Text>
                </Text>
              </View>

              <View style={s.card}>
                <Text style={s.fieldLabel}>KOD WERYFIKACYJNY</Text>
                <View style={s.inputRow}>
                  <MaterialIcons name="pin" size={18} color="#e33835" style={s.inputIcon} />
                  <TextInput
                    style={[s.input, s.codeInput]}
                    placeholder="000000"
                    placeholderTextColor="#ffffff25"
                    keyboardType="number-pad"
                    maxLength={6}
                    value={resetCode}
                    onChangeText={setResetCode}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[s.mainBtn, (resetCode.length !== 6 || loading) && { opacity: 0.5 }]}
                onPress={handleVerifyCode}
                disabled={resetCode.length !== 6 || loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <><MaterialIcons name="verified" size={18} color="#fff" /><Text style={s.mainBtnText}>WERYFIKUJ KOD</Text></>
                }
              </TouchableOpacity>

              <TouchableOpacity style={s.resendBtn} onPress={handleForgot} disabled={loading}>
                <Text style={s.resendText}>Nie dostałeś kodu? Wyślij ponownie →</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── KROK 3: Nowe hasło ── */}
          {resetStep === 'password' && (
            <>
              <View style={s.titleWrap}>
                <Text style={s.title}>NOWE HASŁO</Text>
                <Text style={s.subtitle}>Ustaw nowe hasło do konta VROOM.</Text>
              </View>

              <View style={s.card}>
                <Text style={s.fieldLabel}>NOWE HASŁO</Text>
                <View style={s.inputRow}>
                  <MaterialIcons name="lock" size={18} color="#e33835" style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    placeholder="Min. 6 znaków"
                    placeholderTextColor="#ffffff25"
                    secureTextEntry={!showNewPass}
                    autoCapitalize="none"
                    value={newPassword}
                    onChangeText={setNewPassword}
                  />
                  <TouchableOpacity onPress={() => setShowNewPass(v => !v)} style={s.eyeBtn}>
                    <MaterialIcons name={showNewPass ? 'visibility' : 'visibility-off'} size={18} color="#ffffff30" />
                  </TouchableOpacity>
                </View>

                {newPassword.length > 0 && (
                  <View style={s.strengthRow}>
                    {[1,2,3,4].map(i => (
                      <View key={i} style={[s.strengthBar, {
                        backgroundColor: newPassword.length >= i * 3 ? strengthColor(newPassword.length) : '#ffffff10',
                      }]} />
                    ))}
                    <Text style={s.strengthLabel}>{strengthLabel(newPassword.length)}</Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[s.mainBtn, (newPassword.length < 6 || loading) && { opacity: 0.5 }]}
                onPress={handleResetPassword}
                disabled={newPassword.length < 6 || loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <><MaterialIcons name="lock-reset" size={18} color="#fff" /><Text style={s.mainBtnText}>ZMIEŃ HASŁO</Text></>
                }
              </TouchableOpacity>
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // RENDER – LOGIN / REGISTER
  // ════════════════════════════════════════════════════════════════════════
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.container}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* LOGO */}
        <View style={s.logoWrap}>
          <Image source={require('../assets/images/logo-RED.png')} style={s.logo} resizeMode="contain" />
          <Text style={s.logoTagline}>
            {screen === 'login' ? 'WITAJ Z POWROTEM' : 'DOŁĄCZ DO SPOŁECZNOŚCI'}
          </Text>
        </View>

        {/* TOGGLE */}
        <View style={s.toggle}>
          <TouchableOpacity
            style={[s.toggleBtn, screen === 'login' && s.toggleBtnActive]}
            onPress={() => { setScreen('login'); setPassword(''); setConfirmPass(''); }}
            activeOpacity={0.8}
          >
            <Text style={[s.toggleText, screen === 'login' && s.toggleTextActive]}>LOGOWANIE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.toggleBtn, screen === 'register' && s.toggleBtnActive]}
            onPress={() => { setScreen('register'); setPassword(''); setConfirmPass(''); }}
            activeOpacity={0.8}
          >
            <Text style={[s.toggleText, screen === 'register' && s.toggleTextActive]}>REJESTRACJA</Text>
          </TouchableOpacity>
        </View>

        {/* FORMULARZ */}
        <View style={s.card}>

          {/* Username – rejestracja */}
          {screen === 'register' && (
            <>
              <Text style={s.fieldLabel}>NAZWA UŻYTKOWNIKA</Text>
              <View style={s.inputRow}>
                <MaterialIcons name="person-outline" size={18} color="#e33835" style={s.inputIcon} />
                <TextInput
                  style={s.input}
                  placeholder="np. NightRider_PL"
                  placeholderTextColor="#ffffff25"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
              </View>
              <View style={s.fieldDivider} />
            </>
          )}

          {/* Email */}
          <Text style={s.fieldLabel}>ADRES E-MAIL</Text>
          <View style={s.inputRow}>
            <MaterialIcons name="email" size={18} color="#e33835" style={s.inputIcon} />
            <TextInput
              style={s.input}
              placeholder="twoj@email.com"
              placeholderTextColor="#ffffff25"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={s.fieldDivider} />

          {/* Hasło */}
          <Text style={s.fieldLabel}>HASŁO</Text>
          <View style={s.inputRow}>
            <MaterialIcons name="lock-outline" size={18} color="#e33835" style={s.inputIcon} />
            <TextInput
              style={s.input}
              placeholder="••••••••"
              placeholderTextColor="#ffffff25"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={s.eyeBtn}>
              <MaterialIcons name={showPassword ? 'visibility' : 'visibility-off'} size={18} color="#ffffff30" />
            </TouchableOpacity>
          </View>

          {/* Siła hasła – rejestracja */}
          {screen === 'register' && password.length > 0 && (
            <View style={s.strengthRow}>
              {[1,2,3,4].map(i => (
                <View key={i} style={[s.strengthBar, {
                  backgroundColor: password.length >= i * 3 ? strengthColor(password.length) : '#ffffff10',
                }]} />
              ))}
              <Text style={s.strengthLabel}>{strengthLabel(password.length)}</Text>
            </View>
          )}

          {/* Potwierdź hasło – rejestracja */}
          {screen === 'register' && (
            <>
              <View style={s.fieldDivider} />
              <Text style={s.fieldLabel}>POTWIERDŹ HASŁO</Text>
              <View style={[s.inputRow, confirmPass && password !== confirmPass && s.inputError]}>
                <MaterialIcons name="check-circle-outline" size={18} color="#e33835" style={s.inputIcon} />
                <TextInput
                  style={s.input}
                  placeholder="Powtórz hasło"
                  placeholderTextColor="#ffffff25"
                  secureTextEntry={!showConfirm}
                  value={confirmPass}
                  onChangeText={setConfirmPass}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={s.eyeBtn}>
                  <MaterialIcons name={showConfirm ? 'visibility' : 'visibility-off'} size={18} color="#ffffff30" />
                </TouchableOpacity>
              </View>
              {confirmPass && password !== confirmPass && (
                <Text style={s.errorHint}>Hasła nie są identyczne</Text>
              )}
              {confirmPass && password === confirmPass && (
                <Text style={s.successHint}>✓ Hasła są identyczne</Text>
              )}
            </>
          )}
        </View>

        {/* Zapomniałem hasła */}
        {screen === 'login' && (
          <TouchableOpacity
            style={s.forgotBtn}
            onPress={() => { setScreen('forgot'); setForgotEmail(email); }}
            activeOpacity={0.7}
          >
            <MaterialIcons name="help-outline" size={13} color="#e33835" />
            <Text style={s.forgotText}>Zapomniałeś hasła?</Text>
          </TouchableOpacity>
        )}

        {/* GŁÓWNY PRZYCISK */}
        <TouchableOpacity
          style={[s.mainBtn, loading && { opacity: 0.6 }]}
          onPress={screen === 'login' ? handleLogin : handleRegister}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <>
                <MaterialIcons name={screen === 'login' ? 'login' : 'person-add'} size={18} color="#fff" />
                <Text style={s.mainBtnText}>{screen === 'login' ? 'ZALOGUJ SIĘ' : 'UTWÓRZ KONTO'}</Text>
              </>
          }
        </TouchableOpacity>

        {/* DIVIDER */}
        <View style={s.dividerRow}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>LUB</Text>
          <View style={s.dividerLine} />
        </View>

        {/* SOCIAL */}
        <View style={s.socialRow}>
          <TouchableOpacity
            style={s.socialBtn}
            onPress={() => Toast.show({ type: 'info', text1: 'WKRÓTCE', text2: 'Logowanie przez Google.' })}
          >
            <MaterialCommunityIcons name="google" size={20} color="#fff" />
            <Text style={s.socialBtnText}>Google</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.socialBtn}
            onPress={() => Toast.show({ type: 'info', text1: 'WKRÓTCE', text2: 'Logowanie przez Apple.' })}
          >
            <MaterialCommunityIcons name="apple" size={20} color="#fff" />
            <Text style={s.socialBtnText}>Apple</Text>
          </TouchableOpacity>
        </View>

        {/* Regulamin */}
        {screen === 'register' && (
          <Text style={s.terms}>
            Rejestrując się akceptujesz{' '}
            <Text style={{ color: '#e33835' }}>Regulamin</Text>
            {' '}oraz{' '}
            <Text style={{ color: '#e33835' }}>Politykę Prywatności</Text>
            {' '}VROOM.
          </Text>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0f0f0f' },
  scroll:          { flexGrow: 1, paddingHorizontal: '6%', paddingVertical: 50 },

  // Back
  backRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32 },
  backText:        { fontFamily: 'Orbitron', color: '#e33835', fontSize: 11 },

  // Logo
  logoWrap:        { alignItems: 'center', marginBottom: 36 },
  logo:            { width: 200, height: 44 },
  logoTagline:     { fontFamily: 'Orbitron', color: '#ffffff30', fontSize: 9, letterSpacing: 3, marginTop: 10 },

  // Toggle
  toggle:          { flexDirection: 'row', backgroundColor: '#1a1a1a', borderRadius: 14, padding: 4, marginBottom: 20, borderWidth: 1, borderColor: '#ffffff08' },
  toggleBtn:       { flex: 1, paddingVertical: 12, borderRadius: 11, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: '#e33835' },
  toggleText:      { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 10, letterSpacing: 1 },
  toggleTextActive:{ color: '#fff' },

  // Card
  card:            { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: '#ffffff08' },
  fieldLabel:      { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 8, letterSpacing: 2, marginBottom: 8 },
  fieldDivider:    { height: 1, backgroundColor: '#ffffff08', marginVertical: 14 },
  inputRow:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#252525', borderRadius: 12, borderWidth: 1, borderColor: '#ffffff08' },
  inputError:      { borderColor: '#e3383580' },
  inputIcon:       { marginLeft: 12 },
  input:           { flex: 1, color: '#fff', fontFamily: 'Orbitron', fontSize: 12, paddingHorizontal: 10, paddingVertical: 14 },
  eyeBtn:          { padding: 12 },
  codeInput:       { letterSpacing: 8, fontSize: 20, textAlign: 'center' },

  // Siła hasła
  strengthRow:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  strengthBar:     { flex: 1, height: 3, borderRadius: 2 },
  strengthLabel:   { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 8, marginLeft: 4 },

  errorHint:       { fontFamily: 'Orbitron', color: '#e33835', fontSize: 8, marginTop: 6 },
  successHint:     { fontFamily: 'Orbitron', color: '#4CAF50', fontSize: 8, marginTop: 6 },

  // Forgot
  forgotBtn:       { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', marginBottom: 16 },
  forgotText:      { fontFamily: 'Orbitron', color: '#e33835', fontSize: 10 },

  // Tytuł (forgot screen)
  titleWrap:       { alignItems: 'center', marginBottom: 24 },
  title:           { fontFamily: 'Orbitron', color: '#fff', fontSize: 18, letterSpacing: 2, marginBottom: 8 },
  subtitle:        { fontFamily: 'Orbitron', color: '#ffffff50', fontSize: 10, textAlign: 'center', lineHeight: 18 },

  // Kroki
  stepsRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  stepDot:         { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#ffffff20', justifyContent: 'center', alignItems: 'center' },
  stepDotActive:   { borderColor: '#e33835', backgroundColor: '#e3383520' },
  stepDotDone:     { borderColor: '#4CAF50', backgroundColor: '#4CAF5020' },
  stepNum:         { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 11 },
  stepLine:        { flex: 1, height: 1, backgroundColor: '#ffffff10', marginHorizontal: 8 },
  stepLineDone:    { backgroundColor: '#4CAF5060' },

  // Wyślij ponownie
  resendBtn:       { alignItems: 'center', marginTop: 16, padding: 8 },
  resendText:      { fontFamily: 'Orbitron', color: '#ffffff30', fontSize: 9 },

  // Główny przycisk
  mainBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#e33835', borderRadius: 14, height: 56, marginBottom: 24, elevation: 8, shadowColor: '#e33835', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 },
  mainBtnText:     { fontFamily: 'Orbitron', color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 1 },

  // Divider
  dividerRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  dividerLine:     { flex: 1, height: 1, backgroundColor: '#ffffff0a' },
  dividerText:     { fontFamily: 'Orbitron', color: '#ffffff20', fontSize: 9, marginHorizontal: 14 },

  // Social
  socialRow:       { flexDirection: 'row', gap: 10, marginBottom: 24 },
  socialBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a1a1a', borderRadius: 12, height: 50, borderWidth: 1, borderColor: '#ffffff08' },
  socialBtnText:   { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 10 },

  // Regulamin
  terms:           { color: '#ffffff30', fontSize: 10, textAlign: 'center', lineHeight: 16 },
});