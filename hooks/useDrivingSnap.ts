import { useRef, useCallback } from 'react';
import { snapToRoute }         from '../scripts/navigationUtils';

// Prosty cache ostatnio pobranej trasy snap
// 100 m radius: GPS multipath in urban/residential areas can offset the
// reported position by 30–60 m, so 50 m was rejecting valid snaps.
const SNAP_RADIUS_M    = 100;
const MIN_MOVE_DEG     = 0.00005; // ~5m

export function useDrivingSnap() {
  const lastRawRef      = useRef<{ lat: number; lng: number } | null>(null);
  const lastSnappedRef  = useRef<{ latitude: number; longitude: number } | null>(null);
  const routePtsRef     = useRef<{ latitude: number; longitude: number }[]>([]);
  // DAP-to-Road: map-matched road segment (fallback when no route loaded)
  const roadMatchPtsRef = useRef<{ latitude: number; longitude: number }[]>([]);

  // Ustaw punkty trasy do snapowania (np. z previewRoute)
  const setRoutePoints = useCallback((pts: { latitude: number; longitude: number }[]) => {
    routePtsRef.current = pts;
  }, []);

  // Ustaw punkty z Map Matching API (DAP-to-Road — używane gdy brak załadowanej trasy)
  const setRoadMatchPoints = useCallback((pts: { latitude: number; longitude: number }[]) => {
    roadMatchPtsRef.current = pts;
  }, []);

  // Główna funkcja — zwraca snapped pozycję lub oryginalną
  const snap = useCallback((lat: number, lng: number, speedKmh: number, isNavigating: boolean): {
    latitude:  number;
    longitude: number;
    snapped:   boolean;
  } => {
    // Nawigacja ma własny snap — nie ingeruj
    if (isNavigating) return { latitude: lat, longitude: lng, snapped: false };

    // Wybierz źródło punktów: załadowana trasa ma pierwszeństwo, potem droga z Map Matching
    const pts = routePtsRef.current.length >= 2
      ? routePtsRef.current
      : roadMatchPtsRef.current;

    // Snap whenever we have road points — speed gate removed because loc.speed is
    // unreliable on many Android devices (can read 0 km/h even while moving).
    if (pts.length < 2) {
      return { latitude: lat, longitude: lng, snapped: false };
    }

    // Nie przeliczaj jeśli ruch < 5m
    const last = lastRawRef.current;
    if (last) {
      const dLat = Math.abs(lat - last.lat);
      const dLng = Math.abs(lng - last.lng);
      if (dLat < MIN_MOVE_DEG && dLng < MIN_MOVE_DEG && lastSnappedRef.current) {
        return { ...lastSnappedRef.current, snapped: true };
      }
    }

    lastRawRef.current = { lat, lng };

    const result = snapToRoute(lat, lng, pts, SNAP_RADIUS_M);
    const snapped = { latitude: result.latitude, longitude: result.longitude };
    lastSnappedRef.current = snapped;
    return { ...snapped, snapped: true };
  }, []);

  const reset = useCallback(() => {
    lastRawRef.current     = null;
    lastSnappedRef.current = null;
  }, []);

  return { snap, setRoutePoints, setRoadMatchPoints, reset };
}