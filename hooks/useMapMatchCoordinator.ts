import { useCallback, useMemo, useRef, type MutableRefObject } from 'react';
import {
  MapMatchCoordinator,
  type MapMatchCoordinatorDeps,
  type MapMatchRecoveryRequest,
  type MatchedRoadPoint,
} from '../lib/mapMatch/MapMatchCoordinator';

export type {
  MapMatchRecoveryReason,
  MapMatchRecoveryRequest,
  MatchedRoadPoint,
  MapMatchCoordinatorMetrics,
} from '../lib/mapMatch/MapMatchCoordinator';

export { MapMatchCoordinator } from '../lib/mapMatch/MapMatchCoordinator';

type UseMapMatchCoordinatorArgs = Omit<MapMatchCoordinatorDeps, 'getSpeedKmh' | 'getHeading' | 'isDriving'> & {
  speedKmhRef: MutableRefObject<number>;
  lastHeadingRef: MutableRefObject<number>;
  isDrivingRef: MutableRefObject<boolean>;
};

export function useMapMatchCoordinator({
  forceMapMatch,
  getMatchedPoints,
  applySeqRef,
  speedKmhRef,
  lastHeadingRef,
  isDrivingRef,
  minStationarySpeedKmh,
  onLog,
}: UseMapMatchCoordinatorArgs) {
  const coordRef = useRef<MapMatchCoordinator | null>(null);

  if (!coordRef.current) {
    coordRef.current = new MapMatchCoordinator({
      forceMapMatch,
      getMatchedPoints,
      applySeqRef,
      getSpeedKmh: () => speedKmhRef.current,
      getHeading: () => lastHeadingRef.current,
      isDriving: () => isDrivingRef.current,
      minStationarySpeedKmh,
      onLog,
    });
  }

  const depsRef = useRef({
    forceMapMatch,
    getMatchedPoints,
    applySeqRef,
    speedKmhRef,
    lastHeadingRef,
    isDrivingRef,
    minStationarySpeedKmh,
    onLog,
  });
  depsRef.current = {
    forceMapMatch,
    getMatchedPoints,
    applySeqRef,
    speedKmhRef,
    lastHeadingRef,
    isDrivingRef,
    minStationarySpeedKmh,
    onLog,
  };

  coordRef.current.setDeps({
    forceMapMatch: (...args) => depsRef.current.forceMapMatch(...args),
    getMatchedPoints: () => depsRef.current.getMatchedPoints(),
    applySeqRef: depsRef.current.applySeqRef,
    getSpeedKmh: () => depsRef.current.speedKmhRef.current,
    getHeading: () => depsRef.current.lastHeadingRef.current,
    isDriving: () => depsRef.current.isDrivingRef.current,
    minStationarySpeedKmh: depsRef.current.minStationarySpeedKmh,
    onLog: depsRef.current.onLog,
  });

  const requestRecovery = useCallback(
    (req: MapMatchRecoveryRequest) => coordRef.current!.requestRecovery(req),
    [],
  );

  const allocRequestId = useCallback(
    () => coordRef.current!.allocRequestId(),
    [],
  );

  const isStaleRequest = useCallback(
    (requestId: number) => coordRef.current!.isStaleRequest(requestId),
    [],
  );

  const getCoordinatorMetrics = useCallback(
    () => coordRef.current!.getCoordinatorMetrics(),
    [],
  );

  const resetCoordinator = useCallback(() => {
    coordRef.current!.reset();
  }, []);

  const invalidateCoordinatorRequests = useCallback(() => {
    coordRef.current!.invalidateRequests();
  }, []);

  const scheduleHardRescueStaleRetry = useCallback(
    (
      resolveCoords: () => { lat: number; lng: number } | null,
      speedKmh: number,
      isStillStale: () => boolean,
    ) => {
      coordRef.current!.scheduleHardRescueStaleRetry(resolveCoords, speedKmh, isStillStale);
    },
    [],
  );

  return useMemo(
    () => ({
      requestRecovery,
      allocRequestId,
      isStaleRequest,
      getCoordinatorMetrics,
      resetCoordinator,
      invalidateCoordinatorRequests,
      scheduleHardRescueStaleRetry,
    }),
    [
      requestRecovery,
      allocRequestId,
      isStaleRequest,
      getCoordinatorMetrics,
      resetCoordinator,
      invalidateCoordinatorRequests,
      scheduleHardRescueStaleRetry,
    ],
  );
}
