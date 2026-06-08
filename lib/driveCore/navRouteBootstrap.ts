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
