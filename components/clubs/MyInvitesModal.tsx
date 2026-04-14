import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, FlatList,
  ActivityIndicator, Pressable, Platform,
} from 'react-native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import { useTheme }           from '../../contexts/ThemeContext';
import { API_URL }            from '../../constants/config';
import { UAv }                from './ClubCard';

interface MyInvite {
  id:      number;
  club:    { id: number; name: string; avatarUrl: string | null; description: string | null; _count: { members: number } };
  inviter: { id: number; username: string; avatarUrl: string | null };
  createdAt: string;
}

export function MyInvitesModal({
  visible,
  onClose,
  onAccepted,
}: {
  visible:    boolean;
  onClose:    () => void;
  onAccepted: (clubId: number) => void;
}) {
  const { theme } = useTheme();
  const [invites,  setInvites]  = useState<MyInvite[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [acting,   setActing]   = useState<number | null>(null);

  const getToken = () => AsyncStorage.getItem('token');

  useEffect(() => {
    if (visible) fetchInvites();
  }, [visible]);

  const fetchInvites = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/clubs/invites/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setInvites(await res.json());
    } finally { setLoading(false); }
  };

  const handleAccept = async (invite: MyInvite) => {
    setActing(invite.id);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/clubs/invites/${invite.id}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setInvites(prev => prev.filter(i => i.id !== invite.id));
        onAccepted(invite.club.id);
        onClose();
      }
    } finally { setActing(null); }
  };

  const handleReject = async (inviteId: number) => {
    setActing(inviteId);
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/clubs/invites/${inviteId}/reject`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      setInvites(prev => prev.filter(i => i.id !== inviteId));
    } finally { setActing(null); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={e => e.stopPropagation()}>
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 16,
            maxHeight: '75%',
            borderTopWidth: 1, borderColor: theme.border2,
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 16 }} />

            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 }}>
              <MaterialCommunityIcons name="shield-crown" size={20} color="#e33835" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, flex: 1 }}>
                ZAPROSZENIA DO KLUBÓW
              </Text>
              <TouchableOpacity onPress={onClose}>
                <MaterialIcons name="close" size={20} color={theme.textDim} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator color="#e33835" style={{ marginVertical: 30 }} />
            ) : (
              <FlatList
                data={invites}
                keyExtractor={i => String(i.id)}
                style={{ maxHeight: 400 }}
                ListEmptyComponent={
                  <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
                    <MaterialCommunityIcons name="shield-off-outline" size={40} color={theme.border3} />
                    <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10 }}>BRAK ZAPROSZEŃ</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={{
                    backgroundColor: theme.surface2, borderRadius: 14,
                    borderWidth: 1, borderColor: theme.border2,
                    padding: 12, marginBottom: 10, gap: 10,
                  }}>
                    {/* Club info */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{
                        width: 44, height: 44, borderRadius: 12,
                        backgroundColor: '#e3383518', borderWidth: 1, borderColor: '#e3383530',
                        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                      }}>
                        {item.club.avatarUrl
                          ? <UAv uri={item.club.avatarUrl} name={item.club.name} size={44} />
                          : <MaterialCommunityIcons name="shield-crown-outline" size={22} color="#e33835" />
                        }
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700' }}>
                          {item.club.name}
                        </Text>
                        {!!item.club.description && (
                          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }} numberOfLines={1}>
                            {item.club.description}
                          </Text>
                        )}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                          <MaterialCommunityIcons name="account-group" size={10} color={theme.textDim} />
                          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>
                            {item.club._count.members} członków
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Inviter */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <UAv uri={item.inviter.avatarUrl} name={item.inviter.username} size={20} />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>
                        zaproszony przez{' '}
                        <Text style={{ color: theme.primary }}>{item.inviter.username}</Text>
                      </Text>
                    </View>

                    {/* Actions */}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={[
                          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10, paddingVertical: 10, backgroundColor: '#ffffff08', borderWidth: 1, borderColor: theme.border2 },
                          acting === item.id && { opacity: 0.5 },
                        ]}
                        onPress={() => handleReject(item.id)}
                        disabled={acting === item.id}
                      >
                        <MaterialIcons name="close" size={14} color={theme.textDim} />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, fontWeight: '700' }}>ODRZUĆ</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10, paddingVertical: 10, backgroundColor: '#e33835' },
                          acting === item.id && { opacity: 0.5 },
                        ]}
                        onPress={() => handleAccept(item)}
                        disabled={acting === item.id}
                      >
                        {acting === item.id
                          ? <ActivityIndicator size={14} color="#fff" />
                          : <>
                              <MaterialIcons name="check" size={14} color="#fff" />
                              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700' }}>DOŁĄCZ</Text>
                            </>
                        }
                      </TouchableOpacity>
                    </View>
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