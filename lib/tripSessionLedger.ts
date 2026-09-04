import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  compactDriveTelemetry,
  type DriveTelemetryPoint,
} from './driveTelemetry';

export type TripLedgerMode = 'navigation' | 'freeDrive';
export type TripFinalizationReason = 'arrival' | 'manual' | 'idle' | 'crash' | 'auto_stop' | 'premium_expired';

export type TripSessionLedger = {
  version: 2;
  tripSessionId: string;
  startedAt: string;
  updatedAt: number;
  lastMovementAt: number;
  active: boolean;
  mode: TripLedgerMode;
  distanceKm: number;
  checkpointKm: number;
  routePoints: DriveTelemetryPoint[];
  speedSamples: number[];
  maxSpeedKmh: number;
  finalization: {
    state: 'open' | 'pending' | 'saved';
    reason?: TripFinalizationReason;
    requestedAt?: number;
  };
};

export type NativeLedgerSnapshot = {
  tripSessionId: string;
  startedAt?: number | null;
  mode?: string | null;
  distanceKm: number;
  checkpointKm?: number | null;
  routePoints?: DriveTelemetryPoint[];
  speedSamples?: number[];
  maxSpeedKmh?: number | null;
  movedAt?: number | null;
};

export const TRIP_SESSION_LEDGER_KEY = 'trip_session_ledger_v1';
export const TRIP_FINALIZATION_OUTBOX_KEY = 'trip_session_finalization_outbox_v1';
export const TRIP_LEDGER_SNAPSHOT_KM = 0.1;
export const TRIP_LEDGER_SNAPSHOT_MS = 5_000;

const MAX_ROUTE_POINTS = 1_500;
const MAX_SPEED_SAMPLES = 400;

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function compactTripRoute(points: DriveTelemetryPoint[]) {
  return compactDriveTelemetry(points, MAX_ROUTE_POINTS);
}

/**
 * Native tracking is the only trace that stays continuous while the JS runtime
 * is suspended. Prefer it at finalization; the other snapshots are recovery
 * fallbacks for older binaries or unavailable native tracking.
 */
export function selectTripRouteForFinalization(input: {
  nativeRoute?: DriveTelemetryPoint[];
  foregroundRoute?: DriveTelemetryPoint[];
  emergencyRoute?: DriveTelemetryPoint[];
}): DriveTelemetryPoint[] {
  const nativeRoute = compactTripRoute(input.nativeRoute ?? []);
  if (nativeRoute.length >= 2) return nativeRoute;
  const foregroundRoute = compactTripRoute(input.foregroundRoute ?? []);
  if (foregroundRoute.length >= 2) return foregroundRoute;
  return compactTripRoute(input.emergencyRoute ?? []);
}

function mergeRoute(
  current: DriveTelemetryPoint[],
  next: DriveTelemetryPoint[],
) {
  if (!next.length) return compactTripRoute(current);
  if (!current.length) return compactTripRoute(next);
  const currentLast = current[current.length - 1];
  const nextFirst = next[0];
  const duplicateBoundary = currentLast
    && nextFirst
    && Math.abs(currentLast.latitude - nextFirst.latitude) < 1e-7
    && Math.abs(currentLast.longitude - nextFirst.longitude) < 1e-7;
  return compactTripRoute([...current, ...(duplicateBoundary ? next.slice(1) : next)]);
}

export function resolveTripSessionIdentity(input: {
  jsSessionId: string | null;
  nativeStateActive: boolean;
  nativeStateSessionId: string | null;
  nativeStatsSessionId: string | null;
}): { sessionId: string | null; acceptNativeStats: boolean; conflict: boolean } {
  const nativeSessionId = input.nativeStatsSessionId || input.nativeStateSessionId;
  if (input.jsSessionId) {
    const acceptNativeStats = !!input.nativeStatsSessionId
      && input.nativeStatsSessionId === input.jsSessionId;
    return {
      sessionId: input.jsSessionId,
      acceptNativeStats,
      conflict: !!nativeSessionId && nativeSessionId !== input.jsSessionId,
    };
  }
  if (input.nativeStateActive && nativeSessionId) {
    return {
      sessionId: nativeSessionId,
      acceptNativeStats: !input.nativeStatsSessionId || input.nativeStatsSessionId === nativeSessionId,
      conflict: false,
    };
  }
  return { sessionId: null, acceptNativeStats: false, conflict: false };
}

function parseLedger(raw: string | null): TripSessionLedger | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || ![1, 2].includes(value.version) || typeof value.tripSessionId !== 'string' || !value.tripSessionId) return null;
    return {
      version: 2,
      tripSessionId: value.tripSessionId,
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : new Date().toISOString(),
      updatedAt: safeNumber(value.updatedAt),
      lastMovementAt: safeNumber(value.lastMovementAt),
      active: value.active !== false,
      mode: value.mode === 'navigation' ? 'navigation' : 'freeDrive',
      distanceKm: safeNumber(value.distanceKm),
      checkpointKm: safeNumber(value.checkpointKm),
      routePoints: compactTripRoute(Array.isArray(value.routePoints) ? value.routePoints : []),
      speedSamples: (Array.isArray(value.speedSamples) ? value.speedSamples : [])
        .map(Number).filter((n: number) => Number.isFinite(n) && n >= 1).slice(-MAX_SPEED_SAMPLES),
      maxSpeedKmh: safeNumber(value.maxSpeedKmh),
      finalization: value.finalization?.state === 'saved'
        ? { state: 'saved', reason: value.finalization.reason, requestedAt: safeNumber(value.finalization.requestedAt) }
        : value.finalization?.state === 'pending'
          ? { state: 'pending', reason: value.finalization.reason, requestedAt: safeNumber(value.finalization.requestedAt) }
          : { state: 'open' },
    };
  } catch {
    return null;
  }
}

export async function loadTripSessionLedger(): Promise<TripSessionLedger | null> {
  return parseLedger(await AsyncStorage.getItem(TRIP_SESSION_LEDGER_KEY));
}

export async function saveTripSessionLedger(ledger: TripSessionLedger): Promise<void> {
  await AsyncStorage.setItem(TRIP_SESSION_LEDGER_KEY, JSON.stringify(ledger));
}

export async function clearTripSessionLedger(): Promise<void> {
  await AsyncStorage.removeItem(TRIP_SESSION_LEDGER_KEY);
}

export function createTripSessionLedger(input: {
  tripSessionId: string;
  startedAt?: string;
  mode?: TripLedgerMode;
  now?: number;
}): TripSessionLedger {
  const now = input.now ?? Date.now();
  return {
    version: 2,
    tripSessionId: input.tripSessionId,
    startedAt: input.startedAt ?? new Date(now).toISOString(),
    updatedAt: now,
    lastMovementAt: now,
    active: true,
    mode: input.mode ?? 'freeDrive',
    distanceKm: 0,
    checkpointKm: 0,
    routePoints: [],
    speedSamples: [],
    maxSpeedKmh: 0,
    finalization: { state: 'open' },
  };
}

/** Native distance is a session total, never an incremental fragment. */
export function mergeNativeLedgerSnapshot(
  current: TripSessionLedger | null,
  native: NativeLedgerSnapshot,
  now = Date.now(),
): TripSessionLedger {
  const nextMode: TripLedgerMode = native.mode === 'navigation' ? 'navigation' : 'freeDrive';
  const base = current?.tripSessionId === native.tripSessionId
    ? current
    : createTripSessionLedger({
        tripSessionId: native.tripSessionId,
        startedAt: native.startedAt ? new Date(native.startedAt).toISOString() : undefined,
        mode: nextMode,
        now,
      });
  const nativeDistance = safeNumber(native.distanceKm);
  const nativeCheckpoint = safeNumber(native.checkpointKm);
  const nativeSamples = (native.speedSamples ?? []).map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1).slice(-MAX_SPEED_SAMPLES);
  const moved = nativeDistance > base.distanceKm + 0.001;
  const distanceKm = Math.max(base.distanceKm, nativeDistance, nativeCheckpoint);
  return {
    ...base,
    updatedAt: now,
    lastMovementAt: moved ? (native.movedAt ?? now) : base.lastMovementAt,
    active: true,
    mode: nextMode,
    distanceKm,
    checkpointKm: Math.max(base.checkpointKm, nativeCheckpoint),
    // Android/iOS expose the complete native route snapshot for the session,
    // not a delta. Appending every poll would replay the already-seen prefix
    // and draw loops in the saved activity.
    routePoints: native.routePoints?.length
      ? compactTripRoute(native.routePoints)
      : base.routePoints,
    speedSamples: nativeSamples.length ? nativeSamples : base.speedSamples,
    maxSpeedKmh: Math.max(base.maxSpeedKmh, safeNumber(native.maxSpeedKmh), ...nativeSamples, 0),
    finalization: base.finalization.state === 'saved' ? { state: 'open' } : base.finalization,
  };
}

export function mergeForegroundLedgerSnapshot(
  current: TripSessionLedger,
  input: {
    distanceKm: number;
    routePoints?: DriveTelemetryPoint[];
    maxSpeedKmh?: number;
    avgSpeedKmh?: number;
    mode?: TripLedgerMode;
    now?: number;
  },
): TripSessionLedger {
  const now = input.now ?? Date.now();
  const nextDistance = Math.max(current.distanceKm, safeNumber(input.distanceKm));
  const moved = nextDistance > current.distanceKm + 0.001;
  const samples = input.avgSpeedKmh && input.avgSpeedKmh >= 1
    ? [...current.speedSamples, input.avgSpeedKmh].slice(-MAX_SPEED_SAMPLES)
    : current.speedSamples;
  return {
    ...current,
    updatedAt: now,
    lastMovementAt: moved ? now : current.lastMovementAt,
    mode: input.mode ?? current.mode,
    distanceKm: nextDistance,
    routePoints: mergeRoute(current.routePoints, input.routePoints ?? []),
    speedSamples: samples,
    maxSpeedKmh: Math.max(current.maxSpeedKmh, safeNumber(input.maxSpeedKmh)),
  };
}

export function markLedgerFinalizationPending(
  ledger: TripSessionLedger,
  reason: TripFinalizationReason,
  now = Date.now(),
): TripSessionLedger {
  return {
    ...ledger,
    active: false,
    updatedAt: now,
    finalization: { state: 'pending', reason, requestedAt: now },
  };
}

export function averageLedgerSpeed(ledger: TripSessionLedger): number {
  if (!ledger.speedSamples.length) return 0;
  return ledger.speedSamples.reduce((sum, value) => sum + value, 0) / ledger.speedSamples.length;
}

export function shouldSnapshotLedger(
  previous: TripSessionLedger | null,
  next: TripSessionLedger,
): boolean {
  if (!previous || previous.tripSessionId !== next.tripSessionId) return true;
  return next.distanceKm - previous.distanceKm >= TRIP_LEDGER_SNAPSHOT_KM
    || next.updatedAt - previous.updatedAt >= TRIP_LEDGER_SNAPSHOT_MS
    || next.finalization.state !== previous.finalization.state;
}
