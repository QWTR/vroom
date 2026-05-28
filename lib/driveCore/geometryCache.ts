import { densifyPolyline } from './geo';
import { projectOntoPolylineWithIndex } from '../../scripts/navigationUtils';
import type { GeometrySource, RoadPoint, RoadPolyline, SnappedPose } from './types';

export class GeometryCache {
  private polyline: RoadPolyline | null = null;
  private lastSegmentIndex = 0;

  reset(): void {
    this.polyline = null;
    this.lastSegmentIndex = 0;
  }

  hasGeometry(): boolean {
    return (this.polyline?.points.length ?? 0) >= 2;
  }

  getPolyline(): RoadPolyline | null {
    return this.polyline;
  }

  getLastSegmentIndex(): number {
    return this.lastSegmentIndex;
  }

  setLastSegmentIndex(idx: number): void {
    this.lastSegmentIndex = Math.max(0, idx);
  }

  setRoute(points: RoadPoint[]): void {
    const dense = densifyPolyline(points, 8);
    this.polyline = {
      points: dense,
      source: 'route',
      updatedAt: Date.now(),
    };
    this.lastSegmentIndex = 0;
  }

  setFromMatch(points: RoadPoint[], hintPose?: Pick<SnappedPose, 'lat' | 'lng'>): void {
    if (points.length < 2) return;
    const dense = densifyPolyline(points, 8);
    this.polyline = {
      points: dense,
      source: 'segment_cache',
      updatedAt: Date.now(),
    };
    if (hintPose) {
      const proj = projectOntoPolylineWithIndex(
        hintPose.lat,
        hintPose.lng,
        dense,
        200,
      );
      this.lastSegmentIndex = proj?.segmentIndex ?? 0;
    } else {
      this.lastSegmentIndex = 0;
    }
  }

  setTangentFallback(points: RoadPoint[]): void {
    if (points.length < 2) return;
    this.polyline = {
      points,
      source: 'tangent_fallback',
      updatedAt: Date.now(),
    };
  }

  source(): GeometrySource | null {
    return this.polyline?.source ?? null;
  }
}
