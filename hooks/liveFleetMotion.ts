const FLEET_PUBLISH_INTERVAL_MS = 66;
const SOFT_CORRECTION_MIN_MS = 450;
const SOFT_CORRECTION_MAX_MS = 1_200;
const SMALL_CORRECTION_M = 3;
const SNAP_CORRECTION_M = 80;
/** Pełna animacja floty w tym promieniu od widza; znajomi bez limitu. */
export const FLEET_FULL_ANIMATION_RADIUS_KM = 10;
/** Minimalny dystans do zapisu incremental / force flush (spójne z serwerem). */
export const FLEET_MIN_SNAP_DIST_M = 35;

export function shouldPublishFleetFrame(
  nowMs: number,
  lastPublishAtMs: number,
  intervalMs = FLEET_PUBLISH_INTERVAL_MS,
): boolean {
  'worklet';
  return lastPublishAtMs <= 0 || nowMs - lastPublishAtMs >= intervalMs;
}

export function correctionDurationForDistance(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= SMALL_CORRECTION_M) {
    return SOFT_CORRECTION_MIN_MS;
  }
  if (distanceM >= SNAP_CORRECTION_M) {
    return 0;
  }
  const t = Math.min(1, distanceM / 80);
  return SOFT_CORRECTION_MIN_MS + (SOFT_CORRECTION_MAX_MS - SOFT_CORRECTION_MIN_MS) * t;
}

