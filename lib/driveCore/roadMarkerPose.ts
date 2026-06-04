import { densifyPolyline, projectOntoPolylineWithIndex, snapStepTowardRoad } from '../../scripts/navigationUtils';
import {
  bearingBetween,
  distanceM,
  projectOnPolylineForward,
  stepPoseOnPolyline,
} from './geo';
import { localRoadGeometryMirror } from './localRoadSnap';
import type { RoadPoint, SnappedPose } from './types';

function collectDisplayPolylines(explicit: RoadPoint[]): RoadPoint[][] {
  const out: RoadPoint[][] = [];
  if (explicit.length >= 2) out.push(explicit);
  for (const poly of localRoadGeometryMirror.getPolylines()) {
    if (poly.length >= 2) out.push(poly);
  }
  return out;
}

/** crossTrackM z rawGpsPose — brak snapu na drodze. */
const RAW_GPS_CROSS_TRACK_M = 150;

type RoadProjection = {
  lat: number;
  lng: number;
  heading: number;
  crossTrackM: number;
  segmentIndex: number;
};

export type RoadMarkerInput = {
  prev: { lat: number; lng: number } | null;
  enginePose: SnappedPose;
  roadPolylines: RoadPoint[][];
  speedKmh: number;
  travelHeadingDeg: number;
  rawLat: number;
  rawLng: number;
  isNavigating: boolean;
  /** Ostatni znany segment drogi — zapobiega cofaniu markera wzdłuż osi. */
  lastSegmentIndex?: number | null;
};

export type RoadMarkerResult = {
  lat: number;
  lng: number;
  onRoad: boolean;
  crossTrackM: number;
  segmentIndex: number;
  heading: number;
};

let lastSegmentIndex = 0;

export function resetRoadMarkerPoseState(): void {
  lastSegmentIndex = 0;
}

export function getRoadMarkerSegmentIndex(): number {
  return lastSegmentIndex;
}

function isRawGpsPose(pose: SnappedPose): boolean {
  return pose.crossTrackM >= RAW_GPS_CROSS_TRACK_M;
}

function computeMaxStepM(speedKmh: number): number {
  const v = Math.max(0, speedKmh / 3.6);
  const dt = 0.5;
  return Math.min(36, Math.max(3.5, v * dt * 1.12 + 2));
}

function computeLateralPullM(speedKmh: number, crossTrackM: number): number {
  if (crossTrackM < 0.8) return 0;
  const base = speedKmh < 2.5 ? 14 : speedKmh < 25 ? 10 : 7;
  return Math.min(base, Math.max(2.5, crossTrackM * 0.42));
}

function toNavPoints(poly: RoadPoint[]): { latitude: number; longitude: number }[] {
  return poly;
}

function collectPolylines(explicit: RoadPoint[][]): RoadPoint[][] {
  const out: RoadPoint[][] = [];
  for (const poly of explicit) {
    if (poly.length >= 2) out.push(poly);
  }
  for (const poly of localRoadGeometryMirror.getPolylines()) {
    if (poly.length >= 2) out.push(poly);
  }
  return out;
}

function pickBestPolyline(
  polylines: RoadPoint[][],
  refLat: number,
  refLng: number,
  maxRadiusM: number,
): RoadPoint[] | null {
  let best: RoadPoint[] | null = null;
  let bestCross = Infinity;
  for (const poly of polylines) {
    const proj = projectOnPolylineForward(refLat, refLng, poly, 0, maxRadiusM + 25);
    if (!proj) continue;
    if (proj.crossTrackM < bestCross) {
      bestCross = proj.crossTrackM;
      best = poly;
    }
  }
  return best;
}

function projectForward(
  lat: number,
  lng: number,
  poly: RoadPoint[],
  minSeg: number,
  maxRadiusM: number,
): RoadProjection | null {
  return projectOnPolylineForward(lat, lng, poly, minSeg, maxRadiusM);
}

function isForwardOf(
  poly: RoadPoint[],
  from: RoadProjection,
  to: RoadProjection,
): boolean {
  if (to.segmentIndex > from.segmentIndex) return true;
  if (to.segmentIndex < from.segmentIndex) return false;
  const seg = poly[from.segmentIndex];
  if (!seg) return false;
  const aDist = distanceM(seg.latitude, seg.longitude, from.lat, from.lng);
  const bDist = distanceM(seg.latitude, seg.longitude, to.lat, to.lng);
  return bDist > aDist + 0.35;
}

function pickTargetProjection(
  poly: RoadPoint[],
  prevProj: RoadProjection | null,
  candidates: (RoadProjection | null)[],
): RoadProjection | null {
  const valid = candidates.filter((c): c is RoadProjection => !!c);
  if (valid.length < 1) return null;

  let pool = valid;
  if (prevProj) {
    const forward = valid.filter((c) => isForwardOf(poly, prevProj, c));
    if (forward.length > 0) pool = forward;
  }

  pool.sort((a, b) => {
    if (b.segmentIndex !== a.segmentIndex) return b.segmentIndex - a.segmentIndex;
    if (a.crossTrackM !== b.crossTrackM) return a.crossTrackM - b.crossTrackM;
    return 0;
  });
  return pool[0] ?? null;
}

function pullLaterallyOntoRoad(
  lat: number,
  lng: number,
  poly: RoadPoint[],
  maxRadiusM: number,
  pullM: number,
): { lat: number; lng: number } | null {
  if (pullM <= 0) return null;
  const pulled = snapStepTowardRoad(lat, lng, toNavPoints(poly), maxRadiusM + 20, pullM);
  if (!pulled) return null;
  return { lat: pulled.latitude, lng: pulled.longitude };
}

/**
 * SSOT pozycji markera na drodze — zawsze na polilinii gdy jest geometria.
 * Raw GPS służy tylko do wyboru segmentu drogi, nigdy jako końcowa pozycja.
 */
export function resolveRoadMarkerPose(input: RoadMarkerInput): RoadMarkerResult {
  const {
    prev,
    enginePose,
    roadPolylines,
    speedKmh,
    travelHeadingDeg,
    rawLat,
    rawLng,
    isNavigating,
  } = input;

  const maxRadiusM = isNavigating ? 50 : 100;
  const maxStepM = computeMaxStepM(speedKmh);
  const polylines = collectPolylines(roadPolylines);

  const refLat = prev?.lat ?? (isRawGpsPose(enginePose) ? rawLat : enginePose.lat);
  const refLng = prev?.lng ?? (isRawGpsPose(enginePose) ? rawLng : enginePose.lng);
  const poly = pickBestPolyline(polylines, refLat, refLng, maxRadiusM);

  if (!poly) {
    const tgtLat = isRawGpsPose(enginePose) ? rawLat : enginePose.lat;
    const tgtLng = isRawGpsPose(enginePose) ? rawLng : enginePose.lng;
    if (prev) {
      const distM = distanceM(prev.lat, prev.lng, tgtLat, tgtLng);
      if (distM > 0.05) {
        const stepM = Math.min(maxStepM, distM);
        const frac = stepM / distM;
        return {
          lat: prev.lat + (tgtLat - prev.lat) * frac,
          lng: prev.lng + (tgtLng - prev.lng) * frac,
          onRoad: false,
          crossTrackM: enginePose.crossTrackM,
          segmentIndex: lastSegmentIndex,
          heading: Number.isFinite(travelHeadingDeg) ? travelHeadingDeg : enginePose.heading,
        };
      }
    }
    return {
      lat: tgtLat,
      lng: tgtLng,
      onRoad: !isRawGpsPose(enginePose),
      crossTrackM: enginePose.crossTrackM,
      segmentIndex: enginePose.segmentIndex,
      heading: enginePose.heading,
    };
  }

  const minSeg = Math.max(0, (input.lastSegmentIndex ?? lastSegmentIndex) - 1);

  let prevProj: RoadProjection | null = null;
  if (prev) {
    prevProj = projectForward(prev.lat, prev.lng, poly, minSeg, maxRadiusM + 30);
    if (!prevProj) {
      prevProj = projectForward(prev.lat, prev.lng, poly, 0, maxRadiusM + 40);
    }
  }

  const rawProj = projectForward(rawLat, rawLng, poly, minSeg, maxRadiusM + 30)
    ?? projectForward(rawLat, rawLng, poly, 0, maxRadiusM + 50);
  const engineProj = isRawGpsPose(enginePose)
    ? null
    : projectForward(enginePose.lat, enginePose.lng, poly, minSeg, maxRadiusM + 20);

  let localProj: RoadProjection | null = null;
  if (!isNavigating) {
    const local = localRoadGeometryMirror.snapToLocalRoadBest(
      rawLat,
      rawLng,
      travelHeadingDeg,
    );
    if (local && local.crossTrackM <= maxRadiusM + 15) {
      localProj = {
        lat: local.lat,
        lng: local.lng,
        heading: local.heading,
        crossTrackM: local.crossTrackM,
        segmentIndex: local.segmentIndex,
      };
    }
  }

  // SSOT target: GPS rzutowany na drogę → lokalny L2 → silnik (tylko gdy nie raw fallback).
  let target = pickTargetProjection(poly, prevProj, [rawProj, localProj, engineProj])
    ?? prevProj
    ?? rawProj
    ?? localProj
    ?? engineProj;

  if (
    prevProj
    && target
    && rawProj
    && distanceM(prevProj.lat, prevProj.lng, target.lat, target.lng) < 0.6
    && isForwardOf(poly, prevProj, rawProj)
  ) {
    target = rawProj;
  }

  if (!target) {
    const hold = prev ?? { lat: enginePose.lat, lng: enginePose.lng };
    return {
      lat: hold.lat,
      lng: hold.lng,
      onRoad: false,
      crossTrackM: 999,
      segmentIndex: lastSegmentIndex,
      heading: travelHeadingDeg,
    };
  }

  let fromLat = prev?.lat ?? target.lat;
  let fromLng = prev?.lng ?? target.lng;

  if (prev && prevProj && prevProj.crossTrackM > 1) {
    const pullM = computeLateralPullM(speedKmh, prevProj.crossTrackM);
    const pulled = pullLaterallyOntoRoad(fromLat, fromLng, poly, maxRadiusM, pullM);
    if (pulled) {
      fromLat = pulled.lat;
      fromLng = pulled.lng;
    }
  }

  let outLat = target.lat;
  let outLng = target.lng;

  if (prev && speedKmh >= 1.2) {
    const stepped = stepPoseOnPolyline(
      fromLat,
      fromLng,
      target.lat,
      target.lng,
      poly,
      maxStepM,
      maxRadiusM + 35,
    );
    outLat = stepped.lat;
    outLng = stepped.lng;
  } else if (prev) {
    const pullM = computeLateralPullM(speedKmh, prevProj?.crossTrackM ?? target.crossTrackM);
    const pulled = pullLaterallyOntoRoad(fromLat, fromLng, poly, maxRadiusM, Math.max(pullM, 4));
    if (pulled) {
      outLat = pulled.lat;
      outLng = pulled.lng;
    }
  }

  const finalMinSeg = prevProj
    ? Math.max(minSeg, prevProj.segmentIndex - 1)
    : minSeg;
  const finalProj = projectForward(outLat, outLng, poly, finalMinSeg, maxRadiusM + 35)
    ?? projectForward(outLat, outLng, poly, 0, maxRadiusM + 45);

  if (finalProj) {
    lastSegmentIndex = Math.max(lastSegmentIndex, finalProj.segmentIndex);
    return {
      lat: finalProj.lat,
      lng: finalProj.lng,
      onRoad: true,
      crossTrackM: finalProj.crossTrackM,
      segmentIndex: finalProj.segmentIndex,
      heading: finalProj.heading,
    };
  }

  lastSegmentIndex = Math.max(lastSegmentIndex, target.segmentIndex);
  return {
    lat: target.lat,
    lng: target.lng,
    onRoad: true,
    crossTrackM: target.crossTrackM,
    segmentIndex: target.segmentIndex,
    heading: target.heading,
  };
}

/**
 * Pozycja markera na ekranie — zawsze idzie do przodu gdy GPS się rusza.
 * Priorytet: raw→polilinia (explicit + L2) → krok w stronę raw (nie zamrożony engine).
 */
export function resolveDriveMarkerDisplayPose(input: {
  rawLat: number;
  rawLng: number;
  enginePose: SnappedPose;
  prev: { lat: number; lng: number } | null;
  speedKmh: number;
  roadPolyline: RoadPoint[];
}): { lat: number; lng: number; heading: number; onRoad: boolean } {
  const { rawLat, rawLng, enginePose, prev, speedKmh, roadPolyline } = input;
  const maxStepM = Math.min(38, Math.max(4, (speedKmh / 3.6) * 0.55 + 2));

  const stepFromPrev = (targetLat: number, targetLng: number) => {
    if (!prev) return { lat: targetLat, lng: targetLng };
    const distM = distanceM(prev.lat, prev.lng, targetLat, targetLng);
    if (distM <= maxStepM || distM < 0.05) return { lat: targetLat, lng: targetLng };
    const frac = maxStepM / distM;
    return {
      lat: prev.lat + (targetLat - prev.lat) * frac,
      lng: prev.lng + (targetLng - prev.lng) * frac,
    };
  };

  let bestProj: { lat: number; lng: number; heading: number; distM: number } | null = null;
  for (const poly of collectDisplayPolylines(roadPolyline)) {
    const dense = poly.length <= 8 ? densifyPolyline(poly, 6) : poly;
    const proj = projectOntoPolylineWithIndex(rawLat, rawLng, dense, 110);
    if (!proj || proj.distM > 95) continue;
    const segIdx = Math.max(0, Math.min(proj.segmentIndex, dense.length - 2));
    const a = dense[segIdx];
    const b = dense[segIdx + 1];
    const hdg = bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
    if (!bestProj || proj.distM < bestProj.distM) {
      bestProj = {
        lat: proj.latitude,
        lng: proj.longitude,
        heading: hdg,
        distM: proj.distM,
      };
    }
  }

  if (bestProj) {
    const stepped = stepFromPrev(bestProj.lat, bestProj.lng);
    return {
      lat: stepped.lat,
      lng: stepped.lng,
      heading: bestProj.heading,
      onRoad: true,
    };
  }

  const engineFrozen = !isRawGpsPose(enginePose)
    && prev
    && distanceM(prev.lat, prev.lng, enginePose.lat, enginePose.lng) < 1.2
    && distanceM(enginePose.lat, enginePose.lng, rawLat, rawLng) > 3;
  const useRawTarget = isRawGpsPose(enginePose) || engineFrozen || speedKmh >= 2.5;

  const targetLat = useRawTarget ? rawLat : enginePose.lat;
  const targetLng = useRawTarget ? rawLng : enginePose.lng;
  const stepped = stepFromPrev(targetLat, targetLng);
  let heading = enginePose.heading;
  if (useRawTarget && prev && speedKmh >= 2.5) {
    const moveHdg = bearingBetween(prev.lat, prev.lng, rawLat, rawLng);
    if (Number.isFinite(moveHdg)) heading = moveHdg;
  }

  return {
    lat: stepped.lat,
    lng: stepped.lng,
    heading,
    onRoad: !useRawTarget && !isRawGpsPose(enginePose),
  };
}
