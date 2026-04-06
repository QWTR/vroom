import React, { useState } from 'react';
import {
  View, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Switch, Image, Text,
} from 'react-native';
import { useRouter }        from 'expo-router';
import * as ImagePicker     from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import MaterialIcons        from '@expo/vector-icons/MaterialIcons';
import Toast                from 'react-native-toast-message';
import AsyncStorage         from '@react-native-async-storage/async-storage';
import { API_URL }          from '../../constants/config';
import { useTheme }         from '../../contexts/ThemeContext';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface PhotoAsset { uri: string; name: string; type: string; }

async function compressImage(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri, [{ resize: { width: 1080 } }], { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

export default function AddCarScreen() {
  const router = useRouter();
  const { theme } = useTheme();

  const [brand,       setBrand]       = useState('');
  const [model,       setModel]       = useState('');
  const [year,        setYear]        = useState('');
  const [power,       setPower]       = useState('');
  const [engine,      setEngine]      = useState('');
  const [color,       setColor]       = useState('');
  const [mods,        setMods]        = useState('');
  const [isMain,      setIsMain]      = useState(false);
  const [photos,      setPhotos]      = useState<PhotoAsset[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [compressing, setCompressing] = useState(false);

  const processAndAddPhotos = async (assets: ImagePicker.ImagePickerAsset[]) => {
    setCompressing(true);
    try {
      const processed: PhotoAsset[] = await Promise.all(
        assets.map(async a => ({ uri: await compressImage(a.uri), name: a.fileName ?? `car_${Date.now()}.jpg`, type: 'image/jpeg' }))
      );
      setPhotos(prev => [...prev, ...processed].slice(0, 5));
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się przetworzyć zdjęć.' });
    } finally { setCompressing(false); }
  };

  const pickPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ', text2: 'Zezwól na dostęp do galerii.' }); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 5 - photos.length, quality: 1 });
    if (!result.canceled) await processAndAddPhotos(result.assets);
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ', text2: 'Zezwól na dostęp do aparatu.' }); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 1 });
    if (!result.canceled && result.assets[0]) await processAndAddPhotos(result.assets);
  };

  const removePhoto = (idx: number) => setPhotos(prev => prev.filter((_, i) => i !== idx));

  const handleAdd = async () => {
    if (!brand.trim()) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj markę auta.' }); return; }
    if (!model.trim()) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj model auta.' }); return; }
    setLoading(true);
    try {
      const token = await getToken();
      const specsParts = [year && `${year} r.`, power && `${power} KM`, engine && engine, color && color].filter(Boolean).join(' · ');
      const specs = specsParts || `${brand.trim()} ${model.trim()}`;
      const form  = new FormData();
      form.append('brand', `${brand.trim()} ${model.trim()}`);
      form.append('specs', specs);
      form.append('isMain', String(isMain));
      if (mods.trim()) form.append('mods', mods.trim());
      photos.forEach(p => form.append('photos', { uri: p.uri, name: p.name, type: p.type } as any));
      const res = await fetch(`${API_URL}/api/cars`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd serwera');
      Toast.show({ type: 'success', text1: '🚗 AUTO DODANE!', text2: `${brand} ${model} w Twoim garażu.` });
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
        <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: theme.text, letterSpacing: 2 }}>DODAJ AUTO</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ZDJĘCIA */}
      <Text style={labelStyle}>ZDJĘCIA ({photos.length}/5)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        {photos.map((p, i) => (
          <View key={i} style={{ position: 'relative', marginRight: 10 }}>
            <Image source={{ uri: p.uri }} style={{ width: 90, height: 90, borderRadius: 10 }} />
            <TouchableOpacity style={{ position: 'absolute', top: 4, right: 4, backgroundColor: theme.primary, borderRadius: 10, padding: 2 }} onPress={() => removePhoto(i)}>
              <MaterialIcons name="close" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        {compressing && (
          <View style={{ width: 90, height: 90, backgroundColor: theme.surface3, borderRadius: 10, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={theme.primary} size="small" />
            <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 9, marginTop: 6 }}>Kompresja...</Text>
          </View>
        )}
        {!compressing && photos.length < 5 && (
          <>
            <TouchableOpacity style={{ width: 90, height: 90, backgroundColor: theme.surface3, borderRadius: 10, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center' }} onPress={pickPhotos}>
              <MaterialIcons name="photo-library" size={26} color={theme.primary} />
              <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 9, marginTop: 4 }}>Galeria</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ width: 90, height: 90, backgroundColor: theme.surface3, borderRadius: 10, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center', marginLeft: 8 }} onPress={pickFromCamera}>
              <MaterialIcons name="photo-camera" size={26} color={theme.primary} />
              <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 9, marginTop: 4 }}>Aparat</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Text style={labelStyle}>MARKA *</Text>
      <TextInput style={inputStyle} value={brand} onChangeText={setBrand} placeholder="Np. BMW, Mercedes, Toyota..." placeholderTextColor={theme.textDim} />

      <Text style={labelStyle}>MODEL *</Text>
      <TextInput style={inputStyle} value={model} onChangeText={setModel} placeholder="Np. M4 Competition, AMG C63..." placeholderTextColor={theme.textDim} />

      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={labelStyle}>ROK</Text>
          <TextInput style={inputStyle} value={year} onChangeText={setYear} placeholder="2024" placeholderTextColor={theme.textDim} keyboardType="numeric" maxLength={4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={labelStyle}>MOC (KM)</Text>
          <TextInput style={inputStyle} value={power} onChangeText={setPower} placeholder="510" placeholderTextColor={theme.textDim} keyboardType="numeric" />
        </View>
      </View>

      <Text style={labelStyle}>SILNIK</Text>
      <TextInput style={inputStyle} value={engine} onChangeText={setEngine} placeholder="Np. 3.0 TwinTurbo, 2.0 TSI..." placeholderTextColor={theme.textDim} />

      <Text style={labelStyle}>KOLOR</Text>
      <TextInput style={inputStyle} value={color} onChangeText={setColor} placeholder="Np. Czarny mat, Frozen Red..." placeholderTextColor={theme.textDim} />

      <Text style={labelStyle}>MODYFIKACJE</Text>
      <TextInput style={[inputStyle, { height: 90, textAlignVertical: 'top' }]} value={mods} onChangeText={setMods} placeholder="Np. Stage 2 tune, exhaust, coilovers..." placeholderTextColor={theme.textDim} multiline />

      {/* GŁÓWNE AUTO */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, backgroundColor: theme.surface3, padding: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.border2 }}>
        <View>
          <Text style={labelStyle}>USTAW JAKO GŁÓWNE</Text>
          <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 9, marginTop: 3 }}>Wyświetlane na Twoim profilu</Text>
        </View>
        <Switch value={isMain} onValueChange={setIsMain} trackColor={{ true: theme.primary, false: theme.surface4 }} thumbColor="#fff" />
      </View>

      {/* PODGLĄD */}
      {(brand || model || year || power || engine) && (
        <View style={{ backgroundColor: theme.surface3, borderRadius: 10, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: theme.primaryBorder }}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 9, marginBottom: 8 }}>PODGLĄD</Text>
          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 16, marginBottom: 4 }}>{[brand, model].filter(Boolean).join(' ') || '—'}</Text>
          <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 11 }}>
            {[year && `${year} r.`, power && `${power} KM`, engine, color].filter(Boolean).join(' · ') || '—'}
          </Text>
        </View>
      )}

      {/* DODAJ */}
      <TouchableOpacity
        style={[{ backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 }, (loading || compressing) && { opacity: 0.6 }]}
        onPress={handleAdd} disabled={loading || compressing}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 13, letterSpacing: 1 }}>DODAJ AUTO 🚗</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}