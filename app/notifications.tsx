import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
  StatusBar,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { emitFriendInviteHandled } from '../lib/friendInviteEvents';
import { useTheme } from '../contexts/ThemeContext';
import { API_URL } from '../constants/config';

const CHAT_API = `${API_URL}/api/chat`;

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

type Row = {
  id: number;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  data: Record<string, unknown> | null;
};

function parseData(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return null; }
  }
  return null;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const [rows, setRows]       = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState<'all' | 'friends' | 'following' | 'official'>('all');
  const [friendActionId, setFriendActionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      const r = await fetch(`${API_URL}/api/notifications?limit=100&page=1&scope=${scope}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error();
      const j = await r.json();
      const list: Row[] = (j.notifications ?? []).map((n: any) => ({
        ...n,
        data: parseData(n.data),
      }));
      setRows(list);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router, scope]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const markRead = async (id: number) => {
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setRows(prev => prev.map(x => (x.id === id ? { ...x, read: true } : x)));
    } catch { /* ignore */ }
  };

  const markAll = async () => {
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/notifications/read-all`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setRows(prev => prev.map(x => ({ ...x, read: true })));
    } catch { /* ignore */ }
  };

  const resolveFriendshipId = async (item: Row): Promise<number | null> => {
    const d = item.data;
    if (d?.friendshipId != null) return Number(d.friendshipId);
    const senderId = d?.userId != null ? Number(d.userId) : null;
    if (!senderId) return null;
    try {
      const token = await getToken();
      const r = await fetch(`${CHAT_API}/friends/requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return null;
      const requests = await r.json();
      const match = (requests ?? []).find((req: { id: number; requester: { id: number } }) =>
        req.requester?.id === senderId,
      );
      return match?.id ?? null;
    } catch {
      return null;
    }
  };

  const handleFriendAction = async (item: Row, action: 'accept' | 'reject') => {
    setFriendActionId(item.id);
    try {
      const token = await getToken();
      const friendshipId = await resolveFriendshipId(item);
      if (!friendshipId) {
        Toast.show({ type: 'error', text1: 'Zaproszenie wygasło lub zostało już obsłużone' });
        setRows(prev => prev.filter(x => x.id !== item.id));
        return;
      }
      const r = await fetch(`${CHAT_API}/friends/${friendshipId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error();
      if (!item.read) await markRead(item.id);
      setRows(prev => prev.filter(x => x.id !== item.id));
      emitFriendInviteHandled(friendshipId);
      Toast.show({
        type: 'success',
        text1: action === 'accept' ? '✅ Zaakceptowano zaproszenie' : 'Odrzucono zaproszenie',
      });
    } catch {
      Toast.show({ type: 'error', text1: 'Nie udało się obsłużyć zaproszenia' });
    } finally {
      setFriendActionId(null);
    }
  };

  const onPressRow = async (item: Row) => {
    if (item.type === 'friend_request') return;
    if (!item.read) await markRead(item.id);
    const d = item.data;
    const meetId = d?.meetId != null ? Number(d.meetId) : null;
    if ((item.type === 'meet_nearby_invite' || item.type === 'meet_joined') && meetId) {
      router.push({ pathname: '/Community/meets/meet', params: { id: String(meetId) } } as any);
      return;
    }
    if (item.type === 'market_message' && d?.conversationId != null) {
      router.push({ pathname: '/Community/market/chat/[convId]', params: { convId: String(d.conversationId) } } as any);
      return;
    }
    if (d?.conversationId != null)
      router.push(`/Community/chats/${d.conversationId}` as any);
    else if (
      d?.postId != null
      && (
        item.type === 'like_post'
        || item.type === 'comment_post'
        || item.type === 'comment_reply'
        || item.type === 'mention_discussion'
        || item.type === 'discussion_post_new'
      )
    ) {
      await AsyncStorage.setItem('open_post_id', String(d.postId));
      router.push('/Community/community/community' as any);
    } else if (item.type === 'friend_request' && d?.userId != null) {
      router.push({ pathname: '/profile/[userId]', params: { userId: String(d.userId) } } as any);
    } else if (d?.clubId != null) {
      const q = d.channelId ? `?channelId=${d.channelId}` : '';
      router.push(`/Community/clubs/${d.clubId}${q}` as any);
    } else if (item.type === 'mention_public_chat' || item.type === 'public_chat_message') {
      router.push('/Community/public/public' as any);
    }
  };

  const renderItem = ({ item }: { item: Row }) => (
    <TouchableOpacity
      onPress={() => onPressRow(item)}
      activeOpacity={item.type === 'friend_request' ? 1 : 0.85}
      disabled={item.type === 'friend_request'}
      style={{
        marginHorizontal: 16,
        marginBottom: 10,
        padding: 14,
        borderRadius: 14,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: item.read ? theme.border2 : theme.primaryBorder,
        opacity: item.read ? 0.85 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <Text style={{ flex: 1, color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>{item.title}</Text>
        {!item.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary, marginTop: 4 }} />}
      </View>
      <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 6, lineHeight: 18 }}>{item.body}</Text>
      {item.type === 'friend_request' && (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <TouchableOpacity
            onPress={() => void handleFriendAction(item, 'accept')}
            disabled={friendActionId === item.id}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              paddingVertical: 10, borderRadius: 10,
              backgroundColor: '#4de92620', borderWidth: 1, borderColor: '#4de92645',
            }}
          >
            {friendActionId === item.id
              ? <ActivityIndicator size="small" color="#4de926" />
              : <MaterialIcons name="check" size={16} color="#4de926" />
            }
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#4de926', fontWeight: '700' }}>AKCEPTUJ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void handleFriendAction(item, 'reject')}
            disabled={friendActionId === item.id}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              paddingVertical: 10, borderRadius: 10,
              backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder,
            }}
          >
            <MaterialIcons name="close" size={16} color={theme.primary} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.primary, fontWeight: '700' }}>ODRZUĆ</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={{ color: theme.textFaint, fontSize: 9, marginTop: 8 }}>
        {new Date(item.createdAt).toLocaleString('pl-PL')}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={{ paddingTop: 52, paddingHorizontal: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6 }}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700', color: theme.text }}>POWIADOMIENIA</Text>
        <TouchableOpacity onPress={markAll} style={{ padding: 6 }}>
          <MaterialIcons name="done-all" size={22} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={i => String(i.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={theme.primary}
            />
          }
          ListHeaderComponent={(
            <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 }}>
              {[
                { id: 'all', label: 'Wszystkie' },
                { id: 'friends', label: 'Znajomi' },
                { id: 'following', label: 'Obserwowani' },
                { id: 'official', label: 'Oficjalne' },
              ].map((f) => (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => { setScope(f.id as any); setLoading(true); }}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: scope === f.id ? theme.primary : theme.border,
                    backgroundColor: scope === f.id ? theme.primaryBg : theme.surface,
                  }}
                >
                  <Text style={{ color: scope === f.id ? theme.primary : theme.textDim, fontSize: 11, fontFamily: 'Orbitron' }}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          ListEmptyComponent={(
            <Text style={{ textAlign: 'center', color: theme.textDim, marginTop: 40, fontFamily: 'Orbitron' }}>
              Brak powiadomień
            </Text>
          )}
        />
      )}
    </View>
  );
}
