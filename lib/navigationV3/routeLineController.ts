import { haversineKm, projectPointToRouteWindow } from '../../scripts/navigationUtils';

export type RouteLinePoint = { latitude: number; longitude: number };

/** Owns the visual tail independently from HUD renders and marker interpolation. */
export function createRouteLineController() {
  let points: RouteLinePoint[] = [];
  let revision = 0;
  let previous: { point: RouteLinePoint; index: number; at: number } | null = null;
  return {
    replace(next: RouteLinePoint[]) {
      if (next !== points) {
        points = next;
        previous = null;
        revision += 1;
      }
      return revision;
    },
    update(input: {
      revision: number;
      latitude: number;
      longitude: number;
      segmentIndex?: number;
      visible: boolean;
      offRoute: boolean;
      now: number;
      radiusM: number;
    }): RouteLinePoint[] | null {
      if (!input.visible || input.offRoute || input.revision !== revision || points.length < 2) return null;
      const projection = projectPointToRouteWindow(
        input.latitude, input.longitude, points,
        input.segmentIndex ?? previous?.index ?? -1, input.radiusM,
      );
      if (!projection) return null;
      const index = projection.segmentIndex;
      // A noisy fix must not reveal a segment already consumed by this route.
      if (previous && (index < previous.index || (
        index === previous.index
        && haversineKm(points[index].latitude, points[index].longitude, projection.latitude, projection.longitude)
          < haversineKm(points[index].latitude, points[index].longitude, previous.point.latitude, previous.point.longitude)
      ))) return null;
      const point = { latitude: projection.latitude, longitude: projection.longitude };
      const movedM = previous
        ? haversineKm(previous.point.latitude, previous.point.longitude, point.latitude, point.longitude) * 1000
        : Infinity;
      if (previous && index === previous.index && (movedM < 8 || input.now - previous.at < 1000)) return null;
      previous = { point, index, at: input.now };
      return [point, ...points.slice(index + 1)];
    },
  };
}
