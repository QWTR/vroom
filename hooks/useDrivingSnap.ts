import { useRef, useCallback } from 'react';
import { snapToRoute }         from '../scripts/navigationUtils';

// Promień zwiększamy, bo przy 100km/h dryf GPS jest większy
const SNAP_RADIUS_M_BASE = 45; 
const SNAP_RADIUS_M_FAST = 80; // Większy margines przy szybkiej jeździe
const MIN_MOVE_DEG       = 0.00003; // ~3m (zmniejszamy, żeby częściej odświeżał na zakrętach)

export function useDrivingSnap() {
  const lastRawRef      = useRef<{ lat: number; lng: number } | null>(null);
  const lastSnappedRef  = useRef<{ latitude: number; longitude: number } | null>(null);
  const routePtsRef     = useRef<{ latitude: number; longitude: number }[]>([]);
  const roadMatchPtsRef = useRef<{ latitude: number; longitude: number }[]>([]);

  const setRoutePoints = useCallback((pts: { latitude: number; longitude: number }[]) => {
    routePtsRef.current = pts;
  }, []);

  const setRoadMatchPoints = useCallback((pts: { latitude: number; longitude: number }[]) => {
    // Map Matching daje nam realną geometrię drogi
    roadMatchPtsRef.current = pts;
  }, []);

  const snap = useCallback((lat: number, lng: number, speedKmh: number, isNavigating: boolean): {
    latitude:  number;
    longitude: number;
    snapped:   boolean;
  } => {
    if (isNavigating) return { latitude: lat, longitude: lng, snapped: false };

    // Wybieramy punkty. Priorytet ma roadMatchPtsRef, bo to jest aktualna GEOMETRIA drogi, 
    // po której jedziesz, a nie tylko linia prosta do celu.
    const pts = roadMatchPtsRef.current.length >= 2
      ? roadMatchPtsRef.current
      : routePtsRef.current;

    if (speedKmh <= 5 || pts.length < 2) {
      return { latitude: lat, longitude: lng, snapped: false };
    }

    const last = lastRawRef.current;
    if (last) {
      const dLat = Math.abs(lat - last.lat);
      const dLng = Math.abs(lng - last.lng);
      // Na zakrętach (duża prędkość) nie możemy ignorować małych ruchów
      if (dLat < MIN_MOVE_DEG && dLng < MIN_MOVE_DEG && lastSnappedRef.current && speedKmh < 60) {
        return { ...lastSnappedRef.current, snapped: true };
      }
    }

    lastRawRef.current = { lat, lng };

    // Dynamiczny promień - im szybciej jedziesz, tym bardziej ufamy drodze niż GPS
    const dynamicRadius = speedKmh > 70 ? SNAP_RADIUS_M_FAST : SNAP_RADIUS_M_BASE;

    const result = snapToRoute(lat, lng, pts, dynamicRadius);
    
    // Jeśli snapToRoute zwróci te same koordynaty (brak drogi w pobliżu), 
    // to nie uznajemy tego za udany snap
    const isActuallySnapped = result.latitude !== lat || result.longitude !== lng;

    const snapped = { latitude: result.latitude, longitude: result.longitude };
    lastSnappedRef.current = snapped;
    
    return { ...snapped, snapped: isActuallySnapped };
  }, []);

  const reset = useCallback(() => {
    lastRawRef.current     = null;
    lastSnappedRef.current = null;
    roadMatchPtsRef.current = [];
  }, []);

  return { snap, setRoutePoints, setRoadMatchPoints, reset };
}