import { useRef, useCallback } from 'react';
import { MAPBOX_TOKEN }        from '../constants/mapConfig';
import { haversineKm }         from '../scripts/navigationUtils';
import { fetchDirectionsViaProxy, fetchMatchingViaProxy } from '../scripts/mapboxProxyClient';

// ─────────────────────────────────────────────────────────────────────────────
// Mapbox Map Matching — DAP to Road
// Snaps driving position to the nearest road using Mapbox's matching API.
// Trace requests are throttled by MIN_INTERVAL_MS and MAX_REQUESTS_PER_WINDOW / h.
// ─────────────────────────────────────────────────────────────────────────────

const MAP_MATCH_URL   = 'https://api.mapbox.com/matching/v5/mapbox/driving';
/** Min. odstęp między requestami trace — driving: częstszy pierwszy segment drogi. */
const MIN_INTERVAL_MS = 3_400;
const BUFFER_SIZE     = 9;      // number of GPS points sent to API
const MATCH_RADIUS_M  = 50;     // max 50 m — limit Mapbox Map Matching
/** Musi być ≤ 50 (Mapbox); większe psuje API i forceMatch zwracał pusto = brak snap w driving. */
const FORCE_MATCH_RADIUS_M = 50;
/** Gdy brak świeżego ticku z map.tsx, segment wygasa — driving i tak bumpuje czas przy aktywnym GPS. */
const EXPIRE_MS       = 180_000;
const MIN_POINT_DIST_KM = 0.008; // ~8 m — szybciej zapełnia bufor przy wolnym ruchu
const MIN_BUFFER_POINTS = 2;     // API wymaga ≥2 punktów — pierwszy trace jak najwcześniej
const MIN_FETCH_MOVE_M  = 8;     // częstsze odświeżanie geometrii przy jeździe miejskiej
/** forceMatch (bez manual/refresh): nie spamuj identycznym anchorem. */
const FORCE_MATCH_MIN_INTERVAL_MS = 57_600;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
/** Limit zapytań / h (trace + force) — nie podbijać bez sensu kosztów Mapbox. */
const MAX_REQUESTS_PER_WINDOW = 29;
// Extra buffer only for manual forceMatch entry; keeps UX while preventing runaway costs.
const MAX_MANUAL_BURST_PER_WINDOW = 7;
// Tiny coordinate offset used to form a valid 2-point API call from a single position.
// 0.00005° ≈ 5 m — small enough to return the same road segment.
const FORCE_MATCH_OFFSET_DEG = 0.00005;
const REFRESH_FORCE_MIN_INTERVAL_MS = 9_600;
const REFRESH_FORCE_MIN_MOVE_M = 35;
const DIRECTIONS_STUB_MIN_INTERVAL_MS = 38_400;
const DIRECTIONS_STUB_MIN_MOVE_M = 140;
const DIRECTIONS_STUB_AGGR_INTERVAL_MS = 9_600;
const DIRECTIONS_STUB_AGGR_MOVE_M = 45;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Gdy matching zwróci NoSegment (GPS dalej od drogi niż 50 m), fallback przez krótkie legi Directions. */
const DIRECTIONS_STUB_OFFSET_DEG = 0.00032; // ~25–35 m zależnie od szerokości geogr.

async function roadGeometryFromDirectionsStub(
  lat: number,
  lng: number,
): Promise<{ latitude: number; longitude: number }[] | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const deltas: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [0.72, 0.72],
    [-0.72, 0.72],
  ];

  for (const [dy, dx] of deltas) {
    const lat2 = lat + DIRECTIONS_STUB_OFFSET_DEG * dy;
    const lng2 = lng + DIRECTIONS_STUB_OFFSET_DEG * dx;
    const directionsUrl =
      `https://api.mapbox.com/directions/v5/mapbox/driving/` +
      `${lng},${lat};${lng2},${lat2}` +
      `?alternatives=false&geometries=geojson&overview=full&steps=false&access_token=${MAPBOX_TOKEN}`;

    try {
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
      // try next direction
    }
  }

  return null;
}

export type ForceMatchOptions = {
  /** Ręczne wejście w driving: zawsze sieć, czeka na inny fetch, omija limit zapytań. */
  manual?: boolean;
  /** Okresowe odświeżenie osi drogi w driving — omija cache 72s, wlicza się w budżet zapytań. */
  refresh?: boolean;
};

export type AddMatchContext = {
  speedKmh?: number | null;
  accuracyM?: number | null;
  noRoad?: boolean;
};

interface GpsPoint {
  lat:  number;
  lng:  number;
  time: number;
}

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
  const lastRefreshForceRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const lastDirectionsStubRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const isFetchingRef  = useRef<boolean>(false);
  const matchedPtsRef  = useRef<{ latitude: number; longitude: number }[] | null>(null);
  const matchedTimeRef = useRef<number>(0);
  /** Inkrementowany przy reset() — odrzuca zapisy z fetchy anulowanych po wyjściu z driving. */
  const matchGenRef    = useRef(0);

  const consumeRequestSlot = useCallback((now: number, manual = false): boolean => {
    requestTimesRef.current = requestTimesRef.current.filter((ts) => now - ts < REQUEST_WINDOW_MS);
    const count = requestTimesRef.current.length;
    if (manual) {
      if (count >= MAX_REQUESTS_PER_WINDOW + MAX_MANUAL_BURST_PER_WINDOW) return false;
      if (count < MAX_REQUESTS_PER_WINDOW) requestTimesRef.current.push(now);
      return true;
    }
    if (count >= MAX_REQUESTS_PER_WINDOW) return false;
    requestTimesRef.current.push(now);
    return true;
  }, []);

  const shouldAttemptDirectionsStub = useCallback((
    lat: number,
    lng: number,
    aggressive: boolean,
  ): boolean => {
    const now = Date.now();
    const last = lastDirectionsStubRef.current;
    if (!last) {
      lastDirectionsStubRef.current = { at: now, lat, lng };
      return true;
    }
    const minGap = aggressive ? DIRECTIONS_STUB_AGGR_INTERVAL_MS : DIRECTIONS_STUB_MIN_INTERVAL_MS;
    const minMove = aggressive ? DIRECTIONS_STUB_AGGR_MOVE_M : DIRECTIONS_STUB_MIN_MOVE_M;
    const movedM = haversineKm(last.lat, last.lng, lat, lng) * 1000;
    if (now - last.at < minGap && movedM < minMove) return false;
    lastDirectionsStubRef.current = { at: now, lat, lng };
    return true;
  }, []);

  const addPosition = useCallback(async (
    lat: number,
    lng: number,
    ctx?: AddMatchContext,
  ): Promise<void> => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const now  = Date.now();

    // Skip duplicate / near-duplicate points
    const last = bufferRef.current[bufferRef.current.length - 1];
    if (last && haversineKm(last.lat, last.lng, lat, lng) < MIN_POINT_DIST_KM) return;

    bufferRef.current.push({ lat, lng, time: now });
    if (bufferRef.current.length > BUFFER_SIZE) {
      bufferRef.current = bufferRef.current.slice(-BUFFER_SIZE);
    }

    const speedKmh = Math.max(0, ctx?.speedKmh ?? 0);
    const noRoad = !!ctx?.noRoad;
    const acc = ctx?.accuracyM;
    const poorAcc = acc != null && Number.isFinite(acc) && acc > 35;

    let dynamicMinIntervalMs = MIN_INTERVAL_MS;
    let dynamicMinMoveM = MIN_FETCH_MOVE_M;
    if (noRoad) {
      dynamicMinIntervalMs = 3_000;
      dynamicMinMoveM = 3;
    } else if (speedKmh >= 55) {
      dynamicMinIntervalMs = 7_200;
      dynamicMinMoveM = 22;
    } else if (speedKmh >= 25) {
      dynamicMinIntervalMs = 6_100;
      dynamicMinMoveM = 14;
    } else {
      dynamicMinIntervalMs = 5_000;
      dynamicMinMoveM = 8;
    }
    if (poorAcc && !noRoad) {
      dynamicMinIntervalMs += 1_900;
      dynamicMinMoveM += 8;
    }
    if (matchedPtsRef.current && !noRoad && speedKmh < 16 && !poorAcc) {
      dynamicMinIntervalMs = Math.max(dynamicMinIntervalMs, 8_800);
      dynamicMinMoveM = Math.max(dynamicMinMoveM, 20);
    }

    if (now - lastCallRef.current < dynamicMinIntervalMs) return;
    if (isFetchingRef.current)                       return;
    if (bufferRef.current.length < MIN_BUFFER_POINTS) return;
    if (lastFetchRef.current) {
      const movedSinceLastFetchM = haversineKm(
        lastFetchRef.current.lat,
        lastFetchRef.current.lng,
        lat,
        lng,
      ) * 1000;
      if (movedSinceLastFetchM < dynamicMinMoveM) return;
    }
    if (!consumeRequestSlot(now)) return;

    lastCallRef.current   = now;
    lastFetchRef.current  = { lat, lng };
    isFetchingRef.current = true;
    const genWhenStarted = matchGenRef.current;

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
        // Proxy może zwrócić null (429, auth); driving bez geometrii = surowy GPS „po polu”.
        { allowFallback: true },
      );
      if (genWhenStarted !== matchGenRef.current) return;
      if (!json) {
        const stub = shouldAttemptDirectionsStub(lat, lng, false)
          ? await roadGeometryFromDirectionsStub(lat, lng)
          : null;
        if (stub && stub.length >= 2 && genWhenStarted === matchGenRef.current) {
          matchedPtsRef.current = stub;
          matchedTimeRef.current = Date.now();
          console.log('[DrivingMapMatch] Trace fallback directions stub', stub.length, 'pts');
        }
        return;
      }

      if (Array.isArray(json.matchings) && json.matchings[0]?.geometry?.coordinates?.length) {
        const matched = json.matchings[0].geometry.coordinates.map(
          ([lng, lat]) => ({ latitude: lat, longitude: lng }),
        );
        matchedPtsRef.current  = matched;
        matchedTimeRef.current = Date.now();
        console.log('[DrivingMapMatch] Matched', matched.length, 'points to road');
      } else {
        console.log('[DrivingMapMatch] No match found (code:', json.code, ')');
        const stub = shouldAttemptDirectionsStub(lat, lng, false)
          ? await roadGeometryFromDirectionsStub(lat, lng)
          : null;
        if (stub && stub.length >= 2 && genWhenStarted === matchGenRef.current) {
          matchedPtsRef.current = stub;
          matchedTimeRef.current = Date.now();
          console.log('[DrivingMapMatch] Trace fallback directions stub', stub.length, 'pts');
        }
      }
    } catch (e) {
      console.warn('[DrivingMapMatch] API error:', e);
    } finally {
      isFetchingRef.current = false;
    }
  }, [consumeRequestSlot, shouldAttemptDirectionsStub]);

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
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const manual = !!opts?.manual;

      const refresh = !!opts?.refresh;

      if (manual) {
        for (let i = 0; i < 50 && isFetchingRef.current; i++) {
          await sleep(60);
        }
      } else if (refresh) {
        for (let i = 0; i < 15 && isFetchingRef.current; i++) {
          await sleep(50);
        }
        if (isFetchingRef.current) return matchedPtsRef.current;
        const lr = lastRefreshForceRef.current;
        if (lr) {
          const movedM = haversineKm(lr.lat, lr.lng, lat, lng) * 1000;
          if (Date.now() - lr.at < REFRESH_FORCE_MIN_INTERVAL_MS && movedM < REFRESH_FORCE_MIN_MOVE_M) {
            return matchedPtsRef.current;
          }
        }
      } else if (isFetchingRef.current) {
        return null;
      }

      if (
        !manual &&
        !refresh &&
        matchedPtsRef.current &&
        Date.now() - matchedTimeRef.current < FORCE_MATCH_MIN_INTERVAL_MS
      ) {
        return matchedPtsRef.current;
      }

      const now = Date.now();
      if (!consumeRequestSlot(now, manual)) return matchedPtsRef.current;

      const genWhenStarted = matchGenRef.current;
      isFetchingRef.current = true;
      lastCallRef.current   = now;
      lastFetchRef.current  = { lat, lng };
      if (refresh) {
        lastRefreshForceRef.current = { at: now, lat, lng };
      }

      try {
        const coords = [
          `${lng - FORCE_MATCH_OFFSET_DEG},${lat}`,
          `${lng},${lat}`,
        ].join(';');
        const radii = `${FORCE_MATCH_RADIUS_M};${FORCE_MATCH_RADIUS_M}`;
        const url   = `${MAP_MATCH_URL}/${coords}?geometries=geojson&tidy=true&radiuses=${radii}&access_token=${MAPBOX_TOKEN}`;

        const tryDirectionsStub = async (): Promise<{ latitude: number; longitude: number }[] | null> => {
          const stub = shouldAttemptDirectionsStub(lat, lng, manual)
            ? await roadGeometryFromDirectionsStub(lat, lng)
            : null;
          if (genWhenStarted !== matchGenRef.current) return null;
          if (stub && stub.length >= 2) {
            matchedPtsRef.current  = stub;
            matchedTimeRef.current = Date.now();
            console.log('[DrivingMapMatch] forceMatch directions stub', stub.length, 'pts');
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
          { allowFallback: true },
        );
        if (genWhenStarted !== matchGenRef.current) return null;

        if (!json) {
          return (await tryDirectionsStub()) ?? matchedPtsRef.current;
        }

        if (Array.isArray(json.matchings) && json.matchings[0]?.geometry?.coordinates?.length) {
          const matched = json.matchings[0].geometry.coordinates.map(
            ([lng2, lat2]) => ({ latitude: lat2, longitude: lng2 }),
          );
          if (genWhenStarted !== matchGenRef.current) return null;
          matchedPtsRef.current  = matched;
          matchedTimeRef.current = Date.now();
          console.log('[DrivingMapMatch] forceMatch snapped to road:', matched.length, 'pts');
          return matched;
        }
        console.warn('[DrivingMapMatch] forceMatch: no match (code:', json.code, ')');
        return (await tryDirectionsStub()) ?? null;
      } catch (e) {
        console.warn('[DrivingMapMatch] forceMatch error:', e);
        if (genWhenStarted !== matchGenRef.current) return null;
        const stub = shouldAttemptDirectionsStub(lat, lng, manual)
          ? await roadGeometryFromDirectionsStub(lat, lng)
          : null;
        if (stub && stub.length >= 2 && genWhenStarted === matchGenRef.current) {
          matchedPtsRef.current  = stub;
          matchedTimeRef.current = Date.now();
          console.log('[DrivingMapMatch] forceMatch error recovery stub', stub.length, 'pts');
          return stub;
        }
        return null;
      } finally {
        isFetchingRef.current = false;
      }
    },
    [consumeRequestSlot, shouldAttemptDirectionsStub],
  );

  /**
   * Returns the latest map-matched road segment, or null if unavailable /
   * expired.  Safe to call on every render / GPS update (cheap ref read).
   */
  const getMatchedPoints = useCallback(
    (): { latitude: number; longitude: number }[] | null => {
      if (!matchedPtsRef.current) return null;
      if (Date.now() - matchedTimeRef.current > EXPIRE_MS) {
        matchedPtsRef.current = null;
        return null;
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
    requestTimesRef.current = [];
    isFetchingRef.current = false;
    matchedTimeRef.current = 0;
    console.log('[DrivingMapMatch] reset');
  }, []);

  return { addPosition, getMatchedPoints, reset, forceMatch, bumpMatchedFreshness };
}
