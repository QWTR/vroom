import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelAnimation,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { NAV_V3 } from '../lib/navigationV3/config';
import type { ArcWindowSlice, NavigationTarget, PathMode } from '../lib/navigationV3/types';
import { TRIP_MOTION } from '../lib/navigationV3/motionContract';
import { shouldHoldTransientOffRoadPose } from '../lib/navigationV3/roadPoseRetention';

const MIN_CRUISE_MS = NAV_V3.MARKER_MIN_CRUISE_MS;
const ON_ROAD_BLEND_EPS = NAV_V3.ON_ROAD_BLEND_EPS;
const POLYLINE_KEY_HARD_SNAP_M = TRIP_MOTION.hardSnapDistanceM;
const ON_ROAD_FULL_BLEND = NAV_V3.MARKER_ON_ROAD_FULL_BLEND;
const BOOTSTRAP_HEADING_LOOKAHEAD_M = 3;
const MARKER_ROAD_HEADING_HALF_LIFE_MS = 80;
const MARKER_ROAD_HEADING_MAX_DPS = 720;

export type DriveMarkerV3Values = {
  lat: SharedValue<number>;
  lng: SharedValue<number>;
  /** Heading consumed by the existing camera follow pipeline. */
  heading: SharedValue<number>;
  /** Road tangent consumed only by the rendered 2D marker. */
  markerRoadHeading: SharedValue<number>;
  targetLat: SharedValue<number>;
  targetLng: SharedValue<number>;
  targetHdg: SharedValue<number>;
  segmentDurationMs: SharedValue<number>;
  speedMs: SharedValue<number>;
  /** Zwiększany dokładnie raz po przygotowaniu kompletnego targetu GPS. */
};

export type DriveMarkerSeedPose = {
  lat: number;
  lng: number;
  headingDeg?: number;
};

export type UseDriveMarkerV3Return = DriveMarkerV3Values & {
  /** React-side — true gdy worklet ma pierwszą poprawną pozycję (unika migania markera przy wejściu w trip). */
  isBootstrapped: boolean;
  pushTarget: (target: NavigationTarget) => void;
  reset: (anchor?: { lat: number; lng: number; headingDeg?: number }) => void;
  resetTo: (lat: number, lng: number, headingDeg: number) => void;
  ensureFrameActive: () => void;
  /** Po foreground — twardy snap do ostatniego targetu (bez nadganiania dt). */
  resumeFromBackground: () => void;
};

/** Natychmiastowy target wizualny — bez czekania na akcept filtra GPS. */
export function coldStartNavigationTarget(
  lat: number,
  lng: number,
  headingDeg = 0,
): NavigationTarget {
  const hdg = safeHeadingJs(headingDeg, 0);
  return {
    lat,
    lng,
    headingDeg: hdg,
    speedMs: 0,
    pathMode: 'offRoad',
    roadBlend: 0,
    rawLat: lat,
    rawLng: lng,
    targetArcM: null,
    arcWindow: null,
    polylineKey: null,
    allowInstant: true,
  };
}

function normalizeHeadingJs(h: number): number {
  return ((h % 360) + 360) % 360;
}

/** Kuloodporny kąt 0–360 — nigdy NaN (GeoJSON / worklet). */
function safeHeadingJs(h: unknown, fallback = 0): number {
  if (typeof h === 'number' && Number.isFinite(h)) {
    return normalizeHeadingJs(h);
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return normalizeHeadingJs(fallback);
  }
  return 0;
}

function safeCoordJs(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function packArcWindowFeed(
  window: ArcWindowSlice | null | undefined,
  polylineKey: string,
): {
  ptsFlat: number[];
  cumM: number[];
  baseArcM: number;
  polylineKey: string;
} | null {
  if (!window || window.points.length < 2 || window.cumM.length < 2) return null;
  const ptsFlat: number[] = [];
  for (let i = 0; i < window.points.length; i += 1) {
    const p = window.points[i];
    if (!p) continue;
    ptsFlat.push(p.lat, p.lng);
  }
  if (ptsFlat.length < 4) return null;
  return {
    ptsFlat,
    cumM: window.cumM.slice(),
    baseArcM: window.baseArcM,
    polylineKey,
  };
}

function haversineMJs(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - s1 - s2));
}

function bearingBetweenJs(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function projectCoordinateJs(
  latitude: number,
  longitude: number,
  headingDeg: number,
  distanceM: number,
): { lat: number; lng: number } {
  if (distanceM <= 0) return { lat: latitude, lng: longitude };
  const radiusM = 6_371_000;
  const angular = distanceM / radiusM;
  const bearing = headingDeg * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180;
  const lng1 = longitude * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular)
      + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
}

function pointAtWindowArcLocalJs(
  ptsFlat: number[],
  cumM: number[],
  localM: number,
): { lat: number; lng: number; heading: number } {
  const n = cumM.length;
  if (n < 2 || ptsFlat.length < 4) {
    return { lat: NaN, lng: NaN, heading: 0 };
  }
  const total = cumM[n - 1];
  const clamped = Math.max(0, Math.min(total, localM));
  let seg = 0;
  for (let i = 0; i < n - 1; i += 1) {
    if (clamped <= cumM[i + 1]) {
      seg = i;
      break;
    }
    seg = i;
  }
  const segLen = Math.max(0.001, cumM[seg + 1] - cumM[seg]);
  const t = (clamped - cumM[seg]) / segLen;
  const aLat = ptsFlat[seg * 2];
  const aLng = ptsFlat[seg * 2 + 1];
  const bLat = ptsFlat[(seg + 1) * 2];
  const bLng = ptsFlat[(seg + 1) * 2 + 1];
  const lat = aLat + (bLat - aLat) * t;
  const lng = aLng + (bLng - aLng) * t;
  const hdg = bearingBetweenJs(aLat, aLng, bLat, bLng);
  return { lat, lng, heading: hdg };
}

function lookAheadHeadingJs(
  ptsFlat: number[],
  cumM: number[],
  localM: number,
  direction: number,
  fallbackHdg: number,
): number {
  const total = cumM.length > 0 ? cumM[cumM.length - 1] : 0;
  const dir = direction < 0 ? -1 : 1;
  const behindLocalM = Math.max(0, Math.min(total, localM - dir * BOOTSTRAP_HEADING_LOOKAHEAD_M));
  const aheadLocalM = Math.max(0, Math.min(total, localM + dir * BOOTSTRAP_HEADING_LOOKAHEAD_M));
  const behind = pointAtWindowArcLocalJs(ptsFlat, cumM, behindLocalM);
  const ahead = pointAtWindowArcLocalJs(ptsFlat, cumM, aheadLocalM);
  if (![behind.lat, behind.lng, ahead.lat, ahead.lng].every(Number.isFinite)) {
    return safeHeadingJs(fallbackHdg, 0);
  }
  if (haversineMJs(behind.lat, behind.lng, ahead.lat, ahead.lng) < 0.5) {
    return safeHeadingJs(fallbackHdg, 0);
  }
  return safeHeadingJs(bearingBetweenJs(behind.lat, behind.lng, ahead.lat, ahead.lng), fallbackHdg);
}

function travelDirectionForArcJs(
  ptsFlat: number[],
  cumM: number[],
  baseArcM: number,
  arcM: number,
  targetHeading: number,
): number {
  const pose = pointAtWindowArcLocalJs(ptsFlat, cumM, arcM - baseArcM);
  const delta = Math.abs(((pose.heading - targetHeading + 540) % 360) - 180);
  return delta > 90 ? -1 : 1;
}

function blendPositionJs(
  roadLat: number,
  roadLng: number,
  rawLat: number,
  rawLng: number,
  roadBlend: number,
): { lat: number; lng: number } {
  const blend = Math.max(0, Math.min(1, roadBlend));
  if (blend > 0.001) return { lat: roadLat, lng: roadLng };
  if (blend <= 0.001) return { lat: rawLat, lng: rawLng };
  const inv = 1 - blend;
  return {
    lat: roadLat * blend + rawLat * inv,
    lng: roadLng * blend + rawLng * inv,
  };
}

function normalizeHeadingW(h: number): number {
  'worklet';
  return ((h % 360) + 360) % 360;
}

function headingDeltaW(from: number, to: number): number {
  'worklet';
  return ((to - from + 540) % 360) - 180;
}

function safeHeadingWorklet(h: unknown, fallback: number): number {
  'worklet';
  if (typeof h === 'number' && Number.isFinite(h)) {
    return normalizeHeadingW(h);
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return normalizeHeadingW(fallback);
  }
  return 0;
}

function clampWorklet(n: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, n));
}

function haversineMWorklet(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  'worklet';
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - s1 - s2));
}

function bearingBetweenWorklet(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  'worklet';
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function pointAtWindowArcLocal(
  ptsFlat: number[],
  cumM: number[],
  localM: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  const n = cumM.length;
  if (n < 2 || ptsFlat.length < 4) {
    return { lat: NaN, lng: NaN, heading: 0 };
  }
  const total = cumM[n - 1];
  const clamped = Math.max(0, Math.min(total, localM));
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (cumM[mid + 1] <= clamped) lo = mid;
    else hi = mid - 1;
  }
  const seg = lo;
  const segLen = Math.max(0.001, cumM[seg + 1] - cumM[seg]);
  const t = (clamped - cumM[seg]) / segLen;
  const aLat = ptsFlat[seg * 2];
  const aLng = ptsFlat[seg * 2 + 1];
  const bLat = ptsFlat[(seg + 1) * 2];
  const bLng = ptsFlat[(seg + 1) * 2 + 1];
  const lat = aLat + (bLat - aLat) * t;
  const lng = aLng + (bLng - aLng) * t;
  const heading = bearingBetweenWorklet(aLat, aLng, bLat, bLng);
  return { lat, lng, heading };
}

function tangentHeadingFromDisplayWorklet(
  ptsFlat: number[],
  cum: number[],
  localM: number,
  speedMs: number,
  travelDirection: number,
  fallbackHdg: number,
): number {
  'worklet';
  const total = cum.length > 0 ? cum[cum.length - 1] : 0;
  const windowM = clampWorklet(speedMs * 0.18, 3.5, 6);
  const direction = travelDirection < 0 ? -1 : 1;
  const behind = pointAtWindowArcLocal(
    ptsFlat,
    cum,
    clampWorklet(localM - direction * windowM, 0, total),
  );
  const ahead = pointAtWindowArcLocal(
    ptsFlat,
    cum,
    clampWorklet(localM + direction * windowM, 0, total),
  );
  if (![behind.lat, behind.lng, ahead.lat, ahead.lng].every(Number.isFinite)) {
    return safeHeadingWorklet(fallbackHdg, 0);
  }
  if (haversineMWorklet(behind.lat, behind.lng, ahead.lat, ahead.lng) < 0.5) {
    return safeHeadingWorklet(fallbackHdg, 0);
  }
  return bearingBetweenWorklet(behind.lat, behind.lng, ahead.lat, ahead.lng);
}

function stepHeadingSmoothWorklet(
  cur: number,
  target: number,
  dtSec: number,
  halfLifeMs: number,
  maxDps: number,
): number {
  'worklet';
  const delta = headingDeltaW(cur, target);
  if (Math.abs(delta) <= TRIP_MOTION.headingNoiseFloorDeg) {
    return normalizeHeadingW(cur);
  }
  const halfLifeSec = Math.max(0.001, halfLifeMs / 1000);
  const alpha = 1 - Math.pow(0.5, dtSec / halfLifeSec);
  const tauStep = delta * alpha;
  const maxStep = maxDps * dtSec;
  let step = tauStep;
  if (Math.abs(step) > maxStep) {
    step = Math.sign(step) * maxStep;
  }
  return normalizeHeadingW(cur + step);
}

function projectCoordinateWorklet(
  latitude: number,
  longitude: number,
  headingDeg: number,
  distanceM: number,
): { lat: number; lng: number } {
  'worklet';
  if (distanceM <= 0) return { lat: latitude, lng: longitude };
  const radiusM = 6_371_000;
  const angular = distanceM / radiusM;
  const bearing = headingDeg * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180;
  const lng1 = longitude * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular)
      + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
}

/** Kept local to this module so Reanimated serializes the full UI-thread path. */
function predictMotionAtAgeWorklet(
  sampleSpeedMs: number,
  accelerationMs2: number,
  sourceAgeMs: number,
  predictionHorizonMs: number,
  maxDistanceM: number,
): { distanceM: number; speedMs: number } {
  'worklet';
  const speed0 = Math.max(0, sampleSpeedMs);
  const acceleration = clampWorklet(
    accelerationMs2,
    TRIP_MOTION.accelerationMinMs2,
    TRIP_MOTION.accelerationMaxMs2,
  );
  const horizonSec = Math.max(0, predictionHorizonMs) / 1000;
  const requestedAgeSec = Math.max(0, sourceAgeMs) / 1000;
  const activeSec = Math.min(requestedAgeSec, horizonSec);
  const stopSec = acceleration < 0 ? speed0 / -acceleration : Number.POSITIVE_INFINITY;
  const integratedSec = Math.min(activeSec, stopSec);
  const activeDistance = Math.max(
    0,
    speed0 * integratedSec + 0.5 * acceleration * integratedSec * integratedSec,
  );
  const horizonSpeed = Math.max(0, speed0 + acceleration * integratedSec);
  const fadeSec = TRIP_MOTION.predictionFadeMs / 1000;
  const fadeElapsedSec = Math.min(fadeSec, Math.max(0, requestedAgeSec - horizonSec));
  const fadeRatio = fadeSec > 0 ? fadeElapsedSec / fadeSec : 1;
  const fadeDistance = horizonSpeed * fadeElapsedSec * (1 - 0.5 * fadeRatio);
  return {
    distanceM: Math.min(maxDistanceM, activeDistance + fadeDistance),
    speedMs: requestedAgeSec <= horizonSec
      ? horizonSpeed
      : horizonSpeed * Math.max(0, 1 - fadeRatio),
  };
}

function pathModeOnRoad(mode: PathMode): boolean {
  return mode === 'onRoad';
}

function projectPointToWindowArcJs(
  lat: number,
  lng: number,
  ptsFlat: number[],
  cumM: number[],
  baseArcM: number,
): { arcM: number; distanceM: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || ptsFlat.length < 4 || cumM.length < 2) return null;
  const latScale = Math.max(0.15, Math.cos(lat * Math.PI / 180));
  let best: { arcM: number; distanceM: number } | null = null;
  for (let index = 0; index < cumM.length - 1; index += 1) {
    const aLat = ptsFlat[index * 2];
    const aLng = ptsFlat[index * 2 + 1];
    const bLat = ptsFlat[index * 2 + 2];
    const bLng = ptsFlat[index * 2 + 3];
    if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) continue;
    const ax = aLng * latScale;
    const ay = aLat;
    const bx = bLng * latScale;
    const by = bLat;
    const px = lng * latScale;
    const py = lat;
    const vx = bx - ax;
    const vy = by - ay;
    const lengthSq = vx * vx + vy * vy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq)) : 0;
    const projectedLat = aLat + (bLat - aLat) * t;
    const projectedLng = aLng + (bLng - aLng) * t;
    const distanceM = haversineMJs(lat, lng, projectedLat, projectedLng);
    if (!best || distanceM < best.distanceM) {
      best = { arcM: baseArcM + cumM[index] + (cumM[index + 1] - cumM[index]) * t, distanceM };
    }
  }
  return best;
}

/**
 * One UI-thread motion engine for Android and iOS. GPS fixes only update the
 * measured state; every rendered pose is predicted and corrected per frame.
 */
export function useDriveMarkerV3(
  enabled = true,
  getSeedPose?: () => DriveMarkerSeedPose | null,
): UseDriveMarkerV3Return {
  const getSeedPoseRef = useRef(getSeedPose);
  getSeedPoseRef.current = getSeedPose;
  const bootstrappedJsRef = useRef(false);
  const lastTargetJsRef = useRef<NavigationTarget | null>(null);
  const lastOnRoadTargetAtJsRef = useRef(0);
  const [isBootstrapped, setIsBootstrapped] = useState(false);

  const lat = useSharedValue(NaN);
  const lng = useSharedValue(NaN);
  const heading = useSharedValue(0);
  const markerRoadHeading = useSharedValue(0);
  const enabledSv = useSharedValue(enabled ? 1 : 0);
  const bootstrapped = useSharedValue(0);

  const displayArcM = useSharedValue(0);
  const targetArcM = useSharedValue(0);
  const baseArcM = useSharedValue(0);
  const roadPtsFlat = useSharedValue<number[]>([]);
  const roadCumM = useSharedValue<number[]>([]);
  const polylineKeySv = useSharedValue('');
  const onRoadSv = useSharedValue(0);
  const roadBlendSv = useSharedValue(0);
  /** Rendered velocity consumed by camera/HUD. */
  const speedMs = useSharedValue(0);
  const sampleSpeedMs = useSharedValue(0);
  const accelerationMs2 = useSharedValue(0);
  const predictionHorizonMs = useSharedValue<number>(TRIP_MOTION.minimumFuturePredictionMs);
  const travelDirectionSv = useSharedValue(1);
  const segmentDurationMs = useSharedValue<number>(TRIP_MOTION.segmentDurationDefaultMs);
  const segmentStartedAtMs = useSharedValue(0);
  const segmentStartLat = useSharedValue(NaN);
  const segmentStartLng = useSharedValue(NaN);
  const segmentStartArcM = useSharedValue(0);
  /** Wall-clock times stay on the UI thread and compensate delivery latency. */
  const lastTargetAtMs = useSharedValue(0);
  const sourceTimestampMs = useSharedValue(0);
  const cadenceEwmaMs = useSharedValue(500);
  const jitterEwmaMs = useSharedValue(0);

  const targetLat = useSharedValue(NaN);
  const targetLng = useSharedValue(NaN);
  const targetHdg = useSharedValue(0);
  const rawTargetLat = useSharedValue(NaN);
  const rawTargetLng = useSharedValue(NaN);

  const applyInstantPose = useCallback((
    poseLat: number,
    poseLng: number,
    poseHdg: number,
    arcM: number,
    onRoad: boolean,
    blend: number,
    rawLat: number,
    rawLng: number,
  ) => {
    cancelAnimation(displayArcM);
    cancelAnimation(lat);
    cancelAnimation(lng);
    cancelAnimation(heading);
    const prevHdg = Number.isFinite(heading.value) ? heading.value : 0;
    const safeLat = safeCoordJs(poseLat, safeCoordJs(lat.value, rawLat));
    const safeLng = safeCoordJs(poseLng, safeCoordJs(lng.value, rawLng));
    const safeHdg = safeHeadingJs(poseHdg, prevHdg);
    lat.value = safeLat;
    lng.value = safeLng;
    heading.value = safeHdg;
    markerRoadHeading.value = safeHdg;
    displayArcM.value = Number.isFinite(arcM) ? arcM : 0;
    targetArcM.value = Number.isFinite(arcM) ? arcM : 0;
    targetLat.value = safeLat;
    targetLng.value = safeLng;
    targetHdg.value = safeHdg;
    rawTargetLat.value = safeCoordJs(rawLat, safeLat);
    rawTargetLng.value = safeCoordJs(rawLng, safeLng);
    onRoadSv.value = onRoad ? 1 : 0;
    roadBlendSv.value = blend;
    segmentStartedAtMs.value = Date.now();
    segmentStartLat.value = safeLat;
    segmentStartLng.value = safeLng;
    segmentStartArcM.value = Number.isFinite(arcM) ? arcM : 0;
    bootstrapped.value = 1;
    bootstrappedJsRef.current = true;
    setIsBootstrapped(true);
  }, [
    bootstrapped,
    displayArcM,
    heading,
    lat,
    lng,
    markerRoadHeading,
    onRoadSv,
    rawTargetLat,
    rawTargetLng,
    roadBlendSv,
    segmentStartedAtMs,
    segmentStartLat,
    segmentStartLng,
    segmentStartArcM,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
  ]);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    if (enabledSv.value < 0.5 || bootstrapped.value < 0.5) return;

    const blend = clampWorklet(roadBlendSv.value, 0, 1);
    const onRoad = onRoadSv.value >= 0.5 && blend > ON_ROAD_BLEND_EPS;
    const dtSec = clampWorklet((frame.timeSincePreviousFrame ?? 16.67) / 1000, 0.008, 0.05);
    const nowMs = Date.now();
    const segmentElapsedMs = segmentStartedAtMs.value > 0
      ? Math.max(0, nowMs - segmentStartedAtMs.value)
      : segmentDurationMs.value;
    const segmentProgress = clampWorklet(
      segmentElapsedMs / Math.max(TRIP_MOTION.segmentDurationMinMs, segmentDurationMs.value),
      0,
      1,
    );
    const targetAgeMs = lastTargetAtMs.value > 0
      ? Math.max(0, nowMs - lastTargetAtMs.value)
      : Number.POSITIVE_INFINITY;
    const sourceAgeMs = sourceTimestampMs.value > 0
      ? Math.max(0, nowMs - sourceTimestampMs.value)
      : targetAgeMs;
    const deliveryAgeMs = sourceTimestampMs.value > 0 && lastTargetAtMs.value > 0
      ? Math.max(0, lastTargetAtMs.value - sourceTimestampMs.value)
      : 0;
    const predictionAgeMs = deliveryAgeMs + Math.max(
      0,
      targetAgeMs - segmentDurationMs.value,
    );
    // A stale sample freezes at the last predicted pose. It must never reset the
    // desired pose back to the historical GPS coordinate, which would make the
    // vehicle visibly travel backwards after signal loss.
    const boundedPredictionAgeMs = Math.min(
      predictionAgeMs,
      predictionHorizonMs.value + TRIP_MOTION.predictionFadeMs,
    );
    const predictedMotion = predictMotionAtAgeWorklet(
      sampleSpeedMs.value,
      accelerationMs2.value,
      boundedPredictionAgeMs,
      predictionHorizonMs.value,
      onRoad ? TRIP_MOTION.roadPredictionMaxM : TRIP_MOTION.freePredictionMaxM,
    );
    const motion = sourceAgeMs >= TRIP_MOTION.staleSampleMs
      ? { distanceM: predictedMotion.distanceM, speedMs: 0 }
      : predictedMotion;
    speedMs.value = motion.speedMs;

    if (onRoad && roadPtsFlat.value.length >= 4 && Number.isFinite(displayArcM.value)) {
      const arcStartM = baseArcM.value;
      const arcEndM = baseArcM.value + (roadCumM.value[roadCumM.value.length - 1] ?? 0);
      const direction = travelDirectionSv.value < 0 ? -1 : 1;
      const segmentBaseArcM = segmentStartArcM.value
        + (targetArcM.value - segmentStartArcM.value) * segmentProgress;
      displayArcM.value = clampWorklet(
        segmentBaseArcM + direction * motion.distanceM,
        arcStartM,
        arcEndM,
      );

      const localM = displayArcM.value - baseArcM.value;
      const roadPose = pointAtWindowArcLocal(roadPtsFlat.value, roadCumM.value, localM);
      if (Number.isFinite(roadPose.lat) && Number.isFinite(roadPose.lng)) {
        lat.value = roadPose.lat;
        lng.value = roadPose.lng;
        if (motion.speedMs >= TRIP_MOTION.stoppedSpeedMs) {
          const refHdg = Number.isFinite(heading.value) ? heading.value : targetHdg.value;
          const tangentHdg = tangentHeadingFromDisplayWorklet(
            roadPtsFlat.value,
            roadCumM.value,
            localM,
            motion.speedMs,
            direction,
            refHdg,
          );
          markerRoadHeading.value = stepHeadingSmoothWorklet(
            Number.isFinite(markerRoadHeading.value) ? markerRoadHeading.value : refHdg,
            tangentHdg,
            dtSec,
            MARKER_ROAD_HEADING_HALF_LIFE_MS,
            MARKER_ROAD_HEADING_MAX_DPS,
          );
          heading.value = stepHeadingSmoothWorklet(
            refHdg,
            tangentHdg,
            dtSec,
            TRIP_MOTION.onRoadHeadingHalfLifeMs,
            TRIP_MOTION.onRoadHeadingMaxDps,
          );
        } else {
          const tangentHdg = tangentHeadingFromDisplayWorklet(
            roadPtsFlat.value,
            roadCumM.value,
            localM,
            0,
            direction,
            markerRoadHeading.value,
          );
          markerRoadHeading.value = stepHeadingSmoothWorklet(
            markerRoadHeading.value,
            tangentHdg,
            dtSec,
            MARKER_ROAD_HEADING_HALF_LIFE_MS,
            MARKER_ROAD_HEADING_MAX_DPS,
          );
        }
      }
      return;
    }

    if (Number.isFinite(targetLat.value) && Number.isFinite(targetLng.value)) {
      const startLat = Number.isFinite(segmentStartLat.value) ? segmentStartLat.value : targetLat.value;
      const startLng = Number.isFinite(segmentStartLng.value) ? segmentStartLng.value : targetLng.value;
      const segmentLat = startLat + (targetLat.value - startLat) * segmentProgress;
      const segmentLng = startLng + (targetLng.value - startLng) * segmentProgress;
      const desired = projectCoordinateWorklet(
        segmentLat,
        segmentLng,
        targetHdg.value,
        motion.distanceM,
      );
      lat.value = desired.lat;
      lng.value = desired.lng;
      if (motion.speedMs >= TRIP_MOTION.stoppedSpeedMs) {
        heading.value = stepHeadingSmoothWorklet(
          heading.value,
          targetHdg.value,
          dtSec,
          TRIP_MOTION.headingHalfLifeMs,
          TRIP_MOTION.headingMaxDps,
        );
        markerRoadHeading.value = heading.value;
      }
    }
  }, false);

  // Płynne podążanie za polilinią (Nawigacja)

  // Płynne podążanie w trybie OFF-ROAD

  // Interpolacja Kąta (Shortest Path)

  const pushTarget = useCallback((target: NavigationTarget) => {
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
    const nowMs = Date.now();
    const sourceMs = Number.isFinite(target.sourceTimestampMs) ? Number(target.sourceTimestampMs) : nowMs;
    const sourceAgeMs = Math.max(0, nowMs - sourceMs);
    if (bootstrappedJsRef.current && sourceAgeMs > TRIP_MOTION.staleSampleMs && !target.allowInstant) {
      sampleSpeedMs.value = 0;
      speedMs.value = 0;
      return;
    }
    const previousTarget = lastTargetJsRef.current;

    const tgtHdg = safeHeadingJs(target.headingDeg, safeHeadingJs(heading.value, 0));

    const onRoad = pathModeOnRoad(target.pathMode) && target.roadBlend > ON_ROAD_BLEND_EPS;
    const blend = Math.max(0, Math.min(1, target.roadBlend));
    const incomingSpeedMs = Number.isFinite(target.speedMs) && target.speedMs > 0
      ? target.speedMs
      : 0;
    if (onRoad) {
      lastOnRoadTargetAtJsRef.current = nowMs;
    } else if (shouldHoldTransientOffRoadPose({
      previousWasOnRoad: Boolean(previousTarget && pathModeOnRoad(previousTarget.pathMode)),
      hasRoadWindow: roadPtsFlat.value.length >= 4,
      speedMs: incomingSpeedMs,
      elapsedSinceRoadMs: nowMs - lastOnRoadTargetAtJsRef.current,
      allowInstant: target.allowInstant === true,
    })) {
      // Zachowaj ostatni łuk i jego styczną, podczas gdy warstwa drogowa jest
      // ponownie wyznaczana. Nie przełączaj nawet na jedną klatkę na raw GPS.
      sampleSpeedMs.value = incomingSpeedMs;
      sourceTimestampMs.value = sourceMs;
      return;
    }
    const gpsIntervalMs = Number.isFinite(target.gpsIntervalMs) && Number(target.gpsIntervalMs) > 0
      ? Math.max(TRIP_MOTION.segmentDurationMinMs, Math.min(5_000, Number(target.gpsIntervalMs)))
      : cadenceEwmaMs.value;
    const previousCadenceMs = cadenceEwmaMs.value;
    const intervalJitterMs = Math.abs(gpsIntervalMs - previousCadenceMs);
    cadenceEwmaMs.value = previousCadenceMs * 0.65 + gpsIntervalMs * 0.35;
    jitterEwmaMs.value = jitterEwmaMs.value * 0.7 + intervalJitterMs * 0.3;
    const futurePredictionMs = Math.max(
      TRIP_MOTION.minimumFuturePredictionMs,
      cadenceEwmaMs.value * TRIP_MOTION.predictionCadenceMultiplier
        + jitterEwmaMs.value * TRIP_MOTION.predictionJitterMultiplier,
    );
    predictionHorizonMs.value = Math.min(
      TRIP_MOTION.maximumPredictionMs,
      sourceAgeMs + futurePredictionMs,
    );
    segmentDurationMs.value = Math.max(
      TRIP_MOTION.segmentDurationMinMs,
      Math.min(TRIP_MOTION.segmentDurationMaxMs, Math.round(cadenceEwmaMs.value)),
    );
    lastTargetAtMs.value = nowMs;
    sourceTimestampMs.value = sourceMs;
    let resolvedSpeedMs = incomingSpeedMs;
    if (previousTarget && gpsIntervalMs > 0) {
      const distM = haversineMJs(previousTarget.lat, previousTarget.lng, target.lat, target.lng);
      if (distM > 0.4 && resolvedSpeedMs < MIN_CRUISE_MS) {
        resolvedSpeedMs = distM / (gpsIntervalMs / 1000);
      }
    }
    const previousSampleSpeed = Math.max(0, sampleSpeedMs.value);
    const rawAcceleration = (resolvedSpeedMs - previousSampleSpeed) / Math.max(0.2, gpsIntervalMs / 1000);
    const clampedAcceleration = Math.max(
      TRIP_MOTION.accelerationMinMs2,
      Math.min(TRIP_MOTION.accelerationMaxMs2, rawAcceleration),
    );
    accelerationMs2.value = accelerationMs2.value * (1 - TRIP_MOTION.accelerationEma)
      + clampedAcceleration * TRIP_MOTION.accelerationEma;
    sampleSpeedMs.value = resolvedSpeedMs;
    if (!bootstrappedJsRef.current) speedMs.value = resolvedSpeedMs;
    lastTargetJsRef.current = target;
    targetLat.value = target.lat;
    targetLng.value = target.lng;
    targetHdg.value = tgtHdg;
    rawTargetLat.value = target.rawLat;
    rawTargetLng.value = target.rawLng;
    onRoadSv.value = onRoad ? 1 : 0;
    const prevBlend = roadBlendSv.value;
    if (onRoad) {
      cancelAnimation(lat);
      cancelAnimation(lng);
    } else {
      cancelAnimation(displayArcM);
    }
    const visualBlend = onRoad ? ON_ROAD_FULL_BLEND : blend;
    if (onRoad) {
      roadBlendSv.value = ON_ROAD_FULL_BLEND;
    } else if (prevBlend > ON_ROAD_BLEND_EPS && visualBlend > ON_ROAD_BLEND_EPS) {
      roadBlendSv.value = Math.max(visualBlend, prevBlend * 0.88);
    } else {
      roadBlendSv.value = visualBlend;
    }

    const arcFeed = onRoad && target.arcWindow && target.polylineKey
      ? packArcWindowFeed(target.arcWindow, target.polylineKey)
      : null;
    const useArc = onRoad
      && arcFeed != null
      && target.targetArcM != null
      && Number.isFinite(target.targetArcM);

    const currentPositionValid = Number.isFinite(lat.value) && Number.isFinite(lng.value);
    const positionErrorM = currentPositionValid
      ? haversineMJs(lat.value, lng.value, target.lat, target.lng)
      : Number.POSITIVE_INFINITY;
    const allowInstant = target.allowInstant === true;
    if (!allowInstant && positionErrorM > TRIP_MOTION.hardSnapDistanceM) {
      segmentDurationMs.value = TRIP_MOTION.largeCorrectionDurationMs;
    }
    const segmentLeadM = allowInstant || resolvedSpeedMs < TRIP_MOTION.stoppedSpeedMs
      ? 0
      : Math.min(
        onRoad ? TRIP_MOTION.roadPredictionMaxM : TRIP_MOTION.freePredictionMaxM,
        resolvedSpeedMs * (segmentDurationMs.value / 1000),
      );
    if (!onRoad && segmentLeadM > 0) {
      const visualTarget = projectCoordinateJs(
        target.lat,
        target.lng,
        tgtHdg,
        segmentLeadM,
      );
      targetLat.value = visualTarget.lat;
      targetLng.value = visualTarget.lng;
    }

    if (!Number.isFinite(lat.value) || !Number.isFinite(lng.value) || allowInstant) {
      if (useArc && arcFeed) {
        roadPtsFlat.value = arcFeed.ptsFlat;
        roadCumM.value = arcFeed.cumM;
        baseArcM.value = arcFeed.baseArcM;
        polylineKeySv.value = arcFeed.polylineKey;
        const arcM = target.targetArcM as number;
        travelDirectionSv.value = travelDirectionForArcJs(
          arcFeed.ptsFlat,
          arcFeed.cumM,
          arcFeed.baseArcM,
          arcM,
          tgtHdg,
        );
        const localM = arcM - arcFeed.baseArcM;
        const pose = pointAtWindowArcLocalJs(arcFeed.ptsFlat, arcFeed.cumM, localM);
        const rawLat = target.rawLat;
        const rawLng = target.rawLng;
        const blended = blendPositionJs(
          Number.isFinite(pose.lat) ? pose.lat : target.lat,
          Number.isFinite(pose.lng) ? pose.lng : target.lng,
          rawLat,
          rawLng,
          visualBlend,
        );
        const poseHdg = lookAheadHeadingJs(
          arcFeed.ptsFlat,
          arcFeed.cumM,
          localM,
          travelDirectionSv.value,
          tgtHdg,
        );
        const instantHdg = onRoad && visualBlend > ON_ROAD_BLEND_EPS ? poseHdg : tgtHdg;
        applyInstantPose(
          blended.lat,
          blended.lng,
          instantHdg,
          arcM,
          true,
          visualBlend,
          rawLat,
          rawLng,
        );
      } else {
        onRoadSv.value = 0;
        applyInstantPose(target.lat, target.lng, tgtHdg, 0, false, visualBlend, target.rawLat, target.rawLng);
      }
      return;
    }

    if (useArc && arcFeed) {
      const key = arcFeed.polylineKey;
      const keyChanged = key.length > 0 && key !== polylineKeySv.value;
      const directionUninitialized = polylineKeySv.value.length === 0;
      roadPtsFlat.value = arcFeed.ptsFlat;
      roadCumM.value = arcFeed.cumM;
      baseArcM.value = arcFeed.baseArcM;
      polylineKeySv.value = key;
      onRoadSv.value = 1;
      const incomingArcM = target.targetArcM as number;
      // Resolve polyline orientation once. Refreshed arc windows keep the same
      // travel direction, preventing a noisy heading from producing a 180° flip.
      const nextDirection = directionUninitialized
        ? travelDirectionForArcJs(
          arcFeed.ptsFlat,
          arcFeed.cumM,
          arcFeed.baseArcM,
          incomingArcM,
          tgtHdg,
        )
        : travelDirectionSv.value < 0 ? -1 : 1;
      travelDirectionSv.value = nextDirection;
      const previousArcM = targetArcM.value;
      if (keyChanged) {
        // Arc windows are refreshed while navigating. Reproject the current
        // rendered pose before calculating the new monotonic target.
        const continuity = projectPointToWindowArcJs(
          lat.value,
          lng.value,
          arcFeed.ptsFlat,
          arcFeed.cumM,
          arcFeed.baseArcM,
        );
        if (continuity && continuity.distanceM <= POLYLINE_KEY_HARD_SNAP_M) {
          cancelAnimation(displayArcM);
          displayArcM.value = continuity.arcM;
        }
      }
      const predictedArcM = incomingArcM + nextDirection * segmentLeadM;
      const renderedArcM = Number.isFinite(displayArcM.value)
        ? displayArcM.value
        : predictedArcM;
      const monotonicArcM = nextDirection > 0
        ? Math.max(predictedArcM, renderedArcM)
        : Math.min(predictedArcM, renderedArcM);
      const arcM = keyChanged || !Number.isFinite(previousArcM)
        ? monotonicArcM
        : nextDirection > 0
          ? Math.max(monotonicArcM, previousArcM)
          : Math.min(monotonicArcM, previousArcM);
      const arcEndM = arcFeed.baseArcM + (arcFeed.cumM[arcFeed.cumM.length - 1] ?? 0);
      targetArcM.value = Math.max(arcFeed.baseArcM, Math.min(arcEndM, arcM));
    } else {
      onRoadSv.value = 0;
      travelDirectionSv.value = 1;
      roadPtsFlat.value = [];
      roadCumM.value = [];
      polylineKeySv.value = '';
      displayArcM.value = 0;
      targetArcM.value = 0;
      baseArcM.value = 0;
    }
    segmentStartedAtMs.value = nowMs;
    segmentStartLat.value = Number.isFinite(lat.value) ? lat.value : target.lat;
    segmentStartLng.value = Number.isFinite(lng.value) ? lng.value : target.lng;
    segmentStartArcM.value = Number.isFinite(displayArcM.value) ? displayArcM.value : 0;
  }, [
    applyInstantPose,
    baseArcM,
    displayArcM,
    heading,
    lat,
    lng,
    onRoadSv,
    polylineKeySv,
    rawTargetLat,
    rawTargetLng,
    roadBlendSv,
    roadCumM,
    roadPtsFlat,
    accelerationMs2,
    cadenceEwmaMs,
    jitterEwmaMs,
    predictionHorizonMs,
    sampleSpeedMs,
    speedMs,
    segmentDurationMs,
    segmentStartedAtMs,
    segmentStartLat,
    segmentStartLng,
    segmentStartArcM,
    lastTargetAtMs,
    sourceTimestampMs,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
    travelDirectionSv,
  ]);

  const reset = useCallback((anchor?: { lat: number; lng: number; headingDeg?: number }) => {
    bootstrappedJsRef.current = false;
    lastTargetJsRef.current = null;
    lastOnRoadTargetAtJsRef.current = 0;
    setIsBootstrapped(false);
    bootstrapped.value = 0;
    onRoadSv.value = 0;
    roadBlendSv.value = 0;
    roadPtsFlat.value = [];
    roadCumM.value = [];
    polylineKeySv.value = '';
    displayArcM.value = 0;
    targetArcM.value = 0;
    baseArcM.value = 0;
    speedMs.value = 0;
    sampleSpeedMs.value = 0;
    accelerationMs2.value = 0;
    cadenceEwmaMs.value = TRIP_MOTION.segmentDurationDefaultMs;
    jitterEwmaMs.value = 0;
    predictionHorizonMs.value = TRIP_MOTION.minimumFuturePredictionMs;
    segmentDurationMs.value = TRIP_MOTION.segmentDurationDefaultMs;
    segmentStartedAtMs.value = 0;
    segmentStartLat.value = NaN;
    segmentStartLng.value = NaN;
    segmentStartArcM.value = 0;
    travelDirectionSv.value = 1;
    lastTargetAtMs.value = 0;
    sourceTimestampMs.value = 0;

    if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
      const hdg = safeHeadingJs(anchor.headingDeg, 0);
      lat.value = anchor.lat;
      lng.value = anchor.lng;
      heading.value = hdg;
      markerRoadHeading.value = hdg;
      targetLat.value = anchor.lat;
      targetLng.value = anchor.lng;
      targetHdg.value = hdg;
      rawTargetLat.value = anchor.lat;
      rawTargetLng.value = anchor.lng;
      bootstrapped.value = 1;
      bootstrappedJsRef.current = true;
      setIsBootstrapped(true);
    } else {
      lat.value = NaN;
      lng.value = NaN;
      heading.value = 0;
      markerRoadHeading.value = 0;
      targetLat.value = NaN;
      targetLng.value = NaN;
      targetHdg.value = 0;
      rawTargetLat.value = NaN;
      rawTargetLng.value = NaN;
    }
  }, [
    baseArcM,
    bootstrapped,
    displayArcM,
    heading,
    lat,
    lng,
    markerRoadHeading,
    onRoadSv,
    polylineKeySv,
    rawTargetLat,
    rawTargetLng,
    roadBlendSv,
    roadCumM,
    roadPtsFlat,
    accelerationMs2,
    cadenceEwmaMs,
    jitterEwmaMs,
    predictionHorizonMs,
    sampleSpeedMs,
    speedMs,
    segmentDurationMs,
    segmentStartedAtMs,
    segmentStartLat,
    segmentStartLng,
    segmentStartArcM,
    lastTargetAtMs,
    sourceTimestampMs,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
    travelDirectionSv,
  ]);

  const resetTo = useCallback((targetLatVal: number, targetLngVal: number, hdg: number) => {
    if (!Number.isFinite(targetLatVal) || !Number.isFinite(targetLngVal)) return;
    const normHdg = safeHeadingJs(hdg, 0);
    lastTargetJsRef.current = null;
    lastOnRoadTargetAtJsRef.current = 0;
    applyInstantPose(
      targetLatVal,
      targetLngVal,
      normHdg,
      0,
      false,
      0,
      targetLatVal,
      targetLngVal,
    );
    onRoadSv.value = 0;
    roadPtsFlat.value = [];
    roadCumM.value = [];
    polylineKeySv.value = '';
    displayArcM.value = 0;
    targetArcM.value = 0;
    baseArcM.value = 0;
  }, [
    applyInstantPose,
    baseArcM,
    displayArcM,
    onRoadSv,
    polylineKeySv,
    roadCumM,
    roadPtsFlat,
    targetArcM,
  ]);

  const resumeFromBackground = useCallback(() => {
    const t = lastTargetJsRef.current;
    if (t && Number.isFinite(t.lat) && Number.isFinite(t.lng)) {
      pushTarget({ ...t, allowInstant: true });
      return;
    }
    if (Number.isFinite(targetLat.value) && Number.isFinite(targetLng.value)) {
      applyInstantPose(
        targetLat.value,
        targetLng.value,
        safeHeadingJs(targetHdg.value, 0),
        Number.isFinite(targetArcM.value) ? targetArcM.value : 0,
        onRoadSv.value >= 0.5,
        roadBlendSv.value,
        Number.isFinite(rawTargetLat.value) ? rawTargetLat.value : targetLat.value,
        Number.isFinite(rawTargetLng.value) ? rawTargetLng.value : targetLng.value,
      );
    }
  }, [
    applyInstantPose,
    onRoadSv,
    pushTarget,
    rawTargetLat,
    rawTargetLng,
    roadBlendSv,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
  ]);

  const ensureFrameActive = useCallback(() => {
    enabledSv.value = enabled ? 1 : 0;
    frameCallback.setActive(enabled);
  }, [enabled, enabledSv, frameCallback]);

  useEffect(() => {
    enabledSv.value = enabled ? 1 : 0;
    frameCallback.setActive(enabled);
    if (!enabled) {
      bootstrappedJsRef.current = false;
      lastTargetJsRef.current = null;
      lastOnRoadTargetAtJsRef.current = 0;
      setIsBootstrapped(false);
    }
    return () => {
      frameCallback.setActive(false);
    };
  }, [enabled, enabledSv, frameCallback]);

  /** Trip ON bez wcześniejszego resetTo — seed z najlepszej znanej pozycji (cold start / postój). */
  useEffect(() => {
    if (!enabled || bootstrappedJsRef.current) return;
    const pose = getSeedPoseRef.current?.();
    if (!pose || !Number.isFinite(pose.lat) || !Number.isFinite(pose.lng)) return;
    const hdg = safeHeadingJs(pose.headingDeg, 0);
    applyInstantPose(
      pose.lat,
      pose.lng,
      hdg,
      0,
      false,
      0,
      pose.lat,
      pose.lng,
    );
    onRoadSv.value = 0;
    roadPtsFlat.value = [];
    roadCumM.value = [];
    polylineKeySv.value = '';
    displayArcM.value = 0;
    targetArcM.value = 0;
    baseArcM.value = 0;
    frameCallback.setActive(true);
  }, [enabled, applyInstantPose, baseArcM, displayArcM, frameCallback, onRoadSv, polylineKeySv, roadCumM, roadPtsFlat, targetArcM]);

  return useMemo(
    () => ({
      lat,
      lng,
      heading,
      markerRoadHeading,
      targetLat,
      targetLng,
      targetHdg,
      segmentDurationMs,
      speedMs,
      isBootstrapped,
      pushTarget,
      reset,
      resetTo,
      ensureFrameActive,
      resumeFromBackground,
    }),
    [ensureFrameActive, heading, isBootstrapped, lat, lng, markerRoadHeading, pushTarget, reset, resetTo, resumeFromBackground, segmentDurationMs, speedMs, targetLat, targetLng, targetHdg],
  );
}

export function snapResultToNavigationTarget(
  snap: {
    lat: number;
    lng: number;
    rawLat: number;
    rawLng: number;
    headingDeg: number;
    pathMode: PathMode;
    roadBlend: number;
    arcM: number | null;
    arcWindow: ArcWindowSlice | null;
    polylineKey: string | null;
  },
  speedMs: number,
  allowInstant = false,
): NavigationTarget {
  return {
    lat: snap.lat,
    lng: snap.lng,
    headingDeg: snap.headingDeg,
    speedMs: Math.max(0, speedMs),
    pathMode: snap.pathMode,
    roadBlend: snap.roadBlend,
    rawLat: snap.rawLat,
    rawLng: snap.rawLng,
    targetArcM: snap.arcM,
    arcWindow: snap.arcWindow,
    polylineKey: snap.polylineKey,
    allowInstant,
  };
}
