import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import * as Speech from 'expo-speech';
import * as Notifications from 'expo-notifications';
import { API_URL } from '../constants/mapConfig';
import { snapToRoute } from '../scripts/navigationUtils';

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
/** Zgodne z backendem (lastSeen 5 min) — nie usuwaj markera wcześniej. */
const LIVE_USER_STALE_MS = 5 * 60 * 1000;
/** Opóźnienie przed usunięciem po user:offline (chroni przed miganiem). */
const LIVE_USER_OFFLINE_GRACE_MS = 15_000;
const GEO_USERS_REFRESH_MIN_MS = 28_000;
const GEO_USERS_REFRESH_MIN_MOVE_KM = 1.2;
const LIVE_USER_MAX_STEP_M = 180;
const LIVE_USER_EVENT_STALE_MS = 2 * 60 * 1000;

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
  enabled = true,
  tripActive = false,
) {
  const tripActiveRef = useRef(tripActive);
  useEffect(() => { tripActiveRef.current = tripActive; }, [tripActive]);
  const [liveUsers,       setLiveUsers]       = useState<LiveUser[]>([]);
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
  const allowBgRef         = useRef(allowBackgroundWork);
  const enabledRef         = useRef(enabled);
  const appStateRef        = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    allowBgRef.current = allowBackgroundWork;
  }, [allowBackgroundWork]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const isForegroundActive = useCallback(() => {
    return appStateRef.current === 'active';
  }, []);

  // ── Position smoothing for live users (prevents teleportation) ───
  const smoothedPosRef = useRef<Map<number, { lat: number; lng: number }>>(new Map());
  const SMOOTH_ALPHA   = 0.35;   // 0 = frozen, 1 = instant
  const MIN_MOVE_M     = 4;      // ignore jitter smaller than 4 m

  // ── Time-based interpolation state for live users ─────────────────
  type InterpEntry = {
    fromLat: number; fromLng: number;
    toLat:   number; toLng:   number;
    startMs: number; durationMs: number;
    lastUpdateMs: number;
  };
  const interpRef = useRef<Map<number, InterpEntry>>(new Map());
  const liveUserLastSeenRef = useRef<Map<number, number>>(new Map());
  const pendingOfflineRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const liveUserLastSeqRef = useRef<Map<number, number>>(new Map());
  const liveUserLastServerAtRef = useRef<Map<number, number>>(new Map());
  const INTERP_TICK_BASE_MS = 180;
  const INTERP_TICK_BUSY_MS = 140;
  const INTERP_TICK_TRIP_MS = 120;
  const MIN_INTERP_DUR_MS  = 90;  // minimum lerp duration guard
  const MAX_INTERP_DUR_MS  = 2200;
  const USERS_REFRESH_MS   = 45_000;

  const easeInOut = (t: number) => t * t * (3 - 2 * t);

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

  const removeLiveUser = useCallback((id: number) => {
    if (!Number.isFinite(id)) return;
    liveUserLastSeenRef.current.delete(id);
    smoothedPosRef.current.delete(id);
    interpRef.current.delete(id);
    liveUserLastSeqRef.current.delete(id);
    liveUserLastServerAtRef.current.delete(id);
    const pending = pendingOfflineRef.current.get(id);
    if (pending) {
      clearTimeout(pending);
      pendingOfflineRef.current.delete(id);
    }
    setLiveUsers((prev) => prev.filter((u) => u.id !== id));
  }, []);

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
    setLiveUsers((prev) => {
      const next = prev.filter((u) => {
        const last = liveUserLastSeenRef.current.get(u.id) ?? 0;
        return now - last < LIVE_USER_STALE_MS;
      });
      if (next.length === prev.length) return prev;
      const activeIds = new Set(next.map((u) => u.id));
      Array.from(smoothedPosRef.current.keys()).forEach((id) => {
        if (!activeIds.has(id)) smoothedPosRef.current.delete(id);
      });
      Array.from(interpRef.current.keys()).forEach((id) => {
        if (!activeIds.has(id)) interpRef.current.delete(id);
      });
      return next;
    });
  }, []);

  /** Scal API z socketem — nigdy nie kasuj świeżych użytkowników tylko dlatego, że nie ma ich w jednym fetchu. */
  const mergeLiveUsersFromApi = useCallback((incoming: LiveUser[]) => {
    const now = Date.now();
    incoming.forEach((u) => {
      if (Number.isFinite(u?.id)) touchLiveUser(u.id);
    });

    setLiveUsers((prev) => {
      const prevById = new Map(prev.map((u) => [u.id, u]));
      const incomingById = new Map<number, LiveUser>();
      const merged: LiveUser[] = [];

      for (const u of incoming) {
        if (!Number.isFinite(u?.id) || !Number.isFinite(u?.lat) || !Number.isFinite(u?.lng)) continue;
        if (Number.isFinite(Number(u?.seq))) {
          liveUserLastSeqRef.current.set(u.id, Number(u.seq));
        }
        if (Number.isFinite(Number(u?.serverAt))) {
          liveUserLastServerAtRef.current.set(u.id, Number(u.serverAt));
        }
        incomingById.set(u.id, u);
        const prevU = prevById.get(u.id);
        const lat = prevU?.lat ?? u.lat;
        const lng = prevU?.lng ?? u.lng;
        merged.push({ ...u, lat, lng });
        if (!smoothedPosRef.current.has(u.id)) {
          smoothedPosRef.current.set(u.id, { lat: u.lat, lng: u.lng });
        }
      }

      for (const u of prev) {
        if (incomingById.has(u.id)) continue;
        const last = liveUserLastSeenRef.current.get(u.id) ?? 0;
        if (now - last < LIVE_USER_STALE_MS) {
          merged.push(u);
        }
      }

      const activeIds = new Set(merged.map((u) => u.id));
      Array.from(smoothedPosRef.current.keys()).forEach((id) => {
        if (!activeIds.has(id)) smoothedPosRef.current.delete(id);
      });
      Array.from(interpRef.current.keys()).forEach((id) => {
        if (!activeIds.has(id)) interpRef.current.delete(id);
      });

      return merged;
    });
  }, [touchLiveUser]);

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
    } else if (connected) {
      setSharingStatus('on');
      joinLiveMapRoom();
    } else {
      setSharingStatus('connecting');
    }
  }, [isSharing, connected, joinLiveMapRoom]);

  // Dołącz do pokoju live_map gdy mapa jest aktywna — bez tego socket nie dostarcza user:location.
  useEffect(() => {
    if (!enabled || !connected) return;
    joinLiveMapRoom();
  }, [enabled, connected, joinLiveMapRoom]);

  useEffect(() => {
    if (enabled) return;
    socketRef.current?.disconnect();
    setConnected(false);
    setSharingStatus('off');
    interpRef.current.clear();
    liveUserLastSeqRef.current.clear();
    liveUserLastServerAtRef.current.clear();
  }, [enabled]);

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

  // ── Pobierz dane startowe ─────────────────────────────
  const fetchInitialData = useCallback(async (token: string) => {
    try {
      const loc = userLocationRef.current;
      const warningsQs = new URLSearchParams();
      if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
        warningsQs.set('lat', String(loc.latitude));
        warningsQs.set('lng', String(loc.longitude));
        warningsQs.set('radiusKm', String(WARNING_VISIBLE_RADIUS_KM));
      }
      const warningsUrl = `${API_URL}/api/live/warnings${warningsQs.toString() ? `?${warningsQs}` : ''}`;
      const [warningsRes, usersRes] = await Promise.all([
        fetchWithTimeout(warningsUrl, { headers: { Authorization: `Bearer ${token}` } }),
        fetchWithTimeout(buildLiveUsersUrl(),    { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (warningsRes.ok) {
        const data = await warningsRes.json();
        setWarnings(Array.isArray(data) ? data : []);
      }
      if (usersRes.ok && enabledRef.current) {
        const data = await usersRes.json();
        const users: LiveUser[] = Array.isArray(data) ? data : [];
        mergeLiveUsersFromApi(users);
      }
    } catch (e) {
      console.log('fetchInitialData error:', e);
    }
  }, [buildLiveUsersUrl, mergeLiveUsersFromApi]);

  // Odśwież listę po połączeniu socketu (widoczność innych — niezależnie od własnego share).
  useEffect(() => {
    if (!enabled || !connected) return;
    const tok = tokenRef.current;
    if (!tok) return;
    void fetchInitialData(tok);
  }, [enabled, connected, fetchInitialData]);

  // Gdy użytkownik się przesuwa, odśwież zasięg listy live (throttle).
  const lastUsersGeoRefreshRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  useEffect(() => {
    if (!enabled || !connected) return;
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
    void fetchInitialData(tok);
  }, [userLocation?.latitude, userLocation?.longitude, enabled, connected, fetchInitialData]);

  // ── Init Socket ───────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
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
        joinLiveMapRoom();
        fetchInitialData(token);
      });

      socket.on('disconnect', (reason) => {
        setConnected(false);
        if (reason === 'io server disconnect' && (isSharingRef.current || isForegroundActive())) {
          socket.connect();
        }
      });

      socket.on('connect_error', (err) => console.log('❌ connect_error:', err.message));

      socket.on('user:location', (data: any) => {
        if (!enabledRef.current) return;
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

        setLiveUsers((prev) => {
          const now = Date.now();
          const existingUser = prev.find((u) => u.id === id);
          const prevSmoothed = smoothedPosRef.current.get(id)
            ?? (existingUser ? { lat: existingUser.lat, lng: existingUser.lng } : null);

          // EWMA smoothing on incoming targets (filters GPS spikes)
          let targetLat = rawLat;
          let targetLng = rawLng;
          if (prevSmoothed) {
            const distM = distanceKm(prevSmoothed.lat, prevSmoothed.lng, targetLat, targetLng) * 1000;
            if (distM < MIN_MOVE_M) {
              targetLat = prevSmoothed.lat;
              targetLng = prevSmoothed.lng;
            } else {
              if (distM > LIVE_USER_MAX_STEP_M) {
                const ratio = LIVE_USER_MAX_STEP_M / distM;
                targetLat = prevSmoothed.lat + (targetLat - prevSmoothed.lat) * ratio;
                targetLng = prevSmoothed.lng + (targetLng - prevSmoothed.lng) * ratio;
              }
              targetLat = prevSmoothed.lat + SMOOTH_ALPHA * (targetLat - prevSmoothed.lat);
              targetLng = prevSmoothed.lng + SMOOTH_ALPHA * (targetLng - prevSmoothed.lng);
            }
          }
          smoothedPosRef.current.set(id, { lat: targetLat, lng: targetLng });

          // Build interpolation from *currently displayed* position to new target.
          const interp = interpRef.current.get(id);
          let fromLat = existingUser?.lat ?? targetLat;
          let fromLng = existingUser?.lng ?? targetLng;
          if (interp) {
            const t = Math.min((now - interp.startMs) / Math.max(interp.durationMs, MIN_INTERP_DUR_MS), 1);
            const te = easeInOut(t);
            fromLat = interp.fromLat + (interp.toLat - interp.fromLat) * te;
            fromLng = interp.fromLng + (interp.toLng - interp.fromLng) * te;
          }
          const lastMs = interp?.lastUpdateMs ?? now;
          const durationMs = Math.min(Math.max(now - lastMs, 220), MAX_INTERP_DUR_MS);
          interpRef.current.set(id, {
            fromLat,
            fromLng,
            toLat: targetLat,
            toLng: targetLng,
            startMs: now,
            durationMs,
            lastUpdateMs: now,
          });

          const merged: LiveUser = {
            id,
            username: typeof data?.username === 'string'
              ? data.username
              : (existingUser?.username ?? ''),
            avatarUrl: data?.avatarUrl !== undefined
              ? data.avatarUrl
              : (existingUser?.avatarUrl ?? null),
            avatarFrameUrl: data?.avatarFrameUrl !== undefined
              ? data.avatarFrameUrl
              : (existingUser?.avatarFrameUrl ?? null),
            lat: fromLat,
            lng: fromLng,
            online: data?.online ?? existingUser?.online ?? true,
            isFriend: data?.isFriend ?? existingUser?.isFriend,
            isPremium: data?.isPremium ?? existingUser?.isPremium,
            serverAt,
            seq: Number.isFinite(seq) ? seq : null,
          };

          if (existingUser) {
            return prev.map((u) => (u.id === id ? { ...u, ...merged } : u));
          }
          return [...prev, merged];
        });
      });

      socket.on('live:users:snapshot', (data: any) => {
        if (!enabledRef.current) return;
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
        mergeLiveUsersFromApi(users);
      });

      socket.on('user:offline', (data) => {
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
        if (!enabledRef.current) return;
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
      const s = socketRef.current;
      if (s) {
        s.emit('live:leave');
        s.disconnect();
      }
    };
  }, [fetchInitialData, enabled, touchLiveUser, scheduleLiveUserOffline, removeLiveUser]);

  // Pause socket/interp when app is backgrounded without background permission
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      appStateRef.current = next;
      if ((next === 'background' || next === 'inactive') && !allowBgRef.current) {
        const s = socketRef.current;
        s?.emit('live:leave');
        s?.disconnect();
        setConnected(false);
        interpRef.current.clear();
      } else if (next === 'active' && tokenRef.current && enabledRef.current) {
        const s = socketRef.current;
        if (s && !s.connected) {
          s.connect();
        } else if (s?.connected) {
          joinLiveMapRoom();
          void fetchInitialData(tokenRef.current);
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
  }, [fetchInitialData, joinLiveMapRoom]);

  // ── Time-based interpolation ticker — smoothly moves live-user markers ──
  useEffect(() => {
    if (!enabled) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (!allowBgRef.current && !isForegroundActive()) return;
      const now = Date.now();
      const updates = new Map<number, { lat: number; lng: number }>();
      interpRef.current.forEach((entry, userId) => {
        const { fromLat, fromLng, toLat, toLng, startMs, durationMs } = entry;
        const t = Math.min((now - startMs) / Math.max(durationMs, MIN_INTERP_DUR_MS), 1);
        const te = easeInOut(t);
        updates.set(userId, {
          lat: fromLat + (toLat - fromLat) * te,
          lng: fromLng + (toLng - fromLng) * te,
        });
        if (t >= 1) {
          interpRef.current.delete(userId);
        }
      });
      if (updates.size === 0) return;
      setLiveUsers(prev =>
        prev.map(u => {
          const update = updates.get(u.id);
          return update ? { ...u, lat: update.lat, lng: update.lng } : u;
        }),
      );
    };

    const arm = () => {
      if (interval) clearInterval(interval);
      const ms = tripActiveRef.current
        ? INTERP_TICK_TRIP_MS
        : interpRef.current.size > 5
          ? INTERP_TICK_BUSY_MS
          : INTERP_TICK_BASE_MS;
      interval = setInterval(tick, ms);
    };

    arm();
    const rescheduler = setInterval(arm, 5000);

    return () => {
      if (interval) clearInterval(interval);
      clearInterval(rescheduler);
    };
  }, [isForegroundActive, enabled, tripActive]);

  // Periodic refresh heals missed socket events on unstable networks.
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      if (!allowBgRef.current && !isForegroundActive()) return;
      if (!connected) return;
      const token = tokenRef.current;
      if (!token) return;
      try {
        const res = await fetchWithTimeout(
          buildLiveUsersUrl(),
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok || !enabledRef.current) return;
        const data = await res.json();
        const users: LiveUser[] = Array.isArray(data) ? data : [];
        mergeLiveUsersFromApi(users);
      } catch {
      }
    }, USERS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [enabled, connected, buildLiveUsersUrl, mergeLiveUsersFromApi]);

  // Usuń tylko naprawdę przestarzałych (brak socket/API przez STALE_MS).
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(pruneStaleLiveUsers, 30_000);
    return () => clearInterval(id);
  }, [enabled, pruneStaleLiveUsers]);

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
        socketRef.current?.emit('user:stop_sharing');
        leaveLiveMapRoom();
        pendingOfflineRef.current.forEach((t) => clearTimeout(t));
        pendingOfflineRef.current.clear();
        liveUserLastSeenRef.current.clear();
        smoothedPosRef.current.clear();
        interpRef.current.clear();
        liveUserLastSeqRef.current.clear();
        liveUserLastServerAtRef.current.clear();
        setLiveUsers([]);
      }
      return nextShare;
    } catch {
      toggleRetryRef.current += 1;
      setSharingStatus(isSharingRef.current ? 'on' : 'off');
      return isSharingRef.current;
    } finally {
      toggleInFlightRef.current = false;
    }
  }, [fetchInitialData, joinLiveMapRoom, leaveLiveMapRoom]);

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
    if (!enabledRef.current) return;
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
      joinLiveMapRoom();
      await fetchInitialData(token);
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
  }, [fetchInitialData, joinLiveMapRoom]);

  return {
    liveUsers,
    warnings: visibleWarnings,  // ← zawsze przefiltrowane do 25km
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
    case 'traffic':       return '#ff6b6b';
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