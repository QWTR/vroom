import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SOCKET_URL } from '../constants/config';

export type BugReportMsg = {
  id: number;
  authorKind: string;
  body: string;
  photos: string[];
  videos: string[];
  createdAt: string;
  staffEmail?: string | null;
};

type ReadPayload = {
  reportId: number;
  readerType: 'user' | 'staff';
  readAt: string;
};

type TypingPayload = {
  reportId: number;
  isTyping: boolean;
  userType: string;
};

export function useBugReportSocket(
  reportId: number | string | undefined,
  handlers: {
    onMessage?: (msg: BugReportMsg) => void;
    onRead?: (payload: ReadPayload) => void;
    onTyping?: (payload: TypingPayload) => void;
  },
) {
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const id = Number(reportId);
    if (!Number.isInteger(id) || id <= 0) return;

    let cancelled = false;

    (async () => {
      const token =
        (await AsyncStorage.getItem('userToken')) ??
        (await AsyncStorage.getItem('token'));
      if (!token || cancelled) return;

      const socket = io(SOCKET_URL, {
        auth: { token },
        transports: ['websocket'],
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('bugreport:join', id);
      });

      socket.on('bugreport:message', ({ message }: { message: BugReportMsg }) => {
        handlersRef.current.onMessage?.(message);
      });

      socket.on('bugreport:read', (payload: ReadPayload) => {
        handlersRef.current.onRead?.(payload);
      });

      socket.on('bugreport:typing', (payload: TypingPayload) => {
        handlersRef.current.onTyping?.(payload);
      });
    })();

    return () => {
      cancelled = true;
      const s = socketRef.current;
      if (s) {
        s.emit('bugreport:leave', Number(reportId));
        s.disconnect();
        socketRef.current = null;
      }
    };
  }, [reportId]);

  const emitTyping = useCallback(
    (isTyping: boolean) => {
      const id = Number(reportId);
      if (!socketRef.current?.connected || !Number.isInteger(id)) return;
      socketRef.current.emit('bugreport:typing', {
        reportId: id,
        isTyping,
        userType: 'user',
      });
    },
    [reportId],
  );

  return { emitTyping, socket: socketRef };
}
