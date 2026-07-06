/**
 * One-off helper: extract pure functions from map.tsx into lib/mapScreen modules.
 * Run: node scripts/extractMapPureFns.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mapPath = path.join(__dirname, '../app/(tabs)/map.tsx');
const lines = fs.readFileSync(mapPath, 'utf8').split(/\r?\n/);

// Lines 352-1957 (1-based) = index 351-1956
const block = lines.slice(351, 1957).join('\n');

const modules = {
  'snapGeometry.ts': {
    header: `import {
  bearingBetween,
  alignBearingToReference,
  densifyPolyline,
  haversineKm,
  projectOntoPolylineWithIndex,
  snapToRoute,
  stepTowardSnapOnPolyline,
} from '../../scripts/navigationUtils';
import { validateGeometryAgainstRaw } from '../../hooks/useDrivingSnap';
`,
    fns: [
      'roadPolylineShiftM',
      'shouldPreferNewRoadGeometry',
      'clampCoordStep',
      'projectCoord',
      'projectOntoDrivingRoad',
      'correctParallelRoadSnap',
      'angleDeltaDegSimple',
      'bearingAlongRoadAt',
    ],
  },
  'tripHeadingSnap.ts': {
    header: `import {
  bearingBetween,
  alignBearingToReference,
  haversineKm,
  projectOntoPolylineWithIndex,
} from '../../scripts/navigationUtils';
import { TRAVEL_VECTOR_LOCK_SPEED_KMH, normalizeHeading } from '../driveCore/travelHeading';
import { normalizeHudSpeedKmh } from '../../components/map/SpeedometerHUD';
import { computeStandstillNetM } from '../../scripts/speedSanitizer';

/** Poniżej tej prędkości dopuszczalny kompas urządzenia (loc.coords.heading). */
const TRIP_COMPASS_HEADING_MAX_KMH = TRAVEL_VECTOR_LOCK_SPEED_KMH;
`,
    fns: [
      'smoothHeading',
      'resolveDrivingHeading',
      'resolveUnifiedHeading',
      'tripStandstillNetM',
      'resolveTripBootstrapHeadingHint',
      'resolveTripRoadHeading',
      'mergeTripHudKmh',
    ],
  },
  'tripMarkerMotion.ts': {
    header: `import {
  densifyPolyline,
  haversineKm,
  stepTowardSnapOnPolyline,
} from '../../scripts/navigationUtils';
import { drivingSnapDynamicStepCapM } from './workletFeed';
import { projectOntoDrivingRoad, clampCoordStep } from './snapGeometry';
import { tripStandstillNetM } from './tripHeadingSnap';

const DRIVING_ENTRY_MAX_MARKER_JUMP_M = 18;
`,
    fns: [
      'isWorkletStationaryHold',
      'isParkedLikeTripEvidence',
      'canV10ProgressMarker',
      'trustDopplerInTripEvidence',
      'hasDrivingMotionEvidence',
      'isTripMarkerFrozen',
      'freezeMarkerOnRoad',
      'computeSnapFailMaxStepM',
      'resolveV10SnapFailPosition',
      'advanceV10MarkerTowardRaw',
      'isDriveMarkerBootstrapped',
      'tripLookaheadFromSpeedM',
      'round1',
      'round6',
      'clampDrivingEntryMarkerPose',
      'isStepBackwardAlongHeading',
      'enforceForwardOnlyPosition',
      'shouldBlockBackwardDisplayFeed',
    ],
  },
  'workletFeed.ts': {
    header: `import { haversineKm } from '../../scripts/navigationUtils';

const FEED_SPEED_DECAY_MS = 1500;

export const tripAccelState = {
  bypassUntilMs: 0,
  lagStreak: { count: 0, lastM: 0 },
  prevFeedSpeedKmh: 0,
  launchResetAtMs: 0,
};

const SNAP_STALE_HARD_RESET_M = 80;
`,
    fns: [
      'computeDriveFeedSpeedMs',
      'decayedMarkerFeedSpeedMs',
      'snapStaleHardResetThresholdM',
      'drivingSnapDynamicStepCapM',
      'tripFeedSpeedKmh',
      'workletFeedDurationMs',
      'updateTripAccelBypass',
      'workletGlideMsForLag',
    ],
    extraTypes: `export type AccelBypassState = {
  active: boolean;
  until: number;
  reason: string;
};
`,
  },
  'gpsSanity.ts': {
    header: `import { haversineKm } from '../../scripts/navigationUtils';
import { tripStandstillNetM } from './tripHeadingSnap';

const GPS_MAX_FIX_AGE_MS = 30_000;
`,
    fns: [
      'isNullIsland',
      'isStaleGpsTimestamp',
      'clampRawTowardAnchor',
      'isRawGpsPlausibleVsAnchor',
      'isTripResumeJumpAcceptable',
      'maxPlausibleDrivingStepM',
      'rawStepFromAnchorM',
      'isImplausibleGpsTeleport',
    ],
  },
  'snapPipeline.ts': {
    header: `import { haversineKm } from '../../scripts/navigationUtils';
import { logGpsTickLayer } from '../gpsTickTraceLog';
import { visionEvent } from '../driveVisionTrace';
import { projectOntoDrivingRoad, clampCoordStep } from './snapGeometry';
import { isStepBackwardAlongHeading } from './tripMarkerMotion';
import { maxPlausibleDrivingStepM } from './gpsSanity';
`,
    fns: [
      'reconcileV10ApplyWithGpsTruth',
      'logSnapPipelineEnd',
    ],
  },
  'types.ts': {
    header: `import type { LocationState, RouteInfo } from '../../constants/types';
import type { DirectionsResult } from '../../hooks/useGoogleDirections';
`,
    typesOnly: true,
    typeBlock: `export type PersistedNavSession = {
  savedAt: number;
  isOffroadRoute: boolean;
  startLocation: LocationState | null;
  endLocation: LocationState | null;
  navStartLoc: LocationState | null;
  routeInfo: (RouteInfo & { durationText?: string | null }) | null;
  routeSnapshot?: DirectionsResult | null;
  currentStep: number;
  offroadPoints: { latitude: number; longitude: number }[];
};

/** Załadowana trasa użytkownika (ranking) — osobno od bieżącego celu nawigacji. */
export type LoadedRouteContext = {
  routeId: number;
  routeName: string;
  start: LocationState;
  end: LocationState;
  isOffroad: boolean;
  points: { latitude: number; longitude: number }[];
};
`,
  },
};

function extractFunction(src, name) {
  const fnRe = new RegExp(
    `(^function ${name}\\b[\\s\\S]*?)(?=^function |^type |^const [A-Z_]+ =|^// ──|^export )`,
    'm',
  );
  const m = src.match(fnRe);
  if (!m) throw new Error(`Function not found: ${name}`);
  return m[1].replace(/^function /, 'export function ').trimEnd();
}

function extractType(src, name) {
  const re = new RegExp(`^type ${name} = \\{[\\s\\S]*?\\};`, 'm');
  const m = src.match(re);
  if (!m) throw new Error(`Type not found: ${name}`);
  return m[0].replace(/^type /, 'export type ');
}

const outDir = path.join(__dirname, '../lib/mapScreen');
for (const [file, cfg] of Object.entries(modules)) {
  if (cfg.typesOnly) {
    fs.writeFileSync(path.join(outDir, file), cfg.header + '\n' + cfg.typeBlock + '\n');
    continue;
  }
  const parts = [cfg.header];
  if (cfg.extraTypes) parts.push(cfg.extraTypes);
  for (const fn of cfg.fns) {
    parts.push(extractFunction(block, fn));
    parts.push('');
  }
  fs.writeFileSync(path.join(outDir, file), parts.join('\n'));
  console.log('Wrote', file);
}

console.log('Done');
