import { densifyPolyline, projectOntoPolylineWithIndex } from '../../scripts/navigationUtils';
import {
  BRANCH_BLOCK_ANGULAR_RATE_DPS,
} from './config';
import {
  arcLengthAtPoint,
  bearingBetween,
  buildArcWindow,
  buildPolylineArc,
  distanceM,
  headingDeltaAbs,
  pointAtArcLength,
  projectOnPolylineForward,
  RouteDeviationTracker,
  smoothHeadingEma,
  type ArcWindowSlice,
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
  /** Skręt na skrzyżowaniu — pozwól wybrać gałąź prostopadłą (bez forward-only lock). */
  turnResnap?: boolean;
};

export type RoadMarkerResult = {
  lat: number;
  lng: number;
  onRoad: boolean;
  crossTrackM: number;
  segmentIndex: number;
  /** Wyświetlany heading (LPF na segmencie drogi). */
  heading: number;
  motionHeading: number;
  displayHeading: number;
  arcM: number;
  polylineKey: string;
  arcWindow?: ArcWindowSlice;
};

let lastSegmentIndex = 0;
let lastArcProgressM = 0;
let lastPolylineKey = '';
let smoothedRoadHeading = 0;
let lastHeadingSmoothMs = 0;
let lastTravelHeadingSample = 0;
let lastTravelHeadingTs = 0;
const routeDeviationTracker = new RouteDeviationTracker();

export function resetRoadMarkerPoseState(): void {
  lastSegmentIndex = 0;
  lastArcProgressM = 0;
  lastPolylineKey = '';
  smoothedRoadHeading = 0;
  lastHeadingSmoothMs = 0;
  lastTravelHeadingSample = 0;
  lastTravelHeadingTs = 0;
  routeDeviationTracker.reset();
}

function angularRateDps(currentHeading: number, nowMs: number): number {
  if (lastTravelHeadingTs <= 0) {
    lastTravelHeadingSample = currentHeading;
    lastTravelHeadingTs = nowMs;
    return 0;
  }
  const dt = (nowMs - lastTravelHeadingTs) / 1000;
  const delta = headingDeltaAbs(lastTravelHeadingSample, currentHeading);
  lastTravelHeadingSample = currentHeading;
  lastTravelHeadingTs = nowMs;
  if (dt <= 0.02) return 0;
  return delta / dt;
}

function packMarkerResult(
  partial: {
    lat: number;
    lng: number;
    onRoad: boolean;
    crossTrackM: number;
    segmentIndex: number;
    heading: number;
    arcM: number;
    polylineKey: string;
  },
  motionHeading: number,
  poly: RoadPoint[] | null,
  arc: PolylineArc | null,
  speedKmh: number,
): RoadMarkerResult {
  const displayHeading = partial.heading;
  let arcWindow: ArcWindowSlice | undefined;
  if (partial.onRoad && poly && arc) {
    arcWindow = buildArcWindow(poly, arc, partial.arcM, speedKmh / 3.6) ?? undefined;
  }
  return {
    ...partial,
    motionHeading,
    displayHeading,
    arcWindow,
  };
}

/** Min. dystans raw→prev zanim branch resnap (unika jitteru na węźle). */
const BRANCH_RESNAP_MIN_RAW_GAP_M = 12;

export function getRoadMarkerSegmentIndex(): number {
  return lastSegmentIndex;
}

export function getRoadMarkerArcProgress(): number {
  return lastArcProgressM;
}

function isRawGpsPose(pose: SnappedPose): boolean {
  return pose.crossTrackM >= RAW_GPS_CROSS_TRACK_M;
}

function computeMaxStepM(speedKmh: number): number {
  const v = Math.max(0, speedKmh / 3.6);
  const dt = 0.72;
  return Math.min(52, Math.max(4, v * dt * 1.22 + 2.5));
}

function collectPolylines(explicit: RoadPoint[][], isNavigating: boolean): RoadPoint[][] {
  const out: RoadPoint[][] = [];
  for (const poly of explicit) {
    if (poly.length >= 2) out.push(poly);
  }
  // Nawigacja: tylko explicit (route) — bez lustra OSM.
  if (!isNavigating) {
    for (const poly of localRoadGeometryMirror.getPolylines()) {
      if (poly.length >= 2) out.push(poly);
    }
  }
  return out;
}

function pickBestPolylineAt(
  polylines: RoadPoint[][],
  refLat: number,
  refLng: number,
  searchRadiusM: number,
  travelHeadingDeg?: number,
  speedKmh?: number,
  preferPolylineKey?: string,
): { poly: RoadPoint[] | null; crossTrackM: number } {
  let best: RoadPoint[] | null = null;
  let bestCross = Infinity;
  let bestScore = Infinity;
  let preferred: RoadPoint[] | null = null;
  let preferredCross = Infinity;
  let preferredScore = Infinity;

  for (const poly of polylines) {
    let proj = projectOnPolylineForward(
      refLat,
      refLng,
      poly,
      0,
      searchRadiusM,
      travelHeadingDeg,
      speedKmh,
    );
    if (!proj) {
      proj = projectOnPolylineForward(refLat, refLng, poly, 0, searchRadiusM);
    }
    if (!proj) continue;
    const segA = poly[proj.segmentIndex];
    const segB = poly[proj.segmentIndex + 1];
    const segBearing = bearingBetween(
      segA.latitude,
      segA.longitude,
      segB.latitude,
      segB.longitude,
    );
    const score =
      proj.crossTrackM
      + Math.max(0, Math.abs(((segBearing - (travelHeadingDeg ?? segBearing) + 540) % 360) - 180) - 18) * 0.35;

    const key = polylineKey(poly);
    if (preferPolylineKey && key === preferPolylineKey) {
      if (score < preferredScore) {
        preferredScore = score;
        preferredCross = proj.crossTrackM;
        preferred = poly;
      }
      continue;
    }

    if (score < bestScore) {
      bestScore = score;
      bestCross = proj.crossTrackM;
      best = poly;
    }
  }

  if (
    preferred
    && (best == null || preferredScore <= bestScore + 8)
  ) {
    return { poly: preferred, crossTrackM: preferredCross };
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
  travelHeadingDeg?: number,
  speedKmh?: number,
): RoadPoint[] | null {
  const pickRadiusM = Math.min(3000, maxRadiusM + 120);
  const rawPick = pickBestPolylineAt(
    polylines,
    rawLat,
    rawLng,
    pickRadiusM,
    travelHeadingDeg,
    speedKmh,
    lastPolylineKey || undefined,
  );
  if (rawPick.poly && rawPick.crossTrackM <= maxRadiusM + 30) return rawPick.poly;

  const prevToRawM = prev ? distanceM(prev.lat, prev.lng, rawLat, rawLng) : 0;
  if (prevToRawM > 55 && rawPick.poly) {
    return rawPick.poly;
  }

  if (prev) {
    const prevPick = pickBestPolylineAt(
      polylines,
      prev.lat,
      prev.lng,
      pickRadiusM,
      travelHeadingDeg,
      speedKmh,
      lastPolylineKey || undefined,
    );
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
  speedKmh?: number,
): RoadProjection | null {
  return projectOnPolylineForward(
    lat,
    lng,
    poly,
    minSeg,
    maxRadiusM,
    travelHeadingDeg,
    speedKmh,
  );
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
  allowBranching = false,
): number | null {
  if (candidates.length < 1) return null;
  let pool = candidates;
  if (prevArcM != null && !allowBranching) {
    const forward = candidates.filter((c) => c.arcM >= prevArcM - 0.5);
    if (forward.length > 0) pool = forward;
  }
  pool.sort((a, b) => {
    if (b.segmentIndex !== a.segmentIndex) return b.segmentIndex - a.segmentIndex;
    return a.crossTrackM - b.crossTrackM;
  });
  return pool[0]?.arcM ?? null;
}

type ArcAdvanceOpts = {
  turnResnap?: boolean;
  isNavigating?: boolean;
};

/** 1D catch-up wzdłuż polilinii — bez lateral drift. */
function advanceArcProgress(
  currentArcM: number,
  targetArcM: number,
  maxStepM: number,
  prevRawGapM: number,
  opts: ArcAdvanceOpts = {},
): number {
  const turnResnap = opts.turnResnap === true;
  const isNavigating = opts.isNavigating === true;
  const alongErr = targetArcM - currentArcM;
  const absErr = Math.abs(alongErr);

  // Nawigacja: twardy snap do polilinii trasy — bez spring przez budynki.
  if (isNavigating) {
    if (absErr > TELEPORT_M || prevRawGapM > 120) {
      return targetArcM;
    }
    if (absErr <= SOFT_CATCHUP_M) {
      const alpha = Math.min(0.9, maxStepM / Math.max(absErr, 0.35));
      return currentArcM + alongErr * alpha;
    }
    const gain = turnResnap ? 1 : (prevRawGapM > 35 ? 0.9 : 0.75);
    const step = Math.min(maxStepM, absErr * gain);
    return currentArcM + Math.sign(alongErr) * step;
  }

  const teleportThreshold = turnResnap ? TELEPORT_M + 40 : TELEPORT_M;
  if (absErr > teleportThreshold || prevRawGapM > 120) {
    if (turnResnap && absErr <= teleportThreshold + 25) {
      const springAlpha = Math.min(0.62, maxStepM / Math.max(absErr, 0.35));
      return currentArcM + alongErr * springAlpha;
    }
    return targetArcM;
  }

  if (absErr <= SOFT_CATCHUP_M) {
    const springAlpha = Math.min(0.55, maxStepM / Math.max(absErr, 0.35));
    return currentArcM + alongErr * springAlpha;
  }

  const gain = prevRawGapM > 35 ? 0.85 : 0.65;
  const step = Math.min(maxStepM, absErr * gain);
  return currentArcM + Math.sign(alongErr) * step;
}

/** Przełączenie na gałąź najbliższą raw GPS (zamiast kroku do surowych współrzędnych). */
function resnapOnBestBranch(
  polylines: RoadPoint[][],
  rawLat: number,
  rawLng: number,
  travelHeadingDeg: number,
  maxRadiusM: number,
  speedKmh: number,
  prevRawGapM: number,
  angularRate: number,
): RoadMarkerResult | null {
  if (prevRawGapM < BRANCH_RESNAP_MIN_RAW_GAP_M) return null;
  if (angularRate > BRANCH_BLOCK_ANGULAR_RATE_DPS) return null;
  if (polylines.length < 1) return null;
  const searchRadiusM = Math.min(2500, maxRadiusM + (speedKmh >= 8 ? 180 : 120));
  const pick = pickBestPolylineAt(
    polylines,
    rawLat,
    rawLng,
    searchRadiusM,
    travelHeadingDeg,
    speedKmh,
  );
  if (!pick.poly || pick.crossTrackM > maxRadiusM + 70) return null;

  const arc = buildPolylineArc(pick.poly);
  if (!arc) return null;

  lastPolylineKey = '';
  lastArcProgressM = 0;
  lastSegmentIndex = 0;

  const rawProj = projectForward(
    rawLat,
    rawLng,
    pick.poly,
    0,
    searchRadiusM,
    travelHeadingDeg,
    speedKmh,
  );
  if (!rawProj) return null;

  const at = projectionToArc(pick.poly, arc, rawProj);
  const maxStepM = computeMaxStepM(speedKmh);
  const outArcM = advanceArcProgress(0, at.arcM, maxStepM, pick.crossTrackM, { turnResnap: true });
  const pose = pointAtArcLength(pick.poly, arc, outArcM, travelHeadingDeg);
  const nowMs = Date.now();
  const roadHeading = smoothRoadHeading(pose.heading, nowMs);
  const pKey = polylineKey(pick.poly);

  lastPolylineKey = pKey;
  lastArcProgressM = outArcM;
  lastSegmentIndex = pose.segmentIndex;

  return packMarkerResult(
    {
      lat: pose.lat,
      lng: pose.lng,
      onRoad: true,
      crossTrackM: pick.crossTrackM,
      segmentIndex: pose.segmentIndex,
      heading: roadHeading,
      arcM: outArcM,
      polylineKey: pKey,
    },
    travelHeadingDeg,
    pick.poly,
    arc,
    speedKmh,
  );
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
    turnResnap = false,
  } = input;

  const nowMs = Date.now();
  const angularRate = angularRateDps(travelHeadingDeg, nowMs);
  const routeDeviated = isNavigating
    ? routeDeviationTracker.isDeviated(
      headingDeltaAbs(travelHeadingDeg, enginePose.heading),
      enginePose.crossTrackM,
    )
    : true;
  const allowBranchResnap = turnResnap && (!isNavigating || routeDeviated);

  const maxRadiusM = isNavigating ? 50 : 120;
  const prevRawGapM = prev ? distanceM(prev.lat, prev.lng, rawLat, rawLng) : 0;
  let maxStepM = computeMaxStepM(speedKmh);
  if (turnResnap && !isNavigating) {
    maxStepM = Math.max(maxStepM, Math.min(48, computeMaxStepM(speedKmh) * 1.25));
  }
  // Marker w tyle za raw GPS — przyspiesz catch-up wzdłuż osi (nie ograniczaj kroku).
  if (!isNavigating && prevRawGapM > 25) {
    maxStepM = Math.max(maxStepM, Math.min(58, prevRawGapM * 0.55));
  }
  const polylines = collectPolylines(roadPolylines, isNavigating);

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

  if (prevRawGapM > 120 && turnResnap) {
    lastSegmentIndex = 0;
    lastArcProgressM = 0;
    lastPolylineKey = '';
  }

  const poly = isNavigating && polylines.length >= 1
    ? polylines.reduce((best, p) => (p.length > best.length ? p : best), polylines[0])
    : turnResnap
      ? pickBestPolylineAt(
        polylines,
        rawLat,
        rawLng,
        Math.min(2500, maxRadiusM + 80),
        travelHeadingDeg,
        speedKmh,
      ).poly
      : pickBestPolyline(
        polylines,
        rawLat,
        rawLng,
        maxRadiusM,
        prev,
        travelHeadingDeg,
        speedKmh,
      );

  if (!poly) {
    const chaseRaw = prevRawGapM > 50 || isRawGpsPose(enginePose);
    const tgtLat = chaseRaw ? rawLat : enginePose.lat;
    const tgtLng = chaseRaw ? rawLng : enginePose.lng;
    if (prev) {
      const distM = distanceM(prev.lat, prev.lng, tgtLat, tgtLng);
      if (distM > 0.05) {
        const stepM = Math.min(maxStepM, distM);
        const frac = stepM / distM;
        return packMarkerResult(
          {
            lat: prev.lat + (tgtLat - prev.lat) * frac,
            lng: prev.lng + (tgtLng - prev.lng) * frac,
            onRoad: false,
            crossTrackM: enginePose.crossTrackM,
            segmentIndex: lastSegmentIndex,
            heading: Number.isFinite(travelHeadingDeg) ? travelHeadingDeg : enginePose.heading,
            arcM: lastArcProgressM,
            polylineKey: lastPolylineKey,
          },
          travelHeadingDeg,
          null,
          null,
          speedKmh,
        );
      }
    }
    return packMarkerResult(
      {
        lat: tgtLat,
        lng: tgtLng,
        onRoad: !isRawGpsPose(enginePose),
        crossTrackM: enginePose.crossTrackM,
        segmentIndex: enginePose.segmentIndex,
        heading: enginePose.heading,
        arcM: lastArcProgressM,
        polylineKey: lastPolylineKey,
      },
      travelHeadingDeg,
      null,
      null,
      speedKmh,
    );
  }

  const arc = buildPolylineArc(poly);
  if (!arc) {
    return packMarkerResult(
      {
        lat: prev?.lat ?? enginePose.lat,
        lng: prev?.lng ?? enginePose.lng,
        onRoad: false,
        crossTrackM: 999,
        segmentIndex: lastSegmentIndex,
        heading: travelHeadingDeg,
        arcM: lastArcProgressM,
        polylineKey: lastPolylineKey,
      },
      travelHeadingDeg,
      null,
      null,
      speedKmh,
    );
  }

  const polyKey = polylineKey(poly);
  const minSeg = turnResnap
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
  const rawProjMinSeg = turnResnap ? 0 : minSeg;
  const rawProj = projectForward(
    rawLat,
    rawLng,
    poly,
    rawProjMinSeg,
    rawProjRadiusM,
    travelHeadingDeg,
    speedKmh,
  )
    ?? projectForward(rawLat, rawLng, poly, 0, rawProjRadiusM, travelHeadingDeg, speedKmh)
    ?? projectForward(rawLat, rawLng, poly, rawProjMinSeg, rawProjRadiusM);
  const engineProj = isRawGpsPose(enginePose)
    ? null
    : projectForward(
      enginePose.lat,
      enginePose.lng,
      poly,
      minSeg,
      maxRadiusM + 20,
      travelHeadingDeg,
      speedKmh,
    );

  let localProj: RoadProjection | null = null;
  if (!isNavigating) {
    const local = localRoadGeometryMirror.snapToLocalRoadBest(
      rawLat,
      rawLng,
      travelHeadingDeg,
      undefined,
      speedKmh,
    );
    if (local && local.crossTrackM <= maxRadiusM + (isNavigating ? 15 : 28)) {
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

  if (allowBranchResnap && (rawOnPolyStale || (prevRawGapM > 50 && !rawProj))) {
    const branchResnap = resnapOnBestBranch(
      polylines,
      rawLat,
      rawLng,
      travelHeadingDeg,
      maxRadiusM,
      speedKmh,
      prevRawGapM,
      angularRate,
    );
    if (branchResnap) return branchResnap;
    if (prev) {
      const hold = pointAtArcLength(poly, arc, currentArcM, travelHeadingDeg);
      return packMarkerResult(
        {
          lat: hold.lat,
          lng: hold.lng,
          onRoad: true,
          crossTrackM: rawProj?.crossTrackM ?? prevRawGapM,
          segmentIndex: hold.segmentIndex,
          heading: Number.isFinite(travelHeadingDeg) ? travelHeadingDeg : enginePose.heading,
          arcM: currentArcM,
          polylineKey: polyKey,
        },
        travelHeadingDeg,
        poly,
        arc,
        speedKmh,
      );
    }
  }

  const arcCandidates: { arcM: number; crossTrackM: number; segmentIndex: number }[] = [];
  if (rawProj) arcCandidates.push(projectionToArc(poly, arc, rawProj));
  if (localProj) arcCandidates.push(projectionToArc(poly, arc, localProj));
  if (engineProj) arcCandidates.push(projectionToArc(poly, arc, engineProj));

  let targetArcM = pickTargetArcM(currentArcM, arcCandidates, turnResnap);
  if (targetArcM == null && rawProj) {
    targetArcM = projectionToArc(poly, arc, rawProj).arcM;
  }
  if (targetArcM == null) {
    const hold = prev ?? { lat: enginePose.lat, lng: enginePose.lng };
    return packMarkerResult(
      {
        lat: hold.lat,
        lng: hold.lng,
        onRoad: false,
        crossTrackM: 999,
        segmentIndex: lastSegmentIndex,
        heading: travelHeadingDeg,
        arcM: lastArcProgressM,
        polylineKey: polyKey,
      },
      travelHeadingDeg,
      poly,
      arc,
      speedKmh,
    );
  }

  if (speedKmh >= 1.2) {
    targetArcM = Math.max(targetArcM, currentArcM - 0.3);
  }

  const outArcM = advanceArcProgress(currentArcM, targetArcM, maxStepM, prevRawGapM, {
    turnResnap,
    isNavigating,
  });
  const clampedArcM = speedKmh >= 1.2
    ? Math.max(outArcM, currentArcM - 0.2)
    : outArcM;

  // Free-drive: arc progress może utknąć gdy GPS jest daleko od osi (cross-track ~50 m)
  // — wtedy targetArcM ≈ currentArcM mimo że raw GPS jedzie dalej.
  const arcStallM = Math.abs(clampedArcM - currentArcM);
  if (prev && prevRawGapM > 30 && arcStallM < 0.5 && speedKmh >= 4) {
    if (allowBranchResnap) {
      const branchResnap = resnapOnBestBranch(
        polylines,
        rawLat,
        rawLng,
        travelHeadingDeg,
        maxRadiusM,
        speedKmh,
        prevRawGapM,
        angularRate,
      );
      if (branchResnap) return branchResnap;
    }
    const stallPose = pointAtArcLength(poly, arc, clampedArcM, travelHeadingDeg);
    const stallStepM = Math.min(maxStepM, prevRawGapM * 0.35);
    const stallTarget = projectionToArc(poly, arc, {
      lat: rawLat,
      lng: rawLng,
      heading: travelHeadingDeg,
      crossTrackM: rawProj?.crossTrackM ?? prevRawGapM,
      segmentIndex: stallPose.segmentIndex,
    });
    const stallArcM = advanceArcProgress(
      clampedArcM,
      stallTarget.arcM,
      stallStepM,
      prevRawGapM,
      { turnResnap: true, isNavigating },
    );
    const stallOut = pointAtArcLength(poly, arc, stallArcM, travelHeadingDeg);
    lastArcProgressM = stallArcM;
    lastSegmentIndex = stallOut.segmentIndex;
    return packMarkerResult(
      {
        lat: stallOut.lat,
        lng: stallOut.lng,
        onRoad: true,
        crossTrackM: rawProj?.crossTrackM ?? prevRawGapM,
        segmentIndex: stallOut.segmentIndex,
        heading: smoothRoadHeading(stallOut.heading, Date.now()),
        arcM: stallArcM,
        polylineKey: polyKey,
      },
      travelHeadingDeg,
      poly,
      arc,
      speedKmh,
    );
  }

  const pose = pointAtArcLength(poly, arc, clampedArcM, travelHeadingDeg);
  const roadHeading = smoothRoadHeading(pose.heading, nowMs);

  lastArcProgressM = clampedArcM;
  lastSegmentIndex = Math.max(lastSegmentIndex, pose.segmentIndex);
  lastPolylineKey = polyKey;

  return packMarkerResult(
    {
      lat: pose.lat,
      lng: pose.lng,
      onRoad: true,
      crossTrackM: rawProj?.crossTrackM ?? engineProj?.crossTrackM ?? 0,
      segmentIndex: pose.segmentIndex,
      heading: roadHeading,
      arcM: clampedArcM,
      polylineKey: polyKey,
    },
    travelHeadingDeg,
    poly,
    arc,
    speedKmh,
  );
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
        const outArcM = advanceArcProgress(currentArcM, targetArc.arcM, maxStepM, 0, {
          isNavigating: false,
        });
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
