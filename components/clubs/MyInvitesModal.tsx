import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, FlatList,
  ActivityIndicator, Pressable, Platform, ScrollView,
} from 'react-native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../contexts/ThemeContext';
import { API_URL }            from '../../constants/config';
import { getAuthToken }       from '../../lib/getAuthToken';
import { syncProfileClubFromServer } from '../../lib/profileClubSync';
import { UAv }                from './ClubCard';

interface MyInvite {
  id:      number;
  club:    { id: number; name: string; avatarUrl: string | null; description: string | null; _count: { members: number } };
  inviter: { id: number; username: string; avatarUrl: string | null };
  createdAt: string;
}

export function MyInvitesModal({
  visible,
  focusClubId,
  onClose,
  onAccepted,
}: {
  visible:    boolean;
  focusClubId?: number;
  onClose:    () => void;
  onAccepted: (clubId: number) => void;
}) {
  const { theme }                 = useTheme();
  const [invites,  setInvites]    = useState<MyInvite[]>([]);
  const [loading,  setLoading]    = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);

  useEffect(() => { if (visible) fetchInvites(); }, [visible, focusClubId]);

  const fetchInvites = async () => {
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res   = await fetch(`${API_URL}/api/clubs/invites/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const rows: MyInvite[] = await res.json();
        setInvites(focusClubId ? [...rows].sort((a, b) => Number(b.club.id === focusClubId) - Number(a.club.id === focusClubId)) : rows);
      }
    } finally { setLoading(false); }
  };

  const handleAccept = async (invite: MyInvite) => {
    setAccepting(invite.id);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res   = await fetch(`${API_URL}/api/clubs/invites/${invite.id}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { Toast.show({ type: 'error', text1: data.error ?? 'Błąd' }); return; }
      setInvites(prev => prev.filter(i => i.id !== invite.id));
      await syncProfileClubFromServer();
      Toast.show({ type: 'success', text1: '✅ DOŁĄCZONO', text2: invite.club.name });
      onAccepted(invite.club.id);
      onClose();
    } finally { setAccepting(null); }
  };

  const handleReject = async (invite: MyInvite) => {
    setRejecting(invite.id);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await fetch(`${API_URL}/api/clubs/invites/${invite.id}/reject`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      setInvites(prev => prev.filter(i => i.id !== invite.id));
      Toast.show({ type: 'info', text1: 'Odrzucono zaproszenie', text2: invite.club.name });
    } finally { setRejecting(null); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />

        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 26, borderTopRightRadius: 26,
          borderTopWidth: 1, borderColor: theme.border2,
          // NIE używaj maxHeight — ScrollView sam ograniczy
          paddingBottom: Platform.OS === 'ios' ? 36 : 20,
        }}>
          {/* Handle */}
          <View style={{
            width: 36, height: 4, borderRadius: 2,
            backgroundColor: theme.border3,
            alignSelf: 'center', marginTop: 10, marginBottom: 4,
          }} />

          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: theme.border,
            gap: 10,
          }}>
            <View style={{
              width: 34, height: 34, borderRadius: 10,
              backgroundColor: '#e3383518', borderWidth: 1, borderColor: '#e3383530',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name="shield-crown" size={16} color="#e33835" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '900', letterSpacing: 2 }}>
                ZAPROSZENIA DO KLUBÓW
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 1 }}>
                {invites.length} oczekujących
              </Text>
            </View>
            <TouchableOpacity
              style={{
                width: 30, height: 30, borderRadius: 9,
                backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border2,
                alignItems: 'center', justifyContent: 'center',
              }}
              onPress={onClose}
            >
              <MaterialIcons name="close" size={15} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Treść — ScrollView zamiast FlatList żeby nie ucinało */}
          {loading ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <ActivityIndicator color="#e33835" size="large" />
            </View>
          ) : invites.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
              <MaterialCommunityIcons name="shield-off-outline" size={44} color={theme.border3} />
              <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, letterSpacing: 2 }}>
                BRAK ZAPROSZEŃ
              </Text>
            </View>
          ) : (
            <ScrollView
              style={{ maxHeight: 460 }}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              showsVerticalScrollIndicator={false}
            >
              {invites.map(item => (
                <View key={item.id} style={{
                  backgroundColor: theme.surface2,
                  borderRadius: 16,
                  borderWidth: item.club.id === focusClubId ? 2 : 1,
                  borderColor: item.club.id === focusClubId ? theme.primary : theme.border2,
                  overflow: 'hidden',
                }}>
                  {/* Akcent top */}
                  <View style={{ height: 2, backgroundColor: '#e33835' }} />

                  <View style={{ padding: 12, gap: 10 }}>
                    {/* Klub */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{
                        width: 46, height: 46, borderRadius: 13, overflow: 'hidden',
                        backgroundColor: '#e3383518', borderWidth: 1, borderColor: '#e3383530',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {item.club.avatarUrl
                          ? <UAv uri={item.club.avatarUrl} name={item.club.name} size={46} />
                          : <MaterialCommunityIcons name="shield-crown-outline" size={22} color="#e33835" />
                        }
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '900' }} numberOfLines={1}>
                          {item.club.name}
                        </Text>
                        {!!item.club.description && (
                          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 1 }} numberOfLines={1}>
                            {item.club.description}
                          </Text>
                        )}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                          <MaterialCommunityIcons name="account-group" size={10} color={theme.textDim} />
                          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>
                            {item.club._count.members} członków
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Kto zaprosił */}
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 7,
                      backgroundColor: theme.surface, borderRadius: 9,
                      paddingHorizontal: 9, paddingVertical: 6,
                      borderWidth: 1, borderColor: theme.border,
                    }}>
                      <UAv uri={item.inviter.avatarUrl} name={item.inviter.username} size={20} />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, flex: 1 }}>
                        zaproszony przez{' '}
                        <Text style={{ color: theme.primary, fontWeight: '700' }}>{item.inviter.username}</Text>
                      </Text>
                      <View style={{
                        backgroundColor: '#f5c51818', borderRadius: 6,
                        paddingHorizontal: 6, paddingVertical: 2,
                        borderWidth: 1, borderColor: '#f5c51830',
                      }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#f5c518', fontWeight: '700' }}>
                          ZAPROSZENIE
                        </Text>
                      </View>
                    </View>

                    {/* ── PRZYCISKI — zawsze widoczne ────────── */}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {/* Odrzuć */}
                      <TouchableOpacity
                        style={{
                          flex: 1, flexDirection: 'row', alignItems: 'center',
                          justifyContent: 'center', gap: 5,
                          borderRadius: 11, paddingVertical: 11,
                          backgroundColor: theme.surface,
                          borderWidth: 1, borderColor: theme.border2,
                          opacity: rejecting === item.id ? 0.5 : 1,
                        }}
                        onPress={() => handleReject(item)}
                        disabled={rejecting === item.id || accepting === item.id}
                        activeOpacity={0.8}
                      >
                        {rejecting === item.id
                          ? <ActivityIndicator size={13} color={theme.textDim} />
                          : <>
                              <MaterialIcons name="close" size={14} color={theme.textDim} />
                              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, fontWeight: '700' }}>
                                ODRZUĆ
                              </Text>
                            </>
                        }
                      </TouchableOpacity>

                      {/* Potwierdź — szerszy */}
                      <TouchableOpacity
                        style={{
                          flex: 2, flexDirection: 'row', alignItems: 'center',
                          justifyContent: 'center', gap: 6,
                          borderRadius: 11, paddingVertical: 11,
                          backgroundColor: '#e33835',
                          opacity: accepting === item.id ? 0.7 : 1,
                        }}
                        onPress={() => handleAccept(item)}
                        disabled={accepting === item.id || rejecting === item.id}
                        activeOpacity={0.85}
                      >
                        {accepting === item.id
                          ? <ActivityIndicator size={14} color="#fff" />
                          : <>
                              <MaterialIcons name="check-circle" size={15} color="#fff" />
                              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '900', letterSpacing: 0.5 }}>
                                POTWIERDŹ DOŁĄCZENIE
                              </Text>
                            </>
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
