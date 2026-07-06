import {
  bearingBetween,
  alignBearingToReference,
  haversineKm,
  projectOntoPolylineWithIndex,
} from '../../scripts/navigationUtils';
import { TRAVEL_VECTOR_LOCK_SPEED_KMH, normalizeHeading } from '../driveCore/travelHeading';
import { MAX_SPEED_HUD_KMH } from '../../scripts/speedSanitizer';

function normalizeHudSpeedKmh(value: unknown): number {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const raw = Math.max(0, value);
  return raw > MAX_SPEED_HUD_KMH ? MAX_SPEED_HUD_KMH : raw;
}
import { computeStandstillNetM } from '../../scripts/speedSanitizer';

/** Poniżej tej prędkości dopuszczalny kompas urządzenia (loc.coords.heading). */
export const TRIP_COMPASS_HEADING_MAX_KMH = TRAVEL_VECTOR_LOCK_SPEED_KMH;

export function smoothHeading(
  current:   number,
  target:    number,
  alpha:     number,
  maxChange: number,
): number {
  const diff     = ((target - current + 540) % 360) - 180;
  const clamped  = Math.sign(diff) * Math.min(Math.abs(diff), maxChange);
  const smoothed = current + clamped * alpha;
  return ((smoothed % 360) + 360) % 360;
}

/** Poniżej tej prędkości dopuszczalny kompas urządzenia (loc.coords.heading). */

export function resolveDrivingHeading(
  appliedSnap: { snapped: boolean; targetHeading: number; latitude: number; longitude: number },
  lastHeading: number,
  lastDrivingPos: { lat: number; lng: number } | null,
  gpsHeading: number | null | undefined,
  kmh: number,
  _isNavigating: boolean,
): number | null {
  const useCompass = kmh < TRIP_COMPASS_HEADING_MAX_KMH;
  const compassHdg = useCompass && gpsHeading != null && Number.isFinite(gpsHeading) && Number(gpsHeading) >= 0
    ? Number(gpsHeading)
    : null;

  let moveBearing: number | null = null;
  if (lastDrivingPos) {
    const distM = haversineKm(
      lastDrivingPos.lat, lastDrivingPos.lng,
      appliedSnap.latitude, appliedSnap.longitude,
    ) * 1000;
    if (distM >= 2.5) {
      moveBearing = bearingBetween(
        lastDrivingPos.lat, lastDrivingPos.lng,
        appliedSnap.latitude, appliedSnap.longitude,
      );
    }
  }

  const travelRef = moveBearing ?? lastHeading;

  if (kmh >= TRIP_COMPASS_HEADING_MAX_KMH) {
    if (moveBearing != null) {
      const flip = Math.abs(((moveBearing - lastHeading + 540) % 360) - 180);
      if (flip >= 92) return lastHeading;
      return smoothHeading(lastHeading, moveBearing, 0.88, 34);
    }
    return null;
  }

  if (moveBearing != null && kmh >= 7) {
    if (appliedSnap.snapped && Number.isFinite(appliedSnap.targetHeading)) {
      let roadHeading = alignBearingToReference(appliedSnap.targetHeading, moveBearing);
      const roadDiff = Math.abs(((roadHeading - moveBearing + 540) % 360) - 180);
      if (roadDiff <= 26) {
        roadHeading = smoothHeading(roadHeading, moveBearing, 0.5, 16);
        return smoothHeading(lastHeading, roadHeading, 0.42, 26);
      }
    }
    return smoothHeading(lastHeading, moveBearing, 0.5, 32);
  }

  if (appliedSnap.snapped && Number.isFinite(appliedSnap.targetHeading)) {
    let roadHeading = alignBearingToReference(appliedSnap.targetHeading, travelRef);
    if (moveBearing != null) {
      roadHeading = smoothHeading(roadHeading, moveBearing, 0.45, 18);
    }
    return smoothHeading(lastHeading, roadHeading, 0.48, 32);
  }

  if (moveBearing != null) {
    return smoothHeading(lastHeading, moveBearing, 0.48, 40);
  }

  if (compassHdg != null) {
    const gpsFlip = Math.abs(((compassHdg - lastHeading + 540) % 360) - 180);
    if (gpsFlip <= 110) {
      return smoothHeading(lastHeading, compassHdg, 0.38, 40);
    }
  }

  return null;
}

export function resolveUnifiedHeading(params: {
  snapHeading?: number | null;
  movementHeading?: number | null;
  gpsHeading?: number | null;
  previousHeading: number;
  speedKmh: number;
}): number {
  const prev = Number.isFinite(params.previousHeading) ? params.previousHeading : 0;
  const speedKmh = Number.isFinite(params.speedKmh) ? Math.max(0, params.speedKmh) : 0;
  const hasSnap = params.snapHeading != null && Number.isFinite(params.snapHeading);
  const hasMove = params.movementHeading != null && Number.isFinite(params.movementHeading);
  const useCompass = speedKmh < TRIP_COMPASS_HEADING_MAX_KMH;
  const hasGps = useCompass
    && params.gpsHeading != null
    && Number.isFinite(params.gpsHeading);

  const ref = hasMove
    ? Number(params.movementHeading)
    : hasSnap
      ? Number(params.snapHeading)
      : prev;
  const alignedSnap = hasSnap ? alignBearingToReference(Number(params.snapHeading), ref) : null;
  const alignedMove = hasMove ? alignBearingToReference(Number(params.movementHeading), ref) : null;
  const alignedGps = hasGps ? alignBearingToReference(Number(params.gpsHeading), ref) : null;

  let target = prev;

  if (speedKmh >= TRIP_COMPASS_HEADING_MAX_KMH) {
    if (alignedMove != null) {
      const flip = Math.abs(((alignedMove - prev + 540) % 360) - 180);
      if (flip < 92) {
        target = alignedMove;
      }
    } else if (alignedSnap != null) {
      const flip = Math.abs(((alignedSnap - prev + 540) % 360) - 180);
      if (flip < 92) {
        target = smoothHeading(prev, alignedSnap, 0.35, 18);
      }
    }
  } else {
    if (alignedMove != null) {
      target = smoothHeading(target, alignedMove, speedKmh >= 8 ? 0.55 : 0.45, 28);
    }
    if (alignedSnap != null) {
      const snapWeight = alignedMove != null && speedKmh >= 6
        ? (Math.abs(((alignedSnap - alignedMove + 540) % 360) - 180) > 22 ? 0.18 : 0.3)
        : (speedKmh >= 10 ? 0.4 : 0.32);
      target = smoothHeading(target, alignedSnap, snapWeight, 20);
    }
    if (alignedGps != null && speedKmh < 8) {
      target = smoothHeading(target, alignedGps, 0.28, 22);
    }
  }

  const maxTurn = speedKmh < 6 ? 12 : speedKmh < 20 ? 20 : speedKmh < 55 ? 30 : 38;
  const delta = ((target - prev + 540) % 360) - 180;
  const limited = prev + Math.sign(delta) * Math.min(Math.abs(delta), maxTurn);
  return ((limited % 360) + 360) % 360;
}

/** Przy ~8 km/h net w oknie 3 s ≈ 6–7 m; stary próg 12 m = fałszywy postój. */

export function tripStandstillNetM(speedKmh: number, motionKmh = 0): number {
  return computeStandstillNetM(motionKmh, speedKmh);
}

/** V10: zatrzymaj worklet / prędkość — postój lub ghost Doppler (np. 160 km/h bez ruchu). */

export function resolveTripBootstrapHeadingHint(
  lat: number,
  lng: number,
  hintHdg: number,
  opts: {
    gpsDeviceHdg: number | null;
    lastHeading: number;
    lastSetLoc: { lat: number; lng: number } | null;
    lastGoodLoc: { lat: number; lng: number } | null;
    speedKmh: number;
  },
): number {
  const normalizedHint = normalizeHeading(hintHdg);
  const gpsHdg = opts.gpsDeviceHdg != null && Number.isFinite(opts.gpsDeviceHdg)
    ? normalizeHeading(opts.gpsDeviceHdg)
    : null;
  const prevHdg = Number.isFinite(opts.lastHeading) && opts.lastHeading !== 0
    ? normalizeHeading(opts.lastHeading)
    : normalizedHint;

  const anchor = opts.lastSetLoc ?? opts.lastGoodLoc;
  let moveHdg: number | null = null;
  if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
    const movedM = haversineKm(anchor.lat, anchor.lng, lat, lng) * 1000;
    if (movedM >= 2) {
      moveHdg = bearingBetween(anchor.lat, anchor.lng, lat, lng);
    }
  }

  const refHdg = moveHdg ?? (opts.speedKmh < TRIP_COMPASS_HEADING_MAX_KMH ? gpsHdg : null) ?? prevHdg;
  const compassForResolve = opts.speedKmh < TRIP_COMPASS_HEADING_MAX_KMH ? gpsHdg : null;

  return resolveUnifiedHeading({
    snapHeading: null,
    movementHeading: moveHdg,
    gpsHeading: compassForResolve,
    previousHeading: refHdg,
    speedKmh: opts.speedKmh,
  });
}

/** Heading startu trip — look-ahead na polilinii (nie segment pod maską). */

export function resolveTripRoadHeading(
  lat: number,
  lng: number,
  pts: { latitude: number; longitude: number }[],
  maxRadiusM: number,
  fallbackHdg: number,
): number {
  if (pts.length < 2) return normalizeHeading(fallbackHdg);
  const proj = projectOntoPolylineWithIndex(lat, lng, pts, maxRadiusM);
  if (!proj) return normalizeHeading(fallbackHdg);

  const lookaheadM = 17;
  let remainM = lookaheadM;
  let curLat = proj.latitude;
  let curLng = proj.longitude;
  let segIdx = Math.max(0, Math.min(proj.segmentIndex, pts.length - 2));

  while (remainM > 0.5 && segIdx < pts.length - 1) {
    const segStart = segIdx === proj.segmentIndex
      ? { latitude: curLat, longitude: curLng }
      : pts[segIdx];
    const segEnd = pts[segIdx + 1];
    const segLenM = haversineKm(
      segStart.latitude,
      segStart.longitude,
      segEnd.latitude,
      segEnd.longitude,
    ) * 1000;
    if (segLenM >= remainM) {
      const t = remainM / segLenM;
      const aheadLat = segStart.latitude + (segEnd.latitude - segStart.latitude) * t;
      const aheadLng = segStart.longitude + (segEnd.longitude - segStart.longitude) * t;
      const hdg = bearingBetween(curLat, curLng, aheadLat, aheadLng);
      return normalizeHeading(alignBearingToReference(hdg, fallbackHdg));
    }
    remainM -= segLenM;
    curLat = segEnd.latitude;
    curLng = segEnd.longitude;
    segIdx += 1;
  }

  const segIdxFallback = Math.max(0, Math.min(proj.segmentIndex, pts.length - 2));
  const a = pts[segIdxFallback];
  const b = pts[segIdxFallback + 1];
  const segHdg = bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
  return normalizeHeading(alignBearingToReference(segHdg, fallbackHdg));
}

/** HUD: nawigacja i free-drive — Doppler gdy silnik=0 (Android / off-route). */

export function mergeTripHudKmh(engineKmh: number, dopplerKmh: number): number {
  const engine = normalizeHudSpeedKmh(engineKmh);
  const doppler = normalizeHudSpeedKmh(dopplerKmh);
  if (engine < 3 && doppler >= 8) return doppler;
  return Math.max(engine, doppler);
}
