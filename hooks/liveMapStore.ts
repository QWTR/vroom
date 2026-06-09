import { useCallback, useSyncExternalStore } from 'react';

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
};

export type LiveUserSnapshot = LiveUserMeta & { lat: number; lng: number };

export type LiveMapStore = ReturnType<typeof createLiveMapStore>;

export function createLiveMapStore() {
  const metaById = new Map<number, LiveUserMeta>();
  const positions = new Map<number, { lat: number; lng: number }>();
  let userIds: number[] = [];
  let userIdsSnapshot: number[] = [];

  const userIdsListeners = new Set<() => void>();
  const positionListeners = new Map<number, Set<() => void>>();

  const notifyUserIds = () => {
    userIdsListeners.forEach((l) => l());
  };

  const notifyPosition = (id: number) => {
    positionListeners.get(id)?.forEach((l) => l());
  };

  const syncUserIdsArray = () => {
    const next = Array.from(metaById.keys()).sort((a, b) => a - b);
    if (next.length === userIds.length && next.every((id, i) => id === userIds[i])) return;
    userIds = next;
    userIdsSnapshot = [...next];
    notifyUserIds();
  };

  const setMeta = (meta: LiveUserMeta) => {
    metaById.set(meta.id, meta);
  };

  const setPosition = (id: number, lat: number, lng: number, notify = true) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const prev = positions.get(id);
    if (prev && prev.lat === lat && prev.lng === lng) return;
    positions.set(id, { lat, lng });
    if (notify) notifyPosition(id);
  };

  const removeUserInPlace = (id: number) => {
    if (!metaById.has(id)) return false;
    metaById.delete(id);
    positions.delete(id);
    positionListeners.delete(id);
    return true;
  };

  const removeUser = (id: number) => {
    if (!removeUserInPlace(id)) return;
    syncUserIdsArray();
  };

  const pruneUsersInPlace = (ids: number[]) => {
    let removed = false;
    for (const id of ids) {
      if (removeUserInPlace(id)) removed = true;
    }
    if (removed) syncUserIdsArray();
  };

  type MergeUserBatchEntry = {
    meta: LiveUserMeta;
    lat: number;
    lng: number;
  };

  const mergeUsersBatch = (
    entries: MergeUserBatchEntry[],
    pruneIds: number[] = [],
  ): number[] => {
    const changedPositionIds: number[] = [];

    for (const { meta, lat, lng } of entries) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      setMeta(meta);
      const prev = positions.get(meta.id);
      const posChanged = !prev || prev.lat !== lat || prev.lng !== lng;
      setPosition(meta.id, lat, lng, false);
      if (posChanged) changedPositionIds.push(meta.id);
    }

    for (const id of pruneIds) {
      removeUserInPlace(id);
    }
    syncUserIdsArray();

    for (const id of changedPositionIds) {
      notifyPosition(id);
    }

    return changedPositionIds;
  };

  const getLiveUsersArray = (): LiveUserSnapshot[] => {
    return userIds.map((id) => {
      const meta = metaById.get(id)!;
      const pos = positions.get(id) ?? { lat: 0, lng: 0 };
      return { ...meta, lat: pos.lat, lng: pos.lng };
    });
  };

  return {
    subscribeUserIds(listener: () => void) {
      userIdsListeners.add(listener);
      return () => userIdsListeners.delete(listener);
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
    removeUser,
    pruneUsersInPlace,
    mergeUsersBatch,
    syncUserIdsArray,
    getLiveUsersArray,

    clear() {
      metaById.clear();
      positions.clear();
      userIds = [];
      userIdsSnapshot = [];
      positionListeners.clear();
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
