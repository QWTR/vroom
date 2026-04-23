import { useRef, useCallback } from 'react';
import { bearingBetween, distanceToSegmentMeters } from '../scripts/navigationUtils';

// Dynamiczny promień snapowania: przy wolnej jeździe ufamy GPS bardziej,
// przy szybkiej jeździe GPS ma większy dryf, więc używamy większego promienia.
const SNAP_RADIUS_M_BASE = 65;  // 65 m: covers urban GPS multipath (typically 20-60 m)
const SNAP_RADIUS_M_FAST = 100; // 100 m: GPS multipath w mieście może odchylić o 30-60 m
const MIN_MOVE_DEG       = 0.00003; // ~3m (częstsze odświeżanie na zakrętach)

/**
 * Interpolacja kątowa z uwzględnieniem przejścia przez 0°/360°.
 * @param a Start angle in degrees [0, 360)
 * @param b Target angle in degrees [0, 360)
 * @param t Interpolation factor [0, 1] — 0 returns a, 1 returns b
 * @returns Interpolated angle in degrees [0, 360)
 */
function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180;
  return ((a + diff * t) + 360) % 360;
}

interface SnapResult {
  latitude:      number;
  longitude:     number;
  distM:         number;
  segmentIndex:  number;
  segmentBearing: number;
}

/**
 * Snap to the nearest road segment and return snap metadata.
 * @param userLat  User latitude in degrees
 * @param userLng  User longitude in degrees
 * @param pts      Polyline points (road geometry)
 * @param maxRadiusM  Maximum distance in metres — returns null if all segments are farther
 * @returns Snap result with snapped coordinates, distance, and segment bearing; null when too far
 */
function snapToRouteWithInfo(
  userLat: number,
  userLng: number,
  pts: { latitude: number; longitude: number }[],
  maxRadiusM: number,
): SnapResult | null {
  if (pts.length < 2) return null;

  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;

  let minDist      = Infinity;
  let bestLat      = userLat;
  let bestLng      = userLng;
  let bestSegIdx   = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const aLat = pts[i].latitude;
    const aLon = pts[i].longitude;
    const bLat = pts[i + 1].latitude;
    const bLon = pts[i + 1].longitude;

    const dist = distanceToSegmentMeters(userLat, userLng, aLat, aLon, bLat, bLon);
    if (dist < minDist) {
      minDist    = dist;
      bestSegIdx = i;

      const ax = R * Math.cos(toRad(aLat)) * toRad(aLon);
      const ay = R * toRad(aLat);
      const bx = R * Math.cos(toRad(bLat)) * toRad(bLon);
      const by = R * toRad(bLat);
      const px = R * Math.cos(toRad(userLat)) * toRad(userLng);
      const py = R * toRad(userLat);

      const dx    = bx - ax;
      const dy    = by - ay;
      const lenSq = dx * dx + dy * dy;
      let   t     = 0;
      if (lenSq > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }
      bestLat = aLat + t * (bLat - aLat);
      bestLng = aLon + t * (bLon - aLon);
    }
  }

  if (minDist > maxRadiusM) return null;

  const seg = pts[bestSegIdx];
  const segNext = pts[bestSegIdx + 1];
  const segBearing = bearingBetween(seg.latitude, seg.longitude, segNext.latitude, segNext.longitude);

  return {
    latitude:       bestLat,
    longitude:      bestLng,
    distM:          minDist,
    segmentIndex:   bestSegIdx,
    segmentBearing: segBearing,
  };
}

export function useDrivingSnap() {
  const lastRawRef           = useRef<{ lat: number; lng: number } | null>(null);
  const lastSnappedRef       = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastTargetHeadingRef = useRef<number>(0);
  const routePtsRef          = useRef<{ latitude: number; longitude: number }[]>([]);
  const roadMatchPtsRef      = useRef<{ latitude: number; longitude: number }[]>([]);

  const setRoutePoints = useCallback((pts: { latitude: number; longitude: number }[]) => {
    routePtsRef.current = pts;
  }, []);

  const setRoadMatchPoints = useCallback((pts: { latitude: number; longitude: number }[]) => {
    // Map Matching daje nam realną geometrię drogi
    roadMatchPtsRef.current = pts;
  }, []);

  const snap = useCallback((lat: number, lng: number, speedKmh: number, isNavigating: boolean): {
    latitude:      number;
    longitude:     number;
    snapped:       boolean;
    targetHeading: number;
  } => {
    if (isNavigating) return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };

    // Wybieramy punkty. Priorytet ma roadMatchPtsRef, bo to jest aktualna GEOMETRIA drogi,
    // po której jedziesz, a nie tylko linia prosta do celu.
    const pts = roadMatchPtsRef.current.length >= 2
      ? roadMatchPtsRef.current
      : routePtsRef.current;

    // Snap whenever we have road points — speed gate removed because loc.speed is
    // unreliable on many Android devices (can read 0 km/h even while moving).
    if (pts.length < 2) {
      return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };
    }

    const last = lastRawRef.current;
    if (last) {
      const dLat = Math.abs(lat - last.lat);
      const dLng = Math.abs(lng - last.lng);
      // Na zakrętach (duża prędkość) nie możemy ignorować małych ruchów
      if (dLat < MIN_MOVE_DEG && dLng < MIN_MOVE_DEG && lastSnappedRef.current && speedKmh < 60) {
        return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
      }
    }

    lastRawRef.current = { lat, lng };

    // Dynamiczny promień - im szybciej jedziesz, tym bardziej ufamy drodze niż GPS
    const dynamicRadius = speedKmh > 70 ? SNAP_RADIUS_M_FAST : SNAP_RADIUS_M_BASE;

    const result = snapToRouteWithInfo(lat, lng, pts, dynamicRadius);

    // Brak drogi w promieniu — użyj ostatniej pozycji na drodze jeśli jest dostępna,
    // żeby uniknąć skoku markera do surowego GPS między odświeżeniami geometrii drogi.
    if (!result) {
      if (lastSnappedRef.current) {
        return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
      }
      return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };
    }

    // Snap udany — aktualizuj referencje
    const snappedCoord = { latitude: result.latitude, longitude: result.longitude };
    lastSnappedRef.current = snappedCoord;

    // Wygładzony heading oparty na kierunku segmentu polyline (stabilny, nie szumi)
    const smoothedBearing = lerpAngle(lastTargetHeadingRef.current, result.segmentBearing, 0.35);
    lastTargetHeadingRef.current = smoothedBearing;

    return { ...snappedCoord, snapped: true, targetHeading: smoothedBearing };
  }, []);

  const reset = useCallback(() => {
    lastRawRef.current           = null;
    lastSnappedRef.current       = null;
    lastTargetHeadingRef.current = 0;
    roadMatchPtsRef.current      = [];
  }, []);

  return { snap, setRoutePoints, setRoadMatchPoints, reset };
}