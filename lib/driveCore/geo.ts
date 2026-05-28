import {
  bearingBetween,
  densifyPolyline,
  distanceToSegmentMeters,
  haversineKm,
  projectOntoPolylineWithIndex,
} from '../../scripts/navigationUtils';
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

export function projectOnPolylineForward(
  lat: number,
  lng: number,
  points: RoadPoint[],
  minSegmentIndex: number,
  maxRadiusM: number,
): {
  lat: number;
  lng: number;
  heading: number;
  crossTrackM: number;
  segmentIndex: number;
} | null {
  if (points.length < 2) return null;
  const proj = projectOntoPolylineWithIndex(lat, lng, points, maxRadiusM);
  if (!proj) return null;
  let segIdx = proj.segmentIndex;
  if (segIdx < minSegmentIndex) {
    segIdx = Math.min(minSegmentIndex, points.length - 2);
  }
  const a = points[segIdx];
  const b = points[segIdx + 1];
  const onSeg = closestPointOnSegment(lat, lng, a, b);
  if (onSeg.crossTrackM > maxRadiusM) return null;
  const heading = bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
  return {
    lat: onSeg.lat,
    lng: onSeg.lng,
    heading,
    crossTrackM: onSeg.crossTrackM,
    segmentIndex: segIdx,
  };
}
