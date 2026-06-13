import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import {
  createDrivePipeline,
  type DrivePipeline,
  type DrivePipelineGeometry,
} from '../lib/navigationV3/drivePipeline';
import type {
  DrivePipelineInput,
  DrivePipelineOutput,
  NavMode,
  RoadPolyline,
} from '../lib/navigationV3/types';

export type UseDriveNavigationV3Options = {
  mode: NavMode;
  /** Ref-based mode (natychmiast po isDrivingRef) — ma pierwszeństwo nad `mode` z React state. */
  getMode?: () => NavMode;
  /** Wywoływane po każdym zaakceptowanym ticku GPS z gotowym NavigationTarget. */
  onTarget?: (output: DrivePipelineOutput) => void;
  /** Dynamiczna geometria drogi / trasy — odczyt w momencie ticku GPS. */
  getGeometry?: () => DrivePipelineGeometry;
};

export type GpsLocationInput = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  timestamp?: number | null;
  speed?: number | null;
  heading?: number | null;
};

export function useDriveNavigationV3(opts: UseDriveNavigationV3Options) {
  const pipelineRef = useRef<DrivePipeline | null>(null);
  if (!pipelineRef.current) {
    pipelineRef.current = createDrivePipeline();
  }
  const pipeline = pipelineRef.current;

  const onTargetRef = useRef(opts.onTarget);
  const getGeometryRef = useRef(opts.getGeometry);
  const getModeRef = useRef(opts.getMode);
  onTargetRef.current = opts.onTarget;
  getGeometryRef.current = opts.getGeometry;
  getModeRef.current = opts.getMode;

  useEffect(() => {
    pipeline.setMode(opts.mode);
  }, [pipeline, opts.mode]);

  const processGpsFix = useCallback((loc: GpsLocationInput): DrivePipelineOutput | null => {
    const liveMode = getModeRef.current?.() ?? pipeline.getMode();
    if (pipeline.getMode() !== liveMode) {
      pipeline.setMode(liveMode);
    }
    const geometry = getGeometryRef.current?.() ?? {
      roadPolylines: [] as RoadPolyline[],
      routePolyline: null,
      shouldSnapToRoute: true,
    };
    pipeline.setGeometry(geometry);

    const input: DrivePipelineInput = {
      lat: loc.latitude,
      lng: loc.longitude,
      accuracyM: loc.accuracy ?? 20,
      timestampMs: loc.timestamp ?? Date.now(),
      speedMs: loc.speed != null && loc.speed >= 0 ? loc.speed : null,
      headingDeg: loc.heading != null && loc.heading >= 0 ? loc.heading : null,
    };

    const out = pipeline.processGpsFix(input);
    if (out) {
      if (!out.rejected) {
        onTargetRef.current?.(out);
      } else {
        // Słaby GPS / postój: utrzymaj marker na ostatnim kotwicy (hardReset / bootstrap).
        onTargetRef.current?.({
          ...out,
          target: {
            ...out.target,
            allowInstant: true,
            speedMs: 0,
          },
        });
      }
    }
    return out;
  }, [pipeline]);

  const reset = useCallback((
    anchor?: { lat: number; lng: number; heading?: number },
  ) => {
    pipeline.reset(
      anchor
        ? { lat: anchor.lat, lng: anchor.lng, headingDeg: anchor.heading }
        : undefined,
    );
  }, [pipeline]);

  const hardReset = useCallback((
    lat: number,
    lng: number,
    heading = 0,
    _reason?: string,
  ) => {
    pipeline.hardReset(lat, lng, heading);
  }, [pipeline]);

  const setRoadPolylines = useCallback((polylines: RoadPolyline[]) => {
    pipeline.setRoadPolylines(polylines);
  }, [pipeline]);

  const setRoutePolyline = useCallback((points: { lat: number; lng: number }[] | null) => {
    pipeline.setRoutePolyline(points);
  }, [pipeline]);

  return {
    processGpsFix,
    reset,
    hardReset,
    setRoadPolylines,
    setRoutePolyline,
    pipeline,
  };
}
