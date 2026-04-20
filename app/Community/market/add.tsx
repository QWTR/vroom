import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, StatusBar, Platform, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';

const CATEGORIES   = ['auto', 'moto', 'części', 'inne'];
const DRIVE_OPTS   = ['FWD', 'RWD', 'AWD', '4x4'];
const TRANS_OPTS   = ['manualna', 'automatyczna'];

export default function AddListingScreen() {
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { theme, isDark } = useTheme();
  const isEdit = !!editId;

  const [title,        setTitle]        = useState('');
  const [category,     setCategory]     = useState('auto');
  const [brand,        setBrand]        = useState('');
  const [model,        setModel]        = useState('');
  const [year,         setYear]         = useState('');
  const [mileage,      setMileage]      = useState('');
  const [power,        setPower]        = useState('');
  const [drive,        setDrive]        = useState('');
  const [transmission, setTransmission] = useState('');
  const [color,        setColor]        = useState('');
  const [fuel,         setFuel]         = useState('');
  const [description,  setDescription]  = useState('');
  const [price,        setPrice]        = useState('');
  const [photos,       setPhotos]       = useState<string[]>([]);
  const [submitting,   setSubmitting]   = useState(false);
  const [loadingEdit,  setLoadingEdit]  = useState(false);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  // Load existing data when editing
  useEffect(() => {
    if (!isEdit) return;
    setLoadingEdit(true);
    (async () => {
      try {
        const token = await getToken();
        const r     = await fetch(`${API_URL}/api/market/${editId}`, { headers: { Authorization: `Bearer ${token}` } });
        const data  = await r.json();
        setTitle(data.title ?? '');
        setCategory(data.category ?? 'auto');
        setBrand(data.brand ?? '');
        setModel(data.model ?? '');
        setYear(data.year?.toString() ?? '');
        setMileage(data.mileage?.toString() ?? '');
        setPower(data.power?.toString() ?? '');
        setDrive(data.drive ?? '');
        setTransmission(data.transmission ?? '');
        setColor(data.color ?? '');
        setFuel(data.fuel ?? '');
        setDescription(data.description ?? '');
        setPrice(data.price?.toString() ?? '');
        setPhotos(data.photos ?? []);
      } catch (e) {
        console.error('loadEdit:', e);
        Toast.show({ type: 'error', text1: 'Błąd ładowania danych' });
      } finally {
        setLoadingEdit(false);
      }
    })();
  }, [editId]);

  const pickPhoto = async () => {
    if (photos.length >= 10) {
      Alert.alert('Limit zdjęć', 'Możesz dodać maksymalnie 10 zdjęć.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (!result.canceled) {
      const newUris = result.assets.map(a => a.uri);
      setPhotos(prev => [...prev, ...newUris].slice(0, 10));
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const validate = (): string | null => {
    if (!title.trim()) return 'Tytuł jest wymagany.';
    if (!price.trim() || isNaN(Number(price)) || Number(price) <= 0) return 'Prawidłowa cena jest wymagana.';
    if (photos.length === 0) return 'Dodaj co najmniej jedno zdjęcie.';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { Toast.show({ type: 'error', text1: 'Błąd walidacji', text2: err }); return; }

    setSubmitting(true);
    try {
      const token    = await getToken();
      const formData = new FormData();

      formData.append('title',    title.trim());
      formData.append('category', category);
      formData.append('price',    price);
      if (brand)        formData.append('brand',        brand);
      if (model)        formData.append('model',        model);
      if (year)         formData.append('year',         year);
      if (mileage)      formData.append('mileage',      mileage);
      if (power)        formData.append('power',        power);
      if (drive)        formData.append('drive',        drive);
      if (transmission) formData.append('transmission', transmission);
      if (color)        formData.append('color',        color);
      if (fuel)         formData.append('fuel',         fuel);
      if (description)  formData.append('description',  description.trim());

      // Only append new (local) photos — http(s) URLs are existing server photos
      const newPhotos = photos.filter(p => !p.startsWith('http'));
      for (const uri of newPhotos) {
        const filename = uri.split('/').pop() ?? 'photo.jpg';
        const ext      = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
        const type     = ext === 'png' ? 'image/png' : 'image/jpeg';
        formData.append('photos', { uri, name: filename, type } as any);
      }

      const method = isEdit ? 'PUT' : 'POST';
      const url    = isEdit ? `${API_URL}/api/market/${editId}` : `${API_URL}/api/market`;

      const r = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!r.ok) throw new Error('Błąd zapisu');

      Toast.show({ type: 'success', text1: isEdit ? '✅ Ogłoszenie zaktualizowane' : '✅ Ogłoszenie dodane', text2: 'Pomyślnie!' });
      router.back();
    } catch (e) {
      console.error('handleSubmit:', e);
      Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie udało się zapisać ogłoszenia.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingEdit) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />

      {/* Header */}
      <View style={{ paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <TouchableOpacity
          style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={18} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 4 }}>VROOM GIEŁDA</Text>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 18, fontWeight: '700', letterSpacing: 1 }}>
            {isEdit ? 'EDYTUJ' : 'DODAJ OGŁOSZENIE'}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 40 }}>

        {/* Photos */}
        <FormSection label="ZDJĘCIA" required>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {photos.map((uri, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Image source={{ uri }} style={{ width: 90, height: 90, borderRadius: 12, borderWidth: 1, borderColor: theme.border }} contentFit="cover" />
                  {i === 0 && (
                    <View style={{ position: 'absolute', top: 4, left: 4, backgroundColor: theme.primary, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 }}>
                      <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 6, fontWeight: '700' }}>GŁÓWNE</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.bg }}
                    onPress={() => removePhoto(i)}
                  >
                    <Feather name="x" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < 10 && (
                <TouchableOpacity
                  style={{ width: 90, height: 90, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.border, alignItems: 'center', justifyContent: 'center', gap: 4 }}
                  onPress={pickPhoto}
                >
                  <Feather name="plus" size={24} color={theme.textDim} />
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7 }}>DODAJ</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, marginTop: 6 }}>
            Min. 1, max. 10 zdjęć • Pierwsze zdjęcie to miniatura
          </Text>
        </FormSection>

        {/* Title */}
        <FormSection label="TYTUŁ OGŁOSZENIA" required>
          <FieldInput value={title} onChangeText={setTitle} placeholder="np. BMW M3 E46 2003r stan idealny" theme={theme} />
        </FormSection>

        {/* Category */}
        <FormSection label="KATEGORIA" required>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat}
                style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, backgroundColor: category === cat ? theme.primary : theme.surface2, borderWidth: 1, borderColor: category === cat ? theme.primary : theme.border }}
                onPress={() => setCategory(cat)}
              >
                <Text style={{ color: category === cat ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>{cat.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </FormSection>

        {/* Brand + Model */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <FormSection label="MARKA">
              <FieldInput value={brand} onChangeText={setBrand} placeholder="BMW" theme={theme} />
            </FormSection>
          </View>
          <View style={{ flex: 1 }}>
            <FormSection label="MODEL">
              <FieldInput value={model} onChangeText={setModel} placeholder="M3" theme={theme} />
            </FormSection>
          </View>
        </View>

        {/* Year + Mileage */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <FormSection label="ROK">
              <FieldInput value={year} onChangeText={setYear} placeholder="2003" theme={theme} keyboardType="numeric" />
            </FormSection>
          </View>
          <View style={{ flex: 1 }}>
            <FormSection label="PRZEBIEG (km)">
              <FieldInput value={mileage} onChangeText={setMileage} placeholder="150000" theme={theme} keyboardType="numeric" />
            </FormSection>
          </View>
        </View>

        {/* Power */}
        <FormSection label="MOC (KM)">
          <FieldInput value={power} onChangeText={setPower} placeholder="343" theme={theme} keyboardType="numeric" />
        </FormSection>

        {/* Drive */}
        <FormSection label="NAPĘD">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {DRIVE_OPTS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: drive === opt ? theme.primary : theme.surface2, borderWidth: 1, borderColor: drive === opt ? theme.primary : theme.border }}
                onPress={() => setDrive(drive === opt ? '' : opt)}
              >
                <Text style={{ color: drive === opt ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </FormSection>

        {/* Transmission */}
        <FormSection label="SKRZYNIA BIEGÓW">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {TRANS_OPTS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={{ flex: 1, paddingVertical: 9, borderRadius: 20, alignItems: 'center', backgroundColor: transmission === opt ? theme.primary : theme.surface2, borderWidth: 1, borderColor: transmission === opt ? theme.primary : theme.border }}
                onPress={() => setTransmission(transmission === opt ? '' : opt)}
              >
                <Text style={{ color: transmission === opt ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{opt.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </FormSection>

        {/* Color + Fuel */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <FormSection label="KOLOR">
              <FieldInput value={color} onChangeText={setColor} placeholder="Czarny" theme={theme} />
            </FormSection>
          </View>
          <View style={{ flex: 1 }}>
            <FormSection label="PALIWO">
              <FieldInput value={fuel} onChangeText={setFuel} placeholder="Benzyna" theme={theme} />
            </FormSection>
          </View>
        </View>

        {/* Description */}
        <FormSection label="OPIS">
          <TextInput
            style={{
              color: theme.text, fontFamily: 'Orbitron', fontSize: 12,
              backgroundColor: theme.surface2, borderRadius: 12, borderWidth: 1,
              borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12,
              minHeight: 100, textAlignVertical: 'top',
            }}
            placeholder="Opisz pojazd lub część..."
            placeholderTextColor={theme.textDim}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={2000}
          />
        </FormSection>

        {/* Price */}
        <FormSection label="CENA (PLN)" required>
          <FieldInput value={price} onChangeText={setPrice} placeholder="45000" theme={theme} keyboardType="numeric" />
        </FormSection>

        {/* Submit */}
        <TouchableOpacity
          style={{
            paddingVertical: 16, borderRadius: 16, backgroundColor: theme.primary,
            alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10,
            shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
            opacity: submitting ? 0.7 : 1,
          }}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <>
                <MaterialCommunityIcons name="check-circle-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>
                  {isEdit ? 'ZAPISZ ZMIANY' : 'OPUBLIKUJ OGŁOSZENIE'}
                </Text>
              </>
          }
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function FormSection({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>{label}</Text>
        {required && <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9 }}>*</Text>}
      </View>
      {children}
    </View>
  );
}

function FieldInput({ value, onChangeText, placeholder, theme, keyboardType }: { value: string; onChangeText: (v: string) => void; placeholder: string; theme: any; keyboardType?: any }) {
  return (
    <TextInput
      style={{
        color: theme.text, fontFamily: 'Orbitron', fontSize: 12,
        backgroundColor: theme.surface2, borderRadius: 10, borderWidth: 1,
        borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12,
      }}
      placeholder={placeholder}
      placeholderTextColor={theme.textDim}
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType ?? 'default'}
    />
  );
}
