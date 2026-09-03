export type PathMode = 'offRoad' | 'onRoad';

export type NavMode = 'idle' | 'freeDrive' | 'navigation';

export type RawGpsFix = {
  lat: number;
  lng: number;
  accuracyM: number;
  timestampMs: number;
  speedMs: number | null;
  headingDeg: number | null;
  /** True when the OS marks the fix as simulated (mock location apps). */
  isMocked?: boolean;
};

export type RoadPolyline = {
  /** Stable logical road/route identity used by branch locking. */
  key: string;
  /** Identity of this concrete coordinate frame. Changes when points are replaced/trimmed. */
  geometryRevision: string;
  points: { lat: number; lng: number }[];
  cumM: number[];
};

export type ArcWindowSlice = {
  geometryRevision: string;
  points: { lat: number; lng: number }[];
  cumM: number[];
  baseArcM: number;
  totalM: number;
};

export type SnapResult = {
  lat: number;
  lng: number;
  rawLat: number;
  rawLng: number;
  headingDeg: number;
  crossTrackM: number;
  pathMode: PathMode;
  roadBlend: number;
  segmentIndex: number;
  arcM: number | null;
  polylineKey: string | null;
  geometryRevision: string | null;
  arcWindow: ArcWindowSlice | null;
  /** Ewidentny skręt z polilinii — trigger dynamicznego map-match. */
  intersectionTurnDetected?: boolean;
};

export type SnapEngineState = {
  lastSegmentIndex: number;
  lastPolylineKey: string;
  lastSegmentHeadingDeg: number;
  /** Ostatni poprawny wektor ruchu (bez kompasu w aucie). */
  lockedTravelHeadingDeg: number;
  /** Lepkość roadBlend między tickami GPS. */
  lastRoadBlend: number;
  offRoadStickTicks: number;
  branchCandidate: {
    polylineKey: string;
    segmentIndex: number;
    hits: number;
    atMs: number;
  } | null;
};

export type NavigationTarget = {
  lat: number;
  lng: number;
  headingDeg: number;
  speedMs: number;
  pathMode: PathMode;
  roadBlend: number;
  rawLat: number;
  rawLng: number;
  targetArcM: number | null;
  arcWindow: ArcWindowSlice | null;
  polylineKey: string | null;
  geometryRevision: string | null;
  allowInstant: boolean;
  /** Czas od poprzedniego fixu GPS (ms) — synchronizacja animacji markera. */
  gpsIntervalMs?: number;
  /** Timestamp źródłowego fixu — kompensacja opóźnienia dostarczenia przez OS. */
  sourceTimestampMs?: number;
};

export type GpsFilterVerdict = 'accept' | 'reject';

export type GpsFilterResult = {
  verdict: GpsFilterVerdict;
  reason?: string;
  fix: RawGpsFix;
};

export type DrivePipelineOutput = {
  target: NavigationTarget;
  snap: SnapResult;
  hudSpeedKmh: number;
  isMoving: boolean;
  rejected: boolean;
  rejectReason?: string;
};

export type DrivePipelineInput = {
  lat: number;
  lng: number;
  accuracyM: number;
  timestampMs: number;
  speedMs: number | null;
  headingDeg: number | null;
  isMocked?: boolean;
};
