import React, { useState } from 'react';
import {
  View, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, Text,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker  from 'expo-image-picker';
import MaterialIcons     from '@expo/vector-icons/MaterialIcons';
import Toast             from 'react-native-toast-message';
import AsyncStorage      from '@react-native-async-storage/async-storage';
import { API_URL }       from '../../constants/config';
import { useTheme }      from '../../contexts/ThemeContext';
import { CATEGORIES }    from '../../constants/spotTypes';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function EditSpotScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { id, name: initName, description: initDesc, category: initCat, photos: initPhotosRaw } =
    useLocalSearchParams<{ id: string; name: string; description: string; category: string; photos: string }>();

  const initPhotos: string[] = initPhotosRaw ? JSON.parse(initPhotosRaw) : [];

  const [name,           setName]           = useState(initName ?? '');
  const [description,    setDescription]    = useState(initDesc  ?? '');
  const [category,       setCategory]       = useState(initCat   ?? '');
  const [existingPhotos, setExistingPhotos] = useState<string[]>(initPhotos);
  const [newPhotos,      setNewPhotos]      = useState<Array<{ uri: string; name: string; type: string }>>([]);
  const [photosToRemove, setPhotosToRemove] = useState<string[]>([]);
  const [loading,        setLoading]        = useState(false);

  const totalPhotos = existingPhotos.length + newPhotos.length;

  const pickPhoto = async () => {
    if (totalPhotos >= 5) { Toast.show({ type: 'error', text1: 'LIMIT', text2: 'Maksymalnie 5 zdjęć.' }); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ', text2: 'Zezwól na dostęp do galerii.' }); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 5 - totalPhotos, quality: 0.8 });
    if (!result.canceled) {
      const picked = result.assets.map(a => ({ uri: a.uri, name: a.fileName ?? `spot_${Date.now()}.jpg`, type: a.mimeType ?? 'image/jpeg' }));
      setNewPhotos(prev => [...prev, ...picked].slice(0, 5 - existingPhotos.length));
    }
  };

  const removeExisting = (url: string) => { setExistingPhotos(prev => prev.filter(p => p !== url)); setPhotosToRemove(prev => [...prev, url]); };
  const removeNew      = (uri: string) =>   setNewPhotos(prev => prev.filter(p => p.uri !== uri));

  const handleSave = async () => {
    if (!name.trim()) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nazwa spotu nie może być pusta.' }); return; }
    setLoading(true);
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('name',        name.trim());
      form.append('description', description.trim());
      form.append('category',    category);
      if (photosToRemove.length > 0) form.append('photosToRemove', JSON.stringify(photosToRemove));
      newPhotos.forEach(p => form.append('newPhotos', { uri: p.uri, name: p.name, type: p.type } as any));
      const res = await fetch(`${API_URL}/api/spots/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd serwera');
      Toast.show({ type: 'success', text1: '✅ ZAPISANO', text2: 'Spot zaktualizowany!' });
      router.back();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally { setLoading(false); }
  };

  const inputStyle = { backgroundColor: theme.surface3, borderRadius: 10, padding: 14, color: theme.text, fontFamily: 'Orbitron' as const, fontSize: 13, borderWidth: 1, borderColor: theme.border2, marginBottom: 20 };
  const labelStyle = { fontFamily: 'Orbitron' as const, color: theme.textDim, fontSize: 11, marginBottom: 8, letterSpacing: 1 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%' }} contentContainerStyle={{ paddingBottom: 80 }}>

      {/* NAGŁÓWEK */}
      <View style={{ marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 12 }}>← Wróć</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: theme.text, letterSpacing: 2 }}>EDYTUJ SPOT</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ZDJĘCIA */}
      <Text style={labelStyle}>ZDJĘCIA ({totalPhotos}/5)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        {existingPhotos.map((url, i) => (
          <View key={`ex_${i}`} style={{ position: 'relative', marginRight: 10 }}>
            <Image source={{ uri: url }} style={{ width: 90, height: 90, borderRadius: 10 }} />
            <TouchableOpacity style={{ position: 'absolute', top: 4, right: 4, backgroundColor: theme.primary, borderRadius: 10, padding: 2 }} onPress={() => removeExisting(url)}>
              <MaterialIcons name="close" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        {newPhotos.map((p, i) => (
          <View key={`new_${i}`} style={{ position: 'relative', marginRight: 10 }}>
            <Image source={{ uri: p.uri }} style={{ width: 90, height: 90, borderRadius: 10 }} />
            <View style={{ position: 'absolute', bottom: 4, left: 4, backgroundColor: '#4de926aa', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 7 }}>NOWE</Text>
            </View>
            <TouchableOpacity style={{ position: 'absolute', top: 4, right: 4, backgroundColor: theme.primary, borderRadius: 10, padding: 2 }} onPress={() => removeNew(p.uri)}>
              <MaterialIcons name="close" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        {totalPhotos < 5 && (
          <TouchableOpacity style={{ width: 90, height: 90, backgroundColor: theme.surface3, borderRadius: 10, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center' }} onPress={pickPhoto}>
            <MaterialIcons name="add-photo-alternate" size={28} color={theme.primary} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 9, marginTop: 4 }}>Dodaj</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Text style={labelStyle}>NAZWA</Text>
      <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="Nazwa spotu" placeholderTextColor={theme.textDim} />

      <Text style={labelStyle}>OPIS</Text>
      <TextInput style={[inputStyle, { height: 90, textAlignVertical: 'top' }]} value={description} onChangeText={setDescription} placeholder="Opis spotu..." placeholderTextColor={theme.textDim} multiline />

      <Text style={labelStyle}>KATEGORIA</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        {CATEGORIES.map(cat => (
          <TouchableOpacity
            key={cat}
            style={[
              { backgroundColor: theme.surface3, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: theme.border2 },
              category === cat && { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder },
            ]}
            onPress={() => setCategory(cat)}
          >
            <Text style={[{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10 }, category === cat && { color: theme.primary }]}>
              {cat.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity
        style={[{ backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 }, loading && { opacity: 0.6 }]}
        onPress={handleSave} disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 13, letterSpacing: 1 }}>ZAPISZ ZMIANY</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}