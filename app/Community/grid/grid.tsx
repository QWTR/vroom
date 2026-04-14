import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, StatusBar, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';

const { width } = Dimensions.get('window');

interface Category {
  id:          number;
  name:        string;
  slug:        string;
  icon:        string;
  description: string | null;
  events: {
    id:     number;
    status: string;
    registrationEndsAt: string;
    currentRound: number;
    _count: { entries: number };
  }[];
}

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function GridCategoriesScreen() {
  const { theme } = useTheme();
  const router    = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/grid/categories`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setCategories(await res.json());
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie można załadować kategorii.' });
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, []);

  const getEventBadge = (cat: Category) => {
    const ev = cat.events?.[0];
    if (!ev) return null;
    if (ev.status === 'open')   return { label: 'ZAPISY OTWARTE', color: theme.success };
    if (ev.status === 'active') return { label: `RUNDA ${ev.currentRound}`, color: theme.warning };
    return null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />

      {/* HEADER */}
      <View style={{ paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 }}
        >
          <MaterialIcons name="arrow-back" size={20} color={theme.textDim} />
          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, letterSpacing: 2 }}>
            SPOŁECZNOŚĆ
          </Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MaterialCommunityIcons name="flag-checkered" size={32} color={theme.gold} />
          <View>
            <Text style={{ fontFamily: 'Orbitron', color: theme.gold, fontSize: 26, fontWeight: '900', letterSpacing: 4 }}>
              THE GRID
            </Text>
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, letterSpacing: 3 }}>
              ARENA STARĆ 1V1
            </Text>
          </View>
        </View>

        <View style={{ backgroundColor: theme.surface2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.border2, marginTop: 14 }}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, lineHeight: 15 }}>
            Wystaw swoje auto do walki. System losuje rywala, społeczność głosuje 24h.{' '}
            <Text style={{ color: theme.gold }}>Zwycięzca otrzymuje odznakę LEGENDARY 🏆</Text>
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.gold} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.gold} />}
          showsVerticalScrollIndicator={false}
        >
          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, letterSpacing: 3, marginBottom: 4 }}>
            WYBIERZ KATEGORIĘ
          </Text>

          {categories.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 60 }}>
              <MaterialCommunityIcons name="flag-checkered" size={56} color={theme.border3} />
              <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 12, marginTop: 16 }}>
                Brak aktywnych kategorii
              </Text>
            </View>
          ) : (
            categories.map(cat => {
              const badge = getEventBadge(cat);
              const ev    = cat.events?.[0];
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={{
                    backgroundColor: theme.surface,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: badge ? theme.gold + '30' : theme.border,
                    padding: 18,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                  }}
                  onPress={() => router.push(`/Community/grid/category?slug=${cat.slug}` as any)}
                  activeOpacity={0.8}
                >
                  <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: theme.surface3, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.border2 }}>
                    <Text style={{ fontSize: 28 }}>{cat.icon}</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>
                        {cat.name.toUpperCase()}
                      </Text>
                      {badge && (
                        <View style={{ backgroundColor: badge.color + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: badge.color + '50' }}>
                          <Text style={{ fontFamily: 'Orbitron', color: badge.color, fontSize: 7, fontWeight: '700' }}>
                            {badge.label}
                          </Text>
                        </View>
                      )}
                    </View>

                    {cat.description && (
                      <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, lineHeight: 13, marginBottom: 8 }}>
                        {cat.description}
                      </Text>
                    )}

                    {ev && (
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <MaterialCommunityIcons name="car" size={10} color={theme.textDim} />
                          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8 }}>
                            {ev._count?.entries ?? 0} zawodników
                          </Text>
                        </View>
                        {ev.status === 'open' && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <MaterialIcons name="schedule" size={10} color={theme.textDim} />
                            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8 }}>
                              Zapisy do {new Date(ev.registrationEndsAt).toLocaleDateString('pl-PL')}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {!ev && (
                      <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 8 }}>
                        Brak aktywnego eventu
                      </Text>
                    )}
                  </View>

                  <MaterialIcons name="chevron-right" size={20} color={theme.textDim} />
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}