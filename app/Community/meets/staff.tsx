import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';

interface StaffMember {
  id: number;
  role: string;
  user: { id: number; username: string; avatarUrl: string | null };
}

const ROLES = [
  { key: 'scanner', label: 'Skaner QR' },
  { key: 'editor', label: 'Edytor eventu' },
];

export default function MeetStaffScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('scanner');
  const [adding, setAdding] = useState(false);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${id}/staff`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Brak dostępu');
      setStaff(data);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  const resolveUserId = async (name: string) => {
    const q = name.replace('@', '').trim();
    const token = await getToken();
    const r = await fetch(`${API_URL}/api/chat/users/search?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();
    const list = Array.isArray(data) ? data : data.users ?? [];
    const exact = list.find((u: any) => u.username?.toLowerCase() === q.toLowerCase());
    return exact?.id ?? list[0]?.id ?? null;
  };

  const addStaff = async () => {
    const q = username.trim();
    if (!q) return Toast.show({ type: 'error', text1: 'Podaj username' });
    setAdding(true);
    try {
      const userId = await resolveUserId(q);
      if (!userId) throw new Error('Nie znaleziono użytkownika');

      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${id}/staff`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Nie udało się dodać');
      setUsername('');
      await load();
      Toast.show({ type: 'success', text1: 'Dodano do zespołu' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally {
      setAdding(false);
    }
  };

  const removeStaff = async (userId: number) => {
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${id}/staff/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Błąd usuwania');
      await load();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <CommunityScreenHeader title="ZESPÓŁ" subtitle="Organizatorzy i skanerzy QR" />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: theme.border, gap: 12 }}>
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>DODAJ CZŁONKA</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="@username"
            placeholderTextColor={theme.textDim}
            autoCapitalize="none"
            style={{ backgroundColor: theme.surface2, borderRadius: 12, padding: 14, color: theme.text, borderWidth: 1, borderColor: theme.border, fontFamily: 'Satoshi' }}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {ROLES.map(r => (
              <TouchableOpacity
                key={r.key}
                onPress={() => setRole(r.key)}
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                  borderWidth: 1,
                  borderColor: role === r.key ? theme.primary : theme.border,
                  backgroundColor: role === r.key ? theme.primaryBg : theme.surface2,
                }}
              >
                <Text style={{ color: role === r.key ? theme.primary : theme.text, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            onPress={addStaff}
            disabled={adding}
            style={{ backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: adding ? 0.7 : 1 }}
          >
            {adding ? <ActivityIndicator color="#fff" /> : (
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>DODAJ</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>AKTUALNY ZESPÓŁ ({staff.length})</Text>
        {staff.map(s => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden', backgroundColor: theme.primaryBg, alignItems: 'center', justifyContent: 'center' }}>
              {s.user.avatarUrl
                ? <Image source={{ uri: s.user.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700' }}>{s.user.username.charAt(0).toUpperCase()}</Text>
              }
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>@{s.user.username}</Text>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, marginTop: 2 }}>{s.role.toUpperCase()}</Text>
            </View>
            {s.role !== 'owner' && (
              <TouchableOpacity onPress={() => removeStaff(s.user.id)} style={{ padding: 8 }}>
                <MaterialIcons name="delete-outline" size={20} color="#e33835" />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
