import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiRequest } from '../lib/api/client';
import { ensureSharedSocket } from '../lib/sharedSocket';
import type { ConvoySnapshot } from '../lib/convoyLive';
import { BG_ACTIVE_CONVOY_HOST_KEY, BG_ACTIVE_CONVOY_ID_KEY } from './useBackgroundTracking';

type MapLocation = {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
};

export function useActiveConvoyMap({
  currentUserId,
  isPremium,
  location,
}: {
  currentUserId: number | null;
  isPremium: boolean;
  location: MapLocation | null;
}) {
  const [snapshot, setSnapshot] = useState<ConvoySnapshot | null>(null);
  const locationRef = useRef(location);
  const convoyIdRef = useRef<string | null>(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => { locationRef.current = location; }, [location]);

  const clearActive = useCallback(() => {
    convoyIdRef.current = null;
    setSnapshot(null);
    void AsyncStorage.multiRemove([BG_ACTIVE_CONVOY_ID_KEY, BG_ACTIVE_CONVOY_HOST_KEY]);
  }, []);

  useFocusEffect(useCallback(() => {
    if (currentUserId == null) return undefined;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cleanupSocket: (() => void) | null = null;

    const connect = async (initial: ConvoySnapshot) => {
      if (disposed) return;
      convoyIdRef.current = initial.convoy.id;
      setSnapshot(initial);
      const host = initial.convoy.hostId === currentUserId;
      if (isPremium || host) {
        await AsyncStorage.multiSet([
          [BG_ACTIVE_CONVOY_ID_KEY, initial.convoy.id],
          [BG_ACTIVE_CONVOY_HOST_KEY, host ? 'true' : 'false'],
        ]);
      }
      const socket = await ensureSharedSocket();
      if (!socket || disposed) return;
      socket.emit('convoy:join', { convoyId: initial.convoy.id });
      const onSnapshot = (next: ConvoySnapshot) => {
        if (next.convoy.id === convoyIdRef.current) setSnapshot(next);
      };
      const onPosition = (position: any) => setSnapshot((previous) => previous ? {
        ...previous,
        participants: previous.participants.map((participant) => participant.userId === Number(position.userId)
          ? { ...participant, position, connection: 'live' }
          : participant),
      } : previous);
      const onStatus = (status: any) => setSnapshot((previous) => previous ? {
        ...previous,
        participants: previous.participants.map((participant) => participant.userId === Number(status.userId)
          ? { ...participant, ...(status.status ? { quickStatus: status.status } : {}), ...(status.connection ? { connection: status.connection } : {}) }
          : participant),
      } : previous);
      const reload = () => apiRequest<ConvoySnapshot>('/convoys/active/me').then((next) => {
        if (!disposed) setSnapshot(next);
      }).catch(() => {});
      const onLeave = ({ userId }: any) => {
        if (Number(userId) === currentUserId) clearActive();
        else setSnapshot((previous) => previous ? { ...previous, participants: previous.participants.filter((participant) => participant.userId !== Number(userId)) } : previous);
      };
      const onEnd = () => clearActive();
      socket.on('convoy:snapshot', onSnapshot);
      socket.on('convoy:position', onPosition);
      socket.on('convoy:status', onStatus);
      socket.on('convoy:join', reload);
      socket.on('convoy:leave', onLeave);
      socket.on('convoy:kick', onLeave);
      socket.on('convoy:route', reload);
      socket.on('convoy:end', onEnd);
      cleanupSocket = () => {
        socket.off('convoy:snapshot', onSnapshot);
        socket.off('convoy:position', onPosition);
        socket.off('convoy:status', onStatus);
        socket.off('convoy:join', reload);
        socket.off('convoy:leave', onLeave);
        socket.off('convoy:kick', onLeave);
        socket.off('convoy:route', reload);
        socket.off('convoy:end', onEnd);
      };

      timer = setInterval(() => {
        if (AppState.currentState !== 'active' || convoyIdRef.current !== initial.convoy.id) return;
        const next = locationRef.current;
        if (!next || !Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) return;
        socket.emit('convoy:position', {
          lat: next.latitude,
          lng: next.longitude,
          heading: next.heading ?? null,
          speedKmh: Math.max(0, Number(next.speed ?? 0) * 3.6),
          foreground: true,
        });
      }, 1500);
    };

    void apiRequest<ConvoySnapshot>('/convoys/active/me').then(connect).catch(() => {
      if (!disposed) setSnapshot(null);
    });
    const appStateSubscription = AppState.addEventListener('change', async (state) => {
      const previous = appStateRef.current;
      appStateRef.current = state;
      if (previous === 'active' && state !== 'active' && !isPremium && convoyIdRef.current) {
        const socket = await ensureSharedSocket();
        const last = locationRef.current;
        if (last) socket?.emit('convoy:position', { lat: last.latitude, lng: last.longitude, foreground: false });
      }
    });

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      cleanupSocket?.();
      appStateSubscription.remove();
    };
  }, [clearActive, currentUserId, isPremium]));

  return { activeConvoy: snapshot, clearActiveConvoy: clearActive };
}
