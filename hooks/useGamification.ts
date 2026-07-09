import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import type { NavMode } from '../lib/navigationV3/types';
import {
  ackGamificationReward,
  claimGeoDrop,
  fetchDropStatus,
  fetchNearbyDrops,
  fetchPendingGamificationRewards,
  ingestGamificationPing,
  sendDropNavigateIntent,
  syncGamificationDriveMode,
  type GeoDropNearby,
  type GamificationReward,
} from '../lib/gamificationClient';

const DROPS_REFRESH_MS = 5_000;
const DROPS_NEAR_REFRESH_MS = 2_000;
const DROPS_MIN_MOVE_M = 0;
const DROPS_NEAR_MIN_MOVE_M = 15;
const INGEST_REFRESH_MS = 8_000;
const INGEST_MIN_MOVE_M = 8;
const DROP_PROMPT_DEFAULT_RADIUS_M = 5000;
const DROP_SNOOZE_MS = 5 * 60_000;
const REWARD_POLL_MS = 4_000;
const REWARD_POLL_THROTTLE_MS = 2_000;
const CLAIM_RETRY_MS = 2_500;

type DropPing = {
  lat: number;
  lng: number;
  mode: NavMode;
  headingDeg?: number | null;
  speedKmh?: number | null;
  ts?: number;
};

function isDropClaimReward(reward: GamificationReward) {
  return reward.type === 'drop_claimed' || reward.payload?.icon === 'drop';
}

const REWARD_LABELS: Record<string, string> = {
  road: 'MAPA',
  drop: 'DROP',
  crown: 'KORONA',
  city: 'MIASTO',
  map: 'MAPA',
};

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type DropClaimContext = {
  hadNavigationTarget: boolean;
};

export type DropClaimHandler = (
  dropId: number,
  reward: GamificationReward,
  context: DropClaimContext,
) => void;

export function useGamification() {
  const [drops, setDrops] = useState<GeoDropNearby[]>([]);
  const [availableDropPrompt, setAvailableDropPrompt] = useState<GeoDropNearby | null>(null);
  const [dropNavigationTargetId, setDropNavigationTargetId] = useState<number | null>(null);
  const [claimedDropReward, setClaimedDropReward] = useState<GamificationReward | null>(null);
  const claimedDropRewardRef = useRef<GamificationReward | null>(null);
  const lastModeRef = useRef<NavMode>('idle');
  const dropNavigationTargetIdRef = useRef<number | null>(null);
  const dropClaimHandlerRef = useRef<DropClaimHandler | null>(null);
  const lastDropFetchRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastIngestRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastRewardPollRef = useRef(0);
  const shownRewardIdsRef = useRef<Set<number>>(new Set());
  const promptedDropIdsRef = useRef<Set<number>>(new Set());
  const hiddenDropIdsRef = useRef<Set<number>>(new Set());
  const snoozedDropIdsRef = useRef<Map<number, number>>(new Map());
  const trackedDropRef = useRef<GeoDropNearby | null>(null);
  const dropsRef = useRef<GeoDropNearby[]>([]);
  const claimingDropIdsRef = useRef<Set<number>>(new Set());
  const lastClaimAttemptRef = useRef<Map<number, number>>(new Map());
  const dropRefreshGenRef = useRef(0);

  dropNavigationTargetIdRef.current = dropNavigationTargetId;
  dropsRef.current = drops;
  claimedDropRewardRef.current = claimedDropReward;

  const normalizeDropId = useCallback((dropId: unknown): number | null => {
    const id = Number(dropId);
    return Number.isFinite(id) ? id : null;
  }, []);

  const isDropHidden = useCallback((dropId: unknown): boolean => {
    const id = normalizeDropId(dropId);
    return id != null && hiddenDropIdsRef.current.has(id);
  }, [normalizeDropId]);

  const setClaimedDropModal = useCallback((reward: GamificationReward | null) => {
    claimedDropRewardRef.current = reward;
    setClaimedDropReward(reward);
  }, []);

  const setDropClaimHandler = useCallback((handler: DropClaimHandler | null) => {
    dropClaimHandlerRef.current = handler;
  }, []);

  const purgeDrop = useCallback((dropId: number) => {
    const id = normalizeDropId(dropId);
    if (id == null) return;
    dropRefreshGenRef.current += 1;
    hiddenDropIdsRef.current.add(id);
    promptedDropIdsRef.current.add(id);
    claimingDropIdsRef.current.delete(id);
    if (trackedDropRef.current?.id === id) trackedDropRef.current = null;
    setAvailableDropPrompt((prev) => (Number(prev?.id) === id ? null : prev));
    setDrops((prev) => prev.filter((drop) => Number(drop.id) !== id));
    if (dropNavigationTargetIdRef.current === id) dropNavigationTargetIdRef.current = null;
    setDropNavigationTargetId((prev) => (prev === id ? null : prev));
  }, [normalizeDropId]);

  const syncDriveMode = useCallback(async (mode: NavMode) => {
    if (lastModeRef.current === mode) return;
    lastModeRef.current = mode;
    await syncGamificationDriveMode(mode);
    if (mode === 'navigation') {
      setAvailableDropPrompt(null);
      if (!dropNavigationTargetIdRef.current) {
        setDrops([]);
        trackedDropRef.current = null;
      }
      return;
    }
    if (mode !== 'freeDrive') {
      setDrops([]);
      setAvailableDropPrompt(null);
      setDropNavigationTargetId(null);
      trackedDropRef.current = null;
    }
  }, []);

  const showRewardToast = useCallback((reward: GamificationReward) => {
    if (shownRewardIdsRef.current.has(reward.id)) return;
    shownRewardIdsRef.current.add(reward.id);
    const iconKey = reward.payload?.icon as string | undefined;
    const label = iconKey ? (REWARD_LABELS[iconKey] ?? iconKey) : 'VROOM';
    Toast.show({
      type: 'success',
      text1: `${label}: ${reward.title}`,
      text2: reward.body ?? undefined,
      visibilityTime: 4500,
    } as any);
    void ackGamificationReward(reward.id);
  }, []);

  const pollPendingRewardsRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  const presentDropClaimSuccess = useCallback((
    dropId: number,
    result: { nitroGranted?: number; rarity?: string; wonReward?: unknown; rewardPool?: unknown; rollSeed?: string | null },
  ) => {
    const wonReward = result.wonReward && typeof result.wonReward === 'object' ? result.wonReward as Record<string, unknown> : null;
    const reward: GamificationReward = {
      id: -dropId,
      type: 'drop_claimed',
      title: 'Zrzut zdobyty!',
      body: String(wonReward?.label || '') || ((result.nitroGranted ?? 0) > 0
        ? `+${result.nitroGranted} Nitro`
        : 'Nagroda odebrana.'),
      payload: {
        dropId,
        rarity: result.rarity ?? 'common',
        nitroAmount: result.nitroGranted ?? 0,
        icon: 'drop',
        wonReward: result.wonReward ?? null,
        rewardPool: Array.isArray(result.rewardPool) ? result.rewardPool : [],
        rollSeed: result.rollSeed ?? null,
      },
      createdAt: new Date().toISOString(),
    };
    const hadNavigationTarget = dropNavigationTargetIdRef.current === dropId;
    purgeDrop(dropId);
    claimingDropIdsRef.current.delete(dropId);
    setClaimedDropModal(reward);

    queueMicrotask(() => {
      try {
        dropClaimHandlerRef.current?.(dropId, reward, { hadNavigationTarget });
      } catch {
        // Map cleanup must never block the congratulations modal.
      }
      void pollPendingRewardsRef.current(true);
    });
  }, [purgeDrop, setClaimedDropModal]);

  const presentReward = useCallback((reward: GamificationReward) => {
    if (shownRewardIdsRef.current.has(reward.id)) return;

    if (isDropClaimReward(reward)) {
      const dropId = Number(reward.payload?.dropId);
      if (claimedDropRewardRef.current) {
        shownRewardIdsRef.current.add(reward.id);
        if (Number.isFinite(dropId)) purgeDrop(dropId);
        return;
      }
      shownRewardIdsRef.current.add(reward.id);
      const hadNavigationTarget = Number.isFinite(dropId)
        && dropNavigationTargetIdRef.current === dropId;
      if (Number.isFinite(dropId)) {
        purgeDrop(dropId);
      }
      setClaimedDropModal(reward);
      queueMicrotask(() => {
        if (!Number.isFinite(dropId)) return;
        try {
          dropClaimHandlerRef.current?.(dropId, reward, { hadNavigationTarget });
        } catch {
          // Map cleanup must never block the congratulations modal.
        }
      });
      return;
    }

    showRewardToast(reward);
  }, [showRewardToast, purgeDrop, setClaimedDropModal]);

  const pollPendingRewards = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastRewardPollRef.current < REWARD_POLL_THROTTLE_MS) return;
    lastRewardPollRef.current = now;

    const rewards = await fetchPendingGamificationRewards();
    for (const reward of rewards) {
      presentReward(reward);
    }
  }, [presentReward]);

  pollPendingRewardsRef.current = pollPendingRewards;

  const dismissClaimedDropReward = useCallback(async () => {
    const reward = claimedDropReward;
    if (!reward) return;

    if (reward.id > 0) {
      await ackGamificationReward(reward.id);
    } else {
      const dropId = Number(reward.payload?.dropId);
      const pending = await fetchPendingGamificationRewards();
      for (const item of pending) {
        if (!isDropClaimReward(item)) continue;
        if (Number(item.payload?.dropId) !== dropId) continue;
        shownRewardIdsRef.current.add(item.id);
        await ackGamificationReward(item.id);
      }
    }
    setClaimedDropModal(null);
  }, [claimedDropReward, setClaimedDropModal]);

  const collectDropCandidates = useCallback((): GeoDropNearby[] => {
    const byId = new Map<number, GeoDropNearby>();
    for (const drop of dropsRef.current) byId.set(Number(drop.id), drop);
    if (trackedDropRef.current && !isDropHidden(trackedDropRef.current.id)) {
      byId.set(Number(trackedDropRef.current.id), trackedDropRef.current);
    }
    if (availableDropPrompt && !isDropHidden(availableDropPrompt.id)) {
      byId.set(Number(availableDropPrompt.id), availableDropPrompt);
    }
    return [...byId.values()].filter((drop) => !isDropHidden(drop.id));
  }, [availableDropPrompt, isDropHidden]);

  const tryClaimNearbyDrops = useCallback(async (input: DropPing) => {
    if (input.mode !== 'freeDrive' && input.mode !== 'navigation') return;
    if (claimedDropRewardRef.current) return;

    const now = Date.now();
    const ping = {
      lat: input.lat,
      lng: input.lng,
      mode: input.mode,
      headingDeg: input.headingDeg,
      speedKmh: input.speedKmh,
      ts: input.ts ?? now,
    };

    for (const drop of collectDropCandidates()) {
      const dropId = normalizeDropId(drop.id);
      if (dropId == null) continue;
      if (claimingDropIdsRef.current.has(dropId)) continue;
      const distM = haversineM(ping.lat, ping.lng, drop.lat, drop.lng);
      if (distM > drop.radiusM) continue;

      const lastTry = lastClaimAttemptRef.current.get(dropId) ?? 0;
      if (now - lastTry < CLAIM_RETRY_MS) continue;
      lastClaimAttemptRef.current.set(dropId, now);
      claimingDropIdsRef.current.add(dropId);

      const result = await claimGeoDrop(dropId, ping);
      if (result.ok) {
        presentDropClaimSuccess(dropId, {
          nitroGranted: result.nitroGranted,
          rarity: result.rarity,
          wonReward: result.wonReward,
          rewardPool: result.rewardPool,
          rollSeed: result.rollSeed,
        });
        return;
      }

      claimingDropIdsRef.current.delete(dropId);
      if (result.error === 'DROP_ALREADY_CLAIMED' || result.error === 'DROP_NOT_AVAILABLE') {
        purgeDrop(dropId);
        const pending = await fetchPendingGamificationRewards();
        const serverReward = pending.find((item) =>
          isDropClaimReward(item) && Number(item.payload?.dropId) === dropId,
        );
        if (serverReward && !claimedDropRewardRef.current) {
          presentReward(serverReward);
        } else {
          void pollPendingRewards(true);
        }
      }
    }
  }, [collectDropCandidates, normalizeDropId, presentDropClaimSuccess, presentReward, pollPendingRewards, purgeDrop]);

  const syncTrackedDropStatus = useCallback(async () => {
    const targetId = dropNavigationTargetIdRef.current;
    if (!targetId) return false;

    const status = await fetchDropStatus(targetId);
    if (status?.available) return false;

    purgeDrop(targetId);
    void pollPendingRewards(true);
    return true;
  }, [pollPendingRewards, purgeDrop]);

  const refreshDrops = useCallback(async (lat: number, lng: number, force = false) => {
    const refreshGen = dropRefreshGenRef.current;
    const prev = lastDropFetchRef.current;
    const now = Date.now();
    const nearTrackedDrop = trackedDropRef.current
      && !isDropHidden(trackedDropRef.current.id)
      && haversineM(lat, lng, trackedDropRef.current.lat, trackedDropRef.current.lng) <= 1200;
    const refreshMs = nearTrackedDrop ? DROPS_NEAR_REFRESH_MS : DROPS_REFRESH_MS;
    const minMoveM = nearTrackedDrop ? DROPS_NEAR_MIN_MOVE_M : DROPS_MIN_MOVE_M;

    if (
      !force
      && prev
      && now - prev.at < refreshMs
      && haversineM(prev.lat, prev.lng, lat, lng) < minMoveM
    ) {
      return;
    }

    lastDropFetchRef.current = { lat, lng, at: now };

    if (lastModeRef.current === 'navigation' && dropNavigationTargetIdRef.current) {
      const gone = await syncTrackedDropStatus();
      if (gone) return;
    }

    if (lastModeRef.current === 'navigation' && !dropNavigationTargetIdRef.current) return;
    if (lastModeRef.current !== 'freeDrive' && lastModeRef.current !== 'navigation') return;
    if (claimedDropRewardRef.current) return;

    const next = await fetchNearbyDrops(lat, lng);
    if (refreshGen !== dropRefreshGenRef.current) return;

    const visible = next.filter((drop) => !isDropHidden(drop.id));
    const targetId = dropNavigationTargetIdRef.current;
    const filtered = targetId
      ? visible.filter((drop) => Number(drop.id) === targetId)
      : visible;

    setDrops((prevDrops) => {
      if (refreshGen !== dropRefreshGenRef.current) return prevDrops;
      return filtered.filter((drop) => !isDropHidden(drop.id));
    });

    if (filtered[0] && !isDropHidden(filtered[0].id)) {
      trackedDropRef.current = filtered[0];
    } else if (trackedDropRef.current && isDropHidden(trackedDropRef.current.id)) {
      trackedDropRef.current = null;
    }

    setAvailableDropPrompt((activePrompt) => {
      if (refreshGen !== dropRefreshGenRef.current) return activePrompt;
      if (claimedDropRewardRef.current) return null;
      if (activePrompt && (isDropHidden(activePrompt.id) || !visible.some((drop) => Number(drop.id) === Number(activePrompt.id)))) {
        return null;
      }
      if (activePrompt) return activePrompt;

      const nearby = visible.find((drop) => {
        if (isDropHidden(drop.id)) return false;
        const snoozedUntil = snoozedDropIdsRef.current.get(Number(drop.id)) ?? 0;
        const promptRadiusM = Math.max(
          DROP_PROMPT_DEFAULT_RADIUS_M,
          Math.round(Number(drop.notificationRadiusKm || 5) * 1000),
        );
        return drop.distanceM <= promptRadiusM
          && now >= snoozedUntil
          && !promptedDropIdsRef.current.has(Number(drop.id));
      });

      if (!nearby) return null;
      promptedDropIdsRef.current.add(Number(nearby.id));
      trackedDropRef.current = nearby;
      return nearby;
    });

    for (const drop of visible) {
      if (isDropHidden(drop.id)) continue;
      if (drop.distanceM <= drop.radiusM * 1.5) {
        trackedDropRef.current = drop;
      }
    }

    void pollPendingRewards();
  }, [isDropHidden, pollPendingRewards, syncTrackedDropStatus]);

  const showDropPrompt = useCallback((drop: GeoDropNearby) => {
    if (lastModeRef.current !== 'freeDrive') return;
    if (isDropHidden(drop.id)) return;
    if (claimedDropRewardRef.current) return;
    trackedDropRef.current = drop;
    setAvailableDropPrompt(drop);
  }, [isDropHidden]);

  const snoozeDropPrompt = useCallback((dropId?: number) => {
    const id = dropId ?? availableDropPrompt?.id;
    if (id != null) snoozedDropIdsRef.current.set(id, Date.now() + DROP_SNOOZE_MS);
    setAvailableDropPrompt(null);
  }, [availableDropPrompt?.id]);

  const hideDropPrompt = useCallback((dropId?: number) => {
    const id = dropId ?? availableDropPrompt?.id;
    if (id != null) purgeDrop(id);
  }, [availableDropPrompt?.id, purgeDrop]);

  const dismissDropPrompt = useCallback(() => {
    setAvailableDropPrompt(null);
  }, []);

  const startDropNavigation = useCallback(async (drop: GeoDropNearby, current?: { lat?: number | null; lng?: number | null }) => {
    const dropId = normalizeDropId(drop.id);
    if (dropId == null || isDropHidden(dropId)) return false;
    const ok = await sendDropNavigateIntent({
      dropId,
      lat: current?.lat,
      lng: current?.lng,
      mode: lastModeRef.current,
    });
    if (!ok) {
      return false;
    }
    trackedDropRef.current = drop;
    dropNavigationTargetIdRef.current = dropId;
    setDropNavigationTargetId(dropId);
    setDrops([drop]);
    setAvailableDropPrompt(null);
    return true;
  }, [isDropHidden, normalizeDropId]);

  const clearDropNavigationTarget = useCallback(() => {
    dropNavigationTargetIdRef.current = null;
    setDropNavigationTargetId(null);
    trackedDropRef.current = null;
  }, []);

  const ingestPing = useCallback(async (input: DropPing & { force?: boolean }) => {
    if (input.mode !== 'freeDrive' && input.mode !== 'navigation') return;

    const nearAnyDrop = collectDropCandidates().some((drop) =>
      haversineM(input.lat, input.lng, drop.lat, drop.lng) <= drop.radiusM * 1.25,
    );
    if (nearAnyDrop) {
      await tryClaimNearbyDrops(input);
    }

    const prev = lastIngestRef.current;
    const now = Date.now();
    if (
      !input.force
      && !nearAnyDrop
      && prev
      && now - prev.at < INGEST_REFRESH_MS
      && haversineM(prev.lat, prev.lng, input.lat, input.lng) < INGEST_MIN_MOVE_M
    ) {
      return;
    }

    lastIngestRef.current = { lat: input.lat, lng: input.lng, at: now };
    await ingestGamificationPing({
      lat: input.lat,
      lng: input.lng,
      mode: input.mode,
      headingDeg: input.headingDeg,
      speedKmh: input.speedKmh,
      ts: now,
    });

    if (nearAnyDrop) {
      await tryClaimNearbyDrops(input);
    } else {
      void pollPendingRewards();
    }

    if (input.mode === 'navigation' && dropNavigationTargetIdRef.current) {
      void syncTrackedDropStatus();
    }
  }, [collectDropCandidates, tryClaimNearbyDrops, pollPendingRewards, syncTrackedDropStatus]);

  const deliverPendingRewards = useCallback(async () => {
    const rewards = await fetchPendingGamificationRewards();
    for (const reward of rewards) {
      if (isDropClaimReward(reward)) {
        presentReward(reward);
      } else if (!shownRewardIdsRef.current.has(reward.id)) {
        showRewardToast(reward);
      }
    }
  }, [presentReward, showRewardToast]);

  useEffect(() => {
    const id = setInterval(() => {
      if (lastModeRef.current === 'freeDrive' || lastModeRef.current === 'navigation') {
        void pollPendingRewards();
      }
    }, REWARD_POLL_MS);
    return () => clearInterval(id);
  }, [pollPendingRewards]);

  return {
    drops,
    availableDropPrompt,
    dropNavigationTargetId,
    claimedDropReward,
    syncDriveMode,
    ingestPing,
    refreshDrops,
    deliverPendingRewards,
    pollPendingRewards,
    purgeDrop,
    setDropClaimHandler,
    showRewardToast,
    showDropPrompt,
    snoozeDropPrompt,
    hideDropPrompt,
    dismissDropPrompt,
    dismissClaimedDropReward,
    startDropNavigation,
    clearDropNavigationTarget,
    tryClaimNearbyDrops,
    syncTrackedDropStatus,
  };
}
