import {
  ROUTE_SNAP_MAX_RADIUS_M,
  SNAP_MAX_RADIUS_M,
  SNAP_WIDE_RETRY_RADIUS_M,
} from './config';
import { projectOnPolylineForward } from './geo';
import type { GeometryCache } from './geometryCache';
import type { RawGpsFix, SnappedPose } from './types';

export class RoadSnapEngine {
  private frozenPose: SnappedPose | null = null;

  reset(): void {
    this.frozenPose = null;
  }

  getFrozenPose(): SnappedPose | null {
    return this.frozenPose;
  }

  /** Po wejściu w jazdę — kotwica na drodze zanim przyjdzie pierwszy tick GPS. */
  seedPose(
    lat: number,
    lng: number,
    cache: GeometryCache,
    heading = 0,
  ): SnappedPose {
    const pose = this.snap(
      { lat, lng, accuracy: 8, timestamp: Date.now() },
      cache,
      { isMoving: false, isNavigating: false, allowRawFallback: true },
    );
    if (!Number.isFinite(pose.heading) || pose.heading === 0) {
      pose.heading = heading;
    }
    this.frozenPose = pose;
    return pose;
  }

  snap(
    raw: RawGpsFix,
    cache: GeometryCache,
    opts: { isMoving: boolean; isNavigating: boolean; allowRawFallback?: boolean },
  ): SnappedPose {
    const poly = cache.getPolyline();
    const maxRadius = opts.isNavigating ? ROUTE_SNAP_MAX_RADIUS_M : SNAP_MAX_RADIUS_M;
    const minSeg = cache.getLastSegmentIndex();

    if (poly && poly.points.length >= 2) {
      const pose = this.projectWithRetry(raw, cache, minSeg, maxRadius);
      if (pose) {
        this.frozenPose = pose;
        return pose;
      }
    }

    if (this.frozenPose) {
      return { ...this.frozenPose };
    }

    if (!opts.allowRawFallback) {
      const hold: SnappedPose = {
        lat: raw.lat,
        lng: raw.lng,
        heading: 0,
        crossTrackM: 999,
        segmentIndex: 0,
      };
      return hold;
    }

    const fallback: SnappedPose = {
      lat: raw.lat,
      lng: raw.lng,
      heading: 0,
      crossTrackM: 999,
      segmentIndex: 0,
    };
    this.frozenPose = fallback;
    return fallback;
  }

  private projectWithRetry(
    raw: RawGpsFix,
    cache: GeometryCache,
    minSeg: number,
    maxRadius: number,
  ): SnappedPose | null {
    const poly = cache.getPolyline();
    if (!poly) return null;

    const radii = [maxRadius, SNAP_WIDE_RETRY_RADIUS_M];
    for (const radius of radii) {
      const proj = projectOnPolylineForward(
        raw.lat,
        raw.lng,
        poly.points,
        Math.max(0, minSeg - 1),
        radius,
      );
      if (proj) {
        cache.setLastSegmentIndex(proj.segmentIndex);
        return {
          lat: proj.lat,
          lng: proj.lng,
          heading: proj.heading,
          crossTrackM: proj.crossTrackM,
          segmentIndex: proj.segmentIndex,
        };
      }
    }
    return null;
  }
}
