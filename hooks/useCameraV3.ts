import { useCallback, useEffect, useRef, type RefObject } from 'react';
import Mapbox from '@rnmapbox/maps';
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
} from 'react-native-reanimated';
import { NAV_V3 } from '../lib/navigationV3/config';
import type { NavMode } from '../lib/navigationV3/types';
import { getTripCameraPadding } from './useCameraAnimation';
import type { DriveMarkerV3Values } from './useDriveMarkerV3';
import {
  lerpHeadingWithMaxStep,
  normalizeHeading,
} from '../lib/driveCore/travelHeading';

export type UseCameraV3Options = {
  cameraRef: RefObject<Mapbox.Camera>;
  marker: DriveMarkerV3Values;
  enabled: boolean;
  mode: NavMode;
  /** HUD speed (km/h) — aktualizowany przez pipeline; fallback gdy brak ruchu. */
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
const POS_EMA_ALPHA = 0.38;
const HDG_EMA_ALPHA = 0.28;

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

/**
 * Przesuwa punkt wzdłuż kierunku jazdy (bearing: 0° = północ, 90° = wschód).
 * Dodatni offset = do przodu względem markera → kamera siedzi za autem.
 */
function offsetCenter(
  lat: number,
  lng: number,
  headingDeg: number,
  offsetMeters: number,
): { latitude: number; longitude: number } {
  if (!Number.isFinite(offsetMeters) || offsetMeters <= 0) {
    return { latitude: lat, longitude: lng };
  }
  const hdg = normalizeHeading(headingDeg);
  const R = 6371000;
  const headingRad = (hdg * Math.PI) / 180;
  const dLat = (offsetMeters * Math.cos(headingRad)) / R;
  const dLng =
    (offsetMeters * Math.sin(headingRad))
    / (R * Math.cos((lat * Math.PI) / 180));
  return {
    latitude: lat + (dLat * 180) / Math.PI,
    longitude: lng + (dLng * 180) / Math.PI,
  };
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

function lookaheadFromSpeed(speedKmh: number, isNavigating: boolean): number {
  const s = Math.max(0, speedKmh);
  let m = 0;
  if (s < 18) m = 0;
  else if (s <= 40) m = lerpNum(0, 10, (s - 18) / 22);
  else if (s <= 80) m = lerpNum(10, 18, (s - 40) / 40);
  else m = lerpNum(18, 24, Math.min(1, (s - 80) / 50));
  if (isNavigating && s >= 18) {
    m = m * 1.06 + 3;
  }
  return m;
}

function maxHeadingRateDegPerSec(speedKmh: number): number {
  const s = Math.max(0, speedKmh);
  if (s < 2.5) return 22;
  if (s < 10) return 48;
  if (s < 35) return 72;
  if (s < 70) return 95;
  return NAV_V3.CAMERA_MAX_HEADING_DPS;
}

/**
 * V3 camera — obserwator markera @ ~30 FPS + natywna interpolacja Mapbox.
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
  const smoothedLatRef = useRef<number | null>(null);
  const smoothedLngRef = useRef<number | null>(null);
  const smoothedZoomRef = useRef<number | null>(null);
  const smoothedLookaheadRef = useRef(0);
  const smoothedSpeedRef = useRef(0);
  const lastCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastFrameAtRef = useRef(0);
  const userExploreUntilRef = useRef(0);
  const userZoomOverrideRef = useRef<number | null>(null);
  const userPanningRef = useRef(false);

  const isTripMode = mode === 'freeDrive' || mode === 'navigation';
  const isNavigating = mode === 'navigation';

  const release = useCallback(() => {
    followEnabledSv.value = 0;
    displayHeadingRef.current = 0;
    smoothedLatRef.current = null;
    smoothedLngRef.current = null;
    smoothedZoomRef.current = null;
    smoothedLookaheadRef.current = 0;
    smoothedSpeedRef.current = 0;
    lastCenterRef.current = null;
    lastFrameAtRef.current = 0;
    userExploreUntilRef.current = 0;
    userZoomOverrideRef.current = null;
    userPanningRef.current = false;
  }, [followEnabledSv]);

  useEffect(() => {
    followEnabledSv.value = enabled && isTripMode ? 1 : 0;
    if (!enabled || !isTripMode) {
      release();
    }
  }, [enabled, isTripMode, followEnabledSv, release]);

  const setUserExploring = useCallback((exploring: boolean, resumeMs = RETURN_FROM_EXPLORE_MS) => {
    userPanningRef.current = exploring;
    if (exploring) {
      userExploreUntilRef.current = Date.now() + resumeMs;
    } else {
      userExploreUntilRef.current = 0;
    }
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
    const prevAt = lastFrameAtRef.current > 0 ? lastFrameAtRef.current : now - 32;
    const dtSec = clampNum((now - prevAt) / 1000, 0.012, 0.12);
    lastFrameAtRef.current = now;

    const prevLat = smoothedLatRef.current;
    const prevLng = smoothedLngRef.current;
    const smoothLat = prevLat == null ? lat : prevLat + (lat - prevLat) * POS_EMA_ALPHA;
    const smoothLng = prevLng == null ? lng : prevLng + (lng - prevLng) * POS_EMA_ALPHA;
    smoothedLatRef.current = smoothLat;
    smoothedLngRef.current = smoothLng;

    const prevCenter = lastCenterRef.current;
    const frameMoveM = prevCenter
      ? haversineM(prevCenter.lat, prevCenter.lng, smoothLat, smoothLng)
      : 0;
    lastCenterRef.current = { lat: smoothLat, lng: smoothLng };

    const impliedKmh = frameMoveM > 0.05
      ? Math.min(220, (frameMoveM / dtSec) * 3.6)
      : 0;
    const refKmh = speedKmhRef?.current ?? 0;
    let speedKmh = Math.max(refKmh, impliedKmh);
    if (speedKmh < 3 && frameMoveM < 1.2) {
      speedKmh = 0;
    }
    smoothedSpeedRef.current = smoothedSpeedRef.current <= 0.5
      ? speedKmh
      : smoothedSpeedRef.current * 0.88 + speedKmh * 0.12;

    const markerHdg = normalizeHeading(markerHeading);
    const maxHdgStep = maxHeadingRateDegPerSec(smoothedSpeedRef.current) * dtSec;
    const followHdg = displayHeadingRef.current <= 0.01
      ? markerHdg
      : lerpHeadingWithMaxStep(displayHeadingRef.current, markerHdg, maxHdgStep);
    displayHeadingRef.current = lerpHeadingWithMaxStep(
      followHdg,
      markerHdg,
      Math.max(1.5, 360 * dtSec * 3 * HDG_EMA_ALPHA),
    );

    const targetLookahead = lookaheadFromSpeed(smoothedSpeedRef.current, isNavigating);
    smoothedLookaheadRef.current = smoothedLookaheadRef.current <= 0.5
      ? targetLookahead
      : smoothedLookaheadRef.current * 0.9 + targetLookahead * 0.1;

    // Segment-sync: marker = center geograficzny; framing tylko przez padding (jak V2).
    // Lekki lookahead tylko przy wyższych prędkościach — bez podwójnego przesunięcia.
    const useLookahead = smoothedLookaheadRef.current > 2 && smoothedSpeedRef.current >= 18;
    const center = useLookahead
      ? offsetCenter(smoothLat, smoothLng, displayHeadingRef.current, smoothedLookaheadRef.current)
      : { latitude: smoothLat, longitude: smoothLng };

    const rawZoom = zoomFromSpeed(smoothedSpeedRef.current);
    const prevZoom = smoothedZoomRef.current;
    const zoom = prevZoom == null
      ? rawZoom
      : prevZoom + Math.sign(rawZoom - prevZoom) * Math.min(Math.abs(rawZoom - prevZoom), 0.06);
    smoothedZoomRef.current = zoom;

    const padding = getTripCameraPadding(isNavigating);
    const pitch = isNavigating ? NAV_PITCH : DRIVE_PITCH;
    const effectiveZoom = userZoomOverrideRef.current != null
      ? userZoomOverrideRef.current
      : zoom;

    (cameraRef.current as { setCamera?: (cfg: object) => void } | null)?.setCamera?.({
      centerCoordinate: [center.longitude, center.latitude],
      heading: displayHeadingRef.current,
      zoomLevel: effectiveZoom,
      pitch,
      padding,
      animationDuration: FOLLOW_ANIM_MS,
      animationMode: 'linear',
    });
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
        && Math.abs(next.hdg - prev.hdg) < 0.04
      ) {
        return;
      }
      const now = Date.now();
      if (lastPushMs.value > 0 && now - lastPushMs.value < NAV_V3.CAMERA_FOLLOW_INTERVAL_MS) {
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

    const hdg = normalizeHeading(opts?.heading ?? displayHeadingRef.current);
    displayHeadingRef.current = hdg;
    smoothedLatRef.current = center.latitude;
    smoothedLngRef.current = center.longitude;
    lastCenterRef.current = { lat: center.latitude, lng: center.longitude };
    userPanningRef.current = false;
    userExploreUntilRef.current = 0;

    const speedKmh = opts?.speedKmh ?? speedKmhRef?.current ?? 0;
    smoothedSpeedRef.current = speedKmh;
    const lookahead = lookaheadFromSpeed(speedKmh, isNavigating);
    smoothedLookaheadRef.current = lookahead;
    const zoom = zoomFromSpeed(speedKmh);
    smoothedZoomRef.current = zoom;

    const target = lookahead > 2
      ? offsetCenter(center.latitude, center.longitude, hdg, lookahead)
      : center;
    const padding = getTripCameraPadding(isNavigating);
    const pitch = isNavigating ? NAV_PITCH : DRIVE_PITCH;
    const animate = opts?.animate !== false;

    (cameraRef.current as { setCamera?: (cfg: object) => void } | null)?.setCamera?.({
      centerCoordinate: [target.longitude, target.latitude],
      heading: hdg,
      zoomLevel: zoom,
      pitch,
      padding,
      animationDuration: animate ? 480 : FOLLOW_ANIM_MS,
      animationMode: animate ? 'easeTo' : 'linear',
    });
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
