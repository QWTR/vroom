import { useCallback, useEffect } from 'react';
import {
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

export type DriveMarkerValues = {
  lat: SharedValue<number>;
  lng: SharedValue<number>;
  heading: SharedValue<number>;
};

export type DriveMarkerTarget = {
  lat: number;
  lng: number;
  heading: number;
  durationMs?: number;
  speedMs?: number;
};

const MIN_DR_SPEED_MS = 0.08;
const CRUISE_HOLD_MS = 0.22;
const CRUISE_DECAY_PER_SEC = 0.12;
const GPS_STALE_MS = 2800;
const MAX_DR_STEP_M = 4.5;
const HEADING_BLEND_PER_FRAME = 0.22;
const LERP_MIN_MS = 280;
const LERP_MAX_MS = 1200;

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

function safeDurationMsJs(ms: number | undefined): number {
  const v = ms ?? 650;
  if (!Number.isFinite(v) || v <= 0) return 650;
  return Math.max(LERP_MIN_MS, Math.min(LERP_MAX_MS, v));
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
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

function lerpProgressWorklet(
  nowMs: number,
  startMs: number,
  durationMs: number,
): number {
  'worklet';
  let dur = clampMs(durationMs);
  if (!Number.isFinite(dur) || dur <= 0) {
    return 1;
  }
  if (!Number.isFinite(startMs) || startMs <= 0) {
    return 1;
  }
  let elapsed = nowMs - startMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    elapsed = 0;
  }
  let t = elapsed / dur;
  if (!Number.isFinite(t) || dur <= 0) {
    t = 1;
  }
  return Math.min(1, Math.max(0, t));
}

/**
 * Marker V2 — LERP w worklecie (durationMs) + DR po zakończeniu segmentu.
 */
export function useDriveMarker(
  enabled: boolean,
  getTripActive?: () => boolean,
): DriveMarkerValues & {
  pushTarget: (t: DriveMarkerTarget) => void;
  setCruiseSpeed: (speedMs: number) => void;
  reset: (anchor?: { lat: number; lng: number; heading?: number }) => void;
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

  const pushTarget = useCallback((t: DriveMarkerTarget) => {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) return;

    const incomingMs = Number.isFinite(t.speedMs) ? Math.max(0, t.speedMs!) : 0;
    lastGpsPushMsSv.value = Date.now();

    if (incomingMs >= MIN_DR_SPEED_MS) {
      speedMsSv.value = incomingMs;
      cruiseSpeedMsSv.value = incomingMs;
    } else if (cruiseSpeedMsSv.value >= CRUISE_HOLD_MS) {
      speedMsSv.value = cruiseSpeedMsSv.value;
    } else {
      speedMsSv.value = 0;
    }

    const tgtHdg = Number.isFinite(t.heading) ? t.heading : heading.value;
    const dur = safeDurationMsJs(t.durationMs);

    const needsBootstrap = !Number.isFinite(lat.value) || !Number.isFinite(lng.value);
    if (needsBootstrap) {
      lat.value = t.lat;
      lng.value = t.lng;
      heading.value = tgtHdg;
      lerpActive.value = 0;
      return;
    }

    const fromLa = lat.value;
    const fromLn = lng.value;
    const errM = haversineMJs(fromLa, fromLn, t.lat, t.lng);

    lerpFromLat.value = fromLa;
    lerpFromLng.value = fromLn;
    lerpFromHdg.value = heading.value;
    lerpToLat.value = t.lat;
    lerpToLng.value = t.lng;
    lerpToHdg.value = tgtHdg;
    lerpDurationMs.value = dur;
    lerpStartMs.value = Date.now();

    if (errM < 0.2) {
      lat.value = t.lat;
      lng.value = t.lng;
      heading.value = tgtHdg;
      lerpActive.value = 0;
      return;
    }

    lerpActive.value = 1;
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

  const tripActive = useCallback(() => {
    if (getTripActive) return getTripActive();
    return enabled;
  }, [enabled, getTripActive]);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    if (enabledSv.value < 0.5) return;
    if (!Number.isFinite(lat.value) || !Number.isFinite(lng.value)) return;

    const dtSec = Math.max(
      0.001,
      Math.min(0.05, (frame.timeSincePreviousFrame ?? 16.67) / 1000),
    );
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
        const durationMs = lerpDurationMs.value;
        let t = lerpProgressWorklet(nowMs, lerpStartMs.value, durationMs);

        if (!Number.isFinite(t) || durationMs <= 0 || t >= 1) {
          t = 1;
        }

        const segM = haversineMWorklet(fromLa, fromLn, toLa, toLn);
        if (segM < 0.15) {
          t = 1;
        }

        if (t >= 1) {
          lat.value = toLa;
          lng.value = toLn;
          heading.value = lerpToHdg.value;
          lerpActive.value = 0;
        } else {
          lat.value = fromLa + (toLa - fromLa) * t;
          lng.value = fromLn + (toLn - fromLn) * t;
          const dH = headingDeltaW(lerpFromHdg.value, lerpToHdg.value);
          heading.value = normalizeHeadingW(lerpFromHdg.value + dH * t);
        }
      }
    } else {
      const sinceGpsMs = nowMs - lastGpsPushMsSv.value;
      let drSpeed = speedMsSv.value;

      if (drSpeed < MIN_DR_SPEED_MS && cruiseSpeedMsSv.value >= CRUISE_HOLD_MS) {
        if (sinceGpsMs < GPS_STALE_MS) {
          const decay = Math.max(0.35, 1 - (sinceGpsMs / 1000) * CRUISE_DECAY_PER_SEC);
          drSpeed = cruiseSpeedMsSv.value * decay;
        }
      }

      if (drSpeed >= MIN_DR_SPEED_MS) {
        const stepM = Math.min(MAX_DR_STEP_M, drSpeed * dtSec);
        const hdgRad = (heading.value * Math.PI) / 180;
        lat.value += metersToLatDelta(stepM * Math.cos(hdgRad));
        lng.value += metersToLngDelta(stepM * Math.sin(hdgRad), lat.value);
      } else {
        const hdgErr = Math.abs(headingDeltaW(heading.value, lerpToHdg.value));
        if (hdgErr > 1.5) {
          const hdgAlpha = Math.min(HEADING_BLEND_PER_FRAME, hdgErr / 180);
          const d = headingDeltaW(heading.value, lerpToHdg.value);
          heading.value = normalizeHeadingW(heading.value + d * hdgAlpha);
        }
      }
    }
  }, false);

  useEffect(() => {
    const syncActive = () => {
      const on = tripActive();
      enabledSv.value = on ? 1 : 0;
      frameCallback.setActive(on);
    };
    syncActive();
    const id = setInterval(syncActive, 200);
    return () => {
      clearInterval(id);
      frameCallback.setActive(false);
    };
  }, [tripActive, frameCallback, enabledSv]);

  return { lat, lng, heading, pushTarget, setCruiseSpeed, reset };
}
