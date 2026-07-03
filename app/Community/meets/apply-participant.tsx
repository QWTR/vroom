import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';
import { useCars } from '../../../hooks/useCars';
import type { Car } from '../../../constants/profile';

function carLabel(car: Car) {
  return `${car.brand} ${car.specs}`.trim();
}

export default function ApplyParticipantScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { cars, loading, fetchCars } = useCars();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  useEffect(() => { fetchCars(); }, [fetchCars]);

  useEffect(() => {
    const main = cars.find(c => c.isMain);
    if (main) setSelectedId(main.id);
    else if (cars.length === 1) setSelectedId(cars[0].id);
  }, [cars]);

  const submit = useCallback(async () => {
    if (!selectedId || submitting) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${id}/participant-apply`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ carId: selectedId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Nie udało się wysłać zgłoszenia');
      Toast.show({ type: 'success', text1: 'WYSŁANO', text2: 'Organizator rozpatrzy zgłoszenie' });
      router.back();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally {
      setSubmitting(false);
    }
  }, [id, selectedId, submitting, router]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <CommunityScreenHeader title="ZGŁOSZENIE UCZESTNIKA" subtitle="Wybierz auto z garażu" />

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}>
          <View style={{ backgroundColor: theme.primaryBg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.primaryBorder, flexDirection: 'row', gap: 10 }}>
            <MaterialIcons name="info-outline" size={20} color={theme.primary} />
            <Text style={{ flex: 1, color: theme.textDim, fontSize: 12, lineHeight: 18 }}>
              Po zatwierdzeniu przez organizatora otrzymasz osobny kod QR uczestnika z autem na wjeździe.
            </Text>
          </View>

          {cars.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 16, paddingVertical: 40 }}>
              <MaterialCommunityIcons name="garage-alert" size={48} color={theme.textDim} />
              <Text style={{ color: theme.textDim, textAlign: 'center', lineHeight: 22 }}>
                Twój garaż jest pusty. Dodaj auto w profilu, aby zgłosić się jako uczestnik.
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/profile' as any)}
                style={{ backgroundColor: theme.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14 }}
              >
                <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>PRZEJDŹ DO PROFILU</Text>
              </TouchableOpacity>
            </View>
          ) : (
            cars.map(car => {
              const selected = selectedId === car.id;
              const photo = car.photos?.[0];
              return (
                <TouchableOpacity
                  key={car.id}
                  onPress={() => setSelectedId(car.id)}
                  activeOpacity={0.85}
                  style={{
                    backgroundColor: selected ? theme.primaryBg : theme.surface,
                    borderRadius: 16, padding: 14, borderWidth: 2,
                    borderColor: selected ? theme.primary : theme.border,
                    flexDirection: 'row', alignItems: 'center', gap: 14,
                  }}
                >
                  <View style={{ width: 72, height: 54, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    {photo
                      ? <Image source={{ uri: photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      : <MaterialCommunityIcons name="car-sports" size={28} color={theme.textDim} />
                    }
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' }}>{carLabel(car)}</Text>
                    {car.isMain && (
                      <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8, marginTop: 4 }}>GŁÓWNE AUTO</Text>
                    )}
                  </View>
                  {selected && <MaterialIcons name="check-circle" size={24} color={theme.primary} />}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {cars.length > 0 && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 32, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border }}>
          <TouchableOpacity
            onPress={submit}
            disabled={!selectedId || submitting}
            style={{
              backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
              opacity: !selectedId || submitting ? 0.6 : 1,
            }}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>WYŚLIJ ZGŁOSZENIE</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
