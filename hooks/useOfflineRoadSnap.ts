import { useCallback } from 'react';
import { roadGeometryStore, type RoadPoint } from '../lib/roadGeometry/RoadGeometryStore';

type SnapFn = (
  lat: number,
  lng: number,
  pts: RoadPoint[],
  opts?: Record<string, unknown>,
) => { latitude: number; longitude: number; snapped: boolean; targetHeading?: number };

/**
 * Resolves road polyline for local snap: RAM geometry first, then SQLite cache.
 */
export function useOfflineRoadSnap() {
  const resolveRoadGeometry = useCallback(
    async (
      lat: number,
      lng: number,
      ramGeometry: RoadPoint[],
      searchRadiusM = 80,
    ): Promise<RoadPoint[] | null> => {
      if (ramGeometry.length >= 2) return ramGeometry;

      const cached = await roadGeometryStore.findNearest(lat, lng, searchRadiusM);
      if (cached?.points.length >= 2) {
        return cached.points;
      }
      return null;
    },
    [],
  );

  const persistRoadGeometry = useCallback(async (points: RoadPoint[]) => {
    if (points.length >= 2) {
      await roadGeometryStore.insert(points);
    }
  }, []);

  return { resolveRoadGeometry, persistRoadGeometry };
}

export type { RoadPoint };
