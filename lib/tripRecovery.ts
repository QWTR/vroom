import type { DriveTelemetryPoint } from './driveTelemetry';

type RecoveryCandidate = {
  sessionId: string;
  distanceKm?: number | null;
  routePoints?: DriveTelemetryPoint[] | null;
  speedSamples?: number[] | null;
  startTimeMs?: number | null;
  estimatedSec?: number | null;
  floorKm?: number | null;
  savedAt?: number | null;
};

export type ResolvedTripRecovery = {
  tripSessionId: string;
  distanceKm: number;
  trackedPoints: DriveTelemetryPoint[];
  speedSamples: number[];
  startTimeMs: number | null;
  estimatedSec: number;
  floorKm: number;
  savedAt: number;
};

function safeDistance(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Resolve all durable copies of one trip monotonically. A stale ledger or a
 * freshly restarted native tracker is never allowed to replace 566 km with 0.
 */
export function resolveTripRecovery(input: {
  tripSessionId: string;
  checkpointKm?: number | null;
  candidates: RecoveryCandidate[];
}): ResolvedTripRecovery {
  const candidates = input.candidates.filter((candidate) => candidate.sessionId === input.tripSessionId);
  const distanceKm = Math.max(
    safeDistance(input.checkpointKm),
    ...candidates.map((candidate) => safeDistance(candidate.distanceKm)),
    0,
  );
  const routeSource = [...candidates].sort((left, right) => {
    const pointDelta = (right.routePoints?.length ?? 0) - (left.routePoints?.length ?? 0);
    return pointDelta || safeDistance(right.distanceKm) - safeDistance(left.distanceKm);
  })[0];
  const speedSource = [...candidates].sort((left, right) => (
    (right.speedSamples?.length ?? 0) - (left.speedSamples?.length ?? 0)
  ))[0];
  const startTimes = candidates.map((candidate) => Number(candidate.startTimeMs)).filter((value) => Number.isFinite(value) && value > 0);
  const savedTimes = candidates.map((candidate) => Number(candidate.savedAt)).filter((value) => Number.isFinite(value) && value > 0);

  return {
    tripSessionId: input.tripSessionId,
    distanceKm,
    trackedPoints: [...(routeSource?.routePoints ?? [])],
    speedSamples: [...(speedSource?.speedSamples ?? [])],
    startTimeMs: startTimes.length ? Math.min(...startTimes) : null,
    estimatedSec: Math.max(...candidates.map((candidate) => safeDistance(candidate.estimatedSec)), 0),
    floorKm: Math.max(
      safeDistance(input.checkpointKm),
      ...candidates.map((candidate) => safeDistance(candidate.floorKm)),
      distanceKm,
    ),
    savedAt: savedTimes.length ? Math.max(...savedTimes) : Date.now(),
  };
}
