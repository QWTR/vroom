import { bearingBetween } from '../../scripts/navigationUtils';
import {
  computeTripBearing,
  HeadingRingBuffer,
  TRAVEL_COMPASS_MAX_KMH,
  TRAVEL_HEADING_FLIP_REJECT_DEG,
  TRAVEL_HEADING_LOW_SPEED_HOLD_KMH,
  TRAVEL_HEADING_ROAD_MAX_DIFF_DEG,
  TRAVEL_HEADING_VECTOR_MIN_MOVE_M,
  TRAVEL_VECTOR_LOCK_SPEED_KMH,
  TRAVEL_VECTOR_LOCK_SPEED_MS,
  TRAVEL_VECTOR_ONLY_MIN_KMH,
  TripHeadingFilter,
  type TripBearingInput,
} from './headingFilter';

export {
  TRAVEL_HEADING_VECTOR_MIN_MOVE_M,
  TRAVEL_HEADING_LOW_SPEED_HOLD_KMH,
  TRAVEL_COMPASS_MAX_KMH,
  TRAVEL_VECTOR_ONLY_MIN_KMH,
  TRAVEL_HEADING_ROAD_MAX_DIFF_DEG,
  TRAVEL_HEADING_FLIP_REJECT_DEG,
  TRAVEL_VECTOR_LOCK_SPEED_KMH,
  TRAVEL_VECTOR_LOCK_SPEED_MS,
  TripHeadingFilter,
  computeTripBearing,
  HeadingRingBuffer,
};

export function normalizeHeading(h: number): number {
  'worklet';
  return ((h % 360) + 360) % 360;
}

export function headingDelta(from: number, to: number): number {
  'worklet';
  return ((to - from + 540) % 360) - 180;
}

export function lerpHeading(from: number, to: number, t: number): number {
  const d = headingDelta(from, to);
  return normalizeHeading(from + d * t);
}

export function lerpHeadingWithMaxStep(from: number, to: number, maxStepDeg: number): number {
  const d = headingDelta(from, to);
  const step = Math.max(-maxStepDeg, Math.min(maxStepDeg, d));
  return normalizeHeading(from + step);
}

/** Cel animacji heading — obrót najkrótszą drogą (bez pełnego obrotu 350°→10°). */
export function timingHeadingTarget(current: number, target: number): number {
  'worklet';
  const cur = normalizeHeading(current);
  const tgt = normalizeHeading(target);
  return cur + headingDelta(cur, tgt);
}

export type TravelHeadingInput = {
  snapHeading: number;
  moveBearing: number | null;
  movedM: number;
  speedKmh: number;
  prevHeading: number | null;
  /** Surowe Pₙ₋₁ — preferowane dla filtra MA + wektor ruchu. */
  rawPrevLat?: number;
  rawPrevLng?: number;
  rawLat?: number;
  rawLng?: number;
  speedMs?: number;
  compassDeg?: number | null;
};

/**
 * Kierunek jazdy (SSOT): surowy wektor + MA(4) gdy podane raw coords + ring;
 * w przeciwnym razie bearing z moveBearing / snap (legacy).
 */
export function resolveTravelHeading(
  input: TravelHeadingInput,
  ring?: HeadingRingBuffer,
): number {
  const hasRaw =
    input.rawPrevLat != null
    && input.rawPrevLng != null
    && input.rawLat != null
    && input.rawLng != null
    && Number.isFinite(input.rawPrevLat)
    && Number.isFinite(input.rawPrevLng)
    && Number.isFinite(input.rawLat)
    && Number.isFinite(input.rawLng);

  if (hasRaw && ring) {
    const tripInput: TripBearingInput = {
      prevLat: input.rawPrevLat!,
      prevLng: input.rawPrevLng!,
      lat: input.rawLat!,
      lng: input.rawLng!,
      movedM: input.movedM,
      speedMs: input.speedMs ?? Math.max(0, input.speedKmh / 3.6),
      speedKmh: input.speedKmh,
      snapHeading: input.snapHeading,
      compassDeg: input.compassDeg,
      prevHeading: input.prevHeading,
    };
    return computeTripBearing(tripInput, ring);
  }

  const road = normalizeHeading(input.snapHeading);
  const prev = input.prevHeading != null ? normalizeHeading(input.prevHeading) : null;
  const vectorOnly = input.speedKmh >= TRAVEL_VECTOR_ONLY_MIN_KMH;
  const moving =
    input.speedKmh >= 3.5
    || input.movedM >= TRAVEL_HEADING_VECTOR_MIN_MOVE_M;

  if (input.moveBearing != null && moving) {
    let candidate = normalizeHeading(input.moveBearing);
    if (!vectorOnly) {
      const diff = Math.abs(headingDelta(road, candidate));
      if (diff <= TRAVEL_HEADING_ROAD_MAX_DIFF_DEG) {
        const w = input.speedKmh >= 8 ? 0.2 : 0.12;
        candidate = lerpHeading(candidate, road, w);
      }
    }
    if (prev != null) {
      const flip = Math.abs(headingDelta(prev, candidate));
      if (vectorOnly && flip >= TRAVEL_HEADING_FLIP_REJECT_DEG) return prev;
      const maxStep = input.speedKmh < 8 ? 14 : input.speedKmh < 25 ? 20 : 28;
      return lerpHeadingWithMaxStep(prev, candidate, maxStep);
    }
    return candidate;
  }

  if (
    prev != null
    && input.speedKmh < TRAVEL_HEADING_LOW_SPEED_HOLD_KMH
    && input.movedM < 1
  ) {
    return prev;
  }

  if (vectorOnly && prev != null) {
    return prev;
  }

  if (prev != null) {
    const flip = Math.abs(headingDelta(prev, road));
    if (flip >= TRAVEL_HEADING_FLIP_REJECT_DEG) return prev;
    return lerpHeadingWithMaxStep(prev, road, 12);
  }

  return road;
}

export function moveBearingBetween(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  movedM: number,
): number | null {
  if (movedM < TRAVEL_HEADING_VECTOR_MIN_MOVE_M) return null;
  return bearingBetween(fromLat, fromLng, toLat, toLng);
}

/** Odrzuca nagły flip heading przy pushu do workletu markera. */
export function guardMarkerHeadingPush(
  prevHeading: number,
  nextHeading: number,
  speedKmh: number,
): number {
  const prev = normalizeHeading(prevHeading);
  const next = normalizeHeading(nextHeading);
  const flip = Math.abs(headingDelta(prev, next));
  if (speedKmh >= TRAVEL_VECTOR_ONLY_MIN_KMH && flip >= TRAVEL_HEADING_FLIP_REJECT_DEG) {
    return prev;
  }
  if (speedKmh >= 6 && flip >= 125) {
    return prev;
  }
  return next;
}
