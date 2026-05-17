import { useCallback, useEffect, useRef, type RefObject } from 'react';
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

const RETURN_TO_USER_MS = 4500;
const BROWSE_PITCH = 52;
const ACTIVE_PITCH = 68;
const BROWSE_ZOOM = 15;
const RECENTER_ANIM_MS = 1000;
const IDLE_APPLY_MS = 120;

/** Stałe czasowe wygładzania (sekundy). */
const CENTER_TAU_S = 0.22;
const HEADING_TAU_S = 0.18;
const ZOOM_TAU_S = 1.35;
const PITCH_TAU_S = 0.55;

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function expAlpha(dtSec: number, tauSec: number): number {
  if (tauSec <= 0) return 1;
  return 1 - Math.exp(-dtSec / tauSec);
}

function normalizeHeading(h: number): number {
  return ((h % 360) + 360) % 360;
}

function headingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function lerpHeading(from: number, to: number, t: number): number {
  const d = headingDelta(from, to);
  return normalizeHeading(from + d * t);
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

function moveCenterToward(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  maxStepM: number,
): { latitude: number; longitude: number } {
  const distM = haversineMeters(from.latitude, from.longitude, to.latitude, to.longitude);
  if (!Number.isFinite(distM) || distM <= maxStepM || distM < 0.05) return to;
  const t = clampNum(maxStepM / distM, 0, 1);
  return {
    latitude: lerpNum(from.latitude, to.latitude, t),
    longitude: lerpNum(from.longitude, to.longitude, t),
  };
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

function isActiveFollowMode(mode: CameraFollowMode): boolean {
  return mode === 'drivingFollow' || mode === 'navigationFollow';
}

function buildTargetPose(input: CameraFrameInput, mode: CameraFollowMode): CameraPose | null {
  if (!Number.isFinite(input.center.latitude) || !Number.isFinite(input.center.longitude)) {
    return null;
  }
  const active = isActiveFollowMode(mode);
  const targetHeading = normalizeHeading(input.heading || 0);
  const lookaheadM = active ? lookaheadFromSpeed(input.speedKmh) : 0;
  const center = offsetCenter(
    input.center.latitude,
    input.center.longitude,
    targetHeading,
    lookaheadM,
  );
  return {
    center,
    heading: targetHeading,
    zoom: active ? zoomFromSpeed(input.speedKmh) : BROWSE_ZOOM,
    pitch: active ? ACTIVE_PITCH : BROWSE_PITCH,
  };
}

export function useCameraAnimation(cameraRef: RefObject<Mapbox.Camera>) {
  const modeRef = useRef<CameraFollowMode>('idleBrowse');
  const userPanUntilRef = useRef(0);
  const targetPoseRef = useRef<CameraPose | null>(null);
  const displayPoseRef = useRef<CameraPose | null>(null);
  const lastMapApplyRef = useRef<CameraPose | null>(null);
  const lastIdleApplyRef = useRef(0);
  const recenterLockUntilRef = useRef(0);
  const followRafRef = useRef<number | null>(null);
  const lastRafAtRef = useRef(0);
  const speedKmhRef = useRef(0);

  const applyToMap = useCallback((
    pose: CameraPose,
    duration: number,
    animationMode: 'linear' | 'easeTo' = 'linear',
  ) => {
    const prev = lastMapApplyRef.current;
    if (prev && duration === 0) {
      const dm = haversineMeters(
        prev.center.latitude, prev.center.longitude,
        pose.center.latitude, pose.center.longitude,
      );
      const hdgD = Math.abs(headingDelta(prev.heading, pose.heading));
      if (dm < 0.12 && hdgD < 0.35 && Math.abs(prev.zoom - pose.zoom) < 0.002 && Math.abs(prev.pitch - pose.pitch) < 0.08) {
        return;
      }
    }
    (cameraRef.current as any)?.setCamera({
      centerCoordinate: [pose.center.longitude, pose.center.latitude],
      heading: pose.heading,
      zoomLevel: pose.zoom,
      pitch: pose.pitch,
      animationMode,
      animationDuration: duration,
    });
    lastMapApplyRef.current = pose;
    displayPoseRef.current = pose;
  }, [cameraRef]);

  const stopFollowLoop = useCallback(() => {
    if (followRafRef.current != null) {
      cancelAnimationFrame(followRafRef.current);
      followRafRef.current = null;
    }
  }, []);

  const followTick = useCallback((now: number) => {
    followRafRef.current = requestAnimationFrame(followTick);

    if (Date.now() < recenterLockUntilRef.current) return;
    if (modeRef.current === 'userPanning') return;

    const target = targetPoseRef.current;
    let display = displayPoseRef.current;
    if (!target) return;

    if (!display) {
      display = { ...target };
      displayPoseRef.current = display;
      applyToMap(display, 0, 'linear');
      lastRafAtRef.current = now;
      return;
    }

    const dtSec = clampNum((now - lastRafAtRef.current) / 1000, 0.008, 0.05);
    lastRafAtRef.current = now;

    const centerErrM = haversineMeters(
      display.center.latitude, display.center.longitude,
      target.center.latitude, target.center.longitude,
    );
    const centerTau = centerErrM > 45 ? 0.35 : CENTER_TAU_S;
    const centerAlpha = expAlpha(dtSec, centerTau);
    const maxCenterStep = clampNum(35 + speedKmhRef.current * 1.1, 28, 95) * dtSec;

    const center = moveCenterToward(
      {
        latitude: lerpNum(display.center.latitude, target.center.latitude, centerAlpha),
        longitude: lerpNum(display.center.longitude, target.center.longitude, centerAlpha),
      },
      target.center,
      maxCenterStep,
    );

    const heading = lerpHeading(display.heading, target.heading, expAlpha(dtSec, HEADING_TAU_S));
    const zoom = lerpNum(display.zoom, target.zoom, expAlpha(dtSec, ZOOM_TAU_S));
    const pitch = lerpNum(display.pitch, target.pitch, expAlpha(dtSec, PITCH_TAU_S));

    const next: CameraPose = { center, heading, zoom, pitch };
    displayPoseRef.current = next;
    applyToMap(next, 0, 'linear');
  }, [applyToMap]);

  const startFollowLoop = useCallback(() => {
    if (followRafRef.current != null) return;
    lastRafAtRef.current = performance.now();
    followRafRef.current = requestAnimationFrame(followTick);
  }, [followTick]);

  useEffect(() => () => stopFollowLoop(), [stopFollowLoop]);

  const markUserGesture = useCallback(() => {
    userPanUntilRef.current = Date.now() + RETURN_TO_USER_MS;
    modeRef.current = 'userPanning';
  }, []);

  const recenterTo = useCallback((params: {
    center: { latitude: number; longitude: number };
    heading: number;
    speedKmh: number;
    active: boolean;
  }) => {
    if (!Number.isFinite(params.center.latitude) || !Number.isFinite(params.center.longitude)) return;

    userPanUntilRef.current = 0;
    modeRef.current = 'recenterTransition';
    speedKmhRef.current = params.speedKmh;

    const heading = normalizeHeading(params.heading || 0);
    const lookaheadM = params.active ? lookaheadFromSpeed(params.speedKmh) : 0;
    const center = offsetCenter(params.center.latitude, params.center.longitude, heading, lookaheadM);
    const pose: CameraPose = {
      center,
      heading,
      zoom: params.active ? zoomFromSpeed(params.speedKmh) : BROWSE_ZOOM,
      pitch: params.active ? ACTIVE_PITCH : BROWSE_PITCH,
    };

    targetPoseRef.current = pose;
    recenterLockUntilRef.current = Date.now() + RECENTER_ANIM_MS;
    stopFollowLoop();
    applyToMap(pose, RECENTER_ANIM_MS, 'easeTo');

    setTimeout(() => {
      displayPoseRef.current = pose;
      targetPoseRef.current = pose;
      lastMapApplyRef.current = pose;
      recenterLockUntilRef.current = 0;
      modeRef.current = params.active ? 'drivingFollow' : 'idleBrowse';
      if (params.active) startFollowLoop();
    }, RECENTER_ANIM_MS + 60);
  }, [applyToMap, startFollowLoop, stopFollowLoop]);

  const resetBrowseCamera = useCallback((center: { latitude: number; longitude: number }) => {
    recenterTo({ center, heading: 0, speedKmh: 0, active: false });
  }, [recenterTo]);

  const updateCameraFrame = useCallback((input: CameraFrameInput) => {
    const now = input.timestamp ?? Date.now();
    speedKmhRef.current = input.speedKmh;

    const nextMode = computeFollowMode({
      isDriving: input.isDriving,
      isNavigating: input.isNavigating,
      userPanUntilMs: userPanUntilRef.current,
    });
    modeRef.current = nextMode;

    if (nextMode === 'userPanning') {
      stopFollowLoop();
      return;
    }

    const target = buildTargetPose(input, nextMode);
    if (!target) return;

    const active = isActiveFollowMode(nextMode);

    if (!active) {
      stopFollowLoop();
      if (now - lastIdleApplyRef.current < IDLE_APPLY_MS) return;
      lastIdleApplyRef.current = now;
      targetPoseRef.current = target;
      applyToMap(target, 140, 'linear');
      return;
    }

    if (now < recenterLockUntilRef.current) {
      targetPoseRef.current = target;
      return;
    }

    targetPoseRef.current = target;

    if (!displayPoseRef.current) {
      displayPoseRef.current = { ...target };
      applyToMap(target, 0, 'linear');
    }

    startFollowLoop();
  }, [applyToMap, startFollowLoop, stopFollowLoop]);

  const setFollowMode = useCallback((mode: 'idleBrowse' | 'drivingFollow' | 'navigationFollow') => {
    userPanUntilRef.current = 0;
    modeRef.current = mode;
    if (mode === 'idleBrowse') stopFollowLoop();
    else startFollowLoop();
  }, [startFollowLoop, stopFollowLoop]);

  return {
    updateCameraFrame,
    markUserGesture,
    recenterTo,
    resetBrowseCamera,
    setFollowMode,
  };
}
