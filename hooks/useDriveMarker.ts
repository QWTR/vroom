import { useCallback, useEffect, useMemo } from 'react';
import {
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  guardMarkerHeadingPush,
  TRAVEL_VECTOR_LOCK_SPEED_KMH,
} from '../lib/driveCore/travelHeading';

/** ADB: `adb logcat | grep DEBUG_WORKLET` (działa też na produkcji). */
const DRIVE_V2_PIPELINE_DEBUG = true;

export type DriveMarkerValues = {
  lat: SharedValue<number>;
  lng: SharedValue<number>;
  heading: SharedValue<number>;
  /** Ostatni segment GPS (ms) — synchronizacja kamery Mapbox. */
  segmentDurationMs: SharedValue<number>;
};

export type DriveMarkerTarget = {
  lat: number;
  lng: number;
  heading: number;
  durationMs?: number;
  speedMs?: number;
  /** Prędkość HUD (km/h) — guardy kierunku, NIE ekstrapolacja po skosie. */
  hudKmh?: number;
  /** Między tickami GPS: lekki ruch wzdłuż headingu (domyślnie wł.). */
  allowExtrapolation?: boolean;
  /** Jawny instant snap (bootstrap/resume) — durationMs=0 + allowInstant. */
  allowInstant?: boolean;
  /** @deprecated Ignorowane — heading zawsze LERP (najkrótsza droga na okręgu). */
  syncHeading?: boolean;
  /** Ease-out quad na pozycji (płynny catchup snap-to-road). */
  easeOutPosition?: boolean;
};

const MIN_DR_SPEED_MS = 0.08;
const CRUISE_HOLD_MS = 0.22;
const CRUISE_EXTRAP_MAX_MS = 900;
const MAX_DR_STEP_M = 6;
const HEADING_MAX_STEP_PER_FRAME_DEG = 2.8;
const HEADING_FREEZE_SPEED_KMH = 5;
const MOVEMENT_HEADING_MIN_SPEED_KMH = TRAVEL_VECTOR_LOCK_SPEED_KMH;
const MOVEMENT_HEADING_MIN_SEG_M = 0.35;
const HEADING_FLIP_REJECT_DEG = 92;
const IMPLIED_SPEED_CAP_MARGIN_KMH = 38;
const MAX_FRAME_DT_SEC = 0.05;
function logWorkletSegmentStart(payload: Record<string, unknown>): void {
  if (!DRIVE_V2_PIPELINE_DEBUG) return;
  console.log('[DEBUG_WORKLET]', payload);
}

function headingDeltaJs(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

const LERP_MIN_MS = 200;
const LERP_MAX_MS = 1200;

/** Nigdy NaN/undefined/0 w trakcie jazdy (chyba że jawny instant bootstrap). */
function clampSegmentDurationMs(ms: number | undefined, allowInstant: boolean): number {
  if (allowInstant && ms === 0) return 0;
  const v = Number.isFinite(ms) && (ms as number) > 0 ? (ms as number) : 650;
  return Math.max(LERP_MIN_MS, Math.min(LERP_MAX_MS, v));
}

function normalizeHeadingW(h: number): number {
  'worklet';
  return ((h % 360) + 360) % 360;
}

function headingDeltaW(from: number, to: number): number {
  'worklet';
  return ((to - from + 540) % 360) - 180;
}

function metersToLatDelta(m: number): number {
  'worklet';
  return (m / 6371000) * (180 / Math.PI);
}

function metersToLngDelta(m: number, lat: number): number {
  'worklet';
  const cos = Math.cos((lat * Math.PI) / 180);
  return cos > 1e-6 ? metersToLatDelta(m) / cos : 0;
}

function clampMs(ms: number): number {
  'worklet';
  if (!Number.isFinite(ms) || ms <= 0) {
    return LERP_MIN_MS;
  }
  return Math.max(LERP_MIN_MS, Math.min(LERP_MAX_MS, ms));
}

function haversineMWorklet(aLat: number, aLng: number, bLat: number, bLng: number): number {
  'worklet';
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingBetweenWorklet(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  'worklet';
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1R = (lat1 * Math.PI) / 180;
  const lat2R = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x =
    Math.cos(lat1R) * Math.sin(lat2R)
    - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return normalizeHeadingW((Math.atan2(y, x) * 180) / Math.PI);
}

function stepHeadingLinearWorklet(current: number, target: number, maxStepDeg: number): number {
  'worklet';
  const d = headingDeltaW(current, target);
  const step = Math.max(-maxStepDeg, Math.min(maxStepDeg, d));
  return normalizeHeadingW(current + step);
}

function easeOutQuadWorklet(t: number): number {
  'worklet';
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) * (1 - x);
}

function lerpProgressWorklet(
  nowMs: number,
  startMs: number,
  durationMs: number,
  easeOut: boolean,
): number {
  'worklet';
  let dur = clampMs(durationMs);
  if (!Number.isFinite(dur) || dur <= 0) {
    dur = LERP_MIN_MS;
  }
  if (!Number.isFinite(startMs) || startMs <= 0) {
    return 1;
  }
  let elapsed = nowMs - startMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    elapsed = 0;
  }
  let t = elapsed / dur;
  if (!Number.isFinite(t)) {
    t = 1;
  }
  t = Math.min(1, Math.max(0, t));
  return easeOut ? easeOutQuadWorklet(t) : t;
}

/** Heading docelowy po najkrótszej drodze na okręgu (0–360). */
function resolveShortestArcTargetWorklet(from: number, to: number): number {
  'worklet';
  const diff = headingDeltaW(from, to);
  return normalizeHeadingW(from + diff);
}

function applyCappedSegmentPositionWorklet(
  curLat: number,
  curLng: number,
  fromLa: number,
  fromLn: number,
  toLa: number,
  toLn: number,
  t: number,
  segM: number,
  realSpeedKmh: number,
  dtSec: number,
): { lat: number; lng: number; remainM: number; posT: number } {
  'worklet';
  const idealLat = fromLa + (toLa - fromLa) * t;
  const idealLng = fromLn + (toLn - fromLn) * t;
  const maxImpliedKmh = Math.max(realSpeedKmh + IMPLIED_SPEED_CAP_MARGIN_KMH, 8);
  const maxStepM = (maxImpliedKmh / 3.6) * dtSec;
  let nextLat = idealLat;
  let nextLng = idealLng;
  const stepM = haversineMWorklet(curLat, curLng, idealLat, idealLng);
  if (stepM > maxStepM && maxStepM > 0.002) {
    const frac = maxStepM / stepM;
    nextLat = curLat + (idealLat - curLat) * frac;
    nextLng = curLng + (idealLng - curLng) * frac;
  }
  const remainM = haversineMWorklet(nextLat, nextLng, toLa, toLn);
  const posT = segM > 0.15
    ? Math.min(1, Math.max(0, 1 - remainM / segM))
    : t;
  return { lat: nextLat, lng: nextLng, remainM, posT };
}

function applySegmentHeadingWorklet(
  fromHdg: number,
  toHdg: number,
  t: number,
  speedKmh: number,
  fromLa: number,
  fromLn: number,
  toLa: number,
  toLn: number,
  segM: number,
): number {
  'worklet';
  if (speedKmh < HEADING_FREEZE_SPEED_KMH) {
    return normalizeHeadingW(fromHdg);
  }
  const toResolved = resolveShortestArcTargetWorklet(fromHdg, toHdg);
  let hdgAtT = normalizeHeadingW(fromHdg + headingDeltaW(fromHdg, toResolved) * t);
  if (speedKmh >= MOVEMENT_HEADING_MIN_SPEED_KMH && segM >= MOVEMENT_HEADING_MIN_SEG_M && t < 1) {
    const segHdg = bearingBetweenWorklet(fromLa, fromLn, toLa, toLn);
    if (Math.abs(headingDeltaW(segHdg, toResolved)) <= 28) {
      hdgAtT = normalizeHeadingW(fromHdg + headingDeltaW(fromHdg, segHdg) * t);
    }
  }
  return t >= 1 ? toResolved : hdgAtT;
}

function applyInstantPose(
  targetLat: number,
  targetLng: number,
  tgtHdg: number,
  sv: {
    lat: SharedValue<number>;
    lng: SharedValue<number>;
    heading: SharedValue<number>;
    lastFrameLat: SharedValue<number>;
    lastFrameLng: SharedValue<number>;
    lerpFromLat: SharedValue<number>;
    lerpFromLng: SharedValue<number>;
    lerpToLat: SharedValue<number>;
    lerpToLng: SharedValue<number>;
    lerpFromHdg: SharedValue<number>;
    lerpToHdg: SharedValue<number>;
    lerpActive: SharedValue<number>;
  },
): void {
  sv.lat.value = targetLat;
  sv.lng.value = targetLng;
  sv.heading.value = tgtHdg;
  sv.lastFrameLat.value = targetLat;
  sv.lastFrameLng.value = targetLng;
  sv.lerpFromLat.value = targetLat;
  sv.lerpFromLng.value = targetLng;
  sv.lerpToLat.value = targetLat;
  sv.lerpToLng.value = targetLng;
  sv.lerpFromHdg.value = tgtHdg;
  sv.lerpToHdg.value = tgtHdg;
  sv.lerpActive.value = 0;
}

/**
 * Marker V2 — gate-free LERP: każdy pushTarget z finite coords uruchamia ruch.
 */
export function useDriveMarker(
  enabled: boolean,
  getTripActive?: () => boolean,
): DriveMarkerValues & {
  pushTarget: (t: DriveMarkerTarget) => void;
  setCruiseSpeed: (speedMs: number) => void;
  reset: (anchor?: { lat: number; lng: number; heading?: number }) => void;
  resetTo: (lat: number, lng: number, heading: number) => void;
  ensureFrameActive: () => void;
} {
  const lat = useSharedValue(NaN);
  const lng = useSharedValue(NaN);
  const heading = useSharedValue(0);
  const speedMsSv = useSharedValue(0);
  const cruiseSpeedMsSv = useSharedValue(0);
  const lastGpsPushMsSv = useSharedValue(0);
  const enabledSv = useSharedValue(enabled ? 1 : 0);

  const lerpActive = useSharedValue(0);
  const lerpFromLat = useSharedValue(NaN);
  const lerpFromLng = useSharedValue(NaN);
  const lerpToLat = useSharedValue(NaN);
  const lerpToLng = useSharedValue(NaN);
  const lerpFromHdg = useSharedValue(0);
  const lerpToHdg = useSharedValue(0);
  const lerpStartMs = useSharedValue(0);
  const lerpDurationMs = useSharedValue(650);
  const segmentDurationMs = useSharedValue(650);
  const lastFrameLat = useSharedValue(NaN);
  const lastFrameLng = useSharedValue(NaN);
  const allowExtrapolationSv = useSharedValue(1);
  const lerpEaseOutSv = useSharedValue(0);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    if (enabledSv.value < 0.5) return;
    if (!Number.isFinite(lat.value) || !Number.isFinite(lng.value)) return;

    const nowMs = Date.now();

    if (lerpActive.value > 0.5) {
      const fromLa = lerpFromLat.value;
      const fromLn = lerpFromLng.value;
      const toLa = lerpToLat.value;
      const toLn = lerpToLng.value;

      if (
        !Number.isFinite(fromLa)
        || !Number.isFinite(fromLn)
        || !Number.isFinite(toLa)
        || !Number.isFinite(toLn)
      ) {
        lerpActive.value = 0;
      } else {
        const rawDur = lerpDurationMs.value;
        const durationMs = !Number.isFinite(rawDur) || rawDur <= 0 ? LERP_MIN_MS : rawDur;
        let t = lerpProgressWorklet(nowMs, lerpStartMs.value, durationMs, false);

        if (!Number.isFinite(t) || t >= 1) {
          t = 1;
        }

        const segM = haversineMWorklet(fromLa, fromLn, toLa, toLn);
        if (segM < 0.15) {
          t = 1;
        }

        const speedKmh = speedMsSv.value * 3.6;
        const dtSec = Math.max(
          0.001,
          Math.min(MAX_FRAME_DT_SEC, (frame.timeSincePreviousFrame ?? 16) / 1000),
        );
        const capped = applyCappedSegmentPositionWorklet(
          lat.value,
          lng.value,
          fromLa,
          fromLn,
          toLa,
          toLn,
          t,
          segM,
          speedKmh,
          dtSec,
        );
        lat.value = capped.lat;
        lng.value = capped.lng;
        heading.value = applySegmentHeadingWorklet(
          lerpFromHdg.value,
          lerpToHdg.value,
          capped.posT,
          speedKmh,
          fromLa,
          fromLn,
          toLa,
          toLn,
          segM,
        );
        if (capped.remainM < 0.15) {
          lat.value = toLa;
          lng.value = toLn;
          heading.value = applySegmentHeadingWorklet(
            lerpFromHdg.value,
            lerpToHdg.value,
            1,
            speedKmh,
            fromLa,
            fromLn,
            toLa,
            toLn,
            segM,
          );
          lerpActive.value = 0;
        } else if (t >= 1) {
          const chaseImpliedMs = (capped.remainM / Math.max((speedKmh + IMPLIED_SPEED_CAP_MARGIN_KMH) / 3.6, 2.5)) * 1000;
          lerpFromLat.value = capped.lat;
          lerpFromLng.value = capped.lng;
          lerpFromHdg.value = heading.value;
          lerpStartMs.value = nowMs;
          lerpDurationMs.value = Math.max(LERP_MIN_MS, Math.min(LERP_MAX_MS, chaseImpliedMs));
        }
      }
    } else {
      const speedMs = speedMsSv.value;
      const staleMs = nowMs - lastGpsPushMsSv.value;
      if (
        allowExtrapolationSv.value > 0.5
        && speedMs >= 0.5
        && speedMsSv.value * 3.6 >= 4.5
        && staleMs > 0
        && staleMs <= CRUISE_EXTRAP_MAX_MS
      ) {
        const dtSec = Math.min(
          0.05,
          Math.max(0.001, (frame.timeSincePreviousFrame ?? 16) / 1000),
        );
        const stepM = Math.min(MAX_DR_STEP_M, speedMs * dtSec);
        if (stepM > 0.008) {
          const hdgRad = (heading.value * Math.PI) / 180;
          lat.value = lat.value + metersToLatDelta(stepM * Math.cos(hdgRad));
          lng.value = lng.value + metersToLngDelta(stepM * Math.sin(hdgRad), lat.value);
        }
      }
      lastFrameLat.value = lat.value;
      lastFrameLng.value = lng.value;
      const idleSpeedKmh = speedMsSv.value * 3.6;
      if (idleSpeedKmh >= HEADING_FREEZE_SPEED_KMH) {
        const hdgErr = Math.abs(headingDeltaW(heading.value, lerpToHdg.value));
        if (hdgErr > 1.5) {
          const idleAlpha = Math.min(0.22, HEADING_MAX_STEP_PER_FRAME_DEG / Math.max(hdgErr, 8));
          const fromH = heading.value;
          const toH = resolveShortestArcTargetWorklet(fromH, lerpToHdg.value);
          heading.value = normalizeHeadingW(fromH + headingDeltaW(fromH, toH) * idleAlpha);
        }
      }
    }
  }, false);

  const pushTarget = useCallback((t: DriveMarkerTarget) => {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) return;

    const incomingMs = Number.isFinite(t.speedMs) ? Math.max(0, t.speedMs!) : 0;
    const hudKmh = Number.isFinite(t.hudKmh) ? Math.max(0, t.hudKmh!) : incomingMs * 3.6;
    const allowExtrap = t.allowExtrapolation !== false;
    allowExtrapolationSv.value = allowExtrap ? 1 : 0;
    lastGpsPushMsSv.value = Date.now();

    if (incomingMs >= MIN_DR_SPEED_MS && hudKmh >= 4.5) {
      speedMsSv.value = incomingMs;
      if (allowExtrap) {
        cruiseSpeedMsSv.value = incomingMs;
      }
    } else if (allowExtrap && cruiseSpeedMsSv.value >= CRUISE_HOLD_MS && hudKmh >= 5.5) {
      speedMsSv.value = cruiseSpeedMsSv.value;
    } else {
      speedMsSv.value = incomingMs;
      cruiseSpeedMsSv.value = incomingMs >= MIN_DR_SPEED_MS ? incomingMs : 0;
      if (!allowExtrap || hudKmh < 4) {
        cruiseSpeedMsSv.value = 0;
      }
    }

    const speedKmh = hudKmh > 0 ? hudKmh : speedMsSv.value * 3.6;
    const fromHdg = Number.isFinite(heading.value) ? heading.value : 0;
    let tgtHdg = Number.isFinite(t.heading) ? t.heading : fromHdg;
    if (speedKmh >= HEADING_FREEZE_SPEED_KMH && Number.isFinite(fromHdg)) {
      tgtHdg = guardMarkerHeadingPush(fromHdg, tgtHdg, speedKmh);
      const diff = headingDeltaJs(fromHdg, tgtHdg);
      tgtHdg = ((fromHdg + diff) % 360 + 360) % 360;
    } else {
      tgtHdg = ((fromHdg % 360) + 360) % 360;
    }

    const allowInstant = t.allowInstant === true;
    const segDur = clampSegmentDurationMs(t.durationMs, allowInstant);
    lerpEaseOutSv.value = 0;
    const poseSv = {
      lat,
      lng,
      heading,
      lastFrameLat,
      lastFrameLng,
      lerpFromLat,
      lerpFromLng,
      lerpToLat,
      lerpToLng,
      lerpFromHdg,
      lerpToHdg,
      lerpActive,
    };

    if (!Number.isFinite(lat.value) || !Number.isFinite(lng.value)) {
      applyInstantPose(t.lat, t.lng, tgtHdg, poseSv);
      segmentDurationMs.value = segDur > 0 ? segDur : LERP_MIN_MS;
      logWorkletSegmentStart({
        mode: 'instant_bootstrap',
        lerpDurationMs: segDur > 0 ? segDur : LERP_MIN_MS,
        hdgDeltaDeg: Number.isFinite(heading.value)
          ? Math.round(Math.abs(headingDeltaJs(heading.value, tgtHdg)))
          : null,
        deadReckoningEnabled: allowExtrap && incomingMs >= MIN_DR_SPEED_MS,
        allowInstant: true,
        easeOut: t.easeOutPosition === true,
      });
      return;
    }

    if (allowInstant && segDur === 0) {
      applyInstantPose(t.lat, t.lng, tgtHdg, poseSv);
      segmentDurationMs.value = LERP_MIN_MS;
      logWorkletSegmentStart({
        mode: 'instant_allowInstant',
        lerpDurationMs: LERP_MIN_MS,
        hdgDeltaDeg: Number.isFinite(heading.value)
          ? Math.round(Math.abs(headingDeltaJs(heading.value, tgtHdg)))
          : null,
        deadReckoningEnabled: allowExtrap && incomingMs >= MIN_DR_SPEED_MS,
        allowInstant: true,
        easeOut: t.easeOutPosition === true,
      });
      return;
    }

    const fromLaSnap = lat.value;
    const fromLnSnap = lng.value;
    const fromHdgSnap = heading.value;
    segmentDurationMs.value = segDur;
    lerpDurationMs.value = segDur;
    lerpFromLat.value = fromLaSnap;
    lerpFromLng.value = fromLnSnap;
    lerpToLat.value = t.lat;
    lerpToLng.value = t.lng;
    lerpToHdg.value = tgtHdg;
    lerpFromHdg.value = fromHdgSnap;
    lerpStartMs.value = Date.now();
    lerpActive.value = 1;
    logWorkletSegmentStart({
      mode: 'lerp_segment_start',
      lerpDurationMs: segDur,
      hdgDeltaDeg: Number.isFinite(fromHdgSnap)
        ? Math.round(Math.abs(headingDeltaJs(fromHdgSnap, tgtHdg)))
        : null,
      deadReckoningEnabled:
        allowExtrap
        && (incomingMs >= MIN_DR_SPEED_MS || cruiseSpeedMsSv.value >= CRUISE_HOLD_MS),
      allowInstant: false,
      easeOut: false,
      headingFrozen: speedKmh < HEADING_FREEZE_SPEED_KMH,
      posDeltaM: Number.isFinite(fromLaSnap) && Number.isFinite(fromLnSnap)
        ? Math.round(
          Math.hypot(
            (t.lat - fromLaSnap) * 111320,
            (t.lng - fromLnSnap) * 111320 * Math.cos((fromLaSnap * Math.PI) / 180),
          ) * 10,
        ) / 10
        : null,
    });
  }, [
    allowExtrapolationSv,
    cruiseSpeedMsSv,
    heading,
    lastFrameLat,
    lastFrameLng,
    lastGpsPushMsSv,
    lat,
    lng,
    lerpActive,
    lerpDurationMs,
    lerpEaseOutSv,
    lerpFromHdg,
    lerpFromLat,
    lerpFromLng,
    lerpStartMs,
    lerpToHdg,
    lerpToLat,
    lerpToLng,
    segmentDurationMs,
    speedMsSv,
  ]);

  const setCruiseSpeed = useCallback((speedMs: number) => {
    const ms = Math.max(0, speedMs);
    if (ms >= MIN_DR_SPEED_MS) {
      speedMsSv.value = ms;
      cruiseSpeedMsSv.value = ms;
      lastGpsPushMsSv.value = Date.now();
    }
  }, [cruiseSpeedMsSv, lastGpsPushMsSv, speedMsSv]);

  const reset = useCallback((anchor?: { lat: number; lng: number; heading?: number }) => {
    speedMsSv.value = 0;
    cruiseSpeedMsSv.value = 0;
    lastGpsPushMsSv.value = 0;
    lerpActive.value = 0;

    if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
      lat.value = anchor.lat;
      lng.value = anchor.lng;
      heading.value = Number.isFinite(anchor.heading) ? anchor.heading! : 0;
      lastFrameLat.value = anchor.lat;
      lastFrameLng.value = anchor.lng;
      lastGpsPushMsSv.value = Date.now();
    } else {
      lat.value = NaN;
      lng.value = NaN;
      heading.value = 0;
    }
  }, [
    cruiseSpeedMsSv,
    heading,
    lastGpsPushMsSv,
    lat,
    lerpActive,
    lng,
    speedMsSv,
  ]);

  const resetTo = useCallback((targetLat: number, targetLng: number, hdg: number) => {
    if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) return;
    const normHdg = Number.isFinite(hdg) ? ((hdg % 360) + 360) % 360 : 0;
    lat.value = targetLat;
    lng.value = targetLng;
    heading.value = normHdg;
    lastFrameLat.value = targetLat;
    lastFrameLng.value = targetLng;
    speedMsSv.value = 0;
    cruiseSpeedMsSv.value = 0;
    lastGpsPushMsSv.value = Date.now();
    lerpActive.value = 0;
    lerpFromLat.value = targetLat;
    lerpFromLng.value = targetLng;
    lerpToLat.value = targetLat;
    lerpToLng.value = targetLng;
    lerpFromHdg.value = normHdg;
    lerpToHdg.value = normHdg;
    lerpStartMs.value = Date.now();
    lerpDurationMs.value = LERP_MIN_MS;
    segmentDurationMs.value = LERP_MIN_MS;
  }, [
    cruiseSpeedMsSv,
    heading,
    lastGpsPushMsSv,
    lat,
    lng,
    lerpActive,
    lerpDurationMs,
    lerpFromHdg,
    lerpFromLat,
    lerpFromLng,
    lerpStartMs,
    lerpToHdg,
    lerpToLat,
    lerpToLng,
    speedMsSv,
  ]);

  const tripActive = useCallback(() => {
    if (getTripActive) return getTripActive();
    return enabled;
  }, [enabled, getTripActive]);

  const ensureFrameActive = useCallback(() => {
    if (!tripActive()) return;
    enabledSv.value = 1;
    frameCallback.setActive(true);
  }, [tripActive, frameCallback, enabledSv]);

  useEffect(() => {
    const syncActive = () => {
      const on = tripActive();
      enabledSv.value = on ? 1 : 0;
      frameCallback.setActive(on);
    };
    syncActive();
    return () => {
      frameCallback.setActive(false);
    };
  }, [tripActive, frameCallback, enabledSv]);

  return useMemo(
    () => ({
      lat,
      lng,
      heading,
      segmentDurationMs,
      pushTarget,
      setCruiseSpeed,
      reset,
      resetTo,
      ensureFrameActive,
    }),
    [
      heading,
      lat,
      lng,
      pushTarget,
      reset,
      resetTo,
      ensureFrameActive,
      segmentDurationMs,
      setCruiseSpeed,
    ],
  );
}
