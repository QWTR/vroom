import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, FlatList, TextInput, TouchableOpacity,
  Image, StatusBar, Platform, ActivityIndicator, Modal, Pressable, Dimensions,
} from 'react-native';
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
import { useChatKeyboard, scrollChatToEndAfterLayout } from '../../../hooks/useChatKeyboard';
import { UserBadges } from '../../../components/user/UserBadges';
import { reportContent, showBlockUserAlert, showReportContentAlert } from '../../../lib/ugcActions';
import { renderDiscussionBody, searchMentionUsers, resolveMentionUserId } from '../community/communityShared';

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
const { width: SCREEN_W } = Dimensions.get('window');

interface ChatUser {
  id: number;
  username: string;
  avatarUrl: string | null;
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
    sender: { id: number; username: string };
  } | null;
}

function normalizeUri(uri: string): string {
  if (!uri) return uri;
  if (/^https?:\/\//i.test(uri) || /^file:\/\//i.test(uri) || /^content:\/\//i.test(uri)) return uri;
  return `${API_URL}${uri.startsWith('/') ? uri : `/${uri}`}`;
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
  const [mentionUsers, setMentionUsers] = useState<{ id: number; username: string; avatarUrl: string | null }[]>([]);
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
      socket.emit('public:join');

      socket.on('public:message', (msg: PublicMessage) => {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      });

      socket.on('public:message_deleted', ({ id }: { id: number }) => {
        setMessages(prev => prev.filter(m => m.id !== id));
      });

      socket.on('public:message_updated', (msg: PublicMessage) => {
        setMessages(prev => prev.map(m => (m.id === msg.id ? msg : m)));
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
      socketRef.current?.emit('public:leave');
      socketRef.current?.disconnect();
    };
  }, [fetchMessages, router, loadPushSettings]);

  useEffect(() => {
    if (!mentionQuery) {
      setMentionUsers([]);
      return;
    }
    if (mentionTimer.current) clearTimeout(mentionTimer.current);
    mentionTimer.current = setTimeout(() => {
      void searchMentionUsers(mentionQuery).then(setMentionUsers);
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

  const insertMention = useCallback((username: string) => {
    setText(prev => prev.replace(/@([a-zA-Z0-9_.-]*)$/, `@${username} `));
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
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie wysłano wiadomości.' });
      setText(t);
      setPhotos(p);
      setVideo(v);
      setReplyTo(reply);
    } finally {
      setSending(false);
    }
  }, [text, photos, video, replyTo, sending, editingMsg]);

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

  const typingNames = Object.keys(typingUsers);
  const typingText = typingNames.length === 1
    ? `${typingNames[0]} pisze...`
    : typingNames.length > 1
      ? `${typingNames.slice(0, 2).join(', ')} piszą...`
      : null;

  const inputBottomPad = chatInputPad > 0
    ? chatInputPad
    : Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 16);

  const renderMessage = useCallback(({ item, index }: { item: PublicMessage; index: number }) => {
    const isMe = item.senderId === myId;
    const prev = messages[index - 1];
    const showName = !prev || prev.senderId !== item.senderId;
    const hasPhotos = item.photos?.length > 0;
    const hasVideos = item.videos?.length > 0;
    const hasMedia = hasPhotos || hasVideos;
    const hasText = !!item.content?.trim();

    const bubbleRadius = {
      borderTopLeftRadius:  showName && !isMe ? 4 : 16,
      borderTopRightRadius: showName && isMe ? 4 : 16,
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
    };

    const bubbleStyle = {
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 4,
      backgroundColor: isMe ? '#e33835' : theme.surface2,
      borderWidth: isMe ? 0 : 1,
      borderColor: theme.border,
    };

    const timeRow = (onBubble: boolean) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end' }}>
        {!!item.editedAt && (
          <Text style={{
            fontSize: 8,
            color: onBubble && isMe ? '#ffffff50' : theme.textDim,
            fontStyle: 'italic',
          }}>
            edytowano
          </Text>
        )}
        <Text style={{
          fontSize: 9,
          color: onBubble && isMe ? '#ffffff60' : theme.textDim,
        }}>
          {new Date(item.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );

    const replyQuote = item.replyTo ? (
      <View style={{
        backgroundColor: isMe && !hasMedia ? '#00000020' : (isDark ? '#ffffff10' : '#00000008'),
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: isMe && !hasMedia ? '#ffffff90' : '#e3383560',
        paddingHorizontal: 8,
        paddingVertical: 4,
        marginBottom: hasMedia && !hasText ? 0 : 4,
      }}>
        <Text style={{
          color: isMe && !hasMedia ? '#ffffffaa' : '#e33835aa',
          fontFamily: 'Orbitron',
          fontSize: 8,
          fontWeight: '700',
        }}>
          {item.replyTo.sender.username}
        </Text>
        <Text style={{ color: isMe && !hasMedia ? '#ffffff70' : theme.textDim, fontSize: 11 }} numberOfLines={1}>
          {item.replyTo.content || (item.replyTo as any).photos?.length ? '📷 Zdjęcie' : '🎬 Film'}
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
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border }}>
                    <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
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
                <Text style={{ color: item.sender.nickColor || '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                  {item.sender.username}
                </Text>
              </TouchableOpacity>
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
              style={[bubbleStyle, bubbleRadius]}
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
        </View>
      </View>
    );
  }, [myId, messages, theme, router, isDark, handleMentionPress]);

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

      <View style={{
        paddingTop: insets.top + 10,
        paddingBottom: 12,
        paddingHorizontal: 12,
        backgroundColor: theme.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name="arrow-left" size={18} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700', color: theme.text }}>CZAT OGÓLNY</Text>
          {typingText
            ? <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#4de926', marginTop: 2 }}>{typingText}</Text>
            : <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2, letterSpacing: 1 }}>LIVE · CAŁA SPOŁECZNOŚĆ</Text>
          }
        </View>
        <TouchableOpacity
          onPress={() => setNotifModalOpen(true)}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <MaterialIcons
            name={notifMode === 'muted' ? 'notifications-off' : notifMode === 'mentions_only' ? 'notifications' : 'notifications-active'}
            size={18}
            color={notifMode === 'all' ? '#4de926' : theme.textDim}
          />
        </TouchableOpacity>
        <MaterialCommunityIcons name="earth" size={22} color="#4de926" />
      </View>

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
            <View style={{ alignItems: 'center', paddingTop: 80, gap: 10 }}>
              <MaterialCommunityIcons name="earth" size={40} color="#4de92660" />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 11 }}>Napisz pierwszą wiadomość!</Text>
            </View>
          }
          contentContainerStyle={{ paddingTop: 8, paddingBottom: chatListPad, flexGrow: 1 }}
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
          backgroundColor: theme.surface,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          paddingBottom: inputBottomPad,
        }}>
          {replyTo && (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10 }}>
              <View style={{ width: 3, borderRadius: 2, alignSelf: 'stretch', backgroundColor: '#e33835' }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{replyTo.sender.username}</Text>
                <Text style={{ color: theme.textDim, fontSize: 11 }} numberOfLines={1}>
                  {replyTo.content || (replyTo.photos.length ? '📷 Zdjęcie' : '🎬 Film')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)}>
                <Feather name="x" size={16} color={theme.textDim} />
              </TouchableOpacity>
            </View>
          )}

          {editingMsg && (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10 }}>
              <Feather name="edit-2" size={14} color="#e33835" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>EDYTUJESZ WIADOMOŚĆ</Text>
                <Text style={{ color: theme.textDim, fontSize: 11 }} numberOfLines={1}>
                  {editingMsg.content || (editingMsg.photos.length ? '📷 Zdjęcie' : editingMsg.videos.length ? '🎬 Film' : '…')}
                </Text>
              </View>
              <TouchableOpacity onPress={cancelEdit}>
                <Feather name="x" size={16} color={theme.textDim} />
              </TouchableOpacity>
            </View>
          )}

          {!editingMsg && (photos.length > 0 || video) && (
            <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, gap: 8 }}>
              {photos.map((uri, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Image source={{ uri }} style={{ width: 58, height: 58, borderRadius: 10, borderWidth: 1, borderColor: theme.border }} />
                  <TouchableOpacity
                    style={{ position: 'absolute', top: -5, right: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  >
                    <Feather name="x" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {video && (
                <View style={{ position: 'relative' }}>
                  <View style={{ width: 58, height: 58, borderRadius: 10, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border }}>
                    <MaterialIcons name="videocam" size={22} color="#fff" />
                  </View>
                  <TouchableOpacity
                    style={{ position: 'absolute', top: -5, right: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setVideo(null)}
                  >
                    <Feather name="x" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 10, gap: 8, position: 'relative' }}>
            <TouchableOpacity
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', opacity: editingMsg ? 0.35 : 1 }}
              onPress={pickPhotos}
              disabled={!!editingMsg || !!video || photos.length >= 4}
            >
              <Feather name="image" size={18} color={theme.textDim} />
            </TouchableOpacity>
            <TouchableOpacity
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', opacity: editingMsg ? 0.35 : 1 }}
              onPress={pickVideo}
              disabled={!!editingMsg || photos.length > 0 || !!video}
            >
              <MaterialIcons name="videocam" size={18} color={theme.textDim} />
            </TouchableOpacity>

            <TextInput
              style={{
                flex: 1, color: theme.text, fontSize: 14, lineHeight: 20,
                backgroundColor: theme.surface2, borderRadius: 20,
                paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
                borderWidth: 1, borderColor: editingMsg ? '#e33835' : theme.border,
                height: Math.max(INPUT_MIN_HEIGHT, inputHeight),
              }}
              value={text}
              onChangeText={onInputChange}
              onContentSizeChange={e => setInputHeight(Math.min(e.nativeEvent.contentSize.height, INPUT_MAX_HEIGHT))}
              placeholder={editingMsg ? 'Edytuj treść...' : 'Napisz wiadomość... (@nick)'}
              placeholderTextColor={theme.textDim}
              multiline
              maxLength={2000}
            />

            <TouchableOpacity
              style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: (editingMsg ? text.trim() : (text.trim() || photos.length || video)) ? '#e33835' : '#e3383530',
                alignItems: 'center', justifyContent: 'center',
              }}
              onPress={() => void handleSend()}
              disabled={sending || (editingMsg ? !text.trim() && !editingMsg.photos.length && !editingMsg.videos.length : (!text.trim() && !photos.length && !video))}
            >
              {sending ? <ActivityIndicator size="small" color="#fff" /> : <Feather name={editingMsg ? 'check' : 'send'} size={17} color="#fff" />}
            </TouchableOpacity>

            {!!mentionQuery && mentionUsers.length > 0 && (
              <View style={{
                position: 'absolute', left: 48, right: 48, bottom: 48,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
                borderRadius: 12, maxHeight: 160, overflow: 'hidden',
              }}>
                {mentionUsers.map(u => (
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => insertMention(u.username)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}
                  >
                    {u.avatarUrl
                      ? <Image source={{ uri: u.avatarUrl }} style={{ width: 26, height: 26, borderRadius: 13 }} />
                      : (
                        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>{u.username.slice(0, 1).toUpperCase()}</Text>
                        </View>
                      )}
                    <Text style={{ color: theme.text, fontSize: 13 }}>@{u.username}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
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
