import { bearingBetween } from '../../scripts/navigationUtils';
import { DISPLAY_HEADING_ROAD_TAU_SEC } from './config';
import { smoothHeadingEma } from './geo';

export const TRAVEL_HEADING_VECTOR_MIN_MOVE_M = 1.2;
export const TRAVEL_HEADING_LOW_SPEED_HOLD_KMH = 5;
export const TRAVEL_HEADING_FLIP_REJECT_DEG = 92;
export const TRAVEL_HEADING_ROAD_MAX_DIFF_DEG = 18;

function normalizeHeading(h: number): number {
  return ((h % 360) + 360) % 360;
}

function headingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function lerpHeading(from: number, to: number, t: number): number {
  const d = headingDelta(from, to);
  return normalizeHeading(from + d * t);
}

function lerpHeadingWithMaxStep(from: number, to: number, maxStepDeg: number): number {
  const d = headingDelta(from, to);
  const step = Math.max(-maxStepDeg, Math.min(maxStepDeg, d));
  return normalizeHeading(from + step);
}

/** 10 km/h — powyżej ignoruj kompas urządzenia. */
export const TRAVEL_VECTOR_LOCK_SPEED_MS = 2.78;
export const TRAVEL_VECTOR_LOCK_SPEED_KMH = 10;
export const TRAVEL_COMPASS_MAX_KMH = TRAVEL_VECTOR_LOCK_SPEED_KMH;
export const TRAVEL_VECTOR_ONLY_MIN_KMH = TRAVEL_VECTOR_LOCK_SPEED_KMH;
export const HEADING_MA_SAMPLES = 4;

export function speedMsToKmh(speedMs: number): number {
  return Math.max(0, speedMs) * 3.6;
}

/** Okrągły bufor — średnia kątów przez sumę sin/cos. */
export class HeadingRingBuffer {
  private readonly cap: number;
  private buf: number[] = [];

  constructor(capacity = HEADING_MA_SAMPLES) {
    this.cap = Math.max(1, capacity);
  }

  reset(): void {
    this.buf = [];
  }

  push(deg: number): void {
    if (!Number.isFinite(deg)) return;
    this.buf.push(normalizeHeading(deg));
    if (this.buf.length > this.cap) {
      this.buf.shift();
    }
  }

  circularMean(): number | null {
    if (this.buf.length === 0) return null;
    let sinSum = 0;
    let cosSum = 0;
    for (const d of this.buf) {
      const r = (d * Math.PI) / 180;
      sinSum += Math.sin(r);
      cosSum += Math.cos(r);
    }
    if (Math.abs(sinSum) < 1e-9 && Math.abs(cosSum) < 1e-9) {
      return normalizeHeading(this.buf[this.buf.length - 1]!);
    }
    return normalizeHeading((Math.atan2(sinSum, cosSum) * 180) / Math.PI);
  }
}

export type TripBearingInput = {
  prevLat: number;
  prevLng: number;
  lat: number;
  lng: number;
  movedM: number;
  speedMs: number;
  speedKmh?: number;
  snapHeading: number;
  compassDeg?: number | null;
  prevHeading?: number | null;
};

function rawMoveBearing(
  prevLat: number,
  prevLng: number,
  lat: number,
  lng: number,
  movedM: number,
): number | null {
  if (movedM < TRAVEL_HEADING_VECTOR_MIN_MOVE_M) return null;
  if (!Number.isFinite(prevLat) || !Number.isFinite(prevLng)) return null;
  return bearingBetween(prevLat, prevLng, lat, lng);
}

/** 0° w pipeline = brak ustalonego kierunku (nie mylić z prawdziwą północą). */
function isHeadingUnset(h: number | null | undefined): boolean {
  if (h == null || !Number.isFinite(h)) return true;
  const n = normalizeHeading(h);
  return n < 1.5 || n > 358.5;
}

function applyFlipReject(
  prev: number | null,
  candidate: number,
  speedKmh: number,
): number {
  if (prev == null || isHeadingUnset(prev)) return candidate;
  const flip = Math.abs(headingDelta(prev, candidate));
  if (speedKmh >= TRAVEL_VECTOR_ONLY_MIN_KMH && flip >= TRAVEL_HEADING_FLIP_REJECT_DEG) {
    return prev;
  }
  if (speedKmh >= 6 && flip >= 130) {
    return prev;
  }
  const maxStep = speedKmh < 8 ? 14 : speedKmh < 25 ? 20 : speedKmh < 55 ? 28 : 34;
  return lerpHeadingWithMaxStep(prev, candidate, maxStep);
}

/**
 * Jedna klatka filtra: wektor ruchu + MA(4) + flip guard.
 * Powyżej 10 km/h — bez kompasu i bez tangensa drogi.
 */
export function computeTripBearing(
  input: TripBearingInput,
  ring: HeadingRingBuffer,
): number {
  const speedKmh = input.speedKmh ?? speedMsToKmh(input.speedMs);
  const vectorLock = input.speedMs > TRAVEL_VECTOR_LOCK_SPEED_MS
    || speedKmh > TRAVEL_VECTOR_LOCK_SPEED_KMH;
  const prev = input.prevHeading != null ? normalizeHeading(input.prevHeading) : null;
  const road = normalizeHeading(input.snapHeading);

  const moveBearing = rawMoveBearing(
    input.prevLat,
    input.prevLng,
    input.lat,
    input.lng,
    input.movedM,
  );

  if (vectorLock && moveBearing != null) {
    ring.push(moveBearing);
    const smoothed = ring.circularMean() ?? moveBearing;
    return applyFlipReject(prev, smoothed, speedKmh);
  }

  if (vectorLock && moveBearing == null) {
    if (!isHeadingUnset(prev)) return prev!;
    if (!isHeadingUnset(road)) return road;
  }

  if (moveBearing != null && (speedKmh >= 3.5 || input.movedM >= TRAVEL_HEADING_VECTOR_MIN_MOVE_M)) {
    ring.push(moveBearing);
    let candidate = ring.circularMean() ?? moveBearing;
    if (!vectorLock) {
      const diff = Math.abs(headingDelta(road, candidate));
      if (diff <= TRAVEL_HEADING_ROAD_MAX_DIFF_DEG) {
        candidate = lerpHeading(candidate, road, speedKmh >= 8 ? 0.2 : 0.12);
      }
    }
    return applyFlipReject(prev, candidate, speedKmh);
  }

  if (prev != null && speedKmh < TRAVEL_HEADING_LOW_SPEED_HOLD_KMH) {
    return prev;
  }

  if (vectorLock && prev != null && !isHeadingUnset(prev)) {
    return prev;
  }

  if (prev != null) {
    const flip = Math.abs(headingDelta(prev, road));
    if (flip >= TRAVEL_HEADING_FLIP_REJECT_DEG) return prev;
    return lerpHeadingWithMaxStep(prev, road, 12);
  }

  return road;
}

/** Faza 3 — display heading z segmentu drogi (EMA) gdy onRoad. */
export function preferRoadHeading(
  motionHeading: number,
  roadHeading: number,
  onRoad: boolean,
  speedKmh: number,
  prevDisplay?: number | null,
  dtSec = 0.25,
): number {
  if (!onRoad || speedKmh < 8) {
    return motionHeading;
  }
  const base = prevDisplay != null && Number.isFinite(prevDisplay)
    ? prevDisplay
    : motionHeading;
  return smoothHeadingEma(base, roadHeading, dtSec, DISPLAY_HEADING_ROAD_TAU_SEC);
}

/** Sesyjny filtr heading (SSOT) — trzyma ring buffer między tickami GPS. */
export class TripHeadingFilter {
  private readonly ring = new HeadingRingBuffer(HEADING_MA_SAMPLES);
  private lastHeading: number | null = null;

  reset(heading?: number): void {
    this.ring.reset();
    this.lastHeading = heading != null && Number.isFinite(heading)
      ? normalizeHeading(heading)
      : null;
  }

  getLastHeading(): number | null {
    return this.lastHeading;
  }

  update(input: Omit<TripBearingInput, 'prevHeading'>): number {
    const out = computeTripBearing(
      { ...input, prevHeading: this.lastHeading },
      this.ring,
    );
    this.lastHeading = out;
    return out;
  }
}
