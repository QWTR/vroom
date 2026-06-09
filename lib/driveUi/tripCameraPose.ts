import { getTripCameraPadding } from '../../hooks/useCameraAnimation';
import { normalizeHeading } from '../driveCore/travelHeading';

const TRIP_DRIVE_PITCH = 58;
const TRIP_NAV_PITCH = 62;

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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

export type TripFollowSetCameraParams = {
  centerCoordinate: [number, number];
  heading: number;
  zoomLevel: number;
  pitch: number;
  padding: ReturnType<typeof getTripCameraPadding>;
  animationMode: 'linear';
  animationDuration: 0;
};

/** Marker + kamera: ten sam lat/lng; pozycja markera na ekranie wyłącznie przez padding. */
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
  const zoomLevel = input.userZoomOverride ?? (zoomFromSpeed(speedKmh) - 0.3);
  return {
    centerCoordinate: [input.lng, input.lat],
    heading,
    zoomLevel,
    pitch: input.isNavigating ? TRIP_NAV_PITCH : TRIP_DRIVE_PITCH,
    padding: getTripCameraPadding(input.isNavigating),
    animationMode: 'linear',
    animationDuration: 0,
  };
}
