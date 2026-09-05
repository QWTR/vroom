import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from '../constants/config';
import { getAuthTokenCached } from './api/authTokenMemory';

let socket: Socket | null = null;
let connecting: Promise<Socket | null> | null = null;
const rooms = new Map<string, { count: number; joinEvent: string; leaveEvent: string; payload: unknown }>();
const backgroundHolds = new Set<string>();

export async function ensureSharedSocket(): Promise<Socket | null> {
  if (socket) {
    if (!socket.connected) socket.connect();
    return socket;
  }
  if (connecting) return connecting;
  connecting = (async () => {
    const token = await getAuthTokenCached();
    if (!token) return null;
    const next = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
    next.on('connect', () => {
      for (const room of rooms.values()) next.emit(room.joinEvent, room.payload);
    });
    socket = next;
    return next;
  })().finally(() => { connecting = null; });
  return connecting;
}

export function currentSharedSocket(): Socket | null {
  return socket;
}

export function pauseSharedSocket(): void {
  if (backgroundHolds.size > 0) return;
  socket?.disconnect();
}

export function setSharedSocketBackgroundHold(key: string, active: boolean): void {
  if (active) {
    backgroundHolds.add(key);
    void ensureSharedSocket();
  } else {
    backgroundHolds.delete(key);
  }
}

export function destroySharedSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  connecting = null;
  rooms.clear();
  backgroundHolds.clear();
}

export async function subscribeSharedSocket<T>(event: string, listener: (payload: T) => void): Promise<() => void> {
  const active = await ensureSharedSocket();
  if (!active) return () => {};
  active.on(event, listener as (...args: any[]) => void);
  return () => active.off(event, listener as (...args: any[]) => void);
}

export async function joinSharedRoom(
  key: string,
  joinEvent: string,
  leaveEvent: string,
  payload: unknown,
): Promise<() => void> {
  const existing = rooms.get(key);
  if (existing) existing.count += 1;
  else rooms.set(key, { count: 1, joinEvent, leaveEvent, payload });
  const active = await ensureSharedSocket();
  active?.emit(joinEvent, payload);
  return () => {
    const room = rooms.get(key);
    if (!room) return;
    room.count -= 1;
    if (room.count > 0) return;
    rooms.delete(key);
    socket?.emit(leaveEvent, payload);
  };
}
