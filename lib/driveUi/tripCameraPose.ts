import { getTripCameraPadding } from '../../hooks/useCameraAnimation';
import { normalizeHeading } from '../driveCore/travelHeading';

const TRIP_DRIVE_PITCH = 58;
const TRIP_NAV_PITCH = 62;

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function offsetCenter(
  lat: number,
  lng: number,
  headingDeg: number,
  offsetMeters: number,
): { latitude: number; longitude: number } {
  if (!Number.isFinite(offsetMeters) || offsetMeters <= 0) {
    return { latitude: lat, longitude: lng };
  }
  const R = 6371000;
  const headingRad = (headingDeg * Math.PI) / 180;
  const dLat = (offsetMeters * Math.cos(headingRad)) / R;
  const dLng =
    (offsetMeters * Math.sin(headingRad)) /
    (R * Math.cos((lat * Math.PI) / 180));
  return {
    latitude: lat + (dLat * 180) / Math.PI,
    longitude: lng + (dLng * 180) / Math.PI,
  };
}

function zoomFromSpeed(speedKmh: number): number {
  const s = Math.max(0, speedKmh);
  if (s <= 12) return 19.05;
  if (s <= 35) return lerpNum(19.05, 18.45, (s - 12) / 23);
  if (s <= 70) return lerpNum(18.45, 17.85, (s - 35) / 35);
  if (s <= 100) return lerpNum(17.85, 17.25, (s - 70) / 30);
  if (s <= 130) return lerpNum(17.25, 16.55, (s - 100) / 30);
  if (s <= 160) return lerpNum(16.55, 16.05, (s - 130) / 30);
  return lerpNum(16.05, 15.55, Math.min(1, (s - 160) / 45));
}

function lookaheadFromSpeed(speedKmh: number, isNavigating = false): number {
  const s = Math.max(0, speedKmh);
  let m = 0;
  if (s < 18) m = 0;
  else if (s <= 40) m = lerpNum(0, 10, (s - 18) / 22);
  else if (s <= 80) m = lerpNum(10, 18, (s - 40) / 40);
  else m = lerpNum(18, 24, Math.min(1, (s - 80) / 50));
  if (isNavigating && s >= 18) {
    m = m * 1.06 + 3;
  }
  return m;
}

export type TripFollowSetCameraParams = {
  centerCoordinate: [number, number];
  heading: number;
  zoomLevel: number;
  pitch: number;
  padding: ReturnType<typeof getTripCameraPadding>;
  animationMode: 'linear';
  animationDuration: 0;
};

/** Jedna funkcja dla markera + kamery — ten sam lat/lng/hdg wejściowy. */
export function buildTripFollowSetCameraParams(input: {
  lat: number;
  lng: number;
  headingDeg: number;
  speedKmh: number;
  isNavigating: boolean;
  userZoomOverride?: number | null;
}): TripFollowSetCameraParams {
  const heading = normalizeHeading(input.headingDeg);
  const speedKmh = Math.max(0, input.speedKmh);
  const lookaheadM = lookaheadFromSpeed(speedKmh, input.isNavigating);
  const center = offsetCenter(input.lat, input.lng, heading, lookaheadM);
  const zoomLevel = input.userZoomOverride ?? (zoomFromSpeed(speedKmh) - 0.3);
  return {
    centerCoordinate: [center.longitude, center.latitude],
    heading,
    zoomLevel,
    pitch: input.isNavigating ? TRIP_NAV_PITCH : TRIP_DRIVE_PITCH,
    padding: getTripCameraPadding(input.isNavigating),
    animationMode: 'linear',
    animationDuration: 0,
  };
}
