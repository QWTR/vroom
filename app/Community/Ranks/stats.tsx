import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollView, StyleSheet, TouchableOpacity,
  View, Dimensions, Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { API_URL } from '../../../constants/config'; // ← 3 poziomy w górę

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
  const [category,   setCategory]   = useState<'points' | 'distance'>('points');
  const [period,     setPeriod]     = useState<string>('Wszystko');
  const [users,      setUsers]      = useState<RankUser[]>([]);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [myId,       setMyId]       = useState<number | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) {
        const u = JSON.parse(raw);
        setMyId(u.userId ?? u.id);
      }
    });
  }, []);

  const fetchRanking = useCallback(async (cat: string, per: string) => {
  try {
    const token = await AsyncStorage.getItem('token');
    const url   = `${API_URL}/api/profile/ranking?category=${cat}&period=${PERIOD_MAP[per]}`;

    const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();

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

  const topThree  = users.slice(0, 3);
  const restUsers = users.slice(3);

  // Podium kolejność: 2, 1, 3
  const podiumOrder = [topThree[1], topThree[0], topThree[2]].filter(Boolean);
  const scoreLabel  = category === 'points' ? 'pkt' : 'km';

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={{ paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e33835" />}
    >
      {/* NAGŁÓWEK */}
      <View style={s.header}>
        <Text style={s.headerTitle}>RANKING</Text>
        <Text style={s.headerSub}>NAJLEPSI KIEROWCY</Text>
      </View>

      {/* KATEGORIE */}
      <View style={s.tabs}>
        <TouchableOpacity
          style={[s.tab, category === 'points' && s.tabActive]}
          onPress={() => setCategory('points')}
        >
          <MaterialIcons name="star" size={14} color={category === 'points' ? '#fff' : '#ffffff40'} />
          <Text style={[s.tabText, category === 'points' && s.tabTextActive]}>PUNKTY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, category === 'distance' && s.tabActive]}
          onPress={() => setCategory('distance')}
        >
          <MaterialIcons name="speed" size={14} color={category === 'distance' ? '#fff' : '#ffffff40'} />
          <Text style={[s.tabText, category === 'distance' && s.tabTextActive]}>DYSTANS</Text>
        </TouchableOpacity>
      </View>

      {/* FILTR CZASU */}
      <View style={s.periods}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p}
            onPress={() => setPeriod(p)}
            style={[s.periodBtn, period === p && s.periodBtnActive]}
          >
            <Text style={[s.periodText, period === p && s.periodTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#e33835" style={{ marginTop: 60 }} />
      ) : (
        <>
          {/* PODIUM */}
          {topThree.length >= 3 && (
            <View style={s.podium}>
              {podiumOrder.map((u, idx) => {
                const isFirst  = u.position === 1;
                const barH     = [100, 130, 80][idx];
                const barColor = ['#ffffff50', '#e33835', '#ffffff30'][idx];
                const isMe     = u.id === myId;

                return (
                  <TouchableOpacity
                    key={u.id}
                    style={s.podiumCol}
                    onPress={() => router.push({
                      pathname: '/profile/[userId]',
                      params:   { userId: String(u.id) },
                    })}
                    activeOpacity={0.8}
                  >
                    {isFirst && (
                      <MaterialCommunityIcons name="crown" size={20} color="#e33835" style={s.crown} />
                    )}
                    <View style={[
                      s.podiumAvatar,
                      isFirst && s.podiumAvatarFirst,
                      isMe    && s.podiumAvatarMe,
                    ]}>
                      {u.avatar ? (
                        <Image source={{ uri: u.avatar }} style={s.podiumAvatarImg} />
                      ) : (
                        <Text style={s.podiumAvatarText}>{u.username.slice(0, 2).toUpperCase()}</Text>
                      )}
                    </View>
                    <Text style={s.podiumName} numberOfLines={1}>{u.username}</Text>
                    <Text style={[s.podiumScore, isFirst && { color: '#e33835' }]}>
                      {u.score.toLocaleString('pl-PL')} {scoreLabel}
                    </Text>
                    <View style={[s.podiumBar, { height: barH, borderColor: barColor }]}>
                      <Text style={s.podiumRank}>{u.position}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* LISTA */}
          <View style={s.list}>
            {restUsers.map(u => {
              const isMe = u.id === myId;
              return (
                <TouchableOpacity
                  key={u.id}
                  style={[s.listItem, isMe && s.listItemMe]}
                  onPress={() => router.push({
                    pathname: '/profile/[userId]',
                    params:   { userId: String(u.id) },
                  })}
                  activeOpacity={0.8}
                >
                  <View style={s.listLeft}>
                    <Text style={[s.listRank, u.position <= 10 && { color: '#e33835' }]}>
                      {u.position}
                    </Text>
                    <View style={s.listAvatar}>
                      {u.avatar ? (
                        <Image source={{ uri: u.avatar }} style={s.listAvatarImg} />
                      ) : (
                        <Text style={s.listAvatarText}>{u.username.slice(0, 2).toUpperCase()}</Text>
                      )}
                    </View>
                    <View>
                      <Text style={s.listName}>
                        {u.username}{isMe ? ' (Ty)' : ''}
                      </Text>
                      <Text style={s.listSub}>{u.sub}</Text>
                    </View>
                  </View>
                  <Text style={[s.listScore, isMe && { color: '#e33835' }]}>
                    {u.score.toLocaleString('pl-PL')} {scoreLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* TWOJA POZYCJA */}
          {myPosition && myPosition > 3 && (
            <View style={s.myPositionBanner}>
              <MaterialIcons name="emoji-events" size={16} color="#e33835" />
              <Text style={s.myPositionText}>Twoja pozycja: #{myPosition}</Text>
            </View>
          )}

          {users.length === 0 && (
            <Text style={s.empty}>Brak danych dla wybranego okresu</Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  header:            { marginTop: 60, marginBottom: 24, alignItems: 'center' },
  headerTitle:       { fontFamily: 'Orbitron', fontSize: 28, color: '#fff', letterSpacing: 2 },
  headerSub:         { fontFamily: 'Orbitron', fontSize: 11, color: '#ffffff40', marginTop: 4 },

  tabs:              { flexDirection: 'row', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 4, marginBottom: 16, gap: 4 },
  tab:               { flex: 1, flexDirection: 'row', paddingVertical: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 10, gap: 6 },
  tabActive:         { backgroundColor: '#e33835' },
  tabText:           { fontFamily: 'Orbitron', fontSize: 11, color: '#ffffff40' },
  tabTextActive:     { color: '#fff' },

  periods:           { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 30 },
  periodBtn:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#ffffff10' },
  periodBtnActive:   { backgroundColor: '#e3383520', borderColor: '#e33835' },
  periodText:        { fontFamily: 'Orbitron', fontSize: 10, color: '#ffffff40' },
  periodTextActive:  { color: '#e33835' },

  podium:            { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', marginBottom: 32, height: 260 },
  podiumCol:         { alignItems: 'center', width: width * 0.26 },
  crown:             { marginBottom: 4 },
  podiumAvatar:      { width: 56, height: 56, borderRadius: 28, backgroundColor: '#252525', borderWidth: 2, borderColor: '#ffffff20', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginBottom: 8 },
  podiumAvatarFirst: { width: 68, height: 68, borderRadius: 34, borderColor: '#e33835' },
  podiumAvatarMe:    { borderColor: '#4de926' },
  podiumAvatarImg:   { width: '100%', height: '100%' },
  podiumAvatarText:  { fontFamily: 'Orbitron', fontSize: 16, color: '#fff' },
  podiumName:        { fontFamily: 'Orbitron', fontSize: 9, color: '#fff', marginBottom: 3, textAlign: 'center' },
  podiumScore:       { fontFamily: 'Orbitron', fontSize: 10, color: '#ffffff60', marginBottom: 8 },
  podiumBar:         { width: '100%', backgroundColor: '#1a1a1a', borderTopWidth: 3, borderLeftWidth: 1, borderRightWidth: 1, borderTopLeftRadius: 8, borderTopRightRadius: 8, justifyContent: 'center', alignItems: 'center' },
  podiumRank:        { fontFamily: 'Orbitron', fontSize: 22, color: '#fff' },

  list:              { gap: 8 },
  listItem:          { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#ffffff08' },
  listItemMe:        { borderColor: '#e3383540', backgroundColor: '#e3383510' },
  listLeft:          { flexDirection: 'row', alignItems: 'center', gap: 12 },
  listRank:          { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 14, width: 24, textAlign: 'center' },
  listAvatar:        { width: 42, height: 42, borderRadius: 21, backgroundColor: '#252525', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  listAvatarImg:     { width: 42, height: 42 },
  listAvatarText:    { fontFamily: 'Orbitron', fontSize: 13, color: '#fff' },
  listName:          { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },
  listSub:           { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, marginTop: 2 },
  listScore:         { fontFamily: 'Orbitron', color: '#fff', fontSize: 14 },

  myPositionBanner:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, backgroundColor: '#e3383515', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e3383530' },
  myPositionText:    { fontFamily: 'Orbitron', color: '#e33835', fontSize: 13 },

  empty:             { fontFamily: 'Orbitron', color: '#ffffff30', textAlign: 'center', marginTop: 40, fontSize: 12 },
});