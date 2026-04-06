import { useCallback, useRef } from 'react';
import MapView from 'react-native-maps';

interface CameraParams {
  center:    { latitude: number; longitude: number };
  pitch:     number;
  heading:   number;
  zoom:      number;
  altitude?: number;
}

const RETURN_TO_USER_MS    = 6000;
const NAV_LOOKAHEAD_METERS = 480;

function offsetCenter(
  lat: number, lng: number,
  headingDeg: number, offsetMeters: number,
): { latitude: number; longitude: number } {
  const R          = 6371000;
  const headingRad = (headingDeg * Math.PI) / 180;
  const dLat       = (offsetMeters * Math.cos(headingRad)) / R;
  const dLng       = (offsetMeters * Math.sin(headingRad)) /
                     (R * Math.cos((lat * Math.PI) / 180));
  return {
    latitude:  lat + (dLat * 180) / Math.PI,
    longitude: lng + (dLng * 180) / Math.PI,
  };
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

// Różnica kątów po krótszym łuku
function headingDiff(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180) ;
}

export function useCameraAnimation(mapRef: React.RefObject<MapView>) {
  const lastHeadingRef  = useRef(0);
  const lastCenterRef   = useRef<{ latitude: number; longitude: number } | null>(null);
  const cameraLockedRef = useRef(false);
  const startLockRef    = useRef(false);
  const returnTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDRPosRef    = useRef<CameraParams | null>(null);

  // ── Throttle dla animateCameraLive ────────────────────────
  // Nie wysyłaj animacji częściej niż co LIVE_INTERVAL_MS
  // — zbyt częste wywołania animateCamera blokują heading na Androidzie
  const lastLiveCallRef = useRef(0);
  const LIVE_INTERVAL_MS = 60; // ~12fps dla kamery, wystarczy dla płynności

  function doAnimate(params: CameraParams, duration: number) {
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

  function scheduleReturn(params: CameraParams) {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    returnTimerRef.current = setTimeout(() => {
      cameraLockedRef.current = false;
      const lookahead = offsetCenter(
        params.center.latitude, params.center.longitude,
        params.heading, NAV_LOOKAHEAD_METERS,
      );
      doAnimate({ ...params, center: lookahead }, 1200);
    }, RETURN_TO_USER_MS);
  }

  const onUserPan = useCallback(() => {
    cameraLockedRef.current = true;
    if (lastDRPosRef.current) {
      scheduleReturn(lastDRPosRef.current);
    }
  }, []);

  const unlockCamera = useCallback(() => {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    cameraLockedRef.current = false;
  }, []);

  const lockForStart = useCallback((ms = 900) => {
    startLockRef.current = true;
    setTimeout(() => { startLockRef.current = false; }, ms);
  }, []);

  // ── animateCameraLive — wywoływana z DR lub symulatora ────
  const animateCameraLive = useCallback((params: CameraParams) => {
    // Zawsze zapisuj ostatnią pozycję (potrzebna do powrotu)
    lastDRPosRef.current = params;

    if (cameraLockedRef.current) return;
    if (startLockRef.current)    return;

    const now = Date.now();

    // Throttle — nie częściej niż co LIVE_INTERVAL_MS
    const timeSinceLast = now - lastLiveCallRef.current;
    if (timeSinceLast < LIVE_INTERVAL_MS) return;
    lastLiveCallRef.current = now;

    // Sprawdź czy cokolwiek się zmieniło
    const hdgDiff    = headingDiff(lastHeadingRef.current, params.heading);
    const posChanged = !lastCenterRef.current ||
      haversineSimple(
        params.center.latitude,  params.center.longitude,
        lastCenterRef.current.latitude, lastCenterRef.current.longitude,
      ) > 0.000003; // ~0.3m

    if (!posChanged && hdgDiff < 0.3) return;

    const lookahead = offsetCenter(
      params.center.latitude, params.center.longitude,
      params.heading, NAV_LOOKAHEAD_METERS,
    );

    // KLUCZOWE: duration musi być >= LIVE_INTERVAL_MS
    // duration: 0 na Androidzie ignoruje heading — stąd kamera się nie obracała
    doAnimate({ ...params, center: lookahead }, LIVE_INTERVAL_MS + 20);
  }, [mapRef]);

  // ── animateCameraSmooth — dla GPS updateów ────────────────
  const animateCameraSmooth = useCallback((params: CameraParams) => {
    if (cameraLockedRef.current) return;
    if (startLockRef.current)    return;

    const hdgDiff    = headingDiff(lastHeadingRef.current, params.heading);
    const posChanged = !lastCenterRef.current ||
      haversineSimple(
        params.center.latitude,  params.center.longitude,
        lastCenterRef.current.latitude, lastCenterRef.current.longitude,
      ) > 0.001;

    if (!posChanged && hdgDiff < 2) return;

    const lookahead = offsetCenter(
      params.center.latitude, params.center.longitude,
      params.heading, NAV_LOOKAHEAD_METERS,
    );
    doAnimate({ ...params, center: lookahead }, 150);
  }, [mapRef]);

  const resetCamera = useCallback((
    center: { latitude: number; longitude: number },
    zoom = 15,
  ) => {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    cameraLockedRef.current  = false;
    startLockRef.current     = false;
    lastCenterRef.current    = null;
    lastHeadingRef.current   = 0;
    lastDRPosRef.current     = null;
    lastLiveCallRef.current  = 0;
    mapRef.current?.animateCamera(
      { center, pitch: 0, heading: 0, zoom, altitude: 0 },
      { duration: 800 },
    );
  }, [mapRef]);

  return {
    animateCameraSmooth,
    animateCameraLive,
    resetCamera,
    onUserPan,
    unlockCamera,
    lockForStart,
    cameraLockedRef,
  };
}