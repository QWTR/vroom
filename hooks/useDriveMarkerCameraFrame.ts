import { useCallback, useEffect, useRef } from 'react';
import type { DriveMarkerCameraSink, DriveMarkerValues } from './useDriveMarker';

const CAMERA_FRAME_MIN_MS = 16;

/**
 * @deprecated Camera follow is emitted from useDriveMarker's frame loop (same SV as marker).
 * Kept for compatibility — forwards to a sink ref if provided.
 */
export function useDriveMarkerCameraFrame(
  enabled: boolean,
  marker: DriveMarkerValues,
  onFrame: (lat: number, lng: number, hdg: number) => void,
  sinkRef?: { current: DriveMarkerCameraSink | null },
): void {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!sinkRef) return undefined;
    sinkRef.current = {
      enabled,
      onFrame: (lat, lng, hdg) => onFrameRef.current(lat, lng, hdg),
    };
    return () => {
      if (sinkRef.current) {
        sinkRef.current.enabled = false;
      }
    };
  }, [enabled, sinkRef]);

  const emitFrame = useCallback((lat: number, lng: number, hdg: number) => {
    onFrameRef.current(lat, lng, hdg);
  }, []);

  useEffect(() => {
    if (sinkRef) return undefined;
    void marker;
    void emitFrame;
    return undefined;
  }, [emitFrame, marker, sinkRef]);
}
