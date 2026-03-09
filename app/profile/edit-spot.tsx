import React, { useState, useEffect } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Image, FlatList,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../../constants/config';
import { SPOT_CATEGORIES } from '../../constants/spotTypes';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function EditSpotScreen() {
  const router = useRouter();
  const { id, name: initName, description: initDesc, category: initCat, photos: initPhotosRaw } =
    useLocalSearchParams<{
      id: string;
      name: string;
      description: string;
      category: string;
      photos: string;
    }>();

  const initPhotos: string[] = initPhotosRaw ? JSON.parse(initPhotosRaw) : [];

  const [name,        setName]        = useState(initName        ?? '');
  const [description, setDescription] = useState(initDesc        ?? '');
  const [category,    setCategory]    = useState(initCat         ?? '');
  const [existingPhotos, setExistingPhotos] = useState<string[]>(initPhotos);
  const [newPhotos,      setNewPhotos]      = useState<Array<{ uri: string; name: string; type: string }>>([]);
  const [photosToRemove, setPhotosToRemove] = useState<string[]>([]);
  const [loading,        setLoading]        = useState(false);

  const totalPhotos = existingPhotos.length + newPhotos.length;

  // ── Dodaj zdjęcie ─────────────────────────────────────────────────────────
  const pickPhoto = async () => {
    if (totalPhotos >= 5) {
      Toast.show({ type: 'error', text1: 'LIMIT', text2: 'Maksymalnie 5 zdjęć.' });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ', text2: 'Zezwól na dostęp do galerii.' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:             ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit:          5 - totalPhotos,
      quality:                 0.8,
    });
    if (!result.canceled) {
      const picked = result.assets.map(a => ({
        uri:  a.uri,
        name: a.fileName ?? `spot_${Date.now()}.jpg`,
        type: a.mimeType ?? 'image/jpeg',
      }));
      setNewPhotos(prev => [...prev, ...picked].slice(0, 5 - existingPhotos.length));
    }
  };

  // ── Usuń istniejące zdjęcie ───────────────────────────────────────────────
  const removeExisting = (url: string) => {
    setExistingPhotos(prev => prev.filter(p => p !== url));
    setPhotosToRemove(prev => [...prev, url]);
  };

  // ── Usuń nowe zdjęcie ─────────────────────────────────────────────────────
  const removeNew = (uri: string) => {
    setNewPhotos(prev => prev.filter(p => p.uri !== uri));
  };

  // ── Zapisz ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!name.trim()) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nazwa spotu nie może być pusta.' });
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('name',        name.trim());
      form.append('description', description.trim());
      form.append('category',    category);
      if (photosToRemove.length > 0) {
        form.append('photosToRemove', JSON.stringify(photosToRemove));
      }
      newPhotos.forEach(p => {
        form.append('newPhotos', { uri: p.uri, name: p.name, type: p.type } as any);
      });

      const res = await fetch(`${API_URL}/api/spots/${id}`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body:    form,
      });

      if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd serwera');

      Toast.show({ type: 'success', text1: '✅ ZAPISANO', text2: 'Spot zaktualizowany!' });
      router.back();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 80 }}>

      {/* NAGŁÓWEK */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backBtn}>← Wróć</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>EDYTUJ SPOT</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ZDJĘCIA */}
      <Text style={styles.label}>ZDJĘCIA ({totalPhotos}/5)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        {/* Istniejące */}
        {existingPhotos.map((url, i) => (
          <View key={`ex_${i}`} style={styles.photoWrapper}>
            <Image source={{ uri: url }} style={styles.photoThumb} />
            <TouchableOpacity style={styles.removePhotoBtn} onPress={() => removeExisting(url)}>
              <MaterialIcons name="close" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        {/* Nowe */}
        {newPhotos.map((p, i) => (
          <View key={`new_${i}`} style={styles.photoWrapper}>
            <Image source={{ uri: p.uri }} style={styles.photoThumb} />
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>NOWE</Text>
            </View>
            <TouchableOpacity style={styles.removePhotoBtn} onPress={() => removeNew(p.uri)}>
              <MaterialIcons name="close" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        {/* Przycisk dodaj */}
        {totalPhotos < 5 && (
          <TouchableOpacity style={styles.addPhotoBtn} onPress={pickPhoto}>
            <MaterialIcons name="add-photo-alternate" size={28} color="#e33835" />
            <Text style={styles.addPhotoText}>Dodaj</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* NAZWA */}
      <Text style={styles.label}>NAZWA</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Nazwa spotu"
        placeholderTextColor="#ffffff40"
      />

      {/* OPIS */}
      <Text style={styles.label}>OPIS</Text>
      <TextInput
        style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
        value={description}
        onChangeText={setDescription}
        placeholder="Opis spotu..."
        placeholderTextColor="#ffffff40"
        multiline
      />

      {/* KATEGORIA */}
      <Text style={styles.label}>KATEGORIA</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        {(SPOT_CATEGORIES ?? ['parking', 'ulica', 'tor', 'inne']).map(cat => (
          <TouchableOpacity
            key={cat}
            style={[styles.catBtn, category === cat && styles.catBtnActive]}
            onPress={() => setCategory(cat)}
          >
            <Text style={[styles.catBtnText, category === cat && styles.catBtnTextActive]}>
              {cat.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ZAPISZ */}
      <TouchableOpacity
        style={[styles.saveBtn, loading && { opacity: 0.6 }]}
        onPress={handleSave}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.saveBtnText}>ZAPISZ ZMIANY</Text>}
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  headerRow:       { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  headerTitle:     { fontFamily: 'Orbitron', fontSize: 16, color: '#fff', letterSpacing: 2 },
  backBtn:         { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },
  label:           { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 11, marginBottom: 8, letterSpacing: 1 },
  input:           { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, color: '#fff', fontFamily: 'Orbitron', fontSize: 13, borderWidth: 1, borderColor: '#ffffff15', marginBottom: 20 },
  saveBtn:         { backgroundColor: '#e33835', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  saveBtnText:     { fontFamily: 'Orbitron', color: '#fff', fontSize: 13, letterSpacing: 1 },
  photoWrapper:    { position: 'relative', marginRight: 10 },
  photoThumb:      { width: 90, height: 90, borderRadius: 10 },
  removePhotoBtn:  { position: 'absolute', top: 4, right: 4, backgroundColor: '#e33835', borderRadius: 10, padding: 2 },
  newBadge:        { position: 'absolute', bottom: 4, left: 4, backgroundColor: '#4de926aa', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  newBadgeText:    { fontFamily: 'Orbitron', color: '#fff', fontSize: 7 },
  addPhotoBtn:     { width: 90, height: 90, backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#e3383540', justifyContent: 'center', alignItems: 'center' },
  addPhotoText:    { fontFamily: 'Orbitron', color: '#e33835', fontSize: 9, marginTop: 4 },
  catBtn:          { backgroundColor: '#1a1a1a', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: '#ffffff15' },
  catBtnActive:    { backgroundColor: '#e3383520', borderColor: '#e33835' },
  catBtnText:      { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 10 },
  catBtnTextActive:{ color: '#e33835' },
});