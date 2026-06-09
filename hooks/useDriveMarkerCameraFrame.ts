import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import type { DriveMarkerValues } from './useDriveMarker';

export type DriveMarkerCameraSink = {
  enabled: boolean;
  onFrame: (lat: number, lng: number, hdg: number) => void;
};

/**
 * V2: kamera 60 FPS — reaguje na te same SharedValues co DriveMarkerLayer.
 * updateCameraFrame dostaje followFromWorkletFrame + segmentDurationMs≈16 → linear, animMs=0.
 */
export function useDriveMarkerCameraFrame(
  enabled: boolean,
  marker: DriveMarkerValues,
  onFrame: (lat: number, lng: number, hdg: number) => void,
): void {
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
      runOnJS(onFrame)(next.lat, next.lng, next.hdg);
    },
    [enabled, onFrame],
  );
}
