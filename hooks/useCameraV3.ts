import { useCallback, useEffect, useRef, type RefObject } from 'react';
import Mapbox from '@rnmapbox/maps';
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withSpring,
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
  normalizeHeading,
} from '../lib/driveCore/travelHeading';
import { bearingBetween } from '../scripts/navigationUtils';

export type RawGpsCourseRef = React.MutableRefObject<{
  lat: number;
  lng: number;
} | null>;

export type UseCameraV3Options = {
  cameraRef: RefObject<Mapbox.Camera>;
  marker: DriveMarkerV3Values;
  enabled: boolean;
  mode: NavMode;
  speedKmhRef?: React.MutableRefObject<number>;
  /** Surowy GPS — wyłącznie z tego COG dla bearingu kamery (nie polilinia / marker). */
  rawGpsRef?: RawGpsCourseRef;
  isUserExploring?: () => boolean;
  /** Wstrzymaj kamerę podczas reroute (off-route + pending API). */
  shouldPauseFollow?: () => boolean;
};

const BROWSE_ZOOM = 15;
const BROWSE_PITCH = 52;
const DRIVE_PITCH = 58;
const NAV_PITCH = 62;
const RETURN_FROM_EXPLORE_MS = 3000;
const USER_ZOOM_OVERRIDE_EPS = 0.04;

const ZOOM_UPDATE_MS = NAV_V3.CAMERA_ZOOM_UPDATE_MS;
const SPEED_DEADZONE_KMH = NAV_V3.CAMERA_SPEED_DEADZONE_KMH;
const MIN_COURSE_MOVE_M = 0.35;
const MIN_COURSE_SPEED_KMH = NAV_V3.CAMERA_COG_MIN_SPEED_KMH;

const THROTTLE_FAST_MS = NAV_V3.CAMERA_THROTTLE_FAST_MS;
const THROTTLE_MID_MS = NAV_V3.CAMERA_THROTTLE_MID_MS;
const THROTTLE_SLOW_MS = NAV_V3.CAMERA_THROTTLE_SLOW_MS;
const THROTTLE_SPEED_FAST_KMH = NAV_V3.CAMERA_THROTTLE_SPEED_FAST_KMH;
const THROTTLE_SPEED_SLOW_KMH = NAV_V3.CAMERA_THROTTLE_SPEED_SLOW_KMH;
const THROTTLE_STAND_KMH = NAV_V3.CAMERA_THROTTLE_STAND_KMH;
const DELTA_MIN_DIST_M = NAV_V3.CAMERA_DELTA_MIN_DIST_M;
const DELTA_MIN_HEADING_DEG = NAV_V3.CAMERA_DELTA_MIN_HEADING_DEG;
const STAND_HEADING_DEG = NAV_V3.CAMERA_STAND_HEADING_DEG;
const NATIVE_ANIM_BUFFER_MS = NAV_V3.CAMERA_NATIVE_ANIM_BUFFER_MS;
const CAMERA_EASE_DURATION_MS = NAV_V3.CAMERA_EASE_DURATION_MS;

const HEADING_SPRING = {
  stiffness: NAV_V3.CAMERA_HEADING_SPRING_STIFFNESS,
  damping: NAV_V3.CAMERA_HEADING_SPRING_DAMPING,
};

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

function haversineMWorklet(aLat: number, aLng: number, bLat: number, bLng: number): number {
  'worklet';
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

function resolveCameraThrottleMsWorklet(speedKmh: number): number {
  'worklet';
  const s = Math.max(0, speedKmh);
  if (s <= THROTTLE_STAND_KMH) return THROTTLE_SLOW_MS;
  if (s < THROTTLE_SPEED_SLOW_KMH) return THROTTLE_SLOW_MS;
  if (s <= THROTTLE_SPEED_FAST_KMH) return THROTTLE_MID_MS;
  return THROTTLE_FAST_MS;
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
 * Bearing kamery — wyłącznie Course Over Ground z surowego GPS (dwa ostatnie fixy).
 */
export function resolveCameraCourseHeading(
  lockedHeading: number,
  prevGpsLat: number | null,
  prevGpsLng: number | null,
  currGpsLat: number,
  currGpsLng: number,
  speedKmh: number,
): number {
  const lockHdg = normalizeHeading(
    Number.isFinite(lockedHeading) && lockedHeading >= 0 ? lockedHeading : 0,
  );

  if (
    prevGpsLat == null
    || prevGpsLng == null
    || !Number.isFinite(prevGpsLat)
    || !Number.isFinite(prevGpsLng)
    || !Number.isFinite(currGpsLat)
    || !Number.isFinite(currGpsLng)
    || speedKmh < MIN_COURSE_SPEED_KMH
  ) {
    return lockHdg;
  }

  const movedM = haversineM(prevGpsLat, prevGpsLng, currGpsLat, currGpsLng);
  if (movedM < MIN_COURSE_MOVE_M) {
    return lockHdg;
  }

  return bearingBetween(prevGpsLat, prevGpsLng, currGpsLat, currGpsLng);
}

type SentPose = {
  lat: number;
  lng: number;
  heading: number;
  zoom: number;
  atMs: number;
};

/**
 * V3 camera — translacja natychmiastowa (lat/lng), obrót niezależny (withSpring SV).
 */
export function useCameraV3(opts: UseCameraV3Options) {
  const {
    cameraRef,
    marker,
    enabled,
    mode,
    speedKmhRef,
    rawGpsRef,
    isUserExploring,
    shouldPauseFollow,
  } = opts;

  const shouldPauseFollowRef = useRef(shouldPauseFollow);
  shouldPauseFollowRef.current = shouldPauseFollow;

  const followEnabledSv = useSharedValue(enabled ? 1 : 0);
  const targetCameraHeadingSv = useSharedValue(0);
  const smoothedCameraHeadingSv = useSharedValue(0);
  const headingSpringReadySv = useSharedValue(0);

  const speedKmhSv = useSharedValue(0);
  const lastCameraPushMsSv = useSharedValue(0);
  const lastSentReadySv = useSharedValue(0);
  const lastSentLatSv = useSharedValue(0);
  const lastSentLngSv = useSharedValue(0);
  const lastSentHdgSv = useSharedValue(0);

  const lockedCourseHeadingRef = useRef(0);
  const lockedCourseReadyRef = useRef(false);
  const prevRawGpsLatRef = useRef<number | null>(null);
  const prevRawGpsLngRef = useRef<number | null>(null);
  const smoothedSpeedRef = useRef(0);
  const smoothedZoomRef = useRef<number | null>(null);
  const lastSentRef = useRef<SentPose | null>(null);
  const lastZoomTickRef = useRef(0);
  const userExploreUntilRef = useRef(0);
  const userZoomOverrideRef = useRef<number | null>(null);
  const userPanningRef = useRef(false);
  const cachedPaddingRef = useRef<ReturnType<typeof getTripCameraPadding> | null>(null);

  const isTripMode = mode === 'freeDrive' || mode === 'navigation';
  const isNavigating = mode === 'navigation';

  const resetHeadingSpringState = useCallback(() => {
    targetCameraHeadingSv.value = 0;
    smoothedCameraHeadingSv.value = 0;
    headingSpringReadySv.value = 0;
    lastCameraPushMsSv.value = 0;
    lastSentReadySv.value = 0;
    lastSentLatSv.value = 0;
    lastSentLngSv.value = 0;
    lastSentHdgSv.value = 0;
  }, [
    headingSpringReadySv,
    lastCameraPushMsSv,
    lastSentHdgSv,
    lastSentLatSv,
    lastSentLngSv,
    lastSentReadySv,
    smoothedCameraHeadingSv,
    targetCameraHeadingSv,
  ]);

  const release = useCallback(() => {
    followEnabledSv.value = 0;
    lockedCourseHeadingRef.current = 0;
    lockedCourseReadyRef.current = false;
    prevRawGpsLatRef.current = null;
    prevRawGpsLngRef.current = null;
    smoothedSpeedRef.current = 0;
    smoothedZoomRef.current = null;
    lastSentRef.current = null;
    lastZoomTickRef.current = 0;
    userExploreUntilRef.current = 0;
    userZoomOverrideRef.current = null;
    userPanningRef.current = false;
    cachedPaddingRef.current = null;
    speedKmhSv.value = 0;
    resetHeadingSpringState();
  }, [followEnabledSv, resetHeadingSpringState, speedKmhSv]);

  useEffect(() => {
    followEnabledSv.value = enabled && isTripMode ? 1 : 0;
    if (!enabled || !isTripMode) {
      release();
    }
  }, [enabled, isTripMode, followEnabledSv, release]);

  /** Utrzymuj speedKmhSv dla adaptacyjnego throttlingu na worklecie. */
  useEffect(() => {
    if (!enabled || !isTripMode) return;
    const tick = setInterval(() => {
      const v = Math.max(0, speedKmhRef?.current ?? 0);
      if (Math.abs(v - speedKmhSv.value) > 0.3) {
        speedKmhSv.value = v;
      }
    }, 200);
    return () => clearInterval(tick);
  }, [enabled, isTripMode, speedKmhRef, speedKmhSv]);

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

  const syncCourseHeadingTarget = useCallback((markerHeading: number) => {
    const hudKmh = Math.max(0, speedKmhRef?.current ?? 0);
    smoothedSpeedRef.current = applySpeedHysteresis(hudKmh, smoothedSpeedRef.current);
    speedKmhSv.value = smoothedSpeedRef.current;

    const rawGps = rawGpsRef?.current;
    const hasRawGps = rawGps != null
      && Number.isFinite(rawGps.lat)
      && Number.isFinite(rawGps.lng);
    const currGpsLat = hasRawGps ? rawGps!.lat : NaN;
    const currGpsLng = hasRawGps ? rawGps!.lng : NaN;

    const targetBearing = hasRawGps
      ? resolveCameraCourseHeading(
        lockedCourseHeadingRef.current,
        prevRawGpsLatRef.current,
        prevRawGpsLngRef.current,
        currGpsLat,
        currGpsLng,
        smoothedSpeedRef.current,
      )
      : lockedCourseHeadingRef.current;

    const movedForLock = hasRawGps
      && prevRawGpsLatRef.current != null
      && prevRawGpsLngRef.current != null
      ? haversineM(prevRawGpsLatRef.current, prevRawGpsLngRef.current, currGpsLat, currGpsLng)
      : 0;
    if (
      smoothedSpeedRef.current >= MIN_COURSE_SPEED_KMH
      && movedForLock >= MIN_COURSE_MOVE_M
    ) {
      lockedCourseHeadingRef.current = targetBearing;
      lockedCourseReadyRef.current = true;
    } else if (!lockedCourseReadyRef.current) {
      const coldHdg = Number.isFinite(markerHeading) && markerHeading >= 0
        ? markerHeading
        : 0;
      lockedCourseHeadingRef.current = normalizeHeading(coldHdg);
      lockedCourseReadyRef.current = true;
    }

    if (hasRawGps) {
      prevRawGpsLatRef.current = currGpsLat;
      prevRawGpsLngRef.current = currGpsLng;
    }

    const courseTarget = normalizeHeading(lockedCourseHeadingRef.current);

    if (headingSpringReadySv.value < 0.5) {
      targetCameraHeadingSv.value = courseTarget;
      smoothedCameraHeadingSv.value = courseTarget;
      headingSpringReadySv.value = 1;
      return;
    }

    targetCameraHeadingSv.value = courseTarget;
  }, [
    headingSpringReadySv,
    rawGpsRef,
    smoothedCameraHeadingSv,
    speedKmhRef,
    speedKmhSv,
    targetCameraHeadingSv,
  ]);

  const syncCourseHeadingTargetRef = useRef(syncCourseHeadingTarget);
  syncCourseHeadingTargetRef.current = syncCourseHeadingTarget;

  useAnimatedReaction(
    () => targetCameraHeadingSv.value,
    (target, prev) => {
      if (headingSpringReadySv.value < 0.5) return;
      if (prev != null && Math.abs(headingDelta(prev, target)) < 0.02) return;

      const cur = smoothedCameraHeadingSv.value;
      const springTarget = cur + headingDelta(cur, target);
      smoothedCameraHeadingSv.value = withSpring(springTarget, HEADING_SPRING);
    },
    [headingSpringReadySv, smoothedCameraHeadingSv, targetCameraHeadingSv],
  );

  const markSentPose = useCallback((
    lat: number,
    lng: number,
    heading: number,
    zoom: number,
    atMs: number,
  ) => {
    lastSentRef.current = { lat, lng, heading, zoom, atMs };
    lastSentReadySv.value = 1;
    lastSentLatSv.value = lat;
    lastSentLngSv.value = lng;
    lastSentHdgSv.value = heading;
  }, [lastSentHdgSv, lastSentLatSv, lastSentLngSv, lastSentReadySv]);

  const emitCameraKeyframe = useCallback((
    lat: number,
    lng: number,
    heading: number,
    markerHeading: number,
    throttleMs: number,
  ) => {
    if (!enabled || !isTripMode) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return;
    if (isPaused()) return;

    syncCourseHeadingTargetRef.current(markerHeading);

    const now = Date.now();
    const hudKmh = Math.max(0, speedKmhRef?.current ?? 0);
    const speedKmh = smoothedSpeedRef.current > 0 ? smoothedSpeedRef.current : hudKmh;

    const prevSent = lastSentRef.current;
    let centerDeltaM = 999;
    let headingDeltaDeg = 999;
    if (prevSent) {
      centerDeltaM = haversineM(prevSent.lat, prevSent.lng, lat, lng);
      headingDeltaDeg = Math.abs(headingDelta(prevSent.heading, heading));
      if (centerDeltaM < DELTA_MIN_DIST_M && headingDeltaDeg < DELTA_MIN_HEADING_DEG) {
        return;
      }
    }

    const zoomSpeed = cameraZoomSpeedKmh({
      speedKmh,
      hudSpeedKmh: hudKmh,
      frameMoveM: centerDeltaM,
    });
    const rawZoom = zoomFromSpeed(zoomSpeed) - 0.3;

    let zoom = smoothedZoomRef.current;
    if (zoom == null || now - lastZoomTickRef.current >= ZOOM_UPDATE_MS) {
      zoom = smoothZoomTarget(smoothedZoomRef.current, rawZoom, speedKmh);
      smoothedZoomRef.current = zoom;
      lastZoomTickRef.current = now;
    }

    const effectiveZoom = userZoomOverrideRef.current ?? zoom;
    const zoomChanged = !prevSent || Math.abs(prevSent.zoom - effectiveZoom) >= 0.025;
    if (
      prevSent
      && centerDeltaM < DELTA_MIN_DIST_M
      && headingDeltaDeg < DELTA_MIN_HEADING_DEG
      && !zoomChanged
    ) {
      return;
    }

    if (!cachedPaddingRef.current) {
      cachedPaddingRef.current = getTripCameraPadding(isNavigating);
    }
    const padding = cachedPaddingRef.current;
    const pitch = isNavigating ? NAV_PITCH : DRIVE_PITCH;
    const animMs = Math.max(
      CAMERA_EASE_DURATION_MS,
      Math.ceil(throttleMs) + NATIVE_ANIM_BUFFER_MS,
    );
    const displayHeading = normalizeHeading(heading);

    (cameraRef.current as { setCamera?: (cfg: object) => void } | null)?.setCamera?.({
      centerCoordinate: [lng, lat],
      heading: displayHeading,
      zoomLevel: effectiveZoom,
      pitch,
      padding,
      animationDuration: animMs,
      animationMode: 'easeTo',
    });

    markSentPose(lat, lng, displayHeading, effectiveZoom, now);
  }, [
    cameraRef,
    enabled,
    isNavigating,
    isPaused,
    isTripMode,
    markSentPose,
    speedKmhRef,
  ]);

  const emitCameraKeyframeRef = useRef(emitCameraKeyframe);
  emitCameraKeyframeRef.current = emitCameraKeyframe;

  const onEmitCameraKeyframe = useCallback((
    lat: number,
    lng: number,
    heading: number,
    markerHeading: number,
    throttleMs: number,
  ) => {
    emitCameraKeyframeRef.current(lat, lng, heading, markerHeading, throttleMs);
  }, []);

  useAnimatedReaction(
    () => ({
      lat: marker.lat.value,
      lng: marker.lng.value,
      markerHdg: marker.heading.value,
      camHdg: normalizeHeading(smoothedCameraHeadingSv.value),
      follow: followEnabledSv.value,
      speed: speedKmhSv.value,
    }),
    (next) => {
      if (next.follow < 0.5) return;
      if (shouldPauseFollowRef.current?.()) return;
      if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;
      if (Math.abs(next.lat) < 1e-6 && Math.abs(next.lng) < 1e-6) return;

      const speed = Math.max(0, next.speed);
      const throttleMs = resolveCameraThrottleMsWorklet(speed);
      const now = Date.now();

      let distM = 999;
      let hdgD = 999;
      if (lastSentReadySv.value >= 0.5) {
        distM = haversineMWorklet(
          lastSentLatSv.value,
          lastSentLngSv.value,
          next.lat,
          next.lng,
        );
        hdgD = Math.abs(headingDelta(lastSentHdgSv.value, next.camHdg));
        if (distM < DELTA_MIN_DIST_M && hdgD < DELTA_MIN_HEADING_DEG) {
          return;
        }
      }

      if (speed <= THROTTLE_STAND_KMH) {
        if (lastSentReadySv.value >= 0.5 && hdgD < STAND_HEADING_DEG && distM < DELTA_MIN_DIST_M) {
          return;
        }
      } else if (lastCameraPushMsSv.value > 0 && now - lastCameraPushMsSv.value < throttleMs) {
        return;
      }

      lastCameraPushMsSv.value = now;
      runOnJS(onEmitCameraKeyframe)(
        next.lat,
        next.lng,
        next.camHdg,
        next.markerHdg,
        throttleMs,
      );
    },
    [
      followEnabledSv,
      lastCameraPushMsSv,
      lastSentHdgSv,
      lastSentLatSv,
      lastSentLngSv,
      lastSentReadySv,
      marker.heading,
      marker.lat,
      marker.lng,
      onEmitCameraKeyframe,
      smoothedCameraHeadingSv,
      speedKmhSv,
    ],
  );

  const recenter = useCallback((
    center: { latitude: number; longitude: number },
    opts?: { heading?: number; speedKmh?: number; animate?: boolean },
  ) => {
    if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) return;

    const rawGps = rawGpsRef?.current;
    const gpsLat = rawGps != null && Number.isFinite(rawGps.lat) ? rawGps.lat : center.latitude;
    const gpsLng = rawGps != null && Number.isFinite(rawGps.lng) ? rawGps.lng : center.longitude;
    const hdg = resolveCameraCourseHeading(
      lockedCourseHeadingRef.current,
      prevRawGpsLatRef.current,
      prevRawGpsLngRef.current,
      gpsLat,
      gpsLng,
      opts?.speedKmh ?? speedKmhRef?.current ?? 0,
    );
    const finalHdg = normalizeHeading(
      opts?.heading != null && Number.isFinite(opts.heading)
        ? opts.heading
        : hdg,
    );
    lockedCourseHeadingRef.current = finalHdg;
    lockedCourseReadyRef.current = true;
    targetCameraHeadingSv.value = finalHdg;
    smoothedCameraHeadingSv.value = finalHdg;
    headingSpringReadySv.value = 1;
    prevRawGpsLatRef.current = gpsLat;
    prevRawGpsLngRef.current = gpsLng;
    userPanningRef.current = false;
    userExploreUntilRef.current = 0;

    const speedKmh = opts?.speedKmh ?? speedKmhRef?.current ?? 0;
    smoothedSpeedRef.current = speedKmh;
    speedKmhSv.value = speedKmh;
    const zoom = zoomFromSpeed(speedKmh) - 0.3;
    smoothedZoomRef.current = zoom;
    lastZoomTickRef.current = Date.now();
    cachedPaddingRef.current = getTripCameraPadding(isNavigating);

    const animate = opts?.animate === true;

    (cameraRef.current as { setCamera?: (cfg: object) => void } | null)?.setCamera?.({
      centerCoordinate: [center.longitude, center.latitude],
      heading: finalHdg,
      zoomLevel: zoom,
      pitch: isNavigating ? NAV_PITCH : DRIVE_PITCH,
      padding: cachedPaddingRef.current,
      animationDuration: animate ? 480 : 0,
      animationMode: animate ? 'easeTo' : 'linearTo',
    });

    markSentPose(center.latitude, center.longitude, finalHdg, zoom, Date.now());
    lastCameraPushMsSv.value = Date.now();
  }, [
    cameraRef,
    headingSpringReadySv,
    isNavigating,
    lastCameraPushMsSv,
    markSentPose,
    rawGpsRef,
    smoothedCameraHeadingSv,
    speedKmhRef,
    speedKmhSv,
    targetCameraHeadingSv,
  ]);

  const resumeFromBackground = useCallback(() => {
    prevRawGpsLatRef.current = null;
    prevRawGpsLngRef.current = null;
    lastSentRef.current = null;
    resetHeadingSpringState();
  }, [resetHeadingSpringState]);

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
    resumeFromBackground,
    isUserExploring: isPaused,
    smoothedCameraHeading: smoothedCameraHeadingSv,
    targetCameraHeading: targetCameraHeadingSv,
  };
}

export { getTripCameraPadding };
