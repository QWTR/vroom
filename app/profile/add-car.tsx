import React, { useState } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Switch, Image,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../../constants/config';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface PhotoAsset { uri: string; name: string; type: string; }

export default function AddCarScreen() {
  const router = useRouter();

  const [brand,   setBrand]   = useState('');
  const [model,   setModel]   = useState('');
  const [year,    setYear]    = useState('');
  const [power,   setPower]   = useState('');
  const [engine,  setEngine]  = useState('');
  const [color,   setColor]   = useState('');
  const [mods,    setMods]    = useState('');
  const [isMain,  setIsMain]  = useState(false);
  const [photos,  setPhotos]  = useState<PhotoAsset[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Zdjęcia ───────────────────────────────────────────────────────────────
  const pickPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ', text2: 'Zezwól na dostęp do galerii.' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:              ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit:          5 - photos.length,
      quality:                 0.8,
    });
    if (!result.canceled) {
      const picked: PhotoAsset[] = result.assets.map(a => ({
        uri:  a.uri,
        name: a.fileName ?? `car_${Date.now()}.jpg`,
        type: a.mimeType ?? 'image/jpeg',
      }));
      setPhotos(prev => [...prev, ...picked].slice(0, 5));
    }
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ', text2: 'Zezwól na dostęp do aparatu.' });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true, quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      setPhotos(prev => [...prev, {
        uri:  a.uri,
        name: a.fileName ?? `car_${Date.now()}.jpg`,
        type: a.mimeType ?? 'image/jpeg',
      }].slice(0, 5));
    }
  };

  const removePhoto = (idx: number) => setPhotos(prev => prev.filter((_, i) => i !== idx));

  // ── Wyślij ────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!brand.trim()) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj markę auta.' });
      return;
    }
    if (!model.trim()) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj model auta.' });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();

      // specs = złożone z pól szczegółowych
      const specsParts = [
        year   && `${year} r.`,
        power  && `${power} KM`,
        engine && engine,
        color  && color,
      ].filter(Boolean).join(' · ');

      const specs = specsParts || `${brand.trim()} ${model.trim()}`;

      const form = new FormData();
      form.append('brand',  `${brand.trim()} ${model.trim()}`);
      form.append('specs',  specs);
      form.append('isMain', String(isMain));
      if (mods.trim()) form.append('mods', mods.trim());

      photos.forEach(p => {
        form.append('photos', { uri: p.uri, name: p.name, type: p.type } as any);
      });

      const res = await fetch(`${API_URL}/api/cars`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    form,
      });

      if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd serwera');

      Toast.show({ type: 'success', text1: '🚗 AUTO DODANE!', text2: `${brand} ${model} w Twoim garażu.` });
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
        <Text style={styles.headerTitle}>DODAJ AUTO</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ZDJĘCIA */}
      <Text style={styles.label}>ZDJĘCIA ({photos.length}/5)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        {photos.map((p, i) => (
          <View key={i} style={styles.photoWrapper}>
            <Image source={{ uri: p.uri }} style={styles.photoThumb} />
            <TouchableOpacity style={styles.removePhotoBtn} onPress={() => removePhoto(i)}>
              <MaterialIcons name="close" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        {photos.length < 5 && (
          <>
            <TouchableOpacity style={styles.addPhotoBtn} onPress={pickPhotos}>
              <MaterialIcons name="photo-library" size={26} color="#e33835" />
              <Text style={styles.addPhotoText}>Galeria</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.addPhotoBtn, { marginLeft: 8 }]} onPress={pickFromCamera}>
              <MaterialIcons name="photo-camera" size={26} color="#e33835" />
              <Text style={styles.addPhotoText}>Aparat</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* MARKA */}
      <Text style={styles.label}>MARKA *</Text>
      <TextInput
        style={styles.input}
        value={brand}
        onChangeText={setBrand}
        placeholder="Np. BMW, Mercedes, Toyota..."
        placeholderTextColor="#ffffff40"
      />

      {/* MODEL */}
      <Text style={styles.label}>MODEL *</Text>
      <TextInput
        style={styles.input}
        value={model}
        onChangeText={setModel}
        placeholder="Np. M4 Competition, AMG C63..."
        placeholderTextColor="#ffffff40"
      />

      {/* ROK + MOC w jednej linii */}
      <View style={styles.rowInputs}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.label}>ROK</Text>
          <TextInput
            style={styles.input}
            value={year}
            onChangeText={setYear}
            placeholder="2024"
            placeholderTextColor="#ffffff40"
            keyboardType="numeric"
            maxLength={4}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>MOC (KM)</Text>
          <TextInput
            style={styles.input}
            value={power}
            onChangeText={setPower}
            placeholder="510"
            placeholderTextColor="#ffffff40"
            keyboardType="numeric"
          />
        </View>
      </View>

      {/* SILNIK */}
      <Text style={styles.label}>SILNIK</Text>
      <TextInput
        style={styles.input}
        value={engine}
        onChangeText={setEngine}
        placeholder="Np. 3.0 TwinTurbo, 2.0 TSI..."
        placeholderTextColor="#ffffff40"
      />

      {/* KOLOR */}
      <Text style={styles.label}>KOLOR</Text>
      <TextInput
        style={styles.input}
        value={color}
        onChangeText={setColor}
        placeholder="Np. Czarny mat, Frozen Red..."
        placeholderTextColor="#ffffff40"
      />

      {/* MODYFIKACJE */}
      <Text style={styles.label}>MODYFIKACJE</Text>
      <TextInput
        style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
        value={mods}
        onChangeText={setMods}
        placeholder="Np. Stage 2 tune, exhaust, coilovers..."
        placeholderTextColor="#ffffff40"
        multiline
      />

      {/* GŁÓWNE AUTO */}
      <View style={styles.switchRow}>
        <View>
          <Text style={styles.label}>USTAW JAKO GŁÓWNE</Text>
          <Text style={styles.switchSub}>Wyświetlane na Twoim profilu</Text>
        </View>
        <Switch
          value={isMain}
          onValueChange={setIsMain}
          trackColor={{ true: '#e33835', false: '#333' }}
          thumbColor="#fff"
        />
      </View>

      {/* PODGLĄD SPECS */}
      {(brand || model || year || power || engine) && (
        <View style={styles.previewBox}>
          <Text style={styles.previewLabel}>PODGLĄD</Text>
          <Text style={styles.previewBrand}>{[brand, model].filter(Boolean).join(' ') || '—'}</Text>
          <Text style={styles.previewSpecs}>
            {[year && `${year} r.`, power && `${power} KM`, engine, color]
              .filter(Boolean).join(' · ') || '—'}
          </Text>
        </View>
      )}

      {/* DODAJ */}
      <TouchableOpacity
        style={[styles.saveBtn, loading && { opacity: 0.6 }]}
        onPress={handleAdd}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.saveBtnText}>DODAJ AUTO 🚗</Text>}
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  headerRow:      { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  headerTitle:    { fontFamily: 'Orbitron', fontSize: 16, color: '#fff', letterSpacing: 2 },
  backBtn:        { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },
  label:          { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 11, marginBottom: 8, letterSpacing: 1 },
  input:          { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, color: '#fff', fontFamily: 'Orbitron', fontSize: 13, borderWidth: 1, borderColor: '#ffffff15', marginBottom: 20 },
  rowInputs:      { flexDirection: 'row' },
  switchRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, backgroundColor: '#1a1a1a', padding: 16, borderRadius: 10, borderWidth: 1, borderColor: '#ffffff15' },
  switchSub:      { fontFamily: 'Orbitron', color: '#ffffff30', fontSize: 9, marginTop: 3 },
  saveBtn:        { backgroundColor: '#e33835', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  saveBtnText:    { fontFamily: 'Orbitron', color: '#fff', fontSize: 13, letterSpacing: 1 },
  photoWrapper:   { position: 'relative', marginRight: 10 },
  photoThumb:     { width: 90, height: 90, borderRadius: 10 },
  removePhotoBtn: { position: 'absolute', top: 4, right: 4, backgroundColor: '#e33835', borderRadius: 10, padding: 2 },
  addPhotoBtn:    { width: 90, height: 90, backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#e3383540', justifyContent: 'center', alignItems: 'center' },
  addPhotoText:   { fontFamily: 'Orbitron', color: '#e33835', fontSize: 9, marginTop: 4 },
  previewBox:     { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#e3383530' },
  previewLabel:   { fontFamily: 'Orbitron', color: '#ffffff30', fontSize: 9, marginBottom: 8 },
  previewBrand:   { fontFamily: 'Orbitron', color: '#fff', fontSize: 16, marginBottom: 4 },
  previewSpecs:   { fontFamily: 'Orbitron', color: '#e33835', fontSize: 11 },
});