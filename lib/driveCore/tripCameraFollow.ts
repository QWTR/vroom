export const TRIP_CAMERA_FRAME_MS = 33;
export const MIN_TRIP_CAMERA_SEGMENT_MS = 80;
export const MAX_TRIP_CAMERA_SEGMENT_MS = 5_000;

export type DisplayedMarkerPose = {
  lat: number;
  lng: number;
  heading: number;
};

export type NativeCameraFollowerFrame = {
  positionValid: number;
  latitude: number;
  longitude: number;
  heading: number;
};

/** The camera must consume the already-interpolated marker, never a GPS target. */
export function cameraFrameFromDisplayedMarker(pose: DisplayedMarkerPose): DisplayedMarkerPose | null {
  'worklet';
  if (!Number.isFinite(pose.lat) || !Number.isFinite(pose.lng) || !Number.isFinite(pose.heading)) return null;
  if (Math.abs(pose.lat) < 1e-6 && Math.abs(pose.lng) < 1e-6) return null;
  return {
    lat: pose.lat,
    lng: pose.lng,
    heading: ((pose.heading % 360) + 360) % 360,
  };
}

/** Maps the marker's rendered speed to the trip zoom on the UI thread. */
export function zoomFromMarkerSpeed(speedMs: number): number {
  'worklet';
  const speedKmh = Math.max(0, Number.isFinite(speedMs) ? speedMs * 3.6 : 0);
  if (speedKmh <= 12) return 18.75;
  if (speedKmh <= 35) return 18.75 - ((speedKmh - 12) / 23) * 0.6;
  if (speedKmh <= 70) return 18.15 - ((speedKmh - 35) / 35) * 0.6;
  if (speedKmh <= 100) return 17.55 - ((speedKmh - 70) / 30) * 0.6;
  if (speedKmh <= 130) return 16.95 - ((speedKmh - 100) / 30) * 0.7;
  if (speedKmh <= 160) return 16.25 - ((speedKmh - 130) / 30) * 0.5;
  return 15.75 - Math.min(1, (speedKmh - 160) / 45) * 0.5;
}

/** Native motion props are always derived from the displayed marker. Framing is static. */
export function nativeFollowerFrameFromMarker(
  pose: DisplayedMarkerPose,
  _speedMs: number,
): NativeCameraFollowerFrame {
  'worklet';
  const frame = cameraFrameFromDisplayedMarker(pose);
  if (!frame) {
    return { positionValid: 0, latitude: 0, longitude: 0, heading: 0 };
  }
  return {
    positionValid: 1,
    latitude: frame.lat,
    longitude: frame.lng,
    heading: frame.heading,
  };
}

/** Keeps the native camera segment bounded while preserving the marker's segment rhythm. */
export function tripCameraSegmentDurationMs(value: number): number {
  const fallback = 900;
  const duration = Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.max(MIN_TRIP_CAMERA_SEGMENT_MS, Math.min(MAX_TRIP_CAMERA_SEGMENT_MS, Math.round(duration)));
}
