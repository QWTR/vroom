import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, TouchableOpacity, Image, ScrollView, ActivityIndicator, FlatList, Animated, Dimensions, Modal, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../ui/AppText';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme }  from '../../contexts/ThemeContext';
import { useModalSheetPadding } from '../layout/ModalKeyboardSheet';
import { apiRequest } from '../../lib/api/client';
import { queryClient } from '../../lib/query/client';

const { height: SCREEN_H, width: W } = Dimensions.get('window');
const THUMB  = (W - 6) / 3;
interface ChatUser  { id: number; username: string; avatarUrl: string | null; online?: boolean; }
interface MediaItem { url: string; messageId: number; createdAt: string; sender: string; }
interface SearchResult { id: number; content: string; createdAt: string; sender: ChatUser; }

interface Props {
  visible:      boolean;
  onClose:      () => void;
  convId:       number;
  isGroup:      boolean;
  convName:     string;
  convAvatar:   string | null;
  participants: ChatUser[];
  myId:         number | null;
  onViewProfile:  (userId: number) => void;
  onConvUpdated:  (name: string, avatarUrl: string | null) => void;
}

type Tab = 'info' | 'media' | 'search';

export function ConversationInfoSheet({
  visible, onClose, convId, isGroup, convName,
  convAvatar, participants, myId, onViewProfile, onConvUpdated,
}: Props) {
  const { theme } = useTheme();
  const slideAnim = useRef(new Animated.Value(SCREEN_H)).current;

  const [tab,            setTab]            = useState<Tab>('info');
  const [media,          setMedia]          = useState<MediaItem[]>([]);
  const [mediaLoading,   setMediaLoading]   = useState(false);
  const [searchQuery,    setSearchQuery]    = useState('');
  const [searchResults,  setSearchResults]  = useState<SearchResult[]>([]);
  const [searchLoading,  setSearchLoading]  = useState(false);
  const [friendStatuses, setFriendStatuses] = useState<Record<number, any>>({});
  const [groupName,      setGroupName]      = useState(convName);
  const [editingName,    setEditingName]    = useState(false);
  const [saving,         setSaving]         = useState(false);
  const sheetPaddingBottom = useModalSheetPadding(visible);

  useEffect(() => {
    if (visible) {
      setTab('info'); setSearchQuery(''); setSearchResults([]);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
    } else {
      Animated.timing(slideAnim, { toValue: SCREEN_H, duration: 250, useNativeDriver: true }).start();
    }
  }, [slideAnim, visible]);

  const fetchMedia = useCallback(async () => {
    setMediaLoading(true);
    try {
      const nextMedia = await queryClient.fetchQuery({
        queryKey: ['chat', 'conversation-media', convId],
        queryFn: ({ signal }) => apiRequest<MediaItem[]>(`/chat/conversations/${convId}/media`, { signal, priority: 'visible' }),
        staleTime: 60_000,
      });
      setMedia(nextMedia);
    } catch {}
    finally { setMediaLoading(false); }
  }, [convId]);

  const fetchFriendStatuses = useCallback(async () => {
    const others = participants.filter(p => p.id !== myId);
    if (!others.length) return setFriendStatuses({});
    try {
      const userIds = others.map(participant => participant.id).join(',');
      const result = await queryClient.fetchQuery({
        queryKey: ['social', 'friend-statuses', userIds],
        queryFn: ({ signal }) => apiRequest<{ statuses: Record<number, any> }>(`/v2/social/friend-statuses?userIds=${userIds}`, { signal, priority: 'visible' }),
        staleTime: 30_000,
      });
      setFriendStatuses(result.statuses);
    } catch {}
  }, [myId, participants]);

  useEffect(() => {
    if (!visible) return;
    void fetchFriendStatuses();
  }, [fetchFriendStatuses, visible]);

  useEffect(() => {
    if (!visible || tab !== 'media') return;
    void fetchMedia();
  }, [fetchMedia, tab, visible]);

  const handleFriendAction = async (userId: number) => {
    const status = friendStatuses[userId];
    try {
      if (!status || status.status === 'none') {
        await apiRequest('/chat/friends/request', { method: 'POST', body: { userId } });
        setFriendStatuses(prev => ({ ...prev, [userId]: { status: 'pending', isSender: true } }));
      } else if (status.status === 'accepted') {
        await apiRequest(`/chat/friends/${status.friendshipId}`, { method: 'DELETE' });
        setFriendStatuses(prev => ({ ...prev, [userId]: { status: 'none' } }));
      }
      await queryClient.invalidateQueries({ queryKey: ['social', 'friend-statuses'] });
    } catch (e) { console.error(e); }
  };

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (q.trim().length < 2) setSearchResults([]);
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!visible || tab !== 'search' || query.length < 2) return;
    const queryKey = ['chat', 'conversation-search', convId, query];
    const timer = setTimeout(() => {
      setSearchLoading(true);
      void queryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => apiRequest<SearchResult[]>(`/chat/conversations/${convId}/search?q=${encodeURIComponent(query)}`, { signal, priority: 'visible' }),
        staleTime: 30_000,
      }).then(setSearchResults).catch(() => {}).finally(() => setSearchLoading(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      void queryClient.cancelQueries({ queryKey });
    };
  }, [convId, searchQuery, tab, visible]);

  const handleSaveName = async () => {
    if (!groupName.trim()) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append('name', groupName.trim());
      await apiRequest(`/chat/conversations/${convId}`, { method: 'PATCH', body: form });
      onConvUpdated(groupName.trim(), convAvatar);
      setEditingName(false);
    } catch {}
    finally { setSaving(false); }
  };

  const handleChangeGroupAvatar = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (r.canceled) return;
    const uri = r.assets[0].uri;
    setSaving(true);
    try {
      const form = new FormData();
      form.append('avatar', { uri, type: 'image/jpeg', name: 'avatar.jpg' } as any);
      const d = await apiRequest<{ avatarUrl: string | null }>(`/chat/conversations/${convId}`, { method: 'PATCH', body: form });
      onConvUpdated(convName, d.avatarUrl);
    } catch {}
    finally { setSaving(false); }
  };

  const FriendBadge = ({ userId }: { userId: number }) => {
    const status = friendStatuses[userId];
    const base = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, borderWidth: 1 };
    if (!status || status.status === 'none') return (
      <TouchableOpacity style={[base, { borderColor: '#4de92640', backgroundColor: '#4de92610' }]} onPress={() => handleFriendAction(userId)}>
        <Feather name="user-plus" size={13} color="#4de926" />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', color: '#4de926' }}>DODAJ</Text>
      </TouchableOpacity>
    );
    if (status.status === 'pending' && status.isSender) return (
      <View style={[base, { borderColor: '#ffffff20' }]}>
        <Feather name="clock" size={13} color="#ffffff40" />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', color: '#ffffff40' }}>WYSŁANO</Text>
      </View>
    );
    if (status.status === 'pending' && !status.isSender) return (
      <View style={[base, { borderColor: '#ff922b40' }]}>
        <Feather name="bell" size={13} color="#ff922b" />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', color: '#ff922b' }}>OCZEKUJE</Text>
      </View>
    );
    if (status.status === 'accepted') return (
      <View style={[base, { borderColor: '#4de92630', backgroundColor: '#4de92610' }]}>
        <Feather name="check" size={13} color="#4de926" />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', color: '#4de926' }}>ZNAJOMY</Text>
      </View>
    );
    return null;
  };

  if (!visible) return null;

  const otherParticipant = participants.find(p => p.id !== myId);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS === 'ios'}
      >
      <TouchableOpacity style={{ ...StyleSheet.absoluteFillObject, backgroundColor: theme.overlay }} onPress={onClose} activeOpacity={1} />

      <Animated.View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: SCREEN_H * 0.82,
        backgroundColor: theme.surface2,
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        overflow: 'hidden',
        paddingBottom: sheetPaddingBottom,
        transform: [{ translateY: slideAnim }],
      }}>
        {/* Handle */}
        <View style={{ width: 40, height: 4, backgroundColor: theme.border2, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />

        {/* TOP INFO */}
        <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <TouchableOpacity onPress={isGroup ? handleChangeGroupAvatar : undefined} disabled={!isGroup} activeOpacity={isGroup ? 0.75 : 1}>
            {(isGroup ? convAvatar : otherParticipant?.avatarUrl)
              ? <Image source={{ uri: (isGroup ? convAvatar : otherParticipant?.avatarUrl) as string }} style={{ width: 80, height: 80, borderRadius: 40 }} />
              : <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: theme.surface3, borderWidth: 2, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 26, fontWeight: '700' }}>{convName?.slice(0, 2).toUpperCase() ?? '??'}</Text>
                </View>
            }
            {isGroup && (
              <View style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: theme.primary, borderWidth: 2, borderColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="camera" size={12} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          {isGroup && editingName ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20 }}>
              <TextInput style={{ flex: 1, color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 15, fontWeight: '700', backgroundColor: theme.surface3, borderRadius: 10, borderWidth: 1, borderColor: theme.border2, paddingHorizontal: 12, paddingVertical: 6 }} value={groupName} onChangeText={setGroupName} autoFocus selectTextOnFocus />
              <TouchableOpacity onPress={handleSaveName} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={theme.primary} /> : <Feather name="check" size={18} color="#4de926" />}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingName(false)}>
                <Feather name="x" size={18} color={theme.textDim} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={isGroup ? () => setEditingName(true) : undefined} activeOpacity={isGroup ? 0.75 : 1}>
              <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 16, fontWeight: '700' }}>{convName}</Text>
              {isGroup && <Feather name="edit-2" size={14} color={theme.textFaint} />}
            </TouchableOpacity>
          )}

          <Text style={{ color: theme.textDim, fontSize: 12 }}>
            {isGroup ? `${participants.length} uczestników` : (otherParticipant?.online ? 'Online' : 'Offline')}
          </Text>
        </View>

        {/* TABS */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          {([
            { key: 'info',   icon: 'info',   label: 'INFO'   },
            { key: 'media',  icon: 'image',  label: 'MEDIA'  },
            { key: 'search', icon: 'search', label: 'SZUKAJ' },
          ] as { key: Tab; icon: any; label: string }[]).map(t => (
            <TouchableOpacity
              key={t.key}
              style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.surface3 },
                tab === t.key && { backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder }]}
              onPress={() => setTab(t.key)}
            >
              <Feather name={t.icon} size={15} color={tab === t.key ? theme.primary : theme.textFaint} />
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, color: tab === t.key ? theme.primary : theme.textFaint }}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* INFO */}
        {tab === 'info' && (
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <Text style={{ color: theme.textFaint, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>UCZESTNICY</Text>
            {participants.map(p => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                {p.avatarUrl
                  ? <Image source={{ uri: p.avatarUrl }} style={{ width: 42, height: 42, borderRadius: 21 }} />
                  : <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{p.username?.slice(0, 2).toUpperCase()}</Text>
                    </View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{p.username}{p.id === myId ? ' (Ty)' : ''}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.online ? '#4de926' : theme.border2 }} />
                    <Text style={{ color: theme.textDim, fontSize: 12 }}>{p.online ? 'Online' : 'Offline'}</Text>
                  </View>
                </View>
                {p.id !== myId && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.surface4, borderWidth: 1, borderColor: theme.border2, alignItems: 'center', justifyContent: 'center' }} onPress={() => { onClose(); onViewProfile(p.id); }}>
                      <Feather name="user" size={14} color={theme.textDim} />
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
          <View style={{ flex: 1 }}>
            {mediaLoading
              ? <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
              : media.length === 0
              ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10 }}>
                  <MaterialCommunityIcons name="image-off-outline" size={40} color={theme.border3} />
                  <Text style={{ color: theme.textFaint, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>Brak multimediów</Text>
                </View>
              : <FlatList data={media} keyExtractor={(_, i) => String(i)} numColumns={3}
                  renderItem={({ item }) => <Image source={{ uri: item.url }} style={{ width: THUMB, height: THUMB, margin: 1, borderRadius: 4 }} resizeMode="cover" />}
                  contentContainerStyle={{ padding: 2 }}
                />
            }
          </View>
        )}

        {/* SEARCH */}
        {tab === 'search' && (
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', margin: 12, backgroundColor: theme.surface3, borderRadius: 12, borderWidth: 1, borderColor: theme.border2, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
              <Feather name="search" size={15} color={theme.textDim} />
              <TextInput style={{ flex: 1, color: theme.text, fontSize: 13, padding: 0 }} value={searchQuery} onChangeText={handleSearch} placeholder="Szukaj w konwersacji..." placeholderTextColor={theme.textFaint} autoFocus={tab === 'search'} />
              {searchLoading && <ActivityIndicator size="small" color={theme.primary} />}
              {searchQuery.length > 0 && !searchLoading && (
                <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                  <Feather name="x" size={15} color={theme.textDim} />
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={searchResults}
              keyExtractor={i => String(i.id)}
              renderItem={({ item }) => (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  {item.sender.avatarUrl
                    ? <Image source={{ uri: item.sender.avatarUrl }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                    : <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{item.sender.username?.slice(0, 2).toUpperCase()}</Text>
                      </View>
                  }
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{item.sender.username}</Text>
                      <Text style={{ color: theme.textFaint, fontSize: 12 }}>{new Date(item.createdAt).toLocaleDateString('pl', { day: '2-digit', month: '2-digit' })}</Text>
                    </View>
                    <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>{item.content}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={searchQuery.length >= 2 && !searchLoading
                ? <View style={{ alignItems: 'center', paddingTop: 60 }}><Text style={{ color: theme.textFaint, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>Brak wyników</Text></View>
                : null
              }
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          </View>
        )}
      </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
