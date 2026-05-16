import { useCallback, useRef, type RefObject } from 'react';
import Mapbox from '@rnmapbox/maps';

type CameraFollowMode =
  | 'idleBrowse'
  | 'drivingFollow'
  | 'navigationFollow'
  | 'userPanning'
  | 'recenterTransition';

type CameraFrameInput = {
  center: { latitude: number; longitude: number };
  heading: number;
  speedKmh: number;
  isDriving: boolean;
  isNavigating: boolean;
  timestamp?: number;
};

type CameraPose = {
  center: { latitude: number; longitude: number };
  heading: number;
  zoom: number;
  pitch: number;
};

const CAMERA_TICK_MS = 80;
const RETURN_TO_USER_MS = 4500;
const BROWSE_PITCH = 52;
const ACTIVE_PITCH = 68;
const BROWSE_ZOOM = 15;
const CAMERA_DEBUG_LOGS = false;

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalizeHeading(h: number): number {
  return ((h % 360) + 360) % 360;
}

function headingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function moveHeadingToward(from: number, to: number, maxDelta: number): number {
  const d = headingDelta(from, to);
  const c = clampNum(d, -maxDelta, maxDelta);
  return normalizeHeading(from + c);
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180) *
    Math.cos((bLat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function offsetCenter(
  lat: number,
  lng: number,
  headingDeg: number,
  offsetMeters: number,
): { latitude: number; longitude: number } {
  if (!Number.isFinite(offsetMeters) || offsetMeters <= 0) {
    return { latitude: lat, longitude: lng };
  }
  const R = 6371000;
  const headingRad = (headingDeg * Math.PI) / 180;
  const dLat = (offsetMeters * Math.cos(headingRad)) / R;
  const dLng =
    (offsetMeters * Math.sin(headingRad)) /
    (R * Math.cos((lat * Math.PI) / 180));
  return {
    latitude: lat + (dLat * 180) / Math.PI,
    longitude: lng + (dLng * 180) / Math.PI,
  };
}

function zoomFromSpeed(speedKmh: number): number {
  const s = Math.max(0, speedKmh);
  // Wolno (miasto/manewry): kamera bliżej. Szybko: stopniowe oddalanie.
  if (s <= 8) return 18.75;
  if (s <= 20) return lerpNum(18.75, 18.1, (s - 8) / 12);
  if (s <= 30) return lerpNum(18.1, 17.7, (s - 20) / 10);
  if (s <= 60) return lerpNum(17.7, 16.9, (s - 30) / 30);
  if (s <= 100) return lerpNum(16.9, 16.2, (s - 60) / 40);
  if (s <= 140) return lerpNum(16.2, 15.7, (s - 100) / 40);
  return 15.6;
}

function lookaheadFromSpeed(speedKmh: number): number {
  const s = Math.max(0, speedKmh);
  // Wolno: krótszy lookahead (lepsza czytelność ciasnych ulic).
  // Szybko: dłuższy lookahead, żeby widzieć więcej przed autem.
  // Jednocześnie utrzymujemy auto niżej na ekranie (nie na środku),
  // więc minimalny lookahead nie może być zbyt mały.
  if (s <= 8) return 50;
  if (s <= 25) return lerpNum(50, 64, (s - 8) / 17);
  if (s <= 40) return lerpNum(64, 82, (s - 25) / 15);
  if (s <= 80) return lerpNum(82, 112, (s - 40) / 40);
  if (s <= 130) return lerpNum(112, 185, (s - 80) / 50);
  return 220;
}

function computeFollowMode(input: {
  isDriving: boolean;
  isNavigating: boolean;
  userPanUntilMs: number;
}): CameraFollowMode {
  const now = Date.now();
  if (now < input.userPanUntilMs) return 'userPanning';
  if (input.isNavigating) return 'navigationFollow';
  if (input.isDriving) return 'drivingFollow';
  return 'idleBrowse';
}

export function useCameraAnimation(cameraRef: RefObject<Mapbox.Camera>) {
  const modeRef = useRef<CameraFollowMode>('idleBrowse');
  const userPanUntilRef = useRef(0);
  const lastApplyAtRef = useRef(0);
  const lastPoseRef = useRef<CameraPose | null>(null);
  const smoothZoomRef = useRef<number | null>(null);
  const smoothHeadingRef = useRef<number | null>(null);
  /** When stopped in follow mode, still refresh camera occasionally (avoids perceived freeze). */
  const lastStationaryApplyRef = useRef(0);

  const logTransition = useCallback((next: CameraFollowMode, reason: string) => {
    if (!CAMERA_DEBUG_LOGS) return;
    if (modeRef.current === next) return;
    console.log('[CAMDBG] camera_mode_transition', JSON.stringify({
      from: modeRef.current,
      to: next,
      reason,
      at: Date.now(),
    }));
  }, []);

  const applyPose = useCallback((pose: CameraPose, duration: number) => {
    (cameraRef.current as any)?.setCamera({
      centerCoordinate: [pose.center.longitude, pose.center.latitude],
      heading: pose.heading,
      zoomLevel: pose.zoom,
      pitch: pose.pitch,
      animationMode: 'linear',
      animationDuration: duration,
    });
    lastPoseRef.current = pose;
  }, [cameraRef]);

  const markUserGesture = useCallback(() => {
    userPanUntilRef.current = Date.now() + RETURN_TO_USER_MS;
    logTransition('userPanning', 'gesture');
    modeRef.current = 'userPanning';
  }, [logTransition]);

  const recenterTo = useCallback((params: {
    center: { latitude: number; longitude: number };
    heading: number;
    speedKmh: number;
    active: boolean;
  }) => {
    if (!Number.isFinite(params.center.latitude) || !Number.isFinite(params.center.longitude)) return;

    userPanUntilRef.current = 0;
    modeRef.current = 'recenterTransition';
    const heading = normalizeHeading(params.heading || 0);
    const lookaheadM = params.active ? lookaheadFromSpeed(params.speedKmh) : 0;
    const center = offsetCenter(params.center.latitude, params.center.longitude, heading, lookaheadM);
    const zoom = params.active ? zoomFromSpeed(params.speedKmh) : BROWSE_ZOOM;
    const pitch = params.active ? ACTIVE_PITCH : BROWSE_PITCH;

    if (CAMERA_DEBUG_LOGS) {
      console.log('[CAMDBG] camera_frame_applied', JSON.stringify({
        mode: modeRef.current,
        reason: 'recenter',
        zoom: Number(zoom.toFixed(2)),
        pitch,
      }));
    }

    smoothZoomRef.current = zoom;
    smoothHeadingRef.current = heading;
    applyPose({ center, heading, zoom, pitch }, 420);
    modeRef.current = params.active ? 'drivingFollow' : 'idleBrowse';
  }, [applyPose]);

  const resetBrowseCamera = useCallback((center: { latitude: number; longitude: number }) => {
    recenterTo({
      center,
      heading: 0,
      speedKmh: 0,
      active: false,
    });
  }, [recenterTo]);

  const updateCameraFrame = useCallback((input: CameraFrameInput) => {
    if (!Number.isFinite(input.center.latitude) || !Number.isFinite(input.center.longitude)) return;
    const now = input.timestamp ?? Date.now();
    if (now - lastApplyAtRef.current < CAMERA_TICK_MS) {
      if (CAMERA_DEBUG_LOGS) {
        console.log('[CAMDBG] camera_update_skipped', JSON.stringify({ reason: 'throttle', at: now }));
      }
      return;
    }
    lastApplyAtRef.current = now;

    const nextMode = computeFollowMode({
      isDriving: input.isDriving,
      isNavigating: input.isNavigating,
      userPanUntilMs: userPanUntilRef.current,
    });

    if (modeRef.current !== nextMode) {
      logTransition(nextMode, 'state_update');
      modeRef.current = nextMode;
    }
    if (nextMode === 'userPanning') return;

    const active = nextMode === 'drivingFollow' || nextMode === 'navigationFollow';
    const targetZoom = active ? zoomFromSpeed(input.speedKmh) : BROWSE_ZOOM;
    const targetPitch = active ? ACTIVE_PITCH : BROWSE_PITCH;
    const targetHeading = normalizeHeading(input.heading || 0);
    const lookaheadM = active ? lookaheadFromSpeed(input.speedKmh) : 0;
    const targetCenter = offsetCenter(
      input.center.latitude,
      input.center.longitude,
      targetHeading,
      lookaheadM,
    );

    const prev = lastPoseRef.current;

    let smoothZoom = smoothZoomRef.current ?? targetZoom;
    const zoomDiff = targetZoom - smoothZoom;
    const zoomDeadband = zoomDiff > 0 ? 0.05 : 0.08;
    if (Math.abs(zoomDiff) > zoomDeadband) {
      smoothZoom = smoothZoom + clampNum(zoomDiff * 0.32, -0.14, 0.14);
    }

    let smoothHeading = smoothHeadingRef.current ?? targetHeading;
    smoothHeading = moveHeadingToward(smoothHeading, targetHeading, active ? 24 : 14);
    smoothHeading = normalizeHeading(lerpNum(smoothHeading, targetHeading, active ? 0.28 : 0.18));

    let center = targetCenter;
    if (prev) {
      const distM = haversineMeters(prev.center.latitude, prev.center.longitude, targetCenter.latitude, targetCenter.longitude);
      if (Number.isFinite(distM) && distM > 0) {
        const maxStepM = active ? 42 : 75;
        const ratio = clampNum(maxStepM / distM, 0, 1);
        center = {
          latitude: lerpNum(prev.center.latitude, targetCenter.latitude, ratio),
          longitude: lerpNum(prev.center.longitude, targetCenter.longitude, ratio),
        };
      }
    }

    const pose: CameraPose = {
      center,
      heading: smoothHeading,
      zoom: smoothZoom,
      pitch: targetPitch,
    };

    // Moving follow: drop micro-delta spam (main freeze source on Android).
    // Stopped follow: allow a slow heartbeat so the map does not look deadlocked.
    const stationaryFollow = active && input.speedKmh < 8;
    if (prev && !stationaryFollow) {
      const centerDeltaM = haversineMeters(
        prev.center.latitude,
        prev.center.longitude,
        pose.center.latitude,
        pose.center.longitude,
      );
      const headingDeltaDeg = Math.abs(headingDelta(prev.heading, pose.heading));
      const zoomDelta = Math.abs(prev.zoom - pose.zoom);
      const pitchDelta = Math.abs(prev.pitch - pose.pitch);
      const nearlySamePose =
        centerDeltaM < 0.9 &&
        headingDeltaDeg < 0.8 &&
        zoomDelta < 0.015 &&
        pitchDelta < 0.15;
      if (nearlySamePose) return;
    } else if (stationaryFollow) {
      const stationaryGapMs = 420;
      if (now - lastStationaryApplyRef.current < stationaryGapMs) return;
      lastStationaryApplyRef.current = now;
    }

    if (CAMERA_DEBUG_LOGS) {
      console.log('[CAMDBG] camera_frame_applied', JSON.stringify({
        mode: nextMode,
        speedKmh: Number((input.speedKmh || 0).toFixed(1)),
        zoom: Number(pose.zoom.toFixed(2)),
        heading: Number(pose.heading.toFixed(1)),
      }));
    }

    smoothZoomRef.current = smoothZoom;
    smoothHeadingRef.current = smoothHeading;
    applyPose(pose, active ? 95 : 140);
  }, [applyPose, logTransition]);

  const setFollowMode = useCallback((mode: 'idleBrowse' | 'drivingFollow' | 'navigationFollow') => {
    userPanUntilRef.current = 0;
    logTransition(mode, 'explicit_set');
    modeRef.current = mode;
  }, [logTransition]);

  return {
    updateCameraFrame,
    markUserGesture,
    recenterTo,
    resetBrowseCamera,
    setFollowMode,
  };
}