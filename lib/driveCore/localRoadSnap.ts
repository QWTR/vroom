import { bearingBetween, closestPointOnSegment, distanceM } from './geo';
import type { RoadPoint, SnappedPose } from './types';

/** Promień wyszukiwania segmentów L2 wokół GPS (m). */
export const LOCAL_L2_SNAP_RADIUS_M = 70;
export const LOCAL_L2_SNAP_WIDE_M = 80;
/** Segment musi być zgodny z kierunkiem jazdy ±45°. */
export const LOCAL_L2_HEADING_ALIGN_DEG = 45;
const MIRROR_TTL_MS = 180_000;
const MAX_STORED_POLYLINES = 36;

function headingDeltaDeg(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}

function segmentBearing(a: RoadPoint, b: RoadPoint): number {
  return bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
}

function headingMatchesTravel(segBearing: number, travelHeadingDeg: number): boolean {
  if (!Number.isFinite(travelHeadingDeg)) return true;
  return headingDeltaDeg(segBearing, travelHeadingDeg) <= LOCAL_L2_HEADING_ALIGN_DEG;
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
   * Rzut prostopadły na najbliższy segment z lokalnej bazy, z filtrem heading.
   */
  snapToLocalRoad(
    lat: number,
    lng: number,
    travelHeadingDeg: number,
    radiusM: number = LOCAL_L2_SNAP_RADIUS_M,
  ): SnappedPose | null {
    if (!this.hasGeometry()) return null;

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
        if (!headingMatchesTravel(segH, travelHeadingDeg)) continue;

        const onSeg = closestPointOnSegment(lat, lng, a, b);
        const centerDistM = distanceM(lat, lng, onSeg.lat, onSeg.lng);
        if (centerDistM > LOCAL_L2_SNAP_WIDE_M + 15) continue;
        if (onSeg.crossTrackM > radiusM) continue;

        if (onSeg.crossTrackM < bestCross) {
          bestCross = onSeg.crossTrackM;
          bestLat = onSeg.lat;
          bestLng = onSeg.lng;
          bestHeading = segH;
          bestSegIdx = i;
        }
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

  /**
   * Najbliższy segment bez filtra heading — fallback przy ruchu gdy filtr odrzuca wszystko.
   */
  snapToLocalRoadNearest(
    lat: number,
    lng: number,
    radiusM: number = LOCAL_L2_SNAP_WIDE_M,
  ): SnappedPose | null {
    if (!this.hasGeometry()) return null;

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
        const onSeg = closestPointOnSegment(lat, lng, a, b);
        if (onSeg.crossTrackM > radiusM) continue;

        if (onSeg.crossTrackM < bestCross) {
          bestCross = onSeg.crossTrackM;
          bestLat = onSeg.lat;
          bestLng = onSeg.lng;
          bestHeading = segH;
          bestSegIdx = i;
        }
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
