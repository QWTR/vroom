import {
  CAMERA_TURN_DURATION_FACTOR,
  CAMERA_TURN_DURATION_MAX_MS,
  CAMERA_TURN_DURATION_MIN_MS,
  SHARP_TURN_RATE_DPS,
  ZERO_VELOCITY_ENGINE_STILL_KMH,
  ZERO_VELOCITY_RAW_TRUST_KMH,
} from './config';

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalizeKmh(kmh: number): number {
  return Number.isFinite(kmh) ? Math.max(0, kmh) : 0;
}

/** Najkrótszy łuk między dwoma headingami (stopnie). */
export function headingDeltaDeg(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Stopnie na sekundę — delta heading / czas ticka. */
export function computeHeadingRateDps(
  prevHdg: number,
  currHdg: number,
  dtMs: number,
): number {
  if (!Number.isFinite(prevHdg) || !Number.isFinite(currHdg)) return 0;
  const dtSec = clampNum(dtMs / 1000, 0.05, 5);
  return headingDeltaDeg(prevHdg, currHdg) / dtSec;
}

export function isSharpManeuver(
  headingRateDps: number,
  confirmedTurn = false,
): boolean {
  return confirmedTurn || headingRateDps >= SHARP_TURN_RATE_DPS;
}

export function resolveCameraSegmentDuration(
  feedDurMs: number,
  opts: { sharpTurn?: boolean },
): number {
  const base = Math.max(0, Math.round(feedDurMs));
  if (!opts.sharpTurn || base <= 0) return base;
  return clampNum(
    Math.round(base * CAMERA_TURN_DURATION_FACTOR),
    CAMERA_TURN_DURATION_MIN_MS,
    CAMERA_TURN_DURATION_MAX_MS,
  );
}

/**
 * Twardy priorytet silnika nawigacji — Doppler ignorowany gdy engine mówi „stoi”.
 * engineKmh === 0  OR  (engine < 3  AND  rawGps < 6)
 */
export function isZeroVelocityLock(
  engineKmh: number,
  rawGpsKmh: number,
  parkedLike = false,
): boolean {
  if (parkedLike) return true;
  const engine = normalizeKmh(engineKmh);
  const raw = normalizeKmh(rawGpsKmh);
  return engine === 0
    || (engine < ZERO_VELOCITY_ENGINE_STILL_KMH && raw < ZERO_VELOCITY_RAW_TRUST_KMH);
}

/** HUD: przy lock natychmiast 0 — bez merge Dopplera. */
export function resolveTripHudKmh(
  engineKmh: number,
  dopplerKmh: number,
  opts?: { zeroVelocityLock?: boolean },
): number {
  if (opts?.zeroVelocityLock) return 0;
  const engine = normalizeKmh(engineKmh);
  const doppler = normalizeKmh(dopplerKmh);
  if (engine < 3 && doppler >= 8) return doppler;
  return Math.max(engine, doppler);
}

/** Clamp arcM do [0, segmentLength]; NaN → fallback. */
export function clampArcM(
  arcM: number,
  segmentLengthM: number,
  fallback = 0,
): number {
  if (!Number.isFinite(segmentLengthM) || segmentLengthM <= 0) {
    return Number.isFinite(arcM) ? Math.max(0, arcM) : fallback;
  }
  const m = Number.isFinite(arcM) ? arcM : fallback;
  return clampNum(m, 0, segmentLengthM);
}
