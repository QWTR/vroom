export type LatLng = { latitude: number; longitude: number };

export type GpsFixInput = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  speedMs: number | null;
  headingDeg: number | null;
  timestampMs: number;
  isDriving: boolean;
  isNavigating: boolean;
  /** Bypass filters during hard acceleration from standstill. */
  accelBypass?: boolean;
  /** Raw GPS moved >2-3m: unblock startup micro-movement guards. */
  rawMotionDetected?: boolean;
  /** Grace ticks after wake to avoid dropping first movement packets. */
  microMoveGraceTicks?: number;
};

export type FilteredGpsFix = {
  latitude: number;
  longitude: number;
  rejected: boolean;
  rejectReason?: string;
  speedKmh: number;
  headingDeg: number;
  predicted?: LatLng;
};

export type SnapCandidate = {
  latitude: number;
  longitude: number;
  segmentIndex: number;
  segmentBearing: number;
  lateralM: number;
  score: number;
  snapped: boolean;
};

export type SnapContext = {
  rawLat: number;
  rawLng: number;
  filteredLat: number;
  filteredLng: number;
  speedKmh: number;
  motionBearingDeg: number | null;
  routeHeadingDeg: number | null;
  geometry: LatLng[];
  isNavigating: boolean;
  hardRoadLock: boolean;
  accuracyM: number | null;
};

/** Output shape from useDrivingSnap.snap(). */
export type LegacySnapInput = {
  latitude: number;
  longitude: number;
  snapped: boolean;
  targetHeading: number;
};

export type SnapResult = {
  latitude: number;
  longitude: number;
  snapped: boolean;
  targetHeading: number;
  segmentIndex: number;
  confidence: number;
};

export type DrivePipelineOutput = {
  filtered: FilteredGpsFix;
  snap: SnapResult;
  markerSpeedMs: number;
  roadWindow: LatLng[] | null;
};
