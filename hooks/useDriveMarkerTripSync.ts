import { useEffect, type RefObject } from 'react';
import type Mapbox from '@rnmapbox/maps';
import { buildTripFollowSetCameraParams } from '../lib/driveUi/tripCameraPose';
import type { DriveMarkerValues } from './useDriveMarker';

function isValidMarkerCoord(la: number, ln: number): boolean {
  return Number.isFinite(la)
    && Number.isFinite(ln)
    && !(Math.abs(la) < 1e-6 && Math.abs(ln) < 1e-6);
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function headingDeltaDeg(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Min. odstęp setCamera — unika „trzęsienia” mapy przy 60 fps. */
const CAM_MIN_INTERVAL_MS = 40;
const CAM_MIN_MOVE_M = 0.14;
const CAM_MIN_HDG_DEG = 0.4;
const CAM_MIN_ZOOM_DELTA = 0.04;

export type DriveMarkerTripSyncRefs = {
  getSpeedKmh: () => number;
  getIsNavigating: () => boolean;
  /** Pauza follow kamery (gest użytkownika lub animacja powrotu). */
  shouldPauseTripCameraFollow: () => boolean;
  onProgrammaticCameraApply: () => void;
  getUserZoomOverride: () => number | null;
};

type LastCamApply = {
  t: number;
  lat: number;
  lng: number;
  hdg: number;
  zoom: number;
};

/**
 * rAF: odczyt SharedValues markera → setCamera (throttled + delta gate).
 * Marker renderuje się z własnego rAF w DriveMarkerLayer (bez setState 60 fps tutaj).
 */
export function useDriveMarkerTripSync(
  enabled: boolean,
  marker: DriveMarkerValues,
  cameraRef: RefObject<Mapbox.Camera | null>,
  refs: RefObject<DriveMarkerTripSyncRefs>,
): void {
  useEffect(() => {
    if (!enabled) return undefined;

    let alive = true;
    let rafId = 0;
    const lastCam: LastCamApply = { t: 0, lat: 0, lng: 0, hdg: 0, zoom: 0 };

    const loop = () => {
      if (!alive) return;
      const la = marker.lat.value;
      const ln = marker.lng.value;
      const h = marker.heading.value;

      if (isValidMarkerCoord(la, ln)) {
        const hdg = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
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
          const now = Date.now();
          const centerLat = params.centerCoordinate[1];
          const centerLng = params.centerCoordinate[0];
          const moveM = lastCam.t > 0
            ? haversineM(lastCam.lat, lastCam.lng, centerLat, centerLng)
            : Infinity;
          const dHdg = lastCam.t > 0 ? headingDeltaDeg(lastCam.hdg, params.heading) : Infinity;
          const dZoom = lastCam.t > 0
            ? Math.abs(lastCam.zoom - params.zoomLevel)
            : Infinity;
          const elapsed = now - lastCam.t;
          const shouldApply =
            lastCam.t <= 0
            || elapsed >= CAM_MIN_INTERVAL_MS
            || moveM >= CAM_MIN_MOVE_M
            || dHdg >= CAM_MIN_HDG_DEG
            || dZoom >= CAM_MIN_ZOOM_DELTA;

          if (shouldApply) {
            (cameraRef.current as { setCamera?: (p: typeof params) => void } | null)?.setCamera?.(params);
            sink.onProgrammaticCameraApply();
            lastCam.t = now;
            lastCam.lat = centerLat;
            lastCam.lng = centerLng;
            lastCam.hdg = params.heading;
            lastCam.zoom = params.zoomLevel;
          }
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, marker.lat, marker.lng, marker.heading, cameraRef, refs]);
}
