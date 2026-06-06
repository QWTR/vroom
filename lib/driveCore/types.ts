/** Surowy fix GPS z useAdaptiveGPS. */
export type RawGpsFix = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  /** Doppler z układu GPS (m/s), jeśli dostępny. */
  gpsSpeedMs?: number | null;
};

export type RoadPoint = { latitude: number; longitude: number };

/** Aktywna geometria drogi (trasa, cache free-drive, ostatni match). */
export type RoadPolyline = {
  points: RoadPoint[];
  source: GeometrySource;
  updatedAt: number;
};

export type GeometrySource =
  | 'route'
  | 'segment_cache'
  | 'map_match'
  | 'tangent_fallback';

export type SnappedPose = {
  lat: number;
  lng: number;
  heading: number;
  crossTrackM: number;
  segmentIndex: number;
};

export type DriveTickOutput = {
  pose: SnappedPose;
  speedKmh: number;
  isMoving: boolean;
  durationMs: number;
  geometrySource: GeometrySource;
};

export type MapMatchNetworkTrigger =
  | 'no_cache'
  | 'off_buffer'
  | 'near_segment_end';

export type MapMatchBudgetDecision = {
  allowNetwork: boolean;
  trigger: MapMatchNetworkTrigger | null;
  crossTrackM: number | null;
  remainingAlongCacheM: number | null;
  throttleBlocked: boolean;
  navigationBlocked: boolean;
  stationaryBlocked: boolean;
  /** Foreground traffic-light pause (speed < 3 km/h). */
  velocityPaused?: boolean;
};

export type BufferedGpsPoint = {
  lat: number;
  lng: number;
  timestamp: number;
};
