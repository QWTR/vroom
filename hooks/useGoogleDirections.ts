import { useState, useEffect, useRef } from 'react';
import { LocationState } from '../constants/types';
import { MAPBOX_TOKEN } from '../constants/mapConfig';

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

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const bearingParam = roundedHeading != null ? `&bearings=${roundedHeading},45;` : '';

        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/` +
          `${originLng},${originLat};${destLng},${destLat}` +
          `?alternatives=false&geometries=polyline&steps=true&language=pl` +
          bearingParam +
          `&access_token=${MAPBOX_TOKEN}`;

        const res  = await fetch(url, { signal: controller.signal });
        const data = await res.json();

        if (!data.routes?.length) {
          setError('NO_ROUTE');
          setRoute(null);
          return;
        }

        setRoute(parseMapboxRoute(data.routes[0], 0));
      } catch (e: any) {
        if (e.name !== 'AbortError') setError('FETCH_ERROR');
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
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

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/` +
          `${originLng},${originLat};${destLng},${destLat}` +
          `?alternatives=true&geometries=polyline&steps=true&language=pl` +
          `&access_token=${MAPBOX_TOKEN}`;

        const res  = await fetch(url, { signal: controller.signal });
        const data = await res.json();

        if (!data.routes?.length) {
          setError('NO_ROUTE');
          setRoutes([]);
          return;
        }

        const parsed = data.routes
          .slice(0, 3)
          .map((r: any, i: number) => parseMapboxRoute(r, i))
          .sort((a: DirectionsResult, b: DirectionsResult) => a.duration - b.duration);

        setRoutes(parsed);
      } catch (e: any) {
        if (e.name !== 'AbortError') setError('FETCH_ERROR');
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [originLat, originLng, destLat, destLng]);

  return { routes, loading, error };
}