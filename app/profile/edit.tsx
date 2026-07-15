import React, { useEffect, useState } from 'react';
import {
  View, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, Text,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter }     from 'expo-router';
import * as ImagePicker  from 'expo-image-picker';
import MaterialIcons     from '@expo/vector-icons/MaterialIcons';
import Toast             from 'react-native-toast-message';
import { useProfile }    from '../../hooks/useProfile';
import { useTheme }      from '../../contexts/ThemeContext';
import { useFormKeyboardPadding } from '../../hooks/useKeyboardInset';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';
import { POLISH_PROVINCES } from '../../constants/provinces';

export default function EditProfileScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const headerTop = useScreenHeaderTop(8);
  const { profile, loading, avatarLoading, fetchProfile, updateProfile, uploadAvatar } = useProfile();

  const [username,    setUsername]    = useState('');
  const [location,    setLocation]    = useState('');
  const [province,    setProvince]    = useState<string | null>(null);
  const [bio,         setBio]         = useState('');
  const [localAvatar, setLocalAvatar] = useState<string | null>(null);

  useEffect(() => { if (!profile) fetchProfile(); }, []);
  useEffect(() => {
    if (profile) {
      setUsername(profile.username ?? '');
      setLocation(profile.location ?? '');
      setProvince(profile.province ?? null);
      setBio(profile.bio ?? '');
    }
  }, [profile]);

  const handlePickAvatar = async (useCamera: boolean) => {
    try {
      let result;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ', text2: 'Zezwól na dostęp do aparatu.' }); return; }
        result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      }
      if (!result.canceled && result.assets?.[0]?.uri) setLocalAvatar(result.assets[0].uri);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie można otworzyć galerii' });
    }
  };

  const handleSave = async () => {
    if (!username.trim()) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nazwa użytkownika nie może być pusta.' }); return; }
    if (localAvatar) {
      const up = await uploadAvatar(localAvatar);
      if (!up.ok) {
        Toast.show({
          type: 'error',
          text1: 'BŁĄD ZDJĘCIA',
          text2: up.error ?? 'Nie udało się zapisać zdjęcia profilowego.',
        });
        return;
      }
      setLocalAvatar(null);
    }
    const ok = await updateProfile({
      username: username.trim(),
      location: location.trim(),
      province: province ?? '',
      bio: bio.trim(),
    });
    if (ok) {
      await fetchProfile();
      Toast.show({ type: 'success', text1: '✅ ZAPISANO', text2: 'Profil zaktualizowany!' });
      router.back();
    }
    else    { Toast.show({ type: 'error',   text1: 'BŁĄD',      text2: 'Nie udało się zaktualizować profilu.' }); }
  };

  const avatarSource = localAvatar ?? profile?.avatarUrl ?? null;
  const initials     = profile?.username?.slice(0, 2).toUpperCase() ?? '??';
  const isBusy       = loading || avatarLoading;

  const inputStyle = { backgroundColor: theme.surface3, borderRadius: 10, padding: 14, color: theme.text, fontFamily: 'Orbitron' as const, fontSize: 13, borderWidth: 1, borderColor: theme.border2, marginBottom: 20 };
  const labelStyle = { fontFamily: 'Orbitron' as const, color: theme.textDim, fontSize: 11, marginBottom: 8, letterSpacing: 1 };
  const { scrollPaddingBottom } = useFormKeyboardPadding(72);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      enabled={Platform.OS === 'ios'}
    >
    <ScrollView style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%' }} contentContainerStyle={{ paddingBottom: scrollPaddingBottom }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

      {/* NAGŁÓWEK */}
      <View style={{ paddingTop: headerTop, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 12 }}>← Wróć</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: theme.text, letterSpacing: 2 }}>EDYTUJ PROFIL</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* AVATAR */}
      <View style={{ alignItems: 'center', marginBottom: 30 }}>
        <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: theme.surface3, borderWidth: 2, borderColor: theme.primary, justifyContent: 'center', alignItems: 'center', shadowColor: theme.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
          {avatarLoading
            ? <ActivityIndicator color={theme.primary} size="large" />
            : avatarSource
            ? <Image key={avatarSource} source={{ uri: avatarSource }} style={{ width: 100, height: 100 }} />
            : <Text style={{ fontFamily: 'Orbitron', fontSize: 28, color: theme.primary }}>{initials}</Text>
          }
        </View>
        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginBottom: 12 }}>Wybierz nowe zdjęcie profilowe</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surface3, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.primaryBorder }} onPress={() => handlePickAvatar(false)} disabled={avatarLoading}>
            <MaterialIcons name="photo-library" size={18} color={theme.primary} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 11 }}>Galeria</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surface3, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.primaryBorder }} onPress={() => handlePickAvatar(true)} disabled={avatarLoading}>
            <MaterialIcons name="photo-camera" size={18} color={theme.primary} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 11 }}>Aparat</Text>
          </TouchableOpacity>
        </View>
        {localAvatar && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <MaterialIcons name="check-circle" size={14} color="#4de926" />
            <Text style={{ fontFamily: 'Orbitron', color: '#4de926', fontSize: 9 }}>Nowe zdjęcie wybrane – zapisz żeby zastosować</Text>
          </View>
        )}
      </View>

      <Text style={labelStyle}>NAZWA UŻYTKOWNIKA</Text>
      <TextInput style={inputStyle} value={username} onChangeText={setUsername} placeholder="Twoja nazwa" placeholderTextColor={theme.textDim} />

      <Text style={labelStyle}>LOKALIZACJA</Text>
      <TextInput style={inputStyle} value={location} onChangeText={setLocation} placeholder="Np. Warszawa, Polska" placeholderTextColor={theme.textDim} />

      <Text style={labelStyle}>WOJEWÓDZTWO</Text>
      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginBottom: 10, lineHeight: 14 }}>
        Wyświetlane w profilu, klubach i czacie. Napisz np. @slask, by dotrzeć do użytkowników z regionu.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <TouchableOpacity
          onPress={() => setProvince(null)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: province == null ? theme.primary : theme.border2,
            backgroundColor: province == null ? `${theme.primary}22` : theme.surface3,
          }}
        >
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: province == null ? theme.primary : theme.textDim }}>Brak</Text>
        </TouchableOpacity>
        {POLISH_PROVINCES.map(p => {
          const active = province === p.slug;
          return (
            <TouchableOpacity
              key={p.slug}
              onPress={() => setProvince(p.slug)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 7,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: active ? '#7cb342' : theme.border2,
                backgroundColor: active ? '#7cb34222' : theme.surface3,
              }}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: active ? '#7cb342' : theme.textDim }}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={labelStyle}>BIO</Text>
      <TextInput style={[inputStyle, { height: 90, textAlignVertical: 'top' }]} value={bio} onChangeText={setBio} placeholder="Kilka słów o sobie..." placeholderTextColor={theme.textDim} multiline />

      <TouchableOpacity
        style={[{ backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 }, isBusy && { opacity: 0.6 }]}
        onPress={handleSave} disabled={isBusy}
      >
        {isBusy
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 13, letterSpacing: 1 }}>ZAPISZ ZMIANY</Text>
        }
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
