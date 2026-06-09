import {
  alignBearingToReference,
  bearingBetween,
  densifyPolyline,
  distanceToSegmentMeters,
  haversineKm,
  stepTowardSnapOnPolyline,
} from '../../scripts/navigationUtils';
import {
  ARC_WINDOW_AHEAD_BASE_M,
  ARC_WINDOW_AHEAD_SPEED_SEC,
  ARC_WINDOW_BACK_M,
  ARC_WINDOW_MAX_NODES,
  ROUTE_DEVIATION_ANGLE_DEG,
  ROUTE_DEVIATION_CROSS_TRACK_M,
  ROUTE_DEVIATION_TICKS,
  ROUTE_GRAVITY_CROSS_TRACK_MULT,
  SNAP_ANGLE_REJECT_DEG,
  SNAP_ANGLE_REJECT_HIGHWAY_DEG,
  SNAP_ANGLE_SOFT_DEG,
  SNAP_ANGLE_WEIGHT,
  SNAP_HIGHWAY_SPEED_KMH,
} from './config';
import type { RoadPoint } from './types';

export { bearingBetween, densifyPolyline, haversineKm };

export function distanceM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  return haversineKm(aLat, aLng, bLat, bLng) * 1000;
}

export function remainingAlongPolylineM(
  points: RoadPoint[],
  segmentIndex: number,
  atLat: number,
  atLng: number,
): number {
  if (points.length < 2) return 0;
  const seg = Math.max(0, Math.min(segmentIndex, points.length - 2));
  let sum = distanceM(atLat, atLng, points[seg + 1].latitude, points[seg + 1].longitude);
  for (let i = seg + 1; i < points.length - 1; i++) {
    sum += distanceM(
      points[i].latitude,
      points[i].longitude,
      points[i + 1].latitude,
      points[i + 1].longitude,
    );
  }
  return sum;
}

export type PolylineArc = {
  cumM: number[];
  totalM: number;
};

/** Skumulowane długości wzdłuż polilinii (0 → totalM). */
export function buildPolylineArc(points: RoadPoint[]): PolylineArc | null {
  if (points.length < 2) return null;
  const cumM = [0];
  for (let i = 0; i < points.length - 1; i++) {
    cumM.push(
      cumM[i] + distanceM(
        points[i].latitude,
        points[i].longitude,
        points[i + 1].latitude,
        points[i + 1].longitude,
      ),
    );
  }
  return { cumM, totalM: cumM[cumM.length - 1] };
}

/** Rzut punktu na polilinię → skalar arcM (1D progress) + cross-track. */
export function arcLengthAtPoint(
  points: RoadPoint[],
  arc: PolylineArc,
  lat: number,
  lng: number,
  minSegmentIndex: number,
  maxRadiusM = 2500,
): { arcM: number; segmentIndex: number; crossTrackM: number } | null {
  const proj = projectOnPolylineForward(lat, lng, points, minSegmentIndex, maxRadiusM);
  if (!proj) return null;
  const seg = proj.segmentIndex;
  const a = points[seg];
  const alongSegM = distanceM(a.latitude, a.longitude, proj.lat, proj.lng);
  return {
    arcM: arc.cumM[seg] + Math.max(0, alongSegM),
    segmentIndex: seg,
    crossTrackM: proj.crossTrackM,
  };
}

/** Konwersja 1D arcM → pozycja wyłącznie na osi drogi (środek linii). */
export function pointAtArcLength(
  points: RoadPoint[],
  arc: PolylineArc,
  arcM: number,
  travelHeadingDeg?: number,
): { lat: number; lng: number; segmentIndex: number; heading: number } {
  const clamped = Math.max(0, Math.min(arc.totalM, arcM));
  let seg = 0;
  for (let i = 0; i < arc.cumM.length - 1; i++) {
    if (clamped <= arc.cumM[i + 1] + 1e-9) {
      seg = i;
      break;
    }
    seg = i;
  }
  const a = points[seg];
  const b = points[seg + 1];
  const segStart = arc.cumM[seg];
  const segLen = Math.max(0.001, arc.cumM[seg + 1] - segStart);
  const t = Math.max(0, Math.min(1, (clamped - segStart) / segLen));
  const lat = a.latitude + t * (b.latitude - a.latitude);
  const lng = a.longitude + t * (b.longitude - a.longitude);
  let heading = bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
  if (Number.isFinite(travelHeadingDeg)) {
    heading = alignBearingToReference(heading, travelHeadingDeg!);
  }
  return { lat, lng, segmentIndex: seg, heading };
}

export function headingDeltaShort(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

export function headingDeltaAbs(from: number, to: number): number {
  return Math.abs(headingDeltaShort(from, to));
}

export type SnapSegmentScoreOpts = {
  /** Segment leży na polilinii trasy nawigacyjnej. */
  onRoutePolyline?: boolean;
  /** Segment ciągły względem poprzedniego (bez skoku na gałąź). */
  segmentConnected?: boolean;
};

/** Score segmentu snap — niższy = lepszy; null = hard reject (kąt). */
export function snapSegmentScore(
  crossTrackM: number,
  segBearing: number,
  travelHeadingDeg?: number,
  speedKmh?: number,
  opts?: SnapSegmentScoreOpts,
): number | null {
  let effectiveCross = crossTrackM;
  if (opts?.onRoutePolyline && opts?.segmentConnected) {
    effectiveCross = crossTrackM / ROUTE_GRAVITY_CROSS_TRACK_MULT;
  } else if (opts?.onRoutePolyline) {
    effectiveCross = crossTrackM * 0.85;
  } else {
    effectiveCross = crossTrackM * ROUTE_GRAVITY_CROSS_TRACK_MULT;
  }

  if (!Number.isFinite(travelHeadingDeg)) {
    return effectiveCross;
  }
  const angleDelta = headingDeltaAbs(segBearing, travelHeadingDeg!);
  const rejectDeg = (speedKmh ?? 0) >= SNAP_HIGHWAY_SPEED_KMH
    ? SNAP_ANGLE_REJECT_HIGHWAY_DEG
    : SNAP_ANGLE_REJECT_DEG;
  if (angleDelta > rejectDeg) return null;
  const penalty = Math.max(0, angleDelta - SNAP_ANGLE_SOFT_DEG) * SNAP_ANGLE_WEIGHT;
  return effectiveCross + penalty;
}

/** Escape z trasy dopiero po N tickach dużego kąta + cross-track. */
export class RouteDeviationTracker {
  private ticks = 0;

  reset(): void {
    this.ticks = 0;
  }

  isDeviated(angleDeg: number, crossTrackM: number): boolean {
    if (
      angleDeg >= ROUTE_DEVIATION_ANGLE_DEG
      && crossTrackM >= ROUTE_DEVIATION_CROSS_TRACK_M
    ) {
      this.ticks += 1;
    } else {
      this.ticks = 0;
    }
    return this.ticks >= ROUTE_DEVIATION_TICKS;
  }
}

export type ArcWindowSlice = {
  points: { lat: number; lng: number }[];
  cumM: number[];
  baseArcM: number;
  totalM: number;
};

/** Wycinek polilinii dla workletu coast (max 32 węzły). */
export function buildArcWindow(
  points: RoadPoint[],
  arc: PolylineArc,
  arcM: number,
  speedMs: number,
): ArcWindowSlice | null {
  if (points.length < 2 || arc.totalM <= 0) return null;

  const aheadM = ARC_WINDOW_AHEAD_BASE_M + Math.max(0, speedMs) * ARC_WINDOW_AHEAD_SPEED_SEC;
  const winStart = Math.max(0, arcM - ARC_WINDOW_BACK_M);
  const winEnd = Math.min(arc.totalM, arcM + aheadM);

  const slicePoints: { lat: number; lng: number }[] = [];
  const sliceCum: number[] = [0];
  let lastAddedArc = -1;

  for (let i = 0; i < points.length - 1; i++) {
    const segStart = arc.cumM[i];
    const segEnd = arc.cumM[i + 1];
    if (segEnd < winStart || segStart > winEnd) continue;

    const addNode = (idx: number, arcPos: number) => {
      if (slicePoints.length >= ARC_WINDOW_MAX_NODES) return;
      if (arcPos <= lastAddedArc + 0.05) return;
      const p = points[idx];
      slicePoints.push({ lat: p.latitude, lng: p.longitude });
      if (slicePoints.length > 1) {
        const prev = slicePoints[slicePoints.length - 2];
        const stepM = distanceM(prev.lat, prev.lng, p.latitude, p.longitude);
        sliceCum.push(sliceCum[sliceCum.length - 1] + stepM);
      }
      lastAddedArc = arcPos;
    };

    if (segStart >= winStart && segStart <= winEnd) {
      addNode(i, segStart);
    }
    if (segEnd >= winStart && segEnd <= winEnd) {
      addNode(i + 1, segEnd);
    }
  }

  if (slicePoints.length < 2) {
    const pose = pointAtArcLength(points, arc, arcM);
    const nextPose = pointAtArcLength(points, arc, Math.min(arc.totalM, arcM + 20));
    return {
      points: [
        { lat: pose.lat, lng: pose.lng },
        { lat: nextPose.lat, lng: nextPose.lng },
      ],
      cumM: [0, distanceM(pose.lat, pose.lng, nextPose.lat, nextPose.lng)],
      baseArcM: arcM,
      totalM: distanceM(pose.lat, pose.lng, nextPose.lat, nextPose.lng),
    };
  }

  return {
    points: slicePoints,
    cumM: sliceCum,
    baseArcM: winStart,
    totalM: sliceCum[sliceCum.length - 1],
  };
}

export function smoothHeadingEma(
  current: number,
  target: number,
  dtSec: number,
  tauSec: number,
): number {
  const alpha = 1 - Math.exp(-Math.max(0.001, dtSec) / Math.max(0.05, tauSec));
  const delta = headingDeltaShort(current, target);
  return ((current + delta * alpha) % 360 + 360) % 360;
}

export function closestPointOnSegment(
  lat: number,
  lng: number,
  a: RoadPoint,
  b: RoadPoint,
): { lat: number; lng: number; crossTrackM: number } {
  const aLat = a.latitude;
  const aLng = a.longitude;
  const bLat = b.latitude;
  const bLng = b.longitude;
  const crossTrackM = distanceToSegmentMeters(lat, lng, aLat, aLng, bLat, bLng);
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const ax = R * Math.cos(toRad(aLat)) * toRad(aLng);
  const ay = R * toRad(aLat);
  const bx = R * Math.cos(toRad(bLat)) * toRad(bLng);
  const by = R * toRad(bLat);
  const px = R * Math.cos(toRad(lat)) * toRad(lng);
  const py = R * toRad(lat);
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  return {
    lat: aLat + t * (bLat - aLat),
    lng: aLng + t * (bLng - aLng),
    crossTrackM,
  };
}

/**
 * Snap tylko do segmentów >= minSegmentIndex (bez cofania + bez „skoku” na zły segment).
 */
export function projectOnPolylineForward(
  lat: number,
  lng: number,
  points: RoadPoint[],
  minSegmentIndex: number,
  maxRadiusM: number,
  travelHeadingDeg?: number,
  speedKmh?: number,
  routeGravity?: {
    onRoutePolyline: boolean;
    lastSegmentIndex?: number;
  },
): {
  lat: number;
  lng: number;
  heading: number;
  crossTrackM: number;
  segmentIndex: number;
} | null {
  if (points.length < 2) return null;
  const minSeg = Math.max(0, Math.min(minSegmentIndex, points.length - 2));

  let bestScore = Infinity;
  let bestCross = Infinity;
  let bestLat = lat;
  let bestLng = lng;
  let bestSeg = minSeg;

  for (let i = minSeg; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const onSeg = closestPointOnSegment(lat, lng, a, b);
    if (onSeg.crossTrackM > maxRadiusM) continue;
    const segBearing = bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
    const segmentConnected = routeGravity?.onRoutePolyline === true
      && routeGravity.lastSegmentIndex != null
      && Math.abs(i - routeGravity.lastSegmentIndex) <= 1;
    const score = snapSegmentScore(
      onSeg.crossTrackM,
      segBearing,
      travelHeadingDeg,
      speedKmh,
      {
        onRoutePolyline: routeGravity?.onRoutePolyline,
        segmentConnected,
      },
    );
    if (score == null) continue;
    if (score < bestScore) {
      bestScore = score;
      bestCross = onSeg.crossTrackM;
      bestLat = onSeg.lat;
      bestLng = onSeg.lng;
      bestSeg = i;
    }
  }

  if (!Number.isFinite(bestCross) || bestCross > maxRadiusM) return null;

  const a = points[bestSeg];
  const b = points[bestSeg + 1];
  let heading = bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
  if (Number.isFinite(travelHeadingDeg)) {
    heading = alignBearingToReference(heading, travelHeadingDeg!);
  }
  return {
    lat: bestLat,
    lng: bestLng,
    heading,
    crossTrackM: bestCross,
    segmentIndex: bestSeg,
  };
}

/** Płynny krok wzdłuż polilinii (nie po skosie mapy). */
export function stepPoseOnPolyline(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  points: RoadPoint[],
  maxStepM: number,
  maxSnapM = 120,
): { lat: number; lng: number } {
  const stepped = stepTowardSnapOnPolyline(
    fromLat,
    fromLng,
    toLat,
    toLng,
    points,
    maxStepM,
    maxSnapM,
  );
  return { lat: stepped.latitude, lng: stepped.longitude };
}
