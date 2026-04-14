import { useState, useEffect, useRef } from 'react';
import { LocationState } from '../constants/types';
import { GOOGLE_MAPS_APIKEY } from '../constants/mapConfig';

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

function round4(n: number) { return Math.round(n * 10000) / 10000; }

function parseRoute(r: any, index: number): DirectionsResult {
  const leg    = r.legs[0];
  const points = leg.steps.flatMap((step: any) =>
    decodePolyline(step.polyline.points)
  );
  return {
    points,
    steps:         leg.steps as Step[],
    distanceText:  leg.distance.text,
    distanceValue: leg.distance.value,
    durationText:  leg.duration.text,
    duration:      Math.round(leg.duration.value / 60),
    index,
  };
}

// ── Hook dla nawigacji (1 trasa + heading dla reroutingu) ─────────────────────
export function useGoogleDirections(
  origin:      LocationState | null,
  destination: LocationState | null,
  apiKey:      string = GOOGLE_MAPS_APIKEY,
  heading?:    number, // kierunek jazdy przy reroutingu
) {
  const [route,   setRoute]   = useState<DirectionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const originLat = origin      ? round4(origin.latitude)      : null;
  const originLng = origin      ? round4(origin.longitude)     : null;
  const destLat   = destination ? round4(destination.latitude) : null;
  const destLng   = destination ? round4(destination.longitude): null;

  // Zaokrąglij heading do 10° żeby nie triggerować za często
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
        // heading przekazany → Google wie w którą stronę jedziesz
        const headingParam = roundedHeading != null
          ? `&heading=${roundedHeading}&heading_penalty=20`
          : '';

        const url =
          `https://maps.googleapis.com/maps/api/directions/json?` +
          `origin=${originLat},${originLng}` +
          `&destination=${destLat},${destLng}` +
          `&key=${apiKey}&language=pl&mode=driving&alternatives=false` +
          headingParam;

        const res  = await fetch(url, { signal: controller.signal });
        const data = await res.json();

        if (data.status !== 'OK' || !data.routes?.length) {
          setError(data.status ?? 'NO_ROUTE');
          setRoute(null);
          return;
        }

        setRoute(parseRoute(data.routes[0], 0));
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
  apiKey:      string = GOOGLE_MAPS_APIKEY,
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
          `https://maps.googleapis.com/maps/api/directions/json?` +
          `origin=${originLat},${originLng}` +
          `&destination=${destLat},${destLng}` +
          `&key=${apiKey}&language=pl&mode=driving&alternatives=true`;

        const res  = await fetch(url, { signal: controller.signal });
        const data = await res.json();

        if (data.status !== 'OK' || !data.routes?.length) {
          setError(data.status ?? 'NO_ROUTE');
          setRoutes([]);
          return;
        }

        // Maksymalnie 3 trasy, posortowane po czasie
        const parsed = data.routes
          .slice(0, 3)
          .map((r: any, i: number) => parseRoute(r, i))
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