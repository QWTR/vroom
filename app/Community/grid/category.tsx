import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, RefreshControl, StatusBar,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

function timeLeft(date: string): string {
  const diff = new Date(date).getTime() - Date.now();
  if (diff <= 0) return 'Zakończone';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function GridCategoryScreen() {
  const { theme } = useTheme();
  const router    = useRouter();
  const { slug }  = useLocalSearchParams<{ slug: string }>();

  const [data,       setData]       = useState<any>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/grid/category/${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setData(await res.json());
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie można załadować.' });
    } finally { setLoading(false); setRefreshing(false); }
  }, [slug]);

  useEffect(() => { load(); }, [slug]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={theme.gold} />
    </View>
  );

  const { category, event, myEntry, history } = data ?? {};
  const entryCount = event?._count?.entries ?? 0;
  const maxEntries = event?.maxEntries ?? 32;
  const isFull = event?.status === 'open' && entryCount >= maxEntries;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />

      <CommunityScreenHeader
        breadcrumb="THE GRID"
        title={`${category?.icon ?? ''} ${category?.name?.toUpperCase() ?? 'KATEGORIA'}`.trim()}
        subtitle={category?.description ?? 'KATEGORIA GRIDU'}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.gold} />}
        showsVerticalScrollIndicator={false}
      >
        {/* AKTYWNY EVENT */}
        {event ? (
          <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border2, padding: 16, marginBottom: 16 }}>

            {/* Status */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="flag-checkered" size={16} color={theme.gold} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.gold, fontSize: 11, fontWeight: '700' }}>
                  {event.status === 'open'   && 'ZAPISY OTWARTE'}
                  {event.status === 'active' && `RUNDA ${event.currentRound} · GŁOSOWANIE`}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialIcons name="schedule" size={12} color={theme.textDim} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8 }}>
                  {event.status === 'open' && event.registrationEndsAt
                    ? `Zapisy do: ${timeLeft(event.registrationEndsAt)}`
                    : event.roundEndsAt ? `Kończy się: ${timeLeft(event.roundEndsAt)}` : ''}
                </Text>
              </View>
            </View>

            {/* Statystyki */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.border, marginBottom: 14 }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.gold, fontSize: 20, fontWeight: '900' }}>
                  {entryCount}/{maxEntries}
                </Text>
                <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8 }}>ZAWODNIKÓW</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 20, fontWeight: '900' }}>
                  {event.minEntries ?? '—'}
                </Text>
                <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8 }}>MIN. START</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 20, fontWeight: '900' }}>
                  {event.currentRound === 0 ? '—' : event.currentRound}
                </Text>
                <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8 }}>RUNDA</Text>
              </View>
            </View>

            {/* CTA */}
            {event.status === 'open' && !myEntry && !isFull && (
              <TouchableOpacity
                style={{ backgroundColor: theme.gold, borderRadius: 12, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onPress={() => router.push(`/Community/grid/enter?eventId=${event.id}` as any)}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="flag-checkered" size={16} color="#000" />
                <Text style={{ fontFamily: 'Orbitron', color: '#000', fontSize: 11, fontWeight: '900' }}>
                  ZAPISZ SIĘ DO GRIDU
                </Text>
              </TouchableOpacity>
            )}

            {event.status === 'open' && !myEntry && isFull && (
              <View style={{ backgroundColor: theme.surface3, borderRadius: 12, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: theme.border2 }}>
                <MaterialIcons name="block" size={16} color={theme.textDim} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, fontWeight: '700' }}>
                  BRAK WOLNYCH MIEJSC
                </Text>
              </View>
            )}

            {event.status === 'open' && myEntry && (
              <View style={{ backgroundColor: theme.success + '15', borderRadius: 12, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: theme.success + '40' }}>
                <MaterialIcons name="check-circle" size={16} color={theme.success} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.success, fontSize: 10, fontWeight: '700' }}>
                  JESTEŚ ZAPISANY
                </Text>
              </View>
            )}

            {event.status === 'active' && (
              <TouchableOpacity
                style={{ backgroundColor: theme.primary, borderRadius: 12, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onPress={() => router.push(`/Community/grid/vote?eventId=${event.id}` as any)}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="sword-cross" size={16} color="#fff" />
                <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11, fontWeight: '900' }}>
                  GŁOSUJ TERAZ
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 24, alignItems: 'center', marginBottom: 16 }}>
            <MaterialCommunityIcons name="flag-checkered" size={40} color={theme.border3} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 11, marginTop: 12 }}>
              Brak aktywnego eventu
            </Text>
            <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 8, marginTop: 6, textAlign: 'center' }}>
              Admin wkrótce otworzy nową edycję
            </Text>
          </View>
        )}

        {/* HALL OF FAME */}
        {history?.length > 0 && (
          <>
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, letterSpacing: 3, marginBottom: 10 }}>
              HALL OF FAME
            </Text>
            <View style={{ gap: 8, marginBottom: 16 }}>
              {history.map((ev: any, i: number) => ev.winner && (
                <View key={ev.id} style={{ backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: i === 0 ? theme.gold + '40' : theme.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: i === 0 ? theme.gold + '20' : theme.surface3, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                    {ev.winner.user?.avatarUrl
                      ? <Image source={{ uri: ev.winner.user.avatarUrl }} style={{ width: 40, height: 40 }} />
                      : <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.gold }}>{ev.winner.user?.username?.slice(0, 2).toUpperCase()}</Text>
                    }
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 14 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</Text>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '700' }}>
                        {ev.winner.user?.username}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2 }}>
                      Sezon {ev.season} · {ev.winner.wins}W
                    </Text>
                  </View>
                  {i === 0 && (
                    <View style={{ backgroundColor: theme.gold + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: theme.gold + '50' }}>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.gold, fontSize: 7, fontWeight: '900' }}>🏆 LEGENDARY</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}