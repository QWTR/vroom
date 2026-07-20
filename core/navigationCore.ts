import { LocationState, RouteInfo } from '../constants/types';
import { Step } from '../hooks/useGoogleDirections';
import { formatNavigationInstruction } from '../scripts/navigationUtils';

export type NavRoutePoint = { lat: number; lng: number };

export interface CarSafeUpcomingStep {
  instruction: string;
  maneuver: string;
  maneuverModifier: string;
  maneuverExit: number | null;
  distanceMeters: number | null;
}

export interface CarSafeNavigationDto {
  isNavigating: boolean;
  currentStepIndex: number;
  nextInstruction: string;
  turnDistanceMeters: number | null;
  remainingDistanceMeters: number | null;
  remainingDurationSec: number | null;
  etaEpochSec: number | null;
  maneuver: string;
  maneuverModifier: string;
  maneuverExit: number | null;
  followingInstruction: string;
  followingManeuver: string;
  followingManeuverModifier: string;
  followingManeuverExit: number | null;
  followingTurnDistanceMeters: number | null;
  upcomingSteps: CarSafeUpcomingStep[];
  destinationName: string | null;
  destination: NavRoutePoint | null;
}

export interface NavigationCoreSnapshotInput {
  isNavigating: boolean;
  currentStepIndex: number;
  step?: Step | null;
  followingStep?: Step | null;
  followingSteps?: Step[] | null;
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
  const route = points.map((point) => ({ lat: point.latitude, lng: point.longitude }));
  if (route.length <= maxPoints) return route;

  // A stride sampler cuts across bends and roundabouts. Douglas-Peucker keeps the
  // actual road shape and adjusts its tolerance only enough to fit the AA payload.
  let lowToleranceM = 0.35;
  let highToleranceM = 80;
  let best = simplifyRoute(route, highToleranceM);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const toleranceM = (lowToleranceM + highToleranceM) / 2;
    const candidate = simplifyRoute(route, toleranceM);
    if (candidate.length > maxPoints) {
      lowToleranceM = toleranceM;
    } else {
      highToleranceM = toleranceM;
      best = candidate;
    }
  }
  return best;
}

function simplifyRoute(points: NavRoutePoint[], toleranceM: number): NavRoutePoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const toleranceSq = toleranceM * toleranceM;

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let furthestIndex = -1;
    let furthestDistanceSq = 0;
    for (let index = start + 1; index < end; index += 1) {
      const distanceSq = pointToSegmentDistanceSqMeters(points[index], points[start], points[end]);
      if (distanceSq > furthestDistanceSq) {
        furthestDistanceSq = distanceSq;
        furthestIndex = index;
      }
    }
    if (furthestIndex > start && furthestDistanceSq > toleranceSq) {
      keep[furthestIndex] = 1;
      stack.push([start, furthestIndex], [furthestIndex, end]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

function pointToSegmentDistanceSqMeters(point: NavRoutePoint, start: NavRoutePoint, end: NavRoutePoint): number {
  const meanLatRad = ((point.lat + start.lat + end.lat) / 3) * Math.PI / 180;
  const lngScale = Math.max(0.15, Math.cos(meanLatRad));
  const metersPerDegree = 111_320;
  const ax = start.lng * lngScale * metersPerDegree;
  const ay = start.lat * metersPerDegree;
  const bx = end.lng * lngScale * metersPerDegree;
  const by = end.lat * metersPerDegree;
  const px = point.lng * lngScale * metersPerDegree;
  const py = point.lat * metersPerDegree;
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSq = vx * vx + vy * vy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq)) : 0;
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return dx * dx + dy * dy;
}

export function toCarSafeNavigationDto(input: NavigationCoreSnapshotInput): CarSafeNavigationDto {
  const {
    isNavigating,
    currentStepIndex,
    step,
    followingStep,
    followingSteps,
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

  const upcomingSource = (followingSteps?.length ? followingSteps : followingStep ? [followingStep] : [])
    .slice(0, 3);
  const upcomingSteps = upcomingSource.map((upcoming) => ({
    instruction: formatNavigationInstruction(upcoming),
    maneuver: upcoming.maneuver ?? '',
    maneuverModifier: upcoming.maneuverModifier ?? '',
    maneuverExit: upcoming.maneuverExit ?? null,
    distanceMeters: upcoming.distance?.value != null
      ? Math.max(0, Math.round(upcoming.distance.value))
      : null,
  }));
  const firstUpcoming = upcomingSteps[0];

  return {
    isNavigating,
    currentStepIndex: Math.max(0, currentStepIndex || 0),
    nextInstruction: step ? formatNavigationInstruction(step) : '',
    turnDistanceMeters: distToTurnM != null ? Math.max(0, Math.round(distToTurnM)) : null,
    remainingDistanceMeters: remainingDistKm != null ? Math.max(0, Math.round(remainingDistKm * 1000)) : null,
    remainingDurationSec,
    etaEpochSec,
    maneuver: step?.maneuver ?? 'navigation',
    maneuverModifier: step?.maneuverModifier ?? '',
    maneuverExit: step?.maneuverExit ?? null,
    followingInstruction: firstUpcoming?.instruction ?? '',
    followingManeuver: firstUpcoming?.maneuver ?? '',
    followingManeuverModifier: firstUpcoming?.maneuverModifier ?? '',
    followingManeuverExit: firstUpcoming?.maneuverExit ?? null,
    followingTurnDistanceMeters: firstUpcoming?.distanceMeters ?? null,
    upcomingSteps,
    destinationName: destination?.name ?? null,
    destination: destination
      ? { lat: destination.latitude, lng: destination.longitude }
      : null,
  };
}
