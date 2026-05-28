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

/** Minimalna prędkość DR — poniżej tylko przy świadomym postoju. */
const MIN_DR_SPEED_MS = 0.08;
/** Utrzymanie ruchu między tickami GPS (m/s). */
const CRUISE_HOLD_MS = 0.22;
const CRUISE_DECAY_PER_SEC = 0.12;
const GPS_STALE_MS = 2800;
/** Maks. krok DR na klatkę (~60 FPS). */
const MAX_DR_STEP_M = 4.5;
const GPS_BLEND_ALPHA_MIN = 0.07;
const GPS_BLEND_ALPHA_MID = 0.14;
const GPS_BLEND_ALPHA_MAX = 0.28;
const GPS_CORRECT_MIN_ERR_M = 0.35;
const MAX_CORR_PER_FRAME_M = 2.6;
const HEADING_BLEND_PER_FRAME = 0.18;
const MAX_PUSH_STEP_M = 26;

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

function gpsBlendAlphaWorklet(errM: number): number {
  'worklet';
  if (errM > 35) return GPS_BLEND_ALPHA_MAX;
  if (errM > 12) return GPS_BLEND_ALPHA_MID;
  return GPS_BLEND_ALPHA_MIN;
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

export function useDriveMarker(enabled: boolean): DriveMarkerValues & {
  pushTarget: (t: DriveMarkerTarget) => void;
  reset: (anchor?: { lat: number; lng: number; heading?: number }) => void;
} {
  const lat = useSharedValue(NaN);
  const lng = useSharedValue(NaN);
  const heading = useSharedValue(0);
  const speedMsSv = useSharedValue(0);
  const cruiseSpeedMsSv = useSharedValue(0);
  const lastGpsPushMsSv = useSharedValue(0);
  const enabledSv = useSharedValue(enabled ? 1 : 0);

  const gpsLat = useSharedValue(NaN);
  const gpsLng = useSharedValue(NaN);
  const gpsHeading = useSharedValue(0);
  const hasGpsFix = useSharedValue(0);

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

    let tgtLat = t.lat;
    let tgtLng = t.lng;
    const tgtHdg = Number.isFinite(t.heading) ? t.heading : heading.value;

    const needsBootstrap = !Number.isFinite(lat.value) || !Number.isFinite(lng.value);
    if (!needsBootstrap) {
      const errM = haversineMJs(lat.value, lng.value, tgtLat, tgtLng);
      if (errM > MAX_PUSH_STEP_M) {
        const ratio = MAX_PUSH_STEP_M / errM;
        tgtLat = lat.value + (tgtLat - lat.value) * ratio;
        tgtLng = lng.value + (tgtLng - lng.value) * ratio;
      }
    }

    gpsLat.value = tgtLat;
    gpsLng.value = tgtLng;
    gpsHeading.value = tgtHdg;
    hasGpsFix.value = 1;

    if (needsBootstrap) {
      lat.value = tgtLat;
      lng.value = tgtLng;
      heading.value = tgtHdg;
      return;
    }

    const errM = haversineMJs(lat.value, lng.value, tgtLat, tgtLng);
    if (errM > 80) {
      const snap = errM > 35 ? GPS_BLEND_ALPHA_MAX : GPS_BLEND_ALPHA_MID;
      lat.value = lat.value + (tgtLat - lat.value) * Math.min(0.55, snap * 4);
      lng.value = lng.value + (tgtLng - lng.value) * Math.min(0.55, snap * 4);
    }
  }, [
    cruiseSpeedMsSv,
    gpsHeading,
    gpsLat,
    gpsLng,
    hasGpsFix,
    heading,
    lastGpsPushMsSv,
    lat,
    lng,
    speedMsSv,
  ]);

  const reset = useCallback((anchor?: { lat: number; lng: number; heading?: number }) => {
    speedMsSv.value = 0;
    cruiseSpeedMsSv.value = 0;
    lastGpsPushMsSv.value = 0;
    hasGpsFix.value = 0;
    gpsLat.value = NaN;
    gpsLng.value = NaN;
    gpsHeading.value = 0;

    if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
      lat.value = anchor.lat;
      lng.value = anchor.lng;
      heading.value = Number.isFinite(anchor.heading) ? anchor.heading! : 0;
      gpsLat.value = anchor.lat;
      gpsLng.value = anchor.lng;
      gpsHeading.value = heading.value;
      hasGpsFix.value = 1;
      lastGpsPushMsSv.value = Date.now();
    } else {
      lat.value = NaN;
      lng.value = NaN;
      heading.value = 0;
    }
  }, [
    cruiseSpeedMsSv,
    gpsHeading,
    gpsLat,
    gpsLng,
    hasGpsFix,
    heading,
    lastGpsPushMsSv,
    lat,
    lng,
    speedMsSv,
  ]);

  useEffect(() => {
    enabledSv.value = enabled ? 1 : 0;
  }, [enabled, enabledSv]);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    if (enabledSv.value < 0.5) return;
    if (!Number.isFinite(lat.value) || !Number.isFinite(lng.value)) return;

    const dtSec = Math.max(
      0.001,
      Math.min(0.05, (frame.timeSincePreviousFrame ?? 16.67) / 1000),
    );

    const sinceGpsMs = Date.now() - lastGpsPushMsSv.value;
    let drSpeed = speedMsSv.value;

    if (drSpeed < MIN_DR_SPEED_MS && cruiseSpeedMsSv.value >= CRUISE_HOLD_MS) {
      if (sinceGpsMs < GPS_STALE_MS) {
        const decay = Math.max(0.35, 1 - (sinceGpsMs / 1000) * CRUISE_DECAY_PER_SEC);
        drSpeed = cruiseSpeedMsSv.value * decay;
      }
    }

    if (drSpeed >= MIN_DR_SPEED_MS) {
      const stepM = Math.min(MAX_DR_STEP_M, drSpeed * dtSec);
      const drHdg =
        hasGpsFix.value > 0.5 && Number.isFinite(gpsHeading.value)
          ? gpsHeading.value
          : heading.value;
      const hdgRad = (drHdg * Math.PI) / 180;
      lat.value += metersToLatDelta(stepM * Math.cos(hdgRad));
      lng.value += metersToLngDelta(stepM * Math.sin(hdgRad), lat.value);
    }

    if (hasGpsFix.value > 0.5 && Number.isFinite(gpsLat.value) && Number.isFinite(gpsLng.value)) {
      const errM = haversineMWorklet(lat.value, lng.value, gpsLat.value, gpsLng.value);
      if (errM >= GPS_CORRECT_MIN_ERR_M) {
        let alpha = gpsBlendAlphaWorklet(errM);
        const capAlpha = MAX_CORR_PER_FRAME_M / Math.max(errM, 0.5);
        if (alpha > capAlpha) alpha = capAlpha;
        lat.value += (gpsLat.value - lat.value) * alpha;
        lng.value += (gpsLng.value - lng.value) * alpha;
      }
      const hdgErr = Math.abs(headingDeltaW(heading.value, gpsHeading.value));
      if (hdgErr > 1.5) {
        const hdgAlpha = Math.min(HEADING_BLEND_PER_FRAME, hdgErr / 180);
        const d = headingDeltaW(heading.value, gpsHeading.value);
        heading.value = normalizeHeadingW(heading.value + d * hdgAlpha);
      }
    }
  }, false);

  useEffect(() => {
    frameCallback.setActive(enabled);
    return () => {
      frameCallback.setActive(false);
    };
  }, [enabled, frameCallback]);

  return { lat, lng, heading, pushTarget, reset };
}
