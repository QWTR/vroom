import React, { useState, useRef, useEffect, useMemo } from 'react';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet, View, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Dimensions, Animated, Easing, NativeModules, Linking, Keyboard } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../components/ui/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { registerPushToken } from '../hooks/usePushNotifications';
import { setTutorialPending } from '../hooks/useAppTutorial';
import { syncRevenueCatLoginFromStorage } from '../lib/revenueCatUserSync';
import { normalizeReferralInput } from '../lib/referralInput';
import { markAuthSessionActive } from '../lib/authSessionExpiry';
import { setAuthTokenInMemory } from '../lib/api/authTokenMemory';
import {
  assertAppleState,
  buildAppleSignInBody,
  isAppleSignInCanceled,
} from '../lib/appleSignIn';
import { useTheme } from '../contexts/ThemeContext';
import type { AppTheme } from '../constants/theme';

const { width, height } = Dimensions.get('window');
const RED = '#e33835';

const API_URL  = 'https://v-room.app/api/auth';
const TERMS_URL   = 'https://v-room.app/terms';
const PRIVACY_URL = 'https://v-room.app/privacy';

let GoogleSignin: any = null;
let statusCodes: any  = {};
try {
  const g    = require('@react-native-google-signin/google-signin');
  GoogleSignin = g.GoogleSignin;
  statusCodes  = g.statusCodes;
  GoogleSignin.configure({ 
    webClientId: '422424308025-v8ksqs33clcc1u6gsmsi5esqbrv0dh49.apps.googleusercontent.com',
    offlineAccess: true 
  });
} catch {}

type Screen    = 'login' | 'register' | 'forgot' | 'verify';
type ResetStep = 'email' | 'code' | 'password';

const isStrongPassword = (value: string) => value.length >= 10 && /\p{L}/u.test(value) && /\p{N}/u.test(value);

export default function LoginScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const s = useMemo(() => makeLoginStyles(theme), [theme]);
  const params = useLocalSearchParams<{ ref?: string }>();

  const [screen,       setScreen]       = useState<Screen>('login');
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [username,     setUsername]     = useState('');
  const [confirmPass,  setConfirmPass]  = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [showPass,     setShowPass]     = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [resetStep,    setResetStep]    = useState<ResetStep>('email');
  const [forgotEmail,  setForgotEmail]  = useState('');
  const [resetCode,    setResetCode]    = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword,  setNewPassword]  = useState('');
  const [showNewPass,  setShowNewPass]  = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [gLoading,     setGLoading]     = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState<boolean | null>(
    Platform.OS === 'ios' ? null : false,
  );
  const [acceptedUgcTerms, setAcceptedUgcTerms] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) setAppleAvailable(available);
      })
      .catch(() => {
        if (active) setAppleAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const ref = typeof params.ref === 'string' ? params.ref.trim() : '';
    if (ref) setReferralCode(ref.toUpperCase());
  }, [params.ref]);

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

  const openEmailVerification = (address: string) => {
    setEmail(address.trim().toLowerCase());
    setVerificationCode('');
    setScreen('verify');
    animateSwitch();
  };

  const saveAndNavigate = async (token: string, user: any, meta?: { needsUgcTerms?: boolean }) => {
    await AsyncStorage.setItem('userToken', token);
    await AsyncStorage.setItem('token', token);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    await AsyncStorage.setItem('needsUgcTerms', meta?.needsUgcTerms ? '1' : '0');
    setAuthTokenInMemory(token);
    markAuthSessionActive();
    await registerPushToken();
    await syncRevenueCatLoginFromStorage();
    router.replace('/(tabs)');
  };

  const requireUgcTerms = () => {
    if (!acceptedUgcTerms) {
      Toast.show({
        type: 'error',
        text1: 'REGULAMIN',
        text2: 'Zaznacz zgodę na Regulamin i Politykę prywatności (wymagane przed logowaniem lub rejestracją).',
      });
      return false;
    }
    return true;
  };

  const handleLogin = async () => {
    if (!requireUgcTerms()) return;
    if (!email || !password) return Toast.show({ type: 'error', text1: 'ODMOWA DOSTĘPU', text2: 'Wypełnij wszystkie pola.' });
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password, acceptUgcTerms: acceptedUgcTerms }) });
      const data = await res.json();
      if (res.ok) await saveAndNavigate(data.token, data.user, { needsUgcTerms: data.needsUgcTerms });
      else if (data.code === 'EMAIL_NOT_VERIFIED') {
        await requestVerificationCode(email, false);
        openEmailVerification(email);
      } else Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Nieprawidłowe dane.' });
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia z serwerem.' }); }
    finally { setLoading(false); }
  };

  const handleRegister = async () => {
    if (!requireUgcTerms()) return;
    if (!email || !password || !username) return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wypełnij wszystkie pola.' });
    if (!isStrongPassword(password))      return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasło: min. 10 znaków, litera i cyfra.' });
    if (password !== confirmPass)         return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasła nie są identyczne.' });
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          username: username.trim(),
          referralCode: normalizeReferralInput(referralCode) || undefined,
          acceptUgcTerms: acceptedUgcTerms,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Nie można utworzyć konta.' });
        return;
      }

      Toast.show({
        type: 'success',
        text1: '📧 SPRAWDŹ E-MAIL',
        text2: data.message ?? 'Na podany adres e-mail został wysłany link potwierdzający.',
      });
      openEmailVerification(email);
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia z serwerem.' }); }
    finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    if (Platform.OS === 'ios') return;
    if (!requireUgcTerms()) return;
    if (!GoogleSignin) return Toast.show({ type: 'info', text1: 'NIEDOSTĘPNE', text2: 'Wymaga pełnego buildu.' });
    setGLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const ui    = await GoogleSignin.signIn();
      const token = ui.data?.idToken;
      if (!token) throw new Error('Brak tokenu');
      const res  = await fetch(`${API_URL}/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token, acceptUgcTerms: true }) });
      const data = await res.json();
      if (res.ok) await saveAndNavigate(data.token, data.user, { needsUgcTerms: data.needsUgcTerms });
      else Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Błąd Google.' });
    } catch (e: any) {
      // ← TUTAJ LOGI
      console.log('GOOGLE ERROR:', JSON.stringify(e));
      Toast.show({ 
        type: 'error', 
        text1: `KOD: ${e.code ?? 'brak'}`, 
        text2: e.message ?? 'Błąd' 
      });
      if (e.code === statusCodes?.SIGN_IN_CANCELLED) return;
    } finally { setGLoading(false); }
  };

  const requestVerificationCode = async (address = email, showToast = true) => {
    const res = await fetch(`${API_URL}/verify-email/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Nie udało się wysłać kodu.');
    if (showToast) {
      Toast.show({
        type: 'success',
        text1: '📧 LINK WYSŁANY',
        text2: data.message ?? 'Na podany adres e-mail został wysłany link potwierdzający.',
      });
    }
  };

  const handleConfirmEmail = async () => {
    if (!/^\d{6}$/.test(verificationCode)) {
      return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wpisz 6-cyfrowy kod.' });
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/verify-email/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: verificationCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Nieprawidłowy kod.');
      Toast.show({ type: 'success', text1: '✅ E-MAIL POTWIERDZONY', text2: 'Konto jest aktywne.' });
      await setTutorialPending();
      await saveAndNavigate(data.token, data.user, { needsUgcTerms: data.needsUgcTerms });
    } catch (error: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: error.message ?? 'Nie udało się potwierdzić e-maila.' });
    } finally {
      setLoading(false);
    }
  };

  const handleApple = async () => {
    if (Platform.OS !== 'ios') return;
    if (!requireUgcTerms()) return;
    if (!appleAvailable) {
      Toast.show({
        type: 'info',
        text1: 'NIEDOSTĘPNE',
        text2: 'Logowanie Apple ID nie jest dostępne na tym urządzeniu.',
      });
      return;
    }

    setAppleLoading(true);
    try {
      const state = Crypto.randomUUID();
      const nonce = Crypto.randomUUID();
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        state,
        nonce,
      });

      assertAppleState(state, credential.state);
      const res = await fetch(`${API_URL}/apple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAppleSignInBody(credential, nonce, acceptedUgcTerms)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Toast.show({
          type: 'error',
          text1: 'BŁĄD APPLE ID',
          text2: data.error ?? 'Nie udało się zalogować przez Apple.',
        });
        return;
      }

      await saveAndNavigate(data.token, data.user, {
        needsUgcTerms: data.needsUgcTerms,
      });
    } catch (error: unknown) {
      if (isAppleSignInCanceled(error)) return;
      Toast.show({
        type: 'error',
        text1: 'BŁĄD APPLE ID',
        text2: error instanceof Error
          ? error.message
          : 'Nie udało się połączyć z Apple ID.',
      });
    } finally {
      setAppleLoading(false);
    }
  };

  const handleForgot = async () => {
    if (!forgotEmail) return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj e-mail.' });
    setLoading(true);
    try {
      await fetch(`${API_URL}/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail.trim() }) });
      setResetStep('code');
      Toast.show({ type: 'success', text1: '📧 KOD WYSŁANY', text2: 'Sprawdź skrzynkę.' });
    } catch { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Błąd serwera.' }); }
    finally { setLoading(false); }
  };

  const handleVerifyCode = async () => {
    if (resetCode.length !== 6) return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wpisz 6-cyfrowy kod.' });
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/verify-reset-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail.trim(), code: resetCode }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Nieprawidłowy kod.');
      setResetStep('password');
    } catch (e: any) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message }); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async () => {
    if (!isStrongPassword(newPassword)) return Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Hasło: min. 10 znaków, litera i cyfra.' });
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail.trim(), code: resetCode, newPassword }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Błąd serwera.');
      Toast.show({ type: 'success', text1: '✅ HASŁO ZMIENIONE', text2: 'Możesz się zalogować.' });
      goToLogin();
    } catch (e: any) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message }); }
    finally { setLoading(false); }
  };

  // ── SHARED: Hero header ─────────────────────────────────
  const renderHero = (title: string, sub: string) => (
    <View style={{ minHeight: Math.max(230, height * 0.28), position: 'relative', overflow: 'hidden', marginBottom: -24 }}>
      <LinearGradient
        colors={isDark ? ['#1a0404', '#0e0202', theme.bg] : [theme.bgAlt, theme.bg, theme.surface]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Dekoracje */}
      <View style={{ position: 'absolute', top: -60, right: -60, width: 240, height: 240, borderRadius: 120, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder }} />
      <View style={{ position: 'absolute', top: -20, right: -20, width: 130, height: 130, borderRadius: 65, backgroundColor: theme.primaryBg }} />
      <View style={{ position: 'absolute', bottom: -40, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: theme.primaryBg }} />
      {/* Scan lines */}
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * (height * 0.3 / 8), height: 1, backgroundColor: theme.border }} />
      ))}
      {/* Narożniki HUD */}
      <View style={[s.hudCorner, { top: 20, left: 20 }]}><View style={s.cH} /><View style={s.cV} /></View>
      <View style={[s.hudCorner, { top: 20, right: 20, alignItems: 'flex-end' }]}><View style={s.cH} /><View style={[s.cV, { left: undefined, right: 0 }]} /></View>

      {/* Content */}
      <Animated.View style={{ paddingHorizontal: 28, paddingTop: 72, paddingBottom: 66, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        {/* Logo chip */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <View style={{ backgroundColor: RED, borderRadius: 8, padding: 5 }}>
            <MaterialCommunityIcons name="car-sports" size={14} color="#fff" />
          </View>
          <Text variant="label" contrastBackground="#1a0404" style={{ color: '#fff', fontWeight: '800', letterSpacing: 1 }}>VROOM</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 8, backgroundColor: '#4de92612', borderWidth: 1, borderColor: '#4de92635', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 }}>
            <Animated.View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#4de926', transform: [{ scale: pulseAnim }] }} />
            <Text variant="micro" contrastBackground="#071a07" style={{ color: '#76f45a', letterSpacing: 0.6 }}>ONLINE</Text>
          </View>
        </View>
        <Text variant="label" contrastBackground="#0e0202" style={{ color: '#ff625f', letterSpacing: 0.6, marginBottom: 8 }}>{sub}</Text>
        <Text variant="display" contrastBackground="#0e0202" style={{ color: '#fff' }}>{title}</Text>
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
      autoCorrect?: boolean;
      spellCheck?: boolean;
      onEndEditing?: () => void;
    } = {}
  ) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.inputRow, opts.error && { borderColor: RED + '60' }]}>
        <View style={s.inputIconWrap}>
          <MaterialIcons name={icon as any} size={22} color={theme.primaryText} />
        </View>
        <TextInput
          style={s.input}
          placeholder={opts.placeholder ?? ''}
          placeholderTextColor={theme.textMuted}
          keyboardType={opts.keyboardType}
          autoCapitalize={opts.autoCapitalize ?? 'none'}
          autoCorrect={opts.autoCorrect ?? false}
          spellCheck={opts.spellCheck ?? false}
          secureTextEntry={opts.secure}
          maxLength={opts.maxLength}
          value={value}
          onChangeText={onChange}
          onEndEditing={opts.onEndEditing}
          clearButtonMode="while-editing"
        />
        {!!value && !opts.showToggle && (
          <TouchableOpacity onPress={() => onChange('')} style={s.eyeBtn}>
            <MaterialIcons name="close" size={22} color={theme.textMuted} />
          </TouchableOpacity>
        )}
        {opts.showToggle && (
          <TouchableOpacity onPress={opts.onToggle} style={s.eyeBtn}>
            <MaterialIcons name={opts.secure ? 'visibility' : 'visibility-off'} size={22} color={theme.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  if (screen === 'verify') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS === 'ios'} style={s.root}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {renderHero('POTWIERDŹ E-MAIL', 'OCHRONA KONTA')}
          <Animated.View style={[s.sheet, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <TouchableOpacity style={s.backRow} onPress={goToLogin}>
              <MaterialIcons name="arrow-back-ios" size={14} color={RED} />
              <Text variant="label" style={{ color: theme.link }}>Powrót do logowania</Text>
            </TouchableOpacity>
            <Text style={s.sectionTitle}>SPRAWDŹ SKRZYNKĘ E-MAIL</Text>
            <Text style={s.sectionSub}>Na <Text style={{ color: RED }}>{email}</Text> został wysłany link potwierdzający. Otwórz go, aby aktywować konto. Możesz też użyć kodu awaryjnego z wiadomości.</Text>
            {renderField('KOD AWARYJNY', 'verified-user', verificationCode, setVerificationCode, {
              placeholder: '000000',
              keyboardType: 'number-pad',
              maxLength: 6,
            })}
            <ActionButton label="AKTYWUJ KONTO" icon="verified" onPress={handleConfirmEmail} loading={loading} disabled={verificationCode.length !== 6} />
            <TouchableOpacity
              style={{ alignItems: 'center', padding: 16 }}
              onPress={() => requestVerificationCode().catch((error) => Toast.show({ type: 'error', text1: 'BŁĄD', text2: error.message }))}
            >
              <Text variant="label" style={{ color: theme.link }}>Wyślij link ponownie →</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── FORGOT ─────────────���────────────────────────────────
  if (screen === 'forgot') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
enabled={Platform.OS === 'ios'} style={s.root}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} onScrollBeginDrag={Keyboard.dismiss}>
          {renderHero('RESET HASŁA', 'ODZYSKIWANIE KONTA')}

          <Animated.View style={[s.sheet, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* Wróć */}
            <TouchableOpacity style={s.backRow} onPress={goToLogin}>
              <MaterialIcons name="arrow-back-ios" size={14} color={RED} />
              <Text variant="label" style={{ color: theme.link }}>Powrót</Text>
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
                  <Text variant="label" style={{ color: theme.link }}>Wyślij ponownie →</Text>
                </TouchableOpacity>
              </>
            )}

            {resetStep === 'password' && (
              <>
                <Text style={s.sectionTitle}>NOWE HASŁO</Text>
                <Text style={s.sectionSub}>Ustaw nowe bezpieczne hasło.</Text>
                {renderField('HASŁO', 'lock', newPassword, setNewPassword, { placeholder: 'Min. 10 znaków, litera i cyfra', secure: !showNewPass, showToggle: true, onToggle: () => setShowNewPass(v => !v) })}
                {newPassword.length > 0 && <StrengthBar value={newPassword} />}
                <ActionButton label="ZMIEŃ HASŁO" icon="lock-reset" onPress={handleResetPassword} loading={loading} disabled={!isStrongPassword(newPassword)} />
              </>
            )}

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── LOGIN / REGISTER ────────────────────────────────────
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
enabled={Platform.OS === 'ios'} style={s.root}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} onScrollBeginDrag={Keyboard.dismiss}>

        {renderHero(
          screen === 'login' ? 'ZALOGUJ SIĘ' : 'NOWE KONTO',
          screen === 'login' ? 'WITAJ Z POWROTEM' : 'DOŁĄCZ DO SPOŁECZNOŚCI',
        )}

        <Animated.View style={[s.sheet, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

          {/* Toggle */}
          <View style={s.toggle}>
            {(['login', 'register'] as const).map(sc => (
              <TouchableOpacity
                key={sc}
                style={[s.toggleBtn, screen === sc && s.toggleBtnActive]}
                onPress={() => switchScreen(sc)}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name={sc === 'login' ? 'login' : 'person-add'}
                  size={13}
                  color={screen === sc ? theme.onPrimary : theme.textMuted}
                />
                <Text contrastBackground={screen === sc ? theme.primary : theme.surface3} style={[s.toggleText, screen === sc && { color: theme.onPrimary }]}>
                  {sc === 'login' ? 'LOGOWANIE' : 'REJESTRACJA'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Formularz */}
          {screen === 'register' && renderField('NAZWA UŻYTKOWNIKA', 'person-outline', username, setUsername, { placeholder: 'np. NightRider_PL' })}
          {renderField('ADRES E-MAIL', 'email', email, setEmail, { placeholder: 'twoj@email.com', keyboardType: 'email-address' })}
          {screen === 'register' && renderField('KOD / LINK POLECAJĄCY (opcjonalnie)', 'group-add', referralCode, setReferralCode, {
            placeholder: 'np. NIGHT1234 lub pełny link',
            autoCapitalize: 'characters',
            onEndEditing: () => setReferralCode(normalizeReferralInput(referralCode)),
          })}
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
                <Text variant="bodySmall" style={{ color: theme.danger, marginTop: -10, marginBottom: 12 }}>Hasła nie są identyczne</Text>
              )}
              {!!confirmPass && password === confirmPass && (
                <Text variant="bodySmall" style={{ color: theme.online, marginTop: -10, marginBottom: 12 }}>✓ Hasła są identyczne</Text>
              )}
            </>
          )}

          {screen === 'login' && (
            <TouchableOpacity style={s.forgotRow} onPress={() => { setScreen('forgot'); setForgotEmail(email); animateSwitch(); }}>
              <MaterialIcons name="help-outline" size={20} color={theme.primaryText} />
              <Text variant="label" style={{ color: theme.link }}>Zapomniałeś hasła?</Text>
            </TouchableOpacity>
          )}

          <View style={s.termsCheckRow}>
            <TouchableOpacity
              style={[s.termsCheckBox, acceptedUgcTerms && s.termsCheckBoxOn]}
              onPress={() => setAcceptedUgcTerms((v) => !v)}
              activeOpacity={0.85}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedUgcTerms }}
            >
              {acceptedUgcTerms ? <MaterialIcons name="check" size={20} color={theme.onPrimary} /> : null}
            </TouchableOpacity>
            <Text style={s.termsLegal}>
              Zaznacz pole po lewej — samo otwarcie linków nie wystarczy. Potwierdzam zapoznanie się z{' '}
              <Text style={s.termsLink} onPress={() => Linking.openURL(TERMS_URL)}>Regulaminem</Text>
              {' '}oraz{' '}
              <Text style={s.termsLink} onPress={() => Linking.openURL(PRIVACY_URL)}>Polityką prywatności</Text>
              . W społeczności VROOM obowiązuje{' '}
              <Text style={{ fontWeight: '700', color: '#ffffffaa' }}>zerowa tolerancja</Text>
              {' '}dla treści obraźliwych, wulgarnych, nękających i agresji wobec innych użytkowników.
            </Text>
          </View>
          {!acceptedUgcTerms && screen === 'register' && (
            <Text style={s.termsHint}>Wymagane zaznaczenie pola z regulaminem przed rejestracją.</Text>
          )}

          <ActionButton
            label={screen === 'login' ? 'ZALOGUJ SIĘ' : 'UTWÓRZ KONTO'}
            icon={screen === 'login' ? 'login' : 'person-add'}
            onPress={screen === 'login' ? handleLogin : handleRegister}
            loading={loading}
            disabled={
              !acceptedUgcTerms ||
              (screen === 'login'
                ? !email.trim() || !password
                : !email.trim() || !password || !username.trim() || !isStrongPassword(password) || password !== confirmPass)
            }
          />

          <View style={s.divider}>
            <View style={s.divLine} />
            <Text style={s.divText}>LUB</Text>
            <View style={s.divLine} />
          </View>

          {Platform.OS === 'ios' ? (
            appleAvailable === false ? (
              <Text style={s.iosLoginHint}>
                Logowanie przez Apple ID nie jest dostępne na tym urządzeniu.
              </Text>
            ) : (
              <View
                style={[
                  s.appleButtonContainer,
                  (!acceptedUgcTerms || appleLoading || appleAvailable !== true) && { opacity: 0.45 },
                ]}
                pointerEvents={!acceptedUgcTerms || appleLoading || appleAvailable !== true ? 'none' : 'auto'}
              >
                {appleLoading ? (
                  <View style={s.appleLoadingButton}>
                    <ActivityIndicator color={isDark ? '#000' : '#fff'} />
                  </View>
                ) : appleAvailable ? (
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={
                      isDark
                        ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                        : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                    }
                    cornerRadius={16}
                    style={s.appleButton}
                    onPress={handleApple}
                  />
                ) : (
                  <View style={s.appleButton} />
                )}
              </View>
            )
          ) : (
              <TouchableOpacity
                style={[s.googleBtn, (!acceptedUgcTerms || gLoading) && { opacity: 0.45 }]}
                onPress={handleGoogle}
                disabled={!acceptedUgcTerms || gLoading}
                activeOpacity={0.85}
              >
                {gLoading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <View style={s.googleIcon}><MaterialCommunityIcons name="google" size={18} color="#fff" /></View>
                    <Text style={s.googleTxt}>Kontynuuj z Google</Text>
                  </>
                )}
              </TouchableOpacity>
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
  const { theme } = useTheme();
  const s = useMemo(() => makeLoginStyles(theme), [theme]);
  return (
    <TouchableOpacity
      style={[s.mainBtn, (disabled || loading) && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      <LinearGradient
        colors={[theme.primary, theme.primary]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={s.mainBtnGrad}
      >
        {/* Shimmer dekoracja */}
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 80, backgroundColor: '#ffffff10' }} />
        {loading
          ? <ActivityIndicator color={theme.onPrimary} />
          : <>
              <MaterialIcons name={icon as any} size={18} color={theme.onPrimary} />
              <Text style={s.mainBtnText}>{label}</Text>
            </>
        }
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ── StrengthBar ───────────────────────────────────────────
function StrengthBar({ value }: { value: string }) {
  const { theme } = useTheme();
  const len   = value.length;
  const color = len >= 10 ? theme.online : len >= 6 ? theme.warning : RED;
  const label = len < 6 ? 'Za krótkie' : len < 10 ? 'Słabe' : 'Silne';
  const pct   = Math.min((len / 12) * 100, 100);

  return (
    <View style={{ marginBottom: 16, gap: 5 }}>
      <View style={{ height: 3, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Text variant="bodySmall" style={{ color }}>{label}</Text>
    </View>
  );
}

// ── STYLES ────────────────────────────────────────────────
function makeLoginStyles(t: AppTheme) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },

  // Sheet
  sheet: {
    flex: 1,
    backgroundColor: t.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 32, paddingBottom: 28,
    borderWidth: 1, borderColor: t.controlBorder,
    minHeight: height * 0.72,
  },

  // Back
  backRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },

  // Steps
  stepsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  stepDot:  { width: 34, height: 34, borderRadius: 17, backgroundColor: t.surface3, borderWidth: 1, borderColor: t.border2, justifyContent: 'center', alignItems: 'center' },
  stepDotActive: { borderColor: RED, backgroundColor: RED + '18' },
  stepDotDone:   { borderColor: t.online + '60', backgroundColor: t.online + '15' },
  stepNum:  { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: t.textFaint },
  stepLine: { flex: 1, height: 1, backgroundColor: t.border2, marginHorizontal: 10 },

  sectionTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: t.text, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  sectionSub:   { fontSize: 14, color: t.textMuted, marginBottom: 22, lineHeight: 21 },

  // Toggle
  toggle: {
    flexDirection: 'row',
    backgroundColor: t.surface3,
    borderRadius: 14, padding: 4,
    marginBottom: 24,
    borderWidth: 1, borderColor: t.controlBorder,
  },
  toggleBtn: { flex: 1, minHeight: 52, paddingHorizontal: 8, paddingVertical: 12, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  toggleBtnActive: { backgroundColor: t.primary },
  toggleText: { color: t.textMuted, fontSize: 14, letterSpacing: 0.3, fontWeight: '600' },

  // Field
  fieldLabel: { fontSize: 14, color: t.textSecondary, fontWeight: '600', letterSpacing: 0.2, marginBottom: 8 },
  inputRow:   { minHeight: 58, flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface3, borderRadius: 14, borderWidth: 1.5, borderColor: t.controlBorder, marginBottom: 0 },
  inputIconWrap: { width: 50, alignItems: 'center', justifyContent: 'center' },
  input:      { flex: 1, color: t.text, fontSize: 16, paddingVertical: 16, paddingRight: 12 },
  eyeBtn:     { minWidth: 48, minHeight: 48, padding: 12, alignItems: 'center', justifyContent: 'center' },

  // Forgot
  forgotRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-end', marginBottom: 18, marginTop: 0 },

  // Main button
  mainBtn: { borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  mainBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, minHeight: 58, paddingVertical: 16, paddingHorizontal: 18, overflow: 'hidden',
  },
  mainBtnText: { color: t.onPrimary, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  divLine: { flex: 1, height: 1, backgroundColor: t.border },
  divText: { fontSize: 13, color: t.textMuted, marginHorizontal: 14 },

  // Google
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    minHeight: 58, paddingVertical: 14, borderRadius: 16, borderWidth: 1.5, borderColor: t.controlBorder,
    backgroundColor: t.surface3, marginBottom: 12,
  },
  googleIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#EA4335', alignItems: 'center', justifyContent: 'center' },
  googleTxt:  { color: t.text, fontSize: 16, fontWeight: '600' },

  appleButtonContainer: {
    height: 54,
    marginBottom: 12,
  },
  appleButton: {
    width: '100%',
    height: 54,
  },
  appleLoadingButton: {
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.text,
  },

  iosLoginHint: {
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 4,
    fontSize: 14,
    lineHeight: 21,
    color: t.textMuted,
    textAlign: 'center',
    letterSpacing: 0.3,
  },

  termsCheckRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 18,
    paddingVertical: 4,
  },
  termsCheckBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: t.controlBorder,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surface3,
  },
  termsCheckBoxOn: {
    borderColor: t.primaryText,
    backgroundColor: t.primary,
  },
  termsLegal: {
    flex: 1,
    color: t.textMuted,
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0.2,
  },
  termsLink: {
    color: RED,
    textDecorationLine: 'underline',
    fontWeight: '700',
  },
  termsHint: {
    fontSize: 14,
    color: t.danger,
    marginTop: -10,
    marginBottom: 14,
    lineHeight: 20,
  },

  // Terms (legacy small line — unused)
  terms: { color: t.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 21 },

  // HUD corners
  hudCorner: { position: 'absolute' },
  cH: { width: 18, height: 2, backgroundColor: RED, opacity: 0.6 },
  cV: { position: 'absolute', top: 0, left: 0, width: 2, height: 18, backgroundColor: RED, opacity: 0.6 },
});
}
