import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Switch, Modal, Image, Share,
  Dimensions, KeyboardAvoidingView, Keyboard, Platform,
} from 'react-native';
import { Text }         from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter }    from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons    from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage     from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as TaskManager from 'expo-task-manager';
import * as Location    from 'expo-location';
import Toast            from 'react-native-toast-message';
import { API_URL }      from '../../constants/config';
import { useSettings }  from '../../hooks/useSettings';
import { useTheme }     from '../../contexts/ThemeContext';
import { usePremium }   from '../../contexts/PremiumContext';
import { ThemeMode }    from '../../constants/theme';
import { CustomThemeEditor } from '../../components/settings/CustomThemeEditor';
import { ColorWheelPickerSheet, ColorPickTriggerRow } from '../../components/settings/ColorWheelPickerSheet';
import { SpotifyTrackSearchField } from '../../components/settings/SpotifyTrackSearchField';
import { BackgroundLocationDisclosureModal } from '../../components/privacy/BackgroundLocationDisclosureModal';
import { BACKGROUND_LOCATION_TASK } from '../../hooks/useBackgroundTracking';
import {
  hasAcceptedBackgroundLocationDisclosure,
  requestBackgroundLocationPermissionAfterDisclosure,
} from '../../lib/backgroundLocationConsent';
import { syncRevenueCatLoginFromStorage } from '../../lib/revenueCatUserSync';
import { useFormKeyboardPadding } from '../../hooks/useKeyboardInset';
import { mergeProfilePremiumExtras } from '../../constants/profilePremiumExtras';
import type {
  ProfilePremiumExtras,
  ProfileSectionAccentMode,
  ProfileAvatarRingAnim,
  ProfileVisitEntranceAnim,
  ProfileHeroMotion,
} from '../../constants/profilePremiumExtras';
const RED = '#e33835';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

const BUG_CATEGORIES = [
  { key: 'crash',   label: '💥 Crash / zamrożenie', color: '#e33835' },
  { key: 'ui',      label: '🎨 Problem z wyglądem', color: '#9C27B0' },
  { key: 'map',     label: '🗺️ Problem z mapą',     color: '#2196F3' },
  { key: 'account', label: '👤 Problem z kontem',   color: '#FF9800' },
  { key: 'other',   label: '❓ Inne',               color: '#607D8B' },
];

const THEME_OPTIONS: { key: ThemeMode; label: string; icon: string; color: string }[] = [
  { key: 'light',  label: 'JASNY',  icon: 'light-mode', color: '#FF9800' },
  { key: 'dark',   label: 'CIEMNY', icon: 'dark-mode',  color: '#9C27B0' },
  { key: 'custom', label: 'WŁASNY', icon: 'palette',    color: '#2196F3' },
];

const MARKER_STYLES = [
  { key: 'arrow'   as const, label: 'STRZAŁKA',  icon: 'navigation' },
  { key: 'profile' as const, label: 'PROFILOWE', icon: 'account-circle' },
];
const NICK_COLORS = ['#FFFFFF', '#FFD700', '#4DE926', '#38A5E3', '#A855F7', '#FF6B35'];
const PROFILE_PRESETS = ['default', 'midnight', 'sunset', 'neon', 'royal', 'cyber', 'gold', 'forest', 'custom'] as const;
const FRAME_PRESETS = ['vroom', 'sunrise', 'ocean', 'lime'] as const;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme, isDark, mode, setMode } = useTheme();
  const { isPremium: premiumFromContext } = usePremium();
  const { settings, loading: settingsLoading, updateSetting, fetchSettings } = useSettings();
  const effectivePremium = !!(premiumFromContext || settings.isPremium);
  const { scrollPaddingBottom } = useFormKeyboardPadding(88);
  const scrollBottomPad =
    Platform.OS === 'ios'
      ? Math.max(insets.bottom, 12) + 88
      : scrollPaddingBottom;

  // ── Kolory zależne od motywu ───────────────────────────
  const bg        = theme.bgAlt;
  const cardBg    = theme.surface;
  const cardBorder= theme.border2;
  const rowAlt    = theme.surface2;
  const divider   = theme.border;
  const textMain  = theme.text;
  const textDim   = theme.textDim;
  const textMuted = theme.textMuted;
  const overlayBg = theme.overlay;
  const inputBg   = theme.surface3;
  const inputBorder= theme.border2;
  const cancelBg  = theme.surface2;
  const cancelBorder= theme.border2;
  const scanLine  = isDark ? '#ffffff03' : '#00000003';
  const hudColor  = isDark ? RED         : RED;
  const heroGrad  = isDark
    ? ['#1a0404', '#0e0202', bg] as const
    : ['#fff0f0', '#fce8e8', bg] as const;
  const dangerCardBg = isDark ? '#1a0404' : '#fff5f5';

  // ── State ──────────────────────────────────────────────
  const [deleteModal,        setDeleteModal]        = useState(false);
  const [logoutModal,        setLogoutModal]        = useState(false);
  const [bugModal,           setBugModal]           = useState(false);
  const [bgDisclosureVisible, setBgDisclosureVisible] = useState(false);
  const [themeEditorVisible, setThemeEditorVisible] = useState(false);
  const [deleteConfirm,      setDeleteConfirm]      = useState('');
  const [deleteLoading,      setDeleteLoading]      = useState(false);
  const [bugLoading,         setBugLoading]         = useState(false);
  const [bugCategory,        setBugCategory]        = useState('');
  const [bugDescription,     setBugDescription]     = useState('');
  const [bugPhotos,          setBugPhotos]          = useState<string[]>([]);
  const [colorPick, setColorPick] = useState<{
    title: string;
    color: string;
    onPick: (hex: string) => void;
  } | null>(null);

  const premiumExtras = useMemo(
    () => mergeProfilePremiumExtras(settings.profilePremiumExtras),
    [settings.profilePremiumExtras],
  );

  const [heroC1, setHeroC1] = useState('#E33835');
  const [heroC2, setHeroC2] = useState('#268BFF');
  const [accG1, setAccG1] = useState('#E33835');
  const [accG2, setAccG2] = useState('#268BFF');
  const [accSolid, setAccSolid] = useState('#E33835');
  const [ringC1, setRingC1] = useState('#E33835');
  const [ringC2, setRingC2] = useState('#268BFF');
  const [ringC3, setRingC3] = useState('#4DE926');
  const [spotifyTrackUrl, setSpotifyTrackUrl] = useState('');
  const [spotifySaving, setSpotifySaving] = useState(false);
  const [refCodeInput, setRefCodeInput] = useState('');
  const [refCodeCurrent, setRefCodeCurrent] = useState('');
  const [refLink, setRefLink] = useState('');
  const [refUsedCount, setRefUsedCount] = useState(0);
  const [refLoading, setRefLoading] = useState(false);
  const [refSaving, setRefSaving] = useState(false);

  useEffect(() => {
    const e = mergeProfilePremiumExtras(settings.profilePremiumExtras);
    setHeroC1(e.customHeroGradient?.colors?.[0] ?? '#E33835');
    setHeroC2(e.customHeroGradient?.colors?.[1] ?? '#268BFF');
    setAccG1(e.sectionAccentGradient?.colors?.[0] ?? '#E33835');
    setAccG2(e.sectionAccentGradient?.colors?.[1] ?? '#268BFF');
    setAccSolid(e.sectionAccentSolid ?? '#E33835');
    setRingC1(e.avatarRingGradient?.colors?.[0] ?? '#E33835');
    setRingC2(e.avatarRingGradient?.colors?.[1] ?? '#268BFF');
    setRingC3(e.avatarRingGradient?.colors?.[2] ?? '#4DE926');
    setSpotifyTrackUrl(settings.spotifyProfileTrack?.url ?? '');
  }, [settings.profilePremiumExtras, settings.spotifyProfileTrack?.url]);

  const loadReferralData = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setRefLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/referral/my-code`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) return;
      const code = String(json?.code ?? '').toUpperCase();
      setRefCodeCurrent(code);
      setRefCodeInput(code);
      setRefLink(String(json?.link ?? ''));
      setRefUsedCount(Number(json?.usedCount ?? 0));
    } finally {
      setRefLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReferralData().catch(() => {});
  }, [loadReferralData]);

  // ── Helpers ────────────────────────────────────────────
  const toggleBgTracking = async (val: boolean) => {
    if (!val) {
      await updateSetting('backgroundTracking', false);
      const isRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRunning) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      Toast.show({ type: 'info', text1: '📍 Śledzenie w tle wyłączone' });
      return;
    }

    const accepted = await hasAcceptedBackgroundLocationDisclosure();
    if (!accepted) {
      setBgDisclosureVisible(true);
      return;
    }

    const granted = await requestBackgroundLocationPermissionAfterDisclosure();
    if (!granted) {
      await updateSetting('backgroundTracking', false);
      Toast.show({ type: 'error', text1: 'Brak zgody systemu', text2: 'Włącz lokalizację w tle w ustawieniach telefonu' });
      return;
    }

    await updateSetting('backgroundTracking', true);
    Toast.show({ type: 'success', text1: '📍 Śledzenie w tle włączone' });
  };

  const acceptBgDisclosure = async () => {
    setBgDisclosureVisible(false);
    const granted = await requestBackgroundLocationPermissionAfterDisclosure();
    if (!granted) {
      await updateSetting('backgroundTracking', false);
      Toast.show({ type: 'error', text1: 'Brak zgody systemu', text2: 'Włącz lokalizację w tle w ustawieniach telefonu' });
      return;
    }
    await updateSetting('backgroundTracking', true);
    Toast.show({ type: 'success', text1: '📍 Śledzenie w tle włączone' });
  };

  const setHomeFromGps = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Toast.show({ type: 'error', text1: 'Brak zgody GPS', text2: 'Włącz lokalizację i spróbuj ponownie' });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      await updateSetting('homeLatitude', lat);
      await updateSetting('homeLongitude', lng);
      await updateSetting('homeLabel', 'Dom');
      Toast.show({ type: 'success', text1: '🏠 Dom ustawiony', text2: `${lat}, ${lng}` });
    } catch {
      Toast.show({ type: 'error', text1: 'Nie udało się ustawić Domu' });
    }
  };

  const clearHome = async () => {
    await updateSetting('homeLatitude', null);
    await updateSetting('homeLongitude', null);
    await updateSetting('homeLabel', null);
    Toast.show({ type: 'info', text1: '🏠 Dom usunięty' });
  };

  const handleLogout = async () => {
    setLogoutModal(false);
    await AsyncStorage.multiRemove(['userToken', 'token', 'user', 'app_settings']);
    await syncRevenueCatLoginFromStorage();
    Toast.show({ type: 'success', text1: '👋 DO ZOBACZENIA!' });
    router.replace('/login');
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'USUŃ') { Toast.show({ type: 'error', text1: 'Wpisz USUŃ aby potwierdzić' }); return; }
    setDeleteLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/auth/delete-account`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      await AsyncStorage.multiRemove(['userToken', 'token', 'user', 'app_settings']);
      await syncRevenueCatLoginFromStorage();
      setDeleteModal(false);
      Toast.show({ type: 'success', text1: '🗑️ KONTO USUNIĘTE' });
      router.replace('/login');
    } catch { Toast.show({ type: 'error', text1: 'Nie można usunąć konta' }); }
    finally  { setDeleteLoading(false); }
  };

  const pickBugPhoto = async () => {
    if (bugPhotos.length >= 3) { Toast.show({ type: 'info', text1: 'Maksymalnie 3 zdjęcia' }); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled && result.assets[0]) setBugPhotos(prev => [...prev, result.assets[0].uri]);
  };

  const handleBugSubmit = async () => {
    Keyboard.dismiss();
    if (!bugCategory)                      { Toast.show({ type: 'error', text1: 'Wybierz kategorię' }); return; }
    if (bugDescription.trim().length < 10) { Toast.show({ type: 'error', text1: 'Opis musi mieć min. 10 znaków' }); return; }
    setBugLoading(true);
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('category',    bugCategory);
      form.append('description', bugDescription.trim());
      bugPhotos.forEach((uri, i) => {
        const ext = uri.split('.').pop() ?? 'jpg';
        form.append('photos', { uri, name: `bug_photo_${i}.${ext}`, type: `image/${ext}` } as any);
      });
      const res = await fetch(`${API_URL}/api/settings/bug-report`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Błąd');
      const newId = json.id as number | undefined;
      setBugModal(false); setBugCategory(''); setBugDescription(''); setBugPhotos([]);
      Toast.show({ type: 'success', text1: '🐛 ZGŁOSZENIE WYSŁANE' });
      if (newId) router.push(`/profile/bug-report/${newId}`);
    } catch { Toast.show({ type: 'error', text1: 'Błąd wysyłania zgłoszenia' }); }
    finally { setBugLoading(false); }
  };

  const persistSpotifyTrack = useCallback(async (body: { url?: string; trackId?: string }) => {
    const token = await getToken();
    if (!token) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak sesji' });
      return false;
    }
    setSpotifySaving(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/spotify-track`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: json?.error ?? 'Nie udało się ustawić utworu' });
        return false;
      }
      await fetchSettings();
      if (json?.spotifyProfileTrack?.url) {
        setSpotifyTrackUrl(json.spotifyProfileTrack.url);
      }
      Toast.show({ type: 'success', text1: 'Spotify', text2: 'Utwór ustawiony w profilu' });
      return true;
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' });
      return false;
    } finally {
      setSpotifySaving(false);
    }
  }, [fetchSettings]);

  const handleSaveSpotifyTrack = async () => {
    const url = spotifyTrackUrl.trim();
    if (!url) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wklej link do utworu Spotify' });
      return;
    }
    await persistSpotifyTrack({ url });
  };

  const pickSpotifyTrackFromSearch = useCallback(
    (trackId: string) => persistSpotifyTrack({ trackId }),
    [persistSpotifyTrack],
  );

  const handleClearSpotifyTrack = async () => {
    const token = await getToken();
    if (!token) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak sesji' });
      return;
    }
    setSpotifySaving(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/spotify-track`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się usunąć utworu' });
        return;
      }
      await fetchSettings();
      setSpotifyTrackUrl('');
      Toast.show({ type: 'success', text1: 'Spotify', text2: 'Utwór usunięty z profilu' });
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' });
    } finally {
      setSpotifySaving(false);
    }
  };

  const handleSpotifyPreviewAutoplay = async (val: boolean) => {
    const token = await getToken();
    if (!token) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak sesji' });
      return;
    }
    setSpotifySaving(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/spotify-track`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ previewAutoplay: val }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: json?.error ?? 'Nie udało się zapisać' });
        return;
      }
      await fetchSettings();
      Toast.show({
        type: 'success',
        text1: 'Spotify',
        text2: val ? 'Goście usłyszą podgląd po wejściu na profil' : 'Autoodtwarzanie dla gości wyłączone',
      });
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' });
    } finally {
      setSpotifySaving(false);
    }
  };

  const saveReferralCode = async () => {
    const code = refCodeInput.trim().toUpperCase();
    if (code.length < 4 || code.length > 24 || !/^[A-Z0-9]+$/.test(code)) {
      Toast.show({ type: 'error', text1: 'Kod musi mieć 4-24 znaki A-Z/0-9' });
      return;
    }
    const token = await getToken();
    if (!token) return;
    setRefSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/referral/my-code`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: json?.error ?? 'Nie udało się zapisać kodu' });
        return;
      }
      const nextCode = String(json?.code ?? code).toUpperCase();
      setRefCodeCurrent(nextCode);
      setRefCodeInput(nextCode);
      setRefLink(String(json?.link ?? ''));
      setRefUsedCount(Number(json?.usedCount ?? 0));
      Toast.show({ type: 'success', text1: 'Kod polecający zapisany' });
    } finally {
      setRefSaving(false);
    }
  };

  const shareReferralLink = async () => {
    if (!refLink) return;
    try {
      await Share.share({
        title: 'Mój link polecający VROOM',
        message: `Dołącz do VROOM z mojego linku: ${refLink}`,
      });
    } catch {}
  };

  // ── Sub-components (wewnątrz — mają dostęp do kolorów) ─
  const SectionLabel = ({ title }: { title: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 28, marginBottom: 12, marginHorizontal: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#ffffff08' : '#00000010' }} />
      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: RED + '90', letterSpacing: 3 }}>{title}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#ffffff08' : '#00000010' }} />
    </View>
  );

  const Card = ({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) => (
    <View style={{ backgroundColor: danger ? dangerCardBg : cardBg, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: danger ? RED + '25' : cardBorder }}>
      {children}
    </View>
  );

  const Row = ({
    icon, iconBg, label, sublabel, onPress, right, destructive = false, disabled = false, last = false,
  }: {
    icon: string; iconBg?: string; label: string; sublabel?: string;
    onPress?: () => void; right?: React.ReactNode;
    destructive?: boolean; disabled?: boolean; last?: boolean;
  }) => {
    const ic = destructive ? RED : (iconBg ?? RED);
    return (
      <>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12, opacity: disabled ? 0.4 : 1 }}
          onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={disabled || !onPress}
        >
          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: ic + '20', borderWidth: 1, borderColor: ic + '30', justifyContent: 'center', alignItems: 'center' }}>
            <MaterialIcons name={icon as any} size={17} color={ic} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: destructive ? RED : textMain, fontWeight: '600' }}>{label}</Text>
            {sublabel && <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: textDim, marginTop: 3, lineHeight: 14 }}>{sublabel}</Text>}
          </View>
          {right !== undefined ? right : (onPress && <MaterialIcons name="chevron-right" size={18} color={textDim} />)}
        </TouchableOpacity>
        {!last && <View style={{ height: 1, backgroundColor: divider, marginLeft: 64 }} />}
      </>
    );
  };

  // ── Loading ────────────────────────────────────────────
  if (settingsLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, justifyContent: 'center', alignItems: 'center', gap: 14 }}>
        <MaterialCommunityIcons name="car-sports" size={44} color={RED} />
        <ActivityIndicator color={RED} />
      </View>
    );
  }

  const swProps = { trackColor: { true: RED, false: isDark ? '#2a2a2a' : '#c0c0c0' }, thumbColor: '#fff' };

  return (
		<>
      <View
        style={{
          backgroundColor: bg,
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: divider,
        }}
      >
        <TouchableOpacity
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: isDark ? '#ffffff10' : '#00000010',
            borderWidth: 1,
            borderColor: isDark ? '#ffffff15' : '#00000015',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onPress={() => {
            Keyboard.dismiss();
            router.back();
          }}
        >
          <MaterialIcons name='arrow-back' size={20} color={textMain} />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain, letterSpacing: 2 }}>
          USTAWIENIA
        </Text>
        <View style={{ width: 38 }} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 56 : 0}
      >
			<ScrollView
				style={{ flex: 1 }}
				contentContainerStyle={{ paddingBottom: scrollBottomPad }}
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps="always"
				keyboardDismissMode="none"
        nestedScrollEnabled
      >
				{/* ══ HERO ══ */}
				<View
					style={{
						height: 180,
						position: "relative",
						overflow: "hidden",
						marginBottom: -20,
					}}>
					<LinearGradient
						colors={heroGrad}
						start={{ x: 0.2, y: 0 }}
						end={{ x: 1, y: 1 }}
						style={StyleSheet.absoluteFill}
					/>
					<View
						style={{
							position: "absolute",
							top: -50,
							right: -50,
							width: 200,
							height: 200,
							borderRadius: 100,
							backgroundColor: RED + "10",
							borderWidth: 1,
							borderColor: RED + "18",
						}}
					/>
					<View
						style={{
							position: "absolute",
							top: -10,
							right: -10,
							width: 110,
							height: 110,
							borderRadius: 55,
							backgroundColor: RED + "15",
						}}
					/>
					{Array.from({ length: 6 }).map((_, i) => (
						<View
							key={i}
							style={{
								position: "absolute",
								left: 0,
								right: 0,
								top: i * 30,
								height: 1,
								backgroundColor: scanLine,
							}}
						/>
					))}
					{/* HUD corners */}
					<View style={{ position: "absolute", top: 20, left: 20 }}>
						<View
							style={{
								width: 16,
								height: 2,
								backgroundColor: RED,
								opacity: 0.5,
							}}
						/>
						<View
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: 2,
								height: 16,
								backgroundColor: RED,
								opacity: 0.5,
							}}
						/>
					</View>
					<View
						style={{
							position: "absolute",
							top: 20,
							right: 20,
							alignItems: "flex-end",
						}}>
						<View
							style={{
								width: 16,
								height: 2,
								backgroundColor: RED,
								opacity: 0.5,
							}}
						/>
						<View
							style={{
								position: "absolute",
								top: 0,
								right: 0,
								width: 2,
								height: 16,
								backgroundColor: RED,
								opacity: 0.5,
							}}
						/>
					</View>
          <View
            style={{
              position: 'absolute',
              top: 52,
              right: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              backgroundColor: isDark ? '#ffffff08' : '#00000008',
              borderWidth: 1,
              borderColor: isDark ? '#ffffff12' : '#00000012',
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 20,
            }}>
            <View
              style={{ backgroundColor: RED, borderRadius: 6, padding: 4 }}>
              <MaterialCommunityIcons
                name='car-sports'
                size={11}
                color='#fff'
              />
            </View>
            <Text
              style={{
                fontFamily: 'Orbitron',
                fontSize: 11,
                color: textMain,
                fontWeight: '900',
                letterSpacing: 3,
              }}>
              VROOM
            </Text>
          </View>
					{/* Title */}
					<View style={{ position: "absolute", bottom: 36, left: 20 }}>
						<Text
							style={{
								fontFamily: "Orbitron",
								fontSize: 9,
								color: RED,
								letterSpacing: 4,
								marginBottom: 4,
							}}>
							PANEL UŻYTKOWNIKA
						</Text>
						<Text
							style={{
								fontFamily: "Orbitron",
								fontSize: 28,
								color: textMain,
								fontWeight: "900",
								letterSpacing: 1,
							}}>
							USTAWIENIA
						</Text>
					</View>
					<LinearGradient
						colors={["transparent", bg]}
						style={{
							position: "absolute",
							bottom: 0,
							left: 0,
							right: 0,
							height: 60,
						}}
					/>
				</View>

				{/* ══ CONTENT ══ */}
				<View style={{ paddingHorizontal: 20 }}>
					{/* WYGLĄD */}
					<SectionLabel title='WYGLĄD' />
					<Card>
						<View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
							<View
								style={{
									flexDirection: "row",
									alignItems: "center",
									gap: 12,
									marginBottom: 14,
								}}>
								<View
									style={{
										width: 36,
										height: 36,
										borderRadius: 11,
										backgroundColor: "#9C27B020",
										borderWidth: 1,
										borderColor: "#9C27B030",
										justifyContent: "center",
										alignItems: "center",
									}}>
									<MaterialIcons name='palette' size={17} color='#9C27B0' />
								</View>
								<View>
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 12,
											color: textMain,
											fontWeight: "600",
										}}>
										Motyw aplikacji
									</Text>
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 9,
											color: textDim,
											marginTop: 3,
										}}>
										Aktywny:{" "}
										{THEME_OPTIONS.find(o => o.key === mode)?.label ?? "—"}
									</Text>
								</View>
							</View>
							<View style={{ flexDirection: "row", gap: 8 }}>
								{THEME_OPTIONS.map(opt => (
									<TouchableOpacity
										key={opt.key}
										style={{
											flex: 1,
											flexDirection: "row",
											alignItems: "center",
											justifyContent: "center",
											gap: 5,
											paddingVertical: 10,
											borderRadius: 12,
											borderWidth: 1,
											backgroundColor:
												mode === opt.key ? opt.color + "20" : rowAlt,
											borderColor:
												mode === opt.key ? opt.color + "60" : inputBorder,
										}}
										onPress={() => setMode(opt.key)}>
										<MaterialIcons
											name={opt.icon as any}
											size={13}
											color={mode === opt.key ? opt.color : textDim}
										/>
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 8,
												color: mode === opt.key ? opt.color : textDim,
												letterSpacing: 0.5,
											}}>
											{opt.label}
										</Text>
									</TouchableOpacity>
								))}
							</View>
						</View>
						{mode === "custom" && (
							<>
								<View
									style={{
										height: 1,
										backgroundColor: divider,
										marginLeft: 64,
									}}
								/>
								<TouchableOpacity
									style={{
										flexDirection: "row",
										alignItems: "center",
										paddingHorizontal: 16,
										paddingVertical: 14,
										gap: 12,
									}}
									onPress={() => setThemeEditorVisible(true)}
									activeOpacity={0.7}>
									<View
										style={{
											width: 36,
											height: 36,
											borderRadius: 11,
											backgroundColor: "#2196F320",
											borderWidth: 1,
											borderColor: "#2196F330",
											justifyContent: "center",
											alignItems: "center",
										}}>
										<MaterialIcons
											name='color-lens'
											size={17}
											color='#2196F3'
										/>
									</View>
									<View style={{ flex: 1 }}>
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 12,
												color: textMain,
												fontWeight: "600",
											}}>
											Edytuj własne kolory
										</Text>
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 9,
												color: textDim,
												marginTop: 3,
											}}>
											Dostosuj każdy kolor aplikacji
										</Text>
									</View>
									<MaterialIcons
										name='chevron-right'
										size={18}
										color={textDim}
									/>
								</TouchableOpacity>
							</>
						)}
					</Card>

					<SectionLabel title='PREMIUM PERSONALIZACJA' />
					<Card>
						{!effectivePremium ? (
							<Row
								icon='workspace-premium'
								iconBg='#FFD700'
								label='Dostępne w Premium'
								sublabel='Motywy, własne gradienty, kolory sekcji, ramka treści, animacje wejścia i tła — tylko Premium.'
								last
							/>
						) : (
							<>
								<View
									style={{
										paddingHorizontal: 16,
										paddingVertical: 14,
										gap: 10,
									}}>
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 10,
											color: textMain,
										}}>
										Kolor nicku
									</Text>
									<View
										style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
										{NICK_COLORS.map(c => (
											<TouchableOpacity
												key={c}
												onPress={() => updateSetting("nickColor", c)}
												style={{
													width: 30,
													height: 30,
													borderRadius: 15,
													backgroundColor: c,
													borderWidth: 2,
													borderColor:
														settings.nickColor === c ? RED : inputBorder,
												}}
											/>
										))}
									</View>
								</View>
								<View
									style={{
										height: 1,
										backgroundColor: divider,
										marginLeft: 16,
										marginRight: 16,
									}}
								/>
								<View
									style={{
										paddingHorizontal: 16,
										paddingVertical: 14,
										gap: 10,
									}}>
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 10,
											color: textMain,
										}}>
										Motyw profilu
									</Text>
									<View
										style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
										{PROFILE_PRESETS.map(p => (
											<TouchableOpacity
												key={p}
												onPress={() => updateSetting("profileThemePreset", p)}
												style={{
													paddingHorizontal: 10,
													paddingVertical: 7,
													borderRadius: 10,
													borderWidth: 1,
													borderColor:
														settings.profileThemePreset === p
															? RED
															: inputBorder,
													backgroundColor:
														settings.profileThemePreset === p
															? RED + "22"
															: rowAlt,
												}}>
												<Text
													style={{
														fontFamily: "Orbitron",
														fontSize: 8,
														color:
															settings.profileThemePreset === p ? RED : textDim,
													}}>
													{p.toUpperCase()}
												</Text>
											</TouchableOpacity>
										))}
									</View>
								</View>
								<View
									style={{
										height: 1,
										backgroundColor: divider,
										marginLeft: 16,
										marginRight: 16,
									}}
								/>
								<View
									style={{
										paddingHorizontal: 16,
										paddingVertical: 14,
										gap: 10,
									}}>
									<Text
										style={{
											fontFamily: "Orbitron",
											fontSize: 10,
											color: textMain,
										}}>
										Ramka avatara
									</Text>
									<View
										style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
										{FRAME_PRESETS.map(p => (
											<TouchableOpacity
												key={p}
												onPress={() => updateSetting("avatarFramePreset", p)}
												style={{
													paddingHorizontal: 10,
													paddingVertical: 7,
													borderRadius: 10,
													borderWidth: 1,
													borderColor:
														settings.avatarFramePreset === p
															? RED
															: inputBorder,
													backgroundColor:
														settings.avatarFramePreset === p
															? RED + "22"
															: rowAlt,
												}}>
												<Text
													style={{
														fontFamily: "Orbitron",
														fontSize: 8,
														color:
															settings.avatarFramePreset === p ? RED : textDim,
													}}>
													{p.toUpperCase()}
												</Text>
											</TouchableOpacity>
										))}
									</View>
								</View>
								<View
									style={{
										height: 1,
										backgroundColor: divider,
										marginLeft: 16,
										marginRight: 16,
									}}
								/>
								<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
										Konkurs profilu — własny motyw (gradient tła)
									</Text>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim }}>
										Ustaw motyw profilu na CUSTOM powyżej. Dwa kolory + Zapisz — gradient banera + kolory kart/tła z Twoich barw (bez banera).
									</Text>
									<View style={{ gap: 8 }}>
										<ColorPickTriggerRow
											label="Kolor 1 — gradient tła"
											value={heroC1}
											onOpen={() =>
												setColorPick({
													title: 'Kolor 1 — gradient tła profilu',
													color: heroC1,
													onPick: setHeroC1,
												})
											}
											swatchBorder={inputBorder}
											rowBg={inputBg}
											textMain={textMain}
											textDim={textDim}
										/>
										<ColorPickTriggerRow
											label="Kolor 2 — gradient tła"
											value={heroC2}
											onOpen={() =>
												setColorPick({
													title: 'Kolor 2 — gradient tła profilu',
													color: heroC2,
													onPick: setHeroC2,
												})
											}
											swatchBorder={inputBorder}
											rowBg={inputBg}
											textMain={textMain}
											textDim={textDim}
										/>
										<TouchableOpacity
											onPress={() =>
												updateSetting('profilePremiumExtras', {
													...premiumExtras,
													customHeroGradient: {
														colors: [heroC1.trim().toUpperCase(), heroC2.trim().toUpperCase()],
														start: { x: 0, y: 0 },
														end: { x: 1, y: 1 },
													},
												} as ProfilePremiumExtras)
											}
											style={{
												backgroundColor: RED,
												borderRadius: 10,
												paddingHorizontal: 12,
												paddingVertical: 12,
												alignItems: 'center',
											}}>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>
												ZAPISZ GRADIENT TŁA
											</Text>
										</TouchableOpacity>
									</View>
								</View>
								<View
									style={{
										height: 1,
										backgroundColor: divider,
										marginLeft: 16,
										marginRight: 16,
									}}
								/>
								<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
										Nagłówki sekcji / „zakładki” (kolor)
									</Text>
									<View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
										{(['theme', 'gradient', 'solid'] as ProfileSectionAccentMode[]).map(m => (
											<TouchableOpacity
												key={m}
												onPress={() =>
													updateSetting('profilePremiumExtras', {
														...premiumExtras,
														sectionAccentMode: m,
													} as ProfilePremiumExtras)
												}
												style={{
													paddingHorizontal: 10,
													paddingVertical: 7,
													borderRadius: 10,
													borderWidth: 1,
													borderColor: premiumExtras.sectionAccentMode === m ? RED : inputBorder,
													backgroundColor:
														premiumExtras.sectionAccentMode === m ? RED + '22' : rowAlt,
												}}>
												<Text
													style={{
														fontFamily: 'Orbitron',
														fontSize: 8,
														color: premiumExtras.sectionAccentMode === m ? RED : textDim,
													}}>
													{m.toUpperCase()}
												</Text>
											</TouchableOpacity>
										))}
									</View>
									{premiumExtras.sectionAccentMode === 'gradient' && (
										<View style={{ gap: 8 }}>
											<ColorPickTriggerRow
												label="Kolor 1 — nagłówki sekcji"
												value={accG1}
												onOpen={() =>
													setColorPick({
														title: 'Kolor 1 — gradient nagłówków',
														color: accG1,
														onPick: setAccG1,
													})
												}
												swatchBorder={inputBorder}
												rowBg={inputBg}
												textMain={textMain}
												textDim={textDim}
											/>
											<ColorPickTriggerRow
												label="Kolor 2 — nagłówki sekcji"
												value={accG2}
												onOpen={() =>
													setColorPick({
														title: 'Kolor 2 — gradient nagłówków',
														color: accG2,
														onPick: setAccG2,
													})
												}
												swatchBorder={inputBorder}
												rowBg={inputBg}
												textMain={textMain}
												textDim={textDim}
											/>
											<TouchableOpacity
												onPress={() =>
													updateSetting('profilePremiumExtras', {
														...premiumExtras,
														sectionAccentGradient: {
															colors: [accG1.trim().toUpperCase(), accG2.trim().toUpperCase()],
															start: { x: 0, y: 0 },
															end: { x: 0, y: 1 },
														},
													} as ProfilePremiumExtras)
												}
												style={{
													backgroundColor: RED,
													borderRadius: 10,
													paddingHorizontal: 10,
													paddingVertical: 12,
													alignItems: 'center',
												}}>
												<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>ZAPISZ GRADIENT</Text>
											</TouchableOpacity>
										</View>
									)}
									{premiumExtras.sectionAccentMode === 'solid' && (
										<View style={{ gap: 8 }}>
											<ColorPickTriggerRow
												label="Jeden kolor — nagłówki i zakładki"
												value={accSolid}
												onOpen={() =>
													setColorPick({
														title: 'Kolor nagłówków sekcji',
														color: accSolid,
														onPick: setAccSolid,
													})
												}
												swatchBorder={inputBorder}
												rowBg={inputBg}
												textMain={textMain}
												textDim={textDim}
											/>
											<TouchableOpacity
												onPress={() =>
													updateSetting('profilePremiumExtras', {
														...premiumExtras,
														sectionAccentSolid: accSolid.trim().toUpperCase(),
													} as ProfilePremiumExtras)
												}
												style={{
													backgroundColor: RED,
													borderRadius: 10,
													paddingHorizontal: 10,
													paddingVertical: 12,
													alignItems: 'center',
												}}>
												<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>ZAPISZ KOLOR</Text>
											</TouchableOpacity>
										</View>
									)}
								</View>
								<View
									style={{
										height: 1,
										backgroundColor: divider,
										marginLeft: 16,
										marginRight: 16,
									}}
								/>
								<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
										Obramowanie avatara (gradient)
									</Text>
									<View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
										{(['none', 'rotate', 'pulse', 'breathe'] as ProfileAvatarRingAnim[]).map(a => (
											<TouchableOpacity
												key={a}
												onPress={() =>
													updateSetting('profilePremiumExtras', {
														...premiumExtras,
														avatarRingAnim: a,
													} as ProfilePremiumExtras)
												}
												style={{
													paddingHorizontal: 10,
													paddingVertical: 7,
													borderRadius: 10,
													borderWidth: 1,
													borderColor: premiumExtras.avatarRingAnim === a ? RED : inputBorder,
													backgroundColor:
														premiumExtras.avatarRingAnim === a ? RED + '22' : rowAlt,
												}}>
												<Text
													style={{
														fontFamily: 'Orbitron',
														fontSize: 8,
														color: premiumExtras.avatarRingAnim === a ? RED : textDim,
													}}>
													{a.toUpperCase()}
												</Text>
											</TouchableOpacity>
										))}
									</View>
									<View style={{ gap: 8 }}>
										<ColorPickTriggerRow
											label="Kolor 1 — pierścień avatara"
											value={ringC1}
											onOpen={() =>
												setColorPick({
													title: 'Kolor 1 — pierścień avatara',
													color: ringC1,
													onPick: setRingC1,
												})
											}
											swatchBorder={inputBorder}
											rowBg={inputBg}
											textMain={textMain}
											textDim={textDim}
										/>
										<ColorPickTriggerRow
											label="Kolor 2 — pierścień avatara"
											value={ringC2}
											onOpen={() =>
												setColorPick({
													title: 'Kolor 2 — pierścień avatara',
													color: ringC2,
													onPick: setRingC2,
												})
											}
											swatchBorder={inputBorder}
											rowBg={inputBg}
											textMain={textMain}
											textDim={textDim}
										/>
										<ColorPickTriggerRow
											label="Kolor 3 — pierścień (opcjonalnie)"
											value={ringC3}
											onOpen={() =>
												setColorPick({
													title: 'Kolor 3 — pierścień avatara',
													color: ringC3,
													onPick: setRingC3,
												})
											}
											swatchBorder={inputBorder}
											rowBg={inputBg}
											textMain={textMain}
											textDim={textDim}
										/>
										<TouchableOpacity
											onPress={() =>
												updateSetting('profilePremiumExtras', {
													...premiumExtras,
													avatarRingGradient: {
														colors: [
															ringC1.trim().toUpperCase(),
															ringC2.trim().toUpperCase(),
															ringC3.trim().toUpperCase(),
														],
														start: { x: 0, y: 0 },
														end: { x: 1, y: 1 },
													},
												} as ProfilePremiumExtras)
											}
											style={{
												backgroundColor: RED,
												borderRadius: 10,
												paddingHorizontal: 10,
												paddingVertical: 12,
												alignItems: 'center',
											}}>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>ZAPISZ PIERŚCIEŃ</Text>
										</TouchableOpacity>
									</View>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: textDim }}>
										Bez zapisu używany jest gradient ramki „Motyw avatara”. Minimum dwa kolory po zapisie.
									</Text>
								</View>
								<View
									style={{
										height: 1,
										backgroundColor: divider,
										marginLeft: 16,
										marginRight: 16,
									}}
								/>
								<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
										Animacja gdy ktoś wchodzi na profil
									</Text>
									<View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
										{(['none', 'sparkle', 'hero-flash', 'rings', 'glow', 'sweep'] as ProfileVisitEntranceAnim[]).map(a => (
											<TouchableOpacity
												key={a}
												onPress={() =>
													updateSetting('profilePremiumExtras', {
														...premiumExtras,
														visitEntranceAnim: a,
													} as ProfilePremiumExtras)
												}
												style={{
													paddingHorizontal: 8,
													paddingVertical: 7,
													borderRadius: 10,
													borderWidth: 1,
													borderColor: premiumExtras.visitEntranceAnim === a ? RED : inputBorder,
													backgroundColor:
														premiumExtras.visitEntranceAnim === a ? RED + '22' : rowAlt,
												}}>
												<Text
													style={{
														fontFamily: 'Orbitron',
														fontSize: 7,
														color: premiumExtras.visitEntranceAnim === a ? RED : textDim,
													}}>
													{a.toUpperCase()}
												</Text>
											</TouchableOpacity>
										))}
									</View>
								</View>
								<View
									style={{
										height: 1,
										backgroundColor: divider,
										marginLeft: 16,
										marginRight: 16,
									}}
								/>
								<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 8 }}>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
										Animacja tła profilu (ty)
									</Text>
									<View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
										{(['none', 'shimmer', 'float', 'pulse'] as ProfileHeroMotion[]).map(a => (
											<TouchableOpacity
												key={a}
												onPress={() =>
													updateSetting('profilePremiumExtras', {
														...premiumExtras,
														heroMotion: a,
													} as ProfilePremiumExtras)
												}
												style={{
													paddingHorizontal: 10,
													paddingVertical: 7,
													borderRadius: 10,
													borderWidth: 1,
													borderColor: premiumExtras.heroMotion === a ? RED : inputBorder,
													backgroundColor:
														premiumExtras.heroMotion === a ? RED + '22' : rowAlt,
												}}>
												<Text
													style={{
														fontFamily: 'Orbitron',
														fontSize: 8,
														color: premiumExtras.heroMotion === a ? RED : textDim,
													}}>
													{a.toUpperCase()}
												</Text>
											</TouchableOpacity>
										))}
									</View>
								</View>
							</>
						)}
					</Card>

					<View style={{ marginTop: 10 }}>
						<Card>
							<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
								<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
									Muzyka w profilu (Spotify)
								</Text>
								{settings.spotifySearchAvailable ? (
									<SpotifyTrackSearchField
										apiUrl={API_URL}
										onPickTrack={pickSpotifyTrackFromSearch}
										saving={spotifySaving}
										textMain={textMain}
										textDim={textDim}
										inputBg={inputBg}
										inputBorder={inputBorder}
										rowAlt={rowAlt}
									/>
								) : (
									<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim }}>
										Wyszukiwanie w aplikacji wymaga kluczy Spotify Web API na serwerze (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET). Nadal możesz wkleić link do utworu poniżej.
									</Text>
								)}
								<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, marginTop: 4 }}>
									Alternatywnie: w aplikacji Spotify — Udostępnij → Kopiuj link utworu.
								</Text>
								<TextInput
									value={spotifyTrackUrl}
									onChangeText={setSpotifyTrackUrl}
									placeholder='https://open.spotify.com/track/...'
									placeholderTextColor={textDim}
									autoCapitalize='none'
									autoCorrect={false}
                  clearButtonMode='while-editing'
									style={{
										backgroundColor: inputBg,
										borderRadius: 10,
										borderWidth: 1,
										borderColor: inputBorder,
										color: textMain,
										paddingHorizontal: 12,
										paddingVertical: 11,
										fontFamily: 'Orbitron',
										fontSize: 9,
									}}
								/>
								{!!settings.spotifyProfileTrack && (
									<View style={{ backgroundColor: rowAlt, borderRadius: 10, borderWidth: 1, borderColor: inputBorder, padding: 10 }}>
										<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: RED, letterSpacing: 1 }}>
											AKTUALNY UTWÓR
										</Text>
										<Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: textMain, marginTop: 5 }}>
											{settings.spotifyProfileTrack.trackName}
										</Text>
										{!!settings.spotifyProfileTrack.artistName && (
											<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, marginTop: 3 }}>
												{settings.spotifyProfileTrack.artistName}
											</Text>
										)}
									</View>
								)}
								{!!settings.spotifyProfileTrack && (
									<View
										style={{
											flexDirection: 'row',
											alignItems: 'center',
											justifyContent: 'space-between',
											gap: 12,
											paddingVertical: 6,
										}}>
										<View style={{ flex: 1 }}>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: textMain, fontWeight: '600' }}>
												Autoodtwarzanie dla gości
											</Text>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: textDim, marginTop: 4, lineHeight: 12 }}>
												Na publicznym profilu podgląd zacznie grać sam po wejściu gościa. Odtwarzanie wymaga{' '}
												<Text style={{ color: '#1DB954' }}>podglądu audio</Text> u tego utworu — bez niego przełącznik zapisze się, ale nic nie zagra.
											</Text>
										</View>
										<Switch
											value={!!settings.spotifyProfileTrack.previewAutoplay}
											onValueChange={handleSpotifyPreviewAutoplay}
											disabled={spotifySaving}
											{...swProps}
										/>
									</View>
								)}
								<View style={{ flexDirection: 'row', gap: 8 }}>
									<TouchableOpacity
										onPress={handleSaveSpotifyTrack}
										disabled={spotifySaving}
										style={{
											flex: 1,
											backgroundColor: '#1DB954',
											borderRadius: 10,
											paddingVertical: 12,
											alignItems: 'center',
											opacity: spotifySaving ? 0.75 : 1,
										}}>
										<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>
											{spotifySaving ? 'ZAPIS...' : 'USTAW Z LINKU'}
										</Text>
									</TouchableOpacity>
									<TouchableOpacity
										onPress={handleClearSpotifyTrack}
										disabled={spotifySaving}
										style={{
											paddingHorizontal: 12,
											borderRadius: 10,
											borderWidth: 1,
											borderColor: '#ff3b3040',
											backgroundColor: '#ff3b3018',
											alignItems: 'center',
											justifyContent: 'center',
										}}>
										<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ff3b30', fontWeight: '700' }}>
											WYCZYŚĆ
										</Text>
									</TouchableOpacity>
								</View>
							</View>
						</Card>
					</View>

					{/* IKONA LOKALIZACJI */}
					<View style={{ marginTop: 10 }}>
						<Card>
							<View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
								<View
									style={{
										flexDirection: "row",
										alignItems: "center",
										gap: 12,
										marginBottom: 14,
									}}>
									<View
										style={{
											width: 36,
											height: 36,
											borderRadius: 11,
											backgroundColor: RED + "20",
											borderWidth: 1,
											borderColor: RED + "30",
											justifyContent: "center",
											alignItems: "center",
										}}>
										<MaterialIcons name='navigation' size={17} color={RED} />
									</View>
									<View>
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 12,
												color: textMain,
												fontWeight: "600",
											}}>
											Ikona lokalizacji
										</Text>
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 9,
												color: textDim,
												marginTop: 3,
											}}>
											Aktywna:{" "}
											{MARKER_STYLES.find(
												o => o.key === settings.locationMarkerStyle,
											)?.label ?? "—"}
										</Text>
									</View>
								</View>
								<View style={{ flexDirection: "row", gap: 8 }}>
									{MARKER_STYLES.map(opt => (
										<TouchableOpacity
											key={opt.key}
											style={{
												flex: 1,
												flexDirection: "row",
												alignItems: "center",
												justifyContent: "center",
												gap: 5,
												paddingVertical: 10,
												borderRadius: 12,
												borderWidth: 1,
												backgroundColor:
													settings.locationMarkerStyle === opt.key
														? RED + "20"
														: rowAlt,
												borderColor:
													settings.locationMarkerStyle === opt.key
														? RED + "60"
														: inputBorder,
											}}
											onPress={() =>
												updateSetting("locationMarkerStyle", opt.key)
											}>
											<MaterialIcons
												name={opt.icon as any}
												size={13}
												color={
													settings.locationMarkerStyle === opt.key
														? RED
														: textDim
												}
											/>
											<Text
												style={{
													fontFamily: "Orbitron",
													fontSize: 8,
													color:
														settings.locationMarkerStyle === opt.key
															? RED
															: textDim,
													letterSpacing: 0.5,
												}}>
												{opt.label}
											</Text>
										</TouchableOpacity>
									))}
								</View>
							</View>
						</Card>
					</View>

					<View style={{ marginTop: 10 }}>
						<Card>
							<View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
								<View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
									<View
										style={{
											width: 36,
											height: 36,
											borderRadius: 11,
											backgroundColor: "#4de92620",
											borderWidth: 1,
											borderColor: "#4de92640",
											justifyContent: "center",
											alignItems: "center",
										}}>
										<MaterialIcons name='home' size={18} color='#4de926' />
									</View>
									<View style={{ flex: 1 }}>
										<Text style={{ fontFamily: "Orbitron", fontSize: 12, color: textMain, fontWeight: "600" }}>
											Adres Dom
										</Text>
										<Text style={{ fontFamily: "Orbitron", fontSize: 9, color: textDim, marginTop: 3 }}>
											{settings.homeLatitude != null && settings.homeLongitude != null
												? `${settings.homeLabel || 'Dom'} · ${settings.homeLatitude.toFixed(5)}, ${settings.homeLongitude.toFixed(5)}`
												: 'Nie ustawiono'}
										</Text>
									</View>
								</View>
								<View style={{ flexDirection: "row", gap: 8 }}>
									<TouchableOpacity
										onPress={setHomeFromGps}
										style={{
											flex: 1,
											backgroundColor: "#4de92618",
											borderColor: "#4de92640",
											borderWidth: 1,
											borderRadius: 12,
											paddingVertical: 11,
											alignItems: "center",
										}}>
										<Text style={{ fontFamily: "Orbitron", fontSize: 9, color: "#4de926", fontWeight: "700" }}>
											USTAW Z GPS
										</Text>
									</TouchableOpacity>
									<TouchableOpacity
										onPress={clearHome}
										style={{
											paddingHorizontal: 14,
											borderRadius: 12,
											borderWidth: 1,
											borderColor: inputBorder,
											backgroundColor: rowAlt,
											alignItems: "center",
											justifyContent: "center",
										}}>
										<Text style={{ fontFamily: "Orbitron", fontSize: 9, color: textDim, fontWeight: "700" }}>
											WYCZYŚĆ
										</Text>
									</TouchableOpacity>
								</View>
							</View>
						</Card>
					</View>

					{/* KONTO */}
					<SectionLabel title='KONTO' />
					<Card>
						<Row
							icon='person-outline'
							iconBg={RED}
							label='Edytuj profil'
							sublabel='Zmień avatar, bio, lokalizację'
							onPress={() => router.push("/profile/edit")}
						/>
						<Row
							icon='lock-outline'
							iconBg={RED}
							label='Zmień hasło'
							sublabel='Zaktualizuj hasło do konta'
							onPress={() => router.push("/profile/change-password")}
						/>
						<Row
							icon='email'
							iconBg={RED}
							label='Zmień e-mail'
							sublabel='Zaktualizuj adres e-mail'
							onPress={() => router.push("/profile/change-email")}
							last
						/>
					</Card>

					<SectionLabel title='POLECENIA / REF LINK' />
					<View style={{ backgroundColor: cardBg, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: cardBorder }}>
						<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
							<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
								Twój kod polecający
							</Text>
							{refLoading ? (
								<ActivityIndicator color={RED} />
							) : (
								<>
									<TextInput
										value={refCodeInput}
										onChangeText={(t) => setRefCodeInput(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
										placeholder='NP. NIGHTRIDER99'
										placeholderTextColor={textDim}
										autoCapitalize='characters'
										autoCorrect={false}
                    clearButtonMode='while-editing'
										maxLength={24}
										style={{
											backgroundColor: inputBg,
											borderRadius: 10,
											borderWidth: 1,
											borderColor: inputBorder,
											color: textMain,
											paddingHorizontal: 12,
											paddingVertical: 11,
											fontFamily: 'Orbitron',
											fontSize: 10,
											letterSpacing: 1,
										}}
									/>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim }}>
										Użyć kodu: {refUsedCount} razy
									</Text>
									{!!refLink && (
										<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim }}>
											Link: {refLink}
										</Text>
									)}
									<View style={{ flexDirection: 'row', gap: 8 }}>
										<TouchableOpacity
											onPress={saveReferralCode}
											disabled={refSaving || !refCodeInput || refCodeInput === refCodeCurrent}
											style={{
												flex: 1,
												backgroundColor: RED,
												borderRadius: 10,
												paddingVertical: 12,
												alignItems: 'center',
												opacity: refSaving || !refCodeInput || refCodeInput === refCodeCurrent ? 0.6 : 1,
											}}>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>
												{refSaving ? 'ZAPIS...' : 'ZAPISZ KOD'}
											</Text>
										</TouchableOpacity>
										<TouchableOpacity
											onPress={shareReferralLink}
											disabled={!refLink}
											style={{
												paddingHorizontal: 12,
												borderRadius: 10,
												borderWidth: 1,
												borderColor: '#4de92640',
												backgroundColor: '#4de92618',
												alignItems: 'center',
												justifyContent: 'center',
												opacity: refLink ? 1 : 0.5,
											}}>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#4de926', fontWeight: '700' }}>
												UDOSTĘPNIJ
											</Text>
										</TouchableOpacity>
									</View>
								</>
							)}
						</View>
					</View>

					{/* PRYWATNOŚĆ */}
					<SectionLabel title='PRYWATNOŚĆ' />
					<Card>
						<Row
							icon='leaderboard'
							iconBg='#9C27B0'
							label='Tryb prywatny'
							sublabel='Ukryj swój profil w rankingu'
							right={
								<Switch
									value={settings.privateProfile}
									onValueChange={v => updateSetting("privateProfile", v)}
									{...swProps}
								/>
							}
						/>
						<Row
							icon='location-off'
							iconBg='#FF9800'
							label='Ukryj lokalizację'
							sublabel='Nie pokazuj swojej pozycji na mapie'
							right={
								<Switch
									value={settings.hideLocation}
									onValueChange={v => updateSetting("hideLocation", v)}
									{...swProps}
								/>
							}
						/>
						<Row
							icon='message'
							iconBg='#9C27B0'
							label='Tylko znajomi mogą pisać'
							sublabel='Tylko znajomi mogą wysyłać Ci prywatne wiadomości'
							last
							right={
								<Switch
									value={settings.friendsOnlyMessages}
									onValueChange={v => updateSetting("friendsOnlyMessages", v)}
									{...swProps}
								/>
							}
						/>
					</Card>

					{/* POWIADOMIENIA */}
					<SectionLabel title='POWIADOMIENIA' />
					<Card>
						{(
							[
								{
									icon: "event",
									iconBg: "#4CAF50",
									label: "Nowe zloty",
									sub: "Powiadomienia o zlotach w okolicy",
									key: "notifMeets",
								},
								{
									icon: "favorite-outline",
									iconBg: RED,
									label: "Lajki",
									sub: "Ktoś polubił Twój spot, auto lub post",
									key: "notifLikes",
								},
								{
									icon: "chat-bubble-outline",
									iconBg: "#2196F3",
									label: "Komentarze",
									sub: "Nowy komentarz pod Twoim postem",
									key: "notifComments",
								},
								{
									icon: "message",
									iconBg: "#9C27B0",
									label: "Wiadomości",
									sub: "Nowa wiadomość na czacie",
									key: "notifMessages",
								},
								{
									icon: "person-add",
									iconBg: "#00BCD4",
									label: "Znajomi",
									sub: "Zaproszenia i akceptacje znajomych",
									key: "notifFriends",
								},
								{
									icon: "emoji-events",
									iconBg: "#FFC107",
									label: "Osiągnięcia",
									sub: "Gdy odblokujesz nowe osiągnięcie",
									key: "notifAchievements",
								},
								{
									icon: "warning-amber",
									iconBg: "#FF9800",
									label: "Ostrzeżenia drogowe",
									sub: "Alert gdy jesteś blisko ostrzeżenia",
									key: "notifWarnings",
								},
								{
									icon: "visibility",
									iconBg: "#4de926",
									label: "Posty obserwowanych",
									sub: "Nowy post od obserwowanego użytkownika",
									key: "notifFollowedPosts",
								},
								{
									icon: "forum",
									iconBg: "#FF7043",
									label: "Dyskusje (globalne)",
									sub: "Nowy post w dyskusjach od dowolnego użytkownika",
									key: "notifDiscussionPosts",
								},
							] as const
						).map((item, i, arr) => (
							<Row
								key={item.key}
								icon={item.icon}
								iconBg={item.iconBg}
								label={item.label}
								sublabel={item.sub}
								last={i === arr.length - 1}
								right={
									<Switch
										value={(settings as any)[item.key]}
										onValueChange={v => updateSetting(item.key as any, v)}
										{...swProps}
									/>
								}
							/>
						))}
					</Card>

					{/* APLIKACJA */}
					<SectionLabel title='APLIKACJA' />
					<Card>
						<Row
							icon='directions-run'
							iconBg='#4CAF50'
							label='Praca w tle'
							sublabel='Lokalizacja w tle do km, nawigacji i statystyk jazdy'
							right={
								<Switch
									value={settings.backgroundTracking}
									onValueChange={toggleBgTracking}
									{...swProps}
								/>
							}
						/>
						<Row
							icon='workspace-premium'
							iconBg='#FFD700'
							label='VROOM Premium'
							sublabel={effectivePremium ? 'Zarządzaj subskrypcją i korzyściami' : 'Subskrypcja i korzyści'}
							onPress={() => router.push('/premium')}
						/>
						<Row
							icon='info-outline'
							iconBg='#607D8B'
							label='O aplikacji'
							sublabel='VROOM V1.0.21'
							onPress={() =>
								Toast.show({
									type: "info",
									text1: "🚗 VROOM V1.0.21",
									text2: "Made with ❤️ for car enthusiasts",
								})
							}
						/>
						<Row
							icon='bug-report'
							iconBg='#FF5722'
							label='Zgłoś błąd'
							sublabel='Pomóż nam ulepszyć aplikację'
							onPress={() => setBugModal(true)}
						/>
						<Row
							icon='forum'
							iconBg='#2196F3'
							label='Moje zgłoszenia'
							sublabel='Status, odpowiedzi supportu, czat'
							onPress={() => router.push('/profile/bug-reports')}
						/>
						<Row
							icon='star-outline'
							iconBg='#FFC107'
							label='Oceń aplikację'
							sublabel='Zostaw opinię w sklepie'
							last
							onPress={() => Toast.show({ type: "info", text1: "WKRÓTCE" })}
						/>
					</Card>

					{/* SESJA */}
					<SectionLabel title='SESJA' />
					<Card>
						<Row
							icon='logout'
							iconBg='#FF9800'
							label='Wyloguj się'
							sublabel='Wróć do ekranu logowania'
							last
							onPress={() => setLogoutModal(true)}
						/>
					</Card>

					{/* STREFA NIEBEZPIECZNA */}
					<SectionLabel title='STREFA NIEBEZPIECZNA' />
					<Card danger>
						<Row
							icon='delete-forever'
							label='Usuń konto'
							sublabel='Trwale usuwa konto i wszystkie dane'
							destructive
							last
							onPress={() => {
								setDeleteConfirm("");
								setDeleteModal(true);
							}}
						/>
					</Card>

					{/* Bottom badge */}
					<View style={{ alignItems: "center", marginTop: 36, gap: 6 }}>
						<View
							style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
							<View
								style={{
									width: 5,
									height: 5,
									borderRadius: 2.5,
									backgroundColor: "#4de926",
								}}
							/>
							<Text
								style={{
									fontFamily: "Orbitron",
									fontSize: 8,
									color: textDim,
									letterSpacing: 2,
								}}>
								VROOM OS V1.0.21
							</Text>
							<View
								style={{
									width: 5,
									height: 5,
									borderRadius: 2.5,
									backgroundColor: "#4de926",
								}}
							/>
						</View>
						<Text
							style={{
								fontFamily: "Orbitron",
								fontSize: 7,
								color: textDim,
								letterSpacing: 1,
							}}>
							MADE FOR THOSE WHO NEVER STOP
						</Text>
					</View>
				</View>
			</ScrollView>
      </KeyboardAvoidingView>

			{/* ══ MODAL WYLOGUJ ══ */}
			<Modal
				visible={logoutModal}
				transparent
				animationType='fade'
				onRequestClose={() => setLogoutModal(false)}>
				<View
					style={{
						flex: 1,
						backgroundColor: overlayBg,
						justifyContent: "center",
						alignItems: "center",
						padding: 20,
					}}>
					<View
						style={{
							backgroundColor: cardBg,
							borderRadius: 22,
							padding: 26,
							width: "100%",
							borderWidth: 1,
							borderColor: cardBorder,
						}}>
						<View
							style={{
								width: 62,
								height: 62,
								borderRadius: 18,
								backgroundColor: "#FF980018",
								borderWidth: 1,
								borderColor: "#FF980030",
								justifyContent: "center",
								alignItems: "center",
								alignSelf: "center",
								marginBottom: 18,
							}}>
							<MaterialIcons name='logout' size={30} color='#FF9800' />
						</View>
						<Text
							style={{
								fontFamily: "Orbitron",
								color: textMain,
								fontSize: 16,
								textAlign: "center",
								marginBottom: 10,
								letterSpacing: 2,
								fontWeight: "900",
							}}>
							WYLOGUJ SIĘ
						</Text>
						<Text
							style={{
								color: textMuted,
								fontSize: 13,
								lineHeight: 21,
								textAlign: "center",
								marginBottom: 22,
							}}>
							Czy na pewno chcesz się wylogować z konta VROOM?
						</Text>
						<View style={{ flexDirection: "row", gap: 10 }}>
							<TouchableOpacity
								style={{
									flex: 1,
									backgroundColor: cancelBg,
									borderRadius: 14,
									paddingVertical: 14,
									alignItems: "center",
									borderWidth: 1,
									borderColor: cancelBorder,
								}}
								onPress={() => setLogoutModal(false)}>
								<Text
									style={{
										fontFamily: "Orbitron",
										color: textMuted,
										fontSize: 11,
									}}>
									ANULUJ
								</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={{
									flex: 1,
									backgroundColor: "#FF9800",
									borderRadius: 14,
									paddingVertical: 14,
									alignItems: "center",
								}}
								onPress={handleLogout}>
								<Text
									style={{
										fontFamily: "Orbitron",
										color: "#fff",
										fontSize: 11,
										fontWeight: "900",
									}}>
									WYLOGUJ
								</Text>
							</TouchableOpacity>
						</View>
					</View>
				</View>
			</Modal>

			{/* ══ MODAL USUŃ KONTO ══ */}
			<Modal
				visible={deleteModal}
				transparent
				animationType='fade'
				onRequestClose={() => setDeleteModal(false)}>
				<View
					style={{
						flex: 1,
						backgroundColor: overlayBg,
						justifyContent: "center",
						alignItems: "center",
						padding: 20,
					}}>
					<View
						style={{
							backgroundColor: cardBg,
							borderRadius: 22,
							padding: 26,
							width: "100%",
							borderWidth: 1,
							borderColor: RED + "25",
						}}>
						<View
							style={{
								width: 62,
								height: 62,
								borderRadius: 18,
								backgroundColor: RED + "15",
								borderWidth: 1,
								borderColor: RED + "30",
								justifyContent: "center",
								alignItems: "center",
								alignSelf: "center",
								marginBottom: 18,
							}}>
							<MaterialIcons name='delete-forever' size={30} color={RED} />
						</View>
						<Text
							style={{
								fontFamily: "Orbitron",
								color: RED,
								fontSize: 16,
								textAlign: "center",
								marginBottom: 10,
								letterSpacing: 2,
								fontWeight: "900",
							}}>
							USUŃ KONTO
						</Text>
						<Text
							style={{
								color: textMuted,
								fontSize: 13,
								lineHeight: 21,
								textAlign: "center",
								marginBottom: 18,
							}}>
							Ta operacja jest{" "}
							<Text style={{ color: RED, fontWeight: "700" }}>
								nieodwracalna
							</Text>
							.{"\n\n"}
							Zostaną usunięte:{"\n"}• Profil i dane{"\n"}• Wszystkie spoty
							{"\n"}• Auta w garażu{"\n"}• Historia aktywności{"\n\n"}
							Wpisz <Text style={{ color: RED, fontWeight: "700" }}>
								USUŃ
							</Text>{" "}
							aby potwierdzić:
						</Text>
						<TextInput
							style={{
								backgroundColor: isDark ? "#1a0808" : "#fff0f0",
								borderRadius: 12,
								padding: 14,
								color: RED,
								fontFamily: "Orbitron",
								fontSize: 16,
								borderWidth: 1,
								borderColor: RED + "30",
								textAlign: "center",
								marginBottom: 18,
								letterSpacing: 4,
							}}
							value={deleteConfirm}
							onChangeText={setDeleteConfirm}
							placeholder='Wpisz USUŃ'
							placeholderTextColor={RED + "40"}
							autoCapitalize='characters'
              clearButtonMode='while-editing'
						/>
						<View style={{ flexDirection: "row", gap: 10 }}>
							<TouchableOpacity
								style={{
									flex: 1,
									backgroundColor: cancelBg,
									borderRadius: 14,
									paddingVertical: 14,
									alignItems: "center",
									borderWidth: 1,
									borderColor: cancelBorder,
								}}
								onPress={() => {
                  Keyboard.dismiss();
                  setDeleteModal(false);
                }}
								disabled={deleteLoading}>
								<Text
									style={{
										fontFamily: "Orbitron",
										color: textMuted,
										fontSize: 11,
									}}>
									ANULUJ
								</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={{
									flex: 1,
									backgroundColor: RED,
									borderRadius: 14,
									paddingVertical: 14,
									alignItems: "center",
									opacity: deleteConfirm !== "USUŃ" ? 0.4 : 1,
								}}
								onPress={handleDeleteAccount}
								disabled={deleteConfirm !== "USUŃ" || deleteLoading}>
								{deleteLoading ? (
									<ActivityIndicator size={16} color='#fff' />
								) : (
									<Text
										style={{
											fontFamily: "Orbitron",
											color: "#fff",
											fontSize: 11,
											fontWeight: "900",
										}}>
										USUŃ KONTO
									</Text>
								)}
							</TouchableOpacity>
						</View>
					</View>
				</View>
			</Modal>

			{/* ══ MODAL BUG REPORT ══ */}
			<Modal
				visible={bugModal}
				transparent
				animationType='slide'
				onRequestClose={() => setBugModal(false)}>
				<View
					style={{
						flex: 1,
						backgroundColor: overlayBg,
						justifyContent: "flex-start",
						alignItems: "center",
						padding: 20,
						paddingTop: Platform.OS === 'ios' ? 56 : 28,
					}}>
					<KeyboardAvoidingView
						style={{
							width: "100%",
              maxHeight: "92%",
						}}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
            enabled={Platform.OS === 'ios'}>
            <View
              style={{
                backgroundColor: cardBg,
                borderRadius: 22,
                padding: 26,
                width: "100%",
                maxHeight: "100%",
                borderWidth: 1,
                borderColor: cardBorder,
              }}
            >
						<ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps='handled'
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            >
							<View
								style={{
									width: 62,
									height: 62,
									borderRadius: 18,
									backgroundColor: "#FF572218",
									borderWidth: 1,
									borderColor: "#FF572230",
									justifyContent: "center",
									alignItems: "center",
									alignSelf: "center",
									marginBottom: 18,
								}}>
								<MaterialIcons name='bug-report' size={30} color='#FF5722' />
							</View>
							<Text
								style={{
									fontFamily: "Orbitron",
									color: textMain,
									fontSize: 16,
									textAlign: "center",
									marginBottom: 10,
									letterSpacing: 2,
									fontWeight: "900",
								}}>
								ZGŁOŚ BŁĄD
							</Text>
							<Text
								style={{
									color: textMuted,
									fontSize: 13,
									lineHeight: 21,
									textAlign: "center",
									marginBottom: 20,
								}}>
								Pomóż nam ulepszyć VROOM. Opisz problem jak najdokładniej.
							</Text>

							<Text
								style={{
									fontFamily: "Orbitron",
									fontSize: 8,
									color: textDim,
									letterSpacing: 2,
									marginBottom: 10,
								}}>
								KATEGORIA *
							</Text>
							<View style={{ gap: 8, marginBottom: 18 }}>
								{BUG_CATEGORIES.map(cat => (
									<TouchableOpacity
										key={cat.key}
										style={{
											paddingHorizontal: 14,
											paddingVertical: 12,
											borderRadius: 12,
											borderWidth: 1,
											backgroundColor:
												bugCategory === cat.key ? cat.color + "18" : rowAlt,
											borderColor:
												bugCategory === cat.key
													? cat.color + "60"
													: inputBorder,
											flexDirection: "row",
											alignItems: "center",
											gap: 10,
										}}
										onPress={() => setBugCategory(cat.key)}>
										{bugCategory === cat.key && (
											<View
												style={{
													width: 6,
													height: 6,
													borderRadius: 3,
													backgroundColor: cat.color,
												}}
											/>
										)}
										<Text
											style={{
												fontFamily: "Orbitron",
												fontSize: 11,
												color: bugCategory === cat.key ? cat.color : textMuted,
											}}>
											{cat.label}
										</Text>
									</TouchableOpacity>
								))}
							</View>

							<Text
								style={{
									fontFamily: "Orbitron",
									fontSize: 8,
									color: textDim,
									letterSpacing: 2,
									marginBottom: 10,
								}}>
								OPIS BŁĘDU *
							</Text>
							<TextInput
								style={{
									backgroundColor: inputBg,
									borderRadius: 14,
									padding: 14,
									color: textMain,
									fontSize: 13,
									borderWidth: 1,
									borderColor: inputBorder,
									minHeight: 120,
									marginBottom: 6,
								}}
								value={bugDescription}
								onChangeText={setBugDescription}
								placeholder='Opisz dokładnie co się stało...'
								placeholderTextColor={textDim}
								multiline
                clearButtonMode='while-editing'
								numberOfLines={5}
								textAlignVertical='top'
							/>
							<Text
								style={{
									fontFamily: "Orbitron",
									fontSize: 8,
									color: bugDescription.length < 10 ? RED + "90" : textDim,
									textAlign: "right",
									marginBottom: 18,
								}}>
								{bugDescription.length} / min. 10 znaków
							</Text>

							<Text
								style={{
									fontFamily: "Orbitron",
									fontSize: 8,
									color: textDim,
									letterSpacing: 2,
									marginBottom: 10,
								}}>
								ZDJĘCIA (opcjonalne, max 3)
							</Text>
							<View
								style={{
									flexDirection: "row",
									gap: 10,
									marginBottom: 22,
									flexWrap: "wrap",
								}}>
								{bugPhotos.map((uri, i) => (
									<View key={i} style={{ position: "relative" }}>
										<Image
											source={{ uri }}
											style={{ width: 80, height: 80, borderRadius: 12 }}
										/>
										<TouchableOpacity
											style={{
												position: "absolute",
												top: -6,
												right: -6,
												backgroundColor: RED,
												borderRadius: 10,
												width: 22,
												height: 22,
												justifyContent: "center",
												alignItems: "center",
											}}
											onPress={() =>
												setBugPhotos(prev => prev.filter((_, idx) => idx !== i))
											}>
											<MaterialIcons name='close' size={13} color='#fff' />
										</TouchableOpacity>
									</View>
								))}
								{bugPhotos.length < 3 && (
									<TouchableOpacity
										style={{
											width: 80,
											height: 80,
											borderRadius: 12,
											backgroundColor: inputBg,
											borderWidth: 1,
											borderColor: inputBorder,
											borderStyle: "dashed",
											justifyContent: "center",
											alignItems: "center",
										}}
										onPress={pickBugPhoto}>
										<MaterialIcons
											name='add-photo-alternate'
											size={24}
											color={textDim}
										/>
									</TouchableOpacity>
								)}
							</View>

							<View style={{ flexDirection: "row", gap: 10 }}>
								<TouchableOpacity
									style={{
										flex: 1,
										backgroundColor: cancelBg,
										borderRadius: 14,
										paddingVertical: 14,
										alignItems: "center",
										borderWidth: 1,
										borderColor: cancelBorder,
									}}
									onPress={() => {
                    Keyboard.dismiss();
                    setBugModal(false);
                  }}
									disabled={bugLoading}>
									<Text
										style={{
											fontFamily: "Orbitron",
											color: textMuted,
											fontSize: 11,
										}}>
										ANULUJ
									</Text>
								</TouchableOpacity>
								<TouchableOpacity
									style={{
										flex: 1,
										backgroundColor: "#FF5722",
										borderRadius: 14,
										paddingVertical: 14,
										alignItems: "center",
										opacity:
											!bugCategory || bugDescription.length < 10 ? 0.4 : 1,
									}}
									onPress={handleBugSubmit}
									disabled={
										!bugCategory || bugDescription.length < 10 || bugLoading
									}>
									{bugLoading ? (
										<ActivityIndicator size={16} color='#fff' />
									) : (
										<Text
											style={{
												fontFamily: "Orbitron",
												color: "#fff",
												fontSize: 11,
												fontWeight: "900",
											}}>
											WYŚLIJ
										</Text>
									)}
								</TouchableOpacity>
							</View>
						</ScrollView>
            </View>
					</KeyboardAvoidingView>
				</View>
			</Modal>

			<CustomThemeEditor
				visible={themeEditorVisible}
				onClose={() => setThemeEditorVisible(false)}
			/>

			<ColorWheelPickerSheet
				visible={!!colorPick}
				title={colorPick?.title ?? ''}
				color={colorPick?.color ?? '#E33835'}
				onClose={() => setColorPick(null)}
				onConfirm={(hex) => {
					colorPick?.onPick(hex);
				}}
			/>

			<BackgroundLocationDisclosureModal
				visible={bgDisclosureVisible}
				onCancel={() => setBgDisclosureVisible(false)}
				onAccept={acceptBgDisclosure}
			/>
		</>
	);
}