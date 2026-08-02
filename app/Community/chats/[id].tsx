import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, FlatList, TouchableOpacity, Image, StatusBar, Platform, Modal, Pressable, Dimensions,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { ConversationInfoSheet } from '../../../components/chat/ConversationInfoSheet';
import { CommunityScreenHeader } from '../../../components/community';
import { reportContent, showBlockUserAlert, showReportContentAlert } from '../../../lib/ugcActions';
import { useChatKeyboard, scrollChatToEndAfterLayout } from '../../../hooks/useChatKeyboard';
import {
  ChatScreenShell,
  ChatMessageList,
  ChatComposer,
  ChatMessageMenu,
  ChatLoadingState,
  mapDmMessageToUnified,
  buildChatActions,
  DM_CAPABILITIES,
  type UnifiedChatMessage,
} from '../../../components/chat/v2';

const API = 'https://v-room.app/api/chat';
const WS = 'https://v-room.app';
const PAGE_SIZE = 30;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface ChatUser {
  id: number;
  username: string;
  avatarUrl: string | null;
  online?: boolean;
  isPremium?: boolean;
  isAdmin?: boolean;
  nickColor?: string | null;
}

interface Message {
  id: number;
  content: string;
  photos: string[];
  createdAt: string;
  senderId: number;
  sender: ChatUser;
  conversationId: number;
  replyTo?: {
    id: number;
    content: string;
    sender: { id: number; username: string };
  } | null;
  reactions?: { emoji: string; count: number; myReaction: boolean }[];
}

interface ConvInfo {
  id: number;
  isGroup: boolean;
  name: string;
  avatarUrl: string | null;
  online: boolean;
  participants: ChatUser[];
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const convId = parseInt(id);
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [conv, setConv] = useState<ConvInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [myId, setMyId] = useState<number | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [infoVisible, setInfoVisible] = useState(false);
  const [menuMsg, setMenuMsg] = useState<UnifiedChatMessage | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef<string>('');
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { listPaddingBottom: chatListPad, inputPaddingBottom: chatInputPad } = useChatKeyboard(listRef);

  const unifiedMessages = useMemo(
    () => messages.map(mapDmMessageToUnified),
    [messages],
  );

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('user');
      const token = (await AsyncStorage.getItem('token')) ?? '';
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
      socket.on('chat:reaction', ({ messageId, reactions }: { messageId: number; reactions: Message['reactions'] }) => {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
      });
      socket.on('chat:typing', ({ isTyping, username }: { isTyping: boolean; username?: string }) => {
        if (!username) return;
        setTypingUsers(prev => {
          const next = { ...prev };
          if (isTyping) next[username] = true;
          else delete next[username];
          return next;
        });
      });

      const applyPresence = ({ userId, online }: { userId: number; online: boolean }) => {
        setConv(prev => {
          if (!prev) return prev;
          const uid = Number(userId);
          return {
            ...prev,
            online: prev.participants.some(p => p.id === uid) ? online : prev.online,
            participants: prev.participants.map(p =>
              p.id === uid ? { ...p, online } : p,
            ),
          };
        });
      };

      socket.on('presence:update', applyPresence);
      socket.on('user:online', applyPresence);
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
      setConv(await r.json());
    } catch (e) { console.error('fetchConv:', e); }
  };

  const fetchMessages = async (token: string) => {
    setLoading(true);
    try {
      const r = await fetch(
        `${API}/conversations/${convId}/messages?limit=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d = await r.json();
      setMessages(d.messages ?? []);
      setNextCursor(d.nextCursor ?? null);
      setHasMore(!!d.nextCursor);
      scrollChatToEndAfterLayout(listRef, false);
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
      const d = await r.json();
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
    setText('');
    setPhotos([]);
    setReplyTo(null);

    const form = new FormData();
    if (t) form.append('content', t);
    if (reply?.id) form.append('replyToId', String(reply.id));
    p.forEach((uri, i) => {
      form.append('photos', { uri, type: 'image/jpeg', name: `photo_${i}.jpg` } as any);
    });

    try {
      await fetch(`${API}/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
        body: form,
      });
    } catch (e) { console.error('sendMessage:', e); }
  }, [text, photos, replyTo, convId]);

  const emitTyping = useCallback(() => {
    socketRef.current?.emit('chat:typing', { conversationId: convId, isTyping: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.emit('chat:typing', { conversationId: convId, isTyping: false });
    }, 2000);
  }, [convId]);

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

  const handleReact = useCallback(async (msgId: number, emoji: string) => {
    try {
      const msg = messages.find(m => m.id === msgId);
      const hasMine = !!msg?.reactions?.find(r => r.emoji === emoji)?.myReaction;
      const endpoint = hasMine
        ? `${API}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`
        : `${API}/messages/${msgId}/reactions`;
      const res = await fetch(endpoint, {
        method: hasMine ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        ...(hasMine ? {} : { body: JSON.stringify({ emoji }) }),
      });
      if (!res.ok) Toast.show({ type: 'error', text1: 'Nie udało się dodać reakcji' });
    } catch {
      Toast.show({ type: 'error', text1: 'Brak połączenia' });
    }
  }, [messages]);

  const handleNavigateRoute = useCallback(async (data: Record<string, unknown>) => {
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId: data.routeId,
      routeName: data.name,
      points: data.points,
      distance: data.distance,
    }));
    router.push('/(tabs)/map');
  }, [router]);

  const otherParticipant = conv?.participants?.find(p => p.id !== myId);
  const convName = conv?.isGroup ? conv.name : (otherParticipant?.username ?? '...');
  const convAvatar = conv?.isGroup ? conv.avatarUrl : (otherParticipant?.avatarUrl ?? null);
  const convOnline = !conv?.isGroup ? (otherParticipant?.online ?? false) : false;

  const typingNames = Object.keys(typingUsers).filter(u => u !== convName || conv?.isGroup);
  const typingText = typingNames.length === 1
    ? `${typingNames[0]} pisze...`
    : typingNames.length > 1
      ? `${typingNames.slice(0, 2).join(', ')} piszą...`
      : null;

  const HEADER_HEIGHT = insets.top + 88;
  const headerIconBtn = {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  const menuActions = menuMsg
    ? buildChatActions({
        message: menuMsg,
        myId,
        capabilities: DM_CAPABILITIES,
        onReply: () => {
          const raw = menuMsg.raw as Message;
          setReplyTo(raw);
        },
        onCopy: () => {
          try {
            require('@react-native-clipboard/clipboard').default.setString(menuMsg.content);
          } catch {}
        },
        onReport: () => {
          const raw = menuMsg.raw as Message;
          showReportContentAlert(reason => {
            void reportContent({
              targetType: 'chat_message',
              targetId: raw.id,
              reason,
              offenderUserId: raw.sender.id,
              details: `authorId=${raw.sender.id}`,
            });
          });
        },
        onBlock: () => {
          const raw = menuMsg.raw as Message;
          showBlockUserAlert(raw.sender.id, raw.sender.username, () => {
            setMessages(prev => prev.filter(m => m.senderId !== raw.sender.id));
          });
        },
      })
    : [];

  return (
    <ChatScreenShell
      keyboardVerticalOffset={Platform.OS === 'ios' ? HEADER_HEIGHT : 0}
      header={
        <>
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
          <CommunityScreenHeader
            breadcrumb="WIADOMOŚCI"
            accentDot={false}
            title=""
            center={
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                onPress={() => setInfoVisible(true)}
                activeOpacity={0.75}
              >
                <View style={{ position: 'relative' }}>
                  {convAvatar ? (
                    <Image
                      source={{ uri: convAvatar }}
                      style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: theme.primaryBorder }}
                    />
                  ) : (
                    <View style={{
                      width: 40, height: 40, borderRadius: 20,
                      backgroundColor: theme.primaryBg, borderWidth: 2, borderColor: theme.primaryBorder,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900' }}>
                        {convName?.slice(0, 2).toUpperCase() ?? '??'}
                      </Text>
                    </View>
                  )}
                  {!conv?.isGroup && (
                    <View style={{
                      position: 'absolute', bottom: 0, right: 0,
                      width: 11, height: 11, borderRadius: 6,
                      backgroundColor: convOnline ? theme.online : theme.textDim,
                      borderWidth: 2, borderColor: theme.surface,
                    }} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                    {convName}
                  </Text>
                  {typingText ? (
                    <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8, fontStyle: 'italic' }}>
                      {typingText}
                    </Text>
                  ) : (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5,
                      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
                      backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border,
                    }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: convOnline ? theme.online : theme.textDim }} />
                      <Text style={{ color: convOnline ? theme.online : theme.textDim, fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1, fontWeight: '700' }}>
                        {convOnline ? 'ONLINE' : 'OFFLINE'}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            }
            right={
              <TouchableOpacity style={headerIconBtn} onPress={() => setInfoVisible(true)}>
                <Feather name="info" size={17} color={theme.textDim} />
              </TouchableOpacity>
            }
          />
        </>
      }
      footer={
        <ChatComposer
          text={text}
          onChangeText={t => { setText(t); emitTyping(); }}
          onSend={handleSend}
          onAttach={handlePickPhoto}
          onClear={() => { setText(''); setReplyTo(null); }}
          attachments={photos}
          onRemoveAttachment={i => setPhotos(prev => prev.filter((_, j) => j !== i))}
          replyTo={replyTo ? { username: replyTo.sender.username, preview: replyTo.content || '📷 Zdjęcie' } : null}
          onDismissReply={() => setReplyTo(null)}
          inputPaddingBottom={chatInputPad}
        />
      }
    >
      {loading ? (
        <ChatLoadingState />
      ) : (
        <ChatMessageList
          messages={unifiedMessages}
          myId={myId}
          listRef={listRef}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadOlder={loadMore}
          listPaddingBottom={chatListPad}
          capabilities={DM_CAPABILITIES}
          showGroupNames={conv?.isGroup ?? false}
          onLongPressMessage={setMenuMsg}
          onReact={handleReact}
          onPressPhoto={setPreviewPhoto}
          onNavigateRoute={handleNavigateRoute}
        />
      )}

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

      <ChatMessageMenu
        visible={!!menuMsg}
        onClose={() => setMenuMsg(null)}
        actions={menuActions}
        showReactions={DM_CAPABILITIES.reactions}
        onReact={emoji => menuMsg && handleReact(menuMsg.id, emoji)}
      />

      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <Pressable
          style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}
          onPress={() => setPreviewPhoto(null)}
        >
          {!!previewPhoto && (
            <Image
              source={{ uri: previewPhoto }}
              style={{ width: SCREEN_W, height: SCREEN_H * 0.82 }}
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
    </ChatScreenShell>
  );
}
