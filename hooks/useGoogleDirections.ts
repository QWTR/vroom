import { useState, useEffect, useRef } from 'react';
import { LocationState } from '../constants/types';
import {
  fetchDirectionsViaProxyResult,
  type DirectionsProxyFailure,
  type DirectionsProxyResult,
} from '../scripts/mapboxProxyClient';
import { routeStartsWithUTurn } from '../lib/navigation/reroute';
import { requestOfflineNavigationRoute } from '../lib/offlineNavigation';

// ── Debug flag — set to true to log cache hits, misses, and in-flight dedup ──
// Flip to false (or guard with __DEV__) in production.
const DEBUG_NETWORK = __DEV__;

export interface Step {
  html_instructions: string;
  distance: { text: string; value: number };
  duration: { text: string; value: number };
  start_location: { lat: number; lng: number };
  end_location:   { lat: number; lng: number };
  /** maneuver.type (OSRM/Mapbox) */
  maneuver?: string;
  /** maneuver.modifier: left, slight left, sharp right, … */
  maneuverModifier?: string;
  /** maneuver.exit — numer zjazdu na rondzie */
  maneuverExit?: number;
  /** step.name — nazwa ulicy docelowej */
  streetName?: string;
  polyline: { points: string };
}

function combineManeuverIconKey(type?: string, modifier?: string): string {
  const t = String(type || '').toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
  const mod = String(modifier || '').toLowerCase().trim().replace(/\s+/g, '-');
  if (!mod) return t || 'navigation';
  if (t === 'turn') return `turn-${mod}`;
  if (t.includes('roundabout')) {
    if (mod.includes('left')) return 'roundabout-left';
    if (mod.includes('right')) return 'roundabout-right';
    return 'roundabout';
  }
  if (t === 'uturn') return mod.includes('left') ? 'uturn-left' : 'uturn-right';
  if (t === 'fork' || t === 'ramp' || t === 'merge') return `${t}-${mod}`;
  if (t === 'on-ramp' || t === 'off-ramp' || t === 'end-of-road' || t === 'new-name') {
    return mod ? `${t}-${mod}` : t;
  }
  return `${t}-${mod}`;
}

export { combineManeuverIconKey };

export interface DirectionsResult {
  points:        { latitude: number; longitude: number }[];
  steps:         Step[];
  distanceText:  string;
  distanceValue: number;
  durationText:  string;
  duration:      number;
  index:         number; // indeks trasy (0, 1, 2)
}

function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const poly: { latitude: number; longitude: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    poly.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return poly;
}

function formatDurationText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} godz. ${m} min`;
  if (m > 0) return `${m} min`;
  return `${Math.round(seconds)} sek.`;
}

function round4(n: number) { return Math.round(n * 10000) / 10000; }

// ── Module-level in-memory cache ─────────────────────────────────────────────
// Shared across all hook instances; cleared only on app restart.
// TTLs below control how long a cached result is considered fresh.
//   - SINGLE_ROUTE_TTL_MS  (10 min): nawigacja bez ponownego Directions przy tym samym O/D
//   - ALT_ROUTES_TTL_MS    (5 min): podgląd alternatyw przed startem
// Increase both values to reduce API calls further if stale routes are acceptable.
const SINGLE_ROUTE_TTL_MS = 600_000; // 10 min — ta sama trasa w nawigacji bez ponownego API
const ALT_ROUTES_TTL_MS   = 300_000; // 5 min — podgląd alternatyw przed startem

interface CacheEntry {
  result:    DirectionsResult | DirectionsResult[];
  fetchedAt: number;
}
const directionsCache = new Map<string, CacheEntry>();


export type DirectionsFetchOpts = {
  /** Reroute w trakcie jazdy — szerszy bearings, continue_straight. */
  isReroute?: boolean;
  headingRangeDeg?: number;
  headingQuantizeDeg?: number;
  continueStraight?: boolean;
  /** Prefer a forward-going alternative; accept a U-turn only as fallback. */
  preferForward?: boolean;
};

type DirectionsError = 'NO_ROUTE' | 'AUTH' | 'NETWORK' | 'SERVER' | 'INVALID_RESPONSE';

export function directionsErrorFromProxyFailure(reason: DirectionsProxyFailure): Exclude<DirectionsError, 'NO_ROUTE'> {
  if (reason === 'auth') return 'AUTH';
  if (reason === 'server') return 'SERVER';
  if (reason === 'invalid_response' || reason === 'http') return 'INVALID_RESPONSE';
  return 'NETWORK';
}

export function isTransientDirectionsFailure(reason: DirectionsProxyFailure): boolean {
  return reason === 'network' || reason === 'timeout' || reason === 'server';
}

async function requestDirections(
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<DirectionsProxyResult<any>> {
  let result = await fetchDirectionsViaProxyResult<any>(payload, { signal });
  if (!result.ok && isTransientDirectionsFailure(result.reason)) {
    result = await fetchDirectionsViaProxyResult<any>(payload, { signal });
  }
  return result;
}

function hasRoutes(payload: any): payload is { routes: any[] } {
  return Array.isArray(payload?.routes);
}

function makeCacheKey(
  oLat: number, oLng: number,
  dLat: number, dLng: number,
  hdgBucket: number | null,
  alternatives: boolean,
  headingRangeDeg: number,
  continueStraight: boolean,
): string {
  return `${oLat}:${oLng}:${dLat}:${dLng}:${hdgBucket ?? ''}:${alternatives}:r${headingRangeDeg}:cs${continueStraight ? 1 : 0}`;
}

function mergeRoutePointsFromSteps(
  steps: Step[],
): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  for (const step of steps) {
    const encoded = step.polyline?.points;
    if (!encoded) continue;
    const decoded = decodePolyline(encoded);
    if (!decoded.length) continue;
    if (points.length === 0) {
      points.push(...decoded);
    } else {
      points.push(...decoded.slice(1));
    }
  }
  return points;
}

function parseMapboxRoute(route: any, index: number, includeSteps = true): DirectionsResult {
  const leg = route?.legs?.[0];
  if (!leg) {
    return {
      points: [],
      steps: [],
      distanceText: '0 km',
      distanceValue: 0,
      durationText: '0 sek.',
      duration: 0,
      index,
    };
  }

  const rawSteps = includeSteps && Array.isArray(leg?.steps) ? leg.steps : [];
  const steps: Step[] = rawSteps.flatMap((step: any) => {
    const loc = step?.maneuver?.location;
    if (!Array.isArray(loc) || loc.length < 2) return [];
    const [sLng, sLat] = loc;
    if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) return [];

    const geometry = typeof step.geometry === 'string' ? step.geometry : '';
    const decodedGeom = geometry ? decodePolyline(geometry) : [];
    const lastPt = decodedGeom[decodedGeom.length - 1] ?? { latitude: sLat, longitude: sLng };

    const maneuverType = step.maneuver?.type;
    const maneuverModifier = step.maneuver?.modifier;
    const maneuverExit = step.maneuver?.exit != null
      ? Number(step.maneuver.exit)
      : undefined;
    const streetName = typeof step.name === 'string' && step.name.trim()
      ? step.name.trim()
      : undefined;

    return [{
      html_instructions: step.maneuver?.instruction ?? '',
      distance: {
        value: Math.round(Number(step.distance) || 0),
        text: `${((Number(step.distance) || 0) / 1000).toFixed(1)} km`,
      },
      duration: {
        value: Math.round(Number(step.duration) || 0),
        text: formatDurationText(Number(step.duration) || 0),
      },
      start_location: { lat: sLat, lng: sLng },
      end_location: { lat: lastPt.latitude, lng: lastPt.longitude },
      maneuver: combineManeuverIconKey(maneuverType, maneuverModifier),
      maneuverModifier: maneuverModifier || undefined,
      maneuverExit: Number.isFinite(maneuverExit) ? maneuverExit : undefined,
      streetName,
      polyline: { points: geometry },
    } as Step];
  });

  const points = steps.length > 0
    ? mergeRoutePointsFromSteps(steps)
    : decodePolyline(route.geometry ?? '');

  return {
    points,
    steps,
    distanceText:  `${(leg.distance / 1000).toFixed(1)} km`,
    distanceValue: Math.round(leg.distance),
    durationText:  formatDurationText(leg.duration),
    duration:      Math.round(leg.duration / 60),
    index,
  };
}

// ── Hook dla nawigacji (1 trasa + heading dla reroutingu) ─────────────────────
export function useGoogleDirections(
  origin:      LocationState | null,
  destination: LocationState | null,
  _apiKey?:    string,
  heading?:    number,
  fetchOpts?:  DirectionsFetchOpts,
) {
  const [route,   setRoute]   = useState<DirectionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const originLat = origin      ? round4(origin.latitude)      : null;
  const originLng = origin      ? round4(origin.longitude)     : null;
  const destLat   = destination ? round4(destination.latitude) : null;
  const destLng   = destination ? round4(destination.longitude): null;

  const isReroute = !!fetchOpts?.isReroute;
  const headingRangeDeg = fetchOpts?.headingRangeDeg ?? (isReroute ? 60 : 45);
  const headingQuantizeDeg = fetchOpts?.headingQuantizeDeg ?? (isReroute ? 12 : 45);
  const continueStraight = fetchOpts?.continueStraight !== false;
  const preferForward = !!fetchOpts?.preferForward;

  const roundedHeading = heading != null && Number.isFinite(heading)
    ? (Math.round((((heading % 360) + 360) % 360) / headingQuantizeDeg) * headingQuantizeDeg) % 360
    : null;

  useEffect(() => {
    if (originLat == null || originLng == null || destLat == null || destLng == null) {
      setRoute(null);
      setLoading(false);
      setError(null);
      return;
    }

    const cacheKey = makeCacheKey(
      originLat,
      originLng,
      destLat,
      destLng,
      roundedHeading,
      false,
      headingRangeDeg,
      continueStraight,
    ) + `:pf${preferForward ? 1 : 0}`;

    // ── Cache hit: serve immediately without a network call ──────────────────
    const cached = directionsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < SINGLE_ROUTE_TTL_MS) {
      if (DEBUG_NETWORK) console.log('[useGoogleDirections] cache hit', cacheKey);
      setRoute(cached.result as DirectionsResult);
      setLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    if (DEBUG_NETWORK) console.log('[useGoogleDirections] fetching', cacheKey);

    (async () => {
      try {
        const requestAlternatives = isReroute && preferForward;
        let response = await requestDirections(
          {
            coordinates: [
              [originLng, originLat],
              [destLng, destLat],
            ],
            profile: 'driving',
            alternatives: requestAlternatives,
            geometries: 'polyline',
            steps: true,
            language: 'pl',
            continue_straight: continueStraight,
            bearings: roundedHeading != null
              ? [`${roundedHeading},${headingRangeDeg}`, '']
              : undefined,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          const offlineRoute = isTransientDirectionsFailure(response.reason)
            ? await requestOfflineNavigationRoute({
                origin: { latitude: originLat, longitude: originLng },
                destination: { latitude: destLat, longitude: destLng },
                headingDeg: roundedHeading,
              })
            : null;
          if (controller.signal.aborted) return;
          if (offlineRoute) {
            const result: DirectionsResult = { ...offlineRoute, index: 0 };
            directionsCache.set(cacheKey, { result, fetchedAt: Date.now() });
            setRoute(result);
            setError(null);
            return;
          }
          setError(directionsErrorFromProxyFailure(response.reason));
          setRoute(null);
          return;
        }
        let data = response.data;

        // A strict bearing may yield no route on unusual junction geometry.
        // Retry once without it, still evaluating all alternatives before a U-turn.
        if (hasRoutes(data) && !data.routes.length && preferForward && roundedHeading != null) {
          response = await requestDirections(
            {
              coordinates: [[originLng, originLat], [destLng, destLat]],
              profile: 'driving',
              alternatives: true,
              geometries: 'polyline',
              steps: true,
              language: 'pl',
              continue_straight: continueStraight,
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (!response.ok) {
            setError(directionsErrorFromProxyFailure(response.reason));
            setRoute(null);
            return;
          }
          data = response.data;
        }

        if (!hasRoutes(data)) {
          setError('INVALID_RESPONSE');
          setRoute(null);
          return;
        }
        if (!data.routes.length) {
          setError('NO_ROUTE');
          setRoute(null);
          return;
        }

        const selectedRawRoute = preferForward
          ? (data.routes.find((candidate: any) => !routeStartsWithUTurn(candidate)) ?? data.routes[0])
          : data.routes[0];
        const result = parseMapboxRoute(selectedRawRoute, 0);
        directionsCache.set(cacheKey, { result, fetchedAt: Date.now() });
        setRoute(result);
      } catch (e: any) {
        if (e.name !== 'AbortError') setError('FETCH_ERROR');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [originLat, originLng, destLat, destLng, roundedHeading, headingRangeDeg, continueStraight, isReroute, preferForward]);

  return { route, loading, error };
}

// ── Hook dla alternatywnych tras (wybór przed startem) ────────────────────────
export function useGoogleDirectionsAlternatives(
  origin:      LocationState | null,
  destination: LocationState | null,
  _apiKey?:    string,
) {
  const [routes,  setRoutes]  = useState<DirectionsResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const originLat = origin      ? round4(origin.latitude)      : null;
  const originLng = origin      ? round4(origin.longitude)     : null;
  const destLat   = destination ? round4(destination.latitude) : null;
  const destLng   = destination ? round4(destination.longitude): null;

  useEffect(() => {
    if (originLat == null || originLng == null || destLat == null || destLng == null) {
      setRoutes([]);
      setLoading(false);
      setError(null);
      return;
    }

    const cacheKey = makeCacheKey(originLat, originLng, destLat, destLng, null, true, 45, true);

    // ── Cache hit ─────────────────────────────────────────────────────────────
    const cached = directionsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < ALT_ROUTES_TTL_MS) {
      if (DEBUG_NETWORK) console.log('[useGoogleDirectionsAlternatives] cache hit', cacheKey);
      setRoutes(cached.result as DirectionsResult[]);
      setLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    if (DEBUG_NETWORK) console.log('[useGoogleDirectionsAlternatives] fetching', cacheKey);

    (async () => {
      try {
        const response = await requestDirections(
          {
            coordinates: [
              [originLng, originLat],
              [destLng, destLat],
            ],
            profile: 'driving',
            alternatives: true,
            geometries: 'polyline',
            steps: true,
            language: 'pl',
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          const offlineRoute = isTransientDirectionsFailure(response.reason)
            ? await requestOfflineNavigationRoute({
                origin: { latitude: originLat, longitude: originLng },
                destination: { latitude: destLat, longitude: destLng },
              })
            : null;
          if (controller.signal.aborted) return;
          if (offlineRoute) {
            const result: DirectionsResult = { ...offlineRoute, index: 0 };
            directionsCache.set(cacheKey, { result: [result], fetchedAt: Date.now() });
            setRoutes([result]);
            setError(null);
            return;
          }
          setError(directionsErrorFromProxyFailure(response.reason));
          setRoutes([]);
          return;
        }
        const data = response.data;

        if (!hasRoutes(data)) {
          setError('INVALID_RESPONSE');
          setRoutes([]);
          return;
        }
        if (!data.routes.length) {
          setError('NO_ROUTE');
          setRoutes([]);
          return;
        }

        const parsed = data.routes
          .slice(0, 3)
          .map((r: any, i: number) => parseMapboxRoute(r, i))
          .sort((a: DirectionsResult, b: DirectionsResult) => a.duration - b.duration);

        directionsCache.set(cacheKey, { result: parsed, fetchedAt: Date.now() });
        setRoutes(parsed);
      } catch (e: any) {
        if (e.name !== 'AbortError') setError('FETCH_ERROR');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [originLat, originLng, destLat, destLng]);

  return { routes, loading, error };
}
