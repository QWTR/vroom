import type { DriveMarkerValues } from './useDriveMarker';

export type DriveMarkerCameraSink = {
  enabled: boolean;
  onFrame: (lat: number, lng: number, hdg: number) => void;
};

/**
 * @deprecated V2 camera uses pushCameraFromGpsSegment (native segment-sync).
 */
export function useDriveMarkerCameraFrame(
  _enabled: boolean,
  _marker: DriveMarkerValues,
  _onFrame: (lat: number, lng: number, hdg: number) => void,
): void {
  // no-op — superseded by native segment-sync camera
}
