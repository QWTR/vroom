import { densifyPolyline, projectOntoPolylineWithIndex } from '../../scripts/navigationUtils';
import {
  arcLengthAtPoint,
  bearingBetween,
  buildPolylineArc,
  distanceM,
  pointAtArcLength,
  projectOnPolylineForward,
  smoothHeadingEma,
  type PolylineArc,
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

/** Poniżej: płynny spring/lerp wzdłuż osi drogi (bez teleportu). */
const SOFT_CATCHUP_M = 15;
/** Powyżej: twardy snap (U-turn, utrata GPS). */
const TELEPORT_M = 25;
/** EMA heading przy przejściach segmentów (200–300 ms). */
const HEADING_SMOOTH_TAU_SEC = 0.25;

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
let lastArcProgressM = 0;
let lastPolylineKey = '';
let smoothedRoadHeading = 0;
let lastHeadingSmoothMs = 0;

export function resetRoadMarkerPoseState(): void {
  lastSegmentIndex = 0;
  lastArcProgressM = 0;
  lastPolylineKey = '';
  smoothedRoadHeading = 0;
  lastHeadingSmoothMs = 0;
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

function pickBestPolylineAt(
  polylines: RoadPoint[][],
  refLat: number,
  refLng: number,
  searchRadiusM: number,
): { poly: RoadPoint[] | null; crossTrackM: number } {
  let best: RoadPoint[] | null = null;
  let bestCross = Infinity;
  for (const poly of polylines) {
    const proj = projectOnPolylineForward(refLat, refLng, poly, 0, searchRadiusM);
    if (!proj) continue;
    if (proj.crossTrackM < bestCross) {
      bestCross = proj.crossTrackM;
      best = poly;
    }
  }
  return { poly: best, crossTrackM: bestCross };
}

/** Priorytet: bieżący GPS — nie poprzedni marker (unika „kotwicy startu”). */
function pickBestPolyline(
  polylines: RoadPoint[][],
  rawLat: number,
  rawLng: number,
  maxRadiusM: number,
  prev: { lat: number; lng: number } | null,
): RoadPoint[] | null {
  const pickRadiusM = Math.min(3000, maxRadiusM + 120);
  const rawPick = pickBestPolylineAt(polylines, rawLat, rawLng, pickRadiusM);
  if (rawPick.poly && rawPick.crossTrackM <= maxRadiusM + 30) return rawPick.poly;

  const prevToRawM = prev ? distanceM(prev.lat, prev.lng, rawLat, rawLng) : 0;
  if (prevToRawM > 55 && rawPick.poly) {
    return rawPick.poly;
  }

  if (prev) {
    const prevPick = pickBestPolylineAt(polylines, prev.lat, prev.lng, pickRadiusM);
    if (
      prevPick.poly
      && (!rawPick.poly || prevPick.crossTrackM + 8 < rawPick.crossTrackM)
    ) {
      return prevPick.poly;
    }
  }
  return rawPick.poly;
}

function polylineKey(poly: RoadPoint[]): string {
  if (poly.length < 2) return '';
  const a = poly[0];
  const b = poly[poly.length - 1];
  return `${poly.length}:${a.latitude.toFixed(6)},${a.longitude.toFixed(6)}:${b.latitude.toFixed(6)},${b.longitude.toFixed(6)}`;
}

function projectForward(
  lat: number,
  lng: number,
  poly: RoadPoint[],
  minSeg: number,
  maxRadiusM: number,
  travelHeadingDeg?: number,
): RoadProjection | null {
  return projectOnPolylineForward(lat, lng, poly, minSeg, maxRadiusM, travelHeadingDeg);
}

function projectionToArc(
  poly: RoadPoint[],
  arc: PolylineArc,
  proj: RoadProjection,
): { arcM: number; crossTrackM: number; segmentIndex: number } {
  const at = arcLengthAtPoint(poly, arc, proj.lat, proj.lng, proj.segmentIndex, 2500);
  if (at) return at;
  return { arcM: arc.cumM[proj.segmentIndex] ?? 0, crossTrackM: proj.crossTrackM, segmentIndex: proj.segmentIndex };
}

function pickTargetArcM(
  prevArcM: number | null,
  candidates: { arcM: number; crossTrackM: number; segmentIndex: number }[],
): number | null {
  if (candidates.length < 1) return null;
  let pool = candidates;
  if (prevArcM != null) {
    const forward = candidates.filter((c) => c.arcM >= prevArcM - 0.5);
    if (forward.length > 0) pool = forward;
  }
  pool.sort((a, b) => {
    if (b.segmentIndex !== a.segmentIndex) return b.segmentIndex - a.segmentIndex;
    return a.crossTrackM - b.crossTrackM;
  });
  return pool[0]?.arcM ?? null;
}

/** 1D catch-up wzdłuż polilinii — bez lateral drift. */
function advanceArcProgress(
  currentArcM: number,
  targetArcM: number,
  maxStepM: number,
  prevRawGapM: number,
): number {
  const alongErr = targetArcM - currentArcM;
  const absErr = Math.abs(alongErr);

  if (absErr > TELEPORT_M || prevRawGapM > 120) {
    return targetArcM;
  }

  if (absErr <= SOFT_CATCHUP_M) {
    const springAlpha = Math.min(0.55, maxStepM / Math.max(absErr, 0.35));
    return currentArcM + alongErr * springAlpha;
  }

  const step = Math.min(maxStepM, absErr * 0.65);
  return currentArcM + Math.sign(alongErr) * step;
}

function smoothRoadHeading(targetHdg: number, nowMs: number): number {
  if (!Number.isFinite(smoothedRoadHeading) || lastHeadingSmoothMs <= 0) {
    smoothedRoadHeading = targetHdg;
    lastHeadingSmoothMs = nowMs;
    return targetHdg;
  }
  const dtSec = Math.min(0.35, (nowMs - lastHeadingSmoothMs) / 1000);
  smoothedRoadHeading = smoothHeadingEma(
    smoothedRoadHeading,
    targetHdg,
    dtSec,
    HEADING_SMOOTH_TAU_SEC,
  );
  lastHeadingSmoothMs = nowMs;
  return smoothedRoadHeading;
}

/**
 * SSOT pozycji markera na drodze — pozycja wyłącznie z 1D progress wzdłuż polilinii.
 * Raw GPS służy tylko do wyboru docelowego arcM, nigdy jako końcowa pozycja 2D.
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
  const prevRawGapM = prev ? distanceM(prev.lat, prev.lng, rawLat, rawLng) : 0;
  let maxStepM = computeMaxStepM(speedKmh);
  if (prevRawGapM > 45 && prevRawGapM <= 120) {
    maxStepM = Math.min(maxStepM, Math.max(6, prevRawGapM * 0.2));
  } else if (prevRawGapM > 120) {
    maxStepM = Math.min(32, Math.max(8, prevRawGapM * 0.12));
  }
  const polylines = collectPolylines(roadPolylines);

  if (prevRawGapM > 45) {
    console.log('[DEBUG_CATCHUP]', {
      layer: 'resolveRoadMarkerPose',
      prevRawGapM: Number(prevRawGapM.toFixed(1)),
      maxStepM: Number(maxStepM.toFixed(1)),
      crossTrackM: Number(enginePose.crossTrackM.toFixed(1)),
      isNavigating,
      polylineCount: polylines.length,
      engineRawFallback: isRawGpsPose(enginePose),
    });
  }

  if (prevRawGapM > 120) {
    lastSegmentIndex = 0;
    lastArcProgressM = 0;
    lastPolylineKey = '';
  }

  const poly = pickBestPolyline(polylines, rawLat, rawLng, maxRadiusM, prev);

  if (!poly) {
    const chaseRaw = prevRawGapM > 50 || isRawGpsPose(enginePose);
    const tgtLat = chaseRaw ? rawLat : enginePose.lat;
    const tgtLng = chaseRaw ? rawLng : enginePose.lng;
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

  const arc = buildPolylineArc(poly);
  if (!arc) {
    return {
      lat: prev?.lat ?? enginePose.lat,
      lng: prev?.lng ?? enginePose.lng,
      onRoad: false,
      crossTrackM: 999,
      segmentIndex: lastSegmentIndex,
      heading: travelHeadingDeg,
    };
  }

  const polyKey = polylineKey(poly);
  const minSeg = prevRawGapM > 90
    ? 0
    : Math.max(0, (input.lastSegmentIndex ?? lastSegmentIndex) - 1);

  if (polyKey !== lastPolylineKey) {
    lastPolylineKey = polyKey;
    if (prev) {
      const prevArc = arcLengthAtPoint(poly, arc, prev.lat, prev.lng, minSeg, maxRadiusM + 40);
      lastArcProgressM = prevArc?.arcM ?? 0;
    } else {
      lastArcProgressM = 0;
    }
  }

  let currentArcM = lastArcProgressM;
  if (prev) {
    const prevArc = arcLengthAtPoint(poly, arc, prev.lat, prev.lng, minSeg, maxRadiusM + 40);
    if (prevArc) {
      currentArcM = prevArc.arcM;
    }
  }

  const rawProjRadiusM = prevRawGapM > 45
    ? Math.min(2500, prevRawGapM + 150)
    : maxRadiusM + 30;
  const rawProjMinSeg = prevRawGapM > 90 ? 0 : minSeg;
  const rawProj = projectForward(rawLat, rawLng, poly, rawProjMinSeg, rawProjRadiusM, travelHeadingDeg)
    ?? projectForward(rawLat, rawLng, poly, 0, rawProjRadiusM, travelHeadingDeg);
  const engineProj = isRawGpsPose(enginePose)
    ? null
    : projectForward(enginePose.lat, enginePose.lng, poly, minSeg, maxRadiusM + 20, travelHeadingDeg);

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

  const rawOnPolyStale =
    !!rawProj
    && rawProj.crossTrackM > maxRadiusM + 18
    && prevRawGapM > 45;

  if (rawOnPolyStale || (prevRawGapM > 50 && !rawProj)) {
    if (prev) {
      const stepM = Math.min(maxStepM, prevRawGapM);
      const frac = stepM / Math.max(prevRawGapM, 0.05);
      return {
        lat: prev.lat + (rawLat - prev.lat) * frac,
        lng: prev.lng + (rawLng - prev.lng) * frac,
        onRoad: false,
        crossTrackM: rawProj?.crossTrackM ?? prevRawGapM,
        segmentIndex: lastSegmentIndex,
        heading: Number.isFinite(travelHeadingDeg) ? travelHeadingDeg : enginePose.heading,
      };
    }
  }

  const arcCandidates: { arcM: number; crossTrackM: number; segmentIndex: number }[] = [];
  if (rawProj) arcCandidates.push(projectionToArc(poly, arc, rawProj));
  if (localProj) arcCandidates.push(projectionToArc(poly, arc, localProj));
  if (engineProj) arcCandidates.push(projectionToArc(poly, arc, engineProj));

  let targetArcM = pickTargetArcM(currentArcM, arcCandidates);
  if (targetArcM == null && rawProj) {
    targetArcM = projectionToArc(poly, arc, rawProj).arcM;
  }
  if (targetArcM == null) {
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

  if (speedKmh >= 1.2) {
    targetArcM = Math.max(targetArcM, currentArcM - 0.3);
  }

  const outArcM = advanceArcProgress(currentArcM, targetArcM, maxStepM, prevRawGapM);
  const clampedArcM = speedKmh >= 1.2
    ? Math.max(outArcM, currentArcM - 0.2)
    : outArcM;

  const pose = pointAtArcLength(poly, arc, clampedArcM, travelHeadingDeg);
  const nowMs = Date.now();
  const roadHeading = smoothRoadHeading(pose.heading, nowMs);

  lastArcProgressM = clampedArcM;
  lastSegmentIndex = Math.max(lastSegmentIndex, pose.segmentIndex);

  return {
    lat: pose.lat,
    lng: pose.lng,
    onRoad: true,
    crossTrackM: rawProj?.crossTrackM ?? engineProj?.crossTrackM ?? 0,
    segmentIndex: pose.segmentIndex,
    heading: roadHeading,
  };
}

/**
 * Pozycja markera na ekranie — 1D progress wzdłuż polilinii gdy jest geometria.
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

  let bestPoly: RoadPoint[] | null = null;
  let bestCross = Infinity;
  for (const poly of collectDisplayPolylines(roadPolyline)) {
    const proj = projectOnPolylineForward(rawLat, rawLng, poly, 0, 110);
    if (!proj || proj.crossTrackM > 95) continue;
    if (proj.crossTrackM < bestCross) {
      bestCross = proj.crossTrackM;
      bestPoly = poly;
    }
  }

  if (bestPoly) {
    const arc = buildPolylineArc(bestPoly);
    if (arc) {
      const targetArc = arcLengthAtPoint(bestPoly, arc, rawLat, rawLng, 0, 110);
      if (targetArc) {
        let currentArcM = 0;
        if (prev) {
          const prevArc = arcLengthAtPoint(bestPoly, arc, prev.lat, prev.lng, 0, 110);
          currentArcM = prevArc?.arcM ?? 0;
        }
        const outArcM = advanceArcProgress(currentArcM, targetArc.arcM, maxStepM, 0);
        const pose = pointAtArcLength(bestPoly, arc, outArcM);
        return {
          lat: pose.lat,
          lng: pose.lng,
          heading: pose.heading,
          onRoad: true,
        };
      }
    }
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
