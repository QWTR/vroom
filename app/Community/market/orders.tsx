import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { Image } from 'expo-image';
import { API_URL } from '../../../constants/config';
import { useTheme } from '../../../contexts/ThemeContext';
import { CommunityScreenHeader } from '../../../components/community';

type Order = {
  id: string;
  status: string;
  itemAmount: number;
  totalAmount: number;
  sellerNetAmount: number;
  currency: string;
  autoReleaseAt?: string | null;
  listing: { id: number; title: string; photos: string[]; status: string };
  buyer: { id: number; username: string };
  seller: { id: number; username: string };
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Oczekuje płatności',
  paid_held: 'Escrow — czekaj na odbiór',
  released: 'Zakończone',
  disputed: 'Spór',
  refunded: 'Zwrócone',
  cancelled: 'Anulowane',
  expired: 'Wygasłe',
  failed: 'Nieudane',
};

const money = (grosze: number) => `${(grosze / 100).toFixed(2)} PLN`;

export default function MarketOrdersScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const [tab, setTab] = useState<'bought' | 'sold'>('bought');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (orderId) {
        const response = await fetch(`${API_URL}/api/market/orders/${encodeURIComponent(orderId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ta treść nie jest już dostępna');
        const rawUser = await AsyncStorage.getItem('user');
        const currentUserId = Number(rawUser ? JSON.parse(rawUser)?.userId ?? JSON.parse(rawUser)?.id : 0);
        setTab(Number(data.order?.buyer?.id) === currentUserId ? 'bought' : 'sold');
        setOrders(data.order ? [data.order] : []);
        return;
      }
      const path = tab === 'bought' ? 'orders/my' : 'orders/selling';
      const res = await fetch(`${API_URL}/api/market/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd');
      setOrders(data.orders || []);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Nie udało się pobrać zamówień', text2: e.message } as never);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orderId, tab]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    void load();
  }, [load]));

  const confirmReceived = (orderId: string) => {
    Alert.alert(
      'Potwierdzić odbiór?',
      'Środki trafią do sprzedawcy. Tej operacji nie cofniesz.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Odebrałem',
          style: 'default',
          onPress: async () => {
            setBusyId(orderId);
            try {
              const token = await getToken();
              const res = await fetch(`${API_URL}/api/market/orders/${orderId}/confirm-received`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Błąd');
              Toast.show({ type: 'success', text1: 'Potwierdzono odbiór' } as never);
              void load();
            } catch (e: any) {
              Toast.show({ type: 'error', text1: e.message } as never);
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  const submitDispute = async () => {
    if (!disputeFor) return;
    setBusyId(disputeFor);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/market/orders/${disputeFor}/dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: disputeReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd');
      Toast.show({ type: 'success', text1: 'Spór otwarty' } as never);
      setDisputeFor(null);
      setDisputeReason('');
      void load();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e.message } as never);
    } finally {
      setBusyId(null);
    }
  };

  const renderOrder = ({ item }: { item: Order }) => {
    const photo = item.listing?.photos?.[0];
    const isBuyer = tab === 'bought';
    return (
      <View style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        marginBottom: 12,
        overflow: 'hidden',
      }}
      >
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/Community/market/[id]', params: { id: String(item.listing.id) } } as any)}
          style={{ flexDirection: 'row', gap: 12, padding: 12 }}
        >
          {photo ? (
            <Image source={{ uri: photo }} style={{ width: 72, height: 72, borderRadius: 10 }} contentFit="cover" />
          ) : (
            <View style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="car" size={28} color={theme.textDim} />
            </View>
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }} numberOfLines={2}>
              {item.listing.title}
            </Text>
            <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 13 }}>
              {money(isBuyer ? item.totalAmount : item.sellerNetAmount)}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 11 }}>
              {STATUS_LABEL[item.status] || item.status}
              {' · '}
              {isBuyer ? `@${item.seller.username}` : `@${item.buyer.username}`}
            </Text>
          </View>
        </TouchableOpacity>

        {item.status === 'paid_held' && isBuyer && (
          <View style={{ flexDirection: 'row', gap: 8, padding: 12, paddingTop: 0 }}>
            <TouchableOpacity
              onPress={() => confirmReceived(item.id)}
              disabled={busyId === item.id}
              style={{ flex: 1, backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
            >
              {busyId === item.id
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>ODEBRAŁEM</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setDisputeFor(item.id); setDisputeReason(''); }}
              style={{ paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.border, justifyContent: 'center' }}
            >
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>SPÓR</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <CommunityScreenHeader
        title="Zamówienia"
        subtitle="Giełda"
        onBack={() => router.back()}
      />

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 }}>
        {(['bought', 'sold'] as const).map((key) => (
          <TouchableOpacity
            key={key}
            onPress={() => setTab(key)}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: tab === key ? theme.primary : theme.surface,
              borderWidth: 1,
              borderColor: tab === key ? theme.primary : theme.border,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: tab === key ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>
              {key === 'bought' ? 'KUPIŁEM' : 'SPRZEDAŁEM'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
          ListEmptyComponent={(
            <Text style={{ color: theme.textDim, textAlign: 'center', marginTop: 40, fontFamily: 'Orbitron', fontSize: 11 }}>
              Brak zamówień
            </Text>
          )}
        />
      )}

      {disputeFor && (
        <View style={{
          position: 'absolute', left: 16, right: 16, bottom: 24,
          backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 10,
        }}
        >
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12 }}>Powód sporu</Text>
          <TextInput
            value={disputeReason}
            onChangeText={setDisputeReason}
            placeholder="Opisz problem..."
            placeholderTextColor={theme.textDim}
            multiline
            style={{ minHeight: 80, color: theme.text, backgroundColor: theme.surface2, borderRadius: 10, padding: 12 }}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => setDisputeFor(null)} style={{ flex: 1, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>Anuluj</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submitDispute}
              style={{ flex: 1, backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>Wyślij</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
