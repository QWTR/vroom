import {
  bearingBetween,
  alignBearingToReference,
  densifyPolyline,
  haversineKm,
  projectOntoPolylineWithIndex,
  snapToRoute,
  stepTowardSnapOnPolyline,
} from '../../scripts/navigationUtils';
import { validateGeometryAgainstRaw } from '../../hooks/useDrivingSnap';

export function roadPolylineShiftM(
  prev: { latitude: number; longitude: number }[],
  next: { latitude: number; longitude: number }[],
): number {
  if (prev.length < 2 || next.length < 2) return Infinity;
  const startM = haversineKm(
    prev[0].latitude,
    prev[0].longitude,
    next[0].latitude,
    next[0].longitude,
  ) * 1000;
  const endM = haversineKm(
    prev[prev.length - 1].latitude,
    prev[prev.length - 1].longitude,
    next[next.length - 1].latitude,
    next[next.length - 1].longitude,
  ) * 1000;
  const pi = Math.floor(prev.length / 2);
  const qi = Math.floor(next.length / 2);
  const midM = haversineKm(
    prev[pi].latitude,
    prev[pi].longitude,
    next[qi].latitude,
    next[qi].longitude,
  ) * 1000;
  return Math.max(startM, endM, midM);
}

/** Akceptuj nową geometrię mimo dużego shiftM, gdy lepiej pasuje do raw GPS niż stara. */

export function shouldPreferNewRoadGeometry(
  prev: { latitude: number; longitude: number }[],
  next: { latitude: number; longitude: number }[],
  rawLat: number,
  rawLng: number,
): boolean {
  if (prev.length < 2) return true;
  if (!validateGeometryAgainstRaw(next, rawLat, rawLng, 45)) return false;
  if (!validateGeometryAgainstRaw(prev, rawLat, rawLng, 45)) return true;
  const prevSnap = snapToRoute(rawLat, rawLng, prev, 80);
  const nextSnap = snapToRoute(rawLat, rawLng, next, 80);
  const prevDistM = haversineKm(rawLat, rawLng, prevSnap.latitude, prevSnap.longitude) * 1000;
  const nextDistM = haversineKm(rawLat, rawLng, nextSnap.latitude, nextSnap.longitude) * 1000;
  return nextDistM + 8 < prevDistM;
}

/** Min. odstęp między lokalnym resolve (SQLite / tile / trasa) bez Mapbox. */

export function clampCoordStep(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  maxStepM: number,
): { latitude: number; longitude: number } {
  const distM = haversineKm(from.latitude, from.longitude, to.latitude, to.longitude) * 1000;
  if (!Number.isFinite(distM) || distM <= maxStepM) return to;
  const t = maxStepM / distM;
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    longitude: from.longitude + (to.longitude - from.longitude) * t,
  };
}

export function projectCoord(
  from: { latitude: number; longitude: number },
  headingDeg: number,
  distanceM: number,
): { latitude: number; longitude: number } {
  const R = 6371000;
  const br = (headingDeg * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lng1 = (from.longitude * Math.PI) / 180;
  const d = distanceM / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  );
  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lng2 * 180) / Math.PI,
  };
}

export function projectOntoDrivingRoad(
  lat: number,
  lng: number,
  rawLat: number,
  rawLng: number,
  roadPts: { latitude: number; longitude: number }[],
  maxProjM = 58,
): { latitude: number; longitude: number } | null {
  if (roadPts.length < 2) return null;
  const dense = roadPts.length <= 8 ? densifyPolyline(roadPts, 6) : roadPts;
  const snapProj = projectOntoPolylineWithIndex(lat, lng, dense, maxProjM);
  if (snapProj) {
    return { latitude: snapProj.latitude, longitude: snapProj.longitude };
  }
  const rawProj = projectOntoPolylineWithIndex(rawLat, rawLng, dense, maxProjM + 20);
  if (rawProj) {
    return { latitude: rawProj.latitude, longitude: rawProj.longitude };
  }
  return null;
}

/**
 * Snap na 2-punktowej geometrii trzyma tę samą kotwicę → raw ucieka 40–98 m (MARKER_PIPELINE_GAP).
 * Krokuj marker od bieżącej pozycji w stronę raw/snap, żeby feedMoveM > 0 co tick GPS.
 */

export function correctParallelRoadSnap(
  rawLat: number,
  rawLng: number,
  snapLat: number,
  snapLng: number,
  snapHeading: number,
  prevRaw: { lat: number; lng: number } | null,
  kmh: number,
): { lat: number; lng: number; heading: number; corrected: boolean } {
  const rawToSnapM = haversineKm(rawLat, rawLng, snapLat, snapLng) * 1000;
  if (rawToSnapM < 16 || kmh < 4) {
    return { lat: snapLat, lng: snapLng, heading: snapHeading, corrected: false };
  }
  const motionBrg = prevRaw
    ? bearingBetween(prevRaw.lat, prevRaw.lng, rawLat, rawLng)
    : null;
  if (!motionBrg || angleDeltaDegSimple(motionBrg, snapHeading) < 42) {
    return { lat: snapLat, lng: snapLng, heading: snapHeading, corrected: false };
  }
  const stepM = Math.min(rawToSnapM * 0.7, Math.max(8, kmh * 0.2 + 6));
  const c = clampCoordStep(
    { latitude: snapLat, longitude: snapLng },
    { latitude: rawLat, longitude: rawLng },
    stepM,
  );
  return {
    lat: c.latitude,
    lng: c.longitude,
    heading: motionBrg,
    corrected: true,
  };
}

/** Krok w tył względem kierunku jazdy — główna przyczyna „do przodu → cofka → znowu przód”. */

export function angleDeltaDegSimple(a: number, b: number): number {
  return Math.abs((((a - b) + 540) % 360) - 180);
}

/** Snap na równoległą ulicę — ciągnij w stronę raw GPS i kierunku jazdy. */

export function bearingAlongRoadAt(
  lat: number,
  lng: number,
  roadPts: { latitude: number; longitude: number }[],
): number | null {
  if (roadPts.length < 2) return null;
  const dense = roadPts.length <= 8 ? densifyPolyline(roadPts, 6) : roadPts;
  const proj = projectOntoPolylineWithIndex(lat, lng, dense, 85);
  if (!proj) return null;
  const i = proj.segmentIndex;
  if (i < 0 || i >= dense.length - 1) return null;
  return bearingBetween(
    dense[i].latitude,
    dense[i].longitude,
    dense[i + 1].latitude,
    dense[i + 1].longitude,
  );
}
