import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../contexts/ThemeContext';
import { API_URL } from '../../constants/config';

const STATUS_LABELS: Record<string, string> = {
  awaiting_details: 'Oczekuje danych',
  in_production: 'W produkcji',
  ready: 'Gotowy',
  rejected: 'Odrzucony',
};

type OrderRow = {
  id: string;
  status: string;
  carMake?: string | null;
  carModel?: string | null;
  shopItem?: { name: string } | null;
  createdAt: string;
};

async function getToken() {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

export default function VehicleOrdersListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/vehicle-orders/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setOrders(Array.isArray(data?.orders) ? data.orders : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Zamówienia pojazdów</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#e33835" />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
          {orders.map((o) => (
            <TouchableOpacity
              key={o.id}
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border2 }]}
              onPress={() => router.push(`/shop/vehicle-order/${o.id}`)}
            >
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                {o.shopItem?.name ?? 'Pojazd limitowany'}
              </Text>
              <Text style={{ color: theme.textDim, fontSize: 13 }}>
                {STATUS_LABELS[o.status] ?? o.status}
              </Text>
              {(o.carMake || o.carModel) && (
                <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>
                  {[o.carMake, o.carModel].filter(Boolean).join(' ')}
                </Text>
              )}
            </TouchableOpacity>
          ))}
          {orders.length === 0 && (
            <Text style={{ color: theme.textDim, textAlign: 'center', marginTop: 32 }}>
              Brak zamówień. Kup slot pojazdu limitowanego w sklepie Nitro.
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardTitle: { fontWeight: '700', fontSize: 15 },
});
