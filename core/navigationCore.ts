import { LocationState, RouteInfo } from '../constants/types';
import { Step } from '../hooks/useGoogleDirections';
import { formatNavigationInstruction } from '../scripts/navigationUtils';

export type NavRoutePoint = { lat: number; lng: number };

export interface CarSafeNavigationDto {
  isNavigating: boolean;
  currentStepIndex: number;
  nextInstruction: string;
  turnDistanceMeters: number | null;
  remainingDistanceMeters: number | null;
  remainingDurationSec: number | null;
  etaEpochSec: number | null;
  maneuver: string;
  destinationName: string | null;
  destination: NavRoutePoint | null;
}

export interface NavigationCoreSnapshotInput {
  isNavigating: boolean;
  currentStepIndex: number;
  step?: Step | null;
  remainingDistKm?: number | null;
  distToTurnM?: number | null;
  routeInfo?: (RouteInfo & { durationText?: string | null }) | null;
  destination?: LocationState | null;
}

export function compactRoutePolyline(
  points: { latitude: number; longitude: number }[] | null | undefined,
  maxPoints = 300,
): NavRoutePoint[] {
  if (!points?.length) return [];
  if (points.length <= maxPoints) {
    return points.map((p) => ({ lat: p.latitude, lng: p.longitude }));
  }

  const stride = Math.ceil(points.length / maxPoints);
  const compact: NavRoutePoint[] = [];
  for (let i = 0; i < points.length; i += stride) {
    compact.push({ lat: points[i].latitude, lng: points[i].longitude });
  }

  const last = points[points.length - 1];
  const tail = compact[compact.length - 1];
  if (!tail || tail.lat !== last.latitude || tail.lng !== last.longitude) {
    compact.push({ lat: last.latitude, lng: last.longitude });
  }
  return compact;
}

export function toCarSafeNavigationDto(input: NavigationCoreSnapshotInput): CarSafeNavigationDto {
  const {
    isNavigating,
    currentStepIndex,
    step,
    remainingDistKm = null,
    distToTurnM = null,
    routeInfo = null,
    destination = null,
  } = input;

  const remainingDurationSec = routeInfo?.duration != null
    ? Math.max(0, Math.round(Number(routeInfo.duration) * 60))
    : null;

  const etaEpochSec = remainingDurationSec != null
    ? Math.floor(Date.now() / 1000) + remainingDurationSec
    : null;

  return {
    isNavigating,
    currentStepIndex: Math.max(0, currentStepIndex || 0),
    nextInstruction: step ? formatNavigationInstruction(step) : '',
    turnDistanceMeters: distToTurnM != null ? Math.max(0, Math.round(distToTurnM)) : null,
    remainingDistanceMeters: remainingDistKm != null ? Math.max(0, Math.round(remainingDistKm * 1000)) : null,
    remainingDurationSec,
    etaEpochSec,
    maneuver: step?.maneuver ?? 'navigation',
    destinationName: destination?.name ?? null,
    destination: destination
      ? { lat: destination.latitude, lng: destination.longitude }
      : null,
  };
}
