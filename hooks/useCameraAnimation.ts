import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Dimensions } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { markerLogTick } from '../lib/markerPipelineLog';

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

type MapCameraPadding = {
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
};

type CameraPose = {
  center: { latitude: number; longitude: number };
  heading: number;
  zoom: number;
  pitch: number;
  padding: MapCameraPadding;
};

const ZERO_PADDING: MapCameraPadding = {
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 0,
  paddingBottom: 0,
};

/**
 * Mapbox: punkt follow ląduje w GEOMETRICZNYM ŚRODKU obszaru [paddingTop .. height-paddingBottom].
 * Duży paddingBottom + duży paddingTop = cienki pasek na ŚRODKU ekranu = marker na środku (bug).
 * Żeby marker był NA DOLE (jak Waze): duży paddingTop, mały paddingBottom.
 */
export function getTripCameraPadding(isNavigating: boolean): MapCameraPadding {
  const h = Dimensions.get('window').height;
  const tabBarPx = 88;
  const hudPx = isNavigating ? 200 : 240;
  const top = Math.round(clampNum(h * (isNavigating ? 0.50 : 0.54), 320, 520) + hudPx * 0.35);
  const bottom = Math.round(clampNum(tabBarPx + (isNavigating ? 24 : 32), 72, 120));
  return {
    paddingTop: top,
    paddingBottom: bottom,
    paddingLeft: 24,
    paddingRight: 24,
  };
}

function activeCameraPadding(isNavigating: boolean): MapCameraPadding {
  return getTripCameraPadding(isNavigating);
}

/** Po tym czasie bez gestu użytkownika kamera wraca do follow (jazda/nawigacja). */
const RETURN_TO_USER_MS = 4000;
const BROWSE_PITCH = 52;
const ACTIVE_PITCH = 68;
const BROWSE_ZOOM = 15;
const RECENTER_ANIM_MS = 1000;
/** Szybkie, płynne wejście kamery w tryb jazdy (zoom + pitch), bez 1 s opóźnienia. */
const DRIVING_ENTRY_RECENTER_MS = 480;
const IDLE_APPLY_MS = 120;
/**
 * Jeden setCamera na segment GPS — Mapbox interpoluje natywnie (bez 60×/s przez RN bridge).
 */
const NATIVE_FOLLOW_ANIM_MS = 400;
const NATIVE_FOLLOW_MIN_INTERVAL_MS = 120;
const NATIVE_FOLLOW_MAX_ANIM_MS = 900;
const NATIVE_APPLY_MIN_MOVE_M = 0.4;
const NATIVE_APPLY_MIN_HEADING_DEG = 0.8;

const HEADING_VECTOR_MIN_MOVE_M = 1.8;
const HEADING_LOW_SPEED_HOLD_KMH = 6;
const HEADING_FLIP_GUARD_DEG = 105;
const HEADING_LOW_SPEED_MAX_STEP_DEG = 10;

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

function lerpHeading(from: number, to: number, t: number): number {
  const d = headingDelta(from, to);
  return normalizeHeading(from + d * t);
}

function lerpHeadingWithMaxStep(from: number, to: number, maxStepDeg: number): number {
  const d = headingDelta(from, to);
  const step = clampNum(d, -maxStepDeg, maxStepDeg);
  return normalizeHeading(from + step);
}

/** Maks. prędkość obrotu kamery (°/s) — przy wyższej prędkości jazdy szybsze skręcanie. */
function maxHeadingRateDegPerSec(speedKmh: number): number {
  const s = Math.max(0, speedKmh);
  if (s < 2.5) return 22;
  if (s < 10) return 48;
  if (s < 35) return 72;
  if (s < 70) return 95;
  return 115;
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

function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R)
    - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
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
  if (s <= 10) return 18.9;
  if (s <= 30) return lerpNum(18.9, 18.45, (s - 10) / 20);
  if (s <= 60) return lerpNum(18.45, 18.05, (s - 30) / 30);
  if (s <= 100) return lerpNum(18.05, 17.65, (s - 60) / 40);
  if (s <= 160) return lerpNum(17.65, 17.25, (s - 100) / 60);
  return 17.0;
}

function lookaheadFromSpeed(_speedKmh: number): number {
  return 0;
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
  const isNavigating = mode === 'navigationFollow';
  const targetHeading = normalizeHeading(input.heading || 0);
  const lookaheadM = active ? lookaheadFromSpeed(input.speedKmh) : 0;
  const center = offsetCenter(
    input.center.latitude,
    input.center.longitude,
    targetHeading,
    lookaheadM,
  );
  const rawZoom = active ? zoomFromSpeed(input.speedKmh) : BROWSE_ZOOM;
  return {
    center,
    heading: targetHeading,
    zoom: rawZoom,
    pitch: active ? ACTIVE_PITCH : BROWSE_PITCH,
    padding: active ? activeCameraPadding(isNavigating) : ZERO_PADDING,
  };
}

function smoothZoomTarget(prev: number | null, next: number): number {
  if (prev == null || !Number.isFinite(prev)) return next;
  const maxStep = 0.12;
  const d = next - prev;
  if (Math.abs(d) <= maxStep) return next;
  return prev + Math.sign(d) * maxStep;
}

export function useCameraAnimation(cameraRef: RefObject<Mapbox.Camera>) {
  const modeRef = useRef<CameraFollowMode>('idleBrowse');
  const userPanUntilRef = useRef(0);
  const targetPoseRef = useRef<CameraPose | null>(null);
  const displayPoseRef = useRef<CameraPose | null>(null);
  const lastMapApplyRef = useRef<CameraPose | null>(null);
  const lastIdleApplyRef = useRef(0);
  const recenterLockUntilRef = useRef(0);
  const lastNativeFollowApplyAtRef = useRef(0);
  const speedKmhRef = useRef(0);
  const lastTargetZoomRef = useRef<number | null>(null);
  const travelHeadingRef = useRef<number | null>(null);
  const lastVehicleCenterRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastTravelUpdateAtRef = useRef(0);
  const lastResolvedHeadingAtRef = useRef(0);
  const resolvedHeadingRef = useRef<number | null>(null);
  const lastFrameInputRef = useRef<CameraFrameInput | null>(null);
  const tripActiveRef = useRef(false);
  const gestureResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAfterUserGestureRef = useRef<() => void>(() => {});

  const clearGestureResumeTimer = useCallback(() => {
    if (gestureResumeTimerRef.current != null) {
      clearTimeout(gestureResumeTimerRef.current);
      gestureResumeTimerRef.current = null;
    }
  }, []);

  /** Po wyjściu z jazdy/nawigacji — anuluj auto-powrót po pan/zoom. */
  const releaseTripCameraState = useCallback(() => {
    tripActiveRef.current = false;
    lastFrameInputRef.current = null;
    userPanUntilRef.current = 0;
    recenterLockUntilRef.current = 0;
    lastNativeFollowApplyAtRef.current = 0;
    clearGestureResumeTimer();
    modeRef.current = 'idleBrowse';
    targetPoseRef.current = null;
    displayPoseRef.current = null;
    lastTargetZoomRef.current = null;
    travelHeadingRef.current = null;
    resolvedHeadingRef.current = null;
    lastResolvedHeadingAtRef.current = 0;
    lastVehicleCenterRef.current = null;
    lastTravelUpdateAtRef.current = 0;
    speedKmhRef.current = 0;
  }, [clearGestureResumeTimer]);

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
      padding: pose.padding,
      animationMode,
      animationDuration: duration,
    });
    lastMapApplyRef.current = pose;
    displayPoseRef.current = pose;
  }, [cameraRef]);

  const applyNativeFollow = useCallback((target: CameraPose, now: number) => {
    const prev = lastMapApplyRef.current;
    const sinceLastApply = lastNativeFollowApplyAtRef.current > 0
      ? now - lastNativeFollowApplyAtRef.current
      : NATIVE_FOLLOW_ANIM_MS;

    let centerDeltaM = 999;
    let headingDeltaDeg = 999;
    if (prev) {
      centerDeltaM = haversineMeters(
        prev.center.latitude,
        prev.center.longitude,
        target.center.latitude,
        target.center.longitude,
      );
      headingDeltaDeg = Math.abs(headingDelta(prev.heading, target.heading));
    }

    const significant =
      !prev
      || centerDeltaM >= NATIVE_APPLY_MIN_MOVE_M
      || headingDeltaDeg >= NATIVE_APPLY_MIN_HEADING_DEG
      || Math.abs((prev?.zoom ?? 0) - target.zoom) > 0.06
      || Math.abs((prev?.pitch ?? 0) - target.pitch) > 0.5;

    if (!significant && sinceLastApply < NATIVE_FOLLOW_MIN_INTERVAL_MS) {
      targetPoseRef.current = target;
      return;
    }

    if (sinceLastApply < NATIVE_FOLLOW_MIN_INTERVAL_MS && centerDeltaM < 6) {
      targetPoseRef.current = target;
      return;
    }

    const animMs = clampNum(
      sinceLastApply >= 220
        ? Math.min(sinceLastApply, NATIVE_FOLLOW_MAX_ANIM_MS)
        : NATIVE_FOLLOW_ANIM_MS,
      400,
      NATIVE_FOLLOW_MAX_ANIM_MS,
    );

    lastNativeFollowApplyAtRef.current = now;
    targetPoseRef.current = target;
    applyToMap(target, animMs, 'linear');
  }, [applyToMap]);

  useEffect(() => () => {
    clearGestureResumeTimer();
  }, [clearGestureResumeTimer]);

  const markUserGesture = useCallback(() => {
    if (!tripActiveRef.current) return;
    userPanUntilRef.current = Date.now() + RETURN_TO_USER_MS;
    modeRef.current = 'userPanning';
    clearGestureResumeTimer();
    gestureResumeTimerRef.current = setTimeout(() => {
      gestureResumeTimerRef.current = null;
      if (!tripActiveRef.current) return;
      resumeAfterUserGestureRef.current();
    }, RETURN_TO_USER_MS);
  }, [clearGestureResumeTimer]);

  const recenterTo = useCallback((params: {
    center: { latitude: number; longitude: number };
    heading: number;
    speedKmh: number;
    active: boolean;
    isNavigating?: boolean;
    instant?: boolean;
    entryAnim?: boolean;
  }) => {
    if (!Number.isFinite(params.center.latitude) || !Number.isFinite(params.center.longitude)) return;

    userPanUntilRef.current = 0;
    speedKmhRef.current = params.speedKmh;

    const heading = normalizeHeading(params.heading || 0);
    const entrySpeedKmh = params.active
      ? (params.speedKmh > 4
        ? Math.max(params.speedKmh, params.entryAnim ? 8 : 0)
        : 0)
      : params.speedKmh;
    const lookaheadM = params.active ? lookaheadFromSpeed(entrySpeedKmh) : 0;
    const center = offsetCenter(params.center.latitude, params.center.longitude, heading, lookaheadM);
    const tripNav = !!params.isNavigating || modeRef.current === 'navigationFollow';
    const pose: CameraPose = {
      center,
      heading,
      zoom: params.active ? zoomFromSpeed(entrySpeedKmh) : BROWSE_ZOOM,
      pitch: params.active ? ACTIVE_PITCH : BROWSE_PITCH,
      padding: params.active ? activeCameraPadding(tripNav) : ZERO_PADDING,
    };

    targetPoseRef.current = pose;
    travelHeadingRef.current = pose.heading;
    resolvedHeadingRef.current = pose.heading;
    lastResolvedHeadingAtRef.current = Date.now();
    lastVehicleCenterRef.current = { ...params.center };
    lastTravelUpdateAtRef.current = Date.now();
    if (params.active) {
      lastTargetZoomRef.current = pose.zoom;
    }

    const animMs = params.instant
      ? 0
      : params.entryAnim
        ? DRIVING_ENTRY_RECENTER_MS
        : RECENTER_ANIM_MS;

    if (params.instant) {
      modeRef.current = params.active ? 'drivingFollow' : 'idleBrowse';
      recenterLockUntilRef.current = 0;
      lastNativeFollowApplyAtRef.current = Date.now();
      applyToMap(pose, 0, 'linear');
      return;
    }

    modeRef.current = 'recenterTransition';
    recenterLockUntilRef.current = Date.now() + animMs;
    applyToMap(pose, animMs, 'easeTo');

    setTimeout(() => {
      displayPoseRef.current = pose;
      targetPoseRef.current = pose;
      lastMapApplyRef.current = pose;
      recenterLockUntilRef.current = 0;
      lastNativeFollowApplyAtRef.current = Date.now();
      modeRef.current = params.active ? 'drivingFollow' : 'idleBrowse';
    }, animMs + 60);
  }, [applyToMap]);

  const resetBrowseCamera = useCallback((
    center: { latitude: number; longitude: number },
    opts?: { animate?: boolean },
  ) => {
    releaseTripCameraState();
    recenterTo({
      center,
      heading: 0,
      speedKmh: 0,
      active: false,
      instant: opts?.animate !== true,
    });
  }, [recenterTo, releaseTripCameraState]);

  const updateCameraFrame = useCallback((input: CameraFrameInput) => {
    const now = input.timestamp ?? Date.now();
    speedKmhRef.current = input.speedKmh;
    lastFrameInputRef.current = input;
    tripActiveRef.current = input.isDriving || input.isNavigating;

    const nextMode = computeFollowMode({
      isDriving: input.isDriving,
      isNavigating: input.isNavigating,
      userPanUntilMs: userPanUntilRef.current,
    });
    modeRef.current = nextMode;

    if (nextMode === 'userPanning') {
      return;
    }

    let target = buildTargetPose(input, nextMode);
    if (!target) return;

    const active = isActiveFollowMode(nextMode);
    if (active) {
      const nowMs = now;
      const prevCenter = lastVehicleCenterRef.current;
      const prevResolvedHeading = resolvedHeadingRef.current ?? travelHeadingRef.current;
      let resolvedHeading = target.heading;
      let moveBearing: number | null = null;
      let movedM = 0;

      if (prevCenter) {
        movedM = haversineMeters(
          prevCenter.latitude,
          prevCenter.longitude,
          input.center.latitude,
          input.center.longitude,
        );
        if (movedM >= HEADING_VECTOR_MIN_MOVE_M) {
          moveBearing = bearingBetween(
            prevCenter.latitude,
            prevCenter.longitude,
            input.center.latitude,
            input.center.longitude,
          );
        }
      }

      if (input.speedKmh >= 14) {
        resolvedHeading = target.heading;
      } else if (moveBearing != null && input.speedKmh >= 12 && movedM >= 2.5) {
        const flipDelta = Math.abs(headingDelta(moveBearing, resolvedHeading));
        if (input.speedKmh >= 10 && flipDelta > 95) {
          resolvedHeading = moveBearing;
        }
        const vectorWeight = input.speedKmh >= 8
          ? clampNum(0.55 + (input.speedKmh - 8) / 140, 0.55, 0.78)
          : clampNum((input.speedKmh - 12) / 40, 0.15, 0.45);
        const blended = lerpHeading(resolvedHeading, moveBearing, vectorWeight);
        const maxVectorDiff = input.speedKmh >= 55 ? 28 : input.speedKmh >= 25 ? 38 : 52;
        resolvedHeading = lerpHeadingWithMaxStep(blended, moveBearing, maxVectorDiff);
      } else if (prevResolvedHeading != null && input.speedKmh < HEADING_LOW_SPEED_HOLD_KMH) {
        resolvedHeading = prevResolvedHeading;
      }

      if (prevResolvedHeading != null) {
        const prevResolvedAt = lastResolvedHeadingAtRef.current || nowMs;
        const dtSec = clampNum((nowMs - prevResolvedAt) / 1000, 0.016, 0.55);
        const impliedKmh = dtSec > 0 ? (movedM / dtSec) * 3.6 : 0;
        const turnRate = maxHeadingRateDegPerSec(Math.max(input.speedKmh, impliedKmh));
        const maxStep = turnRate * dtSec * 1.8 + 7;
        resolvedHeading = lerpHeadingWithMaxStep(prevResolvedHeading, resolvedHeading, maxStep);
        const flipDelta = Math.abs(headingDelta(prevResolvedHeading, resolvedHeading));
        if (input.speedKmh < 18 && flipDelta > HEADING_FLIP_GUARD_DEG) {
          resolvedHeading = lerpHeadingWithMaxStep(prevResolvedHeading, resolvedHeading, HEADING_LOW_SPEED_MAX_STEP_DEG);
        }
        if (input.speedKmh < HEADING_LOW_SPEED_HOLD_KMH && movedM < 1.2) {
          resolvedHeading = prevResolvedHeading;
        }
      }

      const headingIn = Math.round(target.heading);
      const headingOut = Math.round(resolvedHeading);
      const flipFromPrev = prevResolvedHeading != null
        ? Math.abs(headingDelta(prevResolvedHeading, resolvedHeading))
        : 0;
      markerLogTick('CAMERA_HEADING', {
        speedKmh: Math.round(input.speedKmh),
        movedM: Number(movedM.toFixed(2)),
        moveBearing: moveBearing != null ? Math.round(moveBearing) : null,
        headingIn,
        headingOut,
        flipFromPrevDeg: Math.round(flipFromPrev),
        usedSnapHeadingOnly: input.speedKmh >= 14,
        nativeFollow: true,
      }, 1100);

      resolvedHeading = normalizeHeading(resolvedHeading);
      lastResolvedHeadingAtRef.current = nowMs;
      lastTravelUpdateAtRef.current = nowMs;
      travelHeadingRef.current = resolvedHeading;
      resolvedHeadingRef.current = resolvedHeading;
      lastVehicleCenterRef.current = { ...input.center };
      const lookaheadM = lookaheadFromSpeed(input.speedKmh);
      target = {
        ...target,
        heading: resolvedHeading,
        center: offsetCenter(
          input.center.latitude,
          input.center.longitude,
          resolvedHeading,
          lookaheadM,
        ),
        zoom: smoothZoomTarget(lastTargetZoomRef.current, target.zoom),
      };
      lastTargetZoomRef.current = target.zoom;
    } else {
      lastTargetZoomRef.current = null;
      travelHeadingRef.current = null;
      resolvedHeadingRef.current = null;
      lastResolvedHeadingAtRef.current = 0;
      lastVehicleCenterRef.current = null;
      lastTravelUpdateAtRef.current = 0;
    }

    if (!active) {
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

    applyNativeFollow(target, now);
  }, [applyNativeFollow, applyToMap]);

  resumeAfterUserGestureRef.current = () => {
    if (!tripActiveRef.current) return;
    const now = Date.now();
    if (now < userPanUntilRef.current) return;

    const input = lastFrameInputRef.current;
    if (!input || (!input.isDriving && !input.isNavigating)) return;

    userPanUntilRef.current = 0;
    recenterTo({
      center: input.center,
      heading: input.heading,
      speedKmh: input.speedKmh,
      active: true,
      isNavigating: input.isNavigating,
    });
    updateCameraFrame({ ...input, timestamp: now });
  };

  const setFollowMode = useCallback((mode: 'idleBrowse' | 'drivingFollow' | 'navigationFollow') => {
    userPanUntilRef.current = 0;
    clearGestureResumeTimer();
    modeRef.current = mode;
    if (mode === 'idleBrowse') {
      tripActiveRef.current = false;
    }
  }, [clearGestureResumeTimer]);

  return {
    updateCameraFrame,
    markUserGesture,
    recenterTo,
    resetBrowseCamera,
    releaseTripCameraState,
    setFollowMode,
  };
}
