import { haversineKm, maxIdleBrowsingJumpM } from '../../scripts/navigationUtils';
import { isSaneLocation } from '../../scripts/kalmanFilter';
import { GPS_MAX_FIX_AGE_MS } from '../../constants/mapPerformance';

const GPS_WALLDT_IGNORE_SPEED_MS = 45_000;
const TRIP_RESUME_HOLD_JUMP_M = 12;
const TRIP_RESUME_MAX_JUMP_M = 50;

export function isNullIsland(lat: number, lng: number): boolean {
  return Math.abs(lat) < 1e-4 && Math.abs(lng) < 1e-4;
}

/** Zwraca true, gdy timestamp fixu wskazuje na przestarzały odczyt z cache OS. */

export function isStaleGpsTimestamp(nowMs: number, timestamp?: number | null): boolean {
  if (timestamp == null || !Number.isFinite(timestamp)) return false;
  let ts = timestamp;
  if (ts > 0 && ts < 1e12) ts *= 1000;
  const age = nowMs - ts;
  return age > GPS_MAX_FIX_AGE_MS || age < -15_000;
}

export function clampRawTowardAnchor(
  anchor: { lat: number; lng: number },
  rawLat: number,
  rawLng: number,
  maxStepM: number,
): { lat: number; lng: number; movedM: number } {
  const movedM = haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000;
  if (!Number.isFinite(movedM) || movedM <= maxStepM || movedM <= 0) {
    return { lat: rawLat, lng: rawLng, movedM };
  }
  const ratio = maxStepM / movedM;
  return {
    lat: anchor.lat + (rawLat - anchor.lat) * ratio,
    lng: anchor.lng + (rawLng - anchor.lng) * ratio,
    movedM,
  };
}

/** Te same progi co w `onLocation`, ale z rzeczywistym Δt (nie psuje go `GPS_RESUME_GRACE_PERIOD_MS`). */

export function isRawGpsPlausibleVsAnchor(
  rawLat: number,
  rawLng: number,
  anchor: { lat: number; lng: number },
  wallDtMs: number,
  reportedSpeedMs: number | null | undefined,
  isDriving: boolean,
  accuracyM?: number | null,
): boolean {
  const safeDt = Math.max(wallDtMs, 100);
  if (!isSaneLocation(rawLat, rawLng, anchor.lat, anchor.lng, 250, safeDt, isDriving)) return false;
  const distM2 = haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000;
  const reportMs =
    wallDtMs > GPS_WALLDT_IGNORE_SPEED_MS
      ? 0
      : (reportedSpeedMs != null && reportedSpeedMs >= 0 ? reportedSpeedMs : 0);
  const reportedKmh = reportMs * 3.6;
  const expectedM2 = (reportedKmh / 3.6) * (safeDt / 1000);
  if (isDriving) {
    const maxDistM2 = Math.max(300, expectedM2 * 3 + 100);
    return distM2 <= maxDistM2;
  }
  let maxDistM2 = Math.max(100, expectedM2 * 3 + 100);
  maxDistM2 = Math.min(maxDistM2, maxIdleBrowsingJumpM(safeDt, reportedKmh, accuracyM ?? 40));
  return distM2 <= maxDistM2;
}

/** Po powrocie z tła: pierwszy fix OS bywa cache (inny kontynent) — nie teleportuj markera. */

export function isTripResumeJumpAcceptable(
  jumpM: number,
  bgPauseMs: number,
): { ok: boolean; allowMegaTeleport: boolean } {
  if (!Number.isFinite(jumpM) || jumpM <= TRIP_RESUME_HOLD_JUMP_M) {
    return { ok: true, allowMegaTeleport: false };
  }
  if (jumpM > 50_000) return { ok: false, allowMegaTeleport: false };
  if (bgPauseMs < 45_000 && jumpM > 1_500) return { ok: false, allowMegaTeleport: false };
  if (bgPauseMs < 120_000 && jumpM > 8_000) return { ok: false, allowMegaTeleport: false };
  const allowMegaTeleport = bgPauseMs >= 30_000 && jumpM > 1_500;
  if (allowMegaTeleport) return { ok: true, allowMegaTeleport: true };
  return { ok: jumpM <= TRIP_RESUME_MAX_JUMP_M, allowMegaTeleport: false };
}

/** Maks. krok markera między tickami GPS — powyżej = teleport, nie commituj kotwicy. */

export function maxPlausibleDrivingStepM(speedMs: number, kmh: number): number {
  const ms = Math.max(speedMs > 0 ? speedMs : 0, kmh > 0.5 ? kmh / 3.6 : 0);
  if (ms < 0.5) return 40;
  return Math.max(40, Math.min(150, ms * 2.0 + 20));
}

/** Skok raw GPS względem ostatniej dobrej kotwicy (m). */

export function rawStepFromAnchorM(
  anchor: { lat: number; lng: number } | null | undefined,
  rawLat: number,
  rawLng: number,
): number {
  if (!anchor) return 0;
  return haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000;
}

/**
 * Pojedynczy zły fix (cache OS / Wi‑Fi) z żywym Dopplerem — nie wolno go karmić snap/worklet.
 */

export function isImplausibleGpsTeleport(
  anchor: { lat: number; lng: number },
  rawLat: number,
  rawLng: number,
  dtMs: number,
  speedMs: number,
  kmh: number,
  motionKmh: number,
  netMoveM: number,
  rawGpsKmh: number,
): boolean {
  const stepM = rawStepFromAnchorM(anchor, rawLat, rawLng);
  // Postój: pojedynczy skok GPS 6–20 m bez ruchu w oknie = teleport (nie czekaj na 22 m).
  if (
    netMoveM < 8
    && motionKmh < 6
    && kmh < 6
    && rawGpsKmh < 12
  ) {
    if (stepM > 10) return true;
    if (stepM > 5 && rawGpsKmh < 4) return true;
  }
  if (stepM < 22) return false;
  if (stepM > 120) return true;
  if (rawGpsKmh >= 35 && netMoveM < 22 && motionKmh < 14) return true;
  if (netMoveM < 25 && kmh < 4 && stepM > 32) return true;
  if (stepM > 55 && netMoveM < 18) return true;
  if (stepM > 85) return true;
  if (netMoveM < 15 && stepM > 28) return true;
  if (rawGpsKmh >= 50 && netMoveM < 10) return true;
  if (rawGpsKmh >= 90 && stepM > 35) return true;
  const maxStep = maxPlausibleDrivingStepM(speedMs, Math.max(kmh, motionKmh, rawGpsKmh));
  const dtSec = Math.max(0.35, Math.min(12, dtMs / 1000));
  const physicsCapM = Math.min(95, maxStep * dtSec * 1.35 + 18);
  const hardCapM = Math.min(110, Math.max(physicsCapM, maxStep * 1.35));
  if (stepM <= hardCapM) return false;
  if (netMoveM < 10 && stepM > 42) return true;
  if (rawGpsKmh >= 12 && motionKmh < 8 && stepM > 50) return true;
  if (kmh >= 10 && netMoveM < stepM * 0.2 && stepM > 55) return true;
  return false;
}
