import {
  bearingBetween,
  closestPointOnSegment,
  distanceM,
  headingDeltaAbs,
  snapSegmentScore,
} from './geo';
import { SNAP_HIGHWAY_SPEED_KMH } from './config';
import type { RoadPoint, SnappedPose } from './types';

/** Promień wyszukiwania segmentów L2 wokół GPS (m). */
export const LOCAL_L2_SNAP_RADIUS_M = 55;
export const LOCAL_L2_SNAP_WIDE_M = 95;
/** Segment zgodny z kierunkiem jazdy (miejski domyślnie). */
export const LOCAL_L2_HEADING_ALIGN_DEG = 32;
export const LOCAL_L2_HEADING_ALIGN_HIGHWAY_DEG = 42;
/** Nearest fallback — odrzuć segment prostopadły do ruchu. */
export const LOCAL_L2_NEAREST_MAX_ANGLE_DEG = 45;
const MIRROR_TTL_MS = 180_000;
const MAX_STORED_POLYLINES = 36;

function segmentBearing(a: RoadPoint, b: RoadPoint): number {
  return bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
}

function headingAlignDeg(speedKmh?: number): number {
  return (speedKmh ?? 0) >= SNAP_HIGHWAY_SPEED_KMH
    ? LOCAL_L2_HEADING_ALIGN_HIGHWAY_DEG
    : LOCAL_L2_HEADING_ALIGN_DEG;
}

function headingMatchesTravel(
  segBearing: number,
  travelHeadingDeg: number,
  speedKmh?: number,
): boolean {
  if (!Number.isFinite(travelHeadingDeg)) return true;
  return headingDeltaAbs(segBearing, travelHeadingDeg) <= headingAlignDeg(speedKmh);
}

/**
 * Synchroniczne lustro L2 (RoadGeometryStore) — wypełniane asynchronicznie przez DriveEngine.
 * Snap w worklecie ticku GPS bez czekania na Mapbox flushBatch.
 */
export class LocalRoadGeometryMirror {
  private polylines: RoadPoint[][] = [];
  private updatedAt = 0;

  clear(): void {
    this.polylines = [];
    this.updatedAt = 0;
  }

  setPolylines(segments: RoadPoint[][]): void {
    const valid = segments.filter((s) => s.length >= 2);
    if (valid.length < 1) return;
    this.polylines = valid.slice(0, MAX_STORED_POLYLINES);
    this.updatedAt = Date.now();
  }

  hasGeometry(): boolean {
    return (
      this.polylines.length > 0
      && Date.now() - this.updatedAt <= MIRROR_TTL_MS
    );
  }

  getPolylines(): RoadPoint[][] {
    return this.hasGeometry() ? this.polylines : [];
  }

  /**
   * Heading-filter + score; nearest tylko gdy kąt OK względem ruchu.
   */
  snapToLocalRoadBest(
    lat: number,
    lng: number,
    travelHeadingDeg: number,
    radiusM: number = LOCAL_L2_SNAP_RADIUS_M,
    speedKmh?: number,
  ): SnappedPose | null {
    const withHeading = this.snapToLocalRoad(lat, lng, travelHeadingDeg, radiusM, speedKmh);
    const nearest = this.snapToLocalRoadNearest(
      lat,
      lng,
      Math.max(radiusM, LOCAL_L2_SNAP_WIDE_M),
      travelHeadingDeg,
      speedKmh,
    );
    if (!withHeading) return nearest;
    if (!nearest) return withHeading;
    const nearestAngleOk = !Number.isFinite(travelHeadingDeg)
      || headingDeltaAbs(nearest.heading, travelHeadingDeg) <= LOCAL_L2_NEAREST_MAX_ANGLE_DEG;
    if (!nearestAngleOk) return withHeading;
    const withScore = snapSegmentScore(
      withHeading.crossTrackM,
      withHeading.heading,
      travelHeadingDeg,
      speedKmh,
    ) ?? Infinity;
    const nearScore = snapSegmentScore(
      nearest.crossTrackM,
      nearest.heading,
      travelHeadingDeg,
      speedKmh,
    ) ?? Infinity;
    return withScore <= nearScore ? withHeading : nearest;
  }

  snapToLocalRoad(
    lat: number,
    lng: number,
    travelHeadingDeg: number,
    radiusM: number = LOCAL_L2_SNAP_RADIUS_M,
    speedKmh?: number,
  ): SnappedPose | null {
    if (!this.hasGeometry()) return null;

    let bestScore = Infinity;
    let bestCross = Infinity;
    let bestLat = lat;
    let bestLng = lng;
    let bestHeading = travelHeadingDeg;
    let bestSegIdx = 0;

    for (const poly of this.polylines) {
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const segH = segmentBearing(a, b);
        if (!headingMatchesTravel(segH, travelHeadingDeg, speedKmh)) continue;

        const onSeg = closestPointOnSegment(lat, lng, a, b);
        const centerDistM = distanceM(lat, lng, onSeg.lat, onSeg.lng);
        if (centerDistM > LOCAL_L2_SNAP_WIDE_M + 15) continue;
        if (onSeg.crossTrackM > radiusM) continue;

        const score = snapSegmentScore(onSeg.crossTrackM, segH, travelHeadingDeg, speedKmh);
        if (score == null || score >= bestScore) continue;
        bestScore = score;
        bestCross = onSeg.crossTrackM;
        bestLat = onSeg.lat;
        bestLng = onSeg.lng;
        bestHeading = segH;
        bestSegIdx = i;
      }
    }

    if (!Number.isFinite(bestCross) || bestCross > radiusM) {
      return null;
    }

    return {
      lat: bestLat,
      lng: bestLng,
      heading: bestHeading,
      crossTrackM: bestCross,
      segmentIndex: bestSegIdx,
    };
  }

  snapToLocalRoadNearest(
    lat: number,
    lng: number,
    radiusM: number = LOCAL_L2_SNAP_WIDE_M,
    travelHeadingDeg?: number,
    speedKmh?: number,
  ): SnappedPose | null {
    if (!this.hasGeometry()) return null;

    let bestScore = Infinity;
    let bestCross = Infinity;
    let bestLat = lat;
    let bestLng = lng;
    let bestHeading = 0;
    let bestSegIdx = 0;

    for (const poly of this.polylines) {
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const segH = segmentBearing(a, b);
        if (
          Number.isFinite(travelHeadingDeg)
          && headingDeltaAbs(segH, travelHeadingDeg!) > LOCAL_L2_NEAREST_MAX_ANGLE_DEG
        ) {
          continue;
        }
        const onSeg = closestPointOnSegment(lat, lng, a, b);
        if (onSeg.crossTrackM > radiusM) continue;

        const score = snapSegmentScore(onSeg.crossTrackM, segH, travelHeadingDeg, speedKmh);
        if (score == null || score >= bestScore) continue;
        bestScore = score;
        bestCross = onSeg.crossTrackM;
        bestLat = onSeg.lat;
        bestLng = onSeg.lng;
        bestHeading = segH;
        bestSegIdx = i;
      }
    }

    if (!Number.isFinite(bestCross) || bestCross > radiusM) {
      return null;
    }

    return {
      lat: bestLat,
      lng: bestLng,
      heading: bestHeading,
      crossTrackM: bestCross,
      segmentIndex: bestSegIdx,
    };
  }
}

export const localRoadGeometryMirror = new LocalRoadGeometryMirror();
