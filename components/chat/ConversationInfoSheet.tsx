import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  ScrollView, TextInput, ActivityIndicator, FlatList,
  Animated, Dimensions, Modal, Platform,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

const { height: SCREEN_H } = Dimensions.get('window');
const API = 'https://v-room.app/api/chat';
const FRIEND_API = 'https://v-room.app/api/chat';

interface ChatUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
  online?:   boolean;
}

interface MediaItem {
  url:       string;
  messageId: number;
  createdAt: string;
  sender:    string;
}

interface SearchResult {
  id:        number;
  content:   string;
  createdAt: string;
  sender:    ChatUser;
}

interface Props {
  visible:     boolean;
  onClose:     () => void;
  convId:      number;
  isGroup:     boolean;
  convName:    string;
  convAvatar:  string | null;
  participants: ChatUser[];
  myId:        number | null;
  onViewProfile: (userId: number) => void;
  onConvUpdated: (name: string, avatarUrl: string | null) => void;
}

type Tab = 'info' | 'media' | 'search';

export function ConversationInfoSheet({
  visible, onClose, convId, isGroup, convName,
  convAvatar, participants, myId, onViewProfile, onConvUpdated,
}: Props) {
  const slideAnim = useRef(new Animated.Value(SCREEN_H)).current;

  const [tab,           setTab]           = useState<Tab>('info');
  const [media,         setMedia]         = useState<MediaItem[]>([]);
  const [mediaLoading,  setMediaLoading]  = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [friendStatuses, setFriendStatuses] = useState<Record<number, any>>({});
  const [groupName,     setGroupName]     = useState(convName);
  const [editingName,   setEditingName]   = useState(false);
  const [saving,        setSaving]        = useState(false);
  const tokenRef = useRef('');

  // ── Animate ────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setTab('info');
      setSearchQuery('');
      setSearchResults([]);
      Animated.spring(slideAnim, {
        toValue:         0,
        useNativeDriver: true,
        tension:         65,
        friction:        11,
      }).start();
      init();
    } else {
      Animated.timing(slideAnim, {
        toValue:         SCREEN_H,
        duration:        250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const init = async () => {
    const token = await AsyncStorage.getItem('token') ?? '';
    tokenRef.current = token;
    fetchMedia(token);
    fetchFriendStatuses(token);
  };

  // ── Fetch media ─────────────────────────────────────────
  const fetchMedia = async (token: string) => {
    setMediaLoading(true);
    try {
      const r = await fetch(`${API}/conversations/${convId}/media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMedia(await r.json());
    } catch (e) { console.error(e); }
    finally { setMediaLoading(false); }
  };

  // ── Friend statuses ─────────────────────────────────────
  const fetchFriendStatuses = async (token: string) => {
    const others = participants.filter(p => p.id !== myId);
    const statuses: Record<number, any> = {};
    await Promise.all(others.map(async p => {
      try {
        const r = await fetch(`${FRIEND_API}/friends/status/${p.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        statuses[p.id] = await r.json();
      } catch {}
    }));
    setFriendStatuses(statuses);
  };

  // ── Friend action ───────────────────────────────────────
  const handleFriendAction = async (userId: number) => {
    const status = friendStatuses[userId];
    try {
      if (!status || status.status === 'none') {
        // Wyślij zaproszenie
        await fetch(`${FRIEND_API}/friends/request`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${tokenRef.current}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ userId }),
        });
        setFriendStatuses(prev => ({ ...prev, [userId]: { status: 'pending', isSender: true } }));
      } else if (status.status === 'accepted') {
        // Usuń znajomego
        await fetch(`${FRIEND_API}/friends/${status.friendshipId}`, {
          method:  'DELETE',
          headers: { Authorization: `Bearer ${tokenRef.current}` },
        });
        setFriendStatuses(prev => ({ ...prev, [userId]: { status: 'none' } }));
      }
    } catch (e) { console.error(e); }
  };

  // ── Search ──────────────────────────────────────────────
  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const r = await fetch(
        `${API}/conversations/${convId}/search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      setSearchResults(await r.json());
    } catch (e) { console.error(e); }
    finally { setSearchLoading(false); }
  }, [convId]);

  // ── Save group name ─────────────────────────────────────
  const handleSaveName = async () => {
    if (!groupName.trim()) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append('name', groupName.trim());
      await fetch(`${API}/conversations/${convId}`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
        body:    form,
      });
      onConvUpdated(groupName.trim(), convAvatar);
      setEditingName(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  // ── Change group avatar ─────────────────────────────────
  const handleChangeGroupAvatar = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality:    0.85,
    });
    if (r.canceled) return;
    const uri = r.assets[0].uri;
    setSaving(true);
    try {
      const form = new FormData();
      form.append('avatar', { uri, type: 'image/jpeg', name: 'avatar.jpg' } as any);
      const res = await fetch(`${API}/conversations/${convId}`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
        body:    form,
      });
      const d = await res.json();
      onConvUpdated(convName, d.avatarUrl);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  // ── Friend badge ────────────────────────────────────────
  const FriendBadge = ({ userId }: { userId: number }) => {
    const status = friendStatuses[userId];
    if (!status || status.status === 'none') {
      return (
        <TouchableOpacity style={bs.friendBtn} onPress={() => handleFriendAction(userId)}>
          <Feather name="user-plus" size={13} color="#4de926" />
          <Text style={[bs.friendBtnText, { color: '#4de926' }]}>DODAJ</Text>
        </TouchableOpacity>
      );
    }
    if (status.status === 'pending' && status.isSender) {
      return (
        <View style={[bs.friendBtn, { borderColor: '#ffffff20' }]}>
          <Feather name="clock" size={13} color="#ffffff40" />
          <Text style={[bs.friendBtnText, { color: '#ffffff40' }]}>WYSŁANO</Text>
        </View>
      );
    }
    if (status.status === 'pending' && !status.isSender) {
      return (
        <View style={[bs.friendBtn, { borderColor: '#ff922b40' }]}>
          <Feather name="bell" size={13} color="#ff922b" />
          <Text style={[bs.friendBtnText, { color: '#ff922b' }]}>OCZEKUJE</Text>
        </View>
      );
    }
    if (status.status === 'accepted') {
      return (
        <View style={[bs.friendBtn, { borderColor: '#4de92630', backgroundColor: '#4de92610' }]}>
          <Feather name="check" size={13} color="#4de926" />
          <Text style={[bs.friendBtnText, { color: '#4de926' }]}>ZNAJOMY</Text>
        </View>
      );
    }
    return null;
  };

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      {/* Backdrop */}
      <TouchableOpacity style={bs.backdrop} onPress={onClose} activeOpacity={1} />

      <Animated.View style={[bs.sheet, { transform: [{ translateY: slideAnim }] }]}>

        {/* Handle */}
        <View style={bs.handle} />

        {/* ── INFO KONWERSACJI (góra) ── */}
        <View style={bs.topInfo}>
          {/* Avatar grupy — klikalny jeśli grupa */}
          <TouchableOpacity
            onPress={isGroup ? handleChangeGroupAvatar : undefined}
            disabled={!isGroup}
            activeOpacity={isGroup ? 0.75 : 1}
          >
            {(isGroup ? convAvatar : participants.find(p => p.id !== myId)?.avatarUrl)
              ? (
                <Image
                  source={{ uri: isGroup ? convAvatar! : participants.find(p => p.id !== myId)!.avatarUrl! }}
                  style={bs.bigAvatar}
                />
              ) : (
                <View style={[bs.bigAvatar, bs.bigAvatarFallback]}>
                  <Text style={bs.bigAvatarText}>
                    {convName?.slice(0, 2).toUpperCase() ?? '??'}
                  </Text>
                </View>
              )
            }
            {isGroup && (
              <View style={bs.editAvatarBadge}>
                <Feather name="camera" size={12} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          {/* Nazwa */}
          {isGroup && editingName ? (
            <View style={bs.nameEditRow}>
              <TextInput
                style={bs.nameInput}
                value={groupName}
                onChangeText={setGroupName}
                autoFocus
                selectTextOnFocus
              />
              <TouchableOpacity onPress={handleSaveName} disabled={saving}>
                {saving
                  ? <ActivityIndicator size="small" color="#e33835" />
                  : <Feather name="check" size={18} color="#4de926" />
                }
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingName(false)}>
                <Feather name="x" size={18} color="#ffffff50" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={bs.nameRow}
              onPress={isGroup ? () => setEditingName(true) : undefined}
              activeOpacity={isGroup ? 0.75 : 1}
            >
              <Text style={bs.convName}>{convName}</Text>
              {isGroup && <Feather name="edit-2" size={14} color="#ffffff30" />}
            </TouchableOpacity>
          )}

          {/* Status / liczba uczestników */}
          <Text style={bs.convSub}>
            {isGroup
              ? `${participants.length} uczestników`
              : (participants.find(p => p.id !== myId)?.online ? 'Online' : 'Offline')
            }
          </Text>
        </View>

        {/* ── TABS ── */}
        <View style={bs.tabs}>
          {([
            { key: 'info',   icon: 'info',   label: 'INFO'   },
            { key: 'media',  icon: 'image',  label: 'MEDIA'  },
            { key: 'search', icon: 'search', label: 'SZUKAJ' },
          ] as { key: Tab; icon: any; label: string }[]).map(t => (
            <TouchableOpacity
              key={t.key}
              style={[bs.tab, tab === t.key && bs.tabActive]}
              onPress={() => setTab(t.key)}
            >
              <Feather name={t.icon} size={15} color={tab === t.key ? '#e33835' : '#ffffff35'} />
              <Text style={[bs.tabText, tab === t.key && bs.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── TAB CONTENT ── */}

        {/* INFO */}
        {tab === 'info' && (
          <ScrollView style={bs.tabContent} showsVerticalScrollIndicator={false}>
            <Text style={bs.sectionLabel}>UCZESTNICY</Text>
            {participants.map(p => (
              <View key={p.id} style={bs.participantRow}>
                {p.avatarUrl
                  ? <Image source={{ uri: p.avatarUrl }} style={bs.pAvatar} />
                  : (
                    <View style={[bs.pAvatar, bs.pAvatarFallback]}>
                      <Text style={bs.pAvatarText}>{p.username?.slice(0, 2).toUpperCase()}</Text>
                    </View>
                  )
                }
                <View style={{ flex: 1 }}>
                  <Text style={bs.pName}>
                    {p.username}{p.id === myId ? ' (Ty)' : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={[bs.onlineDot, { backgroundColor: p.online ? '#4de926' : '#ffffff20' }]} />
                    <Text style={bs.pStatus}>{p.online ? 'Online' : 'Offline'}</Text>
                  </View>
                </View>
                {p.id !== myId && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={bs.profileBtn}
                      onPress={() => { onClose(); onViewProfile(p.id); }}
                    >
                      <Feather name="user" size={14} color="#ffffff60" />
                    </TouchableOpacity>
                    <FriendBadge userId={p.id} />
                  </View>
                )}
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}

        {/* MEDIA */}
        {tab === 'media' && (
          <View style={bs.tabContent}>
            {mediaLoading
              ? <ActivityIndicator color="#e33835" style={{ marginTop: 40 }} />
              : media.length === 0
              ? (
                <View style={bs.emptyTab}>
                  <MaterialCommunityIcons name="image-off-outline" size={40} color="#ffffff15" />
                  <Text style={bs.emptyTabText}>Brak multimediów</Text>
                </View>
              )
              : (
                <FlatList
                  data={media}
                  keyExtractor={(_, i) => String(i)}
                  numColumns={3}
                  renderItem={({ item }) => (
                    <Image
                      source={{ uri: item.url }}
                      style={bs.mediaThumb}
                      resizeMode="cover"
                    />
                  )}
                  contentContainerStyle={{ padding: 2 }}
                />
              )
            }
          </View>
        )}

        {/* SEARCH */}
        {tab === 'search' && (
          <View style={[bs.tabContent, { gap: 0 }]}>
            {/* Search input */}
            <View style={bs.searchBar}>
              <Feather name="search" size={15} color="#ffffff40" />
              <TextInput
                style={bs.searchInput}
                value={searchQuery}
                onChangeText={handleSearch}
                placeholder="Szukaj w konwersacji..."
                placeholderTextColor="#ffffff25"
                autoFocus={tab === 'search'}
              />
              {searchLoading && <ActivityIndicator size="small" color="#e33835" />}
              {searchQuery.length > 0 && !searchLoading && (
                <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                  <Feather name="x" size={15} color="#ffffff40" />
                </TouchableOpacity>
              )}
            </View>

            {/* Wyniki */}
            <FlatList
              data={searchResults}
              keyExtractor={i => String(i.id)}
              renderItem={({ item }) => (
                <View style={bs.searchResult}>
                  {item.sender.avatarUrl
                    ? <Image source={{ uri: item.sender.avatarUrl }} style={bs.srAvatar} />
                    : (
                      <View style={[bs.srAvatar, bs.pAvatarFallback]}>
                        <Text style={bs.pAvatarText}>{item.sender.username?.slice(0, 2).toUpperCase()}</Text>
                      </View>
                    )
                  }
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={bs.srName}>{item.sender.username}</Text>
                      <Text style={bs.srTime}>
                        {new Date(item.createdAt).toLocaleDateString('pl', { day: '2-digit', month: '2-digit' })}
                      </Text>
                    </View>
                    <Text style={bs.srContent} numberOfLines={2}>{item.content}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                searchQuery.length >= 2 && !searchLoading
                  ? (
                    <View style={bs.emptyTab}>
                      <Text style={bs.emptyTabText}>Brak wyników</Text>
                    </View>
                  )
                  : null
              }
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          </View>
        )}

      </Animated.View>
    </Modal>
  );
}

const { width: W } = Dimensions.get('window');
const THUMB = (W - 6) / 3;

const bs = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000080',
  },
  sheet: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    height:          SCREEN_H * 0.82,
    backgroundColor: '#111111',
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    overflow:        'hidden',
  },
  handle: {
    width: 40, height: 4,
    backgroundColor: '#ffffff20',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12, marginBottom: 4,
  },

  // ── Top info ──
  topInfo: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff08',
  },
  bigAvatar: {
    width: 80, height: 80, borderRadius: 40,
  },
  bigAvatarFallback: {
    backgroundColor: '#1a1a1a',
    borderWidth: 2, borderColor: '#e3383530',
    alignItems: 'center', justifyContent: 'center',
  },
  bigAvatarText: {
    color: '#e33835', fontFamily: 'Orbitron',
    fontSize: 26, fontWeight: '700',
  },
  editAvatarBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#e33835',
    borderWidth: 2, borderColor: '#111111',
    alignItems: 'center', justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  convName: {
    color: '#fff', fontFamily: 'Orbitron',
    fontSize: 16, fontWeight: '700',
  },
  convSub: {
    color: '#ffffff40', fontSize: 11,
  },
  nameEditRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20,
  },
  nameInput: {
    flex: 1, color: '#fff', fontFamily: 'Orbitron',
    fontSize: 15, fontWeight: '700',
    backgroundColor: '#1a1a1a',
    borderRadius: 10, borderWidth: 1, borderColor: '#ffffff15',
    paddingHorizontal: 12, paddingVertical: 6,
  },

  // ── Tabs ──
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff08',
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 5,
    paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#1a1a1a',
  },
  tabActive: {
    backgroundColor: '#e3383518',
    borderWidth: 1, borderColor: '#e3383530',
  },
  tabText:       { color: '#ffffff30', fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 },
  tabTextActive: { color: '#e33835' },

  tabContent: { flex: 1 },

  // ── Participants ──
  sectionLabel: {
    color: '#ffffff25', fontFamily: 'Orbitron',
    fontSize: 9, letterSpacing: 2,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
  },
  participantRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1, borderBottomColor: '#ffffff05',
  },
  pAvatar:        { width: 42, height: 42, borderRadius: 21 },
  pAvatarFallback:{ backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#e3383525', alignItems: 'center', justifyContent: 'center' },
  pAvatarText:    { color: '#e33835', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' },
  pName:          { color: '#fff', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' },
  pStatus:        { color: '#ffffff35', fontSize: 10 },
  onlineDot:      { width: 6, height: 6, borderRadius: 3 },
  profileBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff12',
    alignItems: 'center', justifyContent: 'center',
  },
  friendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 12, borderWidth: 1, borderColor: '#4de92640',
    backgroundColor: '#4de92610',
  },
  friendBtnText: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' },

  // ── Media ──
  mediaThumb: {
    width: THUMB, height: THUMB,
    margin: 1, borderRadius: 4,
  },

  // ── Search ──
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    margin: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 12, borderWidth: 1, borderColor: '#ffffff0a',
    paddingHorizontal: 12, paddingVertical: 10,
    gap: 8,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 13, padding: 0 },
  searchResult: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1, borderBottomColor: '#ffffff06',
  },
  srAvatar: { width: 36, height: 36, borderRadius: 18 },
  srName:   { color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' },
  srTime:   { color: '#ffffff30', fontSize: 9 },
  srContent:{ color: '#ffffff70', fontSize: 12, lineHeight: 17 },

  // ── Empty ──
  emptyTab: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingTop: 60, gap: 10,
  },
  emptyTabText: { color: '#ffffff20', fontFamily: 'Orbitron', fontSize: 11 },
});