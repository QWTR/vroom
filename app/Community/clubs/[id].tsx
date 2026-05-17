import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  Image, ActivityIndicator, KeyboardAvoidingView,
  Platform, Modal, Pressable, ScrollView, Dimensions, Alert, Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather }                from '@expo/vector-icons';
import MaterialIcons              from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons     from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker           from 'expo-image-picker';
import { LinearGradient }         from 'expo-linear-gradient';
import AsyncStorage               from '@react-native-async-storage/async-storage';
import { io, Socket }             from 'socket.io-client';
import Toast                      from 'react-native-toast-message';
import { useTheme }               from '../../../contexts/ThemeContext';
import { API_URL, SOCKET_URL }    from '../../../constants/config';
import { UAv }                    from '../../../components/clubs/ClubCard';
import { Club }                   from '../../../components/clubs/types';
import EditClubModal              from '../../../components/clubs/EditClubModal';
import { renderDiscussionBody }   from '../community/communityShared';
import { reportContent, showBlockUserAlert, showReportContentAlert } from '../../../lib/ugcActions';
import { useChatKeyboard, scrollChatToEndAfterLayout } from '../../../hooks/useChatKeyboard';

const WS_URL   = SOCKET_URL;
const getToken = async () => (
  (await AsyncStorage.getItem('userToken'))
  ?? (await AsyncStorage.getItem('token'))
);
const PAGE     = 30;

const CHAT_THEMES = [
  { id: 'default', name: 'Domyślny', myBubble: '#e33835', theirBubble: null as string | null },
  { id: 'ocean',   name: 'Ocean',    myBubble: '#1a6fa8', theirBubble: '#163a52' },
  { id: 'forest',  name: 'Las',      myBubble: '#2a7a3b', theirBubble: '#1a3d23' },
  { id: 'sunset',  name: 'Zachód',   myBubble: '#c45e1a', theirBubble: '#3d2010' },
  { id: 'purple',  name: 'Fiolet',   myBubble: '#7c3aed', theirBubble: '#3b1a6e' },
  { id: 'gold',    name: 'Złoto',    myBubble: '#b8860b', theirBubble: '#3d2c05' },
];

const REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];

function normalizePhotoUri(uri: string): string {
  if (!uri) return uri;
  if (/^https?:\/\//i.test(uri) || /^file:\/\//i.test(uri) || /^content:\/\//i.test(uri)) return uri;
  return `${API_URL}${uri.startsWith('/') ? uri : `/${uri}`}`;
}

interface ClubMessage {
  id:        number;
  clubId:    number;
  channelId: number | null;
  senderId:  number;
  content:   string | null;
  photos:    string[];
  createdAt: string;
  isPinned:  boolean;
  pinnedAt:  string | null;
  sender:  { id: number; username: string; avatarUrl: string | null };
  replyTo: { id: number; content: string | null; sender: { id: number; username: string } } | null;
  reactions?: { emoji: string; count: number; myReaction: boolean }[];
}

// ── Context Menu ──────────────────────────────────────────
function MessageMenu({
  visible, message, isMe, canPin, canDelete,
  onReact, onReply, onPin, onDelete, onReport, onBlock, onClose,
}: {
  visible:   boolean;
  message:   ClubMessage | null;
  isMe:      boolean;
  canPin:    boolean;
  canDelete: boolean;
  onReact:   (emoji: string) => void;
  onReply:   () => void;
  onPin:     () => void;
  onDelete:  () => void;
  onReport?: () => void;
  onBlock?:  () => void;
  onClose:   () => void;
}) {
  const { theme } = useTheme();
  const insets    = useSafeAreaInsets();
  if (!message) return null;

  const actions = [
    { icon: 'reply', label: 'Odpowiedz', color: undefined as string | undefined,
      onPress: () => { onReply(); onClose(); } },
    ...(canPin ? [{
      icon: 'push-pin', label: message.isPinned ? 'Odepnij' : 'Przypnij',
      color: '#FFD700', onPress: () => { onPin(); onClose(); },
    }] : []),
    ...((isMe || canDelete) ? [{
      icon: 'delete-outline', label: 'Usuń', color: '#e33835',
      onPress: () => { onDelete(); onClose(); },
    }] : []),
    ...(!isMe && onReport ? [{
      icon: 'flag', label: 'Zgłoś treść', color: '#FF9800',
      onPress: () => { onReport(); onClose(); },
    }] : []),
    ...(!isMe && onBlock ? [{
      icon: 'block', label: 'Zablokuj użytkownika', color: '#e33835',
      onPress: () => { onBlock(); onClose(); },
    }] : []),
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={e => e.stopPropagation()}>
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingTop: 12, paddingBottom: insets.bottom + 16,
            borderTopWidth: 1, borderColor: theme.border2,
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 16 }} />

            {/* Emoji reaction row */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 4 }}>
              {REACTION_EMOJIS.map(emoji => (
                <TouchableOpacity key={emoji} onPress={() => { onReact(emoji); onClose(); }}
                  style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 22 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>

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
                <Text style={{ fontSize: 12 }} numberOfLines={3}>
                  {message.content
                    ? renderDiscussionBody(message.content, theme, { textColor: theme.textDim })
                    : '📷 Zdjęcie'}
                </Text>
              </View>
              {message.isPinned && <MaterialIcons name="push-pin" size={14} color="#FFD700" />}
            </View>

            <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 8 }} />

            {actions.map((a, i) => (
              <TouchableOpacity
                key={i}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 }}
                onPress={a.onPress}
                activeOpacity={0.7}
              >
                <View style={{
                  width: 36, height: 36, borderRadius: 10,
                  backgroundColor: (a.color ?? theme.primary) + '18',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialIcons name={a.icon as any} size={18} color={a.color ?? theme.primary} />
                </View>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', color: a.color ?? theme.text }}>
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

// ── Main Screen ───────────────────────────────────────────
export default function ClubChatScreen() {
  const { id, channelId } = useLocalSearchParams<{ id: string; channelId?: string }>();
  const clubId            = parseInt(String(id), 10);
  const initialChannelId  = channelId ? parseInt(String(channelId), 10) : NaN;
  const router            = useRouter();
  const { theme, isDark } = useTheme();
  const insets            = useSafeAreaInsets();

  const [clubName,    setClubName]    = useState('');
  const [clubData,    setClubData]    = useState<Club | null>(null);
  const [categories,  setCategories]  = useState<any[]>([]);
  const [channels,    setChannels]    = useState<any[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [photos,      setPhotos]      = useState<string[]>([]);
  const [replyTo,     setReplyTo]     = useState<ClubMessage | null>(null);
  const [sending,     setSending]     = useState(false);
  const [showPinned,  setShowPinned]  = useState(false);
  const [menuMsg,     setMenuMsg]     = useState<ClubMessage | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const [shareText, setShareText] = useState('');
  const [sharing, setSharing] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [chatThemeId, setChatThemeId] = useState('default');
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<'channels' | 'chat' | 'members'>('chat');
  const paneRef = useRef<ScrollView>(null);
  const [memberModal, setMemberModal] = useState<any | null>(null);
  const [pushMuteBusy, setPushMuteBusy] = useState(false);
  const tabSlide = useRef(new Animated.Value(Dimensions.get('window').width / 3)).current;
  const tabHapticSkip = useRef(true);

  const listRef   = useRef<FlatList>(null);
  const { listPaddingBottom: chatListPad, inputPaddingBottom: chatInputPad } = useChatKeyboard(listRef);
  const socketRef = useRef<Socket | null>(null);
  const tokenRef  = useRef('');
  const activeChannelIdRef = useRef<number | null>(null);
  activeChannelIdRef.current = activeChannelId;

  useEffect(() => {
    const seg = Dimensions.get('window').width / 3;
    const tabBarIdx = activePane === 'channels' ? 0 : activePane === 'chat' ? 1 : 2;
    Animated.spring(tabSlide, {
      toValue: tabBarIdx * seg,
      useNativeDriver: true,
      stiffness: 320,
      damping: 28,
      mass: 0.75,
    }).start();
    if (tabHapticSkip.current) {
      tabHapticSkip.current = false;
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [activePane]);

  // ── Init ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const token = await getToken() ?? '';
      tokenRef.current = token;

      const raw = await AsyncStorage.getItem('user');
      if (raw) setMyId(JSON.parse(raw).userId);

      const clubRes = await fetch(`${API_URL}/api/clubs/${clubId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (clubRes.ok) {
        const club = await clubRes.json();
        setClubName(club.name);
        setMyRole(club.myRole);
        setMyRank(club.myRank);
        setClubData(club);
      }

      const savedTheme = await AsyncStorage.getItem(`chat_theme_club_${clubId}`);
      if (savedTheme) setChatThemeId(savedTheme);

      const structRes = await fetch(`${API_URL}/api/clubs/${clubId}/structure`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (structRes.ok) {
        const s = await structRes.json();
        setCategories(s.categories ?? []);
        setChannels(s.channels ?? []);
        const general = (s.channels ?? []).find((c: any) => c.isDefaultGeneral) ?? (s.channels ?? [])[0];
        const hasInitial = Number.isFinite(initialChannelId) && (s.channels ?? []).some((c: any) => c.id === initialChannelId);
        setActiveChannelId(hasInitial ? initialChannelId : (general?.id ?? null));
      }

      const socket = io(WS_URL, { auth: { token }, transports: ['websocket'] });
      socket.emit('club:join', clubId);
      socket.on('club:message', (msg: ClubMessage) => {
        if (msg.clubId === clubId && activeChannelIdRef.current != null && msg.channelId === activeChannelIdRef.current) {
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
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
      socket.on('club:reaction', ({ messageId, reactions }: { messageId: number; reactions: any[] }) => {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
        setPinned(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
      });
      socketRef.current = socket;

      await loadMessages(token, undefined, activeChannelIdRef.current ?? undefined);
    })();

    return () => {
      socketRef.current?.emit('club:leave', clubId);
      socketRef.current?.disconnect();
    };
  }, [clubId, initialChannelId]);

  const loadMessages = async (token: string, cur?: number, channelIdArg?: number) => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (cur) params.append('cursor', String(cur));
      const channelIdToUse = channelIdArg ?? activeChannelIdRef.current;
      if (channelIdToUse) params.append('channelId', String(channelIdToUse));
      const res  = await fetch(`${API_URL}/api/clubs/${clubId}/messages?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let msg = `Błąd pobierania (${res.status})`;
        try {
          const err = await res.json();
          if (typeof err?.error === 'string' && err.error.length > 0) msg = err.error;
        } catch {
        }
        Toast.show({ type: 'error', text1: 'Czat chwilowo niedostępny', text2: msg });
        return;
      }
      const data = await res.json();
      if (cur) setMessages(prev => [...(data.messages ?? []), ...prev]);
      else     setMessages(data.messages ?? []);
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
      setPinned(data.pinned ?? []);
      if (!cur) scrollChatToEndAfterLayout(listRef, false);
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  };

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || !hasMore) return;
    setLoadingMore(true);
    loadMessages(tokenRef.current, cursor, activeChannelId ?? undefined);
  }, [cursor, loadingMore, hasMore, activeChannelId]);

  useEffect(() => {
    if (!activeChannelId || !tokenRef.current) return;
    setLoading(true);
    setMessages([]);
    setPinned([]);
    setCursor(null);
    setHasMore(true);
    loadMessages(tokenRef.current, undefined, activeChannelId);
  }, [activeChannelId]);

  const handleSend = useCallback(async () => {
    if (!text.trim() && !photos.length) return;
    const t = text.trim();
    const p = [...photos];
    const r = replyTo;
    const prevText = text;
    const prevPhotos = [...photos];
    const prevReply = replyTo;
    setText('');
    setPhotos([]);
    setReplyTo(null);
    setSending(true);
    try {
      if (!activeChannelId) {
        setText(prevText);
        setPhotos(prevPhotos);
        setReplyTo(prevReply);
        return;
      }
      const form = new FormData();
      if (t) form.append('content', t);
      if (r) form.append('replyToId', String(r.id));
      form.append('channelId', String(activeChannelId));
      p.forEach((uri, i) => form.append('photos', { uri, type: 'image/jpeg', name: `p${i}.jpg` } as any));
      const res = await fetch(`${API_URL}/api/clubs/${clubId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Toast.show({
          type: 'error',
          text1: 'Nie wysłano wiadomości',
          text2: (err as { error?: string }).error ?? 'Spróbuj ponownie.',
        });
        setText(prevText);
        setPhotos(prevPhotos);
        setReplyTo(prevReply);
        return;
      }
      const msg: ClubMessage = await res.json();
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } catch {
      Toast.show({ type: 'error', text1: 'Brak połączenia' });
      setText(prevText);
      setPhotos(prevPhotos);
      setReplyTo(prevReply);
    } finally { setSending(false); }
  }, [text, photos, replyTo, clubId, activeChannelId]);

  const handlePickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, quality: 0.8,
    });
    if (!r.canceled) setPhotos(prev => [...prev, ...r.assets.map(a => a.uri)].slice(0, 4));
  };

  const handlePin = async (msgId: number, isPinned: boolean) => {
    const method = isPinned ? 'DELETE' : 'POST';
    await fetch(`${API_URL}/api/clubs/${clubId}/messages/${msgId}/pin`, {
      method, headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isPinned: !isPinned } : m));
  };

  const handleDelete = async (msgId: number) => {
    setMessages(prev => prev.filter(m => m.id !== msgId));
    setPinned(prev => prev.filter(m => m.id !== msgId));
    await fetch(`${API_URL}/api/clubs/${clubId}/messages/${msgId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
  };

  const handleReact = async (msgId: number, emoji: string) => {
    try {
      const msg = messages.find(m => m.id === msgId);
      const hasMine = !!msg?.reactions?.find(r => r.emoji === emoji)?.myReaction;
      const endpoint = hasMine
        ? `${API_URL}/api/clubs/${clubId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`
        : `${API_URL}/api/clubs/${clubId}/messages/${msgId}/reactions`;
      const res = await fetch(endpoint, {
        method: hasMine ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        ...(hasMine ? {} : { body: JSON.stringify({ emoji }) }),
      });
      if (!res.ok) Toast.show({ type: 'error', text1: 'Nie udało się dodać reakcji' });
    } catch { Toast.show({ type: 'error', text1: 'Brak połączenia' }); }
  };

  const canPin    = myRole === 'owner' || !!myRank?.canPin;
  const canKick   = myRole === 'owner' || !!myRank?.canKick;
  const canManage = myRole === 'owner' || !!myRank?.canManage;
  const mentionSuggestions = (clubData?.members ?? [])
    .filter((m: any) => mentionQuery && m.username.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 6);

  const activeChatTheme = CHAT_THEMES.find(t => t.id === chatThemeId) ?? CHAT_THEMES[0];

  // ── Render message ────────────────────────────────────────
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

    const myBubbleColor    = activeChatTheme.myBubble;
    const theirBubbleColor = activeChatTheme.theirBubble ?? theme.surface2;

    return (
      <View style={[
        { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 1, marginBottom: isLast ? 8 : 2 },
        isMe ? { justifyContent: 'flex-end', paddingLeft: 48 } : { justifyContent: 'flex-start', paddingRight: 48 },
      ]}>
        {!isMe && (
          <View style={{ width: 30, alignItems: 'center', justifyContent: 'flex-end' }}>
            {isLast && <UAv uri={item.sender.avatarUrl} name={item.sender.username} size={28} />}
          </View>
        )}

        <View style={{ alignItems: isMe ? 'flex-end' : 'flex-start' }}>
          <TouchableOpacity
            style={[{
              maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, gap: 4,
              ...(isMe
                ? { backgroundColor: myBubbleColor }
                : { backgroundColor: theirBubbleColor, borderWidth: 1, borderColor: theme.border }),
            }, bubbleStyle]}
            onLongPress={() => setMenuMsg(item)}
            delayLongPress={350}
            activeOpacity={0.85}
          >
            {!isMe && isFirst && (
              <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginBottom: 2 }}>
                {item.sender.username}
              </Text>
            )}
            {item.isPinned && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 2 }}>
                <MaterialIcons name="push-pin" size={9} color="#FFD700" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#FFD700' }}>PRZYPIĘTA</Text>
              </View>
            )}
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
            {item.photos?.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {item.photos.map((uri, i) => (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.85}
                    onPress={() => setPreviewPhoto(normalizePhotoUri(uri))}
                  >
                    <Image source={{ uri: normalizePhotoUri(uri) }}
                      style={item.photos.length === 1
                        ? { width: 200, height: 150, borderRadius: 12 }
                        : { width: 120, height: 90,  borderRadius: 8 }}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {!!item.content && (
              <Text style={{ fontSize: 14, lineHeight: 20 }}>
                {renderDiscussionBody(
                  item.content,
                  theme,
                  isMe
                    ? {
                        textColor: '#ffffff',
                        mentionColor: '#b8e8ff',
                        linkColor: '#9fd4ff',
                        onMentionPress: (username) => {
                          const member = (clubData?.members ?? []).find(
                            (m: any) => m.username?.toLowerCase() === username.toLowerCase(),
                          );
                          if (member?.userId) {
                            router.push({ pathname: '/profile/[userId]', params: { userId: String(member.userId) } });
                          }
                        },
                      }
                    : {
                        textColor: theme.textMuted,
                        mentionColor: '#4a9eff',
                        onMentionPress: (username) => {
                          const member = (clubData?.members ?? []).find(
                            (m: any) => m.username?.toLowerCase() === username.toLowerCase(),
                          );
                          if (member?.userId) {
                            router.push({ pathname: '/profile/[userId]', params: { userId: String(member.userId) } });
                          }
                        },
                      },
                )}
              </Text>
            )}
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
                    backgroundColor: r.myReaction ? `${theme.primary}30` : theme.surface2,
                    borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3,
                    borderWidth: 1, borderColor: r.myReaction ? theme.primary : theme.border,
                  }}
                >
                  <Text style={{ fontSize: 12 }}>{r.emoji}</Text>
                  <Text style={{ fontSize: 10, color: r.myReaction ? theme.primary : theme.textDim, fontFamily: 'Orbitron', fontWeight: '700' }}>{r.count}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }, [myId, messages, theme, activeChatTheme]);

  const canDeleteMenu = menuMsg ? (menuMsg.senderId === myId || canKick) : false;

  // ── Render ────────────────────────────────────────────────
  const HEADER_HEIGHT = (Platform.OS === 'ios' ? 56 : 44) + 12 + insets.top;
  const SCREEN_W = Dimensions.get('window').width;
  const TAB_SEG_W = SCREEN_W / 3;
  const sidebarBg = isDark ? '#1b1c1f' : theme.surface2;
  const members = clubData?.members ?? [];
  const ownerGroup = members.filter((m: any) => m.role === 'owner');
  const rankedGroup = members.filter((m: any) => m.role !== 'owner' && !!m.rank);
  const memberGroup = members.filter((m: any) => m.role !== 'owner' && !m.rank);
  const rankSections: any[] = Object.values(
    rankedGroup.reduce((acc: any, m: any) => {
      const key = m.rank?.name ?? 'Ranga';
      if (!acc[key]) acc[key] = { title: key.toUpperCase(), data: [] };
      acc[key].data.push(m);
      return acc;
    }, {}),
  );
  const categorySections = [...categories]
    .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
    .map((c: any) => ({
      ...c,
      channels: channels.filter((ch: any) => ch.categoryId === c.id).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)),
    }));

  const refreshClub = async () => {
    const token = await getToken() ?? '';
    const r = await fetch(`${API_URL}/api/clubs/${clubId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const c = await r.json();
      setClubData(c);
      setChannels(c.channels ?? []);
      setCategories(c.categories ?? []);
    }
  };

  const openMemberActions = (m: any) => setMemberModal(m);

  const assignRank = async (rankId: number | null) => {
    if (!memberModal) return;
    const token = await getToken() ?? '';
    await fetch(`${API_URL}/api/clubs/${clubId}/members/${memberModal.userId}/rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rankId }),
    });
    await refreshClub();
  };

  const toggleMute = async () => {
    if (!memberModal) return;
    const token = await getToken() ?? '';
    const isMuted = !!memberModal.isMuted;
    const endpoint = isMuted ? 'unmute' : 'mute';
    await fetch(`${API_URL}/api/clubs/${clubId}/members/${memberModal.userId}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(isMuted ? {} : { body: JSON.stringify({ durationMinutes: 60 }) }),
    });
    await refreshClub();
  };

  const kickMember = async () => {
    if (!memberModal) return;
    const token = await getToken() ?? '';
    await fetch(`${API_URL}/api/clubs/${clubId}/members/${memberModal.userId}/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason: 'Moderacja klubu' }),
    });
    setMemberModal(null);
    await refreshClub();
  };

  const toggleClubPushMute = async () => {
    if (!clubData || pushMuteBusy) return;
    setPushMuteBusy(true);
    try {
      const token = await getToken() ?? '';
      const next = !clubData.myClubPushMuted;
      const res = await fetch(`${API_URL}/api/clubs/${clubId}/push-mute`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ muted: next }),
      });
      if (res.ok) {
        setClubData({ ...clubData, myClubPushMuted: next });
        Toast.show({
          type: 'success',
          text1: next ? 'Powiadomienia z czatu wyciszone' : 'Powiadomienia z czatu włączone',
        });
      } else {
        Toast.show({ type: 'error', text1: 'Nie udało się zmienić ustawień' });
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setPushMuteBusy(false);
    }
  };

  const shareClubToDiscussions = async () => {
    if (sharing || !clubData) return;
    setSharing(true);
    try {
      const token = await getToken() ?? '';
      const trimmedMessage = shareText.trim();
      const payload = {
        type: 'clubInvite',
        clubId: clubData.id,
        clubName: clubData.name,
        memberCount: clubData.memberCount ?? 0,
        ...(trimmedMessage ? { message: trimmedMessage } : {}),
      };
      const form = new FormData();
      form.append('content', JSON.stringify(payload));
      const res = await fetch(`${API_URL}/api/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error('share-failed');
      Toast.show({ type: 'success', text1: 'Zaproszenie opublikowane w dyskusjach' });
      setShareVisible(false);
      setShareText('');
    } catch {
      Toast.show({ type: 'error', text1: 'Nie udało się udostępnić klubu' });
    } finally {
      setSharing(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? HEADER_HEIGHT : 0}
        enabled={Platform.OS === 'ios'}
      >
        {/* HEADER */}
        <LinearGradient
          colors={isDark ? ['#180707', '#0f1013', theme.surface] : ['#faecec', '#f4f5f8', theme.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 8 }}
        >
          <View style={{ position: 'absolute', right: -30, top: -22, width: 120, height: 120, borderRadius: 60, backgroundColor: '#e3383520' }} />
          <View style={{ position: 'absolute', left: -40, bottom: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: isDark ? '#ffffff08' : '#00000005' }} />

          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 12, paddingVertical: 10, gap: 10,
          }}>
            <TouchableOpacity
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: isDark ? '#ffffff14' : '#00000010', borderWidth: 1, borderColor: isDark ? '#ffffff22' : '#00000018', alignItems: 'center', justifyContent: 'center' }}
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
              <Text style={{ color: theme.textDim, fontSize: 9, fontFamily: 'Orbitron', marginTop: 2 }}>
                {myRole === 'owner' ? 'ZAŁOŻYCIEL' : myRank ? myRank.name.toUpperCase() : 'CZAT KLUBU'}
              </Text>
            </View>

            {clubData?.isMember && (
              <TouchableOpacity
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#ffffff14' : '#00000010', borderWidth: 1, borderColor: isDark ? '#ffffff22' : '#00000018' }}
                onPress={toggleClubPushMute}
                disabled={pushMuteBusy}
              >
                <MaterialIcons
                  name={clubData.myClubPushMuted ? 'notifications-off' : 'notifications-active'}
                  size={18}
                  color={clubData.myClubPushMuted ? theme.textDim : theme.primary}
                />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#ffffff14' : '#00000010', borderWidth: 1, borderColor: isDark ? '#ffffff22' : '#00000018' }}
              onPress={() => setThemePickerOpen(true)}
            >
              <MaterialCommunityIcons name="palette" size={18} color={theme.textDim} />
            </TouchableOpacity>

            <TouchableOpacity
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#ffffff14' : '#00000010', borderWidth: 1, borderColor: isDark ? '#ffffff22' : '#00000018' }}
              onPress={() => setShareVisible(true)}
            >
              <MaterialIcons name="share" size={17} color={theme.textDim} />
            </TouchableOpacity>

            {myRole === 'owner' && (
              <TouchableOpacity
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#ffffff14' : '#00000010', borderWidth: 1, borderColor: isDark ? '#ffffff22' : '#00000018' }}
                onPress={() => setEditVisible(true)}
              >
                <MaterialIcons name="settings" size={18} color={theme.textDim} />
              </TouchableOpacity>
            )}

            {pinned.length > 0 && (
              <TouchableOpacity
                style={[
                  { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: isDark ? '#ffffff22' : '#00000018' },
                  showPinned ? { backgroundColor: '#FFD70020' } : { backgroundColor: isDark ? '#ffffff14' : '#00000010' },
                ]}
                onPress={() => setShowPinned(v => !v)}
              >
                <MaterialIcons name="push-pin" size={18} color={showPinned ? '#FFD700' : theme.textDim} />
              </TouchableOpacity>
            )}
          </View>

          <View style={{ paddingHorizontal: 8 }}>
            <View style={{ flexDirection: 'row', paddingTop: 8, borderWidth: 1, borderColor: theme.border2, borderRadius: 14, backgroundColor: isDark ? '#141519' : theme.surface2 }}>
            <TouchableOpacity
              style={{ flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4 }}
              onPress={() => { setActivePane('channels'); paneRef.current?.scrollTo({ x: 0, animated: true }); }}
            >
              <Text
                style={{ fontFamily: 'Orbitron', fontSize: 9, color: activePane === 'channels' ? theme.text : theme.textDim, fontWeight: activePane === 'channels' ? '800' : '600' }}
                numberOfLines={1}
              >
                CZATY
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4 }}
              onPress={() => { setActivePane('chat'); paneRef.current?.scrollTo({ x: SCREEN_W, animated: true }); }}
            >
              <Text
                style={{ fontFamily: 'Orbitron', fontSize: 9, color: activePane === 'chat' ? theme.text : theme.textDim, fontWeight: activePane === 'chat' ? '800' : '600' }}
                numberOfLines={1}
              >
                {(channels.find((c: any) => c.id === activeChannelId)?.name ?? 'Kanał').toUpperCase()}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4 }}
              onPress={() => { setActivePane('members'); paneRef.current?.scrollTo({ x: SCREEN_W * 2, animated: true }); }}
            >
              <Text
                style={{ fontFamily: 'Orbitron', fontSize: 9, color: activePane === 'members' ? theme.text : theme.textDim, fontWeight: activePane === 'members' ? '800' : '600' }}
                numberOfLines={1}
              >
                UŻYTKOWNICY
              </Text>
            </TouchableOpacity>
            </View>
            <View style={{ height: 3, backgroundColor: 'transparent', marginTop: 6 }}>
              <Animated.View
                style={{
                  height: 3,
                  width: TAB_SEG_W,
                  backgroundColor: theme.primary,
                  borderTopLeftRadius: 2,
                  borderTopRightRadius: 2,
                  transform: [{ translateX: tabSlide }],
                }}
              />
            </View>
          </View>
        </LinearGradient>

        <ScrollView
          ref={paneRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
            if (idx === 0) setActivePane('channels');
            else if (idx === 1) setActivePane('chat');
            else setActivePane('members');
          }}
          contentOffset={{ x: SCREEN_W, y: 0 }}
          style={{ flex: 1 }}
        >
          <View style={{ width: SCREEN_W, flex: 1, backgroundColor: sidebarBg }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {categorySections.map((cat: any) => (
                <View key={cat.id} style={{ marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', backgroundColor: isDark ? '#15171b' : theme.surface }}>
                  <LinearGradient
                    colors={isDark ? ['#1a1b20', '#131419'] : [theme.surface, theme.surface2]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ paddingVertical: 8, paddingHorizontal: 10 }}
                  >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '800',
                      letterSpacing: 0.6,
                      color: theme.textDim,
                      marginBottom: 2,
                    }}
                  >
                    {cat.name.toUpperCase()}
                  </Text>
                  </LinearGradient>
                  <View style={{ gap: 2 }}>
                    {cat.channels.map((ch: any) => {
                      const active = activeChannelId === ch.id;
                      return (
                        <TouchableOpacity
                          key={ch.id}
                          onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            setActiveChannelId(ch.id);
                            setActivePane('chat');
                            paneRef.current?.scrollTo({ x: SCREEN_W, animated: true });
                          }}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingVertical: 6,
                            paddingHorizontal: 8,
                            marginHorizontal: 6,
                            marginBottom: 4,
                            borderRadius: 10,
                            borderLeftWidth: 1,
                            borderLeftColor: active ? `${theme.primary}70` : theme.border,
                            borderWidth: 1,
                            borderColor: active ? `${theme.primary}55` : theme.border,
                            backgroundColor: active ? `${theme.primary}16` : (isDark ? '#1b1d22' : theme.surface2),
                          }}
                        >
                          <MaterialCommunityIcons name="pound" size={16} color={active ? theme.text : theme.textDim} />
                          <Text
                            style={{
                              fontFamily: 'Orbitron',
                              fontSize: 11,
                              fontWeight: active ? '700' : '500',
                              color: active ? theme.text : theme.textMuted,
                              marginLeft: 4,
                              flex: 1,
                            }}
                            numberOfLines={1}
                          >
                            {ch.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>

          <View style={{ width: SCREEN_W, flex: 1 }}>
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
                contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: chatListPad, flexGrow: 1 }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
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
          </View>

          <View style={{ width: SCREEN_W, flex: 1, backgroundColor: sidebarBg }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
            {[
              { title: 'WŁAŚCICIEL', data: ownerGroup },
              ...rankSections,
              { title: 'CZŁONKOWIE', data: memberGroup },
            ].map(section => (
              <View key={section.title} style={{ marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', backgroundColor: isDark ? '#15171b' : theme.surface }}>
                <LinearGradient
                  colors={isDark ? ['#1a1b20', '#131419'] : [theme.surface, theme.surface2]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ paddingVertical: 8, paddingHorizontal: 10 }}
                >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '800',
                    letterSpacing: 0.6,
                    color: theme.textDim,
                    marginBottom: 0,
                  }}
                >
                  {section.title} ({section.data.length})
                </Text>
                </LinearGradient>
                {section.data.map((m: any) => (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => openMemberActions(m)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                      borderRadius: 10,
                      marginHorizontal: 6,
                      marginBottom: 4,
                      backgroundColor: isDark ? '#1b1d22' : theme.surface2,
                      borderWidth: 1,
                      borderColor: theme.border,
                    }}
                  >
                    <UAv uri={m.avatarUrl} name={m.username} size={30} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{m.username}</Text>
                      {!!m.rank && <Text style={{ color: m.rank.color, fontSize: 10, marginTop: 1 }}>{m.rank.name}</Text>}
                    </View>
                    <MaterialIcons name="more-horiz" size={18} color={theme.textDim} />
                  </TouchableOpacity>
                ))}
              </View>
            ))}
            </ScrollView>
          </View>
        </ScrollView>

        {/* INPUT */}
        {activePane === 'chat' && (
        <View style={{
          backgroundColor: theme.surface,
          borderTopWidth: 1, borderTopColor: theme.border,
          paddingBottom:
            chatInputPad > 0
              ? chatInputPad
              : (insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 10 : 16)),
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
                borderWidth: 1, borderColor: theme.border,
                minHeight: 40, maxHeight: 120,
              }}
              value={text}
              onChangeText={(v) => {
                setText(v);
                const match = v.match(/(?:^|\s)@([a-zA-Z0-9_.-]{1,32})$/);
                setMentionQuery(match ? match[1] : null);
              }}
              placeholder="Napisz na czacie klubu..."
              placeholderTextColor={theme.textDim}
              multiline
              maxLength={2000}
            />
            {!!mentionQuery && mentionSuggestions.length > 0 && (
              <View style={{ position: 'absolute', left: 48, right: 56, bottom: 52, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 10, maxHeight: 140 }}>
                {mentionSuggestions.map((u: any) => (
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => {
                      setText(prev => prev.replace(/@([a-zA-Z0-9_.-]*)$/, `@${u.username} `));
                      setMentionQuery(null);
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}
                  >
                    <UAv uri={u.avatarUrl} name={u.username} size={22} />
                    <Text style={{ color: theme.text, fontSize: 12 }}>{u.username}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

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
        )}
      </KeyboardAvoidingView>

      <MessageMenu
        visible={!!menuMsg}
        message={menuMsg}
        isMe={menuMsg?.senderId === myId}
        canPin={canPin}
        canDelete={canDeleteMenu}
        onReact={(emoji) => { if (menuMsg) handleReact(menuMsg.id, emoji); }}
        onReply={() => { if (menuMsg) setReplyTo(menuMsg); }}
        onPin={()   => { if (menuMsg) handlePin(menuMsg.id, menuMsg.isPinned); }}
        onDelete={() => { if (menuMsg) handleDelete(menuMsg.id); }}
        onReport={menuMsg && menuMsg.senderId !== myId ? () => {
          const msg = menuMsg;
          showReportContentAlert((reason) => {
            void reportContent({
              targetType: 'club_message',
              targetId: msg.id,
              reason,
              offenderUserId: msg.senderId,
              details: `authorId=${msg.senderId}`,
            });
          });
        } : undefined}
        onBlock={menuMsg && menuMsg.senderId !== myId ? () => {
          const msg = menuMsg;
          showBlockUserAlert(msg.senderId, msg.sender.username, () => {
            setMessages((prev) => prev.filter((m) => m.senderId !== msg.senderId));
          });
        } : undefined}
        onClose={() => setMenuMsg(null)}
      />

      <EditClubModal
        visible={editVisible}
        club={clubData}
        channels={channels}
        onClose={() => setEditVisible(false)}
        onUpdated={(updated) => { setClubName(updated.name); setClubData(updated); setChannels(updated.channels ?? channels); setCategories(updated.categories ?? categories); setEditVisible(false); }}
      />

      <Modal visible={themePickerOpen} transparent animationType="slide" onRequestClose={() => setThemePickerOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setThemePickerOpen(false)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, borderTopWidth: 1, borderColor: theme.border2 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 16 }} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, marginBottom: 20 }}>MOTYW CZATU</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                {CHAT_THEMES.map(t => (
                  <TouchableOpacity key={t.id} onPress={async () => { setChatThemeId(t.id); await AsyncStorage.setItem(`chat_theme_club_${clubId}`, t.id); setThemePickerOpen(false); }} style={{ alignItems: 'center', gap: 6 }}>
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

      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <Pressable
          style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}
          onPress={() => setPreviewPhoto(null)}
        >
          {!!previewPhoto && (
            <Image
              source={{ uri: previewPhoto }}
              style={{ width: SCREEN_W, height: Dimensions.get('window').height * 0.82 }}
              resizeMode="contain"
            />
          )}
          <TouchableOpacity
            onPress={() => setPreviewPhoto(null)}
            style={{ position: 'absolute', top: insets.top + 12, right: 14, backgroundColor: '#ffffff24', borderRadius: 20, padding: 9 }}
          >
            <Feather name="x" size={18} color="#fff" />
          </TouchableOpacity>
        </Pressable>
      </Modal>

      <Modal visible={shareVisible} transparent animationType="slide" onRequestClose={() => setShareVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setShareVisible(false)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 18, borderTopWidth: 1, borderColor: theme.border2 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 14 }} />
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, marginBottom: 4 }}>
                UDOSTĘPNIJ KLUB W DYSKUSJACH
              </Text>
              <Text style={{ color: theme.textDim, fontSize: 11, marginBottom: 10 }}>
                Dodaj opcjonalny tekst do zaproszenia.
              </Text>

              <TextInput
                value={shareText}
                onChangeText={setShareText}
                placeholder="Np. Szukamy aktywnych osób do wspólnych wyjazdów 🚗"
                placeholderTextColor={theme.textDim}
                multiline
                maxLength={320}
                style={{
                  minHeight: 92,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surface2,
                  color: theme.text,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  textAlignVertical: 'top',
                }}
              />

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, alignItems: 'center', paddingVertical: 11 }}
                  onPress={() => setShareVisible(false)}
                  disabled={sharing}
                >
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>ANULUJ</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#e3383560', backgroundColor: '#e33835', alignItems: 'center', paddingVertical: 11 }}
                  onPress={shareClubToDiscussions}
                  disabled={sharing}
                >
                  {sharing ? (
                    <ActivityIndicator size={14} color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10 }}>UDOSTĘPNIJ</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!memberModal} transparent animationType="slide" onRequestClose={() => setMemberModal(null)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setMemberModal(null)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 18, borderTopWidth: 1, borderColor: theme.border2 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 14 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <UAv uri={memberModal?.avatarUrl} name={memberModal?.username ?? '?'} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12 }}>{memberModal?.username}</Text>
                  {!!memberModal?.rank?.name && <Text style={{ color: memberModal.rank.color, fontSize: 10 }}>{memberModal.rank.name}</Text>}
                </View>
              </View>

              <TouchableOpacity style={{ paddingVertical: 12 }} onPress={() => { if (memberModal) router.push(`/profile/${memberModal.userId}` as any); setMemberModal(null); }}>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11 }}>Wyświetl profil</Text>
              </TouchableOpacity>

              {canManage && memberModal?.userId !== myId && memberModal?.role !== 'owner' && (
                <View style={{ marginTop: 6, marginBottom: 8 }}>
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, marginBottom: 6 }}>NADAJ ROLĘ</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <TouchableOpacity onPress={() => assignRank(null)} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 }}>
                      <Text style={{ color: theme.textDim, fontSize: 11 }}>Brak</Text>
                    </TouchableOpacity>
                    {(clubData?.ranks ?? []).map((r: any) => (
                      <TouchableOpacity key={r.id} onPress={() => assignRank(r.id)} style={{ borderWidth: 1, borderColor: r.color, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 }}>
                        <Text style={{ color: r.color, fontSize: 11 }}>{r.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {(canKick || canManage) && memberModal?.userId !== myId && memberModal?.role !== 'owner' && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity onPress={toggleMute} style={{ flex: 1, borderWidth: 1, borderColor: '#ff922b55', backgroundColor: '#ff922b18', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                    <Text style={{ color: '#ff922b', fontFamily: 'Orbitron', fontSize: 10 }}>{memberModal?.isMuted ? 'Odcisz' : 'Wycisz'}</Text>
                  </TouchableOpacity>
                  {canKick && (
                    <TouchableOpacity onPress={kickMember} style={{ flex: 1, borderWidth: 1, borderColor: '#e3383555', backgroundColor: '#e3383518', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                      <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 10 }}>Wyrzuć</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}