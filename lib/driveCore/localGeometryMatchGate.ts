import { projectOntoPolylineWithIndex } from '../../scripts/navigationUtils';
import { roadGeometryStore } from '../roadGeometry/RoadGeometryStore';
import type { RoadPoint } from './types';

/** User moved this far along the trip — worth checking local geometry before Mapbox. */
export const LOCAL_GEOMETRY_MOVED_MIN_M = 80;
/** Still on known road if cross-track distance is below this. */
export const LOCAL_GEOMETRY_ON_ROAD_MAX_M = 25;
const LOCAL_GEOMETRY_SEARCH_RADIUS_M = 120;

export type LocalGeometryGateResult = {
  skipNetwork: boolean;
  crossTrackM: number;
  segment: RoadPoint[] | null;
};

/**
 * Holy-grail check: if raw GPS is still on cached road geometry, skip Mapbox.
 * Only applies when the user has moved meaningfully since the last network match.
 */
export async function evaluateLocalGeometryGate(
  lat: number,
  lng: number,
  movedSinceLastNetworkM: number,
): Promise<LocalGeometryGateResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { skipNetwork: false, crossTrackM: Infinity, segment: null };
  }

  if (movedSinceLastNetworkM < LOCAL_GEOMETRY_MOVED_MIN_M) {
    return { skipNetwork: false, crossTrackM: Infinity, segment: null };
  }

  const hit = await roadGeometryStore.findNearest(lat, lng, LOCAL_GEOMETRY_SEARCH_RADIUS_M);
  if (!hit || hit.points.length < 2) {
    return { skipNetwork: false, crossTrackM: Infinity, segment: null };
  }

  const projection = projectOntoPolylineWithIndex(
    lat,
    lng,
    hit.points,
    LOCAL_GEOMETRY_SEARCH_RADIUS_M,
  );
  if (!projection) {
    return { skipNetwork: false, crossTrackM: Infinity, segment: null };
  }

  if (projection.distM <= LOCAL_GEOMETRY_ON_ROAD_MAX_M) {
    return {
      skipNetwork: true,
      crossTrackM: projection.distM,
      segment: hit.points,
    };
  }

  return {
    skipNetwork: false,
    crossTrackM: projection.distM,
    segment: hit.points,
  };
}
