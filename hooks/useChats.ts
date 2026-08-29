import { useState, useEffect, useCallback } from 'react';
import { emitFriendInviteHandled } from '../lib/friendInviteEvents';
import { apiRequest } from '../lib/api/client';
import { currentSharedSocket, subscribeSharedSocket } from '../lib/sharedSocket';
import type { PremiumVisual } from '../components/user/PremiumIdentity';

const API = '/chat';

export interface ChatUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
  online:    boolean;
  isPremium?: boolean;
  isAdmin?: boolean;
  premiumVisual?: PremiumVisual | null;
  friendshipId?: number;
}

export interface Message {
  id:             number;
  content:        string;
  photos:         string[];
  createdAt:      string;
  senderId:       number;
  sender:         ChatUser;
  conversationId: number;
  replyTo?:       Message | null;
}

export interface Conversation {
  id:           number;
  isGroup:      boolean;
  name:         string;
  avatarUrl:    string | null;
  online:       boolean;
  participants: ChatUser[];
  lastMessage:  {
    content:    string;
    photos:     string[];
    createdAt:  string;
    senderName: string;
    isMe:       boolean;
  } | null;
  unread: number;
}

export interface FriendRequest {
  id:        number;
  status:    string;
  requester: ChatUser;
}

type UseChatOptions = {
  realtime?: boolean;
  autoFetch?: boolean;
};

export function useChat(options: UseChatOptions = {}) {
  const realtime = options.realtime !== false;
  const autoFetch = options.autoFetch !== false;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friends,       setFriends]       = useState<ChatUser[]>([]);
  const [requests,      setRequests]      = useState<FriendRequest[]>([]);
  const [loading,       setLoading]       = useState(false);

  // ── Fetch conversations ──────────────────────────────────
  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiRequest<any>('/v2/chat/conversations?limit=30', { priority: 'visible' });
      // Backend zwraca { conversations, nextCursor } lub tablicę (stary format)
      const list = Array.isArray(d) ? d : (Array.isArray(d?.items) ? d.items : (Array.isArray(d?.conversations) ? d.conversations : []));
      setConversations(list);
    } catch (e) {
      console.error('fetchConversations:', e);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch friends ────────────────────────────────────────
  const fetchFriends = useCallback(async () => {
    try {
      const d = await apiRequest<any>(`${API}/friends`, { priority: 'visible' });
      setFriends(Array.isArray(d) ? d : []);
    } catch (e) {
      console.error('fetchFriends:', e);
      setFriends([]);
    }
  }, []);

  // ── Fetch friend requests ────────────────────────────────
  const fetchRequests = useCallback(async () => {
    try {
      const d = await apiRequest<any>(`${API}/friends/requests`, { priority: 'visible' });
      setRequests(Array.isArray(d) ? d : []);
    } catch (e) {
      console.error('fetchRequests:', e);
      setRequests([]);
    }
  }, []);

  // ── Search users ─────────────────────────────────────────
  const searchUsers = useCallback(async (q: string): Promise<ChatUser[]> => {
    try {
      const d = await apiRequest<any>(`${API}/users/search?q=${encodeURIComponent(q)}`, { priority: 'critical' });
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }, []);

  // ── Start / find conversation ────────────────────────────
  const startConversation = useCallback(async (
    userIds: number[],
    isGroup = false,
    name?: string,
  ): Promise<number | null> => {
    const d = await apiRequest<any>(`${API}/conversations`, {
      method:  'POST',
      body:    { userIds, isGroup, name },
    });
    if (autoFetch) await fetchConversations();
    return d.id ?? null;
  }, [autoFetch, fetchConversations]);

  // ── Send friend request ──────────────────────────────────
  const sendFriendRequest = useCallback(async (userId: number) => {
    return apiRequest(`${API}/friends/request`, {
      method:  'POST',
      body:    { userId },
    });
  }, []);

  // ── Accept friend request ────────────────────────────────
  const acceptRequest = useCallback(async (friendshipId: number) => {
    await apiRequest(`${API}/friends/${friendshipId}/accept`, {
      method:  'POST',
    });
    setRequests(prev =>
      Array.isArray(prev) ? prev.filter(r => r.id !== friendshipId) : [],
    );
    emitFriendInviteHandled(friendshipId);
    fetchFriends();
  }, [fetchFriends]);

  // ── Reject friend request ────────────────────────────────
  const rejectRequest = useCallback(async (friendshipId: number) => {
    await apiRequest(`${API}/friends/${friendshipId}/reject`, {
      method:  'POST',
    });
    setRequests(prev =>
      Array.isArray(prev) ? prev.filter(r => r.id !== friendshipId) : [],
    );
    emitFriendInviteHandled(friendshipId);
  }, []);

  // ── Remove friend ────────────────────────────────────────
  const removeFriend = useCallback(async (friendshipId: number) => {
    await apiRequest(`${API}/friends/${friendshipId}`, {
      method:  'DELETE',
    });
    fetchFriends();
  }, [fetchFriends]);

  // ── Get friend status ────────────────────────────────────
  const getFriendStatus = useCallback(async (userId: number) => {
    return apiRequest(`${API}/friends/status/${userId}`, { priority: 'critical' });
  }, []);

  useEffect(() => {
    if (!realtime) return undefined;
    let disposed = false;
    let unsubscribe: (() => void)[] = [];
    const onNotification = ({ conversationId, message }: any) => {
      setConversations((previous) => previous
        .map((conversation) => conversation.id === conversationId ? {
          ...conversation,
          unread: conversation.unread + 1,
          lastMessage: {
            content: message.content,
            photos: [],
            createdAt: new Date().toISOString(),
            senderName: message.senderName,
            isMe: false,
          },
        } : conversation)
        .sort((left, right) => (right.lastMessage?.createdAt ?? '').localeCompare(left.lastMessage?.createdAt ?? '')));
    };
    const onFriendRequest = (data: any) => {
      const normalized = { id: Number(data?.id ?? data?.friendshipId), status: data?.status ?? 'pending', requester: data?.requester ?? data?.from };
      if (!Number.isFinite(normalized.id) || !normalized.requester) return;
      setRequests((previous) => previous.some((request) => request.id === normalized.id)
        ? previous
        : [...previous, normalized as FriendRequest]);
    };
    const applyPresence = ({ userId, online }: { userId: number; online: boolean }) => {
      const id = Number(userId);
      if (!Number.isFinite(id)) return;
      setFriends((previous) => previous.map((friend) => friend.id === id ? { ...friend, online } : friend));
      setConversations((previous) => previous.map((conversation) => ({
        ...conversation,
        online: !conversation.isGroup && conversation.participants.some((participant) => participant.id === id) ? online : conversation.online,
        participants: conversation.participants.map((participant) => participant.id === id ? { ...participant, online } : participant),
      })));
    };
    void Promise.all([
      subscribeSharedSocket('chat:notification', onNotification),
      subscribeSharedSocket('chat:new_conversation', () => { void fetchConversations(); }),
      subscribeSharedSocket('friend:request', onFriendRequest),
      subscribeSharedSocket('friend:accepted', () => { void fetchFriends(); }),
      subscribeSharedSocket('presence:update', applyPresence),
      subscribeSharedSocket('user:online', applyPresence),
    ]).then((cleanups) => {
      if (disposed) cleanups.forEach((cleanup) => cleanup());
      else unsubscribe = cleanups;
    });
    return () => {
      disposed = true;
      unsubscribe.forEach((cleanup) => cleanup());
    };
  }, [fetchConversations, fetchFriends, realtime]);

  // ── Init fetch ────────────────────────────────────��──────
  useEffect(() => {
    if (!autoFetch) return;
    void fetchConversations();
    void fetchFriends();
    void fetchRequests();
  }, [autoFetch, fetchConversations, fetchFriends, fetchRequests]);

  return {
    conversations,
    friends,
    requests,
    loading,
    socket:             currentSharedSocket(),
    fetchConversations,
    fetchFriends,
    fetchRequests,
    searchUsers,
    startConversation,
    sendFriendRequest,
    acceptRequest,
    rejectRequest,
    removeFriend,
    getFriendStatus,
  };
} 
