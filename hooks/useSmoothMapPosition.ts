import { useEffect } from 'react';
import {
  runOnJS,
  useSharedValue,
  useFrameCallback,
} from 'react-native-reanimated';
import {
  clearSmoothPositionFeed,
  notifySmoothPositionDisplay,
  registerSmoothPositionHandler,
  type SmoothTarget,
} from '../lib/mapPosition/smoothPositionFeed';
import { logGpsTickLayer } from '../lib/gpsTickTraceLog';
import { markerLogTick } from '../lib/markerPipelineLog';

const DISPLAY_PUSH_MS = 16;
const WORKLET_TRACE_MS = 1400;
const WORKLET_STALL_MS = 2000;

function logWorkletFrameTrace(payload: Record<string, unknown>): void {
  markerLogTick('WORKLET_FRAME', payload, WORKLET_TRACE_MS);
}

function logWorkletStall(payload: Record<string, unknown>): void {
  markerLogTick('WORKLET_STALL', payload, WORKLET_STALL_MS);
}

function logWorkletStateCheck(payload: Record<string, unknown>): void {
  logGpsTickLayer('WORKLET_STATE_CHECK', payload);
}

function lerpHeading(from: number, to: number, t: number): number {
  'worklet';
  const diff = ((to - from + 540) % 360) - 180;
  return ((from + diff * t) + 360) % 360;
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
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export type SmoothMapPositionValues = {
  lat: ReturnType<typeof useSharedValue<number>>;
  lng: ReturnType<typeof useSharedValue<number>>;
  heading: ReturnType<typeof useSharedValue<number>>;
};

/**
 * Jeden strumień: płynne dociąganie do kotwicy GPS/snap (bez skoków co tick).
 */
export function useSmoothMapPosition(enabled: boolean): SmoothMapPositionValues {
  const lat = useSharedValue(0);
  const lng = useSharedValue(0);
  const heading = useSharedValue(0);
  const frameActive = useSharedValue(enabled ? 1 : 0);

  const anchorLat = useSharedValue(0);
  const anchorLng = useSharedValue(0);
  const anchorHdg = useSharedValue(0);
  const bootstrapped = useSharedValue(0);
  const speedMs = useSharedValue(0);
  const anchorPullMs = useSharedValue(400);
  const anchorPullStartMs = useSharedValue(0);
  const lastDisplayPushMs = useSharedValue(0);
  const lastFrameMs = useSharedValue(0);
  const prevFrameLat = useSharedValue(0);
  const prevFrameLng = useSharedValue(0);
  const staleAnchorSinceMs = useSharedValue(0);
  const lastStallLogMs = useSharedValue(0);

  useEffect(() => {
    frameActive.value = enabled ? 1 : 0;
    if (!enabled) {
      return;
    }

    const onFeed = (target: SmoothTarget) => {
      if (!Number.isFinite(target.latitude) || !Number.isFinite(target.longitude)) {
        return;
      }
      const feedHdg = Number.isFinite(target.heading) ? target.heading : 0;
      const now = Date.now();
      const instant = target.durationMs === 0;

      const distFromDisplayM = bootstrapped.value === 1
        ? haversineMWorklet(lat.value, lng.value, target.latitude, target.longitude)
        : 0;
      if (target.speedMs != null && Number.isFinite(target.speedMs) && target.speedMs > 0) {
        speedMs.value = target.speedMs;
      } else if (target.source === 'v10_stationary_hold') {
        speedMs.value = 0;
      } else if (distFromDisplayM >= 6 && (target.durationMs ?? 0) > 0) {
        speedMs.value = Math.min(
          22,
          distFromDisplayM / Math.max(0.22, (target.durationMs ?? 400) / 1000),
        );
      }
      anchorLat.value = target.latitude;
      anchorLng.value = target.longitude;
      anchorHdg.value = feedHdg;
      const pullMs = target.durationMs ?? 400;
      const pullCap = distFromDisplayM >= 25 ? 160 : distFromDisplayM >= 12 ? 220 : 300;
      anchorPullMs.value = instant ? 0 : Math.max(120, Math.min(pullCap, pullMs));
      anchorPullStartMs.value = now;
      if (distFromDisplayM >= 0.35) {
        staleAnchorSinceMs.value = 0;
      } else if (staleAnchorSinceMs.value === 0) {
        staleAnchorSinceMs.value = now;
      }

      if (instant || bootstrapped.value === 0) {
        lat.value = target.latitude;
        lng.value = target.longitude;
        heading.value = feedHdg;
        prevFrameLat.value = target.latitude;
        prevFrameLng.value = target.longitude;
        bootstrapped.value = 1;
        if (instant) {
          notifySmoothPositionDisplay(target.latitude, target.longitude, feedHdg);
        }
      } else if (distFromDisplayM > 10 && bootstrapped.value === 1) {
        // Telemetria: displayToTargetM 15–26 m + pullMs 560 → marker „stoi” i drży.
        const catchT = clampWorklet(distFromDisplayM / 32, 0.42, 0.78);
        lat.value = lat.value + (target.latitude - lat.value) * catchT;
        lng.value = lng.value + (target.longitude - lng.value) * catchT;
        prevFrameLat.value = lat.value;
        prevFrameLng.value = lng.value;
        anchorPullMs.value = Math.min(anchorPullMs.value, distFromDisplayM > 22 ? 140 : 200);
      }
      const displayNaN =
        !Number.isFinite(lat.value)
        || !Number.isFinite(lng.value)
        || !Number.isFinite(anchorLat.value)
        || !Number.isFinite(anchorLng.value);
      if (
        displayNaN
        || instant
        || distFromDisplayM > 12
        || (target.durationMs === 0)
      ) {
        logWorkletStateCheck({
          phase: 'onFeed',
          source: target.source ?? 'unknown',
          instant,
          displayNaN,
          distAnchorM: Number(distFromDisplayM.toFixed(2)),
          displayLat: Number(lat.value.toFixed(6)),
          displayLng: Number(lng.value.toFixed(6)),
          anchorLat: Number(anchorLat.value.toFixed(6)),
          anchorLng: Number(anchorLng.value.toFixed(6)),
          pullMs: target.durationMs ?? null,
          speedMs: target.speedMs ?? null,
        });
      }
      logWorkletFrameTrace({
        event: 'feed',
        source: target.source ?? 'unknown',
        instant,
        distFromDisplayM: Number(distFromDisplayM.toFixed(2)),
        speedMs: target.speedMs ?? null,
        pullMs: target.durationMs ?? null,
      });
    };

    registerSmoothPositionHandler(onFeed, 'trip-smooth-map-position');
    return () => {
      registerSmoothPositionHandler(null, 'trip-smooth-map-position');
      bootstrapped.value = 0;
      speedMs.value = 0;
      anchorPullStartMs.value = 0;
      lastFrameMs.value = 0;
      staleAnchorSinceMs.value = 0;
      lastStallLogMs.value = 0;
      clearSmoothPositionFeed();
    };
  }, [
    enabled,
    frameActive,
    anchorHdg,
    anchorLat,
    anchorLng,
    anchorPullMs,
    anchorPullStartMs,
    bootstrapped,
    heading,
    lat,
    lng,
    prevFrameLat,
    prevFrameLng,
    speedMs,
    staleAnchorSinceMs,
    lastStallLogMs,
  ]);

  useFrameCallback(
    () => {
      'worklet';
      if (frameActive.value === 0 || bootstrapped.value === 0) return;

      const now = Date.now();
      const prevFrame = lastFrameMs.value > 0 ? lastFrameMs.value : now - 16;
      const frameDtSec = clampWorklet((now - prevFrame) / 1000, 0.008, 0.1);
      lastFrameMs.value = now;

      const cruiseMs = speedMs.value >= 0.08 ? speedMs.value : 0;
      const targetLat = anchorLat.value;
      const targetLng = anchorLng.value;
      const distAnchorM = haversineMWorklet(lat.value, lng.value, targetLat, targetLng);

      const DRIVING_CHASE_MS = 4.17; // ~15 km/h — powyżej: agresywny chase bez cap 2.4 m/klatkę
      const drivingChase = cruiseMs >= DRIVING_CHASE_MS;

      if (distAnchorM > 0.08) {
        const pullMs = Math.max(200, anchorPullMs.value > 0 ? anchorPullMs.value : 420);
        const easeFrac = clampWorklet(
          frameDtSec / Math.max(0.18, pullMs / 1000),
          drivingChase ? 0.28 : 0.12,
          drivingChase ? 0.58 : 0.34,
        );
        let stepM = distAnchorM * easeFrac;
        const minChaseM = drivingChase
          ? Math.max(0.45, cruiseMs * frameDtSec * 1.6)
          : Math.max(0.25, cruiseMs * frameDtSec * 0.9);
        stepM = Math.min(distAnchorM, Math.max(minChaseM, stepM));
        if (!drivingChase && distAnchorM > 80 && cruiseMs > 0) {
          const teleportGuardM = cruiseMs * frameDtSec * 2.2 + 2;
          stepM = Math.min(stepM, teleportGuardM);
        } else if (distAnchorM > 12 && cruiseMs <= 0.08) {
          stepM = Math.max(stepM, Math.min(distAnchorM, 2.8 * frameDtSec * 60));
        }
        const t = clampWorklet(
          stepM / Math.max(distAnchorM, 0.08),
          drivingChase ? 0.2 : 0.1,
          drivingChase ? 0.55 : 0.38,
        );
        lat.value = lat.value + (targetLat - lat.value) * t;
        lng.value = lng.value + (targetLng - lng.value) * t;
      } else if (
        cruiseMs >= DRIVING_CHASE_MS
        && distAnchorM <= 0.08
      ) {
        const staleMs = staleAnchorSinceMs.value > 0 ? now - staleAnchorSinceMs.value : 0;
        // Forward cruise tylko gdy GPS naprawdę stoi — inaczej marker „płynie” bez kotwicy i drży.
        if (staleMs < 1200) {
          // skip forward projection
        } else {
        const staleDrive = staleMs > 1800;
        const forwardMul = staleDrive ? 1.45 : 0.55;
        const advM = cruiseMs * frameDtSec * forwardMul;
        const hdgRad = (anchorHdg.value * Math.PI) / 180;
        const dLat = (advM * Math.cos(hdgRad)) / 111320;
        const cosLat = Math.max(0.2, Math.cos((lat.value * Math.PI) / 180));
        const dLng = (advM * Math.sin(hdgRad)) / (111320 * cosLat);
        lat.value = lat.value + dLat;
        lng.value = lng.value + dLng;
        }
      }

      const frameMoveM = haversineMWorklet(prevFrameLat.value, prevFrameLng.value, lat.value, lng.value);
      if (frameMoveM >= 0.9 && cruiseMs >= DRIVING_CHASE_MS) {
        const motionHdg = bearingBetweenWorklet(
          prevFrameLat.value,
          prevFrameLng.value,
          lat.value,
          lng.value,
        );
        heading.value = lerpHeading(heading.value, motionHdg, clampWorklet(frameDtSec * 3, 0.12, 0.28));
      } else {
        heading.value = lerpHeading(
          heading.value,
          anchorHdg.value,
          clampWorklet(frameDtSec * 4, 0.14, 0.32),
        );
      }

      prevFrameLat.value = lat.value;
      prevFrameLng.value = lng.value;

      if (now - lastDisplayPushMs.value >= DISPLAY_PUSH_MS) {
        lastDisplayPushMs.value = now;
        const displayHdg = distAnchorM > 2 && frameMoveM >= 0.7 && cruiseMs >= DRIVING_CHASE_MS
          ? heading.value
          : anchorHdg.value;
        runOnJS(notifySmoothPositionDisplay)(lat.value, lng.value, displayHdg);
      }

      if (
        !Number.isFinite(lat.value)
        || !Number.isFinite(lng.value)
        || distAnchorM > 18
        || (distAnchorM > 8 && frameMoveM < 0.12)
      ) {
        runOnJS(logWorkletStateCheck)({
          phase: 'frame',
          distAnchorM: Number(distAnchorM.toFixed(2)),
          frameMoveM: Number(frameMoveM.toFixed(2)),
          displayLat: Number(lat.value.toFixed(6)),
          displayLng: Number(lng.value.toFixed(6)),
          anchorLat: Number(anchorLat.value.toFixed(6)),
          anchorLng: Number(anchorLng.value.toFixed(6)),
          cruiseMs: Number(cruiseMs.toFixed(2)),
          displayNaN: !Number.isFinite(lat.value) || !Number.isFinite(lng.value),
        });
      }

      if (distAnchorM >= 1.2 || frameMoveM >= 0.6) {
        runOnJS(logWorkletFrameTrace)({
          event: 'frame',
          distAnchorM: Number(distAnchorM.toFixed(2)),
          frameMoveM: Number(frameMoveM.toFixed(2)),
          cruiseMs: Number(cruiseMs.toFixed(2)),
          drivingChase,
          displayLat: Number(lat.value.toFixed(6)),
          displayLng: Number(lng.value.toFixed(6)),
          anchorLat: Number(targetLat.toFixed(6)),
          anchorLng: Number(targetLng.toFixed(6)),
        });
      }

      if (
        cruiseMs >= DRIVING_CHASE_MS
        && frameMoveM < 0.05
        && distAnchorM > 1.5
        && now - lastStallLogMs.value >= WORKLET_STALL_MS
      ) {
        lastStallLogMs.value = now;
        runOnJS(logWorkletStall)({
          distAnchorM: Number(distAnchorM.toFixed(2)),
          frameMoveM: Number(frameMoveM.toFixed(2)),
          cruiseMs: Number(cruiseMs.toFixed(2)),
          staleAnchorMs: staleAnchorSinceMs.value > 0 ? now - staleAnchorSinceMs.value : 0,
          displayLat: Number(lat.value.toFixed(6)),
          displayLng: Number(lng.value.toFixed(6)),
          anchorLat: Number(targetLat.toFixed(6)),
          anchorLng: Number(targetLng.toFixed(6)),
        });
      }
    },
    true,
  );

  return { lat, lng, heading };
}
