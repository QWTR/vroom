import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StatusBar,
  DeviceEventEmitter,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { emitFriendInviteHandled } from '../lib/friendInviteEvents';
import { useTheme } from '../contexts/ThemeContext';
import { API_URL } from '../constants/config';
import { useScreenHeaderTop } from '../lib/screenHeaderInsets';
import { markNotificationOpened, resolveNotificationUrl, type NotificationData } from '../lib/notifications/routing';
import { consumeNotificationCenterEntry } from '../lib/notifications/notificationCenterAccess';

const CHAT_API = `${API_URL}/api/chat`;
const PAGE_SIZE = 30;
type Scope = 'all' | 'messages' | 'activity' | 'system';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

type Row = {
  id: number;
  type: string;
  title: string;
  body: string;
  category?: string;
  url?: string | null;
  read: boolean;
  createdAt: string;
  data: NotificationData | null;
};

function parseData(data: unknown): NotificationData | null {
  if (!data) return null;
  if (typeof data === 'object' && !Array.isArray(data)) return data as NotificationData;
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return null; }
  }
  return null;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [entryAllowed] = React.useState(() => consumeNotificationCenterEntry());
  const { theme, isDark } = useTheme();
  const headerTop = useScreenHeaderTop(8);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<Scope>('all');
  const [friendActionId, setFriendActionId] = useState<number | null>(null);

  React.useEffect(() => {
    if (!entryAllowed) router.replace('/(tabs)' as any);
  }, [entryAllowed, router]);

  const load = useCallback(async (nextPage = 1, append = false) => {
    try {
      const token = await getToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      const category = scope === 'all' ? '' : `&category=${scope}`;
      const response = await fetch(`${API_URL}/api/notifications?limit=${PAGE_SIZE}&page=${nextPage}${category}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error();
      const json = await response.json();
      const nextRows: Row[] = (json.notifications ?? []).map((item: Row) => ({
        ...item,
        data: parseData(item.data),
      }));
      setRows((current) => append ? [...current, ...nextRows.filter((item) => !current.some((old) => old.id === item.id))] : nextRows);
      setPage(nextPage);
      setHasMore(Boolean(json.hasMore));
    } catch {
      Toast.show({ type: 'error', text1: 'Nie udało się pobrać powiadomień' });
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [router, scope]);

  useFocusEffect(useCallback(() => {
    if (!entryAllowed) return;
    setLoading(true);
    void load(1, false);
  }, [entryAllowed, load]));

  React.useEffect(() => {
    if (!entryAllowed) return;
    const subscription = DeviceEventEmitter.addListener('vroom:notification-received', () => {
      void load(1, false);
    });
    return () => subscription.remove();
  }, [entryAllowed, load]);

  const markRead = async (id: number) => {
    const token = await getToken();
    await fetch(`${API_URL}/api/notifications/${id}/read`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setRows((current) => current.map((item) => item.id === id ? { ...item, read: true } : item));
  };

  const markAll = async () => {
    const token = await getToken();
    await fetch(`${API_URL}/api/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(scope === 'all' ? {} : { category: scope }),
    }).catch(() => {});
    setRows((current) => current.map((item) => ({ ...item, read: true })));
  };

  const resolveFriendshipId = async (item: Row): Promise<number | null> => {
    if (item.data?.friendshipId != null) return Number(item.data.friendshipId);
    const senderId = Number(item.data?.userId);
    if (!senderId) return null;
    const token = await getToken();
    const response = await fetch(`${CHAT_API}/friends/requests`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const requests = await response.json();
    return requests.find((request: { id: number; requester: { id: number } }) => request.requester?.id === senderId)?.id ?? null;
  };

  const handleFriendAction = async (item: Row, action: 'accept' | 'reject') => {
    setFriendActionId(item.id);
    try {
      const token = await getToken();
      const friendshipId = await resolveFriendshipId(item);
      if (!friendshipId) throw Object.assign(new Error(), { expired: true });
      const response = await fetch(`${CHAT_API}/friends/${friendshipId}/${action}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error();
      await markRead(item.id);
      setRows((current) => current.filter((row) => row.id !== item.id));
      emitFriendInviteHandled(friendshipId);
      Toast.show({ type: 'success', text1: action === 'accept' ? 'Zaakceptowano zaproszenie' : 'Odrzucono zaproszenie' });
    } catch (error: any) {
      Toast.show({ type: 'error', text1: error?.expired ? 'Zaproszenie nie jest już dostępne' : 'Nie udało się obsłużyć zaproszenia' });
    } finally {
      setFriendActionId(null);
    }
  };

  const onPressRow = async (item: Row) => {
    const data: NotificationData = { ...(item.data || {}), type: item.type, notificationId: item.id, url: item.url || item.data?.url };
    await markNotificationOpened(data);
    setRows((current) => current.map((row) => row.id === item.id ? { ...row, read: true } : row));
    router.push(resolveNotificationUrl(data) as any);
  };

  const renderItem = ({ item }: { item: Row }) => (
    <TouchableOpacity
      onPress={() => void onPressRow(item)}
      activeOpacity={0.85}
      style={{
        marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 14,
        backgroundColor: theme.surface, borderWidth: 1,
        borderColor: item.read ? theme.border2 : theme.primaryBorder, opacity: item.read ? 0.82 : 1,
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
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: '#4de92620', borderWidth: 1, borderColor: '#4de92645' }}
          >
            {friendActionId === item.id ? <ActivityIndicator size="small" color="#4de926" /> : <Text style={{ color: '#4de926', fontFamily: 'Orbitron', fontSize: 10 }}>AKCEPTUJ</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void handleFriendAction(item, 'reject')}
            disabled={friendActionId === item.id}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder }}
          >
            <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 10 }}>ODRZUĆ</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={{ color: theme.textFaint, fontSize: 9, marginTop: 8 }}>{new Date(item.createdAt).toLocaleString('pl-PL')}</Text>
    </TouchableOpacity>
  );

  if (!entryAllowed) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={{ paddingTop: headerTop, paddingHorizontal: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6 }}><MaterialIcons name="arrow-back" size={22} color={theme.text} /></TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700', color: theme.text }}>POWIADOMIENIA</Text>
        <TouchableOpacity onPress={() => void markAll()} style={{ padding: 6 }}><MaterialIcons name="done-all" size={22} color={theme.primary} /></TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 7 }}>
        {([
          ['all', 'Wszystkie'], ['messages', 'Wiadomości'], ['activity', 'Aktywność'], ['system', 'System'],
        ] as const).map(([id, label]) => (
          <TouchableOpacity
            key={id}
            onPress={() => { setScope(id); setLoading(true); }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: scope === id ? theme.primary : theme.border, backgroundColor: scope === id ? theme.primaryBg : theme.surface }}
          >
            <Text numberOfLines={1} style={{ color: scope === id ? theme.primary : theme.textDim, fontSize: 9, fontFamily: 'Orbitron' }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color={theme.primary} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 2, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(1, false); }} tintColor={theme.primary} />}
          onEndReached={() => { if (hasMore && !loadingMore) { setLoadingMore(true); void load(page + 1, true); } }}
          onEndReachedThreshold={0.35}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.primary} style={{ margin: 16 }} /> : null}
          ListEmptyComponent={<Text style={{ textAlign: 'center', color: theme.textDim, marginTop: 40, fontFamily: 'Orbitron' }}>Brak powiadomień</Text>}
        />
      )}
    </View>
  );
}
