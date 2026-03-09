import React, { useState } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Switch, Modal, Image,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../constants/config';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

// ── Sekcja ────────────────────────────────────────────────────────────────────
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={s.section}>
    <Text style={s.sectionTitle}>{title}</Text>
    <View style={s.sectionCard}>{children}</View>
  </View>
);

// ── Rząd ──────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router = useRouter();

  const [loading,          setLoading]          = useState(false);
  const [deleteModal,      setDeleteModal]       = useState(false);
  const [logoutModal,      setLogoutModal]       = useState(false);
  const [deleteConfirm,    setDeleteConfirm]     = useState('');
  const [deleteLoading,    setDeleteLoading]     = useState(false);

  // Powiadomienia (lokalny stan – możesz podpiąć pod backend)
  const [notifMeets,       setNotifMeets]        = useState(true);
  const [notifLikes,       setNotifLikes]        = useState(true);
  const [notifComments,    setNotifComments]     = useState(true);

  // ── Wyloguj ────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    setLogoutModal(false);
    await AsyncStorage.multiRemove(['userToken', 'token', 'user']);
    Toast.show({ type: 'success', text1: '👋 DO ZOBACZENIA!', text2: 'Zostałeś wylogowany.' });
    router.replace('/login');
  };

  // ── Usuń konto ─────────────────────────────────────────────────────────
  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'USUŃ') {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wpisz USUŃ aby potwierdzić.' });
      return;
    }
    setDeleteLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/auth/delete-account`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      await AsyncStorage.multiRemove(['userToken', 'token', 'user']);
      setDeleteModal(false);
      Toast.show({ type: 'success', text1: '🗑️ KONTO USUNIĘTE', text2: 'Przykro nam, że odchodzisz.' });
      router.replace('/login');
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można usunąć konta. Spróbuj ponownie.' });
    } finally {
      setDeleteLoading(false);
    }
  };

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
          <Row
            icon="person-outline"
            label="Edytuj profil"
            sublabel="Zmień avatar, bio, lokalizację"
            color="#e33835"
            onPress={() => router.push('/profile/edit')}
          />
          <Divider />
          <Row
            icon="lock-outline"
            label="Zmień hasło"
            sublabel="Zaktualizuj hasło do konta"
            color="#e33835"
            onPress={() => router.push('/profile/change-password')}
          />
          <Divider />
          <Row
            icon="email-outline"
            label="Zmień e-mail"
            sublabel="Zaktualizuj adres e-mail"
            color="#e33835"
            onPress={() => router.push('/profile/change-email')}
          />
        </Section>

        {/* POWIADOMIENIA */}
        <Section title="POWIADOMIENIA">
          <Row
            icon="event"
            label="Nowe zloty"
            sublabel="Powiadomienia o zlotach w okolicy"
            color="#4CAF50"
            right={
              <Switch
                value={notifMeets}
                onValueChange={setNotifMeets}
                trackColor={{ true: '#e33835', false: '#333' }}
                thumbColor="#fff"
              />
            }
          />
          <Divider />
          <Row
            icon="favorite-outline"
            label="Lajki"
            sublabel="Ktoś polubił Twój spot lub auto"
            color="#e33835"
            right={
              <Switch
                value={notifLikes}
                onValueChange={setNotifLikes}
                trackColor={{ true: '#e33835', false: '#333' }}
                thumbColor="#fff"
              />
            }
          />
          <Divider />
          <Row
            icon="chat-bubble-outline"
            label="Komentarze"
            sublabel="Nowy komentarz pod Twoim postem"
            color="#2196F3"
            right={
              <Switch
                value={notifComments}
                onValueChange={setNotifComments}
                trackColor={{ true: '#e33835', false: '#333' }}
                thumbColor="#fff"
              />
            }
          />
        </Section>

        {/* PRYWATNOŚĆ */}
        <Section title="PRYWATNOŚĆ">
          <Row
            icon="visibility-off"
            label="Tryb prywatny"
            sublabel="Ukryj swój profil w rankingu"
            color="#9C27B0"
            onPress={() => Toast.show({ type: 'info', text1: 'WKRÓTCE', text2: 'Ta funkcja jest w przygotowaniu.' })}
          />
          <Divider />
          <Row
            icon="location-off"
            label="Ukryj lokalizację"
            sublabel="Nie pokazuj swojej pozycji na mapie"
            color="#FF9800"
            onPress={() => Toast.show({ type: 'info', text1: 'WKRÓTCE', text2: 'Ta funkcja jest w przygotowaniu.' })}
          />
        </Section>

        {/* APLIKACJA */}
        <Section title="APLIKACJA">
          <Row
            icon="info-outline"
            label="O aplikacji"
            sublabel="VROOM v1.0.0"
            color="#607D8B"
            onPress={() => Toast.show({ type: 'info', text1: '🚗 VROOM v1.0.0', text2: 'Made with ❤️ for car enthusiasts' })}
          />
          <Divider />
          <Row
            icon="bug-report"
            label="Zgłoś błąd"
            sublabel="Pomóż nam ulepszyć aplikację"
            color="#FF5722"
            onPress={() => Toast.show({ type: 'info', text1: 'WKRÓTCE', text2: 'Ta funkcja jest w przygotowaniu.' })}
          />
          <Divider />
          <Row
            icon="star-outline"
            label="Oceń aplikację"
            sublabel="Zostaw opinię w sklepie"
            color="#FFC107"
            onPress={() => Toast.show({ type: 'info', text1: 'WKRÓTCE', text2: 'Ta funkcja jest w przygotowaniu.' })}
          />
        </Section>

        {/* SESJA */}
        <Section title="SESJA">
          <Row
            icon="logout"
            label="Wyloguj się"
            sublabel="Wróć do ekranu logowania"
            color="#FF9800"
            onPress={() => setLogoutModal(true)}
          />
        </Section>

        {/* STREFA NIEBEZPIECZNA */}
        <Section title="STREFA NIEBEZPIECZNA">
          <Row
            icon="delete-forever"
            label="Usuń konto"
            sublabel="Trwale usuwa konto i wszystkie dane"
            destructive
            onPress={() => { setDeleteConfirm(''); setDeleteModal(true); }}
          />
        </Section>

      </ScrollView>

      {/* ── MODAL WYLOGUJ ─────────────────────────────────────────────────── */}
      <Modal visible={logoutModal} transparent animationType="fade" onRequestClose={() => setLogoutModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalIconWrap}>
              <MaterialIcons name="logout" size={32} color="#FF9800" />
            </View>
            <Text style={s.modalTitle}>WYLOGUJ SIĘ</Text>
            <Text style={s.modalDesc}>Czy na pewno chcesz się wylogować z konta VROOM?</Text>
            <View style={s.modalBtns}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setLogoutModal(false)}
              >
                <Text style={s.modalCancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalConfirmBtn} onPress={handleLogout}>
                <Text style={s.modalConfirmText}>Wyloguj</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL USUŃ KONTO ──────────────────────────────────────────────── */}
      <Modal visible={deleteModal} transparent animationType="fade" onRequestClose={() => setDeleteModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={[s.modalIconWrap, { backgroundColor: '#e3383520' }]}>
              <MaterialIcons name="delete-forever" size={32} color="#e33835" />
            </View>
            <Text style={[s.modalTitle, { color: '#e33835' }]}>USUŃ KONTO</Text>
            <Text style={s.modalDesc}>
              Ta operacja jest{' '}
              <Text style={{ color: '#e33835', fontWeight: '700' }}>nieodwracalna</Text>.
              {'\n\n'}Zostaną usunięte:{'\n'}
              • Twój profil i dane{'\n'}
              • Wszystkie dodane spoty{'\n'}
              • Auta w garażu{'\n'}
              • Historia aktywności{'\n\n'}
              Wpisz{' '}
              <Text style={{ color: '#e33835', fontWeight: '700' }}>USUŃ</Text>
              {' '}aby potwierdzić:
            </Text>

            <TextInput
              style={s.deleteInput}
              value={deleteConfirm}
              onChangeText={setDeleteConfirm}
              placeholder="Wpisz USUŃ"
              placeholderTextColor="#ffffff30"
              autoCapitalize="characters"
            />

            <View style={s.modalBtns}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setDeleteModal(false)}
                disabled={deleteLoading}
              >
                <Text style={s.modalCancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.modalDestroyBtn,
                  deleteConfirm !== 'USUŃ' && { opacity: 0.4 },
                ]}
                onPress={handleDeleteAccount}
                disabled={deleteConfirm !== 'USUŃ' || deleteLoading}
              >
                {deleteLoading
                  ? <ActivityIndicator size={16} color="#fff" />
                  : <Text style={s.modalDestroyText}>USUŃ KONTO</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },

  // Header
  headerRow:        { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  headerTitle:      { fontFamily: 'Orbitron', fontSize: 16, color: '#fff', letterSpacing: 2 },
  backBtn:          { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },

  // Sekcje
  section:          { marginBottom: 24 },
  sectionTitle:     { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, letterSpacing: 2, marginBottom: 8, marginLeft: 4 },
  sectionCard:      { backgroundColor: '#1a1a1a', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff08' },

  // Rząd
  row:              { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowIcon:          { width: 34, height: 34, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  rowLabel:         { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },
  rowSublabel:      { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, marginTop: 2 },
  divider:          { height: 1, backgroundColor: '#ffffff08', marginLeft: 62 },

  // Modal
  modalOverlay:     { flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard:        { backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: '#ffffff10' },
  modalIconWrap:    { width: 64, height: 64, borderRadius: 20, backgroundColor: '#FF980018', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 16 },
  modalTitle:       { fontFamily: 'Orbitron', color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 10, letterSpacing: 2 },
  modalDesc:        { color: '#ffffff80', fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  modalBtns:        { flexDirection: 'row', gap: 10 },
  modalCancelBtn:   { flex: 1, backgroundColor: '#252525', borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#ffffff10' },
  modalCancelText:  { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },
  modalConfirmBtn:  { flex: 1, backgroundColor: '#FF9800', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalConfirmText: { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },
  modalDestroyBtn:  { flex: 1, backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalDestroyText: { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },

  // Delete input
  deleteInput:      { backgroundColor: '#252525', borderRadius: 10, padding: 14, color: '#e33835', fontFamily: 'Orbitron', fontSize: 14, borderWidth: 1, borderColor: '#e3383540', textAlign: 'center', marginBottom: 16, letterSpacing: 3 },
});