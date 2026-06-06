import { useCallback, useEffect, useRef } from 'react';
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import type { DriveMarkerValues } from './useDriveMarker';

const CAMERA_FRAME_MIN_MS = 16;

/**
 * V2: kamera follow z workletu markera — stały ~60 fps, bez useAnimatedReaction + progów ruchu.
 */
export function useDriveMarkerCameraFrame(
  enabled: boolean,
  marker: DriveMarkerValues,
  onFrame: (lat: number, lng: number, hdg: number) => void,
): void {
  const enabledSv = useSharedValue(enabled ? 1 : 0);
  const lastPushMsSv = useSharedValue(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const emitFrame = useCallback((lat: number, lng: number, hdg: number) => {
    onFrameRef.current(lat, lng, hdg);
  }, []);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    if (enabledSv.value < 0.5) return;
    const lat = marker.lat.value;
    const lng = marker.lng.value;
    const hdg = marker.heading.value;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return;

    const dtMs = frame.timeSincePreviousFrame ?? 16;
    const since = lastPushMsSv.value > 0 ? dtMs : CAMERA_FRAME_MIN_MS;
    if (lastPushMsSv.value > 0 && since < CAMERA_FRAME_MIN_MS) return;
    lastPushMsSv.value = Date.now();
    runOnJS(emitFrame)(lat, lng, Number.isFinite(hdg) ? hdg : 0);
  }, false);

  useEffect(() => {
    enabledSv.value = enabled ? 1 : 0;
    frameCallback.setActive(enabled);
    if (!enabled) {
      lastPushMsSv.value = 0;
    }
    return () => {
      frameCallback.setActive(false);
    };
  }, [enabled, enabledSv, frameCallback, lastPushMsSv]);
}
