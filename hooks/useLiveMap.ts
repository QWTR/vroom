import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import * as Speech from 'expo-speech';
import * as Notifications from 'expo-notifications';
import { Image } from 'expo-image';
import { API_URL } from '../constants/mapConfig';
import { normalizeMediaUri } from '../lib/mediaUri';
import { snapToRoute } from '../scripts/navigationUtils';
import {
  createLiveMapStore,
  useLiveMapUserIds,
  type LiveMapStore,
  type LiveUserMeta,
} from './liveMapStore';

export interface LiveUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
  avatarFrameUrl?: string | null;
  lat:       number;
  lng:       number;
  online:    boolean;
  isFriend?: boolean;
  isPremium?: boolean;
  serverAt?: number | null;
  seq?: number | null;
}

export interface LiveWarning {
  id:           number;
  type:         'traffic' | 'weather' | 'accident' | 'car_breakdown' | 'speed_control' | 'kosmici' | 'Animal';
  lat:          number;
  lng:          number;
  message:      string;
  createdAt:    string;
  expiresAt:    string;
  confirmCount: number;
  user:         { id: number; username: string; avatarUrl: string | null };
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const PROXIMITY_THRESHOLD_M     = 500;
const FETCH_TIMEOUT_MS          = 8000;
const WARNING_VISIBLE_RADIUS_KM = 25;
const LIVE_USERS_RADIUS_KM = 35;
const LIVE_USERS_TAKE = 220;
/** Brak aktualizacji pozycji — usuń zombie (snapshot / prune). */
const LIVE_USER_STALE_MS = 60_000;
/** Opóźnienie przed usunięciem po user:offline (chroni przed miganiem). */
const LIVE_USER_OFFLINE_GRACE_MS = 15_000;
const GEO_USERS_REFRESH_MIN_MS = 28_000;
const GEO_USERS_REFRESH_MIN_MOVE_KM = 1.2;
const LIVE_USER_EVENT_STALE_MS = 2 * 60 * 1000;
const USERS_REFRESH_MS = 45_000;
const SOCKET_USERS_FALLBACK_MS = 1_500;
const LIVE_USERS_REST_FRESH_MS = 40_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}


export function useLiveMap(
  isSharing:       boolean,
  userLocation:    { latitude: number; longitude: number } | null,
  isSpeechEnabled: boolean,
  allowBackgroundWork = false,
  mapSessionActive = true,
  liveUsersEnabled = true,
) {
  const storeRef = useRef<LiveMapStore | null>(null);
  if (!storeRef.current) storeRef.current = createLiveMapStore();
  const store = storeRef.current;
  const liveUserIds = useLiveMapUserIds(store);

  const [warnings,        setWarnings]        = useState<LiveWarning[]>([]);
  const [visibleWarnings, setVisibleWarnings] = useState<LiveWarning[]>([]);
  const [connected,       setConnected]       = useState(false);
  const [sharingStatus,   setSharingStatus]   = useState<'off' | 'connecting' | 'on'>(
    isSharing ? 'connecting' : 'off',
  );

  const socketRef          = useRef<Socket | null>(null);
  const tokenRef           = useRef<string | null>(null);
  const toggleInFlightRef  = useRef(false);
  const alertedWarningsRef = useRef<Set<number>>(new Set());
  const isSpeechRef        = useRef(isSpeechEnabled);
  const isSharingRef       = useRef(isSharing);
  const routePointsRef     = useRef<{ latitude: number; longitude: number }[]>([]);
  const userLocationRef    = useRef<{ latitude: number; longitude: number } | null>(null);
  const toggleRetryRef     = useRef(0);
  const allowBgRef              = useRef(allowBackgroundWork);
  const mapSessionActiveRef     = useRef(mapSessionActive);
  const liveUsersEnabledRef     = useRef(liveUsersEnabled);
  const appStateRef             = useRef<AppStateStatus>(AppState.currentState);
  const lastSnapshotAtRef  = useRef(0);
  const hasUsersFromSocketRef = useRef(false);
  const usersFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    allowBgRef.current = allowBackgroundWork;
  }, [allowBackgroundWork]);
  useEffect(() => {
    mapSessionActiveRef.current = mapSessionActive;
  }, [mapSessionActive]);
  useEffect(() => {
    liveUsersEnabledRef.current = liveUsersEnabled;
  }, [liveUsersEnabled]);

  const isForegroundActive = useCallback(() => {
    return appStateRef.current === 'active';
  }, []);

  const liveUserLastSeenRef = useRef<Map<number, number>>(new Map());
  const pendingOfflineRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const liveUserLastSeqRef = useRef<Map<number, number>>(new Map());
  const liveUserLastServerAtRef = useRef<Map<number, number>>(new Map());

  const checkSingleWarningProximityRef = useRef<((w: LiveWarning) => void) | null>(null);

  const touchLiveUser = useCallback((id: number) => {
    if (!Number.isFinite(id)) return;
    liveUserLastSeenRef.current.set(id, Date.now());
    const pending = pendingOfflineRef.current.get(id);
    if (pending) {
      clearTimeout(pending);
      pendingOfflineRef.current.delete(id);
    }
  }, []);

  const isIncomingNewer = useCallback((
    id: number,
    serverAt?: number | null,
    seq?: number | null,
  ): boolean => {
    const prevSeq = liveUserLastSeqRef.current.get(id);
    const prevAt = liveUserLastServerAtRef.current.get(id);
    if (Number.isFinite(seq) && prevSeq != null) {
      return Number(seq) > prevSeq;
    }
    if (Number.isFinite(serverAt) && prevAt != null) {
      return Number(serverAt) >= prevAt;
    }
    return prevSeq == null && prevAt == null;
  }, []);

  const pickCoords = useCallback((
    id: number,
    incoming: { lat: number; lng: number; serverAt?: number | null; seq?: number | null },
    prevLat?: number,
    prevLng?: number,
  ) => {
    const pos = store.getPosition(id);
    const baseLat = prevLat ?? pos?.lat ?? incoming.lat;
    const baseLng = prevLng ?? pos?.lng ?? incoming.lng;
    if (isIncomingNewer(id, incoming.serverAt, incoming.seq)) {
      return { lat: incoming.lat, lng: incoming.lng };
    }
    return { lat: baseLat, lng: baseLng };
  }, [isIncomingNewer, store]);

  const removeLiveUser = useCallback((id: number) => {
    if (!Number.isFinite(id)) return;
    liveUserLastSeenRef.current.delete(id);
    liveUserLastSeqRef.current.delete(id);
    liveUserLastServerAtRef.current.delete(id);
    const pending = pendingOfflineRef.current.get(id);
    if (pending) {
      clearTimeout(pending);
      pendingOfflineRef.current.delete(id);
    }
    store.removeUser(id);
  }, [store]);

  const scheduleLiveUserOffline = useCallback((id: number) => {
    if (!Number.isFinite(id)) return;
    const existing = pendingOfflineRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingOfflineRef.current.delete(id);
      removeLiveUser(id);
    }, LIVE_USER_OFFLINE_GRACE_MS);
    pendingOfflineRef.current.set(id, timer);
  }, [removeLiveUser]);

  const pruneStaleLiveUsers = useCallback(() => {
    const now = Date.now();
    for (const id of store.getUserIdsSnapshot()) {
      const last = liveUserLastSeenRef.current.get(id) ?? 0;
      if (now - last >= LIVE_USER_STALE_MS) {
        removeLiveUser(id);
      }
    }
  }, [store, removeLiveUser]);

  /** Scal listę użytkowników — batch merge bez flicker; prune zombie in-place. */
  const mergeLiveUsersFromApi = useCallback((incoming: LiveUser[]) => {
    const now = Date.now();
    const incomingById = new Set<number>();
    const batchEntries: { meta: LiveUserMeta; lat: number; lng: number }[] = [];

    for (const u of incoming) {
      if (!Number.isFinite(u?.id) || !Number.isFinite(u?.lat) || !Number.isFinite(u?.lng)) continue;
      incomingById.add(u.id);
      touchLiveUser(u.id);

      const prevMeta = store.getMeta(u.id);
      const prevPos = store.getPosition(u.id);
      const coords = pickCoords(u.id, u, prevPos?.lat, prevPos?.lng);

      if (Number.isFinite(Number(u?.seq))) {
        const seq = Number(u.seq);
        const prevSeq = liveUserLastSeqRef.current.get(u.id);
        if (prevSeq == null || seq >= prevSeq) {
          liveUserLastSeqRef.current.set(u.id, seq);
        }
      }
      if (Number.isFinite(Number(u?.serverAt))) {
        const at = Number(u.serverAt);
        const prevAt = liveUserLastServerAtRef.current.get(u.id);
        if (prevAt == null || at >= prevAt) {
          liveUserLastServerAtRef.current.set(u.id, at);
        }
      }

      const meta: LiveUserMeta = {
        id: u.id,
        username: u.username,
        avatarUrl: u.avatarUrl ?? prevMeta?.avatarUrl ?? null,
        avatarFrameUrl: u.avatarFrameUrl ?? prevMeta?.avatarFrameUrl ?? null,
        online: u.online,
        isFriend: u.isFriend ?? prevMeta?.isFriend,
        isPremium: u.isPremium ?? prevMeta?.isPremium,
        serverAt: u.serverAt ?? prevMeta?.serverAt ?? null,
        seq: u.seq ?? prevMeta?.seq ?? null,
      };
      batchEntries.push({ meta, lat: coords.lat, lng: coords.lng });

      const avatarUri = normalizeMediaUri(meta.avatarUrl);
      if (avatarUri) Image.prefetch(avatarUri).catch(() => {});
    }

    const pruneIds: number[] = [];
    for (const id of store.getUserIdsSnapshot()) {
      if (incomingById.has(id)) continue;
      const last = liveUserLastSeenRef.current.get(id) ?? 0;
      if (now - last >= LIVE_USER_STALE_MS) {
        liveUserLastSeenRef.current.delete(id);
        liveUserLastSeqRef.current.delete(id);
        liveUserLastServerAtRef.current.delete(id);
        const pending = pendingOfflineRef.current.get(id);
        if (pending) {
          clearTimeout(pending);
          pendingOfflineRef.current.delete(id);
        }
        pruneIds.push(id);
      }
    }

    store.mergeUsersBatch(batchEntries, pruneIds);
  }, [touchLiveUser, store, pickCoords]);

  const joinLiveMapRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit('live:join');
  }, []);

  const leaveLiveMapRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit('live:leave');
  }, []);

  const buildLiveUsersUrl = useCallback(() => {
    const loc = userLocationRef.current;
    const qs = new URLSearchParams();
    qs.set('take', String(LIVE_USERS_TAKE));
    if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
      qs.set('lat', String(loc.latitude));
      qs.set('lng', String(loc.longitude));
      qs.set('radiusKm', String(LIVE_USERS_RADIUS_KM));
    }
    return `${API_URL}/api/live/users?${qs.toString()}`;
  }, []);

  useEffect(() => { userLocationRef.current = userLocation; },   [userLocation]);
  useEffect(() => { isSpeechRef.current     = isSpeechEnabled; }, [isSpeechEnabled]);
  useEffect(() => {
    isSharingRef.current = isSharing;
    if (!isSharing) {
      setSharingStatus('off');
    } else if (connected && liveUsersEnabled) {
      setSharingStatus('on');
    } else if (isSharing) {
      setSharingStatus('connecting');
    }
  }, [isSharing, connected, liveUsersEnabled]);

  // Synchronizacja pokoju live_map — tylko gdy flota włączona (Ghost = brak join).
  useEffect(() => {
    if (!liveUsersEnabled || !connected) {
      if (connected && socketRef.current?.connected) {
        leaveLiveMapRoom();
      }
      return;
    }
    joinLiveMapRoom();
  }, [liveUsersEnabled, connected, joinLiveMapRoom, leaveLiveMapRoom]);

  // ── Filtruj warnings do 25 km gdy zmienia się pozycja lub lista ──
  useEffect(() => {
    const src = warnings ?? [];
    if (!userLocation) {
      setVisibleWarnings(src);
      return;
    }
    const filtered = src.filter(w => {
      const km = distanceKm(
        userLocation.latitude,  userLocation.longitude,
        Number(w.lat),          Number(w.lng),
      );
      return km <= WARNING_VISIBLE_RADIUS_KM;
    });
    setVisibleWarnings(filtered);
  }, [userLocation?.latitude, userLocation?.longitude, warnings]);

  const clearUsersFallbackTimer = useCallback(() => {
    if (usersFallbackTimerRef.current) {
      clearTimeout(usersFallbackTimerRef.current);
      usersFallbackTimerRef.current = null;
    }
  }, []);


  const fetchWarnings = useCallback(async (token: string) => {
    try {
      const loc = userLocationRef.current;
      const warningsQs = new URLSearchParams();
      if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
        warningsQs.set('lat', String(loc.latitude));
        warningsQs.set('lng', String(loc.longitude));
        warningsQs.set('radiusKm', String(WARNING_VISIBLE_RADIUS_KM));
      }
      const warningsUrl = `${API_URL}/api/live/warnings${warningsQs.toString() ? `?${warningsQs}` : ''}`;
      const warningsRes = await fetchWithTimeout(
        warningsUrl,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (warningsRes.ok) {
        const data = await warningsRes.json();
        setWarnings(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.log('fetchWarnings error:', e);
    }
  }, []);

  const fetchLiveUsersRest = useCallback(async (token: string) => {
    if (!liveUsersEnabledRef.current) return;
    if (
      socketRef.current?.connected
      && hasUsersFromSocketRef.current
      && Date.now() - lastSnapshotAtRef.current < LIVE_USERS_REST_FRESH_MS
    ) {
      return;
    }
    try {
      const usersRes = await fetchWithTimeout(
        buildLiveUsersUrl(),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (usersRes.ok && liveUsersEnabledRef.current) {
        const data = await usersRes.json();
        const users: LiveUser[] = Array.isArray(data) ? data : [];
        mergeLiveUsersFromApi(users);
      }
    } catch (e) {
      console.log('fetchLiveUsersRest error:', e);
    }
  }, [buildLiveUsersUrl, mergeLiveUsersFromApi]);

  const scheduleUsersRestFallback = useCallback((token: string) => {
    clearUsersFallbackTimer();
    usersFallbackTimerRef.current = setTimeout(() => {
      usersFallbackTimerRef.current = null;
      if (!liveUsersEnabledRef.current) return;
      if (hasUsersFromSocketRef.current) return;
      void fetchLiveUsersRest(token);
    }, SOCKET_USERS_FALLBACK_MS);
  }, [clearUsersFallbackTimer, fetchLiveUsersRest]);

  const fetchInitialData = useCallback(async (token: string) => {
    await fetchWarnings(token);
    if (liveUsersEnabledRef.current) {
      scheduleUsersRestFallback(token);
    }
  }, [fetchWarnings, scheduleUsersRestFallback]);

  // Geo refresh REST tylko gdy socket martwy lub dawno bez snapshotu.
  const lastUsersGeoRefreshRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  const clearLiveUsersFleetState = useCallback(() => {
    clearUsersFallbackTimer();
    pendingOfflineRef.current.forEach((t) => clearTimeout(t));
    pendingOfflineRef.current.clear();
    liveUserLastSeenRef.current.clear();
    liveUserLastSeqRef.current.clear();
    liveUserLastServerAtRef.current.clear();
    hasUsersFromSocketRef.current = false;
    lastSnapshotAtRef.current = 0;
    lastUsersGeoRefreshRef.current = null;
    store.clear();
  }, [store, clearUsersFallbackTimer]);

  // Ghost Mode — wyłącz flotę, socket zostaje dla ostrzeżeń.
  useEffect(() => {
    if (liveUsersEnabled) return;
    if (connected && socketRef.current?.connected) {
      leaveLiveMapRoom();
    }
    clearLiveUsersFleetState();
  }, [liveUsersEnabled, connected, leaveLiveMapRoom, clearLiveUsersFleetState]);

  // Blur taba — pełne rozłączenie sesji mapy (socket + ostrzeżenia).
  useEffect(() => {
    if (mapSessionActive) return;
    clearUsersFallbackTimer();
    if (socketRef.current?.connected) {
      socketRef.current.emit('live:leave');
    }
    socketRef.current?.disconnect();
    setConnected(false);
    setSharingStatus('off');
    clearLiveUsersFleetState();
    setWarnings([]);
  }, [mapSessionActive, clearUsersFallbackTimer, clearLiveUsersFleetState]);

  // Po połączeniu — ostrzeżenia + opcjonalnie fallback floty.
  useEffect(() => {
    if (!mapSessionActive || !connected) return;
    const tok = tokenRef.current;
    if (!tok) return;
    void fetchWarnings(tok);
    if (liveUsersEnabled) {
      scheduleUsersRestFallback(tok);
    }
  }, [mapSessionActive, liveUsersEnabled, connected, fetchWarnings, scheduleUsersRestFallback]);

  useEffect(() => {
    if (!liveUsersEnabled) return;
    if (!userLocation) return;
    const tok = tokenRef.current;
    if (!tok) return;
    const now = Date.now();
    const prev = lastUsersGeoRefreshRef.current;
    const movedKm = prev
      ? distanceKm(prev.lat, prev.lng, userLocation.latitude, userLocation.longitude)
      : Infinity;
    if (prev && now - prev.at < GEO_USERS_REFRESH_MIN_MS && movedKm < GEO_USERS_REFRESH_MIN_MOVE_KM) return;
    lastUsersGeoRefreshRef.current = {
      lat: userLocation.latitude,
      lng: userLocation.longitude,
      at: now,
    };
    if (
      socketRef.current?.connected
      && now - lastSnapshotAtRef.current < LIVE_USERS_REST_FRESH_MS
    ) return;
    void fetchLiveUsersRest(tok);
  }, [userLocation?.latitude, userLocation?.longitude, liveUsersEnabled, fetchLiveUsersRest]);

  // ── Init Socket ───────────────────────────────────────
  useEffect(() => {
    if (!mapSessionActive) return;
    (async () => {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;
      tokenRef.current = token;

      const socket = io(API_URL, {
        auth:              { token },
        transports:        ['websocket'],
        reconnection:      true,
        reconnectionDelay: 2000,
        pingTimeout:       60000,
        pingInterval:      25000,
      });
      socketRef.current = socket;

      socket.on('connect', async () => {
        setConnected(true);
        hasUsersFromSocketRef.current = false;
        if (liveUsersEnabledRef.current) {
          joinLiveMapRoom();
        }
        await fetchWarnings(token);
        if (liveUsersEnabledRef.current) {
          scheduleUsersRestFallback(token);
        }
      });

      socket.on('disconnect', (reason) => {
        setConnected(false);
        if (
          reason === 'io server disconnect'
          && mapSessionActiveRef.current
          && (isSharingRef.current || isForegroundActive())
        ) {
          socket.connect();
        }
      });

      socket.on('connect_error', (err) => console.log('❌ connect_error:', err.message));

      socket.on('user:location', (data: any) => {
        if (!liveUsersEnabledRef.current) return;
        const id = Number(data?.id);
        const rawLat = Number(data?.lat);
        const rawLng = Number(data?.lng);
        const seq = Number(data?.seq);
        const serverAtRaw = Number(data?.serverAt ?? data?.locationAt);
        const serverAt = Number.isFinite(serverAtRaw) ? serverAtRaw : Date.now();
        if (!Number.isFinite(id) || !Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return;
        if (Date.now() - serverAt > LIVE_USER_EVENT_STALE_MS) return;
        const prevSeq = liveUserLastSeqRef.current.get(id);
        if (Number.isFinite(seq) && prevSeq != null && seq <= prevSeq) return;
        const prevServerAt = liveUserLastServerAtRef.current.get(id);
        if (prevServerAt != null && serverAt < prevServerAt) return;
        if (Number.isFinite(seq)) liveUserLastSeqRef.current.set(id, seq);
        liveUserLastServerAtRef.current.set(id, serverAt);
        touchLiveUser(id);

        const existingMeta = store.getMeta(id);
        const meta: LiveUserMeta = {
          id,
          username: typeof data?.username === 'string'
            ? data.username
            : (existingMeta?.username ?? ''),
          avatarUrl: data?.avatarUrl !== undefined
            ? data.avatarUrl
            : (existingMeta?.avatarUrl ?? null),
          avatarFrameUrl: data?.avatarFrameUrl !== undefined
            ? data.avatarFrameUrl
            : (existingMeta?.avatarFrameUrl ?? null),
          online: data?.online ?? existingMeta?.online ?? true,
          isFriend: data?.isFriend ?? existingMeta?.isFriend,
          isPremium: data?.isPremium ?? existingMeta?.isPremium,
          serverAt,
          seq: Number.isFinite(seq) ? seq : null,
        };
        store.setMeta(meta);
        store.setPosition(id, rawLat, rawLng, true);
        store.syncUserIdsArray();
        lastSnapshotAtRef.current = Date.now();
      });

      socket.on('live:users:snapshot', (data: any) => {
        if (!liveUsersEnabledRef.current) return;
        const users: LiveUser[] = (Array.isArray(data) ? data : [])
          .map((u) => ({
            id: Number(u?.id),
            username: typeof u?.username === 'string' ? u.username : '',
            avatarUrl: typeof u?.avatarUrl === 'string' ? u.avatarUrl : null,
            avatarFrameUrl: typeof u?.avatarFrameUrl === 'string' ? u.avatarFrameUrl : null,
            lat: Number(u?.lat),
            lng: Number(u?.lng),
            online: u?.online !== false,
            isPremium: !!u?.isPremium,
            serverAt: Number.isFinite(Number(u?.serverAt)) ? Number(u.serverAt) : null,
            seq: Number.isFinite(Number(u?.seq)) ? Number(u.seq) : null,
          }))
          .filter((u) =>
            Number.isFinite(u.id)
            && Number.isFinite(u.lat)
            && Number.isFinite(u.lng),
          );
        hasUsersFromSocketRef.current = true;
        lastSnapshotAtRef.current = Date.now();
        clearUsersFallbackTimer();
        mergeLiveUsersFromApi(users);
      });

      socket.on('user:offline', (data) => {
        if (!liveUsersEnabledRef.current) return;
        const id = Number(data?.id);
        if (!Number.isFinite(id)) return;
        // Manual OFF should disappear immediately; disconnects still use grace.
        if (data?.hard === true || data?.reason === 'manual_off') {
          removeLiveUser(id);
          return;
        }
        scheduleLiveUserOffline(id);
      });

      socket.on('warning:new', (warning: LiveWarning) => {
        if (!mapSessionActiveRef.current) return;
        setWarnings(prev => [warning, ...(prev ?? [])]);
        checkSingleWarningProximityRef.current?.(warning);
      });

      socket.on('warning:confirmed', ({ id, confirmCount, expiresAt }: any) => {
        setWarnings(prev =>
          (prev ?? []).map(w => w.id === id ? { ...w, confirmCount, expiresAt } : w),
        );
      });

      socket.on('warning:removed', ({ id }: any) => {
        setWarnings(prev => (prev ?? []).filter(w => w.id !== id));
        alertedWarningsRef.current.delete(id);
      });

      socket.on('warnings:cleanup', () => {
        const now = new Date();
        setWarnings(prev => {
          const src     = prev ?? [];
          const expired = src.filter(w => new Date(w.expiresAt) <= now);
          expired.forEach(w => alertedWarningsRef.current.delete(w.id));
          return src.filter(w => new Date(w.expiresAt) > now);
        });
      });

      await fetchInitialData(token);
    })();
    return () => {
      clearUsersFallbackTimer();
      const s = socketRef.current;
      if (s) {
        if (s.connected) s.emit('live:leave');
        s.disconnect();
      }
    };
  }, [
    fetchInitialData,
    mapSessionActive,
    touchLiveUser,
    scheduleLiveUserOffline,
    removeLiveUser,
    clearUsersFallbackTimer,
    fetchWarnings,
    scheduleUsersRestFallback,
    joinLiveMapRoom,
    mergeLiveUsersFromApi,
    store,
    pickCoords,
    isIncomingNewer,
  ]);

  // Pause socket when app is backgrounded without background permission
  useEffect(() => {
    if (!mapSessionActive) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      appStateRef.current = next;
      if ((next === 'background' || next === 'inactive') && !allowBgRef.current) {
        const s = socketRef.current;
        if (s?.connected) s.emit('live:leave');
        s?.disconnect();
        setConnected(false);
      } else if (next === 'active' && tokenRef.current && mapSessionActiveRef.current) {
        const s = socketRef.current;
        if (s && !s.connected) {
          s.connect();
        } else if (s?.connected) {
          if (liveUsersEnabledRef.current) joinLiveMapRoom();
          void fetchWarnings(tokenRef.current!);
          if (liveUsersEnabledRef.current) {
            scheduleUsersRestFallback(tokenRef.current!);
          }
        }
        if (isSharingRef.current) {
          const loc = userLocationRef.current;
          if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
            void fetchWithTimeout(`${API_URL}/api/live/location`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tokenRef.current}`,
              },
              body: JSON.stringify({
                lat: loc.latitude,
                lng: loc.longitude,
                shareLocation: true,
              }),
            }).catch(() => {});
            s?.emit('location:update', { lat: loc.latitude, lng: loc.longitude });
          }
        }
      }
    });
    return () => sub.remove();
  }, [fetchWarnings, scheduleUsersRestFallback, joinLiveMapRoom, clearUsersFallbackTimer, mergeLiveUsersFromApi, store]);

  // Periodic refresh heals missed socket events on unstable networks.
  useEffect(() => {
    if (!liveUsersEnabled) return;
    const interval = setInterval(async () => {
      if (!allowBgRef.current && !isForegroundActive()) return;
      const token = tokenRef.current;
      if (!token) return;
      if (
        socketRef.current?.connected
        && Date.now() - lastSnapshotAtRef.current < LIVE_USERS_REST_FRESH_MS
      ) {
        return;
      }
      await fetchLiveUsersRest(token);
    }, USERS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [liveUsersEnabled, fetchLiveUsersRest]);

  // Usuń tylko naprawdę przestarzałych (brak socket/API przez STALE_MS).
  useEffect(() => {
    if (!liveUsersEnabled) return;
    const id = setInterval(pruneStaleLiveUsers, 30_000);
    return () => clearInterval(id);
  }, [liveUsersEnabled, pruneStaleLiveUsers]);

  // ── Proximity alert ───────────────────────────────────
  const triggerProximityAlert = useCallback((warning: LiveWarning, distM: number) => {
    alertedWarningsRef.current.add(warning.id);
    const label   = getWarningLabel(warning.type);
    const distTxt = distM < 1000 ? `${distM}m` : `${(distM / 1000).toFixed(1)}km`;
    const message = warning.message
      ? `${label}: ${warning.message} — ${distTxt} od Ciebie`
      : `${label} za ${distTxt}`;

    Toast.show({
      type:           'error',
      text1:          `⚠️ ${label.toUpperCase()}`,
      text2:          `${distTxt} od Ciebie${warning.message ? ` · ${warning.message}` : ''}`,
      visibilityTime: 5000,
    });
    if (isSpeechRef.current) {
      Speech.stop().catch(() => {});
      setTimeout(() => Speech.speak(message, { language: 'pl-PL', pitch: 1.0, rate: 0.88 }), 300);
    }
    Notifications.scheduleNotificationAsync({
      content: {
        title: `⚠️ ${label}`,
        body:  `${distTxt} od Twojej lokalizacji${warning.message ? ` · ${warning.message}` : ''}`,
        sound: true,
        data:  { warningId: warning.id, type: warning.type },
      },
      trigger: null,
    });
  }, []);

  const checkSingleWarningProximity = useCallback((warning: LiveWarning) => {
    const loc = userLocationRef.current;
    if (!loc) return;
    if (alertedWarningsRef.current.has(warning.id)) return;
    const distM = distanceKm(loc.latitude, loc.longitude, warning.lat, warning.lng) * 1000;
    if (distM <= PROXIMITY_THRESHOLD_M) triggerProximityAlert(warning, Math.round(distM));
  }, [triggerProximityAlert]);

  useEffect(() => {
    checkSingleWarningProximityRef.current = checkSingleWarningProximity;
  }, [checkSingleWarningProximity]);

  // ── Skanuj wszystkie warnings przy ruchu użytkownika ──
  useEffect(() => {
    if (!userLocation || !(warnings?.length)) return;
    const clustered = clusterWarnings(warnings);
    clustered.forEach(warning => {
      if (alertedWarningsRef.current.has(warning.id)) return;
      const distM = distanceKm(
        userLocation.latitude, userLocation.longitude,
        Number(warning.lat),   Number(warning.lng),
      ) * 1000;
      if (distM <= PROXIMITY_THRESHOLD_M) triggerProximityAlert(warning, Math.round(distM));
    });
  }, [userLocation?.latitude, userLocation?.longitude, warnings, triggerProximityAlert]);

  // ── Wyślij lokalizację ────────────────────────────────
  const sendLocation = useCallback((
    lat:          number,
    lng:          number,
    routePoints?: { latitude: number; longitude: number }[],
  ) => {
    if (!isSharing) return;
    if (!allowBgRef.current && !isForegroundActive()) return;
    const socket = socketRef.current;
    if (!socket?.connected) return;

    if (routePoints && routePoints.length > 1) routePointsRef.current = routePoints;
    // Live sharing must reflect raw current position. Snapping to stale route
    // points can broadcast an old road point and look like teleportation.
    socket.emit('location:update', { lat, lng });
  }, [isSharing]);

  // ── Toggle sharing ────────────────────────────────────
  const toggleSharing = useCallback(async (): Promise<boolean> => {
    if (!tokenRef.current) return false;
    if (toggleInFlightRef.current) return isSharingRef.current;
    toggleInFlightRef.current = true;
    setSharingStatus(isSharingRef.current ? 'connecting' : 'off');
    try {
      let data: any = null;
      let ok = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetchWithTimeout(`${API_URL}/api/live/location/toggle`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenRef.current}` },
        });
        ok = res.ok;
        data = await res.json().catch(() => null);
        if (ok) break;
      }
      if (!ok || !data) {
        setSharingStatus(isSharingRef.current ? 'on' : 'off');
        return isSharingRef.current;
      }
      const nextShare = !!data.shareLocation;
      isSharingRef.current = nextShare;
      setSharingStatus(nextShare ? 'connecting' : 'off');

      if (nextShare) {
        if (!socketRef.current?.connected) {
          socketRef.current?.connect();
        } else {
          joinLiveMapRoom();
        }
        // Push current GPS immediately on enable so the server doesn't expose
        // stale DB coordinates until the next periodic sender tick.
        const loc = userLocationRef.current;
        if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
          await fetchWithTimeout(`${API_URL}/api/live/location`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenRef.current}`,
            },
            body: JSON.stringify({
              lat: loc.latitude,
              lng: loc.longitude,
              shareLocation: true,
            }),
          }).catch(() => {});
          socketRef.current?.emit('location:update', { lat: loc.latitude, lng: loc.longitude });
        }
        await fetchInitialData(tokenRef.current);
        toggleRetryRef.current = 0;
        setSharingStatus('on');
        Toast.show({ type: 'success', text1: '📍 Lokalizacja widoczna', text2: 'Inni widzą Cię na mapie' });
      } else {
        setSharingStatus('off');
        Toast.show({ type: 'info', text1: '👁️ Lokalizacja ukryta', text2: 'Jesteś niewidoczny na mapie' });
        const socket = socketRef.current;
        if (socket?.connected) {
          socket.emit('user:stop_sharing');
          leaveLiveMapRoom();
        }
        clearLiveUsersFleetState();
      }
      return nextShare;
    } catch {
      toggleRetryRef.current += 1;
      setSharingStatus(isSharingRef.current ? 'on' : 'off');
      return isSharingRef.current;
    } finally {
      toggleInFlightRef.current = false;
    }
  }, [fetchInitialData, joinLiveMapRoom, leaveLiveMapRoom, clearLiveUsersFleetState]);

  // ── Dodaj ostrzeżenie ─────────────────────────────────
  const addWarning = useCallback(async (
    type:         LiveWarning['type'],
    lat:          number,
    lng:          number,
    message?:     string,
    routePoints?: { latitude: number; longitude: number }[],
  ): Promise<void> => {
    if (!tokenRef.current) return;

    let snappedLat = lat;
    let snappedLng = lng;

    try {
      const points = routePoints ?? routePointsRef.current;
      if (points.length > 1) {
        const snapped = snapToRoute(lat, lng, points, 50);
        snappedLat = snapped.latitude;
        snappedLng = snapped.longitude;
      } else {
        // Brak punktów trasy — użyj surowej pozycji GPS
        snappedLat = lat;
        snappedLng = lng;
      }
    } catch (e) {
      console.log('warning snap error — using raw GPS:', e);
    }

    try {
      const res = await fetchWithTimeout(
        `${API_URL}/api/live/warnings`,
        {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:  `Bearer ${tokenRef.current}`,
          },
          body: JSON.stringify({ type, lat: snappedLat, lng: snappedLng, message: message ?? '' }),
        },
        10000,
      );

      const data = await res.json();

      if (res.status === 429) {
        Toast.show({
          type:           'error',
          text1:          '⏱️ COOLDOWN',
          text2:          data.message ?? 'Poczekaj przed kolejnym zgłoszeniem',
          visibilityTime: 5000,
        });
        return;
      }
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'Błąd zgłaszania ostrzeżenia' });
        return;
      }
      if (data.merged) {
        Toast.show({
          type:           'info',
          text1:          '✅ POTWIERDZONO',
          text2:          'Twoje zgłoszenie wzmocniło istniejące ostrzeżenie',
          visibilityTime: 4000,
        });
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        Toast.show({
          type:           'error',
          text1:          '⏱️ TIMEOUT',
          text2:          'Słaby internet — spróbuj ponownie',
          visibilityTime: 4000,
        });
      } else {
        Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      }
    }
  }, []);

  // ── Potwierdź ostrzeżenie ─────────────────────────────
  const confirmWarning = useCallback(async (warningId: number): Promise<void> => {
    if (!tokenRef.current) return;
    try {
      const res  = await fetchWithTimeout(
        `${API_URL}/api/live/warnings/${warningId}/confirm`,
        { method: 'POST', headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      const data = await res.json();
      if (!res.ok) {
        Toast.show({ type: 'info', text1: data.error ?? 'Nie można potwierdzić' });
        return;
      }
      Toast.show({ type: 'success', text1: '👍 POTWIERDZONO', text2: 'Ostrzeżenie aktywne jeszcze 15 min' });
    } catch (e: any) {
      if (e.name === 'AbortError') {
        Toast.show({ type: 'error', text1: '⏱️ TIMEOUT', text2: 'Słaby internet — spróbuj ponownie' });
      } else {
        Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      }
    }
  }, []);

  const cancelWarning = useCallback(async (warningId: number): Promise<void> => {
    if (!tokenRef.current) return;
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/api/live/warnings/${warningId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      if (!res.ok) {
        const data = await res.json();
        Toast.show({ type: 'error', text1: data.error ?? 'Błąd usuwania' });
        return;
      }
      // socket 'warning:removed' sam zaktualizuje state
      Toast.show({ type: 'success', text1: '🗑️ ZGŁOSZENIE ANULOWANE' });
    } catch (e: any) {
      if (e.name === 'AbortError') {
        Toast.show({ type: 'error', text1: '⏱️ TIMEOUT', text2: 'Słaby internet — spróbuj ponownie' });
      } else {
        Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      }
    }
  }, []);

  /** Po powrocie z tła / starcie — socket, lista użytkowników, opcjonalnie share na serwerze. */
  const resumeLiveSession = useCallback(async () => {
    if (!mapSessionActiveRef.current) return;
    let token = tokenRef.current;
    if (!token) {
      token = await AsyncStorage.getItem('token');
      if (!token) return;
      tokenRef.current = token;
    }
    const socket = socketRef.current;
    if (!socket?.connected) {
      socket?.connect();
    } else {
      if (liveUsersEnabledRef.current) joinLiveMapRoom();
      await fetchWarnings(token);
      if (liveUsersEnabledRef.current) scheduleUsersRestFallback(token);
    }
    if (!isSharingRef.current) return;
    const loc = userLocationRef.current;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return;
    try {
      await fetchWithTimeout(`${API_URL}/api/live/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lat: loc.latitude,
          lng: loc.longitude,
          shareLocation: true,
        }),
      });
      socketRef.current?.emit('location:update', { lat: loc.latitude, lng: loc.longitude });
      setSharingStatus('on');
    } catch {
      /* ignore */
    }
  }, [fetchWarnings, scheduleUsersRestFallback, joinLiveMapRoom, leaveLiveMapRoom]);

  const liveUsers = store.getLiveUsersArray();

  return {
    liveUsers,
    liveUserIds,
    liveMapStore: store,
    warnings: visibleWarnings,
    connected,
    sharingStatus,
    sendLocation,
    toggleSharing,
    resumeLiveSession,
    addWarning,
    confirmWarning,
    cancelWarning,
  };
}

// ── Grupowanie ostrzeżeń ──────────────────────────────────
const CLUSTER_RADIUS_KM = 0.3;

export function clusterWarnings(warnings: LiveWarning[]): LiveWarning[] {
  if (!warnings?.length) return [];
  const result: LiveWarning[] = [];
  for (const warning of warnings) {
    const existing = result.find(r =>
      r.type === warning.type &&
      distanceKm(
        Number(r.lat), Number(r.lng),
        Number(warning.lat), Number(warning.lng),
      ) < CLUSTER_RADIUS_KM,
    );
    if (existing) {
      const idx = result.indexOf(existing);
      result[idx] = {
        ...existing,
        confirmCount: existing.confirmCount + warning.confirmCount,
        expiresAt:    new Date(existing.expiresAt) > new Date(warning.expiresAt)
          ? existing.expiresAt
          : warning.expiresAt,
      };
    } else {
      result.push({ ...warning });
    }
  }
  return result;
}

export function getWarningLabel(type: string): string {
  switch (type) {
    case 'traffic':       return 'Korek';
    case 'weather':       return 'Zła pogoda';
    case 'accident':      return 'Wypadek';
    case 'car_breakdown': return 'Awaria auta';
    case 'speed_control': return 'Kontrola prędkości';
    case 'kosmici':       return 'Kosmici';
    case 'Animal':        return 'Zwierzę na drodze';
    default:              return 'Ostrzeżenie';
  }
}

export function getWarningColor(type: string): string {
  switch (type) {
    case 'traffic':       return '#FF9500';
    case 'weather':       return '#ffd43b';
    case 'accident':      return '#ff922b';
    case 'car_breakdown': return '#748ffc';
    case 'speed_control': return '#0535f7';
    case 'kosmici':       return '#05f711';
    default:              return '#ffffff';
  }
}

export function getWarningIcon(type: string): string {
  switch (type) {
    case 'traffic':       return 'car-multiple';
    case 'weather':       return 'weather-lightning-rainy';
    case 'accident':      return 'car-emergency';
    case 'speed_control': return 'access-point';
    case 'kosmici':       return 'alien-outline';
    case 'car_breakdown': return 'car-wrench';
    default:              return 'alert-circle';
  }
}