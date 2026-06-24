import { useCallback, useSyncExternalStore } from 'react';
import type { FleetLatLng, FleetTrailPoint } from './fleetTrailInterpolation';
import { FLEET_SLOT_MAX_POINTS } from './liveFleetMotion';

export type LiveUserMeta = {
  id: number;
  username: string;
  avatarUrl: string | null;
  avatarFrameUrl?: string | null;
  online: boolean;
  isFriend?: boolean;
  isPremium?: boolean;
  serverAt?: number | null;
  seq?: number | null;
  heading?: number | null;
  speedKmh?: number | null;
  speedMps?: number | null;
};

export type LiveUserPosition = {
  lat: number;
  lng: number;
  heading: number | null;
  speedMps: number | null;
  trail?: FleetTrailPoint[];
  osrmPolyline?: FleetLatLng[];
  prevServerLat?: number | null;
  prevServerLng?: number | null;
  prevServerAt?: number | null;
  lastServerAt?: number | null;
};

export type LiveUserSnapshot = LiveUserMeta & LiveUserPosition;

export type LiveMapStore = ReturnType<typeof createLiveMapStore>;

export function createLiveMapStore() {
  const metaById = new Map<number, LiveUserMeta>();
  const positions = new Map<number, LiveUserPosition>();
  let userIds: number[] = [];
  let userIdsSnapshot: number[] = [];

  const userIdsListeners = new Set<() => void>();
  const positionListeners = new Map<number, Set<() => void>>();
  const fleetDeltaListeners = new Set<(ids: number[]) => void>();
  const pendingFleetDeltaIds = new Set<number>();
  let fleetDeltaTimer: ReturnType<typeof setTimeout> | null = null;

  const flushFleetDeltas = () => {
    fleetDeltaTimer = null;
    if (pendingFleetDeltaIds.size === 0) return;
    const ids = [...pendingFleetDeltaIds];
    pendingFleetDeltaIds.clear();
    fleetDeltaListeners.forEach((l) => l(ids));
  };

  const scheduleFleetDelta = (id: number) => {
    if (!Number.isFinite(id)) return;
    pendingFleetDeltaIds.add(id);
    if (fleetDeltaTimer != null) return;
    fleetDeltaTimer = setTimeout(flushFleetDeltas, 50);
  };

  const notifyUserIds = () => {
    userIdsListeners.forEach((l) => l());
  };

  const notifyPosition = (id: number) => {
    positionListeners.get(id)?.forEach((l) => l());
  };

  const publishUserIds = () => {
    userIdsSnapshot = [...userIds];
    notifyUserIds();
  };

  const insertUserIdSorted = (id: number): boolean => {
    if (userIds.includes(id)) return false;
    let lo = 0;
    let hi = userIds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (userIds[mid] < id) lo = mid + 1;
      else hi = mid;
    }
    userIds.splice(lo, 0, id);
    return true;
  };

  const removeUserIdFromList = (id: number): boolean => {
    const idx = userIds.indexOf(id);
    if (idx < 0) return false;
    userIds.splice(idx, 1);
    return true;
  };

  /** Pełny rebuild — tylko clear() / recovery; nie wołać na każdy socket tick. */
  const rebuildUserIdsFromMeta = () => {
    const next = Array.from(metaById.keys()).sort((a, b) => a - b);
    if (next.length === userIds.length && next.every((id, i) => id === userIds[i])) return;
    userIds = next;
    publishUserIds();
  };

  const syncUserIdsArray = () => {
    rebuildUserIdsFromMeta();
  };

  const registerUserId = (id: number): boolean => {
    if (!Number.isFinite(id) || !metaById.has(id)) return false;
    if (!insertUserIdSorted(id)) return false;
    publishUserIds();
    return true;
  };

  const setMeta = (meta: LiveUserMeta) => {
    metaById.set(meta.id, meta);
  };

  const setPosition = (
    id: number,
    lat: number,
    lng: number,
    notify = true,
    motion?: {
      heading?: number | null;
      speedMps?: number | null;
      trail?: FleetTrailPoint[];
      serverAt?: number | null;
    },
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const prev = positions.get(id);
    const prevMeta = metaById.get(id);
    const nextHeading = motion?.heading !== undefined
      ? (Number.isFinite(Number(motion.heading)) ? Number(motion.heading) : null)
      : (prev?.heading ?? null);
    const nextSpeedMps = motion?.speedMps !== undefined
      ? (Number.isFinite(Number(motion.speedMps)) ? Number(motion.speedMps) : null)
      : (prev?.speedMps ?? null);
    const nextTrail = motion?.trail !== undefined
      ? (motion.trail?.length ? motion.trail.slice(-FLEET_SLOT_MAX_POINTS) : undefined)
      : prev?.trail;
    const incomingServerAt = motion?.serverAt ?? prevMeta?.serverAt ?? prev?.lastServerAt ?? null;
    const positionChanged = !prev || prev.lat !== lat || prev.lng !== lng;
    const nextPrevServerLat = positionChanged && prev ? prev.lat : (prev?.prevServerLat ?? null);
    const nextPrevServerLng = positionChanged && prev ? prev.lng : (prev?.prevServerLng ?? null);
    const nextPrevServerAt = positionChanged && prev
      ? (prev.lastServerAt ?? prevMeta?.serverAt ?? null)
      : (prev?.prevServerAt ?? null);

    const samePos = prev && prev.lat === lat && prev.lng === lng;
    const sameTrail = JSON.stringify(prev?.trail ?? []) === JSON.stringify(nextTrail ?? []);
    const sameMotion = prev
      && prev.heading === nextHeading
      && prev.speedMps === nextSpeedMps
      && sameTrail;
    if (samePos && sameMotion) {
      if (notify) notifyPosition(id);
      return;
    }
    positions.set(id, {
      lat,
      lng,
      heading: nextHeading,
      speedMps: nextSpeedMps,
      trail: nextTrail,
      osrmPolyline: prev?.osrmPolyline,
      prevServerLat: nextPrevServerLat,
      prevServerLng: nextPrevServerLng,
      prevServerAt: nextPrevServerAt,
      lastServerAt: incomingServerAt,
    });
    if (notify) {
      notifyPosition(id);
      scheduleFleetDelta(id);
    }
  };

  const setOsrmPolyline = (id: number, polyline: FleetLatLng[] | null | undefined) => {
    const prev = positions.get(id);
    if (!prev) return;
    positions.set(id, {
      ...prev,
      osrmPolyline: polyline?.length ? polyline.slice() : undefined,
    });
    notifyPosition(id);
    scheduleFleetDelta(id);
  };

  const removeUserInPlace = (id: number) => {
    if (!metaById.has(id)) return false;
    metaById.delete(id);
    positions.delete(id);
    positionListeners.delete(id);
    removeUserIdFromList(id);
    return true;
  };

  const removeUser = (id: number) => {
    if (!removeUserInPlace(id)) return;
    publishUserIds();
  };

  const pruneUsersInPlace = (ids: number[]) => {
    let removed = false;
    for (const id of ids) {
      if (removeUserInPlace(id)) removed = true;
    }
    if (removed) publishUserIds();
  };

  type MergeUserBatchEntry = {
    meta: LiveUserMeta;
    lat: number;
    lng: number;
    heading?: number | null;
    speedMps?: number | null;
    trail?: FleetTrailPoint[];
  };

  const mergeUsersBatch = (
    entries: MergeUserBatchEntry[],
    pruneIds: number[] = [],
  ): number[] => {
    const notifyIds: number[] = [];
    let idsChanged = false;

    for (const { meta, lat, lng, heading, speedMps, trail } of entries) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const isNewUser = !metaById.has(meta.id);
      setMeta(meta);
      if (isNewUser && insertUserIdSorted(meta.id)) {
        idsChanged = true;
      }
      setPosition(meta.id, lat, lng, false, {
        heading,
        speedMps,
        trail,
        serverAt: meta.serverAt ?? null,
      });
      notifyIds.push(meta.id);
    }

    for (const id of pruneIds) {
      if (removeUserInPlace(id)) {
        idsChanged = true;
      }
    }

    if (idsChanged) {
      publishUserIds();
    }

    for (const id of notifyIds) {
      notifyPosition(id);
      scheduleFleetDelta(id);
    }

    return notifyIds;
  };

  const getLiveUsersArray = (): LiveUserSnapshot[] => {
    return userIds.map((id) => {
      const meta = metaById.get(id)!;
      const pos = positions.get(id) ?? { lat: 0, lng: 0, heading: null, speedMps: null };
      return {
        ...meta,
        lat: pos.lat,
        lng: pos.lng,
        heading: pos.heading,
        speedMps: pos.speedMps,
        speedKmh: pos.speedMps != null ? pos.speedMps * 3.6 : null,
      };
    });
  };

  return {
    subscribeUserIds(listener: () => void) {
      userIdsListeners.add(listener);
      return () => userIdsListeners.delete(listener);
    },
    subscribeFleetDeltas(listener: (ids: number[]) => void) {
      fleetDeltaListeners.add(listener);
      return () => fleetDeltaListeners.delete(listener);
    },
    getUserIdsSnapshot: () => userIdsSnapshot,

    subscribePosition(userId: number, listener: () => void) {
      if (!positionListeners.has(userId)) positionListeners.set(userId, new Set());
      positionListeners.get(userId)!.add(listener);
      return () => positionListeners.get(userId)?.delete(listener);
    },
    getPosition(userId: number) {
      return positions.get(userId) ?? null;
    },
    getMeta(userId: number) {
      return metaById.get(userId) ?? null;
    },

    setMeta,
    setPosition,
    setOsrmPolyline,
    removeUser,
    pruneUsersInPlace,
    mergeUsersBatch,
    syncUserIdsArray,
    registerUserId,
    getLiveUsersArray,

    clear() {
      metaById.clear();
      positions.clear();
      userIds = [];
      userIdsSnapshot = [];
      positionListeners.clear();
      pendingFleetDeltaIds.clear();
      if (fleetDeltaTimer) {
        clearTimeout(fleetDeltaTimer);
        fleetDeltaTimer = null;
      }
      notifyUserIds();
    },
  };
}

export function useLiveMapUserIds(store: LiveMapStore) {
  return useSyncExternalStore(
    store.subscribeUserIds,
    store.getUserIdsSnapshot,
    store.getUserIdsSnapshot,
  );
}

export function useLiveUserPosition(store: LiveMapStore, userId: number) {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribePosition(userId, listener),
    [store, userId],
  );
  const getSnapshot = useCallback(
    () => store.getPosition(userId),
    [store, userId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useLiveUserMeta(store: LiveMapStore, userId: number) {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeUserIds(listener),
    [store],
  );
  const getSnapshot = useCallback(
    () => store.getMeta(userId),
    [store, userId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
