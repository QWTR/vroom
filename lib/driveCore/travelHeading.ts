import { bearingBetween } from '../../scripts/navigationUtils';

export const TRAVEL_HEADING_VECTOR_MIN_MOVE_M = 1.2;
export const TRAVEL_HEADING_LOW_SPEED_HOLD_KMH = 5;
export const TRAVEL_HEADING_ROAD_MAX_DIFF_DEG = 38;

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
};

/**
 * Kierunek jazdy: wektor ruchu + stabilizacja tangensem drogi (marker i kamera).
 */
export function resolveTravelHeading(input: TravelHeadingInput): number {
  const road = normalizeHeading(input.snapHeading);
  const prev = input.prevHeading;

  if (input.moveBearing != null) {
    const travel = normalizeHeading(input.moveBearing);
    const moving =
      input.speedKmh >= 3.5
      || input.movedM >= TRAVEL_HEADING_VECTOR_MIN_MOVE_M;

    if (moving) {
      const diff = Math.abs(headingDelta(road, travel));
      if (diff <= TRAVEL_HEADING_ROAD_MAX_DIFF_DEG) {
        const roadWeight = input.speedKmh >= 55
          ? 0.5
          : input.speedKmh >= 25
            ? 0.4
            : input.speedKmh >= 10
              ? 0.32
              : 0.22;
        return lerpHeading(travel, road, roadWeight);
      }
      if (input.speedKmh >= 8 || input.movedM >= 2.5) {
        return travel;
      }
      if (prev != null) {
        return lerpHeadingWithMaxStep(prev, travel, 18);
      }
      return travel;
    }
  }

  if (
    prev != null
    && input.speedKmh < TRAVEL_HEADING_LOW_SPEED_HOLD_KMH
    && input.movedM < 1
  ) {
    return prev;
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
