import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Modal, Image, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker         from '@react-native-community/datetimepicker';
import Mapbox from '@rnmapbox/maps';
import { MAPBOX_STYLE_DARK, MAPBOX_STYLE_LIGHT, MAPBOX_TOKEN } from '../../../constants/mapConfig';
Mapbox.setAccessToken(MAPBOX_TOKEN);
import * as ImagePicker       from 'expo-image-picker';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';

const USER_MAX    = 10;
const PRESET_TAGS = ['NIGHT', 'CRUISE', 'TRACK', 'JDM', 'DRIFT', 'STATIC', 'SHOW', 'EURO', 'TURBO', 'STANCE'];

function parseNominatimAddress(data: any): string {
  const a        = data.address ?? {};
  const road     = a.road ?? a.pedestrian ?? a.footway ?? '';
  const number   = a.house_number ?? '';
  const district = a.suburb ?? a.neighbourhood ?? '';
  const city     = a.city ?? a.town ?? a.village ?? '';
  const parts    = [road && number ? `${road} ${number}` : road, district, city].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : (data.display_name?.split(',').slice(0, 3).join(', ') ?? '');
}

export default function EditMeet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading,       setLoading]       = useState(true);
  const [submitting,    setSubmitting]     = useState(false);
  const [deleting,      setDeleting]       = useState(false); // ← NOWE
  const [title,         setTitle]          = useState('');
  const [description,   setDescription]    = useState('');
  const [locationName,  setLocationName]   = useState('');
  const [lat,           setLat]            = useState<number | null>(null);
  const [lng,           setLng]            = useState<number | null>(null);
  const [date,          setDate]           = useState(new Date());
  const [maxP,          setMaxP]           = useState('10');
  const [tags,          setTags]           = useState<string[]>([]);
  const [rules,         setRules]          = useState<string[]>(['']);
  const [showDate,      setShowDate]       = useState(false);
  const [showTime,      setShowTime]       = useState(false);
  const [mapVisible,    setMapVisible]     = useState(false);
  const [geocoding,     setGeocoding]      = useState(false);
  const [existingCover, setExistingCover]  = useState<string | null>(null);
  const [newCover,      setNewCover]       = useState<{ uri: string; name: string; type: string } | null>(null);
  const [removeCover,   setRemoveCover]    = useState(false);

  const mapRef = useRef<Mapbox.MapView>(null);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  // ── Pobierz dane ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const r     = await fetch(`${API_URL}/api/meets/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error('Nie znaleziono');
        const m = await r.json();
        setTitle(m.title ?? '');
        setDescription(m.description ?? '');
        setLocationName(m.locationName ?? '');
        setLat(m.lat ?? null);
        setLng(m.lng ?? null);
        setDate(m.date ? new Date(m.date) : new Date());
        setMaxP(String(m.maxParticipants ?? 10));
        setTags(m.tags ?? []);
        setRules(m.rules?.length ? m.rules : ['']);
        setExistingCover(m.coverImage ?? null);
      } catch (e: any) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
        router.back();
      } finally { setLoading(false); }
    })();
  }, [id]);

  // ── Cover picker ──────────────────────────────────────
  const pickCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Toast.show({ type: 'error', text1: 'Brak uprawnień do galerii' });
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [16, 9], quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      setNewCover({ uri: a.uri, name: a.fileName ?? `cover_${Date.now()}.jpg`, type: a.mimeType ?? 'image/jpeg' });
      setRemoveCover(false);
    }
  };

  const pickCoverCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Toast.show({ type: 'error', text1: 'Brak uprawnień do aparatu' });
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [16, 9], quality: 0.85 });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      setNewCover({ uri: a.uri, name: a.fileName ?? `cover_${Date.now()}.jpg`, type: a.mimeType ?? 'image/jpeg' });
      setRemoveCover(false);
    }
  };

  const handleRemoveCover = () => {
    Alert.alert('Usuń zdjęcie', 'Na pewno chcesz usunąć zdjęcie okładki?', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Usuń', style: 'destructive', onPress: () => { setNewCover(null); setRemoveCover(true); } },
    ]);
  };

  // ── Mapa ──────────────────────────────────────────────
  const handleMapPress = useCallback(async (e: any) => {
    const [longitude, latitude] = e.geometry.coordinates;
    setLat(latitude); setLng(longitude);
    setLocationName(''); setGeocoding(true);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
        { headers: { 'Accept-Language': 'pl', 'User-Agent': 'VroomApp/1.0' } }
      );
      const d = await r.json();
      setLocationName(parseNominatimAddress(d) || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
    } catch {
      setLocationName(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
    } finally { setGeocoding(false); }
  }, []);

  const toggleTag  = (tag: string) =>
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  const addRule    = () => setRules(prev => [...prev, '']);
  const setRule    = (i: number, v: string) => setRules(prev => prev.map((r, j) => j === i ? v : r));
  const removeRule = (i: number) => setRules(prev => prev.filter((_, j) => j !== i));

  // ── Zapisz ────────────────────────────────────────────
  const handleSave = async () => {
    if (!title.trim())        return Toast.show({ type: 'error', text1: 'Podaj tytuł' });
    if (!locationName.trim()) return Toast.show({ type: 'error', text1: 'Podaj lokalizację' });
    if (submitting)           return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('title',           title.trim());
      form.append('description',     description.trim());
      form.append('locationName',    locationName.trim());
      form.append('date',            date.toISOString());
      form.append('maxParticipants', String(Math.min(parseInt(maxP) || USER_MAX, USER_MAX)));
      form.append('tags',            JSON.stringify(tags));
      form.append('rules',           JSON.stringify(rules.filter(r => r.trim())));
      if (lat !== null) form.append('lat', String(lat));
      if (lng !== null) form.append('lng', String(lng));
      if (removeCover)  form.append('removeCover', 'true');
      if (newCover)     form.append('coverImage', { uri: newCover.uri, name: newCover.name, type: newCover.type } as any);

      const r = await fetch(`${API_URL}/api/meets/${id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      if (!r.ok) {
        const err = await r.json();
        return Toast.show({ type: 'error', text1: 'Błąd', text2: err.error });
      }
      Toast.show({ type: 'success', text1: '✅ ZAPISANO', text2: title });
      router.back();
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally { setSubmitting(false); }
  };

  // ── Usuń meet ─────────────────────────────────────────
  const handleDelete = () => {
    Alert.alert(
      'USUŃ MEET',
      `Czy na pewno chcesz usunąć "${title}"?\n\nTej operacji nie można cofnąć.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'USUŃ',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const token = await getToken();
              const r     = await fetch(`${API_URL}/api/meets/${id}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
              });
              if (!r.ok) {
                const err = await r.json();
                return Toast.show({ type: 'error', text1: 'Błąd', text2: err.error });
              }
              Toast.show({ type: 'success', text1: '🗑️ MEET USUNIĘTY' });
              // Wróć do listy meetów (2 ekrany wstecz — editmeet → meet → events)
              router.dismissAll();
              router.replace('/Community/meets/events' as any);
            } catch {
              Toast.show({ type: 'error', text1: 'Błąd połączenia' });
            } finally { setDeleting(false); }
          },
        },
      ]
    );
  };

  const coverUri   = newCover?.uri ?? (!removeCover ? existingCover : null);
  const maxClamped = Math.min(parseInt(maxP) || USER_MAX, USER_MAX);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 52 : 0}
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* HEADER */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 56, marginBottom: 28, gap: 14 }}>
          <TouchableOpacity
            style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.back()}
          >
            <MaterialIcons name="arrow-back" size={20} color={theme.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 3 }}>EDYCJA MEETU</Text>
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 18, fontWeight: '700', letterSpacing: 1 }} numberOfLines={1}>{title}</Text>
          </View>
        </View>

        {/* ZDJĘCIE OKŁADKI */}
        <Field label="ZDJĘCIE OKŁADKI">
          {coverUri ? (
            <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
              <Image source={{ uri: coverUri }} style={{ width: '100%', height: 180 }} resizeMode="cover" />
              <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={{ backgroundColor: '#000000aa', borderRadius: 20, padding: 8 }} onPress={pickCover}>
                  <MaterialIcons name="edit" size={18} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={{ backgroundColor: '#e3383599', borderRadius: 20, padding: 8 }} onPress={handleRemoveCover}>
                  <MaterialIcons name="delete" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
              {newCover && (
                <View style={{ position: 'absolute', bottom: 10, left: 10, backgroundColor: '#4de92699', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>NOWE ZDJĘCIE</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', paddingVertical: 28, alignItems: 'center', gap: 8 }}
                onPress={pickCover} activeOpacity={0.8}
              >
                <MaterialIcons name="photo-library" size={28} color={theme.primary} />
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>GALERIA</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed', paddingVertical: 28, alignItems: 'center', gap: 8 }}
                onPress={pickCoverCamera} activeOpacity={0.8}
              >
                <MaterialIcons name="photo-camera" size={28} color={theme.primary} />
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>APARAT</Text>
              </TouchableOpacity>
            </View>
          )}
        </Field>

        {/* TYTUŁ */}
        <Field label="TYTUŁ">
          <View style={fieldStyle(theme)}>
            <MaterialIcons name="title" size={18} color={theme.primary} />
            <TextInput style={inputStyle(theme)} placeholder="np. Nocny Cruise Warszawa" placeholderTextColor={theme.textDim} value={title} onChangeText={setTitle} maxLength={60} />
          </View>
        </Field>

        {/* DATA + GODZINA */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label="DATA">
              <TouchableOpacity style={fieldStyle(theme)} onPress={() => setShowDate(true)}>
                <MaterialIcons name="event" size={18} color={theme.primary} />
                <Text style={[inputStyle(theme), { paddingVertical: 0 }]}>{date.toLocaleDateString('pl-PL')}</Text>
              </TouchableOpacity>
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="GODZINA">
              <TouchableOpacity style={fieldStyle(theme)} onPress={() => setShowTime(true)}>
                <MaterialIcons name="access-time" size={18} color={theme.primary} />
                <Text style={[inputStyle(theme), { paddingVertical: 0 }]}>{date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</Text>
              </TouchableOpacity>
            </Field>
          </View>
        </View>

        {showDate && (
          <DateTimePicker value={date} mode="date" display="default" minimumDate={new Date()}
            onChange={(_, d) => { setShowDate(false); if (d) setDate(prev => { const n = new Date(prev); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return n; }); }}
          />
        )}
        {showTime && (
          <DateTimePicker value={date} mode="time" is24Hour display="default"
            onChange={(_, d) => { setShowTime(false); if (d) setDate(prev => { const n = new Date(prev); n.setHours(d.getHours(), d.getMinutes()); return n; }); }}
          />
        )}

        {/* LOKALIZACJA */}
        <Field label="LOKALIZACJA">
          <View style={fieldStyle(theme)}>
            <MaterialIcons name="location-on" size={18} color={theme.primary} />
            <TextInput
              style={[inputStyle(theme), { flex: 1 }]} placeholder="Wpisz lub zaznacz na mapie"
              placeholderTextColor={theme.textDim} value={locationName}
              onChangeText={text => { setLocationName(text); if (lat !== null) { setLat(null); setLng(null); } }}
            />
            <TouchableOpacity onPress={() => setMapVisible(true)} style={{ padding: 4 }}>
              <MaterialIcons name="map" size={20} color={theme.primary} />
            </TouchableOpacity>
          </View>
          {lat !== null && lng !== null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, marginLeft: 2 }}>
              <MaterialIcons name="check-circle" size={13} color="#4de926" />
              <Text style={{ color: '#4de926', fontFamily: 'Orbitron', fontSize: 8 }}>Zaznaczono na mapie</Text>
            </View>
          )}
        </Field>

        {/* LIMIT */}
        <Field label={`LIMIT UCZESTNIKÓW (max ${USER_MAX})`}>
          <View style={fieldStyle(theme)}>
            <MaterialIcons name="people" size={18} color={theme.primary} />
            <TextInput
              style={inputStyle(theme)} placeholder="10" placeholderTextColor={theme.textDim}
              keyboardType="numeric" value={maxP}
              onChangeText={v => setMaxP(String(Math.min(parseInt(v) || 1, USER_MAX)))} maxLength={2}
            />
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>/ {USER_MAX}</Text>
          </View>
          <View style={{ height: 3, backgroundColor: theme.border, borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${(maxClamped / USER_MAX) * 100}%`, backgroundColor: theme.primary, borderRadius: 2 }} />
          </View>
        </Field>

        {/* TAGI */}
        <Field label="TAGI">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PRESET_TAGS.map(tag => {
              const active = tags.includes(tag);
              return (
                <TouchableOpacity key={tag} onPress={() => toggleTag(tag)}
                  style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, backgroundColor: active ? theme.primaryBg : theme.surface, borderColor: active ? theme.primary : theme.border }}
                >
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', color: active ? theme.primary : theme.textDim }}>{tag}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Field>

        {/* OPIS */}
        <Field label="OPIS (opcjonalnie)">
          <View style={[fieldStyle(theme), { alignItems: 'flex-start', paddingTop: 10, minHeight: 90 }]}>
            <TextInput
              style={[inputStyle(theme), { textAlignVertical: 'top', flex: 1 }]}
              placeholder="Opisz co będziecie robić..." placeholderTextColor={theme.textDim}
              multiline value={description} onChangeText={setDescription} maxLength={500}
            />
          </View>
        </Field>

        {/* ZASADY */}
        <Field label="ZASADY (opcjonalnie)">
          {rules.map((rule, i) => (
            <View key={i} style={[fieldStyle(theme), { marginBottom: 8 }]}>
              <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', minWidth: 20 }}>{i + 1}.</Text>
              <TextInput style={[inputStyle(theme), { flex: 1 }]} placeholder={`Zasada ${i + 1}...`} placeholderTextColor={theme.textDim} value={rule} onChangeText={v => setRule(i, v)} />
              {rules.length > 1 && (
                <TouchableOpacity onPress={() => removeRule(i)} style={{ padding: 4 }}>
                  <MaterialIcons name="remove-circle-outline" size={18} color={theme.primary} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity onPress={addRule}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border, borderRadius: 10, justifyContent: 'center' }}
          >
            <MaterialIcons name="add" size={16} color={theme.textDim} />
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>DODAJ ZASADĘ</Text>
          </TouchableOpacity>
        </Field>

        {/* ZAPISZ */}
        <TouchableOpacity
          style={[{ backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginTop: 24, flexDirection: 'row', justifyContent: 'center', gap: 10 }, submitting && { opacity: 0.7 }]}
          onPress={handleSave} disabled={submitting || deleting} activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <><MaterialIcons name="save" size={20} color="#fff" /><Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>ZAPISZ ZMIANY</Text></>
          }
        </TouchableOpacity>

        {/* USUŃ MEET */}
        <TouchableOpacity
          style={[{
            borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginTop: 12,
            flexDirection: 'row', justifyContent: 'center', gap: 10,
            borderWidth: 1, borderColor: '#e3383560', backgroundColor: '#e3383510',
          }, deleting && { opacity: 0.7 }]}
          onPress={handleDelete} disabled={submitting || deleting} activeOpacity={0.85}
        >
          {deleting
            ? <ActivityIndicator color="#e33835" />
            : <><MaterialIcons name="delete-forever" size={20} color="#e33835" /><Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>USUŃ MEET</Text></>
          }
        </TouchableOpacity>

      </ScrollView>

      {/* MAP MODAL */}
      <Modal visible={mapVisible} animationType="slide" onRequestClose={() => setMapVisible(false)}>
        <View style={{ flex: 1 }}>
          <Mapbox.MapView
            ref={mapRef}
            style={{ flex: 1 }}
            styleURL={isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT}
            logoEnabled={false}
            attributionEnabled={false}
            onPress={handleMapPress}
          >
            <Mapbox.Camera
              defaultSettings={{
                centerCoordinate: [lng ?? 21.0122, lat ?? 52.2297],
                zoomLevel: 13,
              }}
            />
            {lat !== null && lng !== null && (
              <Mapbox.PointAnnotation id="loc" coordinate={[lng, lat]}>
                <View style={{ backgroundColor: theme.primary, borderRadius: 20, padding: 8, borderWidth: 2, borderColor: '#fff' }}>
                  <MaterialIcons name="location-on" size={18} color="#fff" />
                </View>
              </Mapbox.PointAnnotation>
            )}
          </Mapbox.MapView>
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 20, gap: 14, borderTopWidth: 1, borderTopColor: theme.border }}>
            {geocoding ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color={theme.primary} />
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 11 }}>Pobieranie adresu...</Text>
              </View>
            ) : lat !== null ? (
              <View style={{ gap: 4 }}>
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>WYBRANA LOKALIZACJA</Text>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700', lineHeight: 20 }}>{locationName}</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="touch-app" size={18} color={theme.textDim} />
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 11 }}>Kliknij na mapie żeby wybrać miejsce</Text>
              </View>
            )}
            <TouchableOpacity
              style={[{ backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }, (geocoding || lat === null) && { opacity: 0.5 }]}
              onPress={() => setMapVisible(false)} disabled={geocoding || lat === null}
            >
              <MaterialIcons name="check" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>POTWIERDŹ LOKALIZACJĘ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2, marginBottom: 8 }}>{label}</Text>
      {children}
    </View>
  );
}

function fieldStyle(theme: any) {
  return { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12, gap: 10 };
}

function inputStyle(theme: any) {
  return { flex: 1, color: theme.text, fontFamily: 'Orbitron', fontSize: 12, padding: 0 };
}