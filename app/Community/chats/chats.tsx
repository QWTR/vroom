import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Image, StyleSheet, StatusBar, TextInput,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';

const API = 'https://v-room.app/api/chat';
const WS  = 'https://v-room.app';

interface Conversation {
  id:          number;
  isGroup:     boolean;
  name:        string;
  avatarUrl:   string | null;
  online:      boolean;
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
    const date  = new Date(iso);
    const now   = new Date();
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

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filtered,      setFiltered]      = useState<Conversation[]>([]);
  const [search,        setSearch]        = useState('');
  const [loading,       setLoading]       = useState(false);
  const [myId,          setMyId]          = useState<number | null>(null);
  const socketRef = React.useRef<Socket | null>(null);

  // ── Init: pobierz myId + podłącz socket ─────────────────
  useEffect(() => {
    (async () => {
      const raw   = await AsyncStorage.getItem('user');
      const token = await AsyncStorage.getItem('token');
      if (raw)   setMyId(JSON.parse(raw).userId);
      if (!token) return;

      const socket = io(WS, { auth: { token }, transports: ['websocket'] });

      // Nowe powiadomienie → aktualizuj listę
      socket.on('chat:notification', ({ conversationId, message }: any) => {
        setConversations(prev => {
          const updated = prev.map(c =>
            c.id === conversationId
              ? {
                  ...c,
                  unread:      c.unread + 1,
                  lastMessage: {
                    content:    message.content ?? '',
                    photos:     [],
                    createdAt:  new Date().toISOString(),
                    senderName: message.senderName,
                    isMe:       false,
                  },
                }
              : c
          );
          return updated.sort((a, b) => {
            const at = a.lastMessage?.createdAt ?? '';
            const bt = b.lastMessage?.createdAt ?? '';
            return bt.localeCompare(at);
          });
        });
      });

      // Nowa konwersacja
      socket.on('chat:new_conversation', () => {
        fetchConversations();
      });

      socketRef.current = socket;
    })();

    return () => { socketRef.current?.disconnect(); };
  }, []);

  // ── Fetch ────────────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const r     = await fetch(`${API}/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      setConversations(Array.isArray(data) ? data : []);
      setFiltered(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('fetchConversations:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // ── Search ───────────────────────────────────────────────
  useEffect(() => {
    if (!search.trim()) {
      setFiltered(conversations);
      return;
    }
    const q = search.toLowerCase();
    setFiltered(
      conversations.filter(c => c.name?.toLowerCase().includes(q))
    );
  }, [search, conversations]);

  // ── Render item ──────────────────────────────────────────
  const renderItem = useCallback(({ item }: { item: Conversation }) => {
    const lastText = item.lastMessage
      ? item.lastMessage.content?.trim()
        || (item.lastMessage.photos?.length ? '📷 Zdjęcie' : '')
      : 'Brak wiadomości';

    const lastPrefix = item.lastMessage?.isMe ? 'Ty: ' : '';

    return (
      <TouchableOpacity
        style={s.item}
        onPress={() => router.push(`/Community/chats/${item.id}` as any)}
        activeOpacity={0.72}
      >
        {/* Avatar */}
        <View style={s.avatarWrap}>
          {item.avatarUrl ? (
            <Image source={{ uri: item.avatarUrl }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarInitials}>
                {item.name?.slice(0, 2).toUpperCase() ?? '??'}
              </Text>
            </View>
          )}
          {/* Online dot — tylko dla 1:1 */}
          {!item.isGroup && item.online && (
            <View style={s.onlineDot} />
          )}
          {/* Grupa ikona */}
          {item.isGroup && (
            <View style={s.groupBadge}>
              <MaterialCommunityIcons name="account-group" size={9} color="#fff" />
            </View>
          )}
        </View>

        {/* Info */}
        <View style={s.info}>
          <View style={s.row}>
            <Text style={s.name} numberOfLines={1}>{item.name}</Text>
            {item.lastMessage?.createdAt && (
              <Text style={s.time}>
                {formatTime(item.lastMessage.createdAt)}
              </Text>
            )}
          </View>
          <View style={s.row}>
            <Text style={s.lastMsg} numberOfLines={1}>
              {lastPrefix}{lastText}
            </Text>
            {item.unread > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeText}>
                  {item.unread > 99 ? '99+' : item.unread}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [router]);

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* ── HEADER ── */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <View>
            <Text style={s.headerSub}>VROOM</Text>
            <Text style={s.headerTitle}>WIADOMOŚCI</Text>
          </View>
          {/* Nowy czat */}
          <TouchableOpacity
            style={s.newBtn}
            onPress={() => router.push('/Community/chats/new' as any)}
            activeOpacity={0.8}
          >
            <Feather name="edit" size={18} color="#e33835" />
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        <View style={s.searchBar}>
          <Feather name="search" size={15} color="#ffffff40" />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Szukaj konwersacji..."
            placeholderTextColor="#ffffff30"
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={15} color="#ffffff40" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── LISTA ── */}
      <FlatList
        data={filtered}
        keyExtractor={item => String(item.id)}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={fetchConversations}
            tintColor="#e33835"
            colors={['#e33835']}
          />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator
              color="#e33835"
              style={{ marginTop: 60 }}
            />
          ) : (
            <View style={s.empty}>
              <MaterialCommunityIcons
                name="chat-outline"
                size={52}
                color="#ffffff12"
              />
              <Text style={s.emptyTitle}>
                {search ? 'Brak wyników' : 'Brak wiadomości'}
              </Text>
              <Text style={s.emptySub}>
                {search
                  ? `Nie znaleziono "${search}"`
                  : 'Kliknij ikonę edycji żeby\nrozpocząć rozmowę'
                }
              </Text>
              {!search && (
                <TouchableOpacity
                  style={s.emptyBtn}
                  onPress={() => router.push('/Community/chats/new' as any)}
                >
                  <Feather name="edit" size={14} color="#fff" />
                  <Text style={s.emptyBtnText}>NOWA ROZMOWA</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
        contentContainerStyle={
          filtered.length === 0 ? { flex: 1 } : { paddingBottom: 100 }
        }
        ItemSeparatorComponent={() => <View style={s.separator} />}
      />
    </View>
  );
}

const AVATAR = 54;

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  // ── Header ──
  header: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff08',
    gap: 14,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSub: {
    color: '#e33835',
    fontSize: 10,
    fontFamily: 'Orbitron',
    letterSpacing: 4,
    marginBottom: 2,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontFamily: 'Orbitron',
    fontWeight: '700',
    letterSpacing: 2,
  },
  newBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#e3383518',
    borderWidth: 1,
    borderColor: '#e3383535',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Search ──
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff0a',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 13,
    padding: 0,
  },

  // ── Item ──
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
    gap: 14,
    backgroundColor: '#0a0a0a',
  },
  separator: {
    height: 1,
    backgroundColor: '#ffffff06',
    marginLeft: 20 + AVATAR + 14,
  },

  // ── Avatar ──
  avatarWrap: {
    position: 'relative',
    width: AVATAR,
    height: AVATAR,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
  },
  avatarFallback: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1.5,
    borderColor: '#e3383530',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#e33835',
    fontFamily: 'Orbitron',
    fontSize: 16,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#4de926',
    borderWidth: 2,
    borderColor: '#0a0a0a',
  },
  groupBadge: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#e33835',
    borderWidth: 2,
    borderColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Info ���─
  info: {
    flex: 1,
    gap: 5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
    color: '#ffffff',
    fontFamily: 'Orbitron',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  time: {
    color: '#ffffff35',
    fontSize: 10,
    flexShrink: 0,
  },
  lastMsg: {
    flex: 1,
    color: '#ffffff45',
    fontSize: 12,
    lineHeight: 16,
  },
  badge: {
    backgroundColor: '#e33835',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },

  // ── Empty ──
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 80,
  },
  emptyTitle: {
    color: '#ffffff30',
    fontFamily: 'Orbitron',
    fontSize: 14,
    fontWeight: '700',
  },
  emptySub: {
    color: '#ffffff20',
    fontFamily: 'Orbitron',
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 16,
    letterSpacing: 0.5,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    backgroundColor: '#e33835',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  emptyBtnText: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
});