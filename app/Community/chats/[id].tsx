import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  Image, StyleSheet, StatusBar, KeyboardAvoidingView,
  Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { ConversationInfoSheet } from '../../../components/chat/ConversationInfoSheet';
import { RouteMessageCard }      from '../../../components/chat/RouteMessageCard';

const API = 'https://v-room.app/api/chat';
const WS  = 'https://v-room.app';

const INPUT_MIN_HEIGHT = 40;
const INPUT_MAX_HEIGHT = 120;

interface ChatUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
  online?:   boolean;
}

interface Message {
  id:             number;
  content:        string;
  photos:         string[];
  createdAt:      string;
  senderId:       number;
  sender:         ChatUser;
  conversationId: number;
  replyTo?: {
    id:      number;
    content: string;
    sender:  { id: number; username: string };
  } | null;
}

interface ConvInfo {
  id:           number;
  isGroup:      boolean;
  name:         string;
  avatarUrl:    string | null;
  online:       boolean;
  participants: ChatUser[];
}

// ── Helper — wykryj wiadomość z trasą ────────────────────
function parseRouteMessage(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type === 'route') return parsed;
  } catch {}
  return null;
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const convId  = parseInt(id);

  const [messages,    setMessages]    = useState<Message[]>([]);
  const [conv,        setConv]        = useState<ConvInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor,  setNextCursor]  = useState<number | null>(null);
  const [text,        setText]        = useState('');
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const [photos,      setPhotos]      = useState<string[]>([]);
  const [replyTo,     setReplyTo]     = useState<Message | null>(null);
  const [myId,        setMyId]        = useState<number | null>(null);
  const [typing,      setTyping]      = useState<string[]>([]);
  const [infoVisible, setInfoVisible] = useState(false);

  const listRef     = useRef<FlatList>(null);
  const socketRef   = useRef<Socket | null>(null);
  const tokenRef    = useRef<string>('');
  const typingTimer = useRef<any>(null);

  // ── Init ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const raw   = await AsyncStorage.getItem('user');
      const token = await AsyncStorage.getItem('token') ?? '';
      tokenRef.current = token;
      if (raw) setMyId(JSON.parse(raw).userId);

      const socket = io(WS, { auth: { token }, transports: ['websocket'] });
      socket.emit('chat:join', convId);

      socket.on('chat:message', (msg: Message) => {
        if (msg.conversationId === convId) {
          setMessages(prev => [...prev, msg]);
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
        }
      });

      socket.on('chat:typing', ({ isTyping, username }: any) => {
        setTyping(prev =>
          isTyping
            ? [...new Set([...prev, username])]
            : prev.filter(u => u !== username)
        );
      });

      socketRef.current = socket;
      await Promise.all([fetchConv(token), fetchMessages(token)]);
    })();

    return () => {
      socketRef.current?.emit('chat:leave', convId);
      socketRef.current?.disconnect();
    };
  }, [convId]);

  // ── Fetch conv ───────────────────────────────────────────
  const fetchConv = async (token: string) => {
    try {
      const r = await fetch(`${API}/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setConv(await r.json());
    } catch (e) { console.error('fetchConv:', e); }
  };

  // ── Fetch messages ───────────────────────────────────────
  const fetchMessages = async (token: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      setMessages(d.messages ?? []);
      setNextCursor(d.nextCursor);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    } catch (e) { console.error('fetchMessages:', e); }
    finally { setLoading(false); }
  };

  // ── Load more ────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `${API}/conversations/${convId}/messages?cursor=${nextCursor}`,
        { headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      const d = await r.json();
      setMessages(prev => [...(d.messages ?? []), ...prev]);
      setNextCursor(d.nextCursor);
    } catch (e) { console.error('loadMore:', e); }
    finally { setLoadingMore(false); }
  }, [convId, nextCursor, loadingMore]);

  // ── Send ─────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!text.trim() && !photos.length) return;

    const t = text.trim();
    const p = [...photos];
    setText('');
    setPhotos([]);
    setReplyTo(null);
    setInputHeight(INPUT_MIN_HEIGHT);

    const form = new FormData();
    if (t)           form.append('content', t);
    if (replyTo?.id) form.append('replyToId', String(replyTo.id));
    p.forEach((uri, i) => {
      form.append('photos', { uri, type: 'image/jpeg', name: `photo_${i}.jpg` } as any);
    });

    try {
      await fetch(`${API}/conversations/${convId}/messages`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
        body:    form,
      });
    } catch (e) { console.error('sendMessage:', e); }
  }, [text, photos, replyTo, convId]);

  // ── Typing ───────────────────────────────────────────────
  const emitTyping = useCallback(() => {
    socketRef.current?.emit('chat:typing', { conversationId: convId, isTyping: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.emit('chat:typing', { conversationId: convId, isTyping: false });
    }, 2000);
  }, [convId]);

  // ── Pick photo ───────────────────────────────────────────
  const handlePickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!r.canceled) {
      setPhotos(prev => [...prev, ...r.assets.map(a => a.uri)].slice(0, 4));
    }
  };

  // ── Nawiguj po trasie z wiadomości ───────────────────────
  const handleNavigateRoute = useCallback(async (data: any) => {
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId:   data.routeId,
      routeName: data.name,
      points:    data.points,
      distance:  data.distance,
    }));
    router.push('/(tabs)/map');
  }, [router]);

  // ── Render message ───────────────────────────────────────
  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isMe       = item.senderId === myId;
    const prevMsg    = messages[index - 1];
    const nextMsg    = messages[index + 1];
    const isFirst    = !prevMsg || prevMsg.senderId !== item.senderId;
    const isLast     = !nextMsg || nextMsg.senderId !== item.senderId;
    const showAvatar = !isMe && isLast;
    const showName   = !isMe && isFirst && (conv?.isGroup ?? false);

    const bubbleRadius = 18;
    const tightRadius  = 5;
    const bubbleStyle  = isMe
      ? {
          borderTopLeftRadius:     bubbleRadius,
          borderBottomLeftRadius:  bubbleRadius,
          borderTopRightRadius:    isFirst ? bubbleRadius : tightRadius,
          borderBottomRightRadius: isLast  ? bubbleRadius : tightRadius,
        }
      : {
          borderTopRightRadius:    bubbleRadius,
          borderBottomRightRadius: bubbleRadius,
          borderTopLeftRadius:     isFirst ? bubbleRadius : tightRadius,
          borderBottomLeftRadius:  isLast  ? bubbleRadius : tightRadius,
        };

    // Sprawdź czy to wiadomość z trasą
    const routeData = parseRouteMessage(item.content);

    return (
      <View style={[
        s.msgRow,
        isMe ? s.msgRowMe : s.msgRowOther,
        { marginBottom: isLast ? 8 : 2 },
      ]}>
        {/* Avatar — tylko dla innych */}
        {!isMe && (
          <View style={s.avatarSlot}>
            {showAvatar && (
              item.sender.avatarUrl
                ? <Image source={{ uri: item.sender.avatarUrl }} style={s.msgAvatar} />
                : (
                  <View style={[s.msgAvatar, s.avatarFallback]}>
                    <Text style={s.avatarInitials}>
                      {item.sender.username?.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )
            )}
          </View>
        )}

        {/* Jeśli to karta trasy — renderuj osobno bez bąbelka */}
        {routeData ? (
          <View style={isMe ? s.routeWrapMe : s.routeWrapOther}>
            {showName && (
              <Text style={s.senderName}>{item.sender.username}</Text>
            )}
            <RouteMessageCard
              data={routeData}
              isMe={isMe}
              onNavigate={handleNavigateRoute}
            />
            <Text style={[s.msgTime, isMe ? s.msgTimeMe : s.msgTimeOther, { marginTop: 2 }]}>
              {new Date(item.createdAt).toLocaleTimeString('pl', {
                hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </View>
        ) : (
          /* Zwykła wiadomość */
          <TouchableOpacity
            style={[s.bubble, isMe ? s.bubbleMe : s.bubbleOther, bubbleStyle]}
            onLongPress={() => setReplyTo(item)}
            activeOpacity={0.85}
          >
            {showName && (
              <Text style={s.senderName}>{item.sender.username}</Text>
            )}

            {/* Reply preview */}
            {item.replyTo && (
              <View style={[s.replyPreview, isMe && s.replyPreviewMe]}>
                <Text style={s.replyPreviewName}>{item.replyTo.sender.username}</Text>
                <Text style={s.replyPreviewText} numberOfLines={1}>
                  {item.replyTo.content || '📷 Zdjęcie'}
                </Text>
              </View>
            )}

            {/* Zdjęcia */}
            {item.photos?.length > 0 && (
              <View style={s.photosGrid}>
                {item.photos.map((uri, i) => (
                  <Image key={i} source={{ uri }} style={[
                    s.msgPhoto,
                    item.photos.length === 1 && s.msgPhotoSingle,
                  ]} />
                ))}
              </View>
            )}

            {/* Tekst */}
            {!!item.content && (
              <Text style={[s.msgText, isMe ? s.msgTextMe : s.msgTextOther]}>
                {item.content}
              </Text>
            )}

            {/* Czas */}
            <Text style={[s.msgTime, isMe ? s.msgTimeMe : s.msgTimeOther]}>
              {new Date(item.createdAt).toLocaleTimeString('pl', {
                hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [myId, messages, conv, handleNavigateRoute]);

  // ── Helpers ──────────────────────────────────────────────
  const typingText = typing.length === 1
    ? `${typing[0]} pisze...`
    : typing.length > 1
    ? `${typing.slice(0, 2).join(', ')} piszą...`
    : null;

  const convName = conv?.isGroup
    ? conv.name
    : conv?.participants?.find(p => p.id !== myId)?.username ?? '...';

  const convAvatar = conv?.isGroup
    ? conv.avatarUrl
    : conv?.participants?.find(p => p.id !== myId)?.avatarUrl ?? null;

  const convOnline = !conv?.isGroup
    ? (conv?.participants?.find(p => p.id !== myId)?.online ?? false)
    : false;

  // ─────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0f0f0f" />

      {/* ── HEADER ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={s.headerCenter} onPress={() => setInfoVisible(true)} activeOpacity={0.75}>
          {convAvatar
            ? <Image source={{ uri: convAvatar }} style={s.headerAvatar} />
            : (
              <View style={[s.headerAvatar, s.avatarFallback]}>
                <Text style={s.avatarInitials}>
                  {convName?.slice(0, 2).toUpperCase() ?? '??'}
                </Text>
              </View>
            )
          }
          <View style={s.headerInfo}>
            <Text style={s.headerName} numberOfLines={1}>{convName}</Text>
            {typingText
              ? <Text style={s.headerTyping}>{typingText}</Text>
              : (
                <View style={s.headerStatusRow}>
                  <View style={[s.headerStatusDot, { backgroundColor: convOnline ? '#4de926' : '#ffffff25' }]} />
                  <Text style={s.headerStatus}>{convOnline ? 'Online' : 'Offline'}</Text>
                </View>
              )
            }
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={s.infoBtn} onPress={() => setInfoVisible(true)}>
          <Feather name="info" size={18} color="#ffffff50" />
        </TouchableOpacity>
      </View>

      {/* ── WIADOMOŚCI ── */}
      {loading
        ? <ActivityIndicator style={{ flex: 1 }} color="#e33835" />
        : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={i => String(i.id)}
            renderItem={renderMessage}
            onEndReached={loadMore}
            onEndReachedThreshold={0.15}
            ListHeaderComponent={
              loadingMore
                ? <ActivityIndicator color="#e33835" style={{ marginVertical: 10 }} />
                : null
            }
            ListEmptyComponent={
              <View style={s.emptyMsg}>
                <MaterialCommunityIcons name="chat-outline" size={40} color="#ffffff10" />
                <Text style={s.emptyMsgText}>Brak wiadomości</Text>
                <Text style={s.emptyMsgSub}>Napisz pierwszą wiadomość!</Text>
              </View>
            }
            contentContainerStyle={{
              paddingHorizontal: 12,
              paddingTop: 12,
              paddingBottom: 8,
              flexGrow: 1,
            }}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => {
              listRef.current?.scrollToEnd({ animated: false });
            }}
          />
        )
      }

      {/* ── BOTTOM ── */}
      <View style={s.bottomWrap}>

        {/* Reply bar */}
        {replyTo && (
          <View style={s.replyBar}>
            <View style={s.replyBarLine} />
            <View style={{ flex: 1 }}>
              <Text style={s.replyBarName}>{replyTo.sender.username}</Text>
              <Text style={s.replyBarText} numberOfLines={1}>
                {replyTo.content || '📷 Zdjęcie'}
              </Text>
            </View>
            <TouchableOpacity
              style={s.replyBarClose}
              onPress={() => setReplyTo(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={16} color="#ffffff50" />
            </TouchableOpacity>
          </View>
        )}

        {/* Podgląd zdjęć */}
        {photos.length > 0 && (
          <View style={s.photosPreviewRow}>
            {photos.map((uri, i) => (
              <View key={i} style={s.photoPreviewWrap}>
                <Image source={{ uri }} style={s.photoPreview} />
                <TouchableOpacity
                  style={s.photoRemoveBtn}
                  onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                >
                  <Feather name="x" size={10} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Input row */}
        <View style={s.inputRow}>
          <TouchableOpacity style={s.iconBtn} onPress={handlePickPhoto}>
            <Feather name="image" size={21} color="#ffffff40" />
          </TouchableOpacity>

          <TextInput
            style={[s.input, { height: Math.max(INPUT_MIN_HEIGHT, inputHeight) }]}
            value={text}
            onChangeText={t => { setText(t); emitTyping(); }}
            onContentSizeChange={e => {
              const h = e.nativeEvent.contentSize.height;
              setInputHeight(Math.min(h, INPUT_MAX_HEIGHT));
            }}
            placeholder="Napisz wiadomość..."
            placeholderTextColor="#ffffff25"
            multiline
            maxLength={2000}
            scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
          />

          <TouchableOpacity
            style={[s.sendBtn, (!text.trim() && !photos.length) && s.sendBtnOff]}
            onPress={handleSend}
            disabled={!text.trim() && !photos.length}
          >
            <Feather name="send" size={17} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <ConversationInfoSheet
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        convId={convId}
        isGroup={conv?.isGroup ?? false}
        convName={convName}
        convAvatar={convAvatar}
        participants={conv?.participants ?? []}
        myId={myId}
        onViewProfile={userId => router.push(`/profile/${userId}` as any)}
        onConvUpdated={(name, avatar) => {
          setConv(prev => prev ? { ...prev, name, avatarUrl: avatar } : prev);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0a' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff08', alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 44,
    paddingBottom: 12, paddingHorizontal: 12,
    backgroundColor: '#0f0f0f',
    borderBottomWidth: 1, borderBottomColor: '#ffffff08', gap: 10,
  },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff08', alignItems: 'center', justifyContent: 'center' },
  headerAvatar:{ width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: '#1a1a1a', borderWidth: 1.5, borderColor: '#e3383530', alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#e33835', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' },
  headerInfo:     { flex: 1, gap: 3 },
  headerName:     { color: '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' },
  headerTyping:   { color: '#e33835', fontSize: 10, fontStyle: 'italic' },
  headerStatusRow:{ flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerStatusDot:{ width: 7, height: 7, borderRadius: 4 },
  headerStatus:   { color: '#ffffff35', fontSize: 10 },

  msgRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 1 },
  msgRowMe:    { justifyContent: 'flex-end',   paddingLeft:  48 },
  msgRowOther: { justifyContent: 'flex-start', paddingRight: 48 },

  avatarSlot: { width: 30, alignItems: 'center', justifyContent: 'flex-end' },
  msgAvatar:  { width: 28, height: 28, borderRadius: 14 },

  // Wrappery dla karty trasy
  routeWrapMe:    { alignItems: 'flex-end' },
  routeWrapOther: { alignItems: 'flex-start' },

  bubble:      { maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  bubbleMe:    { backgroundColor: '#e33835' },
  bubbleOther: { backgroundColor: '#1c1c1c', borderWidth: 1, borderColor: '#ffffff0a' },

  senderName: { color: '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginBottom: 2 },

  msgText:      { fontSize: 14, lineHeight: 20 },
  msgTextMe:    { color: '#fff' },
  msgTextOther: { color: '#ffffffcc' },

  msgTime:      { fontSize: 9, alignSelf: 'flex-end' },
  msgTimeMe:    { color: '#ffffff60' },
  msgTimeOther: { color: '#ffffff35' },

  replyPreview:     { backgroundColor: '#00000020', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: '#ffffff60', paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4, gap: 2 },
  replyPreviewMe:   { borderLeftColor: '#ffffff90' },
  replyPreviewName: { color: '#ffffffaa', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' },
  replyPreviewText: { color: '#ffffff70', fontSize: 11 },

  photosGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  msgPhoto:       { width: 120, height: 90,  borderRadius: 8 },
  msgPhotoSingle: { width: 200, height: 150, borderRadius: 12 },

  emptyMsg:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
  emptyMsgText: { color: '#ffffff20', fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' },
  emptyMsgSub:  { color: '#ffffff15', fontFamily: 'Orbitron', fontSize: 9 },

  bottomWrap: {
    backgroundColor: '#0f0f0f',
    borderTopWidth: 1, borderTopColor: '#ffffff08',
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
  },

  replyBar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ffffff08', gap: 10 },
  replyBarLine:  { width: 3, height: '100%', backgroundColor: '#e33835', borderRadius: 2 },
  replyBarName:  { color: '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginBottom: 2 },
  replyBarText:  { color: '#ffffff50', fontSize: 11 },
  replyBarClose: { padding: 4 },

  photosPreviewRow: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, gap: 8 },
  photoPreviewWrap: { position: 'relative' },
  photoPreview:     { width: 58, height: 58, borderRadius: 10 },
  photoRemoveBtn:   { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center' },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 10, gap: 8 },
  iconBtn:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, color: '#fff', fontSize: 14, lineHeight: 20,
    backgroundColor: '#1a1a1a', borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    borderWidth: 1, borderColor: '#ffffff0f',
  },
  sendBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: '#e3383530' },
});