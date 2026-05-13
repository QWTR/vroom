import { useRef, useCallback } from 'react';
import { MAPBOX_TOKEN }        from '../constants/mapConfig';
import { haversineKm }         from '../scripts/navigationUtils';
import { fetchMatchingViaProxy } from '../scripts/mapboxProxyClient';

// ─────────────────────────────────────────────────────────────────────────────
// Mapbox Map Matching — DAP to Road
// Snaps driving position to the nearest road using Mapbox's matching API.
// Called at most every MIN_INTERVAL_MS to avoid rate-limiting.
// ─────────────────────────────────────────────────────────────────────────────

const MAP_MATCH_URL   = 'https://api.mapbox.com/matching/v5/mapbox/driving';
const MIN_INTERVAL_MS = 8_000; // częstsze odświeżanie geometrii dla płynnego driving mode
const BUFFER_SIZE     = 8;      // number of GPS points sent to API
const MATCH_RADIUS_M  = 50;     // snap radius (m) — how far GPS may deviate from road
// forceMatch — szerszy promień przy ręcznym wejściu w driving (GPS bywa 80–120 m od osi drogi)
const FORCE_MATCH_RADIUS_M = 145;
const EXPIRE_MS       = 30_000; // discard cached segment after 30 s
const MIN_POINT_DIST_KM = 0.015; // ~15 m — drop GPS jitter before buffering
const MIN_BUFFER_POINTS = 4;     // avoid map matching calls from tiny segments
const MIN_FETCH_MOVE_M  = 20;    // szybsze odświeżanie po krótszym ruchu
const FORCE_MATCH_MIN_INTERVAL_MS = 120_000; // avoid repeated paid entry snaps
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 24;
// Tiny coordinate offset used to form a valid 2-point API call from a single position.
// 0.00005° ≈ 5 m — small enough to return the same road segment.
const FORCE_MATCH_OFFSET_DEG = 0.00005;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type ForceMatchOptions = {
  /** Ręczne wejście w driving: zawsze sieć, czeka na inny fetch, omija limit zapytań. */
  manual?: boolean;
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
  const isFetchingRef  = useRef<boolean>(false);
  const matchedPtsRef  = useRef<{ latitude: number; longitude: number }[] | null>(null);
  const matchedTimeRef = useRef<number>(0);
  /** Inkrementowany przy reset() — odrzuca zapisy z fetchy anulowanych po wyjściu z driving. */
  const matchGenRef    = useRef(0);

  const addPosition = useCallback(async (lat: number, lng: number): Promise<void> => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const now  = Date.now();

    // Skip duplicate / near-duplicate points
    const last = bufferRef.current[bufferRef.current.length - 1];
    if (last && haversineKm(last.lat, last.lng, lat, lng) < MIN_POINT_DIST_KM) return;

    bufferRef.current.push({ lat, lng, time: now });
    if (bufferRef.current.length > BUFFER_SIZE) {
      bufferRef.current = bufferRef.current.slice(-BUFFER_SIZE);
    }

    if (now - lastCallRef.current < MIN_INTERVAL_MS) return;
    if (isFetchingRef.current)                       return;
    if (bufferRef.current.length < MIN_BUFFER_POINTS) return;
    if (lastFetchRef.current) {
      const movedSinceLastFetchM = haversineKm(
        lastFetchRef.current.lat,
        lastFetchRef.current.lng,
        lat,
        lng,
      ) * 1000;
      if (movedSinceLastFetchM < MIN_FETCH_MOVE_M) return;
    }
    requestTimesRef.current = requestTimesRef.current.filter((ts) => now - ts < REQUEST_WINDOW_MS);
    if (requestTimesRef.current.length >= MAX_REQUESTS_PER_WINDOW) return;
    requestTimesRef.current.push(now);

    lastCallRef.current   = now;
    lastFetchRef.current  = { lat, lng };
    isFetchingRef.current = true;
    const genWhenStarted = matchGenRef.current;

    try {
      const pts     = bufferRef.current;
      const coords  = pts.map(p => `${p.lng},${p.lat}`).join(';');
      const radii   = pts.map(() => String(MATCH_RADIUS_M)).join(';');
      const url     = `${MAP_MATCH_URL}/${coords}?geometries=geojson&radiuses=${radii}&access_token=${MAPBOX_TOKEN}`;

      const json = await fetchMatchingViaProxy<MapMatchResponse>(
        {
          points: pts.map((p) => ({ lat: p.lat, lng: p.lng })),
          profile: 'driving',
          radiuses: pts.map(() => MATCH_RADIUS_M),
        },
        url,
        { allowFallback: false },
      );
      if (genWhenStarted !== matchGenRef.current) return;
      if (!json) return;

      if (Array.isArray(json.matchings) && json.matchings[0]?.geometry?.coordinates?.length) {
        const matched = json.matchings[0].geometry.coordinates.map(
          ([lng, lat]) => ({ latitude: lat, longitude: lng }),
        );
        matchedPtsRef.current  = matched;
        matchedTimeRef.current = Date.now();
        console.log('[DrivingMapMatch] Matched', matched.length, 'points to road');
      } else {
        console.log('[DrivingMapMatch] No match found (code:', json.code, ')');
      }
    } catch (e) {
      console.warn('[DrivingMapMatch] API error:', e);
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

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

      if (manual) {
        for (let i = 0; i < 50 && isFetchingRef.current; i++) {
          await sleep(60);
        }
      } else if (isFetchingRef.current) {
        return null;
      }

      if (
        !manual &&
        matchedPtsRef.current &&
        Date.now() - matchedTimeRef.current < FORCE_MATCH_MIN_INTERVAL_MS
      ) {
        return matchedPtsRef.current;
      }

      const now = Date.now();
      if (!manual) {
        requestTimesRef.current = requestTimesRef.current.filter((ts) => now - ts < REQUEST_WINDOW_MS);
        if (requestTimesRef.current.length >= MAX_REQUESTS_PER_WINDOW) return matchedPtsRef.current;
        requestTimesRef.current.push(now);
      } else {
        requestTimesRef.current = requestTimesRef.current.filter((ts) => now - ts < REQUEST_WINDOW_MS);
        if (requestTimesRef.current.length < MAX_REQUESTS_PER_WINDOW) {
          requestTimesRef.current.push(now);
        }
      }

      const genWhenStarted = matchGenRef.current;
      isFetchingRef.current = true;
      lastCallRef.current   = now;
      lastFetchRef.current  = { lat, lng };

      try {
        const coords = [
          `${lng - FORCE_MATCH_OFFSET_DEG},${lat}`,
          `${lng},${lat}`,
        ].join(';');
        const radii = `${FORCE_MATCH_RADIUS_M};${FORCE_MATCH_RADIUS_M}`;
        const url   = `${MAP_MATCH_URL}/${coords}?geometries=geojson&radiuses=${radii}&access_token=${MAPBOX_TOKEN}`;

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
        if (!json) return matchedPtsRef.current;

        if (Array.isArray(json.matchings) && json.matchings[0]?.geometry?.coordinates?.length) {
          const matched = json.matchings[0].geometry.coordinates.map(
            ([lng2, lat2]) => ({ latitude: lat2, longitude: lng2 }),
          );
          if (genWhenStarted !== matchGenRef.current) return null;
          matchedPtsRef.current  = matched;
          matchedTimeRef.current = Date.now();
          console.log('[DrivingMapMatch] forceMatch snapped to road:', matched.length, 'pts');
          return matched;
        } else {
          console.warn('[DrivingMapMatch] forceMatch: no match (code:', json.code, ')');
          return null;
        }
      } catch (e) {
        console.warn('[DrivingMapMatch] forceMatch error:', e);
        return null;
      } finally {
        isFetchingRef.current = false;
      }
    },
    [],
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

  const reset = useCallback((): void => {
    matchGenRef.current += 1;
    bufferRef.current     = [];
    matchedPtsRef.current = null;
    lastCallRef.current   = 0;
    lastFetchRef.current  = null;
    requestTimesRef.current = [];
    isFetchingRef.current = false;
    matchedTimeRef.current = 0;
    console.log('[DrivingMapMatch] reset');
  }, []);

  return { addPosition, getMatchedPoints, reset, forceMatch };
}
