import { useCallback, useRef } from 'react';
import MapView from 'react-native-maps';

interface CameraParams {
  center:    { latitude: number; longitude: number };
  pitch:     number;
  heading:   number;
  zoom:      number;
  altitude?: number;
}

// ── Przesuń punkt do przodu w kierunku heading ────────────
// offsetMeters — ile metrów "do przodu" przesunąć centrum kamery
function offsetCenter(
  lat: number,
  lng: number,
  headingDeg: number,
  offsetMeters: number,
): { latitude: number; longitude: number } {
  const R          = 6371000; // promień Ziemi w metrach
  const headingRad = (headingDeg * Math.PI) / 180;
  const dLat       = (offsetMeters * Math.cos(headingRad)) / R;
  const dLng       = (offsetMeters * Math.sin(headingRad)) /
                     (R * Math.cos((lat * Math.PI) / 180));

  return {
    latitude:  lat + (dLat * 180) / Math.PI,
    longitude: lng + (dLng * 180) / Math.PI,
  };
}

// Ile metrów do przodu przesunąć kamerę podczas nawigacji
// Im wyższa wartość tym użytkownik niżej na ekranie
const NAV_LOOKAHEAD_METERS = 90;

export function useCameraAnimation(mapRef: React.RefObject<MapView>) {
  const lastUpdateRef   = useRef(0);
  const pendingRef      = useRef<CameraParams | null>(null);
  const rafRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHeadingRef  = useRef(0);
  const lastCenterRef   = useRef<{ latitude: number; longitude: number } | null>(null);

  function doAnimate(params: CameraParams, duration = 150) {
    lastUpdateRef.current  = Date.now();
    lastHeadingRef.current = params.heading;
    lastCenterRef.current  = params.center;

    mapRef.current?.animateCamera(
      {
        center:   params.center,
        pitch:    params.pitch,
        heading:  params.heading,
        zoom:     params.zoom,
        altitude: params.altitude ?? 0,
      },
      { duration },
    );
  }

  // ── Dla GPS updateów (co 200ms) ───────────────────────────
  const animateCameraSmooth = useCallback((params: CameraParams) => {
    const now = Date.now();

    const headingDiff = Math.abs(params.heading - lastHeadingRef.current);
    const posChanged  = !lastCenterRef.current ||
      haversineSimple(
        params.center.latitude, params.center.longitude,
        lastCenterRef.current.latitude, lastCenterRef.current.longitude,
      ) > 0.001;

    if (!posChanged && headingDiff < 2) return;

    // Przesuń centrum kamery do przodu — użytkownik w dolnej części ekranu
    const lookahead = offsetCenter(
      params.center.latitude,
      params.center.longitude,
      params.heading,
      NAV_LOOKAHEAD_METERS,
    );

    const shifted: CameraParams = { ...params, center: lookahead };
    pendingRef.current = shifted;

    if (now - lastUpdateRef.current < 100) {
      if (!rafRef.current) {
        rafRef.current = setTimeout(() => {
          rafRef.current = null;
          if (!pendingRef.current) return;
          doAnimate(pendingRef.current, 150);
          pendingRef.current = null;
        }, 100 - (now - lastUpdateRef.current));
      }
      return;
    }

    doAnimate(shifted, 150);
  }, [mapRef]);

  // ── Dla dead-reckoning (co 16ms) ──────────────────────────
  const animateCameraLive = useCallback((params: CameraParams) => {
    const headingDiff = Math.abs(params.heading - lastHeadingRef.current);
    const posChanged  = !lastCenterRef.current ||
      haversineSimple(
        params.center.latitude, params.center.longitude,
        lastCenterRef.current.latitude, lastCenterRef.current.longitude,
      ) > 0.00001;

    if (!posChanged && headingDiff < 1) return;

    // Przesuń centrum kamery do przodu
    const lookahead = offsetCenter(
      params.center.latitude,
      params.center.longitude,
      params.heading,
      NAV_LOOKAHEAD_METERS,
    );

    doAnimate({ ...params, center: lookahead }, 80);
  }, [mapRef]);

  // ── Reset — bez offsetu ───────────────────────────────────
  const resetCamera = useCallback((
    center: { latitude: number; longitude: number },
    zoom = 15,
  ) => {
    if (rafRef.current) { clearTimeout(rafRef.current); rafRef.current = null; }
    pendingRef.current     = null;
    lastCenterRef.current  = null;
    lastHeadingRef.current = 0;

    mapRef.current?.animateCamera(
      { center, pitch: 0, heading: 0, zoom, altitude: 0 },
      { duration: 800 },
    );
  }, [mapRef]);

  return { animateCameraSmooth, animateCameraLive, resetCamera };
}

function haversineSimple(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}