import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import type { DriveMarkerValues } from './useDriveMarker';

export type DriveMarkerCameraSink = {
  enabled: boolean;
  onFrame: (lat: number, lng: number, hdg: number) => void;
};

/** Min. odstęp między setCamera z workletu (ms) — ogranicza RN bridge / frame drops. */
const FRAME_CAMERA_MIN_INTERVAL_MS = 50;

/**
 * V2 fallback: kamera z SharedValues markera (throttled).
 * Preferowany tryb: segmentSync w useCameraAnimation (jeden setCamera / tick GPS).
 */
export function useDriveMarkerCameraFrame(
  enabled: boolean,
  marker: DriveMarkerValues,
  onFrame: (lat: number, lng: number, hdg: number) => void,
): void {
  const lastPushMs = useSharedValue(0);

  useAnimatedReaction(
    () => ({
      lat: marker.lat.value,
      lng: marker.lng.value,
      hdg: marker.heading.value,
    }),
    (next, prev) => {
      if (!enabled) return;
      if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;
      if (Math.abs(next.lat) < 1e-6 && Math.abs(next.lng) < 1e-6) return;
      if (
        prev
        && Math.abs(next.lat - prev.lat) < 1e-9
        && Math.abs(next.lng - prev.lng) < 1e-9
        && Math.abs(next.hdg - prev.hdg) < 0.02
      ) {
        return;
      }
      const now = Date.now();
      if (lastPushMs.value > 0 && now - lastPushMs.value < FRAME_CAMERA_MIN_INTERVAL_MS) {
        return;
      }
      lastPushMs.value = now;
      runOnJS(onFrame)(next.lat, next.lng, next.hdg);
    },
    [enabled, onFrame],
  );
}
