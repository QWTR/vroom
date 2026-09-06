import type { TripStats } from '../hooks/useTripStats';
import {
  compactDriveTelemetry,
  type DriveTelemetryPoint,
} from './driveTelemetry';

export type SavedTripSummary = {
  summary?: {
    distanceKm?: unknown;
    durationSec?: unknown;
    movingDurationSec?: unknown;
    stoppedDurationSec?: unknown;
    avgSpeedKmh?: unknown;
    maxSpeedKmh?: unknown;
  } | null;
  routePoints?: DriveTelemetryPoint[] | null;
  availability?: { timeline?: boolean } | null;
};

export type TripSummaryPresentation = {
  distanceKm: number;
  elapsedSec: number;
  movingSec: number;
  stoppedSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  points: DriveTelemetryPoint[];
};

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * The local snapshot can be intentionally sparse after Android/iOS suspended JS.
 * Once finalization reaches the server, its native-backed snapshot is the source
 * of truth for both the finish card and VROOM Story.
 */
export function resolveTripSummaryPresentation(
  local: TripStats,
  saved?: SavedTripSummary | null,
): TripSummaryPresentation {
  const serverPoints = compactDriveTelemetry(saved?.routePoints ?? [], 1_500);
  const localPoints = compactDriveTelemetry(local.trackedPoints ?? [], 1_500);
  const points = serverPoints.length >= 2 ? serverPoints : localPoints;
  const timelineReady = saved?.availability?.timeline === true;

  const serverDistance = finiteNonNegative(saved?.summary?.distanceKm);
  const serverDuration = finiteNonNegative(saved?.summary?.durationSec);
  const serverAvgSpeed = finiteNonNegative(saved?.summary?.avgSpeedKmh);
  const serverMaxSpeed = finiteNonNegative(saved?.summary?.maxSpeedKmh);
  const serverMoving = finiteNonNegative(saved?.summary?.movingDurationSec);
  const serverStopped = finiteNonNegative(saved?.summary?.stoppedDurationSec);

  return {
    distanceKm: serverDistance ?? local.distanceKm,
    elapsedSec: serverDuration && serverDuration > 0 ? serverDuration : local.elapsedSec,
    movingSec: timelineReady && serverMoving != null ? serverMoving : local.elapsedSec,
    stoppedSec: timelineReady && serverStopped != null ? serverStopped : 0,
    avgSpeedKmh: serverAvgSpeed ?? local.avgSpeedKmh,
    maxSpeedKmh: serverMaxSpeed ?? local.maxSpeedKmh,
    points,
  };
}
