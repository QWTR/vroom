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
        let local = this.tryLocalL2Snap(raw, travelHdg, maxStepM);
        if (!local) {
          local = this.tryLocalL2SnapNearest(raw, maxStepM);
        }
        if (local) {
          this.frozenPose = local;
          return local;
        }
        if (opts.preferLocalL2 && localRoadGeometryMirror.hasGeometry() && this.frozenPose) {
          return { ...this.frozenPose };
        }
      }
      if (opts.allowRawFallback === true || !hasPoly || !opts.isNavigating) {
        if (opts.preferLocalL2 && localRoadGeometryMirror.hasGeometry() && this.frozenPose) {
          return { ...this.frozenPose };
        }
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

      if (!pose && this.frozenPose && opts.isNavigating) {
        pose = this.stickForwardOnPoly(raw, poly.points, this.frozenPose, maxStepM);
      }

      if (pose) {
        pose = this.applyStepLimit(this.frozenPose, pose, poly.points, maxStepM);
        cache.setLastSegmentIndex(pose.segmentIndex);
        this.frozenPose = pose;
        return pose;
      }

      if (this.frozenPose && opts.isNavigating) {
        const held = this.stickForwardOnPoly(raw, poly.points, this.frozenPose, maxStepM);
        this.frozenPose = held;
        return held;
      }
    }

    if (opts.preferLocalL2) {
      let local = this.tryLocalL2Snap(raw, travelHdg, maxStepM);
      if (local) {
        if (this.frozenPose && opts.isMoving) {
          const movedM = distanceM(
            this.frozenPose.lat,
            this.frozenPose.lng,
            local.lat,
            local.lng,
          );
          if (movedM < 0.35) {
            local = this.advanceOnRoadTowardRaw(this.frozenPose, raw, maxStepM);
          }
        }
        this.frozenPose = local;
        return local;
      }
      if (localRoadGeometryMirror.hasGeometry() && this.frozenPose) {
        if (opts.isMoving) {
          const advanced = this.advanceOnRoadTowardRaw(this.frozenPose, raw, maxStepM);
          this.frozenPose = advanced;
          return advanced;
        }
        return { ...this.frozenPose };
      }
    }

    if (opts.allowRawFallback === true || !opts.isNavigating) {
      if (
        !opts.isMoving
        && (
          (opts.preferLocalL2 && localRoadGeometryMirror.hasGeometry())
          || (hasPoly && !opts.isNavigating)
        )
      ) {
        if (this.frozenPose) {
          return { ...this.frozenPose };
        }
      }
      if (opts.isMoving && this.frozenPose && opts.preferLocalL2) {
        const stepped = localRoadGeometryMirror.hasGeometry()
          ? this.advanceOnRoadTowardRaw(this.frozenPose, raw, maxStepM)
          : this.stepTowardRaw(this.frozenPose, raw, maxStepM);
        this.frozenPose = stepped;
        return stepped;
      }
      const pose = this.rawGpsPose(raw, this.frozenPose);
      this.frozenPose = pose;
      return pose;
    }

    if (this.frozenPose) {
      const rawMovedM = distanceM(
        this.frozenPose.lat,
        this.frozenPose.lng,
        raw.lat,
        raw.lng,
      );
      if (opts.isMoving && rawMovedM >= 1.5) {
        const stepped = this.stepTowardRaw(this.frozenPose, raw, maxStepM);
        this.frozenPose = stepped;
        return stepped;
      }
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

  /** Re-project pose onto road when cross-track error is still large after snap. */
  finalizeSnapPose(
    pose: SnappedPose,
    cache: GeometryCache,
    raw?: RawGpsFix,
    maxCrossTrackM = 6,
  ): SnappedPose {
    if (pose.crossTrackM <= maxCrossTrackM) return pose;

    const snapLat = raw?.lat ?? pose.lat;
    const snapLng = raw?.lng ?? pose.lng;
    const travelHdg = pose.heading;

    if (localRoadGeometryMirror.hasGeometry()) {
      const local = localRoadGeometryMirror.snapToLocalRoadBest(
        snapLat,
        snapLng,
        travelHdg,
        LOCAL_L2_SNAP_RADIUS_M,
      )
        ?? localRoadGeometryMirror.snapToLocalRoadNearest(
          snapLat,
          snapLng,
          LOCAL_L2_SNAP_WIDE_M,
        );
      if (local && local.crossTrackM <= LOCAL_L2_SNAP_WIDE_M) return local;
    }

    const poly = cache.getPolyline();
    if (poly && poly.points.length >= 2) {
      const proj = projectOnPolylineForward(
        pose.lat,
        pose.lng,
        poly.points,
        Math.max(0, pose.segmentIndex - 1),
        SNAP_WIDE_RETRY_RADIUS_M,
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
    }

    return pose;
  }

  /** Offline snap z lustra L2 — bez czekania na Mapbox batch. */
  private tryLocalL2Snap(
    raw: RawGpsFix,
    travelHeadingDeg: number,
    maxStepM: number,
  ): SnappedPose | null {
    if (!localRoadGeometryMirror.hasGeometry()) return null;

    let pose =
      localRoadGeometryMirror.snapToLocalRoadBest(
        raw.lat,
        raw.lng,
        travelHeadingDeg,
        LOCAL_L2_SNAP_RADIUS_M,
      )
      ?? localRoadGeometryMirror.snapToLocalRoadNearest(
        raw.lat,
        raw.lng,
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
        const polys = localRoadGeometryMirror.getPolylines();
        let steppedLat = pose.lat;
        let steppedLng = pose.lng;
        for (const poly of polys) {
          if (poly.length < 2) continue;
          const stepped = stepPoseOnPolyline(
            this.frozenPose.lat,
            this.frozenPose.lng,
            pose.lat,
            pose.lng,
            poly,
            maxStepM,
            LOCAL_L2_SNAP_WIDE_M,
          );
          steppedLat = stepped.lat;
          steppedLng = stepped.lng;
          break;
        }
        pose = {
          ...pose,
          lat: steppedLat,
          lng: steppedLng,
          crossTrackM: distanceM(steppedLat, steppedLng, raw.lat, raw.lng),
        };
      }
    }

    return pose;
  }

  /** Snap bez filtra heading — gdy filtr kierunku odrzuca wszystkie segmenty. */
  private tryLocalL2SnapNearest(
    raw: RawGpsFix,
    maxStepM: number,
  ): SnappedPose | null {
    if (!localRoadGeometryMirror.hasGeometry()) return null;

    let pose = localRoadGeometryMirror.snapToLocalRoadNearest(
      raw.lat,
      raw.lng,
      LOCAL_L2_SNAP_RADIUS_M,
    )
      ?? localRoadGeometryMirror.snapToLocalRoadNearest(
        raw.lat,
        raw.lng,
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
        const polys = localRoadGeometryMirror.getPolylines();
        for (const poly of polys) {
          if (poly.length < 2) continue;
          const stepped = stepPoseOnPolyline(
            this.frozenPose.lat,
            this.frozenPose.lng,
            pose.lat,
            pose.lng,
            poly,
            maxStepM,
            LOCAL_L2_SNAP_WIDE_M,
          );
          pose = {
            ...pose,
            lat: stepped.lat,
            lng: stepped.lng,
            crossTrackM: distanceM(stepped.lat, stepped.lng, raw.lat, raw.lng),
          };
          break;
        }
      }
    }

    return pose;
  }

  /** Postęp do przodu wzdłuż L2 gdy snap z filtrem heading zawiódł. */
  private stickForwardOnLocalL2(
    raw: RawGpsFix,
    frozen: SnappedPose,
    maxStepM: number,
  ): SnappedPose | null {
    const target = localRoadGeometryMirror.snapToLocalRoadNearest(
      raw.lat,
      raw.lng,
      LOCAL_L2_SNAP_WIDE_M,
    );
    if (!target) return null;

    const polys = localRoadGeometryMirror.getPolylines();
    for (const poly of polys) {
      if (poly.length < 2) continue;
      const stepped = stepPoseOnPolyline(
        frozen.lat,
        frozen.lng,
        target.lat,
        target.lng,
        poly,
        Math.max(4, maxStepM),
        LOCAL_L2_SNAP_WIDE_M,
      );
      return {
        lat: stepped.lat,
        lng: stepped.lng,
        heading: target.heading,
        crossTrackM: target.crossTrackM,
        segmentIndex: target.segmentIndex,
      };
    }

    return target;
  }

  /**
   * Ruch do przodu wzdłuż L2 w stronę rzutu GPS — bez ściągania markera na surowy fix.
   */
  private advanceOnRoadTowardRaw(
    frozen: SnappedPose,
    raw: RawGpsFix,
    maxStepM: number,
  ): SnappedPose {
    const forward = this.stickForwardOnLocalL2(raw, frozen, maxStepM);
    if (forward) return forward;

    const target = localRoadGeometryMirror.snapToLocalRoadBest(
      raw.lat,
      raw.lng,
      frozen.heading,
      LOCAL_L2_SNAP_RADIUS_M,
    )
      ?? localRoadGeometryMirror.snapToLocalRoadNearest(
        raw.lat,
        raw.lng,
        LOCAL_L2_SNAP_WIDE_M,
      );

    if (!target) {
      return this.stepForwardOnLocalRoad(frozen, maxStepM);
    }

    const polys = localRoadGeometryMirror.getPolylines();
    for (const poly of polys) {
      if (poly.length < 2) continue;
      const stepped = stepPoseOnPolyline(
        frozen.lat,
        frozen.lng,
        target.lat,
        target.lng,
        poly,
        Math.max(4, maxStepM),
        LOCAL_L2_SNAP_WIDE_M,
      );
      return {
        lat: stepped.lat,
        lng: stepped.lng,
        heading: target.heading,
        crossTrackM: distanceM(stepped.lat, stepped.lng, raw.lat, raw.lng),
        segmentIndex: target.segmentIndex,
      };
    }

    return target;
  }

  /** Krok do przodu wzdłuż drogi gdy snap nie znalazł celu — unika zamrożenia pozycji. */
  private stepForwardOnLocalRoad(
    frozen: SnappedPose,
    maxStepM: number,
  ): SnappedPose {
    const stepM = Math.max(4, maxStepM);
    const rad = (frozen.heading * Math.PI) / 180;
    const R = 6371000;
    const aheadM = Math.max(stepM * 3, 40);
    const dLat = (aheadM * Math.cos(rad) * 180) / (Math.PI * R);
    const cosLat = Math.cos((frozen.lat * Math.PI) / 180);
    const dLng = cosLat > 1e-6
      ? (aheadM * Math.sin(rad) * 180) / (Math.PI * R * cosLat)
      : 0;
    const aheadLat = frozen.lat + dLat;
    const aheadLng = frozen.lng + dLng;

    const polys = localRoadGeometryMirror.getPolylines();
    for (const poly of polys) {
      if (poly.length < 2) continue;
      const stepped = stepPoseOnPolyline(
        frozen.lat,
        frozen.lng,
        aheadLat,
        aheadLng,
        poly,
        stepM,
        LOCAL_L2_SNAP_WIDE_M,
      );
      const movedM = distanceM(frozen.lat, frozen.lng, stepped.lat, stepped.lng);
      if (movedM < 0.5) continue;
      const proj = projectOnPolylineForward(
        stepped.lat,
        stepped.lng,
        poly,
        Math.max(0, frozen.segmentIndex - 1),
        LOCAL_L2_SNAP_WIDE_M,
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
      return {
        ...frozen,
        lat: stepped.lat,
        lng: stepped.lng,
      };
    }
    return { ...frozen };
  }

  /** Ograniczony krok w stronę surowego GPS — tylko bez geometrii L2. */
  private stepTowardRaw(
    prev: SnappedPose,
    raw: RawGpsFix,
    maxStepM: number,
  ): SnappedPose {
    const jumpM = distanceM(prev.lat, prev.lng, raw.lat, raw.lng);
    if (jumpM <= maxStepM || maxStepM <= 0) {
      return this.rawGpsPose(raw, prev);
    }
    const frac = maxStepM / jumpM;
    const lat = prev.lat + (raw.lat - prev.lat) * frac;
    const lng = prev.lng + (raw.lng - prev.lng) * frac;
    return {
      lat,
      lng,
      heading: bearingBetween(prev.lat, prev.lng, raw.lat, raw.lng),
      crossTrackM: distanceM(lat, lng, raw.lat, raw.lng),
      segmentIndex: prev.segmentIndex,
    };
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
    if (next.crossTrackM <= 10 && jumpM <= Math.max(maxStepM, 42)) {
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
