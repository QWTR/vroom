import { useCallback, useRef } from 'react';
import Mapbox from '@rnmapbox/maps';

interface CameraParams {
  center:    { latitude: number; longitude: number };
  pitch:     number;
  heading:   number;
  zoom:      number;
  altitude?: number;
}

const RETURN_TO_USER_MS    = 5000;
const NAV_LOOKAHEAD_METERS = 50;

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

function headingDiff(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}

export function useCameraAnimation(cameraRef: React.RefObject<Mapbox.Camera>) {
  const lastHeadingRef  = useRef(0);
  const lastCenterRef   = useRef<{ latitude: number; longitude: number } | null>(null);
  const cameraLockedRef = useRef(false);
  const startLockRef    = useRef(false);
  const returnTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDRPosRef    = useRef<CameraParams | null>(null);

  const lastLiveCallRef = useRef(0);
  const LIVE_INTERVAL_MS = 60;

  function doAnimate(params: CameraParams, duration: number) {
    lastHeadingRef.current = params.heading;
    lastCenterRef.current  = params.center;
    (cameraRef.current as any)?.setCamera({
      centerCoordinate: [params.center.longitude, params.center.latitude],
      pitch:            params.pitch,
      heading:          params.heading,
      zoomLevel:        params.zoom,
      animationDuration: duration,
      animationMode:    'flyTo',
    });
  }

  function scheduleReturn() {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    returnTimerRef.current = setTimeout(() => {
      // Read the latest DR position at fire-time so camera returns to where
      // the vehicle actually IS now, not where it was when the user started panning.
      const params = lastDRPosRef.current;
      if (!params) return;
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
      scheduleReturn();
    }
  }, []);

  const unlockCamera = useCallback(() => {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    cameraLockedRef.current = false;
    startLockRef.current    = false;
  }, []);

  const lockForStart = useCallback((ms = 900) => {
    startLockRef.current = true;
    setTimeout(() => { startLockRef.current = false; }, ms);
  }, []);

  // ── NOWE: wejście w tryb jazdy — płynna animacja do pitch+zoom ──
  // Wywołaj raz gdy isDriving przechodzi false→true
  const enterDrivingCamera = useCallback((
    center: { latitude: number; longitude: number },
    heading: number,
  ) => {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    cameraLockedRef.current = false;
    startLockRef.current    = false;
    lastCenterRef.current   = null;
    lastLiveCallRef.current = 0;
    const lookahead = offsetCenter(center.latitude, center.longitude, heading, NAV_LOOKAHEAD_METERS);
    (cameraRef.current as any)?.setCamera({
      centerCoordinate: [lookahead.longitude, lookahead.latitude],
      pitch:            55,
      heading,
      zoomLevel:        14.5,
      animationDuration: 800,
      animationMode:    'flyTo',
    });
    lastHeadingRef.current = heading;
    lastCenterRef.current  = lookahead;
  }, [cameraRef]);

  // ── exitDrivingCamera — powrót do widoku 2D ───────────────
  const exitDrivingCamera = useCallback((center: { latitude: number; longitude: number }) => {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    cameraLockedRef.current = false;
    startLockRef.current    = false;
    lastCenterRef.current   = null;
    lastDRPosRef.current    = null;
    lastLiveCallRef.current = 0;
    lastHeadingRef.current  = 0;
    (cameraRef.current as any)?.setCamera({
      centerCoordinate: [center.longitude, center.latitude],
      pitch:            0,
      heading:          0,
      zoomLevel:        15,
      animationDuration: 700,
      animationMode:    'flyTo',
    });
  }, [cameraRef]);

  const animateCameraLive = useCallback((params: CameraParams) => {
    lastDRPosRef.current = params;

    if (cameraLockedRef.current) return;
    if (startLockRef.current)    return;

    const now = Date.now();
    const timeSinceLast = now - lastLiveCallRef.current;
    if (timeSinceLast < LIVE_INTERVAL_MS) return;
    lastLiveCallRef.current = now;

    const hdgDiff    = headingDiff(lastHeadingRef.current, params.heading);
    const posChanged = !lastCenterRef.current ||
      haversineSimple(
        params.center.latitude,  params.center.longitude,
        lastCenterRef.current.latitude, lastCenterRef.current.longitude,
      ) > 0.000003;

    if (!posChanged && hdgDiff < 0.3) return;

    const lookahead = offsetCenter(
      params.center.latitude, params.center.longitude,
      params.heading, NAV_LOOKAHEAD_METERS,
    );
    doAnimate({ ...params, center: lookahead }, LIVE_INTERVAL_MS + 20);
  }, [cameraRef]);

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
  }, [cameraRef]);

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
    (cameraRef.current as any)?.setCamera({
      centerCoordinate: [center.longitude, center.latitude],
      pitch:            0,
      heading:          0,
      zoomLevel:        zoom,
      animationDuration: 800,
      animationMode:    'flyTo',
    });
  }, [cameraRef]);

  return {
    animateCameraSmooth,
    animateCameraLive,
    resetCamera,
    onUserPan,
    unlockCamera,
    lockForStart,
    cameraLockedRef,
    // NOWE
    enterDrivingCamera,
    exitDrivingCamera,
  };
}