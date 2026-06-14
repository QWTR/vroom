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
const MARKER_HEADING_TAU_SEC = NAV_V3.MARKER_HEADING_TIMING_MS / 1000;
const MARKER_HEADING_MAX_DPS = NAV_V3.MARKER_HEADING_MAX_DPS;
const ON_ROAD_FULL_BLEND = NAV_V3.MARKER_ON_ROAD_FULL_BLEND;
/** Liniowy ruch między tickami GPS (~1 Hz). */
const GPS_TARGET_ANIM_MS = 1000;
const HEADING_TARGET_ANIM_MS = 500;
const ARC_JUMP_TELEPORT_M = 100;

export type DriveMarkerV3Values = {
  lat: SharedValue<number>;
  lng: SharedValue<number>;
  heading: SharedValue<number>;
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

  /** ON-ROAD: liniowy withTiming na arcM (natywny silnik C++, bez LERP klatkowego). */
  useAnimatedReaction(
    () => ({
      arc: targetArcM.value,
      onRoad: onRoadSv.value,
    }),
    (curr, prev) => {
      'worklet';
      if (curr.onRoad < 0.5) return;
      if (!Number.isFinite(curr.arc)) return;
      const newTarget = curr.arc;
      const prevTarget = prev?.arc;
      if (prev != null && newTarget === prevTarget) return;
      const isJump =
        prevTarget == null
        || !Number.isFinite(prevTarget)
        || Math.abs(newTarget - prevTarget) > ARC_JUMP_TELEPORT_M;
      cancelAnimation(displayArcM);
      displayArcM.value = isJump
        ? newTarget
        : withTiming(newTarget, { duration: GPS_TARGET_ANIM_MS, easing: Easing.linear });
    },
    [targetArcM, onRoadSv, displayArcM],
  );

  /** OFF-ROAD: liniowy withTiming na współrzędne docelowe z GPS. */
  useAnimatedReaction(
    () => ({
      lat: targetLat.value,
      onRoad: onRoadSv.value,
    }),
    (curr, prev) => {
      'worklet';
      if (curr.onRoad >= 0.5) return;
      if (!Number.isFinite(curr.lat)) return;
      if (prev != null && curr.lat === prev.lat) return;
      cancelAnimation(lat);
      lat.value = withTiming(curr.lat, { duration: GPS_TARGET_ANIM_MS, easing: Easing.linear });
    },
    [targetLat, onRoadSv, lat],
  );

  useAnimatedReaction(
    () => ({
      lng: targetLng.value,
      onRoad: onRoadSv.value,
    }),
    (curr, prev) => {
      'worklet';
      if (curr.onRoad >= 0.5) return;
      if (!Number.isFinite(curr.lng)) return;
      if (prev != null && curr.lng === prev.lng) return;
      cancelAnimation(lng);
      lng.value = withTiming(curr.lng, { duration: GPS_TARGET_ANIM_MS, easing: Easing.linear });
    },
    [targetLng, onRoadSv, lng],
  );

  /** Heading: shortest-path + szybszy ease (500 ms). */
  useAnimatedReaction(
    () => targetHdg.value,
    (newHdg, prevHdg) => {
      'worklet';
      if (!Number.isFinite(newHdg)) return;
      if (prevHdg != null && newHdg === prevHdg) return;
      const current = Number.isFinite(heading.value) ? heading.value : newHdg;
      const diff = ((newHdg - current + 540) % 360) - 180;
      cancelAnimation(heading);
      heading.value = withTiming(
        current + diff,
        { duration: HEADING_TARGET_ANIM_MS, easing: Easing.out(Easing.quad) },
      );
    },
    [targetHdg, heading],
  );

  /** 60 FPS — tylko projekcja displayArcM → lat/lng na krzywej (bez LERP). */
  const frameCallback = useFrameCallback((frameInfo) => {
    'worklet';
    if (enabledSv.value < 0.5 || bootstrapped.value < 0.5) return;

    if (skipCatchUpSv.value >= 0.5) {
      skipCatchUpSv.value = 0;
      lastFrameTimestamp.value = frameInfo.timestamp;
      return;
    }

    lastFrameTimestamp.value = frameInfo.timestamp;

    const blend = clampWorklet(roadBlendSv.value, 0, 1);
    const onRoad = onRoadSv.value >= 0.5 && blend > ON_ROAD_BLEND_EPS;
    const pts = roadPtsFlat.value;
    const cum = roadCumM.value;
    const hasArc = pts.length >= 4 && cum.length >= 2;

    if (onRoad && hasArc && Number.isFinite(displayArcM.value)) {
      const localM = displayArcM.value - baseArcM.value;
      const roadPose = pointAtWindowArcLocal(pts, cum, localM);
      if (Number.isFinite(roadPose.lat) && Number.isFinite(roadPose.lng)) {
        lat.value = roadPose.lat;
        lng.value = roadPose.lng;
      }
    }
  }, false);

  const pushTarget = useCallback((target: NavigationTarget) => {
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
    lastTargetJsRef.current = target;

    const tgtHdg = safeHeadingJs(target.headingDeg, safeHeadingJs(heading.value, 0));

    const onRoad = pathModeOnRoad(target.pathMode) && target.roadBlend > ON_ROAD_BLEND_EPS;
    const blend = Math.max(0, Math.min(1, target.roadBlend));
    const feedSpeed = Number.isFinite(target.speedMs) && target.speedMs > 0 ? target.speedMs : 0;
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
    if (onRoad && prevBlend >= ON_ROAD_FULL_BLEND) {
      roadBlendSv.value = Math.max(blend, ON_ROAD_FULL_BLEND);
    } else if (prevBlend > ON_ROAD_BLEND_EPS && blend > ON_ROAD_BLEND_EPS) {
      roadBlendSv.value = Math.max(blend, prevBlend * 0.88);
    } else {
      roadBlendSv.value = blend;
    }

    const arcFeed = onRoad && target.arcWindow && target.polylineKey
      ? packArcWindowFeed(target.arcWindow, target.polylineKey)
      : null;
    const useArc = onRoad
      && arcFeed != null
      && target.targetArcM != null
      && Number.isFinite(target.targetArcM);

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
          blend,
        );
        const poseHdg = lookAheadHeadingJs(
          arcFeed.ptsFlat,
          arcFeed.cumM,
          localM,
          blended.lat,
          blended.lng,
          tgtHdg,
        );
        const instantHdg = onRoad && blend > ON_ROAD_BLEND_EPS ? poseHdg : tgtHdg;
        applyInstantPose(
          blended.lat,
          blended.lng,
          instantHdg,
          arcM,
          true,
          blend,
          rawLat,
          rawLng,
        );
      } else {
        onRoadSv.value = 0;
        applyInstantPose(target.lat, target.lng, tgtHdg, 0, false, blend, target.rawLat, target.rawLng);
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
              blend,
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
            const snappedHdg = blend > ON_ROAD_BLEND_EPS ? poseHdg : tgtHdg;
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
      isBootstrapped,
      pushTarget,
      reset,
      resetTo,
      ensureFrameActive,
      resumeFromBackground,
    }),
    [ensureFrameActive, heading, isBootstrapped, lat, lng, pushTarget, reset, resetTo, resumeFromBackground],
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
