import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';

const API = 'https://v-room.app/api/chat';
const WS  = 'https://v-room.app';

export interface ChatUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
  online:    boolean;
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

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friends,       setFriends]       = useState<ChatUser[]>([]);
  const [requests,      setRequests]      = useState<FriendRequest[]>([]);
  const [loading,       setLoading]       = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const tokenRef  = useRef<string>('');

  // ── Auth headers ─────────────────────────────────────────
  const headers = useCallback(async () => {
    if (!tokenRef.current) {
      tokenRef.current = await AsyncStorage.getItem('token') ?? '';
    }
    return {
      Authorization:  `Bearer ${tokenRef.current}`,
      'Content-Type': 'application/json',
    };
  }, []);

  // ── Init socket ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;
      tokenRef.current = token;

      const socket = io(WS, {
        auth:       { token },
        transports: ['websocket'],
      });

      socket.on('connect', () => {
        console.log('💬 Chat socket connected');
      });

      // Nowa wiadomość — aktualizuj listę konwersacji
      socket.on('chat:notification', ({ conversationId, message }) => {
        setConversations(prev => {
          // Guard: jeśli state nie jest tablicą (race condition) — zresetuj
          if (!Array.isArray(prev)) return [];

          return prev
            .map(c =>
              c.id === conversationId
                ? {
                    ...c,
                    unread: c.unread + 1,
                    lastMessage: {
                      content:    message.content,
                      photos:     [],
                      createdAt:  new Date().toISOString(),
                      senderName: message.senderName,
                      isMe:       false,
                    },
                  }
                : c,
            )
            .sort((a, b) => {
              const aTime = a.lastMessage?.createdAt ?? '';
              const bTime = b.lastMessage?.createdAt ?? '';
              return bTime.localeCompare(aTime);
            });
        });
      });

      // Nowa konwersacja
      socket.on('chat:new_conversation', () => {
        fetchConversations();
      });

      // Zaproszenie do znajomych
      socket.on('friend:request', (data) => {
        setRequests(prev => (Array.isArray(prev) ? [...prev, data] : [data]));
      });

      socket.on('friend:accepted', () => {
        fetchFriends();
      });

      socketRef.current = socket;
    })();

    return () => {
      socketRef.current?.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch conversations ──────────────────────────────────
  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const h = await headers();
      const r = await fetch(`${API}/conversations`, { headers: h });
      const d = await r.json();
      // Backend zwraca { conversations, nextCursor } lub tablicę (stary format)
      const list = Array.isArray(d) ? d : (Array.isArray(d?.conversations) ? d.conversations : []);
      setConversations(list);
    } catch (e) {
      console.error('fetchConversations:', e);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  // ── Fetch friends ────────────────────────────────────────
  const fetchFriends = useCallback(async () => {
    try {
      const h = await headers();
      const r = await fetch(`${API}/friends`, { headers: h });
      const d = await r.json();
      setFriends(Array.isArray(d) ? d : []);
    } catch (e) {
      console.error('fetchFriends:', e);
      setFriends([]);
    }
  }, [headers]);

  // ── Fetch friend requests ────────────────────────────────
  const fetchRequests = useCallback(async () => {
    try {
      const h = await headers();
      const r = await fetch(`${API}/friends/requests`, { headers: h });
      const d = await r.json();
      setRequests(Array.isArray(d) ? d : []);
    } catch (e) {
      console.error('fetchRequests:', e);
      setRequests([]);
    }
  }, [headers]);

  // ── Search users ─────────────────────────────────────────
  const searchUsers = useCallback(async (q: string): Promise<ChatUser[]> => {
    try {
      const h = await headers();
      const r = await fetch(
        `${API}/users/search?q=${encodeURIComponent(q)}`,
        { headers: h },
      );
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }, [headers]);

  // ── Start / find conversation ────────────────────────────
  const startConversation = useCallback(async (
    userIds: number[],
    isGroup = false,
    name?: string,
  ): Promise<number | null> => {
    const h = await headers();
    const r = await fetch(`${API}/conversations`, {
      method:  'POST',
      headers: h,
      body:    JSON.stringify({ userIds, isGroup, name }),
    });
    const d = await r.json();
    if (!r.ok) {
      const err: Error & { code?: string | null; status?: number } = new Error(d?.error ?? 'startConversation failed');
      err.code   = d?.code ?? null;
      err.status = r.status;
      throw err;
    }
    await fetchConversations();
    return d.id ?? null;
  }, [headers, fetchConversations]);

  // ── Send friend request ──────────────────────────────────
  const sendFriendRequest = useCallback(async (userId: number) => {
    const h = await headers();
    const r = await fetch(`${API}/friends/request`, {
      method:  'POST',
      headers: h,
      body:    JSON.stringify({ userId }),
    });
    return r.json();
  }, [headers]);

  // ── Accept friend request ────────────────────────────────
  const acceptRequest = useCallback(async (friendshipId: number) => {
    const h = await headers();
    await fetch(`${API}/friends/${friendshipId}/accept`, {
      method:  'POST',
      headers: h,
    });
    setRequests(prev =>
      Array.isArray(prev) ? prev.filter(r => r.id !== friendshipId) : [],
    );
    fetchFriends();
  }, [headers, fetchFriends]);

  // ── Reject friend request ────────────────────────────────
  const rejectRequest = useCallback(async (friendshipId: number) => {
    const h = await headers();
    await fetch(`${API}/friends/${friendshipId}/reject`, {
      method:  'POST',
      headers: h,
    });
    setRequests(prev =>
      Array.isArray(prev) ? prev.filter(r => r.id !== friendshipId) : [],
    );
  }, [headers]);

  // ── Remove friend ────────────────────────────────────────
  const removeFriend = useCallback(async (friendshipId: number) => {
    const h = await headers();
    await fetch(`${API}/friends/${friendshipId}`, {
      method:  'DELETE',
      headers: h,
    });
    fetchFriends();
  }, [headers, fetchFriends]);

  // ── Get friend status ────────────────────────────────────
  const getFriendStatus = useCallback(async (userId: number) => {
    const h = await headers();
    const r = await fetch(`${API}/friends/status/${userId}`, { headers: h });
    return r.json();
  }, [headers]);

  // ── Init fetch ────────────────────────────────────��──────
  useEffect(() => {
    fetchConversations();
    fetchFriends();
    fetchRequests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    conversations,
    friends,
    requests,
    loading,
    socket:             socketRef.current,
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