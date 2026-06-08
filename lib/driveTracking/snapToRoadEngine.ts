import {
  alignBearingToReference,
  bearingBetween,
  haversineM,
  headingDeltaDeg,
  projectOntoPolylineWithIndex,
} from './geoMath';
import type { LatLng, LegacySnapInput, SnapContext, SnapResult } from './types';
import { vroomGpsLog } from '../vroomGpsLog';

/** Lateral distance above which we distrust snap at highway speeds. */
const LATERAL_REJECT_BASE_M = 42;
const LATERAL_REJECT_FAST_M = 58;
/** Free drive: GPS bywa 30–50 m off-axis — szersza tolerancja zanim raw fallback. */
const LATERAL_REJECT_FREE_DRIVE_BOOST_M = 38;
const FAST_SPEED_KMH = 70;

/** Hysteresis: bonus for staying on locked segment (prevents parallel-road jumps). */
const SEGMENT_LOCK_BONUS_M = 18;
const SEGMENT_SWITCH_PENALTY_M = 12;
const HEADING_MISMATCH_PENALTY_PER_DEG = 0.35;

export type SnapEngineState = {
  lockedSegmentIndex: number;
  roadCredit: number;
  lastSnapped: LatLng | null;
  lastHeading: number;
};

export function createSnapEngineState(): SnapEngineState {
  return {
    lockedSegmentIndex: -1,
    roadCredit: 0,
    lastSnapped: null,
    lastHeading: 0,
  };
}

/**
 * Advanced snap-to-road: scores candidates using lateral distance, motion bearing,
 * route continuity (hysteresis), and speed-adaptive radius.
 */
export class SnapToRoadEngine {
  constructor(private state: SnapEngineState) {}

  reset(): void {
    this.state.lockedSegmentIndex = -1;
    this.state.roadCredit = 0;
    this.state.lastSnapped = null;
    this.state.lastHeading = 0;
  }

  /**
   * Refines output from useDrivingSnap (or raw projection) with hysteresis + heading gate.
   */
  getLockedSegmentIndex(): number {
    return this.state.lockedSegmentIndex;
  }

  refine(legacy: LegacySnapInput, ctx: SnapContext): SnapResult {
    const geometry = ctx.geometry;
    if (geometry.length < 2) {
      if (legacy.snapped && this.state.lastSnapped) {
        return {
          latitude: legacy.latitude,
          longitude: legacy.longitude,
          snapped: true,
          targetHeading: legacy.targetHeading,
          segmentIndex: this.state.lockedSegmentIndex,
          confidence: 0.35,
        };
      }
      return {
        latitude: legacy.latitude,
        longitude: legacy.longitude,
        snapped: legacy.snapped,
        targetHeading: legacy.targetHeading,
        segmentIndex: -1,
        confidence: legacy.snapped ? 0.4 : 0,
      };
    }

    const motionBearing = ctx.motionBearingDeg ?? this.state.lastHeading;
    const maxRadiusM = snapRadiusM(ctx.speedKmh, ctx.accuracyM, ctx.hardRoadLock, ctx.isNavigating);
    const projection = projectOntoPolylineWithIndex(
      ctx.filteredLat,
      ctx.filteredLng,
      geometry,
    );

    const candidates: Array<{
      lat: number;
      lng: number;
      segIdx: number;
      segBearing: number;
      lateralM: number;
      score: number;
    }> = [];

    if (projection) {
      const segIdx = projection.segmentIndex;
      const seg = geometry[segIdx];
      const segNext = geometry[Math.min(segIdx + 1, geometry.length - 1)];
      const segBearing = bearingBetween(seg.latitude, seg.longitude, segNext.latitude, segNext.longitude);
      const aligned = alignBearingToReference(segBearing, motionBearing);
      const lateralM = haversineM(ctx.filteredLat, ctx.filteredLng, projection.latitude, projection.longitude);
      const score = scoreCandidate({
        lateralM,
        segIdx,
        segBearing: aligned,
        motionBearing,
        lockedSeg: this.state.lockedSegmentIndex,
        roadCredit: this.state.roadCredit,
        speedKmh: ctx.speedKmh,
      });
      candidates.push({
        lat: projection.latitude,
        lng: projection.longitude,
        segIdx,
        segBearing: aligned,
        lateralM,
        score,
      });
    }

    // Legacy snap candidate — may be better when map-match geometry aligns.
    if (legacy.snapped) {
      const legProj = projectOntoPolylineWithIndex(legacy.latitude, legacy.longitude, geometry);
      const segIdx = legProj?.segmentIndex ?? this.state.lockedSegmentIndex;
      const seg = geometry[Math.max(0, Math.min(segIdx, geometry.length - 2))];
      const segNext = geometry[Math.min(segIdx + 1, geometry.length - 1)];
      const segBearing = bearingBetween(seg.latitude, seg.longitude, segNext.latitude, segNext.longitude);
      const aligned = alignBearingToReference(segBearing, motionBearing);
      const lateralM = haversineM(ctx.filteredLat, ctx.filteredLng, legacy.latitude, legacy.longitude);
      const score = scoreCandidate({
        lateralM,
        segIdx,
        segBearing: aligned,
        motionBearing,
        lockedSeg: this.state.lockedSegmentIndex,
        roadCredit: this.state.roadCredit,
        speedKmh: ctx.speedKmh,
        legacyBonus: 6,
      });
      candidates.push({
        lat: legacy.latitude,
        lng: legacy.longitude,
        segIdx,
        segBearing: aligned,
        lateralM,
        score,
      });
    }

    if (candidates.length === 0) {
      return {
        latitude: legacy.latitude,
        longitude: legacy.longitude,
        snapped: false,
        targetHeading: legacy.targetHeading,
        segmentIndex: -1,
        confidence: 0,
      };
    }

    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];
    const lateralRejectM = lateralRejectThresholdM(ctx);
    const rawLateralM = haversineM(ctx.rawLat, ctx.rawLng, best.lat, best.lng);
    const rejectDueToLateral =
      best.lateralM > maxRadiusM
      || rawLateralM > lateralRejectM + (ctx.isNavigating ? 20 : 35);

    if (rejectDueToLateral) {
      vroomGpsLog('DT_SNAP_REJECT', {
        lateralM: Math.round(best.lateralM),
        rawLateralM: Math.round(rawLateralM),
        maxRadiusM: Math.round(maxRadiusM),
        lateralRejectM: Math.round(lateralRejectM),
        speedKmh: Math.round(ctx.speedKmh),
        freeDrive: !ctx.isNavigating,
      }, 1500);
      if (ctx.hardRoadLock && !ctx.isNavigating && projection) {
        const segIdx = projection.segmentIndex;
        const seg = geometry[segIdx];
        const segNext = geometry[Math.min(segIdx + 1, geometry.length - 1)];
        const segBearing = bearingBetween(seg.latitude, seg.longitude, segNext.latitude, segNext.longitude);
        const aligned = alignBearingToReference(segBearing, motionBearing);
        this.state.lockedSegmentIndex = segIdx;
        this.state.lastSnapped = { latitude: projection.latitude, longitude: projection.longitude };
        this.state.lastHeading = aligned;
        return {
          latitude: projection.latitude,
          longitude: projection.longitude,
          snapped: true,
          targetHeading: aligned,
          segmentIndex: segIdx,
          confidence: Math.max(0.2, 1 - best.lateralM / (maxRadiusM + 25)),
        };
      }
      if (this.state.lastSnapped && ctx.hardRoadLock) {
        return {
          latitude: this.state.lastSnapped.latitude,
          longitude: this.state.lastSnapped.longitude,
          snapped: true,
          targetHeading: this.state.lastHeading,
          segmentIndex: this.state.lockedSegmentIndex,
          confidence: 0.25,
        };
      }
      return {
        latitude: ctx.filteredLat,
        longitude: ctx.filteredLng,
        snapped: false,
        targetHeading: motionBearing,
        segmentIndex: -1,
        confidence: 0,
      };
    }

    const segLeap = this.state.lockedSegmentIndex >= 0
      ? Math.abs(best.segIdx - this.state.lockedSegmentIndex)
      : 0;
    if (segLeap > 20 && ctx.speedKmh >= 40) {
      // Large index jump at speed — prefer locked segment unless legacy was very close.
      const locked = candidates.find((c) => c.segIdx === this.state.lockedSegmentIndex);
      if (locked && locked.score - best.score < 25) {
        Object.assign(best, locked);
      }
    }

    if (best.segIdx === this.state.lockedSegmentIndex) {
      this.state.roadCredit = Math.min(100, this.state.roadCredit + 8);
    } else if (segLeap <= 3) {
      this.state.roadCredit = Math.min(100, this.state.roadCredit + 4);
    } else {
      const switchThreshold = SEGMENT_SWITCH_PENALTY_M + this.state.roadCredit * 0.15;
      const lockedCand = candidates.find((c) => c.segIdx === this.state.lockedSegmentIndex);
      if (lockedCand && best.score - lockedCand.score < switchThreshold) {
        Object.assign(best, lockedCand);
      } else {
        this.state.roadCredit = Math.max(0, this.state.roadCredit - 12);
      }
    }

    this.state.lockedSegmentIndex = best.segIdx;
    this.state.lastSnapped = { latitude: best.lat, longitude: best.lng };
    this.state.lastHeading = best.segBearing;

    const confidence = Math.max(0, Math.min(1, 1 - best.lateralM / maxRadiusM));

    return {
      latitude: best.lat,
      longitude: best.lng,
      snapped: true,
      targetHeading: best.segBearing,
      segmentIndex: best.segIdx,
      confidence,
    };
  }
}

function scoreCandidate(args: {
  lateralM: number;
  segIdx: number;
  segBearing: number;
  motionBearing: number;
  lockedSeg: number;
  roadCredit: number;
  speedKmh: number;
  legacyBonus?: number;
}): number {
  const {
    lateralM,
    segIdx,
    segBearing,
    motionBearing,
    lockedSeg,
    roadCredit,
    speedKmh,
    legacyBonus = 0,
  } = args;

  let score = lateralM;
  const hdgDelta = headingDeltaDeg(segBearing, motionBearing);
  const hdgAllow = speedKmh >= 55 ? 38 : speedKmh >= 25 ? 52 : 72;
  if (hdgDelta > hdgAllow) {
    score += (hdgDelta - hdgAllow) * HEADING_MISMATCH_PENALTY_PER_DEG;
  }

  if (lockedSeg >= 0) {
    if (segIdx === lockedSeg) {
      score -= SEGMENT_LOCK_BONUS_M + roadCredit * 0.12;
    } else {
      const leap = Math.abs(segIdx - lockedSeg);
      score += SEGMENT_SWITCH_PENALTY_M + leap * 0.8;
    }
  }

  score -= legacyBonus;
  return score;
}

function lateralRejectThresholdM(ctx: SnapContext): number {
  const base = ctx.speedKmh >= FAST_SPEED_KMH ? LATERAL_REJECT_FAST_M : LATERAL_REJECT_BASE_M;
  return ctx.isNavigating ? base : base + LATERAL_REJECT_FREE_DRIVE_BOOST_M;
}

function snapRadiusM(
  speedKmh: number,
  accuracyM: number | null,
  hardLock: boolean,
  isNavigating: boolean,
): number {
  const acc = accuracyM != null && Number.isFinite(accuracyM) ? accuracyM : 25;
  let base = 32;
  if (speedKmh >= 90) base = 52;
  else if (speedKmh >= 55) base = 44;
  else if (speedKmh >= 25) base = 38;
  if (hardLock) base += 6;
  if (!isNavigating) base += 14;
  if (acc > 35) base += Math.min(14, (acc - 35) * 0.35);
  if (!isNavigating && acc > 22) base += Math.min(10, (acc - 22) * 0.25);
  return base;
}
