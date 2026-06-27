import {
  alignBearingToReference,
  bearingBetween,
  densifyPolyline,
  haversineKm,
} from '../../scripts/navigationUtils';
import {
  buildArcWindow,
  buildPolylineArc,
  arcLengthAtPoint,
  headingDeltaAbs,
  pointAtArcLength,
  projectOnPolylineForward,
  snapSegmentScore,
} from '../driveCore/geo';
import type { RoadPoint } from '../driveCore/types';
import { NAV_V3 } from './config';
import type {
  ArcWindowSlice,
  RawGpsFix,
  RoadPolyline,
  SnapEngineState,
  SnapResult,
} from './types';

export type SnapEngineConfig = {
  attachThresholdM: number;
  detachStartM: number;
  detachFullM: number;
  branchHeadingMinDeg: number;
  branchConfirmSamples: number;
  branchHeadingConfirmToleranceDeg: number;
  maxSnapRadiusM: number;
  onRoadBlendEps: number;
};

const DEFAULT_CONFIG: SnapEngineConfig = {
  attachThresholdM: NAV_V3.SNAP_ATTACH_M,
  detachStartM: NAV_V3.SNAP_DETACH_START_M,
  detachFullM: NAV_V3.SNAP_DETACH_FULL_M,
  branchHeadingMinDeg: NAV_V3.BRANCH_HEADING_DELTA_DEG,
  branchConfirmSamples: NAV_V3.BRANCH_CONFIRM_TICKS,
  branchHeadingConfirmToleranceDeg: NAV_V3.BRANCH_HEADING_CONFIRM_TOLERANCE_DEG,
  maxSnapRadiusM: NAV_V3.SNAP_MAX_RADIUS_M,
  onRoadBlendEps: NAV_V3.ON_ROAD_BLEND_EPS,
};

export function createDefaultSnapEngineState(): SnapEngineState {
  return {
    lastSegmentIndex: 0,
    lastPolylineKey: '',
    lastSegmentHeadingDeg: 0,
    lockedTravelHeadingDeg: -1,
    lastRoadBlend: 1,
    offRoadStickTicks: 0,
    branchCandidate: null,
  };
}

/** Pure — roadBlend from cross-track distance (detach LERP). */
export function computeRoadBlend(
  crossTrackM: number,
  cfg: Pick<SnapEngineConfig, 'attachThresholdM' | 'detachStartM' | 'detachFullM'>,
): number {
  if (!Number.isFinite(crossTrackM) || crossTrackM <= cfg.attachThresholdM) {
    return 1;
  }
  if (crossTrackM >= cfg.detachFullM) {
    return 0;
  }
  if (crossTrackM <= cfg.detachStartM) {
    return 1;
  }
  const span = Math.max(0.001, cfg.detachFullM - cfg.detachStartM);
  const t = (crossTrackM - cfg.detachStartM) / span;
  const u = Math.max(0, Math.min(1, t));
  const smooth = u * u * (3 - 2 * u);
  return 1 - smooth;
}

/**
 * Lepkość blendu — unika natychmiastowego przełączenia onRoad→offRoad przy skręcie,
 * zanim map-match odświeży geometrię.
 */
export function applyRoadBlendStickiness(
  targetBlend: number,
  prevBlend: number,
  crossTrackM: number,
  stickTicks: number,
  cfg: Pick<SnapEngineConfig, 'detachFullM' | 'onRoadBlendEps'>,
): { blend: number; stickTicks: number } {
  const target = Math.max(0, Math.min(1, targetBlend));
  const prev = Math.max(0, Math.min(1, prevBlend));

  if (target >= prev) {
    return { blend: target, stickTicks: 0 };
  }

  const farOffRoad = crossTrackM >= cfg.detachFullM + 30;
  const nextTicks = farOffRoad ? stickTicks + 1 : stickTicks + 1;
  const maxSticky = NAV_V3.SNAP_BLEND_STICKY_TICKS;

  if (farOffRoad && nextTicks >= maxSticky) {
    return { blend: target, stickTicks: 0 };
  }

  const decayed = Math.max(target, prev - NAV_V3.SNAP_BLEND_DECAY_PER_TICK);
  const minHold = cfg.onRoadBlendEps + 0.08;
  const blend = nextTicks < maxSticky
    ? Math.max(decayed, minHold)
    : decayed;

  return { blend, stickTicks: nextTicks };
}

/** Wykrywa ewidentny skręt na skrzyżowaniu (nagła zmiana kąta + ucieczka od polilinii). */
export function detectIntersectionTurn(
  travelHeadingDeg: number,
  lastSegmentHeadingDeg: number,
  crossTrackM: number,
): boolean {
  if (!Number.isFinite(lastSegmentHeadingDeg) || !Number.isFinite(travelHeadingDeg)) {
    return false;
  }
  if (crossTrackM < NAV_V3.INTERSECTION_TURN_CROSS_TRACK_M) {
    return false;
  }
  return headingDeltaAbs(travelHeadingDeg, lastSegmentHeadingDeg)
    >= NAV_V3.INTERSECTION_TURN_HEADING_DEG;
}

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return haversineKm(aLat, aLng, bLat, bLng) * 1000;
}

/** Arc window with every densified vertex in range — preserves sharp corners. */
function buildSnapArcWindow(
  dense: RoadPoint[],
  arc: ReturnType<typeof buildPolylineArc>,
  arcM: number,
  speedMs: number,
): ArcWindowSlice | null {
  if (!arc || dense.length < 2 || arc.totalM <= 0) return null;

  const backM = 40;
  const aheadM = 90 + Math.max(0, speedMs) * 10;
  const winStart = Math.max(0, arcM - backM);
  const winEnd = Math.min(arc.totalM, arcM + aheadM);

  const points: { lat: number; lng: number }[] = [];
  const cumM: number[] = [0];

  const pushPoint = (lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const last = points[points.length - 1];
    if (last) {
      const stepM = distanceM(last.lat, last.lng, lat, lng);
      if (stepM < 0.2) return;
      cumM.push(cumM[cumM.length - 1] + stepM);
    }
    points.push({ lat, lng });
  };

  const startPose = pointAtArcLength(dense, arc, winStart);
  pushPoint(startPose.lat, startPose.lng);

  for (let i = 0; i < dense.length; i += 1) {
    const nodeArc = arc.cumM[i] ?? 0;
    if (nodeArc <= winStart + 0.5 || nodeArc >= winEnd - 0.5) continue;
    const p = dense[i];
    pushPoint(p.latitude, p.longitude);
  }

  const endPose = pointAtArcLength(dense, arc, winEnd);
  pushPoint(endPose.lat, endPose.lng);

  if (points.length < 2) {
    return buildArcWindow(dense, arc, arcM, speedMs);
  }

  return {
    points,
    cumM,
    baseArcM: winStart,
    totalM: cumM[cumM.length - 1],
  };
}

function toRoadPoints(points: { lat: number; lng: number }[]): RoadPoint[] {
  return points.map((p) => ({ latitude: p.lat, longitude: p.lng }));
}

export type TravelHeadingResult = {
  headingDeg: number;
  lockedTravelHeadingDeg: number;
};

/** Zawsze zwraca skończony kąt 0–360 — nigdy NaN. */
export function safeHeadingDeg(h: unknown, fallback = 0): number {
  if (typeof h === 'number' && Number.isFinite(h) && h >= 0) {
    return ((h % 360) + 360) % 360;
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback >= 0) {
    return ((fallback % 360) + 360) % 360;
  }
  return 0;
}

/**
 * Kurs jazdy bez kompasu w trybie trip (metalowa karoseria zakłóca magnetyk).
 * Heading lock: przy postoju / małym ruchu zwraca ostatni poprawny wektor ruchu.
 * segmentHeadingDeg — kierunek najbliższego segmentu drogi przy cold start / postoju.
 */
export function computeTravelHeadingDeg(
  raw: RawGpsFix,
  prev: { lat: number; lng: number } | null,
  fallbackDeg: number,
  lockedHeadingDeg: number,
  tripActive: boolean,
  segmentHeadingDeg?: number | null,
): TravelHeadingResult {
  const segFallback = safeHeadingDeg(segmentHeadingDeg, 0);
  const rawLocked = lockedHeadingDeg;
  const locked = safeHeadingDeg(
    rawLocked >= 0 ? rawLocked : undefined,
    safeHeadingDeg(fallbackDeg, segFallback),
  );

  const speedMs = raw.speedMs != null && raw.speedMs >= 0 ? raw.speedMs : 0;
  const speedKmh = speedMs * 3.6;

  if (prev) {
    const movedM = distanceM(prev.lat, prev.lng, raw.lat, raw.lng);
    if (movedM >= NAV_V3.TRAVEL_HEADING_MIN_MOVE_M) {
      const motionBearing = safeHeadingDeg(
        bearingBetween(prev.lat, prev.lng, raw.lat, raw.lng),
        locked,
      );
      return { headingDeg: motionBearing, lockedTravelHeadingDeg: motionBearing };
    }
  }

  if (tripActive) {
    const hdg = safeHeadingDeg(locked, safeHeadingDeg(fallbackDeg, 0));
    return { headingDeg: hdg, lockedTravelHeadingDeg: hdg };
  }

  if (
    speedKmh < NAV_V3.TRAVEL_HEADING_LOCK_SPEED_KMH
    || !prev
  ) {
    const hdg = safeHeadingDeg(locked, segFallback);
    return { headingDeg: hdg, lockedTravelHeadingDeg: hdg };
  }

  if (raw.headingDeg != null && Number.isFinite(raw.headingDeg) && raw.headingDeg >= 0) {
    const hdg = safeHeadingDeg(raw.headingDeg, locked);
    return { headingDeg: hdg, lockedTravelHeadingDeg: hdg };
  }
  const hdg = safeHeadingDeg(locked, segFallback);
  return { headingDeg: hdg, lockedTravelHeadingDeg: hdg };
}

function buildCumM(points: { lat: number; lng: number }[]): number[] {
  if (points.length < 2) return [0];
  const cumM = [0];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    cumM.push(cumM[i - 1] + distanceM(prev.lat, prev.lng, cur.lat, cur.lng));
  }
  return cumM;
}

function packRoadPolyline(key: string, points: { lat: number; lng: number }[]): RoadPolyline | null {
  if (points.length < 2) return null;
  return { key, points, cumM: buildCumM(points) };
}

type PolylineProjection = {
  polylineKey: string;
  lat: number;
  lng: number;
  headingDeg: number;
  crossTrackM: number;
  segmentIndex: number;
  arcM: number;
  arcWindow: ArcWindowSlice | null;
};

function projectOnPolyline(
  raw: RawGpsFix,
  polyline: RoadPolyline,
  minSegmentIndex: number,
  travelHeadingDeg: number,
  speedMs: number,
  cfg: SnapEngineConfig,
  isNavigating: boolean,
): PolylineProjection | null {
  const dense = densifyPolyline(
    toRoadPoints(polyline.points),
    polyline.points.length <= 4 ? 4 : 5,
  );
  if (dense.length < 2) return null;

  const minSeg = Math.max(0, Math.min(minSegmentIndex, dense.length - 2));
  const speedKmh = Math.max(0, speedMs) * 3.6;

  const proj = projectOnPolylineForward(
    raw.lat,
    raw.lng,
    dense,
    minSeg,
    cfg.maxSnapRadiusM,
    travelHeadingDeg,
    speedKmh,
    {
      onRoutePolyline: isNavigating,
      lastSegmentIndex: minSegmentIndex,
    },
  );
  if (!proj) return null;

  const arc = buildPolylineArc(dense);
  if (!arc) return null;

  const arcInfo = arcLengthAtPoint(dense, arc, proj.lat, proj.lng, proj.segmentIndex, 2500);
  const arcM = arcInfo?.arcM ?? 0;
  const speedForWindow = Math.max(0, speedMs);
  const windowRaw = buildSnapArcWindow(dense, arc, arcM, speedForWindow);

  const arcWindow: ArcWindowSlice | null = windowRaw
    ? {
      points: windowRaw.points,
      cumM: windowRaw.cumM,
      baseArcM: windowRaw.baseArcM,
      totalM: windowRaw.totalM,
    }
    : null;

  return {
    polylineKey: polyline.key,
    lat: proj.lat,
    lng: proj.lng,
    headingDeg: proj.heading,
    crossTrackM: proj.crossTrackM,
    segmentIndex: proj.segmentIndex,
    arcM,
    arcWindow,
  };
}

function scoreGlobalProjection(
  raw: RawGpsFix,
  polyline: RoadPolyline,
  travelHeadingDeg: number,
  speedMs: number,
  cfg: SnapEngineConfig,
): PolylineProjection | null {
  const dense = densifyPolyline(
    toRoadPoints(polyline.points),
    polyline.points.length <= 4 ? 4 : 5,
  );
  if (dense.length < 2) return null;

  let bestScore = Infinity;
  let best: PolylineProjection | null = null;
  const speedKmh = Math.max(0, speedMs) * 3.6;

  for (let i = 0; i < dense.length - 1; i += 1) {
    const a = dense[i];
    const b = dense[i + 1];
    const segBearing = bearingBetween(
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude,
    );
    const midLat = (a.latitude + b.latitude) / 2;
    const midLng = (a.longitude + b.longitude) / 2;
    const crossTrackM = distanceM(raw.lat, raw.lng, midLat, midLng);
    if (crossTrackM > cfg.maxSnapRadiusM * 1.4) continue;

    const score = snapSegmentScore(
      distanceM(raw.lat, raw.lng, midLat, midLng),
      segBearing,
      travelHeadingDeg,
      speedKmh,
    );
    if (score == null || score >= bestScore) continue;

    const proj = projectOnPolylineForward(
      raw.lat,
      raw.lng,
      dense,
      i,
      cfg.maxSnapRadiusM,
      travelHeadingDeg,
      speedKmh,
    );
    if (!proj) continue;

    const arc = buildPolylineArc(dense);
    if (!arc) continue;
    const arcInfo = arcLengthAtPoint(dense, arc, proj.lat, proj.lng, proj.segmentIndex, 2500);
    const arcM = arcInfo?.arcM ?? 0;

    bestScore = score;
    best = {
      polylineKey: polyline.key,
      lat: proj.lat,
      lng: proj.lng,
      headingDeg: proj.heading,
      crossTrackM: proj.crossTrackM,
      segmentIndex: proj.segmentIndex,
      arcM,
      arcWindow: null,
    };
  }

  if (best) {
    const arc = buildPolylineArc(dense);
    if (arc) {
      const windowRaw = buildSnapArcWindow(dense, arc, best.arcM, Math.max(0, speedMs));
      if (windowRaw) {
        best.arcWindow = {
          points: windowRaw.points,
          cumM: windowRaw.cumM,
          baseArcM: windowRaw.baseArcM,
          totalM: windowRaw.totalM,
        };
      }
    }
  }

  return best;
}

function isBranchLeap(
  state: SnapEngineState,
  candidate: PolylineProjection,
  cfg: SnapEngineConfig,
): boolean {
  if (!state.lastPolylineKey) return false;
  if (candidate.polylineKey !== state.lastPolylineKey) return true;

  const segLeap = candidate.segmentIndex - state.lastSegmentIndex;
  if (segLeap > 1) return true;
  if (segLeap < -1) return true;

  const bearingDelta = headingDeltaAbs(candidate.headingDeg, state.lastSegmentHeadingDeg);
  return bearingDelta >= cfg.branchHeadingMinDeg;
}

function headingConfirmsBranch(
  travelHeadingDeg: number,
  segmentHeadingDeg: number,
  cfg: SnapEngineConfig,
): boolean {
  return headingDeltaAbs(travelHeadingDeg, segmentHeadingDeg)
    <= cfg.branchHeadingConfirmToleranceDeg;
}

function updateBranchCandidate(
  state: SnapEngineState,
  candidate: PolylineProjection,
  travelHeadingDeg: number,
  nowMs: number,
  cfg: SnapEngineConfig,
): SnapEngineState {
  const confirms = headingConfirmsBranch(travelHeadingDeg, candidate.headingDeg, cfg);
  if (!confirms) {
    return { ...state, branchCandidate: null };
  }

  const prev = state.branchCandidate;
  if (
    prev
    && prev.polylineKey === candidate.polylineKey
    && prev.segmentIndex === candidate.segmentIndex
  ) {
    return {
      ...state,
      branchCandidate: {
        ...prev,
        hits: prev.hits + 1,
        atMs: nowMs,
      },
    };
  }

  return {
    ...state,
    branchCandidate: {
      polylineKey: candidate.polylineKey,
      segmentIndex: candidate.segmentIndex,
      hits: 1,
      atMs: nowMs,
    },
  };
}

function branchSwitchConfirmed(state: SnapEngineState, cfg: SnapEngineConfig): boolean {
  const c = state.branchCandidate;
  if (!c) return false;
  return c.hits >= cfg.branchConfirmSamples;
}

function findBestProjection(
  raw: RawGpsFix,
  polylines: RoadPolyline[],
  state: SnapEngineState,
  travelHeadingDeg: number,
  speedMs: number,
  isNavigating: boolean,
  cfg: SnapEngineConfig,
  prev: { lat: number; lng: number } | null,
): { projection: PolylineProjection | null; nextState: SnapEngineState } {
  let nextState = { ...state };
  let best: PolylineProjection | null = null;
  let bestScore = Infinity;

  for (const polyline of polylines) {
    if (polyline.points.length < 2) continue;

    const minSeg = polyline.key === state.lastPolylineKey
      ? Math.max(0, state.lastSegmentIndex - 1)
      : 0;

    const proj = projectOnPolyline(
      raw,
      polyline,
      minSeg,
      travelHeadingDeg,
      speedMs,
      cfg,
      isNavigating,
    );
    if (!proj) continue;

    const score = proj.crossTrackM + (polyline.key === state.lastPolylineKey ? -2 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = proj;
    }
  }

  if (!best && polylines.length > 0) {
    for (const polyline of polylines) {
      const global = scoreGlobalProjection(raw, polyline, travelHeadingDeg, speedMs, cfg);
      if (!global) continue;
      if (global.crossTrackM < bestScore) {
        bestScore = global.crossTrackM;
        best = global;
      }
    }
  }

  if (!best) {
    return { projection: null, nextState };
  }

  const leap = isBranchLeap(nextState, best, cfg);
  if (leap) {
    nextState = updateBranchCandidate(nextState, best, travelHeadingDeg, raw.timestampMs, cfg);
    if (!branchSwitchConfirmed(nextState, cfg)) {
      const lockedPolyline = polylines.find((p) => p.key === nextState.lastPolylineKey);
      if (lockedPolyline && nextState.lastPolylineKey) {
        const locked = projectOnPolyline(
          raw,
          lockedPolyline,
          Math.max(0, nextState.lastSegmentIndex),
          travelHeadingDeg,
          speedMs,
          cfg,
          isNavigating,
        );
        if (locked) {
          return { projection: locked, nextState };
        }
      }
      if (prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lng)) {
        return {
          projection: {
            polylineKey: nextState.lastPolylineKey,
            lat: prev.lat,
            lng: prev.lng,
            headingDeg: nextState.lastSegmentHeadingDeg,
            crossTrackM: distanceM(prev.lat, prev.lng, raw.lat, raw.lng),
            segmentIndex: nextState.lastSegmentIndex,
            arcM: 0,
            arcWindow: null,
          },
          nextState,
        };
      }
    }
  } else {
    nextState = { ...nextState, branchCandidate: null };
  }

  return { projection: best, nextState };
}

export type SnapResolveInput = {
  raw: RawGpsFix;
  prev: { lat: number; lng: number } | null;
  travelPrev?: { lat: number; lng: number } | null;
  polylines: RoadPolyline[];
  isNavigating: boolean;
  /** freeDrive lub navigation — bez fallbacku do kompasu. */
  tripActive?: boolean;
  travelHeadingDeg?: number;
  /** Powyżej progu — ignoruj projekcję na trasę (off-road bez drugiego resolve). */
  maxCrossTrackToSnap?: number;
  state: SnapEngineState;
};

export type SnapResolveOutput = {
  result: SnapResult;
  state: SnapEngineState;
};

function buildOffRoadStickyResult(
  raw: RawGpsFix,
  prev: { lat: number; lng: number } | null,
  travelHeadingDeg: number,
  state: SnapEngineState,
  cfg: SnapEngineConfig,
  crossTrackM: number,
  isNavigating: boolean,
): { result: SnapResult; state: SnapEngineState } {
  const instantBreakM = cfg.detachFullM + 10;
  if (!prev || crossTrackM >= instantBreakM) {
    const headingDeg = safeHeadingDeg(
      travelHeadingDeg,
      safeHeadingDeg(state.lockedTravelHeadingDeg, 0),
    );
    const nextState: SnapEngineState = {
      ...state,
      lastRoadBlend: 0,
      offRoadStickTicks: 0,
    };
    return {
      result: {
        lat: raw.lat,
        lng: raw.lng,
        rawLat: raw.lat,
        rawLng: raw.lng,
        headingDeg,
        crossTrackM,
        pathMode: 'offRoad',
        roadBlend: 0,
        segmentIndex: state.lastSegmentIndex,
        arcM: null,
        polylineKey: null,
        arcWindow: null,
      },
      state: nextState,
    };
  }

  const rawBlend = computeRoadBlend(crossTrackM, cfg);
  const sticky = applyRoadBlendStickiness(
    rawBlend,
    state.lastRoadBlend,
    crossTrackM,
    state.offRoadStickTicks,
    cfg,
  );
  const roadBlend = sticky.blend;
  const onRoad = roadBlend > cfg.onRoadBlendEps;
  const stickyHeading = safeHeadingDeg(
    state.lastSegmentHeadingDeg,
    safeHeadingDeg(state.lockedTravelHeadingDeg, travelHeadingDeg),
  );
  const headingDeg = onRoad && isNavigating
    ? stickyHeading
    : safeHeadingDeg(
      travelHeadingDeg,
      safeHeadingDeg(state.lockedTravelHeadingDeg, 0),
    );
  const nextState: SnapEngineState = {
    ...state,
    lastRoadBlend: roadBlend,
    offRoadStickTicks: sticky.stickTicks,
    lockedTravelHeadingDeg: state.lockedTravelHeadingDeg,
  };

  return {
    result: {
      lat: onRoad ? prev!.lat : raw.lat,
      lng: onRoad ? prev!.lng : raw.lng,
      rawLat: raw.lat,
      rawLng: raw.lng,
      headingDeg,
      crossTrackM,
      pathMode: onRoad ? 'onRoad' : 'offRoad',
      roadBlend,
      segmentIndex: state.lastSegmentIndex,
      arcM: null,
      polylineKey: onRoad ? state.lastPolylineKey || null : null,
      arcWindow: null,
    },
    state: nextState,
  };
}

export function resolveSnap(
  input: SnapResolveInput,
  config?: Partial<SnapEngineConfig>,
): SnapResolveOutput {
  const cfg: SnapEngineConfig = { ...DEFAULT_CONFIG, ...config };
  const { raw, prev, polylines, isNavigating } = input;
  let state = { ...input.state };

  const speedMs = raw.speedMs != null && raw.speedMs >= 0 ? raw.speedMs : 0;
  const tripActive = input.tripActive ?? isNavigating;
  const travel = computeTravelHeadingDeg(
    raw,
    input.travelPrev ?? prev,
    input.travelHeadingDeg ?? state.lastSegmentHeadingDeg,
    state.lockedTravelHeadingDeg,
    tripActive,
    null,
  );
  let travelHeadingDeg = safeHeadingDeg(travel.headingDeg, 0);
  state = {
    ...state,
    lockedTravelHeadingDeg: safeHeadingDeg(travel.lockedTravelHeadingDeg, travelHeadingDeg),
  };

  if (!polylines.length) {
    const off = buildOffRoadStickyResult(raw, prev, travelHeadingDeg, state, cfg, 999, isNavigating);
    return off;
  }

  const { projection, nextState } = findBestProjection(
    raw,
    polylines,
    state,
    travelHeadingDeg,
    speedMs,
    isNavigating,
    cfg,
    prev,
  );
  state = nextState;

  if (!projection) {
    return buildOffRoadStickyResult(raw, prev, travelHeadingDeg, state, cfg, 999, isNavigating);
  }

  if (input.maxCrossTrackToSnap && projection.crossTrackM > input.maxCrossTrackToSnap) {
    return buildOffRoadStickyResult(raw, prev, travelHeadingDeg, state, cfg, projection.crossTrackM, isNavigating);
  }

  const rawBlend = computeRoadBlend(projection.crossTrackM, cfg);
  const sticky = applyRoadBlendStickiness(
    rawBlend,
    state.lastRoadBlend,
    projection.crossTrackM,
    state.offRoadStickTicks,
    cfg,
  );
  const roadBlend = sticky.blend;
  const pathMode: SnapResult['pathMode'] = roadBlend > cfg.onRoadBlendEps ? 'onRoad' : 'offRoad';

  const segAligned = safeHeadingDeg(
    alignBearingToReference(projection.headingDeg, travelHeadingDeg),
    travelHeadingDeg,
  );
  const onRoadSnap = roadBlend > cfg.onRoadBlendEps;
  const useRoadHeading = isNavigating && onRoadSnap;
  /** freeDrive: segment prostopadły do ruchu (np. błędny snap na polu) → wektor jazdy. */
  const headingDeg = useRoadHeading
    ? segAligned
    : safeHeadingDeg(
      travelHeadingDeg,
      safeHeadingDeg(state.lockedTravelHeadingDeg, segAligned),
    );

  const intersectionTurnDetected = detectIntersectionTurn(
    useRoadHeading ? segAligned : travelHeadingDeg,
    state.lastSegmentHeadingDeg,
    projection.crossTrackM,
  );

  state = {
    ...state,
    lastSegmentIndex: projection.segmentIndex,
    lastPolylineKey: projection.polylineKey,
    lastSegmentHeadingDeg: onRoadSnap ? segAligned : headingDeg,
    lockedTravelHeadingDeg: safeHeadingDeg(state.lockedTravelHeadingDeg, headingDeg),
    lastRoadBlend: roadBlend,
    offRoadStickTicks: sticky.stickTicks,
    branchCandidate: branchSwitchConfirmed(state, cfg) ? null : state.branchCandidate,
  };

  return {
    result: {
      lat: projection.lat,
      lng: projection.lng,
      rawLat: raw.lat,
      rawLng: raw.lng,
      headingDeg,
      crossTrackM: projection.crossTrackM,
      pathMode,
      roadBlend,
      segmentIndex: projection.segmentIndex,
      arcM: projection.arcM,
      polylineKey: projection.polylineKey,
      arcWindow: projection.arcWindow,
      intersectionTurnDetected,
    },
    state,
  };
}

export function createSnapEngine(config?: Partial<SnapEngineConfig>) {
  const cfg: SnapEngineConfig = { ...DEFAULT_CONFIG, ...config };
  let state = createDefaultSnapEngineState();

  return {
    reset(): void {
      state = createDefaultSnapEngineState();
    },
    /** Bootstrap trip — zablokuj kurs z wejścia (nie kompas / zero). */
    seedTravelHeading(headingDeg: number): void {
      const h = safeHeadingDeg(headingDeg, 0);
      state = {
        ...createDefaultSnapEngineState(),
        lastSegmentHeadingDeg: h,
        lockedTravelHeadingDeg: h,
      };
    },
    getState(): SnapEngineState {
      return { ...state, branchCandidate: state.branchCandidate ? { ...state.branchCandidate } : null };
    },
    resolve(input: Omit<SnapResolveInput, 'state'>): SnapResolveOutput {
      const out = resolveSnap({ ...input, state }, cfg);
      state = out.state;
      return out;
    },
  };
}

/** Helper — build RoadPolyline from lat/lng array with auto cumM. */
export function makeRoadPolyline(key: string, points: { lat: number; lng: number }[]): RoadPolyline | null {
  return packRoadPolyline(key, points);
}

export { packRoadPolyline };
