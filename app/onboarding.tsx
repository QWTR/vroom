import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { AppText as Text, AppTextInput as TextInput } from '../components/ui/AppText';
import { ProfileMusicSearchField } from '../components/settings/ProfileMusicSearchField';
import { StaticHudGrid } from '../components/motion/vroomHudPrimitives';
import { POLISH_PROVINCES } from '../constants/provinces';
import type { ProfileMusicSource } from '../constants/profile';
import { API_URL } from '../constants/config';
import { useTheme } from '../contexts/ThemeContext';
import { useAppTutorial } from '../contexts/AppTutorialContext';
import { useProfile } from '../hooks/useProfile';
import { apiRequest } from '../lib/api/client';
import { clearAuthTokenMemory } from '../lib/api/authTokenMemory';
import { track } from '../lib/analytics/client';
import {
  ONBOARDING_STEPS as STEPS,
  isOnboardingStep,
  nextOnboardingStep as nextStep,
  type OnboardingStep,
} from '../lib/onboardingFlow';
import { setTutorialPending } from '../hooks/useAppTutorial';

WebBrowser.maybeCompleteAuthSession();

type OnboardingState = {
  required: boolean;
  currentStep: OnboardingStep | 'verify_email' | 'complete';
  usernameConfirmed: boolean;
  profile?: { username?: string; avatarUrl?: string | null; bio?: string | null; location?: string | null; province?: string | null };
  completed?: Record<string, boolean>;
};

const STEP_META: Record<OnboardingStep, { kicker: string; title: string; body: string; icon: string }> = {
  username: { kicker: 'IDENTYFIKACJA', title: 'WYBIERZ SWÓJ NICK', body: 'Ta nazwa będzie widoczna na mapie, profilu, czacie i w rankingach.', icon: 'badge-account-horizontal-outline' },
  profile: { kicker: 'TWÓJ PROFIL', title: 'POKAŻ, KTO PROWADZI', body: 'Dodaj avatar i kilka słów o sobie albo uzupełnij je później.', icon: 'account-circle-outline' },
  region: { kicker: 'TWOJA STREFA', title: 'SKĄD JESTEŚ?', body: 'Region pomaga odnaleźć lokalną ekipę, kluby i wydarzenia.', icon: 'map-marker-radius-outline' },
  garage: { kicker: 'GARAŻ', title: 'DODAJ PIERWSZE AUTO', body: 'Zbuduj swój garaż. Wystarczy marka i model — reszta jest opcjonalna.', icon: 'car-sports' },
  music: { kicker: 'SOUNDTRACK', title: 'WYBIERZ SWÓJ UTWÓR', body: 'Muzyka może być odtwarzana z podglądu bezpośrednio na Twoim profilu.', icon: 'music-circle-outline' },
  discord: { kicker: 'POŁĄCZENIA', title: 'PODŁĄCZ DISCORDA', body: 'Na profilu pokażemy wyłącznie publiczną nazwę i avatar Discorda.', icon: 'discord' },
  premium: { kicker: 'VROOM PREMIUM', title: 'WIĘCEJ NIŻ PROFIL', body: 'Odblokuj pełną personalizację i narzędzia dla najbardziej aktywnych kierowców.', icon: 'crown-outline' },
};

export default function OnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; reason?: string }>();
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { uploadAvatar } = useProfile();
  const { startAutoTutorial } = useAppTutorial();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<OnboardingStep>('profile');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [province, setProvince] = useState<string | null>(null);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [power, setPower] = useState('');
  const [engine, setEngine] = useState('');
  const [color, setColor] = useState('');
  const [fuel, setFuel] = useState('pb95');
  const [carPhoto, setCarPhoto] = useState<string | null>(null);
  const [garageCompleted, setGarageCompleted] = useState(false);
  const [musicSaving, setMusicSaving] = useState(false);
  const [musicSelected, setMusicSelected] = useState(false);
  const [discordConnected, setDiscordConnected] = useState(false);
  const [premiumCatalog, setPremiumCatalog] = useState<any>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const fade = useSharedValue(0);
  const slide = useSharedValue(20);
  const stepMotionStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: slide.value }],
  }));

  const animateStep = useCallback(() => {
    if (reduceMotion) {
      fade.value = 1;
      slide.value = 0;
      return;
    }
    fade.value = 0;
    slide.value = 20;
    fade.value = withTiming(1, { duration: 260 });
    slide.value = withSpring(0, { damping: 15, stiffness: 170 });
  }, [fade, reduceMotion, slide]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  const loadState = useCallback(async () => {
    setError('');
    try {
      const value = await apiRequest<OnboardingState>('/auth/onboarding', { priority: 'critical' });
      setState(value);
      if (!value.required || value.currentStep === 'complete') {
        await AsyncStorage.setItem('vroom_onboarding_required', '0');
        router.replace('/(tabs)' as any);
        return;
      }
      if (value.currentStep === 'verify_email') {
        router.replace('/login' as any);
        return;
      }
      const resolved = isOnboardingStep(value.currentStep) ? value.currentStep : 'profile';
      setStep(resolved);
      setUsername(value.profile?.username ?? '');
      setBio(value.profile?.bio ?? '');
      setLocation(value.profile?.location === 'Polska' ? '' : (value.profile?.location ?? ''));
      setProvince(value.profile?.province ?? null);
      setDiscordConnected(Boolean(value.completed?.discord));
      setMusicSelected(Boolean(value.completed?.music));
      setGarageCompleted(Boolean(value.completed?.garage));
      animateStep();
    } catch (requestError: any) {
      setError(requestError?.message || 'Nie udało się wznowić konfiguracji.');
    }
  }, [animateStep, router]);

  useEffect(() => { void loadState(); }, [loadState]);

  useEffect(() => {
    apiRequest<any>('/premium/catalog', { priority: 'background' }).then(setPremiumCatalog).catch(() => setPremiumCatalog(null));
  }, []);

  useEffect(() => {
    if (!params.status) return;
    if (params.status === 'success') {
      setDiscordConnected(true);
      Toast.show({ type: 'success', text1: 'Discord połączony', text2: 'Publiczne dane pojawią się na Twoim profilu.' });
      void loadState();
    } else if (params.status !== 'cancelled') {
      Toast.show({ type: 'error', text1: 'Nie połączono Discorda', text2: params.reason === 'already_linked' ? 'To konto jest już połączone z innym profilem.' : 'Spróbuj ponownie później.' });
    }
  }, [loadState, params.reason, params.status]);

  useEffect(() => {
    if (step !== 'username') return;
    const candidate = username.trim();
    if (candidate.length < 3 || candidate === state?.profile?.username && state?.usernameConfirmed) {
      setUsernameAvailable(candidate === state?.profile?.username && Boolean(state?.usernameConfirmed) ? true : null);
      return;
    }
    setUsernameChecking(true);
    setUsernameAvailable(null);
    const timer = setTimeout(async () => {
      try {
        const result = await apiRequest<{ available: boolean }>(`/auth/username-availability?username=${encodeURIComponent(candidate)}`);
        setUsernameAvailable(Boolean(result.available));
      } catch { setUsernameAvailable(false); }
      finally { setUsernameChecking(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [state?.profile?.username, state?.usernameConfirmed, step, username]);

  const persistStep = useCallback(async (target: OnboardingStep, skipped = false) => {
    await apiRequest('/auth/onboarding/progress', { method: 'PATCH', body: { currentStep: target } });
    setStep(target);
    track({ eventName: skipped ? 'onboarding_step_skipped' : 'onboarding_step_completed', priority: 'medium', screenName: 'onboarding', surface: 'onboarding', properties: { step } });
    void Haptics.selectionAsync().catch(() => {});
    animateStep();
  }, [animateStep, step]);

  const skip = async () => {
    const target = nextStep(step);
    if (!target) return finish();
    setBusy(true);
    try { await persistStep(target, true); }
    catch (e: any) { setError(e?.message || 'Nie udało się zapisać postępu.'); }
    finally { setBusy(false); }
  };

  const advance = async (target: OnboardingStep) => {
    setBusy(true);
    setError('');
    try { await persistStep(target); }
    catch (e: any) { setError(e?.message || 'Nie udało się zapisać postępu.'); }
    finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/auth/onboarding/complete', { method: 'POST' });
      await AsyncStorage.setItem('vroom_onboarding_required', '0');
      await setTutorialPending();
      track({ eventName: 'onboarding_completed', priority: 'high', screenName: 'onboarding', surface: 'onboarding' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace('/(tabs)' as any);
      setTimeout(startAutoTutorial, reduceMotion ? 0 : 320);
    } catch (e: any) { setError(e?.message || 'Nie udało się zakończyć konfiguracji.'); }
    finally { setBusy(false); }
  };

  const saveUsername = async () => {
    if (usernameAvailable !== true) return;
    setBusy(true);
    try {
      await apiRequest('/auth/onboarding/username', { method: 'PATCH', body: { username: username.trim() } });
      const raw = await AsyncStorage.getItem('user');
      const cached = raw ? JSON.parse(raw) : {};
      await AsyncStorage.setItem('user', JSON.stringify({ ...cached, username: username.trim() }));
      await persistStep('profile');
    } catch (e: any) { setError(e?.message || 'Nie udało się zapisać nicku.'); }
    finally { setBusy(false); }
  };

  const pickPhoto = async (camera: boolean, setter: (uri: string) => void) => {
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Toast.show({ type: 'info', text1: 'Brak dostępu', text2: camera ? 'Zezwól aplikacji na użycie aparatu.' : 'Zezwól aplikacji na wybór zdjęcia.' });
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.86 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.86 });
    if (!result.canceled && result.assets[0]?.uri) setter(result.assets[0].uri);
  };

  const saveProfile = async () => {
    setBusy(true);
    setError('');
    try {
      if (avatarUri) {
        const result = await uploadAvatar(avatarUri);
        if (!result.ok) throw new Error(result.error);
      }
      if (bio.trim()) await apiRequest('/profile/me', { method: 'PATCH', body: { bio: bio.trim() } });
      await persistStep('region');
    } catch (e: any) { setError(e?.message || 'Nie udało się zapisać profilu.'); }
    finally { setBusy(false); }
  };

  const saveRegion = async () => {
    setBusy(true);
    try {
      await apiRequest('/profile/me', { method: 'PATCH', body: { location: location.trim(), province: province ?? '' } });
      await persistStep('garage');
    } catch (e: any) { setError(e?.message || 'Nie udało się zapisać regionu.'); }
    finally { setBusy(false); }
  };

  const saveCar = async () => {
    if (!brand.trim() || !model.trim()) return setError('Podaj markę i model albo pomiń ten krok.');
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('brand', `${brand.trim()} ${model.trim()}`);
      form.append('specs', [year && `${year} r.`, power && `${power} KM`, engine, color].filter(Boolean).join(' · ') || `${brand.trim()} ${model.trim()}`);
      form.append('isMain', 'true');
      if (year) form.append('year', year);
      if (power) form.append('power', power);
      if (engine) form.append('engine', engine.trim());
      if (color) form.append('color', color.trim());
      form.append('preferredFuel', fuel);
      if (carPhoto) form.append('photos', { uri: carPhoto, name: 'first-car.jpg', type: 'image/jpeg' } as any);
      await apiRequest('/cars', { method: 'POST', body: form });
      setGarageCompleted(true);
      await persistStep('music');
    } catch (e: any) { setError(e?.message || 'Nie udało się dodać auta.'); }
    finally { setBusy(false); }
  };

  const pickMusic = async (sourceType: ProfileMusicSource, trackId: string) => {
    setMusicSaving(true);
    try {
      await apiRequest('/settings/profile-track', { method: 'PATCH', body: { sourceType, trackId } });
      setMusicSelected(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return true;
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Muzyka', text2: e?.message || 'Nie udało się ustawić utworu.' });
      return false;
    } finally { setMusicSaving(false); }
  };

  const connectDiscord = async () => {
    setBusy(true);
    try {
      const result = await apiRequest<{ authorizationUrl: string }>('/profile/discord/authorize?returnTo=onboarding');
      await WebBrowser.openAuthSessionAsync(result.authorizationUrl, 'vroom://onboarding');
      await loadState();
    } catch (e: any) { setError(e?.message || 'Nie udało się połączyć Discorda.'); }
    finally { setBusy(false); }
  };

  const logOut = async () => {
    await AsyncStorage.multiRemove(['userToken', 'token', 'user', 'vroom_onboarding_required']);
    clearAuthTokenMemory();
    router.replace('/login' as any);
  };

  if (!state && !error) return <View style={styles.loading}><ActivityIndicator color="#e33835" size="large" /><Text style={styles.loadingText}>WCZYTUJEMY TWÓJ START…</Text></View>;
  if (!state && error) return <View style={styles.loading}><MaterialIcons name="cloud-off" size={42} color="#e33835" /><Text style={styles.errorText}>{error}</Text><PrimaryButton label="SPRÓBUJ PONOWNIE" onPress={loadState} /></View>;

  const meta = STEP_META[step];
  const currentIndex = STEPS.indexOf(step);
  const benefits = (premiumCatalog?.groups ?? []).flatMap((group: any) => group.benefits ?? []).filter((item: any) => item.enabled).slice(0, 10);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={['#030303', '#140303', '#050505']} style={StyleSheet.absoluteFill} />
      <StaticHudGrid isDark primary="#e33835" opacity={0.12} />
      <View pointerEvents="none" style={styles.hud}><View style={styles.hudRing} /><View style={styles.hudLine} /></View>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <View><Text style={styles.brand}>VROOM // SETUP</Text><Text style={styles.counter}>{currentIndex + 1} / {STEPS.length}</Text></View>
        <TouchableOpacity onPress={logOut} style={styles.logout}><MaterialIcons name="logout" size={19} color={theme.textDim} /></TouchableOpacity>
      </View>
      <View style={styles.progress}>{STEPS.map((item, index) => <View key={item} style={[styles.progressItem, index <= currentIndex && styles.progressActive]} />)}</View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Animated.View style={stepMotionStyle}>
          <View style={styles.heroIcon}><MaterialCommunityIcons name={meta.icon as any} size={32} color="#ff5c59" /></View>
          <Text style={styles.kicker}>{meta.kicker}</Text>
          <Text style={styles.title}>{meta.title}</Text>
          <Text style={styles.body}>{meta.body}</Text>

          {step === 'username' && <View style={styles.card}>
            <Field label="PUBLICZNY NICK *" value={username} onChangeText={setUsername} placeholder="np. NightRider_PL" maxLength={24} theme={theme} />
            <View style={styles.inlineStatus}>{usernameChecking ? <ActivityIndicator size="small" color="#e33835" /> : <MaterialIcons name={usernameAvailable ? 'check-circle' : 'info-outline'} size={18} color={usernameAvailable ? '#4de926' : theme.textDim} />}<Text style={{ color: usernameAvailable ? '#4de926' : theme.textDim, fontSize: 12 }}>{usernameAvailable ? 'Nick jest dostępny' : 'Nick musi być unikalny i mieć 3–24 znaki'}</Text></View>
            <PrimaryButton label="ZATWIERDŹ NICK" onPress={saveUsername} loading={busy} disabled={usernameAvailable !== true} />
          </View>}

          {step === 'profile' && <View style={styles.card}>
            <View style={styles.avatarWrap}>{avatarUri ? <Image source={{ uri: avatarUri }} style={styles.avatar} /> : state?.profile?.avatarUrl ? <Image source={{ uri: state.profile.avatarUrl }} style={styles.avatar} /> : <MaterialIcons name="person" size={42} color="#e33835" />}</View>
            <View style={styles.photoActions}><SmallButton label="GALERIA" icon="photo-library" onPress={() => pickPhoto(false, setAvatarUri)} /><SmallButton label="APARAT" icon="photo-camera" onPress={() => pickPhoto(true, setAvatarUri)} /></View>
            <Field label="BIO" value={bio} onChangeText={setBio} placeholder="Kilka słów o Tobie i Twojej zajawce…" maxLength={240} multiline theme={theme} />
            <PrimaryButton label="ZAPISZ PROFIL" onPress={saveProfile} loading={busy} />
            <SkipButton onPress={skip} disabled={busy} />
          </View>}

          {step === 'region' && <View style={styles.card}>
            <Field label="MIASTO / LOKALIZACJA" value={location} onChangeText={setLocation} placeholder="np. Katowice" maxLength={80} theme={theme} />
            <Text style={styles.fieldLabel}>WOJEWÓDZTWO</Text>
            <View style={styles.chips}>{POLISH_PROVINCES.map((item) => <TouchableOpacity key={item.slug} onPress={() => setProvince(item.slug)} style={[styles.chip, province === item.slug && styles.chipActive]}><Text style={[styles.chipText, province === item.slug && styles.chipTextActive]}>{item.label}</Text></TouchableOpacity>)}</View>
            <PrimaryButton label="ZAPISZ REGION" onPress={saveRegion} loading={busy} disabled={!location.trim() && !province} />
            <SkipButton onPress={skip} disabled={busy} />
          </View>}

          {step === 'garage' && <View style={styles.card}>
            {garageCompleted && <View style={styles.successBox}><MaterialIcons name="check-circle" size={20} color="#4de926" /><Text style={styles.successText}>Pierwsze auto jest już w garażu</Text></View>}
            <TouchableOpacity style={styles.carPhoto} onPress={() => pickPhoto(false, setCarPhoto)}>{carPhoto ? <Image source={{ uri: carPhoto }} style={styles.carPhotoImage} /> : <><MaterialCommunityIcons name="car-sports" size={43} color="#e33835" /><Text style={styles.carPhotoText}>DODAJ ZDJĘCIE AUTA</Text></>}</TouchableOpacity>
            <View style={styles.twoCols}><View style={styles.col}><Field label="MARKA *" value={brand} onChangeText={setBrand} placeholder="BMW" theme={theme} /></View><View style={styles.col}><Field label="MODEL *" value={model} onChangeText={setModel} placeholder="M4" theme={theme} /></View></View>
            <View style={styles.twoCols}><View style={styles.col}><Field label="ROK" value={year} onChangeText={setYear} placeholder="2024" keyboardType="numeric" maxLength={4} theme={theme} /></View><View style={styles.col}><Field label="MOC KM" value={power} onChangeText={setPower} placeholder="510" keyboardType="numeric" theme={theme} /></View></View>
            <Field label="SILNIK" value={engine} onChangeText={setEngine} placeholder="np. 3.0 biturbo" theme={theme} /><Field label="KOLOR" value={color} onChangeText={setColor} placeholder="np. czerwony" theme={theme} />
            <Text style={styles.fieldLabel}>PREFEROWANE PALIWO</Text><View style={styles.chips}>{['pb95', 'pb98', 'diesel', 'lpg'].map((item) => <TouchableOpacity key={item} onPress={() => setFuel(item)} style={[styles.chip, fuel === item && styles.chipActive]}><Text style={[styles.chipText, fuel === item && styles.chipTextActive]}>{item.toUpperCase()}</Text></TouchableOpacity>)}</View>
            <PrimaryButton label={garageCompleted ? 'DALEJ' : 'DODAJ DO GARAŻU'} onPress={garageCompleted ? () => advance('music') : saveCar} loading={busy} disabled={!garageCompleted && (!brand.trim() || !model.trim())} /><SkipButton onPress={skip} disabled={busy} />
          </View>}

          {step === 'music' && <View style={styles.card}>
            {musicSelected && <View style={styles.successBox}><MaterialIcons name="check-circle" size={20} color="#4de926" /><Text style={styles.successText}>Utwór ustawiony na profilu</Text></View>}
            <ProfileMusicSearchField apiUrl={API_URL} onPickTrack={pickMusic} saving={musicSaving} textMain={theme.text} textDim={theme.textDim} inputBg={theme.surface3} inputBorder={theme.border2} rowAlt={theme.surface2} />
            <PrimaryButton label={musicSelected ? 'DALEJ' : 'WYBIERZ UTWÓR'} onPress={() => advance('discord')} loading={busy} disabled={!musicSelected || musicSaving} /><SkipButton onPress={skip} disabled={musicSaving || busy} />
          </View>}

          {step === 'discord' && <View style={styles.card}>
            <View style={styles.discordBox}><MaterialIcons name="discord" size={42} color="#5865F2" /><Text style={styles.discordTitle}>{discordConnected ? 'DISCORD POŁĄCZONY' : 'VROOM × DISCORD'}</Text><Text style={styles.discordBody}>Nie zapisujemy tokenu ani listy serwerów. Pobieramy tylko nazwę i publiczny avatar.</Text></View>
            {!discordConnected && <PrimaryButton label="POŁĄCZ Z DISCORDEM" onPress={connectDiscord} loading={busy} color="#5865F2" />}
            {discordConnected && <PrimaryButton label="DALEJ" onPress={() => advance('premium')} loading={busy} />}
            <SkipButton onPress={skip} disabled={busy} />
          </View>}

          {step === 'premium' && <View style={[styles.card, styles.premiumCard]}>
            <LinearGradient colors={['#322500', '#171103', '#0b0b0b']} style={StyleSheet.absoluteFill} />
            <View style={styles.premiumBadge}><MaterialIcons name="workspace-premium" size={35} color="#FFD447" /></View>
            <Text style={styles.premiumLead}>TWÓJ PROFIL. TWÓJ STYL.</Text>
            <View style={styles.premiumPreview}>
              <View style={styles.previewFree}>
                <Text style={styles.previewTag}>FREE</Text>
                <View style={styles.previewAvatar}><MaterialIcons name="person" size={20} color="#777" /></View>
                <View style={styles.previewLine} /><View style={[styles.previewLine, { width: '55%' }]} />
              </View>
              <LinearGradient colors={['#e33835', '#7d1dbe', '#0f78bd']} style={styles.previewPremium}>
                <Text style={[styles.previewTag, { color: '#fff' }]}>PREMIUM</Text>
                <View style={styles.previewAvatarPremium}><MaterialIcons name="person" size={20} color="#fff" /></View>
                <View style={[styles.previewLine, { backgroundColor: '#ffffffcc' }]} /><View style={[styles.previewLine, { width: '72%', backgroundColor: '#ffffff80' }]} />
                <MaterialIcons name="auto-awesome" size={18} color="#FFD447" style={styles.previewSpark} />
              </LinearGradient>
            </View>
            {benefits.length ? benefits.map((benefit: any) => <View key={benefit.key} style={styles.benefit}><MaterialIcons name="check-circle" size={17} color="#FFD447" /><View style={{ flex: 1 }}><Text style={styles.benefitTitle}>{benefit.title}</Text><Text style={styles.benefitBody}>{benefit.description}</Text></View></View>) : <ActivityIndicator color="#FFD447" style={{ marginVertical: 24 }} />}
            <PrimaryButton label="ZOBACZ PREMIUM" color="#c99b16" onPress={() => { track({ eventName: 'premium_onboarding_cta', priority: 'high', screenName: 'onboarding', surface: 'premium' }); router.push({ pathname: '/premium', params: { returnTo: '/onboarding' } } as any); }} />
            <TouchableOpacity onPress={finish} disabled={busy} style={styles.finishFree}><Text style={styles.finishFreeText}>{busy ? 'KOŃCZENIE…' : 'NA RAZIE POMIŃ — JADĘ DALEJ'}</Text></TouchableOpacity>
          </View>}

          {!!error && <View style={styles.errorBox}><MaterialIcons name="error-outline" size={18} color="#ff6b6b" /><Text style={styles.errorText}>{error}</Text></View>}
        </Animated.View>
      </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, theme, ...props }: any) {
  return <View style={{ marginBottom: 15 }}><Text style={{ color: theme.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 7 }}>{label}</Text><TextInput {...props} placeholderTextColor={theme.textDim} style={[fieldStyles.input, { color: theme.text, backgroundColor: theme.surface3, borderColor: theme.border2 }, props.multiline && fieldStyles.multiline]} /></View>;
}

function PrimaryButton({ label, onPress, loading, disabled, color = '#e33835' }: any) {
  return <TouchableOpacity onPress={onPress} disabled={disabled || loading} activeOpacity={0.85} style={[fieldStyles.primary, { backgroundColor: color, opacity: disabled || loading ? 0.48 : 1 }]}>{loading ? <ActivityIndicator color="#fff" /> : <><Text style={fieldStyles.primaryText}>{label}</Text><MaterialIcons name="arrow-forward" size={19} color="#fff" /></>}</TouchableOpacity>;
}

function SmallButton({ label, icon, onPress }: any) {
  return <TouchableOpacity onPress={onPress} style={fieldStyles.small}><MaterialIcons name={icon} size={18} color="#ff625f" /><Text style={fieldStyles.smallText}>{label}</Text></TouchableOpacity>;
}

function SkipButton({ onPress, disabled }: any) {
  return <TouchableOpacity onPress={onPress} disabled={disabled} style={fieldStyles.skip}><Text style={fieldStyles.skipText}>POMIŃ — UZUPEŁNIĘ PÓŹNIEJ</Text></TouchableOpacity>;
}

const fieldStyles = StyleSheet.create({
  input: { minHeight: 50, borderRadius: 13, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  primary: { minHeight: 55, borderRadius: 15, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 0.9 },
  small: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#e3383545', backgroundColor: '#e3383512', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  smallText: { color: '#ff625f', fontSize: 11, fontWeight: '800' },
  skip: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  skipText: { color: '#8a8a8a', fontSize: 11, fontWeight: '800', letterSpacing: 0.65 },
});

function makeStyles(t: any) { return StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050505' }, safeArea: { flex: 1 }, loading: { flex: 1, backgroundColor: '#050505', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 }, loadingText: { color: '#aaa', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  hud: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' }, hudRing: { position: 'absolute', width: 370, height: 370, borderRadius: 185, borderWidth: 1, borderColor: '#e3383520', right: -210, top: 95 }, hudLine: { position: 'absolute', left: -40, right: -40, top: 210, height: 1, backgroundColor: '#e338351f', transform: [{ rotate: '-7deg' }] },
  topBar: { paddingTop: 10, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1.5 }, counter: { color: '#e33835', fontSize: 10, marginTop: 4, fontWeight: '800' }, logout: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff18', backgroundColor: '#101010' },
  progress: { flexDirection: 'row', gap: 5, paddingHorizontal: 20, marginTop: 15 }, progressItem: { flex: 1, height: 3, backgroundColor: '#ffffff14', borderRadius: 2 }, progressActive: { backgroundColor: '#e33835' },
  content: { paddingHorizontal: 20, paddingTop: 30, paddingBottom: 48 }, heroIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#e3383516', borderWidth: 1, borderColor: '#e3383540', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }, kicker: { color: '#ff625f', fontSize: 10, fontWeight: '900', letterSpacing: 1.8, marginBottom: 7 }, title: { color: '#fff', fontSize: 29, lineHeight: 34, fontWeight: '900', letterSpacing: -0.7 }, body: { color: '#aaa', fontSize: 13, lineHeight: 20, marginTop: 9, marginBottom: 23 },
  card: { backgroundColor: '#101010ee', borderRadius: 20, borderWidth: 1, borderColor: '#ffffff18', padding: 18, overflow: 'hidden' }, avatarWrap: { width: 104, height: 104, borderRadius: 52, alignSelf: 'center', backgroundColor: '#191919', borderWidth: 2, borderColor: '#e33835', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 13 }, avatar: { width: '100%', height: '100%' }, photoActions: { flexDirection: 'row', gap: 9, marginBottom: 20 }, inlineStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -5, marginBottom: 12 },
  fieldLabel: { color: '#8f8f8f', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 9 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 18 }, chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#ffffff1c', backgroundColor: '#181818' }, chipActive: { borderColor: '#e33835', backgroundColor: '#e3383520' }, chipText: { color: '#999', fontSize: 11, fontWeight: '700' }, chipTextActive: { color: '#ff625f' },
  twoCols: { flexDirection: 'row', gap: 10 }, col: { flex: 1 }, carPhoto: { height: 145, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', borderColor: '#e3383550', backgroundColor: '#161616', alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden', marginBottom: 17 }, carPhotoImage: { width: '100%', height: '100%' }, carPhotoText: { color: '#ff625f', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  successBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#4de92612', borderWidth: 1, borderColor: '#4de92635', marginBottom: 15 }, successText: { color: '#76f45a', fontSize: 12, fontWeight: '800' }, discordBox: { alignItems: 'center', paddingVertical: 16 }, discordTitle: { color: '#fff', fontSize: 15, fontWeight: '900', marginTop: 12 }, discordBody: { color: '#999', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  premiumCard: { borderColor: '#FFD44755' }, premiumBadge: { width: 66, height: 66, borderRadius: 22, backgroundColor: '#FFD44718', borderWidth: 1, borderColor: '#FFD44755', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 }, premiumLead: { color: '#FFD447', textAlign: 'center', fontSize: 14, fontWeight: '900', letterSpacing: 1.2, marginBottom: 15 }, premiumPreview: { flexDirection: 'row', gap: 9, marginBottom: 15 }, previewFree: { flex: 1, height: 118, borderRadius: 15, padding: 12, backgroundColor: '#171717', borderWidth: 1, borderColor: '#ffffff18' }, previewPremium: { flex: 1, height: 118, borderRadius: 15, padding: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#FFD44770' }, previewTag: { color: '#777', fontSize: 9, fontWeight: '900', letterSpacing: 1 }, previewAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 9 }, previewAvatarPremium: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#ffffff25', borderWidth: 2, borderColor: '#FFD447', alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 9 }, previewLine: { width: '82%', height: 5, borderRadius: 3, backgroundColor: '#555', marginBottom: 5 }, previewSpark: { position: 'absolute', right: 10, top: 10 }, benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#ffffff10' }, benefitTitle: { color: '#fff', fontSize: 12, fontWeight: '800' }, benefitBody: { color: '#a5a5a5', fontSize: 11, lineHeight: 16, marginTop: 2 }, finishFree: { minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, finishFreeText: { color: '#bbb', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  errorBox: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: '#ff6b6b12', borderWidth: 1, borderColor: '#ff6b6b35', flexDirection: 'row', alignItems: 'center', gap: 8 }, errorText: { color: '#ff8d8d', fontSize: 12, lineHeight: 17, textAlign: 'center' },
}); }
