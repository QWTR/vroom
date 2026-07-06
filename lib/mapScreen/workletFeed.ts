import { haversineKm } from '../../scripts/navigationUtils';

const FEED_SPEED_DECAY_MS = 1500;

export const tripAccelState = {
  bypassUntilMs: 0,
  lagStreak: { count: 0, lastM: 0 },
  prevFeedSpeedKmh: 0,
  launchResetAtMs: 0,
};

const SNAP_STALE_HARD_RESET_M = 80;

export type AccelBypassState = {
  active: boolean;
  until: number;
  reason: string;
};

export function computeDriveFeedSpeedMs(
  hudKmh: number,
  dopplerKmh: number,
  isFreeDrive: boolean,
  isMoving: boolean,
): number {
  if (isFreeDrive) {
    const motionKmh = Math.max(hudKmh, dopplerKmh);
    if (isMoving || motionKmh >= 3) {
      return Math.max(0.12, Math.min(52, motionKmh / 3.6));
    }
    return 0;
  }
  // Nawigacja: tylko przy potwierdzonym ruchu lub sensownej prędkości silnika (nie sam Doppler).
  if (isMoving || hudKmh >= 5) {
    return Math.max(0.12, Math.min(52, Math.max(hudKmh, isMoving ? dopplerKmh : 0) / 3.6));
  }
  return 0;
}

/** Czas zaniku prędkości integratora markera po zeroVelocityLock / microSleep (ms). */

export function decayedMarkerFeedSpeedMs(
  nowMs: number,
  lastSpeedMs: number,
  lastMovingAtMs: number,
): number {
  if (lastSpeedMs <= 0 || lastMovingAtMs <= 0) return 0;
  const elapsed = nowMs - lastMovingAtMs;
  if (elapsed >= FEED_SPEED_DECAY_MS) return 0;
  const t = elapsed / FEED_SPEED_DECAY_MS;
  return lastSpeedMs * (1 - t) * (1 - t);
}

export function snapStaleHardResetThresholdM(kmh: number, motionKmh = 0): number {
  const v = Math.max(kmh, motionKmh);
  if (v >= 90) return 38;
  if (v >= 70) return 48;
  if (v >= 50) return 58;
  if (v >= 30) return 68;
  return SNAP_STALE_HARD_RESET_M;
}

/** Limit kroku snap/jump w jazdzie — rośnie z prędkością, żeby nadrobić lag w 1 ticku GPS. */

export function drivingSnapDynamicStepCapM(
  kmh: number,
  jumpM?: number,
  opts?: { intervalSec?: number; accelBypass?: boolean },
): number {
  const intervalSec = Math.max(0.25, opts?.intervalSec ?? 0.5);
  const physicsStepM = (Math.max(0, kmh) / 3.6) * intervalSec;
  const dynamicStepCap = Math.max(35, physicsStepM);
  if (opts?.accelBypass) {
    return Math.max(dynamicStepCap, jumpM ?? 999, physicsStepM * 1.35);
  }
  if (jumpM != null && Number.isFinite(jumpM)) {
    return Math.max(dynamicStepCap, jumpM);
  }
  return dynamicStepCap;
}

/** Prędkość do feed/worklet — max z pipeline (nie tylko sanitized). */

export function tripFeedSpeedKmh(
  pipelineSpeedKmh: number,
  speedMs?: number,
  motionKmh?: number,
  sustainedKmh?: number,
  rawGpsKmh?: number,
): number {
  const fromMs = speedMs != null && Number.isFinite(speedMs) && speedMs > 0 ? speedMs * 3.6 : 0;
  const candidates = [
    fromMs,
    pipelineSpeedKmh,
    motionKmh ?? 0,
    sustainedKmh ?? 0,
    rawGpsKmh ?? 0,
  ];
  let best = 0;
  for (const v of candidates) {
    if (Number.isFinite(v) && v > best) best = v;
  }
  return best;
}

/** Czas animacji worklet — nigdy krócej niż kadencja GPS (brak „dziury” między tickami). */

export function workletFeedDurationMs(cadenceMs: number, _speedKmh: number, accelBypass = false): number {
  if (accelBypass) return 0;
  return Math.max(180, Math.min(1200, Math.max(cadenceMs, 1000)));
}

export function updateTripAccelBypass(opts: {
  rawGpsKmh: number;
  feedSpeedKmh: number;
  rawToSnapM: number;
  netMoveM: number;
  tripActive: boolean;
  markerFrozen?: boolean;
}): AccelBypassState | null {
  if (!opts.tripActive || opts.markerFrozen) {
    if (opts.markerFrozen) {
      tripAccelState.bypassUntilMs = 0;
      tripAccelState.lagStreak = { count: 0, lastM: 0 };
    }
    return null;
  }
  const now = Date.now();
  const streak = tripAccelState.lagStreak;
  if (opts.rawToSnapM >= 12) {
    streak.count += 1;
    streak.lastM = opts.rawToSnapM;
  } else {
    streak.count = 0;
    streak.lastM = opts.rawToSnapM;
  }
  const speedAccel =
    opts.rawGpsKmh >= 15
    && opts.rawGpsKmh < 85
    && opts.feedSpeedKmh < opts.rawGpsKmh - 10
    && opts.netMoveM >= 14;
  const lagAccel = streak.count >= 3 && streak.lastM > 8 && opts.netMoveM >= 12;
  if (speedAccel || lagAccel) {
    tripAccelState.bypassUntilMs = now + 4500;
    return {
      active: true,
      until: tripAccelState.bypassUntilMs,
      reason: speedAccel ? 'speed_delta' : 'raw_lag_streak',
    };
  }
  if (tripAccelState.bypassUntilMs > now) {
    return { active: true, until: tripAccelState.bypassUntilMs, reason: 'hold' };
  }
  return null;
}

/**
 * Skraca glide workletu gdy marker/snap laguje za raw GPS.
 * Zwraca ms (min 180) lub 0 gdy instant.
 */

export function workletGlideMsForLag(
  cadenceMs: number,
  opts: {
    forceInstant?: boolean;
    rawLat?: number;
    rawLng?: number;
    applyLat: number;
    applyLng: number;
    feedMoveM: number;
    kmh: number;
    markerAnchor?: { lat: number; lng: number } | null;
  },
): number {
  if (opts.forceInstant || cadenceMs <= 0) return 0;
  let glide = Math.max(cadenceMs, 1000);
  if (
    Number.isFinite(opts.rawLat)
    && Number.isFinite(opts.rawLng)
    && opts.kmh >= 6
  ) {
    const snapLagM = haversineKm(
      opts.applyLat,
      opts.applyLng,
      opts.rawLat as number,
      opts.rawLng as number,
    ) * 1000;
    const rawToMarkerM = opts.markerAnchor
      ? haversineKm(
        opts.markerAnchor.lat,
        opts.markerAnchor.lng,
        opts.rawLat as number,
        opts.rawLng as number,
      ) * 1000
      : snapLagM;
    const lagM = Math.max(snapLagM, rawToMarkerM);
    if (lagM >= 10 || opts.feedMoveM >= 14) {
      const factor = lagM >= 15 ? 1.12 : 1.06;
      glide = Math.max(glide, Math.round(cadenceMs * factor));
    }
  }
  return Math.max(Math.max(cadenceMs, 1000), Math.min(1200, glide));
}
/**
 * ANALIZA mph9uzxa: 337 DR_CRITICAL_REANCHOR w 3.5 min, driftFromSnapM mediana
 * 18 657 m to artefakt — `anchor (lastSetLocRef)` jest okresowo niesynchronizowany
 * z snappedPos po stałej akumulacji DR clamp + map-match catch-up. Realne dryfy
 * krytyczne są zawsze >300 m. Podbicie progu i streak'a likwiduje false-positives
 * bez utraty ratowania. Po tej zmianie spodziewamy się <80 wpisów na sesję 4-min.
 */
