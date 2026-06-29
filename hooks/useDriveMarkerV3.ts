import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelAnimation,
  Easing,
  useAnimatedReaction,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { NAV_V3 } from '../lib/navigationV3/config';
import type { ArcWindowSlice, NavigationTarget, PathMode } from '../lib/navigationV3/types';

const MIN_CRUISE_MS = NAV_V3.MARKER_MIN_CRUISE_MS;
const MAX_HEADING_RATE_DPS = NAV_V3.MARKER_MAX_HEADING_DPS;
const MARKER_HEADING_EMA = NAV_V3.MARKER_HEADING_EMA;
const ON_ROAD_BLEND_EPS = NAV_V3.ON_ROAD_BLEND_EPS;
const POLYLINE_KEY_HARD_SNAP_M = 45;
const MAX_FRAME_DT_MS = NAV_V3.MARKER_MAX_FRAME_DT_MS;
const STALE_FRAME_MS = NAV_V3.MARKER_STALE_FRAME_MS;
const HEADING_LOOKAHEAD_M = NAV_V3.SNAP_HEADING_LOOKAHEAD_M;
const MARKER_HEADING_TIMING_MS = NAV_V3.MARKER_HEADING_TIMING_MS;
const MARKER_HEADING_TAU_SEC = NAV_V3.MARKER_HEADING_TIMING_MS / 1000;
const MARKER_HEADING_MAX_DPS = NAV_V3.MARKER_HEADING_MAX_DPS;
const ON_ROAD_FULL_BLEND = NAV_V3.MARKER_ON_ROAD_FULL_BLEND;
const ROAD_COAST_MAX_M = 16;
const FREE_COAST_MAX_M = 5;

export type DriveMarkerV3Values = {
  lat: SharedValue<number>;
  lng: SharedValue<number>;
  heading: SharedValue<number>;
  targetLat: SharedValue<number>;
  targetLng: SharedValue<number>;
  targetHdg: SharedValue<number>;
  segmentDurationMs: SharedValue<number>;
  cameraTargetLat: SharedValue<number>;
  cameraTargetLng: SharedValue<number>;
  cameraSegmentDurationMs: SharedValue<number>;
  /** Zwiększany dokładnie raz po przygotowaniu kompletnego targetu GPS. */
  cameraTick: SharedValue<number>;
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
  fromLat: number,
  fromLng: number,
  fallbackHdg: number,
): number {
  const total = cumM.length > 0 ? cumM[cumM.length - 1] : 0;
  const aheadLocalM = Math.min(total, localM + HEADING_LOOKAHEAD_M);
  const ahead = pointAtWindowArcLocalJs(ptsFlat, cumM, aheadLocalM);
  if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng) || !Number.isFinite(ahead.lat)) {
    return safeHeadingJs(fallbackHdg, 0);
  }
  const spanM = haversineMJs(fromLat, fromLng, ahead.lat, ahead.lng);
  if (spanM < 3) return safeHeadingJs(fallbackHdg, 0);
  const raw = bearingBetweenJs(fromLat, fromLng, ahead.lat, ahead.lng);
  const reversed = (raw + 180) % 360;
  const fwdDiff = Math.abs(((raw - fallbackHdg + 540) % 360) - 180);
  const revDiff = Math.abs(((reversed - fallbackHdg + 540) % 360) - 180);
  const aligned = revDiff < fwdDiff ? reversed : raw;
  return safeHeadingJs(aligned, fallbackHdg);
}

function smoothTargetArcMJs(
  prevArcM: number,
  incomingArcM: number,
): number {
  if (!Number.isFinite(incomingArcM)) return prevArcM;
  if (!Number.isFinite(prevArcM)) return incomingArcM;
  return incomingArcM;
}

function blendPositionJs(
  roadLat: number,
  roadLng: number,
  rawLat: number,
  rawLng: number,
  roadBlend: number,
): { lat: number; lng: number } {
  const blend = Math.max(0, Math.min(1, roadBlend));
  if (blend >= 0.999) return { lat: roadLat, lng: roadLng };
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

function lerpHeadingCappedWorklet(from: number, to: number, maxDeltaDeg: number): number {
  'worklet';
  const f = Number.isFinite(from) ? from : 0;
  const t = Number.isFinite(to) ? to : f;
  const diff = headingDeltaW(f, t);
  const clamped = Math.max(-maxDeltaDeg, Math.min(maxDeltaDeg, diff));
  return normalizeHeadingW(f + clamped);
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

function stepTowardWorklet(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  maxStepM: number,
): { lat: number; lng: number } {
  'worklet';
  const distM = haversineMWorklet(fromLat, fromLng, toLat, toLng);
  if (distM < 0.008 || maxStepM < 0.008) {
    return { lat: fromLat, lng: fromLng };
  }
  const t = Math.min(1, maxStepM / distM);
  return {
    lat: fromLat + (toLat - fromLat) * t,
    lng: fromLng + (toLng - fromLng) * t,
  };
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

function alignBearingWorklet(segmentBearing: number, referenceBearing: number): number {
  'worklet';
  const seg = normalizeHeadingW(segmentBearing);
  const ref = normalizeHeadingW(referenceBearing);
  const reversed = normalizeHeadingW(seg + 180);
  const fwdDiff = Math.abs(headingDeltaW(seg, ref));
  const revDiff = Math.abs(headingDeltaW(reversed, ref));
  return revDiff < fwdDiff ? reversed : seg;
}

function bearingAheadFromDisplayWorklet(
  ptsFlat: number[],
  cum: number[],
  localM: number,
  fromLat: number,
  fromLng: number,
  referenceHdg: number,
): number {
  'worklet';
  const total = cum.length > 0 ? cum[cum.length - 1] : 0;
  const aheadLocalM = Math.min(total, localM + HEADING_LOOKAHEAD_M);
  const ahead = pointAtWindowArcLocal(ptsFlat, cum, aheadLocalM);
  if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng) || !Number.isFinite(ahead.lat)) {
    return safeHeadingWorklet(referenceHdg, 0);
  }
  const spanM = haversineMWorklet(fromLat, fromLng, ahead.lat, ahead.lng);
  if (spanM < 3) {
    return safeHeadingWorklet(referenceHdg, 0);
  }
  const raw = bearingBetweenWorklet(fromLat, fromLng, ahead.lat, ahead.lng);
  return alignBearingWorklet(raw, referenceHdg);
}

function stepHeadingSmoothWorklet(
  cur: number,
  target: number,
  dtSec: number,
  tauSec: number,
  maxDps: number,
): number {
  'worklet';
  const delta = headingDeltaW(cur, target);
  const tauStep = delta * Math.min(1, dtSec / Math.max(0.05, tauSec));
  const maxStep = maxDps * dtSec;
  let step = tauStep;
  if (Math.abs(step) > maxStep) {
    step = Math.sign(step) * maxStep;
  }
  return normalizeHeadingW(cur + step);
}

function blendPositionWorklet(
  roadLat: number,
  roadLng: number,
  rawLat: number,
  rawLng: number,
  roadBlend: number,
): { lat: number; lng: number } {
  'worklet';
  const blend = clampWorklet(roadBlend, 0, 1);
  if (blend >= 0.999) return { lat: roadLat, lng: roadLng };
  if (blend <= 0.001) return { lat: rawLat, lng: rawLng };
  const inv = 1 - blend;
  return {
    lat: roadLat * blend + rawLat * inv,
    lng: roadLng * blend + rawLng * inv,
  };
}

function pathModeOnRoad(mode: PathMode): boolean {
  return mode === 'onRoad';
}

/**
 * V3 marker — withTiming @ GPS cadence + 60 FPS projekcja arc → lat/lng.
 */
export function useDriveMarkerV3(
  enabled = true,
  getSeedPose?: () => DriveMarkerSeedPose | null,
): UseDriveMarkerV3Return {
  const getSeedPoseRef = useRef(getSeedPose);
  getSeedPoseRef.current = getSeedPose;
  const bootstrappedJsRef = useRef(false);
  const lastTargetJsRef = useRef<NavigationTarget | null>(null);
  const [isBootstrapped, setIsBootstrapped] = useState(false);

  const lat = useSharedValue(NaN);
  const lng = useSharedValue(NaN);
  const heading = useSharedValue(0);
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
  const speedMs = useSharedValue(0);
  const segmentDurationMs = useSharedValue(900);
  const cameraTick = useSharedValue(0);
  const cameraTargetLat = useSharedValue(NaN);
  const cameraTargetLng = useSharedValue(NaN);
  const cameraSegmentDurationMs = useSharedValue(900);
  const lastTargetAtMs = useSharedValue(0);
  const coastDistanceM = useSharedValue(0);

  const targetLat = useSharedValue(NaN);
  const targetLng = useSharedValue(NaN);
  const targetHdg = useSharedValue(0);
  const segmentHdgTargetSv = useSharedValue(0);
  const rawTargetLat = useSharedValue(NaN);
  const rawTargetLng = useSharedValue(NaN);

  const lastFrameTimestamp = useSharedValue(0);
  const skipCatchUpSv = useSharedValue(0);

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
    displayArcM.value = Number.isFinite(arcM) ? arcM : 0;
    targetArcM.value = Number.isFinite(arcM) ? arcM : 0;
    targetLat.value = safeLat;
    targetLng.value = safeLng;
    targetHdg.value = safeHdg;
    segmentHdgTargetSv.value = safeHdg;
    rawTargetLat.value = safeCoordJs(rawLat, safeLat);
    rawTargetLng.value = safeCoordJs(rawLng, safeLng);
    onRoadSv.value = onRoad ? 1 : 0;
    roadBlendSv.value = blend;
    bootstrapped.value = 1;
    bootstrappedJsRef.current = true;
    setIsBootstrapped(true);
  }, [
    baseArcM,
    bootstrapped,
    displayArcM,
    heading,
    lat,
    lng,
    onRoadSv,
    rawTargetLat,
    rawTargetLng,
    roadBlendSv,
    segmentHdgTargetSv,
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
    const segmentFinished = lastTargetAtMs.value > 0
      && Date.now() - lastTargetAtMs.value >= segmentDurationMs.value;

    if (onRoad && roadPtsFlat.value.length >= 4 && Number.isFinite(displayArcM.value)) {
      if (segmentFinished && speedMs.value >= MIN_CRUISE_MS) {
        const aheadM = Math.max(0, displayArcM.value - targetArcM.value);
        const maxAheadM = Math.min(ROAD_COAST_MAX_M, Math.max(5, speedMs.value * 0.8));
        const arcEndM = baseArcM.value + (roadCumM.value[roadCumM.value.length - 1] ?? 0);
        if (aheadM < maxAheadM && displayArcM.value < arcEndM) {
          displayArcM.value = Math.min(
            arcEndM,
            displayArcM.value + Math.min(speedMs.value * dtSec, maxAheadM - aheadM),
          );
        }
      }
      const localM = displayArcM.value - baseArcM.value;
      const roadPose = pointAtWindowArcLocal(roadPtsFlat.value, roadCumM.value, localM);

      if (Number.isFinite(roadPose.lat) && Number.isFinite(roadPose.lng)) {
        lat.value = roadPose.lat;
        lng.value = roadPose.lng;

        const refHdg = Number.isFinite(heading.value) ? heading.value : targetHdg.value;
        const aheadHdg = bearingAheadFromDisplayWorklet(
          roadPtsFlat.value,
          roadCumM.value,
          localM,
          roadPose.lat,
          roadPose.lng,
          refHdg,
        );
        const roadTangentHdg = Number.isFinite(roadPose.heading) ? roadPose.heading : refHdg;
        const tgtHdg = Number.isFinite(aheadHdg) ? aheadHdg : roadTangentHdg;
        heading.value = stepHeadingSmoothWorklet(
          refHdg,
          tgtHdg,
          dtSec,
          MARKER_HEADING_TAU_SEC,
          MARKER_HEADING_MAX_DPS,
        );
      }
    } else if (
      segmentFinished
      && speedMs.value >= MIN_CRUISE_MS
      && coastDistanceM.value < FREE_COAST_MAX_M
      && Number.isFinite(lat.value)
      && Number.isFinite(lng.value)
    ) {
      const stepM = Math.min(
        speedMs.value * dtSec,
        FREE_COAST_MAX_M - coastDistanceM.value,
      );
      const headingRad = targetHdg.value * Math.PI / 180;
      const earthRadiusM = 6_371_000;
      const dLat = (stepM * Math.cos(headingRad)) / earthRadiusM;
      const cosLat = Math.max(0.1, Math.cos(lat.value * Math.PI / 180));
      const dLng = (stepM * Math.sin(headingRad)) / (earthRadiusM * cosLat);
      lat.value += dLat * 180 / Math.PI;
      lng.value += dLng * 180 / Math.PI;
      coastDistanceM.value += stepM;
    }
  }, false);

  // Płynne podążanie za polilinią (Nawigacja)
  useAnimatedReaction(
    () => targetArcM.value,
    (newTarget, prevTarget) => {
      if (newTarget !== null && Number.isFinite(newTarget) && newTarget !== prevTarget) {
        const isJump = prevTarget === null || Math.abs(newTarget - prevTarget) > 150;
        displayArcM.value = isJump
          ? newTarget
          : withTiming(newTarget, { duration: segmentDurationMs.value, easing: Easing.linear });
      }
    },
  );

  // Płynne podążanie w trybie OFF-ROAD
  useAnimatedReaction(
    () => targetLat.value,
    (newLat, prevLat) => {
      if (onRoadSv.value < 0.5 && newLat !== null && Number.isFinite(newLat)) {
        if (prevLat == null || !Number.isFinite(prevLat)) {
          lat.value = newLat;
        } else {
          lat.value = withTiming(newLat, { duration: segmentDurationMs.value, easing: Easing.linear });
        }
      }
    },
  );
  useAnimatedReaction(
    () => targetLng.value,
    (newLng, prevLng) => {
      if (onRoadSv.value < 0.5 && newLng !== null && Number.isFinite(newLng)) {
        if (prevLng == null || !Number.isFinite(prevLng)) {
          lng.value = newLng;
        } else {
          lng.value = withTiming(newLng, { duration: segmentDurationMs.value, easing: Easing.linear });
        }
      }
    },
  );

  // Interpolacja Kąta (Shortest Path)
  useAnimatedReaction(
    () => targetHdg.value,
    (newHdg, prevHdg) => {
      if (newHdg !== null && Number.isFinite(newHdg) && newHdg !== prevHdg) {
        if (prevHdg == null || !Number.isFinite(prevHdg)) {
          heading.value = newHdg;
        } else {
          const current = heading.value;
          const diff = ((newHdg - current + 540) % 360) - 180;
          heading.value = withTiming(current + diff, { duration: MARKER_HEADING_TIMING_MS, easing: Easing.out(Easing.quad) });
        }
      }
    },
  );

  const pushTarget = useCallback((target: NavigationTarget) => {
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
    lastTargetJsRef.current = target;

    const tgtHdg = safeHeadingJs(target.headingDeg, safeHeadingJs(heading.value, 0));

    const onRoad = pathModeOnRoad(target.pathMode) && target.roadBlend > ON_ROAD_BLEND_EPS;
    const blend = Math.max(0, Math.min(1, target.roadBlend));
    const feedSpeed = Number.isFinite(target.speedMs) && target.speedMs > 0 ? target.speedMs : 0;
    segmentDurationMs.value = Math.max(
      320,
      Math.min(1_200, Number.isFinite(target.gpsIntervalMs) ? target.gpsIntervalMs! : 900),
    );
    lastTargetAtMs.value = Date.now();
    coastDistanceM.value = 0;
    let resolvedSpeedMs = feedSpeed;
    if (target.gpsIntervalMs && target.gpsIntervalMs > 0) {
      const fromLat = Number.isFinite(lat.value) ? lat.value : target.lat;
      const fromLng = Number.isFinite(lng.value) ? lng.value : target.lng;
      const distM = haversineMJs(fromLat, fromLng, target.lat, target.lng);
      if (distM > 0.4) {
        const intervalSec = target.gpsIntervalMs / 1000;
        resolvedSpeedMs = Math.max(resolvedSpeedMs, distM / intervalSec);
      }
    }

    speedMs.value = resolvedSpeedMs;
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

    const cameraBridgeMs = resolvedSpeedMs >= MIN_CRUISE_MS ? 350 : 0;
    const cameraLeadM = Math.min(6, resolvedSpeedMs * cameraBridgeMs / 1000);
    let nextCameraLat = target.lat;
    let nextCameraLng = target.lng;
    if (useArc && arcFeed && target.targetArcM != null) {
      const cameraLocalM = target.targetArcM - arcFeed.baseArcM + cameraLeadM;
      const cameraPose = pointAtWindowArcLocalJs(
        arcFeed.ptsFlat,
        arcFeed.cumM,
        cameraLocalM,
      );
      if (Number.isFinite(cameraPose.lat) && Number.isFinite(cameraPose.lng)) {
        nextCameraLat = cameraPose.lat;
        nextCameraLng = cameraPose.lng;
      }
    } else if (cameraLeadM > 0) {
      const headingRad = tgtHdg * Math.PI / 180;
      const earthRadiusM = 6_371_000;
      nextCameraLat += (cameraLeadM * Math.cos(headingRad) / earthRadiusM) * 180 / Math.PI;
      const cosLat = Math.max(0.1, Math.cos(target.lat * Math.PI / 180));
      nextCameraLng += (cameraLeadM * Math.sin(headingRad) / (earthRadiusM * cosLat)) * 180 / Math.PI;
    }
    cameraTargetLat.value = nextCameraLat;
    cameraTargetLng.value = nextCameraLng;
    cameraSegmentDurationMs.value = segmentDurationMs.value + cameraBridgeMs;
    cameraTick.value += 1;

    const allowInstant = target.allowInstant === true;

    if (!Number.isFinite(lat.value) || !Number.isFinite(lng.value) || allowInstant) {
      if (useArc && arcFeed) {
        roadPtsFlat.value = arcFeed.ptsFlat;
        roadCumM.value = arcFeed.cumM;
        baseArcM.value = arcFeed.baseArcM;
        polylineKeySv.value = arcFeed.polylineKey;
        const arcM = target.targetArcM as number;
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
          blended.lat,
          blended.lng,
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
      roadPtsFlat.value = arcFeed.ptsFlat;
      roadCumM.value = arcFeed.cumM;
      baseArcM.value = arcFeed.baseArcM;
      polylineKeySv.value = key;
      onRoadSv.value = 1;
      const arcM = target.targetArcM as number;
      targetArcM.value = arcM;

      if (keyChanged) {
        const gapBeforeKey = arcM - displayArcM.value;
        const localM = arcM - arcFeed.baseArcM;
        const pose = pointAtWindowArcLocalJs(arcFeed.ptsFlat, arcFeed.cumM, localM);
        if (Math.abs(gapBeforeKey) >= POLYLINE_KEY_HARD_SNAP_M) {
          cancelAnimation(displayArcM);
          cancelAnimation(lat);
          cancelAnimation(lng);
          cancelAnimation(heading);
          displayArcM.value = arcM;
          if (Number.isFinite(pose.lat) && Number.isFinite(pose.lng)) {
            const blended = blendPositionJs(
              pose.lat,
              pose.lng,
              target.rawLat,
              target.rawLng,
              visualBlend,
            );
            lat.value = blended.lat;
            lng.value = blended.lng;
            const poseHdg = lookAheadHeadingJs(
              arcFeed.ptsFlat,
              arcFeed.cumM,
              localM,
              blended.lat,
              blended.lng,
              tgtHdg,
            );
            const snappedHdg = visualBlend > ON_ROAD_BLEND_EPS ? poseHdg : tgtHdg;
            heading.value = snappedHdg;
            segmentHdgTargetSv.value = snappedHdg;
          }
        } else if (Number.isFinite(pose.lat) && Number.isFinite(pose.lng)) {
          const reprojGapM = haversineMJs(lat.value, lng.value, pose.lat, pose.lng);
          if (reprojGapM < POLYLINE_KEY_HARD_SNAP_M) {
            displayArcM.value = arcM - reprojGapM * 0.15;
          }
        }
      }
    } else {
      onRoadSv.value = 0;
      roadPtsFlat.value = [];
      roadCumM.value = [];
      polylineKeySv.value = '';
      displayArcM.value = 0;
      targetArcM.value = 0;
      baseArcM.value = 0;
    }
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
    speedMs,
    segmentDurationMs,
    cameraTick,
    cameraTargetLat,
    cameraTargetLng,
    cameraSegmentDurationMs,
    lastTargetAtMs,
    coastDistanceM,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
  ]);

  const reset = useCallback((anchor?: { lat: number; lng: number; headingDeg?: number }) => {
    bootstrappedJsRef.current = false;
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
    lastTargetAtMs.value = 0;
    coastDistanceM.value = 0;
    lastFrameTimestamp.value = 0;

    if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
      const hdg = safeHeadingJs(anchor.headingDeg, 0);
      lat.value = anchor.lat;
      lng.value = anchor.lng;
      heading.value = hdg;
      targetLat.value = anchor.lat;
      targetLng.value = anchor.lng;
      targetHdg.value = hdg;
      segmentHdgTargetSv.value = hdg;
      rawTargetLat.value = anchor.lat;
      rawTargetLng.value = anchor.lng;
      bootstrapped.value = 1;
      bootstrappedJsRef.current = true;
      setIsBootstrapped(true);
    } else {
      lat.value = NaN;
      lng.value = NaN;
      heading.value = 0;
      targetLat.value = NaN;
      targetLng.value = NaN;
      targetHdg.value = 0;
      segmentHdgTargetSv.value = 0;
      rawTargetLat.value = NaN;
      rawTargetLng.value = NaN;
    }
  }, [
    baseArcM,
    bootstrapped,
    displayArcM,
    heading,
    lat,
    lastFrameTimestamp,
    lng,
    onRoadSv,
    polylineKeySv,
    rawTargetLat,
    rawTargetLng,
    roadBlendSv,
    roadCumM,
    roadPtsFlat,
    segmentHdgTargetSv,
    speedMs,
    lastTargetAtMs,
    coastDistanceM,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
  ]);

  const resetTo = useCallback((targetLatVal: number, targetLngVal: number, hdg: number) => {
    if (!Number.isFinite(targetLatVal) || !Number.isFinite(targetLngVal)) return;
    const normHdg = safeHeadingJs(hdg, 0);
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
    lastFrameTimestamp.value = 0;
  }, [
    applyInstantPose,
    baseArcM,
    displayArcM,
    lastFrameTimestamp,
    onRoadSv,
    polylineKeySv,
    roadCumM,
    roadPtsFlat,
    targetArcM,
  ]);

  const resumeFromBackground = useCallback(() => {
    lastFrameTimestamp.value = 0;
    skipCatchUpSv.value = 1;
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
    skipCatchUpSv,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
    lastFrameTimestamp,
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
    lastFrameTimestamp.value = 0;
    frameCallback.setActive(true);
  }, [enabled, applyInstantPose, baseArcM, displayArcM, frameCallback, lastFrameTimestamp, onRoadSv, polylineKeySv, roadCumM, roadPtsFlat, targetArcM]);

  return useMemo(
    () => ({
      lat,
      lng,
      heading,
      targetLat,
      targetLng,
      targetHdg,
      segmentDurationMs,
      cameraTick,
      cameraTargetLat,
      cameraTargetLng,
      cameraSegmentDurationMs,
      isBootstrapped,
      pushTarget,
      reset,
      resetTo,
      ensureFrameActive,
      resumeFromBackground,
    }),
    [cameraSegmentDurationMs, cameraTargetLat, cameraTargetLng, cameraTick, ensureFrameActive, heading, isBootstrapped, lat, lng, pushTarget, reset, resetTo, resumeFromBackground, segmentDurationMs, targetLat, targetLng, targetHdg],
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
