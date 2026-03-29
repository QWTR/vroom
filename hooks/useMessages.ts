import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Socket } from 'socket.io-client';
import { Message } from './useChats';

const API = 'https://v-room.app/api/chat';

export function useMessages(conversationId: number, socket: Socket | null) {
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor,  setNextCursor]  = useState<number | null>(null);
  const [typing,      setTyping]      = useState<number[]>([]); // userIds piszących
  const typingTimer   = useRef<any>(null);

  const getToken = async () => AsyncStorage.getItem('token') ?? '';

  // ── Fetch messages ───────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const r = await fetch(`${API}/conversations/${conversationId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      setMessages(d.messages ?? []);
      setNextCursor(d.nextCursor);
    } catch (e) { console.error('fetchMessages:', e); }
    finally { setLoading(false); }
  }, [conversationId]);

  // ── Load more (pagination) ───────────────────────────────
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const token = await getToken();
      const r = await fetch(
        `${API}/conversations/${conversationId}/messages?cursor=${nextCursor}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d = await r.json();
      setMessages(prev => [...(d.messages ?? []), ...prev]);
      setNextCursor(d.nextCursor);
    } catch (e) { console.error('loadMore:', e); }
    finally { setLoadingMore(false); }
  }, [conversationId, nextCursor, loadingMore]);

  // ── Send message ─────────────────────────────────────────
  const sendMessage = useCallback(async (
    content: string,
    photos:  string[] = [],
    replyToId?: number,
  ) => {
    const token = await getToken();
    const form  = new FormData();
    if (content.trim()) form.append('content', content.trim());
    if (replyToId)       form.append('replyToId', String(replyToId));

    photos.forEach((uri, i) => {
      form.append('photos', {
        uri,
        type: 'image/jpeg',
        name: `photo_${i}.jpg`,
      } as any);
    });

    const r = await fetch(`${API}/conversations/${conversationId}/messages`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
    });
    return r.json();
  }, [conversationId]);

  // ── Socket — join room i odbieranie wiadomości ───────────
  useEffect(() => {
    if (!socket) return;

    socket.emit('chat:join', conversationId);

    socket.on('chat:message', (msg: Message) => {
      if (msg.conversationId === conversationId) {
        setMessages(prev => [...prev, msg]);
      }
    });

    socket.on('chat:typing', ({ userId, isTyping }: { userId: number; isTyping: boolean }) => {
      setTyping(prev =>
        isTyping
          ? [...new Set([...prev, userId])]
          : prev.filter(id => id !== userId)
      );
    });

    return () => {
      socket.emit('chat:leave', conversationId);
      socket.off('chat:message');
      socket.off('chat:typing');
    };
  }, [socket, conversationId]);

  // ── Emit typing ──────────────────────────────────────────
  const emitTyping = useCallback(() => {
    if (!socket) return;
    socket.emit('chat:typing', { conversationId, isTyping: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit('chat:typing', { conversationId, isTyping: false });
    }, 2000);
  }, [socket, conversationId]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  return {
    messages, loading, loadingMore, nextCursor, typing,
    fetchMessages, loadMore, sendMessage, emitTyping,
  };
}