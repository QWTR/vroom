import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, FlatList, TouchableOpacity, Image, ActivityIndicator, KeyboardAvoidingView, Keyboard, Platform, Modal, Pressable, ScrollView, Dimensions, Alert } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../components/ui/AppText';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather }                from '@expo/vector-icons';
import MaterialIcons              from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons     from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker           from 'expo-image-picker';
import AsyncStorage               from '@react-native-async-storage/async-storage';
import { useModalSheetPadding } from '../../../components/layout/ModalKeyboardSheet';
import Toast                      from 'react-native-toast-message';
import { useTheme }               from '../../../contexts/ThemeContext';
import { UAv }                    from '../../../components/clubs/ClubCard';
import { Club }                   from '../../../components/clubs/types';
import EditClubModal              from '../../../components/clubs/EditClubModal';
import { renderDiscussionBody }   from '../community/communityShared';
import { filterProvinceSuggestions } from '../../../constants/provinces';
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
import { ApiRequestError, apiRequest } from '../../../lib/api/client';
import { queryClient } from '../../../lib/query/client';
import { joinSharedRoom, subscribeSharedSocket } from '../../../lib/sharedSocket';

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
  const { id, channelId, messageId } = useLocalSearchParams<{ id: string; channelId?: string; messageId?: string }>();
  const clubId            = parseInt(String(id), 10);
  const initialChannelId  = channelId ? parseInt(String(channelId), 10) : NaN;
  const router            = useRouter();
  const isFocused         = useIsFocused();
  const { theme, isDark } = useTheme();
  const insets            = useSafeAreaInsets();

  const [clubName,    setClubName]    = useState('');
  const [clubData,    setClubData]    = useState<Club | null>(null);
  const [categories,  setCategories]  = useState<any[]>([]);
  const [channels,    setChannels]    = useState<any[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [myId,        setMyId]        = useState<number | null>(null);
  const [myRole,      setMyRole]      = useState<string | null>(null);
  const [myRanks,     setMyRanks]     = useState<any[]>([]);

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
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberModal, setMemberModal] = useState<any | null>(null);
  const [selectedRankIds, setSelectedRankIds] = useState<number[]>([]);
  const [pushMuteBusy, setPushMuteBusy] = useState(false);

  const listRef   = useRef<FlatList<UnifiedChatMessage>>(null);
  const { listPaddingBottom: chatListPad, inputPaddingBottom: chatInputPad } = useChatKeyboard(listRef);
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

  // ── Init ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isFocused) return;
    mountedRef.current = true;
    let disposed = false;
    let socketCleanups: (() => void)[] = [];

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

    void (async () => {
      const raw = await AsyncStorage.getItem('user');
      if (raw && mountedRef.current) setMyId(JSON.parse(raw).userId);

      const [club, structure] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ['clubs', 'detail', clubId],
          queryFn: ({ signal }) => apiRequest<Club>(`/clubs/${clubId}`, { signal, priority: 'critical' }),
          staleTime: 15_000,
        }),
        queryClient.fetchQuery({
          queryKey: ['clubs', 'structure', clubId],
          queryFn: ({ signal }) => apiRequest<any>(`/clubs/${clubId}/structure`, { signal, priority: 'critical' }),
          staleTime: 30_000,
        }),
      ]);
      if (mountedRef.current) {
        setClubName(club.name);
        setMyRole(club.myRole);
        setMyRanks(Array.isArray(club.myRanks) ? club.myRanks : (club.myRank ? [club.myRank] : []));
        setClubData(club);
        setCategories(structure.categories ?? []);
        setChannels(structure.channels ?? []);
        const general = (structure.channels ?? []).find((c: any) => c.isDefaultGeneral) ?? (structure.channels ?? [])[0];
        const hasInitial = Number.isFinite(initialChannelId) && (structure.channels ?? []).some((c: any) => c.id === initialChannelId);
        setActiveChannelId(hasInitial ? initialChannelId : (general?.id ?? null));
      }

      if (!mountedRef.current) return;
      const cleanups = await Promise.all([
        joinSharedRoom(`club:${clubId}`, 'club:join', 'club:leave', clubId),
        subscribeSharedSocket<ClubMessage>('club:message', onMessage),
        subscribeSharedSocket<{ id: number }>('club:message_deleted', onMessageDeleted),
        subscribeSharedSocket<ClubMessage>('club:pinned', onPinned),
        subscribeSharedSocket<{ id: number }>('club:unpinned', onUnpinned),
        subscribeSharedSocket<{ messageId: number; reactions: any[] }>('club:reaction', onReaction),
      ]);
      if (disposed) cleanups.forEach(cleanup => cleanup());
      else socketCleanups = cleanups;
    })().catch((error) => {
      if (mountedRef.current) Toast.show({ type: 'error', text1: 'Klub chwilowo niedostępny', text2: error instanceof Error ? error.message : undefined });
    });

    return () => {
      disposed = true;
      mountedRef.current = false;
      scrollTimeoutsRef.current.forEach(clearTimeout);
      scrollTimeoutsRef.current = [];
      socketCleanups.forEach(cleanup => cleanup());
      socketCleanups = [];
    };
  }, [clubId, initialChannelId, isFocused, scheduleScrollToEnd]);

  const loadMessages = useCallback(async (cur?: number, channelIdArg?: number) => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (cur) params.append('cursor', String(cur));
      const channelIdToUse = channelIdArg ?? activeChannelIdRef.current;
      if (channelIdToUse) params.append('channelId', String(channelIdToUse));
      const data = await queryClient.fetchQuery({
        queryKey: ['clubs', 'messages', clubId, channelIdToUse ?? null, cur ?? 'first'],
        queryFn: ({ signal }) => apiRequest<any>(`/clubs/${clubId}/messages?${params}`, { signal, priority: cur ? 'visible' : 'critical' }),
        staleTime: cur ? 60_000 : 5_000,
      });
      if (!mountedRef.current) return;
      if (cur) setMessages(prev => [...(data.messages ?? []), ...prev]);
      else     setMessages(data.messages ?? []);
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
      setPinned(data.pinned ?? []);
      if (!cur) scrollChatToEndAfterLayout(listRef, false);
    } catch (error) {
      const message = error instanceof ApiRequestError ? error.message : 'Spróbuj ponownie';
      Toast.show({ type: 'error', text1: 'Czat chwilowo niedostępny', text2: message });
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [clubId]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || !hasMore) return;
    setLoadingMore(true);
    void loadMessages(cursor, activeChannelId ?? undefined);
  }, [cursor, loadingMore, hasMore, activeChannelId, loadMessages]);

  useEffect(() => {
    if (!activeChannelId || !isFocused) return;
    setLoading(true);
    setMessages([]);
    setPinned([]);
    setCursor(null);
    setHasMore(true);
    void loadMessages(undefined, activeChannelId);
  }, [activeChannelId, isFocused, loadMessages]);

  useEffect(() => {
    if (channels.length === 0) return;
    if (activeChannelId && channels.some((channel: any) => channel.id === activeChannelId)) return;
    const fallback = channels.find((channel: any) => channel.isDefaultGeneral) ?? channels[0];
    setActiveChannelId(fallback?.id ?? null);
  }, [activeChannelId, channels]);

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
    const localId = -Date.now();
    try {
      if (!activeChannelId) {
        setText(prevText);
        setPhotos(prevPhotos);
        setReplyTo(prevReply);
        return;
      }
      const optimisticMessage: ClubMessage = {
        id: localId,
        clubId,
        channelId: activeChannelId,
        senderId: myId ?? 0,
        content: t || null,
        photos: p,
        createdAt: new Date().toISOString(),
        isPinned: false,
        pinnedAt: null,
        sender: { id: myId ?? 0, username: 'Ty', avatarUrl: null },
        replyTo: r ? { id: r.id, content: r.content, sender: { id: r.sender.id, username: r.sender.username } } : null,
        reactions: [],
      };
      setMessages(prev => [...prev, optimisticMessage]);
      scheduleScrollToEnd();
      const form = new FormData();
      if (t) form.append('content', t);
      if (r) form.append('replyToId', String(r.id));
      form.append('channelId', String(activeChannelId));
      p.forEach((uri, i) => form.append('photos', { uri, type: 'image/jpeg', name: `p${i}.jpg` } as any));
      const msg = await apiRequest<ClubMessage>(`/clubs/${clubId}/messages`, {
        method: 'POST',
        body: form,
      });
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev.filter(m => m.id !== localId);
        return prev.map(m => m.id === localId ? msg : m);
      });
      await queryClient.invalidateQueries({ queryKey: ['clubs', 'messages', clubId, activeChannelId] });
      scheduleScrollToEnd();
    } catch (error) {
      setMessages(prev => prev.filter(message => message.id !== localId));
      Toast.show({ type: 'error', text1: 'Nie wysłano wiadomości', text2: error instanceof Error ? error.message : 'Brak połączenia' });
      setText(prevText);
      setPhotos(prevPhotos);
      setReplyTo(prevReply);
    } finally { setSending(false); }
  }, [text, photos, replyTo, clubId, activeChannelId, myId, scheduleScrollToEnd]);

  const handlePickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, quality: 0.8,
    });
    if (!r.canceled) setPhotos(prev => [...prev, ...r.assets.map(a => a.uri)].slice(0, 4));
  };

  const handlePin = async (msgId: number, isPinned: boolean) => {
    const method = isPinned ? 'DELETE' : 'POST';
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isPinned: !isPinned } : m));
    try {
      await apiRequest(`/clubs/${clubId}/messages/${msgId}/pin`, { method });
      await queryClient.invalidateQueries({ queryKey: ['clubs', 'messages', clubId] });
    } catch (error) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isPinned } : m));
      Toast.show({ type: 'error', text1: 'Nie zmieniono przypięcia', text2: error instanceof Error ? error.message : undefined });
    }
  };

  const handleDelete = async (msgId: number) => {
    const removed = messages.find(message => message.id === msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
    setPinned(prev => prev.filter(m => m.id !== msgId));
    try {
      await apiRequest(`/clubs/${clubId}/messages/${msgId}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['clubs', 'messages', clubId] });
    } catch (error) {
      if (removed) setMessages(prev => [...prev, removed].sort((a, b) => a.id - b.id));
      Toast.show({ type: 'error', text1: 'Nie usunięto wiadomości', text2: error instanceof Error ? error.message : undefined });
    }
  };

  const handleReact = async (msgId: number, emoji: string) => {
    try {
      const msg = messages.find(m => m.id === msgId);
      const hasMine = !!msg?.reactions?.find(r => r.emoji === emoji)?.myReaction;
      const endpoint = hasMine
        ? `/clubs/${clubId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`
        : `/clubs/${clubId}/messages/${msgId}/reactions`;
      await apiRequest(endpoint, {
        method: hasMine ? 'DELETE' : 'POST',
        ...(hasMine ? {} : { body: { emoji } }),
      });
      await queryClient.invalidateQueries({ queryKey: ['clubs', 'messages', clubId] });
    } catch { Toast.show({ type: 'error', text1: 'Brak połączenia' }); }
  };

  const hasRankPermission = (permission: string) => myRanks.some(rank => !!rank?.[permission]);
  const canPin    = myRole === 'owner' || hasRankPermission('canPin');
  const canKick   = myRole === 'owner' || hasRankPermission('canKick');
  const canMute   = myRole === 'owner' || hasRankPermission('canMute');
  const canManage = myRole === 'owner' || hasRankPermission('canManage');
  const canOpenManagement = canManage || canKick || canMute;
  const canWriteReadOnly = myRole === 'owner' || hasRankPermission('canWriteReadOnly');

  const unifiedMessages = useMemo(
    () => messages.map(mapClubMessageToUnified),
    [messages],
  );

  useEffect(() => {
    if (!messageId || loading || !unifiedMessages.length) return;
    const index = unifiedMessages.findIndex((message) => message.id === Number(messageId));
    if (index < 0) return;
    const timer = setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }), 180);
    return () => clearTimeout(timer);
  }, [loading, messageId, unifiedMessages]);

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
              <Text style={{ color: theme.textDim, fontSize: 12 }}>{u.label}</Text>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  ) : null;

  // ── Render ────────────────────────────────────────────────
  const HEADER_HEIGHT = insets.top + 132;
  const SCREEN_W = Dimensions.get('window').width;
  const sidebarBg = isDark ? '#1b1c1f' : theme.surface2;
  const members = clubData?.members ?? [];
  const ownerGroup = members.filter((m: any) => m.role === 'owner');
  const memberRanks = (m: any) => Array.isArray(m.ranks) ? m.ranks : (m.rank ? [m.rank] : []);
  const rankedGroup = members.filter((m: any) => m.role !== 'owner' && memberRanks(m).length > 0);
  const memberGroup = members.filter((m: any) => m.role !== 'owner' && memberRanks(m).length === 0);
  const rankSections: any[] = Object.values(
    rankedGroup.reduce((acc: any, m: any) => {
      const primaryRank = [...memberRanks(m)].sort((a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0))[0];
      const key = primaryRank?.name ?? 'Ranga';
      if (!acc[key]) acc[key] = { title: key.toUpperCase(), data: [] };
      acc[key].data.push(m);
      return acc;
    }, {}),
  );
  const categorySections: any[] = [...categories]
    .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
    .map((c: any) => ({
      ...c,
      channels: channels.filter((ch: any) => ch.categoryId === c.id).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)),
    }));
  const uncategorizedChannels = channels
    .filter((ch: any) => ch.categoryId == null)
    .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
  if (uncategorizedChannels.length > 0) {
    categorySections.push({ id: 'uncategorized', name: 'Pozostałe', channels: uncategorizedChannels });
  }

  const refreshClub = async () => {
    await queryClient.invalidateQueries({ queryKey: ['clubs', 'detail', clubId] });
    const club = await queryClient.fetchQuery({
      queryKey: ['clubs', 'detail', clubId],
      queryFn: ({ signal }) => apiRequest<Club>(`/clubs/${clubId}`, { signal, priority: 'critical' }),
      staleTime: 0,
    });
    setClubData(club);
    setClubName(club.name);
    setMyRole(club.myRole);
    setMyRanks(Array.isArray(club.myRanks) ? club.myRanks : (club.myRank ? [club.myRank] : []));
    setChannels(club.channels ?? []);
    setCategories(club.categories ?? []);
  };

  const openMemberActions = (m: any) => {
    setSelectedRankIds(memberRanks(m).map((rank: any) => rank.id));
    setMemberModal(m);
  };

  const openMemberFromDirectory = (member: any) => {
    setMembersOpen(false);
    setTimeout(() => openMemberActions(member), Platform.OS === 'ios' ? 350 : 0);
  };

  const assignRanks = async () => {
    if (!memberModal) return;
    try {
      await apiRequest(`/clubs/${clubId}/members/${memberModal.userId}/rank`, {
        method: 'POST',
        body: { rankIds: selectedRankIds },
      });
      await refreshClub();
      setMemberModal(null);
    } catch (error) {
      Alert.alert('Nie udało się zapisać ról', error instanceof Error ? error.message : 'Spróbuj ponownie.');
    }
  };

  const toggleMute = async () => {
    if (!memberModal) return;
    const isMuted = !!memberModal.isMuted;
    const method = isMuted ? 'DELETE' : 'POST';
    await apiRequest(`/clubs/${clubId}/members/${memberModal.userId}/mute`, {
      method,
      body: method === 'POST' ? { durationMinutes: 60 } : undefined,
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
            try {
              await apiRequest(`/clubs/${clubId}/members/${memberModal.userId}/kick`, {
                method: 'POST',
                body: { reason: 'Moderacja klubu' },
              });
              Toast.show({ type: 'success', text1: `${username} wyrzucony` });
              setMemberModal(null);
              await refreshClub();
            } catch (error) {
              Toast.show({ type: 'error', text1: error instanceof Error ? error.message : 'Nie udało się wyrzucić' });
            }
          },
        },
      ],
    );
  };

  const toggleClubPushMute = async () => {
    if (!clubData || pushMuteBusy) return;
    setPushMuteBusy(true);
    const previous = clubData;
    const next = !clubData.myClubPushMuted;
    setClubData({ ...clubData, myClubPushMuted: next });
    try {
      await apiRequest(`/clubs/${clubId}/push-mute`, {
        method: 'PATCH',
        body: { muted: next },
      });
      queryClient.setQueryData<Club>(['clubs', 'detail', clubId], current => current ? { ...current, myClubPushMuted: next } : current);
      Toast.show({
        type: 'success',
        text1: next ? 'Powiadomienia z czatu wyciszone' : 'Powiadomienia z czatu włączone',
      });
    } catch {
      setClubData(previous);
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setPushMuteBusy(false);
    }
  };

  const shareClubToDiscussions = async () => {
    if (sharing || !clubData) return;
    setSharing(true);
    try {
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
      await apiRequest('/posts', {
        method: 'POST',
        body: form,
      });
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
                <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                  {clubName}
                </Text>
              </View>
              <Text style={{ color: theme.textDim, fontSize: 12, fontFamily: 'Manrope_600SemiBold', marginTop: 3 }}>
                {myRole === 'owner' ? 'ZAŁOŻYCIEL' : myRanks.length > 0 ? myRanks.map(rank => rank.name).join(' · ').toUpperCase() : 'CZAT KLUBU'}
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

              {canOpenManagement && (
                <TouchableOpacity
                  style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }}
                  onPress={() => setEditVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Otwórz zarządzanie klubem"
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

        <View style={{ backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => setChannelsOpen(true)}
            style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.surface2, borderRadius: 12, borderWidth: 1, borderColor: theme.border2, paddingHorizontal: 11, paddingVertical: 9 }}
          >
            <MaterialIcons name="menu" size={18} color={theme.primary} />
            <MaterialCommunityIcons name="pound" size={15} color={theme.textDim} />
            <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>
              {channels.find((c: any) => c.id === activeChannelId)?.name ?? 'Wybierz kanał'}
            </Text>
            {!!channels.find((c: any) => c.id === activeChannelId)?.isReadOnly && <MaterialIcons name="lock" size={14} color={theme.gold} />}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMembersOpen(true)}
            style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border2 }}
          >
            <MaterialCommunityIcons name="account-group" size={19} color={theme.textDim} />
          </TouchableOpacity>
        </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? HEADER_HEIGHT : 0}
        enabled={Platform.OS === 'ios'}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {showPinned && pinned.length > 0 && (
              <View style={{ backgroundColor: '#FFD70010', borderBottomWidth: 1, borderBottomColor: '#FFD70030', padding: 10, gap: 6 }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#FFD700', letterSpacing: 1, marginBottom: 4 }}>
                  📌 PRZYPIĘTE ({pinned.length})
                </Text>
                {pinned.map(p => (
                  <View key={p.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <UAv uri={p.sender.avatarUrl} name={p.sender.username} size={22} user={p.sender as any} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#FFD700', fontWeight: '700' }}>{p.sender.username}</Text>
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

        {/* INPUT */}
        {channels.find((c: any) => c.id === activeChannelId)?.isReadOnly && !canWriteReadOnly ? (
          <View style={{ margin: 10, borderRadius: 12, borderWidth: 1, borderColor: `${theme.gold}55`, backgroundColor: `${theme.gold}12`, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <MaterialIcons name="lock" size={17} color={theme.gold} />
            <Text style={{ flex: 1, color: theme.textDim, fontSize: 12 }}>Ten kanał jest tylko do odczytu. Wiadomości mogą wysyłać właściciel i uprawnione role.</Text>
          </View>
        ) : (
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
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={channelsOpen}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setChannelsOpen(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000000b8' }}
            onPress={() => setChannelsOpen(false)}
          />
            <View style={{ height: '68%', backgroundColor: sidebarBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: theme.border2, paddingBottom: Math.max(insets.bottom, 14), overflow: 'hidden' }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginVertical: 12 }} />
              <View style={{ paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '800' }}>{clubName}</Text>
                  <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>KANAŁY KLUBU</Text>
                </View>
                <TouchableOpacity onPress={() => setChannelsOpen(false)}><MaterialIcons name="close" size={20} color={theme.textDim} /></TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 16 }}>
                {categorySections.map((cat: any) => (
                  <View key={cat.id} style={{ marginBottom: 12 }}>
                    <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, paddingHorizontal: 8, marginBottom: 5 }}>{cat.name.toUpperCase()}</Text>
                    {cat.channels.map((ch: any) => {
                      const active = ch.id === activeChannelId;
                      return (
                        <TouchableOpacity
                          key={ch.id}
                          onPress={() => { Haptics.selectionAsync().catch(() => {}); setActiveChannelId(ch.id); setChannelsOpen(false); }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, paddingVertical: 11, borderRadius: 11, marginBottom: 3, borderWidth: 1, borderColor: active ? `${theme.primary}66` : 'transparent', backgroundColor: active ? `${theme.primary}18` : theme.surface2 }}
                        >
                          <MaterialCommunityIcons name="pound" size={17} color={active ? theme.primary : theme.textDim} />
                          <Text style={{ flex: 1, color: active ? theme.text : theme.textMuted, fontSize: 13, fontWeight: active ? '700' : '500' }}>{ch.name}</Text>
                          {ch.isReadOnly && <MaterialIcons name="lock" size={14} color={theme.gold} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
            </View>
        </View>
      </Modal>

      <Modal
        visible={membersOpen}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setMembersOpen(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000000b8' }}
            onPress={() => setMembersOpen(false)}
          />
            <View style={{ height: '82%', backgroundColor: sidebarBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: theme.border2, paddingBottom: Math.max(insets.bottom, 14), overflow: 'hidden' }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginVertical: 12 }} />
              <View style={{ paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '800' }}>CZŁONKOWIE · {members.length}</Text>
                <TouchableOpacity onPress={() => setMembersOpen(false)}><MaterialIcons name="close" size={20} color={theme.textDim} /></TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 16 }}>
                {[{ title: 'WŁAŚCICIEL', data: ownerGroup }, ...rankSections, { title: 'CZŁONKOWIE', data: memberGroup }].map(section => section.data.length > 0 && (
                  <View key={section.title} style={{ marginBottom: 12 }}>
                    <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, paddingHorizontal: 8, marginBottom: 5 }}>{section.title} · {section.data.length}</Text>
                    {section.data.map((m: any) => (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => openMemberFromDirectory(m)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 11, marginBottom: 3, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }}
                      >
                        <UAv uri={m.avatarUrl} name={m.username} size={32} user={{ id: m.userId, ...m } as any} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>{m.username}</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {m.role === 'owner' && <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>OWNER</Text>}
                            {memberRanks(m).map((rank: any) => (
                              <View key={rank.id} style={{ borderRadius: 999, borderWidth: 1, borderColor: `${rank.color}66`, backgroundColor: `${rank.color}18`, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ color: rank.color, fontSize: 12 }}>{rank.name}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                        <MaterialIcons name={m.role === 'owner' ? 'lock' : 'more-horiz'} size={17} color={theme.textDim} />
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </View>
        </View>
      </Modal>

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
        onUpdated={(updated) => {
          setClubName(updated.name);
          setClubData(updated);
          setChannels(updated.channels ?? channels);
          setCategories(updated.categories ?? categories);
          setMyRole(updated.myRole);
          setMyRanks(Array.isArray(updated.myRanks) ? updated.myRanks : (updated.myRank ? [updated.myRank] : []));
          setEditVisible(false);
        }}
      />

      <Modal visible={!!previewPhoto} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setPreviewPhoto(null)}>
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

      <Modal visible={shareVisible} transparent animationType="slide" presentationStyle="overFullScreen" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setShareVisible(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          enabled={Platform.OS === 'ios'}
        >
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setShareVisible(false)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: shareSheetPadding, borderTopWidth: 1, borderColor: theme.border2 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 14 }} />
              <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginBottom: 4 }}>
                UDOSTĘPNIJ KLUB W DYSKUSJACH
              </Text>
              <Text style={{ color: theme.textDim, fontSize: 12, marginBottom: 10 }}>
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
                  <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>ANULUJ</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#e3383560', backgroundColor: '#e33835', alignItems: 'center', paddingVertical: 11 }}
                  onPress={shareClubToDiscussions}
                  disabled={sharing}
                >
                  {sharing ? (
                    <ActivityIndicator size={14} color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>UDOSTĘPNIJ</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!memberModal} transparent animationType="slide" presentationStyle="overFullScreen" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setMemberModal(null)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setMemberModal(null)}>
          <Pressable onPress={e => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 18, borderTopWidth: 1, borderColor: theme.border2 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 14 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <UAv uri={memberModal?.avatarUrl} name={memberModal?.username ?? '?'} size={36} user={memberModal ? ({ id: memberModal.userId, ...memberModal } as any) : null} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>{memberModal?.username}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 3 }}>
                    {memberModal && memberRanks(memberModal).map((rank: any) => <Text key={rank.id} style={{ color: rank.color, fontSize: 12 }}>{rank.name}</Text>)}
                  </View>
                </View>
              </View>

              <TouchableOpacity style={{ paddingVertical: 12 }} onPress={() => { if (memberModal) router.push(`/profile/${memberModal.userId}` as any); setMemberModal(null); }}>
                <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>Wyświetl profil</Text>
              </TouchableOpacity>

              {myRole === 'owner' && memberModal?.userId !== myId && memberModal?.role !== 'owner' && (
                <View style={{ marginTop: 6, marginBottom: 8 }}>
                  <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginBottom: 6 }}>ROLE · WYBIERZ WIELE</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {(clubData?.ranks ?? []).map((r: any) => (
                      <TouchableOpacity
                        key={r.id}
                        onPress={() => setSelectedRankIds(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id])}
                        style={{ borderWidth: 1, borderColor: r.color, backgroundColor: selectedRankIds.includes(r.id) ? `${r.color}30` : 'transparent', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 }}
                      >
                        <Text style={{ color: r.color, fontSize: 12 }}>{r.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity onPress={assignRanks} style={{ marginTop: 10, borderRadius: 10, backgroundColor: theme.primary, paddingVertical: 10, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>ZAPISZ ROLE</Text>
                  </TouchableOpacity>
                </View>
              )}

              {(canKick || canMute) && memberModal?.userId !== myId && memberModal?.role !== 'owner' && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {canMute && (
                    <TouchableOpacity onPress={toggleMute} style={{ flex: 1, borderWidth: 1, borderColor: '#ff922b55', backgroundColor: '#ff922b18', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                      <Text style={{ color: '#ff922b', fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>{memberModal?.isMuted ? 'Odcisz' : 'Wycisz'}</Text>
                    </TouchableOpacity>
                  )}
                  {canKick && (
                    <TouchableOpacity onPress={kickMember} style={{ flex: 1, borderWidth: 1, borderColor: '#e3383555', backgroundColor: '#e3383518', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                      <Text style={{ color: '#e33835', fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>Wyrzuć</Text>
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
