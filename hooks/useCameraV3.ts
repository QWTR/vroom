import { useCallback, useEffect, useRef, type RefObject } from 'react';
import Mapbox from '@rnmapbox/maps';
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
} from 'react-native-reanimated';
import { NAV_V3 } from '../lib/navigationV3/config';
import type { NavMode } from '../lib/navigationV3/types';
import {
  cameraZoomSpeedKmh,
  getTripCameraPadding,
} from './useCameraAnimation';
import type { DriveMarkerV3Values } from './useDriveMarkerV3';
import {
  headingDelta,
  lerpHeadingWithMaxStep,
  normalizeHeading,
} from '../lib/driveCore/travelHeading';
import {
  alignBearingToReference,
  bearingBetween,
} from '../scripts/navigationUtils';

export type UseCameraV3Options = {
  cameraRef: RefObject<Mapbox.Camera>;
  marker: DriveMarkerV3Values;
  enabled: boolean;
  mode: NavMode;
  speedKmhRef?: React.MutableRefObject<number>;
  isUserExploring?: () => boolean;
};

const BROWSE_ZOOM = 15;
const BROWSE_PITCH = 52;
const DRIVE_PITCH = 58;
const NAV_PITCH = 62;
const RETURN_FROM_EXPLORE_MS = 3000;
const USER_ZOOM_OVERRIDE_EPS = 0.04;

const FOLLOW_ANIM_MS = NAV_V3.CAMERA_NATIVE_ANIM_MS;
const FOLLOW_INTERVAL_MS = NAV_V3.CAMERA_FOLLOW_INTERVAL_MS;
const ZOOM_UPDATE_MS = NAV_V3.CAMERA_ZOOM_UPDATE_MS;
const SPEED_DEADZONE_KMH = NAV_V3.CAMERA_SPEED_DEADZONE_KMH;

/** Wolniejsze wygładzenie pozycji — mniej mikro-jitteru z workletu. */
const POS_EMA_ALPHA = 0.16;
const MIN_CENTER_MOVE_M = 0.12;
const MIN_HEADING_DEG = 0.22;
/** Min. ruch do wyliczenia kursu kamery z wektora ruchu (naprawia odwrócony bearing). */
const MIN_COURSE_MOVE_M = 0.35;
const MIN_COURSE_SPEED_KMH = 2.5;

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - s1 - s2));
}

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

function smoothZoomTarget(prev: number | null, next: number, speedKmh: number): number {
  if (prev == null || !Number.isFinite(prev)) return next;
  const maxStep = speedKmh >= 90 ? 0.022 : speedKmh >= 45 ? 0.018 : 0.012;
  const d = next - prev;
  if (Math.abs(d) <= maxStep) return next;
  return prev + Math.sign(d) * maxStep;
}

function applySpeedHysteresis(nextKmh: number, prevKmh: number): number {
  const next = Math.max(0, nextKmh);
  const prev = Math.max(0, prevKmh);
  if (prev <= 0.5) return next;
  if (Math.abs(next - prev) < SPEED_DEADZONE_KMH) return prev;
  return prev * 0.92 + next * 0.08;
}

/**
 * Kamera patrzy w kierunku jazdy — segment/polyline może być odwrócony o 180°.
 * Gdy jedziemy, wektor ruchu ma pierwszeństwo przed surowym headingiem markera.
 */
function resolveCameraCourseHeading(
  markerHeading: number,
  fromLat: number | null,
  fromLng: number | null,
  toLat: number,
  toLng: number,
  speedKmh: number,
): number {
  const markerHdg = normalizeHeading(markerHeading);
  if (
    fromLat == null
    || fromLng == null
    || !Number.isFinite(fromLat)
    || !Number.isFinite(fromLng)
    || speedKmh < MIN_COURSE_SPEED_KMH
  ) {
    return markerHdg;
  }
  const movedM = haversineM(fromLat, fromLng, toLat, toLng);
  if (movedM < MIN_COURSE_MOVE_M) {
    return markerHdg;
  }
  const moveBearing = bearingBetween(fromLat, fromLng, toLat, toLng);
  const aligned = alignBearingToReference(markerHdg, moveBearing);
  if (Math.abs(headingDelta(aligned, moveBearing)) > 35) {
    return moveBearing;
  }
  return aligned;
}

function maxHeadingRateDegPerSec(speedKmh: number): number {
  const s = Math.max(0, speedKmh);
  if (s < 2.5) return 18;
  if (s < 10) return 36;
  if (s < 35) return 52;
  if (s < 70) return 68;
  return NAV_V3.CAMERA_MAX_HEADING_DPS;
}

type SentPose = {
  lat: number;
  lng: number;
  heading: number;
  zoom: number;
  atMs: number;
};

/**
 * V3 camera — stabilny follow: długa natywna animacja, zoom rzadko i płynnie.
 */
export function useCameraV3(opts: UseCameraV3Options) {
  const {
    cameraRef,
    marker,
    enabled,
    mode,
    speedKmhRef,
    isUserExploring,
  } = opts;

  const lastPushMs = useSharedValue(0);
  const followEnabledSv = useSharedValue(enabled ? 1 : 0);

  const displayHeadingRef = useRef(0);
  const displayHeadingReadyRef = useRef(false);
  const prevCourseLatRef = useRef<number | null>(null);
  const prevCourseLngRef = useRef<number | null>(null);
  const smoothedLatRef = useRef<number | null>(null);
  const smoothedLngRef = useRef<number | null>(null);
  const smoothedSpeedRef = useRef(0);
  const smoothedZoomRef = useRef<number | null>(null);
  const lastSentRef = useRef<SentPose | null>(null);
  const lastNativeApplyRef = useRef(0);
  const lastZoomTickRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const userExploreUntilRef = useRef(0);
  const userZoomOverrideRef = useRef<number | null>(null);
  const userPanningRef = useRef(false);
  const cachedPaddingRef = useRef<ReturnType<typeof getTripCameraPadding> | null>(null);

  const isTripMode = mode === 'freeDrive' || mode === 'navigation';
  const isNavigating = mode === 'navigation';

  const release = useCallback(() => {
    followEnabledSv.value = 0;
    displayHeadingRef.current = 0;
    displayHeadingReadyRef.current = false;
    prevCourseLatRef.current = null;
    prevCourseLngRef.current = null;
    smoothedLatRef.current = null;
    smoothedLngRef.current = null;
    smoothedSpeedRef.current = 0;
    smoothedZoomRef.current = null;
    lastSentRef.current = null;
    lastNativeApplyRef.current = 0;
    lastZoomTickRef.current = 0;
    lastFrameAtRef.current = 0;
    userExploreUntilRef.current = 0;
    userZoomOverrideRef.current = null;
    userPanningRef.current = false;
    cachedPaddingRef.current = null;
  }, [followEnabledSv]);

  useEffect(() => {
    followEnabledSv.value = enabled && isTripMode ? 1 : 0;
    if (!enabled || !isTripMode) {
      release();
    }
  }, [enabled, isTripMode, followEnabledSv, release]);

  const setUserExploring = useCallback((exploring: boolean, resumeMs = RETURN_FROM_EXPLORE_MS) => {
    userPanningRef.current = exploring;
    userExploreUntilRef.current = exploring ? Date.now() + resumeMs : 0;
  }, []);

  const isPaused = useCallback((): boolean => {
    if (isUserExploring?.()) return true;
    if (userPanningRef.current) return true;
    if (userExploreUntilRef.current > Date.now()) return true;
    return false;
  }, [isUserExploring]);

  const applyCameraFrame = useCallback((
    lat: number,
    lng: number,
    markerHeading: number,
  ) => {
    if (!enabled || !isTripMode) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return;
    if (isPaused()) return;

    const now = Date.now();
    const prevAt = lastFrameAtRef.current > 0 ? lastFrameAtRef.current : now - FOLLOW_INTERVAL_MS;
    const dtSec = clampNum((now - prevAt) / 1000, 0.016, 0.14);
    lastFrameAtRef.current = now;

    const prevLat = smoothedLatRef.current;
    const prevLng = smoothedLngRef.current;
    const smoothLat = prevLat == null ? lat : prevLat + (lat - prevLat) * POS_EMA_ALPHA;
    const smoothLng = prevLng == null ? lng : prevLng + (lng - prevLng) * POS_EMA_ALPHA;
    smoothedLatRef.current = smoothLat;
    smoothedLngRef.current = smoothLng;

    const hudKmh = Math.max(0, speedKmhRef?.current ?? 0);
    smoothedSpeedRef.current = applySpeedHysteresis(hudKmh, smoothedSpeedRef.current);

    const courseFromMotion = resolveCameraCourseHeading(
      markerHeading,
      prevCourseLatRef.current,
      prevCourseLngRef.current,
      smoothLat,
      smoothLng,
      smoothedSpeedRef.current,
    );
    prevCourseLatRef.current = smoothLat;
    prevCourseLngRef.current = smoothLng;

    const targetHdg = courseFromMotion;
    const maxHdgStep = maxHeadingRateDegPerSec(smoothedSpeedRef.current) * dtSec;
    const hdgFlip = displayHeadingReadyRef.current
      ? Math.abs(headingDelta(displayHeadingRef.current, targetHdg))
      : 180;
    if (!displayHeadingReadyRef.current) {
      displayHeadingRef.current = targetHdg;
      displayHeadingReadyRef.current = true;
    } else if (hdgFlip > 90) {
      displayHeadingRef.current = targetHdg;
    } else if (hdgFlip > 25) {
      displayHeadingRef.current = lerpHeadingWithMaxStep(
        displayHeadingRef.current,
        targetHdg,
        Math.max(maxHdgStep, hdgFlip * 0.65),
      );
    } else {
      displayHeadingRef.current = lerpHeadingWithMaxStep(
        displayHeadingRef.current,
        targetHdg,
        maxHdgStep,
      );
    }

    const sinceLastApply = lastNativeApplyRef.current > 0
      ? now - lastNativeApplyRef.current
      : FOLLOW_ANIM_MS;
    const prevSent = lastSentRef.current;

    let centerDeltaM = 999;
    let headingDeltaDeg = 999;
    if (prevSent) {
      centerDeltaM = haversineM(prevSent.lat, prevSent.lng, smoothLat, smoothLng);
      headingDeltaDeg = Math.abs(headingDelta(prevSent.heading, displayHeadingRef.current));
    }

    if (
      prevSent
      && sinceLastApply < FOLLOW_INTERVAL_MS
      && centerDeltaM < MIN_CENTER_MOVE_M
      && headingDeltaDeg < MIN_HEADING_DEG
    ) {
      return;
    }

    if (
      prevSent
      && sinceLastApply < FOLLOW_ANIM_MS * 0.75
      && centerDeltaM < 0.5
      && headingDeltaDeg < 1.5
    ) {
      return;
    }

    const zoomSpeed = cameraZoomSpeedKmh({
      speedKmh: smoothedSpeedRef.current,
      hudSpeedKmh: hudKmh,
      frameMoveM: centerDeltaM,
    });
    const rawZoom = zoomFromSpeed(zoomSpeed) - 0.3;

    let zoom = smoothedZoomRef.current;
    if (zoom == null || now - lastZoomTickRef.current >= ZOOM_UPDATE_MS) {
      zoom = smoothZoomTarget(smoothedZoomRef.current, rawZoom, smoothedSpeedRef.current);
      smoothedZoomRef.current = zoom;
      lastZoomTickRef.current = now;
    }

    const effectiveZoom = userZoomOverrideRef.current ?? zoom;
    const zoomChanged = !prevSent || Math.abs(prevSent.zoom - effectiveZoom) >= 0.025;
    const significant =
      !prevSent
      || centerDeltaM >= MIN_CENTER_MOVE_M
      || headingDeltaDeg >= MIN_HEADING_DEG
      || zoomChanged;

    if (!significant) return;

    if (!cachedPaddingRef.current) {
      cachedPaddingRef.current = getTripCameraPadding(isNavigating);
    }
    const padding = cachedPaddingRef.current;
    const pitch = isNavigating ? NAV_PITCH : DRIVE_PITCH;

    (cameraRef.current as { setCamera?: (cfg: object) => void } | null)?.setCamera?.({
      centerCoordinate: [smoothLng, smoothLat],
      heading: displayHeadingRef.current,
      zoomLevel: effectiveZoom,
      pitch,
      padding,
      animationDuration: FOLLOW_ANIM_MS,
      animationMode: 'linearTo',
    });

    lastNativeApplyRef.current = now;
    lastSentRef.current = {
      lat: smoothLat,
      lng: smoothLng,
      heading: displayHeadingRef.current,
      zoom: effectiveZoom,
      atMs: now,
    };
  }, [
    cameraRef,
    enabled,
    isNavigating,
    isPaused,
    isTripMode,
    speedKmhRef,
  ]);

  const applyCameraFrameRef = useRef(applyCameraFrame);
  applyCameraFrameRef.current = applyCameraFrame;

  const onMarkerFrame = useCallback((lat: number, lng: number, hdg: number) => {
    applyCameraFrameRef.current(lat, lng, hdg);
  }, []);

  useAnimatedReaction(
    () => ({
      lat: marker.lat.value,
      lng: marker.lng.value,
      hdg: marker.heading.value,
      follow: followEnabledSv.value,
    }),
    (next, prev) => {
      if (next.follow < 0.5) return;
      if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;
      if (Math.abs(next.lat) < 1e-6 && Math.abs(next.lng) < 1e-6) return;
      if (
        prev
        && Math.abs(next.lat - prev.lat) < 1e-9
        && Math.abs(next.lng - prev.lng) < 1e-9
        && Math.abs(next.hdg - prev.hdg) < 0.12
      ) {
        return;
      }
      const now = Date.now();
      if (lastPushMs.value > 0 && now - lastPushMs.value < FOLLOW_INTERVAL_MS) {
        return;
      }
      lastPushMs.value = now;
      runOnJS(onMarkerFrame)(next.lat, next.lng, next.hdg);
    },
    [onMarkerFrame],
  );

  const recenter = useCallback((
    center: { latitude: number; longitude: number },
    opts?: { heading?: number; speedKmh?: number; animate?: boolean },
  ) => {
    if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) return;

    const rawHdg = normalizeHeading(opts?.heading ?? displayHeadingRef.current);
    const hdg = resolveCameraCourseHeading(
      rawHdg,
      prevCourseLatRef.current,
      prevCourseLngRef.current,
      center.latitude,
      center.longitude,
      opts?.speedKmh ?? speedKmhRef?.current ?? 0,
    );
    displayHeadingRef.current = hdg;
    displayHeadingReadyRef.current = true;
    smoothedLatRef.current = center.latitude;
    smoothedLngRef.current = center.longitude;
    prevCourseLatRef.current = center.latitude;
    prevCourseLngRef.current = center.longitude;
    userPanningRef.current = false;
    userExploreUntilRef.current = 0;

    const speedKmh = opts?.speedKmh ?? speedKmhRef?.current ?? 0;
    smoothedSpeedRef.current = speedKmh;
    const zoom = zoomFromSpeed(speedKmh) - 0.3;
    smoothedZoomRef.current = zoom;
    lastZoomTickRef.current = Date.now();
    cachedPaddingRef.current = getTripCameraPadding(isNavigating);

    const animate = opts?.animate !== false;
    const duration = animate ? 480 : FOLLOW_ANIM_MS;

    (cameraRef.current as { setCamera?: (cfg: object) => void } | null)?.setCamera?.({
      centerCoordinate: [center.longitude, center.latitude],
      heading: hdg,
      zoomLevel: zoom,
      pitch: isNavigating ? NAV_PITCH : DRIVE_PITCH,
      padding: cachedPaddingRef.current,
      animationDuration: duration,
      animationMode: animate ? 'easeTo' : 'linearTo',
    });

    lastNativeApplyRef.current = Date.now();
    lastSentRef.current = {
      lat: center.latitude,
      lng: center.longitude,
      heading: hdg,
      zoom,
      atMs: Date.now(),
    };
  }, [cameraRef, isNavigating, speedKmhRef]);

  const resetBrowseCamera = useCallback((
    center: { latitude: number; longitude: number },
    opts?: { animate?: boolean },
  ) => {
    release();
    const animate = opts?.animate !== false;
    (cameraRef.current as { setCamera?: (cfg: object) => void } | null)?.setCamera?.({
      centerCoordinate: [center.longitude, center.latitude],
      heading: 0,
      zoomLevel: BROWSE_ZOOM,
      pitch: BROWSE_PITCH,
      padding: {
        paddingLeft: 0,
        paddingRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
      },
      animationDuration: animate ? 900 : 0,
      animationMode: animate ? 'easeTo' : 'linear',
    });
  }, [cameraRef, release]);

  const notifyUserMapInteraction = useCallback((zoomLevel?: number) => {
    setUserExploring(true);
    if (zoomLevel != null && Number.isFinite(zoomLevel)) {
      userZoomOverrideRef.current = zoomLevel;
    }
  }, [setUserExploring]);

  const clearUserZoomOverride = useCallback(() => {
    if (userZoomOverrideRef.current == null) return;
    const current = smoothedZoomRef.current ?? BROWSE_ZOOM;
    if (Math.abs(current - userZoomOverrideRef.current) < USER_ZOOM_OVERRIDE_EPS) {
      userZoomOverrideRef.current = null;
    }
  }, []);

  return {
    recenter,
    resetBrowseCamera,
    setUserExploring,
    notifyUserMapInteraction,
    clearUserZoomOverride,
    release,
    isUserExploring: isPaused,
  };
}

export { getTripCameraPadding };
