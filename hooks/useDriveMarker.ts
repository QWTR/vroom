import { useCallback, useEffect } from 'react';
import {
  cancelAnimation,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  headingDelta,
  normalizeHeading,
  timingHeadingTarget,
} from '../lib/driveCore/travelHeading';

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

const DR_MAX_STEP_M = 2.5;
const DR_GAP_MS = 120;
const HEADING_FRAME_MIN_MOVE_M = 0.08;

function metersToLatDelta(m: number): number {
  return (m / 6371000) * (180 / Math.PI);
}

function metersToLngDelta(m: number, lat: number): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  return cos > 1e-6 ? metersToLatDelta(m) / cos : 0;
}

function bearingDegWorklet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  'worklet';
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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

export function useDriveMarker(enabled: boolean): DriveMarkerValues & {
  pushTarget: (t: DriveMarkerTarget) => void;
  reset: (anchor?: { lat: number; lng: number; heading?: number }) => void;
} {
  const lat = useSharedValue(NaN);
  const lng = useSharedValue(NaN);
  const heading = useSharedValue(0);
  const speedMsSv = useSharedValue(0);
  const lastTargetAt = useSharedValue(0);
  const durationMsSv = useSharedValue(320);
  const enabledSv = useSharedValue(enabled ? 1 : 0);
  const prevFrameLat = useSharedValue(NaN);
  const prevFrameLng = useSharedValue(NaN);

  const pushTarget = useCallback((t: DriveMarkerTarget) => {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) return;
    const dur = Math.max(240, Math.min(920, t.durationMs ?? 320));
    durationMsSv.value = dur;
    lastTargetAt.value = Date.now();
    const speedMs = Number.isFinite(t.speedMs) ? Math.max(0, t.speedMs) : 0;
    speedMsSv.value = speedMs;
    const tgt = Number.isFinite(t.heading) ? t.heading : 0;
    const needsBootstrap = !Number.isFinite(lat.value) || !Number.isFinite(lng.value);

    if (needsBootstrap) {
      cancelAnimation(lat);
      cancelAnimation(lng);
      cancelAnimation(heading);
      lat.value = t.lat;
      lng.value = t.lng;
      heading.value = tgt;
      prevFrameLat.value = t.lat;
      prevFrameLng.value = t.lng;
      return;
    }

    lat.value = withTiming(t.lat, { duration: dur });
    lng.value = withTiming(t.lng, { duration: dur });
    heading.value = withTiming(timingHeadingTarget(heading.value, tgt), { duration: dur });
  }, [durationMsSv, heading, lastTargetAt, lat, lng, prevFrameLat, prevFrameLng, speedMsSv]);

  const reset = useCallback((anchor?: { lat: number; lng: number; heading?: number }) => {
    cancelAnimation(lat);
    cancelAnimation(lng);
    cancelAnimation(heading);
    lastTargetAt.value = 0;
    speedMsSv.value = 0;
    prevFrameLat.value = NaN;
    prevFrameLng.value = NaN;
    if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
      lat.value = anchor.lat;
      lng.value = anchor.lng;
      heading.value = Number.isFinite(anchor.heading) ? anchor.heading! : 0;
      prevFrameLat.value = anchor.lat;
      prevFrameLng.value = anchor.lng;
    } else {
      lat.value = NaN;
      lng.value = NaN;
      heading.value = 0;
    }
  }, [heading, lastTargetAt, lat, lng, prevFrameLat, prevFrameLng, speedMsSv]);

  useEffect(() => {
    enabledSv.value = enabled ? 1 : 0;
  }, [enabled, enabledSv]);

  useFrameCallback((frame) => {
    'worklet';
    if (enabledSv.value < 0.5) return;
    if (!Number.isFinite(lat.value) || !Number.isFinite(lng.value)) return;

    if (Number.isFinite(prevFrameLat.value) && Number.isFinite(prevFrameLng.value)) {
      const frameMoveM = haversineMWorklet(
        prevFrameLat.value,
        prevFrameLng.value,
        lat.value,
        lng.value,
      );
      if (frameMoveM >= HEADING_FRAME_MIN_MOVE_M) {
        const travel = bearingDegWorklet(
          prevFrameLat.value,
          prevFrameLng.value,
          lat.value,
          lng.value,
        );
        const cur = heading.value;
        const blend = frameMoveM >= 0.8 ? 0.55 : 0.35;
        const d = headingDelta(cur, travel);
        heading.value = normalizeHeading(cur + d * blend);
      }
    }
    prevFrameLat.value = lat.value;
    prevFrameLng.value = lng.value;

    const now = frame.timestamp;
    const last = lastTargetAt.value;
    const dur = durationMsSv.value;
    if (last <= 0 || now - last <= dur + DR_GAP_MS) return;
    const speed = speedMsSv.value;
    if (speed < 0.35) return;
    const dt = Math.min(0.05, (frame.timeSincePreviousFrame ?? 16) / 1000);
    const stepM = Math.min(DR_MAX_STEP_M, speed * dt);
    const hdgRad = (heading.value * Math.PI) / 180;
    lat.value += metersToLatDelta(stepM * Math.cos(hdgRad));
    lng.value += metersToLngDelta(stepM * Math.sin(hdgRad), lat.value);
  });

  return { lat, lng, heading, pushTarget, reset };
}
