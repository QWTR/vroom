import { haversineM } from './geoMath';

export type PhysicsGuardResult =
  | { accept: true }
  | { accept: false; reason: string; impliedSpeedKmh: number };

const DEFAULT_MAX_VEHICLE_KMH = 280;
const DRIVING_MAX_VEHICLE_KMH = 350;

/**
 * Rejects GPS fixes that imply impossible displacement between samples.
 */
export function checkGpsPhysics(
  prevLat: number,
  prevLng: number,
  nextLat: number,
  nextLng: number,
  dtMs: number,
  isDriving: boolean,
  maxSpeedKmh = DEFAULT_MAX_VEHICLE_KMH,
): PhysicsGuardResult {
  if (!Number.isFinite(prevLat) || !Number.isFinite(prevLng)) {
    return { accept: true };
  }
  const dtSec = Math.max(0.08, dtMs / 1000);
  const distM = haversineM(prevLat, prevLng, nextLat, nextLng);
  const impliedSpeedKmh = (distM / dtSec) * 3.6;
  const cap = isDriving ? Math.max(maxSpeedKmh, DRIVING_MAX_VEHICLE_KMH) : maxSpeedKmh;
  if (impliedSpeedKmh > cap) {
    return { accept: false, reason: 'impossible_speed', impliedSpeedKmh };
  }
  return { accept: true };
}

/**
 * Soft-clamp a candidate position toward previous when jump is large but not absurd.
 */
export function clampGpsStepM(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  maxStepM: number,
): { latitude: number; longitude: number } {
  const distM = haversineM(fromLat, fromLng, toLat, toLng);
  if (distM <= maxStepM || distM < 0.01) {
    return { latitude: toLat, longitude: toLng };
  }
  const t = maxStepM / distM;
  return {
    latitude: fromLat + (toLat - fromLat) * t,
    longitude: fromLng + (toLng - fromLng) * t,
  };
}

export function maxPlausibleStepM(speedKmh: number, dtMs: number, slack = 1.35): number {
  const dtSec = Math.max(0.12, dtMs / 1000);
  const vMs = Math.max(0, speedKmh) / 3.6;
  return Math.max(2.5, vMs * dtSec * slack + 4);
}
