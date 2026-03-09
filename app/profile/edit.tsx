import React, { useEffect, useState } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Image, Platform,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Toast from 'react-native-toast-message';
import { useProfile } from '../../hooks/useProfile';

export default function EditProfileScreen() {
  const router = useRouter();
  const { profile, loading, avatarLoading, fetchProfile, updateProfile, uploadAvatar } = useProfile();

  const [username, setUsername] = useState('');
  const [location, setLocation] = useState('');
  const [bio,      setBio]      = useState('');
  const [localAvatar, setLocalAvatar] = useState<string | null>(null);

  useEffect(() => { if (!profile) fetchProfile(); }, []);

  useEffect(() => {
    if (profile) {
      setUsername(profile.username  ?? '');
      setLocation(profile.location  ?? '');
      setBio(profile.bio            ?? '');
    }
  }, [profile]);

  // ── Wybór zdjęcia ─────────────────────────────────────────────────────────
  const handlePickAvatar = async (useCamera: boolean) => {
    try {
      let result;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ', text2: 'Zezwól na dostęp do aparatu.' });
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          allowsEditing: true, aspect: [1, 1], quality: 0.8,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ', text2: 'Zezwól na dostęp do galerii.' });
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true, aspect: [1, 1], quality: 0.8,
        });
      }
      if (!result.canceled && result.assets?.[0]?.uri) {
        setLocalAvatar(result.assets[0].uri);
      }
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie można otworzyć galerii' });
    }
  };

  const showAvatarOptions = () => {
    // Zamiast ActionSheet – dwa przyciski w UI (patrz JSX poniżej)
    // Na Android/iOS pokazujemy Toast z opcjami przez dwa osobne TouchableOpacity
  };

  // ── Zapisz ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!username.trim()) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nazwa użytkownika nie może być pusta.' });
      return;
    }

    let avatarOk = true;

    // Najpierw uploaduj avatar jeśli wybrano nowe zdjęcie
    if (localAvatar) {
      avatarOk = await uploadAvatar(localAvatar);
      if (!avatarOk) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się zapisać zdjęcia profilowego.' });
        return;
      }
    }

    // Zapisz resztę danych
    const ok = await updateProfile({ username: username.trim(), location: location.trim(), bio: bio.trim() });
    if (ok) {
      Toast.show({ type: 'success', text1: '✅ ZAPISANO', text2: 'Profil zaktualizowany!' });
      router.back();
    } else {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się zaktualizować profilu.' });
    }
  };

  const avatarSource = localAvatar ?? profile?.avatarUrl ?? null;
  const initials     = profile?.username?.slice(0, 2).toUpperCase() ?? '??';
  const isBusy       = loading || avatarLoading;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>

      {/* NAGŁÓWEK */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backBtn}>← Wróć</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>EDYTUJ PROFIL</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* AVATAR SECTION */}
      <View style={styles.avatarSection}>
        <View style={styles.avatarCircle}>
          {avatarLoading ? (
            <ActivityIndicator color="#e33835" size="large" />
          ) : avatarSource ? (
            <Image source={{ uri: avatarSource }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>
        <Text style={styles.avatarHint}>Wybierz nowe zdjęcie profilowe</Text>

        {/* Dwa przyciski – aparat i galeria */}
        <View style={styles.avatarBtnsRow}>
          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={() => handlePickAvatar(false)}
            disabled={avatarLoading}
          >
            <MaterialIcons name="photo-library" size={18} color="#e33835" />
            <Text style={styles.avatarBtnText}>Galeria</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={() => handlePickAvatar(true)}
            disabled={avatarLoading}
          >
            <MaterialIcons name="photo-camera" size={18} color="#e33835" />
            <Text style={styles.avatarBtnText}>Aparat</Text>
          </TouchableOpacity>
        </View>

        {/* Podgląd wybranego zdjęcia – info */}
        {localAvatar && (
          <View style={styles.newPhotoBadge}>
            <MaterialIcons name="check-circle" size={14} color="#4de926" />
            <Text style={styles.newPhotoText}>Nowe zdjęcie wybrane – zapisz żeby zastosować</Text>
          </View>
        )}
      </View>

      {/* POLA FORMULARZA */}
      <Text style={styles.label}>NAZWA UŻYTKOWNIKA</Text>
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        placeholderTextColor="#ffffff40"
        placeholder="Twoja nazwa"
      />

      <Text style={styles.label}>LOKALIZACJA</Text>
      <TextInput
        style={styles.input}
        value={location}
        onChangeText={setLocation}
        placeholderTextColor="#ffffff40"
        placeholder="Np. Warszawa, Polska"
      />

      <Text style={styles.label}>BIO</Text>
      <TextInput
        style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
        value={bio}
        onChangeText={setBio}
        placeholderTextColor="#ffffff40"
        placeholder="Kilka słów o sobie..."
        multiline
      />

      <TouchableOpacity
        style={[styles.saveBtn, isBusy && { opacity: 0.6 }]}
        onPress={handleSave}
        disabled={isBusy}
      >
        {isBusy
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.saveBtnText}>ZAPISZ ZMIANY</Text>}
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  headerRow:      { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  headerTitle:    { fontFamily: 'Orbitron', fontSize: 16, color: '#fff', letterSpacing: 2 },
  backBtn:        { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },

  // Avatar
  avatarSection:  { alignItems: 'center', marginBottom: 30 },
  avatarCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#252525', borderWidth: 2, borderColor: '#e33835',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#e33835', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 12, overflow: 'hidden',
    marginBottom: 12,
  },
  avatarImage:    { width: 100, height: 100 },
  avatarText:     { fontFamily: 'Orbitron', fontSize: 28, color: '#e33835' },
  avatarHint:     { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 10, marginBottom: 12 },
  avatarBtnsRow:  { flexDirection: 'row', gap: 12 },
  avatarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1a1a1a', paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#e3383540',
  },
  avatarBtnText:  { fontFamily: 'Orbitron', color: '#e33835', fontSize: 11 },
  newPhotoBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  newPhotoText:   { fontFamily: 'Orbitron', color: '#4de926', fontSize: 9 },

  // Formularz
  label:      { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 11, marginBottom: 8, letterSpacing: 1 },
  input: {
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14,
    color: '#fff', fontFamily: 'Orbitron', fontSize: 13,
    borderWidth: 1, borderColor: '#ffffff15', marginBottom: 20,
  },
  saveBtn:     { backgroundColor: '#e33835', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  saveBtnText: { fontFamily: 'Orbitron', color: '#fff', fontSize: 13, letterSpacing: 1 },
});