/**
 * Remove extracted pure functions from map.tsx and add imports.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mapPath = path.join(__dirname, '../app/(tabs)/map.tsx');
let src = fs.readFileSync(mapPath, 'utf8');

const fnNames = [
  'roadPolylineShiftM',
  'shouldPreferNewRoadGeometry',
  'smoothHeading',
  'resolveDrivingHeading',
  'resolveUnifiedHeading',
  'tripStandstillNetM',
  'isWorkletStationaryHold',
  'isParkedLikeTripEvidence',
  'canV10ProgressMarker',
  'trustDopplerInTripEvidence',
  'hasDrivingMotionEvidence',
  'isTripMarkerFrozen',
  'freezeMarkerOnRoad',
  'computeSnapFailMaxStepM',
  'resolveV10SnapFailPosition',
  'projectOntoDrivingRoad',
  'advanceV10MarkerTowardRaw',
  'clampCoordStep',
  'projectCoord',
  'isDriveMarkerBootstrapped',
  'tripLookaheadFromSpeedM',
  'round1',
  'round6',
  'resolveTripBootstrapHeadingHint',
  'resolveTripRoadHeading',
  'mergeTripHudKmh',
  'computeDriveFeedSpeedMs',
  'decayedMarkerFeedSpeedMs',
  'snapStaleHardResetThresholdM',
  'drivingSnapDynamicStepCapM',
  'tripFeedSpeedKmh',
  'workletFeedDurationMs',
  'updateTripAccelBypass',
  'workletGlideMsForLag',
  'isNullIsland',
  'isStaleGpsTimestamp',
  'clampRawTowardAnchor',
  'isRawGpsPlausibleVsAnchor',
  'isTripResumeJumpAcceptable',
  'maxPlausibleDrivingStepM',
  'rawStepFromAnchorM',
  'isImplausibleGpsTeleport',
  'angleDeltaDegSimple',
  'correctParallelRoadSnap',
  'isStepBackwardAlongHeading',
  'clampDrivingEntryMarkerPose',
  'bearingAlongRoadAt',
  'enforceForwardOnlyPosition',
  'shouldBlockBackwardDisplayFeed',
  'reconcileV10ApplyWithGpsTruth',
  'logSnapPipelineEnd',
];

for (const name of fnNames) {
  const re = new RegExp(
    `\\nfunction ${name}\\b[\\s\\S]*?(?=\\nfunction |\\ntype |\\nconst [A-Z_]+ =|\\n// ──)`,
    'm',
  );
  const next = src.replace(re, '\n');
  if (next === src) {
    console.warn('Not removed:', name);
  } else {
    src = next;
    console.log('Removed', name);
  }
}

// Remove types
src = src.replace(
  /\ntype PersistedNavSession = \{[\s\S]*?\};\n/,
  '\n',
);
src = src.replace(
  /\n\/\*\* Załadowana trasa użytkownika[\s\S]*?type LoadedRouteContext = \{[\s\S]*?\};\n/,
  '\n',
);

// Remove tripAccelState block (now in workletFeed)
src = src.replace(
  /\nconst tripAccelState = \{[\s\S]*?\};\n/,
  '\n',
);
src = src.replace(/\ntype AccelBypassState = \{[\s\S]*?\};\n/, '\n');

// Remove TRIP_COMPASS constant if still present
src = src.replace(
  /\n\/\*\* Poniżej tej prędkości[\s\S]*?const TRIP_COMPASS_HEADING_MAX_KMH = TRAVEL_VECTOR_LOCK_SPEED_KMH;\n/,
  '\n',
);

const importBlock = `import {
  roadPolylineShiftM,
  shouldPreferNewRoadGeometry,
  clampCoordStep,
  projectCoord,
  projectOntoDrivingRoad,
  correctParallelRoadSnap,
  angleDeltaDegSimple,
  bearingAlongRoadAt,
} from '../../lib/mapScreen/snapGeometry';
import {
  smoothHeading,
  resolveDrivingHeading,
  resolveUnifiedHeading,
  tripStandstillNetM,
  resolveTripBootstrapHeadingHint,
  resolveTripRoadHeading,
  mergeTripHudKmh,
  TRIP_COMPASS_HEADING_MAX_KMH,
} from '../../lib/mapScreen/tripHeadingSnap';
import {
  isWorkletStationaryHold,
  isParkedLikeTripEvidence,
  canV10ProgressMarker,
  trustDopplerInTripEvidence,
  hasDrivingMotionEvidence,
  isTripMarkerFrozen,
  freezeMarkerOnRoad,
  computeSnapFailMaxStepM,
  resolveV10SnapFailPosition,
  advanceV10MarkerTowardRaw,
  isDriveMarkerBootstrapped,
  tripLookaheadFromSpeedM,
  round1,
  round6,
  clampDrivingEntryMarkerPose,
  isStepBackwardAlongHeading,
  enforceForwardOnlyPosition,
  shouldBlockBackwardDisplayFeed,
} from '../../lib/mapScreen/tripMarkerMotion';
import {
  computeDriveFeedSpeedMs,
  decayedMarkerFeedSpeedMs,
  snapStaleHardResetThresholdM,
  drivingSnapDynamicStepCapM,
  tripFeedSpeedKmh,
  workletFeedDurationMs,
  updateTripAccelBypass,
  workletGlideMsForLag,
  tripAccelState,
} from '../../lib/mapScreen/workletFeed';
import {
  isNullIsland,
  isStaleGpsTimestamp,
  clampRawTowardAnchor,
  isRawGpsPlausibleVsAnchor,
  isTripResumeJumpAcceptable,
  maxPlausibleDrivingStepM,
  rawStepFromAnchorM,
  isImplausibleGpsTeleport,
} from '../../lib/mapScreen/gpsSanity';
import {
  reconcileV10ApplyWithGpsTruth,
  logSnapPipelineEnd,
} from '../../lib/mapScreen/snapPipeline';
import type { PersistedNavSession, LoadedRouteContext } from '../../lib/mapScreen/types';
`;

if (!src.includes("from '../../lib/mapScreen/snapGeometry'")) {
  src = src.replace(
    "import { buildV3GeometryFromRefs } from '../../lib/mapScreen/v3Geometry';",
    `import { buildV3GeometryFromRefs } from '../../lib/mapScreen/v3Geometry';\n${importBlock}`,
  );
}

fs.writeFileSync(mapPath, src);
console.log('Patched map.tsx');
