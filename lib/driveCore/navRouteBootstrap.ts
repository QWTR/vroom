import { findClosestPointIndex, snapToRoute } from '../../scripts/navigationUtils';
import { bearingBetween, distanceM } from './geo';
import type { RoadPoint } from './types';

export type NavRouteStartAnchor = {
  lat: number;
  lng: number;
  headingDeg: number;
};

/** Pierwszy punkt trasy + kierunek pierwszego segmentu (min. ~3 m). */
export function resolveNavRouteStartAnchor(
  points: RoadPoint[],
): NavRouteStartAnchor | null {
  if (points.length < 2) return null;
  const start = points[0];
  if (
    !Number.isFinite(start.latitude)
    || !Number.isFinite(start.longitude)
  ) {
    return null;
  }

  let headingDeg = bearingBetween(
    start.latitude,
    start.longitude,
    points[1].latitude,
    points[1].longitude,
  );

  for (let i = 1; i < Math.min(points.length, 8); i += 1) {
    const p = points[i];
    const segM = distanceM(
      start.latitude,
      start.longitude,
      p.latitude,
      p.longitude,
    );
    if (segM >= 3) {
      headingDeg = bearingBetween(
        start.latitude,
        start.longitude,
        p.latitude,
        p.longitude,
      );
      break;
    }
  }

  return {
    lat: start.latitude,
    lng: start.longitude,
    headingDeg: ((headingDeg % 360) + 360) % 360,
  };
}

/**
 * Trim route polyline so navigation starts at the vehicle — not route[0].
 * Snaps live position onto the route, then keeps only points ahead.
 */
export function trimRoutePointsFromVehicle(
  points: RoadPoint[],
  vehicleLat: number,
  vehicleLng: number,
  maxSnapM: number,
): RoadPoint[] {
  if (points.length < 2) return points;
  if (!Number.isFinite(vehicleLat) || !Number.isFinite(vehicleLng)) return points;

  const snapped = snapToRoute(vehicleLat, vehicleLng, points, maxSnapM);
  const idx = findClosestPointIndex(snapped.latitude, snapped.longitude, points);
  const head: RoadPoint = { latitude: snapped.latitude, longitude: snapped.longitude };
  const tail = points.slice(Math.min(points.length - 1, idx + 1));
  if (tail.length === 0) {
    const last = points[points.length - 1];
    return [head, last];
  }
  if (tail.length === 1 && tail[0] === head) {
    return [head, points[points.length - 1]];
  }
  return [head, ...tail];
}

/** Heading aligned to the route segment at the snapped vehicle position. */
export function routeHeadingAtPoint(
  points: RoadPoint[],
  lat: number,
  lng: number,
  fallbackHeadingDeg: number,
): number {
  if (points.length < 2) return fallbackHeadingDeg;
  const idx = findClosestPointIndex(lat, lng, points);
  const nextIdx = Math.min(points.length - 1, idx + 1);
  if (nextIdx <= idx) return fallbackHeadingDeg;
  const a = points[idx];
  const b = points[nextIdx];
  if (!a || !b) return fallbackHeadingDeg;
  const segM = distanceM(a.latitude, a.longitude, b.latitude, b.longitude);
  if (segM < 2) return fallbackHeadingDeg;
  return bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
}
