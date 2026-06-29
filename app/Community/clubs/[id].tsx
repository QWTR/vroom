import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  Image, ActivityIndicator, KeyboardAvoidingView, Keyboard,
  Platform, Modal, Pressable, ScrollView, Dimensions, Alert, Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather }                from '@expo/vector-icons';
import MaterialIcons              from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons     from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker           from 'expo-image-picker';
import { LinearGradient }         from 'expo-linear-gradient';
import AsyncStorage               from '@react-native-async-storage/async-storage';
import { useModalSheetPadding } from '../../../components/layout/ModalKeyboardSheet';
import { io, Socket }             from 'socket.io-client';
import Toast                      from 'react-native-toast-message';
import { useTheme }               from '../../../contexts/ThemeContext';
import { API_URL, SOCKET_URL }    from '../../../constants/config';
import { UAv }                    from '../../../components/clubs/ClubCard';
import { Club }                   from '../../../components/clubs/types';
import EditClubModal              from '../../../components/clubs/EditClubModal';
import { renderDiscussionBody }   from '../community/communityShared';
import { filterProvinceSuggestions } from '../../../constants/provinces';
import { ProvinceBadge } from '../../../components/user/ProvinceBadge';
import { reportContent, showBlockUserAlert, showReportContentAlert } from '../../../lib/ugcActions';
import { useChatKeyboard, scrollChatToEndAfterLayout } from '../../../hooks/useChatKeyboard';
import { CommunityScreenHeader } from '../../../components/community';
import {
  ChatMessageList,
  ChatComposer,
  ChatMessageMenu,
  ChatLoadingState,
  mapClubMessageToUnified,
  buildChatActions,
  CLUB_CAPABILITIES,
  type UnifiedChatMessage,
} from '../../../components/chat/v2';
import { EntranceIntroGate } from '../../../components/motion';

const WS_URL   = SOCKET_URL;
const getToken = async () => (
  (await AsyncStorage.getItem('userToken'))
  ?? (await AsyncStorage.getItem('token'))
);
const PAGE     = 30;

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
  sender:  { id: number; username: string; avatarUrl: string | null; province?: string | null };
  replyTo: { id: number; content: string | null; sender: { id: number; username: string } } | null;
  reactions?: { emoji: string; count: number; myReaction: boolean }[];
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
  const [menuMsg,     setMenuMsg]     = useState<UnifiedChatMessage | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const shareSheetPadding = useModalSheetPadding(shareVisible);
  const [shareText, setShareText] = useState('');
  const [sharing, setSharing] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<'channels' | 'chat' | 'members'>('chat');
  const paneRef = useRef<ScrollView>(null);
  const [memberModal, setMemberModal] = useState<any | null>(null);
  const [pushMuteBusy, setPushMuteBusy] = useState(false);
  const tabSlide = useRef(new Animated.Value(Dimensions.get('window').width / 3)).current;
  const tabHapticSkip = useRef(true);

  const listRef   = useRef<FlatList<UnifiedChatMessage>>(null);
  const { listPaddingBottom: chatListPad, inputPaddingBottom: chatInputPad } = useChatKeyboard(listRef, {
    parentUsesKeyboardAvoiding: Platform.OS === 'ios',
  });
  const socketRef = useRef<Socket | null>(null);
  const tokenRef  = useRef('');
  const mountedRef = useRef(true);
  const scrollTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeChannelIdRef = useRef<number | null>(null);
  activeChannelIdRef.current = activeChannelId;

  const scheduleScrollToEnd = useCallback((animated = true) => {
    const id = setTimeout(() => {
      if (mountedRef.current) {
        listRef.current?.scrollToEnd({ animated });
      }
    }, 80);
    scrollTimeoutsRef.current.push(id);
  }, []);

  const handleBack = useCallback(() => {
    Keyboard.dismiss();
    router.back();
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      return () => {
        Keyboard.dismiss();
      };
    }, []),
  );

  useEffect(() => {
    paneRef.current?.scrollTo({ x: Dimensions.get('window').width, animated: false });
  }, []);

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
    mountedRef.current = true;

    const onMessage = (msg: ClubMessage) => {
      if (msg.clubId === clubId && activeChannelIdRef.current != null && msg.channelId === activeChannelIdRef.current) {
        if (!mountedRef.current) return;
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        scheduleScrollToEnd();
      }
    };
    const onMessageDeleted = ({ id: msgId }: { id: number }) => {
      if (!mountedRef.current) return;
      setMessages(prev => prev.filter(m => m.id !== msgId));
      setPinned(prev => prev.filter(m => m.id !== msgId));
    };
    const onPinned = (msg: ClubMessage) => {
      if (!mountedRef.current) return;
      setPinned(prev => [msg, ...prev.filter(m => m.id !== msg.id)].slice(0, 5));
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isPinned: true } : m));
    };
    const onUnpinned = ({ id: msgId }: { id: number }) => {
      if (!mountedRef.current) return;
      setPinned(prev => prev.filter(m => m.id !== msgId));
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isPinned: false } : m));
    };
    const onReaction = ({ messageId, reactions }: { messageId: number; reactions: any[] }) => {
      if (!mountedRef.current) return;
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
      setPinned(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    };

    (async () => {
      const token = await getToken() ?? '';
      if (!mountedRef.current) return;
      tokenRef.current = token;

      const raw = await AsyncStorage.getItem('user');
      if (raw && mountedRef.current) setMyId(JSON.parse(raw).userId);

      const clubRes = await fetch(`${API_URL}/api/clubs/${clubId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (clubRes.ok && mountedRef.current) {
        const club = await clubRes.json();
        setClubName(club.name);
        setMyRole(club.myRole);
        setMyRank(club.myRank);
        setClubData(club);
      }

      const structRes = await fetch(`${API_URL}/api/clubs/${clubId}/structure`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (structRes.ok && mountedRef.current) {
        const s = await structRes.json();
        setCategories(s.categories ?? []);
        setChannels(s.channels ?? []);
        const general = (s.channels ?? []).find((c: any) => c.isDefaultGeneral) ?? (s.channels ?? [])[0];
        const hasInitial = Number.isFinite(initialChannelId) && (s.channels ?? []).some((c: any) => c.id === initialChannelId);
        setActiveChannelId(hasInitial ? initialChannelId : (general?.id ?? null));
      }

      if (!mountedRef.current) return;

      const socket = io(WS_URL, { auth: { token }, transports: ['websocket'] });
      socket.emit('club:join', clubId);
      socket.on('club:message', onMessage);
      socket.on('club:message_deleted', onMessageDeleted);
      socket.on('club:pinned', onPinned);
      socket.on('club:unpinned', onUnpinned);
      socket.on('club:reaction', onReaction);
      socketRef.current = socket;

      await loadMessages(token, undefined, activeChannelIdRef.current ?? undefined);
    })();

    return () => {
      mountedRef.current = false;
      scrollTimeoutsRef.current.forEach(clearTimeout);
      scrollTimeoutsRef.current = [];
      const socket = socketRef.current;
      if (socket) {
        socket.off('club:message', onMessage);
        socket.off('club:message_deleted', onMessageDeleted);
        socket.off('club:pinned', onPinned);
        socket.off('club:unpinned', onUnpinned);
        socket.off('club:reaction', onReaction);
        socket.emit('club:leave', clubId);
        socket.disconnect();
        socketRef.current = null;
      }
    };
  }, [clubId, initialChannelId, scheduleScrollToEnd]);

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
      if (!mountedRef.current) return;
      if (cur) setMessages(prev => [...(data.messages ?? []), ...prev]);
      else     setMessages(data.messages ?? []);
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
      setPinned(data.pinned ?? []);
      if (!cur) scrollChatToEndAfterLayout(listRef, false);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
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
      scheduleScrollToEnd();
    } catch {
      Toast.show({ type: 'error', text1: 'Brak połączenia' });
      setText(prevText);
      setPhotos(prevPhotos);
      setReplyTo(prevReply);
    } finally { setSending(false); }
  }, [text, photos, replyTo, clubId, activeChannelId, scheduleScrollToEnd]);

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

  const unifiedMessages = useMemo(
    () => messages.map(mapClubMessageToUnified),
    [messages],
  );

  const handleMentionPress = useCallback((username: string) => {
    const member = (clubData?.members ?? []).find(
      (m: any) => m.username?.toLowerCase() === username.toLowerCase(),
    );
    if (member?.userId) {
      router.push({ pathname: '/profile/[userId]', params: { userId: String(member.userId) } });
    }
  }, [clubData?.members, router]);

  const renderClubBody = useCallback((content: string, isMe: boolean) => (
    <Text style={{ fontSize: 14, lineHeight: 20 }}>
      {renderDiscussionBody(
        content,
        theme,
        isMe
          ? {
              textColor: '#ffffff',
              mentionColor: '#b8e8ff',
              linkColor: '#9fd4ff',
              onMentionPress: handleMentionPress,
            }
          : {
              textColor: theme.textMuted,
              mentionColor: '#4a9eff',
              onMentionPress: handleMentionPress,
            },
      )}
    </Text>
  ), [theme, handleMentionPress]);

  const mentionSuggestions = (() => {
    if (!mentionQuery) return [];
    const provinces = filterProvinceSuggestions(mentionQuery, 3).map(p => ({
      kind: 'province' as const,
      key: `p-${p.slug}`,
      tag: p.mention,
      label: p.label,
    }));
    const members = (clubData?.members ?? [])
      .filter((m: any) => m.username.toLowerCase().includes(mentionQuery.toLowerCase()))
      .slice(0, 6)
      .map((m: any) => ({
        kind: 'member' as const,
        key: `m-${m.id}`,
        tag: m.username,
        label: m.username,
        avatarUrl: m.avatarUrl,
      }));
    return [...provinces, ...members];
  })();

  const menuActions = menuMsg
    ? buildChatActions({
        message: menuMsg,
        myId,
        capabilities: CLUB_CAPABILITIES,
        isModerator: canPin || canKick,
        onReply: () => {
          const raw = menuMsg.raw as ClubMessage;
          setReplyTo(raw);
        },
        onPin: canPin
          ? () => {
              const raw = menuMsg.raw as ClubMessage;
              handlePin(raw.id, !!raw.isPinned);
            }
          : undefined,
        onDelete: () => {
          const raw = menuMsg.raw as ClubMessage;
          if (raw.senderId === myId || canKick) handleDelete(raw.id);
        },
        onCopy: () => {
          try {
            require('@react-native-clipboard/clipboard').default.setString(menuMsg.content);
          } catch {}
        },
        onReport: () => {
          const raw = menuMsg.raw as ClubMessage;
          showReportContentAlert((reason) => {
            void reportContent({
              targetType: 'club_message',
              targetId: raw.id,
              reason,
              offenderUserId: raw.senderId,
              details: `authorId=${raw.senderId}`,
            });
          });
        },
        onBlock: () => {
          const raw = menuMsg.raw as ClubMessage;
          showBlockUserAlert(raw.senderId, raw.sender.username, () => {
            setMessages((prev) => prev.filter((m) => m.senderId !== raw.senderId));
          });
        },
      })
    : [];

  const mentionOverlay = !!mentionQuery && mentionSuggestions.length > 0 ? (
    <View style={{
      marginHorizontal: 12, marginBottom: 6,
      backgroundColor: isDark ? 'rgba(22,22,22,0.96)' : 'rgba(255,255,255,0.96)',
      borderRadius: 14, maxHeight: 140, overflow: 'hidden',
      borderWidth: 1, borderColor: theme.border2,
    }}>
      {mentionSuggestions.map((u) => (
        <TouchableOpacity
          key={u.key}
          onPress={() => {
            setText(prev => prev.replace(/@([a-zA-Z0-9_.-]*)$/, `@${u.tag} `));
            setMentionQuery(null);
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}
        >
          {u.kind === 'member' ? (
            <UAv uri={u.avatarUrl} name={u.label} size={22} />
          ) : (
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#7cb34222', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="map" size={12} color="#7cb342" />
            </View>
          )}
          <View>
            <Text style={{ color: theme.text, fontSize: 12 }}>@{u.tag}</Text>
            {u.kind === 'province' && (
              <Text style={{ color: theme.textDim, fontSize: 9 }}>{u.label}</Text>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  ) : null;

  // ── Render ────────────────────────────────────────────────
  const HEADER_HEIGHT = insets.top + 132;
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
    const method = isMuted ? 'DELETE' : 'POST';
    await fetch(`${API_URL}/api/clubs/${clubId}/members/${memberModal.userId}/mute`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: method === 'POST' ? JSON.stringify({ durationMinutes: 60 }) : undefined,
    });
    await refreshClub();
  };

  const kickMember = () => {
    if (!memberModal) return;
    const username = memberModal.username ?? 'użytkownika';
    Alert.alert(
      `Wyrzuć ${username}`,
      'Na pewno wyrzucić tego użytkownika z klubu?',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wyrzuć',
          style: 'destructive',
          onPress: async () => {
            const token = await getToken() ?? '';
            const res = await fetch(`${API_URL}/api/clubs/${clubId}/members/${memberModal.userId}/kick`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ reason: 'Moderacja klubu' }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              Toast.show({ type: 'error', text1: data.error ?? 'Nie udało się wyrzucić' });
              return;
            }
            Toast.show({ type: 'success', text1: `${username} wyrzucony` });
            setMemberModal(null);
            await refreshClub();
          },
        },
      ],
    );
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
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={[]}>
        <CommunityScreenHeader
          breadcrumb="KLUBY"
          accentDot={false}
          title=""
          onBack={handleBack}
          center={
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialCommunityIcons name="shield-crown" size={14} color={theme.primary} />
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                  {clubName}
                </Text>
              </View>
              <Text style={{ color: theme.textDim, fontSize: 9, fontFamily: 'Orbitron', marginTop: 3 }}>
                {myRole === 'owner' ? 'ZAŁOŻYCIEL' : myRank ? myRank.name.toUpperCase() : 'CZAT KLUBU'}
              </Text>
            </View>
          }
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {clubData?.isMember && (
                <TouchableOpacity
                  style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }}
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
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }}
                onPress={() => setShareVisible(true)}
              >
                <MaterialIcons name="share" size={17} color={theme.textDim} />
              </TouchableOpacity>

              {myRole === 'owner' && (
                <TouchableOpacity
                  style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }}
                  onPress={() => setEditVisible(true)}
                >
                  <MaterialIcons name="settings" size={18} color={theme.textDim} />
                </TouchableOpacity>
              )}

              {pinned.length > 0 && (
                <TouchableOpacity
                  style={[
                    { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border },
                    showPinned ? { backgroundColor: theme.gold + '20' } : { backgroundColor: theme.surface2 },
                  ]}
                  onPress={() => setShowPinned(v => !v)}
                >
                  <MaterialIcons name="push-pin" size={18} color={showPinned ? theme.gold : theme.textDim} />
                </TouchableOpacity>
              )}
            </View>
          }
        />

        <View style={{ backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border, paddingHorizontal: 8, paddingBottom: 8 }}>
          <View style={{ paddingHorizontal: 0 }}>
            <View style={{ flexDirection: 'row', paddingTop: 8, borderWidth: 1, borderColor: theme.border2, borderRadius: 14, backgroundColor: theme.surface2 }}>
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
        </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? HEADER_HEIGHT : 0}
        enabled={Platform.OS === 'ios'}
      >
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
              <ChatLoadingState />
            ) : (
              <ChatMessageList
                messages={unifiedMessages}
                myId={myId}
                listRef={listRef}
                loadingMore={loadingMore}
                hasMore={hasMore}
                onLoadOlder={loadMore}
                listPaddingBottom={chatListPad}
                capabilities={CLUB_CAPABILITIES}
                showGroupNames
                onLongPressMessage={setMenuMsg}
                onReact={handleReact}
                onPressPhoto={setPreviewPhoto}
                renderBody={(content, isMe) => renderClubBody(content, isMe)}
                emptyTitle="Brak wiadomości"
                emptySubtitle="Napisz pierwszą!"
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
                      {!!m.province && (
                        <View style={{ marginTop: 3 }}>
                          <ProvinceBadge province={m.province} compact theme={theme} />
                        </View>
                      )}
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
          <ChatComposer
            text={text}
            onChangeText={(v) => {
              setText(v);
              const match = v.match(/(?:^|\s)@([a-zA-Z0-9_.-]{1,32})$/);
              setMentionQuery(match ? match[1] : null);
            }}
            onSend={() => void handleSend()}
            onAttach={handlePickPhoto}
            onClear={() => { setText(''); setReplyTo(null); }}
            attachments={photos}
            onRemoveAttachment={i => setPhotos(prev => prev.filter((_, j) => j !== i))}
            replyTo={replyTo ? { username: replyTo.sender.username, preview: replyTo.content || '📷 Zdjęcie' } : null}
            onDismissReply={() => setReplyTo(null)}
            inputPaddingBottom={chatInputPad}
            placeholder="Napisz na czacie klubu..."
            sending={sending}
            overlay={mentionOverlay}
          />
        )}
      </KeyboardAvoidingView>

      <ChatMessageMenu
        visible={!!menuMsg}
        onClose={() => setMenuMsg(null)}
        actions={menuActions}
        showReactions={CLUB_CAPABILITIES.reactions}
        onReact={emoji => menuMsg && handleReact(menuMsg.id, emoji)}
      />

      <EditClubModal
        visible={editVisible}
        club={clubData}
        channels={channels}
        onClose={() => setEditVisible(false)}
        onUpdated={(updated) => { setClubName(updated.name); setClubData(updated); setChannels(updated.channels ?? channels); setCategories(updated.categories ?? categories); setEditVisible(false); }}
      />

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
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          enabled={Platform.OS === 'ios'}
        >
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setShareVisible(false)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: shareSheetPadding, borderTopWidth: 1, borderColor: theme.border2 }}>
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
        </KeyboardAvoidingView>
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
      {!introDone && clubId > 0 && (
        <EntranceIntroGate
          presetId="club"
          screenKey={`club_${clubId}`}
          titleOverride={clubName ? clubName.toUpperCase() : undefined}
          onIntroDone={() => setIntroDone(true)}
        />
      )}
    </SafeAreaView>
  );
}