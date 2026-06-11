import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, FlatList, TextInput, TouchableOpacity,
  Image, StatusBar, Platform, ActivityIndicator, Modal, Pressable, Dimensions, StyleSheet,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Text } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Video, ResizeMode } from 'expo-av';
import { io, Socket } from 'socket.io-client';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader, CommunityEmptyState } from '../../../components/community';
import { useChatKeyboard, scrollChatToEndAfterLayout } from '../../../hooks/useChatKeyboard';
import { UserBadges } from '../../../components/user/UserBadges';
import { ProvinceBadge } from '../../../components/user/ProvinceBadge';
import { reportContent, showBlockUserAlert, showReportContentAlert } from '../../../lib/ugcActions';
import {
  renderDiscussionBody,
  searchMentionSuggestions,
  resolveMentionUserId,
  type MentionSuggestion,
} from '../community/communityShared';

const API = `${API_URL}/api/public-chat`;

type PublicNotifMode = 'all' | 'mentions_only' | 'muted';

function modeFromSettings(msgsMuted: boolean, mentionsMuted: boolean): PublicNotifMode {
  if (msgsMuted && mentionsMuted) return 'muted';
  if (msgsMuted && !mentionsMuted) return 'mentions_only';
  return 'all';
}

function settingsFromMode(mode: PublicNotifMode) {
  if (mode === 'muted') return { msgsMuted: true, mentionsMuted: true };
  if (mode === 'mentions_only') return { msgsMuted: true, mentionsMuted: false };
  return { msgsMuted: false, mentionsMuted: false };
}

const INPUT_MIN_HEIGHT = 40;
const INPUT_MAX_HEIGHT = 120;
const PAGE_SIZE = 40;
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
const { width: SCREEN_W } = Dimensions.get('window');

interface ChatUser {
  id: number;
  username: string;
  avatarUrl: string | null;
  province?: string | null;
  isPremium?: boolean;
  isAdmin?: boolean;
  nickColor?: string | null;
}

interface PublicMessage {
  id: number;
  content: string | null;
  photos: string[];
  videos: string[];
  createdAt: string;
  editedAt?: string | null;
  senderId: number;
  sender: ChatUser;
  replyTo?: {
    id: number;
    content: string | null;
    photos?: string[];
    videos?: string[];
    sender: { id: number; username: string };
  } | null;
  reactions?: { emoji: string; count: number; myReaction: boolean }[];
}

function normalizeUri(uri: string): string {
  if (!uri) return uri;
  if (/^https?:\/\//i.test(uri) || /^file:\/\//i.test(uri) || /^content:\/\//i.test(uri)) return uri;
  return `${API_URL}${uri.startsWith('/') ? uri : `/${uri}`}`;
}

function replyPreviewLabel(reply: {
  content: string | null;
  photos?: string[];
  videos?: string[];
}): string {
  const text = reply.content?.trim();
  if (text) return text;
  if (reply.photos?.length) return '📷 Zdjęcie';
  if (reply.videos?.length) return '🎬 Film';
  return '…';
}

export default function PublicChatScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const [photos, setPhotos] = useState<string[]>([]);
  const [video, setVideo] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<PublicMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<PublicMessage | null>(null);
  const [myId, setMyId] = useState<number | null>(null);
  const myIdRef = useRef<number | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [menuMsg, setMenuMsg] = useState<PublicMessage | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionUsers, setMentionUsers] = useState<MentionSuggestion[]>([]);
  const [notifMode, setNotifMode] = useState<PublicNotifMode>('all');
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);

  const listRef = useRef<FlatList>(null);
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef('');
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myUsernameRef = useRef('');

  const { listPaddingBottom: chatListPad, inputPaddingBottom: chatInputPad } = useChatKeyboard(listRef);

  const appendMessage = useCallback((msg: PublicMessage) => {
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const fetchMessages = useCallback(async (token: string, cursor?: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.append('cursor', String(cursor));
    const r = await fetch(`${API}/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error('fetch failed');
    return r.json() as Promise<{ messages: PublicMessage[]; nextCursor: number | null }>;
  }, []);

  const loadPushSettings = useCallback(async (token: string) => {
    try {
      const r = await fetch(`${API}/push-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const data = await r.json();
      setNotifMode(modeFromSettings(!!data.msgsMuted, !!data.mentionsMuted));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await AsyncStorage.getItem('user');
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';
      if (!token) { router.replace('/login'); return; }
      tokenRef.current = token;
      if (raw) {
        const u = JSON.parse(raw);
        setMyId(u.userId ?? u.id);
        myIdRef.current = u.userId ?? u.id;
        myUsernameRef.current = u.username ?? '';
      }

      void loadPushSettings(token);

      try {
        const data = await fetchMessages(token);
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setNextCursor(data.nextCursor ?? null);
        setHasMore(!!data.nextCursor);
        scrollChatToEndAfterLayout(listRef, false);
      } catch {
        Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie udało się załadować czatu.' });
      } finally {
        if (!cancelled) setLoading(false);
      }

      const socket = io(API_URL, { auth: { token }, transports: ['websocket'] });

      const joinPublicRoom = () => socket.emit('public:join');
      socket.on('connect', joinPublicRoom);
      if (socket.connected) joinPublicRoom();

      socket.on('public:message', (msg: PublicMessage) => {
        appendMessage(msg);
      });

      socket.on('public:message_deleted', ({ id }: { id: number }) => {
        setMessages(prev => prev.filter(m => m.id !== id));
      });

      socket.on('public:message_updated', (msg: PublicMessage) => {
        setMessages(prev => prev.map(m => (m.id === msg.id ? msg : m)));
      });

      socket.on('public:reaction', ({ messageId, reactions }: { messageId: number; reactions: PublicMessage['reactions'] }) => {
        setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, reactions } : m)));
      });

      socket.on('public:typing', ({ userId, username, isTyping }: { userId: number; username?: string; isTyping: boolean }) => {
        if (userId === myIdRef.current) return;
        const name = username || 'Ktoś';
        setTypingUsers(prev => {
          const next = { ...prev };
          if (isTyping) next[name] = true;
          else delete next[name];
          return next;
        });
      });

      socketRef.current = socket;
    })();

    return () => {
      cancelled = true;
      const s = socketRef.current;
      s?.removeAllListeners();
      s?.emit('public:leave');
      s?.disconnect();
      socketRef.current = null;
    };
  }, [fetchMessages, router, loadPushSettings, appendMessage]);

  useEffect(() => {
    if (!mentionQuery) {
      setMentionUsers([]);
      return;
    }
    if (mentionTimer.current) clearTimeout(mentionTimer.current);
    mentionTimer.current = setTimeout(() => {
      void searchMentionSuggestions(mentionQuery).then(setMentionUsers);
    }, 180);
    return () => {
      if (mentionTimer.current) clearTimeout(mentionTimer.current);
    };
  }, [mentionQuery]);

  const applyNotifMode = useCallback(async (mode: PublicNotifMode) => {
    if (notifSaving) return;
    setNotifSaving(true);
    const { msgsMuted, mentionsMuted } = settingsFromMode(mode);
    try {
      const r = await fetch(`${API}/push-settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ msgsMuted, mentionsMuted }),
      });
      if (!r.ok) throw new Error();
      setNotifMode(mode);
      setNotifModalOpen(false);
      Toast.show({
        type: 'success',
        text1: mode === 'all' ? 'Powiadomienia włączone' : mode === 'mentions_only' ? 'Tylko oznaczenia (@)' : 'Powiadomienia wyciszone',
      });
    } catch {
      Toast.show({ type: 'error', text1: 'Nie udało się zapisać ustawień' });
    } finally {
      setNotifSaving(false);
    }
  }, [notifSaving]);

  const handleMentionPress = useCallback(async (username: string) => {
    const id = await resolveMentionUserId(username);
    if (id) router.push(`/profile/${id}` as any);
  }, [router]);

  const insertMention = useCallback((item: MentionSuggestion) => {
    const tag = item.type === 'province' ? item.mention : item.username;
    setText(prev => prev.replace(/@([a-zA-Z0-9_.-]*)$/, `@${tag} `));
    setMentionQuery(null);
    setMentionUsers([]);
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchMessages(tokenRef.current, nextCursor);
      if ((data.messages ?? []).length === 0) { setHasMore(false); return; }
      setMessages(prev => [...(data.messages ?? []), ...prev]);
      setNextCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
    } catch { /* ignore */ }
    finally { setLoadingMore(false); }
  }, [nextCursor, loadingMore, hasMore, fetchMessages]);

  const pickPhotos = async () => {
    if (video) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Toast.show({ type: 'error', text1: 'Brak uprawnień' }); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 4 - photos.length,
      quality: 0.85,
    });
    if (!result.canceled) {
      setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 4));
    }
  };

  const pickVideo = async () => {
    if (photos.length > 0) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Toast.show({ type: 'error', text1: 'Brak uprawnień' }); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setVideo(result.assets[0].uri);
    }
  };

  const cancelEdit = useCallback(() => {
    setEditingMsg(null);
    setText('');
    setInputHeight(INPUT_MIN_HEIGHT);
  }, []);

  const startEdit = useCallback((msg: PublicMessage) => {
    setEditingMsg(msg);
    setReplyTo(null);
    setPhotos([]);
    setVideo(null);
    setText(msg.content ?? '');
    setInputHeight(INPUT_MIN_HEIGHT);
    setMenuMsg(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (sending) return;

    if (editingMsg) {
      if (!text.trim() && !editingMsg.photos.length && !editingMsg.videos.length) return;
      setSending(true);
      const t = text.trim();
      const editTarget = editingMsg;
      setText('');
      setEditingMsg(null);
      setInputHeight(INPUT_MIN_HEIGHT);
      try {
        const res = await fetch(`${API}/messages/${editTarget.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenRef.current}`,
          },
          body: JSON.stringify({ content: t }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? 'Błąd edycji');
        }
        const updated: PublicMessage = await res.json();
        setMessages(prev => prev.map(m => (m.id === updated.id ? updated : m)));
      } catch (e: any) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie udało się edytować wiadomości.' });
        setText(t);
        setEditingMsg(editTarget);
      } finally {
        setSending(false);
      }
      return;
    }

    if (!text.trim() && !photos.length && !video) return;
    setSending(true);
    const t = text.trim();
    const p = [...photos];
    const v = video;
    const reply = replyTo;
    setText('');
    setPhotos([]);
    setVideo(null);
    setReplyTo(null);
    setInputHeight(INPUT_MIN_HEIGHT);

    const form = new FormData();
    if (t) form.append('content', t);
    if (reply?.id) form.append('replyToId', String(reply.id));
    p.forEach((uri, i) => {
      form.append('photos', { uri, type: 'image/jpeg', name: `photo_${i}.jpg` } as any);
    });
    if (v) {
      form.append('video', { uri: v, type: 'video/mp4', name: 'clip.mp4' } as any);
    }

    try {
      const res = await fetch(`${API}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Błąd wysyłki');
      }
      const msg: PublicMessage = await res.json();
      appendMessage(msg);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie wysłano wiadomości.' });
      setText(t);
      setPhotos(p);
      setVideo(v);
      setReplyTo(reply);
    } finally {
      setSending(false);
    }
  }, [text, photos, video, replyTo, sending, editingMsg, appendMessage]);

  const emitTyping = useCallback(() => {
    socketRef.current?.emit('public:typing', { isTyping: true, username: myUsernameRef.current });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.emit('public:typing', { isTyping: false, username: myUsernameRef.current });
    }, 2000);
  }, []);

  const onInputChange = useCallback((v: string) => {
    setText(v);
    if (!editingMsg) emitTyping();
    const match = v.match(/(?:^|\s)@([a-zA-Z0-9_.-]{0,32})$/);
    setMentionQuery(match ? match[1] : null);
  }, [editingMsg, emitTyping]);

  const handleReact = useCallback(async (msgId: number, emoji: string) => {
    try {
      const msg = messages.find(m => m.id === msgId);
      const hasMine = !!msg?.reactions?.find(r => r.emoji === emoji)?.myReaction;
      const endpoint = hasMine
        ? `${API}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`
        : `${API}/messages/${msgId}/reactions`;
      const res = await fetch(endpoint, {
        method: hasMine ? 'DELETE' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        ...(hasMine ? {} : { body: JSON.stringify({ emoji }) }),
      });
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'Nie udało się dodać reakcji' });
        return;
      }
      const data = await res.json();
      setMessages(prev => prev.map(m => (
        m.id === msgId ? { ...m, reactions: data.reactions ?? [] } : m
      )));
    } catch {
      Toast.show({ type: 'error', text1: 'Brak połączenia' });
    }
  }, [messages]);

  const typingNames = Object.keys(typingUsers);
  const typingText = typingNames.length === 1
    ? `${typingNames[0]} pisze...`
    : typingNames.length > 1
      ? `${typingNames.slice(0, 2).join(', ')} piszą...`
      : null;

  const inputBottomPad = chatInputPad > 0
    ? chatInputPad
    : Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 16);

  const pillBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const pillSolidBg = isDark ? 'rgba(15, 15, 15, 0.95)' : 'rgba(250, 250, 250, 0.95)';
  const pillShadow = Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.5,
      shadowRadius: 10,
    },
    android: { elevation: 10 },
    default: {},
  });
  const pillHeight = Math.min(Math.max(50, inputHeight + 10), 60);
  const canSendInput = editingMsg
    ? text.trim() || editingMsg.photos.length || editingMsg.videos.length
    : text.trim() || photos.length || !!video;

  const renderMessage = useCallback(({ item, index }: { item: PublicMessage; index: number }) => {
    const isMe = item.senderId === myId;
    const prev = messages[index - 1];
    const showName = !prev || prev.senderId !== item.senderId;
    const hasPhotos = item.photos?.length > 0;
    const hasVideos = item.videos?.length > 0;
    const hasMedia = hasPhotos || hasVideos;
    const hasText = !!item.content?.trim();

    const myBubbleRadius = {
      borderTopLeftRadius: 20,
      borderTopRightRadius: showName ? 4 : 20,
      borderBottomLeftRadius: 20,
      borderBottomRightRadius: 4,
    };

    const theirBubbleRadius = {
      borderTopLeftRadius: showName ? 4 : 20,
      borderTopRightRadius: 20,
      borderBottomLeftRadius: 20,
      borderBottomRightRadius: 20,
    };

    const bubblePadding = { paddingHorizontal: 16, paddingVertical: 12, gap: 6 };

    const myBubbleStyle = {
      backgroundColor: 'rgba(227, 56, 53, 0.15)',
      borderWidth: 1,
      borderColor: 'rgba(227, 56, 53, 0.4)',
    };

    const theirBubbleStyle = {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
    };

    const timeRow = (onBubble: boolean) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end' }}>
        {!!item.editedAt && (
          <Text style={{
            fontSize: 8,
            color: onBubble && isMe ? 'rgba(255,255,255,0.55)' : theme.textDim,
            fontStyle: 'italic',
          }}>
            edytowano
          </Text>
        )}
        <Text style={{
          fontSize: 9,
          color: onBubble && isMe ? 'rgba(255,255,255,0.65)' : theme.textDim,
        }}>
          {new Date(item.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );

    const replyQuote = item.replyTo ? (
      <View style={{
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: theme.primary,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginBottom: hasMedia && !hasText ? 0 : 6,
      }}>
        <Text style={{
          color: isMe ? '#fff' : theme.primary,
          fontFamily: 'Orbitron',
          fontSize: 8,
          fontWeight: '600',
          letterSpacing: 0,
        }}>
          {item.replyTo.sender.username}
        </Text>
        <Text style={{ color: isMe ? 'rgba(255,255,255,0.75)' : theme.textDim, fontSize: 11 }} numberOfLines={1}>
          {replyPreviewLabel(item.replyTo)}
        </Text>
      </View>
    ) : null;

    return (
      <View style={{ flexDirection: 'row', marginBottom: 8, paddingHorizontal: 12, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
        {!isMe && (
          <View style={{ width: 32, marginRight: 8, alignSelf: 'flex-end' }}>
            {showName && (
              item.sender.avatarUrl
                ? <Image source={{ uri: item.sender.avatarUrl }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                : (
                  <View style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: 'rgba(150, 150, 150, 0.2)',
                  }}>
                    <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                      {item.sender.username.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )
            )}
          </View>
        )}

        <View style={{ maxWidth: SCREEN_W * 0.78, alignItems: isMe ? 'flex-end' : 'flex-start', gap: 4 }}>
          {showName && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <TouchableOpacity onPress={() => router.push(`/profile/${item.sender.id}` as any)}>
                <Text style={{ color: item.sender.nickColor || theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '600', letterSpacing: 0 }}>
                  {item.sender.username}
                </Text>
              </TouchableOpacity>
              {!!item.sender.province && (
                <ProvinceBadge province={item.sender.province} compact theme={theme} />
              )}
              <UserBadges isAdmin={item.sender.isAdmin} isPremium={item.sender.isPremium} compact />
            </View>
          )}

          {hasMedia && (
            <TouchableOpacity onLongPress={() => setMenuMsg(item)} activeOpacity={0.9} style={{ gap: 4 }}>
              {replyQuote}
              {hasPhotos && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {item.photos.map((uri, i) => (
                    <TouchableOpacity key={i} onPress={() => setPreviewPhoto(normalizeUri(uri))}>
                      <Image
                        source={{ uri: normalizeUri(uri) }}
                        style={item.photos.length === 1
                          ? { width: 220, height: 160, borderRadius: 12 }
                          : { width: 120, height: 90, borderRadius: 8 }}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {hasVideos && item.videos.map((uri, i) => (
                <Video
                  key={i}
                  source={{ uri: normalizeUri(uri) }}
                  style={{ width: 220, height: 160, borderRadius: 12, backgroundColor: '#000' }}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                />
              ))}
              {!hasText && timeRow(false)}
            </TouchableOpacity>
          )}

          {(hasText || (item.replyTo && !hasMedia)) && (
            <TouchableOpacity
              style={[
                isMe ? myBubbleRadius : theirBubbleRadius,
                bubblePadding,
                isMe ? myBubbleStyle : theirBubbleStyle,
              ]}
              onLongPress={() => setMenuMsg(item)}
              activeOpacity={0.85}
            >
              {item.replyTo && !hasMedia && replyQuote}
              {hasText && (
                <Text style={{ fontSize: 14, lineHeight: 20 }}>
                  {renderDiscussionBody(item.content!, theme, {
                    textColor: isMe ? '#fff' : theme.text,
                    mentionColor: isMe ? '#b8e8ff' : '#4a9eff',
                    linkColor: isMe ? '#9fd4ff' : '#4a9eff',
                    onMentionPress: handleMentionPress,
                  })}
                </Text>
              )}
              {timeRow(true)}
            </TouchableOpacity>
          )}

          {item.reactions && item.reactions.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2, paddingHorizontal: 2 }}>
              {item.reactions.map(r => (
                <TouchableOpacity
                  key={r.emoji}
                  onPress={() => handleReact(item.id, r.emoji)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 3,
                    backgroundColor: r.myReaction
                      ? (isDark ? '#e3383528' : '#e3383518')
                      : (isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)'),
                    borderRadius: 14,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ fontSize: 12 }}>{r.emoji}</Text>
                  <Text style={{
                    fontSize: 10,
                    color: r.myReaction ? theme.primary : theme.textDim,
                    fontFamily: 'Orbitron',
                    fontWeight: '700',
                  }}>
                    {r.count}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }, [myId, messages, theme, router, isDark, handleMentionPress, handleReact]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e33835" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />

      <CommunityScreenHeader
        title="CZAT OGÓLNY"
        subtitle={typingText || 'LIVE · CAŁA SPOŁECZNOŚĆ'}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => setNotifModalOpen(true)}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
            >
              <MaterialIcons
                name={notifMode === 'muted' ? 'notifications-off' : notifMode === 'mentions_only' ? 'notifications' : 'notifications-active'}
                size={18}
                color={notifMode === 'all' ? theme.success : theme.textDim}
              />
            </TouchableOpacity>
            <MaterialCommunityIcons name="earth" size={22} color={theme.success} />
          </View>
        }
      />

      <View style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => String(m.id)}
          renderItem={renderMessage}
          ListHeaderComponent={
            hasMore ? (
              loadingMore
                ? <ActivityIndicator color="#e33835" style={{ marginVertical: 14 }} />
                : (
                  <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={loadMore}>
                    <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 8 }}>ZAŁADUJ STARSZE</Text>
                  </TouchableOpacity>
                )
            ) : null
          }
          ListEmptyComponent={
            <CommunityEmptyState
              icon="earth"
              title="Napisz pierwszą wiadomość!"
            />
          }
          contentContainerStyle={{ paddingTop: 8, paddingBottom: chatListPad + 80, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 10 }}
          onContentSizeChange={() => {
            if (chatInputPad > 0) {
              listRef.current?.scrollToEnd({ animated: true });
            }
          }}
        />

        <View style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: inputBottomPad,
        }}>
          {(replyTo || editingMsg) && (
            <View style={{
              marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8,
              flexDirection: 'row', alignItems: 'center', gap: 8,
              borderLeftWidth: 3, borderLeftColor: theme.primary,
              backgroundColor: 'rgba(0,0,0,0.15)',
              borderRadius: 10,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '600' }}>
                  {replyTo ? replyTo.sender.username : 'EDYTUJESZ WIADOMOŚĆ'}
                </Text>
                <Text style={{ color: theme.textDim, fontSize: 11 }} numberOfLines={1}>
                  {replyTo ? replyPreviewLabel(replyTo) : replyPreviewLabel(editingMsg!)}
                </Text>
              </View>
              <TouchableOpacity onPress={replyTo ? () => setReplyTo(null) : cancelEdit}>
                <Feather name="x" size={16} color={theme.textDim} />
              </TouchableOpacity>
            </View>
          )}

          {!editingMsg && (photos.length > 0 || video) && (
            <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 8 }}>
              {photos.map((uri, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Image source={{ uri }} style={{ width: 48, height: 48, borderRadius: 10 }} />
                  <TouchableOpacity
                    style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  >
                    <Feather name="x" size={9} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {video && (
                <View style={{ position: 'relative' }}>
                  <View style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialIcons name="videocam" size={18} color="#fff" />
                  </View>
                  <TouchableOpacity
                    style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setVideo(null)}
                  >
                    <Feather name="x" size={9} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          <View style={{ marginHorizontal: 16, marginBottom: 16, ...pillShadow }}>
            <View style={{
              height: pillHeight,
              borderRadius: 25,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: pillBorder,
            }}>
              <BlurView
                intensity={100}
                tint={isDark ? 'dark' : 'light'}
                style={StyleSheet.absoluteFillObject}
              />
              <View
                style={[
                  StyleSheet.absoluteFillObject,
                  { backgroundColor: pillSolidBg },
                ]}
              />
              <View style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingLeft: 10,
                paddingRight: 6,
                gap: 4,
              }}>
              <TouchableOpacity
                onPress={pickPhotos}
                disabled={!!editingMsg || !!video || photos.length >= 4}
                style={{ padding: 6, opacity: editingMsg ? 0.3 : 1 }}
                hitSlop={4}
              >
                <Feather name="image" size={16} color={theme.textDim} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={pickVideo}
                disabled={!!editingMsg || photos.length > 0 || !!video}
                style={{ padding: 6, opacity: editingMsg ? 0.3 : 1 }}
                hitSlop={4}
              >
                <MaterialIcons name="videocam" size={16} color={theme.textDim} />
              </TouchableOpacity>

              <TextInput
                style={{
                  flex: 1,
                  color: theme.text,
                  fontSize: 14,
                  lineHeight: 18,
                  backgroundColor: 'transparent',
                  borderWidth: 0,
                  paddingVertical: 0,
                  maxHeight: 44,
                }}
                value={text}
                onChangeText={onInputChange}
                onContentSizeChange={e => setInputHeight(Math.min(e.nativeEvent.contentSize.height, INPUT_MAX_HEIGHT))}
                placeholder={editingMsg ? 'Edytuj treść...' : 'Napisz wiadomość...'}
                placeholderTextColor={theme.textDim}
                multiline
                maxLength={2000}
              />

              <TouchableOpacity
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: theme.primary,
                  alignItems: 'center', justifyContent: 'center',
                  opacity: canSendInput ? 1 : 0.35,
                }}
                onPress={() => void handleSend()}
                disabled={sending || !canSendInput}
              >
                {sending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Feather name={editingMsg ? 'check' : 'send'} size={15} color="#fff" />
                }
              </TouchableOpacity>
              </View>
            </View>
          </View>

          {!!mentionQuery && mentionUsers.length > 0 && (
            <View style={{
              position: 'absolute',
              left: 16, right: 16, bottom: pillHeight + 24,
              backgroundColor: isDark ? 'rgba(22,22,22,0.96)' : 'rgba(255,255,255,0.96)',
              borderRadius: 14, maxHeight: 140, overflow: 'hidden',
              borderWidth: 1, borderColor: pillBorder,
            }}>
              {mentionUsers.map(u => (
                <TouchableOpacity
                  key={u.type === 'province' ? `p-${u.slug}` : `u-${u.id}`}
                  onPress={() => insertMention(u)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}
                >
                  {u.type === 'user' ? (
                    u.avatarUrl
                      ? <Image source={{ uri: u.avatarUrl }} style={{ width: 24, height: 24, borderRadius: 12 }} />
                      : (
                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8 }}>{u.username.slice(0, 1).toUpperCase()}</Text>
                        </View>
                      )
                  ) : (
                    <MaterialIcons name="map" size={14} color="#7cb342" />
                  )}
                  <Text style={{ color: theme.text, fontSize: 13 }}>
                    {u.type === 'province' ? `@${u.mention}` : `@${u.username}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>

      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000ee', justifyContent: 'center', alignItems: 'center' }} onPress={() => setPreviewPhoto(null)}>
          {previewPhoto && (
            <Image source={{ uri: previewPhoto }} style={{ width: SCREEN_W, height: SCREEN_W * 0.75 }} resizeMode="contain" />
          )}
        </Pressable>
      </Modal>

      <Modal visible={notifModalOpen} transparent animationType="fade" onRequestClose={() => setNotifModalOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setNotifModalOpen(false)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: insets.bottom + 16 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 14 }} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, letterSpacing: 1.5, paddingHorizontal: 20, marginBottom: 8 }}>
                POWIADOMIENIA CZATU
              </Text>
              {([
                { mode: 'all' as PublicNotifMode, icon: 'notifications-active', title: 'Wszystkie', desc: 'Wiadomości i oznaczenia (@)' },
                { mode: 'mentions_only' as PublicNotifMode, icon: 'alternate-email', title: 'Tylko oznaczenia', desc: 'Wycisz wiadomości, zostaw @pingi' },
                { mode: 'muted' as PublicNotifMode, icon: 'notifications-off', title: 'Wyciszone', desc: 'Bez wiadomości i bez @pingów' },
              ]).map(opt => (
                <TouchableOpacity
                  key={opt.mode}
                  disabled={notifSaving}
                  onPress={() => void applyNotifMode(opt.mode)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 14,
                    paddingHorizontal: 20, paddingVertical: 14,
                    backgroundColor: notifMode === opt.mode ? `${theme.primary}12` : 'transparent',
                  }}
                >
                  <MaterialIcons name={opt.icon as any} size={20} color={notifMode === opt.mode ? theme.primary : theme.textDim} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>{opt.title.toUpperCase()}</Text>
                    <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 2 }}>{opt.desc}</Text>
                  </View>
                  {notifMode === opt.mode && <MaterialIcons name="check" size={18} color={theme.primary} />}
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setMenuMsg(null)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: insets.bottom + 16 }}>
              <View style={{
                flexDirection: 'row',
                justifyContent: 'space-around',
                paddingHorizontal: 20,
                paddingBottom: 14,
                borderBottomWidth: 1,
                borderBottomColor: theme.border,
                marginBottom: 4,
              }}>
                {REACTION_EMOJIS.map(emoji => (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => { if (menuMsg) void handleReact(menuMsg.id, emoji); setMenuMsg(null); }}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: theme.surface2,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 }}
                onPress={() => { if (menuMsg) setReplyTo(menuMsg); setMenuMsg(null); }}
              >
                <MaterialIcons name="reply" size={18} color={theme.primary} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text }}>Odpowiedz</Text>
              </TouchableOpacity>
              {menuMsg && menuMsg.senderId === myId && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 }}
                  onPress={() => { if (menuMsg) startEdit(menuMsg); }}
                >
                  <Feather name="edit-2" size={18} color={theme.primary} />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text }}>Edytuj</Text>
                </TouchableOpacity>
              )}
              {menuMsg && menuMsg.senderId !== myId && (
                <>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 }}
                    onPress={() => {
                      const msg = menuMsg;
                      setMenuMsg(null);
                      showReportContentAlert((reason) => {
                        void reportContent({
                          targetType: 'public_chat_message',
                          targetId: msg.id,
                          reason,
                          offenderUserId: msg.sender.id,
                        });
                      });
                    }}
                  >
                    <MaterialIcons name="flag" size={18} color="#FF9800" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text }}>Zgłoś treść</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 }}
                    onPress={() => {
                      const msg = menuMsg;
                      setMenuMsg(null);
                      showBlockUserAlert(msg.sender.id, msg.sender.username, () => {
                        setMessages(prev => prev.filter(m => m.senderId !== msg.sender.id));
                      });
                    }}
                  >
                    <MaterialIcons name="block" size={18} color="#e33835" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#e33835' }}>Zablokuj użytkownika</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
