import { useEffect, useState, type RefObject } from 'react';
import type Mapbox from '@rnmapbox/maps';
import { buildTripFollowSetCameraParams } from '../lib/driveUi/tripCameraPose';
import type { DriveMarkerValues } from './useDriveMarker';

export type DriveMarkerTripPose = {
  lat: number;
  lng: number;
  hdg: number;
};

function isValidMarkerCoord(la: number, ln: number): boolean {
  return Number.isFinite(la)
    && Number.isFinite(ln)
    && !(Math.abs(la) < 1e-6 && Math.abs(ln) < 1e-6);
}

export type DriveMarkerTripSyncRefs = {
  getSpeedKmh: () => number;
  getIsNavigating: () => boolean;
  /** Pauza follow kamery (gest użytkownika lub animacja powrotu). */
  shouldPauseTripCameraFollow: () => boolean;
  onProgrammaticCameraApply: () => void;
  getUserZoomOverride: () => number | null;
};

/**
 * Jeden rAF (~60 fps): odczyt SharedValues markera → pose UI + setCamera (animationDuration 0).
 * Marker i kamera mają identyczne źródło pozycji w tej samej klatce.
 */
export function useDriveMarkerTripSync(
  enabled: boolean,
  marker: DriveMarkerValues,
  cameraRef: RefObject<Mapbox.Camera | null>,
  refs: RefObject<DriveMarkerTripSyncRefs>,
): { pose: DriveMarkerTripPose; visible: boolean } {
  const [pose, setPose] = useState<DriveMarkerTripPose>({ lat: 0, lng: 0, hdg: 0 });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return undefined;
    }

    let alive = true;
    let rafId = 0;

    const loop = () => {
      if (!alive) return;
      const la = marker.lat.value;
      const ln = marker.lng.value;
      const h = marker.heading.value;

      if (isValidMarkerCoord(la, ln)) {
        const hdg = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
        setPose({ lat: la, lng: ln, hdg });
        setVisible(true);

        const sink = refs.current;
        if (sink && !sink.shouldPauseTripCameraFollow()) {
          const params = buildTripFollowSetCameraParams({
            lat: la,
            lng: ln,
            headingDeg: hdg,
            speedKmh: sink.getSpeedKmh(),
            isNavigating: sink.getIsNavigating(),
            userZoomOverride: sink.getUserZoomOverride(),
          });
          (cameraRef.current as { setCamera?: (p: typeof params) => void } | null)?.setCamera?.(params);
          sink.onProgrammaticCameraApply();
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    const la0 = marker.lat.value;
    const ln0 = marker.lng.value;
    const h0 = marker.heading.value;
    if (isValidMarkerCoord(la0, ln0)) {
      setPose({
        lat: la0,
        lng: ln0,
        hdg: Number.isFinite(h0) ? ((h0 % 360) + 360) % 360 : 0,
      });
      setVisible(true);
    }

    rafId = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, marker.lat, marker.lng, marker.heading, cameraRef, refs]);

  return { pose, visible };
}
