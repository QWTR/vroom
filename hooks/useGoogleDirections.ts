import { useState, useEffect, useRef } from 'react';
import { LocationState } from '../constants/types';
import { MAPBOX_TOKEN } from '../constants/mapConfig';
import { fetchDirectionsViaProxy } from '../scripts/mapboxProxyClient';

// ── Debug flag — set to true to log cache hits, misses, and in-flight dedup ──
// Flip to false (or guard with __DEV__) in production.
const DEBUG_NETWORK = false;

export interface Step {
  html_instructions: string;
  distance: { text: string; value: number };
  duration: { text: string; value: number };
  start_location: { lat: number; lng: number };
  end_location:   { lat: number; lng: number };
  maneuver?: string;
  polyline: { points: string };
}

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
//   - SINGLE_ROUTE_TTL_MS  (30 s): keeps navigation + reroute results fresh enough for a drive
//   - ALT_ROUTES_TTL_MS    (60 s): alternatives panel rarely needs sub-minute freshness
// Increase both values to reduce API calls further if stale routes are acceptable.
const SINGLE_ROUTE_TTL_MS = 90_000;
const ALT_ROUTES_TTL_MS   = 180_000;

interface CacheEntry {
  result:    DirectionsResult | DirectionsResult[];
  fetchedAt: number;
}
const directionsCache = new Map<string, CacheEntry>();

// In-flight deduplication: if a fetch for a given key is already running,
// skip launching another one for the same hook instance.
// JavaScript is single-threaded, so there are no true race conditions here;
// this guards against the same async IIFE being started twice within one
// event loop tick (e.g., rapid dep changes triggering consecutive effects).
const inflightKeys = new Set<string>();

function makeCacheKey(
  oLat: number, oLng: number,
  dLat: number, dLng: number,
  hdgBucket: number | null,
  alternatives: boolean,
): string {
  return `${oLat}:${oLng}:${dLat}:${dLng}:${hdgBucket ?? ''}:${alternatives}`;
}

function parseMapboxRoute(route: any, index: number): DirectionsResult {
  const leg = route.legs[0];

  const steps: Step[] = leg.steps.map((step: any) => {
    const [sLng, sLat] = step.maneuver.location;
    const decodedGeom  = decodePolyline(step.geometry);
    const lastPt       = decodedGeom[decodedGeom.length - 1] ?? { latitude: sLat, longitude: sLng };

    return {
      html_instructions: step.maneuver.instruction ?? '',
      distance: {
        value: Math.round(step.distance),
        text:  `${(step.distance / 1000).toFixed(1)} km`,
      },
      duration: {
        value: Math.round(step.duration),
        text:  formatDurationText(step.duration),
      },
      start_location: { lat: sLat, lng: sLng },
      end_location:   { lat: lastPt.latitude, lng: lastPt.longitude },
      maneuver: step.maneuver.type,
      polyline: { points: step.geometry },
    } as Step;
  });

  const points = steps.flatMap(s => decodePolyline(s.polyline.points));

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
) {
  const [route,   setRoute]   = useState<DirectionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const originLat = origin      ? round4(origin.latitude)      : null;
  const originLng = origin      ? round4(origin.longitude)     : null;
  const destLat   = destination ? round4(destination.latitude) : null;
  const destLng   = destination ? round4(destination.longitude): null;

  const roundedHeading = heading != null ? Math.round(heading / 10) * 10 : null;

  useEffect(() => {
    if (originLat == null || originLng == null || destLat == null || destLng == null) {
      setRoute(null);
      return;
    }

    const cacheKey = makeCacheKey(originLat, originLng, destLat, destLng, roundedHeading, false);

    // ── Cache hit: serve immediately without a network call ──────────────────
    const cached = directionsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < SINGLE_ROUTE_TTL_MS) {
      if (DEBUG_NETWORK) console.log('[useGoogleDirections] cache hit', cacheKey);
      setRoute(cached.result as DirectionsResult);
      return;
    }

    // ── In-flight dedup: same key already fetching, skip ────────────────────
    if (inflightKeys.has(cacheKey)) {
      if (DEBUG_NETWORK) console.log('[useGoogleDirections] in-flight dedup, skipping', cacheKey);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    inflightKeys.add(cacheKey);
    setLoading(true);
    setError(null);

    if (DEBUG_NETWORK) console.log('[useGoogleDirections] fetching', cacheKey);

    (async () => {
      try {
        const bearingParam = roundedHeading != null ? `&bearings=${roundedHeading},45;` : '';

        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/` +
          `${originLng},${originLat};${destLng},${destLat}` +
          `?alternatives=false&geometries=polyline&steps=true&language=pl` +
          bearingParam +
          `&access_token=${MAPBOX_TOKEN}`;

        const data = await fetchDirectionsViaProxy<any>(
          {
            coordinates: [
              [originLng, originLat],
              [destLng, destLat],
            ],
            profile: 'driving',
            alternatives: false,
            geometries: 'polyline',
            steps: true,
            language: 'pl',
            bearings: roundedHeading != null ? [`${roundedHeading},45`, ''] : undefined,
          },
          url,
        );

        if (!data.routes?.length) {
          setError('NO_ROUTE');
          setRoute(null);
          return;
        }

        const result = parseMapboxRoute(data.routes[0], 0);
        directionsCache.set(cacheKey, { result, fetchedAt: Date.now() });
        setRoute(result);
      } catch (e: any) {
        if (e.name !== 'AbortError') setError('FETCH_ERROR');
      } finally {
        setLoading(false);
        inflightKeys.delete(cacheKey);
      }
    })();

    return () => {
      controller.abort();
      inflightKeys.delete(cacheKey);
    };
  }, [originLat, originLng, destLat, destLng, roundedHeading]);

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
      return;
    }

    const cacheKey = makeCacheKey(originLat, originLng, destLat, destLng, null, true);

    // ── Cache hit ─────────────────────────────────────────────────────────────
    const cached = directionsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < ALT_ROUTES_TTL_MS) {
      if (DEBUG_NETWORK) console.log('[useGoogleDirectionsAlternatives] cache hit', cacheKey);
      setRoutes(cached.result as DirectionsResult[]);
      return;
    }

    // ── In-flight dedup ───────────────────────────────────────────────────────
    if (inflightKeys.has(cacheKey)) {
      if (DEBUG_NETWORK) console.log('[useGoogleDirectionsAlternatives] in-flight dedup, skipping', cacheKey);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    inflightKeys.add(cacheKey);
    setLoading(true);
    setError(null);

    if (DEBUG_NETWORK) console.log('[useGoogleDirectionsAlternatives] fetching', cacheKey);

    (async () => {
      try {
        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/` +
          `${originLng},${originLat};${destLng},${destLat}` +
          `?alternatives=true&geometries=polyline&steps=true&language=pl` +
          `&access_token=${MAPBOX_TOKEN}`;

        const data = await fetchDirectionsViaProxy<any>(
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
          url,
        );

        if (!data.routes?.length) {
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
        setLoading(false);
        inflightKeys.delete(cacheKey);
      }
    })();

    return () => {
      controller.abort();
      inflightKeys.delete(cacheKey);
    };
  }, [originLat, originLng, destLat, destLng]);

  return { routes, loading, error };
}