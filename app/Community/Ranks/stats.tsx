import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollView, TouchableOpacity,
  View, Dimensions, Image, ActivityIndicator, RefreshControl, Text,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import { useRouter }          from 'expo-router';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';

const { width } = Dimensions.get('window');

interface RankUser {
  id:       number;
  username: string;
  avatar:   string | null;
  position: number;
  score:    number;
  sub:      string;
}

const PERIODS   = ['Dziś', 'Tydzień', 'Miesiąc', 'Wszystko'] as const;
const PERIOD_MAP: Record<string, string> = {
  'Dziś':     'day',
  'Tydzień':  'week',
  'Miesiąc':  'month',
  'Wszystko': 'all',
};

export default function StatsScreen() {
  const router = useRouter();
  const { theme } = useTheme();

  const [category,   setCategory]   = useState<'points' | 'distance'>('points');
  const [period,     setPeriod]     = useState<string>('Wszystko');
  const [users,      setUsers]      = useState<RankUser[]>([]);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [myId,       setMyId]       = useState<number | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) { const u = JSON.parse(raw); setMyId(u.userId ?? u.id); }
    });
  }, []);

  const fetchRanking = useCallback(async (cat: string, per: string) => {
    try {
      const token = await AsyncStorage.getItem('token');
      const url   = `${API_URL}/api/profile/ranking?category=${cat}&period=${PERIOD_MAP[per]}`;
      const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data  = await res.json();
      setUsers(data.users ?? []);
      setMyPosition(data.myPosition ?? null);
    } catch (e) {
      console.log('fetchRanking error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchRanking(category, period);
  }, [category, period, fetchRanking]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRanking(category, period);
  }, [category, period, fetchRanking]);

  const topThree   = users.slice(0, 3);
  const restUsers  = users.slice(3);
  const podiumOrder = [topThree[1], topThree[0], topThree[2]].filter(Boolean);
  const scoreLabel  = category === 'points' ? 'pkt' : 'km';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg, paddingHorizontal: '5%' }}
      contentContainerStyle={{ paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e33835" />}
    >
      {/* NAGŁÓWEK */}
      <View style={{ marginTop: 60, marginBottom: 24, alignItems: 'center' }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 28, color: theme.text, letterSpacing: 2 }}>RANKING</Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim, marginTop: 4 }}>NAJLEPSI KIEROWCY</Text>
      </View>

      {/* KATEGORIE */}
      <View style={{ flexDirection: 'row', backgroundColor: theme.surface, borderRadius: 12, padding: 4, marginBottom: 16, gap: 4 }}>
        {(['points', 'distance'] as const).map(cat => (
          <TouchableOpacity
            key={cat}
            style={[{ flex: 1, flexDirection: 'row', paddingVertical: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 10, gap: 6 },
              category === cat && { backgroundColor: '#e33835' }]}
            onPress={() => setCategory(cat)}
          >
            <MaterialIcons name={cat === 'points' ? 'star' : 'speed'} size={14} color={category === cat ? '#fff' : theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: category === cat ? '#fff' : theme.textDim }}>
              {cat === 'points' ? 'PUNKTY' : 'DYSTANS'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* FILTR CZASU */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 30 }}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p}
            onPress={() => setPeriod(p)}
            style={[{
              paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border2,
            }, period === p && { backgroundColor: '#e3383520', borderColor: '#e33835' }]}
          >
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: period === p ? '#e33835' : theme.textDim }}>
              {p}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#e33835" style={{ marginTop: 60 }} />
      ) : (
        <>
          {/* PODIUM */}
          {topThree.length >= 3 && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', marginBottom: 32, height: 260 }}>
              {podiumOrder.map((u, idx) => {
                const isFirst  = u.position === 1;
                const barH     = [100, 130, 80][idx];
                const barColor = ['#ffffff50', '#e33835', '#ffffff30'][idx];
                const isMe     = u.id === myId;

                return (
                  <TouchableOpacity
                    key={u.id}
                    style={{ alignItems: 'center', width: width * 0.26 }}
                    onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: String(u.id) } })}
                    activeOpacity={0.8}
                  >
                    {isFirst && (
                      <MaterialCommunityIcons name="crown" size={20} color="#e33835" style={{ marginBottom: 4 }} />
                    )}
                    <View style={[{
                      width: 56, height: 56, borderRadius: 28,
                      backgroundColor: theme.surface2, borderWidth: 2, borderColor: theme.border2,
                      justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginBottom: 8,
                    },
                      isFirst && { width: 68, height: 68, borderRadius: 34, borderColor: '#e33835' },
                      isMe    && { borderColor: '#4de926' },
                    ]}>
                      {u.avatar
                        ? <Image source={{ uri: u.avatar }} style={{ width: '100%', height: '100%' }} />
                        : <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: theme.text }}>{u.username.slice(0, 2).toUpperCase()}</Text>
                      }
                    </View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.text, marginBottom: 3, textAlign: 'center' }} numberOfLines={1}>
                      {u.username}
                    </Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: isFirst ? '#e33835' : theme.textDim, marginBottom: 8 }}>
                      {u.score.toLocaleString('pl-PL')} {scoreLabel}
                    </Text>
                    <View style={{
                      width: '100%', height: barH,
                      backgroundColor: theme.surface,
                      borderTopWidth: 3, borderLeftWidth: 1, borderRightWidth: 1,
                      borderTopLeftRadius: 8, borderTopRightRadius: 8,
                      borderColor: barColor,
                      justifyContent: 'center', alignItems: 'center',
                    }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 22, color: theme.text }}>{u.position}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* LISTA */}
          <View style={{ gap: 8 }}>
            {restUsers.map(u => {
              const isMe = u.id === myId;
              return (
                <TouchableOpacity
                  key={u.id}
                  style={[{
                    backgroundColor: theme.surface, borderRadius: 12, padding: 14,
                    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    borderWidth: 1, borderColor: theme.border2,
                  }, isMe && { borderColor: '#e3383540', backgroundColor: '#e3383510' }]}
                  onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: String(u.id) } })}
                  activeOpacity={0.8}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Text style={{ fontFamily: 'Orbitron', color: u.position <= 10 ? '#e33835' : theme.textDim, fontSize: 14, width: 24, textAlign: 'center' }}>
                      {u.position}
                    </Text>
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                      {u.avatar
                        ? <Image source={{ uri: u.avatar }} style={{ width: 42, height: 42 }} />
                        : <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text }}>{u.username.slice(0, 2).toUpperCase()}</Text>
                      }
                    </View>
                    <View>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12 }}>
                        {u.username}{isMe ? ' (Ty)' : ''}
                      </Text>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, marginTop: 2 }}>{u.sub}</Text>
                    </View>
                  </View>
                  <Text style={{ fontFamily: 'Orbitron', color: isMe ? '#e33835' : theme.text, fontSize: 14 }}>
                    {u.score.toLocaleString('pl-PL')} {scoreLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* TWOJA POZYCJA */}
          {myPosition && myPosition > 3 && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 20, backgroundColor: '#e3383515', borderRadius: 12, padding: 14,
              borderWidth: 1, borderColor: '#e3383530',
            }}>
              <MaterialIcons name="emoji-events" size={16} color="#e33835" />
              <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 13 }}>Twoja pozycja: #{myPosition}</Text>
            </View>
          )}

          {users.length === 0 && (
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, textAlign: 'center', marginTop: 40, fontSize: 12 }}>
              Brak danych dla wybranego okresu
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}