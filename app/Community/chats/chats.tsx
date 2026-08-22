import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StatusBar, RefreshControl, ActivityIndicator, Modal,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../../contexts/ThemeContext';
import { CommunityScreenHeader, CommunityEmptyState } from '../../../components/community';
import { ChatConversationListItem, type ConversationListData } from '../../../components/chat/v2';
import { apiRequest, ApiRequestError } from '../../../lib/api/client';
import { queryClient } from '../../../lib/query/client';
import { subscribeSharedSocket } from '../../../lib/sharedSocket';

const PAGE = 8;

type Segment = 'all' | 'unread' | 'groups';

interface Conversation {
  id:           number;
  isGroup:      boolean;
  name:         string;
  avatarUrl:    string | null;
  online:       boolean;
  participants: any[];
  lastMessage: {
    content:    string;
    photos:     string[];
    createdAt:  string;
    senderName: string;
    isMe:       boolean;
  } | null;
  unread: number;
}

export default function ChatsIndex() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { theme, isDark } = useTheme();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filtered,      setFiltered]      = useState<Conversation[]>([]);
  const [search,        setSearch]        = useState('');
  const [segment,       setSegment]       = useState<Segment>('all');
  const [loading,       setLoading]       = useState(false);
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [hasMore,       setHasMore]       = useState(true);
  const [cursor,        setCursor]        = useState<string | null>(null);
  const [myId,          setMyId]          = useState<number | null>(null);
  const [errorModalVisible, setErrorModalVisible] = useState(false);
  const [errorMessage,  setErrorMessage]  = useState('');
  const [authError,     setAuthError]     = useState(false);

  const fetchingRef  = useRef(false); // blokada podwójnego fetcha

  // ── Init socket ────────────────────────────────────────
  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    const cleanup: Array<() => void> = [];
    void (async () => {
      const raw   = await AsyncStorage.getItem('user');
      if (raw) setMyId(JSON.parse(raw).userId);
      cleanup.push(await subscribeSharedSocket<any>('chat:notification', ({ conversationId, message, isMe }) => {
        if (!active) return;
        setConversations(prev => {
          const updated = prev.map(c =>
            c.id === conversationId
              ? {
                  ...c,
                  unread: isMe ? c.unread : c.unread + 1,
                  lastMessage: {
                    content:    message.content ?? '',
                    photos:     [],
                    createdAt:  new Date().toISOString(),
                    senderName: message.senderName,
                    isMe:       !!isMe,
                  },
                }
              : c
          );
          return updated.sort((a, b) =>
            (b.lastMessage?.createdAt ?? '').localeCompare(a.lastMessage?.createdAt ?? '')
          );
        });
      }));
      cleanup.push(await subscribeSharedSocket('chat:new_conversation', () => { if (active) void fetchConversations(true); }));
    })();

    return () => { active = false; cleanup.forEach((dispose) => dispose()); };
  }, [isFocused]);

  // ── Pobierz pierwszą stronę ────────────────────────────
  const fetchConversations = useCallback(async (reset = true) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) setLoading(true);

    try {
      const data = await queryClient.fetchQuery({
        queryKey: ['chat', 'inbox', 'first', PAGE],
        queryFn: ({ signal }) => apiRequest<{ items: Conversation[]; nextCursor: string | null; hasMore: boolean }>(`/api/v2/chat/conversations?limit=${PAGE}`, { signal, priority: 'critical' }),
        staleTime: 20_000,
      });
      const list = data.items;
      const next = data.nextCursor;

      setConversations(list);
      setFiltered(list);
      setCursor(next);
      setHasMore(!!next);
      setAuthError(false);
      setErrorModalVisible(false);
    } catch (e) {
      console.error('fetchConversations: network/parsing error', e);
      setAuthError(e instanceof ApiRequestError && e.status === 401);
      setErrorMessage(e instanceof Error ? e.message : 'Nie udało się załadować czatów. Sprawdź połączenie i spróbuj ponownie.');
      setErrorModalVisible(true);
    }
    finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  // ── Załaduj więcej (scroll w dół) ─────────────────────
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || fetchingRef.current || !cursor || search) return;
    fetchingRef.current = true;
    setLoadingMore(true);
    try {
      const data = await apiRequest<{ items: Conversation[]; nextCursor: string | null; hasMore: boolean }>(
        `/api/v2/chat/conversations?limit=${PAGE}&cursor=${encodeURIComponent(cursor)}`,
        { priority: 'visible' },
      );
      const list = data.items;
      const next = data.nextCursor;

      setConversations(prev => {
        const ids     = new Set(prev.map(c => c.id));
        const newOnes = list.filter((c: Conversation) => !ids.has(c.id));
        return [...prev, ...newOnes];
      });
      setCursor(next);
      setHasMore(!!next);
    } catch (e) { console.error('loadMore: network/parsing error', e); }
    finally {
      setLoadingMore(false);
      fetchingRef.current = false;
    }
  }, [hasMore, loadingMore, cursor, search]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);
  useFocusEffect(useCallback(() => { fetchConversations(); }, [fetchConversations]));

  // ── Filtrowanie lokalne ────────────────────────────────
  useEffect(() => {
    let list = conversations;
    if (segment === 'unread') list = list.filter(c => c.unread > 0);
    if (segment === 'groups') list = list.filter(c => c.isGroup);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name?.toLowerCase().includes(q));
    }
    setFiltered(list);
  }, [search, conversations, segment]);

  const toListItem = useCallback((item: Conversation): ConversationListData => ({
    id: item.id,
    name: item.name,
    avatarUrl: item.avatarUrl,
    isGroup: item.isGroup,
    online: item.online,
    unread: item.unread,
    lastMessage: item.lastMessage
      ? {
          content: item.lastMessage.content,
          photos: item.lastMessage.photos,
          createdAt: item.lastMessage.createdAt,
          isMe: item.lastMessage.isMe,
        }
      : null,
  }), []);

  const renderItem = useCallback(({ item }: { item: Conversation }) => (
    <ChatConversationListItem
      item={toListItem(item)}
      onPress={() => router.push(`/Community/chats/${item.id}` as any)}
    />
  ), [router, toListItem]);

  const segments: { id: Segment; label: string }[] = [
    { id: 'all', label: 'WSZYSTKIE' },
    { id: 'unread', label: 'NIEPRZECZYTANE' },
    { id: 'groups', label: 'GRUPY' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />

      <CommunityScreenHeader
        title="WIADOMOŚCI"
        right={
          <TouchableOpacity
            style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.push('/Community/chats/new' as any)}
            activeOpacity={0.8}
          >
            <Feather name="edit" size={18} color={theme.primary} />
          </TouchableOpacity>
        }
      />
      <View style={{ paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: theme.surface2, borderRadius: 14, borderWidth: 1, borderColor: theme.border2,
          paddingHorizontal: 14, paddingVertical: 11,
        }}>
          <Feather name="search" size={16} color={theme.textDim} />
          <TextInput
            style={{ flex: 1, color: theme.text, fontSize: 13, fontFamily: 'Orbitron' }}
            value={search}
            onChangeText={setSearch}
            placeholder="Szukaj konwersacji..."
            placeholderTextColor={theme.textDim}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={15} color={theme.textDim} />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {segments.map(s => {
            const active = segment === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                onPress={() => setSegment(s.id)}
                style={{
                  flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10,
                  backgroundColor: active ? theme.primaryBg : theme.surface2,
                  borderWidth: 1,
                  borderColor: active ? theme.primaryBorder : theme.border,
                }}
              >
                <Text style={{
                  color: active ? theme.primary : theme.textDim,
                  fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 0.5, fontWeight: '700',
                }}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => String(item.id)}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => fetchConversations(true)}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore
            ? <ActivityIndicator color={theme.primary} style={{ marginVertical: 16 }} />
            : null
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={theme.primary} style={{ marginTop: 60 }} />
          ) : (
            <CommunityEmptyState
              icon="chat-outline"
              title={search ? 'Brak wyników' : 'Brak wiadomości'}
              subtitle={search ? `Nie znaleziono "${search}"` : 'Kliknij ikonę edycji żeby rozpocząć rozmowę'}
              actionLabel={search ? undefined : 'NOWA ROZMOWA'}
              onAction={search ? undefined : () => router.push('/Community/chats/new' as any)}
            />
          )
        }
        contentContainerStyle={filtered.length === 0 ? { flex: 1 } : { paddingBottom: 100 }}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 88 }} />
        )}
      />

      <Modal
        visible={errorModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setErrorModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#00000088', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <View style={{ width: '100%', maxWidth: 360, backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border2, padding: 18, gap: 14 }}>
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }}>
              BŁĄD ŁADOWANIA CZATÓW
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 18 }}>
              {errorMessage || 'Nie udało się załadować czatów.'}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
              <TouchableOpacity
                style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: theme.border2, backgroundColor: theme.surface2 }}
                onPress={() => setErrorModalVisible(false)}
              >
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>ZAMKNIJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.primary }}
                onPress={() => {
                  setErrorModalVisible(false);
                  if (authError) {
                    router.replace('/login' as any);
                  } else {
                    fetchConversations(true);
                  }
                }}
              >
                <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>
                  {authError ? 'ZALOGUJ PONOWNIE' : 'SPRÓBUJ PONOWNIE'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
