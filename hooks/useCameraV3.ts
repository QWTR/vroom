import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import Mapbox from '@rnmapbox/maps';
import { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import type { NavMode } from '../lib/navigationV3/types';
import { getTripCameraPadding } from './useCameraAnimation';
import type { DriveMarkerV3Values } from './useDriveMarkerV3';
import { normalizeHeading } from '../lib/driveCore/travelHeading';
import { nativeFollowerFrameFromMarker } from '../lib/driveCore/tripCameraFollow';
import { bearingBetween } from '../scripts/navigationUtils';

export type RawGpsCourseRef = React.MutableRefObject<{ lat: number; lng: number } | null>;

export type UseCameraV3Options = {
  cameraRef: RefObject<Mapbox.Camera | null>;
  marker: DriveMarkerV3Values;
  enabled: boolean;
  mode: NavMode;
  speedKmhRef?: React.MutableRefObject<number>;
  rawGpsRef?: RawGpsCourseRef;
  isUserExploring?: () => boolean;
};

const BROWSE_ZOOM = 15;
const BROWSE_PITCH = 52;
const DRIVE_PITCH = 58;
const NAV_PITCH = 62;
const DRIVE_ZOOM = 18.1;
const NAV_ZOOM = 17.65;
const RETURN_FROM_EXPLORE_MS = 4000;
const MIN_COURSE_MOVE_M = 0.35;
const MIN_COURSE_SPEED_KMH = 3;

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - s1 - s2));
}

/** Kept for route/telemetry callers. The active trip camera uses the marker heading. */
export function resolveCameraCourseHeading(
  lockedHeading: number,
  prevGpsLat: number | null,
  prevGpsLng: number | null,
  currGpsLat: number,
  currGpsLng: number,
  speedKmh: number,
): number {
  const fallback = normalizeHeading(Number.isFinite(lockedHeading) ? lockedHeading : 0);
  if (prevGpsLat == null || prevGpsLng == null || !Number.isFinite(currGpsLat) || !Number.isFinite(currGpsLng) || speedKmh < MIN_COURSE_SPEED_KMH) {
    return fallback;
  }
  return haversineM(prevGpsLat, prevGpsLng, currGpsLat, currGpsLng) < MIN_COURSE_MOVE_M
    ? fallback
    : bearingBetween(prevGpsLat, prevGpsLng, currGpsLat, currGpsLng);
}

/**
 * During a trip this hook owns camera policy, not camera movement. Movement is
 * applied by VroomMapCameraFollower from the marker's rendered SharedValues.
 */
export function useCameraV3(opts: UseCameraV3Options) {
  const { cameraRef, marker, enabled, mode, speedKmhRef, isUserExploring } = opts;
  const isTripMode = mode === 'freeDrive' || mode === 'navigation';
  const isNavigating = mode === 'navigation';
  const [nativeFollowEnabled, setNativeFollowEnabled] = useState(enabled && isTripMode);
  const userPanningRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetCameraHeading = useSharedValue(0);
  const smoothedCameraHeading = useSharedValue(0);

  const stopResumeTimer = useCallback(() => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const release = useCallback(() => {
    stopResumeTimer();
    userPanningRef.current = false;
    setNativeFollowEnabled(false);
  }, [stopResumeTimer]);

  const armTripFollow = useCallback((heading?: number) => {
    if (heading != null && Number.isFinite(heading)) {
      const normalized = normalizeHeading(heading);
      targetCameraHeading.value = normalized;
      smoothedCameraHeading.value = normalized;
    }
    stopResumeTimer();
    userPanningRef.current = false;
    setNativeFollowEnabled(true);
  }, [smoothedCameraHeading, stopResumeTimer, targetCameraHeading]);

  useEffect(() => {
    if (enabled && isTripMode) {
      setNativeFollowEnabled(true);
    } else {
      release();
    }
  }, [enabled, isTripMode, release]);

  useEffect(() => () => stopResumeTimer(), [stopResumeTimer]);

  const setUserExploring = useCallback((exploring: boolean, resumeMs = RETURN_FROM_EXPLORE_MS) => {
    stopResumeTimer();
    userPanningRef.current = exploring;
    setNativeFollowEnabled(!exploring);
    if (exploring) {
      resumeTimerRef.current = setTimeout(() => {
        userPanningRef.current = false;
        setNativeFollowEnabled(true);
        resumeTimerRef.current = null;
      }, resumeMs);
    }
  }, [stopResumeTimer]);

  const isPaused = useCallback(() => Boolean(isUserExploring?.() || userPanningRef.current), [isUserExploring]);

  const recenter = useCallback((
    center: { latitude: number; longitude: number },
    options?: { heading?: number; speedKmh?: number; animate?: boolean; coldStart?: boolean },
  ) => {
    if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) return;
    const heading = normalizeHeading(options?.heading ?? marker.heading.value ?? 0);
    armTripFollow(heading);

    // A one-off browse/cold-start pose is allowed. Once the native follower is
    // enabled, it owns all continuous position updates.
    // A trip cold-start is owned by the native follower. It reads Mapbox's
    // current framing and blends into the driving frame without a competing snap.
    if ((!enabled || !isTripMode) && !options?.coldStart) {
      const speed = Math.max(0, options?.speedKmh ?? speedKmhRef?.current ?? 0);
      (cameraRef.current as { setCamera?: (cfg: object) => void } | null)?.setCamera?.({
        centerCoordinate: [center.longitude, center.latitude],
        heading,
        zoomLevel: Math.max(15.5, 18.75 - Math.min(speed, 120) / 120 * 2.2),
        pitch: isNavigating ? NAV_PITCH : DRIVE_PITCH,
        padding: getTripCameraPadding(isNavigating),
        animationDuration: options?.animate ? 280 : 0,
        animationMode: options?.animate ? 'easeTo' : 'linearTo',
      });
    }
  }, [armTripFollow, cameraRef, enabled, isNavigating, isTripMode, marker.heading, speedKmhRef]);

  const resetBrowseCamera = useCallback((center: { latitude: number; longitude: number }, options?: { animate?: boolean }) => {
    release();
    (cameraRef.current as { setCamera?: (cfg: object) => void } | null)?.setCamera?.({
      centerCoordinate: [center.longitude, center.latitude],
      heading: 0,
      zoomLevel: BROWSE_ZOOM,
      pitch: BROWSE_PITCH,
      padding: { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 },
      animationDuration: options?.animate === false ? 0 : 900,
      animationMode: options?.animate === false ? 'linear' : 'easeTo',
    });
  }, [cameraRef, release]);

  const resumeFollow = useCallback(() => armTripFollow(marker.heading.value), [armTripFollow, marker.heading]);
  const notifyUserMapInteraction = useCallback((_zoomLevel?: number) => setUserExploring(true), [setUserExploring]);
  const clearUserZoomOverride = useCallback(() => undefined, []);
  const resumeFromBackground = useCallback(() => undefined, []);

  const animatedProps = useAnimatedProps(() => {
    'worklet';
    const frame = nativeFollowerFrameFromMarker({
      lat: marker.lat.value,
      lng: marker.lng.value,
      heading: marker.heading.value,
    }, marker.speedMs.value);
    return {
      ...frame,
      segmentDurationMs: marker.segmentDurationMs.value,
    };
  });

  return {
    recenter,
    armTripFollow,
    resetBrowseCamera,
    setUserExploring,
    notifyUserMapInteraction,
    clearUserZoomOverride,
    resumeFollow,
    release,
    resumeFromBackground,
    isUserExploring: isPaused,
    smoothedCameraHeading,
    targetCameraHeading,
    nativeFollowEnabled,
    useNativeTripFollow: true,
    nativeFollower: {
      enabled: Boolean(enabled && isTripMode && nativeFollowEnabled),
      zoom: isNavigating ? NAV_ZOOM : DRIVE_ZOOM,
      pitch: isNavigating ? NAV_PITCH : DRIVE_PITCH,
      padding: getTripCameraPadding(isNavigating),
      animatedProps,
    },
  };
}

export { getTripCameraPadding };
