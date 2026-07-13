export const TRIP_CAMERA_FRAME_MS = 33;
export const MIN_TRIP_CAMERA_SEGMENT_MS = 80;
export const MAX_TRIP_CAMERA_SEGMENT_MS = 5_000;

export type DisplayedMarkerPose = {
  lat: number;
  lng: number;
  heading: number;
};

/** The camera must consume the already-interpolated marker, never a GPS target. */
export function cameraFrameFromDisplayedMarker(pose: DisplayedMarkerPose): DisplayedMarkerPose | null {
  if (!Number.isFinite(pose.lat) || !Number.isFinite(pose.lng) || !Number.isFinite(pose.heading)) return null;
  if (Math.abs(pose.lat) < 1e-6 && Math.abs(pose.lng) < 1e-6) return null;
  return {
    lat: pose.lat,
    lng: pose.lng,
    heading: ((pose.heading % 360) + 360) % 360,
  };
}

/** Keeps the native camera segment bounded while preserving the marker's segment rhythm. */
export function tripCameraSegmentDurationMs(value: number): number {
  const fallback = 900;
  const duration = Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.max(MIN_TRIP_CAMERA_SEGMENT_MS, Math.min(MAX_TRIP_CAMERA_SEGMENT_MS, Math.round(duration)));
}
