import React, { useState, useRef, useEffect } from 'react';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Image, Dimensions, Animated, Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { registerPushToken } from '../hooks/usePushNotifications';

const { width, height } = Dimensions.get('window');
const RED = '#e33835';

const API_URL  = 'https://v-room.app/api/auth';
const SAPI_URL = 'https://v-room.app/sapi';

let GoogleSignin: any = null;
let statusCodes: any  = {};
try {
  const g    = require('@react-native-google-signin/google-signin');
  GoogleSignin = g.GoogleSignin;
  statusCodes  = g.statusCodes;
  GoogleSignin.configure({ webClientId: '422424308025-2suso0t9uculamcjm5rhdv0e5krtie5d.apps.googleusercontent.com' });
} catch {}

type Screen    = 'login' | 'register' | 'forgot';
type ResetStep = 'email' | 'code' | 'password';

export default function LoginScreen() {
  const router = useRouter();

  const [screen,       setScreen]       = useState<Screen>('login');
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [username,     setUsername]     = useState('');
  const [confirmPass,  setConfirmPass]  = useState('');
  const [showPass,     setShowPass]     = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [resetStep,    setResetStep]    = useState<ResetStep>('email');
  const [forgotEmail,  setForgotEmail]  = useState('');
  const [resetCode,    setResetCode]    = useState('');
  const [newPassword,  setNewPassword]  = useState('');
  const [showNewPass,  setShowNewPass]  = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [gLoading,     setGLoading]     = useState(false);

  // Animacje wejścia
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(32)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Wejście
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 55, useNativeDriver: true }),
    ]).start();

    // Pulsowanie kropki
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Re-animacja przy zmianie ekranu
  const animateSwitch = () => {
    slideAnim.setValue(20);
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 9, tension: 70, useNativeDriver: true }),
    ]).start();
  };

  const switchScreen = (s: Screen) => {
    setScreen(s);
    setPassword('');
    setConfirmPass('');
    animateSwitch();
  };

  const goToLogin = () => {
    setResetStep('email');
    setForgotEmail('');
    setResetCode('');
    setNewPassword('');
    switchScreen('login');
  };

  const strengthColor = (l: number) => l >= 10 ? '#4de926' : l >= 6 ? '#ff922b' : RED;
  const strengthLabel = (l: number) => l < 6 ? 'Za krótkie' : l < 10 ? 'Słabe' : 'Silne';
  const strengthPct   = (l: number) => Math.min((l / 12) * 100, 100);

  const saveAndNavigate = async (token: string, user: any) => {
    await AsyncStorage.setItem('userToken', token);
    await AsyncStorage.setItem('token', token);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    await registerPushToken();
    router.replace('/(tabs)');
  };

  const handleLogin = async () => {
    if (!email || !password) return Toast.show({ type: 'error', text1: 'ODMOWA DOSTĘPU', text2: 'Wypełnij wszystkie pola.' });
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
      const data = await res.json();
      if (res.ok) await saveAndNavigate(data.token, data.user);
      else Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Nieprawidłowe dane.' });
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia z serwerem.' }); }
    finally { setLoading(false); }
  };

  const handleRegister = async () => {
    if (!email || !password || !username) return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wypełnij wszystkie pola.' });
    if (password.length < 6)              return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasło min. 6 znaków.' });
    if (password !== confirmPass)         return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasła nie są identyczne.' });
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password, username: username.trim() }) });
      const data = await res.json();
      if (res.ok) { Toast.show({ type: 'success', text1: '🚗 WITAJ W VROOM!', text2: 'Konto utworzone. Zaloguj się.' }); switchScreen('login'); }
      else Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Nie można utworzyć konta.' });
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia z serwerem.' }); }
    finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    if (!GoogleSignin) return Toast.show({ type: 'info', text1: 'NIEDOSTĘPNE', text2: 'Wymaga pełnego buildu.' });
    setGLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const ui    = await GoogleSignin.signIn();
      const token = ui.data?.idToken;
      if (!token) throw new Error('Brak tokenu');
      const res  = await fetch(`${API_URL}/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) });
      const data = await res.json();
      if (res.ok) await saveAndNavigate(data.token, data.user);
      else Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Błąd Google.' });
    } catch (e: any) {
      if (e.code === statusCodes?.SIGN_IN_CANCELLED) return;
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Logowanie Google nieudane.' });
    } finally { setGLoading(false); }
  };

  const handleForgot = async () => {
    if (!forgotEmail) return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj e-mail.' });
    setLoading(true);
    try {
      await fetch(`${SAPI_URL}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail.trim() }) });
      setResetStep('code');
      Toast.show({ type: 'success', text1: '📧 KOD WYSŁANY', text2: 'Sprawdź skrzynkę.' });
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Błąd serwera.' }); }
    finally { setLoading(false); }
  };

  const handleVerifyCode = async () => {
    if (resetCode.length !== 6) return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wpisz 6-cyfrowy kod.' });
    setLoading(true);
    try {
      const res  = await fetch(`${SAPI_URL}/auth/verify-reset-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail.trim(), code: resetCode }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Nieprawidłowy kod.');
      setResetStep('password');
    } catch (e: any) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message }); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 6) return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Min. 6 znaków.' });
    setLoading(true);
    try {
      const res  = await fetch(`${SAPI_URL}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail.trim(), code: resetCode, newPassword }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Błąd serwera.');
      Toast.show({ type: 'success', text1: '✅ HASŁO ZMIENIONE', text2: 'Możesz się zalogować.' });
      goToLogin();
    } catch (e: any) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message }); }
    finally { setLoading(false); }
  };

  // ── SHARED: Hero header ─────────────────────────────────
  const renderHero = (title: string, sub: string) => (
    <View style={{ height: height * 0.30, position: 'relative', overflow: 'hidden', marginBottom: -24 }}>
      <LinearGradient
        colors={['#1a0404', '#0e0202', '#090909']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Dekoracje */}
      <View style={{ position: 'absolute', top: -60, right: -60, width: 240, height: 240, borderRadius: 120, backgroundColor: '#e3383510', borderWidth: 1, borderColor: '#e3383520' }} />
      <View style={{ position: 'absolute', top: -20, right: -20, width: 130, height: 130, borderRadius: 65, backgroundColor: '#e3383518' }} />
      <View style={{ position: 'absolute', bottom: -40, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: '#e3383506' }} />
      {/* Scan lines */}
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * (height * 0.3 / 8), height: 1, backgroundColor: '#ffffff04' }} />
      ))}
      {/* Narożniki HUD */}
      <View style={[s.hudCorner, { top: 20, left: 20 }]}><View style={s.cH} /><View style={s.cV} /></View>
      <View style={[s.hudCorner, { top: 20, right: 20, alignItems: 'flex-end' }]}><View style={s.cH} /><View style={[s.cV, { left: undefined, right: 0 }]} /></View>

      {/* Content */}
      <Animated.View style={{ flex: 1, paddingHorizontal: 28, paddingTop: 56, justifyContent: 'center', opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        {/* Logo chip */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <View style={{ backgroundColor: RED, borderRadius: 8, padding: 5 }}>
            <MaterialCommunityIcons name="car-sports" size={14} color="#fff" />
          </View>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#fff', fontWeight: '900', letterSpacing: 4 }}>VROOM</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 8, backgroundColor: '#4de92612', borderWidth: 1, borderColor: '#4de92635', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 }}>
            <Animated.View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#4de926', transform: [{ scale: pulseAnim }] }} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#4de926', letterSpacing: 2 }}>ONLINE</Text>
          </View>
        </View>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: RED, letterSpacing: 4, marginBottom: 6 }}>{sub}</Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 32, color: '#fff', fontWeight: '900', letterSpacing: 1 }}>{title}</Text>
      </Animated.View>

      {/* Bottom fade */}
      <LinearGradient colors={['transparent', '#090909']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 50 }} />
    </View>
  );

  // ── SHARED: Field ───────────────────────────────────────
  const renderField = (
    label: string,
    icon: string,
    value: string,
    onChange: (t: string) => void,
    opts: {
      placeholder?: string;
      secure?: boolean;
      showToggle?: boolean;
      onToggle?: () => void;
      keyboardType?: any;
      maxLength?: number;
      autoCapitalize?: any;
      error?: boolean;
    } = {}
  ) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.inputRow, opts.error && { borderColor: RED + '60' }]}>
        <View style={s.inputIconWrap}>
          <MaterialIcons name={icon as any} size={17} color={RED} />
        </View>
        <TextInput
          style={s.input}
          placeholder={opts.placeholder ?? ''}
          placeholderTextColor="#ffffff20"
          keyboardType={opts.keyboardType}
          autoCapitalize={opts.autoCapitalize ?? 'none'}
          secureTextEntry={opts.secure}
          maxLength={opts.maxLength}
          value={value}
          onChangeText={onChange}
        />
        {opts.showToggle && (
          <TouchableOpacity onPress={opts.onToggle} style={s.eyeBtn}>
            <MaterialIcons name={opts.secure ? 'visibility' : 'visibility-off'} size={17} color="#ffffff25" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // ── FORGOT ─────────────���────────────────────────────────
  if (screen === 'forgot') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.root}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {renderHero('RESET HASŁA', 'ODZYSKIWANIE KONTA')}

          <Animated.View style={[s.sheet, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* Wróć */}
            <TouchableOpacity style={s.backRow} onPress={goToLogin}>
              <MaterialIcons name="arrow-back-ios" size={14} color={RED} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: RED }}>POWRÓT</Text>
            </TouchableOpacity>

            {/* Steps */}
            <View style={s.stepsRow}>
              {(['email', 'code', 'password'] as ResetStep[]).map((step, i) => {
                const done   = (step === 'email' && (resetStep === 'code' || resetStep === 'password'))
                            || (step === 'code'  && resetStep === 'password');
                const active = resetStep === step;
                return (
                  <React.Fragment key={step}>
                    <View style={[s.stepDot, active && s.stepDotActive, done && s.stepDotDone]}>
                      {done
                        ? <MaterialIcons name="check" size={13} color="#4de926" />
                        : <Text style={[s.stepNum, active && { color: RED }]}>{i + 1}</Text>
                      }
                    </View>
                    {i < 2 && <View style={[s.stepLine, done && { backgroundColor: '#4de92650' }]} />}
                  </React.Fragment>
                );
              })}
            </View>

            {resetStep === 'email' && (
              <>
                <Text style={s.sectionTitle}>ADRES E-MAIL</Text>
                <Text style={s.sectionSub}>Wyślemy 6-cyfrowy kod na Twój adres.</Text>
                {renderField('E-MAIL', 'email', forgotEmail, setForgotEmail, { placeholder: 'twoj@email.com', keyboardType: 'email-address' })}
                <ActionButton label="WYŚLIJ KOD" icon="send" onPress={handleForgot} loading={loading} disabled={!forgotEmail} />
              </>
            )}

            {resetStep === 'code' && (
              <>
                <Text style={s.sectionTitle}>KOD WERYFIKACYJNY</Text>
                <Text style={s.sectionSub}>Wysłano na <Text style={{ color: RED }}>{forgotEmail}</Text></Text>
                {renderField('6-CYFROWY KOD', 'pin', resetCode, setResetCode, { placeholder: '000000', keyboardType: 'number-pad', maxLength: 6 })}
                <ActionButton label="WERYFIKUJ" icon="verified" onPress={handleVerifyCode} loading={loading} disabled={resetCode.length !== 6} />
                <TouchableOpacity style={{ alignItems: 'center', padding: 12 }} onPress={handleForgot}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff30' }}>Wyślij ponownie →</Text>
                </TouchableOpacity>
              </>
            )}

            {resetStep === 'password' && (
              <>
                <Text style={s.sectionTitle}>NOWE HASŁO</Text>
                <Text style={s.sectionSub}>Ustaw nowe bezpieczne hasło.</Text>
                {renderField('HASŁO', 'lock', newPassword, setNewPassword, { placeholder: 'Min. 6 znaków', secure: !showNewPass, showToggle: true, onToggle: () => setShowNewPass(v => !v) })}
                {newPassword.length > 0 && <StrengthBar value={newPassword} />}
                <ActionButton label="ZMIEŃ HASŁO" icon="lock-reset" onPress={handleResetPassword} loading={loading} disabled={newPassword.length < 6} />
              </>
            )}

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── LOGIN / REGISTER ────────────────────────────────────
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.root}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {renderHero(
          screen === 'login' ? 'ZALOGUJ SIĘ' : 'NOWE KONTO',
          screen === 'login' ? 'WITAJ Z POWROTEM' : 'DOŁĄCZ DO SPOŁECZNOŚCI',
        )}

        <Animated.View style={[s.sheet, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

          {/* Toggle */}
          <View style={s.toggle}>
            {(['login', 'register'] as Screen[]).map(sc => (
              <TouchableOpacity
                key={sc}
                style={[s.toggleBtn, screen === sc && s.toggleBtnActive]}
                onPress={() => switchScreen(sc)}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name={sc === 'login' ? 'login' : 'person-add'}
                  size={13}
                  color={screen === sc ? '#fff' : '#ffffff40'}
                />
                <Text style={[s.toggleText, screen === sc && { color: '#fff' }]}>
                  {sc === 'login' ? 'LOGOWANIE' : 'REJESTRACJA'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Formularz */}
          {screen === 'register' && renderField('NAZWA UŻYTKOWNIKA', 'person-outline', username, setUsername, { placeholder: 'np. NightRider_PL' })}
          {renderField('ADRES E-MAIL', 'email', email, setEmail, { placeholder: 'twoj@email.com', keyboardType: 'email-address' })}
          {renderField('HASŁO', 'lock-outline', password, setPassword, {
            placeholder: '••••••••',
            secure: !showPass,
            showToggle: true,
            onToggle: () => setShowPass(v => !v),
          })}
          {screen === 'register' && password.length > 0 && <StrengthBar value={password} />}

          {screen === 'register' && (
            <>
              {renderField('POTWIERDŹ HASŁO', 'check-circle-outline', confirmPass, setConfirmPass, {
                placeholder: 'Powtórz hasło',
                secure: !showConfirm,
                showToggle: true,
                onToggle: () => setShowConfirm(v => !v),
                error: !!confirmPass && password !== confirmPass,
              })}
              {!!confirmPass && password !== confirmPass && (
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: RED, marginTop: -10, marginBottom: 12 }}>Hasła nie są identyczne</Text>
              )}
              {!!confirmPass && password === confirmPass && (
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#4de926', marginTop: -10, marginBottom: 12 }}>✓ Hasła są identyczne</Text>
              )}
            </>
          )}

          {screen === 'login' && (
            <TouchableOpacity style={s.forgotRow} onPress={() => { setScreen('forgot'); setForgotEmail(email); animateSwitch(); }}>
              <MaterialIcons name="help-outline" size={12} color={RED} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: RED }}>Zapomniałeś hasła?</Text>
            </TouchableOpacity>
          )}

          <ActionButton
            label={screen === 'login' ? 'ZALOGUJ SIĘ' : 'UTWÓRZ KONTO'}
            icon={screen === 'login' ? 'login' : 'person-add'}
            onPress={screen === 'login' ? handleLogin : handleRegister}
            loading={loading}
          />

          {/* Divider */}
          <View style={s.divider}>
            <View style={s.divLine} />
            <Text style={s.divText}>LUB</Text>
            <View style={s.divLine} />
          </View>

          {/* Google */}
          <TouchableOpacity style={s.googleBtn} onPress={handleGoogle} disabled={gLoading} activeOpacity={0.85}>
            {gLoading ? <ActivityIndicator color="#fff" /> : (
              <>
                <View style={s.googleIcon}><MaterialCommunityIcons name="google" size={18} color="#fff" /></View>
                <Text style={s.googleTxt}>Kontynuuj z Google</Text>
              </>
            )}
          </TouchableOpacity>

          {screen === 'register' && (
            <Text style={s.terms}>
              Rejestrując się akceptujesz{' '}
              <Text style={{ color: RED }}>Regulamin</Text>{' '}oraz{' '}
              <Text style={{ color: RED }}>Politykę Prywatności</Text> VROOM.
            </Text>
          )}

        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── ActionButton ──────────────────────────────────────────
function ActionButton({ label, icon, onPress, loading, disabled }: {
  label: string; icon: string; onPress: () => void;
  loading?: boolean; disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.mainBtn, (disabled || loading) && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      <LinearGradient
        colors={[RED, '#c02020']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={s.mainBtnGrad}
      >
        {/* Shimmer dekoracja */}
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 80, backgroundColor: '#ffffff10' }} />
        {loading
          ? <ActivityIndicator color="#fff" />
          : <>
              <MaterialIcons name={icon as any} size={18} color="#fff" />
              <Text style={s.mainBtnText}>{label}</Text>
            </>
        }
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ── StrengthBar ───────────────────────────────────────────
function StrengthBar({ value }: { value: string }) {
  const len   = value.length;
  const color = len >= 10 ? '#4de926' : len >= 6 ? '#ff922b' : RED;
  const label = len < 6 ? 'Za krótkie' : len < 10 ? 'Słabe' : 'Silne';
  const pct   = Math.min((len / 12) * 100, 100);

  return (
    <View style={{ marginBottom: 16, gap: 5 }}>
      <View style={{ height: 3, backgroundColor: '#ffffff0a', borderRadius: 2, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: color + 'aa' }}>{label}</Text>
    </View>
  );
}

// ── STYLES ────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#090909' },

  // Sheet
  sheet: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingTop: 32,
    borderWidth: 1, borderColor: '#ffffff08',
    minHeight: height * 0.72,
  },

  // Back
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 24 },

  // Steps
  stepsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  stepDot:  { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#ffffff15', justifyContent: 'center', alignItems: 'center' },
  stepDotActive: { borderColor: RED, backgroundColor: RED + '18' },
  stepDotDone:   { borderColor: '#4de92660', backgroundColor: '#4de92615' },
  stepNum:  { fontFamily: 'Orbitron', fontSize: 11, color: '#ffffff30' },
  stepLine: { flex: 1, height: 1, backgroundColor: '#ffffff10', marginHorizontal: 10 },

  sectionTitle: { fontFamily: 'Orbitron', fontSize: 16, color: '#fff', fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  sectionSub:   { fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff40', marginBottom: 22, lineHeight: 15 },

  // Toggle
  toggle: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 14, padding: 4,
    marginBottom: 24,
    borderWidth: 1, borderColor: '#ffffff08',
  },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  toggleBtnActive: { backgroundColor: RED },
  toggleText: { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, letterSpacing: 1 },

  // Field
  fieldLabel: { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff35', letterSpacing: 2, marginBottom: 8 },
  inputRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 14, borderWidth: 1, borderColor: '#ffffff0a', marginBottom: 0 },
  inputIconWrap: { width: 44, alignItems: 'center', justifyContent: 'center' },
  input:      { flex: 1, color: '#fff', fontFamily: 'Orbitron', fontSize: 12, paddingVertical: 15, paddingRight: 14 },
  eyeBtn:     { padding: 14 },

  // Forgot
  forgotRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', marginBottom: 20, marginTop: -4 },

  // Main button
  mainBtn: { borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  mainBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, height: 58, overflow: 'hidden',
  },
  mainBtnText: { fontFamily: 'Orbitron', color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1 },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  divLine: { flex: 1, height: 1, backgroundColor: '#ffffff08' },
  divText: { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff20', marginHorizontal: 14 },

  // Google
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    height: 54, borderRadius: 16, borderWidth: 1, borderColor: '#ffffff10',
    backgroundColor: '#1a1a1a', marginBottom: 24,
  },
  googleIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#EA4335', alignItems: 'center', justifyContent: 'center' },
  googleTxt:  { fontFamily: 'Orbitron', color: '#ffffffcc', fontSize: 12 },

  // Terms
  terms: { fontFamily: 'Orbitron', color: '#ffffff25', fontSize: 9, textAlign: 'center', lineHeight: 16 },

  // HUD corners
  hudCorner: { position: 'absolute' },
  cH: { width: 18, height: 2, backgroundColor: RED, opacity: 0.6 },
  cV: { position: 'absolute', top: 0, left: 0, width: 2, height: 18, backgroundColor: RED, opacity: 0.6 },
});