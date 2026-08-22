import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, FlatList, TouchableOpacity, Image, StatusBar, Platform, Modal, Pressable, Dimensions,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { ConversationInfoSheet } from '../../../components/chat/ConversationInfoSheet';
import { CommunityScreenHeader } from '../../../components/community';
import { reportContent, showBlockUserAlert, showReportContentAlert } from '../../../lib/ugcActions';
import { useChatKeyboard, scrollChatToEndAfterLayout } from '../../../hooks/useChatKeyboard';
import { apiRequest } from '../../../lib/api/client';
import { currentSharedSocket, joinSharedRoom, subscribeSharedSocket } from '../../../lib/sharedSocket';
import {
  copyMediaToSocialQueue,
  enqueueSocialOperation,
  listSocialOperations,
  removeSocialOperation,
  retrySocialOperation,
  subscribeSocialQueue,
} from '../../../lib/socialQueue';
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
  clientRequestId?: string | null;
  deliveryStatus?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deliveryError?: string | null;
}

interface ConvInfo {
  id: number;
  isGroup: boolean;
  name: string;
  avatarUrl: string | null;
  online: boolean;
  participants: ChatUser[];
}

type MessagePage = { items: Message[]; nextCursor: string | null; hasMore: boolean };
type MessageAck = { operationId: string; status: 'accepted' | 'completed'; entity: Message };

function mergeMessage(current: Message[], incoming: Message): Message[] {
  const index = current.findIndex((message) => (
    message.id === incoming.id
    || (!!incoming.clientRequestId && message.clientRequestId === incoming.clientRequestId)
  ));
  if (index < 0) return [...current, incoming];
  const next = [...current];
  next[index] = { ...current[index], ...incoming };
  return next;
}

function operationId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function ChatScreen() {
  const { id, messageId } = useLocalSearchParams<{ id: string; messageId?: string }>();
  const router = useRouter();
  const isFocused = useIsFocused();
  const convId = parseInt(id);
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [conv, setConv] = useState<ConvInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [myId, setMyId] = useState<number | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [infoVisible, setInfoVisible] = useState(false);
  const [menuMsg, setMenuMsg] = useState<UnifiedChatMessage | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftHydratedRef = useRef(false);
  const draftKey = `@vroom/chat_draft:v1:${convId}`;

  const { listPaddingBottom: chatListPad, inputPaddingBottom: chatInputPad } = useChatKeyboard(listRef);

  const unifiedMessages = useMemo(
    () => messages.map(mapDmMessageToUnified),
    [messages],
  );

  useEffect(() => {
    let active = true;
    draftHydratedRef.current = false;
    void AsyncStorage.getItem(draftKey).then((stored) => {
      if (!active) return;
      if (stored) {
        try {
          const draft = JSON.parse(stored) as { text?: string; photos?: string[] };
          setText(typeof draft.text === 'string' ? draft.text : '');
          setPhotos(Array.isArray(draft.photos)
            ? draft.photos.filter((uri): uri is string => typeof uri === 'string')
            : []);
        } catch { /* invalid or old draft is replaced by the current schema */ }
      }
      draftHydratedRef.current = true;
    });
    return () => { active = false; };
  }, [draftKey]);

  useEffect(() => {
    if (!draftHydratedRef.current) return undefined;
    const timer = setTimeout(() => {
      if (text.trim() || photos.length) {
        void AsyncStorage.setItem(draftKey, JSON.stringify({ text, photos }));
      } else {
        void AsyncStorage.removeItem(draftKey);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [draftKey, photos, text]);

  useEffect(() => {
    if (!messageId || loading || !unifiedMessages.length) return;
    const index = unifiedMessages.findIndex((message) => message.id === Number(messageId));
    if (index < 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    }, 180);
    return () => clearTimeout(timer);
  }, [loading, messageId, unifiedMessages]);

  useEffect(() => {
    if (!isFocused) return;
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const applyPresence = ({ userId, online }: { userId: number; online: boolean }) => {
      setConv(prev => {
        if (!prev) return prev;
        const uid = Number(userId);
        return {
          ...prev,
          online: prev.participants.some(p => p.id === uid) ? online : prev.online,
          participants: prev.participants.map(p => p.id === uid ? { ...p, online } : p),
        };
      });
    };

    void (async () => {
      const raw = await AsyncStorage.getItem('user');
      if (raw) {
        try {
          const user = JSON.parse(raw) as { id?: number; userId?: number };
          setMyId(Number(user.userId ?? user.id) || null);
        } catch { /* session bootstrap will refresh malformed local data */ }
      }
      if (disposed) return;

      const queued = await listSocialOperations({ entityKey: `chat:${convId}` });
      if (!disposed && queued.length) {
        setMessages(prev => queued.reduce((all, row) => {
          const entity = row.request.optimisticEntity as Message | undefined;
          return entity
            ? mergeMessage(all, {
                ...entity,
                clientRequestId: row.operationId,
                deliveryStatus: row.status === 'failed' ? 'failed' : 'sending',
              })
            : all;
        }, prev));
      }

      const unsubscribers = await Promise.all([
        joinSharedRoom(`chat:${convId}`, 'chat:join', 'chat:leave', convId),
        subscribeSharedSocket<Message>('chat:message', (msg) => {
          if (msg.conversationId !== convId) return;
          setMessages(prev => mergeMessage(prev, { ...msg, deliveryStatus: msg.deliveryStatus || 'sent' }));
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
        }),
        subscribeSharedSocket<{ messageId: number; reactions: Message['reactions'] }>('chat:reaction', ({ messageId: incomingId, reactions }) => {
          setMessages(prev => prev.map(message => message.id === incomingId ? { ...message, reactions } : message));
        }),
        subscribeSharedSocket<{ conversationId: number; userId: number; messageId: number }>('chat:read', (receipt) => {
          if (receipt.conversationId !== convId) return;
          setMessages(prev => prev.map(message => (
            message.id > 0 && message.id <= receipt.messageId && message.senderId !== receipt.userId
              ? { ...message, deliveryStatus: 'read' }
              : message
          )));
        }),
        subscribeSharedSocket<{ isTyping: boolean; username?: string }>('chat:typing', ({ isTyping, username }) => {
          if (!username) return;
          setTypingUsers(prev => {
            const next = { ...prev };
            if (isTyping) next[username] = true;
            else delete next[username];
            return next;
          });
        }),
        subscribeSharedSocket<{ userId: number; online: boolean }>('presence:update', applyPresence),
        subscribeSharedSocket<{ userId: number; online: boolean }>('user:online', applyPresence),
      ]);
      if (disposed) unsubscribers.forEach(unsubscribe => unsubscribe());
      else cleanups.push(...unsubscribers);
      await Promise.all([fetchConv(), fetchMessages()]);
    })();

    const unsubscribeQueue = subscribeSocialQueue((event) => {
      if (event.entityKey !== `chat:${convId}`) return;
      if (event.status === 'failed') {
        setMessages(prev => prev.map(message => message.clientRequestId === event.operationId
          ? { ...message, deliveryStatus: 'failed', deliveryError: event.error || 'Nie udało się wysłać' }
          : message));
        return;
      }
      if (event.status === 'pending' || event.status === 'sending') {
        setMessages(prev => prev.map(message => message.clientRequestId === event.operationId
          ? { ...message, deliveryStatus: 'sending' }
          : message));
        return;
      }
      const response = event.response as MessageAck | Message | undefined;
      const entity = response && 'entity' in response ? response.entity : response;
      if (entity && typeof entity.id === 'number') {
        setMessages(prev => mergeMessage(
          prev.filter(message => message.clientRequestId !== event.operationId || message.id < 0),
          { ...entity, clientRequestId: entity.clientRequestId || event.operationId, deliveryStatus: 'sent' },
        ));
      }
    });

    return () => {
      disposed = true;
      cleanups.forEach(cleanup => cleanup());
      unsubscribeQueue();
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [convId, isFocused]);

  const fetchConv = async () => {
    try {
      setConv(await apiRequest<ConvInfo>(`/chat/conversations/${convId}`, { priority: 'critical' }));
    } catch (e) { console.error('fetchConv:', e); }
  };

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const page = await apiRequest<MessagePage>(`/v2/chat/conversations/${convId}/messages?limit=${PAGE_SIZE}`, { priority: 'critical' });
      setMessages(current => {
        const optimistic = current.filter(message => message.deliveryStatus === 'sending' || message.deliveryStatus === 'failed');
        return optimistic.reduce((all, message) => mergeMessage(all, message), page.items ?? []);
      });
      setNextCursor(page.nextCursor ?? null);
      setHasMore(page.hasMore);
      scrollChatToEndAfterLayout(listRef, false);
    } catch (e) { console.error('fetchMessages:', e); }
    finally { setLoading(false); }
  };

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await apiRequest<MessagePage>(
        `/v2/chat/conversations/${convId}/messages?cursor=${encodeURIComponent(nextCursor)}&limit=${PAGE_SIZE}`,
        { priority: 'visible' },
      );
      const msgs = page.items ?? [];
      if (msgs.length === 0) { setHasMore(false); return; }
      setMessages(prev => [...msgs, ...prev]);
      setNextCursor(page.nextCursor ?? null);
      setHasMore(page.hasMore);
    } catch (e) { console.error('loadMore:', e); }
    finally { setLoadingMore(false); }
  }, [convId, nextCursor, loadingMore, hasMore]);

  const handleSend = useCallback(async () => {
    if (!text.trim() && !photos.length) return;
    const t = text.trim();
    const p = [...photos];
    const reply = replyTo;
    const clientRequestId = operationId();
    const sender = conv?.participants.find(participant => participant.id === myId) || {
      id: myId || 0,
      username: 'TY',
      avatarUrl: null,
    };
    const optimistic: Message = {
      id: -Date.now(),
      content: t,
      photos: p,
      createdAt: new Date().toISOString(),
      senderId: myId || sender.id,
      sender,
      conversationId: convId,
      replyTo: reply ? {
        id: reply.id,
        content: reply.content,
        sender: { id: reply.sender.id, username: reply.sender.username },
      } : null,
      clientRequestId,
      deliveryStatus: 'sending',
    };
    setMessages(prev => mergeMessage(prev, optimistic));
    setText('');
    setPhotos([]);
    setReplyTo(null);
    void AsyncStorage.removeItem(draftKey);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 30);

    try {
      if (!myId) throw new Error('Brak aktywnego użytkownika');
      const queuedPhotos = await Promise.all(p.map(copyMediaToSocialQueue));
      await enqueueSocialOperation({
        userId: myId,
        type: 'chat.message.send',
        entityKey: `chat:${convId}`,
        operationId: clientRequestId,
        request: queuedPhotos.length ? {
          path: `/chat/conversations/${convId}/messages`,
          method: 'POST',
          multipart: {
            fields: {
              ...(t ? { content: t } : {}),
              ...(reply?.id && reply.id > 0 ? { replyToId: String(reply.id) } : {}),
              clientRequestId,
            },
            files: queuedPhotos.map((uri, index) => ({
              fieldName: 'photos',
              uri,
              type: 'image/jpeg',
              name: `photo_${index}.jpg`,
            })),
          },
          invalidateKeys: [['chat', 'conversations']],
          optimisticEntity: { ...optimistic, photos: queuedPhotos },
        } : {
          path: `/v2/chat/conversations/${convId}/messages`,
          method: 'POST',
          body: {
            content: t,
            ...(reply?.id && reply.id > 0 ? { replyToId: reply.id } : {}),
            clientRequestId,
          },
          invalidateKeys: [['chat', 'conversations']],
          optimisticEntity: optimistic,
        },
      });
    } catch (e) {
      setMessages(prev => prev.map(message => message.clientRequestId === clientRequestId
        ? { ...message, deliveryStatus: 'failed', deliveryError: e instanceof Error ? e.message : 'Nie udało się wysłać' }
        : message));
    }
  }, [text, photos, replyTo, convId, draftKey, conv, myId]);

  const emitTyping = useCallback(() => {
    currentSharedSocket()?.emit('chat:typing', { conversationId: convId, isTyping: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      currentSharedSocket()?.emit('chat:typing', { conversationId: convId, isTyping: false });
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
        ? `/chat/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`
        : `/chat/messages/${msgId}/reactions`;
      await apiRequest(endpoint, {
        method: hasMine ? 'DELETE' : 'POST',
        ...(hasMine ? {} : { body: { emoji } }),
      });
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

  const renderDeliveryFooter = useCallback((message: UnifiedChatMessage) => {
    if (message.deliveryStatus !== 'failed' || !message.clientRequestId) return null;
    const requestId = message.clientRequestId;
    return (
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginRight: 6, marginBottom: 8 }}>
        <TouchableOpacity onPress={() => retrySocialOperation(requestId)}>
          <Text style={{ color: theme.primary, fontSize: 10 }}>SPRÓBUJ PONOWNIE</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          void removeSocialOperation(requestId);
          setMessages(prev => prev.filter(item => item.clientRequestId !== requestId));
        }}>
          <Text style={{ color: theme.textDim, fontSize: 10 }}>USUŃ</Text>
        </TouchableOpacity>
      </View>
    );
  }, [theme.primary, theme.textDim]);

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
          renderMessageFooter={renderDeliveryFooter}
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
