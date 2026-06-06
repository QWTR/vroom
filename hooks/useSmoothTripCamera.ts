import { useCallback, useEffect, useRef } from 'react';
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

export type SmoothTripCameraFrame = {
  center: { latitude: number; longitude: number };
  heading: number;
  speedKmh: number;
  isNavigating: boolean;
  isDriving: boolean;
  segmentDurationMs: number;
  smoothedLookaheadM: number;
};

const MIN_PUSH_MS = 52;
/** Sprężyna centrum / heading — wyższe damping = mniej oscylacji. */
const CAM_CENTER_STIFFNESS = 68;
const CAM_CENTER_DAMPING = 24;
const CAM_HDG_STIFFNESS = 52;
const CAM_HDG_DAMPING = 26;
const CAM_LOOKAHEAD_TAU_SEC = 0.42;

function springAlpha(dtSec: number, stiffness: number, damping: number): number {
  'worklet';
  const omega = Math.sqrt(stiffness) / 1000;
  const zeta = damping / (2 * Math.sqrt(stiffness));
  return 1 - Math.exp(-omega * dtSec / Math.max(0.45, zeta));
}

function normalizeHeadingW(h: number): number {
  'worklet';
  return ((h % 360) + 360) % 360;
}

function headingDeltaW(from: number, to: number): number {
  'worklet';
  return ((to - from + 540) % 360) - 180;
}

/**
 * Reanimated worklet: wygładza pozycję markera + lookahead przed setCamera Mapbox.
 * Odkleja offset kamery od nagłych obrotów headingu (efekt „masła”).
 */
export function useSmoothTripCamera(
  onApplyFrame: (frame: SmoothTripCameraFrame) => void,
) {
  const enabledSv = useSharedValue(0);
  const targetLat = useSharedValue(NaN);
  const targetLng = useSharedValue(NaN);
  const targetHdg = useSharedValue(0);
  const targetLookahead = useSharedValue(0);
  const smoothLat = useSharedValue(NaN);
  const smoothLng = useSharedValue(NaN);
  const smoothHdg = useSharedValue(0);
  const smoothLookahead = useSharedValue(0);
  const speedKmhSv = useSharedValue(0);
  const isNavSv = useSharedValue(0);
  const isDriveSv = useSharedValue(0);
  const markerSegMsSv = useSharedValue(650);
  const lastPushMs = useSharedValue(0);

  const onApplyRef = useRef(onApplyFrame);
  onApplyRef.current = onApplyFrame;

  const applyCameraJs = useCallback((
    lat: number,
    lng: number,
    hdg: number,
    lookM: number,
    speedKmh: number,
    isNav: boolean,
    isDrive: boolean,
    animMs: number,
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    onApplyRef.current({
      center: { latitude: lat, longitude: lng },
      heading: ((hdg % 360) + 360) % 360,
      speedKmh,
      isNavigating: isNav,
      isDriving: isDrive,
      segmentDurationMs: animMs,
      smoothedLookaheadM: lookM,
    });
  }, []);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    if (enabledSv.value < 0.5) return;
    if (!Number.isFinite(targetLat.value) || !Number.isFinite(targetLng.value)) return;

    const dtMs = Math.min(48, Math.max(8, frame.timeSincePreviousFrame ?? 16));
    const dtSec = dtMs / 1000;
    const alphaPos = springAlpha(dtSec, CAM_CENTER_STIFFNESS, CAM_CENTER_DAMPING);
    const alphaHdg = springAlpha(dtSec, CAM_HDG_STIFFNESS, CAM_HDG_DAMPING);
    const alphaLook = 1 - Math.exp(-dtSec / CAM_LOOKAHEAD_TAU_SEC);

    if (!Number.isFinite(smoothLat.value)) {
      smoothLat.value = targetLat.value;
      smoothLng.value = targetLng.value;
      smoothHdg.value = normalizeHeadingW(targetHdg.value);
      smoothLookahead.value = targetLookahead.value;
    } else {
      smoothLat.value = smoothLat.value + (targetLat.value - smoothLat.value) * alphaPos;
      smoothLng.value = smoothLng.value + (targetLng.value - smoothLng.value) * alphaPos;
      const dH = headingDeltaW(smoothHdg.value, targetHdg.value);
      smoothHdg.value = normalizeHeadingW(smoothHdg.value + dH * alphaHdg);
      smoothLookahead.value =
        smoothLookahead.value + (targetLookahead.value - smoothLookahead.value) * alphaLook;
    }

    const now = Date.now();
    if (now - lastPushMs.value < MIN_PUSH_MS) return;
    lastPushMs.value = now;

    const animMs = Math.max(
      180,
      Math.min(420, Math.round(markerSegMsSv.value * 0.52)),
    );

    runOnJS(applyCameraJs)(
      smoothLat.value,
      smoothLng.value,
      smoothHdg.value,
      smoothLookahead.value,
      speedKmhSv.value,
      isNavSv.value > 0.5,
      isDriveSv.value > 0.5,
      animMs,
    );
  }, false);

  const pushMarkerFrame = useCallback((
    lat: number,
    lng: number,
    heading: number,
    speedKmh: number,
    isNavigating: boolean,
    isDriving: boolean,
    markerSegMs: number,
    lookaheadM: number,
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    targetLat.value = lat;
    targetLng.value = lng;
    targetHdg.value = normalizeHeadingW(heading);
    targetLookahead.value = Math.max(0, lookaheadM);
    speedKmhSv.value = Math.max(0, speedKmh);
    isNavSv.value = isNavigating ? 1 : 0;
    isDriveSv.value = isDriving ? 1 : 0;
    markerSegMsSv.value = Number.isFinite(markerSegMs) && markerSegMs > 0 ? markerSegMs : 650;
    enabledSv.value = 1;
    frameCallback.setActive(true);
  }, [enabledSv, frameCallback, isDriveSv, isNavSv, markerSegMsSv, speedKmhSv, targetHdg, targetLat, targetLng, targetLookahead]);

  const setTripCameraSmoothActive = useCallback((active: boolean) => {
    enabledSv.value = active ? 1 : 0;
    frameCallback.setActive(active);
    if (!active) {
      smoothLat.value = NaN;
      smoothLng.value = NaN;
      smoothLookahead.value = 0;
    }
  }, [enabledSv, frameCallback, smoothLat, smoothLng, smoothLookahead]);

  const reset = useCallback(() => {
    enabledSv.value = 0;
    frameCallback.setActive(false);
    targetLat.value = NaN;
    targetLng.value = NaN;
    smoothLat.value = NaN;
    smoothLng.value = NaN;
    smoothHdg.value = 0;
    smoothLookahead.value = 0;
    lastPushMs.value = 0;
  }, [enabledSv, frameCallback, lastPushMs, smoothHdg, smoothLat, smoothLng, smoothLookahead, targetLat, targetLng]);

  useEffect(() => () => {
    frameCallback.setActive(false);
  }, [frameCallback]);

  return {
    pushMarkerFrame,
    setTripCameraSmoothActive,
    reset,
  };
}
