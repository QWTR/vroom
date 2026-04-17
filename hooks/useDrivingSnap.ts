import { useRef, useCallback } from 'react';
import { snapToRoute }         from '../scripts/navigationUtils';

// Prosty cache ostatnio pobranej trasy snap
const SNAP_RADIUS_M    = 50;
const MIN_MOVE_DEG     = 0.00005; // ~5m

export function useDrivingSnap() {
  const lastRawRef    = useRef<{ lat: number; lng: number } | null>(null);
  const lastSnappedRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const routePtsRef   = useRef<{ latitude: number; longitude: number }[]>([]);

  // Ustaw punkty trasy do snapowania (np. z previewRoute)
  const setRoutePoints = useCallback((pts: { latitude: number; longitude: number }[]) => {
    routePtsRef.current = pts;
  }, []);

  // Główna funkcja — zwraca snapped pozycję lub oryginalną
  const snap = useCallback((lat: number, lng: number, speedKmh: number, isNavigating: boolean): {
    latitude:  number;
    longitude: number;
    snapped:   boolean;
  } => {
    // Snap tylko gdy jedzie i nie ma nawigacji (nawigacja ma własny snap)
    if (isNavigating || speedKmh <= 10 || routePtsRef.current.length < 2) {
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

    const result = snapToRoute(lat, lng, routePtsRef.current, SNAP_RADIUS_M);
    const snapped = { latitude: result.latitude, longitude: result.longitude };
    lastSnappedRef.current = snapped;
    return { ...snapped, snapped: true };
  }, []);

  const reset = useCallback(() => {
    lastRawRef.current    = null;
    lastSnappedRef.current = null;
  }, []);

  return { snap, setRoutePoints, reset };
}