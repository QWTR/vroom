import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, NativeModules, type AppStateStatus } from 'react-native';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import * as Notifications from 'expo-notifications';
import { API_URL } from '../constants/mapConfig';
import { prepareLiveLocationPacket, sendLiveLocation } from '../lib/liveLocationBroker';
import { snapToRoute } from '../scripts/navigationUtils';
import {
  createLiveMapStore,
  useLiveMapUserIds,
  type LiveMapStore,
  type LiveUserMeta,
} from './liveMapStore';
import type { VehicleModelMeta } from '../constants/shopCosmetics';
import { normalizeVehicleLiveFields } from '../lib/vehicleModelContract';
import {
  FLEET_FULL_ANIMATION_RADIUS_KM,
  FLEET_REDUCED_UPDATE_MS,
  FLEET_SLOT_MAX_POINTS,
  resolveFleetMotionTier,
  shouldApplyReducedFleetUpdate,
  type FleetMotionTier,
} from './liveFleetMotion';
import { parseIncomingTrail, type FleetTrailPoint } from './fleetTrailInterpolation';
import { isLiveUpdateNewer, resolveLiveUserLivenessAt } from './liveUpdateOrder';
import {
  WARNING_CATALOG,
  type CreateWarningInput,
  type LiveWarning,
  type WarningType,
} from '../lib/warnings/warningCatalog';

export type { CreateWarningInput, LiveWarning, WarningType } from '../lib/warnings/warningCatalog';

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
  vehicleModelUrl?: string | null;
  vehicleModelMeta?: VehicleModelMeta | null;
  serverAt?: number | null;
  fixAt?: number | null;
  fixId?: string | null;
  stale?: boolean;
  seq?: number | null;
  heading?: number | null;
  speedKmh?: number | null;
  speedMps?: number | null;
  trail?: FleetTrailPoint[];
  motionTier?: FleetMotionTier;
  positionSource?: 'snapped' | 'raw';
}

export type LiveLocationMotion = {
  fixAt?: number;
  fixId?: string;
  heading?: number;
  speedKmh?: number;
  trail?: FleetTrailPoint[];
  /** idle | freeDrive | navigation — gamification server gate */
  mode?: string;
  rawLat?: number;
  rawLng?: number;
  accuracyM?: number;
  snapSource?: string;
  snapAgeMs?: number;
  snapDistanceM?: number;
};

function isNativeAutoSessionActive(): boolean {
  try {
    return NativeModules.VroomBridgeModule?.isCarSessionActive?.() === true;
  } catch {
    return false;
  }
}

function parseIncomingMotion(u: Partial<LiveUser>): {
  heading: number | null;
  speedMps: number | null;
} {
  const headingRaw = Number(u?.heading);
  const speedMpsRaw = Number(u?.speedMps);
  const speedKmhRaw = Number(u?.speedKmh);
  const heading = Number.isFinite(headingRaw) ? headingRaw : null;
  let speedMps: number | null = null;
  if (Number.isFinite(speedMpsRaw) && speedMpsRaw >= 0) {
    speedMps = speedMpsRaw;
  } else if (Number.isFinite(speedKmhRaw) && speedKmhRaw >= 0) {
    speedMps = speedKmhRaw / 3.6;
  }
  return { heading, speedMps };
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
const LIVE_USERS_RADIUS_KM = 350;
const LIVE_USERS_TAKE = 400;
/** Brak aktualizacji pozycji — usuń zombie (snapshot / prune). */
const LIVE_USER_STALE_MS = 30_000;
/** Opóźnienie przed usunięciem po user:offline (chroni przed miganiem). */
const LIVE_USER_OFFLINE_GRACE_MS = 15_000;
const GEO_USERS_REFRESH_MIN_MS = 28_000;
const GEO_USERS_REFRESH_MIN_MOVE_KM = 1.2;
const LIVE_USER_EVENT_STALE_MS = 30_000;
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
  const liveJoinWithGpsRef = useRef(false);
  const usersFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergeGenerationRef = useRef(0);
  const pendingLocationPayloadRef = useRef<Record<string, unknown> | null>(null);
  const latestOwnFixRef = useRef<{ lat: number; lng: number; fixAt: number; fixId: string } | null>(null);
  const liveUserFixAtRef = useRef<Map<number, number>>(new Map());

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
  const reducedLastAppliedAtRef = useRef<Map<number, number>>(new Map());
  const reducedPendingRef = useRef<Map<number, { dueAt: number; apply: () => void }>>(new Map());
  const reducedFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return isLiveUpdateNewer({
      previousSeq: liveUserLastSeqRef.current.get(id),
      previousServerAt: liveUserLastServerAtRef.current.get(id),
      incomingSeq: seq,
      incomingServerAt: serverAt,
    });
  }, []);

  const resolveIncomingMotionTier = useCallback((
    incoming: {
      lat: number;
      lng: number;
      isFriend?: boolean;
      motionTier?: string | null;
    },
  ): FleetMotionTier => {
    const loc = userLocationRef.current;
    return resolveFleetMotionTier({
      serverTier: incoming.motionTier,
      isFriend: incoming.isFriend,
      viewerLat: loc?.latitude,
      viewerLng: loc?.longitude,
      incomingLat: incoming.lat,
      incomingLng: incoming.lng,
      fullRadiusKm: FLEET_FULL_ANIMATION_RADIUS_KM,
    });
  }, []);

  const enqueueReducedMotionUpdate = useCallback((id: number, apply: () => void) => {
    const now = Date.now();
    const lastAppliedAt = reducedLastAppliedAtRef.current.get(id) ?? 0;
    if (shouldApplyReducedFleetUpdate(now, lastAppliedAt, FLEET_REDUCED_UPDATE_MS)) {
      reducedPendingRef.current.delete(id);
      reducedLastAppliedAtRef.current.set(id, now);
      apply();
      return;
    }
    reducedPendingRef.current.set(id, {
      dueAt: lastAppliedAt + FLEET_REDUCED_UPDATE_MS,
      apply,
    });
  }, []);

  const removeLiveUser = useCallback((id: number) => {
    if (!Number.isFinite(id)) return;
    liveUserLastSeenRef.current.delete(id);
    liveUserLastSeqRef.current.delete(id);
    liveUserLastServerAtRef.current.delete(id);
    liveUserFixAtRef.current.delete(id);
    reducedLastAppliedAtRef.current.delete(id);
    reducedPendingRef.current.delete(id);
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
      const last = resolveLiveUserLivenessAt(
        liveUserLastSeenRef.current.get(id),
        liveUserFixAtRef.current.get(id),
      );
      if (now - last >= LIVE_USER_STALE_MS) {
        removeLiveUser(id);
      } else if (now - last >= 5_000) {
        const meta = store.getMeta(id);
        const pos = store.getPosition(id);
        if (meta && pos && meta.stale !== true) {
          store.setMeta({ ...meta, stale: true });
          store.setPosition(id, pos.lat, pos.lng, true);
        }
      }
    }
  }, [store, removeLiveUser]);

  /** Scal listę użytkowników — natychmiastowy zapis do store, prune po flocie. */
  const applyLiveUsersMerge = useCallback((
    incoming: LiveUser[],
    cancelToken: number,
  ): boolean => {
    if (cancelToken !== mergeGenerationRef.current) return false;

    const batchEntries: {
      meta: LiveUserMeta;
      lat: number;
      lng: number;
      heading?: number | null;
      speedMps?: number | null;
      trail?: FleetTrailPoint[];
    }[] = [];

    for (let i = 0; i < incoming.length; i++) {
      const u = incoming[i];
      if (!Number.isFinite(u?.id) || !Number.isFinite(u?.lat) || !Number.isFinite(u?.lng)) continue;
      touchLiveUser(u.id);
      const fixAt = Number(u.fixAt);
      if (Number.isFinite(fixAt)) liveUserFixAtRef.current.set(u.id, fixAt);

      const prevMeta = store.getMeta(u.id);
      const prevPos = store.getPosition(u.id);
      const incomingNewer = isIncomingNewer(u.id, u.serverAt, u.seq);
      const coords = incomingNewer || !prevPos
        ? { lat: u.lat, lng: u.lng }
        : { lat: prevPos.lat, lng: prevPos.lng };
      const motion = parseIncomingMotion(u);
      const trail = parseIncomingTrail(u?.trail);
      const liveVehicle = normalizeVehicleLiveFields(u, prevMeta);
      const isFriend = u.isFriend ?? prevMeta?.isFriend;
      const motionTier = resolveIncomingMotionTier({
        lat: u.lat,
        lng: u.lng,
        isFriend,
        motionTier: u.motionTier,
      });
      if (incomingNewer) {
        reducedPendingRef.current.delete(u.id);
        if (motionTier === 'reduced') {
          reducedLastAppliedAtRef.current.set(u.id, Date.now());
        }
      }
      const displayHeading = incomingNewer || !prevPos
        ? motion.heading
        : (prevPos?.heading ?? prevMeta?.heading ?? null);
      const displaySpeedMps = incomingNewer || !prevPos
        ? motion.speedMps
        : (prevPos?.speedMps ?? prevMeta?.speedMps ?? null);

      if (incomingNewer && Number.isFinite(Number(u?.seq))) {
        const seq = Number(u.seq);
        const prevSeq = liveUserLastSeqRef.current.get(u.id);
        if (prevSeq == null || seq >= prevSeq) {
          liveUserLastSeqRef.current.set(u.id, seq);
        }
      }
      if (incomingNewer && Number.isFinite(Number(u?.serverAt))) {
        const at = Number(u.serverAt);
        const prevAt = liveUserLastServerAtRef.current.get(u.id);
        if (prevAt == null || at >= prevAt) {
          liveUserLastServerAtRef.current.set(u.id, at);
        }
      }

      batchEntries.push({
        meta: {
          id: u.id,
          username: u.username,
          avatarUrl: u.avatarUrl ?? prevMeta?.avatarUrl ?? null,
          avatarFrameUrl: u.avatarFrameUrl ?? prevMeta?.avatarFrameUrl ?? null,
          online: u.online,
          isFriend,
          isPremium: u.isPremium ?? prevMeta?.isPremium,
          vehicleModelUrl: liveVehicle.vehicleModelUrl,
          vehicleModelMeta: liveVehicle.vehicleModelMeta,
          serverAt: incomingNewer ? (u.serverAt ?? prevMeta?.serverAt ?? null) : (prevMeta?.serverAt ?? null),
          fixAt: incomingNewer ? (u.fixAt ?? prevMeta?.fixAt ?? null) : (prevMeta?.fixAt ?? null),
          fixId: incomingNewer ? (u.fixId ?? prevMeta?.fixId ?? null) : (prevMeta?.fixId ?? null),
          stale: incomingNewer ? (u.stale === true) : (prevMeta?.stale === true),
          seq: incomingNewer ? (u.seq ?? prevMeta?.seq ?? null) : (prevMeta?.seq ?? null),
          heading: displayHeading ?? prevMeta?.heading ?? null,
          speedKmh: displaySpeedMps != null ? displaySpeedMps * 3.6 : (prevMeta?.speedKmh ?? null),
          speedMps: displaySpeedMps ?? prevMeta?.speedMps ?? null,
          motionTier,
          positionSource: incomingNewer
            ? (u.positionSource ?? prevMeta?.positionSource)
            : prevMeta?.positionSource,
        },
        lat: coords.lat,
        lng: coords.lng,
        heading: displayHeading,
        speedMps: displaySpeedMps,
        trail: (incomingNewer || !prevPos) && trail.length > 0 ? trail : undefined,
      });
    }

    if (cancelToken !== mergeGenerationRef.current) return false;

    // Natychmiastowy render — awatary ładuje Mapbox / sprite pipeline osobno.
    store.mergeUsersBatch(batchEntries, []);

    if (__DEV__) {
      console.log(
        '[LIVE_MERGE] instant store write — merged=',
        batchEntries.length,
        'storeIds=',
        store.getUserIdsSnapshot().length,
      );
    }

    // Prune zombie po zapisie floty — nie blokuje pierwszej klatki markerów.
    const now = Date.now();
    const incomingById = new Set(batchEntries.map((e) => e.meta.id));
    const pruneIds: number[] = [];
    for (const id of store.getUserIdsSnapshot()) {
      if (incomingById.has(id)) continue;
      const last = resolveLiveUserLivenessAt(
        liveUserLastSeenRef.current.get(id),
        liveUserFixAtRef.current.get(id),
      );
      if (now - last >= LIVE_USER_STALE_MS) {
        liveUserLastSeenRef.current.delete(id);
        liveUserLastSeqRef.current.delete(id);
        liveUserLastServerAtRef.current.delete(id);
        liveUserFixAtRef.current.delete(id);
        const pending = pendingOfflineRef.current.get(id);
        if (pending) {
          clearTimeout(pending);
          pendingOfflineRef.current.delete(id);
        }
        pruneIds.push(id);
      }
    }
    if (pruneIds.length > 0) {
      store.pruneUsersInPlace(pruneIds);
    }

    return true;
  }, [touchLiveUser, store, isIncomingNewer, resolveIncomingMotionTier]);

  const mergeLiveUsersFromApi = useCallback((incoming: LiveUser[]) => {
    applyLiveUsersMerge(incoming, mergeGenerationRef.current);
  }, [applyLiveUsersMerge]);

  const emitPendingLocation = useCallback(() => {
    const socket = socketRef.current;
    const payload = pendingLocationPayloadRef.current;
    if (!socket?.connected || !payload) return;
    const sentFixId = payload.fixId == null ? null : String(payload.fixId);
    socket.timeout(3_000).emit('location:update', payload, (error: Error | null, ack?: any) => {
      if (error || ack?.accepted !== true) return;
      const currentFixId = pendingLocationPayloadRef.current?.fixId;
      if (sentFixId == null || String(currentFixId) === sentFixId) {
        pendingLocationPayloadRef.current = null;
      }
    });
  }, []);

  const queueCurrentLocation = useCallback((source: string) => {
    const loc = userLocationRef.current;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null;
    const previousFix = latestOwnFixRef.current;
    const sameFix = previousFix
      && previousFix.lat === loc.latitude
      && previousFix.lng === loc.longitude;
    const fixAt = sameFix ? previousFix.fixAt : Date.now();
    const fixId = sameFix
      ? previousFix.fixId
      : `${source}:${fixAt}:${loc.latitude.toFixed(6)}:${loc.longitude.toFixed(6)}`;
    latestOwnFixRef.current = { lat: loc.latitude, lng: loc.longitude, fixAt, fixId };
    const payload = prepareLiveLocationPacket({
      protocolVersion: 2,
      lat: loc.latitude,
      lng: loc.longitude,
      fixAt,
      fixId,
      fixAgeMs: Math.max(0, Date.now() - fixAt),
      source,
    });
    if (!payload) return null;
    pendingLocationPayloadRef.current = payload;
    emitPendingLocation();
    return payload;
  }, [emitPendingLocation]);

  const joinLiveMapRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const pending = pendingLocationPayloadRef.current;
    const loc = userLocationRef.current;
    const previousFix = latestOwnFixRef.current;
    const payload = pending ?? (loc ? {
      protocolVersion: 2,
      lat: loc.latitude,
      lng: loc.longitude,
      ...(previousFix ? {
        fixAt: previousFix.fixAt,
        fixId: previousFix.fixId,
        fixAgeMs: Math.max(0, Date.now() - previousFix.fixAt),
      } : {}),
    } : { protocolVersion: 2 });
    socket.emit('live:join', payload);
    emitPendingLocation();
  }, [emitPendingLocation]);

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
    // Pusty snapshot z socketa nie blokuje REST — hasUsersFromSocketRef ustawiamy tylko przy users.length > 0.
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
    mergeGenerationRef.current += 1;
    clearUsersFallbackTimer();
    pendingOfflineRef.current.forEach((t) => clearTimeout(t));
    pendingOfflineRef.current.clear();
    liveUserLastSeenRef.current.clear();
    liveUserLastSeqRef.current.clear();
    liveUserLastServerAtRef.current.clear();
    reducedLastAppliedAtRef.current.clear();
    reducedPendingRef.current.clear();
    hasUsersFromSocketRef.current = false;
    lastSnapshotAtRef.current = 0;
    lastUsersGeoRefreshRef.current = null;
    store.clear();
  }, [store, clearUsersFallbackTimer]);

  useEffect(() => {
    if (!liveUsersEnabled) return;
    reducedFlushTimerRef.current = setInterval(() => {
      const now = Date.now();
      for (const [id, pending] of reducedPendingRef.current.entries()) {
        if (pending.dueAt > now) continue;
        reducedPendingRef.current.delete(id);
        reducedLastAppliedAtRef.current.set(id, now);
        pending.apply();
      }
    }, 500);
    return () => {
      if (reducedFlushTimerRef.current) {
        clearInterval(reducedFlushTimerRef.current);
        reducedFlushTimerRef.current = null;
      }
    };
  }, [liveUsersEnabled]);

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

  // Pierwszy fix GPS — ponowny join + REST (snapshot mógł przyjść bez współrzędnych widza).
  useEffect(() => {
    if (!liveUsersEnabled) {
      liveJoinWithGpsRef.current = false;
      return;
    }
    if (!connected) return;
    const loc = userLocation;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return;
    if (liveJoinWithGpsRef.current) return;
    liveJoinWithGpsRef.current = true;
    joinLiveMapRoom();
    const tok = tokenRef.current;
    if (tok) void fetchLiveUsersRest(tok);
  }, [
    liveUsersEnabled,
    connected,
    userLocation?.latitude,
    userLocation?.longitude,
    joinLiveMapRoom,
    fetchLiveUsersRest,
  ]);

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
        emitPendingLocation();
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
        const fixAtRaw = Number(data?.fixAt ?? data?.serverAt ?? data?.locationAt);
        const fixAt = Number.isFinite(fixAtRaw) ? fixAtRaw : serverAt;
        if (!Number.isFinite(id) || !Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return;
        if (Date.now() - fixAt > LIVE_USER_EVENT_STALE_MS) return;
        const prevSeq = liveUserLastSeqRef.current.get(id);
        if (Number.isFinite(seq) && prevSeq != null && seq <= prevSeq) return;
        const prevServerAt = liveUserLastServerAtRef.current.get(id);
        if (!Number.isFinite(seq) && prevServerAt != null && serverAt <= prevServerAt) return;
        if (Number.isFinite(seq)) liveUserLastSeqRef.current.set(id, seq);
        liveUserLastServerAtRef.current.set(id, serverAt);
        touchLiveUser(id);
        liveUserFixAtRef.current.set(id, fixAt);

        const existingMetaForTier = store.getMeta(id);
        const existingPosForTier = store.getPosition(id);
        const isFriend = data?.isFriend ?? existingMetaForTier?.isFriend;
        const motionTier = resolveIncomingMotionTier({
          lat: rawLat,
          lng: rawLng,
          isFriend,
          motionTier: data?.motionTier,
        });

        const applyIncomingLocation = () => {
          const existingMeta = store.getMeta(id);
          const motion = parseIncomingMotion(data);
          const trail = parseIncomingTrail(data?.trail);
          const liveVehicle = normalizeVehicleLiveFields(data, existingMeta);
          const displaySpeedMps = motion.speedMps;
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
            vehicleModelUrl: liveVehicle.vehicleModelUrl,
            vehicleModelMeta: liveVehicle.vehicleModelMeta,
            serverAt,
            fixAt,
            fixId: data?.fixId == null ? null : String(data.fixId),
            // To zdarzenie właśnie dotarło na żywo. Nie porównuj Date.now() z
            // fixAt obcego telefonu, bo przesunięcie zegara powoduje miganie stale/fresh.
            stale: data?.stale === true,
            seq: Number.isFinite(seq) ? seq : null,
            heading: motion.heading ?? existingMeta?.heading ?? null,
            speedKmh: displaySpeedMps != null ? displaySpeedMps * 3.6 : (existingMeta?.speedKmh ?? null),
            speedMps: displaySpeedMps ?? existingMeta?.speedMps ?? null,
            motionTier,
            positionSource: data?.positionSource === 'snapped'
              ? 'snapped'
              : (data?.positionSource === 'raw' ? 'raw' : existingMeta?.positionSource),
          };
          store.setMeta(meta);
          store.setPosition(id, rawLat, rawLng, true, {
            heading: motion.heading,
            speedMps: motion.speedMps,
            trail: trail.length > 0 ? trail : undefined,
            serverAt,
          });
          if (!existingMeta) store.registerUserId(id);
          lastSnapshotAtRef.current = Date.now();
        };

        if (motionTier === 'reduced' && existingPosForTier) {
          enqueueReducedMotionUpdate(id, applyIncomingLocation);
        } else {
          reducedPendingRef.current.delete(id);
          applyIncomingLocation();
        }
        lastSnapshotAtRef.current = Date.now();
      });

      socket.on('live:users:snapshot', (data: any) => {
        const rawCount = Array.isArray(data) ? data.length : -1;
        console.log(
          '[LIVE_SNAPSHOT] received rawCount=',
          rawCount,
          'liveUsersEnabled=',
          liveUsersEnabledRef.current,
        );
        if (!liveUsersEnabledRef.current) {
          console.log('[LIVE_SNAPSHOT] skipped — liveUsersEnabled is false');
          return;
        }
        const users: LiveUser[] = (Array.isArray(data) ? data : [])
          .map((u): LiveUser => ({
            id: Number(u?.id),
            username: typeof u?.username === 'string' ? u.username : '',
            avatarUrl: typeof u?.avatarUrl === 'string' ? u.avatarUrl : null,
            avatarFrameUrl: typeof u?.avatarFrameUrl === 'string' ? u.avatarFrameUrl : null,
            lat: Number(u?.lat),
            lng: Number(u?.lng),
            online: u?.online !== false,
            isFriend: u?.isFriend === true,
            isPremium: !!u?.isPremium,
            vehicleModelUrl: u?.vehicleModelUrl === undefined
              ? undefined
              : (typeof u?.vehicleModelUrl === 'string' ? u.vehicleModelUrl : null),
            vehicleModelMeta: u?.vehicleModelMeta,
            serverAt: Number.isFinite(Number(u?.serverAt)) ? Number(u.serverAt) : null,
            fixAt: Number.isFinite(Number(u?.fixAt)) ? Number(u.fixAt) : null,
            fixId: u?.fixId == null ? null : String(u.fixId),
            stale: u?.stale === true,
            seq: Number.isFinite(Number(u?.seq)) ? Number(u.seq) : null,
            heading: Number.isFinite(Number(u?.heading)) ? Number(u.heading) : null,
            speedKmh: Number.isFinite(Number(u?.speedKmh)) ? Number(u.speedKmh) : null,
            speedMps: Number.isFinite(Number(u?.speedMps)) ? Number(u.speedMps) : null,
            trail: parseIncomingTrail(u?.trail),
            motionTier: u?.motionTier === 'full' || u?.motionTier === 'reduced'
              ? u.motionTier
              : undefined,
            positionSource: u?.positionSource === 'snapped' ? 'snapped' : 'raw',
          }))
          .filter((u) =>
            Number.isFinite(u.id)
            && Number.isFinite(u.lat)
            && Number.isFinite(u.lng),
          );
        console.log(
          '[LIVE_SNAPSHOT] parsed users=',
          users.length,
          '→ mergeLiveUsersFromApi',
        );
        if (users.length > 0) {
          hasUsersFromSocketRef.current = true;
          lastSnapshotAtRef.current = Date.now();
        }
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

      socket.on('warning:confirmed', ({ id, confirmCount, expiresAt, subtype, direction, message }: any) => {
        setWarnings(prev =>
          (prev ?? []).map(w => w.id === id ? {
            ...w,
            confirmCount,
            expiresAt,
            subtype: subtype ?? w.subtype,
            direction: direction ?? w.direction,
            message: message ?? w.message,
          } : w),
        );
      });

      socket.on('warning:dismissed', ({ id, dismissCount }: any) => {
        setWarnings(prev => (prev ?? []).map(w => w.id === id ? { ...w, dismissCount } : w));
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
    isIncomingNewer,
    resolveIncomingMotionTier,
    enqueueReducedMotionUpdate,
    emitPendingLocation,
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
            void sendLiveLocation({
                lat: loc.latitude,
                lng: loc.longitude,
                shareLocation: true,
                source: 'foreground_resume',
              }, { force: true }).catch(() => {});
            queueCurrentLocation('foreground_resume');
          }
        }
      }
    });
    return () => sub.remove();
  }, [fetchWarnings, scheduleUsersRestFallback, joinLiveMapRoom, clearUsersFallbackTimer, mergeLiveUsersFromApi, store, queueCurrentLocation]);

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
    const id = setInterval(pruneStaleLiveUsers, 1_000);
    return () => clearInterval(id);
  }, [liveUsersEnabled, pruneStaleLiveUsers]);

  // ── Proximity alert ───────────────────────────────────
  const triggerProximityAlert = useCallback((warning: LiveWarning, distM: number) => {
    alertedWarningsRef.current.add(warning.id);
    const label   = getWarningLabel(warning.type);
    const distTxt = distM < 1000 ? `${distM}m` : `${(distM / 1000).toFixed(1)}km`;

    Toast.show({
      type:           'error',
      text1:          `⚠️ ${label.toUpperCase()}`,
      text2:          `${distTxt} od Ciebie${warning.message ? ` · ${warning.message}` : ''}`,
      visibilityTime: 5000,
    });
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
    motion?:      LiveLocationMotion,
  ) => {
    if (!isSharing) return;
    if (isNativeAutoSessionActive()) return;
    if (!allowBgRef.current && !isForegroundActive()) return;

    if (routePoints && routePoints.length > 1) routePointsRef.current = routePoints;
    const fixAt = Number.isFinite(Number(motion?.fixAt)) ? Number(motion?.fixAt) : Date.now();
    const fixId = motion?.fixId ?? `${fixAt}:${lat.toFixed(6)}:${lng.toFixed(6)}`;
    latestOwnFixRef.current = { lat, lng, fixAt, fixId };
    const payload: Record<string, unknown> = {
      protocolVersion: 2,
      lat,
      lng,
      fixAt,
      fixId,
      fixAgeMs: Math.max(0, Date.now() - fixAt),
      source: 'foreground',
    };
    if (motion?.heading != null && Number.isFinite(motion.heading)) {
      payload.heading = motion.heading;
    }
    if (motion?.speedKmh != null && Number.isFinite(motion.speedKmh) && motion.speedKmh >= 0) {
      payload.speedKmh = motion.speedKmh;
      payload.speedMps = motion.speedKmh / 3.6;
    }
    if (motion?.trail && motion.trail.length > 0) {
      payload.trail = motion.trail.slice(-FLEET_SLOT_MAX_POINTS);
    }
    if (motion?.mode) {
      payload.mode = motion.mode;
    }
    for (const key of ['rawLat', 'rawLng', 'accuracyM', 'snapAgeMs', 'snapDistanceM'] as const) {
      const value = motion?.[key];
      if (value != null && Number.isFinite(value)) payload[key] = value;
    }
    if (motion?.snapSource) {
      payload.snapSource = motion.snapSource;
    }
    const prepared = prepareLiveLocationPacket(payload);
    if (!prepared) return;
    pendingLocationPayloadRef.current = prepared;
    emitPendingLocation();
  }, [isSharing, emitPendingLocation]);

  // ── Toggle sharing ────────────────────────────────────
  const forceLocalSharingOff = useCallback(() => {
    isSharingRef.current = false;
    setSharingStatus('off');
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('user:stop_sharing');
      leaveLiveMapRoom();
    }
    clearLiveUsersFleetState();
  }, [leaveLiveMapRoom, clearLiveUsersFleetState]);

  const toggleSharing = useCallback(async (desired?: boolean): Promise<boolean> => {
    const forceOff = desired === false;
    const forceOn = desired === true;
    if (forceOn) {
      isSharingRef.current = true;
      setSharingStatus(connected && liveUsersEnabled ? 'on' : 'connecting');
      if (!tokenRef.current) return true;
      if (!socketRef.current?.connected) {
        socketRef.current?.connect();
      } else {
        joinLiveMapRoom();
      }
      const loc = userLocationRef.current;
      if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
        await sendLiveLocation({
            lat: loc.latitude,
            lng: loc.longitude,
            shareLocation: true,
            source: 'sharing_enabled',
          }, { force: true }).catch(() => {});
        queueCurrentLocation('sharing_enabled');
      }
      await fetchInitialData(tokenRef.current);
      setSharingStatus('on');
      return true;
    }
    if (forceOff) {
      forceLocalSharingOff();
      if (tokenRef.current) {
        await sendLiveLocation({ shareLocation: false, source: 'sharing_disabled' }, { force: true }).catch(() => {});
      }
      return false;
    }
    if (!tokenRef.current) {
      return false;
    }
    if (toggleInFlightRef.current) {
      return isSharingRef.current;
    }
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
      const nextShare = forceOff ? false : !!data.shareLocation;
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
          await sendLiveLocation({
              lat: loc.latitude,
              lng: loc.longitude,
              shareLocation: true,
              source: 'sharing_enabled',
            }, { force: true }).catch(() => {});
          queueCurrentLocation('sharing_enabled');
        }
        await fetchInitialData(tokenRef.current);
        toggleRetryRef.current = 0;
        setSharingStatus('on');
        Toast.show({ type: 'success', text1: '📍 Lokalizacja widoczna', text2: 'Inni widzą Cię na mapie' });
      } else {
        forceLocalSharingOff();
        Toast.show({ type: 'info', text1: '👁️ Lokalizacja ukryta', text2: 'Jesteś niewidoczny na mapie' });
      }
      return nextShare;
    } catch {
      toggleRetryRef.current += 1;
      if (forceOff) {
        forceLocalSharingOff();
        return false;
      }
      setSharingStatus(isSharingRef.current ? 'on' : 'off');
      return isSharingRef.current;
    } finally {
      toggleInFlightRef.current = false;
    }
  }, [connected, liveUsersEnabled, fetchInitialData, joinLiveMapRoom, forceLocalSharingOff, queueCurrentLocation]);

  // ── Dodaj ostrzeżenie ─────────────────────────────────
  const addWarning = useCallback(async (
    input:        CreateWarningInput,
    lat:          number,
    lng:          number,
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
          body: JSON.stringify({
            ...input,
            lat: snappedLat,
            lng: snappedLng,
            message: input.message ?? '',
          }),
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

  const dismissWarning = useCallback(async (warningId: number): Promise<void> => {
    const token = tokenRef.current;
    const location = userLocationRef.current;
    if (!token || !location) return;
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/api/live/warnings/${warningId}/dismiss`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: location.latitude, lng: location.longitude }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        Toast.show({ type: 'info', text1: data.error ?? 'Nie można oznaczyć ostrzeżenia' });
        return;
      }
      Toast.show({ type: 'success', text1: 'OZNACZONO JAKO NIEAKTUALNE' });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
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
      await sendLiveLocation({
          lat: loc.latitude,
          lng: loc.longitude,
          shareLocation: true,
          source: 'session_resume',
        }, { force: true });
      queueCurrentLocation('session_resume');
      setSharingStatus('on');
    } catch {
      /* ignore */
    }
  }, [fetchWarnings, scheduleUsersRestFallback, joinLiveMapRoom, leaveLiveMapRoom, queueCurrentLocation]);

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
    dismissWarning,
  };
}

// ── Grupowanie ostrzeżeń ──────────────────────────────────
const CLUSTER_RADIUS_KM = 0.3;

export function clusterWarnings(warnings: LiveWarning[]): LiveWarning[] {
  if (!warnings?.length) return [];
  const result: LiveWarning[] = [];
  for (const warning of warnings) {
    const existing = result.find(r =>
      r.type === warning.type
      && (r.subtype ?? null) === (warning.subtype ?? null)
      && (
        r.direction === 'unknown'
        || warning.direction === 'unknown'
        || r.direction === 'both'
        || warning.direction === 'both'
        || r.direction === warning.direction
      ) &&
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
  const catalogLabel = WARNING_CATALOG[type as WarningType]?.label;
  if (catalogLabel) return catalogLabel;
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
  const catalogColor = WARNING_CATALOG[type as WarningType]?.color;
  if (catalogColor) return catalogColor;
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
  const catalogIcon = WARNING_CATALOG[type as WarningType]?.icon;
  if (catalogIcon) return catalogIcon;
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
