import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView,
  Image, ActivityIndicator, Alert,
} from 'react-native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../contexts/ThemeContext';
import { API_URL }            from '../../constants/config';
import { Club }               from './types';
import { UAv, RankBadge }     from './ClubCard';
import { InviteModal }        from './InviteModal';

const getToken = () => AsyncStorage.getItem('token');

interface Props {
  club:         Club | null;
  myId:         number | null;
  onClose:      () => void;
  onJoin:       (id: number) => void;
  onLeave:      (id: number) => void;
  onDelete:     (id: number) => void;
  onChatOpen:   (club: Club) => void;
  onRanksOpen:  (club: Club) => void;
  joining:      number | null;
  onRefresh:    () => void;
}

export default function ClubDetailModal({
  club, myId, onClose, onJoin, onLeave, onDelete,
  onChatOpen, onRanksOpen, joining, onRefresh,
}: Props) {
  const { theme }                     = useTheme();
  const [assigning, setAssigning]     = useState<number | null>(null);
  const [inviteOpen, setInviteOpen]   = useState(false);

  if (!club) return null;

  const isOwner     = club.myRole === 'owner';
  const canInvite   = isOwner || !!(club.myRank?.canManage);
  const canModerate = isOwner || !!(club.myRank && (club.myRank.canKick || club.myRank.canMute));

  const assignRank = async (userId: number, rankId: number | null) => {
    setAssigning(userId);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/clubs/${club.id}/members/${userId}/rank`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ rankId }),
      });
      if (!res.ok) { const d = await res.json(); Toast.show({ type: 'error', text1: d.error }); }
      else onRefresh();
    } finally { setAssigning(null); }
  };

  const kickMember = (userId: number, username: string) => {
    Alert.alert(`Wyrzuć ${username}`, 'Na pewno wyrzucić tego użytkownika?', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Wyrzuć', style: 'destructive', onPress: async () => {
        const token = await getToken();
        const res   = await fetch(`${API_URL}/api/clubs/${club.id}/members/${userId}/kick`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ reason: 'Kick przez moderatora' }),
        });
        const data = await res.json();
        if (!res.ok) { Toast.show({ type: 'error', text1: data.error }); return; }
        Toast.show({ type: 'success', text1: `${username} wyrzucony` });
        onRefresh();
      }},
    ]);
  };

  const toggleMute = async (userId: number, username: string, isMuted: boolean) => {
    const token = await getToken();
    const path  = isMuted ? 'unmute' : 'mute';
    const body  = isMuted ? undefined : JSON.stringify({ durationMinutes: 60 });
    await fetch(`${API_URL}/api/clubs/${club.id}/members/${userId}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
    });
    Toast.show({ type: 'success', text1: isMuted ? `${username} odciszony` : `${username} wyciszony na 1h` });
    onRefresh();
  };

  return (
    <>
      <Modal visible={!!club} animationType="slide" transparent onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
          <View style={{
            backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            maxHeight: '88%', borderTopWidth: 1, borderColor: theme.border2,
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 14 }} />
            <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <View style={{ width: 60, height: 60, borderRadius: 15, overflow: 'hidden', backgroundColor: '#e3383518', borderWidth: 1, borderColor: '#e3383530', alignItems: 'center', justifyContent: 'center' }}>
                  {club.avatarUrl
                    ? <Image source={{ uri: club.avatarUrl }} style={{ width: 60, height: 60 }} />
                    : <MaterialCommunityIcons name="shield-crown-outline" size={30} color="#e33835" />
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 15, color: theme.text, fontWeight: '700', marginBottom: 3 }}>
                    {club.name}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>{club.memberCount} członków</Text>
                    {club.isPrivate && <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>🔒 PRYWATNY</Text>}
                  </View>
                </View>
                <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                  <MaterialIcons name="close" size={20} color={theme.textDim} />
                </TouchableOpacity>
              </View>

              {!!club.description && (
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, lineHeight: 15, marginBottom: 14 }}>
                  {club.description}
                </Text>
              )}

              {/* Przyciski akcji — rząd 1 */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                {club.isMember && (
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    onPress={() => onChatOpen(club)} activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="chat" size={16} color="#fff" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#fff', fontWeight: '700' }}>CZAT KLUBU</Text>
                  </TouchableOpacity>
                )}
                {isOwner && (
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#FFD70020', borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#FFD70040' }}
                    onPress={() => onRanksOpen(club)} activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="shield-star" size={16} color="#FFD700" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#FFD700', fontWeight: '700' }}>RANGI</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Przycisk ZAPROŚ — widoczny dla ownera i managera */}
              {canInvite && (
                <TouchableOpacity
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    backgroundColor: '#4de92615', borderRadius: 12, paddingVertical: 12,
                    borderWidth: 1, borderColor: '#4de92630', marginBottom: 8,
                  }}
                  onPress={() => setInviteOpen(true)}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="person-add" size={16} color="#4de926" />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#4de926', fontWeight: '700' }}>
                    ZAPROŚ DO KLUBU
                  </Text>
                </TouchableOpacity>
              )}

              {/* Join / Leave / Delete */}
              {!isOwner ? (
                <TouchableOpacity
                  style={[
                    { borderRadius: 12, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
                    club.isMember
                      ? { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border2 }
                      : { backgroundColor: '#e33835' },
                  ]}
                  onPress={() => club.isMember ? onLeave(club.id) : onJoin(club.id)}
                  disabled={joining === club.id}
                >
                  {joining === club.id ? (
                    <ActivityIndicator color="#fff" size={16} />
                  ) : (
                    <>
                      <MaterialIcons name={club.isMember ? 'exit-to-app' : 'add'} size={15} color={club.isMember ? theme.text : '#fff'} />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', color: club.isMember ? theme.text : '#fff' }}>
                        {club.isMember ? 'OPUŚĆ KLUB' : 'DOŁĄCZ'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={{ backgroundColor: '#e3383520', borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#e3383540', marginBottom: 16 }}
                  onPress={() => onDelete(club.id)}
                >
                  <MaterialIcons name="delete" size={15} color="#e33835" />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', color: '#e33835' }}>USUŃ KLUB</Text>
                </TouchableOpacity>
              )}

              {/* Członkowie */}
              {club.members && club.members.length > 0 && (
                <>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, letterSpacing: 2, marginBottom: 10 }}>
                    CZŁONKOWIE ({club.members.length})
                  </Text>
                  {club.members.map(m => {
                    const isMe       = m.userId === myId;
                    const isOwnerRow = m.role === 'owner';
                    return (
                      <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                        <UAv uri={m.avatarUrl} name={m.username} size={34} />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '700' }}>{m.username}</Text>
                            {isOwnerRow && (
                              <View style={{ backgroundColor: '#e3383520', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835' }}>OWNER</Text>
                              </View>
                            )}
                            {m.rank && <RankBadge rank={m.rank} />}
                            {m.isMuted && (
                              <View style={{ backgroundColor: '#ff922b20', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#ff922b' }}>MUTED</Text>
                              </View>
                            )}
                          </View>
                        </View>

                        {/* Akcje ownera */}
                        {!isMe && !isOwnerRow && isOwner && (
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            {club.ranks && club.ranks.length > 0 && (
                              <TouchableOpacity
                                style={{ padding: 5, backgroundColor: '#FFD70015', borderRadius: 8, borderWidth: 1, borderColor: '#FFD70030' }}
                                onPress={() => {
                                  const rankIds = [null, ...(club.ranks ?? []).map(r => r.id)];
                                  const names   = ['Brak rangi', ...(club.ranks ?? []).map(r => r.name)];
                                  Alert.alert('Nadaj rangę', m.username,
                                    names.map((n, i) => ({ text: n, onPress: () => assignRank(m.userId, rankIds[i]) }))
                                  );
                                }}
                              >
                                {assigning === m.userId
                                  ? <ActivityIndicator size={12} color="#FFD700" />
                                  : <MaterialCommunityIcons name="shield-star-outline" size={15} color="#FFD700" />
                                }
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              style={{ padding: 5, backgroundColor: '#ff922b15', borderRadius: 8, borderWidth: 1, borderColor: '#ff922b30' }}
                              onPress={() => toggleMute(m.userId, m.username, m.isMuted)}
                            >
                              <MaterialIcons name={m.isMuted ? 'volume-up' : 'volume-off'} size={15} color="#ff922b" />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={{ padding: 5, backgroundColor: '#e3383515', borderRadius: 8, borderWidth: 1, borderColor: '#e3383530' }}
                              onPress={() => kickMember(m.userId, m.username)}
                            >
                              <MaterialIcons name="person-remove" size={15} color="#e33835" />
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* Akcje moderatora */}
                        {!isMe && !isOwnerRow && !isOwner && canModerate && (
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            {club.myRank?.canMute && (
                              <TouchableOpacity
                                style={{ padding: 5, backgroundColor: '#ff922b15', borderRadius: 8, borderWidth: 1, borderColor: '#ff922b30' }}
                                onPress={() => toggleMute(m.userId, m.username, m.isMuted)}
                              >
                                <MaterialIcons name={m.isMuted ? 'volume-up' : 'volume-off'} size={15} color="#ff922b" />
                              </TouchableOpacity>
                            )}
                            {club.myRank?.canKick && (
                              <TouchableOpacity
                                style={{ padding: 5, backgroundColor: '#e3383515', borderRadius: 8, borderWidth: 1, borderColor: '#e3383530' }}
                                onPress={() => kickMember(m.userId, m.username)}
                              >
                                <MaterialIcons name="person-remove" size={15} color="#e33835" />
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* INVITE MODAL — poza głównym Modal żeby nie było nestowania */}
      <InviteModal
        visible={inviteOpen}
        clubId={club.id}
        onClose={() => { setInviteOpen(false); onRefresh(); }}
      />
    </>
  );
}