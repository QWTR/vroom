import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, TextInput, StatusBar,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { useCars } from '../../../hooks/useCars';
import { CommunityScreenHeader } from '../../../components/community';
import { EntranceIntroGate } from '../../../components/motion';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function EnterGridScreen() {
  const { theme }   = useTheme();
  const router      = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  // ── używamy tego samego hooka co profil ──
  const { cars, loading, fetchCars } = useCars();

  const [selectedCar, setSelectedCar] = useState<typeof cars[0] | null>(null);
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [introDone,   setIntroDone]   = useState(false);

  useEffect(() => {
    fetchCars(); // bez userId → pobierze własne auta
  }, []);

  // Gdy auta się załadują → zaznacz główne
  useEffect(() => {
    if (cars.length > 0 && !selectedCar) {
      const main = cars.find(c => c.isMain) ?? cars[0];
      setSelectedCar(main);
    }
  }, [cars]);

  const pickExtraPhoto = async () => {
    if (extraPhotos.length >= 4) {
      Toast.show({ type: 'info', text1: 'Max 4 dodatkowe zdjęcia' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85, allowsEditing: true, aspect: [1, 1],
    });
    if (!result.canceled) setExtraPhotos(p => [...p, result.assets[0].uri]);
  };

  const removeExtraPhoto = (idx: number) =>
    setExtraPhotos(p => p.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!selectedCar) {
      Toast.show({ type: 'error', text1: 'Wybierz auto z garażu' });
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();

      const uploadedUrls: string[] = [];
      for (const uri of extraPhotos) {
        const formData = new FormData();
        formData.append('file', { uri, name: `grid_${Date.now()}.jpg`, type: 'image/jpeg' } as any);
        const upRes = await fetch(`${API_URL}/api/grid/upload-photo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (upRes.ok) {
          const upData = await upRes.json();
          const url = upData.url ?? upData.urls?.[0];
          if (url) uploadedUrls.push(url);
        }
      }

      const allPhotos = [...(selectedCar.photos ?? []), ...uploadedUrls];

      const res = await fetch(`${API_URL}/api/grid/enter`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId:     parseInt(eventId),
          carId:       selectedCar.id,
          photos:      allPhotos,
          description,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        Toast.show({ type: 'success', text1: '🏁 Jesteś w gridzie!', text2: 'Czekaj na start głosowania.' });
        router.back();
      } else {
        Toast.show({ type: 'error', text1: 'Błąd', text2: data.error });
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd', text2: 'Brak połączenia.' });
    } finally { setSubmitting(false); }
  };

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={theme.gold} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />

      <CommunityScreenHeader
        breadcrumb="THE GRID"
        title="DOŁĄCZ DO GRIDU"
        subtitle="ZAPISZ SIĘ DO EVENTU"
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Wybór auta */}
        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, letterSpacing: 3, marginBottom: 12 }}>
          WYBIERZ AUTO Z GARAŻU
        </Text>

        {cars.length === 0 ? (
          <View style={{
            backgroundColor: theme.surface, borderRadius: 14, padding: 28,
            alignItems: 'center', marginBottom: 24, borderWidth: 1, borderColor: theme.border2,
          }}>
            <MaterialCommunityIcons name="car-off" size={44} color={theme.border3} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginTop: 12, marginBottom: 16 }}>
              Brak aut w garażu
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: theme.gold, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}
              onPress={() => router.push('/profile/add-car' as any)}
            >
              <Text style={{ fontFamily: 'Orbitron', color: '#000', fontSize: 9, fontWeight: '700' }}>DODAJ AUTO</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', gap: 10, paddingRight: 16 }}>
              {cars.map(car => {
                const isSelected = selectedCar?.id === car.id;
                return (
                  <TouchableOpacity
                    key={car.id}
                    style={{
                      width: 140, borderRadius: 14, overflow: 'hidden',
                      borderWidth: 2,
                      borderColor: isSelected ? theme.gold : theme.border2,
                      backgroundColor: theme.surface,
                    }}
                    onPress={() => setSelectedCar(car)}
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri: car.photos?.[0] ?? 'https://via.placeholder.com/140' }}
                      style={{ width: 140, height: 100 }}
                      resizeMode="cover"
                    />
                    {isSelected && (
                      <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: theme.gold, borderRadius: 10, padding: 3 }}>
                        <MaterialIcons name="check" size={12} color="#000" />
                      </View>
                    )}
                    <View style={{ padding: 8 }}>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 9, fontWeight: '700' }} numberOfLines={1}>
                        {car.brand}
                      </Text>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 7, marginTop: 2 }} numberOfLines={1}>
                        {car.specs}
                      </Text>
                      {car.isMain && (
                        <Text style={{ fontFamily: 'Orbitron', color: theme.gold, fontSize: 7, marginTop: 3 }}>★ GŁÓWNE</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}

        {/* Zdjęcia wybranego auta */}
        {selectedCar && (selectedCar.photos?.length ?? 0) > 0 && (
          <>
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, letterSpacing: 3, marginBottom: 10 }}>
              ZDJĘCIA Z GARAŻU
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingRight: 16 }}>
                {selectedCar.photos.map((uri, i) => (
                  <Image key={i} source={{ uri }} style={{ width: 80, height: 80, borderRadius: 10 }} resizeMode="cover" />
                ))}
              </View>
            </ScrollView>
          </>
        )}

        {/* Dodatkowe zdjęcia */}
        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, letterSpacing: 3, marginBottom: 10 }}>
          DODATKOWE ZDJĘCIA <Text style={{ color: theme.textFaint }}>(OPCJONALNIE, MAX 4)</Text>
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {extraPhotos.map((uri, i) => (
            <View key={i} style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden' }}>
              <Image source={{ uri }} style={{ width: 80, height: 80 }} resizeMode="cover" />
              <TouchableOpacity
                style={{ position: 'absolute', top: 3, right: 3, backgroundColor: theme.danger, borderRadius: 8, padding: 2 }}
                onPress={() => removeExtraPhoto(i)}
              >
                <MaterialIcons name="close" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {extraPhotos.length < 4 && (
            <TouchableOpacity
              style={{
                width: 80, height: 80, borderRadius: 10,
                backgroundColor: theme.surface, borderWidth: 1,
                borderColor: theme.border2, borderStyle: 'dashed',
                justifyContent: 'center', alignItems: 'center',
              }}
              onPress={pickExtraPhoto}
            >
              <MaterialIcons name="add-photo-alternate" size={24} color={theme.gold} />
            </TouchableOpacity>
          )}
        </View>

        {/* Opis */}
        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, letterSpacing: 3, marginBottom: 8 }}>
          OPIS <Text style={{ color: theme.textFaint }}>(OPCJONALNIE)</Text>
        </Text>
        <View style={{ backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border2, marginBottom: 24 }}>
          <TextInput
            style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, padding: 14, minHeight: 70 }}
            placeholder="Opisz swój build..."
            placeholderTextColor={theme.textFaint}
            value={description}
            onChangeText={setDescription}
            multiline maxLength={200}
          />
        </View>

        {/* Zasady */}
        <View style={{ backgroundColor: theme.gold + '10', borderRadius: 12, borderWidth: 1, borderColor: theme.gold + '30', padding: 14, marginBottom: 28 }}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.gold, fontSize: 8, fontWeight: '700', marginBottom: 8 }}>
            ZASADY THE GRID
          </Text>
          {[
            'System automatycznie losuje rywala po zamknięciu zapisów',
            'Głosowanie trwa 24 godziny na rundę',
            'Każdy user ma 1 głos na parę',
            'Zwycięzca finału otrzymuje odznakę LEGENDARY 🏆',
          ].map((rule, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 5 }}>
              <Text style={{ color: theme.gold }}>›</Text>
              <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, flex: 1, lineHeight: 14 }}>{rule}</Text>
            </View>
          ))}
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={{
            backgroundColor: theme.gold, borderRadius: 14, height: 54,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
            opacity: submitting || !selectedCar ? 0.6 : 1,
          }}
          onPress={handleSubmit}
          disabled={submitting || !selectedCar}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#000" />
            : <>
                <MaterialCommunityIcons name="flag-checkered" size={18} color="#000" />
                <Text style={{ fontFamily: 'Orbitron', color: '#000', fontSize: 13, fontWeight: '900' }}>
                  WCHODZĘ NA GRID!
                </Text>
              </>
          }
        </TouchableOpacity>
      </ScrollView>
      {!introDone && (
        <EntranceIntroGate
          presetId="garage"
          screenKey={`grid_enter_${eventId}`}
          onIntroDone={() => setIntroDone(true)}
        />
      )}
    </View>
  );
}