import { useCallback, useMemo, useRef } from 'react';
import {
  DriveTrackingPipeline,
  type FilteredGpsFix,
  type GpsFixInput,
  type LatLng,
  type SnapContext,
  type SnapResult,
} from '../lib/driveTracking';
import type { LegacySnapInput } from '../lib/driveTracking/types';
import { vroomGpsLog } from '../lib/vroomGpsLog';

export type UseDriveTrackingPipelineResult = {
  reset: () => void;
  filterGpsFix: (input: GpsFixInput) => FilteredGpsFix;
  stabilizeSpeedKmh: (
    displayKmh: number,
    meta: {
      rawGpsKmh: number;
      derivedKmh: number;
      sustainedKmh: number;
      netMoveM: number;
      pathMoveM: number;
      isTripActive: boolean;
    },
    nowMs?: number,
  ) => number;
  refineSnap: (legacy: LegacySnapInput, ctx: SnapContext) => SnapResult;
  buildRoadWindow: (geometry: LatLng[], lat: number, lng: number) => LatLng[] | null;
  predictBetweenFixes: (
    from: LatLng,
    speedMs: number,
    headingDeg: number,
    dtMs: number,
    roadPts: LatLng[] | null,
  ) => LatLng;
};

/**
 * React hook wrapper around DriveTrackingPipeline (stable instance per map screen).
 */
export function useDriveTrackingPipeline(): UseDriveTrackingPipelineResult {
  const pipelineRef = useRef<DriveTrackingPipeline | null>(null);
  if (!pipelineRef.current) {
    pipelineRef.current = new DriveTrackingPipeline({
      onReject: (reason, payload) => {
        vroomGpsLog('DT_GPS_REJECT', { reason, ...(payload ?? {}) }, 1200);
      },
    });
  }

  const reset = useCallback(() => {
    pipelineRef.current?.reset();
  }, []);

  const filterGpsFix = useCallback((input: GpsFixInput) => {
    return pipelineRef.current!.filterGpsFix(input);
  }, []);

  const stabilizeSpeedKmh = useCallback((
    displayKmh: number,
    meta: Parameters<UseDriveTrackingPipelineResult['stabilizeSpeedKmh']>[1],
    nowMs = Date.now(),
  ) => {
    return pipelineRef.current!.stabilizeSpeedKmh(displayKmh, meta, nowMs);
  }, []);

  const refineSnap = useCallback((legacy: LegacySnapInput, ctx: SnapContext) => {
    return pipelineRef.current!.refineSnap(legacy, ctx);
  }, []);

  const buildRoadWindow = useCallback((geometry: LatLng[], lat: number, lng: number) => {
    return pipelineRef.current!.buildRoadWindow(geometry, lat, lng);
  }, []);

  const predictBetweenFixes = useCallback((
    from: LatLng,
    speedMs: number,
    headingDeg: number,
    dtMs: number,
    roadPts: LatLng[] | null,
  ) => {
    return pipelineRef.current!.predictBetweenFixes(from, speedMs, headingDeg, dtMs, roadPts);
  }, []);

  return useMemo(() => ({
    reset,
    filterGpsFix,
    stabilizeSpeedKmh,
    refineSnap,
    buildRoadWindow,
    predictBetweenFixes,
  }), [reset, filterGpsFix, stabilizeSpeedKmh, refineSnap, buildRoadWindow, predictBetweenFixes]);
}
