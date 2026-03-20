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

// Zaokrąglenie do 4 miejsc dziesiętnych (~11m dokładność)
// Dzięki temu hook NIE przeładowuje się przy każdym małym ruchu GPS
function round4(n: number) { return Math.round(n * 10000) / 10000; }

export function useGoogleDirections(
  origin:      LocationState | null,
  destination: LocationState | null,
  apiKey:      string = GOOGLE_MAPS_APIKEY,
) {
  const [route,   setRoute]   = useState<DirectionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // Zaokrąglone koordynaty żeby nie triggerować co metr
  const originLat = origin  ? round4(origin.latitude)       : null;
  const originLng = origin  ? round4(origin.longitude)      : null;
  const destLat   = destination ? round4(destination.latitude)  : null;
  const destLng   = destination ? round4(destination.longitude) : null;

  useEffect(() => {
    if (originLat == null || originLng == null || destLat == null || destLng == null) {
      setRoute(null);
      return;
    }

    abortRef.current?.abort();
    const controller  = new AbortController();
    abortRef.current  = controller;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url =
          `https://maps.googleapis.com/maps/api/directions/json?` +
          `origin=${originLat},${originLng}` +
          `&destination=${destLat},${destLng}` +
          `&key=${apiKey}&language=pl&mode=driving&alternatives=false`;

        const res  = await fetch(url, { signal: controller.signal });
        const data = await res.json();

        if (data.status !== 'OK' || !data.routes?.length) {
          setError(data.status ?? 'NO_ROUTE');
          setRoute(null);
          return;
        }

        const leg    = data.routes[0].legs[0];
        const points = leg.steps.flatMap((step: any) =>
          decodePolyline(step.polyline.points)
        );

        setRoute({
          points,
          steps:         leg.steps as Step[],
          distanceText:  leg.distance.text,
          distanceValue: leg.distance.value,
          durationText:  leg.duration.text,
          duration:      Math.round(leg.duration.value / 60),
        });
      } catch (e: any) {
        if (e.name !== 'AbortError') setError('FETCH_ERROR');
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [originLat, originLng, destLat, destLng]);  // ← zaokrąglone → rzadkie zmiany

  return { route, loading, error };
}