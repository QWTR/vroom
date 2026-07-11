import React, { useCallback, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

function showToast(params: { type: 'error' | 'info' | 'success'; text1: string; text2?: string }) {
  (Toast.show as unknown as (input: typeof params) => void)(params);
}

type Row = {
  id: number;
  category: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
  hasUnreadFromStaff: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  new: 'NOWE',
  in_progress: 'W TRAKCIE',
  resolved: 'ZAMKNIĘTE',
};

export default function BugReportsListScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnceRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/bug-reports/my`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd');
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        showToast({ type: 'error', text1: 'Nie udało się pobrać zgłoszeń' });
      }
      setRows([]);
    } finally {
      clearTimeout(timer);
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load({ silent: loadedOnceRef.current });
      loadedOnceRef.current = true;
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bgAlt, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e33835" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bgAlt }}>
      <View style={{ marginTop: 56, paddingHorizontal: '5%', flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: theme.text, marginLeft: 8, flex: 1 }}>
          MOJE ZGŁOSZENIA
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={item => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e33835" />}
        contentContainerStyle={{ paddingHorizontal: '5%', paddingBottom: 40 }}
        ListEmptyComponent={
          <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.textDim, textAlign: 'center', marginTop: 40 }}>
            Brak zgłoszeń. Utwórz je w Ustawienia → Zgłoś błąd.
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push(`/profile/bug-report/${item.id}`)}
            style={{
              backgroundColor: theme.surface,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 14,
              marginBottom: 10,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#e33835' }}>#{item.id}</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>
                {STATUS_LABEL[item.status] ?? item.status}
              </Text>
            </View>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, marginTop: 6 }}>
              {item.category?.toUpperCase()} · {item.messageCount} wiadomości
            </Text>
            {!!item.lastMessagePreview && (
              <Text numberOfLines={2} style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, marginTop: 8 }}>
                {item.lastMessagePreview}
              </Text>
            )}
            {item.hasUnreadFromStaff && (
              <View style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: '#2196F322', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#2196F3' }}>NOWA ODPOWIEDŹ</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
