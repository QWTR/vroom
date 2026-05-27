/**
 * Centralny gate przed siecią Mapbox (Matching + Directions).
 * Jedna prawda dla interwału/ruchu/prędkości — trace, forceMatch i map.tsx.
 */

import { haversineKm } from '../scripts/navigationUtils';

export const MAP_MATCH_MIN_INTERVAL_MS = 8_000;
export const MAP_MATCH_MIN_MOVE_M = 20;
export const MAP_MATCH_MIN_SPEED_KMH = 5;
export const MAP_MATCH_STATIONARY_MAX_ACC_M = 35;
const STALE_SNAP_BURST_WINDOW_MS = 10 * 60_000;
const STALE_SNAP_BURST_MAX = 3;

export type MapboxNetworkKind = 'map_match' | 'directions';

export type MapMatchGateInput = {
  lat: number;
  lng: number;
  speedKmh: number;
  accuracyM?: number | null;
  /** Ręczne wejście w jazdę — omija próg prędkości. */
  manual?: boolean;
  staleSnap?: boolean;
};

type GateState = {
  lastMatchAt: number;
  lastMatchLat: number;
  lastMatchLng: number;
  staleSnapBurstAt: number[];
  counters: Record<string, number>;
};

const state: GateState = {
  lastMatchAt: 0,
  lastMatchLat: 0,
  lastMatchLng: 0,
  staleSnapBurstAt: [],
  counters: {},
};

function movedM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

function bumpCounter(kind: MapboxNetworkKind, reason: string): void {
  const key = `${kind}:${reason}`;
  state.counters[key] = (state.counters[key] ?? 0) + 1;
}

/** Czy wolno wysłać kolejny request Map Matching do sieci. */
export function canRequestMapMatch(input: MapMatchGateInput): { ok: boolean; reason?: string } {
  const { lat, lng, speedKmh, accuracyM, manual, staleSnap } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'invalid_coord' };
  }

  if (!manual) {
    if (speedKmh < MAP_MATCH_MIN_SPEED_KMH) {
      return { ok: false, reason: 'stationary' };
    }
    if (
      accuracyM != null
      && Number.isFinite(accuracyM)
      && accuracyM > MAP_MATCH_STATIONARY_MAX_ACC_M
      && speedKmh < 15
    ) {
      return { ok: false, reason: 'poor_accuracy' };
    }
  }

  if (!manual && staleSnap) {
    const now = Date.now();
    state.staleSnapBurstAt = state.staleSnapBurstAt.filter((t) => now - t < STALE_SNAP_BURST_WINDOW_MS);
    if (state.staleSnapBurstAt.length >= STALE_SNAP_BURST_MAX) {
      return { ok: false, reason: 'stale_snap_burst' };
    }
    if (speedKmh < 8) {
      return { ok: false, reason: 'stale_snap_low_speed' };
    }
  }

  if (!manual) {
    const now = Date.now();
    if (state.lastMatchAt > 0) {
      const move = movedM(state.lastMatchLat, state.lastMatchLng, lat, lng);
      if (now - state.lastMatchAt < MAP_MATCH_MIN_INTERVAL_MS && move < MAP_MATCH_MIN_MOVE_M) {
        return { ok: false, reason: 'global_throttle' };
      }
    }
  }

  return { ok: true };
}

/** Wywołać tuż przed fetchMatchingViaProxy / fetchDirectionsViaProxy (sieć). */
export function recordMapMatchNetwork(
  lat: number,
  lng: number,
  reason: string,
  opts?: { staleSnap?: boolean },
): void {
  const now = Date.now();
  state.lastMatchAt = now;
  state.lastMatchLat = lat;
  state.lastMatchLng = lng;
  if (opts?.staleSnap) {
    state.staleSnapBurstAt.push(now);
  }
  bumpCounter('map_match', reason);
  if (__DEV__) {
    console.log('[MapboxGate] map_match', reason, getMapboxNetworkMetrics().map_match_total);
  }
}

export function recordDirectionsNetwork(reason: string): void {
  bumpCounter('directions', reason);
  if (__DEV__) {
    console.log('[MapboxGate] directions', reason);
  }
}

export function getMapboxNetworkMetrics(): {
  counters: Record<string, number>;
  map_match_total: number;
  directions_total: number;
} {
  let mapMatchTotal = 0;
  let directionsTotal = 0;
  for (const [key, n] of Object.entries(state.counters)) {
    if (key.startsWith('map_match:')) mapMatchTotal += n;
    if (key.startsWith('directions:')) directionsTotal += n;
  }
  return {
    counters: { ...state.counters },
    map_match_total: mapMatchTotal,
    directions_total: directionsTotal,
  };
}

export function resetMapboxNetworkGateForTests(): void {
  state.lastMatchAt = 0;
  state.lastMatchLat = 0;
  state.lastMatchLng = 0;
  state.staleSnapBurstAt = [];
  state.counters = {};
}
