import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Image, StatusBar, TextInput,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { useTheme } from '../../../contexts/ThemeContext';

const API      = 'https://v-room.app/api/chat';
const WS       = 'https://v-room.app';
const AVATAR   = 54;
const PAGE     = 8;

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

function formatTime(iso: string): string {
  try {
    const date   = new Date(iso);
    const now    = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffM  = Math.floor(diffMs / 60000);
    const diffH  = Math.floor(diffMs / 3600000);
    const diffD  = Math.floor(diffMs / 86400000);
    if (diffM < 1)  return 'teraz';
    if (diffM < 60) return `${diffM}min`;
    if (diffH < 24) return `${diffH}h`;
    if (diffD < 7)  return `${diffD}d`;
    return date.toLocaleDateString('pl', { day: '2-digit', month: '2-digit' });
  } catch { return ''; }
}

export default function ChatsIndex() {
  const router = useRouter();
  const { theme, isDark } = useTheme();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filtered,      setFiltered]      = useState<Conversation[]>([]);
  const [search,        setSearch]        = useState('');
  const [loading,       setLoading]       = useState(false);
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [hasMore,       setHasMore]       = useState(true);
  const [cursor,        setCursor]        = useState<number | null>(null);
  const [myId,          setMyId]          = useState<number | null>(null);

  const socketRef    = useRef<Socket | null>(null);
  const fetchingRef  = useRef(false); // blokada podwójnego fetcha

  // ── Init socket ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const raw   = await AsyncStorage.getItem('user');
      const token = await AsyncStorage.getItem('token');
      if (raw) setMyId(JSON.parse(raw).userId);
      if (!token) return;

      const socket = io(WS, { auth: { token }, transports: ['websocket'] });

      socket.on('chat:notification', ({ conversationId, message, isMe }: any) => {
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
      });

      socket.on('chat:new_conversation', () => fetchConversations(true));
      socketRef.current = socket;
    })();

    return () => { socketRef.current?.disconnect(); };
  }, []);

  // ── Pobierz pierwszą stronę ────────────────────────────
  const fetchConversations = useCallback(async (reset = true) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) setLoading(true);

    try {
      const token = await AsyncStorage.getItem('token');
      const url   = `${API}/conversations?limit=${PAGE}`;
      const r     = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data  = await r.json();
      const list  = Array.isArray(data) ? data : (data.conversations ?? []);
      const next  = data.nextCursor ?? null;

      setConversations(list);
      setFiltered(list);
      setCursor(next);
      setHasMore(!!next);
    } catch (e) { console.error('fetchConversations:', e); }
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
      const token = await AsyncStorage.getItem('token');
      const r     = await fetch(
        `${API}/conversations?limit=${PAGE}&cursor=${cursor}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await r.json();
      const list = Array.isArray(data) ? data : (data.conversations ?? []);
      const next = data.nextCursor ?? null;

      setConversations(prev => {
        const ids     = new Set(prev.map(c => c.id));
        const newOnes = list.filter((c: Conversation) => !ids.has(c.id));
        return [...prev, ...newOnes];
      });
      setCursor(next);
      setHasMore(!!next);
    } catch (e) { console.error('loadMore:', e); }
    finally {
      setLoadingMore(false);
      fetchingRef.current = false;
    }
  }, [hasMore, loadingMore, cursor, search]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);
  useFocusEffect(useCallback(() => { fetchConversations(); }, [fetchConversations]));

  // ── Filtrowanie lokalne ────────────────────────────────
  useEffect(() => {
    if (!search.trim()) { setFiltered(conversations); return; }
    const q = search.toLowerCase();
    setFiltered(conversations.filter(c => c.name?.toLowerCase().includes(q)));
  }, [search, conversations]);

  // ── Render konwersacji ─────────────────────────────────
  const renderItem = useCallback(({ item }: { item: Conversation }) => {
    const lastText   = item.lastMessage
      ? item.lastMessage.content?.trim() || (item.lastMessage.photos?.length ? '📷 Zdjęcie' : '')
      : 'Brak wiadomości';
    const lastPrefix = item.lastMessage?.isMe ? 'Ty: ' : '';

    return (
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13, gap: 14, backgroundColor: theme.bg }}
        onPress={() => router.push(`/Community/chats/${item.id}` as any)}
        activeOpacity={0.72}
      >
        <View style={{ position: 'relative', width: AVATAR, height: AVATAR }}>
          {item.avatarUrl
            ? <Image source={{ uri: item.avatarUrl }} style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 }} />
            : (
              <View style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: theme.surface2, borderWidth: 1.5, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700' }}>
                  {item.name?.slice(0, 2).toUpperCase() ?? '??'}
                </Text>
              </View>
            )
          }
          {!item.isGroup && item.online && (
            <View style={{ position: 'absolute', bottom: 2, right: 2, width: 13, height: 13, borderRadius: 7, backgroundColor: '#4de926', borderWidth: 2, borderColor: theme.bg }} />
          )}
          {item.isGroup && (
            <View style={{ position: 'absolute', bottom: 1, right: 1, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.primary, borderWidth: 2, borderColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="account-group" size={9} color="#fff" />
            </View>
          )}
        </View>

        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flex: 1, color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }} numberOfLines={1}>{item.name}</Text>
            {item.lastMessage?.createdAt && (
              <Text style={{ color: theme.textDim, fontSize: 10, flexShrink: 0 }}>{formatTime(item.lastMessage.createdAt)}</Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flex: 1, color: theme.textDim, fontSize: 12, lineHeight: 16 }} numberOfLines={1}>{lastPrefix}{lastText}</Text>
            {item.unread > 0 && (
              <View style={{ backgroundColor: theme.primary, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{item.unread > 99 ? '99+' : item.unread}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [router, theme]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />

      {/* HEADER */}
      <View style={{ paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: theme.primary, fontSize: 10, fontFamily: 'Orbitron', letterSpacing: 4, marginBottom: 2 }}>VROOM</Text>
            <Text style={{ color: theme.text, fontSize: 24, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 2 }}>WIADOMOŚCI</Text>
          </View>
          <TouchableOpacity
            style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.push('/Community/chats/new' as any)}
            activeOpacity={0.8}
          >
            <Feather name="edit" size={18} color={theme.primary} />
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border2, paddingHorizontal: 14, paddingVertical: 11, gap: 10 }}>
          <Feather name="search" size={15} color={theme.textDim} />
          <TextInput
            style={{ flex: 1, color: theme.text, fontSize: 13, padding: 0 }}
            value={search}
            onChangeText={setSearch}
            placeholder="Szukaj konwersacji..."
            placeholderTextColor={theme.textDim}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={15} color={theme.textDim} />
            </TouchableOpacity>
          )}
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
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 80, paddingTop: 60 }}>
              <MaterialCommunityIcons name="chat-outline" size={52} color={theme.border3} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700' }}>
                {search ? 'Brak wyników' : 'Brak wiadomości'}
              </Text>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, textAlign: 'center', lineHeight: 16 }}>
                {search ? `Nie znaleziono "${search}"` : 'Kliknij ikonę edycji żeby\nrozpocząć rozmowę'}
              </Text>
              {!search && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, backgroundColor: theme.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20 }}
                  onPress={() => router.push('/Community/chats/new' as any)}
                >
                  <Feather name="edit" size={14} color="#fff" />
                  <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>NOWA ROZMOWA</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
        contentContainerStyle={filtered.length === 0 ? { flex: 1 } : { paddingBottom: 100 }}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 20 + AVATAR + 14 }} />
        )}
      />
    </View>
  );
}