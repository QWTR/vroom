import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiRequest } from '../lib/api/client';
import { ensureSharedSocket, joinSharedRoom } from '../lib/sharedSocket';
import type { ConvoySnapshot } from '../lib/convoyLive';
import type { ConvoyPlanEvent, ConvoyStatusEvent } from '../lib/convoyLive';
import {
  enqueueConvoyNotice,
  noticeFromPlanEvent,
  noticeFromStatusEvent,
  type ConvoyMapNotice,
} from '../lib/convoyUi';
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
  const [notices, setNotices] = useState<ConvoyMapNotice[]>([]);
  const locationRef = useRef(location);
  const convoyIdRef = useRef<string | null>(null);
  const snapshotRef = useRef<ConvoySnapshot | null>(null);
  const seenEventIdsRef = useRef(new Set<string>());
  const appStateRef = useRef(AppState.currentState);
  const foregroundSinceRef = useRef(0);

  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  const pushNotice = useCallback((notice: ConvoyMapNotice | null) => {
    const appState = AppState.currentState;
    if (
      !notice
      || appState === 'background'
      || appState === 'inactive'
      || seenEventIdsRef.current.has(notice.id)
    ) return;
    seenEventIdsRef.current.add(notice.id);
    if (seenEventIdsRef.current.size > 100) {
      seenEventIdsRef.current = new Set([...seenEventIdsRef.current].slice(-50));
    }
    setNotices((previous) => enqueueConvoyNotice(previous, notice));
  }, []);

  const dismissNotice = useCallback((id: string) => {
    setNotices((previous) => previous.filter((notice) => notice.id !== id));
  }, []);

  const clearActive = useCallback(() => {
    convoyIdRef.current = null;
    snapshotRef.current = null;
    setSnapshot(null);
    setNotices([]);
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
      snapshotRef.current = initial;
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
      const releaseRoom = await joinSharedRoom(
        `convoy:${initial.convoy.id}`,
        'convoy:join',
        'convoy:unsubscribe',
        { convoyId: initial.convoy.id },
      );
      if (disposed) {
        releaseRoom();
        return;
      }
      const onSnapshot = (next: ConvoySnapshot) => {
        if (next.convoy.id === convoyIdRef.current) {
          snapshotRef.current = next;
          setSnapshot(next);
        }
      };
      const onPosition = (position: any) => {
        const previous = snapshotRef.current;
        if (!previous) return;
        const next = {
          ...previous,
          participants: previous.participants.map((participant) => participant.userId === Number(position.userId)
            ? { ...participant, position, connection: 'live' }
            : participant),
        };
        snapshotRef.current = next;
        setSnapshot(next);
      };
      const onStatus = (status: ConvoyStatusEvent) => {
        const previousSnapshot = snapshotRef.current;
        const nextSnapshot = previousSnapshot ? {
          ...previousSnapshot,
          participants: previousSnapshot.participants.map((participant) => participant.userId === Number(status.userId)
            ? { ...participant, ...(status.status ? { quickStatus: status.status } : {}), ...(status.connection ? { connection: status.connection } : {}) }
            : participant),
        } : previousSnapshot;
        if (nextSnapshot) {
          snapshotRef.current = nextSnapshot;
          setSnapshot(nextSnapshot);
        }
        if (status.status && previousSnapshot) {
          pushNotice(noticeFromStatusEvent({
            event: { ...status, userId: Number(status.userId) },
            participants: previousSnapshot.participants,
            currentUserId,
            foregroundSince: foregroundSinceRef.current,
            receivedLive: true,
          }));
        }
      };
      const reload = async () => {
        try {
          const next = await apiRequest<ConvoySnapshot>('/convoys/active/me');
          if (!disposed) {
            snapshotRef.current = next;
            setSnapshot(next);
          }
        } catch {}
      };
      const onRoute = (event: ConvoyPlanEvent) => {
        void reload().finally(() => {
          const currentSnapshot = snapshotRef.current;
          if (!disposed && currentSnapshot) {
            pushNotice(noticeFromPlanEvent({
              event: { ...event, actorId: Number(event.actorId) },
              participants: currentSnapshot.participants,
              currentUserId,
              foregroundSince: foregroundSinceRef.current,
              receivedLive: true,
            }));
          }
        });
      };
      const onLeave = ({ userId }: any) => {
        if (Number(userId) === currentUserId) clearActive();
        else {
          const previous = snapshotRef.current;
          if (!previous) return;
          const next = { ...previous, participants: previous.participants.filter((participant) => participant.userId !== Number(userId)) };
          snapshotRef.current = next;
          setSnapshot(next);
        }
      };
      const onEnd = () => clearActive();
      socket.on('convoy:snapshot', onSnapshot);
      socket.on('convoy:position', onPosition);
      socket.on('convoy:status', onStatus);
      socket.on('convoy:join', reload);
      socket.on('convoy:leave', onLeave);
      socket.on('convoy:kick', onLeave);
      socket.on('convoy:route', onRoute);
      socket.on('convoy:end', onEnd);
      cleanupSocket = () => {
        socket.off('convoy:snapshot', onSnapshot);
        socket.off('convoy:position', onPosition);
        socket.off('convoy:status', onStatus);
        socket.off('convoy:join', reload);
        socket.off('convoy:leave', onLeave);
        socket.off('convoy:kick', onLeave);
        socket.off('convoy:route', onRoute);
        socket.off('convoy:end', onEnd);
        releaseRoom();
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
      if (state === 'active' && previous !== 'active') {
        foregroundSinceRef.current = Date.now();
        setNotices([]);
      } else if (state !== 'active') {
        setNotices([]);
      }
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
  }, [clearActive, currentUserId, isPremium, pushNotice]));

  return {
    activeConvoy: snapshot,
    convoyNotices: notices,
    dismissConvoyNotice: dismissNotice,
    clearActiveConvoy: clearActive,
  };
}
