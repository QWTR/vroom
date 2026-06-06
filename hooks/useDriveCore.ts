import { useCallback, useEffect, useRef } from 'react';
import { DriveEngine } from '../lib/driveCore/driveEngine';
import type { DriveTickOutput, RawGpsFix, RoadPoint } from '../lib/driveCore/types';
import type { ApiMetrics } from '../lib/driveCore/apiBudgetManager';

export type UseDriveCoreOptions = {
  isDriving: boolean;
  isNavigating: boolean;
  /** Ref — GPS nie czeka na re-render po setIsDriving(true). */
  getTripActive?: () => boolean;
  routePoints?: RoadPoint[];
  onTick?: (out: DriveTickOutput) => void;
  onPoseAfterMatch?: (out: DriveTickOutput) => void;
};

export function useDriveCore(opts: UseDriveCoreOptions) {
  const engineRef = useRef<DriveEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new DriveEngine();
  }
  const engine = engineRef.current;

  const onTickRef = useRef(opts.onTick);
  const onMatchRef = useRef(opts.onPoseAfterMatch);
  onTickRef.current = opts.onTick;
  onMatchRef.current = opts.onPoseAfterMatch;

  useEffect(() => {
    engine.setCallbacks({
      onPoseAfterMatch: (out) => onMatchRef.current?.(out),
    });
  }, [engine]);

  useEffect(() => {
    engine.setNavigating(opts.isNavigating);
  }, [engine, opts.isNavigating]);

  useEffect(() => {
    if (opts.isNavigating && opts.routePoints && opts.routePoints.length >= 2) {
      engine.setRoutePolyline(opts.routePoints);
    }
  }, [engine, opts.isNavigating, opts.routePoints]);

  const reset = useCallback(
    (
      anchor?: { lat: number; lng: number },
      options?: { heading?: number; seedPolyline?: RoadPoint[] },
    ) => {
      engine.reset({ anchor, ...options });
    },
    [engine],
  );

  const setRoutePolyline = useCallback((points: RoadPoint[]) => {
    engine.setRoutePolyline(points);
  }, [engine]);

  const applyMatchGeometry = useCallback((points: RoadPoint[]) => {
    engine.applyMatchGeometry(points);
  }, [engine]);

  const seedLocalMirror = useCallback((points: RoadPoint[]) => {
    engine.seedLocalMirror(points);
  }, [engine]);

  const primeLocalGeometry = useCallback((lat: number, lng: number) => {
    return engine.primeLocalGeometry(lat, lng);
  }, [engine]);

  const getTripActiveRef = useRef(opts.getTripActive);
  getTripActiveRef.current = opts.getTripActive;

  const setAppBackground = useCallback((active: boolean) => {
    engine.setAppBackground(active);
  }, [engine]);

  const onRawGps = useCallback((raw: RawGpsFix): DriveTickOutput | null => {
    const tripActive = getTripActiveRef.current
      ? getTripActiveRef.current()
      : opts.isDriving || opts.isNavigating;
    if (!tripActive) return null;
    const out = engine.onRawGps(raw);
    if (out) onTickRef.current?.(out);
    return out;
  }, [engine, opts.isDriving, opts.isNavigating]);

  const getApiMetrics = useCallback((): ApiMetrics => {
    return engine.budget.getMetrics();
  }, [engine]);

  return {
    onRawGps,
    reset,
    setRoutePolyline,
    applyMatchGeometry,
    seedLocalMirror,
    primeLocalGeometry,
    getApiMetrics,
    setAppBackground,
    engine,
  };
}
