import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Image } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../components/ui/AppText';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker  from 'expo-image-picker';
import MaterialIcons     from '@expo/vector-icons/MaterialIcons';
import Toast             from 'react-native-toast-message';
import AsyncStorage      from '@react-native-async-storage/async-storage';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { API_URL }       from '../../constants/config';
import { useTheme }      from '../../contexts/ThemeContext';
import { useEffectivePremium } from '../../hooks/useEffectivePremium';
import { PREFERRED_FUEL_OPTIONS, normalizePreferredFuel, type PreferredFuelKey } from '../../lib/fuelDisplayPrice';
import { launchRecoverableCameraAsync, useRecoveredImagePickerResult } from '../../lib/recoverableImagePicker';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface PhotoAsset { uri: string; name: string; type: string; }

type CarPhotoItem = {
  key: string;
  kind: 'existing' | 'new';
  uri: string;
  asset?: PhotoAsset;
};

function toExistingItems(urls: string[]): CarPhotoItem[] {
  return urls.map((uri, i) => ({ key: `ex-${uri}-${i}`, kind: 'existing', uri }));
}

export default function EditCarScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { isPremium } = useEffectivePremium();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [brand,          setBrand]          = useState('');
  const [model,          setModel]          = useState('');
  const [year,           setYear]           = useState('');
  const [power,          setPower]          = useState('');
  const [engine,         setEngine]         = useState('');
  const [color,          setColor]          = useState('');
  const [mods,           setMods]           = useState('');
  const [preferredFuel,  setPreferredFuel]  = useState<PreferredFuelKey>('pb95');
  const [isMain,         setIsMain]         = useState(false);
  const [photoItems,     setPhotoItems]     = useState<CarPhotoItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res   = await fetch(`${API_URL}/api/cars/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('Błąd pobierania');
        const car = await res.json();

        // brand = "BMW M4 Competition" → brand="BMW", model="M4 Competition"
        const parts = (car.brand as string).split(' ');
        setBrand(parts[0] ?? '');
        setModel(parts.slice(1).join(' ') ?? '');

        // Nowe pola z bazy — jeśli są, użyj ich; jeśli nie (stare wpisy), parsuj specs
        if (car.year)   setYear(String(car.year));
        else {
          const yearMatch = (car.specs ?? '').match(/(\d{4})\s*r\./);
          if (yearMatch) setYear(yearMatch[1]);
        }
        if (car.power)  setPower(String(car.power));
        else {
          const powerMatch = (car.specs ?? '').match(/(\d+)\s*KM/);
          if (powerMatch) setPower(powerMatch[1]);
        }
        if (car.engine) setEngine(car.engine);
        else {
          const remaining = (car.specs ?? '')
            .replace(/\d{4}\s*r\./, '').replace(/\d+\s*KM/, '')
            .split('·').map((s: string) => s.trim()).filter(Boolean);
          if (remaining[0]) setEngine(remaining[0]);
        }
        if (car.color)  setColor(car.color);
        else {
          const remaining = (car.specs ?? '')
            .replace(/\d{4}\s*r\./, '').replace(/\d+\s*KM/, '')
            .split('·').map((s: string) => s.trim()).filter(Boolean);
          if (remaining[1]) setColor(remaining[1]);
        }
        if (car.mods)   setMods(car.mods);

        setPreferredFuel(normalizePreferredFuel(car.preferredFuel) ?? 'pb95');
        setIsMain(car.isMain ?? false);
        setPhotoItems(toExistingItems(car.photos ?? []));
      } catch (e: any) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
        router.back();
      } finally { setLoading(false); }
    })();
  }, [id]);

  const totalPhotos = photoItems.length;
  const cameraPurpose = `edit-car-photo:${id}`;
  const photoBtnStyle = { width: 90, height: 90, backgroundColor: theme.surface3, borderRadius: 10, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center' as const, alignItems: 'center' as const };

  const pickPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 5 - totalPhotos, quality: 0.8 });
    if (!result.canceled) {
      const picked: CarPhotoItem[] = result.assets.map((a, i) => {
        const asset: PhotoAsset = { uri: a.uri, name: a.fileName ?? `car_edit_${Date.now()}_${i}.jpg`, type: a.mimeType ?? 'image/jpeg' };
        return { key: `new-${asset.uri}-${Date.now()}-${i}`, kind: 'new', uri: asset.uri, asset };
      });
      setPhotoItems(prev => [...prev, ...picked].slice(0, 5));
    }
  };

  const addCameraResult = useCallback((result: ImagePicker.ImagePickerResult) => {
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      const asset: PhotoAsset = { uri: a.uri, name: a.fileName ?? `car_edit_${Date.now()}.jpg`, type: a.mimeType ?? 'image/jpeg' };
      const item: CarPhotoItem = { key: `new-${asset.uri}-${Date.now()}`, kind: 'new', uri: asset.uri, asset };
      setPhotoItems(prev => [...prev, item].slice(0, 5));
    }
  }, []);

  useRecoveredImagePickerResult(cameraPurpose, addCameraResult);

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Toast.show({ type: 'error', text1: 'BRAK UPRAWNIEŃ' }); return; }
    const result = await launchRecoverableCameraAsync(cameraPurpose, { allowsEditing: true, quality: 0.8 });
    addCameraResult(result);
  };

  const removePhoto = (key: string) => setPhotoItems(prev => prev.filter(p => p.key !== key));

  const renderPhotoItem = useCallback(({ item, drag, isActive }: RenderItemParams<CarPhotoItem>) => (
    <ScaleDecorator>
      <TouchableOpacity
        onLongPress={drag}
        disabled={isActive}
        activeOpacity={0.9}
        style={{ marginRight: 10, opacity: isActive ? 0.85 : 1 }}
      >
        <View style={{ position: 'relative' }}>
          <Image source={{ uri: item.uri }} style={{ width: 90, height: 90, borderRadius: 10 }} />
          <View style={{
            position: 'absolute', bottom: 4, left: 4,
            backgroundColor: item.kind === 'existing' ? '#00000080' : theme.primaryBg,
            borderRadius: 6, padding: 3,
            borderWidth: item.kind === 'new' ? 1 : 0,
            borderColor: theme.primaryBorder,
          }}>
            <MaterialIcons
              name={item.kind === 'existing' ? 'cloud-done' : 'fiber-new'}
              size={9}
              color={item.kind === 'existing' ? '#4de926' : theme.primary}
            />
          </View>
          <View style={{
            position: 'absolute', bottom: 4, right: 4,
            backgroundColor: '#00000080', borderRadius: 6, padding: 3,
          }}>
            <MaterialIcons name="drag-indicator" size={9} color="#fff" />
          </View>
          <TouchableOpacity
            style={{ position: 'absolute', top: 4, right: 4, backgroundColor: theme.primary, borderRadius: 10, padding: 2 }}
            onPress={() => removePhoto(item.key)}
          >
            <MaterialIcons name="close" size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </ScaleDecorator>
  ), [theme]);

  const photoListHeader = useMemo(() => (
    totalPhotos < 5 ? (
      <>
        <TouchableOpacity style={photoBtnStyle} onPress={pickPhotos}>
          <MaterialIcons name="photo-library" size={26} color={theme.primary} />
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.primary, fontSize: 12, marginTop: 4 }}>Galeria</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[photoBtnStyle, { marginLeft: 8 }]} onPress={pickFromCamera}>
          <MaterialIcons name="photo-camera" size={26} color={theme.primary} />
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.primary, fontSize: 12, marginTop: 4 }}>Aparat</Text>
        </TouchableOpacity>
      </>
    ) : null
  ), [totalPhotos, theme, photoBtnStyle, pickPhotos, pickFromCamera]);

  const handleSave = async () => {
    if (!brand.trim()) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj markę.' }); return; }
    if (!model.trim()) { Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj model.' }); return; }
    setSaving(true);
    try {
      const token      = await getToken();
      const specsParts = [year && `${year} r.`, power && `${power} KM`, engine && engine, color && color].filter(Boolean).join(' · ');
      const specs      = specsParts || `${brand.trim()} ${model.trim()}`;
      const existingPhotos = photoItems.filter(p => p.kind === 'existing').map(p => p.uri);
      const newPhotos = photoItems.filter(p => p.kind === 'new').map(p => p.asset!);
      const photoOrder = photoItems.map(p => (p.kind === 'existing' ? { t: 'e', u: p.uri } : { t: 'n' }));
      const form       = new FormData();
      form.append('brand',      `${brand.trim()} ${model.trim()}`);
      form.append('specs',      specs);
      form.append('isMain',     String(isMain));
      form.append('keepPhotos', JSON.stringify(existingPhotos));
      form.append('photoOrder', JSON.stringify(photoOrder));
      if (year.trim())   form.append('year',   year.trim());
      if (power.trim())  form.append('power',  power.trim());
      if (engine.trim()) form.append('engine', engine.trim());
      if (color.trim())  form.append('color',  color.trim());
      if (mods.trim())   form.append('mods',   mods.trim());
      form.append('preferredFuel', preferredFuel);
      newPhotos.forEach(p => form.append('newPhotos', { uri: p.uri, name: p.name, type: p.type } as any));
      const res = await fetch(`${API_URL}/api/cars/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd serwera');
      Toast.show({ type: 'success', text1: '✅ ZAPISANO' });
      router.back();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally { setSaving(false); }
  };

  const inputStyle    = { backgroundColor: theme.surface3, borderRadius: 10, padding: 14, color: theme.text, fontFamily: 'Manrope_600SemiBold' as const, fontSize: 13, borderWidth: 1, borderColor: theme.border2, marginBottom: 20 };
  const labelStyle    = { fontFamily: 'Manrope_600SemiBold' as const, color: theme.textDim, fontSize: 12, marginBottom: 8, letterSpacing: 1 };

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%' }} contentContainerStyle={{ paddingBottom: 80 }}>

      {/* NAGŁÓWEK */}
      <View style={{ marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.primary, fontSize: 12 }}>← Wróć</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: theme.text, letterSpacing: 1 }}>EDYTUJ AUTO</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ZDJĘCIA */}
      <Text style={labelStyle}>ZDJĘCIA ({totalPhotos}/5)</Text>
      <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textFaint, fontSize: 12, marginBottom: 10 }}>
        Przytrzymaj zdjęcie i przeciągnij, aby zmienić kolejność
      </Text>
      <GestureHandlerRootView style={{ marginBottom: 20 }}>
        <DraggableFlatList
          data={photoItems}
          keyExtractor={item => item.key}
          renderItem={renderPhotoItem}
          onDragEnd={({ data }) => setPhotoItems(data)}
          horizontal
          showsHorizontalScrollIndicator={false}
          containerStyle={{ flexGrow: 0 }}
          ListFooterComponent={photoListHeader}
        />
      </GestureHandlerRootView>

      {isPremium && (
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/profile/car-maintenance', params: { id: String(id), brand: `${brand} ${model}`.trim() } } as any)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: '#FFD70012', borderRadius: 12, padding: 14, marginBottom: 20,
            borderWidth: 1, borderColor: '#FFD70040',
          }}
        >
          <MaterialIcons name="build-circle" size={22} color="#FFD700" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700' }}>Dziennik serwisowy</Text>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 3 }}>Przegląd, OC, serwisy i naprawy</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color="#FFD700" />
        </TouchableOpacity>
      )}

      <Text style={labelStyle}>MARKA *</Text>
      <TextInput style={inputStyle} value={brand} onChangeText={setBrand} placeholder="Np. BMW, Mercedes..." placeholderTextColor={theme.textDim} />

      <Text style={labelStyle}>MODEL *</Text>
      <TextInput style={inputStyle} value={model} onChangeText={setModel} placeholder="Np. M4 Competition..." placeholderTextColor={theme.textDim} />

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
      <TextInput style={inputStyle} value={engine} onChangeText={setEngine} placeholder="Np. 3.0 TwinTurbo..." placeholderTextColor={theme.textDim} />

      <Text style={labelStyle}>KOLOR</Text>
      <TextInput style={inputStyle} value={color} onChangeText={setColor} placeholder="Np. Czarny mat..." placeholderTextColor={theme.textDim} />

      <Text style={labelStyle}>MODYFIKACJE</Text>
      <TextInput style={[inputStyle, { height: 90, textAlignVertical: 'top' }]} value={mods} onChangeText={setMods} placeholder="Np. Stage 2, exhaust, coilovers..." placeholderTextColor={theme.textDim} multiline />

      <Text style={labelStyle}>TYP PALIWA (PINY NA MAPIE)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {PREFERRED_FUEL_OPTIONS.map((opt) => {
          const active = preferredFuel === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              onPress={() => setPreferredFuel(opt.key)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: active ? theme.primary : theme.border2,
                backgroundColor: active ? theme.primaryBg : theme.surface3,
              }}
            >
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: active ? theme.primary : theme.textDim }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* GŁÓWNE */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, backgroundColor: theme.surface3, padding: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.border2 }}>
        <View>
          <Text style={labelStyle}>USTAW JAKO GŁÓWNE</Text>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textFaint, fontSize: 12, marginTop: 3 }}>Wyświetlane na Twoim profilu</Text>
        </View>
        <Switch value={isMain} onValueChange={setIsMain} trackColor={{ true: theme.primary, false: theme.surface4 }} thumbColor="#fff" />
      </View>

      {/* PODGLĄD */}
      {(brand || model || year || power || engine) && (
        <View style={{ backgroundColor: theme.surface3, borderRadius: 10, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: theme.primaryBorder }}>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textFaint, fontSize: 12, marginBottom: 8 }}>PODGLĄD</Text>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 16, marginBottom: 4 }}>{[brand, model].filter(Boolean).join(' ') || '—'}</Text>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.primary, fontSize: 12 }}>
            {[year && `${year} r.`, power && `${power} KM`, engine, color].filter(Boolean).join(' · ') || '—'}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[{ backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 }, saving && { opacity: 0.6 }]}
        onPress={handleSave} disabled={saving}
      >
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#fff', fontSize: 13, letterSpacing: 1 }}>ZAPISZ ZMIANY ✅</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}
