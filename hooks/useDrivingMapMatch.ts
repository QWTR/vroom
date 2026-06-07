import { useRef, useCallback } from 'react';
import { MAPBOX_TOKEN }        from '../constants/mapConfig';
import { haversineKm }         from '../scripts/navigationUtils';
import { fetchDirectionsViaProxy, fetchMatchingViaProxy } from '../scripts/mapboxProxyClient';
import { roadGeometryStore } from '../lib/roadGeometry/RoadGeometryStore';
import {
  canRequestMapMatch,
  recordDirectionsNetwork,
  recordMapMatchNetwork,
} from '../lib/mapboxNetworkGate';
import { vroomGpsLog } from '../lib/vroomGpsLog';
import { GpsBufferJitterFilter } from '../lib/driveCore/gpsBufferJitterFilter';
import { evaluateLocalGeometryGate } from '../lib/driveCore/localGeometryMatchGate';
import {
  BACKGROUND_NETWORK_MIN_INTERVAL_MS,
  BACKGROUND_NETWORK_MIN_PATH_M,
  MAP_MATCH_TRAFFIC_LIGHT_KMH,
} from '../lib/driveCore/config';
import { isMapMatchAppBackground } from '../lib/mapMatch/mapMatchSyncState';

// ─────────────────────────────────────────────────────────────────────────────
// Mapbox Map Matching — DAP to Road
// Snaps driving position to the nearest road using Mapbox's matching API.
// Trace requests are throttled by MIN_INTERVAL_MS and MAX_REQUESTS_PER_WINDOW / h.
// ─────────────────────────────────────────────────────────────────────────────

const MAP_MATCH_URL   = 'https://api.mapbox.com/matching/v5/mapbox/driving';
/** Min. odstęp między requestami trace — driving: częstszy pierwszy segment drogi. */
/** Min. odstęp między trace do Map Matching — koszt API > lag snapu przy <45 s. */
const MIN_INTERVAL_MS = 45_000;
const BUFFER_SIZE     = 22;     // number of GPS points sent to API (Mapbox allows up to 100)
/** Suma dystansu w buforze przed wysłaniem trace (batching zamiast pojedynczych punktów). */
const BATCH_MIN_PATH_DISTANCE_M = 40;
const BATCH_MIN_POINTS = 3;
/** Traffic-light freeze for Map Matching API (marker still moves locally). */
const STATIONARY_SPEED_KMH = MAP_MATCH_TRAFFIC_LIGHT_KMH;
const MATCH_RADIUS_M  = 50;     // max 50 m — limit Mapbox Map Matching
/** Musi być ≤ 50 (Mapbox); większe psuje API i forceMatch zwracał pusto = brak snap w driving. */
const FORCE_MATCH_RADIUS_M = 50;
/** Gdy brak świeżego ticku z map.tsx, segment wygasa — driving i tak bumpuje czas przy aktywnym GPS. */
/** Gdy przekroczone — tylko log stale; geometria zostaje do STALE_MAX_MS. */
const EXPIRE_MS       = 120_000;
const STALE_MAX_MS    = 15 * 60_000;
const MIN_POINT_DIST_KM = 0.005; // legacy fallback; jitter filter is primary gate
const MIN_BUFFER_POINTS = 2;     // API wymaga ≥2 punktów
const MIN_FETCH_MOVE_M  = 45;
/** forceMatch (bez manual/refresh): nie spamuj identycznym anchorem. */
const FORCE_MATCH_MIN_INTERVAL_MS = 180_000;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
/** Limit zapytań / h (trace + force) — nie podbijać bez sensu kosztów Mapbox. */
/** Zgodne z MATCHING_MAX_PER_WINDOW w mapboxProxy.js */
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_MANUAL_BURST_PER_WINDOW = 2;
const BUDGET_SOFT_CAP_PER_WINDOW = 14;
const BUDGET_HARD_CAP_PER_WINDOW = 20;
const STALE_SNAP_BURST_PER_WINDOW = 3;
const FRESH_GEOMETRY_BLOCK_MS = 120_000;
// Tiny coordinate offset used to form a valid 2-point API call from a single position.
// 0.00005° ≈ 5 m — small enough to return the same road segment.
const FORCE_MATCH_OFFSET_DEG = 0.00005;
const REFRESH_FORCE_MIN_INTERVAL_MS = 45_000;
const REFRESH_FORCE_MIN_MOVE_M = 120;
const DIRECTIONS_STUB_MIN_INTERVAL_MS = 120_000;
const DIRECTIONS_STUB_MIN_MOVE_M = 260;
const DIRECTIONS_STUB_MAX_PER_WINDOW = 5;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface GpsPoint {
  lat:  number;
  lng:  number;
  time: number;
}

function bufferPathDistanceM(points: GpsPoint[]): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng) * 1000;
  }
  return sum;
}

/** Gdy matching zwróci NoSegment (GPS dalej od drogi niż 50 m), fallback przez krótkie legi Directions. */
const DIRECTIONS_STUB_OFFSET_DEG = 0.00032; // ~25–35 m zależnie od szerokości geogr.

async function roadGeometryFromDirectionsStub(
  lat: number,
  lng: number,
  headingDeg?: number,
): Promise<{ latitude: number; longitude: number }[] | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let dy = 1;
  let dx = 0;
  if (Number.isFinite(headingDeg)) {
    const rad = ((90 - headingDeg) * Math.PI) / 180;
    dy = Math.cos(rad);
    dx = Math.sin(rad);
  }
  const lat2 = lat + DIRECTIONS_STUB_OFFSET_DEG * dy;
  const lng2 = lng + DIRECTIONS_STUB_OFFSET_DEG * dx;
  const directionsUrl =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${lng},${lat};${lng2},${lat2}` +
    `?alternatives=false&geometries=geojson&overview=full&steps=false&access_token=${MAPBOX_TOKEN}`;

  try {
    recordDirectionsNetwork('force_stub_manual');
    const data = await fetchDirectionsViaProxy<{
      routes?: Array<{ geometry?: { coordinates?: [number, number][] } }>;
    }>(
      {
        coordinates: [
          [lng, lat],
          [lng2, lat2],
        ],
        profile: 'driving',
        alternatives: false,
        geometries: 'geojson',
        steps: false,
        overview: 'full',
        language: 'pl',
      },
      directionsUrl,
    );
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      return coords.map(([lng3, lat3]) => ({ latitude: lat3, longitude: lng3 }));
    }
  } catch {
    /* stub miss */
  }

  return null;
}

export type ForceMatchOptions = {
  /** Ręczne wejście w driving: zawsze sieć, czeka na inny fetch, omija limit zapytań. */
  manual?: boolean;
  /** Okresowe odświeżenie osi drogi w driving — omija cache 72s, wlicza się w budżet zapytań. */
  refresh?: boolean;
  speedKmh?: number;
  headingDeg?: number;
};

export type AddMatchContext = {
  speedKmh?: number | null;
  accuracyM?: number | null;
  noRoad?: boolean;
  staleSnap?: boolean;
};

interface MapMatchResponse {
  code:      string;
  matchings: Array<{
    geometry: {
      coordinates: [number, number][];
    };
  }>;
}

/**
 * Maintains a small rolling buffer of GPS positions and periodically calls
 * the Mapbox Map Matching API to obtain a road-snapped polyline.
 *
 * The returned `addPosition` should be called on every GPS update while in
 * (or approaching) Driving Mode.  `getMatchedPoints` returns the latest
 * matched road segment (or null when unavailable / expired).
 */
export function useDrivingMapMatch() {
  const bufferRef      = useRef<GpsPoint[]>([]);
  const lastCallRef    = useRef<number>(0);
  const lastFetchRef   = useRef<{ lat: number; lng: number } | null>(null);
  const requestTimesRef = useRef<number[]>([]);
  const directionsStubTimesRef = useRef<number[]>([]);
  const lastRefreshForceRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const lastNetworkAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const jitterFilterRef = useRef(new GpsBufferJitterFilter());
  const lastDirectionsStubRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const isFetchingRef  = useRef<boolean>(false);
  const matchedPtsRef  = useRef<{ latitude: number; longitude: number }[] | null>(null);
  const matchedTimeRef = useRef<number>(0);
  /** Inkrementowany przy reset() — odrzuca zapisy z fetchy anulowanych po wyjściu z driving. */
  const matchGenRef    = useRef(0);
  const applyLocalRoadCache = useCallback(async (
    lat: number,
    lng: number,
    radiusM = 120,
  ): Promise<{ latitude: number; longitude: number }[] | null> => {
    const hit = await roadGeometryStore.findNearest(lat, lng, radiusM);
    if (!hit || hit.points.length < 2) return null;
    matchedPtsRef.current = hit.points;
    matchedTimeRef.current = Date.now();
    if (__DEV__) {
      console.log('[DrivingMapMatch] SQLite road cache hit', hit.points.length, 'pts', 'ageMs', hit.ageMs);
    }
    return hit.points;
  }, []);

  const persistMatchedGeometry = useCallback(async (
    points: { latitude: number; longitude: number }[],
  ) => {
    if (points.length >= 2) {
      await roadGeometryStore.insert(points);
    }
  }, []);

  const logSnapReject = useCallback((reason: string, payload?: Record<string, unknown>) => {
    vroomGpsLog(`MATCH_${reason}`, { source: 'useDrivingMapMatch', ...(payload ?? {}) }, 1500);
  }, []);

  const consumeRequestSlot = useCallback((now: number, manual = false, staleSnap = false): boolean => {
    requestTimesRef.current = requestTimesRef.current.filter((ts) => now - ts < REQUEST_WINDOW_MS);
    const count = requestTimesRef.current.length;
    if (manual) {
      if (count >= MAX_REQUESTS_PER_WINDOW + MAX_MANUAL_BURST_PER_WINDOW) return false;
      if (count < MAX_REQUESTS_PER_WINDOW) requestTimesRef.current.push(now);
      return true;
    }
    if (staleSnap) {
      if (count >= MAX_REQUESTS_PER_WINDOW + STALE_SNAP_BURST_PER_WINDOW) return false;
      requestTimesRef.current.push(now);
      return true;
    }
    if (count >= MAX_REQUESTS_PER_WINDOW) return false;
    requestTimesRef.current.push(now);
    return true;
  }, []);

  const getRequestUsageCount = useCallback((now: number): number => {
    requestTimesRef.current = requestTimesRef.current.filter((ts) => now - ts < REQUEST_WINDOW_MS);
    return requestTimesRef.current.length;
  }, []);

  const shouldAttemptDirectionsStub = useCallback((
    lat: number,
    lng: number,
    speedKmh: number,
    manual: boolean,
  ): boolean => {
    if (!manual || speedKmh < 10) return false;
    const now = Date.now();
    directionsStubTimesRef.current = directionsStubTimesRef.current.filter((ts) => now - ts < REQUEST_WINDOW_MS);
    if (directionsStubTimesRef.current.length >= DIRECTIONS_STUB_MAX_PER_WINDOW) return false;
    if (getRequestUsageCount(now) >= BUDGET_HARD_CAP_PER_WINDOW) return false;
    const last = lastDirectionsStubRef.current;
    if (!last) {
      lastDirectionsStubRef.current = { at: now, lat, lng };
      directionsStubTimesRef.current.push(now);
      return true;
    }
    const movedM = haversineKm(last.lat, last.lng, lat, lng) * 1000;
    if (now - last.at < DIRECTIONS_STUB_MIN_INTERVAL_MS && movedM < DIRECTIONS_STUB_MIN_MOVE_M) return false;
    lastDirectionsStubRef.current = { at: now, lat, lng };
    directionsStubTimesRef.current.push(now);
    return true;
  }, [getRequestUsageCount]);

  const addPosition = useCallback(async (
    lat: number,
    lng: number,
    ctx?: AddMatchContext,
  ): Promise<void> => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      logSnapReject('add_invalid_coord');
      return;
    }
    const now  = Date.now();
    const background = isMapMatchAppBackground();
    const speedKmh = Math.max(0, ctx?.speedKmh ?? 0);
    const noRoad = !!ctx?.noRoad;
    const staleSnap = !!ctx?.staleSnap;

    if (!background && speedKmh < STATIONARY_SPEED_KMH && !noRoad) {
      logSnapReject('add_velocity_pause', { speedKmh: Math.round(speedKmh) });
      return;
    }

    const jitterAccepted = jitterFilterRef.current.accept({
      lat,
      lng,
      accuracy: ctx?.accuracyM ?? 12,
      timestamp: now,
    });
    if (!jitterAccepted) {
      logSnapReject('add_jitter_reject');
      return;
    }

    // Skip duplicate / near-duplicate points (secondary guard)
    const last = bufferRef.current[bufferRef.current.length - 1];
    if (last && haversineKm(last.lat, last.lng, lat, lng) < MIN_POINT_DIST_KM) return;

    bufferRef.current.push({ lat, lng, time: now });
    if (bufferRef.current.length > BUFFER_SIZE) {
      bufferRef.current = bufferRef.current.slice(-BUFFER_SIZE);
    }

    const acc = ctx?.accuracyM;
    const gate = canRequestMapMatch({
      lat,
      lng,
      speedKmh,
      accuracyM: acc,
      staleSnap,
    });
    if (!gate.ok) {
      logSnapReject(`add_gate_${gate.reason ?? 'denied'}`, { staleSnap });
      return;
    }
    const poorAcc = acc != null && Number.isFinite(acc) && acc > 35;
    const usageCount = getRequestUsageCount(now);

    let dynamicMinIntervalMs = background
      ? BACKGROUND_NETWORK_MIN_INTERVAL_MS
      : MIN_INTERVAL_MS;
    let dynamicMinMoveM = MIN_FETCH_MOVE_M;
    let minPathM = background ? BACKGROUND_NETWORK_MIN_PATH_M : BATCH_MIN_PATH_DISTANCE_M;
    if (noRoad) {
      dynamicMinIntervalMs = 30_000;
      dynamicMinMoveM = 24;
    } else if (speedKmh >= 55) {
      dynamicMinIntervalMs = 13_000;
      dynamicMinMoveM = 100;
    } else if (speedKmh >= 25) {
      dynamicMinIntervalMs = 30_000;
      dynamicMinMoveM = 40;
    } else {
      dynamicMinIntervalMs = 30_000;
      dynamicMinMoveM = 34;
    }
    if (poorAcc && !noRoad) {
      dynamicMinIntervalMs += 1_900;
      dynamicMinMoveM += 8;
    }
    if (matchedPtsRef.current && !noRoad && speedKmh < 16 && !poorAcc) {
      dynamicMinIntervalMs = Math.max(dynamicMinIntervalMs, 30_000);
      dynamicMinMoveM = Math.max(dynamicMinMoveM, 70);
    }
    if (usageCount >= BUDGET_SOFT_CAP_PER_WINDOW) {
      dynamicMinIntervalMs += 12_000;
      dynamicMinMoveM += 30;
    }
    if (usageCount >= BUDGET_HARD_CAP_PER_WINDOW) {
      dynamicMinIntervalMs += 22_000;
      dynamicMinMoveM += 55;
    }
    if (staleSnap) {
      dynamicMinIntervalMs = 45_000;
      dynamicMinMoveM = 40;
    }

    // Przy bardzo małej prędkości i istniejącym snapie utrzymujemy płynność lokalnie
    // (DR + drivingSnap), nie dopytując API — chyba że staleSnap (geometria odjechała).
    if (matchedPtsRef.current && speedKmh < 8 && !noRoad && !staleSnap) {
      logSnapReject('add_low_speed_cached_geometry', { speedKmh: Math.round(speedKmh) });
      return;
    }

    if (now - lastCallRef.current < dynamicMinIntervalMs) {
      logSnapReject('add_interval_gate', {
        waitMs: dynamicMinIntervalMs - (now - lastCallRef.current),
        staleSnap,
      });
      return;
    }
    if (isFetchingRef.current) {
      logSnapReject('add_fetch_inflight');
      return;
    }
    if (bufferRef.current.length < MIN_BUFFER_POINTS) {
      logSnapReject('add_buffer_too_short', { points: bufferRef.current.length });
      return;
    }
    const pathM = bufferPathDistanceM(bufferRef.current);
    const batchReady =
      pathM >= minPathM
      || bufferRef.current.length >= BUFFER_SIZE
      || (noRoad && pathM >= 12 && bufferRef.current.length >= BATCH_MIN_POINTS);
    if (!batchReady) {
      logSnapReject('add_batch_distance_gate', {
        pathM: Math.round(pathM),
        minPathM,
        points: bufferRef.current.length,
        background,
      });
      return;
    }
    if (lastFetchRef.current) {
      const movedSinceLastFetchM = haversineKm(
        lastFetchRef.current.lat,
        lastFetchRef.current.lng,
        lat,
        lng,
      ) * 1000;
      if (movedSinceLastFetchM < dynamicMinMoveM) {
        logSnapReject('add_move_gate', {
          movedM: Math.round(movedSinceLastFetchM),
          minMoveM: Math.round(dynamicMinMoveM),
          staleSnap,
        });
        return;
      }
    }
    if (!consumeRequestSlot(now, false, staleSnap)) {
      logSnapReject('add_budget_exhausted', { staleSnap });
      return;
    }

    const sqliteHit = await applyLocalRoadCache(lat, lng, 80);
    if (sqliteHit) {
      logSnapReject('add_sqlite_cache_hit');
      return;
    }

    if (!background) {
      const anchor = lastNetworkAnchorRef.current ?? lastFetchRef.current;
      const movedSinceNetworkM = anchor
        ? haversineKm(anchor.lat, anchor.lng, lat, lng) * 1000
        : Infinity;
      const localGate = await evaluateLocalGeometryGate(lat, lng, movedSinceNetworkM);
      if (localGate.skipNetwork && localGate.segment) {
        matchedPtsRef.current = localGate.segment;
        matchedTimeRef.current = Date.now();
        logSnapReject('add_local_geometry_skip', {
          crossTrackM: Math.round(localGate.crossTrackM),
        });
        return;
      }
    }

    lastCallRef.current   = now;
    lastFetchRef.current  = { lat, lng };
    isFetchingRef.current = true;
    const genWhenStarted = matchGenRef.current;
    recordMapMatchNetwork(lat, lng, staleSnap ? 'trace_stale_snap' : 'trace', { staleSnap });

    try {
      const pts     = bufferRef.current;
      const coords  = pts.map(p => `${p.lng},${p.lat}`).join(';');
      const radii   = pts.map(() => String(MATCH_RADIUS_M)).join(';');
      const url     = `${MAP_MATCH_URL}/${coords}?geometries=geojson&tidy=true&radiuses=${radii}&access_token=${MAPBOX_TOKEN}`;

      const json = await fetchMatchingViaProxy<MapMatchResponse>(
        {
          points: pts.map((p) => ({ lat: p.lat, lng: p.lng })),
          profile: 'driving',
          radiuses: pts.map(() => MATCH_RADIUS_M),
        },
        url,
        // Proxy może zwrócić null (429, auth); allow direct fallback so
        // geometry is still refreshed during driving, not only on forceMatch.
        {
          allowFallback: false,
          proxyTimeoutMs: noRoad ? 2800 : 4000,
        },
      );
      if (genWhenStarted !== matchGenRef.current) return;
      if (!json) {
        logSnapReject('add_proxy_and_fallback_null');
        return;
      }

      if (Array.isArray(json.matchings) && json.matchings[0]?.geometry?.coordinates?.length) {
        const matched = json.matchings[0].geometry.coordinates.map(
          ([lng, lat]) => ({ latitude: lat, longitude: lng }),
        );
        matchedPtsRef.current  = matched;
        matchedTimeRef.current = Date.now();
        lastNetworkAnchorRef.current = { lat, lng };
        await persistMatchedGeometry(matched);
        console.log('[DrivingMapMatch] Matched', matched.length, 'points to road');
      } else {
        console.log('[DrivingMapMatch] No match found (code:', json.code, ')');
        logSnapReject('add_no_match', { code: json.code ?? 'unknown' });
      }
    } catch (e) {
      console.warn('[DrivingMapMatch] API error:', e);
      logSnapReject('add_api_error');
    } finally {
      isFetchingRef.current = false;
    }
  }, [applyLocalRoadCache, consumeRequestSlot, logSnapReject, persistMatchedGeometry, shouldAttemptDirectionsStub]);

  /**
   * Immediately snaps a single position to the nearest road, bypassing the
   * normal cooldown and buffer-size requirements.  Used on driving mode entry
   * so the marker is road-snapped from the very first GPS tick rather than
   * waiting for the user to move enough and the regular interval to elapse.
   *
   * Internally sends two nearly-identical coordinates (5 m apart) because the
   * Mapbox Map Matching API requires at least 2 points.
   *
   * @returns The matched road-geometry points, or null if the API call failed /
   *          returned no match.  The result is also stored in the internal cache
   *          so subsequent calls to `getMatchedPoints()` return it as usual.
   */
  const forceMatch = useCallback(
    async (
      lat: number,
      lng: number,
      opts?: ForceMatchOptions,
    ): Promise<{ latitude: number; longitude: number }[] | null> => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        logSnapReject('force_invalid_coord');
        return null;
      }

      const manual = !!opts?.manual;
      const refresh = !!opts?.refresh;
      const speedKmh = Math.max(0, opts?.speedKmh ?? 0);

      if (!manual) {
        const gate = canRequestMapMatch({ lat, lng, speedKmh, manual });
        if (!gate.ok) {
          logSnapReject(`force_gate_${gate.reason ?? 'denied'}`, { refresh });
          return matchedPtsRef.current;
        }
      }

      if (manual) {
        for (let i = 0; i < 50 && isFetchingRef.current; i++) {
          await sleep(60);
        }
      } else if (refresh) {
        if (getRequestUsageCount(Date.now()) >= BUDGET_HARD_CAP_PER_WINDOW * 2.5) {
          logSnapReject('force_refresh_budget_hard_cap');
          return matchedPtsRef.current;
        }
        for (let i = 0; i < 15 && isFetchingRef.current; i++) {
          await sleep(50);
        }
        if (isFetchingRef.current) {
          logSnapReject('force_refresh_fetch_inflight');
          return matchedPtsRef.current;
        }
        const lr = lastRefreshForceRef.current;
        if (lr) {
          const movedM = haversineKm(lr.lat, lr.lng, lat, lng) * 1000;
          if (Date.now() - lr.at < REFRESH_FORCE_MIN_INTERVAL_MS && movedM < REFRESH_FORCE_MIN_MOVE_M) {
            logSnapReject('force_refresh_interval_gate', {
              movedM: Math.round(movedM),
            });
            return matchedPtsRef.current;
          }
        }
      } else if (isFetchingRef.current) {
        logSnapReject('force_fetch_inflight');
        return null;
      }

      if (
        !manual &&
        !refresh &&
        matchedPtsRef.current &&
        Date.now() - matchedTimeRef.current < FORCE_MATCH_MIN_INTERVAL_MS
      ) {
        logSnapReject('force_recent_cache_used');
        return matchedPtsRef.current;
      }
      if (
        !manual &&
        !refresh &&
        matchedPtsRef.current &&
        Date.now() - matchedTimeRef.current < FRESH_GEOMETRY_BLOCK_MS
      ) {
        logSnapReject('force_geometry_fresh');
        return matchedPtsRef.current;
      }

      const now = Date.now();
      if (!manual && getRequestUsageCount(now) >= BUDGET_HARD_CAP_PER_WINDOW) {
        logSnapReject('force_budget_hard_cap');
        return matchedPtsRef.current;
      }
      if (!consumeRequestSlot(now, manual)) {
        logSnapReject('force_budget_slot_denied');
        return matchedPtsRef.current;
      }

      const sqliteHit = await applyLocalRoadCache(lat, lng, manual ? 120 : 150);
      if (sqliteHit) {
        logSnapReject(manual ? 'force_sqlite_cache_hit_manual' : 'force_sqlite_cache_hit');
        return sqliteHit;
      }

      const genWhenStarted = matchGenRef.current;
      isFetchingRef.current = true;
      lastCallRef.current   = now;
      lastFetchRef.current  = { lat, lng };
      if (refresh) {
        lastRefreshForceRef.current = { at: now, lat, lng };
      }
      const matchReason = manual ? 'force_manual' : (refresh ? 'force_refresh' : 'force');
      recordMapMatchNetwork(lat, lng, matchReason);

      try {
        const coords = [
          `${lng - FORCE_MATCH_OFFSET_DEG},${lat}`,
          `${lng},${lat}`,
        ].join(';');
        const radii = `${FORCE_MATCH_RADIUS_M};${FORCE_MATCH_RADIUS_M}`;
        const url   = `${MAP_MATCH_URL}/${coords}?geometries=geojson&tidy=true&radiuses=${radii}&access_token=${MAPBOX_TOKEN}`;

        const tryDirectionsStub = async (): Promise<{ latitude: number; longitude: number }[] | null> => {
          const cached = await roadGeometryStore.findNearest(lat, lng, 150);
          if (cached && cached.points.length >= 2) {
            matchedPtsRef.current = cached.points;
            matchedTimeRef.current = Date.now();
            vroomGpsLog('FORCE_SQLITE_FALLBACK', { pts: cached.points.length, ageMs: cached.ageMs });
            return cached.points;
          }
          if (!manual) return matchedPtsRef.current;
          const stub = shouldAttemptDirectionsStub(lat, lng, speedKmh, manual)
            ? await roadGeometryFromDirectionsStub(lat, lng, opts?.headingDeg)
            : null;
          if (genWhenStarted !== matchGenRef.current) return null;
          if (stub && stub.length >= 2) {
            matchedPtsRef.current  = stub;
            matchedTimeRef.current = Date.now();
            console.log('[DrivingMapMatch] forceMatch directions stub', stub.length, 'pts');
            await persistMatchedGeometry(stub);
            return stub;
          }
          return null;
        };

        const json = await fetchMatchingViaProxy<MapMatchResponse>(
          {
            points: [
              { lat, lng: lng - FORCE_MATCH_OFFSET_DEG },
              { lat, lng },
            ],
            profile: 'driving',
            radiuses: [FORCE_MATCH_RADIUS_M, FORCE_MATCH_RADIUS_M],
          },
          url,
          {
            allowFallback: false,
            skipClientCache: manual || refresh,
            proxyTimeoutMs: manual ? 4500 : (refresh ? 4000 : 4500),
          },
        );
        if (genWhenStarted !== matchGenRef.current) return null;

        if (!json) {
          logSnapReject('force_proxy_and_fallback_null');
          return (await tryDirectionsStub()) ?? matchedPtsRef.current;
        }

        if (Array.isArray(json.matchings) && json.matchings[0]?.geometry?.coordinates?.length) {
          const matched = json.matchings[0].geometry.coordinates.map(
            ([lng2, lat2]) => ({ latitude: lat2, longitude: lng2 }),
          );
          if (genWhenStarted !== matchGenRef.current) return null;
          matchedPtsRef.current  = matched;
          matchedTimeRef.current = Date.now();
          await persistMatchedGeometry(matched);
          console.log('[DrivingMapMatch] forceMatch snapped to road:', matched.length, 'pts');
          return matched;
        }
        console.warn('[DrivingMapMatch] forceMatch: no match (code:', json.code, ')');
        logSnapReject('force_no_match', { code: json.code ?? 'unknown' });
        return (await tryDirectionsStub()) ?? null;
      } catch (e) {
        console.warn('[DrivingMapMatch] forceMatch error:', e);
        logSnapReject('force_api_error');
        if (genWhenStarted !== matchGenRef.current) return null;
        const stub = manual && shouldAttemptDirectionsStub(lat, lng, speedKmh, manual)
          ? await roadGeometryFromDirectionsStub(lat, lng, opts?.headingDeg)
          : null;
        if (stub && stub.length >= 2 && genWhenStarted === matchGenRef.current) {
          matchedPtsRef.current  = stub;
          matchedTimeRef.current = Date.now();
          console.log('[DrivingMapMatch] forceMatch error recovery stub', stub.length, 'pts');
          await persistMatchedGeometry(stub);
          return stub;
        }
        return null;
      } finally {
        isFetchingRef.current = false;
      }
    },
    [applyLocalRoadCache, consumeRequestSlot, getRequestUsageCount, logSnapReject, persistMatchedGeometry, shouldAttemptDirectionsStub],
  );

  /**
   * Returns the latest map-matched road segment, or null if unavailable /
   * expired.  Safe to call on every render / GPS update (cheap ref read).
   */
  const getMatchedPoints = useCallback(
    (): { latitude: number; longitude: number }[] | null => {
      if (!matchedPtsRef.current) return null;
      const ageMs = Date.now() - matchedTimeRef.current;
      if (ageMs > STALE_MAX_MS) {
        vroomGpsLog('GEOMETRY_DISCARDED', { ageMs });
        matchedPtsRef.current = null;
        return null;
      }
      if (ageMs > EXPIRE_MS) {
        vroomGpsLog('GEOMETRY_STALE', { ageMs });
      }
      return matchedPtsRef.current;
    },
    [],
  );

  /** Przy aktywnym driving map.tsx woła to po każdym poprawnym odczycie geometrii — segment nie „wygasa” w trakcie jazdy. */
  const bumpMatchedFreshness = useCallback((): void => {
    if (matchedPtsRef.current && matchedPtsRef.current.length >= 2) {
      matchedTimeRef.current = Date.now();
    }
  }, []);

  const reset = useCallback((): void => {
    matchGenRef.current += 1;
    bufferRef.current     = [];
    matchedPtsRef.current = null;
    lastCallRef.current   = 0;
    lastFetchRef.current  = null;
    lastRefreshForceRef.current = null;
    lastDirectionsStubRef.current = null;
    lastNetworkAnchorRef.current = null;
    jitterFilterRef.current.reset();
    requestTimesRef.current = [];
    directionsStubTimesRef.current = [];
    isFetchingRef.current = false;
    matchedTimeRef.current = 0;
    console.log('[DrivingMapMatch] reset');
  }, []);

  return { addPosition, getMatchedPoints, reset, forceMatch, bumpMatchedFreshness };
}
