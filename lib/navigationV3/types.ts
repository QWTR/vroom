export type PathMode = 'offRoad' | 'onRoad';

export type NavMode = 'idle' | 'freeDrive' | 'navigation';

export type RawGpsFix = {
  lat: number;
  lng: number;
  accuracyM: number;
  timestampMs: number;
  speedMs: number | null;
  headingDeg: number | null;
};

export type RoadPolyline = {
  key: string;
  points: { lat: number; lng: number }[];
  cumM: number[];
};

export type ArcWindowSlice = {
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
  arcWindow: ArcWindowSlice | null;
};

export type SnapEngineState = {
  lastSegmentIndex: number;
  lastPolylineKey: string;
  lastSegmentHeadingDeg: number;
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
  allowInstant: boolean;
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
};
