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
import {
  LOCAL_L2_HEADING_ALIGN_DEG,
  LOCAL_L2_SNAP_RADIUS_M,
  LOCAL_L2_SNAP_WIDE_M,
  localRoadGeometryMirror,
} from './localRoadSnap';
import type { GeometryCache } from './geometryCache';
import type { RawGpsFix, RoadPoint, SnappedPose } from './types';

export type SnapOptions = {
  isMoving: boolean;
  isNavigating: boolean;
  allowRawFallback?: boolean;
  /** Maks. dystans między kolejnymi pozami (płynność markera). */
  maxStepM?: number;
  /** Kierunek jazdy do filtra L2 (°). */
  travelHeadingDeg?: number;
  /** Free-drive: najpierw snap z lokalnego L2 (RoadGeometryStore mirror). */
  preferLocalL2?: boolean;
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
      {
        isMoving: false,
        isNavigating: false,
        allowRawFallback: true,
        travelHeadingDeg: heading,
        preferLocalL2: true,
      },
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
    const travelHdg = this.resolveTravelHeading(raw, opts.travelHeadingDeg);

    if (!opts.isMoving) {
      if (hasPoly) {
        const pose = this.projectWithRetry(raw, cache, minSeg, maxRadius);
        if (pose) {
          this.frozenPose = pose;
          return pose;
        }
      }
      if (opts.preferLocalL2 || opts.allowRawFallback === true || !hasPoly) {
        const local = this.tryLocalL2Snap(raw, travelHdg, maxStepM);
        if (local) {
          this.frozenPose = local;
          return local;
        }
      }
      if (opts.allowRawFallback === true || !hasPoly) {
        const pose = this.rawGpsPose(raw, this.frozenPose);
        this.frozenPose = pose;
        return pose;
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

    if (opts.preferLocalL2) {
      const local = this.tryLocalL2Snap(raw, travelHdg, maxStepM);
      if (local) {
        this.frozenPose = local;
        return local;
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

  private resolveTravelHeading(raw: RawGpsFix, explicit?: number): number {
    if (Number.isFinite(explicit)) return explicit!;
    if (this.frozenPose) {
      const movedM = distanceM(
        this.frozenPose.lat,
        this.frozenPose.lng,
        raw.lat,
        raw.lng,
      );
      if (movedM >= 1.2) {
        return bearingBetween(
          this.frozenPose.lat,
          this.frozenPose.lng,
          raw.lat,
          raw.lng,
        );
      }
      return this.frozenPose.heading;
    }
    return 0;
  }

  /** Offline snap z lustra L2 — bez czekania na Mapbox batch. */
  private tryLocalL2Snap(
    raw: RawGpsFix,
    travelHeadingDeg: number,
    maxStepM: number,
  ): SnappedPose | null {
    if (!localRoadGeometryMirror.hasGeometry()) return null;

    let pose =
      localRoadGeometryMirror.snapToLocalRoad(
        raw.lat,
        raw.lng,
        travelHeadingDeg,
        LOCAL_L2_SNAP_RADIUS_M,
      )
      ?? localRoadGeometryMirror.snapToLocalRoad(
        raw.lat,
        raw.lng,
        travelHeadingDeg,
        LOCAL_L2_SNAP_WIDE_M,
      );

    if (!pose) return null;

    if (this.frozenPose && maxStepM > 0) {
      const jumpM = distanceM(
        this.frozenPose.lat,
        this.frozenPose.lng,
        pose.lat,
        pose.lng,
      );
      if (jumpM > maxStepM && pose.crossTrackM > 12) {
        const frac = maxStepM / jumpM;
        pose = {
          ...pose,
          lat: this.frozenPose.lat + (pose.lat - this.frozenPose.lat) * frac,
          lng: this.frozenPose.lng + (pose.lng - this.frozenPose.lng) * frac,
        };
      }
    }

    return pose;
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
    if (next.crossTrackM <= 18 && jumpM <= Math.max(maxStepM, 42)) {
      return next;
    }

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

export { LOCAL_L2_HEADING_ALIGN_DEG };
