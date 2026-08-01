import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { MAP_PERF } from '../../constants/mapPerformance';
import { useMapTick, MAP_TICK } from '../useMapTick';
import { driveTraceHeartbeat } from '../../lib/driveSessionTrace';
import { vroomGpsLog } from '../../lib/vroomGpsLog';
import { haversineKm } from '../../scripts/navigationUtils';

export type MapTripRefs = {
  isDrivingRef: MutableRefObject<boolean>;
  isNavigatingRef: MutableRefObject<boolean>;
  lastGoodLocRef: MutableRefObject<{ lat: number; lng: number } | null>;
  lastGpsTickAtRef: MutableRefObject<number>;
  lastAcceptedFixWallClockRef: MutableRefObject<number>;
  drLastFrameAtRef: MutableRefObject<number>;
  drLatRef: MutableRefObject<number>;
  drLngRef: MutableRefObject<number>;
  lastSetLocRef: MutableRefObject<{ lat: number; lng: number } | null>;
  speedKmhRef: MutableRefObject<number>;
  offRouteRef: MutableRefObject<boolean>;
  reroutePendingRef: MutableRefObject<boolean>;
  routePointsRef: MutableRefObject<{ latitude: number; longitude: number }[]>;
};

export type UseMapTripLifecycleParams = {
  isDriving: boolean;
  isNavigating: boolean;
  /** Keep screen on only while the map tab is focused. */
  isMapFocused?: boolean;
  rerouteOrigin: unknown;
  refs: MapTripRefs;
};

const KEEP_AWAKE_TAG = 'vroom-map-nav';

/** Keep-awake, drive heartbeat trace, and drive health logging during trip. */
export function useMapTripLifecycle(params: UseMapTripLifecycleParams) {
  const { isDriving, isNavigating, isMapFocused = true, rerouteOrigin, refs } = params;
  const tripActive = isDriving || isNavigating;
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', setAppState);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const shouldKeep = tripActive && isMapFocused && appState === 'active';
    if (shouldKeep) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    }
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [tripActive, isMapFocused, appState]);

  const heartbeat = useCallback(() => {
    const loc = refs.lastGoodLocRef.current;
    driveTraceHeartbeat({
      driving: refs.isDrivingRef.current,
      navigating: refs.isNavigatingRef.current,
      tripActive: refs.isDrivingRef.current || refs.isNavigatingRef.current,
      lat: loc?.lat,
      lng: loc?.lng,
      gpsAgeMs: refs.lastGpsTickAtRef.current > 0 ? Date.now() - refs.lastGpsTickAtRef.current : null,
    });
  }, [refs]);

  const driveHealth = useCallback(() => {
    if (AppState.currentState !== 'active') return;
    const now = Date.now();
    const gpsAgeMs = refs.lastAcceptedFixWallClockRef.current > 0
      ? now - refs.lastAcceptedFixWallClockRef.current
      : Number.POSITIVE_INFINITY;
    const drAgeMs = refs.drLastFrameAtRef.current > 0
      ? now - refs.drLastFrameAtRef.current
      : Number.POSITIVE_INFINITY;
    const gpsToDriftM = (
      refs.lastGoodLocRef.current
      && refs.drLatRef.current !== 0
      && refs.drLngRef.current !== 0
    )
      ? haversineKm(
        refs.lastGoodLocRef.current.lat,
        refs.lastGoodLocRef.current.lng,
        refs.drLatRef.current,
        refs.drLngRef.current,
      ) * 1000
      : null;
    const snapAnchorDriftM = (
      refs.lastSetLocRef.current
      && refs.drLatRef.current !== 0
      && refs.drLngRef.current !== 0
    )
      ? haversineKm(
        refs.lastSetLocRef.current.lat,
        refs.lastSetLocRef.current.lng,
        refs.drLatRef.current,
        refs.drLngRef.current,
      ) * 1000
      : null;
    vroomGpsLog('DRIVE_HEALTH', {
      mode: refs.isNavigatingRef.current ? 'navigation' : (refs.isDrivingRef.current ? 'driving' : 'idle'),
      speedHudKmh: Number((refs.speedKmhRef.current || 0).toFixed(1)),
      speedPipeKmh: Number((refs.speedKmhRef.current || 0).toFixed(1)),
      gpsAgeMs: Number.isFinite(gpsAgeMs) ? Math.round(gpsAgeMs) : null,
      drAgeMs: Number.isFinite(drAgeMs) ? Math.round(drAgeMs) : null,
      gpsToDriftM: gpsToDriftM != null ? Math.round(gpsToDriftM) : null,
      snapAnchorDriftM: snapAnchorDriftM != null ? Math.round(snapAnchorDriftM) : null,
      offRoute: refs.offRouteRef.current,
      reroutePending: refs.reroutePendingRef.current,
      rerouteLoading: rerouteOrigin != null || refs.reroutePendingRef.current,
      hasRoutePts: refs.routePointsRef.current.length,
    }, MAP_PERF.driveHealthLog);
  }, [refs, rerouteOrigin]);

  useEffect(() => {
    if (!tripActive) return;
    heartbeat();
  }, [tripActive, heartbeat]);

  useMapTick(MAP_TICK.heartbeat, [heartbeat, driveHealth], tripActive);
}
