import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView,
  Image, ActivityIndicator, Alert,
} from 'react-native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../contexts/ThemeContext';
import { API_URL }            from '../../constants/config';
import { getAuthToken }       from '../../lib/getAuthToken';
import { Club }               from './types';
import { UAv, RankBadge }     from './ClubCard';
interface Props {
  club:         Club | null;
  myId:         number | null;
  onClose:      () => void;
  onJoin:       (id: number) => void;
  onLeave:      (id: number) => void;
  onDelete:     (id: number) => void;
  onChatOpen:   (club: Club) => void;
  onRanksOpen:  (club: Club) => void;
  /** iOS: drugi Modal nad szczegółami nie działa — otwierz zaproszenie z ekranu nadrzędnego */
  onInviteRequest?: (club: Club) => void;
  onEditRequest?:   (club: Club) => void;
  joining:      number | null;
  onRefresh:    () => void;
}

export default function ClubDetailModal({
  club, myId, onClose, onJoin, onLeave, onDelete,
  onChatOpen, onRanksOpen, onInviteRequest, onEditRequest,
  joining, onRefresh,
}: Props) {
  const { theme }                   = useTheme();
  const [assigning, setAssigning]   = useState<number | null>(null);

  if (!club) return null;

  const isOwner     = club.myRole === 'owner';
  const isMember    = club.isMember;
  const isPrivate   = club.isPrivate;
  const canInvite   = isOwner || !!(club.myRank?.canManage);
  const canModerate = isOwner || !!(club.myRank && (club.myRank.canKick || club.myRank.canMute));
  const ownerUsername = club.owner?.username ?? 'nieznany';
  const safeRanks = Array.isArray(club.ranks) ? club.ranks : [];
  const members = Array.isArray(club.members) ? club.members : [];

  const assignRank = async (userId: number, rankId: number | null) => {
    setAssigning(userId);
    try {
      const token = await getAuthToken();
      if (!token) { Toast.show({ type: 'error', text1: 'Zaloguj się ponownie' }); return; }
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
        const token = await getAuthToken();
      if (!token) { Toast.show({ type: 'error', text1: 'Zaloguj się ponownie' }); return; }
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
    const token = await getAuthToken();
    if (!token) { Toast.show({ type: 'error', text1: 'Zaloguj się ponownie' }); return; }
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
            backgroundColor: theme.surface,
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            maxHeight: '90%',
            borderTopWidth: 1, borderColor: theme.border2,
          }}>
            {/* Handle */}
            <View style={{
              width: 36, height: 4, borderRadius: 2,
              backgroundColor: theme.border3,
              alignSelf: 'center', marginTop: 12, marginBottom: 4,
            }} />

            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 48 }}
              showsVerticalScrollIndicator={false}
            >
              {/* ── HERO HEADER ─────────────────────────────── */}
              <View style={{
                alignItems: 'center', paddingVertical: 20,
                borderBottomWidth: 1, borderBottomColor: theme.border,
                marginBottom: 16, gap: 10,
              }}>
                {/* Avatar */}
                <View style={{
                  width: 72, height: 72, borderRadius: 20, overflow: 'hidden',
                  backgroundColor: '#e3383518',
                  borderWidth: isMember ? 3 : 1,
                  borderColor: isMember ? '#e33835' : '#e3383530',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {club.avatarUrl
                    ? <Image source={{ uri: club.avatarUrl }} style={{ width: 72, height: 72 }} />
                    : <MaterialCommunityIcons name="shield-crown-outline" size={36} color="#e33835" />
                  }
                </View>

                {/* Nazwa */}
                <Text style={{
                  fontFamily: 'Orbitron', fontSize: 18,
                  color: theme.text, fontWeight: '900',
                  textAlign: 'center',
                }}>
                  {club.name}
                </Text>

                {/* Badges rząd */}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: theme.surface2, borderRadius: 8,
                    paddingHorizontal: 10, paddingVertical: 4,
                    borderWidth: 1, borderColor: theme.border2,
                  }}>
                    <MaterialCommunityIcons name="account-group" size={12} color={theme.textDim} />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>
                      {club.memberCount} członków
                    </Text>
                  </View>

                  {isPrivate && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: theme.surface2, borderRadius: 8,
                      paddingHorizontal: 10, paddingVertical: 4,
                      borderWidth: 1, borderColor: theme.border2,
                    }}>
                      <MaterialIcons name="lock" size={11} color={theme.textDim} />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>PRYWATNY</Text>
                    </View>
                  )}

                  {isOwner && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: '#e3383520', borderRadius: 8,
                      paddingHorizontal: 10, paddingVertical: 4,
                      borderWidth: 1, borderColor: '#e3383540',
                    }}>
                      <MaterialCommunityIcons name="shield-crown" size={11} color="#e33835" />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#e33835', fontWeight: '700' }}>OWNER</Text>
                    </View>
                  )}

                  {isMember && !isOwner && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: '#4de92615', borderRadius: 8,
                      paddingHorizontal: 10, paddingVertical: 4,
                      borderWidth: 1, borderColor: '#4de92630',
                    }}>
                      <MaterialIcons name="check-circle" size={11} color="#4de926" />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#4de926', fontWeight: '700' }}>
                        {club.myRank ? club.myRank.name.toUpperCase() : 'CZŁONEK'}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Opis */}
                {!!club.description && (
                  <Text style={{
                    fontFamily: 'Orbitron', fontSize: 9,
                    color: theme.textDim, lineHeight: 15,
                    textAlign: 'center', paddingHorizontal: 10,
                  }}>
                    {club.description}
                  </Text>
                )}

                {/* Owner info */}
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textFaint }}>
                  założony przez @{ownerUsername}
                </Text>
              </View>

              {/* ── PRZYCISKI AKCJI ──────────────────────────── */}
              <View style={{ gap: 8, marginBottom: 16 }}>

                {/* Czat — tylko dla członków */}
                {isMember && (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      justifyContent: 'center', gap: 8,
                      backgroundColor: '#e33835',
                      borderRadius: 14, paddingVertical: 14,
                    }}
                    onPress={() => onChatOpen(club)}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="chat" size={18} color="#fff" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '700', letterSpacing: 1 }}>
                      CZAT KLUBU
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Rząd: Rangi + Zaproś */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {isOwner && (
                    <TouchableOpacity
                      style={{
                        flex: 1, flexDirection: 'row', alignItems: 'center',
                        justifyContent: 'center', gap: 6,
                        backgroundColor: '#FFD70015', borderRadius: 14,
                        paddingVertical: 12, borderWidth: 1, borderColor: '#FFD70035',
                      }}
                      onPress={() => onRanksOpen(club)}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons name="shield-star" size={16} color="#FFD700" />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#FFD700', fontWeight: '700' }}>RANGI</Text>
                    </TouchableOpacity>
                  )}

                  {canInvite && (
                    <TouchableOpacity
                      style={{
                        flex: 1, flexDirection: 'row', alignItems: 'center',
                        justifyContent: 'center', gap: 6,
                        backgroundColor: '#4de92615', borderRadius: 14,
                        paddingVertical: 12, borderWidth: 1, borderColor: '#4de92630',
                      }}
                      onPress={() => onInviteRequest?.(club)}
                      activeOpacity={0.85}
                    >
                      <MaterialIcons name="person-add" size={16} color="#4de926" />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#4de926', fontWeight: '700' }}>ZAPROŚ</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {isOwner && (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      justifyContent: 'center', gap: 6,
                      backgroundColor: `${theme.primary}15`, borderRadius: 14,
                      paddingVertical: 12, borderWidth: 1, borderColor: `${theme.primary}35`,
                    }}
                    onPress={() => onEditRequest?.(club)}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="edit" size={16} color={theme.primary} />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.primary, fontWeight: '700' }}>EDYTUJ KLUB</Text>
                  </TouchableOpacity>
                )}

                {/* Join / Leave / Delete / Prywatny lock */}
                {isOwner ? (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      justifyContent: 'center', gap: 8,
                      backgroundColor: '#e3383515', borderRadius: 14,
                      paddingVertical: 13, borderWidth: 1, borderColor: '#e3383535',
                    }}
                    onPress={() => onDelete(club.id)}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="delete" size={16} color="#e33835" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', color: '#e33835' }}>
                      USUŃ KLUB
                    </Text>
                  </TouchableOpacity>
                ) : isMember ? (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      justifyContent: 'center', gap: 8,
                      backgroundColor: theme.surface2, borderRadius: 14,
                      paddingVertical: 13, borderWidth: 1, borderColor: theme.border2,
                    }}
                    onPress={() => onLeave(club.id)}
                    disabled={joining === club.id}
                    activeOpacity={0.85}
                  >
                    {joining === club.id ? (
                      <ActivityIndicator color={theme.text} size={16} />
                    ) : (
                      <>
                        <MaterialIcons name="exit-to-app" size={16} color={theme.text} />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', color: theme.text }}>
                          OPUŚĆ KLUB
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : isPrivate ? (
                  // ── PRYWATNY — zablokowany ─────────────────
                  <View style={{
                    flexDirection: 'row', alignItems: 'center',
                    gap: 10, backgroundColor: theme.surface2,
                    borderRadius: 14, paddingVertical: 14,
                    paddingHorizontal: 16, borderWidth: 1, borderColor: theme.border2,
                  }}>
                    <MaterialIcons name="lock" size={18} color={theme.textDim} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, fontWeight: '700' }}>
                        KLUB PRYWATNY
                      </Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textFaint, marginTop: 2 }}>
                        Dołączenie wymaga zaproszenia od członka
                      </Text>
                    </View>
                  </View>
                ) : (
                  // ── PUBLICZNY — dołącz ─────────────────────
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      justifyContent: 'center', gap: 8,
                      backgroundColor: '#e33835', borderRadius: 14,
                      paddingVertical: 14,
                    }}
                    onPress={() => onJoin(club.id)}
                    disabled={joining === club.id}
                    activeOpacity={0.85}
                  >
                    {joining === club.id ? (
                      <ActivityIndicator color="#fff" size={16} />
                    ) : (
                      <>
                        <MaterialIcons name="add" size={16} color="#fff" />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', color: '#fff' }}>
                          DOŁĄCZ DO KLUBU
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              {/* ── CZŁONKOWIE ──────────────────────────────── */}
              {members.length > 0 && (
                <>
                  <View style={{
                    flexDirection: 'row', alignItems: 'center',
                    marginBottom: 12, gap: 8,
                  }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 2 }}>
                      CZŁONKOWIE · {members.length}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                  </View>

                  {members.map(m => {
                  // ── DEFENSIVE: obsłuż obie struktury backendu ──────────
                  const username  = m.username  ?? (m as any).user?.username  ?? '?';
                  const avatarUrl = m.avatarUrl ?? (m as any).user?.avatarUrl ?? null;
                  const userId    = m.userId    ?? (m as any).user?.id        ?? (m as any).userId;
                  // ────────────────────────────────────────────────────────

                  const isMe       = userId === myId;
                  const isOwnerRow = m.role === 'owner';

                  return (
                    <View
                      key={m.id}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 12,
                        paddingVertical: 11,
                        borderBottomWidth: 1, borderBottomColor: theme.border,
                      }}
                    >
                      {/* Avatar */}
                      <UAv uri={avatarUrl} name={username} size={38} />

                      {/* Info */}
                      <View style={{ flex: 1, gap: 3 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={{
                            fontFamily: 'Orbitron', fontSize: 11,
                            color: isMe ? '#e33835' : theme.text,
                            fontWeight: '700',
                          }}>
                            {username}{isMe ? ' (Ty)' : ''}
                          </Text>
                          {isOwnerRow && (
                            <View style={{
                              backgroundColor: '#e3383520', borderRadius: 4,
                              paddingHorizontal: 5, paddingVertical: 1,
                              borderWidth: 1, borderColor: '#e3383540',
                            }}>
                              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835', fontWeight: '700' }}>
                                OWNER
                              </Text>
                            </View>
                          )}
                          {m.rank && <RankBadge rank={m.rank} />}
                          {m.isMuted && (
                            <View style={{
                              backgroundColor: '#ff922b15', borderRadius: 4,
                              paddingHorizontal: 5, paddingVertical: 1,
                              borderWidth: 1, borderColor: '#ff922b30',
                            }}>
                              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#ff922b', fontWeight: '700' }}>
                                MUTED
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>

                      {/* Akcje ownera */}
                      {!isMe && !isOwnerRow && isOwner && (
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {safeRanks.length > 0 && (
                            <TouchableOpacity
                              style={{
                                padding: 7, backgroundColor: '#FFD70015',
                                borderRadius: 9, borderWidth: 1, borderColor: '#FFD70030',
                              }}
                              onPress={() => {
                                const rankIds = [null, ...safeRanks.map(r => r.id)];
                                const names   = ['Brak rangi', ...safeRanks.map(r => r.name)];
                                Alert.alert('Nadaj rangę', username,
                                  names.map((n, i) => ({ text: n, onPress: () => assignRank(userId, rankIds[i]) })),
                                );
                              }}
                            >
                              {assigning === userId
                                ? <ActivityIndicator size={14} color="#FFD700" />
                                : <MaterialCommunityIcons name="shield-star-outline" size={16} color="#FFD700" />
                              }
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={{
                              padding: 7, backgroundColor: '#ff922b15',
                              borderRadius: 9, borderWidth: 1, borderColor: '#ff922b30',
                            }}
                            onPress={() => toggleMute(userId, username, m.isMuted)}
                          >
                            <MaterialIcons
                              name={m.isMuted ? 'volume-up' : 'volume-off'}
                              size={16} color="#ff922b"
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{
                              padding: 7, backgroundColor: '#e3383515',
                              borderRadius: 9, borderWidth: 1, borderColor: '#e3383530',
                            }}
                            onPress={() => kickMember(userId, username)}
                          >
                            <MaterialIcons name="person-remove" size={16} color="#e33835" />
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Akcje moderatora */}
                      {!isMe && !isOwnerRow && !isOwner && canModerate && (
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {club.myRank?.canMute && (
                            <TouchableOpacity
                              style={{
                                padding: 7, backgroundColor: '#ff922b15',
                                borderRadius: 9, borderWidth: 1, borderColor: '#ff922b30',
                              }}
                              onPress={() => toggleMute(userId, username, m.isMuted)}
                            >
                              <MaterialIcons
                                name={m.isMuted ? 'volume-up' : 'volume-off'}
                                size={16} color="#ff922b"
                              />
                            </TouchableOpacity>
                          )}
                          {club.myRank?.canKick && (
                            <TouchableOpacity
                              style={{
                                padding: 7, backgroundColor: '#e3383515',
                                borderRadius: 9, borderWidth: 1, borderColor: '#e3383530',
                              }}
                              onPress={() => kickMember(userId, username)}
                            >
                              <MaterialIcons name="person-remove" size={16} color="#e33835" />
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
    </>
  );
}