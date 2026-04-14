import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  FlatList, Image, ActivityIndicator, Pressable, Platform,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage  from '@react-native-async-storage/async-storage';
import { useTheme }  from '../../contexts/ThemeContext';
import { API_URL }   from '../../constants/config';
import { UAv }       from './ClubCard';

interface Invite {
  id:        number;
  invited:   { id: number; username: string; avatarUrl: string | null };
  inviter:   { id: number; username: string };
  createdAt: string;
}

export function InviteModal({
  visible,
  clubId,
  onClose,
}: {
  visible: boolean;
  clubId:  number;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const [search,   setSearch]   = useState('');
  const [invites,  setInvites]  = useState<Invite[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  const getToken = () => AsyncStorage.getItem('token');

  useEffect(() => {
    if (visible) { setSearch(''); setError(''); setSuccess(''); fetchInvites(); }
  }, [visible]);

  const fetchInvites = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/clubs/${clubId}/invites`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setInvites(await res.json());
    } finally { setLoading(false); }
  };

  const handleInvite = async () => {
    if (!search.trim()) return;
    setSending(true); setError(''); setSuccess('');
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/clubs/${clubId}/invites`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: search.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Błąd'); return; }
      setSuccess(`Zaproszono ${search.trim()}!`);
      setSearch('');
      await fetchInvites();
    } finally { setSending(false); }
  };

  const handleCancel = async (inviteId: number) => {
    const token = await getToken();
    await fetch(`${API_URL}/api/clubs/${clubId}/invites/${inviteId}`, {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setInvites(prev => prev.filter(i => i.id !== inviteId));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={e => e.stopPropagation()}>
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 16,
            maxHeight: '80%',
            borderTopWidth: 1, borderColor: theme.border2,
          }}>
            {/* Handle */}
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 16 }} />

            {/* Title */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 }}>
              <MaterialIcons name="person-add" size={20} color="#e33835" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, flex: 1 }}>
                ZAPROŚ DO KLUBU
              </Text>
              <TouchableOpacity onPress={onClose}>
                <MaterialIcons name="close" size={20} color={theme.textDim} />
              </TouchableOpacity>
            </View>

            {/* Search input */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TextInput
                style={{
                  flex: 1, backgroundColor: theme.surface2, borderRadius: 12,
                  paddingHorizontal: 14, paddingVertical: 10,
                  color: theme.text, fontSize: 13,
                  borderWidth: 1, borderColor: error ? '#e33835' : theme.border,
                }}
                value={search}
                onChangeText={t => { setSearch(t); setError(''); setSuccess(''); }}
                placeholder="Nazwa użytkownika..."
                placeholderTextColor={theme.textDim}
                autoCapitalize="none"
                returnKeyType="send"
                onSubmitEditing={handleInvite}
              />
              <TouchableOpacity
                style={[
                  { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center' },
                  (!search.trim() || sending) && { opacity: 0.4 },
                ]}
                onPress={handleInvite}
                disabled={!search.trim() || sending}
              >
                {sending
                  ? <ActivityIndicator size={16} color="#fff" />
                  : <MaterialIcons name="send" size={16} color="#fff" />
                }
              </TouchableOpacity>
            </View>

            {/* Feedback */}
            {!!error   && <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 9, marginBottom: 8 }}>✕ {error}</Text>}
            {!!success && <Text style={{ color: '#4de926', fontFamily: 'Orbitron', fontSize: 9, marginBottom: 8 }}>✓ {success}</Text>}

            {/* Pending invites */}
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 2, marginBottom: 10 }}>
              OCZEKUJĄCE ({invites.length})
            </Text>

            {loading ? (
              <ActivityIndicator color="#e33835" style={{ marginVertical: 20 }} />
            ) : (
              <FlatList
                data={invites}
                keyExtractor={i => String(i.id)}
                style={{ maxHeight: 280 }}
                ListEmptyComponent={
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, textAlign: 'center', marginTop: 20 }}>
                    Brak oczekujących zaproszeń
                  </Text>
                }
                renderItem={({ item }) => (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingVertical: 10,
                    borderBottomWidth: 1, borderBottomColor: theme.border,
                  }}>
                    <UAv uri={item.invited.avatarUrl} name={item.invited.username} size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>
                        {item.invited.username}
                      </Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>
                        zaproszony przez {item.inviter.username}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={{ backgroundColor: '#e3383515', borderRadius: 8, borderWidth: 1, borderColor: '#e3383530', paddingHorizontal: 10, paddingVertical: 6 }}
                      onPress={() => handleCancel(item.id)}
                    >
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#e33835' }}>ANULUJ</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}