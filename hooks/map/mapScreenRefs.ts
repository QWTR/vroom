import type { MutableRefObject } from 'react';

/** Grouped refs shared across map domain hooks — extend as hooks are extracted. */
export type MapScreenRefs = {
  isDrivingRef: MutableRefObject<boolean>;
  isNavigatingRef: MutableRefObject<boolean>;
  isMapFocusedRef: MutableRefObject<boolean>;
  appStateRef: MutableRefObject<string>;
  lastGoodLocRef: MutableRefObject<{ lat: number; lng: number } | null>;
  lastGpsTickAtRef: MutableRefObject<number>;
  lastAcceptedFixWallClockRef: MutableRefObject<number>;
  drLastFrameAtRef: MutableRefObject<number>;
  drLatRef: MutableRefObject<number>;
  drLngRef: MutableRefObject<number>;
  drHdgRef: MutableRefObject<number>;
  lastHeadingRef: MutableRefObject<number>;
  lastSetLocRef: MutableRefObject<{ lat: number; lng: number } | null>;
  speedKmhRef: MutableRefObject<number>;
  offRouteRef: MutableRefObject<boolean>;
  reroutePendingRef: MutableRefObject<boolean>;
  routePointsRef: MutableRefObject<{ latitude: number; longitude: number }[]>;
  lastTripMarkerPoseRef: MutableRefObject<{ lat: number; lng: number } | null>;
  tripCheckpointSavedKmRef: MutableRefObject<number>;
  flushTripDistanceCheckpointRef: MutableRefObject<(opts?: {
    reason?: string;
    minKm?: number;
    forceAll?: boolean;
  }) => Promise<boolean>>;
};
