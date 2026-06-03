import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Dimensions } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { markerLogTick } from '../lib/markerPipelineLog';
import {
  headingDelta,
  lerpHeadingWithMaxStep,
  normalizeHeading,
  resolveTravelHeading,
  TRAVEL_HEADING_VECTOR_MIN_MOVE_M,
} from '../lib/driveCore/travelHeading';

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
  /** Heading już z trip pipeline (marker + resolveTripTravelHeading) — bez drugiego resolveTravelHeading. */
  headingFromTripPipeline?: boolean;
  /** Czas segmentu GPS (ms) — liniowa animacja kamery jak marker. */
  segmentDurationMs?: number;
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
  // Nawigacja: większy paddingTop = marker niżej, więcej drogi przed autem (Waze).
  const top = Math.round(
    clampNum(h * (isNavigating ? 0.50 : 0.38), isNavigating ? 280 : 240, isNavigating ? 460 : 400)
    + hudPx * (isNavigating ? 0.18 : 0.26),
  );
  const bottom = Math.round(clampNum(tabBarPx + (isNavigating ? 12 : 20), 48, 88));
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
/** Ignoruj echo programmatic setCamera przy wykrywaniu gestu (ms). */
export const PROGRAMMATIC_CAMERA_GESTURE_GUARD_MS = 380;
/** Łagodny powrót po rozglądaniu się mapą — bez szarpnięcia zoomu. */
const SOFT_RETURN_ANIM_MS = 1400;
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
/** Czas animacji Mapbox między klatkami follow (~14–20 Hz z workletu markera). */
const NATIVE_FOLLOW_ANIM_MS = 95;
/** Min. odstęp setCamera — krótki, żeby łańcuchować płynne animacje bez „skoków”. */
const NATIVE_FOLLOW_MIN_INTERVAL_MS = 52;
const NATIVE_FOLLOW_MAX_ANIM_MS = 520;
const NATIVE_APPLY_MIN_MOVE_M = 0.08;
const NATIVE_APPLY_MIN_HEADING_DEG = 0.2;

const HEADING_VECTOR_MIN_MOVE_M = TRAVEL_HEADING_VECTOR_MIN_MOVE_M;
const HEADING_LOW_SPEED_HOLD_KMH = 5;
const HEADING_FLIP_GUARD_DEG = 105;
const HEADING_LOW_SPEED_MAX_STEP_DEG = 12;

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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

/** Zoom jazdy: wyższa wartość = bliżej (Mapbox). Przy 100+ km/h widok się oddala. */
function zoomFromSpeed(speedKmh: number): number {
  const s = Math.max(0, speedKmh);
  if (s <= 12) return 19.05;
  if (s <= 35) return lerpNum(19.05, 18.45, (s - 12) / 23);
  if (s <= 70) return lerpNum(18.45, 17.85, (s - 35) / 35);
  if (s <= 100) return lerpNum(17.85, 17.25, (s - 70) / 30);
  if (s <= 130) return lerpNum(17.25, 16.55, (s - 100) / 30);
  if (s <= 160) return lerpNum(16.55, 16.05, (s - 130) / 30);
  return lerpNum(16.05, 15.55, Math.min(1, (s - 160) / 45));
}

/** Prędkość do zoomu — bez szumu GPS / implied z workletu (nie cofaj kamery na postoju). */
export function cameraZoomSpeedKmh(input: {
  speedKmh: number;
  hudSpeedKmh?: number;
  frameMoveM?: number;
}): number {
  const hud = input.hudSpeedKmh ?? input.speedKmh;
  const moveM = input.frameMoveM ?? 0;
  if (hud < 3 && moveM < 1.5) return 0;
  if (hud < 12) return hud;
  return input.speedKmh;
}

/** Martwa strefa prędkości — zoom / lookahead nie reagują na szum GPS. */
const CAMERA_FOLLOW_SPEED_DEADZONE_KMH = 6;

function applyFollowSpeedHysteresis(nextKmh: number, prevKmh: number): number {
  const next = Math.max(0, nextKmh);
  const prev = Math.max(0, prevKmh);
  if (prev <= 0.5) return next;
  if (Math.abs(next - prev) < CAMERA_FOLLOW_SPEED_DEADZONE_KMH) {
    return prev;
  }
  return next;
}

/** Przesunięcie centrum mapy do przodu — więcej drogi przed autem przy wyższej prędkości. */
function lookaheadFromSpeed(speedKmh: number, isNavigating = false): number {
  const s = Math.max(0, speedKmh);
  let m = 0;
  if (s < 12) m = 0;
  else if (s <= 25) m = lerpNum(8, 22, (s - 12) / 13);
  else if (s <= 60) m = lerpNum(22, 52, (s - 25) / 35);
  else if (s <= 110) m = lerpNum(52, 72, (s - 60) / 50);
  else m = lerpNum(72, 92, Math.min(1, (s - 110) / 50));
  if (isNavigating && s >= 8) {
    m = m * 1.28 + 14;
  }
  return m;
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
  const lookaheadM = active ? lookaheadFromSpeed(input.speedKmh, isNavigating) : 0;
  const center = offsetCenter(
    input.center.latitude,
    input.center.longitude,
    targetHeading,
    lookaheadM,
  );
  const zoomSpeed = active
    ? cameraZoomSpeedKmh({ speedKmh: input.speedKmh })
    : 0;
  const rawZoom = active ? zoomFromSpeed(zoomSpeed) : BROWSE_ZOOM;
  return {
    center,
    heading: targetHeading,
    zoom: rawZoom,
    pitch: active ? ACTIVE_PITCH : BROWSE_PITCH,
    padding: active ? activeCameraPadding(isNavigating) : ZERO_PADDING,
  };
}

function smoothZoomTarget(prev: number | null, next: number, speedKmh = 0): number {
  if (prev == null || !Number.isFinite(prev)) return next;
  const maxStep = speedKmh >= 90 ? 0.09 : speedKmh >= 45 ? 0.07 : 0.05;
  const d = next - prev;
  if (Math.abs(d) <= maxStep) return next;
  return prev + Math.sign(d) * maxStep;
}

/** Low-pass na bearing — tłumi szum GPS przy małych deltach kąta. */
function lowPassHeadingStep(
  prev: number,
  target: number,
  dtSec: number,
  speedKmh: number,
  fromTripPipeline: boolean,
): number {
  const delta = Math.abs(headingDelta(prev, target));
  const tauSec = fromTripPipeline
    ? (delta < 6 ? 0.42 : delta < 16 ? 0.28 : 0.18)
    : (delta < 6 ? 0.55 : 0.32);
  const speedFactor = speedKmh >= 80 ? 1.15 : speedKmh >= 35 ? 1.05 : 0.92;
  const alpha = 1 - Math.exp(-dtSec / Math.max(tauSec / speedFactor, 0.04));
  const maxStep = Math.max(0.35, 95 * alpha);
  return lerpHeadingWithMaxStep(prev, target, maxStep);
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
  const stabilizedFollowSpeedRef = useRef(0);
  const tripActiveRef = useRef(false);
  const gestureResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAfterUserGestureRef = useRef<() => void>(() => {});
  const userExploreViewRef = useRef<{ zoom: number; pitch: number } | null>(null);
  /** Zoom ustawiony przez użytkownika (oddalenie) — bez auto-dociągania do zoomFromSpeed. */
  const userZoomOverrideRef = useRef<number | null>(null);

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
    userExploreViewRef.current = null;
    userZoomOverrideRef.current = null;
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
    stabilizedFollowSpeedRef.current = 0;
  }, [clearGestureResumeTimer]);

  const applyToMap = useCallback((
    pose: CameraPose,
    duration: number,
    animationMode: 'linear' | 'easeTo' = 'linear',
  ) => {
    if (
      tripActiveRef.current
      && (Date.now() < userPanUntilRef.current || modeRef.current === 'userPanning')
    ) {
      return;
    }
    const effectivePose = userZoomOverrideRef.current != null
      ? { ...pose, zoom: userZoomOverrideRef.current }
      : pose;
    const prev = lastMapApplyRef.current;
    if (prev && duration === 0) {
      const dm = haversineMeters(
        prev.center.latitude, prev.center.longitude,
        effectivePose.center.latitude, effectivePose.center.longitude,
      );
      const hdgD = Math.abs(headingDelta(prev.heading, effectivePose.heading));
      if (dm < 0.12 && hdgD < 0.35 && Math.abs(prev.zoom - effectivePose.zoom) < 0.002 && Math.abs(prev.pitch - effectivePose.pitch) < 0.08) {
        return;
      }
    }
    lastNativeFollowApplyAtRef.current = Date.now();
    (cameraRef.current as any)?.setCamera({
      centerCoordinate: [effectivePose.center.longitude, effectivePose.center.latitude],
      heading: effectivePose.heading,
      zoomLevel: effectivePose.zoom,
      pitch: effectivePose.pitch,
      padding: effectivePose.padding,
      animationMode,
      animationDuration: duration,
    });
    lastMapApplyRef.current = effectivePose;
    displayPoseRef.current = effectivePose;
  }, [cameraRef]);

  const applyNativeFollow = useCallback((
    target: CameraPose,
    now: number,
    segmentDurationMs?: number,
  ) => {
    if (
      tripActiveRef.current
      && (Date.now() < userPanUntilRef.current || modeRef.current === 'userPanning')
    ) {
      targetPoseRef.current = target;
      return;
    }
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

    if (sinceLastApply < NATIVE_FOLLOW_MIN_INTERVAL_MS && centerDeltaM < 1.2) {
      targetPoseRef.current = target;
      return;
    }

    const segDur = segmentDurationMs != null && segmentDurationMs > 0
      ? clampNum(segmentDurationMs, 220, 1200)
      : null;
    const animMs = segDur != null
      ? Math.min(segDur, NATIVE_FOLLOW_MAX_ANIM_MS)
      : clampNum(
        sinceLastApply >= 40
          ? Math.min(sinceLastApply + 32, NATIVE_FOLLOW_MAX_ANIM_MS)
          : NATIVE_FOLLOW_ANIM_MS,
        72,
        NATIVE_FOLLOW_MAX_ANIM_MS,
      );

    lastNativeFollowApplyAtRef.current = now;
    targetPoseRef.current = target;
    applyToMap(target, animMs, 'linear');
  }, [applyToMap]);

  useEffect(() => () => {
    clearGestureResumeTimer();
  }, [clearGestureResumeTimer]);

  const setTripCameraActive = useCallback((active: boolean) => {
    tripActiveRef.current = active;
  }, []);

  const getLastProgrammaticCameraApplyMs = useCallback(() => {
    return lastNativeFollowApplyAtRef.current;
  }, []);

  const isUserExploringMap = useCallback(() => {
    return modeRef.current === 'userPanning' || Date.now() < userPanUntilRef.current;
  }, []);

  const extendUserExploreSession = useCallback((now: number) => {
    userPanUntilRef.current = now + RETURN_TO_USER_MS;
    modeRef.current = 'userPanning';
    clearGestureResumeTimer();
    gestureResumeTimerRef.current = setTimeout(() => {
      gestureResumeTimerRef.current = null;
      if (!tripActiveRef.current) return;
      resumeAfterUserGestureRef.current();
    }, RETURN_TO_USER_MS);
  }, [clearGestureResumeTimer]);

  /** Pan/zoom w trybie jazdy — blokuje follow i zapamiętuje zoom użytkownika. */
  const notifyUserMapInteraction = useCallback((zoom?: number, pitch?: number) => {
    if (!tripActiveRef.current) return;
    const now = Date.now();
    if (Number.isFinite(zoom)) {
      userExploreViewRef.current = {
        zoom: zoom!,
        pitch: Number.isFinite(pitch) ? pitch! : (userExploreViewRef.current?.pitch ?? ACTIVE_PITCH),
      };
      userZoomOverrideRef.current = zoom!;
    } else {
      const display = displayPoseRef.current;
      if (display) {
        userExploreViewRef.current = {
          zoom: display.zoom,
          pitch: display.pitch,
        };
        userZoomOverrideRef.current = display.zoom;
      }
    }
    extendUserExploreSession(now);
  }, [extendUserExploreSession]);

  const syncUserExploreView = useCallback((zoom: number, pitch?: number) => {
    notifyUserMapInteraction(zoom, pitch);
  }, [notifyUserMapInteraction]);

  const markUserGesture = useCallback((_opts?: { force?: boolean }) => {
    notifyUserMapInteraction();
  }, [notifyUserMapInteraction]);

  const getLastAppliedCameraZoom = useCallback((): number | null => {
    const z = lastMapApplyRef.current?.zoom;
    return Number.isFinite(z) ? z! : null;
  }, []);

  const resumeTripCameraFollow = useCallback(() => {
    if (!tripActiveRef.current) return;
    userPanUntilRef.current = 0;
    clearGestureResumeTimer();
    resumeAfterUserGestureRef.current();
  }, [clearGestureResumeTimer]);

  const recenterTo = useCallback((params: {
    center: { latitude: number; longitude: number };
    heading: number;
    speedKmh: number;
    active: boolean;
    isNavigating?: boolean;
    instant?: boolean;
    entryAnim?: boolean;
    /** Powrót po pan/zoom — łagodna animacja (zoom zawsze jak w trybie jazdy). */
    softReturn?: boolean;
  }) => {
    if (!Number.isFinite(params.center.latitude) || !Number.isFinite(params.center.longitude)) return;

    userZoomOverrideRef.current = null;
    if (params.softReturn) {
      userExploreViewRef.current = null;
    }
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
    const targetZoom = params.active ? zoomFromSpeed(entrySpeedKmh) : BROWSE_ZOOM;
    const pose: CameraPose = {
      center,
      heading,
      zoom: targetZoom,
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
      : params.softReturn
        ? SOFT_RETURN_ANIM_MS
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
      lastVehicleCenterRef.current = { ...input.center };
      return;
    }

    const active = isActiveFollowMode(nextMode);
    let speedForPose = input.speedKmh;
    if (active) {
      speedForPose = applyFollowSpeedHysteresis(
        input.speedKmh,
        stabilizedFollowSpeedRef.current,
      );
      stabilizedFollowSpeedRef.current = speedForPose;
    } else {
      stabilizedFollowSpeedRef.current = 0;
    }

    let target = buildTargetPose({ ...input, speedKmh: speedForPose }, nextMode);
    if (!target) return;

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

      if (input.headingFromTripPipeline) {
        resolvedHeading = normalizeHeading(input.heading);
        if (prevResolvedHeading != null) {
          const flip = Math.abs(headingDelta(prevResolvedHeading, resolvedHeading));
          if (flip >= HEADING_FLIP_GUARD_DEG) {
            resolvedHeading = lerpHeadingWithMaxStep(
              prevResolvedHeading,
              resolvedHeading,
              input.speedKmh >= 25 ? 10 : 6,
            );
          }
          if (input.speedKmh < HEADING_LOW_SPEED_HOLD_KMH && movedM < 1.2) {
            resolvedHeading = prevResolvedHeading;
          }
        }
      } else {
        resolvedHeading = resolveTravelHeading({
          snapHeading: target.heading,
          moveBearing,
          movedM,
          speedKmh: input.speedKmh,
          prevHeading: prevResolvedHeading,
        });
        if (prevResolvedHeading != null) {
          const prevResolvedAt = lastResolvedHeadingAtRef.current || nowMs;
          const dtSec = clampNum((nowMs - prevResolvedAt) / 1000, 0.012, 0.12);
          const impliedKmh = dtSec > 0 ? (movedM / dtSec) * 3.6 : 0;
          const turnRate = maxHeadingRateDegPerSec(Math.max(input.speedKmh, impliedKmh));
          const rawDelta = Math.abs(headingDelta(prevResolvedHeading, resolvedHeading));
          const noiseScale = rawDelta < 7 ? 0.5 : rawDelta < 18 ? 0.75 : 1;
          const maxStep = (turnRate * dtSec * 1.8 + 7) * noiseScale;
          resolvedHeading = lerpHeadingWithMaxStep(prevResolvedHeading, resolvedHeading, maxStep);
          resolvedHeading = lowPassHeadingStep(
            prevResolvedHeading,
            resolvedHeading,
            dtSec,
            Math.max(input.speedKmh, impliedKmh),
            false,
          );
          const flipDelta = Math.abs(headingDelta(prevResolvedHeading, resolvedHeading));
          if (input.speedKmh < 18 && flipDelta > HEADING_FLIP_GUARD_DEG) {
            resolvedHeading = lerpHeadingWithMaxStep(prevResolvedHeading, resolvedHeading, HEADING_LOW_SPEED_MAX_STEP_DEG);
          }
          if (input.speedKmh < HEADING_LOW_SPEED_HOLD_KMH && movedM < 1.2) {
            resolvedHeading = prevResolvedHeading;
          }
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
        snapHdg: headingIn,
        headingOut,
        flipFromPrevDeg: Math.round(flipFromPrev),
        lookaheadM: Math.round(lookaheadFromSpeed(speedForPose)),
        nativeFollow: true,
      }, 1100);

      resolvedHeading = normalizeHeading(resolvedHeading);
      lastResolvedHeadingAtRef.current = nowMs;
      lastTravelUpdateAtRef.current = nowMs;
      travelHeadingRef.current = resolvedHeading;
      resolvedHeadingRef.current = resolvedHeading;
      lastVehicleCenterRef.current = { ...input.center };
      const zoomSpeed = cameraZoomSpeedKmh({
        speedKmh: speedForPose,
        hudSpeedKmh: speedForPose,
        frameMoveM: movedM,
      });
      const followZoom = zoomFromSpeed(zoomSpeed);
      const zoomTarget = userZoomOverrideRef.current != null
        ? userZoomOverrideRef.current
        : smoothZoomTarget(lastTargetZoomRef.current, followZoom, speedForPose);
      const lookaheadM = lookaheadFromSpeed(speedForPose);
      target = {
        ...target,
        heading: resolvedHeading,
        center: offsetCenter(
          input.center.latitude,
          input.center.longitude,
          resolvedHeading,
          lookaheadM,
        ),
        zoom: zoomTarget,
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

    applyNativeFollow(target, now, input.segmentDurationMs);
  }, [applyNativeFollow, applyToMap]);

  resumeAfterUserGestureRef.current = () => {
    if (!tripActiveRef.current) return;
    const now = Date.now();
    if (now < userPanUntilRef.current - 32) return;

    const input = lastFrameInputRef.current;
    const vehicle = lastVehicleCenterRef.current;
    if (!input && !vehicle) return;

    const center = input?.center ?? vehicle!;
    const heading = input?.heading
      ?? resolvedHeadingRef.current
      ?? travelHeadingRef.current
      ?? 0;
    const speedKmh = input?.speedKmh ?? speedKmhRef.current;
    const isNavigating = input?.isNavigating ?? (modeRef.current === 'navigationFollow');
    const isDriving = input?.isDriving ?? (tripActiveRef.current && !isNavigating);

    userPanUntilRef.current = 0;
    modeRef.current = isNavigating ? 'navigationFollow' : 'drivingFollow';
    recenterTo({
      center,
      heading,
      speedKmh,
      active: true,
      isNavigating,
      softReturn: true,
    });
    updateCameraFrame({
      center,
      heading,
      speedKmh,
      isNavigating,
      isDriving,
      timestamp: now,
      headingFromTripPipeline: true,
    });
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
    setTripCameraActive,
    getLastProgrammaticCameraApplyMs,
    isUserExploringMap,
    resumeTripCameraFollow,
    syncUserExploreView,
    notifyUserMapInteraction,
    getLastAppliedCameraZoom,
  };
}
