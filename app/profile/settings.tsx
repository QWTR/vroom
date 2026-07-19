import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Switch, Modal, Image, Share,
  Dimensions, KeyboardAvoidingView, Keyboard, Platform,
} from 'react-native';
import { Text }         from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ResizeMode, Video } from 'expo-av';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons    from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage     from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as TaskManager from 'expo-task-manager';
import * as Location    from 'expo-location';
import * as WebBrowser  from 'expo-web-browser';
import Toast            from 'react-native-toast-message';
import { API_URL }      from '../../constants/config';
import { useSettings }  from '../../hooks/useSettings';
import { useTheme }     from '../../contexts/ThemeContext';
import { useEffectivePremium } from '../../hooks/useEffectivePremium';
import { useProfile } from '../../hooks/useProfile';
import { useEquippedMapVehicle } from '../../hooks/useEquippedMapVehicle';
import { useCursorSkin } from '../../hooks/useCursorSkin';
import { ThemeMode }    from '../../constants/theme';
import { CustomThemeEditor } from '../../components/settings/CustomThemeEditor';
import { ColorWheelPickerSheet, ColorPickTriggerRow, normalizePickerHex } from '../../components/settings/ColorWheelPickerSheet';
import { ProfileMusicSearchField } from '../../components/settings/ProfileMusicSearchField';
import { SpotifyProfileTrackRow } from '../../components/profile/SpotifyProfileTrackRow';
import { TrackStartScrubber } from '../../components/shared/TrackStartScrubber';
import { MusicTrimSheet } from '../../components/shared/MusicTrimSheet';
import { fetchProfileMusicPreviewUrl } from '../../utils/freshAudioPreview';
import { defaultTrimSelectionMs, isFullTrackSource, PREVIEW_CLIP_MS } from '../../utils/musicPreviewLimits';
import type { ProfileMusicSource } from '../../constants/profile';
import { SettingsSectionLabel, SettingsCard, SettingsRow } from '../../components/settings/SettingsLayout';
import { setEntranceMotionMode } from '../../hooks/useEntranceIntroPolicy';
import type { EntranceMotionMode } from '../../components/motion/entranceFxTypes';
import { useAppTutorial } from '../../contexts/AppTutorialContext';
import { NitroShopPromoCard } from '../../components/shop/NitroShopPromoCard';
import { useNitroWallet } from '../../hooks/useNitroWallet';
import { useAppUpdate, getUpdateDiagnostics } from '../../hooks/useAppUpdate';
import { BackgroundLocationDisclosureModal } from '../../components/privacy/BackgroundLocationDisclosureModal';
import { BACKGROUND_LOCATION_TASK, stopBackgroundLocationTaskIfRunning, mirrorBackgroundTrackingSetting } from '../../hooks/useBackgroundTracking';
import { BackgroundDriveController } from '../../lib/backgroundDriveController';
import { startVroomBgForegroundNotification, stopVroomBgForegroundNotification } from '../../lib/vroomBgForegroundService';
import {
  hasAcceptedBackgroundLocationDisclosure,
  requestBackgroundLocationPermissionAfterDisclosure,
} from '../../lib/backgroundLocationConsent';
import { syncRevenueCatLoginFromStorage } from '../../lib/revenueCatUserSync';
import { useFormKeyboardPadding, useKeyboardInset } from '../../hooks/useKeyboardInset';
import ProfileAnimationSettingsPreview from '../../components/profile/ProfileAnimationSettingsPreview';
import { HERO_MOTION_LABELS, VISIT_ENTRANCE_LABELS } from '../../constants/profileAnimationLabels';
import {
  mergeProfilePremiumExtras,
  PROFILE_HERO_MOTIONS,
  PROFILE_VISIT_ENTRANCE_ANIMS,
  type ProfilePremiumExtras,
  type ProfileSectionAccentMode,
  type ProfileAvatarRingAnim,
  type ProfileVisitEntranceAnim,
  type ProfileHeroMotion,
  type ProfileBannerFocusPoint,
} from '../../constants/profilePremiumExtras';
import ProfileHeroBannerFrame from '../../components/profile/ProfileHeroBannerFrame';
import ProfileBannerCropModal from '../../components/profile/ProfileBannerCropModal';
import {
  getHeroBannerHeight,
  uploadProfileBanner,
  deleteProfileBanner,
} from '../../lib/profileBanner';
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

const SETTINGS_TABS = [
  { key: 'appearance', label: 'WyglÄ…d', icon: 'palette' },
  { key: 'profile', label: 'Profil', icon: 'person' },
  { key: 'account', label: 'Konto', icon: 'manage-accounts' },
  { key: 'privacy', label: 'PrywatnoĹ›Ä‡', icon: 'shield' },
  { key: 'notifications', label: 'Powiadomienia', icon: 'notifications' },
  { key: 'app', label: 'Aplikacja', icon: 'apps' },
  { key: 'session', label: 'Sesja', icon: 'logout' },
] as const;
type SettingsTabKey = typeof SETTINGS_TABS[number]['key'];

const MARKER_STYLES = [
  { key: 'arrow'   as const, label: 'STRZAŁKA',  icon: 'navigation' },
  { key: 'profile' as const, label: 'PROFILOWE', icon: 'account-circle' },
  { key: 'vehicle_3d' as const, label: 'AUTO 3D', icon: 'directions-car', requiresVehicle: true },
];
const NICK_COLORS = ['#FFFFFF', '#FFD700', '#4DE926', '#38A5E3', '#A855F7', '#FF6B35'];
const PROFILE_PRESETS = ['default', 'midnight', 'sunset', 'neon', 'royal', 'cyber', 'gold', 'forest', 'custom'] as const;
const FRAME_PRESETS = ['vroom', 'sunrise', 'ocean', 'lime'] as const;
const BANNER_FOCUS_OPTIONS: { key: ProfileBannerFocusPoint; label: string }[] = [
  { key: 'top', label: 'GÓRA' },
  { key: 'center', label: 'ŚRODEK' },
  { key: 'bottom', label: 'DÓŁ' },
];

const REFERRAL_PROMO_FORMATS = [
  { key: 'story' as const, label: 'STORY', hint: '9:16' },
  { key: 'post' as const, label: 'POST', hint: '1:1' },
  { key: 'banner' as const, label: 'BANER', hint: '16:9' },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { openBug } = useLocalSearchParams<{ openBug?: string }>();
  const openBugHandledRef = React.useRef(false);
  const { theme, isDark, mode, presetId, setMode, setPreset, availablePresets } = useTheme();
  const { profile, fetchProfile } = useProfile();
  const { isPremium: effectivePremium, refresh: refreshPremiumAccess } = useEffectivePremium(profile);
  const { settings, loading: settingsLoading, updateSetting, fetchSettings } = useSettings();
  const { skins: cursorSkins, activeSkin, setActiveSkinId } = useCursorSkin();
  const { vehicle: equippedMapVehicle } = useEquippedMapVehicle();
  const { wallet: nitroWallet } = useNitroWallet();
  const { startTutorialReplay } = useAppTutorial();
  const [cursorSkinModalVisible, setCursorSkinModalVisible] = useState(false);
  const [entranceMotion, setEntranceMotionState] = useState<EntranceMotionMode>('full');
  const [bannerPreviewUri, setBannerPreviewUri] = useState<string | null>(null);
  const [bannerPreviewSize, setBannerPreviewSize] = useState<{ w: number; h: number } | null>(null);
  const [bannerPreviewVisible, setBannerPreviewVisible] = useState(false);
  const [bannerUploadBusy, setBannerUploadBusy] = useState(false);
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
  const deleteKeyboardInset = useKeyboardInset(deleteModal);
  const [logoutModal,        setLogoutModal]        = useState(false);
  const [bugModal,           setBugModal]           = useState(false);
  const [loadTimedOut,       setLoadTimedOut]       = useState(false);

  useEffect(() => {
    if (!settingsLoading) {
      setLoadTimedOut(false);
      return;
    }
    const t = setTimeout(() => setLoadTimedOut(true), 4_000);
    return () => clearTimeout(t);
  }, [settingsLoading]);

  useEffect(() => {
    if (openBugHandledRef.current) return;
    if (openBug === '1' || openBug === 'true') {
      openBugHandledRef.current = true;
      setBugModal(true);
    }
  }, [openBug]);

  useEffect(() => {
    AsyncStorage.getItem('entrance_motion_mode').then(v => {
      if (v === 'off' || v === 'reduced' || v === 'full') setEntranceMotionState(v);
    });
  }, []);

  const cycleEntranceMotion = async () => {
    const next: EntranceMotionMode = entranceMotion === 'full' ? 'reduced' : entranceMotion === 'reduced' ? 'off' : 'full';
    setEntranceMotionState(next);
    await setEntranceMotionMode(next);
  };

  const entranceMotionLabel = entranceMotion === 'full'
    ? 'Pełne intro arena'
    : entranceMotion === 'reduced'
      ? 'Tylko reduce motion skip'
      : 'Wyłączone';

  const [bgDisclosureVisible, setBgDisclosureVisible] = useState(false);
  const [themeEditorVisible, setThemeEditorVisible] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabKey>('appearance');
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

  const buildTwoColorGradient = useCallback(
    (c1: string, c2: string, vertical = false) => ({
      colors: [normalizePickerHex(c1), normalizePickerHex(c2)],
      start: { x: 0, y: 0 },
      end: vertical ? { x: 0, y: 1 } : { x: 1, y: 1 },
    }),
    [],
  );

  const persistPremiumExtras = useCallback(
    async (
      patch: Partial<ProfilePremiumExtras>,
      opts?: { setCustomTheme?: boolean; okMessage?: string },
    ) => {
      if (opts?.setCustomTheme && settings.profileThemePreset !== 'custom') {
        await updateSetting('profileThemePreset', 'custom');
      }
      const merged = mergeProfilePremiumExtras({ ...premiumExtras, ...patch });
      const ok = await updateSetting('profilePremiumExtras', merged);
      if (ok) {
        void fetchProfile();
        Toast.show({
          type: 'success',
          text1: opts?.okMessage ?? 'Zapisano',
          text2: 'Odśwież profil, jeśli nie widzisz zmian od razu.',
        });
      } else {
        Toast.show({
          type: 'error',
          text1: 'Nie zapisano',
          text2: 'Aktywne Premium i internet są wymagane.',
        });
      }
      return ok;
    },
    [premiumExtras, settings.profileThemePreset, updateSetting, fetchProfile],
  );

  const pickBannerForPreview = useCallback(async () => {
    if (!effectivePremium) {
      Toast.show({ type: 'info', text1: 'VROOM Premium', text2: 'Baner profilu wymaga Premium.' });
      router.push('/premium');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const asset = result.assets[0];
    setBannerPreviewUri(asset.uri);
    setBannerPreviewSize(
      asset.width && asset.height ? { w: asset.width, h: asset.height } : null,
    );
    setBannerPreviewVisible(true);
  }, [effectivePremium, router]);

  const handleBannerCropConfirm = useCallback(async ({
    croppedUri,
    focusPoint,
  }: {
    croppedUri: string;
    focusPoint: ProfileBannerFocusPoint;
  }) => {
    setBannerUploadBusy(true);
    try {
      await persistPremiumExtras({ bannerFocusPoint: focusPoint });
      const result = await uploadProfileBanner(croppedUri);
      if (!result.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: result.error });
        return;
      }
      await fetchProfile();
      Toast.show({ type: 'success', text1: 'Baner zaktualizowany' });
      setBannerPreviewVisible(false);
      setBannerPreviewUri(null);
      setBannerPreviewSize(null);
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się wgrać banera.' });
    } finally {
      setBannerUploadBusy(false);
    }
  }, [persistPremiumExtras, fetchProfile]);

  const handleBannerFocusChange = useCallback(async (focus: ProfileBannerFocusPoint) => {
    await persistPremiumExtras({ bannerFocusPoint: focus }, { okMessage: 'Kadrowanie banera zapisane' });
  }, [persistPremiumExtras]);

  const handleDeleteBanner = useCallback(async () => {
    setBannerUploadBusy(true);
    try {
      const result = await deleteProfileBanner();
      if (!result.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: result.error ?? 'Nie udało się usunąć banera.' });
        return;
      }
      await fetchProfile();
      Toast.show({ type: 'success', text1: 'Baner usunięty' });
    } finally {
      setBannerUploadBusy(false);
    }
  }, [fetchProfile]);

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
  const [profileMusicTrimOpen, setProfileMusicTrimOpen] = useState(false);
  const [refCodeInput, setRefCodeInput] = useState('');
  const [refCodeCurrent, setRefCodeCurrent] = useState('');
  const [refLink, setRefLink] = useState('');
  const [refUsedCount, setRefUsedCount] = useState(0);
  const [refLoading, setRefLoading] = useState(false);
  const [refSaving, setRefSaving] = useState(false);
  const [promoFormat, setPromoFormat] = useState<'story' | 'post' | 'banner'>('story');
  const [promoPreviewMode, setPromoPreviewMode] = useState<'png' | 'mp4'>('mp4');
  const [promoPreviewUrl, setPromoPreviewUrl] = useState('');
  const [promoVideoPreviewUrl, setPromoVideoPreviewUrl] = useState('');
  const [promoBusy, setPromoBusy] = useState<'png' | 'mp4' | null>(null);

  const { checkForUpdate, applyUpdate, downloading: otaDownloading } = useAppUpdate();
  const [otaChecking, setOtaChecking] = useState(false);
  const otaDiag = useMemo(() => getUpdateDiagnostics(), []);

  const handleCheckAppUpdate = useCallback(async () => {
    const diag = getUpdateDiagnostics();
    if (diag.isDev) {
      Toast.show({ type: 'info', text1: 'OTA wyłączone w dev', text2: 'Tylko build produkcyjny ze sklepu / EAS' });
      return;
    }
    if (!diag.enabled) {
      Toast.show({
        type: 'error',
        text1: 'Aktualizacje OTA wyłączone',
        text2: `Runtime ${diag.runtimeVersion ?? '?'} · kanał ${diag.channel ?? 'brak'}`,
      });
      return;
    }
    setOtaChecking(true);
    try {
      const available = await checkForUpdate({ retries: 3 });
      const shortId = diag.updateId ? diag.updateId.slice(0, 8) : 'brak';
      if (available) {
        Toast.show({
          type: 'success',
          text1: 'Nowa wersja — pobieranie…',
          text2: `Runtime ${diag.runtimeVersion} · kanał ${diag.channel ?? '?'}`,
        });
        await applyUpdate();
        return;
      }
      Toast.show({
        type: 'info',
        text1: 'Masz najnowszą wersję OTA',
        text2: `Runtime ${diag.runtimeVersion} · kanał ${diag.channel ?? '?'} · pakiet ${shortId}`,
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Nie udało się sprawdzić aktualizacji',
        text2: `Runtime ${diag.runtimeVersion} · kanał ${diag.channel ?? '?'}`,
      });
    } finally {
      setOtaChecking(false);
    }
  }, [checkForUpdate, applyUpdate]);

  const otaSublabel = otaDiag.isDev
    ? 'Dostępne tylko w buildzie produkcyjnym'
    : !otaDiag.enabled
      ? 'OTA wyłączone w tym buildzie'
      : `Runtime ${otaDiag.runtimeVersion ?? '?'} · kanał ${otaDiag.channel ?? 'brak'}`;

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

  useFocusEffect(
    useCallback(() => {
      void refreshPremiumAccess();
      void fetchProfile();
    }, [refreshPremiumAccess, fetchProfile]),
  );

  const prevEffectivePremiumRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (settingsLoading) return;
    if (effectivePremium) {
      prevEffectivePremiumRef.current = true;
      return;
    }
    if (prevEffectivePremiumRef.current === true && settings.backgroundTracking) {
      void (async () => {
        await updateSetting('backgroundTracking', false);
        await stopBackgroundLocationTaskIfRunning();
        await mirrorBackgroundTrackingSetting(false);
      })();
    }
    if (prevEffectivePremiumRef.current === null) {
      prevEffectivePremiumRef.current = false;
    }
  }, [effectivePremium, settings.backgroundTracking, settingsLoading, updateSetting]);

  // ── Helpers ────────────────────────────────────────────
  const toggleBgTracking = async (val: boolean) => {
    if (!val) {
      await updateSetting('backgroundTracking', false);
      await mirrorBackgroundTrackingSetting(false);
      await stopVroomBgForegroundNotification();
      await BackgroundDriveController.stop('app');
      const isRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRunning) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      Toast.show({ type: 'info', text1: '📍 Śledzenie w tle wyłączone' });
      return;
    }

    if (!effectivePremium) {
      Toast.show({
        type: 'info',
        text1: 'VROOM Premium',
        text2: 'Statystyki km w tle po zminimalizowaniu aplikacji',
      });
      router.push('/premium');
      return;
    }

    const accepted = await hasAcceptedBackgroundLocationDisclosure();
    if (!accepted) {
      setBgDisclosureVisible(true);
      return;
    }

    const granted = await requestBackgroundLocationPermissionAfterDisclosure();
    if (!granted) {
      const bg = await Location.getBackgroundPermissionsAsync();
      if (bg.status !== 'granted') {
        await updateSetting('backgroundTracking', false);
        await mirrorBackgroundTrackingSetting(false);
        Toast.show({ type: 'error', text1: 'Brak zgody systemu', text2: 'Włącz lokalizację „Zawsze” w ustawieniach telefonu' });
        return;
      }
    }

    const ok = await updateSetting('backgroundTracking', true);
    if (!ok) {
      await mirrorBackgroundTrackingSetting(false);
      Toast.show({
        type: 'error',
        text1: 'Nie udało się włączyć',
        text2: 'Sprawdź subskrypcję Premium i spróbuj ponownie',
      });
      return;
    }
    await mirrorBackgroundTrackingSetting(true);
    if (Platform.OS === 'android') {
      await startVroomBgForegroundNotification();
    }
    Toast.show({ type: 'success', text1: '📍 Śledzenie w tle włączone' });
  };

  const acceptBgDisclosure = async () => {
    setBgDisclosureVisible(false);
    const granted = await requestBackgroundLocationPermissionAfterDisclosure();
    if (!granted) {
      const bg = await Location.getBackgroundPermissionsAsync();
      if (bg.status !== 'granted') {
        await updateSetting('backgroundTracking', false);
        await mirrorBackgroundTrackingSetting(false);
        Toast.show({ type: 'error', text1: 'Brak zgody systemu', text2: 'Włącz lokalizację „Zawsze” w ustawieniach telefonu' });
        return;
      }
    }
    const ok = await updateSetting('backgroundTracking', true);
    if (!ok) {
      await mirrorBackgroundTrackingSetting(false);
      Toast.show({
        type: 'error',
        text1: 'Nie udało się włączyć',
        text2: 'Sprawdź subskrypcję Premium i spróbuj ponownie',
      });
      return;
    }
    await mirrorBackgroundTrackingSetting(true);
    if (Platform.OS === 'android') {
      await startVroomBgForegroundNotification();
    }
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
      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const apiError = typeof payload?.error === 'string' ? payload.error : null;
        const fallback =
          res.status === 401 ? 'Sesja wygasła, zaloguj się ponownie'
          : res.status === 503 ? 'Usuwanie kont jest chwilowo niedostępne'
          : 'Nie można usunąć konta';
        throw new Error(apiError || fallback);
      }
      await AsyncStorage.multiRemove(['userToken', 'token', 'user', 'app_settings']);
      await syncRevenueCatLoginFromStorage();
      setDeleteModal(false);
      Toast.show({ type: 'success', text1: '🗑️ KONTO USUNIĘTE' });
      router.replace('/login');
    } catch (e: any) {
      Toast.show({
        type: 'error',
        text1: 'Nie można usunąć konta',
        text2: e?.message || 'Spróbuj ponownie za chwilę',
      });
    }
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

  const persistProfileTrack = useCallback(async (body: {
    sourceType?: ProfileMusicSource;
    trackId?: string;
    url?: string;
    previewAutoplay?: boolean;
  }) => {
    const token = await getToken();
    if (!token) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak sesji' });
      return false;
    }
    setSpotifySaving(true);
    try {
      const useProfileEndpoint = !!body.sourceType && !!body.trackId && !body.url;
      const res = await fetch(
        `${API_URL}/api/settings/${useProfileEndpoint ? 'profile-track' : 'spotify-track'}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: json?.error ?? 'Nie udało się ustawić utworu' });
        return false;
      }
      await fetchSettings();
      if (json?.spotifyProfileTrack?.url) {
        setSpotifyTrackUrl(json.spotifyProfileTrack.url);
      }
      Toast.show({ type: 'success', text1: 'Muzyka profilu', text2: 'Utwór ustawiony w profilu' });
      return true;
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' });
      return false;
    } finally {
      setSpotifySaving(false);
    }
  }, [fetchSettings]);

  const persistSpotifyTrack = useCallback(
    async (body: { url?: string; trackId?: string }) => persistProfileTrack(body),
    [persistProfileTrack],
  );

  const handleSaveSpotifyTrack = async () => {
    const url = spotifyTrackUrl.trim();
    if (!url) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wklej link do utworu Spotify' });
      return;
    }
    await persistSpotifyTrack({ url });
  };

  const pickProfileTrackFromSearch = useCallback(
    async (sourceType: ProfileMusicSource, trackId: string) => {
      const ok = await persistProfileTrack({ sourceType, trackId });
      if (ok) setProfileMusicTrimOpen(true);
      return ok;
    },
    [persistProfileTrack],
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
      Toast.show({ type: 'success', text1: 'Muzyka profilu', text2: 'Utwór usunięty z profilu' });
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
      const res = await fetch(`${API_URL}/api/settings/profile-track`, {
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
        text1: 'Muzyka profilu',
        text2: val ? 'Goście usłyszą podgląd po wejściu na profil' : 'Autoodtwarzanie dla gości wyłączone',
      });
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' });
    } finally {
      setSpotifySaving(false);
    }
  };

  const handleProfilePreviewStart = async (ms: number) => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/settings/profile-track`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ previewStartMs: ms }),
      });
      if (!res.ok) return;
      await fetchSettings();
    } catch {
      /* ignore */
    }
  };

  const resolveProfileTrimAudio = useCallback(async () => {
    const track = settings.spotifyProfileTrack;
    if (!track?.trackId) return track?.previewUrl ?? null;
    const fresh = await fetchProfileMusicPreviewUrl(track.sourceType ?? 'deezer', track.trackId);
    return fresh ?? track.previewUrl ?? null;
  }, [settings.spotifyProfileTrack]);

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

  // ── Sub-components (module-level SettingsLayout — stable identity for TextInput focus) ─

  // ── Loading (max 4s — potem pokaż UI z cache) ──
  const fetchReferralPromoUrl = useCallback(async (media: 'png' | 'mp4') => {
    const token = await getToken();
    if (!token) return '';
    const res = await fetch(
      `${API_URL}/api/referral/promo-ticket?media=${media}&format=${promoFormat}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(json?.error ?? 'Nie udało się przygotować materiału');
    return String(json?.url ? `${API_URL}${json.url}` : (json?.absoluteUrl || ''));
  }, [promoFormat]);

  const refreshPromoPreview = useCallback(async () => {
    if (!refCodeCurrent) return;
    try {
      const media = promoPreviewMode === 'mp4' ? 'mp4' : 'png';
      const url = await fetchReferralPromoUrl(media);
      if (media === 'mp4') {
        setPromoVideoPreviewUrl(`${url}${url.includes('?') ? '&' : '?'}preview=${Date.now()}`);
        return;
      }
      setPromoPreviewUrl(`${url}${url.includes('?') ? '&' : '?'}preview=${Date.now()}`);
    } catch {
      if (promoPreviewMode === 'mp4') setPromoVideoPreviewUrl('');
      else setPromoPreviewUrl('');
    }
  }, [fetchReferralPromoUrl, promoPreviewMode, refCodeCurrent]);

  useEffect(() => {
    if (activeSettingsTab !== 'account') return;
    void refreshPromoPreview();
  }, [activeSettingsTab, refreshPromoPreview]);

  const saveReferralCodeForPromo = async () => {
    const code = refCodeInput.trim().toUpperCase();
    if (code === refCodeCurrent) return true;
    if (code.length < 4 || code.length > 24 || !/^[A-Z0-9]+$/.test(code)) {
      (Toast.show as any)({ type: 'error', text1: 'Kod musi mieć 4-24 znaki A-Z/0-9' });
      return false;
    }
    const token = await getToken();
    if (!token) return false;
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
        (Toast.show as any)({ type: 'error', text1: 'BŁĄD', text2: json?.error ?? 'Nie udało się zapisać kodu' });
        return false;
      }
      const nextCode = String(json?.code ?? code).toUpperCase();
      setRefCodeCurrent(nextCode);
      setRefCodeInput(nextCode);
      setRefLink(String(json?.link ?? ''));
      setRefUsedCount(Number(json?.usedCount ?? 0));
      return true;
    } finally {
      setRefSaving(false);
    }
  };

  const openReferralPromoDownload = async (media: 'png' | 'mp4') => {
    const saved = await saveReferralCodeForPromo();
    if (!saved) return;

    setPromoBusy(media);
    try {
      const url = await fetchReferralPromoUrl(media);
      await WebBrowser.openBrowserAsync(url);
      if (media === 'png') void refreshPromoPreview();
    } catch (e: any) {
      (Toast.show as any)({
        type: 'error',
        text1: 'Nie udało się pobrać',
        text2: e?.message ?? 'Spróbuj ponownie za chwilę',
      });
    } finally {
      setPromoBusy(null);
    }
  };

  if (settingsLoading && !loadTimedOut) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, justifyContent: 'center', alignItems: 'center', gap: 14 }}>
        <MaterialCommunityIcons name="car-sports" size={44} color={RED} />
        <ActivityIndicator color={RED} />
      </View>
    );
  }

  const swProps = { trackColor: { true: RED, false: isDark ? '#2a2a2a' : '#c0c0c0' }, thumbColor: '#fff' };
  const settingsCardProps = { cardBg, dangerCardBg, cardBorder };
  const settingsRowProps = { textMain, textDim, divider };

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
              top: insets.top + 8,
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
					<ScrollView
						horizontal
						showsHorizontalScrollIndicator={false}
						contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
						style={{ marginHorizontal: -4, marginBottom: 8 }}
					>
						{SETTINGS_TABS.map(tab => {
							const active = activeSettingsTab === tab.key;
							return (
								<TouchableOpacity
									key={tab.key}
									onPress={() => setActiveSettingsTab(tab.key)}
									style={{
										flexDirection: 'row',
										alignItems: 'center',
										gap: 6,
										paddingHorizontal: 12,
										paddingVertical: 9,
										borderRadius: 12,
										borderWidth: 1,
										borderColor: active ? RED + '70' : cardBorder,
										backgroundColor: active ? RED + '18' : rowAlt,
									}}
								>
									<MaterialIcons name={tab.icon as any} size={15} color={active ? RED : textDim} />
									<Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: active ? RED : textDim }}>
										{tab.label}
									</Text>
								</TouchableOpacity>
							);
						})}
					</ScrollView>
					{activeSettingsTab === 'profile' && (<>
					<SettingsSectionLabel isDark={isDark} title='SKLEP NITRO' />
					<NitroShopPromoCard
						nitroBalance={nitroWallet?.nitroBalance ?? 0}
						onPress={() => router.push('/shop' as any)}
					/>

					</>)}

					{activeSettingsTab === 'appearance' && (<>
					{/* WYGLĄD */}
					<SettingsSectionLabel isDark={isDark} title='WYGLĄD' />
					<SettingsCard {...settingsCardProps}>
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
										onPress={async () => {
											if (opt.key === 'custom' && !effectivePremium) {
												Toast.show({ type: 'info', text1: 'VROOM Premium', text2: 'Własny motyw wymaga Premium.' });
												router.push('/premium');
												return;
											}
											const ok = await setMode(opt.key);
											if (!ok) {
												(Toast as any).show({ type: 'error', text1: 'Nie zapisano motywu', text2: 'Sprawdź Premium albo połączenie z serwerem.' });
											}
										}}>
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
							<View style={{ marginTop: 16, gap: 12 }}>
								{(['dark', 'light'] as const).map(category => (
									<View key={category} style={{ gap: 8 }}>
										<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, letterSpacing: 2 }}>
											{category === 'dark' ? 'GOTOWE CIEMNE' : 'GOTOWE JASNE'}
										</Text>
										<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
											{availablePresets.filter(p => p.category === category).map(preset => {
												const active = mode === 'preset' && presetId === preset.id;
												const swatches = (preset as any).swatches ?? [theme.primary, theme.surface, theme.textDim];
												return (
													<TouchableOpacity
														key={preset.id}
														onPress={async () => {
															if (!effectivePremium) {
																Toast.show({ type: 'info', text1: 'VROOM Premium', text2: 'Gotowe motywy są dla Premium.' });
																router.push('/premium');
																return;
															}
															const ok = await setPreset(preset.id);
															if (!ok) {
																(Toast as any).show({ type: 'error', text1: 'Nie zapisano motywu', text2: 'Sprawdź Premium albo połączenie z serwerem.' });
															}
														}}
														style={{
															width: '48%',
															minHeight: 84,
															borderRadius: 14,
															borderWidth: 1,
															borderColor: active ? RED : inputBorder,
															backgroundColor: active ? RED + '12' : rowAlt,
															padding: 10,
															gap: 8,
														}}
													>
														<View style={{ flexDirection: 'row', gap: 5 }}>
															{swatches.slice(0, 3).map((c: string, i: number) => (
																<View key={`${preset.id}-${i}`} style={{ flex: 1, height: 20, borderRadius: 7, backgroundColor: c, borderWidth: 1, borderColor: inputBorder }} />
															))}
														</View>
														<Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: active ? RED : textMain }}>
															{preset.label}
														</Text>
														<Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: effectivePremium ? textDim : theme.gold }}>
															{effectivePremium ? (active ? 'AKTYWNY' : 'PRESET') : 'PREMIUM'}
														</Text>
													</TouchableOpacity>
												);
											})}
										</View>
									</View>
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
									onPress={() => {
										if (!effectivePremium) {
											Toast.show({ type: 'info', text1: 'VROOM Premium', text2: 'Edycja własnych kolorów wymaga Premium.' });
											router.push('/premium');
											return;
										}
										setThemeEditorVisible(true);
									}}
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
					</SettingsCard>

					</>)}

					{activeSettingsTab === 'profile' && (<>
					<SettingsSectionLabel isDark={isDark} title='PREMIUM PERSONALIZACJA' />
					<SettingsCard {...settingsCardProps}>
						{!effectivePremium ? (
							<SettingsRow {...settingsRowProps}
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
										Baner profilu
									</Text>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim }}>
										Wybierz zdjęcie — otworzy się edytor z podglądem jak na profilu.
									</Text>
									{profile?.bannerUrl ? (
										<ProfileHeroBannerFrame
											uri={profile.bannerUrl}
											focusPoint={premiumExtras.bannerFocusPoint ?? 'center'}
											fixedHeight={getHeroBannerHeight() * 0.38}
											style={{ borderRadius: 12, borderWidth: 1, borderColor: inputBorder }}
										/>
									) : (
										<View
											style={{
												width: '100%',
												height: getHeroBannerHeight() * 0.38,
												borderRadius: 12,
												borderWidth: 1,
												borderColor: inputBorder,
												backgroundColor: rowAlt,
												alignItems: 'center',
												justifyContent: 'center',
											}}>
											<MaterialCommunityIcons name="image-outline" size={28} color={textDim} />
											<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, marginTop: 6 }}>
												Brak banera
											</Text>
										</View>
									)}
									<Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: textMain }}>
										Punkt kadrowania (Focus)
									</Text>
									<View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
										{BANNER_FOCUS_OPTIONS.map(({ key, label }) => (
											<TouchableOpacity
												key={key}
												onPress={() => void handleBannerFocusChange(key)}
												style={{
													paddingHorizontal: 10,
													paddingVertical: 7,
													borderRadius: 10,
													borderWidth: 1,
													borderColor:
														(premiumExtras.bannerFocusPoint ?? 'center') === key ? RED : inputBorder,
													backgroundColor:
														(premiumExtras.bannerFocusPoint ?? 'center') === key ? RED + '22' : rowAlt,
												}}>
												<Text
													style={{
														fontFamily: 'Orbitron',
														fontSize: 8,
														color: (premiumExtras.bannerFocusPoint ?? 'center') === key ? RED : textDim,
													}}>
													{label}
												</Text>
											</TouchableOpacity>
										))}
									</View>
									<View style={{ flexDirection: 'row', gap: 8 }}>
										<TouchableOpacity
											onPress={() => void pickBannerForPreview()}
											disabled={bannerUploadBusy}
											style={{
												flex: 1,
												backgroundColor: RED,
												borderRadius: 10,
												paddingVertical: 12,
												alignItems: 'center',
												opacity: bannerUploadBusy ? 0.6 : 1,
											}}>
											{bannerUploadBusy ? (
												<ActivityIndicator color="#fff" size="small" />
											) : (
												<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>
													{profile?.bannerUrl ? 'ZMIEN BANER' : 'WGRAJ BANER'}
												</Text>
											)}
										</TouchableOpacity>
										{profile?.bannerUrl ? (
											<TouchableOpacity
												onPress={() => void handleDeleteBanner()}
												disabled={bannerUploadBusy}
												style={{
													paddingHorizontal: 14,
													borderRadius: 10,
													borderWidth: 1,
													borderColor: inputBorder,
													backgroundColor: rowAlt,
													justifyContent: 'center',
													opacity: bannerUploadBusy ? 0.6 : 1,
												}}>
												<MaterialIcons name="delete-outline" size={20} color={RED} />
											</TouchableOpacity>
										) : null}
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
												void persistPremiumExtras(
													{ customHeroGradient: buildTwoColorGradient(heroC1, heroC2) },
													{ setCustomTheme: true, okMessage: 'Gradient tła zapisany' },
												)
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
													void persistPremiumExtras(
														{ sectionAccentGradient: buildTwoColorGradient(accG1, accG2, true) },
														{ okMessage: 'Gradient nagłówków zapisany' },
													)
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
													void persistPremiumExtras(
														{ sectionAccentSolid: normalizePickerHex(accSolid) },
														{ okMessage: 'Kolor nagłówków zapisany' },
													)
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
												void persistPremiumExtras(
													{
														avatarRingGradient: {
															colors: [ringC1, ringC2, ringC3].map(normalizePickerHex),
															start: { x: 0, y: 0 },
															end: { x: 1, y: 1 },
														},
													},
													{ okMessage: 'Pierścień avatara zapisany' },
												)
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
									<ProfileAnimationSettingsPreview
										heroMotion={premiumExtras.heroMotion}
										visitEntranceAnim={premiumExtras.visitEntranceAnim}
										customHeroGradient={premiumExtras.customHeroGradient}
										bannerUri={profile?.bannerUrl ?? null}
										isDark={isDark}
										textMain={textMain}
										textDim={textDim}
										accent={RED}
										inputBorder={inputBorder}
									/>
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
										{PROFILE_VISIT_ENTRANCE_ANIMS.map(a => (
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
													{VISIT_ENTRANCE_LABELS[a]}
												</Text>
											</TouchableOpacity>
										))}
									</View>
									{(settings.globalPremiumAnimations ?? []).filter(a => a.category === 'entrance_effect').length > 0 && (
										<View style={{ gap: 8 }}>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, letterSpacing: 1 }}>
												ANIMACJE Z PANELU ADMINA
											</Text>
											<View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
												{(settings.globalPremiumAnimations ?? []).filter(a => a.category === 'entrance_effect').map(a => {
													const active = premiumExtras.globalEntranceAnimationId === a.id;
													return (
														<TouchableOpacity
															key={a.id}
															onPress={() =>
																updateSetting('profilePremiumExtras', {
																	...premiumExtras,
																	globalEntranceAnimationId: active ? null : a.id,
																} as ProfilePremiumExtras)
															}
															style={{
																paddingHorizontal: 10,
																paddingVertical: 7,
																borderRadius: 10,
																borderWidth: 1,
																borderColor: active ? RED : inputBorder,
																backgroundColor: active ? RED + '22' : rowAlt,
															}}>
															<Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: active ? RED : textDim }}>
																{a.name.toUpperCase()}
															</Text>
														</TouchableOpacity>
													);
												})}
											</View>
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
								<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 8 }}>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
										Animacja tła profilu (ty)
									</Text>
									<View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
										{PROFILE_HERO_MOTIONS.map(a => (
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
													{HERO_MOTION_LABELS[a]}
												</Text>
											</TouchableOpacity>
										))}
									</View>
									{(settings.globalPremiumAnimations ?? []).filter(a => a.category === 'profile_background_animation').length > 0 && (
										<View style={{ gap: 8 }}>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, letterSpacing: 1 }}>
												TŁA Z PANELU ADMINA
											</Text>
											<View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
												{(settings.globalPremiumAnimations ?? []).filter(a => a.category === 'profile_background_animation').map(a => {
													const active = premiumExtras.globalBackgroundAnimationId === a.id;
													return (
														<TouchableOpacity
															key={a.id}
															onPress={() =>
																updateSetting('profilePremiumExtras', {
																	...premiumExtras,
																	globalBackgroundAnimationId: active ? null : a.id,
																} as ProfilePremiumExtras)
															}
															style={{
																paddingHorizontal: 10,
																paddingVertical: 7,
																borderRadius: 10,
																borderWidth: 1,
																borderColor: active ? RED : inputBorder,
																backgroundColor: active ? RED + '22' : rowAlt,
															}}>
															<Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: active ? RED : textDim }}>
																{a.name.toUpperCase()}
															</Text>
														</TouchableOpacity>
													);
												})}
											</View>
										</View>
									)}
								</View>
							</>
						)}
					</SettingsCard>

					<View style={{ marginTop: 10 }}>
						<SettingsCard {...settingsCardProps}>
							<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
								<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
									Muzyka w profilu
								</Text>
								<ProfileMusicSearchField
									apiUrl={API_URL}
									onPickTrack={pickProfileTrackFromSearch}
									saving={spotifySaving}
									textMain={textMain}
									textDim={textDim}
									inputBg={inputBg}
									inputBorder={inputBorder}
									rowAlt={rowAlt}
								/>
								<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, marginTop: 4 }}>
									Alternatywnie Spotify: Udostępnij → Kopiuj link utworu.
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
									<SpotifyProfileTrackRow
										track={settings.spotifyProfileTrack}
										theme={{ text: textMain, textDim, surface: rowAlt, border: inputBorder }}
										embedded
									/>
								)}
								{!!settings.spotifyProfileTrack?.trackId && (
									<TouchableOpacity
										onPress={() => setProfileMusicTrimOpen(true)}
										style={{
											flexDirection: 'row',
											alignItems: 'center',
											justifyContent: 'center',
											gap: 8,
											marginTop: 10,
											paddingVertical: 12,
											borderRadius: 12,
											backgroundColor: '#1DB95422',
											borderWidth: 1,
											borderColor: '#1DB95455',
										}}>
										<MaterialIcons name="content-cut" size={18} color="#1DB954" />
										<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#1DB954', fontWeight: '700' }}>
											PRZYTNij UTWÓR
											{(settings.spotifyProfileTrack.previewStartMs ?? 0) > 0
												? ` · od ${Math.round((settings.spotifyProfileTrack.previewStartMs ?? 0) / 1000)}s`
												: ''}
										</Text>
									</TouchableOpacity>
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
						</SettingsCard>
					</View>

					{/* IKONA LOKALIZACJI */}
					<View style={{ marginTop: 10 }}>
						<SettingsCard {...settingsCardProps}>
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
								<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
									{MARKER_STYLES.filter(
										(opt) => !opt.requiresVehicle || !!equippedMapVehicle,
									).map(opt => (
										<TouchableOpacity
											key={opt.key}
											style={{
												flex: 1,
												minWidth: "30%",
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
						</SettingsCard>
					</View>

					<View style={{ marginTop: 10 }}>
						<SettingsCard {...settingsCardProps}>
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
						</SettingsCard>
					</View>

					</>)}

					{activeSettingsTab === 'account' && (<>
					{/* KONTO */}
					<SettingsSectionLabel isDark={isDark} title='KONTO' />
					<SettingsCard {...settingsCardProps}>
						<SettingsRow {...settingsRowProps}
							icon='person-outline'
							iconBg={RED}
							label='Edytuj profil'
							sublabel='Zmień avatar, bio, lokalizację'
							onPress={() => router.push("/profile/edit")}
						/>
						<SettingsRow {...settingsRowProps}
							icon='lock-outline'
							iconBg={RED}
							label='Zmień hasło'
							sublabel='Zaktualizuj hasło do konta'
							onPress={() => router.push("/profile/change-password")}
						/>
						<SettingsRow {...settingsRowProps}
							icon='email'
							iconBg={RED}
							label='Zmień e-mail'
							sublabel='Zaktualizuj adres e-mail'
							onPress={() => router.push("/profile/change-email")}
						/>
						<SettingsRow {...settingsRowProps}
							icon='card-giftcard'
							iconBg='#f5b942'
							label='Moje korzyści'
							sublabel='Kupony i wydarzenia partnerów VROOM'
							onPress={() => router.push('/profile/benefits' as any)}
							last
						/>
					</SettingsCard>

					<SettingsSectionLabel isDark={isDark} title='POLECENIA / REF LINK' />
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

					<SettingsSectionLabel isDark={isDark} title='MATERIALY PROMOCYJNE' />
					<View style={{ backgroundColor: cardBg, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: cardBorder }}>
						<View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 12 }}>
							<Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>
								Baner z kodem VROOM
							</Text>
							<View style={{ flexDirection: 'row', gap: 8 }}>
								{REFERRAL_PROMO_FORMATS.map((item) => {
									const selected = promoFormat === item.key;
									return (
										<TouchableOpacity
											key={item.key}
											onPress={() => setPromoFormat(item.key)}
											style={{
												flex: 1,
												borderRadius: 10,
												borderWidth: 1,
												borderColor: selected ? RED : inputBorder,
												backgroundColor: selected ? '#e3383522' : rowAlt,
												paddingVertical: 10,
												alignItems: 'center',
											}}>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: selected ? RED : textMain, fontWeight: '800' }}>
												{item.label}
											</Text>
											<Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: textDim, marginTop: 3 }}>
												{item.hint}
											</Text>
										</TouchableOpacity>
									);
								})}
							</View>

							<View style={{ flexDirection: 'row', gap: 8 }}>
								<TouchableOpacity
									onPress={() => setPromoPreviewMode('mp4')}
									style={{
										flex: 1,
										borderRadius: 10,
										borderWidth: 1,
										borderColor: promoPreviewMode === 'mp4' ? '#4de92670' : inputBorder,
										backgroundColor: promoPreviewMode === 'mp4' ? '#4de92616' : rowAlt,
										paddingVertical: 10,
										alignItems: 'center',
									}}>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: promoPreviewMode === 'mp4' ? '#4de926' : textDim, fontWeight: '800' }}>
										PODGLAD MP4
									</Text>
								</TouchableOpacity>
								<TouchableOpacity
									onPress={() => setPromoPreviewMode('png')}
									style={{
										flex: 1,
										borderRadius: 10,
										borderWidth: 1,
										borderColor: promoPreviewMode === 'png' ? RED : inputBorder,
										backgroundColor: promoPreviewMode === 'png' ? '#e3383522' : rowAlt,
										paddingVertical: 10,
										alignItems: 'center',
									}}>
									<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: promoPreviewMode === 'png' ? RED : textDim, fontWeight: '800' }}>
										PODGLAD PNG
									</Text>
								</TouchableOpacity>
							</View>

							<View style={{
								borderRadius: 14,
								overflow: 'hidden',
								borderWidth: 1,
								borderColor: inputBorder,
								backgroundColor: '#08090f',
								aspectRatio: promoFormat === 'story' ? 9 / 16 : promoFormat === 'post' ? 1 : 1200 / 628,
							}}>
								{promoPreviewMode === 'mp4' && promoVideoPreviewUrl ? (
									<Video
										key={promoVideoPreviewUrl}
										source={{ uri: promoVideoPreviewUrl }}
										style={{ width: '100%', height: '100%' }}
										resizeMode={ResizeMode.COVER}
										shouldPlay
										isLooping
										isMuted
									/>
								) : promoPreviewMode === 'png' && promoPreviewUrl ? (
									<Image
										source={{ uri: promoPreviewUrl }}
										style={{ width: '100%', height: '100%' }}
										resizeMode="cover"
									/>
								) : (
									<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
										<MaterialCommunityIcons name={promoPreviewMode === 'mp4' ? 'movie-open-play-outline' : 'image-refresh-outline'} size={26} color={textDim} />
										<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, marginTop: 8, textAlign: 'center' }}>
											Podglad pojawi sie po odswiezeniu kodu
										</Text>
									</View>
								)}
							</View>

							<View style={{ flexDirection: 'row', gap: 8 }}>
								<TouchableOpacity
									onPress={() => openReferralPromoDownload('png')}
									disabled={!!promoBusy || refSaving || refLoading}
									style={{
										flex: 1,
										backgroundColor: RED,
										borderRadius: 10,
										paddingVertical: 12,
										alignItems: 'center',
										opacity: promoBusy || refSaving || refLoading ? 0.6 : 1,
									}}>
									{promoBusy === 'png' ? (
										<ActivityIndicator size={14} color="#fff" />
									) : (
										<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '800' }}>
											POBIERZ PNG
										</Text>
									)}
								</TouchableOpacity>
								<TouchableOpacity
									onPress={() => openReferralPromoDownload('mp4')}
									disabled={!!promoBusy || refSaving || refLoading}
									style={{
										flex: 1,
										borderRadius: 10,
										borderWidth: 1,
										borderColor: '#4de92650',
										backgroundColor: '#4de92618',
										paddingVertical: 12,
										alignItems: 'center',
										opacity: promoBusy || refSaving || refLoading ? 0.6 : 1,
									}}>
									{promoBusy === 'mp4' ? (
										<ActivityIndicator size={14} color="#4de926" />
									) : (
										<Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#4de926', fontWeight: '800' }}>
											POBIERZ MP4
										</Text>
									)}
								</TouchableOpacity>
							</View>
						</View>
					</View>

					</>)}

					{activeSettingsTab === 'privacy' && (<>
					{/* PRYWATNOŚĆ */}
					<SettingsSectionLabel isDark={isDark} title='PRYWATNOŚĆ' />
					<SettingsCard {...settingsCardProps}>
						<SettingsRow {...settingsRowProps}
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
						<SettingsRow {...settingsRowProps}
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
						<SettingsRow {...settingsRowProps}
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
					</SettingsCard>

					</>)}

					{activeSettingsTab === 'notifications' && (<>
					{/* POWIADOMIENIA */}
					<SettingsSectionLabel isDark={isDark} title='POWIADOMIENIA' />
					<SettingsCard {...settingsCardProps}>
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
							<SettingsRow {...settingsRowProps}
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
					</SettingsCard>

					</>)}

					{activeSettingsTab === 'app' && (<>
					{/* APLIKACJA */}
					<SettingsSectionLabel isDark={isDark} title='APLIKACJA' />
					<SettingsCard {...settingsCardProps}>
						<SettingsRow {...settingsRowProps}
							icon='directions-run'
							iconBg='#4CAF50'
							label='Praca w tle'
							sublabel={effectivePremium
								? 'Zlicza km i statystyki jazdy po zminimalizowaniu aplikacji'
								: 'Premium — statystyki km w tle podczas jazdy'}
							right={
								<Switch
									value={settings.backgroundTracking && effectivePremium}
									onValueChange={toggleBgTracking}
									disabled={!effectivePremium}
									{...swProps}
								/>
							}
						/>
						<SettingsRow {...settingsRowProps}
							icon='navigation'
							iconBg='#e33835'
							label='Skórka kursora'
							sublabel={activeSkin?.name ?? 'Domyślna'}
							onPress={() => setCursorSkinModalVisible(true)}
						/>
						<SettingsRow {...settingsRowProps}
							icon='movie-filter'
							iconBg='#9C27B0'
							label='Animacje wejścia'
							sublabel={entranceMotionLabel}
							onPress={() => { void cycleEntranceMotion(); }}
						/>
						<SettingsRow {...settingsRowProps}
							icon='school'
							iconBg='#2196F3'
							label='Przewodnik po aplikacji'
							sublabel='Pokaż tutorial od początku'
							onPress={startTutorialReplay}
						/>
						<SettingsRow {...settingsRowProps}
							icon='workspace-premium'
							iconBg='#FFD700'
							label='VROOM Premium'
							sublabel={effectivePremium ? 'Zarządzaj subskrypcją i korzyściami' : 'Subskrypcja i korzyści'}
							onPress={() => router.push('/premium')}
						/>
						<SettingsRow {...settingsRowProps}
							icon='system-update'
							iconBg='#4CAF50'
							label='Sprawdź aktualizację'
							sublabel={otaSublabel}
							onPress={handleCheckAppUpdate}
							right={(otaChecking || otaDownloading) ? (
								<ActivityIndicator color={RED} size="small" />
							) : undefined}
						/>
						<SettingsRow {...settingsRowProps}
							icon='info-outline'
							iconBg='#607D8B'
							label='O aplikacji'
							sublabel='VROOM V1.0.23'
							onPress={() =>
								Toast.show({
									type: "info",
									text1: "🚗 VROOM V1.0.23",
									text2: "Made with ❤️ for car enthusiasts",
								})
							}
						/>
						<SettingsRow {...settingsRowProps}
							icon='bug-report'
							iconBg='#FF5722'
							label='Zgłoś błąd'
							sublabel='Pomóż nam ulepszyć aplikację'
							onPress={() => setBugModal(true)}
						/>
						<SettingsRow {...settingsRowProps}
							icon='forum'
							iconBg='#2196F3'
							label='Moje zgłoszenia'
							sublabel='Status, odpowiedzi supportu, czat'
							onPress={() => router.push('/profile/bug-reports')}
						/>
						<SettingsRow {...settingsRowProps}
							icon='star-outline'
							iconBg='#FFC107'
							label='Oceń aplikację'
							sublabel='Zostaw opinię w sklepie'
							last
							onPress={() => Toast.show({ type: "info", text1: "WKRÓTCE" })}
						/>
					</SettingsCard>

					</>)}

					{activeSettingsTab === 'session' && (<>
					{/* SESJA */}
					<SettingsSectionLabel isDark={isDark} title='SESJA' />
					<SettingsCard {...settingsCardProps}>
						<SettingsRow {...settingsRowProps}
							icon='logout'
							iconBg='#FF9800'
							label='Wyloguj się'
							sublabel='Wróć do ekranu logowania'
							last
							onPress={() => setLogoutModal(true)}
						/>
					</SettingsCard>

					{/* STREFA NIEBEZPIECZNA */}
					<SettingsSectionLabel isDark={isDark} title='STREFA NIEBEZPIECZNA' />
					<SettingsCard danger {...settingsCardProps}>
						<SettingsRow {...settingsRowProps}
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
					</SettingsCard>

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
								VROOM OS V1.0.23
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
					</>)}
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
				<KeyboardAvoidingView
					style={{
						flex: 1,
						backgroundColor: overlayBg,
						justifyContent: "center",
						alignItems: "center",
						padding: 20,
						paddingBottom: deleteKeyboardInset > 0 ? deleteKeyboardInset + 20 : 20,
					}}
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					enabled={Platform.OS === 'ios'}
				>
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
				</KeyboardAvoidingView>
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

			<Modal
				visible={cursorSkinModalVisible}
				transparent
				animationType="slide"
				onRequestClose={() => setCursorSkinModalVisible(false)}
			>
				<View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
					<View style={{
						backgroundColor: cardBg,
						borderTopLeftRadius: 18,
						borderTopRightRadius: 18,
						paddingBottom: insets.bottom + 16,
						maxHeight: '70%',
					}}>
						<View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: cardBorder }}>
							<Text style={{ fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900', color: textMain }}>
								SKÓRKA KURSORA
							</Text>
							<Text style={{ color: textMuted, fontSize: 11, marginTop: 4 }}>
								Wyświetlana na mapie podczas jazdy
							</Text>
						</View>
						<ScrollView style={{ paddingHorizontal: 12 }}>
							{cursorSkins.map((skin) => {
								const locked = !skin.unlocked;
								const selected = activeSkin?.id === skin.id;
								return (
									<TouchableOpacity
										key={skin.id}
										disabled={locked}
										onPress={async () => {
											const ok = await setActiveSkinId(skin.id);
											if (!ok) {
												if (skin.requiresPremium && !effectivePremium) {
													Toast.show({ type: 'info', text1: 'Wymaga Premium' });
													router.push('/premium');
												} else {
													Toast.show({ type: 'error', text1: 'Nie udało się wybrać skórki' });
												}
												return;
											}
											Toast.show({ type: 'success', text1: skin.name });
											setCursorSkinModalVisible(false);
										}}
										style={{
											flexDirection: 'row',
											alignItems: 'center',
											paddingVertical: 12,
											paddingHorizontal: 8,
											opacity: locked ? 0.45 : 1,
											borderBottomWidth: 1,
											borderBottomColor: cardBorder,
										}}
									>
										<View style={{
											width: 36,
											height: 36,
											borderRadius: 18,
											borderWidth: 2,
											borderColor: skin.borderColor,
											backgroundColor: rowAlt,
											marginRight: 12,
										}} />
										<View style={{ flex: 1 }}>
											<Text style={{ color: textMain, fontWeight: '700' }}>{skin.name}</Text>
											<Text style={{ color: textMuted, fontSize: 10 }}>
												{locked
													? (skin.requiresPremium ? 'Premium' : 'Zablokowane')
													: (selected ? 'Aktywna' : 'Dostępna')}
											</Text>
										</View>
										{selected ? (
											<MaterialIcons name="check-circle" size={22} color={RED} />
										) : null}
									</TouchableOpacity>
								);
							})}
						</ScrollView>
						<TouchableOpacity
							onPress={() => setCursorSkinModalVisible(false)}
							style={{ margin: 16, padding: 12, alignItems: 'center' }}
						>
							<Text style={{ color: textMuted, fontWeight: '700' }}>Zamknij</Text>
						</TouchableOpacity>
					</View>
				</View>
			</Modal>

			<ProfileBannerCropModal
				visible={bannerPreviewVisible}
				imageUri={bannerPreviewUri}
				imageWidth={bannerPreviewSize?.w}
				imageHeight={bannerPreviewSize?.h}
				themeBg={theme.bg}
				busy={bannerUploadBusy}
				onClose={() => {
					if (bannerUploadBusy) return;
					setBannerPreviewVisible(false);
					setBannerPreviewUri(null);
					setBannerPreviewSize(null);
				}}
				onConfirm={handleBannerCropConfirm}
			/>

			{!!settings.spotifyProfileTrack?.trackId && (
				<MusicTrimSheet
					visible={profileMusicTrimOpen}
					title={settings.spotifyProfileTrack.trackName}
					trackLabel={settings.spotifyProfileTrack.artistName ?? ''}
					audioUrl={settings.spotifyProfileTrack.previewUrl}
					resolveAudioUrl={resolveProfileTrimAudio}
					sourceType={settings.spotifyProfileTrack.sourceType ?? 'deezer'}
					startMs={settings.spotifyProfileTrack.previewStartMs ?? 0}
					trackDurationMs={
						isFullTrackSource(settings.spotifyProfileTrack.sourceType)
							? (settings.spotifyProfileTrack.durationMs ?? 120000)
							: PREVIEW_CLIP_MS
					}
					fullSongDurationMs={settings.spotifyProfileTrack.durationMs ?? null}
					selectionDurationMs={defaultTrimSelectionMs(settings.spotifyProfileTrack.sourceType)}
					accent="#1DB954"
					onCancel={() => setProfileMusicTrimOpen(false)}
					onConfirm={(ms) => {
						void handleProfilePreviewStart(ms);
						setProfileMusicTrimOpen(false);
					}}
				/>
			)}
		</>
	);
}
