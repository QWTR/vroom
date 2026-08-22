import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useTheme } from '../../contexts/ThemeContext';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';
import { apiRequest } from '../../lib/api/client';
import { queryClient } from '../../lib/query/client';
import { enqueueSocialOperation, subscribeSocialQueue } from '../../lib/socialQueue';

type Tab = 'followers' | 'following';
type Person = {
  id: number;
  username: string;
  avatarUrl?: string | null;
  location?: string | null;
  isFollowing: boolean;
  canFollow: boolean;
};

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
  const nextCursorRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [changingId, setChangingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [myId, setMyId] = useState<number | null>(null);
  const pendingFollowsRef = useRef(new Map<string, Person>());

  useEffect(() => {
    void AsyncStorage.getItem('user').then((raw) => {
      if (!raw) return;
      try { const value = JSON.parse(raw); setMyId(Number(value.userId ?? value.id) || null); } catch { /* ignore */ }
    });
    return subscribeSocialQueue((event) => {
      const previous = pendingFollowsRef.current.get(event.operationId);
      if (!previous) return;
      if (event.status === 'failed') {
        setItems((current) => current.map((row) => row.id === previous.id ? previous : row));
      }
      if (event.status === 'completed' || event.status === 'failed') pendingFollowsRef.current.delete(event.operationId);
    });
  }, []);

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
    if (append) setLoadingMore(true);
    else if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const query = new URLSearchParams({ limit: '25', ...(search ? { search } : {}) });
      const cursor = append ? nextCursorRef.current : null;
      if (cursor) query.set('cursor', String(cursor));
      const queryKey = ['connections', userId, tab, search, append ? cursor : 'first'] as const;
      if (!append) {
        const cached = queryClient.getQueryData<any>(queryKey);
        if (cached?.items) { setItems(cached.items); setNextCursor(cached.nextCursor || null); setLoading(false); }
      }
      const json = await queryClient.fetchQuery<any>({
        queryKey,
        queryFn: () => apiRequest(`/follow/${userId}/${tab}?${query}`, { priority: append ? 'background' : 'visible' }),
        staleTime: 20_000,
      });
      setItems((previous) => append
        ? [...previous, ...(json.items || []).filter((person: Person) => !previous.some((row) => row.id === person.id))]
        : json.items || []);
      nextCursorRef.current = json.nextCursor || null;
      setNextCursor(nextCursorRef.current);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się pobrać listy');
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [search, tab, userId]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    nextCursorRef.current = null;
    void load();
  }, [load, tab, search, userId]);

  const toggleFollow = useCallback(async (person: Person) => {
    if (changingId || !myId) return;
    const nextFollowing = !person.isFollowing;
    const operationId = `follow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    pendingFollowsRef.current.set(operationId, person);
    setChangingId(person.id);
    setItems((previous) => previous.map((row) => row.id === person.id ? { ...row, isFollowing: nextFollowing } : row));
    try {
      await enqueueSocialOperation({
        userId: myId,
        type: 'follow',
        entityKey: `follow:${person.id}`,
        operationId,
        coalesce: true,
        request: {
          path: `/v2/social/users/${person.id}/follow`,
          method: nextFollowing ? 'PUT' : 'DELETE',
          optimisticEntity: { userId: person.id, isFollowing: nextFollowing },
          invalidateKeys: [['connections'], ['profile', person.id, 'summary']],
        },
      });
    } catch {
      pendingFollowsRef.current.delete(operationId);
      setItems((previous) => previous.map((row) => row.id === person.id ? { ...row, isFollowing: person.isFollowing } : row));
    } finally {
      setChangingId(null);
    }
  }, [changingId, myId]);

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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['connections', userId, tab, search] }).then(() => load({ silent: true }))} tintColor={theme.primary} />}
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
