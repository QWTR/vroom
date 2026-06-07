import type { DriveMarkerValues } from './useDriveMarker';

export type DriveMarkerCameraSink = {
  enabled: boolean;
  onFrame: (lat: number, lng: number, hdg: number) => void;
};

/**
 * @deprecated Use useDriveMarkerTripSync — marker + camera share one rAF loop.
 */
export function useDriveMarkerCameraFrame(
  _enabled: boolean,
  _marker: DriveMarkerValues,
  _onFrame: (lat: number, lng: number, hdg: number) => void,
): void {
  // no-op — superseded by useDriveMarkerTripSync
}
