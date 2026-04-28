import React, { useState } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Switch, Modal, Image,
  Dimensions,
} from 'react-native';
import { Text }         from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter }    from 'expo-router';
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
import { ThemeMode }    from '../../constants/theme';
import { CustomThemeEditor } from '../../components/settings/CustomThemeEditor';
import { BACKGROUND_LOCATION_TASK } from '../../hooks/useBackgroundTracking';

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
const PROFILE_PRESETS = ['default', 'midnight', 'sunset', 'neon'] as const;
const FRAME_PRESETS = ['vroom', 'sunrise', 'ocean', 'lime'] as const;

export default function SettingsScreen() {
  const router = useRouter();
  const { theme, isDark, mode, setMode } = useTheme();
  const { settings, loading: settingsLoading, updateSetting } = useSettings();

  // ── Kolory zależne od motywu ───────────────────────────
  const bg        = isDark ? '#090909'   : '#f0f2f5';
  const cardBg    = isDark ? '#141414'   : '#ffffff';
  const cardBorder= isDark ? '#ffffff0a' : '#00000010';
  const rowAlt    = isDark ? '#1a1a1a'   : '#f8f8f8';
  const divider   = isDark ? '#ffffff07' : '#00000008';
  const textMain  = isDark ? '#ffffff'   : '#0a0a0a';
  const textDim   = isDark ? '#ffffff35' : '#00000045';
  const textMuted = isDark ? '#ffffff50' : '#00000060';
  const overlayBg = isDark ? '#000000cc' : '#00000088';
  const inputBg   = isDark ? '#1a1a1a'   : '#f0f0f0';
  const inputBorder= isDark ? '#ffffff10': '#00000015';
  const cancelBg  = isDark ? '#1a1a1a'   : '#ececec';
  const cancelBorder= isDark? '#ffffff10': '#00000012';
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
  const [themeEditorVisible, setThemeEditorVisible] = useState(false);
  const [deleteConfirm,      setDeleteConfirm]      = useState('');
  const [deleteLoading,      setDeleteLoading]      = useState(false);
  const [bugLoading,         setBugLoading]         = useState(false);
  const [bugCategory,        setBugCategory]        = useState('');
  const [bugDescription,     setBugDescription]     = useState('');
  const [bugPhotos,          setBugPhotos]          = useState<string[]>([]);

  // ── Helpers ────────────────────────────────────────────
  const toggleBgTracking = async (val: boolean) => {
    await updateSetting('backgroundTracking', val);
    if (!val) {
      const isRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRunning) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      Toast.show({ type: 'info', text1: '📍 Śledzenie w tle wyłączone' });
    } else {
      Toast.show({ type: 'success', text1: '📍 Śledzenie w tle włączone' });
    }
  };

  const handleLogout = async () => {
    setLogoutModal(false);
    await AsyncStorage.multiRemove(['userToken', 'token', 'user', 'app_settings']);
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
      if (!res.ok) throw new Error();
      setBugModal(false); setBugCategory(''); setBugDescription(''); setBugPhotos([]);
      Toast.show({ type: 'success', text1: '🐛 ZGŁOSZENIE WYSŁANE' });
    } catch { Toast.show({ type: 'error', text1: 'Błąd wysyłania zgłoszenia' }); }
    finally { setBugLoading(false); }
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
      <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>

        {/* ══ HERO ══ */}
        <View style={{ height: 180, position: 'relative', overflow: 'hidden', marginBottom: -20 }}>
          <LinearGradient colors={heroGrad} start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: RED + '10', borderWidth: 1, borderColor: RED + '18' }} />
          <View style={{ position: 'absolute', top: -10, right: -10, width: 110, height: 110, borderRadius: 55, backgroundColor: RED + '15' }} />
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * 30, height: 1, backgroundColor: scanLine }} />
          ))}
          {/* HUD corners */}
          <View style={{ position: 'absolute', top: 20, left: 20 }}>
            <View style={{ width: 16, height: 2, backgroundColor: RED, opacity: 0.5 }} />
            <View style={{ position: 'absolute', top: 0, left: 0, width: 2, height: 16, backgroundColor: RED, opacity: 0.5 }} />
          </View>
          <View style={{ position: 'absolute', top: 20, right: 20, alignItems: 'flex-end' }}>
            <View style={{ width: 16, height: 2, backgroundColor: RED, opacity: 0.5 }} />
            <View style={{ position: 'absolute', top: 0, right: 0, width: 2, height: 16, backgroundColor: RED, opacity: 0.5 }} />
          </View>
          {/* Nav */}
          <View style={{ position: 'absolute', top: 52, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <TouchableOpacity style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: isDark ? '#ffffff10' : '#00000010', borderWidth: 1, borderColor: isDark ? '#ffffff15' : '#00000015', alignItems: 'center', justifyContent: 'center' }} onPress={() => router.back()}>
              <MaterialIcons name="arrow-back" size={20} color={textMain} />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: isDark ? '#ffffff08' : '#00000008', borderWidth: 1, borderColor: isDark ? '#ffffff12' : '#00000012', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 }}>
              <View style={{ backgroundColor: RED, borderRadius: 6, padding: 4 }}>
                <MaterialCommunityIcons name="car-sports" size={11} color="#fff" />
              </View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: textMain, fontWeight: '900', letterSpacing: 3 }}>VROOM</Text>
            </View>
            <View style={{ width: 38 }} />
          </View>
          {/* Title */}
          <View style={{ position: 'absolute', bottom: 36, left: 20 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: RED, letterSpacing: 4, marginBottom: 4 }}>PANEL UŻYTKOWNIKA</Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 28, color: textMain, fontWeight: '900', letterSpacing: 1 }}>USTAWIENIA</Text>
          </View>
          <LinearGradient colors={['transparent', bg]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60 }} />
        </View>

        {/* ══ CONTENT ══ */}
        <View style={{ paddingHorizontal: 20 }}>

          {/* WYGLĄD */}
          <SectionLabel title="WYGLĄD" />
          <Card>
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: '#9C27B020', borderWidth: 1, borderColor: '#9C27B030', justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name="palette" size={17} color="#9C27B0" />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: textMain, fontWeight: '600' }}>Motyw aplikacji</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: textDim, marginTop: 3 }}>
                    Aktywny: {THEME_OPTIONS.find(o => o.key === mode)?.label ?? '—'}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {THEME_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: 12, borderWidth: 1, backgroundColor: mode === opt.key ? opt.color + '20' : rowAlt, borderColor: mode === opt.key ? opt.color + '60' : inputBorder }}
                    onPress={() => setMode(opt.key)}
                  >
                    <MaterialIcons name={opt.icon as any} size={13} color={mode === opt.key ? opt.color : textDim} />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: mode === opt.key ? opt.color : textDim, letterSpacing: 0.5 }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {mode === 'custom' && (
              <>
                <View style={{ height: 1, backgroundColor: divider, marginLeft: 64 }} />
                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 }} onPress={() => setThemeEditorVisible(true)} activeOpacity={0.7}>
                  <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: '#2196F320', borderWidth: 1, borderColor: '#2196F330', justifyContent: 'center', alignItems: 'center' }}>
                    <MaterialIcons name="color-lens" size={17} color="#2196F3" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: textMain, fontWeight: '600' }}>Edytuj własne kolory</Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: textDim, marginTop: 3 }}>Dostosuj każdy kolor aplikacji</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={18} color={textDim} />
                </TouchableOpacity>
              </>
            )}
          </Card>

          <SectionLabel title="PREMIUM PERSONALIZACJA" />
          <Card>
            {!settings.isPremium ? (
              <Row
                icon="workspace-premium"
                iconBg="#FFD700"
                label="Dostępne w Premium"
                sublabel="Nick color, motyw profilu, ramka avatara i sync motywu konta."
                last
              />
            ) : (
              <>
                <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>Kolor nicku</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {NICK_COLORS.map(c => (
                      <TouchableOpacity key={c} onPress={() => updateSetting('nickColor', c)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: 2, borderColor: settings.nickColor === c ? RED : inputBorder }} />
                    ))}
                  </View>
                </View>
                <View style={{ height: 1, backgroundColor: divider, marginLeft: 16, marginRight: 16 }} />
                <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>Motyw profilu</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {PROFILE_PRESETS.map(p => (
                      <TouchableOpacity key={p} onPress={() => updateSetting('profileThemePreset', p)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: settings.profileThemePreset === p ? RED : inputBorder, backgroundColor: settings.profileThemePreset === p ? RED + '22' : rowAlt }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: settings.profileThemePreset === p ? RED : textDim }}>{p.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={{ height: 1, backgroundColor: divider, marginLeft: 16, marginRight: 16 }} />
                <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: textMain }}>Ramka avatara</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {FRAME_PRESETS.map(p => (
                      <TouchableOpacity key={p} onPress={() => updateSetting('avatarFramePreset', p)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: settings.avatarFramePreset === p ? RED : inputBorder, backgroundColor: settings.avatarFramePreset === p ? RED + '22' : rowAlt }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: settings.avatarFramePreset === p ? RED : textDim }}>{p.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            )}
          </Card>

          {/* IKONA LOKALIZACJI */}
          <Card>
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: RED + '20', borderWidth: 1, borderColor: RED + '30', justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name="navigation" size={17} color={RED} />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: textMain, fontWeight: '600' }}>Ikona lokalizacji</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: textDim, marginTop: 3 }}>
                    Aktywna: {MARKER_STYLES.find(o => o.key === settings.locationMarkerStyle)?.label ?? '—'}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {MARKER_STYLES.map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: 12, borderWidth: 1, backgroundColor: settings.locationMarkerStyle === opt.key ? RED + '20' : rowAlt, borderColor: settings.locationMarkerStyle === opt.key ? RED + '60' : inputBorder }}
                    onPress={() => updateSetting('locationMarkerStyle', opt.key)}
                  >
                    <MaterialIcons name={opt.icon as any} size={13} color={settings.locationMarkerStyle === opt.key ? RED : textDim} />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: settings.locationMarkerStyle === opt.key ? RED : textDim, letterSpacing: 0.5 }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Card>

          {/* KONTO */}
          <SectionLabel title="KONTO" />
          <Card>
            <Row icon="person-outline" iconBg={RED} label="Edytuj profil"  sublabel="Zmień avatar, bio, lokalizację"  onPress={() => router.push('/profile/edit')} />
            <Row icon="lock-outline"   iconBg={RED} label="Zmień hasło"    sublabel="Zaktualizuj hasło do konta"       onPress={() => router.push('/profile/change-password')} />
            <Row icon="email"          iconBg={RED} label="Zmień e-mail"   sublabel="Zaktualizuj adres e-mail"         onPress={() => router.push('/profile/change-email')} last />
          </Card>

          {/* PRYWATNOŚĆ */}
          <SectionLabel title="PRYWATNOŚĆ" />
          <Card>
            <Row icon="leaderboard"  iconBg="#9C27B0" label="Tryb prywatny"     sublabel="Ukryj swój profil w rankingu"           right={<Switch value={settings.privateProfile} onValueChange={v => updateSetting('privateProfile', v)} {...swProps} />} />
            <Row icon="location-off" iconBg="#FF9800" label="Ukryj lokalizację" sublabel="Nie pokazuj swojej pozycji na mapie"     right={<Switch value={settings.hideLocation}    onValueChange={v => updateSetting('hideLocation', v)}    {...swProps} />} />
            <Row icon="message"      iconBg="#9C27B0" label="Tylko znajomi mogą pisać" sublabel="Tylko znajomi mogą wysyłać Ci prywatne wiadomości" last right={<Switch value={settings.friendsOnlyMessages} onValueChange={v => updateSetting('friendsOnlyMessages', v)} {...swProps} />} />
          </Card>

          {/* POWIADOMIENIA */}
          <SectionLabel title="POWIADOMIENIA" />
          <Card>
            {([
              { icon: 'event',               iconBg: '#4CAF50', label: 'Nowe zloty',          sub: 'Powiadomienia o zlotach w okolicy',        key: 'notifMeets'        },
              { icon: 'favorite-outline',    iconBg: RED,       label: 'Lajki',               sub: 'Ktoś polubił Twój spot, auto lub post',    key: 'notifLikes'        },
              { icon: 'chat-bubble-outline', iconBg: '#2196F3', label: 'Komentarze',          sub: 'Nowy komentarz pod Twoim postem',          key: 'notifComments'     },
              { icon: 'message',             iconBg: '#9C27B0', label: 'Wiadomości',          sub: 'Nowa wiadomość na czacie',                 key: 'notifMessages'     },
              { icon: 'person-add',          iconBg: '#00BCD4', label: 'Znajomi',             sub: 'Zaproszenia i akceptacje znajomych',       key: 'notifFriends'      },
              { icon: 'emoji-events',        iconBg: '#FFC107', label: 'Osiągnięcia',         sub: 'Gdy odblokujesz nowe osiągnięcie',         key: 'notifAchievements' },
              { icon: 'warning-amber',       iconBg: '#FF9800', label: 'Ostrzeżenia drogowe', sub: 'Alert gdy jesteś blisko ostrzeżenia',      key: 'notifWarnings'     },
              { icon: 'visibility',          iconBg: '#4de926', label: 'Posty obserwowanych', sub: 'Nowy post od obserwowanego użytkownika',   key: 'notifFollowedPosts'},
            ] as const).map((item, i, arr) => (
              <Row key={item.key} icon={item.icon} iconBg={item.iconBg} label={item.label} sublabel={item.sub} last={i === arr.length - 1}
                right={<Switch value={(settings as any)[item.key]} onValueChange={v => updateSetting(item.key as any, v)} {...swProps} />}
              />
            ))}
          </Card>

          {/* APLIKACJA */}
          <SectionLabel title="APLIKACJA" />
          <Card>
            <Row icon="directions-run" iconBg="#4CAF50" label="Praca w tle"     sublabel="Liczenie km gdy aplikacja zamknięta"  right={<Switch value={settings.backgroundTracking} onValueChange={toggleBgTracking} {...swProps} />} />
            <Row icon="info-outline"   iconBg="#607D8B" label="O aplikacji"     sublabel="VROOM v1.0.0"                        onPress={() => Toast.show({ type: 'info', text1: '🚗 VROOM v1.0.0', text2: 'Made with ❤️ for car enthusiasts' })} />
            <Row icon="bug-report"     iconBg="#FF5722" label="Zgłoś błąd"      sublabel="Pomóż nam ulepszyć aplikację"        onPress={() => setBugModal(true)} />
            <Row icon="star-outline"   iconBg="#FFC107" label="Oceń aplikację"  sublabel="Zostaw opinię w sklepie"             last onPress={() => Toast.show({ type: 'info', text1: 'WKRÓTCE' })} />
          </Card>

          {/* SESJA */}
          <SectionLabel title="SESJA" />
          <Card>
            <Row icon="logout" iconBg="#FF9800" label="Wyloguj się" sublabel="Wróć do ekranu logowania" last onPress={() => setLogoutModal(true)} />
          </Card>

          {/* STREFA NIEBEZPIECZNA */}
          <SectionLabel title="STREFA NIEBEZPIECZNA" />
          <Card danger>
            <Row icon="delete-forever" label="Usuń konto" sublabel="Trwale usuwa konto i wszystkie dane" destructive last onPress={() => { setDeleteConfirm(''); setDeleteModal(true); }} />
          </Card>

          {/* Bottom badge */}
          <View style={{ alignItems: 'center', marginTop: 36, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#4de926' }} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, letterSpacing: 2 }}>VROOM OS v1.0</Text>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#4de926' }} />
            </View>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: textDim, letterSpacing: 1 }}>MADE FOR THOSE WHO NEVER STOP</Text>
          </View>
        </View>
      </ScrollView>

      {/* ══ MODAL WYLOGUJ ══ */}
      <Modal visible={logoutModal} transparent animationType="fade" onRequestClose={() => setLogoutModal(false)}>
        <View style={{ flex: 1, backgroundColor: overlayBg, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: cardBg, borderRadius: 22, padding: 26, width: '100%', borderWidth: 1, borderColor: cardBorder }}>
            <View style={{ width: 62, height: 62, borderRadius: 18, backgroundColor: '#FF980018', borderWidth: 1, borderColor: '#FF980030', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 18 }}>
              <MaterialIcons name="logout" size={30} color="#FF9800" />
            </View>
            <Text style={{ fontFamily: 'Orbitron', color: textMain, fontSize: 16, textAlign: 'center', marginBottom: 10, letterSpacing: 2, fontWeight: '900' }}>WYLOGUJ SIĘ</Text>
            <Text style={{ color: textMuted, fontSize: 13, lineHeight: 21, textAlign: 'center', marginBottom: 22 }}>Czy na pewno chcesz się wylogować z konta VROOM?</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: cancelBg, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: cancelBorder }} onPress={() => setLogoutModal(false)}>
                <Text style={{ fontFamily: 'Orbitron', color: textMuted, fontSize: 11 }}>ANULUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: '#FF9800', borderRadius: 14, paddingVertical: 14, alignItems: 'center' }} onPress={handleLogout}>
                <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11, fontWeight: '900' }}>WYLOGUJ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══ MODAL USUŃ KONTO ══ */}
      <Modal visible={deleteModal} transparent animationType="fade" onRequestClose={() => setDeleteModal(false)}>
        <View style={{ flex: 1, backgroundColor: overlayBg, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: cardBg, borderRadius: 22, padding: 26, width: '100%', borderWidth: 1, borderColor: RED + '25' }}>
            <View style={{ width: 62, height: 62, borderRadius: 18, backgroundColor: RED + '15', borderWidth: 1, borderColor: RED + '30', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 18 }}>
              <MaterialIcons name="delete-forever" size={30} color={RED} />
            </View>
            <Text style={{ fontFamily: 'Orbitron', color: RED, fontSize: 16, textAlign: 'center', marginBottom: 10, letterSpacing: 2, fontWeight: '900' }}>USUŃ KONTO</Text>
            <Text style={{ color: textMuted, fontSize: 13, lineHeight: 21, textAlign: 'center', marginBottom: 18 }}>
              Ta operacja jest <Text style={{ color: RED, fontWeight: '700' }}>nieodwracalna</Text>.{'\n\n'}
              Zostaną usunięte:{'\n'}• Profil i dane{'\n'}• Wszystkie spoty{'\n'}• Auta w garażu{'\n'}• Historia aktywności{'\n\n'}
              Wpisz <Text style={{ color: RED, fontWeight: '700' }}>USUŃ</Text> aby potwierdzić:
            </Text>
            <TextInput
              style={{ backgroundColor: isDark ? '#1a0808' : '#fff0f0', borderRadius: 12, padding: 14, color: RED, fontFamily: 'Orbitron', fontSize: 16, borderWidth: 1, borderColor: RED + '30', textAlign: 'center', marginBottom: 18, letterSpacing: 4 }}
              value={deleteConfirm} onChangeText={setDeleteConfirm}
              placeholder="Wpisz USUŃ" placeholderTextColor={RED + '40'}
              autoCapitalize="characters"
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: cancelBg, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: cancelBorder }} onPress={() => setDeleteModal(false)} disabled={deleteLoading}>
                <Text style={{ fontFamily: 'Orbitron', color: textMuted, fontSize: 11 }}>ANULUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: RED, borderRadius: 14, paddingVertical: 14, alignItems: 'center', opacity: deleteConfirm !== 'USUŃ' ? 0.4 : 1 }} onPress={handleDeleteAccount} disabled={deleteConfirm !== 'USUŃ' || deleteLoading}>
                {deleteLoading ? <ActivityIndicator size={16} color="#fff" /> : <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11, fontWeight: '900' }}>USUŃ KONTO</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══ MODAL BUG REPORT ══ */}
      <Modal visible={bugModal} transparent animationType="slide" onRequestClose={() => setBugModal(false)}>
        <View style={{ flex: 1, backgroundColor: overlayBg, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: cardBg, borderRadius: 22, padding: 26, width: '100%', maxHeight: '92%', borderWidth: 1, borderColor: cardBorder }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ width: 62, height: 62, borderRadius: 18, backgroundColor: '#FF572218', borderWidth: 1, borderColor: '#FF572230', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 18 }}>
                <MaterialIcons name="bug-report" size={30} color="#FF5722" />
              </View>
              <Text style={{ fontFamily: 'Orbitron', color: textMain, fontSize: 16, textAlign: 'center', marginBottom: 10, letterSpacing: 2, fontWeight: '900' }}>ZGŁOŚ BŁĄD</Text>
              <Text style={{ color: textMuted, fontSize: 13, lineHeight: 21, textAlign: 'center', marginBottom: 20 }}>Pomóż nam ulepszyć VROOM. Opisz problem jak najdokładniej.</Text>

              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, letterSpacing: 2, marginBottom: 10 }}>KATEGORIA *</Text>
              <View style={{ gap: 8, marginBottom: 18 }}>
                {BUG_CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat.key}
                    style={{ paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, backgroundColor: bugCategory === cat.key ? cat.color + '18' : rowAlt, borderColor: bugCategory === cat.key ? cat.color + '60' : inputBorder, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                    onPress={() => setBugCategory(cat.key)}
                  >
                    {bugCategory === cat.key && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cat.color }} />}
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: bugCategory === cat.key ? cat.color : textMuted }}>{cat.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, letterSpacing: 2, marginBottom: 10 }}>OPIS BŁĘDU *</Text>
              <TextInput
                style={{ backgroundColor: inputBg, borderRadius: 14, padding: 14, color: textMain, fontSize: 13, borderWidth: 1, borderColor: inputBorder, minHeight: 120, marginBottom: 6 }}
                value={bugDescription} onChangeText={setBugDescription}
                placeholder="Opisz dokładnie co się stało..." placeholderTextColor={textDim}
                multiline numberOfLines={5} textAlignVertical="top"
              />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: bugDescription.length < 10 ? RED + '90' : textDim, textAlign: 'right', marginBottom: 18 }}>
                {bugDescription.length} / min. 10 znaków
              </Text>

              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: textDim, letterSpacing: 2, marginBottom: 10 }}>ZDJĘCIA (opcjonalne, max 3)</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
                {bugPhotos.map((uri, i) => (
                  <View key={i} style={{ position: 'relative' }}>
                    <Image source={{ uri }} style={{ width: 80, height: 80, borderRadius: 12 }} />
                    <TouchableOpacity style={{ position: 'absolute', top: -6, right: -6, backgroundColor: RED, borderRadius: 10, width: 22, height: 22, justifyContent: 'center', alignItems: 'center' }} onPress={() => setBugPhotos(prev => prev.filter((_, idx) => idx !== i))}>
                      <MaterialIcons name="close" size={13} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
                {bugPhotos.length < 3 && (
                  <TouchableOpacity style={{ width: 80, height: 80, borderRadius: 12, backgroundColor: inputBg, borderWidth: 1, borderColor: inputBorder, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' }} onPress={pickBugPhoto}>
                    <MaterialIcons name="add-photo-alternate" size={24} color={textDim} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={{ flex: 1, backgroundColor: cancelBg, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: cancelBorder }} onPress={() => setBugModal(false)} disabled={bugLoading}>
                  <Text style={{ fontFamily: 'Orbitron', color: textMuted, fontSize: 11 }}>ANULUJ</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, backgroundColor: '#FF5722', borderRadius: 14, paddingVertical: 14, alignItems: 'center', opacity: (!bugCategory || bugDescription.length < 10) ? 0.4 : 1 }} onPress={handleBugSubmit} disabled={!bugCategory || bugDescription.length < 10 || bugLoading}>
                  {bugLoading ? <ActivityIndicator size={16} color="#fff" /> : <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11, fontWeight: '900' }}>WYŚLIJ</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <CustomThemeEditor visible={themeEditorVisible} onClose={() => setThemeEditorVisible(false)} />
    </>
  );
}