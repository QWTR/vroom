import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  FlatList, Image, RefreshControl, ActivityIndicator, StatusBar,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';

const PAGE = 20;

interface Meet {
  id:               number;
  title:            string;
  description:      string | null;
  locationName:     string;
  lat:              number | null;
  lng:              number | null;
  date:             string;
  maxParticipants:  number;
  participantsCount: number;
  coverImage:       string | null;
  tags:             string[];
  status:           string | null;
  category:         string;
  isJoined:         boolean;
  creator: { id: number; username: string; avatarUrl: string | null };
  participants: { id: number; username: string; avatarUrl: string | null }[];
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function daysUntil(iso: string) {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff === 0) return 'Dziś';
  if (diff === 1) return 'Jutro';
  if (diff < 7)  return `Za ${diff} dni`;
  return null;
}

export default function EventsScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();

  const [category,    setCategory]    = useState<'unofficial' | 'official'>('unofficial');
  const [meets,       setMeets]       = useState<Meet[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [hasMore,     setHasMore]     = useState(true);
  const [cursor,      setCursor]      = useState<number | null>(null);
  const [search,      setSearch]      = useState('');

  const fetchingRef  = useRef(false);
  const searchTimer  = useRef<any>(null);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const fetchMeets = useCallback(async (reset = true, q = search, cat = category) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) setLoading(true);

    try {
      const token = await getToken();
      const params = new URLSearchParams({
        category: cat,
        limit:    String(PAGE),
        ...(q ? { search: q } : {}),
      });
      const r    = await fetch(`${API_URL}/api/meets?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      const list = data.meets ?? [];
      setMeets(reset ? list : prev => {
        const ids = new Set(prev.map((m: Meet) => m.id));
        return [...prev, ...list.filter((m: Meet) => !ids.has(m.id))];
      });
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
    } catch (e) { console.error('fetchMeets:', e); }
    finally {
      setLoading(false);
      setRefreshing(false);
      fetchingRef.current = false;
    }
  }, [search, category]);

  useEffect(() => { fetchMeets(true, search, category); }, [category]);
  useFocusEffect(useCallback(() => { fetchMeets(true, search, category); }, [category]));

  const handleSearch = (q: string) => {
    setSearch(q);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchMeets(true, q, category), 400);
  };

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || fetchingRef.current || !cursor) return;
    fetchingRef.current = true;
    setLoadingMore(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ category, limit: String(PAGE), cursor: String(cursor), ...(search ? { search } : {}) });
      const r    = await fetch(`${API_URL}/api/meets?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      const list = data.meets ?? [];
      setMeets(prev => {
        const ids = new Set(prev.map((m: Meet) => m.id));
        return [...prev, ...list.filter((m: Meet) => !ids.has(m.id))];
      });
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
    } catch (e) { console.error('loadMore:', e); }
    finally { setLoadingMore(false); fetchingRef.current = false; }
  }, [hasMore, loadingMore, cursor, category, search]);

  const handleJoin = useCallback(async (meetId: number) => {
    try {
      const token = await getToken();
      const r     = await fetch(`${API_URL}/api/meets/${meetId}/join`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      setMeets(prev => prev.map(m =>
        m.id === meetId
          ? { ...m, isJoined: data.joined, participantsCount: data.participantsCount }
          : m
      ));
    } catch (e) { console.error('handleJoin:', e); }
  }, []);

  const renderMeet = useCallback(({ item }: { item: Meet }) => {
    const pct      = item.participantsCount / item.maxParticipants;
    const spots    = item.maxParticipants - item.participantsCount;
    const badge    = daysUntil(item.date);
    const isFull   = spots <= 0;
    const isHot    = item.status === 'HOT' || pct >= 0.8;

    return (
      <TouchableOpacity
        onPress={() => router.push({ pathname: '/Community/meets/meet', params: { id: String(item.id) } })}
        activeOpacity={0.88}
        style={{
          backgroundColor: theme.surface,
          borderRadius: 18,
          marginBottom: 14,
          borderWidth: 1,
          borderColor: theme.border,
          overflow: 'hidden',
        }}
      >
        {/* Cover / placeholder */}
        {item.coverImage ? (
          <Image source={{ uri: item.coverImage }} style={{ width: '100%', height: 140 }} resizeMode="cover" />
        ) : (
          <View style={{ width: '100%', height: 100, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="car-multiple" size={40} color={theme.border3} />
          </View>
        )}

        {/* Badges na obrazku */}
        <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6 }}>
          {isHot && (
            <View style={{ backgroundColor: theme.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>🔥 HOT</Text>
            </View>
          )}
          {badge && (
            <View style={{ backgroundColor: '#000000aa', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>{badge}</Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={{ padding: 14, gap: 10 }}>
          {/* Tytuł + join */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Text style={{ flex: 1, color: theme.text, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700', lineHeight: 20 }}>
              {item.title}
            </Text>
            <TouchableOpacity
              onPress={() => handleJoin(item.id)}
              disabled={isFull && !item.isJoined}
              style={[{
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                borderWidth: 1,
              }, item.isJoined
                ? { backgroundColor: '#4de92615', borderColor: '#4de92640' }
                : isFull
                  ? { backgroundColor: theme.surface2, borderColor: theme.border }
                  : { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder }
              ]}
            >
              <Text style={{
                fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700',
                color: item.isJoined ? '#4de926' : isFull ? theme.textDim : theme.primary,
              }}>
                {item.isJoined ? '✓ DOŁĄCZONO' : isFull ? 'PEŁNE' : 'DOŁĄCZ'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Meta */}
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <MaterialIcons name="access-time" size={13} color={theme.primary} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>{formatDate(item.date)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <MaterialIcons name="location-on" size={13} color={theme.primary} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }} numberOfLines={1}>{item.locationName}</Text>
            </View>
          </View>

          {/* Tagi */}
          {item.tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {item.tags.slice(0, 4).map((tag, i) => (
                <View key={i} style={{ backgroundColor: theme.surface2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: theme.primaryBorder }}>
                  <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Pasek + uczestnicy */}
          <View style={{ gap: 6 }}>
            <View style={{ height: 4, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${Math.min(pct * 100, 100)}%`, backgroundColor: isFull ? '#e33835' : theme.primary, borderRadius: 2 }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              {/* Avatary uczestników */}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {item.participants.slice(0, 4).map((p, i) => (
                  <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -8, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.surface, overflow: 'hidden', backgroundColor: theme.surface2 }}>
                    {p.avatarUrl
                      ? <Image source={{ uri: p.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                      : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700' }}>{p.username.charAt(0).toUpperCase()}</Text>
                        </View>
                    }
                  </View>
                ))}
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, marginLeft: item.participants.length > 0 ? 8 : 0 }}>
                  {item.participantsCount}/{item.maxParticipants}
                </Text>
              </View>
              <Text style={{ color: isFull ? theme.primary : theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>
                {isFull ? 'BRAK MIEJSC' : `${spots} miejsc`}
              </Text>
            </View>
          </View>

          {/* Organizer */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.border }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {item.creator.avatarUrl
                ? <Image source={{ uri: item.creator.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700' }}>{item.creator.username.charAt(0).toUpperCase()}</Text>
              }
            </View>
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>
              <Text style={{ color: theme.text }}>@{item.creator.username}</Text>
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [theme, handleJoin, router]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />

      {/* HEADER */}
      <View style={{ paddingTop: 56, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: theme.primary, fontSize: 9, fontFamily: 'Orbitron', letterSpacing: 4 }}>VROOM</Text>
            <Text style={{ color: theme.text, fontSize: 22, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 2 }}>MEETY</Text>
          </View>
          <TouchableOpacity
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.push('/Community/meets/createmeet' as any)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="add" size={24} color={theme.primary} />
          </TouchableOpacity>
        </View>

        {/* Category toggle */}
        <View style={{ flexDirection: 'row', backgroundColor: theme.surface, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: theme.border }}>
          {(['unofficial', 'official'] as const).map(cat => (
            <TouchableOpacity
              key={cat}
              onPress={() => setCategory(cat)}
              style={[{
                flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
              }, category === cat && { backgroundColor: theme.primary }]}
              activeOpacity={0.8}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700', color: category === cat ? '#fff' : theme.textDim }}>
                {cat === 'unofficial' ? '🏁 NIEOFICJALNE' : '⭐ OFICJALNE'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Search */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 10, gap: 10 }}>
          <MaterialIcons name="search" size={16} color={theme.textDim} />
          <TextInput
            style={{ flex: 1, color: theme.text, fontFamily: 'Orbitron', fontSize: 12, padding: 0 }}
            placeholder="Szukaj meetów..."
            placeholderTextColor={theme.textDim}
            value={search}
            onChangeText={handleSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => handleSearch('')}>
              <MaterialIcons name="close" size={16} color={theme.textDim} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={meets}
        keyExtractor={m => String(m.id)}
        renderItem={renderMeet}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchMeets(true); }}
            tintColor={theme.primary} colors={[theme.primary]}
          />
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.primary} style={{ marginVertical: 16 }} /> : null}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={theme.primary} style={{ marginTop: 80 }} />
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 80, gap: 12 }}>
              <MaterialCommunityIcons name="car-off" size={52} color={theme.border3} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700' }}>
                {category === 'official' ? 'Brak oficjalnych meetów' : 'Brak meetów'}
              </Text>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, textAlign: 'center' }}>
                {category === 'unofficial' ? 'Bądź pierwszy i zorganizuj meet!' : 'Wkrótce pojawią się oficjalne wydarzenia'}
              </Text>
              {category === 'unofficial' && (
                <TouchableOpacity
                  onPress={() => router.push('/Community/meets/createmeet' as any)}
                  style={{ marginTop: 8, backgroundColor: theme.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 }}
                >
                  <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>+ UTWÓRZ MEET</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100, flexGrow: 1 }}
      />
    </View>
  );
}