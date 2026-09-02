import React, { useState, useEffect, useRef } from 'react';
import { View, ScrollView, TouchableOpacity, FlatList, ActivityIndicator, StatusBar, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../components/ui/AppText';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import type { AppTheme } from '../../../constants/theme';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';

const CATEGORIES   = ['auto', 'moto', 'części', 'inne'];
const CATEGORY_FROM_API: Record<string, string> = {
  car: 'auto',
  auto: 'auto',
  motorcycle: 'moto',
  moto: 'moto',
  parts: 'części',
  części: 'części',
  czesci: 'części',
  other: 'inne',
  inne: 'inne',
};
const DRIVE_OPTS   = ['FWD', 'RWD', 'AWD', '4x4'];
const TRANS_OPTS   = ['manualna', 'automatyczna'];
const FUEL_OPTS    = ['benzyna', 'diesel', 'LPG', 'hybryda', 'elektryczny', 'inne'];
const MAX_PHOTOS   = 10;

export default function AddListingScreen() {
  const router = useRouter();
  const { editId, paidSlotId: paidSlotParam } = useLocalSearchParams<{ editId?: string; paidSlotId?: string }>();
  const { theme, isDark } = useTheme();
  const isEdit = !!editId;
  const [paidSlotId, setPaidSlotId] = useState<string | null>(
    paidSlotParam ? String(paidSlotParam) : null,
  );

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
  const [locationText, setLocationText] = useState('');
  const [listingLat,   setListingLat]   = useState<number | null>(null);
  const [listingLng,   setListingLng]   = useState<number | null>(null);
  const [locLoading,   setLocLoading]   = useState(false);
  const [photos,       setPhotos]       = useState<string[]>([]);
  const originalPhotosRef = React.useRef<string[]>([]);
  const [submitting,   setSubmitting]   = useState(false);
  const [loadingEdit,  setLoadingEdit]  = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const fieldYRef = useRef<Record<string, number>>({});

  const scrollFieldIntoView = (key: string) => {
    const y = fieldYRef.current[key];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  };

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  useEffect(() => {
    if (paidSlotParam) setPaidSlotId(String(paidSlotParam));
  }, [paidSlotParam]);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      (async () => {
        const stored = await AsyncStorage.getItem('marketPaidSlotId');
        if (active && stored) setPaidSlotId(stored);
      })();
      return () => { active = false; };
    }, []),
  );

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
        setCategory(CATEGORY_FROM_API[String(data.category || '').toLowerCase()] ?? 'auto');
        setBrand(data.brand ?? '');
        setModel(data.model ?? '');
        setYear(data.year?.toString() ?? '');
        setMileage(data.mileage?.toString() ?? '');
        setPower(data.power?.toString() ?? '');
        setDrive(data.drive ?? '');
        setTransmission(data.transmission ?? '');
        setColor(data.color ?? '');
        setFuel(data.fuelType ?? data.fuel ?? '');
        setDescription(data.description ?? '');
        setPrice(data.price?.toString() ?? '');
        setLocationText(data.location ?? '');
        setListingLat(data.lat ?? null);
        setListingLng(data.lng ?? null);
        setPhotos(data.photos ?? []);
        originalPhotosRef.current = data.photos ?? [];
      } catch (e) {
        console.error('loadEdit:', e);
        Toast.show({ type: 'error', text1: 'Błąd ładowania danych' });
      } finally {
        setLoadingEdit(false);
      }
    })();
  }, [editId]);

  const pickPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Limit zdjęć', `Możesz dodać maksymalnie ${MAX_PHOTOS} zdjęć.`);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (!result.canceled) {
      const newUris = result.assets.map(a => a.uri);
      setPhotos(prev => [...prev, ...newUris].slice(0, MAX_PHOTOS));
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const validate = (): string | null => {
    if (!title.trim()) return 'Tytuł jest wymagany.';
    if (!price.trim() || isNaN(Number(price)) || Number(price) <= 0) return 'Prawidłowa cena jest wymagana (wartość > 0).';
    if (photos.length === 0) return 'Dodaj co najmniej jedno zdjęcie.';
    return null;
  };

  const useMyLocation = async () => {
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Toast.show({ type: 'error', text1: 'Brak dostępu do lokalizacji' });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setListingLat(pos.coords.latitude);
      setListingLng(pos.coords.longitude);
      const places = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      const p = places[0];
      const city = p?.city || p?.subregion || p?.region;
      if (city) setLocationText(city);
      else Toast.show({ type: 'info', text1: 'Lokalizacja zapisana', text2: 'Uzupełnij miasto ręcznie jeśli trzeba' });
    } catch {
      Toast.show({ type: 'error', text1: 'Nie udało się pobrać lokalizacji' });
    } finally {
      setLocLoading(false);
    }
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
      if (locationText.trim()) formData.append('location', locationText.trim());
      if (listingLat != null) formData.append('lat', String(listingLat));
      if (listingLng != null) formData.append('lng', String(listingLng));

      // Only append new (local) photos — photos already in originalPhotosRef are server-side
      const originalSet = new Set(originalPhotosRef.current);
      const newPhotos = photos.filter(p => !originalSet.has(p));
      for (const uri of newPhotos) {
        const filename = uri.split('/').pop() ?? 'photo.jpg';
        const ext      = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
        const type     = ext === 'png' ? 'image/png' : 'image/jpeg';
        formData.append(isEdit ? 'newPhotos' : 'photos', { uri, name: filename, type } as any);
      }

      if (isEdit) {
        const removedPhotos = originalPhotosRef.current.filter(p => !photos.includes(p));
        formData.append('photosToRemove', JSON.stringify(removedPhotos));
      }
      if (!isEdit && paidSlotId) {
        formData.append('paidSlotId', paidSlotId);
      }

      const method = isEdit ? 'PATCH' : 'POST';
      const url    = isEdit ? `${API_URL}/api/market/${editId}` : `${API_URL}/api/market`;

      const r = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (r.status === 402) {
        const payload = await r.json().catch(() => ({}));
        const errCode = payload?.error;
        if (errCode === 'LISTING_LIMIT_REACHED') {
          const priceZl = payload?.listingPaidPrice != null
            ? `${(Number(payload.listingPaidPrice) / 100).toFixed(2)} zł`
            : null;
          Alert.alert(
            'Limit ogłoszeń',
            priceZl
              ? `Osiągnięto limit aktywnych ogłoszeń. Możesz zapłacić ${priceZl} za dodatkowy slot albo zwiększyć limit przez Premium.`
              : 'Osiągnięto limit aktywnych ogłoszeń. Zapłać za dodatkowy slot albo zwiększ limit przez Premium.',
            [
              { text: 'Anuluj', style: 'cancel' },
              { text: 'Premium', onPress: () => router.push('/premium' as any) },
              {
                text: 'Zapłać za slot',
                onPress: () => router.push({
                  pathname: '/Community/market/fee-checkout',
                  params: { kind: 'listing_slot' },
                } as any),
              },
            ],
          );
        } else {
          Toast.show({ type: 'error', text1: 'Płatność wymagana', text2: 'Dokończ płatność, aby kontynuować.' });
        }
        return;
      }

      if (!r.ok) throw new Error('Błąd zapisu');

      setPaidSlotId(null);
      await AsyncStorage.removeItem('marketPaidSlotId');
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

      <CommunityScreenHeader
        breadcrumb="GIEŁDA"
        title={isEdit ? 'EDYTUJ OGŁOSZENIE' : 'DODAJ OGŁOSZENIE'}
        subtitle="VROOM GIEŁDA"
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        enabled={Platform.OS === 'ios'}
      >
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 120 }}
      >
        {!isEdit && paidSlotId ? (
          <View style={{ backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.primary, padding: 12 }}>
            <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>
              Opłacony slot aktywny — możesz dodać ogłoszenie ponad limit
            </Text>
          </View>
        ) : null}

        {/* Photos */}
        <FormSection label="ZDJĘCIA" required>
          <FlatList
            data={photos}
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(uri, i) => `${uri}-${i}`}
            contentContainerStyle={{ gap: 10 }}
            ListFooterComponent={
              photos.length < MAX_PHOTOS ? (
                <TouchableOpacity
                  style={{ width: 90, height: 90, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.border, alignItems: 'center', justifyContent: 'center', gap: 4 }}
                  onPress={pickPhoto}
                >
                  <Feather name="plus" size={24} color={theme.textDim} />
                  <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>DODAJ</Text>
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item: uri, index: i }) => (
              <View style={{ position: 'relative', width: 90 }}>
                <View style={{ width: 90, height: 90, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
                  <Image source={{ uri }} style={{ width: 90, height: 90 }} contentFit="cover" transition={0} />
                </View>
                {i === 0 && (
                  <View style={{ position: 'absolute', top: 4, left: 4, backgroundColor: theme.primary, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 }}>
                    <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>GŁÓWNE</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.bg }}
                  onPress={() => removePhoto(i)}
                >
                  <Feather name="x" size={10} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          />
          <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginTop: 6 }}>
            Min. 1, max. {MAX_PHOTOS} zdjęć • Pierwsze zdjęcie to miniatura
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
                <Text style={{ color: category === cat ? '#fff' : theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{cat.toUpperCase()}</Text>
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
                <Text style={{ color: drive === opt ? '#fff' : theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{opt}</Text>
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
                <Text style={{ color: transmission === opt ? '#fff' : theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{opt.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </FormSection>

        {/* Color */}
        <FormSection label="KOLOR">
          <FieldInput value={color} onChangeText={setColor} placeholder="Czarny" theme={theme} />
        </FormSection>

        {/* Fuel */}
        <FormSection label="PALIWO">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {FUEL_OPTS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: fuel === opt ? theme.primary : theme.surface2, borderWidth: 1, borderColor: fuel === opt ? theme.primary : theme.border }}
                onPress={() => setFuel(fuel === opt ? '' : opt)}
              >
                <Text style={{ color: fuel === opt ? '#fff' : theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{opt.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </FormSection>

        {/* Location */}
        <FormSection label="MIASTO / LOKALIZACJA">
          <FieldInput value={locationText} onChangeText={setLocationText} placeholder="np. Katowice" theme={theme} />
          <TouchableOpacity
            onPress={() => void useMyLocation()}
            disabled={locLoading}
            style={{
              marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.primaryBorder,
              backgroundColor: theme.primaryBg, opacity: locLoading ? 0.6 : 1,
            }}
          >
            {locLoading
              ? <ActivityIndicator size="small" color={theme.primary} />
              : <MaterialCommunityIcons name="crosshairs-gps" size={16} color={theme.primary} />
            }
            <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>
              UŻYJ MOJEJ LOKALIZACJI
            </Text>
          </TouchableOpacity>
        </FormSection>

        {/* Description */}
        <View onLayout={e => { fieldYRef.current.description = e.nativeEvent.layout.y; }}>
        <FormSection label="OPIS">
          <TextInput
            style={{
              color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12,
              backgroundColor: theme.surface2, borderRadius: 12, borderWidth: 1,
              borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12,
              minHeight: 100, textAlignVertical: 'top',
            }}
            placeholder="Opisz pojazd lub część..."
            placeholderTextColor={theme.textDim}
            value={description}
            onChangeText={setDescription}
            onFocus={() => scrollFieldIntoView('description')}
            multiline
            maxLength={2000}
          />
        </FormSection>
        </View>

        {/* Price */}
        <View onLayout={e => { fieldYRef.current.price = e.nativeEvent.layout.y; }}>
        <FormSection label="CENA (PLN)" required>
          <FieldInput value={price} onChangeText={setPrice} placeholder="45000" theme={theme} keyboardType="numeric" onFocus={() => scrollFieldIntoView('price')} />
        </FormSection>
        </View>

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
                <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>
                  {isEdit ? 'ZAPISZ ZMIANY' : 'OPUBLIKUJ OGŁOSZENIE'}
                </Text>
              </>
          }
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FormSection({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>{label}</Text>
        {required && <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>*</Text>}
      </View>
      {children}
    </View>
  );
}

function FieldInput({ value, onChangeText, placeholder, theme, keyboardType, onFocus }: { value: string; onChangeText: (v: string) => void; placeholder: string; theme: AppTheme; keyboardType?: any; onFocus?: () => void }) {
  return (
    <TextInput
      style={{
        color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12,
        backgroundColor: theme.surface2, borderRadius: 10, borderWidth: 1,
        borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12,
      }}
      placeholder={placeholder}
      placeholderTextColor={theme.textDim}
      value={value}
      onChangeText={onChangeText}
      onFocus={onFocus}
      keyboardType={keyboardType ?? 'default'}
    />
  );
}
