/**
 * Client-first policy: prefer local road geometry (route / SQLite / vector tiles)
 * before any Mapbox Map Matching HTTP call.
 */

export type LocalGeometrySource = 'route' | 'sqlite' | 'tile' | 'memory';

export type ClientFirstMetrics = {
  healthyUntil: number;
  noRoadSince: number;
  localHits: Record<string, number>;
  networkBlocked: number;
  networkAllowed: number;
};

const LOCAL_HEALTHY_TTL_MS = 12 * 60_000;
/** Bez lokalnej geometrii — czekaj przed pierwszym trace (local tile/sqlite mają czas). */
const NO_ROAD_NETWORK_GRACE_MS = 50_000;
/** Po tym czasie bez drogi — wolno sieć mimo krótkiego healthy. */
const NO_ROAD_FORCE_NETWORK_MS = 120_000;

const state = {
  healthyUntil: 0,
  noRoadSince: 0,
  localHits: {} as Record<string, number>,
  networkBlocked: 0,
  networkAllowed: 0,
};

export function markClientFirstGeometryHealthy(
  source?: LocalGeometrySource,
  ttlMs = LOCAL_HEALTHY_TTL_MS,
): void {
  state.healthyUntil = Date.now() + ttlMs;
  state.noRoadSince = 0;
  if (source) {
    state.localHits[source] = (state.localHits[source] ?? 0) + 1;
  }
}

export function markClientFirstNoRoad(): void {
  if (state.noRoadSince === 0) {
    state.noRoadSince = Date.now();
  }
}

export function clearClientFirstNoRoad(): void {
  state.noRoadSince = 0;
}

export function isClientFirstGeometryHealthy(): boolean {
  return Date.now() < state.healthyUntil;
}

export function getNoRoadDurationMs(): number {
  if (state.noRoadSince === 0) return 0;
  return Date.now() - state.noRoadSince;
}

export function getClientFirstMetrics(): ClientFirstMetrics {
  return {
    healthyUntil: state.healthyUntil,
    noRoadSince: state.noRoadSince,
    localHits: { ...state.localHits },
    networkBlocked: state.networkBlocked,
    networkAllowed: state.networkAllowed,
  };
}

export function resetClientFirstState(): void {
  state.healthyUntil = 0;
  state.noRoadSince = 0;
  state.localHits = {};
  state.networkBlocked = 0;
  state.networkAllowed = 0;
}

export type NetworkMapMatchPolicyInput = {
  /** Ręczne wejście w jazdę — jednorazowy anchor z sieci dozwolony. */
  manualEntry?: boolean;
  /** Krytyczny rescue (duży drift, marker stuck) — sieć po krótkim healthy. */
  critical?: boolean;
  /** Brak polilinii drogi w snap engine. */
  noRoad?: boolean;
  /** Wymuszony trace (stale snap burst). */
  staleSnap?: boolean;
};

/**
 * Czy wolno wysłać Map Matching / force recovery do Mapbox.
 */
export function shouldAllowNetworkMapMatch(input: NetworkMapMatchPolicyInput): boolean {
  const {
    manualEntry = false,
    critical = false,
    noRoad = false,
    staleSnap = false,
  } = input;

  if (manualEntry) {
    state.networkAllowed += 1;
    return true;
  }

  if (critical) {
    const noRoadMs = getNoRoadDurationMs();
    if (isClientFirstGeometryHealthy() && noRoadMs > 0 && noRoadMs < NO_ROAD_FORCE_NETWORK_MS) {
      state.networkBlocked += 1;
      return false;
    }
    state.networkAllowed += 1;
    return true;
  }

  const healthy = isClientFirstGeometryHealthy();
  const noRoadMs = getNoRoadDurationMs();

  if (healthy && !noRoad && !staleSnap) {
    state.networkBlocked += 1;
    return false;
  }

  if (noRoad && noRoadMs > 0 && noRoadMs < NO_ROAD_NETWORK_GRACE_MS) {
    state.networkBlocked += 1;
    return false;
  }

  if (healthy && noRoad && noRoadMs < NO_ROAD_FORCE_NETWORK_MS) {
    state.networkBlocked += 1;
    return false;
  }

  state.networkAllowed += 1;
  return true;
}
