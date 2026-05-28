import {
  ROUTE_SNAP_MAX_RADIUS_M,
  SNAP_MAX_RADIUS_M,
  SNAP_WIDE_RETRY_RADIUS_M,
} from './config';
import {
  bearingBetween,
  distanceM,
  projectOnPolylineForward,
  stepPoseOnPolyline,
} from './geo';
import type { GeometryCache } from './geometryCache';
import type { RawGpsFix, RoadPoint, SnappedPose } from './types';

export type SnapOptions = {
  isMoving: boolean;
  isNavigating: boolean;
  allowRawFallback?: boolean;
  /** Maks. dystans między kolejnymi pozami (płynność markera). */
  maxStepM?: number;
};

export class RoadSnapEngine {
  private frozenPose: SnappedPose | null = null;

  reset(): void {
    this.frozenPose = null;
  }

  getFrozenPose(): SnappedPose | null {
    return this.frozenPose;
  }

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

  snap(raw: RawGpsFix, cache: GeometryCache, opts: SnapOptions): SnappedPose {
    const poly = cache.getPolyline();
    const maxRadius = opts.isNavigating ? ROUTE_SNAP_MAX_RADIUS_M : SNAP_MAX_RADIUS_M;
    const minSeg = cache.getLastSegmentIndex();
    const maxStepM = opts.maxStepM ?? 24;
    const hasPoly = !!(poly && poly.points.length >= 2);

    if (!opts.isMoving) {
      if (hasPoly) {
        const pose = this.projectWithRetry(raw, cache, minSeg, maxRadius);
        if (pose) {
          this.frozenPose = pose;
          return pose;
        }
      }
      if (this.frozenPose) {
        return { ...this.frozenPose };
      }
      const pose = this.rawGpsPose(raw, null);
      this.frozenPose = pose;
      return pose;
    }

    if (hasPoly) {
      let pose =
        this.projectWithRetry(raw, cache, minSeg, maxRadius)
        ?? this.projectWithRetry(raw, cache, minSeg, SNAP_WIDE_RETRY_RADIUS_M);

      if (!pose && this.frozenPose) {
        pose = this.stickForwardOnPoly(raw, poly.points, this.frozenPose, maxStepM);
      }

      if (pose) {
        pose = this.applyStepLimit(this.frozenPose, pose, poly.points, maxStepM);
        cache.setLastSegmentIndex(pose.segmentIndex);
        this.frozenPose = pose;
        return pose;
      }

      if (this.frozenPose) {
        const held = this.stickForwardOnPoly(raw, poly.points, this.frozenPose, maxStepM);
        this.frozenPose = held;
        return held;
      }
    }

    if (opts.allowRawFallback === true) {
      const pose = this.rawGpsPose(raw, this.frozenPose);
      this.frozenPose = pose;
      return pose;
    }

    if (this.frozenPose) {
      return { ...this.frozenPose };
    }

    const fallback = this.rawGpsPose(raw, null);
    this.frozenPose = fallback;
    return fallback;
  }

  private applyStepLimit(
    prev: SnappedPose | null,
    next: SnappedPose,
    points: RoadPoint[],
    maxStepM: number,
  ): SnappedPose {
    if (!prev || maxStepM <= 0) return next;
    const jumpM = distanceM(prev.lat, prev.lng, next.lat, next.lng);
    if (jumpM <= maxStepM) return next;

    const stepped = stepPoseOnPolyline(
      prev.lat,
      prev.lng,
      next.lat,
      next.lng,
      points,
      maxStepM,
      SNAP_WIDE_RETRY_RADIUS_M,
    );
    const segIdx = next.segmentIndex;
    const a = points[Math.max(0, Math.min(segIdx, points.length - 2))];
    const b = points[Math.min(segIdx + 1, points.length - 1)];
    const heading = bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
    return {
      lat: stepped.lat,
      lng: stepped.lng,
      heading,
      crossTrackM: distanceM(stepped.lat, stepped.lng, next.lat, next.lng),
      segmentIndex: segIdx,
    };
  }

  /** Geometria jest, ale GPS poza pasem — idź do przodu wzdłuż drogi, nie na RAW. */
  private stickForwardOnPoly(
    raw: RawGpsFix,
    points: RoadPoint[],
    frozen: SnappedPose,
    maxStepM: number,
  ): SnappedPose {
    const proj = projectOnPolylineForward(
      raw.lat,
      raw.lng,
      points,
      frozen.segmentIndex,
      SNAP_WIDE_RETRY_RADIUS_M,
    );
    const target = proj ?? frozen;
    const stepped = stepPoseOnPolyline(
      frozen.lat,
      frozen.lng,
      target.lat,
      target.lng,
      points,
      Math.max(4, maxStepM),
      SNAP_WIDE_RETRY_RADIUS_M,
    );
    const segIdx = proj?.segmentIndex ?? frozen.segmentIndex;
    const a = points[Math.max(0, Math.min(segIdx, points.length - 2))];
    const b = points[Math.min(segIdx + 1, points.length - 1)];
    const heading = proj?.heading
      ?? bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
    return {
      lat: stepped.lat,
      lng: stepped.lng,
      heading,
      crossTrackM: proj?.crossTrackM ?? frozen.crossTrackM,
      segmentIndex: segIdx,
    };
  }

  private rawGpsPose(raw: RawGpsFix, prev: SnappedPose | null): SnappedPose {
    let heading = prev?.heading ?? 0;
    if (prev) {
      const movedM = distanceM(prev.lat, prev.lng, raw.lat, raw.lng);
      if (movedM >= 1) {
        heading = bearingBetween(prev.lat, prev.lng, raw.lat, raw.lng);
      }
    }
    return {
      lat: raw.lat,
      lng: raw.lng,
      heading,
      crossTrackM: 999,
      segmentIndex: prev?.segmentIndex ?? 0,
    };
  }

  private projectWithRetry(
    raw: RawGpsFix,
    cache: GeometryCache,
    minSeg: number,
    maxRadius: number,
  ): SnappedPose | null {
    const poly = cache.getPolyline();
    if (!poly) return null;

    const proj = projectOnPolylineForward(
      raw.lat,
      raw.lng,
      poly.points,
      Math.max(0, minSeg - 1),
      maxRadius,
    );
    if (proj) {
      return {
        lat: proj.lat,
        lng: proj.lng,
        heading: proj.heading,
        crossTrackM: proj.crossTrackM,
        segmentIndex: proj.segmentIndex,
      };
    }
    return null;
  }
}
