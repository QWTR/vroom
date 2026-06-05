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
import { visionFrame } from '../lib/driveVisionTrace';
import { DRIVE_FULL_VISION_LOG } from '../lib/driveLogConfig';

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
  /** Wyrównaj SV heading do snapu (kamera + MarkerView — bez LERP 275°). */
  syncHeading?: boolean;
};

const MIN_DR_SPEED_MS = 0.08;
const CRUISE_HOLD_MS = 0.22;
const CRUISE_EXTRAP_MAX_MS = 900;
const MAX_DR_STEP_M = 3;
const HEADING_MAX_STEP_PER_FRAME_DEG = 2.8;
const MOVEMENT_HEADING_MIN_SPEED_KMH = TRAVEL_VECTOR_LOCK_SPEED_KMH;
const MOVEMENT_HEADING_MIN_SEG_M = 0.35;
const HEADING_FLIP_REJECT_DEG = 92;
const LERP_MIN_MS = 280;
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

function lerpProgressWorklet(
  nowMs: number,
  startMs: number,
  durationMs: number,
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
  return Math.min(1, Math.max(0, t));
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
        let t = lerpProgressWorklet(nowMs, lerpStartMs.value, durationMs);

        if (!Number.isFinite(t) || t >= 1) {
          t = 1;
        }

        const segM = haversineMWorklet(fromLa, fromLn, toLa, toLn);
        if (segM < 0.15) {
          t = 1;
        }

        const speedKmh = speedMsSv.value * 3.6;
        const dH = headingDeltaW(lerpFromHdg.value, lerpToHdg.value);
        let targetHdg = normalizeHeadingW(lerpFromHdg.value + dH * (t >= 1 ? 1 : t));
        if (speedKmh >= 5 && segM >= MOVEMENT_HEADING_MIN_SEG_M) {
          const segHdg = bearingBetweenWorklet(fromLa, fromLn, toLa, toLn);
          if (Math.abs(headingDeltaW(segHdg, lerpToHdg.value)) <= 28) {
            targetHdg = segHdg;
          }
        }
        if (t >= 1) {
          lat.value = toLa;
          lng.value = toLn;
          const flipToPipeline = Math.abs(headingDeltaW(heading.value, lerpToHdg.value));
          if (flipToPipeline >= HEADING_FLIP_REJECT_DEG && speedKmh >= 8) {
            heading.value = lerpToHdg.value;
          } else {
            const flip = Math.abs(headingDeltaW(heading.value, targetHdg));
            heading.value = flip >= HEADING_FLIP_REJECT_DEG && speedKmh >= 8
              ? stepHeadingLinearWorklet(heading.value, lerpToHdg.value, HEADING_MAX_STEP_PER_FRAME_DEG * 2.5)
              : stepHeadingLinearWorklet(
                heading.value,
                targetHdg,
                HEADING_MAX_STEP_PER_FRAME_DEG * (t >= 1 ? 1.4 : 1),
              );
          }
          lerpActive.value = 0;
        } else {
          lat.value = fromLa + (toLa - fromLa) * t;
          lng.value = fromLn + (toLn - fromLn) * t;
          heading.value = stepHeadingLinearWorklet(
            heading.value,
            targetHdg,
            HEADING_MAX_STEP_PER_FRAME_DEG,
          );
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
      const hdgErr = Math.abs(headingDeltaW(heading.value, lerpToHdg.value));
      if (hdgErr > 1.5) {
        heading.value = stepHeadingLinearWorklet(
          heading.value,
          lerpToHdg.value,
          HEADING_MAX_STEP_PER_FRAME_DEG * 0.85,
        );
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
    let tgtHdg = Number.isFinite(t.heading) ? t.heading : heading.value;
    if (Number.isFinite(heading.value)) {
      tgtHdg = guardMarkerHeadingPush(heading.value, tgtHdg, speedKmh);
    }

    const allowInstant = t.allowInstant === true;
    const headingFlipDeg = Number.isFinite(heading.value)
      ? Math.abs(headingDeltaW(heading.value, tgtHdg))
      : 0;
    const snapHeadingOnly = (t.syncHeading === true || headingFlipDeg >= HEADING_FLIP_REJECT_DEG)
      && speedKmh >= 8
      && headingFlipDeg >= 28;
    const segDur = clampSegmentDurationMs(t.durationMs, allowInstant);
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
      return;
    }

    if (allowInstant && segDur === 0) {
      applyInstantPose(t.lat, t.lng, tgtHdg, poseSv);
      segmentDurationMs.value = LERP_MIN_MS;
      return;
    }

    const fromLa = lat.value;
    const fromLn = lng.value;
    segmentDurationMs.value = segDur;
    lerpDurationMs.value = segDur;
    lerpFromLat.value = fromLa;
    lerpFromLng.value = fromLn;
    lerpToLat.value = t.lat;
    lerpToLng.value = t.lng;
    lerpToHdg.value = tgtHdg;
    lerpFromHdg.value = heading.value;
    if (snapHeadingOnly) {
      heading.value = tgtHdg;
      lerpFromHdg.value = tgtHdg;
    }
    lerpStartMs.value = Date.now();
    lerpActive.value = 1;
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
    const id = setInterval(syncActive, 250);
    return () => {
      clearInterval(id);
      frameCallback.setActive(false);
    };
  }, [tripActive, frameCallback, enabledSv]);

  useEffect(() => {
    if (!enabled || !DRIVE_FULL_VISION_LOG) return undefined;
    let lastAt = 0;
    let lastLat = NaN;
    let lastLng = NaN;
    const pollMs = 500;
    const id = setInterval(() => {
      if (!tripActive()) return;
      const svLat = lat.value;
      const svLng = lng.value;
      const svHdg = heading.value;
      if (!Number.isFinite(svLat) || !Number.isFinite(svLng)) return;
      const now = Date.now();
      const frameDtMs = lastAt > 0 ? now - lastAt : pollMs;
      const frameMoveM = Number.isFinite(lastLat) && Number.isFinite(lastLng)
        ? Math.hypot(
          (svLat - lastLat) * 111320,
          (svLng - lastLng) * 111320 * Math.cos((svLat * Math.PI) / 180),
        )
        : 0;
      const impliedKmh = frameDtMs > 0 ? (frameMoveM / (frameDtMs / 1000)) * 3.6 : 0;
      const staleMs = now - lastGpsPushMsSv.value;
      visionFrame({
        layer: 'sv',
        svLat,
        svLng,
        svHdg,
        frameDtMs,
        impliedKmh,
        stuck: staleMs > 2500 && speedMsSv.value * 3.6 >= 5,
        msSinceCommit: staleMs,
      });
      lastAt = now;
      lastLat = svLat;
      lastLng = svLng;
    }, pollMs);
    return () => clearInterval(id);
  }, [enabled, tripActive, lat, lng, heading, lastGpsPushMsSv, speedMsSv]);

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
