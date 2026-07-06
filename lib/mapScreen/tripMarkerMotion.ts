import {
  densifyPolyline,
  haversineKm,
  stepTowardSnapOnPolyline,
} from '../../scripts/navigationUtils';
import { drivingSnapDynamicStepCapM } from './workletFeed';
import { projectOntoDrivingRoad, clampCoordStep } from './snapGeometry';
import { tripStandstillNetM } from './tripHeadingSnap';

const DRIVING_ENTRY_MAX_MARKER_JUMP_M = 18;

export function isWorkletStationaryHold(
  parkedLike: boolean,
  speedKmh: number,
  rawGpsKmh: number,
  motionKmh: number = 0,
  netMoveM: number = 0,
  accelBypassActive = false,
  isDriving = false,
  coordsFrozenDriving = false,
): boolean {
  if (accelBypassActive) return false;
  if (coordsFrozenDriving && (rawGpsKmh >= 6 || motionKmh >= 6)) return false;
  if (isDriving && (rawGpsKmh > 3 || motionKmh > 3)) return false;
  // Twardy bezpiecznik: natychmiastowy sygnal ruchu z GPS/motion ma pierwszenstwo
  // nad buforami "postoju", zeby nie zamykac pipeline przy ruszaniu.
  if (rawGpsKmh >= 8 || motionKmh >= 8) return false;
  if (parkedLike) return true;
  if (rawGpsKmh >= 15 && netMoveM >= 12) return false;
  // Highway: Doppler high + sanitized speed low used to freeze marker — require total data paralysis.
  if (rawGpsKmh >= 85) {
    if (netMoveM < 4 && motionKmh < 5 && speedKmh < 10) return true;
    return false;
  }
  if (rawGpsKmh >= 55 && speedKmh < 12 && motionKmh < 10 && netMoveM < 18) return true;
  if (rawGpsKmh >= 70 && netMoveM < 18 && motionKmh < 12) return true;
  if (rawGpsKmh >= 45 && netMoveM < 8 && motionKmh < 5 && speedKmh < 6) return true;
  // Ghost Doppler 8–80 km/h przy braku realnego ruchu — najczęstsza przyczyna dryfu na postoju.
  if (rawGpsKmh >= 8 && speedKmh < 6 && netMoveM < 16 && motionKmh < 14) return true;
  return speedKmh < 1.5 && rawGpsKmh < 25 && motionKmh < 4 && netMoveM < 10;
}

/** Postój / parking — nie ufaj Dopplerowi (ghost 20–80 km/h), nie karm workletu. */

export function isParkedLikeTripEvidence(opts: {
  netMoveM: number;
  sustainedKmh: number;
  motionKmh: number;
  pathMoveM?: number;
  rawGpsKmh?: number;
  /** lat/lng nie ruszają się, Doppler żywy — jazda z zamrożonym GPS, nie postój. */
  coordsFrozenDriving?: boolean;
  foregroundRefreshGrace?: boolean;
}): boolean {
  const rawGps = opts.rawGpsKmh ?? 0;
  if (opts.foregroundRefreshGrace && rawGps >= 6) return false;
  const standstillNetM = tripStandstillNetM(rawGps, opts.motionKmh);
  const pathM = opts.pathMoveM ?? 0;
  if (pathM >= 12 && (opts.motionKmh >= 2.5 || opts.netMoveM >= 3)) {
    return false;
  }
  if (
    opts.coordsFrozenDriving
    && rawGps >= 15
    && opts.netMoveM < 10
    && pathM < 22
  ) {
    return false;
  }
  if (
    opts.netMoveM < standstillNetM
    && opts.sustainedKmh < 4
    && opts.motionKmh < 5
    && pathM < 14
  ) {
    return true;
  }
  // Doppler na postoju (20–50 km/h) bez ruchu w oknie — nie karm chase/worklet.
  // Luźniej niż wcześniej: wolna jazda / korek z jitterem net nie = postój.
  if (
    rawGps >= 8
    && rawGps <= 55
    && opts.netMoveM < 5
    && opts.sustainedKmh < 3.5
    && opts.motionKmh < 5
    && pathM < 10
  ) {
    return true;
  }
  if (
    opts.netMoveM < 10
    && pathM < 12
    && opts.motionKmh > 35
    && opts.sustainedKmh < 8
  ) {
    return true;
  }
  // Pojedynczy skok GPS (motionKmh 40+) bez potwierdzenia w oknie 3 s.
  if (
    opts.netMoveM < 12
    && opts.sustainedKmh < 5
    && opts.motionKmh > 12
    && pathM < 22
    && rawGps < 18
  ) {
    return true;
  }
  // Skok GPS (motionKmh z sanity cap 200) bez realnego ruchu w oknie 5 s.
  // Highway: delayed batch often shows low netMoveM — require stronger paralysis before parked-like.
  if (
    opts.netMoveM < 8
    && opts.sustainedKmh < 5
    && opts.motionKmh >= 80
    && pathM < 12
  ) {
    return true;
  }
  if (rawGps >= 55 && opts.netMoveM < 20 && opts.motionKmh < 15) {
    return true;
  }
  if (rawGps >= 100 && opts.netMoveM < 25 && opts.motionKmh < 20) {
    return true;
  }
  return false;
}

/** Chase/arc/GAP tylko przy realnej jeździe — nie przy postoju ani teleporcie GPS. */

export function canV10ProgressMarker(opts: {
  parkedLike: boolean;
  speedMs: number;
  kmh: number;
  rawGpsKmh: number;
  rawStepM: number;
  rawToMarkerM: number;
}): boolean {
  if (opts.parkedLike) return false;
  if (!Number.isFinite(opts.rawStepM) || opts.rawStepM > 42) return false;
  if (opts.rawToMarkerM > 95) return false;
  return opts.rawGpsKmh >= 8 || opts.kmh >= 8 || opts.speedMs >= 2.4;
}

export function trustDopplerInTripEvidence(opts: {
  netMoveM: number;
  sustainedKmh: number;
  motionKmh: number;
  pathMoveM?: number;
  rawGpsKmh: number;
}): boolean {
  if (opts.rawGpsKmh < 6 || isParkedLikeTripEvidence(opts)) return false;
  // Zakręty / autostrada: ufaj Dopplerowi przy motionKmh >= 8 nawet przy niskim net.
  if (opts.rawGpsKmh >= 6 && opts.motionKmh >= 8) return true;
  if (opts.rawGpsKmh >= 50 && opts.netMoveM >= 4) return true;
  const geoKmh = Math.max(opts.motionKmh, opts.sustainedKmh);
  const delta = Math.abs(opts.rawGpsKmh - geoKmh);
  return opts.netMoveM >= 6 || delta < 25;
}

export function hasDrivingMotionEvidence(opts: {
  rawGpsKmh: number;
  motionKmh: number;
  netMoveM: number;
  sustainedKmh: number;
  pathMoveM?: number;
}): boolean {
  const pathM = opts.pathMoveM ?? 0;
  const dopplerWithGeometry =
    opts.rawGpsKmh >= 6
    && (opts.netMoveM >= 5 || opts.motionKmh >= 3.5 || opts.sustainedKmh >= 3 || pathM >= 7);
  return (
    dopplerWithGeometry
    || opts.motionKmh >= 5
    || opts.sustainedKmh >= 4
    || opts.netMoveM >= 6
    || pathM >= 8
  );
}

/**
 * Postój fizyczny — zamroź marker na drodze mimo ghost Dopplera (20–50 km/h bez ruchu).
 */

export function isTripMarkerFrozen(opts: {
  parkedLike: boolean;
  netMoveM: number;
  motionKmh: number;
  sustainedKmh: number;
  pathMoveM?: number;
  speedKmh: number;
  rawGpsKmh: number;
  rawStepM?: number;
  foregroundRefreshGrace?: boolean;
}): boolean {
  if (opts.foregroundRefreshGrace && (opts.rawGpsKmh >= 6 || opts.motionKmh >= 6)) {
    return false;
  }
  if (opts.parkedLike) return true;
  const pathM = opts.pathMoveM ?? 0;
  if (pathM >= 12 && (opts.motionKmh >= 2.5 || opts.netMoveM >= 3)) {
    return false;
  }
  const standstillNetM = tripStandstillNetM(opts.rawGpsKmh, opts.motionKmh);
  const rawStep = opts.rawStepM ?? 0;
  if (
    opts.netMoveM < standstillNetM
    && opts.motionKmh < 6
    && opts.sustainedKmh < 5
    && pathM < 14
    && opts.speedKmh < 8
    && rawStep < 2.5
  ) {
    return true;
  }
  if (
    opts.rawGpsKmh >= 10
    && opts.speedKmh < 6
    && opts.netMoveM < 12
    && opts.motionKmh < 6
    && rawStep < 2.5
  ) {
    return true;
  }
  return false;
}

export function freezeMarkerOnRoad(
  pin: { lat: number; lng: number },
  roadPts: { latitude: number; longitude: number }[],
): { lat: number; lng: number; snapped: boolean } {
  if (roadPts.length < 2) {
    return { lat: pin.lat, lng: pin.lng, snapped: false };
  }
  const onRoad = projectOntoDrivingRoad(pin.lat, pin.lng, pin.lat, pin.lng, roadPts, 48);
  if (onRoad) {
    return { lat: onRoad.latitude, lng: onRoad.longitude, snapped: true };
  }
  return { lat: pin.lat, lng: pin.lng, snapped: false };
}

export function computeSnapFailMaxStepM(kmh: number, rawDriftM: number): number {
  if (kmh >= 25) {
    const dynamic = drivingSnapDynamicStepCapM(kmh);
    return Math.min(dynamic, Math.max(12, rawDriftM * 0.55, kmh * 0.35));
  }
  if (kmh >= 8) {
    const dynamic = drivingSnapDynamicStepCapM(kmh);
    return Math.min(dynamic, Math.max(8, kmh * 0.22, rawDriftM * 0.4));
  }
  if (kmh < 6 && rawDriftM < 45) {
    return 0;
  }
  if (rawDriftM > 1.0) {
    return Math.max(2.0, Math.min(22, Math.max(kmh * 0.3, 2), rawDriftM * 0.35));
  }
  if (rawDriftM >= 0.5) {
    return Math.max(1.5, Math.min(8, kmh * 0.3, rawDriftM * 0.2));
  }
  return 0;
}

/** SNAP_FAIL: najpierw wzdłuż polilinii (5 s), dopiero potem krok do raw GPS. */

export function resolveV10SnapFailPosition(
  hold: { lat: number; lng: number },
  rawLat: number,
  rawLng: number,
  kmh: number,
  roadPts: { latitude: number; longitude: number }[],
  snapFailAgeMs: number,
  rawDriftM: number,
  motionKmhHint = 0,
): { latitude: number; longitude: number } {
  const effectiveKmh = Math.max(kmh, motionKmhHint);
  const stepM = effectiveKmh < 6 && rawDriftM < 45
    ? 0
    : Math.max(1.5, Math.min(16, effectiveKmh * 0.28, rawDriftM * 0.4));
  if (stepM > 0 && roadPts.length >= 2 && snapFailAgeMs < 5000) {
    return stepTowardSnapOnPolyline(
      hold.lat,
      hold.lng,
      rawLat,
      rawLng,
      roadPts,
      stepM,
      90,
    );
  }
  const maxStepM = computeSnapFailMaxStepM(effectiveKmh, rawDriftM);
  if (maxStepM > 0 && roadPts.length >= 2) {
    return stepTowardSnapOnPolyline(
      hold.lat,
      hold.lng,
      rawLat,
      rawLng,
      roadPts,
      maxStepM,
      85,
    );
  }
  if (maxStepM > 0) {
    return clampCoordStep(
      { latitude: hold.lat, longitude: hold.lng },
      { latitude: rawLat, longitude: rawLng },
      maxStepM,
    );
  }
  return { latitude: hold.lat, longitude: hold.lng };
}

/** Twardy rzut markera na polilinię drogi — nawet gdy drivingSnap zwrócił punkt „obok” łuku. */

export function advanceV10MarkerTowardRaw(
  markerLat: number,
  markerLng: number,
  snapLat: number,
  snapLng: number,
  rawLat: number,
  rawLng: number,
  roadPts: { latitude: number; longitude: number }[],
  speedMs: number,
  kmh: number,
): { latitude: number; longitude: number; chaseM: number; failReason?: string } {
  const rawFromMarkerM = haversineKm(markerLat, markerLng, rawLat, rawLng) * 1000;
  if (rawFromMarkerM < 6 || (speedMs < 0.35 && kmh < 5)) {
    return {
      latitude: snapLat,
      longitude: snapLng,
      chaseM: 0,
      failReason: rawFromMarkerM < 6 ? 'raw_too_close' : 'parked',
    };
  }
  const snapFromMarkerM = haversineKm(markerLat, markerLng, snapLat, snapLng) * 1000;
  const hasRoad = roadPts.length >= 2;
  let goalLat = snapLat;
  let goalLng = snapLng;
  if (hasRoad) {
    const rawOnRoad = projectOntoDrivingRoad(rawLat, rawLng, rawLat, rawLng, roadPts, 52);
    if (rawOnRoad) {
      goalLat = rawOnRoad.latitude;
      goalLng = rawOnRoad.longitude;
    }
  } else {
    const towardRaw = rawFromMarkerM > snapFromMarkerM + 6;
    goalLat = towardRaw ? rawLat : snapLat;
    goalLng = towardRaw ? rawLng : snapLng;
  }
  const distGoalM = haversineKm(markerLat, markerLng, goalLat, goalLng) * 1000;
  const effectiveKmh = Math.max(kmh, speedMs * 3.6);
  const maxCatchupStepM = ((effectiveKmh + 25) / 3.6) * 1.05;
  const stepM = Math.min(
    distGoalM,
    Math.max(4, Math.min(kmh >= 55 ? 52 : kmh >= 30 ? 36 : 28, speedMs * 1.8 + 8)),
    rawFromMarkerM * 0.72,
    maxCatchupStepM,
  );
  if (stepM < 2) {
    return { latitude: snapLat, longitude: snapLng, chaseM: 0, failReason: 'step_too_small' };
  }
  const densePts = roadPts.length >= 2 && roadPts.length <= 8
    ? densifyPolyline(roadPts, 8)
    : roadPts;
  let next = densePts.length >= 2
    ? stepTowardSnapOnPolyline(markerLat, markerLng, goalLat, goalLng, densePts, stepM, 92)
    : clampCoordStep(
      { latitude: markerLat, longitude: markerLng },
      { latitude: goalLat, longitude: goalLng },
      stepM,
    );
  let movedM = haversineKm(markerLat, markerLng, next.latitude, next.longitude) * 1000;
  if (movedM < 2.5 && !hasRoad) {
    const rawStepM = Math.max(4, Math.min(stepM, rawFromMarkerM * 0.45, 8));
    next = clampCoordStep(
      { latitude: markerLat, longitude: markerLng },
      { latitude: goalLat, longitude: goalLng },
      rawStepM,
    );
    movedM = haversineKm(markerLat, markerLng, next.latitude, next.longitude) * 1000;
  }
  if (movedM < 1) {
    return { latitude: snapLat, longitude: snapLng, chaseM: 0, failReason: 'polyline_step_failed' };
  }
  return { latitude: next.latitude, longitude: next.longitude, chaseM: movedM };
}

export function isDriveMarkerBootstrapped(marker: { lat: { value: number }; lng: { value: number } }): boolean {
  return Number.isFinite(marker.lat.value) && Number.isFinite(marker.lng.value);
}


/** Lookahead kamery (m) — lustrzane z useCameraAnimation.lookaheadFromSpeed. */

export function tripLookaheadFromSpeedM(speedKmh: number, isNavigating: boolean): number {
  const s = Math.max(0, speedKmh);
  let m = 0;
  if (s < 18) m = 0;
  else if (s <= 40) m = ((s - 18) / 22) * 10;
  else if (s <= 80) m = 10 + ((s - 40) / 40) * 8;
  else m = 18 + Math.min(1, (s - 80) / 50) * 6;
  if (isNavigating && s >= 18) {
    m = m * 1.06 + 3;
  }
  return m;
}

export function round1(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(1)) : n;
}

export function round6(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(6)) : n;
}

/**
 * Początkowy heading trip — ta sama hierarchia co GPS tick i przycisk „Centruj”
 * (ruch → kompas → poprzedni kurs), zanim polyline wybierze stronę segmentu.
 */

export function clampDrivingEntryMarkerPose(
  _rawLat: number,
  _rawLng: number,
  snappedLat: number,
  snappedLng: number,
  graceUntilMs: number,
  entryAnchor: { lat: number; lng: number } | null,
): { lat: number; lng: number } {
  if (!entryAnchor || Date.now() >= graceUntilMs) {
    return { lat: snappedLat, lng: snappedLng };
  }
  const jumpFromEntryM = haversineKm(
    entryAnchor.lat,
    entryAnchor.lng,
    snappedLat,
    snappedLng,
  ) * 1000;
  if (jumpFromEntryM > DRIVING_ENTRY_MAX_MARKER_JUMP_M) {
    return { lat: entryAnchor.lat, lng: entryAnchor.lng };
  }
  return { lat: snappedLat, lng: snappedLng };
}

/** Tangenta polilinii w punkcie (do forward/backward guard na zakrętach). */

export function isStepBackwardAlongHeading(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  headingDeg: number,
  minDistM = 1.2,
): boolean {
  if (!Number.isFinite(headingDeg)) return false;
  const distM = haversineKm(fromLat, fromLng, toLat, toLng) * 1000;
  if (distM < minDistM) return false;
  const stepBearing = bearingBetween(fromLat, fromLng, toLat, toLng);
  return angleDeltaDegSimple(stepBearing, headingDeg) > 108;
}

/** Po wejściu w jazdę: blokuj tylko duży skok snapu od kotwicy wejścia (nie raw↔snap). */

export function enforceForwardOnlyPosition(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  headingDeg: number,
): { latitude: number; longitude: number; held: boolean } {
  if (!isStepBackwardAlongHeading(fromLat, fromLng, toLat, toLng, headingDeg)) {
    return { latitude: toLat, longitude: toLng, held: false };
  }
  return { latitude: fromLat, longitude: fromLng, held: true };
}

/** Feed w tył względem wyświetlanego markera — główna przyczyna „mrugnięcia” na drodze. */

export function shouldBlockBackwardDisplayFeed(
  display: { lat: number; lng: number; at: number },
  feedLat: number,
  feedLng: number,
  headingDeg: number,
  speedKmh: number,
  maxDistM = 55,
  roadPts?: { latitude: number; longitude: number }[],
  turnMode = false,
): boolean {
  if (turnMode) return false;
  if (display.at <= 0 || speedKmh < 4) return false;
  const distM = haversineKm(display.lat, display.lng, feedLat, feedLng) * 1000;
  if (distM < 2.5 || distM > maxDistM) return false;
  const refHdg = roadPts && roadPts.length >= 2
    ? (bearingAlongRoadAt(display.lat, display.lng, roadPts) ?? headingDeg)
    : headingDeg;
  return isStepBackwardAlongHeading(display.lat, display.lng, feedLat, feedLng, refHdg, 2.5);
}

/** Snap/chase potrafi odsunąć marker od raw — ciągnij z powrotem do GPS, nie teleportuj dalej. */
