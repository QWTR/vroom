import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  Image, ActivityIndicator, KeyboardAvoidingView,
  Platform, StatusBar, Modal, Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather }       from '@expo/vector-icons';
import MaterialIcons     from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker  from 'expo-image-picker';
import AsyncStorage      from '@react-native-async-storage/async-storage';
import { io, Socket }    from 'socket.io-client';
import { useTheme }      from '../../../contexts/ThemeContext';
import { API_URL }       from '../../../constants/config';
import { UAv }           from '../../../components/clubs/ClubCard';

const WS_URL   = 'https://v-room.app';
const getToken = () => AsyncStorage.getItem('token');
const PAGE     = 30;

interface ClubMessage {
  id:        number;
  clubId:    number;
  senderId:  number;
  content:   string | null;
  photos:    string[];
  createdAt: string;
  isPinned:  boolean;
  pinnedAt:  string | null;
  sender: { id: number; username: string; avatarUrl: string | null };
  replyTo: {
    id:      number;
    content: string | null;
    sender:  { id: number; username: string };
  } | null;
}

// ── Context Menu Modal ────────────────────────────────────
function MessageMenu({
  visible,
  message,
  isMe,
  canPin,
  canDelete,
  onReply,
  onPin,
  onDelete,
  onClose,
}: {
  visible:   boolean;
  message:   ClubMessage | null;
  isMe:      boolean;
  canPin:    boolean;
  canDelete: boolean;
  onReply:   () => void;
  onPin:     () => void;
  onDelete:  () => void;
  onClose:   () => void;
}) {
  const { theme } = useTheme();
  if (!message) return null;

  const actions: { icon: string; label: string; color?: string; onPress: () => void }[] = [
    {
      icon: 'reply', label: 'Odpowiedz', onPress: () => { onReply(); onClose(); },
    },
    ...(canPin ? [{
      icon:    message.isPinned ? 'push-pin' : 'push-pin',
      label:   message.isPinned ? 'Odepnij' : 'Przypnij',
      color:   '#FFD700',
      onPress: () => { onPin(); onClose(); },
    }] : []),
    ...((isMe || canDelete) ? [{
      icon: 'delete-outline', label: 'Usuń', color: '#e33835',
      onPress: () => { onDelete(); onClose(); },
    }] : []),
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={e => e.stopPropagation()}>
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 34 : 16,
            borderTopWidth: 1, borderColor: theme.border2,
          }}>
            {/* Handle */}
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 16 }} />

            {/* Message preview */}
            <View style={{
              marginHorizontal: 16, marginBottom: 16,
              backgroundColor: theme.surface2, borderRadius: 12,
              padding: 10, borderWidth: 1, borderColor: theme.border,
              flexDirection: 'row', gap: 8, alignItems: 'center',
            }}>
              <UAv uri={message.sender.avatarUrl} name={message.sender.username} size={28} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.primary, fontWeight: '700', marginBottom: 2 }}>
                  {message.sender.username}
                </Text>
                <Text style={{ color: theme.textDim, fontSize: 12 }} numberOfLines={2}>
                  {message.content || '📷 Zdjęcie'}
                </Text>
              </View>
              {message.isPinned && (
                <MaterialIcons name="push-pin" size={14} color="#FFD700" />
              )}
            </View>

            {/* Divider */}
            <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 8 }} />

            {/* Actions */}
            {actions.map((a, i) => (
              <TouchableOpacity
                key={i}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  paddingHorizontal: 20, paddingVertical: 14,
                }}
                onPress={a.onPress}
                activeOpacity={0.7}
              >
                <View style={{
                  width: 36, height: 36, borderRadius: 10,
                  backgroundColor: (a.color ?? theme.primary) + '18',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialIcons
                    name={a.icon as any}
                    size={18}
                    color={a.color ?? theme.primary}
                  />
                </View>
                <Text style={{
                  fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700',
                  color: a.color ?? theme.text,
                }}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function ClubChatScreen() {
  const { id }            = useLocalSearchParams<{ id: string }>();
  const clubId            = parseInt(id);
  const router            = useRouter();
  const { theme, isDark } = useTheme();

  const [clubName,    setClubName]    = useState('');
  const [myId,        setMyId]        = useState<number | null>(null);
  const [myRole,      setMyRole]      = useState<string | null>(null);
  const [myRank,      setMyRank]      = useState<any>(null);

  const [messages,    setMessages]    = useState<ClubMessage[]>([]);
  const [pinned,      setPinned]      = useState<ClubMessage[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(true);
  const [cursor,      setCursor]      = useState<number | null>(null);

  const [text,        setText]        = useState('');
  const [photos,      setPhotos]      = useState<string[]>([]);
  const [replyTo,     setReplyTo]     = useState<ClubMessage | null>(null);
  const [sending,     setSending]     = useState(false);
  const [showPinned,  setShowPinned]  = useState(false);

  // ── Context menu ───────────────────────────────────────
  const [menuMsg,     setMenuMsg]     = useState<ClubMessage | null>(null);

  const listRef          = useRef<FlatList>(null);
  const socketRef        = useRef<Socket | null>(null);
  const tokenRef         = useRef('');
  const initialScrollRef = useRef(false);

  // ── Init ───────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const token = await getToken() ?? '';
      tokenRef.current = token;

      const raw = await AsyncStorage.getItem('user');
      if (raw) { const u = JSON.parse(raw); setMyId(u.userId); }

      const clubRes = await fetch(`${API_URL}/api/clubs/${clubId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (clubRes.ok) {
        const club = await clubRes.json();
        setClubName(club.name);
        setMyRole(club.myRole);
        setMyRank(club.myRank);
      }

      const socket = io(WS_URL, { auth: { token }, transports: ['websocket'] });
      socket.emit('club:join', clubId);

      socket.on('club:message', (msg: ClubMessage) => {
        if (msg.clubId === clubId) {
          setMessages(prev => [...prev, msg]);
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
        }
      });
      socket.on('club:message_deleted', ({ id: msgId }: { id: number }) => {
        setMessages(prev => prev.filter(m => m.id !== msgId));
        setPinned(prev => prev.filter(m => m.id !== msgId));
      });
      socket.on('club:pinned', (msg: ClubMessage) => {
        setPinned(prev => [msg, ...prev.filter(m => m.id !== msg.id)].slice(0, 5));
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isPinned: true } : m));
      });
      socket.on('club:unpinned', ({ id: msgId }: { id: number }) => {
        setPinned(prev => prev.filter(m => m.id !== msgId));
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isPinned: false } : m));
      });
      socketRef.current = socket;

      await loadMessages(token);
    })();

    return () => {
      socketRef.current?.emit('club:leave', clubId);
      socketRef.current?.disconnect();
    };
  }, [clubId]);

  const loadMessages = async (token: string, cur?: number) => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (cur) params.append('cursor', String(cur));
      const res  = await fetch(`${API_URL}/api/clubs/${clubId}/messages?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (cur) setMessages(prev => [...(data.messages ?? []), ...prev]);
      else     setMessages(data.messages ?? []);
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
      setPinned(data.pinned ?? []);
      if (!cur) setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: false });
        initialScrollRef.current = true;
      }, 120);
    } finally { setLoading(false); setLoadingMore(false); }
  };

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || !hasMore) return;
    setLoadingMore(true);
    loadMessages(tokenRef.current, cursor);
  }, [cursor, loadingMore, hasMore]);

  const handleSend = useCallback(async () => {
    if (!text.trim() && !photos.length) return;
    const t = text.trim();
    const p = [...photos];
    setText(''); setPhotos([]); setReplyTo(null);
    setSending(true);
    try {
      const form = new FormData();
      if (t)       form.append('content', t);
      if (replyTo) form.append('replyToId', String(replyTo.id));
      p.forEach((uri, i) => form.append('photos', { uri, type: 'image/jpeg', name: `p${i}.jpg` } as any));
      await fetch(`${API_URL}/api/clubs/${clubId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${tokenRef.current}` }, body: form,
      });
    } finally { setSending(false); }
  }, [text, photos, replyTo, clubId]);

  const handlePickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, quality: 0.8,
    });
    if (!r.canceled) setPhotos(prev => [...prev, ...r.assets.map(a => a.uri)].slice(0, 4));
  };

  const handlePin = async (msgId: number, isPinned: boolean) => {
    const token = tokenRef.current;
    const method = isPinned ? 'DELETE' : 'POST';
    await fetch(`${API_URL}/api/clubs/${clubId}/messages/${msgId}/pin`, {
      method, headers: { Authorization: `Bearer ${token}` },
    });
    // Optymistyczny update — socket wyśle też event
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isPinned: !isPinned } : m));
  };

  const handleDelete = async (msgId: number) => {
    // Optymistyczny update
    setMessages(prev => prev.filter(m => m.id !== msgId));
    setPinned(prev => prev.filter(m => m.id !== msgId));
    await fetch(`${API_URL}/api/clubs/${clubId}/messages/${msgId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
  };

  const canPin    = myRole === 'owner' || !!myRank?.canPin;
  const canKick   = myRole === 'owner' || !!myRank?.canKick;

  // ── Render message ─────────────────────────────────────
  const renderMessage = useCallback(({ item, index }: { item: ClubMessage; index: number }) => {
    const isMe    = item.senderId === myId;
    const prev    = messages[index - 1];
    const next    = messages[index + 1];
    const isFirst = !prev || prev.senderId !== item.senderId;
    const isLast  = !next || next.senderId !== item.senderId;
    const R = 18, T = 5;

    const bubbleStyle = isMe
      ? { borderTopLeftRadius: R, borderBottomLeftRadius: R, borderTopRightRadius: isFirst ? R : T, borderBottomRightRadius: isLast ? R : T }
      : { borderTopRightRadius: R, borderBottomRightRadius: R, borderTopLeftRadius: isFirst ? R : T, borderBottomLeftRadius: isLast ? R : T };

    return (
      <View style={[
        { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 1, marginBottom: isLast ? 8 : 2 },
        isMe
          ? { justifyContent: 'flex-end',   paddingLeft: 48 }
          : { justifyContent: 'flex-start', paddingRight: 48 },
      ]}>
        {/* Avatar */}
        {!isMe && (
          <View style={{ width: 30, alignItems: 'center', justifyContent: 'flex-end' }}>
            {isLast && <UAv uri={item.sender.avatarUrl} name={item.sender.username} size={28} />}
          </View>
        )}

        {/* Bubble */}
        <TouchableOpacity
          style={[{
            maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, gap: 4,
            ...(isMe
              ? { backgroundColor: theme.primary }
              : { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }),
          }, bubbleStyle]}
          onLongPress={() => setMenuMsg(item)}
          delayLongPress={350}
          activeOpacity={0.85}
        >
          {/* Sender name */}
          {!isMe && isFirst && (
            <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginBottom: 2 }}>
              {item.sender.username}
            </Text>
          )}

          {/* Pin indicator */}
          {item.isPinned && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 2 }}>
              <MaterialIcons name="push-pin" size={9} color="#FFD700" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#FFD700' }}>PRZYPIĘTA</Text>
            </View>
          )}

          {/* Reply */}
          {item.replyTo && (
            <View style={{
              backgroundColor: '#00000020', borderRadius: 8,
              borderLeftWidth: 3, borderLeftColor: isMe ? '#ffffff90' : '#ffffff60',
              paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4, gap: 2,
            }}>
              <Text style={{ color: '#ffffffaa', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>
                {item.replyTo.sender.username}
              </Text>
              <Text style={{ color: '#ffffff70', fontSize: 11 }} numberOfLines={1}>
                {item.replyTo.content || '📷 Zdjęcie'}
              </Text>
            </View>
          )}

          {/* Photos */}
          {item.photos?.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {item.photos.map((uri, i) => (
                <Image
                  key={i} source={{ uri }}
                  style={item.photos.length === 1
                    ? { width: 200, height: 150, borderRadius: 12 }
                    : { width: 120, height: 90,  borderRadius: 8  }}
                />
              ))}
            </View>
          )}

          {/* Text */}
          {!!item.content && (
            <Text style={{ fontSize: 14, lineHeight: 20, color: isMe ? '#fff' : theme.textMuted }}>
              {item.content}
            </Text>
          )}

          {/* Time */}
          <Text style={{ fontSize: 9, alignSelf: 'flex-end', color: isMe ? '#ffffff60' : theme.textDim }}>
            {new Date(item.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }, [myId, messages, theme]);

  const canDeleteMenu = menuMsg
    ? (menuMsg.senderId === myId || canKick)
    : false;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.surface} />

      {/* HEADER */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: Platform.OS === 'ios' ? 56 : 44,
        paddingBottom: 12, paddingHorizontal: 12,
        backgroundColor: theme.surface,
        borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10,
      }}>
        <TouchableOpacity
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={20} color={theme.text} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="shield-crown" size={14} color="#e33835" />
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
              {clubName}
            </Text>
          </View>
          <Text style={{ color: theme.textDim, fontSize: 9, fontFamily: 'Orbitron', marginTop: 1 }}>
            {myRole === 'owner' ? 'ZAŁOŻYCIEL' : myRank ? myRank.name.toUpperCase() : 'CZAT KLUBU'}
          </Text>
        </View>

        {pinned.length > 0 && (
          <TouchableOpacity
            style={[
              { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
              showPinned ? { backgroundColor: '#FFD70020' } : { backgroundColor: theme.surface2 },
            ]}
            onPress={() => setShowPinned(v => !v)}
          >
            <MaterialIcons name="push-pin" size={18} color={showPinned ? '#FFD700' : theme.textDim} />
          </TouchableOpacity>
        )}
      </View>

      {/* PINNED PANEL */}
      {showPinned && pinned.length > 0 && (
        <View style={{ backgroundColor: '#FFD70010', borderBottomWidth: 1, borderBottomColor: '#FFD70030', padding: 10, gap: 6 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#FFD700', letterSpacing: 2, marginBottom: 4 }}>
            📌 PRZYPIĘTE ({pinned.length})
          </Text>
          {pinned.map(p => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <UAv uri={p.sender.avatarUrl} name={p.sender.username} size={22} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#FFD700', fontWeight: '700' }}>{p.sender.username}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 12 }} numberOfLines={1}>{p.content || '📷 Zdjęcie'}</Text>
              </View>
              {canPin && (
                <TouchableOpacity onPress={() => handlePin(p.id, true)}>
                  <MaterialIcons name="close" size={14} color={theme.textDim} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {/* MESSAGES */}
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#e33835" size="large" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => String(m.id)}
          renderItem={renderMessage}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 10 }}
          ListHeaderComponent={
            hasMore ? (
              loadingMore
                ? <ActivityIndicator color={theme.primary} style={{ marginVertical: 14 }} />
                : (
                  <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={loadMore}>
                    <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>↑ ZAŁADUJ STARSZE</Text>
                  </TouchableOpacity>
                )
            ) : (
              messages.length > 0
                ? <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                    <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>POCZĄTEK CZATU KLUBU</Text>
                  </View>
                : null
            )
          }
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 }}>
              <MaterialCommunityIcons name="chat-outline" size={40} color={theme.border3} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' }}>Brak wiadomości</Text>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>Napisz pierwszą!</Text>
            </View>
          }
        />
      )}

      {/* INPUT */}
      <View style={{
        backgroundColor: theme.surface,
        borderTopWidth: 1, borderTopColor: theme.border,
        paddingBottom: Platform.OS === 'ios' ? 28 : 10,
      }}>
        {replyTo && (
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 14, paddingVertical: 8,
            borderBottomWidth: 1, borderBottomColor: theme.border, gap: 8,
          }}>
            <View style={{ width: 3, borderRadius: 2, backgroundColor: theme.primary, alignSelf: 'stretch' }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginBottom: 1 }}>
                {replyTo.sender.username}
              </Text>
              <Text style={{ color: theme.textDim, fontSize: 11 }} numberOfLines={1}>
                {replyTo.content || '📷 Zdjęcie'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={16} color={theme.textDim} />
            </TouchableOpacity>
          </View>
        )}

        {photos.length > 0 && (
          <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingTop: 8, gap: 8 }}>
            {photos.map((uri, i) => (
              <View key={i} style={{ position: 'relative' }}>
                <Image source={{ uri }} style={{ width: 52, height: 52, borderRadius: 9 }} />
                <TouchableOpacity
                  style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 17, height: 17, borderRadius: 9,
                    backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center',
                  }}
                  onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                >
                  <Feather name="x" size={10} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 10, gap: 8 }}>
          <TouchableOpacity
            style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}
            onPress={handlePickPhoto}
          >
            <Feather name="image" size={21} color={theme.textDim} />
          </TouchableOpacity>

          <TextInput
            style={{
              flex: 1, color: theme.text, fontSize: 14, lineHeight: 20,
              backgroundColor: theme.surface2, borderRadius: 20,
              paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9,
              borderWidth: 1, borderColor: theme.border, minHeight: 40, maxHeight: 120,
            }}
            value={text}
            onChangeText={setText}
            placeholder="Napisz na czacie klubu..."
            placeholderTextColor={theme.textDim}
            multiline maxLength={2000}
          />

          <TouchableOpacity
            style={[
              { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary },
              (!text.trim() && !photos.length) && { backgroundColor: `${theme.primary}30` },
            ]}
            onPress={handleSend}
            disabled={(!text.trim() && !photos.length) || sending}
          >
            {sending
              ? <ActivityIndicator size={14} color="#fff" />
              : <Feather name="send" size={17} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </View>

      {/* CONTEXT MENU */}
      <MessageMenu
        visible={!!menuMsg}
        message={menuMsg}
        isMe={menuMsg?.senderId === myId}
        canPin={canPin}
        canDelete={canDeleteMenu}
        onReply={() => { if (menuMsg) setReplyTo(menuMsg); }}
        onPin={()   => { if (menuMsg) handlePin(menuMsg.id, menuMsg.isPinned); }}
        onDelete={() => { if (menuMsg) handleDelete(menuMsg.id); }}
        onClose={() => setMenuMsg(null)}
      />
    </KeyboardAvoidingView>
  );
}