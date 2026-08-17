import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';

type Tab = 'followers' | 'following';
type Person = {
  id: number;
  username: string;
  avatarUrl?: string | null;
  location?: string | null;
  isFollowing: boolean;
  canFollow: boolean;
};

const token = async () => (
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'))
);

export default function ConnectionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string; tab?: string }>();
  const { theme } = useTheme();
  const top = useScreenHeaderTop(8);
  const userId = Number(params.userId);
  const initialTab: Tab = params.tab === 'following' ? 'following' : 'followers';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [items, setItems] = useState<Person[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [changingId, setChangingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const load = useCallback(async ({ append = false, silent = false } = {}) => {
    if (!Number.isInteger(userId) || userId <= 0) {
      setError('Nieprawidłowy profil');
      setLoading(false);
      return;
    }
    append ? setLoadingMore(true) : silent ? setRefreshing(true) : setLoading(true);
    try {
      const authToken = await token();
      const query = new URLSearchParams({ limit: '25', ...(search ? { search } : {}) });
      if (append && nextCursor) query.set('cursor', String(nextCursor));
      const response = await fetch(`${API_URL}/api/follow/${userId}/${tab}?${query}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Nie udało się pobrać listy');
      setItems((previous) => append
        ? [...previous, ...(json.items || []).filter((person: Person) => !previous.some((row) => row.id === person.id))]
        : json.items || []);
      setNextCursor(json.nextCursor || null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się pobrać listy');
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [nextCursor, search, tab, userId]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void load();
    // nextCursor jest celowo pominięty — zmiana kursora nie może przeładować pierwszej strony.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, userId]);

  const toggleFollow = useCallback(async (person: Person) => {
    if (changingId) return;
    setChangingId(person.id);
    setItems((previous) => previous.map((row) => row.id === person.id ? { ...row, isFollowing: !row.isFollowing } : row));
    try {
      const authToken = await token();
      const response = await fetch(`${API_URL}/api/follow/${person.id}`, {
        method: person.isFollowing ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error('Nie udało się zmienić obserwowania');
    } catch {
      setItems((previous) => previous.map((row) => row.id === person.id ? { ...row, isFollowing: person.isFollowing } : row));
    } finally {
      setChangingId(null);
    }
  }, [changingId]);

  const title = useMemo(() => tab === 'followers' ? 'OBSERWUJĄCY' : 'OBSERWOWANI', [tab]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: top, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
            <MaterialIcons name="arrow-back" size={22} color={theme.text} />
          </TouchableOpacity>
          <Text style={{ flex: 1, color: theme.text, fontFamily: 'Orbitron', fontWeight: '800', fontSize: 15, letterSpacing: 1.5 }}>{title}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          {(['followers', 'following'] as Tab[]).map((key) => {
            const active = tab === key;
            return (
              <TouchableOpacity key={key} onPress={() => setTab(key)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: active ? `${theme.primary}22` : theme.surface, borderWidth: 1, borderColor: active ? theme.primary : theme.border }}>
                <Text style={{ color: active ? theme.primary : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{key === 'followers' ? 'OBSERWUJĄCY' : 'OBSERWOWANI'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
          <MaterialIcons name="search" size={19} color={theme.textDim} />
          <TextInput value={searchInput} onChangeText={setSearchInput} placeholder="Szukaj użytkownika…" placeholderTextColor={theme.textDim} style={{ flex: 1, color: theme.text, paddingVertical: 11, paddingHorizontal: 8 }} />
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={theme.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, gap: 8, flexGrow: items.length ? 0 : 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load({ silent: true })} tintColor={theme.primary} />}
          onEndReached={() => { if (nextCursor && !loadingMore) void load({ append: true }); }}
          onEndReachedThreshold={0.35}
          ListEmptyComponent={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: theme.textDim }}>{error || 'Brak użytkowników'}</Text></View>}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.primary} style={{ margin: 14 }} /> : null}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => router.push(`/profile/${item.id}` as any)} activeOpacity={0.78} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
              {item.avatarUrl ? <Image source={{ uri: item.avatarUrl }} style={{ width: 48, height: 48, borderRadius: 16 }} contentFit="cover" /> : <View style={{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.border }}><MaterialIcons name="person" size={24} color={theme.textDim} /></View>}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>{item.username}</Text>
                {!!item.location && <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 11, marginTop: 3 }}>{item.location}</Text>}
              </View>
              {item.canFollow && <TouchableOpacity onPress={(event) => { event.stopPropagation(); void toggleFollow(item); }} disabled={changingId === item.id} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: item.isFollowing ? theme.border : `${theme.primary}22`, borderWidth: 1, borderColor: item.isFollowing ? theme.border : theme.primary }}>
                <Text style={{ color: item.isFollowing ? theme.textDim : theme.primary, fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>{item.isFollowing ? 'OBSERWUJESZ' : 'OBSERWUJ'}</Text>
              </TouchableOpacity>}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
