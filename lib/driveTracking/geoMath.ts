import {
  alignBearingToReference,
  bearingBetween,
  haversineKm,
  projectOntoPolylineWithIndex,
} from '../../scripts/navigationUtils';
import type { LatLng } from './types';

export { bearingBetween, haversineKm, alignBearingToReference, projectOntoPolylineWithIndex };

export function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  return haversineKm(aLat, aLng, bLat, bLng) * 1000;
}

export function headingDeltaDeg(a: number, b: number): number {
  return Math.abs((((a - b) + 540) % 360) - 180);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function lerpHeading(from: number, to: number, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  const diff = ((to - from + 540) % 360) - 180;
  return ((from + diff * u) + 360) % 360;
}

export function lerpHeadingRate(from: number, to: number, maxDegPerSec: number, dtSec: number): number {
  const diff = ((to - from + 540) % 360) - 180;
  const maxStep = maxDegPerSec * dtSec;
  const clamped = Math.max(-maxStep, Math.min(maxStep, diff));
  return ((from + clamped) + 360) % 360;
}

/** Local tangent plane: lat/lng → east/north meters relative to anchor. */
export function toLocalEnuM(
  anchorLat: number,
  anchorLng: number,
  lat: number,
  lng: number,
): { east: number; north: number } {
  const latRad = (anchorLat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(latRad);
  return {
    east: (lng - anchorLng) * mPerDegLng,
    north: (lat - anchorLat) * mPerDegLat,
  };
}

export function fromLocalEnuM(
  anchorLat: number,
  anchorLng: number,
  east: number,
  north: number,
): LatLng {
  const latRad = (anchorLat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(latRad);
  return {
    latitude: anchorLat + north / mPerDegLat,
    longitude: anchorLng + east / Math.max(mPerDegLng, 1e-6),
  };
}

export function moveAlongBearingM(
  lat: number,
  lng: number,
  bearingDeg: number,
  distM: number,
): LatLng {
  const R = 6_371_000;
  const br = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const dLat = ((distM * Math.cos(br)) / R) * (180 / Math.PI);
  const cosLat = Math.cos(latRad);
  const dLng = cosLat > 1e-6
    ? ((distM * Math.sin(br)) / (R * cosLat)) * (180 / Math.PI)
    : 0;
  return { latitude: lat + dLat, longitude: lng + dLng };
}

export function sliceRoadWindow(
  roadPts: LatLng[],
  lat: number,
  lng: number,
  before = 22,
  after = 22,
): LatLng[] | null {
  if (roadPts.length < 2) return null;
  let bestI = 0;
  let bestD = Infinity;
  const step = roadPts.length > 140 ? 3 : 1;
  for (let i = 0; i < roadPts.length; i += step) {
    const p = roadPts[i];
    const d = haversineM(lat, lng, p.latitude, p.longitude);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const start = Math.max(0, bestI - before);
  const end = Math.min(roadPts.length, bestI + after);
  const win = roadPts.slice(start, end);
  return win.length >= 2 ? win : null;
}
