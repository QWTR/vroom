import AsyncStorage from '@react-native-async-storage/async-storage';

export const TRIP_CHECKPOINT_OUTBOX_KEY = 'trip_checkpoint_outbox_v1';
const TRIP_DIAGNOSTICS_KEY = 'trip_persistence_diagnostics_v1';
const MAX_DIAGNOSTICS = 40;

export type PendingTripCheckpoint = {
  tripSessionId: string;
  distanceKm: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  source: 'navigation' | 'driving' | 'trip-checkpoint' | 'background-passive';
  updatedAt: number;
};

export type TripPersistenceEvent =
  | 'session_started'
  | 'session_id_conflict'
  | 'checkpoint_queued'
  | 'checkpoint_ok'
  | 'checkpoint_fail'
  | 'finalization_queued'
  | 'finalization_ok'
  | 'finalization_fail';

type ActiveTripCheckpointFlusher = (opts?: {
  minKm?: number;
  forceAll?: boolean;
  reason?: string;
}) => Promise<boolean>;

let activeTripCheckpointFlusher: ActiveTripCheckpointFlusher | null = null;
let activeFlushPromise: Promise<boolean> | null = null;

export function registerActiveTripCheckpointFlusher(
  flusher: ActiveTripCheckpointFlusher,
): () => void {
  activeTripCheckpointFlusher = flusher;
  return () => {
    if (activeTripCheckpointFlusher === flusher) activeTripCheckpointFlusher = null;
  };
}

export async function flushActiveTripCheckpointForProfile(): Promise<boolean> {
  if (!activeTripCheckpointFlusher) return false;
  if (activeFlushPromise) return activeFlushPromise;
  const options = { minKm: 0.05, forceAll: true, reason: 'profile' } as const;
  activeFlushPromise = (async () => {
    const first = await activeTripCheckpointFlusher?.(options) ?? false;
    // If a periodic tick was already in flight, the first call joined it. A
    // second pass captures any distance that arrived while that request ran.
    const second = await activeTripCheckpointFlusher?.(options) ?? false;
    return first || second;
  })().finally(() => {
    activeFlushPromise = null;
  });
  return activeFlushPromise;
}

export function parsePendingTripCheckpoint(raw: string | null): PendingTripCheckpoint | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const distanceKm = Number(value?.distanceKm);
    if (!value?.tripSessionId || !Number.isFinite(distanceKm) || distanceKm < 0.05) return null;
    return {
      tripSessionId: String(value.tripSessionId),
      distanceKm,
      maxSpeedKmh: Math.max(0, Number(value.maxSpeedKmh) || 0),
      avgSpeedKmh: Math.max(0, Number(value.avgSpeedKmh) || 0),
      source: value.source === 'navigation' || value.source === 'driving'
        || value.source === 'background-passive'
        ? value.source
        : 'trip-checkpoint',
      updatedAt: Number(value.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function mergePendingTripCheckpoint(
  current: PendingTripCheckpoint | null,
  next: PendingTripCheckpoint,
): PendingTripCheckpoint {
  if (!current || current.tripSessionId !== next.tripSessionId) return next;
  return {
    ...next,
    distanceKm: Math.max(current.distanceKm, next.distanceKm),
    maxSpeedKmh: Math.max(current.maxSpeedKmh, next.maxSpeedKmh),
    avgSpeedKmh: next.avgSpeedKmh || current.avgSpeedKmh,
    updatedAt: Math.max(current.updatedAt, next.updatedAt),
  };
}

export async function readPendingTripCheckpoint(): Promise<PendingTripCheckpoint | null> {
  return parsePendingTripCheckpoint(await AsyncStorage.getItem(TRIP_CHECKPOINT_OUTBOX_KEY));
}

export async function queuePendingTripCheckpoint(
  next: PendingTripCheckpoint,
): Promise<PendingTripCheckpoint> {
  const merged = mergePendingTripCheckpoint(await readPendingTripCheckpoint(), next);
  await AsyncStorage.setItem(TRIP_CHECKPOINT_OUTBOX_KEY, JSON.stringify(merged));
  return merged;
}

export async function acknowledgePendingTripCheckpoint(
  tripSessionId: string,
  acknowledgedDistanceKm: number,
): Promise<void> {
  const current = await readPendingTripCheckpoint();
  if (
    current?.tripSessionId === tripSessionId
    && current.distanceKm <= acknowledgedDistanceKm + 0.0005
  ) {
    await AsyncStorage.removeItem(TRIP_CHECKPOINT_OUTBOX_KEY);
  }
}

export async function recordTripPersistenceEvent(
  event: TripPersistenceEvent,
  details: {
    tripSessionId?: string | null;
    distanceKm?: number;
    routePointsCount?: number;
    status?: number;
    reason?: string;
  } = {},
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(TRIP_DIAGNOSTICS_KEY);
    const current = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(current) ? current : [];
    const safeDetails = {
      at: Date.now(),
      event,
      session: details.tripSessionId ? String(details.tripSessionId).slice(-12) : undefined,
      distanceKm: Number.isFinite(details.distanceKm) ? Number(details.distanceKm?.toFixed(3)) : undefined,
      routePointsCount: Number.isFinite(details.routePointsCount) ? details.routePointsCount : undefined,
      status: Number.isFinite(details.status) ? details.status : undefined,
      reason: details.reason?.slice(0, 48),
    };
    await AsyncStorage.setItem(
      TRIP_DIAGNOSTICS_KEY,
      JSON.stringify([...list, safeDetails].slice(-MAX_DIAGNOSTICS)),
    );
  } catch {
    // Diagnostics must never interfere with saving a trip.
  }
}
