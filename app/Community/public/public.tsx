import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, FlatList, TouchableOpacity,
  Image, StatusBar, Platform, Modal, Pressable, Dimensions,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';
import { useChatKeyboard, pinChatToBottom } from '../../../hooks/useChatKeyboard';
import { reportContent, showBlockUserAlert, showReportContentAlert } from '../../../lib/ugcActions';
import {
  renderDiscussionBody,
  searchMentionSuggestions,
  resolveMentionUserId,
  type MentionSuggestion,
} from '../community/communityShared';
import {
  ChatScreenShell,
  ChatMessageList,
  ChatComposer,
  ChatMessageMenu,
  ChatLoadingState,
  mapPublicMessageToUnified,
  buildChatActions,
  PUBLIC_CAPABILITIES,
  type UnifiedChatMessage,
} from '../../../components/chat/v2';
import { EntranceIntroGate } from '../../../components/motion';

const API = `${API_URL}/api/public-chat`;

type PublicNotifMode = 'all' | 'mentions_only' | 'muted';
type VroomToastParams = { type?: string; text1?: string; text2?: string; [key: string]: unknown };

function showToast(params: VroomToastParams) {
  Toast.show(params as any);
}

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

const PAGE_SIZE = 40;
const LOAD_OLDER_THRESHOLD = 72;
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

function mergePublicMessages(current: PublicMessage[], incoming: PublicMessage[]) {
  const byId = new Map<number, PublicMessage>();
  for (const msg of current) byId.set(msg.id, msg);
  for (const msg of incoming) byId.set(msg.id, msg);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

export default function PublicChatScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [video, setVideo] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<PublicMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<PublicMessage | null>(null);
  const [myId, setMyId] = useState<number | null>(null);
  const myIdRef = useRef<number | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [menuMsg, setMenuMsg] = useState<UnifiedChatMessage | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionUsers, setMentionUsers] = useState<MentionSuggestion[]>([]);
  const [notifMode, setNotifMode] = useState<PublicNotifMode>('all');
  const [introDone, setIntroDone] = useState(false);
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);

  const listRef = useRef<FlatList>(null);
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef('');
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myUsernameRef = useRef('');
  const stickToNewestRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const nextCursorRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const listLayoutHeightRef = useRef(0);

  const { listPaddingBottom: chatListPad, inputPaddingBottom: chatInputPad } = useChatKeyboard(listRef);

  const scrollToNewest = useCallback((animated = false) => {
    pinChatToBottom(listRef, animated);
  }, []);

  const appendMessage = useCallback((msg: PublicMessage, forceScroll = false) => {
    const shouldStick = forceScroll || stickToNewestRef.current || msg.senderId === myIdRef.current;
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      return mergePublicMessages(prev, [msg]);
    });
    if (shouldStick) {
      stickToNewestRef.current = true;
      setTimeout(() => scrollToNewest(true), 50);
    }
  }, [scrollToNewest]);

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
        setHasMore(!!data.nextCursor);
        nextCursorRef.current = data.nextCursor ?? null;
        hasMoreRef.current = !!data.nextCursor;
        stickToNewestRef.current = true;
      } catch {
        showToast({ type: 'error', text1: 'Błąd', text2: 'Nie udało się załadować czatu.' });
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
    if (loading || didInitialScrollRef.current || messages.length === 0) return;
    didInitialScrollRef.current = true;
    scrollToNewest(false);
  }, [loading, messages.length, scrollToNewest]);

  useFocusEffect(
    useCallback(() => {
      if (loading) return;
      stickToNewestRef.current = true;
      scrollToNewest(false);
    }, [loading, scrollToNewest]),
  );

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
      showToast({
        type: 'success',
        text1: mode === 'all' ? 'Powiadomienia włączone' : mode === 'mentions_only' ? 'Tylko oznaczenia (@)' : 'Powiadomienia wyciszone',
      });
    } catch {
      showToast({ type: 'error', text1: 'Nie udało się zapisać ustawień' });
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
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current || !hasMoreRef.current) return;
    stickToNewestRef.current = false;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const data = await fetchMessages(tokenRef.current, cursor);
      if ((data.messages ?? []).length === 0) {
        hasMoreRef.current = false;
        setHasMore(false);
        return;
      }
      setMessages(prev => mergePublicMessages(prev, data.messages ?? []));
      nextCursorRef.current = data.nextCursor ?? null;
      hasMoreRef.current = !!data.nextCursor;
      setHasMore(!!data.nextCursor);
    } catch { /* ignore */ }
    finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchMessages]);

  const pickPhotos = async () => {
    if (video) return;
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
  }, []);

  const startEdit = useCallback((msg: PublicMessage) => {
    setEditingMsg(msg);
    setReplyTo(null);
    setPhotos([]);
    setVideo(null);
    setText(msg.content ?? '');
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
        showToast({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie udało się edytować wiadomości.' });
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
      appendMessage(msg, true);
    } catch (e: any) {
      showToast({ type: 'error', text1: 'BŁĄD', text2: e.message ?? 'Nie wysłano wiadomości.' });
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
        showToast({ type: 'error', text1: 'Nie udało się dodać reakcji' });
        return;
      }
      const data = await res.json();
      setMessages(prev => prev.map(m => (
        m.id === msgId ? { ...m, reactions: data.reactions ?? [] } : m
      )));
    } catch {
      showToast({ type: 'error', text1: 'Brak połączenia' });
    }
  }, [messages]);

  const typingNames = Object.keys(typingUsers);
  const typingText = typingNames.length === 1
    ? `${typingNames[0]} pisze...`
    : typingNames.length > 1
      ? `${typingNames.slice(0, 2).join(', ')} piszą...`
      : null;

  const unifiedMessages = useMemo(() => messages.map(mapPublicMessageToUnified), [messages]);

  const renderPublicBody = useCallback((content: string, isMe: boolean) => (
    <Text style={{ fontSize: 14, lineHeight: 20 }}>
      {renderDiscussionBody(content, theme, {
        textColor: isMe ? '#fff' : theme.text,
        mentionColor: isMe ? '#b8e8ff' : '#4a9eff',
        linkColor: isMe ? '#9fd4ff' : '#4a9eff',
        onMentionPress: handleMentionPress,
      })}
    </Text>
  ), [theme, handleMentionPress]);

  const publicMenuActions = menuMsg
    ? buildChatActions({
        message: menuMsg,
        myId,
        capabilities: PUBLIC_CAPABILITIES,
        isModerator: false,
        onReply: () => setReplyTo(menuMsg.raw as PublicMessage),
        onEdit: () => startEdit(menuMsg.raw as PublicMessage),
        onCopy: () => {
          try {
            require('@react-native-clipboard/clipboard').default.setString(menuMsg.content);
          } catch {}
        },
        onReport: () => {
          const raw = menuMsg.raw as PublicMessage;
          showReportContentAlert(reason => {
            void reportContent({
              targetType: 'public_chat_message',
              targetId: raw.id,
              reason,
              offenderUserId: raw.sender.id,
            });
          });
        },
        onBlock: () => {
          const raw = menuMsg.raw as PublicMessage;
          showBlockUserAlert(raw.sender.id, raw.sender.username, () => {
            setMessages(prev => prev.filter(m => m.senderId !== raw.sender.id));
          });
        },
      })
    : [];

  if (loading && messages.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
        <CommunityScreenHeader
          title="CZAT OGÓLNY"
          subtitle="LIVE · CAŁA SPOŁECZNOŚĆ"
          right={<MaterialCommunityIcons name="earth" size={22} color={theme.success} />}
        />
        <ChatLoadingState />
      </View>
    );
  }

  const mentionOverlay = !!mentionQuery && mentionUsers.length > 0 ? (
    <View style={{
      marginHorizontal: 12, marginBottom: 6,
      backgroundColor: isDark ? 'rgba(22,22,22,0.96)' : 'rgba(255,255,255,0.96)',
      borderRadius: 14, maxHeight: 140, overflow: 'hidden',
      borderWidth: 1, borderColor: theme.border2,
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
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
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
  ) : null;

  return (
    <ChatScreenShell
      header={
        <>
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
        </>
      }
      footer={
        <ChatComposer
          text={text}
          onChangeText={onInputChange}
          onSend={() => void handleSend()}
          onAttach={pickPhotos}
          onAttachVideo={pickVideo}
          showVideoAttach={!editingMsg}
          hasVideo={!!video}
          onRemoveVideo={() => setVideo(null)}
          onClear={() => { setText(''); setReplyTo(null); cancelEdit(); }}
          attachments={editingMsg ? [] : photos}
          onRemoveAttachment={i => setPhotos(prev => prev.filter((_, j) => j !== i))}
          replyTo={replyTo ? { username: replyTo.sender.username, preview: replyPreviewLabel(replyTo) } : null}
          onDismissReply={() => setReplyTo(null)}
          editing={editingMsg ? { preview: replyPreviewLabel(editingMsg) } : null}
          onDismissEdit={cancelEdit}
          inputPaddingBottom={chatInputPad}
          placeholder={editingMsg ? 'Edytuj treść...' : 'Napisz wiadomość...'}
          disabled={!!editingMsg && false}
          sending={sending}
          sendIcon={editingMsg ? 'check' : 'send'}
          showAttach={!editingMsg}
          overlay={mentionOverlay}
        />
      }
    >
      <ChatMessageList
        messages={unifiedMessages}
        myId={myId}
        listRef={listRef}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadOlder={loadMore}
        listPaddingBottom={chatListPad}
        capabilities={PUBLIC_CAPABILITIES}
        showGroupNames
        onLongPressMessage={setMenuMsg}
        onReact={handleReact}
        onPressPhoto={uri => setPreviewPhoto(normalizeUri(uri))}
        renderBody={(content, isMe) => renderPublicBody(content, isMe)}
        emptyTitle="Napisz pierwszą wiadomość!"
        listProps={{
          contentContainerStyle: {
            paddingTop: 8,
            flexGrow: messages.length > 0 ? 1 : undefined,
            justifyContent: messages.length > 0 ? 'flex-end' : undefined,
          },
          onLayout: (e) => { listLayoutHeightRef.current = e.nativeEvent.layout.height; },
          onScroll: (e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const viewH = layoutMeasurement.height > 0 ? layoutMeasurement.height : listLayoutHeightRef.current;
            const distFromBottom = contentSize.height - viewH - contentOffset.y;
            stickToNewestRef.current = distFromBottom < 160;
            if (
              contentOffset.y <= LOAD_OLDER_THRESHOLD
              && contentSize.height > viewH + LOAD_OLDER_THRESHOLD
              && hasMoreRef.current
              && !loadingMoreRef.current
            ) {
              void loadMore();
            }
          },
          scrollEventThrottle: 16,
          onContentSizeChange: () => {
            if (stickToNewestRef.current) {
              scrollToNewest(false);
            }
          },
          onScrollToIndexFailed: (info) => {
            setTimeout(() => {
              listRef.current?.scrollToEnd({ animated: false });
              setTimeout(() => {
                listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 1 });
              }, 80);
            }, 80);
          },
        }}
      />

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

      <ChatMessageMenu
        visible={!!menuMsg}
        onClose={() => setMenuMsg(null)}
        actions={publicMenuActions}
        showReactions={PUBLIC_CAPABILITIES.reactions}
        onReact={emoji => menuMsg && void handleReact(menuMsg.id, emoji)}
      />
      {!introDone && (
        <EntranceIntroGate
          presetId="live-chat"
          screenKey="public_chat"
          onIntroDone={() => setIntroDone(true)}
        />
      )}
    </ChatScreenShell>
  );
}
