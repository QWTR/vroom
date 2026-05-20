import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  FlatList, ActivityIndicator, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../contexts/ThemeContext';
import { useModalSheetPadding } from '../layout/ModalKeyboardSheet';
import { API_URL }            from '../../constants/config';
import { getAuthToken }       from '../../lib/getAuthToken';
import { UAv }                from './ClubCard';

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
  const { theme }                     = useTheme();
  const [search,   setSearch]         = useState('');
  const [invites,  setInvites]        = useState<Invite[]>([]);
  const [loading,  setLoading]        = useState(false);
  const [sending,  setSending]        = useState(false);
  const [cancelling, setCancelling]   = useState<number | null>(null);
  const [error,    setError]          = useState('');
  const [success,  setSuccess]        = useState('');
  const sheetPaddingBottom = useModalSheetPadding(visible);

  useEffect(() => {
    if (visible) { setSearch(''); setError(''); setSuccess(''); fetchInvites(); }
  }, [visible]);

  const fetchInvites = async () => {
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) { setError('Zaloguj się ponownie'); return; }
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
      const token = await getAuthToken();
      if (!token) { setError('Zaloguj się ponownie'); return; }
      const res   = await fetch(`${API_URL}/api/clubs/${clubId}/invites`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: search.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Błąd'); return; }
      setSuccess(`Zaproszono ${search.trim()}!`);
      setSearch('');
      Toast.show({ type: 'success', text1: '✅ ZAPROSZONO', text2: search.trim() });
      await fetchInvites();
    } finally { setSending(false); }
  };

  const handleCancel = async (inviteId: number) => {
    setCancelling(inviteId);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await fetch(`${API_URL}/api/clubs/${clubId}/invites/${inviteId}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setInvites(prev => prev.filter(i => i.id !== inviteId));
      Toast.show({ type: 'info', text1: 'Zaproszenie anulowane' });
    } finally { setCancelling(null); }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS === 'ios'}
      >
      <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            paddingBottom: sheetPaddingBottom,
            maxHeight: '82%',
            borderTopWidth: 1, borderColor: theme.border2,
          }}>
            {/* Handle */}
            <View style={{
              width: 36, height: 4, borderRadius: 2,
              backgroundColor: theme.border3,
              alignSelf: 'center', marginTop: 12, marginBottom: 4,
            }} />

            {/* Header */}
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 18, paddingVertical: 14,
              borderBottomWidth: 1, borderBottomColor: theme.border,
              gap: 10,
            }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: '#4de92615', borderWidth: 1, borderColor: '#4de92630',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialIcons name="person-add" size={18} color="#4de926" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '900', letterSpacing: 2 }}>
                  ZAPROŚ DO KLUBU
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 1 }}>
                  {invites.length} oczekujących zaproszeń
                </Text>
              </View>
              <TouchableOpacity
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border2,
                  alignItems: 'center', justifyContent: 'center',
                }}
                onPress={onClose}
              >
                <MaterialIcons name="close" size={16} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={{ padding: 16 }}>
              {/* Input + wyślij */}
              <View style={{
                flexDirection: 'row', gap: 8, marginBottom: 6,
              }}>
                <View style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center',
                  backgroundColor: theme.surface2, borderRadius: 14,
                  paddingHorizontal: 12, gap: 8,
                  borderWidth: 1, borderColor: error ? '#e33835' : theme.border2,
                }}>
                  <MaterialIcons name="person-search" size={16} color={theme.textDim} />
                  <TextInput
                    style={{
                      flex: 1, color: theme.text,
                      fontFamily: 'Orbitron', fontSize: 11,
                      paddingVertical: 12,
                    }}
                    value={search}
                    onChangeText={t => { setSearch(t); setError(''); setSuccess(''); }}
                    placeholder="Nazwa użytkownika..."
                    placeholderTextColor={theme.textDim}
                    autoCapitalize="none"
                    returnKeyType="send"
                    onSubmitEditing={handleInvite}
                  />
                  {search.length > 0 && (
                    <TouchableOpacity onPress={() => { setSearch(''); setError(''); setSuccess(''); }}>
                      <MaterialIcons name="close" size={14} color={theme.textDim} />
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity
                  style={[
                    {
                      borderRadius: 14, paddingHorizontal: 16,
                      backgroundColor: '#4de926',
                      justifyContent: 'center', alignItems: 'center',
                    },
                    (!search.trim() || sending) && { opacity: 0.4 },
                  ]}
                  onPress={handleInvite}
                  disabled={!search.trim() || sending}
                  activeOpacity={0.85}
                >
                  {sending
                    ? <ActivityIndicator size={16} color="#fff" />
                    : <MaterialIcons name="send" size={18} color="#fff" />
                  }
                </TouchableOpacity>
              </View>

              {/* Feedback */}
              {!!error && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: '#e3383515', borderRadius: 8,
                  paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8,
                  borderWidth: 1, borderColor: '#e3383530',
                }}>
                  <MaterialIcons name="error-outline" size={13} color="#e33835" />
                  <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 8, flex: 1 }}>{error}</Text>
                </View>
              )}
              {!!success && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: '#4de92615', borderRadius: 8,
                  paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8,
                  borderWidth: 1, borderColor: '#4de92630',
                }}>
                  <MaterialIcons name="check-circle-outline" size={13} color="#4de926" />
                  <Text style={{ color: '#4de926', fontFamily: 'Orbitron', fontSize: 8, flex: 1 }}>{success}</Text>
                </View>
              )}
            </View>

            {/* Lista oczekujących */}
            <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 2 }}>
                  OCZEKUJĄCE · {invites.length}
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
              </View>
            </View>

            {loading ? (
              <ActivityIndicator color="#e33835" style={{ marginVertical: 20 }} />
            ) : (
              <FlatList
                data={invites}
                keyExtractor={i => String(i.id)}
                style={{ maxHeight: 280 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
                    <MaterialCommunityIcons name="account-clock-outline" size={36} color={theme.border3} />
                    <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>
                      BRAK OCZEKUJĄCYCH
                    </Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    backgroundColor: theme.surface2, borderRadius: 14,
                    padding: 12, borderWidth: 1, borderColor: theme.border2,
                  }}>
                    <UAv uri={item.invited.avatarUrl} name={item.invited.username} size={38} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>
                        {item.invited.username}
                      </Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>
                        przez {item.inviter.username}
                      </Text>
                    </View>
                    {/* Badge oczekuje */}
                    <View style={{
                      backgroundColor: '#f5c51815', borderRadius: 8,
                      paddingHorizontal: 8, paddingVertical: 4,
                      borderWidth: 1, borderColor: '#f5c51830',
                    }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#f5c518', fontWeight: '700' }}>
                        OCZEKUJE
                      </Text>
                    </View>
                    {/* Anuluj */}
                    <TouchableOpacity
                      style={{
                        width: 32, height: 32, borderRadius: 9,
                        backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530',
                        alignItems: 'center', justifyContent: 'center',
                        opacity: cancelling === item.id ? 0.5 : 1,
                      }}
                      onPress={() => handleCancel(item.id)}
                      disabled={cancelling === item.id}
                    >
                      {cancelling === item.id
                        ? <ActivityIndicator size={13} color="#e33835" />
                        : <MaterialIcons name="close" size={15} color="#e33835" />
                      }
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}