import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, FlatList, TextInput, TouchableOpacity,
  Image, StatusBar, KeyboardAvoidingView,
  Platform, ActivityIndicator, Animated, Modal, Pressable,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { io, Socket } from 'socket.io-client';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { ConversationInfoSheet } from '../../../components/chat/ConversationInfoSheet';
import { RouteMessageCard } from '../../../components/chat/RouteMessageCard';
// @ts-ignore
import { LinkPreviewCard } from '../../../components/chat/LinkPreviewCard';

const API = 'https://v-room.app/api/chat';
const WS  = 'https://v-room.app';

const INPUT_MIN_HEIGHT = 40;
const INPUT_MAX_HEIGHT = 120;
const PAGE_SIZE        = 30;

const CHAT_THEMES = [
  { id: 'default', name: 'Domyślny', myBubble: '#e33835', theirBubble: null as string | null },
  { id: 'ocean',   name: 'Ocean',    myBubble: '#1a6fa8', theirBubble: '#163a52' },
  { id: 'forest',  name: 'Las',      myBubble: '#2a7a3b', theirBubble: '#1a3d23' },
  { id: 'sunset',  name: 'Zachód',   myBubble: '#c45e1a', theirBubble: '#3d2010' },
  { id: 'purple',  name: 'Fiolet',   myBubble: '#7c3aed', theirBubble: '#3b1a6e' },
  { id: 'gold',    name: 'Złoto',    myBubble: '#b8860b', theirBubble: '#3d2c05' },
];

const REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];

interface ChatUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
  online?:   boolean;
  isPremium?: boolean;
  nickColor?: string | null;
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
  reactions?: { emoji: string; count: number; myReaction: boolean }[];
}

interface ConvInfo {
  id:           number;
  isGroup:      boolean;
  name:         string;
  avatarUrl:    string | null;
  online:       boolean;
  participants: ChatUser[];
}

function parseRouteMessage(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type === 'route') return parsed;
  } catch {}
  return null;
}

function extractUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

export default function ChatScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const convId  = parseInt(id);
  const { theme, isDark } = useTheme();
  const insets  = useSafeAreaInsets();

  const [messages,    setMessages]    = useState<Message[]>([]);
  const [conv,        setConv]        = useState<ConvInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(true);
  const [nextCursor,  setNextCursor]  = useState<number | null>(null);
  const [text,        setText]        = useState('');
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const [photos,      setPhotos]      = useState<string[]>([]);
  const [replyTo,     setReplyTo]     = useState<Message | null>(null);
  const [myId,        setMyId]        = useState<number | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [infoVisible, setInfoVisible] = useState(false);
  const [menuMsg,     setMenuMsg]     = useState<Message | null>(null);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [chatThemeId, setChatThemeId] = useState('default');

  // Animacje wejścia
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const listRef          = useRef<FlatList>(null);
  const socketRef        = useRef<Socket | null>(null);
  const tokenRef         = useRef<string>('');
  const typingTimer      = useRef<any>(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    (async () => {
      const raw   = await AsyncStorage.getItem('user');
      const token = (await AsyncStorage.getItem('token')) ?? '';
      tokenRef.current = token;
      if (raw) setMyId(JSON.parse(raw).userId);

      const savedTheme = await AsyncStorage.getItem(`chat_theme_conv_${convId}`);
      if (savedTheme) setChatThemeId(savedTheme);

      const socket = io(WS, { auth: { token }, transports: ['websocket'] });
      socket.emit('chat:join', convId);

      socket.on('chat:message', (msg: Message) => {
        if (msg.conversationId === convId) {
          setMessages(prev => [...prev, msg]);
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
        }
      });

      // ✅ FIX: sprawdzamy czy username istnieje przed ustawieniem
      socket.on('chat:typing', ({ isTyping, username }: { isTyping: boolean; username?: string }) => {
        if (!username) return;
        setTypingUsers(prev => {
          const next = { ...prev };
          if (isTyping) next[username] = true;
          else delete next[username];
          return next;
        });
      });

      // ✅ FIX: nasłuchuj na aktualizacje online z socketa
      socket.on('user:online', ({ userId, online }: { userId: number; online: boolean }) => {
        setConv(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: prev.participants.map(p =>
              p.id === userId ? { ...p, online } : p
            ),
          };
        });
      });

      socketRef.current = socket;
      await Promise.all([fetchConv(token), fetchMessages(token)]);
    })();

    return () => {
      socketRef.current?.emit('chat:leave', convId);
      socketRef.current?.disconnect();
    };
  }, [convId]);

  const fetchConv = async (token: string) => {
    try {
      const r = await fetch(`${API}/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      setConv(data);
    } catch (e) { console.error('fetchConv:', e); }
  };

  const fetchMessages = async (token: string) => {
    setLoading(true);
    try {
      const r = await fetch(
        `${API}/conversations/${convId}/messages?limit=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d    = await r.json();
      const msgs = d.messages ?? [];
      setMessages(msgs);
      setNextCursor(d.nextCursor ?? null);
      setHasMore(!!d.nextCursor);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 120);
    } catch (e) { console.error('fetchMessages:', e); }
    finally { setLoading(false); }
  };

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `${API}/conversations/${convId}/messages?cursor=${nextCursor}&limit=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      const d    = await r.json();
      const msgs = d.messages ?? [];
      if (msgs.length === 0) { setHasMore(false); return; }
      setMessages(prev => [...msgs, ...prev]);
      setNextCursor(d.nextCursor ?? null);
      setHasMore(!!d.nextCursor);
    } catch (e) { console.error('loadMore:', e); }
    finally { setLoadingMore(false); }
  }, [convId, nextCursor, loadingMore, hasMore]);

  const handleSend = useCallback(async () => {
    if (!text.trim() && !photos.length) return;
    const t = text.trim();
    const p = [...photos];
    const reply = replyTo;
    setText(''); setPhotos([]); setReplyTo(null); setInputHeight(INPUT_MIN_HEIGHT);

    const form = new FormData();
    if (t)        form.append('content', t);
    if (reply?.id) form.append('replyToId', String(reply.id));
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

  const emitTyping = useCallback(() => {
    socketRef.current?.emit('chat:typing', { conversationId: convId, isTyping: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.emit('chat:typing', { conversationId: convId, isTyping: false });
    }, 2000);
  }, [convId]);

  const handlePickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, quality: 0.8,
    });
    if (!r.canceled) {
      setPhotos(prev => [...prev, ...r.assets.map(a => a.uri)].slice(0, 4));
    }
  };

  const handleReact = async (msgId: number, emoji: string) => {
    try {
      const res = await fetch(`${API}/conversations/${convId}/messages/${msgId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ emoji }),
      });
      if (!res.ok) Toast.show({ type: 'error', text1: 'Nie udało się dodać reakcji' });
    } catch { Toast.show({ type: 'error', text1: 'Brak połączenia' }); }
  };

  const handleNavigateRoute = useCallback(async (data: any) => {
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId: data.routeId, routeName: data.name,
      points: data.points, distance: data.distance,
    }));
    router.push('/(tabs)/map');
  }, [router]);

  const activeChatTheme = CHAT_THEMES.find(t => t.id === chatThemeId) ?? CHAT_THEMES[0];

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isMe    = item.senderId === myId;
    const prevMsg = messages[index - 1];
    const nextMsg = messages[index + 1];
    const isFirst = !prevMsg || prevMsg.senderId !== item.senderId;
    const isLast  = !nextMsg || nextMsg.senderId !== item.senderId;
    const showAvatar = !isMe && isLast;
    const showName   = !isMe && isFirst && (conv?.isGroup ?? false);

    const R = 18, T = 5;
    const bubbleRadius = isMe
      ? { borderTopLeftRadius: R, borderBottomLeftRadius: R, borderTopRightRadius: isFirst ? R : T, borderBottomRightRadius: isLast ? R : T }
      : { borderTopRightRadius: R, borderBottomRightRadius: R, borderTopLeftRadius: isFirst ? R : T, borderBottomLeftRadius: isLast ? R : T };

    const routeData = parseRouteMessage(item.content);
    const linkUrl   = !routeData ? extractUrl(item.content) : null;

    const myBubbleColor    = activeChatTheme.myBubble;
    const theirBubbleColor = activeChatTheme.theirBubble ?? theme.surface2;

    return (
      <View style={[
        { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 1, marginBottom: isLast ? 8 : 2 },
        isMe
          ? { justifyContent: 'flex-end', paddingLeft: 48 }
          : { justifyContent: 'flex-start', paddingRight: 48 },
      ]}>
        {!isMe && (
          <View style={{ width: 30, alignItems: 'center', justifyContent: 'flex-end' }}>
            {showAvatar && (
              item.sender.avatarUrl
                ? <Image source={{ uri: item.sender.avatarUrl }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                : (
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.surface2, borderWidth: 1.5, borderColor: '#e3383540', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                      {item.sender.username?.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )
            )}
          </View>
        )}

        {routeData ? (
          <View style={isMe ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }}>
            {showName && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <Text style={{ color: item.sender.nickColor || '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                  {item.sender.username}
                </Text>
                {item.sender.isPremium && (
                  <View style={{ backgroundColor: '#FFD7001f', borderRadius: 8, borderWidth: 1, borderColor: '#FFD70045', paddingHorizontal: 6, paddingVertical: 1 }}>
                    <Text style={{ color: '#FFD700', fontFamily: 'Orbitron', fontSize: 7 }}>PREMIUM</Text>
                  </View>
                )}
              </View>
            )}
            <RouteMessageCard data={routeData} isMe={isMe} onNavigate={handleNavigateRoute} />
            <Text style={{ fontSize: 9, alignSelf: 'flex-end', marginTop: 2, color: isDark ? '#ffffff40' : '#00000040' }}>
              {new Date(item.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        ) : (
          <View style={{ alignItems: isMe ? 'flex-end' : 'flex-start' }}>
            <TouchableOpacity
              style={[{
                maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, gap: 4,
                ...(isMe
                  ? { backgroundColor: myBubbleColor }
                  : { backgroundColor: theirBubbleColor, borderWidth: 1, borderColor: theme.border }),
              }, bubbleRadius]}
              onLongPress={() => setMenuMsg(item)}
              activeOpacity={0.85}
            >
              {showName && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <Text style={{ color: item.sender.nickColor || '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                    {item.sender.username}
                  </Text>
                  {item.sender.isPremium && (
                    <View style={{ backgroundColor: '#FFD7001f', borderRadius: 8, borderWidth: 1, borderColor: '#FFD70045', paddingHorizontal: 6, paddingVertical: 1 }}>
                      <Text style={{ color: '#FFD700', fontFamily: 'Orbitron', fontSize: 7 }}>PREMIUM</Text>
                    </View>
                  )}
                </View>
              )}

              {item.replyTo && (
                <View style={{ backgroundColor: '#00000020', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: isMe ? '#ffffff90' : '#e3383560', paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4, gap: 2 }}>
                  <Text style={{ color: isMe ? '#ffffffaa' : '#e33835aa', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>
                    {item.replyTo.sender.username}
                  </Text>
                  <Text style={{ color: isMe ? '#ffffff70' : theme.textDim, fontSize: 11 }} numberOfLines={1}>
                    {item.replyTo.content || '📷 Zdjęcie'}
                  </Text>
                </View>
              )}

              {item.photos?.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {item.photos.map((uri, i) => (
                    <Image
                      key={i} source={{ uri }}
                      style={item.photos.length === 1
                        ? { width: 200, height: 150, borderRadius: 12 }
                        : { width: 120, height: 90, borderRadius: 8 }}
                    />
                  ))}
                </View>
              )}

              {!!item.content && (
                <Text style={{ fontSize: 14, lineHeight: 20, color: isMe ? '#fff' : theme.textMuted }}>
                  {item.content}
                </Text>
              )}

              {!!linkUrl && <LinkPreviewCard url={linkUrl} isMe={isMe} theme={theme} />}

              <Text style={{ fontSize: 9, alignSelf: 'flex-end', color: isMe ? '#ffffff60' : theme.textDim }}>
                {new Date(item.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </TouchableOpacity>

            {item.reactions && item.reactions.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, paddingHorizontal: 2 }}>
                {item.reactions.map(r => (
                  <TouchableOpacity
                    key={r.emoji}
                    onPress={() => handleReact(item.id, r.emoji)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 3,
                      backgroundColor: r.myReaction ? '#e3383530' : theme.surface2,
                      borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3,
                      borderWidth: 1, borderColor: r.myReaction ? '#e33835' : theme.border,
                    }}
                  >
                    <Text style={{ fontSize: 12 }}>{r.emoji}</Text>
                    <Text style={{ fontSize: 10, color: r.myReaction ? '#e33835' : theme.textDim, fontFamily: 'Orbitron', fontWeight: '700' }}>{r.count}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    );
  }, [myId, messages, conv, handleNavigateRoute, theme, isDark, activeChatTheme]);

  // ── Derived values ─────────────────────────────────────
  // ✅ FIX: bezpieczne odczytanie danych rozmówcy
  const otherParticipant = conv?.participants?.find(p => p.id !== myId);
  const convName   = conv?.isGroup ? conv.name   : (otherParticipant?.username  ?? '...');
  const convAvatar = conv?.isGroup ? conv.avatarUrl : (otherParticipant?.avatarUrl ?? null);
  // ✅ FIX: online pobieramy z participants (aktualizowanych przez socket), nie z conv.online
  const convOnline = !conv?.isGroup ? (otherParticipant?.online ?? false) : false;

  // ✅ FIX: typing text z Record – nigdy nie będzie "undefined pisze..."
  const typingNames = Object.keys(typingUsers).filter(u => u !== convName || conv?.isGroup);
  const typingText  = typingNames.length === 1
    ? `${typingNames[0]} pisze...`
    : typingNames.length > 1
    ? `${typingNames.slice(0, 2).join(', ')} piszą...`
    : null;

  const HEADER_HEIGHT = (Platform.OS === 'ios' ? 56 : 44) + 12 + insets.top;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      {/* ══════════════════════ HEADER ══════════════════════ */}
      <View style={{
        paddingTop: insets.top + 10,
        paddingBottom: 0,
        backgroundColor: theme.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}>
        {/* Subtelny gradient na górze headera */}
        <LinearGradient
          colors={isDark ? ['#1a0404', theme.surface] : ['#fce8e8', theme.surface]}
          style={{ ...StyleSheet_absoluteFill_hack, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          pointerEvents="none"
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
          {/* Przycisk wstecz */}
          <TouchableOpacity
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={18} color={theme.text} />
          </TouchableOpacity>

          {/* Avatar + nazwa */}
          <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => setInfoVisible(true)} activeOpacity={0.75}>
            {/* Avatar */}
            <View style={{ position: 'relative' }}>
              {convAvatar
                ? <Image source={{ uri: convAvatar }} style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#e3383540' }} />
                : (
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#e3383515', borderWidth: 2, borderColor: '#e3383540', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900' }}>
                      {convName?.slice(0, 2).toUpperCase() ?? '??'}
                    </Text>
                  </View>
                )
              }
              {/* Online dot na avatarze */}
              {!conv?.isGroup && (
                <View style={{
                  position: 'absolute', bottom: 0, right: 0,
                  width: 11, height: 11, borderRadius: 6,
                  backgroundColor: convOnline ? '#4de926' : (isDark ? '#444' : '#ccc'),
                  borderWidth: 2, borderColor: theme.surface,
                }} />
              )}
            </View>

            {/* Tekst */}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                {convName}
              </Text>
              {typingText
                ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialCommunityIcons name="dots-horizontal" size={14} color="#e33835" />
                    <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 8, fontStyle: 'italic' }}>{typingText}</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: convOnline ? '#4de926' : (isDark ? '#444' : '#ccc') }} />
                    <Text style={{ color: convOnline ? '#4de926' : theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>
                      {convOnline ? 'ONLINE' : 'OFFLINE'}
                    </Text>
                  </View>
                )
              }
            </View>
          </TouchableOpacity>

          {/* Info button */}
          <TouchableOpacity
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => setThemePickerOpen(true)}
          >
            <MaterialCommunityIcons name="palette" size={17} color={theme.textDim} />
          </TouchableOpacity>
          <TouchableOpacity
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => setInfoVisible(true)}
          >
            <Feather name="info" size={17} color={theme.textDim} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ══════════════════ LISTA + INPUT ═══════════════════ */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? HEADER_HEIGHT : 0}
      >
        {/* WIADOMOŚCI */}
        {loading
          ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <MaterialCommunityIcons name="car-sports" size={36} color="#e3383560" />
              <ActivityIndicator color="#e33835" />
            </View>
          ) : (
            <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={i => String(i.id)}
                renderItem={renderMessage}
                ListHeaderComponent={
                  hasMore ? (
                    loadingMore
                      ? <ActivityIndicator color="#e33835" style={{ marginVertical: 14 }} />
                      : (
                        <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={loadMore}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#e3383515', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: '#e3383530' }}>
                            <MaterialIcons name="keyboard-arrow-up" size={14} color="#e33835" />
                            <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>ZAŁADUJ STARSZE</Text>
                          </View>
                        </TouchableOpacity>
                      )
                  ) : (
                    messages.length > 0
                      ? (
                        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 2 }}>POCZĄTEK ROZMOWY</Text>
                            <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                          </View>
                        </View>
                      ) : null
                  )
                }
                ListEmptyComponent={
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 }}>
                    <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#e3383510', borderWidth: 1, borderColor: '#e3383525', alignItems: 'center', justifyContent: 'center' }}>
                      <MaterialCommunityIcons name="chat-outline" size={32} color="#e3383560" />
                    </View>
                    <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' }}>Brak wiadomości</Text>
                    <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>Napisz pierwszą wiadomość!</Text>
                  </View>
                }
                contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, flexGrow: 1 }}
                keyboardShouldPersistTaps="handled"
                maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 10 }}
              />
            </Animated.View>
          )
        }

        {/* ══════════════════════ INPUT ═══════════════════════ */}
        <View style={{
          backgroundColor: theme.surface,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 16) : Math.max(insets.bottom, 10),
        }}>

          {/* Reply preview */}
          {replyTo && (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10 }}>
              <View style={{ width: 3, borderRadius: 2, alignSelf: 'stretch', backgroundColor: '#e33835' }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginBottom: 2 }}>
                  {replyTo.sender.username}
                </Text>
                <Text style={{ color: theme.textDim, fontSize: 11 }} numberOfLines={1}>
                  {replyTo.content || '📷 Zdjęcie'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="x" size={12} color={theme.textDim} />
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* Podgląd zdjęć */}
          {photos.length > 0 && (
            <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, gap: 8 }}>
              {photos.map((uri, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Image source={{ uri }} style={{ width: 58, height: 58, borderRadius: 10, borderWidth: 1, borderColor: theme.border }} />
                  <TouchableOpacity
                    style={{ position: 'absolute', top: -5, right: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.surface }}
                    onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  >
                    <Feather name="x" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Input row */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 10, gap: 8 }}>
            <TouchableOpacity
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
              onPress={handlePickPhoto}
            >
              <Feather name="image" size={18} color={theme.textDim} />
            </TouchableOpacity>

            <TextInput
              style={{
                flex: 1, color: theme.text, fontSize: 14, lineHeight: 20,
                backgroundColor: theme.surface2, borderRadius: 20,
                paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
                borderWidth: 1, borderColor: theme.border,
                height: Math.max(INPUT_MIN_HEIGHT, inputHeight),
              }}
              value={text}
              onChangeText={t => { setText(t); emitTyping(); }}
              onContentSizeChange={e => {
                const h = e.nativeEvent.contentSize.height;
                setInputHeight(Math.min(h, INPUT_MAX_HEIGHT));
              }}
              placeholder="Napisz wiadomość..."
              placeholderTextColor={theme.textDim}
              multiline maxLength={2000}
              scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
            />

            <TouchableOpacity
              style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: (text.trim() || photos.length) ? '#e33835' : '#e3383530',
                alignItems: 'center', justifyContent: 'center',
              }}
              onPress={handleSend}
              disabled={!text.trim() && !photos.length}
            >
              <Feather name="send" size={17} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

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
        onConvUpdated={(name, avatar) => setConv(prev => prev ? { ...prev, name, avatarUrl: avatar } : prev)}
      />

      {/* Context menu for message long-press */}
      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setMenuMsg(null)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: insets.bottom + 16, borderTopWidth: 1, borderColor: theme.border2 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 16 }} />

              {/* Emoji reaction row */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 4 }}>
                {REACTION_EMOJIS.map(emoji => (
                  <TouchableOpacity key={emoji} onPress={() => { if (menuMsg) handleReact(menuMsg.id, emoji); setMenuMsg(null); }}
                    style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 22 }}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Reply action */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 }}
                onPress={() => { if (menuMsg) setReplyTo(menuMsg); setMenuMsg(null); }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="reply" size={18} color={theme.primary} />
                </View>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', color: theme.text }}>Odpowiedz</Text>
              </TouchableOpacity>

              {/* Copy action */}
              {!!menuMsg?.content && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 }}
                  onPress={() => {
                    try { require('@react-native-clipboard/clipboard').default.setString(menuMsg?.content ?? ''); } catch {}
                    setMenuMsg(null);
                  }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialIcons name="content-copy" size={18} color={theme.textDim} />
                  </View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', color: theme.text }}>Kopiuj</Text>
                </TouchableOpacity>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Chat theme picker */}
      <Modal visible={themePickerOpen} transparent animationType="slide" onRequestClose={() => setThemePickerOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setThemePickerOpen(false)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, borderTopWidth: 1, borderColor: theme.border2 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 16 }} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, marginBottom: 20 }}>MOTYW CZATU</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                {CHAT_THEMES.map(t => (
                  <TouchableOpacity key={t.id} onPress={async () => { setChatThemeId(t.id); await AsyncStorage.setItem(`chat_theme_conv_${convId}`, t.id); setThemePickerOpen(false); }} style={{ alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.myBubble, borderWidth: 2, borderColor: chatThemeId === t.id ? '#fff' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {chatThemeId === t.id && <MaterialIcons name="check" size={18} color="#fff" />}
                    </View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>{t.name.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// helper zamiast StyleSheet.absoluteFill (działa inline)
const StyleSheet_absoluteFill_hack = {
  position: 'absolute' as const,
  top: 0, left: 0, right: 0, bottom: 0,
};