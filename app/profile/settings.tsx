import React, { useState, useEffect, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Switch, Modal, Image, Alert,
} from 'react-native';
import { Text }          from '@react-navigation/elements';
import { useRouter }     from 'expo-router';
import MaterialIcons     from '@expo/vector-icons/MaterialIcons';
import AsyncStorage      from '@react-native-async-storage/async-storage';
import * as ImagePicker  from 'expo-image-picker';
import * as TaskManager  from 'expo-task-manager';
import * as Location     from 'expo-location';
import Toast             from 'react-native-toast-message';
import { API_URL }       from '../../constants/config';
import { useSettings }   from '../../hooks/useSettings';
import { BACKGROUND_LOCATION_TASK } from '../../hooks/useBackgroundTracking';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

// ─────────────────────────────────────────────────────────
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={s.section}>
    <Text style={s.sectionTitle}>{title}</Text>
    <View style={s.sectionCard}>{children}</View>
  </View>
);

const Row = ({
  icon, label, sublabel, color = '#fff', onPress, right, destructive = false, disabled = false,
}: {
  icon: string; label: string; sublabel?: string; color?: string;
  onPress?: () => void; right?: React.ReactNode;
  destructive?: boolean; disabled?: boolean;
}) => (
  <TouchableOpacity
    style={[s.row, disabled && { opacity: 0.4 }]}
    onPress={onPress}
    activeOpacity={onPress ? 0.7 : 1}
    disabled={disabled || !onPress}
  >
    <View style={[s.rowIcon, { backgroundColor: (destructive ? '#e33835' : color) + '18' }]}>
      <MaterialIcons name={icon as any} size={18} color={destructive ? '#e33835' : color} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={[s.rowLabel, destructive && { color: '#e33835' }]}>{label}</Text>
      {sublabel && <Text style={s.rowSublabel}>{sublabel}</Text>}
    </View>
    {right ?? (onPress && <MaterialIcons name="arrow-forward-ios" size={13} color="#ffffff20" />)}
  </TouchableOpacity>
);

const Divider = () => <View style={s.divider} />;

const BUG_CATEGORIES = [
  { key: 'crash',   label: '💥 Crash / zamrożenie',    color: '#e33835' },
  { key: 'ui',      label: '🎨 Problem z wyglądem',    color: '#9C27B0' },
  { key: 'map',     label: '🗺️ Problem z mapą',        color: '#2196F3' },
  { key: 'account', label: '👤 Problem z kontem',      color: '#FF9800' },
  { key: 'other',   label: '❓ Inne',                  color: '#607D8B' },
];

// ─────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router = useRouter();
  const { settings, loading: settingsLoading, updateSetting } = useSettings();

  const [deleteModal,   setDeleteModal]   = useState(false);
  const [logoutModal,   setLogoutModal]   = useState(false);
  const [bugModal,      setBugModal]      = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [bugLoading,    setBugLoading]    = useState(false);

  // Bug report state
  const [bugCategory,    setBugCategory]    = useState('');
  const [bugDescription, setBugDescription] = useState('');
  const [bugPhotos,      setBugPhotos]      = useState<string[]>([]);

  // ── Toggle background tracking ──────────────────────────
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

  // ── Wyloguj ─────────────────────────────────────────────
  const handleLogout = async () => {
    setLogoutModal(false);
    await AsyncStorage.multiRemove(['userToken', 'token', 'user', 'app_settings']);
    Toast.show({ type: 'success', text1: '👋 DO ZOBACZENIA!' });
    router.replace('/login');
  };

  // ── Usuń konto ──────────────────────────────────────────
  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'USUŃ') {
      Toast.show({ type: 'error', text1: 'Wpisz USUŃ aby potwierdzić' });
      return;
    }
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
    } catch {
      Toast.show({ type: 'error', text1: 'Nie można usunąć konta' });
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── Bug report — wybierz zdjęcia ────────────────────────
  const pickBugPhoto = async () => {
    if (bugPhotos.length >= 3) {
      Toast.show({ type: 'info', text1: 'Maksymalnie 3 zdjęcia' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality:    0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setBugPhotos(prev => [...prev, result.assets[0].uri]);
    }
  };

  // ── Wyślij bug report ────────────────────────────────────
  const handleBugSubmit = async () => {
    if (!bugCategory) {
      Toast.show({ type: 'error', text1: 'Wybierz kategorię' });
      return;
    }
    if (bugDescription.trim().length < 10) {
      Toast.show({ type: 'error', text1: 'Opis musi mieć min. 10 znaków' });
      return;
    }

    setBugLoading(true);
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('category',    bugCategory);
      form.append('description', bugDescription.trim());

      bugPhotos.forEach((uri, i) => {
        const ext = uri.split('.').pop() ?? 'jpg';
        form.append('photos', {
          uri,
          name: `bug_photo_${i}.${ext}`,
          type: `image/${ext}`,
        } as any);
      });

      const res = await fetch(`${API_URL}/api/settings/bug-report`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    form,
      });

      if (!res.ok) throw new Error();

      setBugModal(false);
      setBugCategory('');
      setBugDescription('');
      setBugPhotos([]);
      Toast.show({ type: 'success', text1: '🐛 ZGŁOSZENIE WYSŁANE', text2: 'Dziękujemy! Zajmiemy się tym.' });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd wysyłania zgłoszenia' });
    } finally {
      setBugLoading(false);
    }
  };

  if (settingsLoading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#e33835" size="large" />
      </View>
    );
  }

  return (
    <>
      <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 80 }}>

        {/* NAGŁÓWEK */}
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.backBtn}>← Wróć</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>USTAWIENIA</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* KONTO */}
        <Section title="KONTO">
          <Row icon="person-outline"  label="Edytuj profil"  sublabel="Zmień avatar, bio, lokalizację" color="#e33835" onPress={() => router.push('/profile/edit')} />
          <Divider />
          <Row icon="lock-outline"    label="Zmień hasło"    sublabel="Zaktualizuj hasło do konta"      color="#e33835" onPress={() => router.push('/profile/change-password')} />
          <Divider />
          <Row icon="email-outline"   label="Zmień e-mail"   sublabel="Zaktualizuj adres e-mail"        color="#e33835" onPress={() => router.push('/profile/change-email')} />
        </Section>

        {/* PRYWATNOŚĆ */}
        <Section title="PRYWATNOŚĆ">
          <Row
            icon="leaderboard" label="Tryb prywatny"
            sublabel="Ukryj swój profil w rankingu"
            color="#9C27B0"
            right={
              <Switch value={settings.privateProfile} onValueChange={v => updateSetting('privateProfile', v)}
                trackColor={{ true: '#e33835', false: '#333' }} thumbColor="#fff" />
            }
          />
          <Divider />
          <Row
            icon="location-off" label="Ukryj lokalizację"
            sublabel="Nie pokazuj swojej pozycji na mapie"
            color="#FF9800"
            right={
              <Switch value={settings.hideLocation} onValueChange={v => updateSetting('hideLocation', v)}
                trackColor={{ true: '#e33835', false: '#333' }} thumbColor="#fff" />
            }
          />
        </Section>

        {/* POWIADOMIENIA */}
        <Section title="POWIADOMIENIA">
          <Row
            icon="event" label="Nowe zloty"
            sublabel="Powiadomienia o zlotach w okolicy"
            color="#4CAF50"
            right={
              <Switch value={settings.notifMeets} onValueChange={v => updateSetting('notifMeets', v)}
                trackColor={{ true: '#e33835', false: '#333' }} thumbColor="#fff" />
            }
          />
          <Divider />
          <Row
            icon="favorite-outline" label="Lajki"
            sublabel="Ktoś polubił Twój spot lub auto"
            color="#e33835"
            right={
              <Switch value={settings.notifLikes} onValueChange={v => updateSetting('notifLikes', v)}
                trackColor={{ true: '#e33835', false: '#333' }} thumbColor="#fff" />
            }
          />
          <Divider />
          <Row
            icon="chat-bubble-outline" label="Komentarze"
            sublabel="Nowy komentarz pod Twoim postem"
            color="#2196F3"
            right={
              <Switch value={settings.notifComments} onValueChange={v => updateSetting('notifComments', v)}
                trackColor={{ true: '#e33835', false: '#333' }} thumbColor="#fff" />
            }
          />
          <Divider />
          <Row
            icon="warning-amber" label="Ostrzeżenia drogowe"
            sublabel="Alert gdy jesteś blisko ostrzeżenia"
            color="#FF9800"
            right={
              <Switch value={settings.notifWarnings} onValueChange={v => updateSetting('notifWarnings', v)}
                trackColor={{ true: '#e33835', false: '#333' }} thumbColor="#fff" />
            }
          />
        </Section>

        {/* APLIKACJA */}
        <Section title="APLIKACJA">
          <Row
            icon="directions-run" label="Praca w tle"
            sublabel="Liczenie km gdy aplikacja zamknięta"
            color="#4CAF50"
            right={
              <Switch value={settings.backgroundTracking} onValueChange={toggleBgTracking}
                trackColor={{ true: '#e33835', false: '#333' }} thumbColor="#fff" />
            }
          />
          <Divider />
          <Row icon="info-outline"  label="O aplikacji" sublabel="VROOM v1.0.0" color="#607D8B"
            onPress={() => Toast.show({ type: 'info', text1: '🚗 VROOM v1.0.0', text2: 'Made with ❤️ for car enthusiasts' })} />
          <Divider />
          <Row icon="bug-report"    label="Zgłoś błąd"  sublabel="Pomóż nam ulepszyć aplikację" color="#FF5722"
            onPress={() => setBugModal(true)} />
          <Divider />
          <Row icon="star-outline"  label="Oceń aplikację" sublabel="Zostaw opinię w sklepie" color="#FFC107"
            onPress={() => Toast.show({ type: 'info', text1: 'WKRÓTCE' })} />
        </Section>

        {/* SESJA */}
        <Section title="SESJA">
          <Row icon="logout" label="Wyloguj się" sublabel="Wróć do ekranu logowania" color="#FF9800"
            onPress={() => setLogoutModal(true)} />
        </Section>

        {/* STREFA NIEBEZPIECZNA */}
        <Section title="STREFA NIEBEZPIECZNA">
          <Row icon="delete-forever" label="Usuń konto" sublabel="Trwale usuwa konto i wszystkie dane"
            destructive onPress={() => { setDeleteConfirm(''); setDeleteModal(true); }} />
        </Section>

      </ScrollView>

      {/* ── MODAL WYLOGUJ ──────────────────────────────────────── */}
      <Modal visible={logoutModal} transparent animationType="fade" onRequestClose={() => setLogoutModal(false)}>
        <View style={s.overlay}>
          <View style={s.card}>
            <View style={[s.modalIcon, { backgroundColor: '#FF980018' }]}>
              <MaterialIcons name="logout" size={32} color="#FF9800" />
            </View>
            <Text style={s.modalTitle}>WYLOGUJ SIĘ</Text>
            <Text style={s.modalDesc}>Czy na pewno chcesz się wylogować z konta VROOM?</Text>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setLogoutModal(false)}>
                <Text style={s.cancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, { backgroundColor: '#FF9800' }]} onPress={handleLogout}>
                <Text style={s.confirmText}>Wyloguj</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL USUŃ KONTO ────────────────────────────────────── */}
      <Modal visible={deleteModal} transparent animationType="fade" onRequestClose={() => setDeleteModal(false)}>
        <View style={s.overlay}>
          <View style={s.card}>
            <View style={[s.modalIcon, { backgroundColor: '#e3383520' }]}>
              <MaterialIcons name="delete-forever" size={32} color="#e33835" />
            </View>
            <Text style={[s.modalTitle, { color: '#e33835' }]}>USUŃ KONTO</Text>
            <Text style={s.modalDesc}>
              Ta operacja jest <Text style={{ color: '#e33835', fontWeight: '700' }}>nieodwracalna</Text>.{'\n\n'}
              Zostaną usunięte:{'\n'}• Twój profil i dane{'\n'}• Wszystkie dodane spoty{'\n'}
              • Auta w garażu{'\n'}• Historia aktywności{'\n\n'}
              Wpisz <Text style={{ color: '#e33835', fontWeight: '700' }}>USUŃ</Text> aby potwierdzić:
            </Text>
            <TextInput
              style={s.deleteInput} value={deleteConfirm} onChangeText={setDeleteConfirm}
              placeholder="Wpisz USUŃ" placeholderTextColor="#ffffff30" autoCapitalize="characters"
            />
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setDeleteModal(false)} disabled={deleteLoading}>
                <Text style={s.cancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, { backgroundColor: '#e33835' }, deleteConfirm !== 'USUŃ' && { opacity: 0.4 }]}
                onPress={handleDeleteAccount} disabled={deleteConfirm !== 'USUŃ' || deleteLoading}
              >
                {deleteLoading ? <ActivityIndicator size={16} color="#fff" /> : <Text style={s.confirmText}>USUŃ KONTO</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL BUG REPORT ────────────────────────────────────── */}
      <Modal visible={bugModal} transparent animationType="slide" onRequestClose={() => setBugModal(false)}>
        <View style={s.overlay}>
          <View style={[s.card, { maxHeight: '90%' }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[s.modalIcon, { backgroundColor: '#FF572218' }]}>
                <MaterialIcons name="bug-report" size={32} color="#FF5722" />
              </View>
              <Text style={s.modalTitle}>ZGŁOŚ BŁĄD</Text>
              <Text style={s.modalDesc}>Pomóż nam ulepszyć VROOM. Opisz problem jak najdokładniej.</Text>

              {/* Kategoria */}
              <Text style={s.bugLabel}>KATEGORIA *</Text>
              <View style={s.bugCategories}>
                {BUG_CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat.key}
                    style={[s.bugCatBtn, bugCategory === cat.key && { borderColor: cat.color, backgroundColor: cat.color + '20' }]}
                    onPress={() => setBugCategory(cat.key)}
                  >
                    <Text style={[s.bugCatText, bugCategory === cat.key && { color: cat.color }]}>{cat.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Opis */}
              <Text style={s.bugLabel}>OPIS BŁĘDU *</Text>
              <TextInput
                style={s.bugInput}
                value={bugDescription}
                onChangeText={setBugDescription}
                placeholder="Opisz dokładnie co się stało, jakie kroki podjąłeś i czego się spodziewałeś..."
                placeholderTextColor="#ffffff30"
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
              <Text style={[s.bugCharCount, bugDescription.length < 10 && { color: '#e33835' }]}>
                {bugDescription.length} / min. 10 znaków
              </Text>

              {/* Zdjęcia */}
              <Text style={s.bugLabel}>ZDJĘCIA (opcjonalne, max 3)</Text>
              <View style={s.bugPhotos}>
                {bugPhotos.map((uri, i) => (
                  <View key={i} style={s.bugPhotoWrap}>
                    <Image source={{ uri }} style={s.bugPhoto} />
                    <TouchableOpacity
                      style={s.bugPhotoRemove}
                      onPress={() => setBugPhotos(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      <MaterialIcons name="close" size={14} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
                {bugPhotos.length < 3 && (
                  <TouchableOpacity style={s.bugPhotoAdd} onPress={pickBugPhoto}>
                    <MaterialIcons name="add-photo-alternate" size={24} color="#ffffff40" />
                  </TouchableOpacity>
                )}
              </View>

              <View style={[s.modalBtns, { marginTop: 20 }]}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setBugModal(false)} disabled={bugLoading}>
                  <Text style={s.cancelText}>Anuluj</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.confirmBtn, { backgroundColor: '#FF5722' }, (!bugCategory || bugDescription.length < 10) && { opacity: 0.4 }]}
                  onPress={handleBugSubmit}
                  disabled={!bugCategory || bugDescription.length < 10 || bugLoading}
                >
                  {bugLoading
                    ? <ActivityIndicator size={16} color="#fff" />
                    : <Text style={s.confirmText}>WYŚLIJ</Text>
                  }
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  headerRow:       { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  headerTitle:     { fontFamily: 'Orbitron', fontSize: 16, color: '#fff', letterSpacing: 2 },
  backBtn:         { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },
  section:         { marginBottom: 24 },
  sectionTitle:    { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, letterSpacing: 2, marginBottom: 8, marginLeft: 4 },
  sectionCard:     { backgroundColor: '#1a1a1a', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff08' },
  row:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowIcon:         { width: 34, height: 34, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  rowLabel:        { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },
  rowSublabel:     { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, marginTop: 2 },
  divider:         { height: 1, backgroundColor: '#ffffff08', marginLeft: 62 },

  overlay:         { flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card:            { backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: '#ffffff10' },
  modalIcon:       { width: 64, height: 64, borderRadius: 20, justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 16 },
  modalTitle:      { fontFamily: 'Orbitron', color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 10, letterSpacing: 2 },
  modalDesc:       { color: '#ffffff80', fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  modalBtns:       { flexDirection: 'row', gap: 10 },
  cancelBtn:       { flex: 1, backgroundColor: '#252525', borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#ffffff10' },
  cancelText:      { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },
  confirmBtn:      { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  confirmText:     { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },
  deleteInput:     { backgroundColor: '#252525', borderRadius: 10, padding: 14, color: '#e33835', fontFamily: 'Orbitron', fontSize: 14, borderWidth: 1, borderColor: '#e3383540', textAlign: 'center', marginBottom: 16, letterSpacing: 3 },

  // Bug report
  bugLabel:        { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 9, letterSpacing: 2, marginBottom: 10, marginTop: 4 },
  bugCategories:   { gap: 8, marginBottom: 16 },
  bugCatBtn:       { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#ffffff15', backgroundColor: '#252525' },
  bugCatText:      { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 11 },
  bugInput:        { backgroundColor: '#252525', borderRadius: 12, padding: 14, color: '#fff', fontSize: 13, borderWidth: 1, borderColor: '#ffffff15', minHeight: 120, marginBottom: 6 },
  bugCharCount:    { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, textAlign: 'right', marginBottom: 16 },
  bugPhotos:       { flexDirection: 'row', gap: 10, marginBottom: 8, flexWrap: 'wrap' },
  bugPhotoWrap:    { position: 'relative' },
  bugPhoto:        { width: 80, height: 80, borderRadius: 10 },
  bugPhotoRemove:  { position: 'absolute', top: -6, right: -6, backgroundColor: '#e33835', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  bugPhotoAdd:     { width: 80, height: 80, borderRadius: 10, backgroundColor: '#252525', borderWidth: 1, borderColor: '#ffffff15', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
});