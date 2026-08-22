import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Mapbox from '@rnmapbox/maps';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { showGpsLocationErrorToast } from '../../lib/gpsErrorToast';
import { fetchProfileMeCached } from '../../lib/cachedProfileMe';
import { track } from '../../lib/analytics/client';
import { API_URL } from '../../constants/mapConfig';
import { useTheme } from '../../contexts/ThemeContext';
import { useSubscriptionStatus } from '../../hooks/useSubscriptionStatus';
import { useChat } from '../../hooks/useChats';
import { DriveMarkerLayer } from '../../components/map/DriveMarkerLayer';
import {
  VroomMapCameraFollower,
} from '../../components/map/VroomMapCameraFollower';
import { DrPositionMarker } from '../../components/map/DrPositionMarker';
import { VehicleModelMarker } from '../../components/map/VehicleModelMarker';
import { MapVehicleModelsHost } from '../../components/map/MapVehicleModelsHost';
import {
  HudPanelShell,
  DriveSpeedTile,
  HudQuickReportButton,
  emitSpeedometerKmh,
  normalizeHudSpeedKmh,
  resetSpeedometerEmitterThrottle,
  useHudStyles,
} from '../../components/map/SpeedometerHUD';
import { NavStartHudBar } from '../../components/motion';
import { MapTerrainLayers } from '../../components/map/MapTerrainLayers';
import { MapVividLayers } from '../../components/map/MapVividLayers';
import { MapCanvas } from '../../components/map/MapCanvas';
import { TripMapLabelGuard } from '../../components/map/TripMapLabelGuard';
import { MapActiveRouteLayers, MapBuilderRouteLayers } from '../../components/map/MapRouteLayers';
import { makeMapStyles } from '../../styles/mapstyle';
import { ensureMapboxToken, initMapbox } from '../../lib/mapboxInit';
import { useMapTilePrefetch } from '../../hooks/useMapTilePrefetch';
import { buildV3GeometryFromRefs } from '../../lib/mapScreen/v3Geometry';
import {
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
import {
  isFreshPersistedNavSession,
  parsePersistedNavSession,
  PERSISTED_NAV_SESSION_VERSION,
} from '../../lib/mapScreen/persistedNavSession';

import { coldStartNavigationTarget, useDriveMarkerV3 } from '../../hooks/useDriveMarkerV3';
import { useDriveNavigationV3 } from '../../hooks/useDriveNavigationV3';
import { useCameraV3 } from '../../hooks/useCameraV3';
import type { NavMode } from '../../lib/navigationV3/types';
import { roadGeometryStore } from '../../lib/roadGeometry/RoadGeometryStore';
import { getLocalRoadGeometry, pickNearestPolyline } from '../../lib/roadGeometry/localTileSnap';
import { canRequestMapMatch, getMapboxNetworkMetrics } from '../../lib/mapboxNetworkGate';
import {
  markClientFirstGeometryHealthy,
  markClientFirstNoRoad,
  clearClientFirstNoRoad,
  resetClientFirstState,
  shouldAllowNetworkMapMatch,
  isClientFirstGeometryHealthy,
} from '../../lib/mapMatch/clientFirstRoadGeometry';
import { setMapMatchAppBackground } from '../../lib/mapMatch/mapMatchSyncState';
import { useMapMatchCoordinator } from '../../hooks/useMapMatchCoordinator';
import { markerLogCritical, markerLogTick } from '../../lib/markerPipelineLog';
import { navDriveTrace, navDriveTraceSession } from '../../lib/navDriveTrace';
import { TRIP_PIPELINE_SIMPLE } from '../../lib/tripPipelineConfig';
import { shareNavTraceLog } from '../../lib/navDriveTraceStore';
import { vroomGpsLog, vroomGpsLogNow } from '../../lib/vroomGpsLog';
import { beginGpsTick } from '../../lib/gpsTickTrace';
import { logGpsTickLayer, logGpsTickLayerThrottled } from '../../lib/gpsTickTraceLog';
import {
  driveTraceCamera,
  driveTraceFallback,
  driveTraceRaw,
  driveTraceReject,
  driveTraceSession,
  driveTraceTick,
  driveTraceHeartbeat,
  driveSessionLog,
  driveTraceMarkerPipeline,
  driveTraceCameraPipeline,
} from '../../lib/driveSessionTrace';
import { visionEvent } from '../../lib/driveVisionTrace';
import { getGpsTickId } from '../../lib/gpsTickTrace';
import { clearTelemetry, logTelemetry } from '../../lib/telemetryLogger';
import {
  buildRerouteOrigin,
  buildRerouteRouteSignature,
  quantizeHeading,
  REROUTE_BEARING_RANGE_DEG,
  resolveRerouteApiHeadingDeg,
  resolveRerouteTravelHeadingDeg,
} from '../../lib/navigation/reroute';

ensureMapboxToken();

import {
  resolveMapStyle,
  resolveMapStyleForVehicle3d,
  shouldApplyVividMapLayers,
  MAX_NEARBY_USERS_DISTANCE
} from '../../constants/mapConfig';
import { LocationState, RouteInfo, User } from '../../constants/types';
import {
  loadMapLastLocation,
  saveMapLastLocation,
  peekMapLastLocation,
  rememberMapLastLocation,
} from '../../lib/mapLastLocation';

import {
  latFilter,
  lngFilter,
  navLatFilter,
  navLngFilter,
  drivLatFilter,
  drivLngFilter,
  configureDrivingKalmanForSpeed,
  configureNavKalmanForSpeed,
} from '../../scripts/kalmanFilter';
// ── NOWE: sanity check ────────────────────────────────────
import { isSaneLocation } from '../../scripts/kalmanFilter';
import {
  sanitizeSpeedMs,
  clampSpeedKmhToGeometry,
  MAX_SPEED_HUD_KMH,
  GPS_ACCURACY_HIGH_SPEED_MAX_M,
  GPS_DOPPLER_HIGH_SPEED_TRUST_KMH,
  sustainedTripSpeedFromSamples,
  computeStandstillNetM,
  isStationaryGpsSpike,
  type TripMoveSample,
} from '../../scripts/speedSanitizer';

import { useDriveLocationWatch } from '../../hooks/useDriveLocationWatch';
import {
  useGpsForegroundLifecycle,
  shouldSkipResumeDedupe,
} from '../../hooks/useGpsForegroundLifecycle';
import {
  BG_IS_SHARING_KEY,
  LIVE_SHARING_USER_PREF_KEY,
  feedSpeedSample,
  recordDrivingTracePoint,
  resetSpeedStats,
  saveIncrementalTripKm,
  flushTripSessionFinalizationOutbox,
  flushTracePendingKmToStorage,
  startDriveSession,
  continueDriveSessionAsNavigation,
  ensureTripSessionId,
  setDrivingFlag,
  setNavigatingFlag,
  readEmergencyTripSave,
  clearEmergencyTripSave,
  writeEmergencyTripSave,
  persistTripCheckpointSavedKm,
  loadTripCheckpointSavedKm,
  clearTripCheckpointSavedKm,
  consumeNativeDriveStatsToStorage,
  BG_IS_DRIVING_KEY,
  BG_IS_NAVIGATING_KEY,
  TRIP_SESSION_ID_KEY,
  useBackgroundTracking,
} from '../../hooks/useBackgroundTracking';
import {
  flushActiveTripCheckpointForProfile,
  registerActiveTripCheckpointFlusher,
} from '../../lib/tripPersistenceCoordinator';
import {
  BackgroundDriveController,
  type BackgroundDriveFix,
} from '../../lib/backgroundDriveController';
import { useSettings } from '../../hooks/useSettings';
import { useMapMaintenanceGate } from '../../hooks/useMapMaintenanceGate';
import { MapMaintenanceScreen } from '../../components/maintenance/MapMaintenanceScreen';
import { useCameraAnimation, PROGRAMMATIC_CAMERA_GESTURE_GUARD_MS } from '../../hooks/useCameraAnimation';
import { TripHeadingFilter } from '../../lib/driveCore/headingFilter';
import { DriveSessionGuard } from '../../lib/driveCore/driveSessionGuard';
import {
  moveBearingBetween,
  normalizeHeading,
  resolveTravelHeading,
  lerpHeadingWithMaxStep,
  headingDelta,
  TRAVEL_VECTOR_LOCK_SPEED_KMH,
} from '../../lib/driveCore/travelHeading';
import { localRoadGeometryMirror } from '../../lib/driveCore/localRoadSnap';
import {
  routeHeadingAtPoint,
  trimRoutePointsFromVehicle,
  trimNavigationRouteFromVehicle,
} from '../../lib/driveCore/navRouteBootstrap';
import { getLiveTripPose, resolveBestKnownPose } from '../../lib/mapScreen/liveTripPose';
import {
  beginResumeRecovery,
  canBypassGpsLockDuringResume,
  classifyFixFreshness,
  createResumeRecoveryState,
  markResumeSourceAccepted,
  markResumeSourceSeen,
  quarantineHudSpeedKmh,
  resolveResumeSpeedKmh,
  shouldAcceptResumeSource,
} from '../../lib/mapScreen/resumeRecovery';
import { clearTripSessionLedger, loadTripSessionLedger } from '../../lib/tripSessionLedger';
import { validateGeometryAgainstRaw } from '../../hooks/useDrivingSnap';
import { useDemoUsers } from '../../hooks/useDemoUsers';
import { useDrivingMapMatch } from '../../hooks/useDrivingMapMatch';
import {
  useGoogleDirections,
  useGoogleDirectionsAlternatives,
  type DirectionsResult,
} from '../../hooks/useGoogleDirections';
import {
  clusterWarnings,
  getWarningLabel,
  LiveWarning,
  useLiveMap,
} from '../../hooks/useLiveMap';
import { useNavigationNotification } from '../../hooks/useNavigationNotification';
import { useNavigationVoice } from '../../hooks/useNavigationVoice';
import { useNavigationPoints } from '../../hooks/useNavigationPoints';
import { useNavigationSimulator } from '../../hooks/useNavigationSimulator';
import { useRouteBuilder } from '../../hooks/useRouteBuilder';
import { useRouteLeaderboard } from '../../hooks/useRouteLeaderboard';
import { useRouteTimer } from '../../hooks/useRouteTimer';
import { SPEED_CAMERA_MIN_ZOOM } from '../../constants/speedCameraMap';
import { SpeedCameraMapLayers } from '../../components/map/SpeedCameraMapLayers';
import { GeoDropMapLayer } from '../../components/map/GeoDropMapLayer';
import { GeoDropAvailableSheet } from '../../components/map/GeoDropAvailableSheet';
import { GeoDropClaimedModal } from '../../components/map/GeoDropClaimedModal';
import type { SpeedCamera } from '../../hooks/useSpeedCamera';
import { useSpeedCameras } from '../../hooks/useSpeedCamera';
import { useGamification } from '../../hooks/useGamification';
import { fetchDropStatus, type GeoDropNearby } from '../../lib/gamificationClient';
import { useSpeedLimit } from '../../hooks/useSpeedLimit';
import { useTripStats } from '../../hooks/useTripStats';
import {
  estimateRemainingRouteMinutes,
  routeDurationMinutesToSeconds,
} from '../../lib/tripEstimate';
import {
  useAutoNavigationBridge,
  type AutoNavigationStartedPayload,
} from '../../hooks/useAutoNavigationBridge';
import { calculateDistance } from '../../scripts/distance';
import {
  bearingBetween,
  alignBearingToReference,
  formatNavigationInstruction,
  detectCurrentStep,
  resolveAnnouncementTarget,
  buildStepArcIndex,
  buildRouteForwardArcPrefix,
  computeUserArcM,
  stabilizeManeuverDistance,
  stabilizeRouteArcProgress,
  findStepIndexForArcM,
  shouldSpeakForStep,
  type StepArcIndex,
  findClosestPointIndex,
  formatDuration,
  getManeuverIcon,
  haversineKm,
  isOnRoute,
  maxIdleBrowsingJumpM,
  snapToRoute,
  snapStepTowardRoad,
  stepTowardSnapOnPolyline,
  generateSubAnchorsAlongPolyline,
  projectOntoPolylineWithIndex,
  projectPointToRouteWindow,
  densifyPolyline,
} from '../../scripts/navigationUtils';
// testd sdsd

import { RouteEndpointRenderer } from '@/components/markers/RouteEndpointRenderer';
import { ArrowMarkerRenderer } from '../../components/markers/ArrowMarkerRenderer';
import { CarMarkerRenderer } from '../../components/markers/CarMarkerRenderer';
import { RoutePinRenderer } from '../../components/markers/RoutePinRenderer';
import { AddSpeedCameraModal, type CameraType } from '../../components/modals/AddSpeedCameraModal';
import { ReportModal } from '../../components/modals/ReportModal';
import { RouteLeaderboardModal } from '../../components/modals/RouteLeaderboardModal';
import { SaveRouteModal } from '../../components/modals/SaveRouteModal';
import { SearchModal } from '../../components/modals/SearchModal';
import { SettingsModal } from '../../components/modals/SettingsModal';
import { SpeedCameraDetailModal } from '../../components/modals/SpeedCameraDetailModal';
import { TripStatsModal } from '../../components/modals/TripStatsModal';
import { UserInfoModal } from '../../components/modals/UserInfoModal';
import { WarningDetailModal } from '../../components/modals/WarningDetailModal';
import { SpeedLimitReportModal } from '../../components/modals/SpeedLimitReportModal';
import { AdSlot }               from '../../components/ads/AdSlot';
import { useFuelStations }      from '../../hooks/useFuelStations';
import { FuelStationMarker }    from '../../components/markers/FuelStationMarker';
import { PartnerPoiMarker }     from '../../components/markers/PartnerPoiMarker';
import { OfficialMeetMarker }   from '../../components/markers/OfficialMeetMarker';
import { PartnerPoiModal }      from '../../components/modals/PartnerPoiModal';
import { usePartnerPois, type PartnerPoi } from '../../hooks/usePartnerPois';
import { useOfficialMapMeets, type OfficialMapMeet } from '../../hooks/useOfficialMapMeets';
import { useCursorSkin }        from '../../hooks/useCursorSkin';
import { useEquippedMapVehicle } from '../../hooks/useEquippedMapVehicle';
import { FuelStationModal }     from '../../components/modals/FuelStationModal';
import { AddFuelStationModal }  from '../../components/modals/AddFuelStationModal';
import { LiveFleetMapController } from '../../components/map/LiveFleetMapController';
import { MapFabActionsModal } from '../../components/map/MapFabActionsModal';
import { CameraPickOverlay } from '../../components/map/CameraPickOverlay';
import { ManualTargetPickOverlay } from '../../components/map/ManualTargetPickOverlay';
import { MapScreenHud } from '../../components/map/MapScreenHud';
import { WarningMapLayers } from '../../components/map/WarningMapLayers';
import { MapModalsHost } from '../../components/map/MapModalsHost';
import { useMapGeoDrops } from '../../hooks/map/useMapGeoDrops';
import { useMapTripCheckpoints } from '../../hooks/map/useMapTripCheckpoints';
import { useMapTripLifecycle } from '../../hooks/map/useMapTripLifecycle';
import { useMapNavProgressTick } from '../../hooks/map/useMapNavProgressTick';
import { useMapAnchorSync } from '../../hooks/map/useMapNavProgressTick';
import { useMapNavigationSession } from '../../hooks/map/useMapNavigationSession';
import { useMapCameraSpeedPoll } from '../../hooks/map/useMapCameraSpeedPoll';
import { useMapGpsWatchdog } from '../../hooks/map/useMapGpsLifecycle';
import { useMapLiveSendTick } from '../../hooks/map/useMapLiveSendTick';
import { selectUpcomingWarning } from '../../lib/warnings/warningAhead';
import type { CreateWarningInput, WarningType } from '../../lib/warnings/warningCatalog';
import { canReportCommunitySpeedLimit } from '../../lib/speedLimits/types';
import {
  createResolvedNavigationCue,
  resolveNavigationRoute,
  resolvedCueKey,
  type ResolvedNavigationCue,
} from '../../lib/navigation/resolvedCue';
import {
  buildAdaptiveNavigationSpeech,
  getAdaptiveGuidancePhase,
  isCriticalWarning,
  shouldChainFollowingManeuver,
} from '../../lib/navigation/voiceGuidanceCore';


// Geoprzestrzenna detekcja on-route (Turf Haversine) — margines GPS 30–40 m.
const GPS_ON_ROUTE_THRESHOLD_M = 35;
/** Potwierdzenie zjazdu z trasy — próg cross-track (m). */
const REROUTE_THRESHOLD_M = 40;
/** Natychmiastowy snap release + isOffRoute gdy cross-track przekroczy ten próg. */
const OFF_ROUTE_SNAP_RELEASE_M = 35;
const NAV_PITCH           = 62;
const BROWSE_3D_PITCH     = 52;
const BUILDINGS_3D_MIN_ZOOM = 13;
// Keep heavy map diagnostics opt-in. Verbose logs at GPS/DR camera rates can
// saturate the JS bridge on physical devices and cause apparent map freezes.
const MAP_RENDER_DEBUG = false;
// Lightweight runtime diagnostics for field test rides (driving/navigation).
// Emits compact snapshots every few seconds to help identify "frozen marker"
// root causes without spamming logs on every frame.
const DRIVE_TEST_DIAGNOSTICS = __DEV__;

// ── Cost-optimization thresholds ─────────────────────────────────────────────
// Set DEBUG_NETWORK = true to see throttle/suppression logs in the console.
const DEBUG_NETWORK = false;

// Live location sharing — częsty broadcast (opóźnienie floty zależy głównie od tego)
const LIVE_SEND_TICK_MS         = 250;
const LIVE_SEND_INTERVAL_TRIP_MS = 800;
const LIVE_SEND_INTERVAL_MS      = 2_000;
const LIVE_SEND_MIN_DIST_TRIP_M  = 4;
const LIVE_SEND_MIN_DIST_M       = 10;
const LIVE_SEND_MAX_ELAPSED_MS   = 1_200;
const LIVE_BROADCAST_TRAIL_MAX = 8;
const FORCE_MAP_MATCH_RECOVER_MIN_INTERVAL_MS = 45_000;
const FORCE_MAP_MATCH_RECOVER_STREAK = 4;
/** Min. odstęp forceMatch przy braku geometrii drogi (noRoad). */
/** NO_ROAD recovery — cooldown w MapMatchCoordinator (MAP_MATCH_COORD_NO_ROAD_*). */
/** Min. odstęp między wywołaniami addMatchPosition z map.tsx (hook ma własny batching). */
const ADD_MATCH_FEED_MIN_MS = 45_000;
const ADD_MATCH_FEED_NO_ROAD_MIN_MS = 60_000;
const ADD_MATCH_FEED_HEALTHY_MIN_MS = 120_000;
/** Mapbox match odrzucony gdy polyline dalej od surowego GPS. */
const ROAD_MATCH_REJECT_RAW_M = 120;
/** Miękka aktualizacja geometrii — bez resetSnap gdy przesunięcie osi drogi jest małe. */
const ROAD_MATCH_SOFT_SHIFT_M = 28;



const CLIENT_FIRST_RESOLVE_MIN_MS = 4_000;
const NAV_SESSION_KEY     = 'nav_session_v1';
const NAV_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

// updateCameras + updateSpeedLimit — skip if user hasn't moved this far
// (each hook also has its own internal throttle; this gate prevents even the
//  cheap recalc/sort from running on every sub-second GPS tick)
const CAMERA_SPEED_LIMIT_GATE_M = 30; // meters
const CAMERA_SPEED_LIMIT_GATE_NAV_M = 10; // meters in driving/navigation
// Ile km/h ponad limit zanim kolor prędkości zmienia się na czerwony
const SPEED_LIMIT_TOLERANCE = 5;

// Reroute cooldown — avoids hammering Directions API while continuously off-route
const REROUTE_COOLDOWN_MS = 5_000;
const REROUTE_MIN_MOVED_M = 20;
/** Dwa kolejne ticki postępu potwierdzają zjazd bez czekania pełnych sekund. */
const OFF_ROUTE_CONFIRM_STREAK = 2;
/** Snap-to-route: marker na polilinii gdy cross-track ≤ ten próg (m). */
const NAV_ROUTE_SNAP_M = 40;
const REROUTE_PENDING_TIMEOUT_MS = 18_000;
const REROUTE_RETRY_AFTER_FAIL_MS = 20_000;
const REROUTE_GRACE_AFTER_APPLY_MS = 12_000;
const REROUTE_THRESHOLD_RECOVERY_M = 60;

// ── DRIVING MODE ──────────────────────────────────────────
// Czas postoju (<3 km/h) zanim auto-wyłączymy tryb driving (guard w driveSessionGuard.ts)
















// ─────────────────────────────────────────────────────────────────────────────

// ── DRIVING MODE ──────────────────────────────────────────
const DRIVING_SPEED_KMH          = 10;
/** Postój przy włączeniu trybu jazdy — nie przesuwaj markera na odległą drogę. */
const DRIVING_ENTRY_STATIONARY_KMH = 6;
const DRIVING_ENTRY_MAX_SNAP_M     = 22;
/** Pierwsze przyklejenie do drogi przy włączeniu trybu jazdy (GPS bywa 50–80 m off-road). */
const DRIVING_ENTRY_INITIAL_SNAP_M = 22;
const DRIVING_ENTRY_GRACE_MS = 2800;
const DRIVING_ENTRY_MAX_MARKER_JUMP_M = 18;
const DRIVING_ENTRY_SQLITE_RADIUS_M = 120;
/** Po async map-match przy wejściu w jazdę — przesuń marker tylko gdy korekta ≤ tego (m). */
const DRIVING_ENTRY_ASYNC_MAX_CORRECTION_M = 8;
const DRIVING_TOGGLE_GUARD_MS      = 400;

/** Min. czas LERP markera w aktywnej jeździe — nigdy 0 ms (teleport). */
const TRIP_MARKER_LERP_MIN_MS = 280;
/** Minimalny czas segmentu GPS → marker + kamera (baseline 613bba88). */
const TRIP_GPS_FEED_MIN_MS = 320;









const FEED_SPEED_DECAY_MS = 1500;


// ── Driving-mode distance accumulator safety caps ──────────
// Maximum realistic speed for per-tick distance cap (km/h)
const MAX_PLAUSIBLE_SPEED_KMH    = 360;
const DRIVING_MANUAL_DISABLE_RESET_MS = 15 * 60 * 1000;
const DRIVING_MANUAL_DISABLE_RESET_KM = 2;
// Per-tick distance upper bound regardless of speed (km)
const MAX_DIST_PER_TICK_KM       = 0.1;   // 100 m
// Per-tick distance lower bound so extremely short intervals don't cap to ~0 (km)
const MIN_DIST_PER_TICK_KM       = 0.005; // 5 m
// Floor value for the dt computation — prevents near-zero dt when ticks arrive
// faster than the GPS rate (e.g. after a filter reset or rapid double fire)
const MIN_GPS_TICK_SEC           = 0.25;

// ── GPS resume/focus grace period ─────────────────────────
// After restarting GPS on foreground/focus, backdate lastGoodTimeRef by this
// amount so the sanity-check allows larger position jumps for the first few
// fixes (accommodates inaccurate first fix after a cold GPS restart).
const GPS_RESUME_GRACE_PERIOD_MS = 2000;
/** v10: krótki freeze tylko po długim tle — długi blokował GPS ~10s (freeze + teleport). */
const TRIP_RESUME_FREEZE_MS = 1200;
const TRIP_RESUME_FREEZE_SHORT_MS = 400;
const TRIP_RESUME_FREEZE_MAX_MS = 2800;
/** Po tym skoku / pauzie w tle — bez freeze, instant sync do live GPS. */
const TRIP_RESUME_INSTANT_JUMP_M = 40;
const TRIP_RESUME_BG_PAUSE_INSTANT_MS = 8_000;
/** Po powrocie z tła: pełny refresh pozycji/prędkości bez resume-freeze (ms). */
const TRIP_FOREGROUND_REFRESH_MS = 8_000;
const TRIP_FOREGROUND_SPEED_HOLD_MS = 4_000;
/** Po zakręcie / zmianie segmentu — łagodniejsze guardy (ms). */
const TURN_MODE_DURATION_MS = 2_200;
const RESUME_FOLLOWUP_ONESHOT_MS = 800;
/** Po foreground nie karm bg_projection przez ten czas (ms). */
const BG_PROJECTION_COOLDOWN_MS = 2_000;
/** Podczas freeze ignoruj fixy przesuwające marker mniej niż tyle (m). */
const TRIP_RESUME_HOLD_JUMP_M = 12;
const TRIP_RESUME_MAX_JUMP_M = 50;
const TRIP_RESUME_CONFIRM_HITS = 3;
const GPS_RESTART_COOLDOWN_MS    = 2000;
/** Nie restartuj watchera po focus, jeśli fix jest świeży (mniej lagów). */
const GPS_WATCHER_STALE_MS       = 12_000;
/** Po długiej pauzie w tle — zawsze restart. */
const GPS_BACKGROUND_STALE_MS    = 25_000;
/** Min. prędkość do pasywnego liczenia km na mapie (bez trybu jazdy / nawigacji). */
const PASSIVE_DISTANCE_MIN_KMH   = 7;
/** Throttle publikacji markera na UI (Hz) poza nawigacją/jazdą. */
/** Podczas jazdy: userLocation state tylko dla fuel/socket — marker/kamera z workletu. */
/** Rzadsze setUserLocation w jazdzie — mniej re-renderow MapScreen (marker = worklet). */
const ACTIVE_UI_LOCATION_THROTTLE_MS = 2000;
/** Podczas jazdy/nawigacji userLocation state jest tylko dla secondary/live state. */
const SECONDARY_LOC_PUBLISH_MS   = 2500;
import {
  NAV_PROGRESS_UI_MS,
  CAMERA_SPEED_POLL_MS,
  LIVE_ACHIEVEMENT_PERIODIC_MS,
  GPS_WATCHDOG_TICK_MS,
  GPS_MAX_FIX_AGE_MS,
  UI_LOCATION_THROTTLE_MS,
  MAP_PERF,
} from '../../constants/mapPerformance';
const GPS_RESUME_DEDUPE_MS       = 9000;
const GPS_ONESHOT_COOLDOWN_MS    = 6000;
const GPS_ONESHOT_AFTER_RESUME_MS = 1500;
/** Ignoruj krótkie przejścia inactive<->active (np. overlay systemowy), jeśli fix jest świeży. */
const GPS_RESUME_MIN_BG_PAUSE_MS = 3000;
/** Po realnym foreground pomiń duplikat "focus resume" przez krótkie okno. */
const GPS_SKIP_FOCUS_AFTER_FOREGROUND_MS = 7000;
/** Tuż po resume dopuść nieco większy pierwszy skok UI, żeby marker nie "zastygał". */
const GPS_RESUME_IDLE_UI_MIN_JUMP_M = 32;
/** Tuż po resume poluzuj też próg random-jump, nadal z limitem bezpieczeństwa. */
const GPS_RESUME_IDLE_RANDOM_JUMP_M = 130;
/** Tryb jazdy/nawigacji: jeśli brak fixów za długo, wymuś recovery GPS. */
const GPS_ACTIVE_RECOVERY_STALE_MS = 8_000;
const GPS_ACTIVE_RECOVERY_COOLDOWN_MS = 12_000;
const DRIVING_MARKER_STALL_MAX_AGE_MS = 4_500;
const DRIVING_MARKER_STALL_RAW_MOVE_WAKE_M = 3;
const DRIVING_MARKER_STALL_UI_MOVE_WAKE_M = 3.5;
const DRIVING_MARKER_STALL_DR_MOVE_MAX_M = 1.6;
/** Brak zaakceptowanego fixu na mapie (idle) — wymuś recovery zamiast wiecznej pętli odrzuceń. */
const GPS_HEALTH_STALE_MS = 20_000;
const GPS_HEALTH_RECOVERY_COOLDOWN_MS = 14_000;
const GPS_RAW_TICK_DEDUPE_MIN_MS = 220;
const GPS_RAW_TICK_DEDUPE_MIN_MOVE_M = 1.4;
const GPS_RAW_TICK_DEDUPE_ACC_IMPROVE_M = 9;
/** Kotwica starsza niż tyle — ufaj świeżemu fixowi zamiast anty-teleportu. */
const GPS_ANCHOR_STALE_REBASE_MS = 35_000;
const GPS_IOS_ANCHOR_STALE_REBASE_MAX_ACC_M = 55;
const GPS_IOS_ANCHOR_STALE_REBASE_CONFIRM_HITS = 3;
const GPS_IOS_ANCHOR_STALE_REBASE_CONFIRM_RADIUS_M = 45;
const GPS_IOS_ANCHOR_STALE_REBASE_CONFIRM_WINDOW_MS = 15_000;
const GPS_REJECT_STREAK_THRESHOLD = 12;
const LIVE_ACHIEVEMENT_CHECK_COOLDOWN_MS = 2500;
const LIVE_ACHIEVEMENT_SPEED_DELTA_TRIGGER_KMH = 2;
const LIVE_ACHIEVEMENT_DISTANCE_DELTA_TRIGGER_KM = 0.4;
const LIVE_ACHIEVEMENT_MIN_MOVING_DISTANCE_KM = 1.0;
const DRIVE_HEALTH_LOG_MS = 15_000;
/** Co tyle km zapisujemy postęp trasy na serwer (profil nie „zamraża się” na długiej jeździe). */
const TRIP_CHECKPOINT_KM = 0.2;
/** Minimalny nies zapisany blok przy wymuszonym flushu (tło / kill). */
const TRIP_CHECKPOINT_FORCE_MIN_KM = 0.05;
/** Checkpoint dystansu w trakcie jazdy — zapis co N km niezależnie od końca sesji. */
const ENABLE_TRIP_DISTANCE_CHECKPOINT = true;
/** Odrzuć pierwszy fix inicjalizacji, jeśli provider zwraca zbyt zgrubną niedokładność (często cache sieci). */
const GPS_INIT_MAX_ACCURACY_M = 150;
/** OS last-known starszy niż tyle traktujemy jako nieaktualny (nie ustawia kotwicy anty-teleportu). */
const GPS_LAST_KNOWN_MAX_AGE_MS = 30 * 60 * 1000;
/** Stojąc w miejscu: po tylu spójnych fixach w nowym miejscu odblokuj kotwicę zatrutą cache. */
const GPS_IDLE_ANCHOR_RECOVERY_MIN_DIST_M = 100;
const GPS_IDLE_ANCHOR_RECOVERY_HITS = 4;
const GPS_IDLE_ANCHOR_RECOVERY_WINDOW_MS = 45_000;
/** Po wznowieniu apki — pokaż „Szukam GPS” dopiero gdy ostatni fix jest starszy niż tyle. */
const GPS_RESUME_SPINNER_MIN_AGE_MS = 90_000;
/** Jednorazowy fix po wznowieniu — powyżej tego promienia zwykle jest to last-known z komórki, nie GPS. */
const GPS_ONESHOT_MAX_ACCURACY_M = 100;
/** Loader "Szukam GPS" nie powinien wisieć przy działających fixach o średniej dokładności. */
const GPS_ACQUIRING_RELEASE_ACCURACY_M = 130;
const GPS_ACQUIRING_RELEASE_AFTER_TICKS = 2;
const GPS_ACQUIRING_RELEASE_FALLBACK_ACCURACY_M = 180;
const GPS_ACQUIRING_ACTIVE_RELEASE_ACCURACY_M = 230;
/** Fix starszy niż tyle ms względem zegara urządzenia = typowy cache OS po uśpieniu — odrzuć. */
/** Przy długiej przerwie nie ufaj `coords.speed` z providera przy walidacji one-shot (bywa zatrzymany z jazdy). */
const GPS_WALLDT_IGNORE_SPEED_MS = 45_000;
/** Na mapie bez nawigacji/jazdy: po przerwie i niskiej prędkości jeden skok > tego (m) = zwykle sieć/Wi‑Fi, nie GPS. */
const GPS_IDLE_MAX_JUMP_AFTER_GAP_M = 1_800;
const GPS_IDLE_GAP_FOR_JUMP_GUARD_MS = 45_000;
const GPS_IDLE_SPEED_GUARD_KMH = 25;
const GPS_IDLE_RANDOM_JUMP_M = 85;
const GPS_IDLE_CONFIRM_RADIUS_M = 120;
const GPS_IDLE_CONFIRM_WINDOW_MS = 15_000;
const GPS_IDLE_CONFIRM_HITS = 3;
const GPS_IDLE_HARD_REJECT_M = 900;
/** Gdy anchor został "zatruty" teleportem, pozwól wrócić po kilku spójnych fixach. */
const GPS_IDLE_HARD_REJECT_ESCAPE_HITS = 10;
const GPS_IDLE_HARD_REJECT_ESCAPE_MAX_SPEED_KMH = 7;
const GPS_IDLE_HARD_REJECT_ESCAPE_MAX_ACC_M = 55;
const GPS_IDLE_UI_SOFT_JUMP_M = 28;
const GPS_IDLE_UI_HARD_JUMP_M = 48;
const GPS_IDLE_UI_CONFIRM_RADIUS_M = 35;
const GPS_IDLE_UI_CONFIRM_WINDOW_MS = 10_000;
/** Przy takiej prędkości traktujemy mapę jako stojącą/wolną i blokujemy skoki względem aktualnego UI. */
const GPS_IDLE_UI_LOCK_SPEED_KMH = 6;
/** Dodatkowy anti-teleport tylko dla prawie-stojącego auta i słabego sygnału. */
const GPS_STILL_LOCK_SPEED_KMH = 2.8;
const GPS_STILL_LOCK_SOFT_JUMP_M = 90;
const GPS_STILL_LOCK_CONFIRM_RADIUS_M = 60;
const GPS_STILL_LOCK_CONFIRM_WINDOW_MS = 10_000;
const GPS_STILL_LOCK_CONFIRM_HITS = 2;
const GPS_STILL_LOCK_HARD_REJECT_M = 320;
const GPS_DEBUG_BUFFER_SIZE = 30;
/** Active modes: instead of hard-dropping suspicious fixes, clamp step to keep motion smooth. */
const GPS_ACTIVE_SOFT_REBASE_MAX_STEP_M = 95;
const SNAP_STALE_MIN_KMH = 8;
// ANALIZA mphanl3x: poprzednie 60 m przepuszczało off-road 50-70 m (marker
// równolegle do drogi przez kilka sekund). Próg 35 m łapie wszystko co wykracza
// poza realną dokładność GPS (≤20 m typowo).
const SNAP_STALE_MIN_RAW_TO_SNAP_M = 35;
const SNAP_STALE_RESCUE_STREAK = 3;
/**
 * Próg rawToSnapM przy którym natychmiast resetujemy geometrię i wymuszamy match
 * (poza streak). Obniżone z 180 na 80 — w logu mphanl3x marker leciał 161 m
 * od drogi przy snapped:true (próg 180 nie zadziałał wystarczająco wcześnie).
 */
const SNAP_STALE_HARD_RESET_M = 80;

/** Próg hard reset geometrii — przy wyższej prędkości wcześniej (mniejszy widoczny lag). */

const DRIFT_CRITICAL_M = 300;
const DRIFT_CRITICAL_STREAK = 5;
/** Throttle DR_CRITICAL_REANCHOR — w poprzednim logu były 1347 wpisów (co klatkę). */
const DR_REANCHOR_LOG_THROTTLE_MS = 500;
/** Max odległość gdzie reanchor próbuje skok w stronę raw — powyżej traktujemy jako odjazd na inną drogę. */
const DR_REANCHOR_MAX_HARD_STEP_M = 35;
// PŁYNNOŚĆ v9 (analiza mphfjy6z): SNAP_STALE_ANCHOR hardRescue u\u017cywa\u0142
// DR_REANCHOR_MAX_HARD_STEP_M=35m co dawa\u0142o widoczny 35m teleport w 1 ramce
// worklet 35ms. 6\u00d7 STALE_ANCHOR w 35s = 6 widocznych skok\u00f3w 35m. Dedicated
// 15m cap dla snap stale rescue = marker w 2-3 ramki (33-50ms) p\u0142ynnie dosko\u0107y.
const SNAP_RESCUE_MAX_STEP_M = 15;
/** HUD / marker — nie wpływa na zapis vmax. */
const MAX_REALISTIC_DRIVING_KMH = MAX_SPEED_HUD_KMH;
const MAX_REALISTIC_NAV_KMH = 250;
const HEADING_FLIP_ALERT_DEG = 95;
const CAMERA_LAG_ALERT_M = 34;
// Płynność feedu worklet: 50–250 ms pokrywa opóźnienia między tickami GPS/DR (bez „dojazdu w 75 ms i stania”).
// Worklet dostaje target co 16 ms, więc duration musi być w tym rzędzie wielkości
// żeby segment się zakończył zanim przyjdzie nowy. Krótsze duration = marker
// jest CIĄGLE blisko aktualnego DR position, nie zostawia śladu animacji.
const TRIP_SMOOTH_MIN_MS = 35;
const TRIP_SMOOTH_MAX_MS = 220;


















function MapScreenInner() {
  const notificationParams = useLocalSearchParams<{ dropId?: string; lat?: string; lng?: string; start?: string }>();
  const [mapViewHeight, setMapViewHeight] = useState(0);
  const ignoreHudLayout = useCallback((_height: number) => {}, []);

  useEffect(() => {
    void initMapbox().catch(() => {});
  }, []);

  // ── Refs – mapa i GPS ────────────────────────────────────
  const mapRef               = useRef<Mapbox.MapView>(null);
  const cameraRef            = useRef<Mapbox.Camera>(null);
  const locationSubRef       = useRef<any>(null);
  const lastHeadingRef       = useRef(0);
  /** v10: Snap Lock Guard — blokuj pojedyncze odchyły snapu na boczne uliczki. */
  const snapLockPosRef       = useRef<{ lat: number; lng: number } | null>(null);
  const snapLockHdgRef       = useRef(0);
  const snapLockStreakRef    = useRef(0);
  const snapLockLastAtRef    = useRef(0);
  const routePrefixSumsRef   = useRef<{ points: any[], sums: number[] }>({ points: [], sums: [] });
  const routeForwardPrefixRef = useRef<{ points: any[]; prefix: number[] }>({ points: [], prefix: [] });
  const stepArcIndexRef = useRef<{ points: any[]; steps: any[]; index: StepArcIndex[] }>({
    points: [],
    steps: [],
    index: [],
  });
  const pendingStepArcClampRef = useRef(false);
  /** On-route arc progress — never decrease much (GPS projection jitter). */
  const lastUserArcMRef = useRef<number | null>(null);
  const locationReadyRef     = useRef(false);
  const lastNavLocRef        = useRef<{ latitude: number; longitude: number } | null>(null);
  const isOffroadRef         = useRef(false);
  const offroadPointsRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const offroadLoadedPointsRef = useRef<{ latitude: number; longitude: number }[]>([]);
  /** v10: cooldown ostatniego wywolania Map Matching API z client snap orchestrator. */
  const lastClientSnapApiAtRef = useRef<number>(0);
  /** v10: ostatni snap source dla telemetrii (route|sqlite|tile|api|raw). */
  const lastClientSnapSourceRef = useRef<string>('raw');
  /**
   * v10: ref do updateCameraFrame uzywany w applyTripPosition (zdefiniowane PRZED
   * useCameraAnimation, wiec bezposrednie wywolanie dalo by reference error).
   * Aktualizujemy w useEffect ponizej.
   */
  const lastCamPushFromGpsTickRef = useRef(0);
  const lastCamVehicleForBearingRef = useRef<{ lat: number; lng: number } | null>(null);
  /** Dłuższa baza wektora ruchu — stabilny heading kamery na prostej. */
  const lastCamBearingAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const updateCameraFrameRef = useRef<((args: {
    center: { latitude: number; longitude: number };
    heading?: number;
    speedKmh?: number;
    isNavigating?: boolean;
    isDriving?: boolean;
    timestamp?: number;
    headingFromTripPipeline?: boolean;
    segmentDurationMs?: number;
  }) => void) | null>(null);
  const lastSegmentDurationMsRef = useRef(650);

  /** Sync z useCameraAnimation — ref do isUserExploringMap (hook jest niżej w pliku). */
  const isUserExploringMapRef = useRef<() => boolean>(() => false);
  const getLastProgrammaticCameraApplyMsRef = useRef<() => number>(() => 0);

  // ── Refs – nawigacja / mowa ───────────────────────────────
  const rerouteTimerRef      = useRef<any>(null);
  const announcedPhasesRef   = useRef<Set<string>>(new Set());
  const chainedPrepareStepsRef = useRef<Set<string>>(new Set());
  const lastGuidanceStartedAtRef = useRef(0);
  const longStraightSpokenForStepRef = useRef<string | null>(null);
  const spokenWarningIdsRef = useRef<Set<string>>(new Set());
  const startIsMyLocationRef = useRef(false);
  const pendingRouteRef      = useRef<{ id: number; name: string } | null>(null);
  const loadedRouteRef       = useRef<LoadedRouteContext | null>(null);
  const routeStartZoneEnteredRef = useRef(false);
  /** Dojazd do punktu startowego trasy — bez liczenia czasu / zapisu w rankingu. */
  const approachingRouteStartRef = useRef(false);
  const autoStartRouteAfterApproachRef = useRef(false);
  const pendingDropAutoStartRef = useRef(false);
  const transitioningToRouteRunRef = useRef(false);


  const drivingConsecutiveRef = useRef(0);       // ile z rzędu odczytów ponad próg
  const DRIVING_CONSECUTIVE_REQ = 2;             // wymagane kolejne odczyty zanim wejdziemy w driving
  const lastSetLocRef = useRef<{ lat: number; lng: number } | null>(null);
  const MIN_MOVE_M = 4;                          // ignoruj ruch < 4m gdy wolno
  const DR_STALE_MS = 18_000;


  // ── Refs – dead-reckoning ─────────────────────────────────
  const drLatRef    = useRef(0);
  const drLngRef    = useRef(0);
  const drHdgRef    = useRef(0);
  const lastMovingFeedSpeedMsRef = useRef(0);
  const lastMovingAtRef = useRef(0);
  const coastingSpeedRef = useRef(0);
  const tripHeadingFilterRef = useRef<TripHeadingFilter | null>(null);
  const travelHeadingStateRef = useRef({
    lat: NaN,
    lng: NaN,
    hdg: 0,
    initialized: false,
  });
  const getTripHeadingFilter = useCallback(() => {
    if (!tripHeadingFilterRef.current) {
      tripHeadingFilterRef.current = new TripHeadingFilter();
    }
    return tripHeadingFilterRef.current;
  }, []);
  const resetTravelHeadingState = useCallback((
    lat?: number,
    lng?: number,
    hdg?: number,
  ) => {
    travelHeadingStateRef.current = {
      lat: lat ?? NaN,
      lng: lng ?? NaN,
      hdg: hdg ?? 0,
      initialized: Number.isFinite(lat) && Number.isFinite(lng),
    };
  }, []);
  const resolveTripTravelHeading = useCallback((
    snapLat: number,
    snapLng: number,
    snapHeading: number,
    speedKmh: number,
    rawLat?: number,
    rawLng?: number,
  ): number => {
    const rawPrev = lastRawForHeadingRef.current;
    const filter = getTripHeadingFilter();
    if (
      rawPrev
      && rawLat != null
      && rawLng != null
      && Number.isFinite(rawLat)
      && Number.isFinite(rawLng)
    ) {
      const movedM = haversineKm(rawPrev.lat, rawPrev.lng, rawLat, rawLng) * 1000;
      const hdg = filter.update({
        prevLat: rawPrev.lat,
        prevLng: rawPrev.lng,
        lat: rawLat,
        lng: rawLng,
        movedM,
        speedMs: Math.max(0, speedKmh / 3.6),
        speedKmh,
        snapHeading,
      });
      travelHeadingStateRef.current = { lat: snapLat, lng: snapLng, hdg, initialized: true };
      return hdg;
    }
    const prev = travelHeadingStateRef.current;
    let movedM = 0;
    let moveBearing: number | null = null;
    if (prev.initialized && Number.isFinite(prev.lat)) {
      movedM = haversineKm(prev.lat, prev.lng, snapLat, snapLng) * 1000;
      moveBearing = moveBearingBetween(prev.lat, prev.lng, snapLat, snapLng, movedM);
    }
    const hdg = resolveTravelHeading({
      snapHeading,
      moveBearing,
      movedM,
      speedKmh,
      prevHeading: prev.initialized ? prev.hdg : null,
    });
    travelHeadingStateRef.current = { lat: snapLat, lng: snapLng, hdg, initialized: true };
    return hdg;
  }, [getTripHeadingFilter]);
  /** SSOT heading: surowy wektor Pₙ₋₁→Pₙ + MA(4); snap tylko na pozycję markera. */
  const headingForDriveMarker = useCallback((
    snapLat: number,
    snapLng: number,
    pose: { heading: number; crossTrackM: number },
    speedKmh: number,
    rawLat?: number,
    rawLng?: number,
  ): number => {
    if (drivingEntryJustStartedRef.current) {
      const entryH = drivingEntryHeadingRef.current;
      const spd = speedKmhRef.current;
      const anchor = lastDrivingPosRef.current;
      const movedM = anchor
        ? haversineKm(anchor.lat, anchor.lng, snapLat, snapLng) * 1000
        : 0;
      if (spd < 5 && movedM < 3 && Number.isFinite(entryH)) {
        return normalizeHeading(entryH);
      }
    }
    return resolveTripTravelHeading(snapLat, snapLng, pose.heading, speedKmh, rawLat, rawLng);
  }, [resolveTripTravelHeading]);
  const lastWorkletFeedAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastWorkletFeedAtRef = useRef(0);
  const lastFeedWorkletCallAtRef = useRef(0);
  const lastWorkletFeedSourceRef = useRef('');
  const subAnchorTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const drLastFrameAtRef = useRef(0);

  // ── Ref – isNavigating synchronicznie ────────────────────
  const isNavigatingRef = useRef(false);
  const tripCheckpointActiveRef = useRef(false);

  // ── Ref – punkty trasy ───────────────────────────────────
  const routePointsRef = useRef<{ latitude: number; longitude: number }[]>([]);

  // ── Ref – navRoute bez stale closure ─────────────────────
  const navRouteRef = useRef<typeof navRoute | null>(null);

  // ── Ref — throttle powiadomień nawigacyjnych (co 30s) ─────
  const notifThrottleRef = useRef(0);
  const speedKmhRef = useRef(0);
  /** Surowa prędkość z Dopplera GPS (loc.coords.speed × 3.6, km/h). Niezależna od
   *  delta-pozycji — niewrażliwa na GPS jitter przy postoju. Używane do drift clamp
   *  w DR.onFrame żeby odróżnić "stoję, GPS jitteruje" od "jadę, lat/lng zamarły". */
  const rawGpsKmhRef = useRef(0);
  /** Surowy GPS dla COG kamery V3 (nie snapped marker / polilinia). */
  const rawGpsCourseRef = useRef<{ lat: number; lng: number } | null>(null);
  /** Kurs z Dopplera GPS (loc.coords.heading, °) — fallback gdy brak wektora ruchu. */
  const lastGpsDeviceHeadingRef = useRef<number | null>(null);
  const tripPeakSpeedRef = useRef(0);
  /** Ostatni feed GPS — projekcja markera w tle gdy worklet Reanimated stoi. */
  const markerProjRef = useRef({
    lat: 0,
    lng: 0,
    hdg: 0,
    speedMs: 0,
    at: 0,
  });
  /** Rzeczywista pozycja markera z workletu (~20 Hz) — do forward-only guard. */
  const markerDisplayRef = useRef({
    lat: 0,
    lng: 0,
    hdg: 0,
    speedMs: 0,
    at: 0,
  });
  const lastCamPushFromSmoothRef = useRef(0);
  const lastCamPushFromMarkerFrameRef = useRef(0);
  const lastDebugCameraLogAtRef = useRef(0);
  const lastCamPushCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastCamResolvedHdgRef = useRef<number | null>(null);
  const cameraLookaheadEmaRef = useRef(0);
  const tripForegroundRefreshUntilRef = useRef(0);
  const turnModeUntilRef = useRef(0);
  const resumeForegroundTickCountRef = useRef(0);
  const resumeFollowUpOneShotRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgMarkerTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripCheckpointSavedKmRef = useRef(0);
  const tripCheckpointInFlightRef = useRef<Promise<boolean> | null>(null);
  const liveDistanceKmRef = useRef(0);

  // ── Cost-optimisation refs ────────────────────────────────
  // sendLocation: track last sent position + time to apply distance/heartbeat gate
  const lastSendTimeRef    = useRef<number>(0);
  const lastSendLocRef     = useRef<{ lat: number; lng: number } | null>(null);
  const lastSentLiveFixAtRef = useRef(0);
  // updateCameras / updateSpeedLimit: skip if user hasn't moved CAMERA_SPEED_LIMIT_GATE_M
  const lastCameraUpdateLocRef = useRef<{ lat: number; lng: number } | null>(null);
  // reroute cooldown: limit reroute trigger frequency
  const lastRerouteTimeRef  = useRef<number>(0);
  const lastRerouteLocRef   = useRef<{ lat: number; lng: number } | null>(null);
  const lastRerouteMotionAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const offRouteSinceRef    = useRef<number>(0);
  const offRouteStreakRef   = useRef(0);
  const lastDrivingNoSnapForceRef = useRef<number>(0);
  const drivingNoSnapStreakRef = useRef(0);
  const lastSnapSuccessAtRef = useRef(0);
  const lastDrivingSqliteRecoverRef = useRef<number>(0);
  const lastClientFirstResolveRef = useRef<number>(0);
  const lastAddMatchFeedRef = useRef<number>(0);
  const lastIntersectionMatchRef = useRef<number>(0);
  /** Po starcie trybu jazdy/nawigacji: tłumimy ekstremalne skoki speed (zimny GPS fix). */
  const tripSpeedWarmupUntilRef = useRef<number>(0);
  /** Zapobiega równoległemu wejściu w driving (podwójny tap podczas await forceMatch). */
  const drivingManualEntryBusyRef = useRef(false);
  // currentLocRef: latest userLocation readable inside stable interval callbacks
  const currentLocRef       = useRef<{ latitude: number; longitude: number } | null>(null);
  /** Ostatnie znane centrum mapy — żeby Camera nie wracała na domyślne 19/52 przy migawce stanu. */
  const lastMapCenterRef    = useRef<[number, number]>((() => {
    const c = peekMapLastLocation();
    return c ? [c.longitude, c.latitude] : [19.0, 52.0];
  })());
  /** Stałe defaultSettings — bez userLocation w JSX (unika resetu kamery co re-render). */
  const cameraDefaultSettingsRef = useRef({
    centerCoordinate: lastMapCenterRef.current,
    zoomLevel: 14,
    pitch: 0 as number,
  });

  // ── NOWE Refs — GPS sanity + driving mode ─────────────────
  const lastGoodLocRef        = useRef<{ lat: number; lng: number } | null>((() => {
    const c = peekMapLastLocation();
    return c ? { lat: c.latitude, lng: c.longitude } : null;
  })());
  const gpsBootstrapPendingRef = useRef(false);
  const idleRecoveryClusterRef = useRef<{ lat: number; lng: number; hits: number; firstAt: number } | null>(null);
  const iosStaleRebaseCandidateRef = useRef<{ lat: number; lng: number; hits: number; time: number } | null>(null);
  const idleJumpCandidateRef  = useRef<{ lat: number; lng: number; time: number; hits: number } | null>(null);
  const idleUiJumpCandidateRef = useRef<{ lat: number; lng: number; time: number; hits: number } | null>(null);
  const stillLockCandidateRef = useRef<{ lat: number; lng: number; time: number; hits: number } | null>(null);
  const gpsFixDebugRef = useRef<Array<{
    at: number;
    lat: number;
    lng: number;
    acc: number;
    speedKmh: number;
    accepted: boolean;
    reason: string;
  }>>([]);
  const gpsTelemetryRef = useRef({
    watcherRestarts: 0,
    oneShotAttempts: 0,
    oneShotApplied: 0,
    oneShotRejected: 0,
    rejectedFixes: 0,
    clampedFixes: 0,
    snapRecoveryCalls: 0,
    snapRecoverySuccess: 0,
    snapRecoveryFail: 0,
    headingBypassNav: 0,
    headingBypassDrive: 0,
    snapLagCatchup: 0,
    navSkipLateralClamp: 0,
    accelBypass: 0,
    stationaryHoldBlocked: 0,
    launchFromStopReset: 0,
  });
  const gpsDbgLastLogAtRef = useRef(0);
  const gpsDbgLastAcceptedRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const driveSessionGuardRef    = useRef(new DriveSessionGuard());
  const isDrivingRef          = useRef(false);
  const drivingSinceRef       = useRef(0);
  const drivingManualModeRef  = useRef(false);
  const lastDrivingToggleAtRef = useRef(0);
  const drivingManuallyDisabledRef = useRef(false);
  const drivingManualDisabledAtRef = useRef(0);
  const kmSinceManualOffRef = useRef(0);
  const gpsForceActiveRef = useRef(false);
  const gpsLockEstablishedRef = useRef(false);
  const lastBumpActiveMarkerAtRef = useRef(0);
  const tripMoveSamplesRef = useRef<TripMoveSample[]>([]);
  const rawMotionWakeUntilRef = useRef(0);
  /** Potwierdzenie ruchu: 2 kolejne ticki ≥3 m (nie pojedynczy jitter GPS). */
  const rawMotionStreakRef = useRef(0);
  const startupMicroMoveGraceTicksRef = useRef(0);
  const lastSpeedRawAnchorRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastSpeedDiagRef = useRef<{ kmh: number; at: number } | null>(null);
  const lastMarkerDiagRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const drivingLastLocRef     = useRef<{ lat: number; lng: number } | null>(null);
  const lastDrivingPosRef     = useRef<{ lat: number; lng: number } | null>(null);
  /** Ostatnia wiarygodna motionKmh z delty pozycji — odrzuca skoki GPS w derivedKmh. */
  const lastValidMotionKmhRef = useRef(0);
  const lastRawForHeadingRef  = useRef<{ lat: number; lng: number } | null>(null);
  const snapAnchorStaleRef = useRef<{
    lat: number;
    lng: number;
    streak: number;
    lastResyncAt: number;
  } | null>(null);
  const driftCriticalStreakRef = useRef(0);
  const lastCameraLagLogAtRef = useRef(0);
  const lastHeadingFlipLogAtRef = useRef(0);
  const lastReanchorLogAtRef = useRef(0);
  /** Liczba kolejnych klatek z brakiem polilinii pod raw — używane do force-match. */
  const drNoRoadStreakRef = useRef(0);
  const cameraLagStreakRef = useRef<{ startAt: number; lastLagM: number } | null>(null);
  const lastCameraWatchdogAtRef = useRef(0);
  const markerStuckStreakRef = useRef<{ startAt: number; drToTargetM: number } | null>(null);
  const lastMarkerStuckRecoveryAtRef = useRef(0);
  // v6: anti-stale anchor reset (prewencja mega-teleportów raw_clamp 2-12km)
  const lastAntiStaleResetAtRef = useRef(0);
  // v6: debounce DR_CRITICAL_REANCHOR road ping-pong (ten sam anchor ±5m w <500ms)
  const lastReanchorAnchorRef = useRef<{
    lat: number;
    lng: number;
    at: number;
    srcLat?: number;
    srcLng?: number;
  } | null>(null);
  // ANALIZA mphbhukq v4: 8/12 MARKER_STUCK_RECOVERY na tym samym snap point
  // (53.12402, 21.678398) — snap geometria była martwa, samo resetowanie DR
  // nie pomaga bo dryf wraca w 1-2 s. Trzymamy ostatni recovery snap point
  // żeby wykryć loop i wymusić clearGeometry + force-match.
  const lastRecoverySnapRef = useRef<{ lat: number; lng: number; count: number } | null>(null);
  const lastRecoveryGeometryResetAtRef = useRef(0);
  const lastTripTargetUpdateAtRef = useRef(0);
  const lastDriveMarkerPushAtRef = useRef(Date.now());
  const drivingEntryJustStartedRef = useRef(false);
  const drivingEntryHeadingRef = useRef<number>(0);
  const drivingEntryAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const drivingEntryGraceUntilRef = useRef(0);
  /** Ostatnia poza markera/dystansu — wykrywanie „zamrożonego” snapu. */
  const lastTripMarkerPoseRef = useRef<{ lat: number; lng: number } | null>(null);
  const liveBroadcastTrailRef = useRef<{ lat: number; lng: number; t: number }[]>([]);
  /** Free drive: timestamp pierwszego ticka z crossTrack > FREE_DRIVE_SNAP_UNTRUSTWORTHY_M. */
  const freeDriveSnapDriftSinceRef = useRef<number | null>(null);
  /** Throttle branch re-snap — unika resetu arc co tick GPS. */
  const lastBranchResnapAtRef = useRef(0);
  /** Pierwszy tick GPS po wejściu w jazdę — instant teleport na raw, bez LERP. */
  const driveSessionFirstGpsFrameRef = useRef(true);
  /** Licznik klatek init dopóki geometria drogi się nie załaduje. */
  const driveSessionInitFramesRef = useRef(0);
  /** V2: bootstrap markera tylko raz na wejście w trip (nie przy każdym re-renderze). */
  const tripMarkerV2BootstrappedRef = useRef(false);
  const lastGoodTimeRef       = useRef<number>(Date.now());
  /** Rzeczywisty czas ostatniego zaakceptowanego fixu — bez cofania przy resume (walidacja one-shot). */
  const lastAcceptedFixWallClockRef = useRef<number>(Date.now());
  const lastGpsRestartAtRef   = useRef<number>(0);
  /** Ustawiane przy celowym stopGPS (np. tło free) — wymusza restart mimo „świeżego” fixAge. */
  const foregroundGpsIntentionallyStoppedRef = useRef(false);
  const lastBrowseMarkerPublishRef = useRef(0);
  const lastResumeHandledAtRef = useRef<number>(0);
  const lastForegroundResumeAtRef = useRef<number>(0);
  const lastBgDriveResumeSyncAtRef = useRef<number>(0);
  const resumeRecoveryRef = useRef(createResumeRecoveryState());
  const didColdStartBgDriveRestoreRef = useRef(false);
  const navSessionColdStartGuardUntilRef = useRef(Date.now() + 8_000);
  const lastOneShotAtRef       = useRef<number>(0);
  const pendingDrivingEntryOneShotRef = useRef(false);
  const resumeAwaitFixUntilRef = useRef<number>(0);
  const tripResumeFreezeUntilRef = useRef(0);
  const tripResumeAnchorRef = useRef<{ lat: number; lng: number; hdg: number } | null>(null);
  const tripResumeConfirmRef = useRef<{ lat: number; lng: number; hits: number } | null>(null);
  const tripResumeMotionWakeHitsRef = useRef(0);
  /** Resume freeze: licz prędkość, pomiń snap/teleport (nie return przed sanitizerem). */
  const gpsResumeSoftHoldSkipRef = useRef(false);
  const bgProjectionCooldownUntilRef = useRef(0);
  const lastLagCatchupInstantAtRef = useRef(0);
  const appStateRef            = useRef(AppState.currentState);
  const backgroundTrackingRef  = useRef(false);
  const resumeOneShotTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didRestoreNavSessionRef = useRef(false);
  // Tracks the timestamp of the previous GPS tick for per-tick distance capping.
  const prevGoodTimeRef       = useRef<number>(Date.now());
  const navStatsFlushedRef    = useRef(false);
  const passiveTripStartedRef = useRef(false);
  const lastUiLocPublishRef   = useRef(0);
  const lastSecondaryLocPublishRef = useRef(0);
  const lastHeadingUiRef      = useRef(0);
  const lastReliableSpeedMsRef = useRef<number | null>(null);
  const speedSignalHoldUntilRef = useRef(0);
  const jumpAnomalyDrUntilRef = useRef(0);
  const jumpAnomalyCarrySpeedMsRef = useRef<number | null>(null);
  const jumpRecoveryCandidateRef = useRef<{ lat: number; lng: number; hits: number; firstAt: number } | null>(null);
  const lastSpeedEmitRef = useRef<{ kmh: number; at: number } | null>(null);
  /** Stable refs so navV3.onTarget can call trip-stats feeders declared later in the hook order. */
  const feedPositionRef = useRef<(lat: number, lng: number, speedMs?: number) => number>(() => 0);
  const feedSpeedRef = useRef<(speedMs: number | null) => void>(() => {});
  const roadMatchSigRef       = useRef('');
  const drivingSnapGeometryRef = useRef<{ latitude: number; longitude: number }[]>([]);
  /** Ostatnia dobra geometria drogi — grace gdy chwilowy brak matchu (free drive). */
  const lastGoodDrivingSnapGeometryRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const markerStaleSnapTicksRef = useRef(0);
  const drivingSnapUsesMatchedRef = useRef(false);
  const lastRoadLockRepairAtRef = useRef(0);
  const drivingMarkerStallRef = useRef({
    rawLat: 0,
    rawLng: 0,
    drLat: 0,
    drLng: 0,
    at: 0,
  });
  const navRouteIdxRef        = useRef(-1);
  const previewRouteRef       = useRef<DirectionsResult | null>(null);
  const lastDistToTurnUiRef   = useRef<number | null>(null);
  const lastRemainingKmUiRef  = useRef<number | null>(null);
  const lastRemainingRouteHeadRef = useRef<{ lat: number; lng: number; idx: number; atMs: number } | null>(null);
  const lastManeuverDistanceRef = useRef<{ stepIndex: number; distanceM: number } | null>(null);
  const reroutePendingRef     = useRef(false);
  const reroutePendingSinceRef = useRef<number>(0);
  const rerouteBlockedUntilRef = useRef<number>(0);
  const rerouteGraceUntilRef = useRef<number>(0);
  const lastAppliedRerouteSigRef = useRef<string>('');
  const lastBackgroundAtRef   = useRef<number>(0);
  const gpsTickCountRef       = useRef(0);
  const drTickCountRef        = useRef(0);
  const lastGpsTickAtRef      = useRef(0);
  const lastExpoGpsTickAtRef  = useRef(0);
  const lastNativeDrivePipelineAtRef = useRef(0);
  const lastExpoSeenAtRef = useRef(0);
  const lastNativeSeenAtRef = useRef(0);
  const lastTripStaleAnchorRecoveryAtRef = useRef(0);
  /** v10.9: mierzona kadencja GPS (przerwa miedzy poprzednim i przedostatnim
   *  fixem) — uzywana do dobierania durationMs interpolacji markera w worklet. */
  const gpsCadenceMsRef       = useRef(1200);
  const lastRawTickRef = useRef<{ lat: number; lng: number; at: number; acc: number } | null>(null);
  const lastActiveRecoveryAtRef = useRef(0);
  const lastGpsHealthRecoveryAtRef = useRef(0);
  const profileTotalDistanceKmRef = useRef(0);
  const liveAchLastCheckAtRef = useRef(0);
  const liveAchLastSpeedSubmittedRef = useRef(0);
  const liveAchLastDistanceSubmittedRef = useRef(0);
  const liveAchSessionPeakSpeedRef = useRef(0);
  const liveAchTripStartDistanceRef = useRef(0);
  const liveAchInFlightRef = useRef(false);
  const liveAchUnlockedKeysRef = useRef<Set<string>>(new Set());
  const diagLastSnapshotRef   = useRef<{
    at: number;
    lat: number;
    lng: number;
  } | null>(null);
  const diagStuckStreakRef    = useRef(0);

  const lastMapPersistAtRef = useRef(0);
  const persistMapLocation = useCallback((lat: number, lng: number, acc?: number) => {
    const now = Date.now();
    if (now - lastMapPersistAtRef.current < 3500) return;
    lastMapPersistAtRef.current = now;
    void saveMapLastLocation(lat, lng, acc);
  }, []);

  const publishUserLocation = useCallback((loc: { latitude: number; longitude: number }, force = false) => {
    if (
      !Number.isFinite(loc.latitude)
      || !Number.isFinite(loc.longitude)
      || isNullIsland(loc.latitude, loc.longitude)
    ) {
      vroomGpsLog('LOCATION_PUBLISH_SKIPPED', {
        lat: Number.isFinite(loc.latitude) ? Number(loc.latitude.toFixed(6)) : loc.latitude,
        lng: Number.isFinite(loc.longitude) ? Number(loc.longitude.toFixed(6)) : loc.longitude,
      }, 2000);
      return;
    }
    const now = Date.now();
    currentLocRef.current = loc;
    const highPriority = isNavigatingRef.current || isDrivingRef.current;
    const minGap = highPriority
      ? ACTIVE_UI_LOCATION_THROTTLE_MS
      : UI_LOCATION_THROTTLE_MS;
    if (highPriority) {
      if (!force && now - lastUiLocPublishRef.current < minGap) {
        return;
      }
      lastUiLocPublishRef.current = now;
      setUserLocation(loc);
      if (now - lastSecondaryLocPublishRef.current >= SECONDARY_LOC_PUBLISH_MS) {
        lastSecondaryLocPublishRef.current = now;
        persistMapLocation(loc.latitude, loc.longitude);
      }
      return;
    } else if (!force && now - lastUiLocPublishRef.current < minGap) {
      return;
    }
    lastUiLocPublishRef.current = now;
    setUserLocation(loc);
    if (force) {
      if (now - lastSecondaryLocPublishRef.current >= SECONDARY_LOC_PUBLISH_MS) {
        lastSecondaryLocPublishRef.current = now;
        persistMapLocation(loc.latitude, loc.longitude);
      }
    }
  }, [persistMapLocation]);

  /** Każdy zaakceptowany fix GPS → marker (browse + jazda).
   *
   * W trybie jazdy/nawigacji marker prowadzi useDeadReckoning.onFrame; bumpa nie
   * ma teleportować refów DR (powoduje cofnięcie markera z forward projection).
   * Tylko publishUserLocation dla socket/UI.
   */
  const bumpMapMarker = useCallback((
    lat: number,
    lng: number,
    opts?: { force?: boolean },
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    publishUserLocation({ latitude: lat, longitude: lng }, opts?.force ?? false);
  }, [publishUserLocation]);

  /** GPS → marker bootstrap via V3 (wired after tripBootstrapPose is defined). */
  const tripBootstrapPoseRef = useRef<(
    lat: number,
    lng: number,
    heading: number,
    opts?: { animateCamera?: boolean },
  ) => void>(() => {});

  const bumpActiveMarker = useCallback((
    lat: number,
    lng: number,
    opts?: { heading?: number; forcePublish?: boolean; instant?: boolean; speedMs?: number },
  ) => {
    if (!isNavigatingRef.current && !isDrivingRef.current) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const hdg = opts?.heading ?? drHdgRef.current ?? lastHeadingRef.current ?? 0;
    if (opts?.heading != null && Number.isFinite(opts.heading)) {
      drHdgRef.current = opts.heading;
    }
    tripBootstrapPoseRef.current(lat, lng, hdg, { animateCamera: !!opts?.instant });
    publishUserLocation({ latitude: lat, longitude: lng }, opts?.forcePublish ?? true);
  }, [publishUserLocation]);

  /** Single source of truth for active-trip marker anchoring (driving/navigation).
   *
   * W aktywnej jeździe/nawigacji marker płynie przez useDeadReckoning.onFrame
   * (30Hz lerp + ekstrapolacja Dopplerem). applyTripPosition karmi DR z nowym
   * targetem; bumpActiveMarker odpalamy wyłącznie gdy instant=true (entry/resume/
   * bootstrap) lub gdy jeszcze nie jesteśmy w trybie jazdy/nawigacji (idle).
   * Inaczej bumpa cofa marker do raw_GPS i kasuje projekcję bridge'a.
   */
  const clearSubAnchorTimers = useCallback(() => {
    subAnchorTimersRef.current.forEach((t) => clearTimeout(t));
    subAnchorTimersRef.current = [];
  }, []);


  /**
   * v10 CLIENT-FIRST snap orchestrator. Hierarchia od najtanszej do najdrozszej:
   *   L1 NAV route polyline (FREE, 100% pewny)
   *   L2 SQLite roadGeometryStore.findNearest 120m (FREE, perzyste)
   *   L3 queryRenderedFeatures z renderowanych Mapbox tiles (FREE, lokalne)
   *
   * Walidacja: kazdy snap musi byc <=35m od raw GPS (sasiednia ulica = odrzut).
   * Zwraca null = uzyj raw GPS. L4 Map Matching API jest trigger'owane separate
   * w driving handler (background, ze swoim cooldownem).
   */
  const getLocalSnapTarget = useCallback(async (
    lat: number,
    lng: number,
  ): Promise<{
    latitude: number;
    longitude: number;
    source: 'route' | 'sqlite' | 'tile';
    polylinePoints: { latitude: number; longitude: number }[];
  } | null> => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    // L1: NAV route polyline
    if (isNavigatingRef.current && routePointsRef.current.length >= 2) {
      const s = snapToRoute(lat, lng, routePointsRef.current, NAV_ROUTE_SNAP_M);
      const distM = haversineKm(lat, lng, s.latitude, s.longitude) * 1000;
      if (distM <= NAV_ROUTE_SNAP_M) {
        return {
          latitude: s.latitude,
          longitude: s.longitude,
          source: 'route',
          polylinePoints: routePointsRef.current,
        };
      }
    }

    // L2: SQLite cache
    try {
      const cached = await roadGeometryStore.findNearest(lat, lng, 120);
      if (cached && Array.isArray(cached.points) && cached.points.length >= 2) {
        const s = snapToRoute(lat, lng, cached.points, 35);
        const distM = haversineKm(lat, lng, s.latitude, s.longitude) * 1000;
        if (distM <= 30 && validateGeometryAgainstRaw(cached.points, lat, lng, 35)) {
          return {
            latitude: s.latitude,
            longitude: s.longitude,
            source: 'sqlite',
            polylinePoints: cached.points,
          };
        }
      }
    } catch {
      /* ignore */
    }

    // L3: queryRenderedFeatures (vector tiles)
    try {
      const polylines = await getLocalRoadGeometry(mapRef, lat, lng);
      if (polylines) {
        const nearest = pickNearestPolyline(polylines, lat, lng);
        if (nearest && nearest.length >= 2 && validateGeometryAgainstRaw(nearest, lat, lng, 30)) {
          const s = snapToRoute(lat, lng, nearest, 30);
          const distM = haversineKm(lat, lng, s.latitude, s.longitude) * 1000;
          if (distM <= 25) {
            void roadGeometryStore.insert(nearest).catch(() => {});
            return {
              latitude: s.latitude,
              longitude: s.longitude,
              source: 'tile',
              polylinePoints: nearest,
            };
          }
        }
      }
    } catch {
      /* ignore */
    }

    return null;
  }, []);

  /** Polilinia drogi z lokalnych źródeł (bez Map Matching HTTP). */
  const resolveLocalRoadPolylineForMatch = useCallback(async (
    lat: number,
    lng: number,
  ): Promise<{
    points: { latitude: number; longitude: number }[];
    source: 'route' | 'sqlite' | 'tile' | 'memory';
  } | null> => {
    const hit = await getLocalSnapTarget(lat, lng);
    if (hit && hit.polylinePoints.length >= 2) {
      return { points: hit.polylinePoints, source: hit.source };
    }
    const mem = drivingSnapUsesMatchedRef.current
      ? drivingSnapGeometryRef.current
      : [];
    if (mem.length >= 6 && validateGeometryAgainstRaw(mem, lat, lng, 45)) {
      return { points: mem, source: 'memory' };
    }
    return null;
  }, [getLocalSnapTarget]);

  const publishHeading = useCallback((hdg: number) => {
    const spdKmh = speedKmhRef.current;
    let outHdg = hdg;
    const prev = lastHeadingRef.current;
    const tripActive = isNavigatingRef.current || isDrivingRef.current;
    if (Number.isFinite(prev) && Number.isFinite(hdg) && spdKmh < TRIP_COMPASS_HEADING_MAX_KMH) {
      const delta = Math.abs(((hdg - prev + 540) % 360) - 180);
      if (delta > 22) {
        const t = spdKmh < 3 ? 0.12 : 0.22;
        const diff = ((hdg - prev + 540) % 360) - 180;
        outHdg = ((prev + diff * t) + 360) % 360;
      } else if (spdKmh < 3 && delta > 8) {
        outHdg = prev;
      }
    } else if (tripActive && spdKmh >= TRIP_COMPASS_HEADING_MAX_KMH) {
      const delta = ((hdg - prev + 540) % 360) - 180;
      const maxTurn = 35;
      outHdg = ((prev + Math.sign(delta) * Math.min(Math.abs(delta), maxTurn)) + 360) % 360;
    }
    lastHeadingRef.current = outHdg;
    if (tripActive) {
      // Trip marker/camera read heading from refs/shared values; React state would re-render the whole map.
      lastHeadingUiRef.current = outHdg;
      return;
    }
    lastHeadingUiRef.current = outHdg;
    setHeading(outHdg);
  }, []);

  const pushGpsDebugFix = useCallback((entry: {
    lat: number;
    lng: number;
    acc: number;
    speedKmh: number;
    accepted: boolean;
    reason: string;
  }) => {
    if (!MAP_RENDER_DEBUG) return;
    const now = Date.now();
    const maybeLog = (kind: string, payload: Record<string, unknown>, throttleMs = 0) => {
      if (throttleMs > 0 && now - gpsDbgLastLogAtRef.current < throttleMs) return;
      gpsDbgLastLogAtRef.current = now;
      console.log(`[GPSDBG] ${kind}`, JSON.stringify({ at: now, ...payload }));
    };
    const next = [
      ...gpsFixDebugRef.current,
      { at: now, ...entry },
    ].slice(-GPS_DEBUG_BUFFER_SIZE);
    gpsFixDebugRef.current = next;
    if (!entry.accepted) gpsTelemetryRef.current.rejectedFixes += 1;
    if (entry.reason.includes('clamped')) gpsTelemetryRef.current.clampedFixes += 1;
    if (!entry.accepted) {
      maybeLog('FIX_REJECT', {
        reason: entry.reason,
        lat: Number(entry.lat.toFixed(6)),
        lng: Number(entry.lng.toFixed(6)),
        accM: Math.round(entry.acc),
        speedKmh: Math.round(entry.speedKmh),
      });
      return;
    }
    maybeLog('FIX_ACCEPT', {
      reason: entry.reason,
      lat: Number(entry.lat.toFixed(6)),
      lng: Number(entry.lng.toFixed(6)),
      accM: Math.round(entry.acc),
      speedKmh: Math.round(entry.speedKmh),
    }, 2_000);
    if (entry.reason !== 'accepted_raw') return;
    const prev = gpsDbgLastAcceptedRef.current;
    if (prev) {
      const dtMs = Math.max(1, now - prev.at);
      const jumpM = haversineKm(prev.lat, prev.lng, entry.lat, entry.lng) * 1000;
      if (entry.speedKmh < 2 && dtMs <= 25_000 && jumpM >= 45) {
        maybeLog('STATIONARY_JUMP', {
          jumpM: Math.round(jumpM),
          dtMs,
          speedKmh: Math.round(entry.speedKmh),
          from: { lat: Number(prev.lat.toFixed(6)), lng: Number(prev.lng.toFixed(6)) },
          to: { lat: Number(entry.lat.toFixed(6)), lng: Number(entry.lng.toFixed(6)) },
        });
      }
    }
    gpsDbgLastAcceptedRef.current = { lat: entry.lat, lng: entry.lng, at: now };
  }, []);

  // ── BUILD FINGERPRINT ─────────────────────────────────────────────────────
  // Loguje przy każdym mount mapy konkretną wersję patchy. Patrz na pierwszy
  // wpis w telemetrii — jeśli go nie ma, kod NIE doleciał do urządzenia
  // (problem w `eas update` / cache / kanał) i żadne zmiany w kodzie nie
  // zadziałają, bo telefon ich nie widzi.
  useEffect(() => {
    vroomGpsLog('BUILD_FINGERPRINT', {
      version: 'v10.44-camera-stable-heading',
      platform: Platform.OS,
      mountedAt: new Date().toISOString(),
      features: {
        clientSnapHierarchy: true,
        snapRadiusMatched30m: true,
        snapRadiusBase22m: true,
        snapLateralReject25m: true,
        snapMaxToRawGuard60m: true,
        snapHardDrop120m: true,
        validateGeometryAgainstRaw: true,
        navRouteSnap80m: true,
        rerouteThreshold100m: true,
        queryRenderedFeaturesSnap: true,
        prefetchAroundRoute: true,
        simpleMarkerInDriving: true,
        lightWorkletPosition: true,
        noDrInDriving: true,
        gpsPipelineSimplified: true,
        rescueMechanismsDisabled: true,
        apiMapMatchCooldown60s: true,
        v10_1_markerInHoldPath: true,
        v10_1_cameraFollowFromApplyTripPosition: true,
        v10_1_rawGpsAsPrimary: true,
        v10_2_tripPublishesUserLocation: true,
        v10_2_iosGhostHighSpeedReject: true,
        v10_3_androidGestureGuard: true,
        v10_3_markerFallbackToDrRef: true,
        v10_3_abruptGhostSpeedReject: true,
        v10_4_primaryFromAppliedSnap: true,
        v10_4_holdPinsSnappedAnchor: true,
        v10_4_localRefineOnlyWhenNoReliableSnap: true,
        v10_5_tripUiThrottle120ms: true,
        v10_5_speedEmitSpikeBlock: true,
        v10_6_speedometerHudSingleSubscriber: true,
        v10_6_speedometerNotDrivenByMapState: true,
        v10_7_adaptiveLateralReject: true,
        v10_7_bridgeOnlyWhenReallyFrozen: true,
        v10_8_lateralClampInsteadOfReject: true,
        v10_8_rawFallbackUsesRawNotAnchor: true,
        v10_8_fastSnapRecoveryStreak2: true,
        v10_9_smoothMarkerWorkletRestored: true,
        v10_9_workletFedFromApplyTripPosition: true,
        v10_9_adaptiveGpsCadenceInterpolation: true,
        v10_10_cameraAutoReturnAfter4sInactivity: true,
        v10_11_navCameraBottomPadding: true,
        v10_11_increasedLookahead: true,
        v10_12_workletDeadReckoningBetweenFixes: true,
        v10_12_noRawGpsOnSnapFail: true,
        v10_12_bridgeDisabledInV10: true,
        v10_12_maxSnapJump20m: true,
        v10_12_localRefineOnlyWhenUnsnapped: true,
        v10_13_liveCruiseWorklet60fps: true,
        v10_13_continuousForwardFromSpeed: true,
        v10_14_workletHookOnMapScreen: true,
        v10_14_geomValidateBeforeRoadMatch: true,
        v10_14_cameraFollowsSmoothMarker30fps: true,
        v10_14_lateralHardClampNotReject: true,
        v10_14_mapMatchInterval14s: true,
        v10_15_anchorForwardNotIntegrate: true,
        v10_15_lowCameraLookaheadMeters: true,
        v10_15_fasterCameraCenterTau: true,
        v10_16_drivingHudPaddingTop: true,
        v10_16_zeroGeoLookahead: true,
        v10_16_markerJsLerpRender: true,
        v10_18_mapboxPaddingTopHeavy: true,
        v10_18_cameraPaddingPropOnMapboxCamera: true,
        v10_19_useAnimatedReactionMarker: true,
        v10_19_useAnimatedReactionCamera: true,
        v10_20_displayListenerSync: true,
        v10_20_noUseAnimatedReaction: true,
        v10_21_cameraFromApplyTripPositionOnly: true,
        v10_22_workletFeedGateDeprecatedSources: true,
        v10_23_bumpInstantViaApplyTripPosition: true,
        v10_22_feedAlwaysNotifyDisplay: true,
        v10_23_markerOnlyFrameCallbackNotify: true,
        v10_23_hudSpeedCap250: true,
        v10_23_workletLastNonZeroSpeed: true,
        v10_25_ssot_noTripMarkerDisplay: true,
        v10_25_ssot_noFrameSnapLoop: true,
        v10_25_ssot_cameraFromWorkletOnly: true,
        v10_25_workletLerpToAnchor: true,
        v10_25_notifyThrottle40ms: true,
        v10_26_gateFreePushTarget: true,
        v10_27_shapeSourceMarkerNoMarkerView: true,
        v10_27_1_noAnimatedShapeSource: false,
        v10_27_2_noMapboxImagesSymbolLayer: false,
        v10_27_cameraFromDriveMarkerSv60fps: true,
        v10_27_noGpsTickCameraPush: true,
        v10_28_navHudDopplerMerge: true,
        v10_28_navV2RejectRawGlide: true,
        v10_28_offrouteCamThrottle: true,
        v10_28_navRemainingRouteHysteresis: true,
        v10_29_mapboxAbortRnSafe: true,
        v10_29_staleSegmentCacheBypass: true,
        v10_29_driveMatchGeometrySync: true,
        v10_29_markerHeadingSnapAlign: true,
        v10_29_mapMatchFallbackEnabled: true,
        v10_30_cameraHeadingFromSnapNotWorklet: true,
        v10_30_cameraMotionBearingMerge: true,
        v10_30_markerSyncHeadingOnGps: true,
        v10_31_snapUnfreezeWhenRawGap40m: true,
        v10_43_freeDriveRawMarker40kmh: false,
        v10_43_skipResyncOnRoadMatchFreeDrive: false,
        v10_45_snapWhenGeometryExists: true,
        v10_45_urgentOffRoadApiBypass: true,
        v10_43_noZeroSpeedOnMatchResync: true,
        v10_44_cameraHoldHeadingHighSpeed: true,
        v10_44_cameraPushMoveGate: true,
        v10_44_cameraNorthAmbiguityGuard: true,
      },
    }, 0);
  }, []);

  // ── State – lokalizacja ───────────────────────────────────
  const [userLocation,  setUserLocation]  = useState<LocationState | null>(() => {
    const c = peekMapLastLocation();
    return c ? { latitude: c.latitude, longitude: c.longitude } : null;
  });
  const [startLocation, setStartLocation] = useState<LocationState | null>(null);
  const [endLocation,   setEndLocation]   = useState<LocationState | null>(null);
  const [region,        setRegion]        = useState<any>(() => {
    const c = peekMapLastLocation();
    return c
      ? { latitude: c.latitude, longitude: c.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 }
      : null;
  });
  const [heading,       setHeading]       = useState(0);
  const [speed,         setSpeed]         = useState<number | null>(null);
  const lastGpsAccuracyRef = useRef<number | null>(null);
  const [locationReady, setLocationReady] = useState(() => peekMapLastLocation() != null);
  /** true tylko gdy nie mamy żadnej pozycji do pokazania — nie blokuje live GPS przy słabszym sygnale. */
  const [gpsAcquiring, setGpsAcquiring] = useState(() => peekMapLastLocation() == null);
  const gpsAcquiringRef = useRef(gpsAcquiring);

  // ── State – nawigacja ─────────────────────────────────────
  const [isNavigating, setIsNavigating] = useState(false);
  const [navHudVisible, setNavHudVisible] = useState(false);
  const wasNavigatingRef = useRef(false);
  const [navStartLoc,  setNavStartLoc]  = useState<LocationState | null>(null);
  const [currentStep,  setCurrentStep]  = useState(0);
  const currentStepRef = useRef(0);
  currentStepRef.current = currentStep;
  const [announceStepIndex, setAnnounceStepIndex] = useState(0);
  const announceStepIndexRef = useRef(0);
  const [offRoute,     setOffRoute]     = useState(false);
  const offRouteRef = useRef(false);
  offRouteRef.current = offRoute;
  /** V3: natychmiast wyłącz snap do starej trasy (ref — bez czekania na React state). */
  const v3SnapToRouteSuppressedRef = useRef(false);
  // rerouteOrigin is set (with cooldown) when user goes off-route.
  // Using a dedicated state instead of `userLocation` prevents the
  // reroute Directions hook from re-firing on every GPS tick while off-route.
  const [rerouteOrigin, setRerouteOrigin] = useState<LocationState | null>(null);
  const [rerouteHeadingForApi, setRerouteHeadingForApi] = useState<number | undefined>(undefined);
  /** Trasa po reroute — bez zmiany navStartLoc (unika drugiego Directions przy tym samym reroute). */
  const [navRouteOverride, setNavRouteOverride] = useState<DirectionsResult | null>(null);
  const [arrived,      setArrived]      = useState(false);
  const arrivedRef = useRef(false);
  arrivedRef.current = arrived;
  const dropZoneClaimToastAtRef = useRef(0);
  const [routeInfo,    setRouteInfo]    = useState<(RouteInfo & { durationText?: string | null }) | null>(null);

  useEffect(() => {
    if (isNavigating && !wasNavigatingRef.current) setNavHudVisible(true);
    wasNavigatingRef.current = isNavigating;
  }, [isNavigating]);

  /** Ref synced every render — GPS callback must not depend on `routeInfo` (object churn resubscribes watch). */
  const routeInfoRef = useRef(routeInfo);
  routeInfoRef.current = routeInfo;
  const [isOffroadRoute, setIsOffroadRoute] = useState(false);

  // ── State – dr tick ───────────────────────────────────────
  // ── NOWY State — tryb driving ─────────────────────────────
  const [isDriving,    setIsDriving]    = useState(false);
  const [mapFabModalVisible, setMapFabModalVisible] = useState(false);
  const isMapFocusedRef = useRef(true);
  const [isMapFocused, setIsMapFocused] = useState(true);
  const navProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runNavProgressRef = useRef<() => void>(() => {});
  const navigationBootstrapTokenRef = useRef(0);
  const cameraSpeedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveSendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapMatchApplySeqRef = useRef(0);

  // ── State — live distances (nawigacja) ────────────────────
  const [distToTurnM,     setDistToTurnM]     = useState<number | null>(null);
  const [remainingDistKm, setRemainingDistKm] = useState<number | null>(null);
  const [remainingDurationMin, setRemainingDurationMin] = useState<number | null>(null);
  const remainingDurationMinRef = useRef<number | null>(null);

  // ── State – markery ───────────────────────────────────────
  const [carMarkerImage,      setCarMarkerImage]      = useState<string | null>(null);
  const [arrowMarkerImage,    setArrowMarkerImage]    = useState<string | null>(null);
  const [myAvatarUrl,         setMyAvatarUrl]         = useState<string | null>(null);
  const [myUsername,          setMyUsername]          = useState('');
  const [preferredFuel,       setPreferredFuel]       = useState<string | null>(null);
  const [pinImages,           setPinImages]           = useState<Record<string, string>>({});
  const [routeEndpointImages, setRouteEndpointImages] = useState<{ start?: string; end?: string }>({});

  // ── State – UI ────────────────────────────────────────────
  const [mapType,            setMapType]            = useState('standard');
  const [settingsVisible,    setSettingsVisible]    = useState(false);
  const [reportVisible,      setReportVisible]      = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [userInfoVisible,    setUserInfoVisible]    = useState(false);
  const [selectedUser,       setSelectedUser]       = useState<User | null>(null);
  const navigationVoice = useNavigationVoice();
  const isSpeechEnabled = navigationVoice.masterEnabled;
  const [resolvedNavigationCue, setResolvedNavigationCue] = useState<ResolvedNavigationCue | null>(null);
  const resolvedNavigationCueRef = useRef<ResolvedNavigationCue | null>(null);
  const [saveRouteVisible,   setSaveRouteVisible]   = useState(false);
  const [remainingRoutePoints, setRemainingRoutePoints] = useState<
    { latitude: number; longitude: number }[]
  >([]);
  const [navigationUiReady, setNavigationUiReady] = useState(false);
  const [selectedRouteIndex,   setSelectedRouteIndex]   = useState(0);
  const [tripStatsVisible,     setTripStatsVisible]     = useState(false);
  const [addCameraVisible,     setAddCameraVisible]     = useState(false);
  const [cameraPickMode,       setCameraPickMode]       = useState(false);
  const [manualTargetPickMode, setManualTargetPickMode] = useState(false);
  const [pendingAddCameraParams, setPendingAddCameraParams] = useState<{
    maxspeed: number | null;
    type: CameraType;
    description: string | null;
  } | null>(null);
  const pickCenterRef = useRef<{ lat: number; lng: number }>({ lat: 0, lng: 0 });
  const [selectedCamera,       setSelectedCamera]       = useState<SpeedCamera | null>(null);
  const [cameraDetailVisible,  setCameraDetailVisible]  = useState(false);
  const lastPreviewOriginBumpRef = useRef(0);
  const lastPreviewOriginCoordRef = useRef<{ lat: number; lng: number } | null>(null);
  const [livePreviewOriginTick, setLivePreviewOriginTick] = useState(0);
  const endLocationRef = useRef<LocationState | null>(null);
  const [stableStartLocation, setStableStartLocation] = useState<LocationState | null>(null);

  // ── State – fuel stations ─────────────────────────────────
  const [selectedFuelStation,     setSelectedFuelStation]     = useState<any>(null);
  const [fuelStationModalVisible, setFuelStationModalVisible] = useState(false);
  const [selectedPartnerPoi, setSelectedPartnerPoi] = useState<PartnerPoi | null>(null);
  const [partnerPoiModalVisible, setPartnerPoiModalVisible] = useState(false);
  const [selectedOfficialMeet, setSelectedOfficialMeet] = useState<OfficialMapMeet | null>(null);
  const [officialMeetModalVisible, setOfficialMeetModalVisible] = useState(false);
  const [fuelAddMode, setFuelAddMode] = useState(false);
  const [addFuelStationVisible, setAddFuelStationVisible] = useState(false);
  const [addFuelStationCoords, setAddFuelStationCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const { stations: fuelStations, updatePrices: updateFuelPrices, refetch: refetchFuelStations, onLocationChange: onFuelLocationChange, createStation: createFuelStation } = useFuelStations(userLocation);
  const { pois: partnerPois } = usePartnerPois(userLocation);
  const { meets: officialMapMeets } = useOfficialMapMeets();
  // ── State – live / ostrzeżenia ────────────────────────────
  const [isSharing,           setIsSharing]           = useState(true);
  const isSharingRef          = useRef(true);
  /** Live socket — zależny wyłącznie od isSharing (działa w tle na innych zakładkach). */
  const liveMapEnabled = isSharing;
  /** Po pierwszym odczycie shareLocation z /api/profile/me — wtedy syncujemy flagę BG. */
  const [sharingHydrated,    setSharingHydrated]    = useState(false);
  const [isSubmittingWarning, setIsSubmittingWarning] = useState(false);
  const [selectedWarning,     setSelectedWarning]     = useState<LiveWarning | null>(null);
  const handleReportRef = useRef<((report: WarningType | CreateWarningInput) => Promise<void>) | null>(null);
  const [speedLimitReportVisible, setSpeedLimitReportVisible] = useState(false);
  const [currentUserId,       setCurrentUserId]       = useState<number | null>(null);

  // ── State – demo users ────────────────────────────────────
  const [demoUsers, setDemoUsers] = useState<User[]>([]);

  // ── State – leaderboard ───────────────────────────────────
  const [leaderboardRouteId,   setLeaderboardRouteId]   = useState<number | null>(null);
  const [leaderboardRouteName, setLeaderboardRouteName] = useState('');
  const [leaderboardVisible,   setLeaderboardVisible]   = useState(false);
  const [myFinishedTime,       setMyFinishedTime]       = useState<number | null>(null);

  // ── Symulator ─────────────────────────────────────────────
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentZoom,  setCurrentZoom]  = useState(15);
  const [mapStyleEpoch, setMapStyleEpoch] = useState(0);

  useEffect(() => {
    void clearTelemetry();
    void logTelemetry('TELEMETRY_BOOT', { scope: 'map_screen' });
  }, []);

  // ─────────────────────────────────────────────────────────
  // Hooki
  // ─────────────────────────────────────────────────────────

  const router = useRouter();
  const { theme, isDark, presetId } = useTheme();
  const { isPremium } = useSubscriptionStatus();
  const isPremiumRef = useRef(isPremium);
  useEffect(() => {
    isPremiumRef.current = isPremium;
  }, [isPremium]);
  const { activeSkin: cursorSkinActive } = useCursorSkin();
  const {
    vehicle: equippedMapVehicle,
    reload: reloadEquippedVehicle,
    loading: equippedVehicleLoading,
    modelHealth,
  } = useEquippedMapVehicle();
  const cursorSkinOverlay = cursorSkinActive?.imageUrl
    ? { imageUrl: cursorSkinActive.imageUrl, borderColor: cursorSkinActive.borderColor }
    : null;
  const { startConversation } = useChat({ realtime: false, autoFetch: false });
  const { settings } = useSettings();
  const wantVehicle3DMarker = settings.locationMarkerStyle === 'vehicle_3d';
  const useVehicle3DMarker = wantVehicle3DMarker && !!equippedMapVehicle?.assetUrl && !equippedVehicleLoading;
  const useNativeVehicleModel = useVehicle3DMarker
    && modelHealth === 'ok'
    && !!equippedMapVehicle?.assetUrl;
  /** Strzałka gdy model się ładuje LUB gdy 3D jeszcze nie gotowy — nigdy pusta mapa. */
  const showSelf2DMarker = !wantVehicle3DMarker || !useNativeVehicleModel;
  const showArrowWhileLoading = wantVehicle3DMarker && !useNativeVehicleModel;
  const selfMarkerUsesArrow = settings.locationMarkerStyle === 'arrow' || showArrowWhileLoading;
  const insets = useSafeAreaInsets();
  const styles = makeMapStyles(theme, isDark, insets.top, { mapControlsTop: 12 });
  const hudStyles = useHudStyles();
  const homeLocation = (
    Number.isFinite(settings.homeLatitude) &&
    Number.isFinite(settings.homeLongitude) &&
    settings.homeLatitude != null &&
    settings.homeLongitude != null
  )
    ? {
        latitude: settings.homeLatitude,
        longitude: settings.homeLongitude,
        name: settings.homeLabel || 'Dom',
      }
    : null;
  const mapStyle = resolveMapStyleForVehicle3d(mapType, isDark, useVehicle3DMarker, presetId);
  useEffect(() => {
    setMapStyleEpoch(0);
  }, [mapStyle]);
  const enableThreeDScene = mapType !== 'satellite';
  const isTripActiveMap = isNavigating || isDriving;
  /** Aktywne 3D nie ma 2D underlay; 2D renderuje się tylko jako fallback przez showSelf2DMarker. */
  const showTripArrowUnderlay = false;
  const getTripActive = useCallback(
    () => isDrivingRef.current || isNavigatingRef.current,
    [],
  );
  const getDriveMarkerSeedPose = useCallback(() => {
    const pose = resolveBestKnownPose({
      drLat: drLatRef.current,
      drLng: drLngRef.current,
      drHdg: drHdgRef.current,
      tripActive: isDrivingRef.current || isNavigatingRef.current,
      lastSetLoc: lastSetLocRef.current,
      lastGoodLoc: lastGoodLocRef.current,
      userLocation: currentLocRef.current ?? userLocation,
      headingFallback: lastGpsDeviceHeadingRef.current ?? lastHeadingRef.current,
    });
    if (!pose) return null;
    const headingDeg = resolveTripBootstrapHeadingHint(
      pose.latitude,
      pose.longitude,
      pose.headingDeg,
      {
        gpsDeviceHdg: lastGpsDeviceHeadingRef.current,
        lastHeading: lastHeadingRef.current,
        lastSetLoc: lastSetLocRef.current,
        lastGoodLoc: lastGoodLocRef.current,
        speedKmh: speedKmhRef.current,
      },
    );
    return { lat: pose.latitude, lng: pose.longitude, headingDeg };
  }, [userLocation]);

  /** Marker prowadzony po łuku drogi na UI thread. */
  const driveMarker = useDriveMarkerV3(isTripActiveMap, getDriveMarkerSeedPose);
  const navV3Mode: NavMode = isNavigating
    ? 'navigation'
    : isDriving
      ? 'freeDrive'
      : 'idle';

  const buildV3Geometry = useCallback(() => {
    const rawForGeometry = rawGpsCourseRef.current ?? lastRawForHeadingRef.current;
    const canValidateRoadGeometry = Boolean(
      rawForGeometry
      && Number.isFinite(rawForGeometry.lat)
      && Number.isFinite(rawForGeometry.lng)
      && isDrivingRef.current
      && !isNavigatingRef.current,
    );
    const isValidRoadGeometry = (pts: { latitude: number; longitude: number }[]) => (
      !canValidateRoadGeometry
      || validateGeometryAgainstRaw(pts, rawForGeometry!.lat, rawForGeometry!.lng, 45)
    );
    let liveGeom = drivingSnapGeometryRef.current;
    if (canValidateRoadGeometry && liveGeom.length >= 2 && !isValidRoadGeometry(liveGeom)) {
      drivingSnapGeometryRef.current = [];
      liveGeom = [];
    }
    if (
      canValidateRoadGeometry
      && lastGoodDrivingSnapGeometryRef.current.length >= 2
      && !isValidRoadGeometry(lastGoodDrivingSnapGeometryRef.current)
    ) {
      lastGoodDrivingSnapGeometryRef.current = [];
    }
    const matchedGeometry = liveGeom.length >= 2 && isValidRoadGeometry(liveGeom)
      ? liveGeom
      : (
          lastGoodDrivingSnapGeometryRef.current.length >= 2
          && isValidRoadGeometry(lastGoodDrivingSnapGeometryRef.current)
            ? lastGoodDrivingSnapGeometryRef.current
            : []
        );
    
    const suppressSnap = isNavigatingRef.current && (
      offRouteRef.current
      || v3SnapToRouteSuppressedRef.current
      || reroutePendingRef.current
    );

    return buildV3GeometryFromRefs({
      matchedGeometry,
      routePoints: routePointsRef.current,
      isNavigating: isNavigatingRef.current,
      suppressRouteSnap: suppressSnap,
      mirrorPolylines: localRoadGeometryMirror.getPolylines().filter(isValidRoadGeometry),
    });
  }, []);

  const navV3 = useDriveNavigationV3({
    mode: navV3Mode,
    getMode: () => (
      isNavigatingRef.current
        ? 'navigation'
        : isDrivingRef.current
          ? 'freeDrive'
          : 'idle'
    ),
    getGeometry: buildV3Geometry,
    onTarget: (out) => {
      if (!out.rejected && isNavigatingRef.current && !isOffroadRef.current) {
        if (
          out.snap.pathMode === 'onRoad'
          && !offRouteRef.current
          && !reroutePendingRef.current
        ) {
          v3SnapToRouteSuppressedRef.current = false;
        }
      }

      const hudSpeedKmh = quarantineHudSpeedKmh(
        resumeRecoveryRef.current,
        out.hudSpeedKmh,
        { now: Date.now() },
      );
      speedKmhRef.current = hudSpeedKmh;
      rawGpsKmhRef.current = hudSpeedKmh;
      if (hudSpeedKmh >= 1) {
        emitSpeedometerKmh(hudSpeedKmh);
      } else {
        emitSpeedometerKmh(0);
      }
      let markerTarget = out.target;
      // V3 SSOT — nie nadpisuj lat/lng snapToRoute (inna geometria niż arcWindow → lateral jitter).
      driveMarker.pushTarget(markerTarget);
      if (Number.isFinite(out.snap.rawLat) && Number.isFinite(out.snap.rawLng)) {
        rawGpsCourseRef.current = { lat: out.snap.rawLat, lng: out.snap.rawLng };
      }
      if (
        !out.rejected
        && isDrivingRef.current
        && !isNavigatingRef.current
        && out.snap.pathMode === 'onRoad'
      ) {
        const localPose = localRoadGeometryMirror.snapToLocalRoadNearest(
          out.snap.rawLat,
          out.snap.rawLng,
          38,
          markerTarget.headingDeg,
          hudSpeedKmh,
        );
        const targetToLocalM = localPose
          ? haversineKm(markerTarget.lat, markerTarget.lng, localPose.lat, localPose.lng) * 1000
          : 0;
        const suspiciousRoadLock =
          out.snap.crossTrackM > 18
          || targetToLocalM > 10;
        const nowRepair = Date.now();
        if (suspiciousRoadLock && nowRepair - lastRoadLockRepairAtRef.current >= 1600) {
          lastRoadLockRepairAtRef.current = nowRepair;
          void getLocalSnapTarget(out.snap.rawLat, out.snap.rawLng).then((hit) => {
            if (!isDrivingRef.current || isNavigatingRef.current) return;
            if (!hit || hit.polylinePoints.length < 2) return;
            if (!validateGeometryAgainstRaw(hit.polylinePoints, out.snap.rawLat, out.snap.rawLng, 38)) return;
            applyRoadMatchPoints(hit.polylinePoints, { skipResync: true });
            bumpMatchedFreshness();
            resyncSnapAfterRoadGeometry(
              out.snap.rawLat,
              out.snap.rawLng,
              hudSpeedKmh,
              null,
            );
          });
        }
      }
      lastHeadingRef.current = markerTarget.headingDeg;
      lastTripMarkerPoseRef.current = { lat: markerTarget.lat, lng: markerTarget.lng };
      drLatRef.current = markerTarget.lat;
      drLngRef.current = markerTarget.lng;
      drHdgRef.current = markerTarget.headingDeg;
      drLastFrameAtRef.current = Date.now();
      lastSetLocRef.current = { lat: markerTarget.lat, lng: markerTarget.lng };
      lastAcceptedFixWallClockRef.current = Date.now();

      // V3 SSOT drives the marker, but trip distance uses raw GPS when available.
      if (!out.rejected && appStateRef.current === 'active') {
        const speedMs = hudSpeedKmh > 0 ? hudSpeedKmh / 3.6 : undefined;
        const distanceLat = Number.isFinite(out.snap.rawLat) ? out.snap.rawLat : markerTarget.lat;
        const distanceLng = Number.isFinite(out.snap.rawLng) ? out.snap.rawLng : markerTarget.lng;
        feedSpeedRef.current(speedMs ?? null);
        const segKm = feedPositionRef.current(
          distanceLat,
          distanceLng,
          speedMs,
        );
        if (segKm > 0) {
          recordDrivingTracePoint(markerTarget.lat, markerTarget.lng, {
            speedKmh: hudSpeedKmh,
          }).catch(() => {});
        }
      }

      // LIVE map: publish snapped pose from V3 engine (not raw GPS).
      if (
        !out.rejected
        && (isDrivingRef.current || isNavigatingRef.current)
        && appStateRef.current === 'active'
      ) {
        publishUserLocation({ latitude: markerTarget.lat, longitude: markerTarget.lng });
      }

      if (isDrivingRef.current && !isNavigatingRef.current && endLocationRef.current) {
        const now = Date.now();
        const prev = lastPreviewOriginCoordRef.current;
        const movedM = prev
          ? haversineKm(prev.lat, prev.lng, out.target.lat, out.target.lng) * 1000
          : 999;
        if (movedM >= 80 || now - lastPreviewOriginBumpRef.current >= 5000) {
          lastPreviewOriginBumpRef.current = now;
          lastPreviewOriginCoordRef.current = { lat: out.target.lat, lng: out.target.lng };
          setLivePreviewOriginTick((t) => t + 1);
        }
      }

      if (
        !out.rejected
        && out.snap.intersectionTurnDetected
        && isDrivingRef.current
        && !isNavigatingRef.current
      ) {
        const nowTurn = Date.now();
        if (nowTurn - lastIntersectionMatchRef.current >= 5_000) {
          lastIntersectionMatchRef.current = nowTurn;
          roadMatchSigRef.current = '';
          const turnReqId = mapMatchCoord.allocRequestId();
          void mapMatchCoord.requestRecovery({
            reason: 'INTERSECTION_TURN',
            lat: out.snap.rawLat,
            lng: out.snap.rawLng,
            speedKmh: hudSpeedKmh,
            headingDeg: out.snap.headingDeg,
            forceImmediate: true,
          }).then((pts) => {
            if (mapMatchCoord.isStaleRequest(turnReqId)) return;
            if (!isDrivingRef.current || isNavigatingRef.current) return;
            if (pts && pts.length >= 2) {
              applyRoadMatchPoints(pts, { skipResync: true });
              bumpMatchedFreshness();
              resyncSnapAfterRoadGeometry(
                out.snap.rawLat,
                out.snap.rawLng,
                hudSpeedKmh,
                null,
              );
            }
          });
        }
      }
    },
  });
  const processMotionFix = navV3.processGpsFix;

  const cameraV3 = useCameraV3({
    cameraRef,
    marker: driveMarker,
    enabled: isTripActiveMap,
    mode: navV3Mode,
    speedKmhRef,
    rawGpsRef: rawGpsCourseRef,
    isUserExploring: () => isUserExploringMapRef.current(),
    mapHeight: mapViewHeight,
  });
  const tripBootstrapPose = useCallback((
    lat: number,
    lng: number,
    heading: number,
    opts?: { animateCamera?: boolean },
  ) => {
    const liveMarkerLat = driveMarker.lat.value;
    const liveMarkerLng = driveMarker.lng.value;
    const liveToBootstrapM =
      Number.isFinite(liveMarkerLat)
      && Number.isFinite(liveMarkerLng)
      && Number.isFinite(lat)
      && Number.isFinite(lng)
        ? haversineKm(liveMarkerLat, liveMarkerLng, lat, lng) * 1000
        : Number.POSITIVE_INFINITY;
    const tripIsActive = isDrivingRef.current || isNavigatingRef.current;
    const preserveLiveMotion = tripIsActive
      && driveMarker.isBootstrapped
      && Number.isFinite(liveMarkerLat)
      && Number.isFinite(liveMarkerLng)
      && !(Math.abs(liveMarkerLat) < 1e-6 && Math.abs(liveMarkerLng) < 1e-6)
      && liveToBootstrapM <= 120;

    if (
      tripIsActive
      && driveMarker.isBootstrapped
      && Number.isFinite(liveToBootstrapM)
      && liveToBootstrapM > 120
    ) {
      vroomGpsLog('TRIP_BOOTSTRAP_STALE_MARKER_RESET', {
        distM: Math.round(liveToBootstrapM),
        targetLat: Number(lat.toFixed(6)),
        targetLng: Number(lng.toFixed(6)),
        liveLat: Number(liveMarkerLat.toFixed(6)),
        liveLng: Number(liveMarkerLng.toFixed(6)),
      }, 0);
    }

    if (preserveLiveMotion) {
      const liveHeading = Number.isFinite(driveMarker.heading.value)
        ? normalizeHeading(driveMarker.heading.value)
        : normalizeHeading(heading);
      navV3.pipeline.setMode(isNavigatingRef.current ? 'navigation' : 'freeDrive');
      drLatRef.current = liveMarkerLat;
      drLngRef.current = liveMarkerLng;
      drHdgRef.current = liveHeading;
      lastHeadingRef.current = liveHeading;
      cameraV3.armTripFollow(liveHeading);
      driveMarker.ensureFrameActive();
      return;
    }

    let hdg = resolveTripBootstrapHeadingHint(lat, lng, heading, {
      gpsDeviceHdg: lastGpsDeviceHeadingRef.current,
      lastHeading: lastHeadingRef.current,
      lastSetLoc: lastSetLocRef.current,
      lastGoodLoc: lastGoodLocRef.current,
      speedKmh: speedKmhRef.current,
    });
    const navPts = routePointsRef.current;
    const roadPts = isNavigatingRef.current && navPts.length >= 2
      ? navPts
      : drivingSnapGeometryRef.current;
    const maxSnapM = isNavigatingRef.current
      ? NAV_ROUTE_SNAP_M
      : DRIVING_ENTRY_MAX_SNAP_M;
    if (roadPts.length >= 2) {
      hdg = resolveTripRoadHeading(lat, lng, roadPts, maxSnapM, hdg);
    }

    navV3.hardReset(lat, lng, hdg);
    navV3.pipeline.setMode(
      isNavigatingRef.current
        ? 'navigation'
        : isDrivingRef.current
          ? 'freeDrive'
          : 'idle',
    );
    driveMarker.resetTo(lat, lng, hdg);
    const coldTarget = coldStartNavigationTarget(lat, lng, hdg);
    driveMarker.pushTarget(coldTarget);
    driveMarker.ensureFrameActive?.();
    lastTripMarkerPoseRef.current = { lat, lng };
    drLatRef.current = lat;
    drLngRef.current = lng;
    drHdgRef.current = hdg;
    lastHeadingRef.current = hdg;
    // Ten sam bearing co przycisk „Centruj” — marker SV po resetTo.
    const cameraHdg = Number.isFinite(driveMarker.heading.value)
      ? normalizeHeading(driveMarker.heading.value)
      : hdg;
    cameraV3.armTripFollow(cameraHdg);
    cameraV3.recenter(
      { latitude: lat, longitude: lng },
      {
        heading: cameraHdg,
        speedKmh: speedKmhRef.current,
        animate: false,
        coldStart: true,
      },
    );
  }, [navV3, driveMarker, cameraV3]);

  useEffect(() => {
    tripBootstrapPoseRef.current = tripBootstrapPose;
  }, [tripBootstrapPose]);

  useEffect(() => () => {
    subAnchorTimersRef.current.forEach((t) => clearTimeout(t));
    subAnchorTimersRef.current = [];
  }, []);

  /**
   * Foreground: marker z workletu (subscribeSmoothPositionDisplay, ~20 Hz).
   * Tło + aktywny trip: useFrameCallback staje — projekcja markera z JS co 100 ms.
   */
  useEffect(() => {
    const stopBgMarkerTick = () => {
      if (bgMarkerTickRef.current) {
        clearInterval(bgMarkerTickRef.current);
        bgMarkerTickRef.current = null;
      }
    };

    const syncBgMarkerTick = () => {
      stopBgMarkerTick();
      const tripActive = isNavigatingRef.current || isDrivingRef.current;
      const inBackground = appStateRef.current !== 'active';
      if (!true || !tripActive || !inBackground) return;

      bgMarkerTickRef.current = setInterval(() => {
        if (appStateRef.current === 'active') {
          stopBgMarkerTick();
          return;
        }
        if (Date.now() < bgProjectionCooldownUntilRef.current) {
          return;
        }
        if (!isNavigatingRef.current && !isDrivingRef.current) {
          stopBgMarkerTick();
          return;
        }
        const p = markerProjRef.current;
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || p.at <= 0) return;
        const ageSec = Math.min(2.4, Math.max(0, (Date.now() - p.at) / 1000));
        if (ageSec > 2.2) return;
        const spd = p.speedMs > 0.08 ? p.speedMs : (speedKmhRef.current > 0.5 ? speedKmhRef.current / 3.6 : 0);
        if (spd < 0.08) return;
        const roadPts = drivingSnapGeometryRef.current;
        const stepM = Math.min(3.5, Math.max(1.2, spd * 0.12));
        const projected = roadPts.length >= 2
          ? snapStepTowardRoad(p.lat, p.lng, roadPts, 80, stepM)
          : null;
        const next = projected ?? projectCoord(
          { latitude: p.lat, longitude: p.lng },
          p.hdg,
          stepM,
        );
        markerProjRef.current = {
          lat: next.latitude,
          lng: next.longitude,
          hdg: p.hdg,
          speedMs: spd,
          at: Date.now(),
        };
        markerLogTick('BG_PROJECTION_FEED', {
          stepM: Number(stepM.toFixed(2)),
          speedMs: Number(spd.toFixed(2)),
          ageSec: Number(ageSec.toFixed(2)),
          lat: Number(next.latitude.toFixed(6)),
          lng: Number(next.longitude.toFixed(6)),
        }, 2000);
}, 500);
    };

    syncBgMarkerTick();
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
      if (next === 'active') {
        bgProjectionCooldownUntilRef.current = Date.now() + BG_PROJECTION_COOLDOWN_MS;
        stopBgMarkerTick();
        if (isNavigatingRef.current || isDrivingRef.current) {
          driveMarker.ensureFrameActive?.();
        }
      }
      syncBgMarkerTick();
    });
    return () => {
      sub.remove();
      stopBgMarkerTick();
    };
  }, [isTripActiveMap, driveMarker, cameraV3]);

  const showThreeDBuildings = enableThreeDScene && currentZoom >= BUILDINGS_3D_MIN_ZOOM && !isTripActiveMap;
  const showTerrainLayers = enableThreeDScene && !isTripActiveMap;
  const showVividMapLayers = shouldApplyVividMapLayers(mapType) && !isTripActiveMap;

  const routePrefetchKey = useMemo(() => {
    if (!isNavigating || remainingRoutePoints.length < 2) return null;
    const a = remainingRoutePoints[0];
    const b = remainingRoutePoints[remainingRoutePoints.length - 1];
    return `${a.latitude.toFixed(3)}_${a.longitude.toFixed(3)}_${b.latitude.toFixed(3)}_${b.longitude.toFixed(3)}`;
  }, [isNavigating, remainingRoutePoints]);

  useMapTilePrefetch({
    isNavigating,
    navigationReady: navigationUiReady,
    isDriving,
    mapStyleURL: mapStyle,
    routePoints: remainingRoutePoints,
    routeKey: routePrefetchKey,
    userLocation,
  });
  const renderCountRef = useRef(0);
  const renderWindowStartRef = useRef(Date.now());
  const lastRenderLogAtRef = useRef(0);
  const prevRenderSigRef = useRef('');
  const lastLocLogAtRef = useRef(0);
  const lastCameraChangeLogAtRef = useRef(0);

  const mapDbg = useCallback((kind: string, payload?: Record<string, unknown>, throttleMs = 0) => {
    if (!MAP_RENDER_DEBUG) return;
    const now = Date.now();
    if (throttleMs > 0 && now - lastRenderLogAtRef.current < throttleMs) return;
    if (throttleMs > 0) lastRenderLogAtRef.current = now;
    console.log(`[MAPDBG] ${kind}`, JSON.stringify({ at: now, ...(payload ?? {}) }));
  }, []);

  const {
    addPosition: addMatchPosition,
    getMatchedPoints,
    reset: resetMapMatch,
    forceMatch: forceMapMatch,
    bumpMatchedFreshness,
  } = useDrivingMapMatch();
  const mapMatchCoord = useMapMatchCoordinator({
    forceMapMatch,
    getMatchedPoints,
    applySeqRef: mapMatchApplySeqRef,
    speedKmhRef,
    lastHeadingRef,
    isDrivingRef,
    minStationarySpeedKmh: DRIVING_ENTRY_STATIONARY_KMH,
    onLog: (event, payload) => {
      vroomGpsLog(`MAP_MATCH_COORD_${event}`, payload, 800);
      visionEvent('MAP_MATCH_RECOVERY', { coordEvent: event, ...(payload ?? {}) });
    },
  });

  const runMapMatchRecovery = useCallback((
    req: Parameters<typeof mapMatchCoord.requestRecovery>[0],
    onApplied?: (pts: { latitude: number; longitude: number }[] | null) => void,
  ) => {
    if (true && req.reason !== 'MANUAL') {
      onApplied?.(null);
      return 0;
    }
    const reqId = mapMatchCoord.allocRequestId();
    void mapMatchCoord.requestRecovery(req).then((pts) => {
      if (mapMatchCoord.isStaleRequest(reqId)) return;
      onApplied?.(pts);
    });
    return reqId;
  }, [mapMatchCoord]);

  const runMapMatchRecoveryRef = useRef(runMapMatchRecovery);
  const mapMatchCoordApiRef = useRef(mapMatchCoord);
  useEffect(() => {
    runMapMatchRecoveryRef.current = runMapMatchRecovery;
    mapMatchCoordApiRef.current = mapMatchCoord;
  }, [runMapMatchRecovery, mapMatchCoord]);

  const resolveDrivingAnchor = useCallback((): { latitude: number; longitude: number } | null => {
    const tripActive = isDrivingRef.current || isNavigatingRef.current;
    const live = getLiveTripPose({
      drLat: drLatRef.current,
      drLng: drLngRef.current,
      drHdg: drHdgRef.current,
      tripActive,
      lastSetLoc: lastSetLocRef.current,
      lastGoodLoc: lastGoodLocRef.current,
    });
    if (live) {
      return { latitude: live.latitude, longitude: live.longitude };
    }
    const u = currentLocRef.current;
    if (u && Number.isFinite(u.latitude) && Number.isFinite(u.longitude)) {
      return { latitude: u.latitude, longitude: u.longitude };
    }
    return null;
  }, []);

  /** SSOT live pose for routing preview + nav bootstrap (drLatRef during trip). */
  const readLiveTripPose = useCallback((): ReturnType<typeof getLiveTripPose> => {
    return getLiveTripPose({
      drLat: drLatRef.current,
      drLng: drLngRef.current,
      drHdg: drHdgRef.current,
      tripActive: isDrivingRef.current || isNavigatingRef.current,
      lastSetLoc: lastSetLocRef.current,
      lastGoodLoc: lastGoodLocRef.current,
    });
  }, []);

  /** Wywoływane gdy nowy odcinek drogi (matched geometry) pojawia się w trakcie
   * jazdy lub nawigacji. KIEDYŚ ten helper TELEPORTOWAŁ drLatRef i bumpActiveMarker
   * do każdego nowego snap-pos, co kasowało projekcję bridge'a (forward DR podczas
   * iOS lat/lng-freeze) — marker wracał do raw_snap co kilka sekund.
   *
   * Teraz: w trybie aktywnej jazdy/nawigacji tylko karmimy DR nowym targetem
   * (płynny lerp); BEZ bumpActiveMarker i bez instant. To wystarczy żeby
   * geometria nowej drogi była używana przez następne ticki — bez wizualnych skoków.
   * Instant flow zostawiamy tylko dla wejścia w driving (driving entry path).
   */
  const resyncSnapAfterRoadGeometry = useCallback((
    rawLat: number,
    rawLng: number,
    speedKmh: number,
    acc: number | null | undefined,
  ) => {
    if (!isDrivingRef.current && !isNavigatingRef.current) return;
    navV3.processGpsFix({
      latitude: rawLat,
      longitude: rawLng,
      accuracy: acc ?? 12,
      timestamp: Date.now(),
      speed: speedKmh > 0 ? speedKmh / 3.6 : null,
      heading: lastHeadingRef.current,
    });
  }, [navV3]);

  const applyRoadMatchPoints = useCallback((
    pts: { latitude: number; longitude: number }[] | null | undefined,
    opts?: { skipResync?: boolean },
  ) => {
    const list = pts && pts.length >= 2 ? pts : [];
    if (list.length < 2) {
      if (pts && pts.length === 0) {
        drivingSnapUsesMatchedRef.current = false;
        if (isNavigatingRef.current && routePointsRef.current.length >= 2) {
          drivingSnapGeometryRef.current = routePointsRef.current;
        } else if (lastGoodDrivingSnapGeometryRef.current.length >= 2) {
          drivingSnapGeometryRef.current = lastGoodDrivingSnapGeometryRef.current;
        } else {
          drivingSnapGeometryRef.current = [];
          localRoadGeometryMirror.clear();
        }
        roadMatchSigRef.current = '';
      }
      return;
    }
    const densified = densifyPolyline(list, list.length <= 4 ? 6 : 8);
    const sig = `${densified.length}:${densified[0].latitude.toFixed(5)},${densified[0].longitude.toFixed(5)},${densified[densified.length - 1].latitude.toFixed(5)},${densified[densified.length - 1].longitude.toFixed(5)}`;
    if (sig === roadMatchSigRef.current) return;

    const prevGeom = drivingSnapGeometryRef.current;
    const shiftM = prevGeom.length >= 2 ? roadPolylineShiftM(prevGeom, densified) : 0;
    const rawForGeom = lastRawForHeadingRef.current ?? lastGoodLocRef.current;
    const preferNewGeom = rawForGeom != null
      && shouldPreferNewRoadGeometry(
        prevGeom,
        densified,
        rawForGeom.lat,
        rawForGeom.lng,
      );

    // Nie stosuj krótkiego cache — psuje snap (marker stoi / obrót w bok).
    if (
      densified.length <= 8
      && prevGeom.length >= 4
      && shiftM > 35
      && !preferNewGeom
    ) {
      vroomGpsLog('ROAD_MATCH_SKIP_TRUNCATED', {
        pts: densified.length,
        prevPts: prevGeom.length,
        shiftM: Math.round(shiftM),
      }, 3000);
      return;
    }
    if (densified.length <= 4 && prevGeom.length >= 2 && !preferNewGeom) {
      vroomGpsLog('ROAD_MATCH_SKIP_TRUNCATED', {
        pts: densified.length,
        prevPts: prevGeom.length,
        shiftM: Math.round(shiftM),
      }, 3000);
      return;
    }
    // Geometria przesunięta w bok (równoległa ulica) — nie psuj snapu.
    if (prevGeom.length >= 2 && shiftM > 55 && !preferNewGeom) {
      vroomGpsLog('ROAD_MATCH_SKIP_SHIFT', {
        pts: densified.length,
        prevPts: prevGeom.length,
        shiftM: Math.round(shiftM),
      }, 3000);
      return;
    }

    roadMatchSigRef.current = sig;
    roadGeometryStore.insert(list).catch(() => {});

    // Nawigacja: routePtsRef jest jedynym SSOT — map-match nie może nadpisać niebieskiej linii.
    if (isNavigatingRef.current) {
      if (routePointsRef.current.length >= 2) {
        drivingSnapGeometryRef.current = routePointsRef.current;
        lastGoodDrivingSnapGeometryRef.current = routePointsRef.current;
        drivingSnapUsesMatchedRef.current = false;
      }
      return;
    }

    drivingSnapGeometryRef.current = densified;
    lastGoodDrivingSnapGeometryRef.current = densified;
    drivingSnapUsesMatchedRef.current = true;
    localRoadGeometryMirror.setPolylines([densified]);

    vroomGpsLog('ROAD_MATCH_SOFT_APPLY', {
      pts: densified.length,
      shiftM: Math.round(shiftM),
    }, 1200);
    void logTelemetry('ROAD_MATCH_SOFT_APPLY', {
      pts: densified.length,
      shiftM: Math.round(shiftM),
    });

    if (opts?.skipResync) return;

    const raw = lastRawForHeadingRef.current ?? lastGoodLocRef.current;
    const resyncSpeedKmh = Math.max(speedKmhRef.current, rawGpsKmhRef.current);
    if (raw && (isDrivingRef.current || isNavigatingRef.current)) {
      resyncSnapAfterRoadGeometry(raw.lat, raw.lng, resyncSpeedKmh, null);
    }
  }, [resyncSnapAfterRoadGeometry]);


  /** V3 path: refresh road geometry before navV3.processGpsFix (syncDrivingRoadGeometry). */
  const syncDrivingRoadGeometry = useCallback((
    lat: number,
    lng: number,
    speedKmh: number,
    accuracyM: number | null | undefined,
  ) => {
    if (!isDrivingRef.current || isNavigatingRef.current) return;

    const matchedPts = getMatchedPoints();
    const noRoad = !matchedPts || matchedPts.length < 2;

    if (matchedPts && matchedPts.length > 1) {
      applyRoadMatchPoints(matchedPts, { skipResync: true });
      bumpMatchedFreshness();
      markClientFirstGeometryHealthy('memory');
      clearClientFirstNoRoad();
      return;
    }

    markClientFirstNoRoad();
    const nowCf = Date.now();
    const rawForValidate = lastRawForHeadingRef.current ?? lastGoodLocRef.current;
    const geomInvalidForRaw = drivingSnapGeometryRef.current.length >= 2
      && rawForValidate != null
      && !validateGeometryAgainstRaw(
        drivingSnapGeometryRef.current,
        rawForValidate.lat,
        rawForValidate.lng,
        45,
      );
    const needsLocalResolve =
      drivingSnapGeometryRef.current.length < 2
      || geomInvalidForRaw;
    if (geomInvalidForRaw) {
      drivingSnapGeometryRef.current = [];
      lastGoodDrivingSnapGeometryRef.current = [];
      localRoadGeometryMirror.clear();
      roadMatchSigRef.current = '';
    }
    const resolveGapMs = geomInvalidForRaw ? 1200 : CLIENT_FIRST_RESOLVE_MIN_MS;
    if (needsLocalResolve && nowCf - lastClientFirstResolveRef.current >= resolveGapMs) {
      lastClientFirstResolveRef.current = nowCf;
      void resolveLocalRoadPolylineForMatch(lat, lng).then((local) => {
        if (!isDrivingRef.current || isNavigatingRef.current || !local || local.points.length < 2) return;
        applyRoadMatchPoints(local.points, { skipResync: true });
        bumpMatchedFreshness();
        markClientFirstGeometryHealthy(local.source);
        clearClientFirstNoRoad();
      });
    }

    const gateOk = canRequestMapMatch({
      lat,
      lng,
      speedKmh,
      accuracyM: accuracyM ?? null,
    }).ok;
    if (!gateOk || !noRoad) return;

    const nowMatch = Date.now();
    if (nowMatch - lastAddMatchFeedRef.current < ADD_MATCH_FEED_NO_ROAD_MIN_MS) return;
    if (!shouldAllowNetworkMapMatch({ noRoad: true })) return;
    if (speedKmh < DRIVING_ENTRY_STATIONARY_KMH) return;

    lastAddMatchFeedRef.current = nowMatch;
    void addMatchPosition(lat, lng, {
      speedKmh,
      accuracyM: accuracyM ?? null,
      noRoad: true,
      staleSnap: false,
    });
  }, [
    getMatchedPoints,
    applyRoadMatchPoints,
    addMatchPosition,
    resolveLocalRoadPolylineForMatch,
    bumpMatchedFreshness,
  ]);

  const {
    cameras, nearestCamera,
    updateCameras, addCamera, confirmCamera,
    checkAlert, markAlerted, invalidate, deleteCamera,
  } = useSpeedCameras();

  const {
    speedLimit,
    resolution: speedLimitResolution,
    updateSpeedLimit,
    submitSpeedLimit,
    flushQueuedSpeedLimits,
  } = useSpeedLimit(true);
  const updateSpeedLimitRef = useRef(updateSpeedLimit);
  useEffect(() => {
    updateSpeedLimitRef.current = updateSpeedLimit;
  }, [updateSpeedLimit]);
  const speedKmh = (speed ?? 0) * 3.6;
  /** OSM + sticky — bez mieszania z limitem fotoradaru (eliminuje mruganie znaku). */
  const effectiveSpeedLimit = useMemo(() => speedLimit, [speedLimit]);
  const ALERT_DIST = 400;
  const cameraAlertVisible = nearestCamera !== null && nearestCamera.distanceM <= ALERT_DIST;

  useEffect(() => {
    if (!nearestCamera) return;
    const voiceLeadM = Math.max(300, Math.min(800, (speedKmh / 3.6) * 20));
    if (!checkAlert(nearestCamera, voiceLeadM)) return;
    const dist   = Math.max(50, Math.round(nearestCamera.distanceM / 50) * 50);
    const isBump = nearestCamera.type === 'bump';
    const msg    = isBump
      ? `Uwaga, próg zwalniający za ${dist} metrów`
      : nearestCamera.maxspeed
        ? `Uwaga, fotoradar za ${dist} metrów, limit ${nearestCamera.maxspeed} kilometrów na godzinę`
        : `Uwaga, fotoradar za ${dist} metrów`;
    navigationVoice.enqueue({
      id: `road-object:${nearestCamera.id}`,
      text: msg,
      category: 'warning',
      onStart: () => markAlerted(nearestCamera.id),
    });
  }, [
    nearestCamera?.id,
    nearestCamera?.distanceM,
    nearestCamera?.maxspeed,
    nearestCamera?.type,
    speedKmh,
    checkAlert,
    markAlerted,
    navigationVoice.enqueue,
  ]);

  // ── mapType persistence ────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('map_type').then(val => {
      if (val) setMapType(val);
    }).catch(() => {});
  }, []);

  // ── Fuel stations — trigger fetch on location change ──────
  // Hook throttles (5 min / 2.5 km). Zaokrąglamy GPS żeby micro-jitter nie odpalał Search Box category.
  const fuelLocationKey = userLocation
    ? `${userLocation.latitude.toFixed(3)}_${userLocation.longitude.toFixed(3)}`
    : null;
  useEffect(() => {
    if (!userLocation || !fuelLocationKey) return;
    onFuelLocationChange(userLocation);
  }, [fuelLocationKey, onFuelLocationChange, userLocation]);

  const handleChangeMapType = useCallback((type: string) => {
    setMapType(type);
    AsyncStorage.setItem('map_type', type).catch(() => {});
  }, []);

  const {
    startTrip, updateTripEstimate, feedSpeed, feedPosition,
    finishTrip, clearStats, restoreTripSnapshot, stats: tripStats, liveDistanceKm,
  } = useTripStats();
  feedPositionRef.current = feedPosition;
  feedSpeedRef.current = feedSpeed;

  useEffect(() => {
    liveDistanceKmRef.current = Number(liveDistanceKm || 0);
  }, [liveDistanceKm]);

  const flushTripDistanceCheckpointRef = useRef<
    (opts?: { minKm?: number; forceAll?: boolean; reason?: string }) => Promise<boolean>
  >(async () => false);

  const flushTripDistanceCheckpoint = useCallback(async (opts?: {
    minKm?: number;
    forceAll?: boolean;
    reason?: string;
  }) => {
    if (!ENABLE_TRIP_DISTANCE_CHECKPOINT) return false;
    if (tripCheckpointInFlightRef.current) return tripCheckpointInFlightRef.current;
    const operation = (async () => {
      const activeSessionId = await ensureTripSessionId();
      const minKm = opts?.minKm ?? TRIP_CHECKPOINT_KM;
      const foregroundKm = parseFloat(
        (liveDistanceKmRef.current > 0
          ? liveDistanceKmRef.current
          : finishTrip().distanceKm
        ).toFixed(3),
      );
      // Prefer the native session total when it is running. The foreground HUD
      // resets on a screen restart, while the native ledger correctly continues
      // the same trip across that restart.
      const [nativeState, nativeStats, persistedCheckpointKm] = await Promise.all([
        BackgroundDriveController.getState(),
        BackgroundDriveController.getNativeStats(),
        loadTripCheckpointSavedKm(),
      ]);
      const nativeKm = Number(nativeStats?.distanceKm);
      const nativeOwnsCurrentSession = nativeState.active
        && nativeState.tripSessionId
        && nativeState.tripSessionId === activeSessionId
        && nativeStats?.tripSessionId === nativeState.tripSessionId
        && Number.isFinite(nativeKm)
        && nativeKm > 0;
      // Prefer the larger of native/JS — lagging native must not stall checkpoints.
      const currentKm = nativeOwnsCurrentSession
        ? Math.max(nativeKm, foregroundKm)
        : foregroundKm;
      let savedKm = Math.max(
        tripCheckpointSavedKmRef.current,
        persistedCheckpointKm,
        0,
      );
      if (savedKm > currentKm + 0.001) {
        savedKm = 0;
        tripCheckpointSavedKmRef.current = 0;
        await clearTripCheckpointSavedKm();
      }
      tripCheckpointSavedKmRef.current = Math.max(tripCheckpointSavedKmRef.current, savedKm);
      const unsavedKm = currentKm - savedKm;
      if (unsavedKm < minKm) return false;

      const checkpointTotalKm = opts?.forceAll
        ? currentKm
        : savedKm + Math.floor(unsavedKm / TRIP_CHECKPOINT_KM) * TRIP_CHECKPOINT_KM;
      if (checkpointTotalKm - savedKm < minKm) return false;

      const ok = await saveIncrementalTripKm({
        distanceKm: checkpointTotalKm,
        maxSpeedKmh: tripPeakSpeedRef.current,
        source: isNavigatingRef.current ? 'navigation' : 'driving',
      });
      if (ok) {
        const previousSavedKm = savedKm;
        tripCheckpointSavedKmRef.current = Math.max(previousSavedKm, ok.checkpointDistanceKm);
        if (Number.isFinite(ok.userTotalDistance)) {
          profileTotalDistanceKmRef.current = Math.max(0, Number(ok.userTotalDistance));
        } else {
          profileTotalDistanceKmRef.current += Math.max(0, ok.creditedDeltaKm);
        }
        await persistTripCheckpointSavedKm(tripCheckpointSavedKmRef.current);
        for (const achievement of ok.newAchievements ?? []) {
          const key = String(
            achievement?.definition?.key ?? achievement?.key ?? achievement?.id ?? '',
          );
          if (!key || liveAchUnlockedKeysRef.current.has(key)) continue;
          liveAchUnlockedKeysRef.current.add(key);
          Toast.show({
            type: 'success',
            text1: 'Nowe osiągnięcie',
            text2: String(
              achievement?.definition?.label
                ?? achievement?.label
                ?? 'Nowe osiągnięcie',
            ),
          });
        }
        if (__DEV__) {
          console.log('[TripCheckpoint] saved', {
            reason: opts?.reason ?? 'periodic',
            creditedDeltaKm: Number(ok.creditedDeltaKm.toFixed(3)),
            checkpointTotalKm: Number(tripCheckpointSavedKmRef.current.toFixed(3)),
            totalSavedKm: Number(tripCheckpointSavedKmRef.current.toFixed(3)),
          });
        }
      } else if (__DEV__) {
        console.warn('[TripCheckpoint] flush failed', {
          reason: opts?.reason ?? 'periodic',
          currentKm: Number(currentKm.toFixed(3)),
          savedKm: Number(savedKm.toFixed(3)),
        });
      }
      return !!ok;
    })();
    tripCheckpointInFlightRef.current = operation;
    try {
      return await operation;
    } finally {
      if (tripCheckpointInFlightRef.current === operation) {
        tripCheckpointInFlightRef.current = null;
      }
    }
  }, [finishTrip]);

  useEffect(() => {
    flushTripDistanceCheckpointRef.current = flushTripDistanceCheckpoint;
  }, [flushTripDistanceCheckpoint]);

  useEffect(() => registerActiveTripCheckpointFlusher(flushTripDistanceCheckpoint), [flushTripDistanceCheckpoint]);

  const publishSpeed = useCallback((
    gpsSpeedMs: number | null,
    opts?: {
      sanitizedMs?: number | null;
      lat?: number;
      lng?: number;
      now?: number;
      dtMs?: number;
      netMoveM?: number;
      pathMoveM?: number;
      sustainedKmh?: number;
      motionKmh?: number;
      rawGpsKmh?: number;
    },
  ) => {
    let sanitizedMs = opts?.sanitizedMs;
    if (sanitizedMs === undefined) {
      const prev = lastGoodLocRef.current ?? lastSetLocRef.current;
      const now = opts?.now ?? Date.now();
      const dtMs = opts?.dtMs ?? Math.max(100, now - lastGoodTimeRef.current);
      sanitizedMs = sanitizeSpeedMs({
        gpsSpeedMs,
        prevLat: prev?.lat,
        prevLng: prev?.lng,
        newLat: opts?.lat,
        newLng: opts?.lng,
        dtMs: opts?.lat != null ? dtMs : 0,
        isTripActive: isNavigatingRef.current || isDrivingRef.current,
        netMoveM: opts?.netMoveM,
        sustainedKmh: opts?.sustainedKmh,
      });
    }
    const tripActive = isNavigatingRef.current || isDrivingRef.current;
    let display = sanitizedMs;
    // Never fallback to raw GPS speed in active trip mode: Doppler spikes while
    // standing can report absurd values and poison top-speed/achievements.
    if (sanitizedMs != null && sanitizedMs > 0.4) {
      const capMs = (isNavigatingRef.current || isDrivingRef.current)
        ? MAX_REALISTIC_DRIVING_KMH / 3.6
        : sanitizedMs;
      lastReliableSpeedMsRef.current = Math.min(sanitizedMs, capMs);
      speedSignalHoldUntilRef.current = Date.now() + 1800;
    } else if (
      tripActive
      && lastReliableSpeedMsRef.current != null
      && Date.now() < speedSignalHoldUntilRef.current
      && (opts?.netMoveM == null || opts.netMoveM >= 14)
      && (opts?.sustainedKmh == null || opts.sustainedKmh >= 4)
    ) {
      // Krótki hold tylko przy potwierdzonym ruchu — nie przy postoju z ghost Doppler.
      display = lastReliableSpeedMsRef.current;
    }
    if (display != null && (!Number.isFinite(display) || display < 0 || display * 3.6 > MAX_SPEED_HUD_KMH)) {
      display = null;
    }
    let peakTrusted = false;
    let peakKmh = 0;
    if (tripActive) {
      const nowTs = opts?.now ?? Date.now();
      const netMoveM = opts?.netMoveM ?? 0;
      const motionKmh = opts?.motionKmh ?? 0;
      const sustainedKmh = opts?.sustainedKmh ?? 0;
      const rawGpsKmh = opts?.rawGpsKmh ?? (gpsSpeedMs != null ? gpsSpeedMs * 3.6 : 0);
      const stationaryGpsSpike = isStationaryGpsSpike({
        rawGpsKmh,
        derivedKmh: display != null && display > 0 ? display * 3.6 : 0,
        netMoveM,
        pathMoveM: opts?.pathMoveM,
        sustainedKmh,
        motionKmh,
      });
      const fgRefreshPublish =
        tripForegroundRefreshUntilRef.current > nowTs
        && (isDrivingRef.current || isNavigatingRef.current);
      const standstillNetM = tripStandstillNetM(speedKmhRef.current, motionKmh);
      const drivingMotionEvidence = isDrivingRef.current && hasDrivingMotionEvidence({
        rawGpsKmh,
        motionKmh,
        netMoveM,
        sustainedKmh,
        pathMoveM: opts?.pathMoveM,
      });
      let stationaryEvidence =
        stationaryGpsSpike
        || (
          rawGpsKmh < 15
          && netMoveM < standstillNetM
          && sustainedKmh < 3.5
          && motionKmh < 2.5
        );
      if (fgRefreshPublish && rawGpsKmh >= 6) {
        stationaryEvidence = false;
      }
      if (drivingMotionEvidence && !stationaryGpsSpike) {
        stationaryEvidence = false;
      }
      let dopplerGhostWhileStill =
        stationaryEvidence
        && rawGpsKmh >= 6
        && rawGpsKmh <= 45;

      let reliableSpeedKmh = display != null && display > 0 ? display * 3.6 : 0;
      if (
        rawGpsKmh >= 8
        && netMoveM >= 12
        && sustainedKmh >= 6
      ) {
        stationaryEvidence = false;
        dopplerGhostWhileStill = false;
        reliableSpeedKmh = Math.max(reliableSpeedKmh, rawGpsKmh);
      } else if (rawGpsKmh >= 55 && netMoveM < 15) {
        stationaryEvidence = true;
        dopplerGhostWhileStill = true;
        reliableSpeedKmh = 0;
      } else if (stationaryEvidence || dopplerGhostWhileStill) {
        reliableSpeedKmh = 0;
      } else if (reliableSpeedKmh < 1) {
        const derivedKmhEarly = opts?.lat != null && opts?.dtMs
          ? (() => {
            const prev = lastGoodLocRef.current ?? lastSetLocRef.current;
            if (!prev || opts.lat == null || opts.lng == null) return 0;
            const dt = Math.max(400, opts.dtMs ?? 0);
            return (haversineKm(prev.lat, prev.lng, opts.lat, opts.lng) / (dt / 1000)) * 3600;
          })()
          : 0;
        if (motionKmh >= 3 && netMoveM >= 10) {
          reliableSpeedKmh = Math.max(
            motionKmh,
            Number.isFinite(derivedKmhEarly) ? derivedKmhEarly : 0,
            reliableSpeedKmh,
          );
        } else if (motionKmh >= 6 && netMoveM >= 14) {
          reliableSpeedKmh = Math.max(reliableSpeedKmh, motionKmh);
        } else if (sustainedKmh >= 6 && netMoveM >= 14) {
          reliableSpeedKmh = Math.max(reliableSpeedKmh, sustainedKmh);
        } else if (
          lastReliableSpeedMsRef.current != null
          && nowTs < speedSignalHoldUntilRef.current
          && netMoveM >= 14
          && sustainedKmh >= 4
        ) {
          reliableSpeedKmh = lastReliableSpeedMsRef.current * 3.6;
        }
      }
      const prevEmit = lastSpeedEmitRef.current;
      const parkedLikeEmit = isParkedLikeTripEvidence({
        netMoveM: opts?.netMoveM ?? 0,
        sustainedKmh: opts?.sustainedKmh ?? 0,
        motionKmh: opts?.motionKmh ?? 0,
        pathMoveM: opts?.pathMoveM,
        rawGpsKmh,
        foregroundRefreshGrace: fgRefreshPublish,
      });
      const dopplerTrustedEmit = trustDopplerInTripEvidence({
        netMoveM: opts?.netMoveM ?? 0,
        sustainedKmh: opts?.sustainedKmh ?? 0,
        motionKmh: opts?.motionKmh ?? 0,
        pathMoveM: opts?.pathMoveM,
        rawGpsKmh,
      });
      const motionConfirmed =
        dopplerTrustedEmit
        || (
          motionKmh >= 14
          && netMoveM >= 18
          && sustainedKmh >= 6
        );
      if (prevEmit && !stationaryEvidence) {
        const dtSec = Math.max(0.08, (nowTs - prevEmit.at) / 1000);
        const accelKmhPerSec = (reliableSpeedKmh - prevEmit.kmh) / dtSec;
        const deltaKmh = reliableSpeedKmh - prevEmit.kmh;
        const hugeJumpFromNearZero =
          !motionConfirmed
          && prevEmit.kmh <= 15
          && reliableSpeedKmh >= 28
          && dtSec <= 8;
        const massiveAbsoluteJump =
          !dopplerTrustedEmit
          && !motionConfirmed
          && deltaKmh >= 35
          && dtSec <= 6;
        const standstillHallucination =
          !dopplerTrustedEmit
          && !motionConfirmed
          && netMoveM < standstillNetM
          && sustainedKmh < 5
          && motionKmh < 6
          && reliableSpeedKmh > 6;
        const impossibleHud =
          (
            !motionConfirmed
            && reliableSpeedKmh >= 95
            && netMoveM < 22
          );
        if (
          (!motionConfirmed && accelKmhPerSec > 35)
          || hugeJumpFromNearZero
          || massiveAbsoluteJump
          || standstillHallucination
          || impossibleHud
        ) {
          vroomGpsLog('SPEED_EMIT_SPIKE_BLOCK', {
            prevKmh: Number(prevEmit.kmh.toFixed(1)),
            nextKmh: Number(reliableSpeedKmh.toFixed(1)),
            dtSec: Number(dtSec.toFixed(2)),
            accelKmhPerSec: Number(accelKmhPerSec.toFixed(1)),
            reason: standstillHallucination ? 'standstill_hallucination'
              : massiveAbsoluteJump ? 'absolute_jump'
                : hugeJumpFromNearZero ? 'near_zero_jump'
                  : 'high_accel',
          }, 1200);
          if (
            massiveAbsoluteJump
            || standstillHallucination
            || impossibleHud
          ) {
            reliableSpeedKmh = standstillHallucination
              || massiveAbsoluteJump
              || impossibleHud
              ? 0
              : Math.max(0, prevEmit.kmh);
          }
        }
      }
      if (opts?.netMoveM != null && opts?.sustainedKmh != null && !stationaryEvidence) {
        reliableSpeedKmh = clampSpeedKmhToGeometry(reliableSpeedKmh, {
          netMoveM: opts.netMoveM,
          sustainedKmh: opts.sustainedKmh,
          motionKmh: opts.motionKmh ?? 0,
          rawGpsKmh,
          isTripActive: true,
        });
      }
      if (
        dopplerTrustedEmit
        && rawGpsKmh >= 8
        && rawGpsKmh < 70
        && reliableSpeedKmh < 8
        && netMoveM >= 12
        && sustainedKmh >= 4
      ) {
        reliableSpeedKmh = Math.min(90, rawGpsKmh);
      }
      if (
        !parkedLikeEmit
        && rawGpsKmh >= 70
        && netMoveM < 22
        && motionKmh < 14
        && !drivingMotionEvidence
      ) {
        reliableSpeedKmh = 0;
      }
      if (parkedLikeEmit && reliableSpeedKmh > 1 && !fgRefreshPublish && !drivingMotionEvidence) {
        reliableSpeedKmh = 0;
      }
      if (drivingMotionEvidence && reliableSpeedKmh < 4) {
        reliableSpeedKmh = Math.max(rawGpsKmh, motionKmh, sustainedKmh, 6, reliableSpeedKmh);
      }
      if (
        rawGpsKmh >= 15
        && netMoveM < 18
        && reliableSpeedKmh > 0
      ) {
        const geoHud = Math.max(motionKmh, sustainedKmh);
        if (Math.abs(rawGpsKmh - reliableSpeedKmh) > 25 && Math.abs(rawGpsKmh - geoHud) > 25) {
          reliableSpeedKmh = geoHud > 2
            ? Math.min(reliableSpeedKmh, geoHud * 1.12 + 4)
            : Math.min(reliableSpeedKmh, motionKmh);
        }
      }
      const recordSpeedKmh = Math.max(0, reliableSpeedKmh);
      reliableSpeedKmh = Math.max(0, Math.min(MAX_SPEED_HUD_KMH, reliableSpeedKmh));
      if (reliableSpeedKmh > 0.5 && !stationaryEvidence) {
        lastReliableSpeedMsRef.current = Math.min(
          reliableSpeedKmh / 3.6,
          MAX_SPEED_HUD_KMH / 3.6,
        );
        speedSignalHoldUntilRef.current = nowTs + 1800;
      } else if (reliableSpeedKmh <= 0.5) {
        lastReliableSpeedMsRef.current = null;
        speedSignalHoldUntilRef.current = 0;
      }
      lastSpeedEmitRef.current = { kmh: reliableSpeedKmh, at: nowTs };
      display = reliableSpeedKmh > 0 ? reliableSpeedKmh / 3.6 : null;
      speedKmhRef.current = reliableSpeedKmh;
      const parkedForPeak = isParkedLikeTripEvidence({
        netMoveM: opts?.netMoveM ?? 0,
        sustainedKmh: opts?.sustainedKmh ?? 0,
        motionKmh: opts?.motionKmh ?? 0,
        pathMoveM: opts?.pathMoveM,
        rawGpsKmh: opts?.rawGpsKmh ?? 0,
      });
      const peakNetM = opts?.netMoveM ?? 0;
      const peakSustained = opts?.sustainedKmh ?? 0;
      const peakRawGps = opts?.rawGpsKmh ?? 0;
      const dopplerPeakOk = peakRawGps < 31.67 * 3.6 || peakNetM >= 18;
      peakTrusted =
        !parkedForPeak
        && recordSpeedKmh >= 8
        && peakNetM >= 15
        && peakSustained >= 8
        && dopplerPeakOk;
      peakKmh = recordSpeedKmh;
      if (peakTrusted && peakKmh > tripPeakSpeedRef.current) {
        tripPeakSpeedRef.current = peakKmh;
      }
      if (peakTrusted && peakKmh > liveAchSessionPeakSpeedRef.current) {
        liveAchSessionPeakSpeedRef.current = peakKmh;
      }
      const displayKmhHud = display != null && display > 0 ? display * 3.6 : 0;
      const rawGpsKmhHud = opts?.rawGpsKmh ?? (gpsSpeedMs != null && gpsSpeedMs >= 0 ? gpsSpeedMs * 3.6 : 0);
      const hudFrozenSuspect =
        displayKmhHud < 2
        && rawGpsKmhHud >= 10
        && (opts?.netMoveM ?? 0) >= 8;
      logGpsTickLayerThrottled('SPEED_HUD_DIAG', {
        rawGpsKmh: Number(rawGpsKmhHud.toFixed(1)),
        netMoveM: opts?.netMoveM != null ? Math.round(opts.netMoveM) : null,
        sustainedKmh: opts?.sustainedKmh != null ? Number(opts.sustainedKmh.toFixed(1)) : null,
        motionKmh: opts?.motionKmh != null ? Number(opts.motionKmh.toFixed(1)) : null,
        sanitizedKmh: sanitizedMs != null && sanitizedMs > 0
          ? Number((sanitizedMs * 3.6).toFixed(1))
          : 0,
        displayKmh: Number(displayKmhHud.toFixed(1)),
        displayMs: display != null && display > 0 ? Number(display.toFixed(2)) : 0,
        speedKmhRef: Number(speedKmhRef.current.toFixed(1)),
        hudFrozenSuspect,
        drivingMotionEvidence,
        holdActive: Date.now() < speedSignalHoldUntilRef.current,
      }, hudFrozenSuspect ? 0 : 450);
    }
    const peakFeedMs = peakTrusted && peakKmh > 0 ? peakKmh / 3.6 : display;
    feedSpeedSample(peakFeedMs, peakTrusted);
    feedSpeed(peakFeedMs != null && peakFeedMs > 0 ? peakFeedMs : null);
    if (tripActive) {
      const displayKmh = display != null && display > 0 ? display * 3.6 : 0;
      emitSpeedometerKmh(displayKmh);
      // In trip mode the HUD is isolated via DeviceEventEmitter; do not re-render MapScreen.
      return;
    }
    setSpeed(display);
  }, [feedSpeed]);

  const maybeClearDrivingManualDisable = useCallback((segKm: number, now: number) => {
    if (!drivingManuallyDisabledRef.current) return;
    if (segKm > 0) kmSinceManualOffRef.current += segKm;
    const elapsed = drivingManualDisabledAtRef.current > 0
      ? now - drivingManualDisabledAtRef.current
      : 0;
    if (
      kmSinceManualOffRef.current >= DRIVING_MANUAL_DISABLE_RESET_KM
      || elapsed >= DRIVING_MANUAL_DISABLE_RESET_MS
    ) {
      drivingManuallyDisabledRef.current = false;
      kmSinceManualOffRef.current = 0;
      drivingManualDisabledAtRef.current = 0;
    }
  }, []);

  const checkLiveAchievements = useCallback(async (
    reason: 'speed' | 'distance' | 'periodic' | 'trip_end',
    extraPeakKmh?: number,
  ) => {
    if (liveAchInFlightRef.current) return;
    const now = Date.now();
    const projectedDistanceKm = Math.max(
      0,
      Number(profileTotalDistanceKmRef.current || 0) + Number(liveDistanceKm || 0),
    );
    const movedInTripKm = Math.max(
      0,
      projectedDistanceKm - Number(liveAchTripStartDistanceRef.current || 0),
    );
    const force = reason === 'trip_end';
    const includeTripEndPeak = force && movedInTripKm >= LIVE_ACHIEVEMENT_MIN_MOVING_DISTANCE_KM;
    const currentSpeedKmh = Math.max(
      0,
      Number(speedKmhRef.current || 0),
      Number(liveAchSessionPeakSpeedRef.current || 0),
      includeTripEndPeak ? Number(extraPeakKmh || 0) : 0,
    );
    if (!Number.isFinite(currentSpeedKmh) || !Number.isFinite(projectedDistanceKm)) return;
    const speedDelta = currentSpeedKmh - liveAchLastSpeedSubmittedRef.current;
    const distanceDelta = projectedDistanceKm - liveAchLastDistanceSubmittedRef.current;
    if (!force && movedInTripKm < LIVE_ACHIEVEMENT_MIN_MOVING_DISTANCE_KM) {
      return;
    }
    if (!force && now - liveAchLastCheckAtRef.current < LIVE_ACHIEVEMENT_CHECK_COOLDOWN_MS) return;
    if (!force && reason === 'speed' && speedDelta < LIVE_ACHIEVEMENT_SPEED_DELTA_TRIGGER_KMH) return;
    if (!force && reason === 'distance' && distanceDelta < LIVE_ACHIEVEMENT_DISTANCE_DELTA_TRIGGER_KM) return;

    liveAchInFlightRef.current = true;
    try {
      const token = await AsyncStorage.getItem('token')
        ?? await AsyncStorage.getItem('userToken');
      if (!token) return;
      const res = await fetch(`${API_URL}/api/achievements/check`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          overrides: {
            topSpeed: Number(currentSpeedKmh.toFixed(1)),
            totalDistance: Number(projectedDistanceKm.toFixed(3)),
            tripDistanceKm: Number(movedInTripKm.toFixed(3)),
          },
        }),
      });
      if (!res.ok) return;
      const payload = await res.json().catch(() => null);
      const unlocked = Array.isArray(payload?.newAchievements) ? payload.newAchievements : [];
      for (const ach of unlocked) {
        const key = String(ach?.definition?.key ?? ach?.key ?? ach?.id ?? '');
        if (!key || liveAchUnlockedKeysRef.current.has(key)) continue;
        liveAchUnlockedKeysRef.current.add(key);
        const label = String(ach?.definition?.label ?? ach?.label ?? 'Nowe osiągnięcie');
        Toast.show({
          type: 'success',
          text1: 'Nowe osiągnięcie',
          text2: label,
        });
      }
      liveAchLastCheckAtRef.current = now;
      liveAchLastSpeedSubmittedRef.current = Math.max(liveAchLastSpeedSubmittedRef.current, currentSpeedKmh);
      liveAchLastDistanceSubmittedRef.current = Math.max(liveAchLastDistanceSubmittedRef.current, projectedDistanceKm);
    } catch {
      /* ignore live-check failures */
    } finally {
      liveAchInFlightRef.current = false;
    }
  }, [liveDistanceKm]);

  useEffect(() => {
    if (!(isDriving || isNavigating)) {
      lastReliableSpeedMsRef.current = null;
      speedSignalHoldUntilRef.current = 0;
      liveAchLastSpeedSubmittedRef.current = 0;
      liveAchLastDistanceSubmittedRef.current = Math.max(0, Number(profileTotalDistanceKmRef.current || 0));
      liveAchSessionPeakSpeedRef.current = 0;
      liveAchTripStartDistanceRef.current = Math.max(0, Number(profileTotalDistanceKmRef.current || 0));
      return;
    }
    if (liveAchTripStartDistanceRef.current <= 0) {
      liveAchTripStartDistanceRef.current = Math.max(0, Number(profileTotalDistanceKmRef.current || 0));
    }
  }, [isDriving, isNavigating]);

  /** Checkpoint km w trakcie jazdy — zapis co TRIP_CHECKPOINT_KM na serwer. */
  useMapTripCheckpoints({
    enabled: isDriving || isNavigating,
    checkpointEnabled: ENABLE_TRIP_DISTANCE_CHECKPOINT,
    tripActiveRef: tripCheckpointActiveRef,
    liveDistanceKm,
    flushTripDistanceCheckpoint,
    flushTripDistanceCheckpointRef,
    tripCheckpointSavedKmRef,
  });

  useEffect(() => {
    tripCheckpointActiveRef.current = isDriving || isNavigating
      || isDrivingRef.current
      || isNavigatingRef.current;
  }, [isDriving, isNavigating]);

  useMapTripLifecycle({
    isDriving,
    isNavigating,
    isMapFocused,
    rerouteOrigin,
    refs: {
      isDrivingRef,
      isNavigatingRef,
      lastGoodLocRef,
      lastGpsTickAtRef,
      lastAcceptedFixWallClockRef,
      drLastFrameAtRef,
      drLatRef,
      drLngRef,
      lastSetLocRef,
      speedKmhRef,
      offRouteRef,
      reroutePendingRef,
      routePointsRef,
    },
  });

  const {
    liveUserIds, liveMapStore, warnings, connected,
    sendLocation, toggleSharing, resumeLiveSession, addWarning, confirmWarning, cancelWarning, dismissWarning,
  } = useLiveMap(
    isSharing,
    userLocation,
    settings.backgroundTracking && isPremium,
    liveMapEnabled && sharingHydrated && (isMapFocused || isDriving || isNavigating),
    isSharing && sharingHydrated && isMapFocused,
  );

  useEffect(() => {
    if (connected) void flushQueuedSpeedLimits();
  }, [connected, flushQueuedSpeedLimits]);

  const {
    drops: gamificationDrops,
    availableDropPrompt,
    dropNavigationTargetId,
    syncDriveMode: syncGamificationDriveMode,
    ingestPing: ingestGamificationPing,
    refreshDrops: refreshGamificationDrops,
    deliverPendingRewards: deliverGamificationRewards,
    pollPendingRewards: pollGamificationRewards,
    tryClaimNearbyDrops: tryClaimGamificationDrop,
    purgeDrop: purgeGamificationDrop,
    setDropClaimHandler,
    syncTrackedDropStatus: syncGamificationDropStatus,
    showDropPrompt,
    snoozeDropPrompt,
    hideDropPrompt,
    startDropNavigation,
    clearDropNavigationTarget,
    claimedDropReward,
    dismissClaimedDropReward,
  } = useGamification();

  const handledNotificationDropRef = useRef<number | null>(null);
  useEffect(() => {
    const dropId = Number(notificationParams.dropId);
    if (!Number.isInteger(dropId) || dropId <= 0 || handledNotificationDropRef.current === dropId) return;

    const openDrop = (drop: GeoDropNearby) => {
      handledNotificationDropRef.current = dropId;
      cameraRef.current?.setCamera({
        centerCoordinate: [drop.lng, drop.lat],
        zoomLevel: 15,
        animationDuration: 650,
      });
      showDropPrompt(drop);
    };

    const existing = gamificationDrops.find((drop) => Number(drop.id) === dropId);
    if (existing) { openDrop(existing); return; }

    handledNotificationDropRef.current = dropId;
    void fetchDropStatus(dropId).then((status) => {
      if (!status?.available || !Number.isFinite(status.lat) || !Number.isFinite(status.lng)) {
        handledNotificationDropRef.current = dropId;
        Toast.show({ type: 'info', text1: 'Ten zrzut nie jest już dostępny' });
        return;
      }
      const lat = Number(status.lat);
      const lng = Number(status.lng);
      openDrop({
        id: dropId,
        lat,
        lng,
        radiusM: Number(status.radiusM) || 85,
        rarity: (status.rarity || 'rare') as GeoDropNearby['rarity'],
        type: status.type || 'event',
        expiresAt: String(status.expiresAt),
        distanceM: userLocation ? haversineKm(userLocation.latitude, userLocation.longitude, lat, lng) * 1000 : 0,
        notificationRadiusKm: status.notificationRadiusKm,
      });
    }).catch(() => {
      handledNotificationDropRef.current = dropId;
      Toast.show({ type: 'info', text1: 'Ten zrzut nie jest już dostępny' });
    });
  }, [notificationParams.dropId, gamificationDrops, showDropPrompt, userLocation]);

  const dropNavigationTargetIdRef = useRef(dropNavigationTargetId);
  dropNavigationTargetIdRef.current = dropNavigationTargetId;
  const tryClaimGamificationDropRef = useRef(tryClaimGamificationDrop);
  tryClaimGamificationDropRef.current = tryClaimGamificationDrop;
  const gamificationDropsRef = useRef(gamificationDrops);
  gamificationDropsRef.current = gamificationDrops;

  const mapSessionActive = liveMapEnabled && sharingHydrated;
  const liveUsersEnabled = isSharing && sharingHydrated;
  const liveManuallyDisabledThisSessionRef = useRef(false);

  const liveResumeOnLocRef = useRef(false);
  useEffect(() => {
    void syncGamificationDriveMode(navV3Mode);
    if (navV3Mode === 'freeDrive' || navV3Mode === 'navigation') {
      void pollGamificationRewards(true);
    }
  }, [navV3Mode, syncGamificationDriveMode, pollGamificationRewards]);

  useEffect(() => {
    if (navV3Mode !== 'freeDrive' && navV3Mode !== 'navigation') return;

    const tick = (force = false) => {
      const pose = lastTripMarkerPoseRef.current;
      const lat = pose?.lat ?? userLocation?.latitude;
      const lng = pose?.lng ?? userLocation?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      void ingestGamificationPing({
        lat: lat!,
        lng: lng!,
        mode: navV3Mode,
        headingDeg: drHdgRef.current ?? lastHeadingRef.current ?? null,
        speedKmh: Number.isFinite(speedKmhRef.current) ? speedKmhRef.current : 0,
        force,
      });
    };

    tick(true);
    const intervalMs = dropNavigationTargetId ? 2_000 : 8_000;
    const id = setInterval(() => tick(false), intervalMs);
    return () => clearInterval(id);
  }, [
    navV3Mode,
    dropNavigationTargetId,
    userLocation?.latitude,
    userLocation?.longitude,
    ingestGamificationPing,
  ]);

  useMapGeoDrops({
    navV3Mode,
    dropNavigationTargetId,
    gamificationDropsLength: gamificationDrops.length,
    availableDropPrompt,
    userLat: userLocation?.latitude,
    userLng: userLocation?.longitude,
    lastTripMarkerPoseRef,
    drHdgRef,
    lastHeadingRef,
    speedKmhRef,
    tryClaimGamificationDrop,
    refreshGamificationDrops,
    syncGamificationDropStatus,
    pollGamificationRewards,
  });

  useEffect(() => {
    if (!isSharing || !sharingHydrated || !liveMapEnabled) return;
    if (!userLocation?.latitude || !userLocation?.longitude) return;
    if (liveResumeOnLocRef.current) return;
    liveResumeOnLocRef.current = true;
    void resumeLiveSession();
  }, [
    isSharing,
    sharingHydrated,
    liveMapEnabled,
    userLocation?.latitude,
    userLocation?.longitude,
    resumeLiveSession,
  ]);

  useEffect(() => {
    if (!isSharing) liveResumeOnLocRef.current = false;
  }, [isSharing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // LIVE ma być domyślnie i trwale ON. Stare zapisane OFF ignorujemy.
        await AsyncStorage.setItem(LIVE_SHARING_USER_PREF_KEY, 'true');
        if (!cancelled && !liveManuallyDisabledThisSessionRef.current) {
          setIsSharing(true);
        }

        const token = await AsyncStorage.getItem('token');
        if (!token) return;
        const data = await fetchProfileMeCached({ token });
        if (cancelled || !data) return;
        const profileAvatar = (data.avatarUrl ?? data.avatar) as string | null;
        if (profileAvatar && typeof profileAvatar === 'string') {
          setMyAvatarUrl(
            profileAvatar.startsWith('http')
              ? profileAvatar
              : `${API_URL}${profileAvatar.startsWith('/') ? profileAvatar : `/${profileAvatar}`}`,
          );
        }
        if (!cancelled && !liveManuallyDisabledThisSessionRef.current) {
          setIsSharing(true);
          await AsyncStorage.setItem(LIVE_SHARING_USER_PREF_KEY, 'true');
          void resumeLiveSession();
        }
        if (Number.isFinite(Number(data.totalDistance))) {
          profileTotalDistanceKmRef.current = Math.max(0, Number(data.totalDistance));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setSharingHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const {
    isBuilding, pins, saving, snapping, snappedRoute, displaySnappedRoute,
    startBuilding, cancelBuilding,
    addPin, removePin, finishPin, snapToRoad,
    totalDistance, saveRoute,
  } = useRouteBuilder();

  const {
    isRunning: timerRunning, elapsedSec,
    routeName: timerRouteName,
    startTimer, stopTimer, resetTimer, formatElapsed,
  } = useRouteTimer();

  const {
    data: leaderboardData, runsData: leaderboardRunsData,
    loading: leaderboardLoading,
    fetchLeaderboard, fetchRuns, saveRun,
  } = useRouteLeaderboard();

  const { onNavigationStart, onNavigationComplete, onNavigationCancel } = useNavigationPoints();

  const {
    updateCameraFrame,
    markUserGesture,
    recenterTo,
    resetBrowseCamera,
    releaseTripCameraState,
    abortTripCameraAnimation,
    setFollowMode,
    setTripCameraActive,
    getLastProgrammaticCameraApplyMs,
    isUserExploringMap,
    shouldPauseTripCameraFollow,
    resumeTripCameraFollow,
    syncUserExploreView,
    notifyUserMapInteraction,
    getLastAppliedCameraZoom,
    touchProgrammaticCameraApply,
    getUserZoomOverride,
  } = useCameraAnimation(cameraRef);

  useEffect(() => {
    isUserExploringMapRef.current = isUserExploringMap;
  }, [isUserExploringMap]);

  useEffect(() => {
    getLastProgrammaticCameraApplyMsRef.current = getLastProgrammaticCameraApplyMs;
  }, [getLastProgrammaticCameraApplyMs]);

  useEffect(() => {
    setTripCameraActive(isDriving || isNavigating);
  }, [isDriving, isNavigating, setTripCameraActive]);

  const resetBrowseCameraRef = useRef<
    ((center: { latitude: number; longitude: number }, opts?: { animate?: boolean }) => void) | null
  >(null);

  useEffect(() => {
    resetBrowseCameraRef.current = resetBrowseCamera;
  }, [resetBrowseCamera]);

  const prevTripActiveMapRef = useRef(false);

  const resolveBrowseCameraCenter = useCallback((): { latitude: number; longitude: number } | null => {
    const dlat = drLatRef.current;
    const dlng = drLngRef.current;
    if (
      Number.isFinite(dlat)
      && Number.isFinite(dlng)
      && !(Math.abs(dlat) < 1e-6 && Math.abs(dlng) < 1e-6)
    ) {
      return { latitude: dlat, longitude: dlng };
    }
    if (
      userLocation
      && Number.isFinite(userLocation.latitude)
      && Number.isFinite(userLocation.longitude)
    ) {
      return { latitude: userLocation.latitude, longitude: userLocation.longitude };
    }
    const good = lastGoodLocRef.current;
    if (good) return { latitude: good.lat, longitude: good.lng };
    const last = lastMapCenterRef.current;
    if (Array.isArray(last) && last.length >= 2) {
      return { latitude: last[1], longitude: last[0] };
    }
    return null;
  }, [userLocation]);

  const restoreBrowseCameraAfterTrip = useCallback((opts?: { animate?: boolean }) => {
    const center = resolveBrowseCameraCenter();
    if (!center) {
      releaseTripCameraState();
      cameraV3.release();
      return;
    }
    cameraV3.resetBrowseCamera(center, { animate: opts?.animate !== false });
    releaseTripCameraState();
  }, [resolveBrowseCameraCenter, releaseTripCameraState, cameraV3]);

  /** Po wyjściu z jazdy/nawigacji: widok browse (zoom, pitch, padding, północ). */
  useEffect(() => {
    const wasTrip = prevTripActiveMapRef.current;
    prevTripActiveMapRef.current = isTripActiveMap;
    if (isTripActiveMap) return;
    if (!wasTrip) return;
    cameraLookaheadEmaRef.current = 0;
    if (isNavigatingRef.current || isDrivingRef.current) return;
    restoreBrowseCameraAfterTrip({ animate: true });
  }, [isTripActiveMap, restoreBrowseCameraAfterTrip]);

  // v10: udostepniamy updateCameraFrame przez ref, zeby applyTripPosition
  // (zdefiniowane wczesniej w pliku) mogl wywolac kamere follow.
  useEffect(() => {
    updateCameraFrameRef.current = updateCameraFrame;
  }, [updateCameraFrame]);

  const hardResetOnRouteChange = useCallback((
    lat: number,
    lng: number,
    heading: number,
    reason: 'reroute' | 'route_swap',
  ) => {
    resetTravelHeadingState(lat, lng, normalizeHeading(heading));
    tripBootstrapPose(lat, lng, heading, { animateCamera: false });
    vroomGpsLog('NAV_SANITY_HARD_RESET', {
      reason,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      hdg: Math.round(normalizeHeading(heading)),
    }, 0);
  }, [tripBootstrapPose, resetTravelHeadingState]);

  useEffect(() => () => {
    resetSpeedometerEmitterThrottle();
  }, []);


  const navMappedPointsRef = useRef<{lat: number, lng: number}[]>([]);
  const navPrevPtsRef = useRef<any[]>([]);

  useEffect(() => {
    if (!isNavigating || !navigationUiReady) return;
    const pts = routePointsRef.current;
    if (pts.length >= 2) {
      if (navPrevPtsRef.current !== pts) {
         navMappedPointsRef.current = pts.map(p => ({ lat: p.latitude, lng: p.longitude }));
         navPrevPtsRef.current = pts;
      }
      navV3.setRoutePolyline(navMappedPointsRef.current);
    }
  }, [isNavigating, navV3, routePointsRef.current]);


  /** Wejście w jazdę: heading-up follow + wznów natywny tracking po geście użytkownika. */
  const prevDrivingCameraArmRef = useRef(false);
  useEffect(() => {
    const drivingTrip = isDriving && !isNavigating;
    const entered = drivingTrip && !prevDrivingCameraArmRef.current;
    prevDrivingCameraArmRef.current = drivingTrip;
    if (!entered) return;
    if (drivingEntryJustStartedRef.current) return;
    const followHeading = Number.isFinite(drHdgRef.current)
      ? drHdgRef.current
      : (Number.isFinite(lastHeadingRef.current) ? lastHeadingRef.current : 0);
    setFollowMode('drivingFollow');
    cameraV3.setUserExploring(false);
    cameraV3.armTripFollow(followHeading);
  }, [isDriving, isNavigating, setFollowMode, cameraV3]);

  useEffect(() => {
    if (!MAP_RENDER_DEBUG) return;
    renderCountRef.current += 1;
    const now = Date.now();
    const elapsedMs = now - renderWindowStartRef.current;
    if (elapsedMs >= 2000) {
      const rps = (renderCountRef.current / (elapsedMs / 1000)).toFixed(2);
      mapDbg('RENDER_RATE', {
        renders: renderCountRef.current,
        elapsedMs,
        rps: Number(rps),
      });
      renderCountRef.current = 0;
      renderWindowStartRef.current = now;
    }

    const sigObj = {
      isMapFocused,
      isNavigating,
      isDriving,
      isSimulating,
      mapType,
      currentZoom: Number(currentZoom.toFixed(2)),
      modals: {
        settingsVisible,
        reportVisible,
        searchModalVisible,
        userInfoVisible,
        saveRouteVisible,
        tripStatsVisible,
        addCameraVisible,
        cameraDetailVisible,
        fuelStationModalVisible,
        leaderboardVisible,
      },
      sharing: isSharing,
      cameraPickMode,
      routePreview: Boolean(startLocation && endLocation && !isNavigating),
      routeState: {
        hasRouteInfo: Boolean(routeInfo),
        points: routePointsRef.current.length,
        remaining: remainingRoutePoints.length,
      },
    };
    const sig = JSON.stringify(sigObj);
    if (sig !== prevRenderSigRef.current) {
      prevRenderSigRef.current = sig;
      mapDbg('RENDER_DIFF', sigObj);
    }
  });

  useEffect(() => {
    if (!MAP_RENDER_DEBUG) return;
    const id = setInterval(() => {
      const drFresh =
        drLatRef.current !== 0 &&
        drLngRef.current !== 0 &&
        Date.now() - drLastFrameAtRef.current <= DR_STALE_MS;
      mapDbg('HEALTH_SNAPSHOT', {
        isMapFocused,
        isNavigating,
        isDriving,
        isSimulating,
        speedKmh: Number((speedKmhRef.current || 0).toFixed(1)),
        heading: Number((lastHeadingRef.current || 0).toFixed(1)),
        hasUserLocation: Boolean(userLocation),
        drFresh,
        routePoints: routePointsRef.current.length,
        remainingRoutePoints: remainingRoutePoints.length,
        mapStyle,
      });
    }, 5000);
    return () => clearInterval(id);
  }, [isMapFocused, isNavigating, isDriving, isSimulating, userLocation, remainingRoutePoints.length, mapStyle, mapDbg]);

  useEffect(() => {
    if (!MAP_RENDER_DEBUG || !userLocation) return;
    const now = Date.now();
    if (now - lastLocLogAtRef.current < 500) return;
    lastLocLogAtRef.current = now;
    mapDbg('LOCATION_UPDATE', {
      lat: Number(userLocation.latitude.toFixed(6)),
      lng: Number(userLocation.longitude.toFixed(6)),
      speedKmh: Number((speedKmhRef.current || 0).toFixed(1)),
      heading: Number((lastHeadingRef.current || 0).toFixed(1)),
      isNavigating,
      isDriving,
      isMapFocused,
    });
  }, [userLocation, isNavigating, isDriving, isMapFocused, mapDbg]);

  useEffect(() => {
    mapDbg('STATE_FLAGS', {
      isMapFocused,
      isNavigating,
      isDriving,
      isSharing,
      isSimulating,
      mapType,
      currentZoom: Number(currentZoom.toFixed(2)),
    });
  }, [isMapFocused, isNavigating, isDriving, isSharing, isSimulating, mapType, currentZoom, mapDbg]);

  // ── Sync currentLocRef so stable interval callbacks read latest position ──
  useEffect(() => { currentLocRef.current = userLocation; }, [userLocation]);

  useEffect(() => {
    const c = peekMapLastLocation();
    if (!c) return;
    if (!lastAcceptedFixWallClockRef.current) {
      lastAcceptedFixWallClockRef.current = c.at;
    }
    if (drLatRef.current === 0 && drLngRef.current === 0) {
      drLatRef.current = c.latitude;
      drLngRef.current = c.longitude;
    }
  }, []);
  useEffect(() => {
    if (
      userLocation
      && Number.isFinite(userLocation.latitude)
      && Number.isFinite(userLocation.longitude)
    ) {
      lastMapCenterRef.current = [userLocation.longitude, userLocation.latitude];
    }
  }, [userLocation]);

  const runCameraSpeedUpdate = useCallback(() => {
    const drOk =
      (isNavigating || isDriving)
      && drLatRef.current !== 0
      && drLngRef.current !== 0
      && Date.now() - drLastFrameAtRef.current <= DR_STALE_MS;
    const lat = drOk ? drLatRef.current : userLocation?.latitude;
    const lng = drOk ? drLngRef.current : userLocation?.longitude;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const gateM = (isNavigating || isDriving) ? CAMERA_SPEED_LIMIT_GATE_NAV_M : CAMERA_SPEED_LIMIT_GATE_M;
    if (lastCameraUpdateLocRef.current) {
      const movedM = haversineKm(lat, lng,
        lastCameraUpdateLocRef.current.lat, lastCameraUpdateLocRef.current.lng) * 1000;
      if (movedM < gateM) {
        if (DEBUG_NETWORK) console.log('[cameras/speedlimit] gate — moved only', movedM.toFixed(0), 'm');
        return;
      }
    }
    lastCameraUpdateLocRef.current = { lat, lng };

    if (DEBUG_NETWORK) console.log('[cameras/speedlimit] updating at', lat.toFixed(5), lng.toFixed(5));
    updateCameras(lat, lng, {
      headingDeg: lastHeadingRef.current,
      speedKmh: speedKmhRef.current,
    });
    updateSpeedLimit(lat, lng, { nav: isNavigating || isDriving, heading: lastHeadingRef.current });
  }, [userLocation?.latitude, userLocation?.longitude, isNavigating, isDriving, updateCameras, updateSpeedLimit]);

  const canPollCameras = isMapFocused || isNavigating || isDriving;
  const tripCameraPoll = canPollCameras && (isNavigating || isDriving);

  useEffect(() => {
    if (!canPollCameras) return;
    if (tripCameraPoll) return;
    if (!userLocation) return;
    runCameraSpeedUpdate();
  }, [canPollCameras, tripCameraPoll, userLocation, runCameraSpeedUpdate]);

  useMapCameraSpeedPoll({
    tripActive: tripCameraPoll,
    runOnce: false,
    poll: runCameraSpeedUpdate,
  });

  useEffect(() => {
    isNavigatingRef.current = isNavigating;
  }, [isNavigating]);

  // ── Sync isDrivingRef ─────────────────────────────────────
  useEffect(() => {
    isDrivingRef.current = isDriving;
  }, [isDriving]);
  useEffect(() => {
    if (
      Platform.OS === 'android'
      && !isDriving
      && Date.now() < navSessionColdStartGuardUntilRef.current
    ) {
      return;
    }
    setDrivingFlag(isDriving).catch(() => {});
  }, [isDriving]);

  // Bootstrap markera raz na wejście w trip — useLayoutEffect przed pierwszą klatką
  // (useEffect uruchamiał seed markera z heading=0 zanim tripBootstrapPose zdążył).
  useLayoutEffect(() => {
    const tripActive = isDriving || isNavigating;
    if (!tripActive) {
      tripMarkerV2BootstrappedRef.current = false;
      return;
    }
    if (tripMarkerV2BootstrappedRef.current) return;
    const best = resolveBestKnownPose({
      drLat: drLatRef.current,
      drLng: drLngRef.current,
      drHdg: drHdgRef.current,
      tripActive: true,
      lastSetLoc: lastSetLocRef.current,
      lastGoodLoc: lastGoodLocRef.current,
      userLocation: currentLocRef.current ?? userLocation,
      headingFallback: lastGpsDeviceHeadingRef.current ?? lastHeadingRef.current,
    });
    const plat = best?.latitude ?? drLatRef.current;
    const plng = best?.longitude ?? drLngRef.current;
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) return;
    if (Math.abs(plat) < 1e-6 && Math.abs(plng) < 1e-6) return;
    tripMarkerV2BootstrappedRef.current = true;
    const hdgHint = best?.headingDeg
      ?? (Number.isFinite(drHdgRef.current) ? drHdgRef.current : (lastHeadingRef.current || 0));
    tripBootstrapPose(plat, plng, hdgHint, { animateCamera: true });
  }, [isDriving, isNavigating, tripBootstrapPose, userLocation]);


  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);
  useEffect(() => { backgroundTrackingRef.current = settings.backgroundTracking && isPremium; }, [settings.backgroundTracking, isPremium]);

  const { flushPendingKm, finalizeTripSession } = useBackgroundTracking(
    isSharing,
    settings.backgroundTracking && isPremium,
    isNavigating || isDriving,
    sharingHydrated,
    isPremium,
  );

  const { showNavigationNotification, dismissNavigationNotification } = useNavigationNotification();

  useEffect(() => {
    endLocationRef.current = endLocation;
  }, [endLocation]);

  useEffect(() => {
    if (endLocation && !isNavigating) {
      // Ustaw raz gdy pojawia się cel, nie aktualizuj co GPS update
      setStableStartLocation(prev => prev ?? startLocation);
    } else {
      setStableStartLocation(null);
    }
  }, [endLocation, isNavigating]);

  /** Podgląd trasy: tylko isNavigating blokuje Directions (nie isDriving — inaczej brak trasy w trybie jazdy). */
  const routePreviewOrigin = useMemo((): LocationState | null => {
    if (isNavigating || isOffroadRoute) return null;

    const tripActive = isDriving || isNavigating;
    if (tripActive) {
      const live = getLiveTripPose({
        drLat: drLatRef.current,
        drLng: drLngRef.current,
        drHdg: drHdgRef.current,
        tripActive: true,
        lastSetLoc: lastSetLocRef.current,
        lastGoodLoc: lastGoodLocRef.current,
      });
      if (live) {
        return { latitude: live.latitude, longitude: live.longitude, name: 'Moja pozycja' };
      }
    }

    if (
      startLocation
      && Number.isFinite(startLocation.latitude)
      && Number.isFinite(startLocation.longitude)
      && !tripActive
    ) {
      return startLocation;
    }
    if (userLocation && Number.isFinite(userLocation.latitude) && Number.isFinite(userLocation.longitude)) {
      return { ...userLocation, name: 'Moja pozycja' };
    }
    return null;
  }, [isNavigating, isOffroadRoute, isDriving, startLocation, userLocation, livePreviewOriginTick]);

  const routePreviewDestination = useMemo((): LocationState | null => {
    if (isNavigating || isOffroadRoute) return null;
    return endLocation;
  }, [isNavigating, isOffroadRoute, endLocation]);

  const { routes: alternativeRoutes, loading: previewLoading, error: previewError } = useGoogleDirectionsAlternatives(
    routePreviewOrigin,
    routePreviewDestination,
  );

  // ── Offroad preview route — prosta linia z punków ─────────
  const offroadPreviewRoute = useMemo(() => {
    if (!isOffroadRoute || !startLocation || !endLocation) return null;

    // ← użyj załadowanych punktów, nie routePointsRef
    const points = offroadLoadedPointsRef.current.length > 1
      ? offroadLoadedPointsRef.current
      : [
          { latitude: startLocation.latitude,  longitude: startLocation.longitude },
          { latitude: endLocation.latitude,    longitude: endLocation.longitude },
        ];

    const dist = points.reduce((acc, p, i) => {
      if (i === 0) return 0;
      return acc + haversineKm(
        points[i-1].latitude, points[i-1].longitude,
        p.latitude, p.longitude,
      );
    }, 0);

    return {
      points,
      distanceValue: dist * 1000,
      distance:      dist.toFixed(1),
      duration:      0,
      durationText:  '—',
      distanceText:  `${dist.toFixed(1)} km`,
      steps:         [],
      index:         0,
    };
  }, [isOffroadRoute, startLocation, endLocation]);

  const previewRoute = isOffroadRoute
    ? offroadPreviewRoute
    : (alternativeRoutes[selectedRouteIndex] ?? null);

  useEffect(() => {
    previewRouteRef.current = previewRoute;
  }, [previewRoute]);

  const { route: navRoute } = useGoogleDirections(
    navStartLoc,
    isNavigating ? endLocation : null,
  );

  const { route: rerouteResult, loading: rerouteLoading, error: rerouteError } = useGoogleDirections(
    rerouteOrigin,
    rerouteOrigin ? endLocation : null,
    undefined,
    rerouteHeadingForApi,
    {
      isReroute: true,
      continueStraight: true,
      headingRangeDeg: REROUTE_BEARING_RANGE_DEG,
      preferForward: true,
    },
  );

  const clusteredWarnings = useMemo(
    () => clusterWarnings(warnings ?? []),
    [warnings],
  );

  const getCurrentAccurateLocation = useCallback(() => {
    let lat = userLocation?.latitude;
    let lng = userLocation?.longitude;
    let heading = lastHeadingRef.current;

    if (isDrivingRef.current || isNavigatingRef.current) {
      const mLat = driveMarker.lat.value;
      const mLng = driveMarker.lng.value;
      const mHdg = driveMarker.heading.value;
      const drLat = drLatRef.current;
      const drLng = drLngRef.current;

      if (Number.isFinite(mLat) && Number.isFinite(mLng)) {
        lat = mLat;
        lng = mLng;
        if (Number.isFinite(mHdg)) heading = mHdg;
      } else if (Number.isFinite(drLat) && drLat !== 0) {
        lat = drLat;
        lng = drLng;
      }
    }
    return { lat, lng, heading, accuracy: lastGpsAccuracyRef.current };
  }, [userLocation, driveMarker]);

  const handleAddCamera = useCallback(async (
    params: {
      maxspeed: number | null;
      type: 'fixed' | 'section' | 'mobile' | 'bump';
      description: string | null;
    },
    coords?: { lat: number; lng: number } | null,
  ) => {
    const acc = getCurrentAccurateLocation();
    const lat = coords?.lat ?? acc.lat;
    const lng = coords?.lng ?? acc.lng;
    if (lat == null || lng == null) {
      Toast.show({ type: 'error', text1: 'GPS', text2: 'Brak pozycji — włącz lokalizację lub wskaż na mapie.' });
      return;
    }
    const result = await addCamera({
      lat,
      lng,
      maxspeed:    params.maxspeed,
      type:        params.type,
      description: params.description,
    });
    if (result) {
      Toast.show({ type: 'success', text1: '📷 FOTORADAR DODANY', text2: 'Dziękujemy za zgłoszenie!' });
      invalidate();
      const refLat = acc.lat ?? lat;
      const refLng = acc.lng ?? lng;
      updateCameras(refLat, refLng, {
        headingDeg: acc.heading,
        speedKmh,
      });
    } else {
      Toast.show({ type: 'info', text1: 'Fotoradar już istnieje w tym miejscu' });
    }
  }, [getCurrentAccurateLocation, addCamera, invalidate, updateCameras, speedKmh]);

  const cancelCameraPick = useCallback(() => {
    setCameraPickMode(false);
    setPendingAddCameraParams(null);
  }, []);

  const handleSelectCamera = useCallback((camera: SpeedCamera) => {
    setSelectedCamera(camera);
    setCameraDetailVisible(true);
  }, []);

  const confirmCameraPick = useCallback(async () => {
    if (!pendingAddCameraParams) return;
    const { lat, lng } = pickCenterRef.current;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      Toast.show({ type: 'error', text1: 'Mapa', text2: 'Poczekaj chwilę lub przesuń mapę pod celownik.' });
      return;
    }
    await handleAddCamera(pendingAddCameraParams, { lat, lng });
    setCameraPickMode(false);
    setPendingAddCameraParams(null);
  }, [pendingAddCameraParams, handleAddCamera]);

  const cancelManualTargetPick = useCallback(() => {
    setManualTargetPickMode(false);
  }, []);

  // ── Helper: generuj kroki offroad z punktów trasy ─────────
  const buildOffroadSteps = useCallback((
    points: { latitude: number; longitude: number }[],
  ) => {
    if (points.length < 2) return [];
    return points.slice(0, -1).map((p, i) => {
      const next = points[i + 1];
      const distKm = haversineKm(p.latitude, p.longitude, next.latitude, next.longitude);
      return {
        html_instructions: `Jedź w kierunku punktu ${i + 2}`,
        distance: { text: `${(distKm * 1000).toFixed(0)} m`, value: distKm * 1000 },
        duration: { text: '', value: 0 },
        maneuver: 'straight',
        start_location: { lat: p.latitude,    lng: p.longitude },
        end_location:   { lat: next.latitude, lng: next.longitude },
      };
    });
  }, []);

  
  const resetDRRefs = useCallback(() => {
    drLatRef.current  = 0;
    drLngRef.current  = 0;
    drHdgRef.current  = 0;
  }, []);

  // ─────────────────────────────────────────────────��───────
  // Effects
  // ─────────────────────────────────────────────────────────

  // ── isOffroadRef synchronizuj ze statem ──────────────────
  useEffect(() => {
    isOffroadRef.current = isOffroadRoute;
  }, [isOffroadRoute]);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (!raw) return;
      const user = JSON.parse(raw);
      setCurrentUserId(user.userId);
      const rawAvatar = user.avatarUrl ?? user.avatar ?? null;
      setMyAvatarUrl(
        rawAvatar && typeof rawAvatar === 'string'
          ? (rawAvatar.startsWith('http')
            ? rawAvatar
            : `${API_URL}${rawAvatar.startsWith('/') ? rawAvatar : `/${rawAvatar}`}`)
          : null,
      );
      setMyUsername(user.username ?? '');
    });
  }, []);

  useFocusEffect(useCallback(() => {
    void reloadEquippedVehicle();
  }, [reloadEquippedVehicle]));

  useEffect(() => {
    if (wantVehicle3DMarker) void reloadEquippedVehicle();
  }, [wantVehicle3DMarker, reloadEquippedVehicle]);

  useFocusEffect(useCallback(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('nav_route');
      if (!raw) return;
      await AsyncStorage.removeItem('nav_route');
      const data = JSON.parse(raw);
      if (!data.points?.length) return;

      const first = data.points[0];
      const last  = data.points[data.points.length - 1];

      const offroad = data.isOffroad ?? false;
      setIsOffroadRoute(offroad);
      isOffroadRef.current = offroad;

      // ← KLUCZOWE: zapisz wszystkie punkty
      if (offroad) {
        offroadLoadedPointsRef.current = data.points.map((p: any) => ({
          latitude:  p.latitude,
          longitude: p.longitude,
        }));
        routePointsRef.current = offroadLoadedPointsRef.current;
      } else {
        offroadLoadedPointsRef.current = [];
      }

      const routeStart: LocationState = {
        latitude: first.latitude,
        longitude: first.longitude,
        name: 'Start trasy',
      };
      const routeEnd: LocationState = {
        latitude: last.latitude,
        longitude: last.longitude,
        name: data.routeName,
      };

      setStartLocation(routeStart);
      setEndLocation(routeEnd);

      loadedRouteRef.current = {
        routeId: data.routeId,
        routeName: data.routeName,
        start: routeStart,
        end: routeEnd,
        isOffroad: offroad,
        points: data.points.map((p: { latitude: number; longitude: number }) => ({
          latitude: p.latitude,
          longitude: p.longitude,
        })),
      };
      approachingRouteStartRef.current = false;
      autoStartRouteAfterApproachRef.current = false;

      pendingRouteRef.current = { id: data.routeId, name: data.routeName };
      setLeaderboardRouteId(data.routeId);
      setLeaderboardRouteName(data.routeName);

      Toast.show({ type: 'success', text1: '🗺️ TRASA ZAŁADOWANA', text2: data.routeName });
    })();
  }, []));

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('nav_destination');
        if (!raw) return;
        if (isDrivingRef.current || isNavigatingRef.current) return;
        await AsyncStorage.removeItem('nav_destination');
        const dest = JSON.parse(raw);
        let loc = userLocation;
        if (!loc) {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
            mayShowUserSettingsDialog: true,
          });
          if (isStaleGpsTimestamp(Date.now(), pos.timestamp)) {
            Toast.show({ type: 'error', text1: 'GPS', text2: 'Stary odczyt lokalizacji — spróbuj ponownie.' });
            return;
          }
          const rLat = pos.coords.latitude;
          const rLng = pos.coords.longitude;
          const rAcc = pos.coords.accuracy ?? 999;
          if (
            Number.isFinite(rLat) && Number.isFinite(rLng) && !isNullIsland(rLat, rLng)
            && rAcc <= GPS_ONESHOT_MAX_ACCURACY_M
          ) {
            loc = { latitude: rLat, longitude: rLng };
            setUserLocation(loc);
            lastGoodLocRef.current = { lat: rLat, lng: rLng };
            lastAcceptedFixWallClockRef.current = Date.now();
          } else {
            Toast.show({ type: 'error', text1: 'GPS', text2: 'Za mało dokładna lokalizacja — spróbuj ponownie.' });
            return;
          }
        }
        setStartLocation({ ...loc, name: 'Moja pozycja' });
        setEndLocation({ latitude: dest.latitude, longitude: dest.longitude, name: dest.name });
        Toast.show({ type: 'success', text1: '📍 CEL USTAWIONY', text2: dest.name });
      } catch (e) { console.log('nav_destination error:', e); }
    })();
  }, [userLocation]));

  // Reset the navigation flag on screen focus so that if the app was killed
  // or crashed mid-navigation the background auto-flush is not permanently blocked.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      if (isNavigatingRef.current) return;
      try {
        const [state, navRaw] = await Promise.all([
          BackgroundDriveController.getState(),
          AsyncStorage.getItem(NAV_SESSION_KEY),
        ]);
        if (cancelled) return;
        if (state?.active === true && state.mode === 'navigation') return;
        const navSession = parsePersistedNavSession(navRaw);
        if (isFreshPersistedNavSession(navSession, {
          tripSessionId: state?.tripSessionId ?? null,
          maxAgeMs: NAV_SESSION_MAX_AGE_MS,
        })) {
          return;
        }
      } catch {
        // best effort cleanup below
      }
      if (!cancelled && !isNavigatingRef.current) {
        setNavigatingFlag(false).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []));

  // Zdejmij blokadę ręcznego włączenia jazdy przy opuszczeniu zakładki (zawieszony fetch / brak finally).
  useFocusEffect(useCallback(() => {
    return () => {
      drivingManualEntryBusyRef.current = false;
    };
  }, []));

  useEffect(() => {
    const pinIds = new Set(pins.map(p => p.id));
    setPinImages(prev => {
      const next: Record<string, string> = {};
      Object.keys(prev).forEach(k => { if (pinIds.has(k)) next[k] = prev[k]; });
      return next;
    });
  }, [pins]);

  const applyBootstrapLocation = useCallback((
    lat: number,
    lng: number,
    opts?: { approximate?: boolean; accuracy?: number },
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || isNullIsland(lat, lng)) return;
    lastMapCenterRef.current = [lng, lat];
    const provisional = !!opts?.approximate;
    if (provisional) {
      const trusted =
        lastGoodLocRef.current
        ?? (peekMapLastLocation()
          ? { lat: peekMapLastLocation()!.latitude, lng: peekMapLastLocation()!.longitude }
          : null);
      if (trusted) {
        const cacheJumpM = haversineKm(trusted.lat, trusted.lng, lat, lng) * 1000;
        if (cacheJumpM > 800) {
          if (__DEV__) {
            console.log('[GPSDBG] BOOTSTRAP_REJECT', JSON.stringify({
              at: Date.now(),
              jumpM: Math.round(cacheJumpM),
              lat: Number(lat.toFixed(6)),
              lng: Number(lng.toFixed(6)),
            }));
          }
          return;
        }
      }
      // Cache / last-known tylko do szybkiego pokazania mapy — nie truj kotwicy GPS.
      gpsBootstrapPendingRef.current = true;
    } else {
      gpsBootstrapPendingRef.current = false;
      lastGoodLocRef.current = { lat, lng };
      lastAcceptedFixWallClockRef.current = Date.now();
      drLatRef.current = lat;
      drLngRef.current = lng;
    }
    setUserLocation({ latitude: lat, longitude: lng });
    setRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.015, longitudeDelta: 0.015 });
    if (!isDrivingRef.current && !isNavigatingRef.current) {
      resetBrowseCameraRef.current?.({ latitude: lat, longitude: lng }, { animate: false });
    }
    setLocationReady(true);
    locationReadyRef.current = true;
    // Cache/last-known: pokazuj od razu na mapie, bez banera „Szukam GPS”.
    setGpsAcquiring(false);
    if (__DEV__) {
      console.log('[GPSDBG] BOOTSTRAP_LOC', JSON.stringify({
        at: Date.now(),
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        approximate: !!opts?.approximate,
        accM: opts?.accuracy != null ? Math.round(opts.accuracy) : null,
      }));
    }
  }, []);

  // ── Init GPS ──────────────────────────────────────────────
  // Cache AsyncStorage + last-known OS → mapa od razu; świeży fix GPS podmienia pozycję.
  useEffect(() => {
    let cancelled = false;
    let deferredToBgDrive = false;
    let watchSub: { remove: () => void } | null = null;
    let initUnlockTimer: ReturnType<typeof setTimeout> | null = null;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const acceptFreshFix = (loc: Location.LocationObject): boolean => {
      const rawLat = loc.coords.latitude;
      const rawLng = loc.coords.longitude;
      const acc = loc.coords.accuracy ?? 999;
      if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng) || isNullIsland(rawLat, rawLng)) return false;
      if (acc > GPS_INIT_MAX_ACCURACY_M) return false;
      if (isStaleGpsTimestamp(Date.now(), loc.timestamp)) return false;
      return true;
    };

    const applyInitialFix = (loc: Location.LocationObject, approximate = false) => {
      const rawLat = loc.coords.latitude;
      const rawLng = loc.coords.longitude;
      const acc = loc.coords.accuracy ?? 999;
      const prevAnchor =
        lastGoodLocRef.current
        ?? (peekMapLastLocation()
          ? { lat: peekMapLastLocation()!.latitude, lng: peekMapLastLocation()!.longitude }
          : null);
      if (approximate && prevAnchor) {
        const initJumpM = haversineKm(prevAnchor.lat, prevAnchor.lng, rawLat, rawLng) * 1000;
        if (initJumpM > 800) {
          if (__DEV__) {
            console.log('[GPSDBG] INIT_LASTKNOWN_REJECT', JSON.stringify({
              at: Date.now(),
              jumpM: Math.round(initJumpM),
            }));
          }
          return;
        }
      }
      const jumpFromAnchorM = prevAnchor
        ? haversineKm(prevAnchor.lat, prevAnchor.lng, rawLat, rawLng) * 1000
        : 0;
      const shouldRebaseAnchor =
        gpsBootstrapPendingRef.current
        || (!approximate && jumpFromAnchorM > 120 && acc <= GPS_INIT_MAX_ACCURACY_M);
      if (shouldRebaseAnchor || acc <= 80) {
        latFilter.reset();
        lngFilter.reset();
        navLatFilter.reset();
        navLngFilter.reset();
        drivLatFilter.reset();
        drivLngFilter.reset();
        idleJumpCandidateRef.current = null;
        idleUiJumpCandidateRef.current = null;
        stillLockCandidateRef.current = null;
        idleRecoveryClusterRef.current = null;
      }
      const canCommitAnchor = !approximate && acc <= GPS_INIT_MAX_ACCURACY_M;
      const lat = canCommitAnchor ? rawLat : latFilter.filter(rawLat, acc);
      const lng = canCommitAnchor ? rawLng : lngFilter.filter(rawLng, acc);
      lastMapCenterRef.current = [lng, lat];
      setUserLocation({ latitude: lat, longitude: lng });
      setRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.015, longitudeDelta: 0.015 });
      if (canCommitAnchor) {
        lastGoodLocRef.current = { lat, lng };
        lastSetLocRef.current = { lat, lng };
        lastAcceptedFixWallClockRef.current = Date.now();
        drLatRef.current = lat;
        drLngRef.current = lng;
        gpsBootstrapPendingRef.current = false;
        persistMapLocation(lat, lng, acc);
        if (!isDrivingRef.current && !isNavigatingRef.current) {
          resetBrowseCameraRef.current?.({ latitude: lat, longitude: lng }, { animate: false });
        }
      }
      setLocationReady(true);
      locationReadyRef.current = true;
      setGpsAcquiring(false);
    };

    const unlockMapWithFallback = () => {
      if (cancelled) return;
      if (deferredToBgDrive) return;
      const wasReady = locationReadyRef.current;
      const [lng, lat] = lastMapCenterRef.current;
      if (!wasReady) {
        setRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.02 });
        setLocationReady(true);
        locationReadyRef.current = true;
        Toast.show({
          type: 'info',
          text1: 'GPS',
          text2: 'Mapa odblokowana — dokładam pozycję w tle.',
        });
      }
      setGpsAcquiring(false);
    };

    (async () => {
      try {
        if (Platform.OS === 'android' && !didColdStartBgDriveRestoreRef.current) {
          try {
            const [state, navFlag, drivingFlag] = await Promise.all([
              BackgroundDriveController.getState(),
              AsyncStorage.getItem(BG_IS_NAVIGATING_KEY),
              AsyncStorage.getItem(BG_IS_DRIVING_KEY),
            ]);
            const bgDriveActive =
              state?.active === true
              || navFlag === 'true'
              || drivingFlag === 'true';
            if (bgDriveActive) {
              deferredToBgDrive = true;
              vroomGpsLog('INIT_GPS_DEFER_BG_DRIVE', {
                stateActive: state?.active === true,
                stateMode: state?.mode ?? null,
                hasLastFix: Boolean(state?.lastFix),
                navFlag,
                drivingFlag,
              }, 0);
              setGpsAcquiring(false);
              return;
            }
          } catch (e) {
            vroomGpsLog('INIT_GPS_DEFER_CHECK_FAIL', {
              message: e instanceof Error ? e.message : String(e),
            }, 0);
          }
        }

        const cached = await loadMapLastLocation();
        if (!cancelled && cached) {
          applyBootstrapLocation(cached.latitude, cached.longitude, {
            approximate: true,
            accuracy: cached.accuracy,
          });
        }

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Toast.show({ type: 'error', text1: 'ODMOWA DOSTĘPU', text2: 'Włącz lokalizację w ustawieniach' });
          unlockMapWithFallback();
          return;
        }

        // Fast-path: if OS has a recent last-known fix, unlock UI immediately.
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({
            maxAge: GPS_LAST_KNOWN_MAX_AGE_MS,
            requiredAccuracy: 100,
          });
          if (lastKnown && !cancelled) {
            const rawLat = lastKnown.coords.latitude;
            const rawLng = lastKnown.coords.longitude;
            if (Number.isFinite(rawLat) && Number.isFinite(rawLng) && !isNullIsland(rawLat, rawLng)) {
              if (acceptFreshFix(lastKnown)) {
                applyInitialFix(lastKnown);
              } else {
                applyInitialFix(lastKnown, true);
              }
            }
          }
        } catch {
          /* continue with standard init flow */
        }

        for (let i = 0; i < 3 && !cancelled; i++) {
          try {
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.High,
              mayShowUserSettingsDialog: i === 0,
            });
            if (acceptFreshFix(loc)) {
              applyInitialFix(loc);
              return;
            }
          } catch {
            /* kolejna próba */
          }
          await sleep(1500);
        }

        if (cancelled) return;

        const watched = await new Promise<Location.LocationObject | null>((resolve) => {
          const timeout = setTimeout(() => {
            watchSub?.remove();
            watchSub = null;
            resolve(null);
          }, 20_000);
          Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: 3000,
              distanceInterval: 5,
            },
            (loc) => {
              if (cancelled || !acceptFreshFix(loc)) return;
              clearTimeout(timeout);
              watchSub?.remove();
              watchSub = null;
              resolve(loc);
            },
          )
            .then((sub) => {
              watchSub = sub;
            })
            .catch(() => {
              clearTimeout(timeout);
              resolve(null);
            });
        });

        if (cancelled) return;
        if (watched && acceptFreshFix(watched)) {
          applyInitialFix(watched);
          return;
        }

        showGpsLocationErrorToast();
        unlockMapWithFallback();
      } catch {
        showGpsLocationErrorToast();
        unlockMapWithFallback();
      }
    })();

    // Hard failsafe: never keep the map on infinite GPS loader.
    initUnlockTimer = setTimeout(() => {
      unlockMapWithFallback();
    }, 12_000);

    return () => {
      cancelled = true;
      if (initUnlockTimer) clearTimeout(initUnlockTimer);
      watchSub?.remove();
    };
  }, []);

  // ─────────────────────────────────────────────────────────
  // DRIVING MODE helpers
  // ─────────────────────────────────────────────────────────

  const resolveFinalTripPose = useCallback((): {
    lat: number;
    lng: number;
    headingDeg: number;
  } | null => {
    const mLat = driveMarker.lat.value;
    const mLng = driveMarker.lng.value;
    if (
      Number.isFinite(mLat)
      && Number.isFinite(mLng)
      && !(Math.abs(mLat) < 1e-6 && Math.abs(mLng) < 1e-6)
    ) {
      const hdg = Number.isFinite(driveMarker.heading.value)
        ? driveMarker.heading.value
        : (lastHeadingRef.current || 0);
      return { lat: mLat, lng: mLng, headingDeg: normalizeHeading(hdg) };
    }
    const tripPose = lastTripMarkerPoseRef.current;
    if (tripPose && Number.isFinite(tripPose.lat) && Number.isFinite(tripPose.lng)) {
      return {
        lat: tripPose.lat,
        lng: tripPose.lng,
        headingDeg: normalizeHeading(lastHeadingRef.current || drHdgRef.current || 0),
      };
    }
    const setLoc = lastSetLocRef.current;
    if (setLoc && Number.isFinite(setLoc.lat) && Number.isFinite(setLoc.lng)) {
      return {
        lat: setLoc.lat,
        lng: setLoc.lng,
        headingDeg: normalizeHeading(lastHeadingRef.current || 0),
      };
    }
    const good = lastGoodLocRef.current;
    if (good && Number.isFinite(good.lat) && Number.isFinite(good.lng)) {
      return {
        lat: good.lat,
        lng: good.lng,
        headingDeg: normalizeHeading(lastHeadingRef.current || 0),
      };
    }
    const cur = currentLocRef.current;
    if (cur && Number.isFinite(cur.latitude) && Number.isFinite(cur.longitude)) {
      return {
        lat: cur.latitude,
        lng: cur.longitude,
        headingDeg: normalizeHeading(lastHeadingRef.current || 0),
      };
    }
    if (
      Number.isFinite(drLatRef.current)
      && Number.isFinite(drLngRef.current)
      && drLatRef.current !== 0
      && drLngRef.current !== 0
    ) {
      return {
        lat: drLatRef.current,
        lng: drLngRef.current,
        headingDeg: normalizeHeading(drHdgRef.current || lastHeadingRef.current || 0),
      };
    }
    return null;
  }, [driveMarker]);

  const exitDrivingMode = useCallback((opts?: {
    skipFlush?: boolean;
    reason?: string;
    skipProfileCredit?: boolean;
    finalStatsOverride?: {
      distanceKm: number;
      maxSpeedKmh: number;
      avgSpeedKmh: number;
      elapsedSec: number;
      trackedPoints: { latitude: number; longitude: number }[];
    };
  }) => {
    const handoffLat = drLatRef.current;
    const handoffLng = drLngRef.current;

    mapMatchCoord.invalidateCoordinatorRequests();
    passiveTripStartedRef.current = false;
    const finalStats = opts?.finalStatsOverride ?? finishTrip();
    tripPeakSpeedRef.current = Math.max(tripPeakSpeedRef.current, finalStats.maxSpeedKmh || 0);
    if (!opts?.skipProfileCredit) {
      profileTotalDistanceKmRef.current += Math.max(
        0,
        Math.max(Number(finalStats.distanceKm || 0), tripCheckpointSavedKmRef.current) - tripCheckpointSavedKmRef.current,
      );
      void deliverGamificationRewards();
    }

    const finalPose = resolveFinalTripPose();
    const hasFinalPose = finalPose != null
      && Number.isFinite(finalPose.lat)
      && Number.isFinite(finalPose.lng)
      && !(Math.abs(finalPose.lat) < 1e-6 && Math.abs(finalPose.lng) < 1e-6);

    const finalLat = hasFinalPose ? finalPose!.lat : 0;
    const finalLng = hasFinalPose ? finalPose!.lng : 0;
    const finalHdg = hasFinalPose ? finalPose!.headingDeg : 0;

    if (hasFinalPose) {
      const loc = { latitude: finalLat, longitude: finalLng };
      setUserLocation(loc);
      publishUserLocation(loc, true);
      lastGoodLocRef.current = { lat: finalLat, lng: finalLng };
      lastSetLocRef.current = { lat: finalLat, lng: finalLng };
      currentLocRef.current = loc;
      lastHeadingRef.current = finalHdg;
      lastTripMarkerPoseRef.current = { lat: finalLat, lng: finalLng };
      rememberMapLastLocation(finalLat, finalLng, 10);
    }

    isDrivingRef.current        = false;
    drivingSinceRef.current     = 0;
    drivingLastLocRef.current   = null;
    lastDrivingPosRef.current   = null;
    lastRawForHeadingRef.current = null;
    tripHeadingFilterRef.current?.reset();
    tripHeadingFilterRef.current = null;
    driveSessionGuardRef.current.reset();
    lastGoodTimeRef.current = Date.now();
    lastAcceptedFixWallClockRef.current = Date.now();

    if (hasFinalPose) {
      navV3.hardReset(finalLat, finalLng, finalHdg);
      driveMarker.reset({ lat: finalLat, lng: finalLng, headingDeg: finalHdg });
      if (
        Number.isFinite(finalLat)
        && Number.isFinite(finalLng)
        && !(Math.abs(finalLat) < 1e-6 && Math.abs(finalLng) < 1e-6)
      ) {
        // Natywna kamera
        cameraV3.recenter(
          { latitude: finalLat, longitude: finalLng },
          { heading: finalHdg, speedKmh: speedKmhRef.current, animate: true },
        );
      }
    } else {
      navV3.hardReset(0, 0, 0);
      driveMarker.reset();
      lastTripMarkerPoseRef.current = null;
    }

    resetMapMatch();
    drivingNoSnapStreakRef.current = 0;
    lastSnapSuccessAtRef.current = 0;
    lastWorkletFeedAnchorRef.current = null;
    subAnchorTimersRef.current.forEach((t) => clearTimeout(t));
    subAnchorTimersRef.current = [];
    lastDrivingNoSnapForceRef.current = 0;
    mapMatchCoord.resetCoordinator();
    resetClientFirstState();
    applyRoadMatchPoints([]);
    drivingSnapGeometryRef.current = [];
    drivingSnapUsesMatchedRef.current = false;
    localRoadGeometryMirror.clear();
    drivingManualModeRef.current = false;
    if (Number.isFinite(handoffLat) && Number.isFinite(handoffLng) && handoffLat !== 0) {
      setUserLocation(prev => (
        prev ? { ...prev, latitude: handoffLat, longitude: handoffLng } : null
      ));
      lastSetLocRef.current = { lat: handoffLat, lng: handoffLng };
      lastGoodLocRef.current = { lat: handoffLat, lng: handoffLng };
      currentLocRef.current = {
        latitude: handoffLat,
        longitude: handoffLng,
        accuracy: 10,
        timestamp: Date.now(),
      };
      rememberMapLastLocation(handoffLat, handoffLng, 10);
    }
    resetDRRefs();
    setIsDriving(false);
    tripCheckpointActiveRef.current = false;
    if (!opts?.skipFlush) {
      // Persist driving sessions with full fg+bg merge (same strategy as navigation),
      // so top speed and km don't get lost when provider reports sparse/zero speed.
      void (async () => {
        try {
          await finalizeTripSession({
            reason: 'manual',
            mode: 'freeDrive',
            distanceKm: Math.max(
              0,
              Number(finalStats.distanceKm || 0),
              Number(liveDistanceKmRef.current || 0),
              Number(tripCheckpointSavedKmRef.current || 0),
            ),
            maxSpeedKmh: Math.max(tripPeakSpeedRef.current, finalStats.maxSpeedKmh || 0),
            avgSpeedKmh: finalStats.avgSpeedKmh,
            durationSec: finalStats.elapsedSec,
            routePoints: finalStats.trackedPoints,
          }, { deferFlush: true });
        } catch (error) {
          console.warn('[DrivingMode] Trip finalization deferred', error);
        }
        await setDrivingFlag(false);
        await flushTripSessionFinalizationOutbox();
      })();
      if (DRIVE_TEST_DIAGNOSTICS) {
        console.log('[RUNDIAG] DRIVING_FLUSH', JSON.stringify({
          at: Date.now(),
          reason: 'manual_exit',
          distanceKm: Number(finalStats.distanceKm.toFixed(3)),
          maxSpeedKmh: Math.max(tripPeakSpeedRef.current, finalStats.maxSpeedKmh || 0),
          avgSpeedKmh: finalStats.avgSpeedKmh,
          elapsedSec: finalStats.elapsedSec,
          routePoints: finalStats.trackedPoints.length,
          mapboxNetwork: getMapboxNetworkMetrics(),
          mapMatchCoordinator: mapMatchCoord.getCoordinatorMetrics(),
        }));
      }
    }
    tripMoveSamplesRef.current = [];
    speedKmhRef.current = 0;
    setSpeed(null);
    clearStats({ preserveEmergency: true });
    tripPeakSpeedRef.current = 0;
    resetSpeedometerEmitterThrottle();
    emitSpeedometerKmh(0);
    tripMarkerV2BootstrappedRef.current = false;
    resetTravelHeadingState();
    drivingEntryAnchorRef.current = null;
    drivingEntryGraceUntilRef.current = 0;
    freeDriveSnapDriftSinceRef.current = null;
    lastBranchResnapAtRef.current = 0;
    driveSessionFirstGpsFrameRef.current = true;
    driveSessionInitFramesRef.current = 0;
    navDriveTraceSession('driving_end', {
      reason: opts?.reason ?? 'unspecified',
      skipFlush: !!opts?.skipFlush,
    });
    console.log('[DrivingMode] Exited driving mode', JSON.stringify({
      reason: opts?.reason ?? 'unspecified',
      skipFlush: !!opts?.skipFlush,
    }));
  }, [resetDRRefs, resetMapMatch, applyRoadMatchPoints, finalizeTripSession, clearStats, finishTrip, deliverGamificationRewards, mapMatchCoord, navV3, driveMarker, resolveFinalTripPose, publishUserLocation]);

  const exportNavDriveTrace = useCallback(() => {
    void shareNavTraceLog();
  }, []);

  // Ręczny przełącznik trybu jazdy (przycisk w UI) — wejście natychmiastowe,
  // dopasowanie drogi dogrywane asynchronicznie w tle (bez "poczekaj").
  const handleToggleDrivingMode = useCallback(async () => {
    const nowToggle = Date.now();
    if (nowToggle - lastDrivingToggleAtRef.current < DRIVING_TOGGLE_GUARD_MS) {
      if (__DEV__) console.log('[DrivingMode] toggle_guard_blocked', JSON.stringify({ at: nowToggle }));
      return;
    }
    lastDrivingToggleAtRef.current = nowToggle;
    if (isNavigating) return;
    const drivingActive = isDrivingRef.current || isDriving;
    if (drivingActive) {
      drivingManuallyDisabledRef.current = true;
      drivingManualDisabledAtRef.current = Date.now();
      kmSinceManualOffRef.current = 0;
      drivingManualModeRef.current = false;
      pendingDrivingEntryOneShotRef.current = false;
      // Zawsze zwalnij busy przy wyjściu — inaczej szybkie OFF→ON może zostawić blokadę i „nic się nie dzieje”.
      drivingManualEntryBusyRef.current = false;
      isDrivingRef.current = false;
      setIsDriving(false);
      exitDrivingMode({ reason: 'manual_toggle_off' });
      setFollowMode('idleBrowse');
    } else {
      let nativeSeedFix: BackgroundDriveFix | null = null;
      if (!currentLocRef.current && !userLocation && !lastGoodLocRef.current && !lastSetLocRef.current) {
        try {
          const [nativeState, nativeBuffered] = await Promise.all([
            BackgroundDriveController.getState(),
            BackgroundDriveController.consumeBufferedLocations(),
          ]);
          const nativeFixes = [
            ...(Array.isArray(nativeBuffered) ? nativeBuffered : []),
            ...(nativeState?.lastFix ? [nativeState.lastFix] : []),
          ].filter((fix) => (
            Number.isFinite(fix?.latitude)
            && Number.isFinite(fix?.longitude)
            && !isNullIsland(Number(fix.latitude), Number(fix.longitude))
          ));
          nativeSeedFix = nativeFixes[nativeFixes.length - 1] ?? null;
        } catch {
          nativeSeedFix = null;
        }
      }
      const nativeSeedLocation = nativeSeedFix
        ? {
            latitude: Number(nativeSeedFix.latitude),
            longitude: Number(nativeSeedFix.longitude),
          }
        : null;
      if (
        !currentLocRef.current
        && !lastGoodLocRef.current
        && !lastSetLocRef.current
        && !nativeSeedLocation
        && (!userLocation || !Number.isFinite(userLocation.latitude) || !Number.isFinite(userLocation.longitude))
      ) {
        Toast.show({ type: 'error', text1: 'GPS', text2: 'Poczekaj na fix lokalizacji zanim włączysz jazdę.' });
        return;
      }
      drivingManualEntryBusyRef.current = true;
      const entryPose = resolveBestKnownPose({
        drLat: drLatRef.current,
        drLng: drLngRef.current,
        drHdg: drHdgRef.current,
        tripActive: false,
        lastSetLoc: lastSetLocRef.current,
        lastGoodLoc: lastGoodLocRef.current,
        userLocation: currentLocRef.current ?? userLocation ?? nativeSeedLocation,
        headingFallback: nativeSeedFix?.heading != null && Number.isFinite(Number(nativeSeedFix.heading))
          ? Number(nativeSeedFix.heading)
          : lastHeadingRef.current,
      });
      if (!entryPose) {
        drivingManualEntryBusyRef.current = false;
        Toast.show({ type: 'error', text1: 'GPS', text2: 'Poczekaj na fix lokalizacji zanim włączysz jazdę.' });
        return;
      }
      const startLat = entryPose.latitude;
      const startLng = entryPose.longitude;
      const stationaryEntry = speedKmhRef.current < DRIVING_ENTRY_STATIONARY_KMH;

      drivingManuallyDisabledRef.current = false;
      drivingManualModeRef.current = true;
      driveSessionGuardRef.current.reset();
      tripResumeFreezeUntilRef.current = 0;
      tripResumeAnchorRef.current = null;
      tripResumeConfirmRef.current = null;
      drivingNoSnapStreakRef.current = 0;
      lastDrivingNoSnapForceRef.current = 0;

      const previewPts = routePointsRef.current;
      let instantRoad = getMatchedPoints();

      if (instantRoad && instantRoad.length >= 2) {
        applyRoadMatchPoints(instantRoad, { skipResync: true });
        bumpMatchedFreshness();
      }
      // Nie seeduj snapu trasą podglądu — w free drive to równoległy offset od realnej drogi.

      let entryLat = startLat;
      let entryLng = startLng;
      let entryHeading = Number.isFinite(entryPose.headingDeg)
        ? entryPose.headingDeg
        : (Number.isFinite(lastHeadingRef.current) ? lastHeadingRef.current : 0);
      drivingEntryGraceUntilRef.current = Date.now() + DRIVING_ENTRY_GRACE_MS;

      const entryGeom = drivingSnapGeometryRef.current;
      if (entryGeom.length >= 2) {
        const snapped = snapToRoute(startLat, startLng, entryGeom, DRIVING_ENTRY_MAX_SNAP_M);
        const snapDistM = haversineKm(startLat, startLng, snapped.latitude, snapped.longitude) * 1000;
        const maxSnapM = stationaryEntry
          ? DRIVING_ENTRY_INITIAL_SNAP_M
          : DRIVING_ENTRY_MAX_SNAP_M;
        if (snapDistM <= maxSnapM) {
          entryLat = snapped.latitude;
          entryLng = snapped.longitude;
          if (Number.isFinite(snapped.targetHeading)) {
            const refHdg = lastGpsDeviceHeadingRef.current
              ?? (Number.isFinite(lastHeadingRef.current) ? lastHeadingRef.current : entryHeading);
            entryHeading = alignBearingToReference(snapped.targetHeading, refHdg);
          }
        }
      }

      drivingEntryAnchorRef.current = { lat: entryLat, lng: entryLng };

      vroomGpsLog('ENTRY_SNAP', {
        cachedRoadPts: instantRoad?.length ?? 0,
        previewPts: previewPts.length,
        localSnapped: true,
        stationaryEntry,
        entryLat: Number(entryLat.toFixed(5)),
        entryLng: Number(entryLng.toFixed(5)),
      });

      isDrivingRef.current = true;
      tripCheckpointActiveRef.current = true;
      await startDriveSession('freeDrive');
      setTripCameraActive(true);
      drivingSinceRef.current = Date.now();
      drivingEntryJustStartedRef.current = true;
      drivingEntryHeadingRef.current = entryHeading;
      setTimeout(() => {
        drivingEntryJustStartedRef.current = false;
      }, 800);
      tripSpeedWarmupUntilRef.current = Date.now() + 10_000;
      drivingConsecutiveRef.current = DRIVING_CONSECUTIVE_REQ;
      setIsDriving(true);
      startTrip(routeDurationMinutesToSeconds(routeInfoRef.current?.duration));
      drivingLastLocRef.current = null;
      lastDrivingPosRef.current = { lat: entryLat, lng: entryLng };
      if (!stationaryEntry) {
        navLatFilter.reset();
        navLngFilter.reset();
        drivLatFilter.reset();
        drivLngFilter.reset();
      }

      resetTravelHeadingState(startLat, startLng, entryHeading);
      getTripHeadingFilter().reset(entryHeading);
      tripMarkerV2BootstrappedRef.current = true;
      lastTripMarkerPoseRef.current = { lat: entryLat, lng: entryLng };
      driveSessionFirstGpsFrameRef.current = true;
      driveSessionInitFramesRef.current = 0;
      lastMovingFeedSpeedMsRef.current = 0;
      lastMovingAtRef.current = 0;
      coastingSpeedRef.current = 0;
      tripBootstrapPose(entryLat, entryLng, entryHeading, { animateCamera: true });
      cameraV3.setUserExploring(false);
      cameraV3.armTripFollow(entryHeading);
      if (!gpsForceActiveRef.current) {
        gpsForceActiveRef.current = true;
        applyGpsForceActive(true);
      }
      startGPS();
      navDriveTraceSession('driving_start', {
        lat: Number(entryLat.toFixed(6)),
        lng: Number(entryLng.toFixed(6)),
        stationaryEntry,
      });
      speedKmhRef.current = normalizeHudSpeedKmh(speedKmhRef.current);
      if (stationaryEntry) {
        emitSpeedometerKmh(0);
      }
      pendingDrivingEntryOneShotRef.current = false;
      const displayEntryLat = entryLat;
      const displayEntryLng = entryLng;
      drLatRef.current = displayEntryLat;
      drLngRef.current = displayEntryLng;
      lastSetLocRef.current = { lat: displayEntryLat, lng: displayEntryLng };
      drivingMarkerStallRef.current = {
        rawLat: startLat,
        rawLng: startLng,
        drLat: displayEntryLat,
        drLng: displayEntryLng,
        at: Date.now(),
      };
      setUserLocation({ latitude: displayEntryLat, longitude: displayEntryLng });
      lastGoodLocRef.current = { lat: entryLat, lng: entryLng };
      lastAcceptedFixWallClockRef.current = Date.now();
      setFollowMode('drivingFollow');
      recordDrivingTracePoint(entryLat, entryLng, { speedKmh: speedKmhRef.current }).catch(() => {});
      drivingManualEntryBusyRef.current = false;

      if (!instantRoad || instantRoad.length < 2) {
        void getLocalSnapTarget(startLat, startLng).then((hit) => {
          if (!isDrivingRef.current || isNavigatingRef.current) return;
          if (!hit || hit.polylinePoints.length < 2) return;
          applyRoadMatchPoints(hit.polylinePoints, { skipResync: true });
          bumpMatchedFreshness();
          resyncSnapAfterRoadGeometry(startLat, startLng, speedKmhRef.current, null);
        });

        void (async () => {
          try {
            const sqliteHit = await Promise.race([
              roadGeometryStore.findNearest(
                startLat,
                startLng,
                DRIVING_ENTRY_SQLITE_RADIUS_M,
              ),
              new Promise<Awaited<ReturnType<typeof roadGeometryStore.findNearest>>>((resolve) => {
                setTimeout(() => resolve(null), 800);
              }),
            ]);
            if (!isDrivingRef.current || isNavigatingRef.current) return;
            if (sqliteHit?.points && sqliteHit.points.length >= 2) {
              const nearStartM = haversineKm(
                startLat,
                startLng,
                sqliteHit.points[0].latitude,
                sqliteHit.points[0].longitude,
              ) * 1000;
              if (nearStartM <= 55) {
                applyRoadMatchPoints(sqliteHit.points, { skipResync: true });
                bumpMatchedFreshness();
                resyncSnapAfterRoadGeometry(startLat, startLng, speedKmhRef.current, null);
              }
            }
          } catch {
            /* background sqlite optional */
          }
        })();

        const entryReqId = mapMatchCoord.allocRequestId();
        void (async () => {
          try {
            const apiRoad = await mapMatchCoord.requestRecovery({
              reason: 'MANUAL',
              lat: startLat,
              lng: startLng,
              speedKmh: speedKmhRef.current,
              forceImmediate: true,
            });
            if (mapMatchCoord.isStaleRequest(entryReqId)) return;
            if (!apiRoad || apiRoad.length < 2) return;
            applyRoadMatchPoints(apiRoad, { skipResync: true });
            bumpMatchedFreshness();
            resyncSnapAfterRoadGeometry(startLat, startLng, speedKmhRef.current, null);
            if (!isDrivingRef.current || isNavigatingRef.current) return;
            if (Date.now() < drivingEntryGraceUntilRef.current) return;
            // Async snap refinement handled by navV3 on next GPS tick.
          } catch {
            /* background entry match optional */
          }
        })();
      } else if (instantRoad && instantRoad.length >= 2) {
        resyncSnapAfterRoadGeometry(startLat, startLng, speedKmhRef.current, null);
      }

      console.log('[DrivingMode] Manually entered — snap-first entry');
    }
  }, [isNavigating, isDriving, userLocation, exitDrivingMode, setFollowMode, recenterTo, getMatchedPoints, bumpMatchedFreshness, mapMatchCoord, startTrip, recordDrivingTracePoint, applyRoadMatchPoints, resyncSnapAfterRoadGeometry, tripBootstrapPose, touchProgrammaticCameraApply, setTripCameraActive, cameraV3, getLocalSnapTarget]);

  // ─────────────────────────────────────────────────────────
  // Adaptive GPS
  // ─────────────────────────────────────────────────────────
  const [gpsForceActive, setGpsForceActive] = useState(false);
  const applyGpsForceActive = useCallback((active: boolean) => {
    if (gpsForceActiveRef.current === active) return;
    gpsForceActiveRef.current = active;
    setGpsForceActive(active);
  }, []);

  const { start: startGPS, stop: stopGPS, hardRestart: hardRestartGPS, seedLockFromResume: seedGpsLockFromResume } = useDriveLocationWatch({
    isNavigating,
    isDriving,
    isMapFocused,
    speedKmh: speedKmhRef.current,
    forceActive: gpsForceActive,
    onGpsLockChange: useCallback((locked: boolean) => {
      gpsLockEstablishedRef.current = locked;
      if (isDrivingRef.current || isNavigatingRef.current) {
        setGpsAcquiring(!locked);
      }
    }, []),
    onLocation: useCallback((loc) => {
      // During trip startup keep the cached/seed pose stable until the active
      // navigation watcher confirms GPS lock. This removes the first-fix
      // left/right/backward oscillation without delaying the map itself.
      gpsResumeSoftHoldSkipRef.current = false;
      gpsTickCountRef.current += 1;
      const tickNow = Date.now();
      if (lastGpsTickAtRef.current > 0) {
        const cadence = tickNow - lastGpsTickAtRef.current;
        if (cadence >= 200 && cadence <= 5000) {
          // EMA smoothing 0.35 — szybko reaguje na zmiany freq,
          // ale ignoruje pojedyncze opoznienia/sleepy.
          let targetCadence = cadence;
          if (speedKmhRef.current >= 70) {
            targetCadence = Math.min(cadence, 450);
          }
          gpsCadenceMsRef.current = Math.round(gpsCadenceMsRef.current * 0.65 + targetCadence * 0.35);
        }
      }
      lastExpoSeenAtRef.current = tickNow;
      const rawLat0 = loc.latitude;
      const rawLng0 = loc.longitude;
      let rawLat = rawLat0;
      let rawLng = rawLng0;
      const acc    = loc.accuracy ?? 10;
      lastGpsAccuracyRef.current = Number.isFinite(acc) ? acc : null;
      const now    = Date.now();
      const speedKmhRaw = driveSessionGuardRef.current.resolveSpeedKmh(
        loc.speed,
        speedKmhRef.current,
        now,
      );
      if (loc.heading != null && loc.heading >= 0 && Number.isFinite(loc.heading)) {
        lastGpsDeviceHeadingRef.current = loc.heading;
      }
      if (!Number.isFinite(rawLat0) || !Number.isFinite(rawLng0) || !Number.isFinite(acc)) return;
      const tripActiveEarly = isDrivingRef.current || isNavigatingRef.current;
      const expoResumeFix = {
        latitude: rawLat0,
        longitude: rawLng0,
        timestamp: loc.timestamp ?? now,
        speed: loc.speed,
        accuracy: acc,
        source: 'live' as const,
      };
      if (tripActiveEarly) {
        vroomGpsLog('RESUME_EXPO_SEEN', {
          recoveryActive: resumeRecoveryRef.current.active,
          phase: resumeRecoveryRef.current.phase,
          gpsLock: gpsLockEstablishedRef.current,
          accM: Math.round(acc),
          ageMs: Math.round(now - Number(loc.timestamp ?? now)),
          speedMs: Number.isFinite(Number(loc.speed)) ? Number(loc.speed).toFixed(2) : null,
        }, 500);
      }
      if (tripActiveEarly && resumeRecoveryRef.current.active) {
        markResumeSourceSeen(resumeRecoveryRef.current, 'expo', now);
      }
      if (
        tripActiveEarly
        && !gpsLockEstablishedRef.current
      ) {
        if (canBypassGpsLockDuringResume(expoResumeFix, resumeRecoveryRef.current, { now })) {
          seedGpsLockFromResume();
          gpsLockEstablishedRef.current = true;
          setGpsAcquiring(false);
          vroomGpsLog('RESUME_EXPO_LOCK_BYPASS', {
            phase: resumeRecoveryRef.current.phase,
            accM: Math.round(acc),
            ageMs: Math.round(now - Number(loc.timestamp ?? now)),
          }, 0);
        } else {
          vroomGpsLog('RESUME_EXPO_LOCK_BLOCK', {
            recoveryActive: resumeRecoveryRef.current.active,
            phase: resumeRecoveryRef.current.phase,
            accM: Math.round(acc),
            ageMs: Math.round(now - Number(loc.timestamp ?? now)),
            fixFreshness: classifyFixFreshness(expoResumeFix, now),
          }, 0);
          return;
        }
      }
      if (
        tripActiveEarly
        && resumeRecoveryRef.current.active
        && !shouldAcceptResumeSource(resumeRecoveryRef.current, 'expo', now, {
          nativeFreshMs: lastNativeDrivePipelineAtRef.current > 0
            ? now - lastNativeDrivePipelineAtRef.current
            : Number.POSITIVE_INFINITY,
          expoFreshMs: lastExpoGpsTickAtRef.current > 0
            ? now - lastExpoGpsTickAtRef.current
            : Number.POSITIVE_INFINITY,
        })
      ) {
        vroomGpsLog('RESUME_EXPO_SOURCE_BLOCK', {
          phase: resumeRecoveryRef.current.phase,
          lastNativeAcceptedMs: resumeRecoveryRef.current.lastNativeAcceptedAt > 0
            ? Math.round(now - resumeRecoveryRef.current.lastNativeAcceptedAt)
            : null,
          lastExpoAcceptedMs: resumeRecoveryRef.current.lastExpoAcceptedAt > 0
            ? Math.round(now - resumeRecoveryRef.current.lastExpoAcceptedAt)
            : null,
        }, 0);
        return;
      }
      markResumeSourceAccepted(resumeRecoveryRef.current, 'expo', now);
      lastGpsTickAtRef.current = tickNow;
      lastExpoGpsTickAtRef.current = tickNow;
      if (tripActiveEarly && resumeRecoveryRef.current.active) {
        vroomGpsLog('RESUME_EXPO_ACCEPT', {
          phase: resumeRecoveryRef.current.phase,
          accM: Math.round(acc),
          lat: Number(rawLat0.toFixed(6)),
          lng: Number(rawLng0.toFixed(6)),
        }, 0);
      }
      const prevRaw = lastRawTickRef.current;
      const resumeExpoSpeed = tripActiveEarly && resumeRecoveryRef.current.active
        ? resolveResumeSpeedKmh(
            expoResumeFix,
            prevRaw,
            resumeRecoveryRef.current,
            {
              now,
              previousReliableKmh: Math.max(speedKmhRef.current, rawGpsKmhRef.current),
            },
          )
        : null;
      if (prevRaw) {
        const dtMs = now - prevRaw.at;
        const movedM = haversineKm(prevRaw.lat, prevRaw.lng, rawLat0, rawLng0) * 1000;
        const hardJumpM = Math.max(
          1800,
          ((Math.max(speedKmhRef.current, 15) / 3.6) * (Math.max(dtMs, 1000) / 1000)) * 10,
        );
        if (movedM > hardJumpM) {
          if (tripActiveEarly && true) {
            vroomGpsLog('GPS_HARD_JUMP_CLAMP', {
              movedM: Math.round(movedM),
              hardJumpM: Math.round(hardJumpM),
            }, 2000);
            const maxStep = maxPlausibleDrivingStepM(
              speedKmhRaw > 0 ? speedKmhRaw / 3.6 : speedKmhRef.current / 3.6,
              Math.max(speedKmhRef.current, speedKmhRaw),
            );
            const ratio = Math.min(1, maxStep / movedM);
            rawLat = prevRaw.lat + (rawLat0 - prevRaw.lat) * ratio;
            rawLng = prevRaw.lng + (rawLng0 - prevRaw.lng) * ratio;
            if (speedKmhRaw >= 1) {
              speedKmhRef.current = normalizeHudSpeedKmh(speedKmhRaw);
              emitSpeedometerKmh(speedKmhRef.current);
            }
            driveTraceReject('hard_jump_clamp', {
              movedM: Math.round(movedM),
              hardJumpM: Math.round(hardJumpM),
              rawLat: Number(rawLat0.toFixed(6)),
              rawLng: Number(rawLng0.toFixed(6)),
              clampLat: Number(rawLat.toFixed(6)),
              clampLng: Number(rawLng.toFixed(6)),
            });
          } else {
            driveTraceReject('hard_jump_reject', {
              movedM: Math.round(movedM),
              hardJumpM: Math.round(hardJumpM),
            });
          }
        }
      }
      lastRawTickRef.current = { lat: rawLat0, lng: rawLng0, at: now, acc };

      const gpsTickId = beginGpsTick({
        lat: rawLat0,
        lng: rawLng0,
        osTimestamp: loc.timestamp ?? null,
      });
      logGpsTickLayer('RAW_GPS_TICK', {
        gpsTickId,
        lat: Number(rawLat0.toFixed(6)),
        lng: Number(rawLng0.toFixed(6)),
        speed: loc.speed != null && loc.speed >= 0 ? Number(loc.speed.toFixed(2)) : null,
        speedKmh: Number(speedKmhRaw.toFixed(1)),
        accuracy: Number.isFinite(acc) ? Math.round(acc) : null,
        osTimestamp: loc.timestamp ?? null,
        tripActive: isDrivingRef.current || isNavigatingRef.current,
        appState: appStateRef.current,
      });
      if (tripActiveEarly) {
        driveTraceRaw({
          lat: rawLat,
          lng: rawLng,
          acc,
          speedKmh: speedKmhRaw,
          speedMs: loc.speed != null && loc.speed >= 0 ? loc.speed : null,
          heading: loc.heading != null && Number.isFinite(loc.heading) ? loc.heading : null,
          tripActive: true,
          driving: isDrivingRef.current,
          navigating: isNavigatingRef.current,
          osTimestamp: loc.timestamp ?? null,
        });
      }

      const rollbackGoodLoc = lastGoodLocRef.current
        ? { ...lastGoodLocRef.current }
        : null;
      const rollbackGoodTime = lastGoodTimeRef.current;
      const rollbackAcceptedWallClock = lastAcceptedFixWallClockRef.current;
      const rollbackIdleAnchor = () => {
        if (rollbackGoodLoc) lastGoodLocRef.current = rollbackGoodLoc;
        lastGoodTimeRef.current = rollbackGoodTime;
        lastAcceptedFixWallClockRef.current = rollbackAcceptedWallClock;
      };

      const tripActiveNow = isDrivingRef.current || isNavigatingRef.current;

      if (tripActiveNow) {
        if (isDrivingRef.current && !isNavigatingRef.current) {
          syncDrivingRoadGeometry(rawLat, rawLng, speedKmhRaw, acc);
        }
        const out = navV3.processGpsFix({
          latitude: rawLat,
          longitude: rawLng,
          accuracy: acc,
          timestamp: loc.timestamp ?? now,
          speed: resumeExpoSpeed?.speedMs ?? loc.speed,
          heading: loc.heading,
        });
        if (!out || out.rejected) {
          const staleAnchor =
            lastTripMarkerPoseRef.current
            ?? lastSetLocRef.current
            ?? (
              Number.isFinite(drLatRef.current)
              && Number.isFinite(drLngRef.current)
              && drLatRef.current !== 0
              && drLngRef.current !== 0
                ? { lat: drLatRef.current, lng: drLngRef.current }
                : null
            );
          const staleAnchorDistM = staleAnchor
            ? haversineKm(staleAnchor.lat, staleAnchor.lng, rawLat0, rawLng0) * 1000
            : 0;
          const canRecoverStaleAnchor =
            isDrivingRef.current
            && !isNavigatingRef.current
            && staleAnchor
            && staleAnchorDistM >= 250
            && speedKmhRaw >= 8
            && acc <= 80
            && now - lastTripStaleAnchorRecoveryAtRef.current >= 2500;
          if (canRecoverStaleAnchor) {
            lastTripStaleAnchorRecoveryAtRef.current = now;
            const recoveryHeading =
              loc.heading != null && Number.isFinite(loc.heading) && loc.heading >= 0
                ? normalizeHeading(loc.heading)
                : (
                    prevRaw
                      ? bearingBetween(prevRaw.lat, prevRaw.lng, rawLat0, rawLng0)
                      : normalizeHeading(lastHeadingRef.current || drHdgRef.current || 0)
                  );
            latFilter.reset();
            lngFilter.reset();
            navLatFilter.reset();
            navLngFilter.reset();
            drivLatFilter.reset();
            drivLngFilter.reset();
            driveSessionGuardRef.current.reset();
            tripResumeFreezeUntilRef.current = 0;
            tripResumeAnchorRef.current = null;
            tripResumeConfirmRef.current = null;
            tripResumeMotionWakeHitsRef.current = 0;
            lastGoodLocRef.current = { lat: rawLat0, lng: rawLng0 };
            lastSetLocRef.current = { lat: rawLat0, lng: rawLng0 };
            lastTripMarkerPoseRef.current = { lat: rawLat0, lng: rawLng0 };
            lastDrivingPosRef.current = { lat: rawLat0, lng: rawLng0 };
            drLatRef.current = rawLat0;
            drLngRef.current = rawLng0;
            drHdgRef.current = recoveryHeading;
            lastHeadingRef.current = recoveryHeading;
            speedKmhRef.current = normalizeHudSpeedKmh(speedKmhRaw);
            rawGpsKmhRef.current = speedKmhRef.current;
            emitSpeedometerKmh(speedKmhRef.current);
            publishUserLocation({ latitude: rawLat0, longitude: rawLng0 }, true);
            navV3.hardReset(rawLat0, rawLng0, recoveryHeading, 'stale_anchor_recovery');
            tripBootstrapPose(rawLat0, rawLng0, recoveryHeading, { animateCamera: false });
            driveMarker.ensureFrameActive?.();
            vroomGpsLog('TRIP_STALE_ANCHOR_RECOVERY', {
              anchorDistM: Math.round(staleAnchorDistM),
              speedKmh: Math.round(speedKmhRaw),
              rejectReason: out?.rejectReason ?? null,
              lat: Number(rawLat0.toFixed(6)),
              lng: Number(rawLng0.toFixed(6)),
            }, 0);
          } else {
            vroomGpsLog('TRIP_NAVV3_REJECT', {
              rejectReason: out?.rejectReason ?? null,
              anchorDistM: Math.round(staleAnchorDistM),
              speedKmh: Math.round(speedKmhRaw),
              accM: Math.round(acc),
            }, 1000);
          }
        }
        if (out && !out.rejected) {
          lastGoodLocRef.current = { lat: rawLat, lng: rawLng };
          lastGoodTimeRef.current = now;
        }
        lastRawForHeadingRef.current = { lat: rawLat, lng: rawLng };
        lastAcceptedFixWallClockRef.current = now;
        if (isDrivingRef.current || isNavigatingRef.current) {
          updateSpeedLimitRef.current(rawLat, rawLng, { nav: true, heading: lastHeadingRef.current });
        }
        return;
      }

      let drivingJumpClampActive = false;
      const motionPrev = lastGoodLocRef.current ?? lastSetLocRef.current;
      const motionDtMs = motionPrev ? now - lastGoodTimeRef.current : 0;
      const derivedKmhRaw =
        motionPrev && motionDtMs >= 100
          ? (haversineKm(motionPrev.lat, motionPrev.lng, rawLat0, rawLng0) / (motionDtMs / 1000)) * 3600
          : 0;
      // SANITY CAP: motionKmh osiągało 168 000 km/h po skokach GPS, psując
      // SPEED_PIPE, snap-stale detection (sustainedKmh=51536), hold logic.
      // Realistyczny maks: 200 km/h driving / 250 km/h nawigacja. Wszystko
      // powyżej to artefakt skoku pozycji o setki/tysiące metrów.
      const motionCapKmh = isNavigatingRef.current
        ? MAX_REALISTIC_NAV_KMH
        : MAX_REALISTIC_DRIVING_KMH;
      const motionDtSec = motionDtMs > 0 ? motionDtMs / 1000 : 0;
      const prevMotionKmh = lastValidMotionKmhRef.current;
      const isAnomalousMotionJump =
        motionPrev != null
        && motionDtMs >= 100
        && motionDtSec > 0.05
        && Number.isFinite(derivedKmhRaw)
        && derivedKmhRaw > 50
        && Math.abs(derivedKmhRaw - prevMotionKmh) / motionDtSec > 25;
      const derivedKmhEarly = Number.isFinite(derivedKmhRaw) && !isAnomalousMotionJump
        ? Math.min(derivedKmhRaw, motionCapKmh)
        : Math.min(prevMotionKmh, motionCapKmh);
      let motionKmh = Math.min(
        motionCapKmh,
        Math.max(
          Math.min(speedKmhRaw, motionCapKmh),
          Number.isFinite(derivedKmhEarly) ? derivedKmhEarly : 0,
        ),
      );
      if (!isAnomalousMotionJump && motionKmh > 0) {
        lastValidMotionKmhRef.current = motionKmh;
      }
      if (
        !tripActiveNow
        && isMapFocusedRef.current
        && motionKmh >= 6
        && !gpsForceActiveRef.current
      ) {
        gpsForceActiveRef.current = true;
        applyGpsForceActive(true);
      }
      const drivingLowSpeedJumpCapM = (kmh: number, accuracyM: number) => {
        if (kmh >= 12) return Infinity;
        if (kmh < 3) return Math.max(12, Math.min(26, accuracyM * 0.45 + 8));
        return Math.max(18, Math.min(40, accuracyM * 0.65 + 10));
      };
      const activeClampStepM = (() => {
        if (isDrivingRef.current) {
          if (speedKmhRaw < 3) return 6;
          if (speedKmhRaw < 10) return 12;
          if (speedKmhRaw < 28) return 22;
          return 34;
        }
        if (isNavigatingRef.current) return 26;
        return GPS_ACTIVE_SOFT_REBASE_MAX_STEP_M;
      })();

      const inTripResumeFreezeEarly =
        tripResumeFreezeUntilRef.current > now && !!tripResumeAnchorRef.current;
      const bgPauseMsEarly = lastBackgroundAtRef.current > 0
        ? now - lastBackgroundAtRef.current
        : 0;
      if (true && tripActiveNow) {
        if (tripForegroundRefreshUntilRef.current > now) {
          tripResumeFreezeUntilRef.current = 0;
          tripResumeAnchorRef.current = null;
          tripResumeConfirmRef.current = null;
        }
      }
      if (
        true
        && inTripResumeFreezeEarly
        && bgPauseMsEarly >= 12_000
        && (speedKmhRaw >= 8 || motionKmh >= 8)
      ) {
        tripResumeFreezeUntilRef.current = 0;
        tripResumeAnchorRef.current = null;
        tripResumeConfirmRef.current = null;
      }
      if (
        inTripResumeFreezeEarly
        && !(true && tripActiveNow)
        && tripResumeFreezeUntilRef.current > now
        && tripActiveNow
        && tripResumeAnchorRef.current
      ) {
        const anchor = tripResumeAnchorRef.current;
        const jumpM = haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000;
        const resumeMotionWake =
          speedKmhRaw >= 4
          || motionKmh >= 4
          || rawGpsKmhRef.current >= 4;
        // INSTANT RELEASE: ewidentna jazda (>12 km/h z dowolnego źródła) lub
        // ruch raw >25 m od anchora — wybudź natychmiast bez hits.
        const resumeJumpGate = isTripResumeJumpAcceptable(jumpM, bgPauseMsEarly);
        const resumeInstantRelease =
          resumeJumpGate.ok
          && (
            speedKmhRaw >= 8
            || motionKmh >= 8
            || rawGpsKmhRef.current >= 8
            || (jumpM >= 15 && (speedKmhRaw >= 6 || motionKmh >= 6))
            || (jumpM >= 25 && resumeJumpGate.allowMegaTeleport)
          );
        // INSTANT RELEASE — wyjdź z całego freeze pipeline bez cluster confirm.
        let resumeFreezeInstantlyReleased = false;
        if (!resumeJumpGate.ok) {
          markerLogCritical('RESUME_REJECT_TELEPORT', {
            jumpM: Math.round(jumpM),
            bgPauseMs: Math.round(bgPauseMsEarly),
            lat: Number(rawLat.toFixed(5)),
            lng: Number(rawLng.toFixed(5)),
          });
          return;
        }
        if (resumeInstantRelease) {
          // SMOOTH CATCH-UP / MEGA TELEPORT (v8, analiza mphew0b2):
          // W v6 smoothCatchUp 80m działał dla skoków 100-500m, ALE dla
          // mega-skoków (jumpM=6541m, 6908m po 3min background) marker
          // nie nadążał: leciał 80m, GPS dawał nowy fix 6.8km dalej,
          // znowu 80m, itd. = wlókł się 5s zanim trafił do prawdziwego miejsca.
          //
          // Nowa strategia:
          //  - jumpM > 1500m LUB bgPause > 30s → MEGA TELEPORT (instant do raw).
          //    Akceptujemy że marker "skacze" raz, bo to UX po długim sleepie
          //    (user wie że auto jechało, GPS dropnął) — lepsze niż 5s wleczenia.
          //  - jumpM 100-1500m → smoothCatchUp 80m (jak v6, działa OK).
          //  - jumpM <= 100m → instant do raw bez catch-up (drobny skok).
          const SMOOTH_CATCH_UP_THRESHOLD_M = 100;
          const SMOOTH_CATCH_UP_FIRST_STEP_M = 80;
          const MEGA_TELEPORT_THRESHOLD_M = 1500;
          const MEGA_TELEPORT_BG_PAUSE_MS = 30_000;
          const bgPauseMs = lastBackgroundAtRef.current > 0
            ? now - lastBackgroundAtRef.current
            : 0;
          const isMegaTeleport =
            resumeJumpGate.allowMegaTeleport
            && (
              jumpM > MEGA_TELEPORT_THRESHOLD_M
              || bgPauseMs > MEGA_TELEPORT_BG_PAUSE_MS
            );
          let releaseTargetLat = rawLat;
          let releaseTargetLng = rawLng;
          let smoothCatchUp = false;
          const useResumeStairStep =
            !isMegaTeleport
            && jumpM > SMOOTH_CATCH_UP_THRESHOLD_M
            && bgPauseMs >= MEGA_TELEPORT_BG_PAUSE_MS
            && lastSetLocRef.current;
          if (useResumeStairStep && lastSetLocRef.current) {
            const t = SMOOTH_CATCH_UP_FIRST_STEP_M / jumpM;
            releaseTargetLat = lastSetLocRef.current.lat + (rawLat - lastSetLocRef.current.lat) * t;
            releaseTargetLng = lastSetLocRef.current.lng + (rawLng - lastSetLocRef.current.lng) * t;
            smoothCatchUp = true;
          }
          vroomGpsLog('RESUME_FREEZE_INSTANT_RELEASE', {
            jumpM: Math.round(jumpM),
            speedKmh: Math.round(speedKmhRaw),
            motionKmh: Math.round(motionKmh),
            rawGpsKmh: Math.round(rawGpsKmhRef.current),
            smoothCatchUp,
            megaTeleport: isMegaTeleport,
            firstStepM: smoothCatchUp ? SMOOTH_CATCH_UP_FIRST_STEP_M : Math.round(jumpM),
          });
          tripResumeFreezeUntilRef.current = 0;
          tripResumeAnchorRef.current = null;
          tripResumeConfirmRef.current = null;
          tripResumeMotionWakeHitsRef.current = 0;
          resumeFreezeInstantlyReleased = true;
          try {
            drLatRef.current = releaseTargetLat;
            drLngRef.current = releaseTargetLng;
            lastSetLocRef.current = { lat: releaseTargetLat, lng: releaseTargetLng };
            if (jumpM <= TRIP_RESUME_MAX_JUMP_M) {
              lastGoodLocRef.current = { lat: rawLat, lng: rawLng };
            }
            lastRawForHeadingRef.current = { lat: rawLat, lng: rawLng };
            const releaseSpeedMs = Math.max(0, Math.max(speedKmhRaw, motionKmh) / 3.6);
            const releaseHdg = lastHeadingRef.current ?? 0;
            if (true && tripActiveNow) {
              // Refs only — jeden applyTripPosition po drivingSnap poniżej (bez raw leak).
              drLatRef.current = releaseTargetLat;
              drLngRef.current = releaseTargetLng;
              lastSetLocRef.current = { lat: releaseTargetLat, lng: releaseTargetLng };
            }
          } catch {}
        } else if (jumpM <= TRIP_RESUME_HOLD_JUMP_M) {
          if (resumeMotionWake) {
            tripResumeMotionWakeHitsRef.current += 1;
            if (tripResumeMotionWakeHitsRef.current >= 2) {
              vroomGpsLog('RESUME_FREEZE_MOTION_RELEASE', {
                jumpM: Math.round(jumpM),
                speedKmh: Math.round(speedKmhRaw),
                motionKmh: Math.round(motionKmh),
                hits: tripResumeMotionWakeHitsRef.current,
              });
              tripResumeFreezeUntilRef.current = 0;
              tripResumeAnchorRef.current = null;
              tripResumeConfirmRef.current = null;
              tripResumeMotionWakeHitsRef.current = 0;
            } else {
              markerLogCritical('RESUME_FREEZE_HOLD', {
                jumpM: Math.round(jumpM),
                kmh: Math.round(speedKmhRaw),
                motionKmh: Math.round(motionKmh),
                motionHits: tripResumeMotionWakeHitsRef.current,
                freezeLeftMs: tripResumeFreezeUntilRef.current - now,
              });
              gpsResumeSoftHoldSkipRef.current = true;
            }
          } else {
            tripResumeMotionWakeHitsRef.current = 0;
            markerLogCritical('RESUME_FREEZE_HOLD', {
              jumpM: Math.round(jumpM),
              kmh: Math.round(speedKmhRaw),
              freezeLeftMs: tripResumeFreezeUntilRef.current - now,
            });
            gpsResumeSoftHoldSkipRef.current = true;
          }
        }
        if (resumeFreezeInstantlyReleased) {
          // Instant release już naprawił marker; pomijamy cluster confirm dla dużego skoku.
        } else {
        const cand = tripResumeConfirmRef.current;
        const sameCluster =
          !!cand
          && haversineKm(cand.lat, cand.lng, rawLat, rawLng) * 1000 <= 35;
        if (!sameCluster) {
          tripResumeConfirmRef.current = { lat: rawLat, lng: rawLng, hits: 1 };
          vroomGpsLog('RESUME_FREEZE_REJECT', { jumpM: Math.round(jumpM), hits: 1 });
          if (speedKmhRaw < 6 && motionKmh < 6 && jumpM < TRIP_RESUME_INSTANT_JUMP_M) {
            gpsResumeSoftHoldSkipRef.current = true;
          } else {
            tripResumeFreezeUntilRef.current = 0;
            tripResumeAnchorRef.current = null;
          }
        } else {
          const hits = (cand?.hits ?? 1) + 1;
          if (hits < TRIP_RESUME_CONFIRM_HITS) {
            tripResumeConfirmRef.current = { lat: rawLat, lng: rawLng, hits };
            vroomGpsLog('RESUME_FREEZE_REJECT', { jumpM: Math.round(jumpM), hits });
            if (speedKmhRaw >= 8 || motionKmh >= 8 || jumpM >= TRIP_RESUME_INSTANT_JUMP_M) {
              tripResumeFreezeUntilRef.current = 0;
              tripResumeAnchorRef.current = null;
            } else {
              gpsResumeSoftHoldSkipRef.current = true;
            }
          } else {
        vroomGpsLog('RESUME_FREEZE_RELEASE', { jumpM: Math.round(jumpM), hits });
        tripResumeFreezeUntilRef.current = 0;
        tripResumeAnchorRef.current = null;
        tripResumeConfirmRef.current = null;
        tripResumeMotionWakeHitsRef.current = 0;
        // Wybudzenie z tła + potwierdzony świeży klaster — teleport markera natychmiast
        // do nowej pozycji bez ślizgu (inaczej DR animowałby 300–600m w >1s i ciągnął
        // marker po cudzych ulicach). Resetujemy DR i zerujemy historię delta.
        try {
          const resumeTeleportImplausible = lastGoodLocRef.current
            ? isImplausibleGpsTeleport(
              lastGoodLocRef.current,
              rawLat,
              rawLng,
              Math.max(250, now - prevGoodTimeRef.current),
              0,
              speedKmhRaw,
              motionKmh,
              0,
              rawGpsKmhRef.current,
            )
            : false;
          if (resumeTeleportImplausible) {
            vroomGpsLog('RESUME_TELEPORT_REJECT', {
              jumpM: Math.round(jumpM),
              accM: Math.round(acc),
            }, 0);
            return;
          }
          drLatRef.current = rawLat;
          drLngRef.current = rawLng;
          lastSetLocRef.current = { lat: rawLat, lng: rawLng };
          if (jumpM <= TRIP_RESUME_MAX_JUMP_M) {
            lastGoodLocRef.current = { lat: rawLat, lng: rawLng };
          }
          if (lastDrivingPosRef.current) {
            lastDrivingPosRef.current = { lat: rawLat, lng: rawLng };
          }
          lastRawForHeadingRef.current = { lat: rawLat, lng: rawLng };
          lastRawTickRef.current = { lat: rawLat, lng: rawLng, at: now, acc };
          prevGoodTimeRef.current = now;
          const releaseHdg2 = lastHeadingRef.current ?? 0;
          if (!(true && tripActiveNow)) {
bumpActiveMarker(rawLat, rawLng, {
              heading: releaseHdg2,
              forcePublish: true,
              instant: true,
            });
          }
        } catch {
          // best-effort — i tak puścimy fix poniżej
        }
          }
        }
        }
      }

      if (isStaleGpsTimestamp(now, loc.timestamp)) {
        if (!tripActiveNow) {
          console.warn('[GPS map] Odrzucono przestarzały fix (timestamp OS)');
          pushGpsDebugFix({
            lat: rawLat,
            lng: rawLng,
            acc,
            speedKmh: speedKmhRaw,
            accepted: false,
            reason: 'stale_timestamp',
          });
          return;
        }
        if (tripResumeFreezeUntilRef.current > now && tripResumeAnchorRef.current) {
          vroomGpsLog('RESUME_STALE_REJECT', { accM: Math.round(acc) });
          return;
        }
        if (lastGoodLocRef.current) {
          const clamped = clampRawTowardAnchor(
            lastGoodLocRef.current,
            rawLat,
            rawLng,
            activeClampStepM,
          );
          rawLat = clamped.lat;
          rawLng = clamped.lng;
          pushGpsDebugFix({
            lat: rawLat,
            lng: rawLng,
            acc,
            speedKmh: speedKmhRaw,
            accepted: true,
            reason: 'stale_timestamp_active_clamped',
          });
        }
      }

      const reportedKmhIdle = (loc.speed != null && loc.speed >= 0) ? loc.speed * 3.6 : 0;
      const wallSinceAcceptIdle = now - lastAcceptedFixWallClockRef.current;
      const inResumeGrace = resumeAwaitFixUntilRef.current > now;
      if (
        lastGoodLocRef.current
        && wallSinceAcceptIdle > GPS_IDLE_GAP_FOR_JUMP_GUARD_MS
        && reportedKmhIdle < GPS_IDLE_SPEED_GUARD_KMH
        && reportedKmhIdle < 4
        && !isDrivingRef.current
        && !isNavigatingRef.current
      ) {
        const jumpIdleM = haversineKm(
          lastGoodLocRef.current.lat, lastGoodLocRef.current.lng,
          rawLat, rawLng,
        ) * 1000;
        if (jumpIdleM > GPS_IDLE_MAX_JUMP_AFTER_GAP_M) {
          if (wallSinceAcceptIdle > GPS_ANCHOR_STALE_REBASE_MS && acc <= 120) {
            vroomGpsLog('IDLE_GAP_JUMP_ESCAPE', {
              jumpM: Math.round(jumpIdleM),
              wallMs: Math.round(wallSinceAcceptIdle),
            });
          } else {
            console.warn('[GPS map] Duży skok po przerwie (idle) — odrzucono');
            latFilter.reset();
            lngFilter.reset();
            navLatFilter.reset();
            navLngFilter.reset();
            drivLatFilter.reset();
            drivLngFilter.reset();
            pushGpsDebugFix({
              lat: rawLat,
              lng: rawLng,
              acc,
              speedKmh: speedKmhRaw,
              accepted: false,
              reason: 'idle_gap_jump',
            });
            return;
          }
        }
      }

      // ══ 1. SANITY CHECK ══════════════════════════════════════
      const rollbackRejectedRawAnchor = rollbackIdleAnchor;
      const anchorAgeMs = lastAcceptedFixWallClockRef.current > 0
        ? now - lastAcceptedFixWallClockRef.current
        : Infinity;
      const idleModeEarly = !isDrivingRef.current && !isNavigatingRef.current;
      let bypassIdleSanity = false;
      if (
        idleModeEarly
        && lastGoodLocRef.current
        && anchorAgeMs > GPS_ANCHOR_STALE_REBASE_MS
        && acc <= 120
      ) {
        if (Platform.OS === 'ios') {
          if (acc > GPS_IOS_ANCHOR_STALE_REBASE_MAX_ACC_M) {
            iosStaleRebaseCandidateRef.current = null;
            pushGpsDebugFix({
              lat: rawLat,
              lng: rawLng,
              acc,
              speedKmh: speedKmhRaw,
              accepted: false,
              reason: 'ios_anchor_stale_rebase_low_quality',
            });
            return;
          } else {
            const cand = iosStaleRebaseCandidateRef.current;
            const sameCluster =
              !!cand
              && now - cand.time <= GPS_IOS_ANCHOR_STALE_REBASE_CONFIRM_WINDOW_MS
              && haversineKm(cand.lat, cand.lng, rawLat, rawLng) * 1000 <= GPS_IOS_ANCHOR_STALE_REBASE_CONFIRM_RADIUS_M;
            if (!sameCluster) {
              iosStaleRebaseCandidateRef.current = { lat: rawLat, lng: rawLng, hits: 1, time: now };
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: false,
                reason: 'ios_anchor_stale_rebase_candidate_1',
              });
              return;
            }
            const hits = (cand?.hits ?? 1) + 1;
            if (hits < GPS_IOS_ANCHOR_STALE_REBASE_CONFIRM_HITS) {
              iosStaleRebaseCandidateRef.current = { lat: rawLat, lng: rawLng, hits, time: now };
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: false,
                reason: `ios_anchor_stale_rebase_candidate_${hits}`,
              });
              return;
            }
            iosStaleRebaseCandidateRef.current = null;
          }
        } else {
          iosStaleRebaseCandidateRef.current = null;
        }
        latFilter.reset();
        lngFilter.reset();
        navLatFilter.reset();
        navLngFilter.reset();
        drivLatFilter.reset();
        drivLngFilter.reset();
        idleJumpCandidateRef.current = null;
        idleUiJumpCandidateRef.current = null;
        stillLockCandidateRef.current = null;
        idleRecoveryClusterRef.current = null;
        lastGoodLocRef.current = { lat: rawLat, lng: rawLng };
        lastGoodTimeRef.current = now;
        bypassIdleSanity = true;
        vroomGpsLog('ANCHOR_STALE_REBASE', {
          anchorAgeMs: Math.round(anchorAgeMs),
          accM: Math.round(acc),
        });
      }
      if (!(idleModeEarly && anchorAgeMs > GPS_ANCHOR_STALE_REBASE_MS)) {
        iosStaleRebaseCandidateRef.current = null;
      }

      if (lastGoodLocRef.current && !bypassIdleSanity) {
        const dtMs   = now - lastGoodTimeRef.current;
        const safeDt = Math.max(dtMs, 100);
        const idleMode = !isDrivingRef.current && !isNavigatingRef.current;
        const activeMode = isDrivingRef.current || isNavigatingRef.current;
        const jumpM = haversineKm(
          lastGoodLocRef.current.lat,
          lastGoodLocRef.current.lng,
          rawLat,
          rawLng,
        ) * 1000;
        if (idleMode && motionKmh < GPS_IDLE_UI_LOCK_SPEED_KMH) {
          const uiAnchor =
            lastSetLocRef.current
            ?? (currentLocRef.current
              && Number.isFinite(currentLocRef.current.latitude)
              && Number.isFinite(currentLocRef.current.longitude)
              ? { lat: currentLocRef.current.latitude, lng: currentLocRef.current.longitude }
              : null);
          if (uiAnchor) {
            const uiJumpM = haversineKm(uiAnchor.lat, uiAnchor.lng, rawLat, rawLng) * 1000;
            const maxUiJumpMBase = maxIdleBrowsingJumpM(safeDt, speedKmhRaw, acc, motionKmh);
            const maxUiJumpM = inResumeGrace
              ? Math.max(maxUiJumpMBase, GPS_RESUME_IDLE_UI_MIN_JUMP_M)
              : maxUiJumpMBase;
            if (uiJumpM > maxUiJumpM) {
              console.warn(`[GPS map] Idle UI raw jump rejected before anchor update: ${Math.round(uiJumpM)}m > ${Math.round(maxUiJumpM)}m`);
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: false,
                reason: 'idle_ui_raw_pre_anchor',
              });
              return;
            }
          }
        }
        if (idleMode) {
          const uiAnchor =
            lastSetLocRef.current
            ?? (currentLocRef.current
              && Number.isFinite(currentLocRef.current.latitude)
              && Number.isFinite(currentLocRef.current.longitude)
              ? { lat: currentLocRef.current.latitude, lng: currentLocRef.current.longitude }
              : null);
          if (uiAnchor) {
            const uiJumpM = haversineKm(uiAnchor.lat, uiAnchor.lng, rawLat, rawLng) * 1000;
            const stillLockApplies =
              uiJumpM > GPS_STILL_LOCK_SOFT_JUMP_M
              && safeDt < 9_000
              && motionKmh < GPS_STILL_LOCK_SPEED_KMH
              && acc > 45;
            if (stillLockApplies && !inResumeGrace) {
              const cand = stillLockCandidateRef.current;
              const sameCluster =
                !!cand &&
                now - cand.time <= GPS_STILL_LOCK_CONFIRM_WINDOW_MS &&
                haversineKm(cand.lat, cand.lng, rawLat, rawLng) * 1000 <= GPS_STILL_LOCK_CONFIRM_RADIUS_M;
              if (!sameCluster) {
                stillLockCandidateRef.current = { lat: rawLat, lng: rawLng, time: now, hits: 1 };
                pushGpsDebugFix({
                  lat: rawLat,
                  lng: rawLng,
                  acc,
                  speedKmh: speedKmhRaw,
                  accepted: false,
                  reason: 'still_lock_candidate_1',
                });
                return;
              }
              const hits = (cand?.hits ?? 1) + 1;
              stillLockCandidateRef.current = { lat: rawLat, lng: rawLng, time: now, hits };
              if (hits < GPS_STILL_LOCK_CONFIRM_HITS) {
                pushGpsDebugFix({
                  lat: rawLat,
                  lng: rawLng,
                  acc,
                  speedKmh: speedKmhRaw,
                  accepted: false,
                  reason: `still_lock_candidate_${hits}`,
                });
                return;
              }
              if (uiJumpM > GPS_STILL_LOCK_HARD_REJECT_M) {
                pushGpsDebugFix({
                  lat: rawLat,
                  lng: rawLng,
                  acc,
                  speedKmh: speedKmhRaw,
                  accepted: false,
                  reason: 'still_lock_hard_reject',
                });
                return;
              }
              stillLockCandidateRef.current = null;
            } else if (uiJumpM <= GPS_IDLE_UI_SOFT_JUMP_M) {
              stillLockCandidateRef.current = null;
            }
          }
        }
        // Idle anti-teleport: do not trust one-off large jumps while not navigating/driving.
        // Ignore GPS-reported speed here — some devices report stale/high speed on stationary fixes.
        const idleRandomJumpLimitM = inResumeGrace
          ? Math.max(GPS_IDLE_RANDOM_JUMP_M, GPS_RESUME_IDLE_RANDOM_JUMP_M)
          : GPS_IDLE_RANDOM_JUMP_M;
        if (idleMode && jumpM > idleRandomJumpLimitM) {
          const cand = idleJumpCandidateRef.current;
          const sameCluster =
            !!cand &&
            now - cand.time <= GPS_IDLE_CONFIRM_WINDOW_MS &&
            haversineKm(cand.lat, cand.lng, rawLat, rawLng) * 1000 <= GPS_IDLE_CONFIRM_RADIUS_M;
          if (!sameCluster) {
            idleJumpCandidateRef.current = { lat: rawLat, lng: rawLng, time: now, hits: 1 };
            console.warn('[GPS map] Idle random jump candidate held (1/3)');
            pushGpsDebugFix({
              lat: rawLat,
              lng: rawLng,
              acc,
              speedKmh: speedKmhRaw,
              accepted: false,
              reason: 'idle_candidate_1',
            });
            return;
          }
          const hits = (cand?.hits ?? 1) + 1;
          idleJumpCandidateRef.current = { lat: rawLat, lng: rawLng, time: now, hits };
          if (hits < GPS_IDLE_CONFIRM_HITS) {
            console.warn(`[GPS map] Idle random jump candidate held (${hits}/3)`);
            pushGpsDebugFix({
              lat: rawLat,
              lng: rawLng,
              acc,
              speedKmh: speedKmhRaw,
              accepted: false,
              reason: `idle_candidate_${hits}`,
            });
            return;
          }
          if (jumpM > GPS_IDLE_HARD_REJECT_M) {
            if (anchorAgeMs > GPS_ANCHOR_STALE_REBASE_MS && acc <= 120) {
              idleJumpCandidateRef.current = null;
              vroomGpsLog('IDLE_HARD_REJECT_ESCAPE', {
                jumpM: Math.round(jumpM),
                anchorAgeMs: Math.round(anchorAgeMs),
              });
            } else {
              console.warn('[GPS map] Idle jump hard-rejected');
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: false,
                reason: 'idle_hard_reject',
              });
              return;
            }
          }
          idleJumpCandidateRef.current = null;
        } else if (jumpM <= idleRandomJumpLimitM) {
          idleJumpCandidateRef.current = null;
        }

        // Stojąc w miejscu: odzyskaj kotwicę gdy UI utknął na cache, a GPS podaje spójny klaster.
        if (
          idleMode
          && motionKmh < 5
          && acc <= 55
          && lastSetLocRef.current
        ) {
          const uiDistM = haversineKm(
            lastSetLocRef.current.lat,
            lastSetLocRef.current.lng,
            rawLat,
            rawLng,
          ) * 1000;
          if (uiDistM >= GPS_IDLE_ANCHOR_RECOVERY_MIN_DIST_M) {
            const cand = idleRecoveryClusterRef.current;
            const sameCluster =
              !!cand
              && now - cand.firstAt <= GPS_IDLE_ANCHOR_RECOVERY_WINDOW_MS
              && haversineKm(cand.lat, cand.lng, rawLat, rawLng) * 1000 <= 50;
            if (!sameCluster) {
              idleRecoveryClusterRef.current = { lat: rawLat, lng: rawLng, hits: 1, firstAt: now };
            } else {
              const hits = (cand?.hits ?? 1) + 1;
              idleRecoveryClusterRef.current = { lat: rawLat, lng: rawLng, hits, firstAt: cand!.firstAt };
              if (hits >= GPS_IDLE_ANCHOR_RECOVERY_HITS) {
                latFilter.reset();
                lngFilter.reset();
                navLatFilter.reset();
                navLngFilter.reset();
                drivLatFilter.reset();
                drivLngFilter.reset();
                lastGoodLocRef.current = { lat: rawLat, lng: rawLng };
                lastSetLocRef.current = { lat: rawLat, lng: rawLng };
                lastGoodTimeRef.current = now;
                lastAcceptedFixWallClockRef.current = now;
                gpsBootstrapPendingRef.current = false;
                idleJumpCandidateRef.current = null;
                idleUiJumpCandidateRef.current = null;
                stillLockCandidateRef.current = null;
                idleRecoveryClusterRef.current = null;
                vroomGpsLog('IDLE_ANCHOR_RECOVERY', { uiDistM: Math.round(uiDistM), hits, accM: Math.round(acc) });
              }
            }
          } else {
            idleRecoveryClusterRef.current = null;
          }
        }

        const sane   = isSaneLocation(
          rawLat, rawLng,
          lastGoodLocRef.current.lat,
          lastGoodLocRef.current.lng,
          activeMode ? MAX_PLAUSIBLE_SPEED_KMH : 250,
          safeDt,
          isDrivingRef.current,
        );
        if (!sane) {
          if (activeMode) {
            if (isDrivingRef.current) {
              // Driving mode: do not clamp/reject sane-distance anomalies.
              // Hard jump guard at the top of onLocation remains the only distance reject.
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: true,
                reason: 'sanity_speed_driving_bypass',
              });
            } else {
              rollbackIdleAnchor();
              const clamped = clampRawTowardAnchor(
                lastGoodLocRef.current,
                rawLat,
                rawLng,
                activeClampStepM,
              );
              rawLat = clamped.lat;
              rawLng = clamped.lng;
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: true,
                reason: 'sanity_speed_clamped',
              });
            }
          } else {
            if (anchorAgeMs > GPS_ANCHOR_STALE_REBASE_MS && acc <= 120) {
              vroomGpsLog('SANITY_SPEED_ESCAPE', { anchorAgeMs: Math.round(anchorAgeMs) });
            } else {
              console.warn('[GPS map] Skok odrzucony');
              latFilter.reset();
              lngFilter.reset();
              navLatFilter.reset();
              navLngFilter.reset();
              drivLatFilter.reset();
              drivLngFilter.reset();
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: false,
                reason: 'sanity_speed',
              });
              return;
            }
          }
        }

        // Absolute-distance cap: a medium-sized drift (e.g. 200 m over 30 s =
        // 24 km/h) passes the speed check but is still a bad fix when the vehicle
        // is slow or stationary. Allow 3× expected distance + 100 m headroom.
        // safeDt uses a 100 ms floor so a very short time-delta between consecutive
        // GPS fixes never makes an ordinary displacement look unreasonably fast.
        // In driving mode, use a higher floor (300 m) to accommodate GPS drift at
        // highway speeds when loc.speed may report 0 on Android.
        const distM2    = haversineKm(lastGoodLocRef.current.lat, lastGoodLocRef.current.lng, rawLat, rawLng) * 1000;
        const reportedKmhRaw = (loc.speed != null && loc.speed >= 0) ? loc.speed * 3.6 : 0;
        const ghostDopplerInflatesJump =
          !isDrivingRef.current
          && (
          reportedKmhRaw >= 30
          && motionKmh < 14
          && (isDrivingRef.current || isNavigatingRef.current)
          );
        const fgRefreshEarly =
          tripForegroundRefreshUntilRef.current > now
          && tripActiveNow;
        if (
          activeMode
          && distM2 > 45
          && ghostDopplerInflatesJump
        ) {
          if (fgRefreshEarly && (rawGpsKmhRef.current >= 6 || speedKmhRaw >= 6)) {
            const clampedGhost = clampRawTowardAnchor(
              lastGoodLocRef.current,
              rawLat,
              rawLng,
              activeClampStepM,
            );
            rawLat = clampedGhost.lat;
            rawLng = clampedGhost.lng;
            vroomGpsLog('DRIVING_GHOST_JUMP_CLAMP_RESUME', {
              jumpM: Math.round(distM2),
            }, 1200);
          } else {
            vroomGpsLog('DRIVING_GHOST_JUMP_REJECT', {
              jumpM: Math.round(distM2),
              reportedKmh: Math.round(reportedKmhRaw),
              motionKmh: Math.round(motionKmh),
              accM: Math.round(acc),
            }, 1200);
            pushGpsDebugFix({
              lat: rawLat,
              lng: rawLng,
              acc,
              speedKmh: speedKmhRaw,
              accepted: false,
              reason: 'driving_ghost_jump',
            });
            return;
          }
        }
        const reportedKmhRawCapped = ghostDopplerInflatesJump
          ? Math.min(reportedKmhRaw, 8)
          : reportedKmhRaw;
        const reportedKmh = (isDrivingRef.current || isNavigatingRef.current)
          ? Math.max(reportedKmhRawCapped, Math.min(motionKmh, 25))
          : (!isDrivingRef.current && !isNavigatingRef.current)
            ? Math.max(reportedKmhRawCapped, motionKmh)
            : reportedKmhRawCapped;
        const expectedM2  = (reportedKmh / 3.6) * (safeDt / 1000);
        const distFloor = isDrivingRef.current
          ? (reportedKmhRaw < 4 ? 80 : (reportedKmhRaw < 14 ? 150 : 260))
          : (isNavigatingRef.current ? 320 : 100);
        let maxDistM2   = Math.max(distFloor, expectedM2 * 3 + 100);
        if (idleMode && motionKmh < 22) {
          maxDistM2 = Math.min(maxDistM2, maxIdleBrowsingJumpM(safeDt, reportedKmhRaw, acc, motionKmh));
        }
        if (isDrivingRef.current && reportedKmhRaw < 6) {
          maxDistM2 = Math.min(maxDistM2, drivingLowSpeedJumpCapM(reportedKmhRaw, acc));
        } else if (isDrivingRef.current && reportedKmhRaw < 12) {
          const lowSpeedCapM = Math.max(22, Math.min(55, acc * 1.2 + 14));
          maxDistM2 = Math.min(maxDistM2, lowSpeedCapM);
        }
        if (
          isDrivingRef.current
          && distM2 > 55
          && reportedKmhRaw >= 12
          && motionKmh < 10
        ) {
          maxDistM2 = Math.min(maxDistM2, Math.max(32, drivingLowSpeedJumpCapM(reportedKmhRaw, acc)));
        }
        if (distM2 > maxDistM2) {
          if (activeMode) {
            if (isDrivingRef.current) {
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: true,
                reason: 'sanity_distance_driving_bypass',
              });
            } else {
              const clamped = clampRawTowardAnchor(
                lastGoodLocRef.current,
                rawLat,
                rawLng,
                activeClampStepM,
              );
              rawLat = clamped.lat;
              rawLng = clamped.lng;
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: true,
                reason: 'sanity_distance_clamped',
              });
            }
            if (tripActiveNow && motionPrev && motionDtMs >= 350) {
              const clampedDerived = (haversineKm(
                motionPrev.lat,
                motionPrev.lng,
                rawLat,
                rawLng,
              ) / (motionDtMs / 1000)) * 3600;
              if (Number.isFinite(clampedDerived)) {
                motionKmh = Math.min(
                  motionKmh,
                  Math.max(0, Math.min(clampedDerived, motionCapKmh)),
                );
              }
            }
          } else {
            const allowStaleEscape =
              anchorAgeMs > GPS_ANCHOR_STALE_REBASE_MS
              && acc <= 120
              && distM2 < 350
              && !(motionKmh < 10 && reportedKmhRaw >= 25);
            if (allowStaleEscape) {
              vroomGpsLog('SANITY_DISTANCE_ESCAPE', {
                jumpM: Math.round(distM2),
                anchorAgeMs: Math.round(anchorAgeMs),
              });
            } else {
              console.warn(`[GPS map] Skok dystansowy odrzucony: ${Math.round(distM2)}m > ${Math.round(maxDistM2)}m`);
              latFilter.reset();
              lngFilter.reset();
              navLatFilter.reset();
              navLngFilter.reset();
              drivLatFilter.reset();
              drivLngFilter.reset();
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: false,
                reason: 'sanity_distance',
              });
              return;
            }
          }
        }
        if (tripActiveNow && isDrivingRef.current && drivingJumpClampActive) {
          const carryMs = Math.max(
            0,
            lastReliableSpeedMsRef.current
              ?? (speedKmhRef.current > 0 ? speedKmhRef.current / 3.6 : 0),
          );
          if (carryMs >= 1.8) {
            jumpAnomalyCarrySpeedMsRef.current = carryMs;
            jumpAnomalyDrUntilRef.current = now + 5000;
          }
          const anchor = lastGoodLocRef.current ?? lastSetLocRef.current;
          if (anchor) {
            const anchorToRawM = haversineKm(anchor.lat, anchor.lng, rawLat0, rawLng0) * 1000;
            if (anchorToRawM >= 120 && acc <= 65) {
              const cand = jumpRecoveryCandidateRef.current;
              const sameCluster = !!cand
                && haversineKm(cand.lat, cand.lng, rawLat0, rawLng0) * 1000 <= 55;
              if (sameCluster) {
                cand!.hits += 1;
                cand!.lat = rawLat0;
                cand!.lng = rawLng0;
                const stableHits = cand!.hits;
                if (stableHits >= 3) {
                  const recoverAlpha = 0.42;
                  rawLat = anchor.lat + (cand!.lat - anchor.lat) * recoverAlpha;
                  rawLng = anchor.lng + (cand!.lng - anchor.lng) * recoverAlpha;
                  jumpRecoveryCandidateRef.current = null;
                  jumpAnomalyDrUntilRef.current = 0;
                  vroomGpsLog('GPS_JUMP_RECOVERY_LOCK', {
                    hits: stableHits,
                    anchorToRawM: Math.round(anchorToRawM),
                    accM: Math.round(acc),
                  }, 800);
                }
              } else {
                jumpRecoveryCandidateRef.current = {
                  lat: rawLat0,
                  lng: rawLng0,
                  hits: 1,
                  firstAt: now,
                };
              }
            } else {
              jumpRecoveryCandidateRef.current = null;
            }
          }
        } else if (tripActiveNow && isDrivingRef.current) {
          jumpRecoveryCandidateRef.current = null;
        }
      }
      prevGoodTimeRef.current = lastGoodTimeRef.current;
      lastGoodTimeRef.current = now;
      // W jazdzie/nawigacji lastGoodLoc = tylko pozycja snapped (patrz appliedSnap na końcu pipeline).
      if (!tripActiveNow) {
        lastGoodLocRef.current = { lat: rawLat, lng: rawLng };
      }
      lastAcceptedFixWallClockRef.current = now;
      stillLockCandidateRef.current = null;
      iosStaleRebaseCandidateRef.current = null;
      if (resumeAwaitFixUntilRef.current > 0) {
        resumeAwaitFixUntilRef.current = 0;
      }
      pushGpsDebugFix({
        lat: rawLat,
        lng: rawLng,
        acc,
        speedKmh: speedKmhRaw,
        accepted: true,
        reason: 'accepted_raw',
      });
      const shouldPersistLocation = tripActiveNow
        ? acc <= GPS_ACQUIRING_ACTIVE_RELEASE_ACCURACY_M
        : (
          acc <= GPS_ACQUIRING_RELEASE_ACCURACY_M
          || (gpsTickCountRef.current >= GPS_ACQUIRING_RELEASE_AFTER_TICKS
            && acc <= GPS_ACQUIRING_RELEASE_FALLBACK_ACCURACY_M)
        );
      setGpsAcquiring(false);
      if (shouldPersistLocation) {
        persistMapLocation(rawLat, rawLng, acc);
      }

      // ══ 2. Kalman / driveTracking ════════════════════════════
      const tripActivePreKalman = isDrivingRef.current || isNavigatingRef.current;
      const rawKmhPreKalman = loc.speed != null && loc.speed >= 0 ? loc.speed * 3.6 : 0;
      const rawStepWakeM = lastRawForHeadingRef.current
        ? haversineKm(
          lastRawForHeadingRef.current.lat,
          lastRawForHeadingRef.current.lng,
          rawLat,
          rawLng,
        ) * 1000
        : 0;
      const rawWakeAccuracyOk =
        TRIP_PIPELINE_SIMPLE
        || !Number.isFinite(acc)
        || acc <= 35
        || rawStepWakeM >= 6
        || speedKmhRaw >= 10;
      const rawStepWakeCandidate =
        tripActivePreKalman
        && rawWakeAccuracyOk
        && rawStepWakeM >= (TRIP_PIPELINE_SIMPLE ? 2.0 : 2.5);
      if (rawStepWakeCandidate) {
        rawMotionStreakRef.current = Math.min(6, rawMotionStreakRef.current + 1);
      } else if (rawStepWakeM < 1.0) {
        rawMotionStreakRef.current = 0;
      } else if (rawMotionStreakRef.current > 0) {
        rawMotionStreakRef.current -= 1;
      }
      const rawGpsMotionDetected = TRIP_PIPELINE_SIMPLE
        ? (
          tripActivePreKalman
          && (rawStepWakeM >= 2.5 || speedKmhRaw >= 4 || motionKmh >= 4)
        )
        : (
          tripActivePreKalman
          && (
            (rawStepWakeM >= 4.0 && rawWakeAccuracyOk)
            || (rawMotionStreakRef.current >= 2 && rawStepWakeM >= 2.5)
            || (speedKmhRaw >= 12 && rawStepWakeM >= 2.0)
          )
        );
      if (rawGpsMotionDetected) {
        rawMotionWakeUntilRef.current = now + (TRIP_PIPELINE_SIMPLE ? 3000 : 2400);
        startupMicroMoveGraceTicksRef.current = Math.max(startupMicroMoveGraceTicksRef.current, 3);
      } else if (tripActivePreKalman && speedKmhRaw >= 8 && rawStepWakeM >= 1.5) {
        rawMotionWakeUntilRef.current = Math.max(rawMotionWakeUntilRef.current, now + 1200);
      } else if (!tripActivePreKalman) {
        rawMotionWakeUntilRef.current = 0;
        rawMotionStreakRef.current = 0;
        startupMicroMoveGraceTicksRef.current = 0;
      }
      const rawMotionWakeActive =
        tripActivePreKalman
        && (rawGpsMotionDetected || now < rawMotionWakeUntilRef.current);
      const snapMotionWake =
        rawGpsMotionDetected
        || rawMotionWakeActive
        || speedKmhRaw >= (TRIP_PIPELINE_SIMPLE ? 3 : 8)
        || motionKmh >= (TRIP_PIPELINE_SIMPLE ? 3 : 6);
      if (
        !TRIP_PIPELINE_SIMPLE
        && tripActivePreKalman
        && lastGoodLocRef.current
        && !rawGpsMotionDetected
        && !rawMotionWakeActive
      ) {
        const earlyHoldStepM = haversineKm(
          lastGoodLocRef.current.lat,
          lastGoodLocRef.current.lng,
          rawLat,
          rawLng,
        ) * 1000;
        const ghostJumpFromAnchor =
          earlyHoldStepM > 14
          && rawStepWakeM < 3.5
          && speedKmhRef.current < 3
          && motionKmh < 4
          && speedKmhRaw < 6;
        if (ghostJumpFromAnchor) {
          pushGpsDebugFix({
            lat: rawLat,
            lng: rawLng,
            acc,
            speedKmh: 0,
            accepted: false,
            reason: 'stationary_jump_hold',
          });
          navDriveTrace('GHOST_JUMP_HOLD', {
            earlyHoldStepM: Math.round(earlyHoldStepM),
            rawStepWakeM: Number(rawStepWakeM.toFixed(2)),
            speedKmhRef: Math.round(speedKmhRef.current),
            motionKmh: Number(motionKmh.toFixed(1)),
            speedKmhRaw: Math.round(speedKmhRaw),
            accM: Math.round(acc),
          });
          const pin =
            lastSetLocRef.current
            ?? lastGoodLocRef.current;
          if (pin) {
publishSpeed(0, {
              sanitizedMs: 0,
              lat: pin.lat,
              lng: pin.lng,
              now,
              dtMs: Math.max(100, now - prevGoodTimeRef.current),
            });
          }
          return;
        }
      }
      navDriveTrace('RAW', {
        rawLat: Number(rawLat.toFixed(6)),
        rawLng: Number(rawLng.toFixed(6)),
        accM: Math.round(acc),
        speedKmhRaw: Number(speedKmhRaw.toFixed(1)),
        rawStepWakeM: Number(rawStepWakeM.toFixed(2)),
        motionKmh: Number(motionKmh.toFixed(1)),
        motionStreak: rawMotionStreakRef.current,
        rawMotion: rawGpsMotionDetected,
        rawWake: rawMotionWakeActive,
        snapWake: snapMotionWake,
      });
      const estRawToSnapPreM = lastSetLocRef.current
        ? haversineKm(lastSetLocRef.current.lat, lastSetLocRef.current.lng, rawLat, rawLng) * 1000
        : 0;
      const earlyTripFrozen =
        tripActivePreKalman
        && speedKmhRef.current < 8
        && estRawToSnapPreM < 12
        && (rawKmhPreKalman < 8 || (rawKmhPreKalman >= 10 && estRawToSnapPreM < 8));
      const preKalmanAccel = updateTripAccelBypass({
        rawGpsKmh: rawKmhPreKalman,
        feedSpeedKmh: speedKmhRef.current,
        rawToSnapM: estRawToSnapPreM,
        netMoveM: 0,
        tripActive: tripActivePreKalman,
        markerFrozen: earlyTripFrozen,
      });
      const accelBypassKalman = !!preKalmanAccel?.active;
      const useDrivingKalman = isDrivingRef.current && speedKmhRaw >= 3 && !accelBypassKalman;
      const kalmanSpeedKmh = speedKmhRaw;
      const rawSpeedMs = loc.speed != null && loc.speed >= 0 ? loc.speed : null;
      rawGpsKmhRef.current = rawSpeedMs != null ? rawSpeedMs * 3.6 : 0;
      const speedPrevAnchor = lastGoodLocRef.current ?? lastSetLocRef.current;
      const speedDtMs = Math.max(100, now - prevGoodTimeRef.current);
      let netMoveM = 0;
      let pathMoveM = 0;
      let sustainedKmh = 0;
      tripMoveSamplesRef.current = [];

      let lat: number;
      let lng: number;
      if (useDrivingKalman) {
        configureDrivingKalmanForSpeed(kalmanSpeedKmh);
      }
      lat = accelBypassKalman
        ? rawLat
        : useDrivingKalman
          ? drivLatFilter.filter(rawLat, acc)
          : latFilter.filter(rawLat, acc);
      lng = accelBypassKalman
        ? rawLng
        : useDrivingKalman
          ? drivLngFilter.filter(rawLng, acc)
          : lngFilter.filter(rawLng, acc);

      let rawGpsKmhForSpike = rawSpeedMs != null ? rawSpeedMs * 3.6 : 0;
      if (
        rawGpsKmhForSpike > GPS_DOPPLER_HIGH_SPEED_TRUST_KMH
        && Number.isFinite(acc)
        && acc > GPS_ACCURACY_HIGH_SPEED_MAX_M
      ) {
        rawGpsKmhForSpike = 0;
      }
      const tripSpeedWarmupActive = Date.now() < tripSpeedWarmupUntilRef.current;
      if (tripSpeedWarmupActive) {
        const physicallyMoving =
          netMoveM >= 8
          || motionKmh >= 6
          || sustainedKmh >= 6
          || pathMoveM >= 10;
        // Startup anti-spike: ignore absurd Doppler bursts at trip start without motion evidence.
        if (!physicallyMoving && rawGpsKmhForSpike > 70) {
          rawGpsKmhForSpike = 0;
        } else if (!physicallyMoving && rawGpsKmhForSpike > 200) {
          rawGpsKmhForSpike = 0;
        }
      }
      const trustDopplerInTrip = tripActiveNow && trustDopplerInTripEvidence({
        netMoveM,
        sustainedKmh,
        motionKmh,
        pathMoveM,
        rawGpsKmh: rawGpsKmhForSpike,
      });
      // Po długiej ciszy GPS (Android batch) netMove/sustained są 0 — nie traktuj Dopplera jako ghost.
      const gpsGapResumeTick = tripActiveNow
        && speedDtMs >= 2800
        && rawGpsKmhForSpike >= 8;
      // iOS ghost Doppler spike guard: telefon potrafi raportowac >100 km/h
      // na postoju przy slabym fixie. Gdy ruch z geometrii (derived/sustained/net)
      // tego nie potwierdza, ignorujemy doppler dla sanitizera.
      const likelyGhostHighSpeed =
        tripActiveNow
        && !trustDopplerInTrip
        && !gpsGapResumeTick
        && (
          (
            rawGpsKmhForSpike >= 22
            && rawGpsKmhForSpike <= 58
            && derivedKmhEarly < 12
            && sustainedKmh < 6
            && netMoveM < 18
          )
          || (
            rawGpsKmhForSpike >= 70
            && rawGpsKmhForSpike < 85
            && netMoveM < 20
            && motionKmh < 12
            && sustainedKmh < 8
          )
          || (
            rawGpsKmhForSpike >= 100
            && netMoveM < 6
            && sustainedKmh < 10
          )
          || (
            rawGpsKmhForSpike >= 85
            && netMoveM < 5
            && motionKmh < 8
          )
        );
      const speedInputMs = likelyGhostHighSpeed ? 0 : rawSpeedMs;

      let sanitizedSpeedMs = sanitizeSpeedMs({
        gpsSpeedMs: speedInputMs,
        prevLat: speedPrevAnchor?.lat,
        prevLng: speedPrevAnchor?.lng,
        newLat: tripActiveNow ? rawLat : lat,
        newLng: tripActiveNow ? rawLng : lng,
        dtMs: speedDtMs,
        isTripActive: tripActiveNow,
        netMoveM,
        pathMoveM,
        sustainedKmh,
        rawMotionDetected: rawMotionWakeActive,
        accuracyM: acc,
      });
      lastSpeedRawAnchorRef.current = { lat: rawLat, lng: rawLng, at: now };
      let kmh = sanitizedSpeedMs != null ? sanitizedSpeedMs * 3.6 : 0;
      const rawSpeedEvidenceKmh = Math.max(
        0,
        Number.isFinite(rawGpsKmhForSpike) ? rawGpsKmhForSpike : 0,
      );
      const rawStepParkM = lastRawForHeadingRef.current
        ? haversineKm(
          lastRawForHeadingRef.current.lat,
          lastRawForHeadingRef.current.lng,
          rawLat,
          rawLng,
        ) * 1000
        : Infinity;
      const stationaryGpsSpikeNow = isStationaryGpsSpike({
        rawGpsKmh: rawGpsKmhForSpike,
        derivedKmh: Math.max(kmh, derivedKmhEarly),
        netMoveM,
        pathMoveM,
        sustainedKmh,
        motionKmh,
        accuracyM: acc,
      });
      if (stationaryGpsSpikeNow) {
        kmh = 0;
        sanitizedSpeedMs = 0;
        rawGpsKmhForSpike = 0;
        rawGpsKmhRef.current = 0;
        rawMotionWakeUntilRef.current = 0;
        vroomGpsLog('SPEED_STATIONARY_SPIKE_REJECT', {
          rawGpsKmh: Number(rawSpeedEvidenceKmh.toFixed(1)),
          derivedKmh: Number(derivedKmhEarly.toFixed(1)),
          netMoveM: Math.round(netMoveM),
          pathMoveM: Math.round(pathMoveM),
          motionKmh: Number(motionKmh.toFixed(1)),
          sustainedKmh: Number(sustainedKmh.toFixed(1)),
          accM: Math.round(acc),
        }, 1200);
      }
      const hardZeroSpeedClamp = !TRIP_PIPELINE_SIMPLE
        && tripActiveNow
        && isDrivingRef.current
        && !rawGpsMotionDetected
        && !rawMotionWakeActive
        && rawGpsKmhForSpike < 5
        && motionKmh < 4
        && netMoveM < 6
        && (Number.isFinite(rawStepParkM) ? rawStepParkM < 2.5 : true);
      if (hardZeroSpeedClamp) {
        kmh = 0;
        sanitizedSpeedMs = 0;
        rawGpsKmhForSpike = 0;
      }
      if (
        tripActiveNow
        && isDrivingRef.current
        && !stationaryGpsSpikeNow
        && (sanitizedSpeedMs == null || kmh < 1.5)
        && rawSpeedEvidenceKmh >= 6
        && rawSpeedEvidenceKmh <= 45
        && (
          netMoveM >= 6
          || pathMoveM >= 8
          || sustainedKmh >= 3
          || motionKmh >= 4
          || (Number.isFinite(rawStepParkM) ? rawStepParkM >= 3 : false)
        )
      ) {
        const fallbackKmh = Math.max(
          6,
          Math.min(rawSpeedEvidenceKmh * 0.82, MAX_REALISTIC_DRIVING_KMH),
        );
        kmh = fallbackKmh;
        sanitizedSpeedMs = fallbackKmh / 3.6;
        vroomGpsLog('SPEED_RAW_FALLBACK_ACTIVE', {
          rawGpsKmh: Number(rawSpeedEvidenceKmh.toFixed(1)),
          fallbackKmh: Number(fallbackKmh.toFixed(1)),
          rawStepM: Number(rawStepParkM.toFixed(2)),
        }, 1200);
      }
      const tickMovementEvidence =
        (rawGpsKmhForSpike >= 15 && netMoveM >= 6)
        || (Number.isFinite(rawStepParkM) && rawStepParkM >= 5);
      if (
        tripActiveNow
        && !tickMovementEvidence
        && (rawGpsKmhForSpike >= 75 || kmh >= 75)
        && netMoveM < 12
        && motionKmh < 12
        && sustainedKmh < 12
      ) {
        kmh = 0;
        sanitizedSpeedMs = null;
        rawGpsKmhForSpike = 0;
        vroomGpsLog('SPEED_GHOST_EXTREME_REJECT', {
          rawGpsKmh: Number((loc.speed != null ? loc.speed * 3.6 : 0).toFixed(1)),
          derivedKmh: Number((kmh || 0).toFixed(1)),
          netMoveM: Math.round(netMoveM),
          motionKmh: Number(motionKmh.toFixed(1)),
        }, 1200);
      }
      const likelyStationarySpike =
        tripActiveNow
        && rawGpsKmhForSpike < 1
        && kmh > 12
        && motionKmh < 2.5
        && sustainedKmh < 2.8
        && netMoveM < 12;
      const likelyGhostLowSpeed =
        tripActiveNow
        && rawGpsKmhForSpike > 0
        && rawGpsKmhForSpike <= 12
        && kmh <= 14
        && motionKmh < 2.6
        && sustainedKmh < 2
        && netMoveM < 6;
      const likelyGhostDopplerStill =
        tripActiveNow
        && rawGpsKmhForSpike >= 6
        && rawGpsKmhForSpike <= 45
        && rawGpsKmhForSpike < 15
        && motionKmh < 4
        && sustainedKmh < 3.5
        && netMoveM < 8
        && pathMoveM < 8
        && (Number.isFinite(rawStepParkM) ? rawStepParkM < 2.5 : true);
      const coordsFrozenDrivingTick =
        Number.isFinite(rawStepParkM)
        && rawStepParkM < 2.8
        && rawGpsKmhForSpike >= 12;
      const fgRefreshTick =
        tripForegroundRefreshUntilRef.current > now
        && tripActiveNow;
      let parkedLikeNow = isParkedLikeTripEvidence({
        netMoveM,
        sustainedKmh,
        motionKmh,
        pathMoveM,
        rawGpsKmh: rawGpsKmhForSpike,
        coordsFrozenDriving: coordsFrozenDrivingTick,
        foregroundRefreshGrace: fgRefreshTick,
      });
      let tripMarkerFrozen = isTripMarkerFrozen({
        parkedLike: parkedLikeNow,
        netMoveM,
        motionKmh,
        sustainedKmh,
        pathMoveM,
        speedKmh: kmh,
        rawGpsKmh: rawGpsKmhForSpike,
        rawStepM: Number.isFinite(rawStepParkM) ? rawStepParkM : 0,
        foregroundRefreshGrace: fgRefreshTick,
      });
      const drivingPhysicalMotionEvidence =
        isDrivingRef.current
        && !stationaryGpsSpikeNow
        && (
          rawGpsMotionDetected
          || motionKmh >= 5
          || netMoveM >= 6
          || pathMoveM >= 8
          || (Number.isFinite(rawStepParkM) ? rawStepParkM >= 4 : false)
          || (rawGpsKmhForSpike >= 8 && netMoveM >= 5)
        );
      if (drivingPhysicalMotionEvidence) {
        parkedLikeNow = false;
        tripMarkerFrozen = false;
      }
      if (fgRefreshTick && resumeForegroundTickCountRef.current < 5) {
        resumeForegroundTickCountRef.current += 1;
        vroomGpsLog('RESUME_TICK_STATE', {
          tick: resumeForegroundTickCountRef.current,
          netMoveM: Math.round(netMoveM),
          sustainedKmh: Math.round(sustainedKmh),
          motionKmh: Math.round(motionKmh),
          parkedLike: parkedLikeNow,
          tripMarkerFrozen,
          sanitizedKmh: Math.round(kmh),
          rawGpsKmh: Math.round(rawGpsKmhForSpike),
        }, 0);
      }
      if (tripMarkerFrozen) {
        tripAccelState.bypassUntilMs = 0;
        tripAccelState.lagStreak = { count: 0, lastM: 0 };
      }
      if (
        !trustDopplerInTrip
        && !gpsGapResumeTick
        && (likelyStationarySpike || likelyGhostLowSpeed || likelyGhostHighSpeed || likelyGhostDopplerStill)
      ) {
        kmh = 0;
        sanitizedSpeedMs = null;
        speedSignalHoldUntilRef.current = 0;
        lastReliableSpeedMsRef.current = null;
        if (likelyGhostHighSpeed) {
          vroomGpsLog('SPEED_GHOST_HIGH_REJECT', {
            rawGpsKmh: Number(rawGpsKmhForSpike.toFixed(1)),
            derivedKmh: Number(derivedKmhEarly.toFixed(1)),
            sustainedKmh: Number((sustainedKmh || 0).toFixed(1)),
            netMoveM: Math.round(netMoveM || 0),
          }, 1200);
        }
      }
      const prevReliableKmh = lastReliableSpeedMsRef.current != null
        ? lastReliableSpeedMsRef.current * 3.6
        : 0;
      const abruptGhostJump =
        !trustDopplerInTrip
        && !gpsGapResumeTick
        && tripActiveNow
        && rawGpsKmhForSpike >= 25
        && rawGpsKmhForSpike <= 55
        && kmh >= 22
        && (kmh - prevReliableKmh) >= 18
        && sustainedKmh < 6
        && netMoveM < 18;
      if (
        abruptGhostJump
        && !(rawGpsKmhForSpike >= 25 && netMoveM >= 12 && motionKmh >= 8)
      ) {
        kmh = 0;
        sanitizedSpeedMs = null;
        speedSignalHoldUntilRef.current = 0;
        lastReliableSpeedMsRef.current = null;
        vroomGpsLog('SPEED_ABRUPT_GHOST_REJECT', {
          rawGpsKmh: Number(rawGpsKmhForSpike.toFixed(1)),
          prevReliableKmh: Number(prevReliableKmh.toFixed(1)),
          kmh: Number(kmh.toFixed(1)),
          sustainedKmh: Number((sustainedKmh || 0).toFixed(1)),
          netMoveM: Math.round(netMoveM || 0),
        }, 1200);
      }
      // Na Androidzie po clampie skoku doppler bywa chwilowo 0 km/h.
      // Nie ubijaj wtedy od razu HUD/DR — utrzymaj krótko poprzednią, łagodnie
      // wygaszaną prędkość, dopóki kolejne ticki nie potwierdzą zatrzymania.
      if (
        tripActiveNow
        && isDrivingRef.current
        && drivingJumpClampActive
        && kmh < 2
        && speedKmhRef.current >= 8
      ) {
        const carryKmh = Math.max(8, speedKmhRef.current * 0.92);
        kmh = Math.min(MAX_REALISTIC_DRIVING_KMH, carryKmh);
        sanitizedSpeedMs = kmh / 3.6;
        vroomGpsLog('SPEED_JUMP_CLAMP_HOLD', {
          carryKmh: Number(carryKmh.toFixed(1)),
          prevKmh: Number(speedKmhRef.current.toFixed(1)),
          rawGpsKmh: Number(rawGpsKmhForSpike.toFixed(1)),
        }, 1200);
      }
      if (
        tripActiveNow
        && isDrivingRef.current
        && kmh < 2
        && jumpAnomalyDrUntilRef.current > now
        && jumpAnomalyCarrySpeedMsRef.current != null
      ) {
        const totalMs = 5000;
        const remainingMs = Math.max(0, jumpAnomalyDrUntilRef.current - now);
        const fade = Math.max(0.45, remainingMs / totalMs);
        const carriedMs = jumpAnomalyCarrySpeedMsRef.current * fade;
        if (carriedMs >= 1.35) {
          kmh = Math.min(MAX_REALISTIC_DRIVING_KMH, carriedMs * 3.6);
          sanitizedSpeedMs = carriedMs;
          vroomGpsLog('SPEED_EXTENDED_DR_HOLD', {
            kmh: Number(kmh.toFixed(1)),
            remainingMs,
            fade: Number(fade.toFixed(2)),
          }, 1200);
        }
      } else if (jumpAnomalyDrUntilRef.current > 0 && jumpAnomalyDrUntilRef.current <= now) {
        jumpAnomalyDrUntilRef.current = 0;
        jumpAnomalyCarrySpeedMsRef.current = null;
      }
      if (
        tripActiveNow
        && sanitizedSpeedMs == null
        && (motionKmh >= 4 || netMoveM >= 5 || pathMoveM >= 8 || sustainedKmh >= 2.5)
        && (lastReliableSpeedMsRef.current != null || speedKmhRef.current >= 4)
      ) {
        speedSignalHoldUntilRef.current = Math.max(
          speedSignalHoldUntilRef.current,
          now + 2200,
        );
      }
      const holdActive = Date.now() < speedSignalHoldUntilRef.current;
      if (
        tripActiveNow
        && holdActive
        && sanitizedSpeedMs == null
        && trustDopplerInTrip
        && rawGpsKmhForSpike >= 15
        && rawGpsKmhForSpike < 65
        && netMoveM >= 12
        && motionKmh >= 6
      ) {
        const recoveredKmh = Math.min(
          MAX_REALISTIC_DRIVING_KMH,
          Math.max(rawGpsKmhForSpike * 0.92, 8),
        );
        kmh = recoveredKmh;
        sanitizedSpeedMs = recoveredKmh / 3.6;
        vroomGpsLog('SPEED_HOLD_DOPPLER_OVERRIDE', {
          recoveredKmh: Number(recoveredKmh.toFixed(1)),
          rawGpsKmh: Number(rawGpsKmhForSpike.toFixed(1)),
          netMoveM: Math.round(netMoveM),
        }, 1500);
      } else if (
        tripActiveNow
        && holdActive
        && sanitizedSpeedMs == null
        && (netMoveM >= 10 || pathMoveM >= 8)
        && (motionKmh >= 6 || sustainedKmh >= 4)
      ) {
        const recoveredKmh = Math.min(
          MAX_REALISTIC_DRIVING_KMH,
          Math.max(
            kmh,
            motionKmh * 0.78,
            sustainedKmh * 0.92,
            5,
          ),
        );
        if (recoveredKmh > kmh) {
          kmh = recoveredKmh;
          sanitizedSpeedMs = recoveredKmh / 3.6;
          vroomGpsLog('SPEED_HOLD_MOTION_OVERRIDE', {
            recoveredKmh: Number(recoveredKmh.toFixed(1)),
            motionKmh: Number(motionKmh.toFixed(1)),
            sustainedKmh: Number(sustainedKmh.toFixed(1)),
            rawGpsKmh: Number(rawGpsKmhForSpike.toFixed(1)),
            netMoveM: Math.round(netMoveM),
          }, 1500);
        }
      }
      if (
        !parkedLikeNow
        && trustDopplerInTrip
        && kmh < 8
        && netMoveM >= tripStandstillNetM(kmh, motionKmh)
      ) {
        kmh = Math.min(MAX_REALISTIC_DRIVING_KMH, rawGpsKmhForSpike);
        sanitizedSpeedMs = kmh / 3.6;
      }
      kmh = clampSpeedKmhToGeometry(kmh, {
        netMoveM,
        sustainedKmh,
        motionKmh,
        rawGpsKmh: rawGpsKmhForSpike,
        isTripActive: tripActiveNow,
      });
      if (
        tripActiveNow
        && kmh < 3
        && pathMoveM >= 8
        && (motionKmh >= 2.5 || derivedKmhEarly >= 2.5 || rawGpsKmhForSpike >= 2.5)
      ) {
        const crawlKmh = Math.min(
          MAX_REALISTIC_DRIVING_KMH,
          Math.max(
            motionKmh,
            derivedKmhEarly * 0.92,
            rawGpsKmhForSpike,
            speedKmhRef.current * 0.9,
            4,
          ),
        );
        kmh = crawlKmh;
        sanitizedSpeedMs = crawlKmh / 3.6;
      }
      if (
        !parkedLikeNow
        && !tripMarkerFrozen
        && trustDopplerInTrip
        && kmh < 8
        && rawGpsKmhForSpike < 70
        && netMoveM >= tripStandstillNetM(kmh, motionKmh)
        && motionKmh >= 6
      ) {
        kmh = Math.min(90, rawGpsKmhForSpike);
        sanitizedSpeedMs = kmh / 3.6;
      }
      if (
        tripActiveNow
        && isDrivingRef.current
        && !parkedLikeNow
        && !tripMarkerFrozen
        && rawGpsMotionDetected
        && (rawGpsKmhForSpike >= 6 || motionKmh >= 6 || netMoveM >= 6 || pathMoveM >= 8)
        && kmh < 4
      ) {
        const recoveredKmh = Math.min(
          MAX_REALISTIC_DRIVING_KMH,
          Math.max(rawGpsKmhForSpike, motionKmh, sustainedKmh, 6),
        );
        kmh = recoveredKmh;
        sanitizedSpeedMs = recoveredKmh / 3.6;
        speedKmhRef.current = recoveredKmh;
      }
      if (tripActiveNow && (isDrivingRef.current || isNavigatingRef.current)) {
        const teleportAnchor =
          lastGoodLocRef.current
          ?? lastSetLocRef.current;
        if (
          teleportAnchor
          && isImplausibleGpsTeleport(
            teleportAnchor,
            rawLat,
            rawLng,
            speedDtMs,
            sanitizedSpeedMs ?? 0,
            kmh,
            motionKmh,
            netMoveM,
            rawGpsKmhForSpike,
          )
        ) {
          const stepM = rawStepFromAnchorM(teleportAnchor, rawLat, rawLng);
          markerLogCritical('GPS_TELEPORT_REJECT', {
            stepM: Math.round(stepM),
            rawGpsKmh: Math.round(rawGpsKmhForSpike),
            kmh: Math.round(kmh),
            netMoveM: Math.round(netMoveM),
            motionKmh: Math.round(motionKmh),
            accM: loc.accuracy != null ? Math.round(loc.accuracy) : null,
          });
          kmh = 0;
          sanitizedSpeedMs = null;
          rawGpsKmhRef.current = 0;
          rawGpsKmhForSpike = 0;
          speedSignalHoldUntilRef.current = 0;
          lastReliableSpeedMsRef.current = null;
          speedKmhRef.current = 0;
          emitSpeedometerKmh(0);
          const fgRefreshTeleport =
            tripForegroundRefreshUntilRef.current > now
            && tripActiveNow;
          if (
            (
              stepM > 50
              || (
                stepM > 10
                && (tripMarkerFrozen || parkedLikeNow || kmh < 5 || motionKmh < 8)
              )
            )
            && !fgRefreshTeleport
          ) {
            pushGpsDebugFix({
              lat: rawLat,
              lng: rawLng,
              acc,
              speedKmh: 0,
              accepted: false,
              reason: 'teleport_tick_aborted',
            });
            return;
          }
          const c = clampCoordStep(
            { latitude: teleportAnchor.lat, longitude: teleportAnchor.lng },
            { latitude: rawLat, longitude: rawLng },
            maxPlausibleDrivingStepM(0, 0),
          );
          rawLat = c.latitude;
          rawLng = c.longitude;
        }
      }
      let accelBypassActive = !!preKalmanAccel?.active;
      const accelAfterSpeed = updateTripAccelBypass({
        rawGpsKmh: rawGpsKmhForSpike,
        feedSpeedKmh: speedKmhRef.current,
        rawToSnapM: lastSetLocRef.current
          ? haversineKm(lastSetLocRef.current.lat, lastSetLocRef.current.lng, rawLat, rawLng) * 1000
          : 0,
        netMoveM,
        tripActive: tripActiveNow,
        markerFrozen: tripMarkerFrozen,
      });
      if (accelAfterSpeed?.active) {
        accelBypassActive = true;
        if (accelAfterSpeed.reason !== 'hold') {
          gpsTelemetryRef.current.accelBypass += 1;
          vroomGpsLog('ACCEL_BYPASS', {
            reason: accelAfterSpeed.reason,
            rawGpsKmh: Math.round(rawGpsKmhForSpike),
            feedKmh: Math.round(speedKmhRef.current),
            netMoveM: Math.round(netMoveM),
          }, 900);
        }
      }
      const launchFromStop =
        tripActiveNow
        && !tripMarkerFrozen
        && (tripAccelState.prevFeedSpeedKmh < 8 || speedKmhRef.current < 8)
        && Math.max(kmh, rawGpsKmhForSpike, motionKmh) >= 15
        && netMoveM >= 12
        && pathMoveM >= 14
        && sustainedKmh >= 5
        && motionKmh >= 8
        && (Number.isFinite(rawStepParkM) ? rawStepParkM >= 6 : true)
        && now - tripAccelState.launchResetAtMs > 6000;
      if (launchFromStop) {
        tripAccelState.launchResetAtMs = now;
        accelBypassActive = true;
        gpsTelemetryRef.current.launchFromStopReset += 1;
        vroomGpsLog('ACCEL_LAUNCH_RESET', {
          rawGpsKmh: Math.round(rawGpsKmhForSpike),
          kmh: Math.round(kmh),
          motionKmh: Math.round(motionKmh),
        }, 2000);
      }
      const wouldStationaryHold = isWorkletStationaryHold(
        parkedLikeNow,
        kmh,
        rawGpsKmhForSpike,
        motionKmh,
        netMoveM,
        false,
        isDrivingRef.current,
        coordsFrozenDrivingTick,
      );
      const physicalMovementEvidence =
        rawGpsMotionDetected
        || motionKmh >= 8
        || (netMoveM >= 8 && pathMoveM >= 10)
        || (speedKmhRaw >= 8 && netMoveM >= 6);
      const drivingMotionActive =
        isDrivingRef.current
        && (
          motionKmh > 3.5
          || netMoveM >= 5
          || pathMoveM >= 7
          || sustainedKmh >= 3
          || (rawGpsKmhForSpike >= 6 && (netMoveM >= 4 || pathMoveM >= 6))
        );
      if (wouldStationaryHold && accelBypassActive && tripActiveNow) {
        gpsTelemetryRef.current.stationaryHoldBlocked += 1;
      } else if (wouldStationaryHold && tripActiveNow && !physicalMovementEvidence && !drivingMotionActive) {
        kmh = 0;
        sanitizedSpeedMs = 0;
        speedSignalHoldUntilRef.current = 0;
        lastReliableSpeedMsRef.current = null;
      } else if (wouldStationaryHold && physicalMovementEvidence) {
        gpsTelemetryRef.current.stationaryHoldBlocked += 1;
        const recoveredKmh = Math.min(
          MAX_REALISTIC_DRIVING_KMH,
          Math.max(kmh, rawGpsKmhForSpike, rawGpsKmhRef.current, motionKmh, 8),
        );
        kmh = recoveredKmh;
        sanitizedSpeedMs = recoveredKmh / 3.6;
        lastReliableSpeedMsRef.current = sanitizedSpeedMs;
        speedSignalHoldUntilRef.current = Math.max(speedSignalHoldUntilRef.current, now + 1200);
      } else if (
        tripActiveNow
        && isDrivingRef.current
        && !parkedLikeNow
        && rawGpsKmhForSpike >= 15
        && rawGpsKmhForSpike < 55
        && kmh < 8
        && netMoveM >= 10
        && pathMoveM >= 14
        && sustainedKmh >= 5
        && lastGoodLocRef.current
        && rawStepFromAnchorM(lastGoodLocRef.current, rawLat, rawLng)
          <= maxPlausibleDrivingStepM(rawGpsKmhForSpike / 3.6, rawGpsKmhForSpike) * 1.25
      ) {
        kmh = Math.min(MAX_REALISTIC_DRIVING_KMH, rawGpsKmhForSpike);
        sanitizedSpeedMs = kmh / 3.6;
        lastReliableSpeedMsRef.current = sanitizedSpeedMs;
      } else if (
        tripActiveNow
        && coordsFrozenDrivingTick
        && !parkedLikeNow
        && rawGpsKmhForSpike >= 8
        && rawGpsKmhForSpike < 45
        && kmh < 6
        && netMoveM < 18
        && pathMoveM >= 12
        && sustainedKmh >= 4
      ) {
        const frozenKmh = Math.min(
          MAX_REALISTIC_DRIVING_KMH,
          Math.max(rawGpsKmhForSpike * 0.94, 6),
        );
        kmh = frozenKmh;
        sanitizedSpeedMs = frozenKmh / 3.6;
        lastReliableSpeedMsRef.current = sanitizedSpeedMs;
      }
      const speedTrustedForPeaks =
        (motionKmh >= 6 || sustainedKmh >= 4 || netMoveM >= 14)
        && (!tripActiveNow || kmh <= MAX_SPEED_HUD_KMH);
      const hardStationarySpeedGate =
        tripActiveNow
        && isDrivingRef.current
        && netMoveM < 6
        && pathMoveM < 8
        && sustainedKmh < 2.5
        && motionKmh < 3
        && rawGpsKmhForSpike < 60
        && (Number.isFinite(rawStepParkM) ? rawStepParkM < 2.5 : true);
      const drivingColdStartStationaryGate =
        tripActiveNow
        && isDrivingRef.current
        && now - drivingSinceRef.current <= 12_000
        && netMoveM < 10
        && pathMoveM < 14
        && sustainedKmh < 4
        && motionKmh < 5
        && (Number.isFinite(rawStepParkM) ? rawStepParkM < 5 : true);
      if (hardStationarySpeedGate) {
        kmh = 0;
        sanitizedSpeedMs = 0;
        speedSignalHoldUntilRef.current = 0;
        lastReliableSpeedMsRef.current = null;
      } else if (drivingColdStartStationaryGate) {
        kmh = 0;
        sanitizedSpeedMs = 0;
        speedSignalHoldUntilRef.current = 0;
        lastReliableSpeedMsRef.current = null;
      }
      speedKmhRef.current = kmh;
      if (tripActiveNow) {
        const prevEmit = lastSpeedEmitRef.current;
        const nowK = Date.now();
        const dtSec = prevEmit ? Math.max(0.05, (nowK - prevEmit.at) / 1000) : 0.2;
        const prevKmh = prevEmit ? prevEmit.kmh : kmh;
        // Anti-teleport for HUD/speed pipe: cap acceleration/deceleration per second.
        const maxUpPerSec = tripSpeedWarmupActive ? 12 : 22;
        const maxDownPerSec = 18;
        const maxUp = maxUpPerSec * dtSec;
        const maxDown = maxDownPerSec * dtSec;
        let smoothKmh = kmh;
        if (smoothKmh > prevKmh + maxUp) smoothKmh = prevKmh + maxUp;
        if (smoothKmh < prevKmh - maxDown) smoothKmh = prevKmh - maxDown;
        const movementEvidence =
          (rawGpsKmhForSpike >= 8 && (netMoveM >= 6 || pathMoveM >= 8 || sustainedKmh >= 4))
          || motionKmh >= 6
          || sustainedKmh >= 6
          || netMoveM >= 8
          || pathMoveM >= 10;
        // Anti false zero while vehicle still moves (nie na postoju / ghost Doppler).
        if (
          movementEvidence
          && !parkedLikeNow
          && !tripMarkerFrozen
          && !hardStationarySpeedGate
          && rawGpsMotionDetected
          && smoothKmh < 1.5
          && prevKmh >= 8
        ) {
          smoothKmh = Math.max(4, prevKmh * 0.7);
        }
        kmh = Math.max(0, Math.min(MAX_REALISTIC_DRIVING_KMH, smoothKmh));
        if (
          (parkedLikeNow || tripMarkerFrozen || hardStationarySpeedGate)
          && !rawGpsMotionDetected
        ) {
          kmh = 0;
        }
        speedKmhRef.current = kmh;
        if (kmh > 0.5) sanitizedSpeedMs = kmh / 3.6;
      }
      if (
        true
        && tripActiveNow
        && tripForegroundRefreshUntilRef.current > now
        && !hardStationarySpeedGate
        && !drivingColdStartStationaryGate
        && kmh < 10
        && (
          motionKmh >= 6
          || pathMoveM >= 8
          || netMoveM >= 8
          || (rawGpsKmhForSpike >= 8 && (netMoveM >= 6 || sustainedKmh >= 4))
        )
      ) {
        const refreshKmh = Math.max(
          kmh,
          rawGpsKmhForSpike * 0.88,
          motionKmh * 0.88,
          10,
        );
        kmh = Math.min(MAX_REALISTIC_DRIVING_KMH, refreshKmh);
        speedKmhRef.current = kmh;
        sanitizedSpeedMs = kmh / 3.6;
        lastReliableSpeedMsRef.current = sanitizedSpeedMs;
        emitSpeedometerKmh(kmh);
      }
      if (gpsResumeSoftHoldSkipRef.current) {
        gpsResumeSoftHoldSkipRef.current = false;
        tripResumeFreezeUntilRef.current = 0;
        tripResumeAnchorRef.current = null;
        vroomGpsLog('RESUME_SOFT_HOLD_RELEASE', {
          kmh: Math.round(kmh),
          rawGpsKmh: Math.round(rawGpsKmhForSpike),
          pathMoveM: Math.round(pathMoveM),
        }, 1200);
      }
      const speedPublishMeta = {
        lat: rawLat,
        lng: rawLng,
        now,
        dtMs: speedDtMs,
        netMoveM,
        pathMoveM,
        sustainedKmh,
        motionKmh,
        rawGpsKmh: rawGpsKmhForSpike,
      };
      const drInputSpeedMs = (() => {
        if (parkedLikeNow) return 0;
        if (kmh < 5 && netMoveM < 14 && motionKmh < 10) return 0;
        const standstillNetM = tripStandstillNetM(kmh, motionKmh);
        const still =
          netMoveM < standstillNetM
          && sustainedKmh < 3.5
          && motionKmh < 2.5
          && rawGpsKmhForSpike < 2.5;
        if (still) return 0;
        if (trustDopplerInTrip && rawGpsKmhForSpike >= 8) {
          return Math.min(MAX_REALISTIC_DRIVING_KMH, Math.max(kmh, rawGpsKmhForSpike)) / 3.6;
        }
        if (rawGpsKmhForSpike >= 8 && kmh >= 6) {
          return Math.min(MAX_REALISTIC_DRIVING_KMH, Math.max(kmh, rawGpsKmhForSpike)) / 3.6;
        }
        if (sanitizedSpeedMs != null && sanitizedSpeedMs > 0) return sanitizedSpeedMs;
        if (motionKmh >= 2.5 && netMoveM >= 3) return motionKmh / 3.6;
        if (kmh > 0.8) return kmh / 3.6;
        if (motionKmh >= 4 && netMoveM >= 8) return motionKmh / 3.6;
        return 0;
      })();
      if (tripActiveNow) {
        const prevSpeedDiag = lastSpeedDiagRef.current;
        const rawGpsKmh = rawSpeedMs != null ? rawSpeedMs * 3.6 : null;
        const speedDeltaKmh = prevSpeedDiag ? Math.abs(kmh - prevSpeedDiag.kmh) : 0;
        vroomGpsLog('SPEED_PIPE', {
          mode: isNavigatingRef.current ? 'navigation' : 'driving',
          rawGpsKmh: rawGpsKmh != null ? Number(rawGpsKmh.toFixed(1)) : null,
          sanitizedKmh: Number(kmh.toFixed(1)),
          motionKmh: Number((motionKmh || 0).toFixed(1)),
          sustainedKmh: Number((sustainedKmh || 0).toFixed(1)),
          netMoveM: Math.round(netMoveM || 0),
          dtMs: Math.round(speedDtMs),
          holdActive,
        }, 1000);
        if (
          rawGpsKmh != null
          && rawGpsKmh >= 8
          && kmh < rawGpsKmh * 0.55
        ) {
          vroomGpsLog('SPEED_UNDER_REPORT', {
            rawGpsKmh: Number(rawGpsKmh.toFixed(1)),
            sanitizedKmh: Number(kmh.toFixed(1)),
            motionKmh: Number((motionKmh || 0).toFixed(1)),
            sustainedKmh: Number((sustainedKmh || 0).toFixed(1)),
            netMoveM: Math.round(netMoveM || 0),
          }, 500);
        }
        if (
          prevSpeedDiag
          && rawGpsKmh != null
          && rawGpsKmh >= 6
          && speedDeltaKmh < 0.5
          && now - prevSpeedDiag.at > 3000
        ) {
          vroomGpsLog('SPEED_STUCK_SUSPECT', {
            rawGpsKmh: Number(rawGpsKmh.toFixed(1)),
            shownKmh: Number(kmh.toFixed(1)),
            ageMs: Math.round(now - prevSpeedDiag.at),
          }, 1000);
        }
        if (!prevSpeedDiag || speedDeltaKmh >= 0.5) {
          lastSpeedDiagRef.current = { kmh, at: now };
        }
      }
      const safeDtForSnappedUi = Math.max(100, now - prevGoodTimeRef.current);

      // ══ 4. (feed speed — przeniesione na koniec callbacku) ═══════════════════

      // ══ 5/6 moved below ═══════════════════════════════════════
      // For navigation we update distance + DR after snapping to route.

      // ══ 7. Heading ═══════════════════════════════════════════
      // In driving mode, heading is derived from the movement vector
      // (calculated below in the driving pipeline after snapping).
      // For idle browse mode, use the GPS-reported heading.
      // Navigation heading is resolved from route geometry later in this callback.
      if (!isDrivingRef.current && !isNavigatingRef.current) {
        const newH = loc.heading ?? lastHeadingRef.current;
        if (kmh > 3 && newH >= 0) {
          const normalizedDiff = ((newH - lastHeadingRef.current + 540) % 360) - 180;
          if (Math.abs(normalizedDiff) > 2) {
            const finalHeading = smoothHeading(lastHeadingRef.current, newH, 0.4, 180);
            publishHeading(finalHeading);
            lastHeadingRef.current = finalHeading;
          }
        }
      }

      // ══ 8. Pozycja + driving mode ════════════════════════════
      if (!isNavigatingRef.current) {

        const movedForSnapEarly = lastSetLocRef.current
          ? haversineKm(lastSetLocRef.current.lat, lastSetLocRef.current.lng, lat, lng) * 1000
          : Infinity;
        const movedRawEarly = lastSetLocRef.current
          ? haversineKm(lastSetLocRef.current.lat, lastSetLocRef.current.lng, rawLat, rawLng) * 1000
          : Infinity;
        const likelyDriving =
          !parkedLikeNow
          && (
            isDrivingRef.current
            || motionKmh >= DRIVING_SPEED_KMH
            || (kmh >= DRIVING_SPEED_KMH && (motionKmh >= 4 || netMoveM >= 6 || sustainedKmh >= 3))
            || movedRawEarly >= 18
            || (movedRawEarly >= 12 && motionKmh >= 4)
          );

        // Przeglądanie mapy bez jazdy: prosty GPS (bez snapu / still-lock), ale licz km przy ruchu.
        if (!likelyDriving) {
          const browseAnchor = lastSetLocRef.current;
          const browseMovedRawM = browseAnchor
            ? haversineKm(browseAnchor.lat, browseAnchor.lng, rawLat, rawLng) * 1000
            : Infinity;
          const browseMovedFilteredM = browseAnchor
            ? haversineKm(browseAnchor.lat, browseAnchor.lng, lat, lng) * 1000
            : Infinity;
          if (
            browseAnchor
            && motionKmh < 3
            && browseMovedRawM < MIN_MOVE_M
            && browseMovedFilteredM < MIN_MOVE_M + 3
          ) {
            publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });
            const sinceBrowseUi = now - lastBrowseMarkerPublishRef.current;
            if (sinceBrowseUi < 900) {
              rollbackIdleAnchor();
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: false,
                reason: 'browse_stationary_deadzone',
              });
              return;
            }
            lastBrowseMarkerPublishRef.current = now;
          }
          lastSetLocRef.current = { lat, lng };
          lastGoodLocRef.current = { lat, lng };
          const browseHdg =
            loc.heading != null && loc.heading >= 0 && kmh > 2
              ? loc.heading
              : lastHeadingRef.current;
          // Przeglądanie mapy: surowy GPS — soft-snap na starej geometrii drogi powodował teleporty.
          bumpMapMarker(lat, lng);
          publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });
          const likelyMotorMotion =
            motionKmh >= 6
            || kmh >= 6
            || browseMovedRawM >= 24
            || browseMovedFilteredM >= 20;
          if (likelyMotorMotion && appStateRef.current === 'active') {
            const segKm = feedPosition(lat, lng, sanitizedSpeedMs ?? undefined, Number.isFinite(acc) ? acc : null);
            if (segKm > 0) {
              recordDrivingTracePoint(lat, lng, { speedKmh: kmh }).catch(() => {});
              maybeClearDrivingManualDisable(segKm, now);
            }
          }
          return;
        }

        // ── DAP-to-Road: refresh snap points + conditionally feed map matcher ──
        // Do this before snapping so the latest matched road is available.

        // Always pull the latest matched road segment into the snap hook.
        // This picks up forceMatch results (called on driving mode entry) even
        // when the user is stationary and no new points have been fed.
        const movedForSnap = movedForSnapEarly;
        const movingForDriving =
          !parkedLikeNow
          && (
            motionKmh >= DRIVING_SPEED_KMH
            || (kmh >= DRIVING_SPEED_KMH && (motionKmh >= 4 || netMoveM >= 6 || sustainedKmh >= 3))
            || movedRawEarly >= 18
            || (movedRawEarly >= 12 && motionKmh >= 4)
          );

        if (movingForDriving || drivingConsecutiveRef.current >= 1) {
          if (!gpsForceActiveRef.current) {
            gpsForceActiveRef.current = true;
            applyGpsForceActive(true);
          }
        } else if (
          !isDrivingRef.current
          && !isNavigatingRef.current
          && drivingConsecutiveRef.current === 0
          && gpsForceActiveRef.current
        ) {
          gpsForceActiveRef.current = false;
          applyGpsForceActive(false);
        }

        const matchedPts = getMatchedPoints();
        const noRoad = !matchedPts || matchedPts.length < 2;
        const matchSpeedKmh = Math.max(kmh, motionKmh, sustainedKmh);
        const drivingMapboxGateOk = canRequestMapMatch({
          lat: rawLat,
          lng: rawLng,
          speedKmh: matchSpeedKmh,
          accuracyM: loc.accuracy ?? null,
        }).ok;
        if (matchedPts && matchedPts.length > 1) {
          applyRoadMatchPoints(matchedPts);
          if (isDrivingRef.current) {
            bumpMatchedFreshness();
            markClientFirstGeometryHealthy('memory');
            clearClientFirstNoRoad();
          }
        } else if (isDrivingRef.current && noRoad) {
          markClientFirstNoRoad();
          const nowCf = Date.now();
          if (nowCf - lastClientFirstResolveRef.current >= CLIENT_FIRST_RESOLVE_MIN_MS) {
            lastClientFirstResolveRef.current = nowCf;
            void resolveLocalRoadPolylineForMatch(lat, lng).then((local) => {
              if (!isDrivingRef.current || !local || local.points.length < 2) return;
              vroomGpsLog('CLIENT_FIRST_GEOM', { source: local.source, pts: local.points.length });
              applyRoadMatchPoints(local.points);
              bumpMatchedFreshness();
              markClientFirstGeometryHealthy(local.source);
              clearClientFirstNoRoad();
            });
          }
        } else if (
          !isDrivingRef.current
          && movingForDriving
          && drivingConsecutiveRef.current === 1
        ) {
          if (kmh >= DRIVING_ENTRY_STATIONARY_KMH) {
            runMapMatchRecovery(
              { reason: 'PRE_DRIVE', lat, lng, speedKmh: kmh },
              (p) => { if (p && p.length >= 2) applyRoadMatchPoints(p); },
            );
          }
        }

        const accStrict = (loc.accuracy ?? 999) <= 48;
        const accRelaxedDriving = (loc.accuracy ?? 999) <= 100;
        const accForMatch = isDrivingRef.current ? accRelaxedDriving : accStrict;
        const staleSnapHintEarly =
          (snapAnchorStaleRef.current?.streak ?? 0) >= 3;

        // Twardy snap: zawsze przy aktywnym driving; przed auto-wejściem — ostatnia seria ticków.
        const hardRoadSnap =
          isDrivingRef.current
          || isNavigatingRef.current
          || drivingManualModeRef.current
          || (
            movingForDriving
            && drivingConsecutiveRef.current >= DRIVING_CONSECUTIVE_REQ - 1
            && !drivingManuallyDisabledRef.current
          );

        const snapSpeedKmh = Math.max(
          kmh,
          motionKmh,
          sustainedKmh,
          rawGpsKmhForSpike >= 15 ? rawGpsKmhForSpike * 0.85 : 0,
          derivedKmhEarly > 0 ? derivedKmhEarly : 0,
        );
        const stationaryHoldAnchor =
          lastDrivingPosRef.current
          ?? lastSetLocRef.current
          ?? (lastGoodLocRef.current
            ? { lat: lastGoodLocRef.current.lat, lng: lastGoodLocRef.current.lng }
            : null);
        const snapMovementEvidence =
          (rawGpsKmhForSpike >= 10 && (netMoveM >= 6 || pathMoveM >= 8 || sustainedKmh >= 4))
          || (Number.isFinite(rawStepParkM) && rawStepParkM >= 4)
          || netMoveM >= 6
          || motionKmh >= 6;
        const isPhysicallyStationary = !TRIP_PIPELINE_SIMPLE
          && isDrivingRef.current
          && !snapMovementEvidence
          && speedKmhRaw < 4.5
          && netMoveM < 12
          && motionKmh < 5
          && sustainedKmh < 4
          && (Number.isFinite(rawStepParkM) ? rawStepParkM < 2 : true)
          && !!stationaryHoldAnchor;
        let snapped: {
          latitude: number;
          longitude: number;
          snapped: boolean;
          targetHeading: number;
        };
        if (
          isPhysicallyStationary
          && stationaryHoldAnchor
          && !accelBypassActive
          && rawGpsKmhForSpike < 4
        ) {
          snapped = {
            latitude: stationaryHoldAnchor.lat,
            longitude: stationaryHoldAnchor.lng,
            snapped: true,
            targetHeading: lastHeadingRef.current,
          };
        } else {
          const snapInputLat = isDrivingRef.current ? rawLat : lat;
          const snapInputLng = isDrivingRef.current ? rawLng : lng;
          snapped = {
            latitude: snapInputLat,
            longitude: snapInputLng,
            snapped: false,
            targetHeading: lastHeadingRef.current,
          };
        }
        let rawToSnapAfterSnapM = haversineKm(rawLat, rawLng, snapped.latitude, snapped.longitude) * 1000;
        navDriveTrace('SNAP', {
          snapped: snapped.snapped,
          snapLat: Number(snapped.latitude.toFixed(6)),
          snapLng: Number(snapped.longitude.toFixed(6)),
          rawToSnapM: Math.round(rawToSnapAfterSnapM),
          roadPts: drivingSnapGeometryRef.current.length,
          snapSpeedKmh: Math.round(snapSpeedKmh),
          hardRoadSnap,
          physStationary: isPhysicallyStationary,
          hdg: Math.round(snapped.targetHeading),
        });
        const snapIntervalSec = Math.max(0.25, Math.min(2.5, speedDtMs / 1000));
        const snapCapSpeedKmh = Math.max(kmh, rawGpsKmhForSpike, motionKmh, sustainedKmh);
        if (
          !tripMarkerFrozen
          && (accelBypassActive || launchFromStop)
          && (isDrivingRef.current || isNavigatingRef.current)
        ) {
          const roadPtsAccel = drivingSnapGeometryRef.current;
          if (roadPtsAccel.length >= 2) {
            const onRoad = projectOntoDrivingRoad(
              rawLat,
              rawLng,
              rawLat,
              rawLng,
              roadPtsAccel,
              120,
            );
            if (onRoad) {
              snapped = {
                ...snapped,
                latitude: onRoad.latitude,
                longitude: onRoad.longitude,
                snapped: true,
              };
            }
          } else if (launchFromStop) {
            snapped = {
              ...snapped,
              latitude: rawLat,
              longitude: rawLng,
              snapped: false,
            };
          }
          if (launchFromStop) {
            kmh = Math.min(MAX_REALISTIC_DRIVING_KMH, snapCapSpeedKmh);
            sanitizedSpeedMs = kmh / 3.6;
            speedKmhRef.current = kmh;
          }
        }
        if ((isDrivingRef.current || isNavigatingRef.current) && rawToSnapAfterSnapM >= 15) {
          gpsTelemetryRef.current.snapLagCatchup += 1;
          vroomGpsLog('SNAP_LAG', {
            mode: isNavigatingRef.current ? 'navigation' : 'driving',
            kmh: Math.round(kmh),
            rawToSnapM: Math.round(rawToSnapAfterSnapM),
            hardRoadSnap,
            roadPts: drivingSnapGeometryRef.current.length,
            snapped: snapped.snapped,
          }, 800);
        }
        let snapLifecycleStage: string = snapped.snapped ? 'snap_matched' : 'snap_miss';
        if (
          !Number.isFinite(snapped.latitude)
          || !Number.isFinite(snapped.longitude)
          || isNullIsland(snapped.latitude, snapped.longitude)
        ) {
          console.warn('[GPS map] drivingSnap produced non-finite coord');
          if (hardRoadSnap) {
            const fallbackHdg = lastHeadingRef.current || 0;
            const hold = lastSetLocRef.current ?? lastGoodLocRef.current;
            if (hold) {
}
            publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });
          }
          return;
        }
        let appliedSnap = snapped;
        if (
          tripMarkerFrozen
          && (isDrivingRef.current || isNavigatingRef.current)
        ) {
          const pinRef =
            lastSetLocRef.current
            ?? lastDrivingPosRef.current
            ?? (lastGoodLocRef.current
              ? { lat: lastGoodLocRef.current.lat, lng: lastGoodLocRef.current.lng }
              : null);
          if (pinRef) {
            const frozen = freezeMarkerOnRoad(
              pinRef,
              drivingSnapGeometryRef.current,
            );
            appliedSnap = {
              ...appliedSnap,
              latitude: frozen.lat,
              longitude: frozen.lng,
              snapped: frozen.snapped || appliedSnap.snapped,
            };
            accelBypassActive = false;
          }
        }
        if (hardRoadSnap && !snapped.snapped) {
          // v10.12: NIGDY nie rzucaj markera na surowy GPS w jazdzie gdy mamy kotwice.
          // Surowy GPS = skok poza droge + freeze + teleport gdy snap wraca.
          // Zamiast tego: krokowe podejscie do raw (max 12-18m/tick) albo hold anchor.
          if (true && isDrivingRef.current) {
            const hold = lastSetLocRef.current ?? lastGoodLocRef.current ?? lastDrivingPosRef.current;
            if (hold) {
              const rawDriftM = haversineKm(hold.lat, hold.lng, lat, lng) * 1000;
              const snapFailAgeMs = lastSnapSuccessAtRef.current > 0
                ? Date.now() - lastSnapSuccessAtRef.current
                : 9999;
              const roadPts = drivingSnapGeometryRef.current;
              const c = resolveV10SnapFailPosition(
                hold,
                lat,
                lng,
                kmh,
                roadPts,
                snapFailAgeMs,
                rawDriftM,
                Math.max(rawGpsKmhRef.current, motionKmh, rawGpsKmhForSpike),
              );
              snapLifecycleStage = 'resolve_v10_snap_fail';
              appliedSnap = {
                ...snapped,
                latitude: c.latitude,
                longitude: c.longitude,
                snapped: true,
              };
            } else {
              const lastHold = lastSetLocRef.current ?? lastGoodLocRef.current;
              if (lastHold) {
                snapLifecycleStage = 'snap_fail_hold_last_set';
                appliedSnap = {
                  ...snapped,
                  latitude: lastHold.lat,
                  longitude: lastHold.lng,
                  snapped: true,
                };
              } else {
                const roadPtsLeak = drivingSnapGeometryRef.current;
                if (roadPtsLeak.length >= 2) {
                  const onRoad = projectOntoDrivingRoad(lat, lng, rawLat, rawLng, roadPtsLeak, 55);
                  snapLifecycleStage = onRoad ? 'snap_fail_project_road' : 'snap_fail_no_hold_raw_leak';
                  appliedSnap = {
                    ...snapped,
                    latitude: onRoad?.latitude ?? lat,
                    longitude: onRoad?.longitude ?? lng,
                    snapped: !!onRoad,
                  };
                } else {
                  const emergencyHold = lastDrivingPosRef.current ?? lastGoodLocRef.current;
                  snapLifecycleStage = emergencyHold
                    ? 'snap_fail_no_hold_emergency_anchor'
                    : 'snap_fail_no_hold_raw_leak';
                  appliedSnap = emergencyHold
                    ? {
                      ...snapped,
                      latitude: emergencyHold.lat,
                      longitude: emergencyHold.lng,
                      snapped: true,
                    }
                    : {
                      ...snapped,
                      latitude: lat,
                      longitude: lng,
                      snapped: false,
                    };
                }
              }
            }
          } else {
            const anchor = resolveDrivingAnchor();
            if (!anchor) {
              if (isDrivingRef.current && lastSetLocRef.current) {
                appliedSnap = {
                  ...snapped,
                  latitude: lastSetLocRef.current.lat,
                  longitude: lastSetLocRef.current.lng,
                  snapped: true,
                };
              } else if (isDrivingRef.current && noRoad) {
                const hold = lastSetLocRef.current ?? lastDrivingPosRef.current;
                if (hold) {
                  const dynamicStepCap = drivingSnapDynamicStepCapM(
                    Math.max(kmh, speedKmhRef.current, rawGpsKmhRef.current),
                  );
                  const c = clampCoordStep(
                    { latitude: hold.lat, longitude: hold.lng },
                    { latitude: lat, longitude: lng },
                    dynamicStepCap,
                  );
                  appliedSnap = {
                    ...snapped,
                    latitude: c.latitude,
                    longitude: c.longitude,
                    snapped: true,
                  };
                }
              } else if (!isDrivingRef.current) {
                const idleHdg = lastHeadingRef.current || 0;
publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });
                return;
              }
            } else {
              const rawDistM = haversineKm(lat, lng, anchor.latitude, anchor.longitude) * 1000;
              if (kmh < DRIVING_ENTRY_STATIONARY_KMH) {
                vroomGpsLog('SNAP_FAIL_STATIONARY_HOLD', {
                  rawDistM: Math.round(rawDistM),
                  accM: loc.accuracy != null ? Math.round(loc.accuracy) : null,
                });
                appliedSnap = {
                  ...snapped,
                  latitude: anchor.latitude,
                  longitude: anchor.longitude,
                  snapped: true,
                };
              } else {
                const roadPtsFail = drivingSnapGeometryRef.current;
                const maxStepM = drivingSnapDynamicStepCapM(
                  snapCapSpeedKmh,
                  undefined,
                  { intervalSec: snapIntervalSec, accelBypass: accelBypassActive },
                );
                if (roadPtsFail.length >= 2) {
                  const rawOnRoad = projectOntoDrivingRoad(lat, lng, rawLat, rawLng, roadPtsFail, 55);
                  const goalLat = rawOnRoad?.latitude ?? anchor.latitude;
                  const goalLng = rawOnRoad?.longitude ?? anchor.longitude;
                  const stepped = stepTowardSnapOnPolyline(
                    anchor.latitude,
                    anchor.longitude,
                    goalLat,
                    goalLng,
                    roadPtsFail,
                    maxStepM,
                    88,
                  );
                  appliedSnap = {
                    ...snapped,
                    latitude: stepped.latitude,
                    longitude: stepped.longitude,
                    snapped: true,
                  };
                } else if (rawDistM <= 100) {
                  const blend = Math.min(1, rawDistM / 70) * 0.12;
                  appliedSnap = {
                    ...snapped,
                    latitude: anchor.latitude + (lat - anchor.latitude) * blend,
                    longitude: anchor.longitude + (lng - anchor.longitude) * blend,
                    snapped: true,
                  };
                } else {
                  const stepped = clampCoordStep(
                    { latitude: anchor.latitude, longitude: anchor.longitude },
                    { latitude: lat, longitude: lng },
                    maxStepM,
                  );
                  appliedSnap = {
                    ...snapped,
                    latitude: stepped.latitude,
                    longitude: stepped.longitude,
                    snapped: true,
                  };
                }
              }
            }
          }
        } else if (hardRoadSnap && snapped.snapped && lastSetLocRef.current) {
          const jumpM = haversineKm(
            lastSetLocRef.current.lat, lastSetLocRef.current.lng,
            snapped.latitude, snapped.longitude,
          ) * 1000;
          const maxJumpM = parkedLikeNow
            ? 3
            : true && isDrivingRef.current
              ? (kmh < 8 ? 6 : Math.max(32, kmh * 0.45))
              : isDrivingRef.current
                ? 42
                : 28;
          if (jumpM > maxJumpM && !accelBypassActive && !tripMarkerFrozen) {
            const roadPts = drivingSnapGeometryRef.current;
            const stepCap = drivingSnapDynamicStepCapM(
              snapCapSpeedKmh,
              jumpM,
              { intervalSec: snapIntervalSec, accelBypass: accelBypassActive },
            );
            const c = roadPts.length >= 2
              ? stepTowardSnapOnPolyline(
                lastSetLocRef.current.lat,
                lastSetLocRef.current.lng,
                snapped.latitude,
                snapped.longitude,
                roadPts,
                stepCap,
                90,
              )
              : clampCoordStep(
                { latitude: lastSetLocRef.current.lat, longitude: lastSetLocRef.current.lng },
                { latitude: snapped.latitude, longitude: snapped.longitude },
                stepCap,
              );
            appliedSnap = { ...snapped, latitude: c.latitude, longitude: c.longitude, snapped: true };
          }
          const roadPtsClamp = drivingSnapGeometryRef.current;
          if (
            true
            && isDrivingRef.current
            && roadPtsClamp.length >= 2
            && !parkedLikeNow
          ) {
            const locked = projectOntoDrivingRoad(
              appliedSnap.latitude,
              appliedSnap.longitude,
              rawLat,
              rawLng,
              roadPtsClamp,
              kmh >= 35 ? 48 : 38,
            );
            if (locked) {
              appliedSnap = {
                ...appliedSnap,
                latitude: locked.latitude,
                longitude: locked.longitude,
                snapped: true,
              };
            }
          }
        }
        const actuallyUsingRawGps =
          hardRoadSnap
          && !appliedSnap.snapped
          && haversineKm(appliedSnap.latitude, appliedSnap.longitude, lat, lng) * 1000 < 3;
        if (actuallyUsingRawGps) {
          console.warn('[GPS map] drivingSnap returned raw — no anchor hold');
        } else if (hardRoadSnap && !appliedSnap.snapped) {
          if (snapLifecycleStage === 'snap_miss') {
            snapLifecycleStage = 'snap_fail_held_anchor';
          }
          vroomGpsLog('SNAP_FAIL_HELD_ANCHOR', {
            speedKmh: Math.round(kmh),
            appliedSnapped: appliedSnap.snapped,
          }, 2000);
        }
        if (hardRoadSnap && !appliedSnap.snapped) {
          // Driving/Navi invariant: keep road lock continuity.
          // Never leak marker directly to raw GPS when hard lock is active.
          const hold = lastSetLocRef.current ?? lastDrivingPosRef.current ?? lastGoodLocRef.current;
          const roadPts = drivingSnapGeometryRef.current;
          if (roadPts.length >= 2) {
            const proj = projectOntoDrivingRoad(
              hold?.lat ?? rawLat,
              hold?.lng ?? rawLng,
              rawLat,
              rawLng,
              roadPts,
              85,
            );
            if (proj) {
              appliedSnap = {
                ...appliedSnap,
                latitude: proj.latitude,
                longitude: proj.longitude,
                snapped: true,
              };
              snapLifecycleStage = 'snap_force_projected_on_road';
            }
          }
          if (!appliedSnap.snapped && hold) {
            appliedSnap = {
              ...appliedSnap,
              latitude: hold.lat,
              longitude: hold.lng,
              snapped: true,
            };
            snapLifecycleStage = 'snap_force_hold_anchor';
          }
          if (!appliedSnap.snapped) {
            const emergencyHold = lastSetLocRef.current
              ?? lastDrivingPosRef.current
              ?? lastGoodLocRef.current
              ?? (currentLocRef.current
                ? { lat: currentLocRef.current.latitude, lng: currentLocRef.current.longitude }
                : null);
            appliedSnap = {
              ...appliedSnap,
              latitude: emergencyHold?.lat ?? appliedSnap.latitude,
              longitude: emergencyHold?.lng ?? appliedSnap.longitude,
              snapped: true,
            };
            snapLifecycleStage = 'snap_force_emergency_hold';
          }
        }

        const appliedToRawM = haversineKm(appliedSnap.latitude, appliedSnap.longitude, rawLat, rawLng) * 1000;
        if (
          true
          && isDrivingRef.current
          && appliedSnap.snapped
          && !parkedLikeNow
          && !tripMarkerFrozen
        ) {
          const snapHdg = appliedSnap.targetHeading ?? lastHeadingRef.current ?? 0;
          const prevRawForPar = lastRawForHeadingRef.current;
          const par = correctParallelRoadSnap(
            rawLat,
            rawLng,
            appliedSnap.latitude,
            appliedSnap.longitude,
            snapHdg,
            prevRawForPar,
            kmh,
          );
          if (par.corrected) {
            appliedSnap = {
              ...appliedSnap,
              latitude: par.lat,
              longitude: par.lng,
              targetHeading: par.heading,
              snapped: true,
            };
            markerLogTick('V10_PARALLEL_ROAD_CORRECT', {
              rawToSnapM: Math.round(rawToSnapAfterSnapM),
              lat: Number(par.lat.toFixed(6)),
              lng: Number(par.lng.toFixed(6)),
            }, 1200);
          }
        }
        logGpsTickLayer('SNAP_RESULT_LIFECYCLE', {
          snapLifecycleStage,
          snapped: snapped.snapped,
          appliedSnapped: appliedSnap.snapped,
          hardRoadSnap,
          noRoad,
          rawLat: Number(rawLat.toFixed(6)),
          rawLng: Number(rawLng.toFixed(6)),
          snapLat: Number(snapped.latitude.toFixed(6)),
          snapLng: Number(snapped.longitude.toFixed(6)),
          appliedLat: Number(appliedSnap.latitude.toFixed(6)),
          appliedLng: Number(appliedSnap.longitude.toFixed(6)),
          rawToSnapM: Math.round(rawToSnapAfterSnapM),
          appliedToRawM: Math.round(appliedToRawM),
          rawOffRoadLeak: appliedToRawM < 4 && !appliedSnap.snapped,
          roadPts: drivingSnapGeometryRef.current.length,
          isDriving: isDrivingRef.current,
        });
        if (hardRoadSnap && !appliedSnap.snapped) {
          drivingNoSnapStreakRef.current += 1;
          if (accForMatch && kmh >= DRIVING_ENTRY_STATIONARY_KMH) {
            const nowNoSnap = Date.now();
            const recoverStreak = FORCE_MAP_MATCH_RECOVER_STREAK;
            const recoverIntervalMs = FORCE_MAP_MATCH_RECOVER_MIN_INTERVAL_MS;
            const useManualRecover =
              drivingNoSnapStreakRef.current >= recoverStreak
              && (nowNoSnap - lastDrivingNoSnapForceRef.current) >= recoverIntervalMs;
            gpsTelemetryRef.current.snapRecoveryCalls += 1;
            if (useManualRecover) {
              lastDrivingNoSnapForceRef.current = nowNoSnap;
              void roadGeometryStore.findNearest(lat, lng, 150).then((hit) => {
                if (!isDrivingRef.current) return;
                if (hit && hit.points.length >= 2 && hit.ageMs <= 120_000) {
                  applyRoadMatchPoints(hit.points);
                  bumpMatchedFreshness();
                  gpsTelemetryRef.current.snapRecoverySuccess += 1;
                  return;
                }
                runMapMatchRecovery(
                  { reason: 'SNAP_RECOVERY_MANUAL', lat, lng, speedKmh: kmh },
                  (p) => {
                    if (p && p.length >= 2 && isDrivingRef.current) {
                      gpsTelemetryRef.current.snapRecoverySuccess += 1;
                      applyRoadMatchPoints(p);
                    } else {
                      gpsTelemetryRef.current.snapRecoveryFail += 1;
                    }
                  },
                );
              }).catch(() => {
                runMapMatchRecovery(
                  { reason: 'SNAP_RECOVERY_MANUAL', lat, lng, speedKmh: kmh },
                  (p) => {
                    if (p && p.length >= 2 && isDrivingRef.current) {
                      gpsTelemetryRef.current.snapRecoverySuccess += 1;
                      applyRoadMatchPoints(p);
                    } else {
                      gpsTelemetryRef.current.snapRecoveryFail += 1;
                    }
                  },
                );
              });
            } else {
              runMapMatchRecovery(
                { reason: 'SNAP_RECOVERY', lat, lng, speedKmh: kmh, staleSnap: staleSnapHintEarly },
                (p) => {
                  if (p && p.length >= 2 && isDrivingRef.current) {
                    gpsTelemetryRef.current.snapRecoverySuccess += 1;
                    applyRoadMatchPoints(p);
                  } else {
                    gpsTelemetryRef.current.snapRecoveryFail += 1;
                  }
                },
              );
            }
          }
        } else if (hardRoadSnap && appliedSnap.snapped) {
          drivingNoSnapStreakRef.current = 0;
          lastSnapSuccessAtRef.current = Date.now();
        }
        const trackPassiveKm =
          !isNavigatingRef.current
          && !isDrivingRef.current
          && !movingForDriving
          && (kmh >= PASSIVE_DISTANCE_MIN_KMH || movedForSnap >= 28);
        const trackDistance =
          isDrivingRef.current
          || movingForDriving
          || trackPassiveKm;
        if (
          trackDistance
          && !parkedLikeNow
          && kmh >= 3
          && appStateRef.current === 'active'
        ) {
          if (trackPassiveKm && !passiveTripStartedRef.current) {
            startTrip(0);
            passiveTripStartedRef.current = true;
          }
          const distAnchor = lastDrivingPosRef.current ?? lastSetLocRef.current;
          const snapMoveM = distAnchor
            ? haversineKm(distAnchor.lat, distAnchor.lng, appliedSnap.latitude, appliedSnap.longitude) * 1000
            : Infinity;
          const rawMoveM = distAnchor
            ? haversineKm(distAnchor.lat, distAnchor.lng, rawLat, rawLng) * 1000
            : Infinity;
          const useRawForDistance =
            rawMoveM >= 4
            && (
              isNavigatingRef.current
              || Platform.OS === 'ios'
              || (rawMoveM > snapMoveM * 1.35 && (kmh >= 20 || rawGpsKmhForSpike >= 20))
            );
          const distLat = useRawForDistance ? rawLat : appliedSnap.latitude;
          const distLng = useRawForDistance ? rawLng : appliedSnap.longitude;
          const segKm = feedPosition(distLat, distLng, sanitizedSpeedMs ?? undefined, Number.isFinite(acc) ? acc : null);
          if (segKm > 0) {
            const traceLat = appliedSnap.latitude;
            const traceLng = appliedSnap.longitude;
            const traceKmh = kmh;
            InteractionManager.runAfterInteractions(() => {
              recordDrivingTracePoint(traceLat, traceLng, { speedKmh: traceKmh }).catch(() => {});
            });
            maybeClearDrivingManualDisable(segKm, now);
          }
        }

        // ── Driving heading — droga (polyline) ma pierwszeństwo przed surowym GPS ──
        let drivingHeading = lastHeadingRef.current;
        const movedForHeadingM = lastDrivingPosRef.current
          ? haversineKm(
            lastDrivingPosRef.current.lat, lastDrivingPosRef.current.lng,
            appliedSnap.latitude, appliedSnap.longitude,
          ) * 1000
          : 0;
        const prevRawForHeading = lastRawForHeadingRef.current;
        const rawMovedForHeadingM = prevRawForHeading
          ? haversineKm(prevRawForHeading.lat, prevRawForHeading.lng, lat, lng) * 1000
          : 0;
        lastRawForHeadingRef.current = { lat, lng };
        const shouldUpdateHeading =
          kmh >= 4
          || movedForSnap >= 3
          || movedForHeadingM >= 2.2
          || rawMovedForHeadingM >= 3;

        if (shouldUpdateHeading) {
          const rawMoveHeading = rawMovedForHeadingM >= 2.2 && prevRawForHeading
            ? bearingBetween(prevRawForHeading.lat, prevRawForHeading.lng, rawLat, rawLng)
            : null;
          const snapMoveHeading = movedForHeadingM >= 1.5 && lastDrivingPosRef.current
            ? bearingBetween(
              lastDrivingPosRef.current.lat,
              lastDrivingPosRef.current.lng,
              appliedSnap.latitude,
              appliedSnap.longitude,
            )
            : null;
          const moveHeading = rawMoveHeading ?? snapMoveHeading;
          const compassForHeading = kmh < TRIP_COMPASS_HEADING_MAX_KMH ? loc.heading : null;
          const resolved = resolveDrivingHeading(
            appliedSnap,
            lastHeadingRef.current,
            lastDrivingPosRef.current,
            compassForHeading,
            kmh,
            isNavigatingRef.current,
          );
          drivingHeading = resolveUnifiedHeading({
            snapHeading: resolved ?? (appliedSnap.snapped ? appliedSnap.targetHeading : null),
            movementHeading: moveHeading,
            gpsHeading: compassForHeading,
            previousHeading: lastHeadingRef.current,
            speedKmh: kmh,
          });
          lastHeadingRef.current = drivingHeading;
          publishHeading(drivingHeading);
        }
        const deviceSpeedMs = loc.speed != null && loc.speed >= 0 ? loc.speed : 0;
        const deviceSpeedKmh = deviceSpeedMs * 3.6;
        if (!appliedSnap.snapped && deviceSpeedKmh > 0) {
          // Prędkość nie może zależeć od sukcesu snapowania.
          kmh = Math.max(kmh, deviceSpeedKmh);
          sanitizedSpeedMs = Math.max(sanitizedSpeedMs ?? 0, deviceSpeedMs);
          speedKmhRef.current = Math.max(speedKmhRef.current, kmh);
        }
        // Always track last snapped position for next bearing calculation
        lastDrivingPosRef.current = { lat: appliedSnap.latitude, lng: appliedSnap.longitude };

        // Keep only heading in sync with driving pipeline — lat/lng are driven
        // by DR onFrame at 60fps to prevent marker teleportation on each GPS tick.
        drHdgRef.current = drivingHeading;

        // ── DEAD ZONE — ignoruj jitter gdy stoisz (nie dotyczy jazdy/nawigacji) ─
        if (!isDrivingRef.current && !isNavigatingRef.current && lastSetLocRef.current && kmh < 5) {
          const movedM = haversineKm(
            lastSetLocRef.current.lat, lastSetLocRef.current.lng,
            appliedSnap.latitude, appliedSnap.longitude,
          ) * 1000;
          if (movedM < MIN_MOVE_M) {
            drivingConsecutiveRef.current = 0;
            setSpeed(null);
            publishUserLocation({ latitude: appliedSnap.latitude, longitude: appliedSnap.longitude });
            if (isMapFocusedRef.current) {
}
            return;
          }
        }
        if (!isDrivingRef.current && !isNavigatingRef.current && lastSetLocRef.current) {
          const movedUiM = haversineKm(
            lastSetLocRef.current.lat,
            lastSetLocRef.current.lng,
            appliedSnap.latitude,
            appliedSnap.longitude,
          ) * 1000;
          if (motionKmh < GPS_IDLE_UI_LOCK_SPEED_KMH) {
            const maxFilteredUiM = maxIdleBrowsingJumpM(safeDtForSnappedUi, kmh, acc, motionKmh);
            if (movedUiM > maxFilteredUiM) {
              rollbackRejectedRawAnchor();
              pushGpsDebugFix({
                lat: appliedSnap.latitude,
                lng: appliedSnap.longitude,
                acc,
                speedKmh: kmh,
                accepted: false,
                reason: 'idle_ui_filtered_lock',
              });
              return;
            }
          }
          if (movedUiM > GPS_IDLE_UI_HARD_JUMP_M && motionKmh < 15) {
            rollbackRejectedRawAnchor();
            pushGpsDebugFix({
              lat: appliedSnap.latitude,
              lng: appliedSnap.longitude,
              acc,
              speedKmh: kmh,
              accepted: false,
              reason: 'idle_ui_hard_jump',
            });
            return;
          }
          if (movedUiM > GPS_IDLE_UI_SOFT_JUMP_M && motionKmh < 10) {
            const nowUi = Date.now();
            const cand = idleUiJumpCandidateRef.current;
            const sameCluster =
              !!cand &&
              nowUi - cand.time <= GPS_IDLE_UI_CONFIRM_WINDOW_MS &&
              haversineKm(cand.lat, cand.lng, appliedSnap.latitude, appliedSnap.longitude) * 1000 <= GPS_IDLE_UI_CONFIRM_RADIUS_M;
            if (!sameCluster) {
              idleUiJumpCandidateRef.current = { lat: appliedSnap.latitude, lng: appliedSnap.longitude, time: nowUi, hits: 1 };
              rollbackRejectedRawAnchor();
              pushGpsDebugFix({
                lat: appliedSnap.latitude,
                lng: appliedSnap.longitude,
                acc,
                speedKmh: kmh,
                accepted: false,
                reason: 'idle_ui_candidate_1',
              });
              return;
            }
            const hits = (cand?.hits ?? 1) + 1;
            if (hits < 2) {
              idleUiJumpCandidateRef.current = { lat: appliedSnap.latitude, lng: appliedSnap.longitude, time: nowUi, hits };
              rollbackRejectedRawAnchor();
              pushGpsDebugFix({
                lat: appliedSnap.latitude,
                lng: appliedSnap.longitude,
                acc,
                speedKmh: kmh,
                accepted: false,
                reason: `idle_ui_candidate_${hits}`,
              });
              return;
            }
            idleUiJumpCandidateRef.current = null;
          } else {
            idleUiJumpCandidateRef.current = null;
          }
        } else {
          idleUiJumpCandidateRef.current = null;
        }
        lastSetLocRef.current = { lat: appliedSnap.latitude, lng: appliedSnap.longitude };

        if (movingForDriving) {
          // ── Wymaga N kolejnych odczytów przed wejściem w driving
          drivingConsecutiveRef.current += 1;

          if (!isDrivingRef.current) {
            if (drivingManuallyDisabledRef.current) {
              publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });
              return;
            }
            if (drivingConsecutiveRef.current < DRIVING_CONSECUTIVE_REQ) {
              // V10: bez feedu markera przed potwierdzeniem jazdy — surowy lat/lng
              // powodował teleport off-road, potem snap w następnym ticku.
              publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });
              return;
            }
            isDrivingRef.current      = true;
            tripCheckpointActiveRef.current = true;
            drivingManualModeRef.current = false;
            driveSessionGuardRef.current.reset();
            setIsDriving(true);
            if (!passiveTripStartedRef.current) {
              startTrip(routeDurationMinutesToSeconds(routeInfoRef.current?.duration));
              passiveTripStartedRef.current = true;
            }
            void startDriveSession('freeDrive').catch(() => {});
            drivingLastLocRef.current = null;
            lastDrivingPosRef.current = null;
            // Reset nav-quality Kalman filters to start fresh in driving mode
            navLatFilter.reset();
            navLngFilter.reset();
            drivLatFilter.reset();
            drivLngFilter.reset();
            console.log('[DrivingMode] Entered driving mode, speed:', Math.round(kmh), 'km/h');

            const cachedRoad = getMatchedPoints();
            if (cachedRoad && cachedRoad.length >= 2) {
              applyRoadMatchPoints(cachedRoad);
              bumpMatchedFreshness();
            }

            let entryLat = appliedSnap.latitude;
            let entryLng = appliedSnap.longitude;
            const anchor = resolveDrivingAnchor();
            if (anchor) {
              entryLat = anchor.latitude;
              entryLng = anchor.longitude;
              const c = clampCoordStep(anchor, { latitude: entryLat, longitude: entryLng }, 40);
              entryLat = c.latitude;
              entryLng = c.longitude;
            }

            isDrivingRef.current = true;
            setTripCameraActive(true);
            drLatRef.current = entryLat;
            drLngRef.current = entryLng;
            lastSetLocRef.current = { lat: entryLat, lng: entryLng };
            lastGoodLocRef.current = { lat, lng };
            drivingEntryAnchorRef.current = { lat: entryLat, lng: entryLng };
            drivingEntryGraceUntilRef.current = Date.now() + DRIVING_ENTRY_GRACE_MS;

            tripMarkerV2BootstrappedRef.current = true;
            tripBootstrapPose(entryLat, entryLng, drivingHeading, { animateCamera: true });
            cameraV3.setUserExploring(false);
            cameraV3.armTripFollow(drivingHeading);
            recordDrivingTracePoint(entryLat, entryLng, { speedKmh: kmh }).catch(() => {});
            setFollowMode('drivingFollow');
            publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });

            if (motionKmh >= DRIVING_ENTRY_STATIONARY_KMH) {
              runMapMatchRecovery(
                {
                  reason: 'AUTO_ENTRY',
                  lat,
                  lng,
                  speedKmh: kmh,
                  forceImmediate: true,
                  context: { canForceAutoEntry: true },
                },
                (matchedPts) => {
                  if (!matchedPts || matchedPts.length < 2 || !isDrivingRef.current) return;
                  applyRoadMatchPoints(matchedPts);
                },
              );
            }
            return;
          }
        } else {
          drivingConsecutiveRef.current = 0;
        }

      }

      publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });
    // clearStats / startTrip / routeInfo are read via stable refs (clearStats+startTrip from useTripStats are stable;
    // routeInfo via routeInfoRef) — do NOT list them here or every route preview tick tears down GPS watch.
    }, [feedPosition, startTrip, finishTrip, publishUserLocation, publishHeading, publishSpeed, setFollowMode, recenterTo, resetBrowseCamera, updateCameraFrame, addMatchPosition, getMatchedPoints, applyRoadMatchPoints, resetMapMatch, runMapMatchRecovery, mapMatchCoord, bumpMatchedFreshness, flushPendingKm, resolveDrivingAnchor, resyncSnapAfterRoadGeometry, bumpActiveMarker, bumpMapMarker, maybeClearDrivingManualDisable, syncDrivingRoadGeometry]),
  });

  const flushNavigationStatsOnce = useCallback(async (finalStats: {
    distanceKm: number;
    maxSpeedKmh: number;
    avgSpeedKmh: number;
    elapsedSec: number;
    trackedPoints: { latitude: number; longitude: number }[];
  }, opts?: {
    reason?: 'arrival' | 'manual' | 'idle';
    mode?: 'navigation' | 'freeDrive';
  }): Promise<boolean> => {
    if (navStatsFlushedRef.current) return false;
    navStatsFlushedRef.current = true;
    return finalizeTripSession({
      reason: opts?.reason ?? 'arrival',
      mode: opts?.mode ?? 'navigation',
      distanceKm: Math.max(
        0,
        Number(finalStats.distanceKm || 0),
        Number(liveDistanceKmRef.current || 0),
        Number(tripCheckpointSavedKmRef.current || 0),
      ),
      maxSpeedKmh: finalStats.maxSpeedKmh,
      avgSpeedKmh: finalStats.avgSpeedKmh,
      durationSec: finalStats.elapsedSec,
      routePoints: finalStats.trackedPoints,
    });
  }, [finalizeTripSession]);

  useEffect(() => {
    if (!locationReady) return;
    lastGoodLocRef.current = userLocation
      ? { lat: userLocation.latitude, lng: userLocation.longitude }
      : null;
    foregroundGpsIntentionallyStoppedRef.current = false;
    startGPS();
    return () => {
      if (!isNavigatingRef.current && !isDrivingRef.current) {
        stopGPS();
      }
    };
  }, [locationReady, startGPS, stopGPS]);

  // Keep locationReadyRef in sync for use inside AppState/focus callbacks
  useEffect(() => { locationReadyRef.current = locationReady; }, [locationReady]);
  useEffect(() => { gpsAcquiringRef.current = gpsAcquiring; }, [gpsAcquiring]);

  const emergencyTripRestoredRef = useRef(false);
  const crashRecoveryPromptedRef = useRef(false);
  useEffect(() => {
    if (!locationReady || emergencyTripRestoredRef.current) return;
    emergencyTripRestoredRef.current = true;
    // This is the only cold-start coordinator. The older Android and navigation
    // restore effects below are guarded before their asynchronous work begins.
    didColdStartBgDriveRestoreRef.current = true;
    didRestoreNavSessionRef.current = true;
    navSessionColdStartGuardUntilRef.current = 0;
    void (async () => {
      try {
        await consumeNativeDriveStatsToStorage();
        const [drivingFlag, navFlag, emergency, savedKm, nativeState, activeSessionId, navRaw] = await Promise.all([
          AsyncStorage.getItem(BG_IS_DRIVING_KEY),
          AsyncStorage.getItem(BG_IS_NAVIGATING_KEY),
          readEmergencyTripSave(),
          loadTripCheckpointSavedKm(),
          BackgroundDriveController.getState(),
          AsyncStorage.getItem(TRIP_SESSION_ID_KEY),
          AsyncStorage.getItem(NAV_SESSION_KEY),
        ]);
        tripCheckpointSavedKmRef.current = savedKm;
        const hadActiveFlag = drivingFlag === 'true' || navFlag === 'true';

        if (
          emergency
          && emergency.tripSessionId === activeSessionId
          && emergency.distanceKm >= TRIP_CHECKPOINT_FORCE_MIN_KM
        ) {
          const unsavedKm = Math.max(0, emergency.distanceKm - savedKm);
          if (unsavedKm >= TRIP_CHECKPOINT_FORCE_MIN_KM) {
            const peakFromEmergency = (emergency.speedSamples ?? [])
              .filter((s) => s > 2 && s <= 200);
            const ok = await saveIncrementalTripKm({
              distanceKm: emergency.distanceKm,
              maxSpeedKmh: peakFromEmergency.length ? Math.max(...peakFromEmergency) : 0,
              source: navFlag === 'true' ? 'navigation' : 'driving',
            });
            if (ok) {
              tripCheckpointSavedKmRef.current = Math.max(savedKm, ok.checkpointDistanceKm);
              if (Number.isFinite(ok.userTotalDistance)) {
                profileTotalDistanceKmRef.current = Math.max(0, Number(ok.userTotalDistance));
              } else {
                profileTotalDistanceKmRef.current += Math.max(0, ok.creditedDeltaKm);
              }
              await persistTripCheckpointSavedKm(tripCheckpointSavedKmRef.current);
              vroomGpsLog('EMERGENCY_TRIP_FLUSH', {
                creditedDeltaKm: Number(ok.creditedDeltaKm.toFixed(3)),
                totalKm: Number(tripCheckpointSavedKmRef.current.toFixed(3)),
              }, 0);
            }
          }
          if (hadActiveFlag) {
            restoreTripSnapshot(emergency);
            vroomGpsLog('EMERGENCY_TRIP_RESTORE', {
              distanceKm: Number(emergency.distanceKm.toFixed(3)),
              floorKm: emergency.floorKm,
            }, 0);
          } else {
            await clearEmergencyTripSave();
            await clearTripCheckpointSavedKm();
            tripCheckpointSavedKmRef.current = 0;
          }
        } else if (!hadActiveFlag) {
          await setDrivingFlag(false);
          await setNavigatingFlag(false);
          await clearTripCheckpointSavedKm();
          tripCheckpointSavedKmRef.current = 0;
        }

        const ledger = await loadTripSessionLedger();
        const navSession = parsePersistedNavSession(navRaw);
        const freshNavigation = isFreshPersistedNavSession(navSession, {
          tripSessionId: ledger?.tripSessionId ?? activeSessionId,
          maxAgeMs: NAV_SESSION_MAX_AGE_MS,
        });
        if (
          ledger?.active
          && hadActiveFlag
          && nativeState?.active === false
          && nativeState?.endedBy === 'idle'
        ) {
          // Older iOS binaries stopped Core Location after ten stationary
          // minutes. Keep the same ledger/session instead of finalizing it.
          await BackgroundDriveController.start(ledger.mode, ledger.tripSessionId);
          vroomGpsLog('LEGACY_IOS_IDLE_RECOVERED', {
            tripSessionId: ledger.tripSessionId,
            distanceKm: Number(ledger.distanceKm.toFixed(3)),
          }, 0);
        }
        if (
          ledger?.active
          && ledger.finalization.state === 'open'
          && !crashRecoveryPromptedRef.current
        ) {
          crashRecoveryPromptedRef.current = true;
          Alert.alert(
            'Niedokończona jazda',
            'Wykryto jazdę przerwaną przez zamknięcie aplikacji. Możesz ją wznowić albo zapisać dotychczasowy przejazd.',
            [
              {
                text: 'Zakończ i zapisz',
                style: 'destructive',
                onPress: () => {
                  void (async () => {
                    await BackgroundDriveController.stop('app');
                    const finalized = await finalizeTripSession({
                      reason: 'crash',
                      mode: ledger.mode,
                      distanceKm: ledger.distanceKm,
                      maxSpeedKmh: ledger.maxSpeedKmh,
                      routePoints: ledger.routePoints,
                    });
                    if (!finalized) {
                      const remainingLedger = await loadTripSessionLedger();
                      if (
                        remainingLedger?.tripSessionId === ledger.tripSessionId
                        && remainingLedger.finalization.state === 'open'
                      ) {
                        await Promise.all([
                          clearTripSessionLedger(),
                          clearEmergencyTripSave(),
                          clearTripCheckpointSavedKm(),
                          AsyncStorage.removeItem(TRIP_SESSION_ID_KEY),
                        ]);
                      }
                    }
                    await setNavigatingFlag(false);
                    await setDrivingFlag(false);
                    await AsyncStorage.removeItem(NAV_SESSION_KEY);
                    setIsNavigating(false);
                    setIsDriving(false);
                    isNavigatingRef.current = false;
                    isDrivingRef.current = false;
                  })();
                },
              },
              {
                text: 'Wznów jazdę',
                onPress: () => {
                  void (async () => {
                    await AsyncStorage.setItem(TRIP_SESSION_ID_KEY, ledger.tripSessionId);
                    if (!passiveTripStartedRef.current) {
                      startTrip(routeDurationMinutesToSeconds(navSession?.routeInfo?.duration));
                      passiveTripStartedRef.current = true;
                    }
                    restoreTripSnapshot({
                      tripSessionId: ledger.tripSessionId,
                      distanceKm: ledger.distanceKm,
                      trackedPoints: ledger.routePoints,
                      speedSamples: ledger.speedSamples,
                      startTimeMs: new Date(ledger.startedAt).getTime(),
                      estimatedSec: routeDurationMinutesToSeconds(navSession?.routeInfo?.duration),
                      floorKm: ledger.distanceKm,
                      savedAt: ledger.updatedAt || Date.now(),
                    });
                    tripCheckpointActiveRef.current = true;
                    if (ledger.mode === 'navigation' && freshNavigation && navSession) {
                      setIsOffroadRoute(navSession.isOffroadRoute);
                      setStartLocation(navSession.startLocation);
                      setEndLocation(navSession.endLocation);
                      setNavStartLoc(navSession.navStartLoc ?? navSession.startLocation);
                      setRouteInfo(navSession.routeInfo);
                      setCurrentStep(navSession.currentStep);
                      currentStepRef.current = navSession.currentStep;
                      offroadLoadedPointsRef.current = navSession.offroadPoints;
                      if (navSession.routeSnapshot?.points?.length) {
                        setNavRouteOverride(navSession.routeSnapshot);
                        routePointsRef.current = navSession.routeSnapshot.points;
                        navV3.setRoutePolyline(
                          navSession.routeSnapshot.points.map((point) => ({
                            lat: point.latitude,
                            lng: point.longitude,
                          })),
                        );
                      }
                      isNavigatingRef.current = true;
                      isDrivingRef.current = false;
                      setIsNavigating(true);
                      setIsDriving(false);
                      await startDriveSession('navigation');
                    } else {
                      await AsyncStorage.removeItem(NAV_SESSION_KEY);
                      await setNavigatingFlag(false);
                      isNavigatingRef.current = false;
                      isDrivingRef.current = true;
                      setIsNavigating(false);
                      setIsDriving(true);
                      await startDriveSession('freeDrive');
                    }
                    setTripCameraActive(true);
                    setFollowMode('drivingFollow');
                    foregroundGpsIntentionallyStoppedRef.current = false;
                    startGPS();
                  })();
                },
              },
            ],
            { cancelable: false },
          );
        }
      } catch { /* ignore */ }
    })();
  }, [
    locationReady,
    restoreTripSnapshot,
    finalizeTripSession,
    startTrip,
    navV3,
    setFollowMode,
    startGPS,
  ]);

  // W trybie przeglądania wyczyść geometrię snapu z poprzedniej jazdy — unika teleportów na starą drogę.
  useEffect(() => {
    if (!isMapFocused || isDriving || isNavigating) return;
    void 0;
    applyRoadMatchPoints([], { skipResync: true });
    drivingSnapGeometryRef.current = [];
    drivingSnapUsesMatchedRef.current = false;
    localRoadGeometryMirror.clear();
    snapAnchorStaleRef.current = null;
    driftCriticalStreakRef.current = 0;
  }, [isMapFocused, isDriving, isNavigating, applyRoadMatchPoints]);

  useEffect(() => {
    if (!isMapFocused || !userLocation) return;
    if (isDrivingRef.current || isNavigatingRef.current) return;
    drLatRef.current = userLocation.latitude;
    drLngRef.current = userLocation.longitude;
  }, [isMapFocused, userLocation]);

  const restartGPSWatcher = useCallback((reason: 'foreground' | 'focus' | 'resume', opts?: { force?: boolean }) => {
    const now = Date.now();
    if (now - lastGpsRestartAtRef.current < GPS_RESTART_COOLDOWN_MS && !opts?.force) return;
    const fixAge = now - lastAcceptedFixWallClockRef.current;
    const bgPause = lastBackgroundAtRef.current > 0 ? now - lastBackgroundAtRef.current : 0;
    const tripActive = isDrivingRef.current || isNavigatingRef.current;
    const forceRestart = opts?.force === true || (tripActive && bgPause >= GPS_BACKGROUND_STALE_MS);
    const watcherLikelyAlive =
      backgroundTrackingRef.current
      || (tripActive && appStateRef.current === 'active');
    if (
      !forceRestart
      && (reason === 'focus' || reason === 'resume')
      && watcherLikelyAlive
      && !foregroundGpsIntentionallyStoppedRef.current
      && fixAge < GPS_WATCHER_STALE_MS
      && bgPause < GPS_BACKGROUND_STALE_MS
      && !gpsAcquiringRef.current
    ) {
      vroomGpsLog('WATCHER_RESTART_SKIP', { reason, fixAgeMs: Math.round(fixAge), bgPauseMs: Math.round(bgPause) });
      if (__DEV__) console.log('[GPS] Skip watcher restart — fresh fix / BG watcher kept alive');
      return;
    }
    lastGpsRestartAtRef.current = now;
    gpsTelemetryRef.current.watcherRestarts += 1;
    if (__DEV__) {
      console.log('[GPSDBG] WATCHER_RESTART', JSON.stringify({
        at: now,
        reason,
        force: forceRestart,
        fixAgeMs: Math.max(0, now - lastAcceptedFixWallClockRef.current),
        bgPauseMs: bgPause,
      }));
    }
    if (__DEV__) console.log(`[GPS] Restart watcher (${reason})`);
    lastGoodTimeRef.current = now - GPS_RESUME_GRACE_PERIOD_MS;
    lastNavLocRef.current = null;
    drivingLastLocRef.current = null;
    idleJumpCandidateRef.current = null;
    idleUiJumpCandidateRef.current = null;
    stillLockCandidateRef.current = null;
    if (forceRestart && tripActive) {
      // Mamy już wiarygodną pozycję trasy (DR / natywny bufor) — nie zerujemy
      // locka, aby pierwszy fix po restarcie nie był odrzucony (brak freeze).
      const hasKnownTripPose =
        (Number.isFinite(drLatRef.current) && drLatRef.current !== 0)
        || lastSetLocRef.current != null
        || lastGoodLocRef.current != null;
      void hardRestartGPS(`restart_${reason}`, { preserveLock: hasKnownTripPose });
      foregroundGpsIntentionallyStoppedRef.current = false;
      return;
    }
    stopGPS();
    foregroundGpsIntentionallyStoppedRef.current = true;
    startGPS();
    foregroundGpsIntentionallyStoppedRef.current = false;
    if (!lastGoodLocRef.current && currentLocRef.current) {
      const u = currentLocRef.current;
      if (Number.isFinite(u.latitude) && Number.isFinite(u.longitude)) {
        lastGoodLocRef.current = { lat: u.latitude, lng: u.longitude };
      }
    }
  }, [startGPS, stopGPS, hardRestartGPS]);

  // One-shot location refresh: immediately snaps the marker to the current
  // position before the watch subscription has had a chance to emit updates.
  const refreshLocationOneShot = useCallback((opts?: { force?: boolean }) => {
    // W trasie: one-shot zwraca stary cache OS na Androidzie — tylko watchPositionAsync.
    if (opts?.force && (isDrivingRef.current || isNavigatingRef.current)) {
      return;
    }
    const now = Date.now();
    if (!opts?.force && now - lastOneShotAtRef.current < GPS_ONESHOT_COOLDOWN_MS) {
      return;
    }
    lastOneShotAtRef.current = now;
    gpsTelemetryRef.current.oneShotAttempts += 1;
    Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
      mayShowUserSettingsDialog: true,
    })
      .then((loc) => {
        const rawLat = loc.coords.latitude;
        const rawLng = loc.coords.longitude;
        const acc = loc.coords.accuracy ?? 999;
        if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng) || isNullIsland(rawLat, rawLng)) {
          console.warn('[GPS] One-shot: niepoprawne współrzędne');
          gpsTelemetryRef.current.oneShotRejected += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_REJECT', JSON.stringify({ at: Date.now(), reason: 'invalid_coord' }));
          return;
        }
        if (isStaleGpsTimestamp(Date.now(), loc.timestamp)) {
          console.warn('[GPS] One-shot odrzucony: przestarzały timestamp (cache OS)');
          gpsTelemetryRef.current.oneShotRejected += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_REJECT', JSON.stringify({ at: Date.now(), reason: 'stale_timestamp' }));
          return;
        }
        if (acc > GPS_ONESHOT_MAX_ACCURACY_M) {
          console.warn(`[GPS] One-shot odrzucony: accuracy ${Math.round(acc)} m`);
          gpsTelemetryRef.current.oneShotRejected += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_REJECT', JSON.stringify({ at: Date.now(), reason: 'poor_accuracy', accM: Math.round(acc) }));
          return;
        }
        const anchor =
          lastGoodLocRef.current
          ?? (currentLocRef.current
            && Number.isFinite(currentLocRef.current.latitude)
            && Number.isFinite(currentLocRef.current.longitude)
            ? { lat: currentLocRef.current.latitude, lng: currentLocRef.current.longitude }
            : null);
        if (!anchor && !isDrivingRef.current && !isNavigatingRef.current) {
          // Without a reliable anchor in idle mode, a one-shot can be a cached
          // network fix and visually teleport the marker after app resume.
          gpsTelemetryRef.current.oneShotRejected += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_REJECT', JSON.stringify({ at: Date.now(), reason: 'no_idle_anchor' }));
          return;
        }
        const wallDt = Math.max(1, Date.now() - lastAcceptedFixWallClockRef.current);
        if (
          anchor
          && !isRawGpsPlausibleVsAnchor(
            rawLat,
            rawLng,
            anchor,
            wallDt,
            loc.coords.speed,
            isDrivingRef.current,
            acc,
          )
        ) {
          console.warn('[GPS] One-shot odrzucony: nierealistyczny skok względem ostatniej pozycji');
          gpsTelemetryRef.current.oneShotRejected += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_REJECT', JSON.stringify({ at: Date.now(), reason: 'implausible_jump' }));
          return;
        }
        if (isDrivingRef.current || isNavigatingRef.current) {
          const bgPauseMs = lastBackgroundAtRef.current > 0 ? Date.now() - lastBackgroundAtRef.current : 0;
          const oneShotJumpM = anchor
            ? haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000
            : 0;
          if (!isTripResumeJumpAcceptable(oneShotJumpM, bgPauseMs).ok) {
            gpsTelemetryRef.current.oneShotRejected += 1;
            markerLogCritical('ONE_SHOT_RESUME_REJECT', {
              jumpM: Math.round(oneShotJumpM),
              bgPauseMs: Math.round(bgPauseMs),
            });
            if (__DEV__) console.log('[GPSDBG] ONE_SHOT_REJECT', JSON.stringify({ at: Date.now(), reason: 'resume_teleport' }));
            return;
          }
        }
        const speedMs = loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : 0;
        const speedKmh = speedMs * 3.6;
        if (!isDrivingRef.current && !isNavigatingRef.current && speedKmh < GPS_IDLE_UI_LOCK_SPEED_KMH && currentLocRef.current) {
          const uiJumpM = haversineKm(
            currentLocRef.current.latitude,
            currentLocRef.current.longitude,
            rawLat,
            rawLng,
          ) * 1000;
          const maxUiJumpM = maxIdleBrowsingJumpM(wallDt, speedKmh, acc);
          if (uiJumpM > maxUiJumpM) {
            console.warn(`[GPS] One-shot odrzucony: idle UI jump ${Math.round(uiJumpM)}m > ${Math.round(maxUiJumpM)}m`);
            gpsTelemetryRef.current.oneShotRejected += 1;
            if (__DEV__) console.log('[GPSDBG] ONE_SHOT_REJECT', JSON.stringify({
              at: Date.now(),
              reason: 'idle_ui_jump',
              jumpM: Math.round(uiJumpM),
              maxUiJumpM: Math.round(maxUiJumpM),
            }));
            return;
          }
        }

        const lat = latFilter.filter(rawLat, acc);
        const lng = lngFilter.filter(rawLng, acc);

        // Keep route-matched continuity after resume/focus so we don't show a
        // raw-GPS jump before the continuous watcher pushes the next snapped tick.
        if (isNavigatingRef.current && routePointsRef.current.length > 1) {
          const navSnapped = snapToRoute(lat, lng, routePointsRef.current, NAV_ROUTE_SNAP_M);
          const prevNavLoc = lastNavLocRef.current;
          let navHdg = lastHeadingRef.current || 0;
          if (prevNavLoc) {
            const moveM = haversineKm(
              prevNavLoc.latitude,
              prevNavLoc.longitude,
              navSnapped.latitude,
              navSnapped.longitude,
            ) * 1000;
            if (moveM >= 2.5) {
              navHdg = bearingBetween(
                prevNavLoc.latitude,
                prevNavLoc.longitude,
                navSnapped.latitude,
                navSnapped.longitude,
              );
            }
          }
          lastGoodLocRef.current = { lat: navSnapped.latitude, lng: navSnapped.longitude };
          lastNavLocRef.current = { latitude: navSnapped.latitude, longitude: navSnapped.longitude };
          lastSetLocRef.current = { lat: navSnapped.latitude, lng: navSnapped.longitude };
          if (appStateRef.current === 'active') {
            feedPosition(rawLat, rawLng, speedMs, Number.isFinite(acc) ? acc : null);
          }
          lastAcceptedFixWallClockRef.current = Date.now();
          setGpsAcquiring(false);
          persistMapLocation(navSnapped.latitude, navSnapped.longitude, acc);
          gpsTelemetryRef.current.oneShotApplied += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_APPLY', JSON.stringify({ at: Date.now(), mode: 'navigation', snapped: true }));
          return;
        }

        if (isNavigatingRef.current) {
          lastGoodLocRef.current = { lat, lng };
          lastSetLocRef.current = { lat, lng };
          lastNavLocRef.current = { latitude: lat, longitude: lng };
          if (appStateRef.current === 'active') {
            feedPosition(rawLat, rawLng, speedMs, Number.isFinite(acc) ? acc : null);
          }
          lastAcceptedFixWallClockRef.current = Date.now();
          setGpsAcquiring(false);
          persistMapLocation(lat, lng, acc);
          gpsTelemetryRef.current.oneShotApplied += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_APPLY', JSON.stringify({ at: Date.now(), mode: 'navigation', snapped: false }));
          return;
        }

        if (isDrivingRef.current) {
          lastAcceptedFixWallClockRef.current = Date.now();
          setGpsAcquiring(false);
          persistMapLocation(lat, lng, acc);
          gpsTelemetryRef.current.oneShotApplied += 1;
          return;
        }

        lastGoodLocRef.current = { lat, lng };
        lastAcceptedFixWallClockRef.current = Date.now();
        setGpsAcquiring(false);
        persistMapLocation(lat, lng, acc);
        if (__DEV__) console.log('[GPS] One-shot fix applied');
        gpsTelemetryRef.current.oneShotApplied += 1;
        if (__DEV__) console.log('[GPSDBG] ONE_SHOT_APPLY', JSON.stringify({ at: Date.now(), mode: 'idle' }));
        publishUserLocation({ latitude: lat, longitude: lng }, true);
      })
      .catch((e) => console.warn('[GPS] One-shot fix failed:', e));
  }, [feedPosition, runMapMatchRecovery, getMatchedPoints, applyRoadMatchPoints, publishUserLocation, persistMapLocation, resolveDrivingAnchor]);

  const performGpsHealthRecovery = useCallback((reason: string) => {
    const now = Date.now();
    if (now - lastGpsHealthRecoveryAtRef.current < GPS_HEALTH_RECOVERY_COOLDOWN_MS) return;
    lastGpsHealthRecoveryAtRef.current = now;

    latFilter.reset();
    lngFilter.reset();
    navLatFilter.reset();
    navLngFilter.reset();
    drivLatFilter.reset();
    drivLngFilter.reset();
    idleJumpCandidateRef.current = null;
    idleUiJumpCandidateRef.current = null;
    stillLockCandidateRef.current = null;
    idleRecoveryClusterRef.current = null;
    tripResumeFreezeUntilRef.current = 0;
    tripResumeAnchorRef.current = null;
    tripResumeConfirmRef.current = null;
    tripResumeMotionWakeHitsRef.current = 0;
    gpsFixDebugRef.current = [];

    const gpsAgeMs = now - lastAcceptedFixWallClockRef.current;
    vroomGpsLog('GPS_HEALTH_RECOVERY', { reason, gpsAgeMs: Math.round(gpsAgeMs) });
    if (__DEV__) {
      console.log('[GPSDBG] HEALTH_RECOVERY', JSON.stringify({ at: now, reason, gpsAgeMs: Math.round(gpsAgeMs) }));
    }

    restartGPSWatcher('resume', { force: true });
    refreshLocationOneShot({ force: true });

    const cached = peekMapLastLocation();
    if (cached && gpsAgeMs > GPS_HEALTH_STALE_MS) {
      lastGoodLocRef.current = { lat: cached.latitude, lng: cached.longitude };
      lastSetLocRef.current = { lat: cached.latitude, lng: cached.longitude };
      drLatRef.current = cached.latitude;
      drLngRef.current = cached.longitude;
      setUserLocation({ latitude: cached.latitude, longitude: cached.longitude });
      bumpActiveMarker(cached.latitude, cached.longitude, { forcePublish: true });
      resetBrowseCamera({ latitude: cached.latitude, longitude: cached.longitude });
    }
  }, [
    restartGPSWatcher,
    refreshLocationOneShot,
    bumpActiveMarker,
    resetBrowseCamera,
  ]);

  // Wejście w jazdę: wyczyść resume-freeze, odtwórz watcher jeśli zatrzymany (inactive/tło).
  const prevIsDrivingForGpsRef = useRef(false);
  useEffect(() => {
    if (!isDriving) {
      prevIsDrivingForGpsRef.current = false;
      return;
    }
    if (prevIsDrivingForGpsRef.current) return;
    prevIsDrivingForGpsRef.current = true;
    pendingDrivingEntryOneShotRef.current = false;
    tripResumeFreezeUntilRef.current = 0;
    tripResumeAnchorRef.current = null;
    tripResumeConfirmRef.current = null;
    tripResumeMotionWakeHitsRef.current = 0;
    const tickAgeMs = Date.now() - lastGpsTickAtRef.current;
    if (foregroundGpsIntentionallyStoppedRef.current || tickAgeMs > 4000) {
      lastGpsRestartAtRef.current = 0;
      restartGPSWatcher('resume');
    }
    startGPS();
    refreshLocationOneShot({ force: true });
  }, [isDriving, refreshLocationOneShot, restartGPSWatcher, startGPS]);

  // GPS health watchdog: stale fixes / reject streaks (idle + active).
  const runGpsHealthWatchdog = useCallback(() => {
    if (appStateRef.current !== 'active') return;
    const now = Date.now();
    const wallAgeMs = now - lastAcceptedFixWallClockRef.current;
    const tickAgeMs = lastGpsTickAtRef.current > 0
      ? now - lastGpsTickAtRef.current
      : wallAgeMs;
    const tripActive = isDrivingRef.current || isNavigatingRef.current;

    if (drivingManuallyDisabledRef.current) {
      maybeClearDrivingManualDisable(0, now);
    }

    if (tripActive && isMapFocusedRef.current) {
        const markerPushAgeMs = now - lastDriveMarkerPushAtRef.current;
        if (
          speedKmhRef.current >= 8
          && markerPushAgeMs >= 3000
          && tickAgeMs < GPS_ACTIVE_RECOVERY_STALE_MS
        ) {
          vroomGpsLog('NAV_FREEZE_SUSPECT', {
            speedKmh: Math.round(speedKmhRef.current),
            markerPushAgeMs: Math.round(markerPushAgeMs),
            tickAgeMs: Math.round(tickAgeMs),
            wallAgeMs: Math.round(wallAgeMs),
          }, 5000);
        }

        if (isDrivingRef.current && !isNavigatingRef.current) {
          const stall = drivingMarkerStallRef.current;
          const raw = currentLocRef.current;
          const ui = lastSetLocRef.current;
          if (raw && ui && stall.rawLat !== 0 && stall.rawLng !== 0) {
            const rawMoveM = haversineKm(stall.rawLat, stall.rawLng, raw.latitude, raw.longitude) * 1000;
            const uiMoveM = haversineKm(stall.drLat, stall.drLng, ui.lat, ui.lng) * 1000;
            const drMoveM = haversineKm(stall.drLat, stall.drLng, drLatRef.current, drLngRef.current) * 1000;
            const stallAgeMs = now - stall.at;
            const stallTripMoving =
              speedKmhRef.current >= 15
              || rawGpsKmhRef.current >= 15;
            const gapRawToUiM = haversineKm(ui.lat, ui.lng, raw.latitude, raw.longitude) * 1000;
            const v10GapStall =
              true
              && gapRawToUiM > 20
              && gapRawToUiM < 90
              && uiMoveM < 1
              && speedKmhRef.current >= 8
              && rawGpsKmhRef.current >= 8
              && stallAgeMs > 2000;
            if (
              (stallTripMoving
                && stallAgeMs > DRIVING_MARKER_STALL_MAX_AGE_MS
                && drMoveM < DRIVING_MARKER_STALL_DR_MOVE_MAX_M
                && (rawMoveM > DRIVING_MARKER_STALL_RAW_MOVE_WAKE_M || uiMoveM > DRIVING_MARKER_STALL_UI_MOVE_WAKE_M))
              || v10GapStall
            ) {
              if (tripResumeFreezeUntilRef.current > now && (speedKmhRef.current >= 6 || rawMoveM >= 6)) {
                tripResumeFreezeUntilRef.current = 0;
                tripResumeAnchorRef.current = null;
                tripResumeConfirmRef.current = null;
                tripResumeMotionWakeHitsRef.current = 0;
                vroomGpsLog('RESUME_FREEZE_STALL_RELEASE', {
                  rawMoveM: Math.round(rawMoveM),
                  speedKmh: Math.round(speedKmhRef.current),
                });
              }
              if (__DEV__) {
                console.log('[DrivingMode] driving_marker_stall recovery', JSON.stringify({
                  rawMoveM: Math.round(rawMoveM),
                  uiMoveM: Math.round(uiMoveM),
                  drMoveM: Math.round(drMoveM),
                }));
              }
              // Re-anchor DR marker do snap-on-polyline (NIE do raw GPS).
              // Wcześniej feed szedł w stronę raw → marker uciekał obok drogi
              // (zielone kropki obok jezdni). Teraz target = projekcja raw na
              // aktualną geometrię drogi; fallback do ui (snap target).
              const stallSpeedMs = Math.max(0, (speedKmhRef.current || 0) / 3.6);
              const stallRoadPts = drivingSnapGeometryRef.current;
              let rescueLat = ui.lat;
              let rescueLng = ui.lng;
              if (stallRoadPts.length >= 2) {
                const snappedRescue = snapToRoute(raw.latitude, raw.longitude, stallRoadPts, 120);
                const movedToRoad =
                  snappedRescue.latitude !== raw.latitude
                  || snappedRescue.longitude !== raw.longitude;
                if (movedToRoad) {
                  rescueLat = snappedRescue.latitude;
                  rescueLng = snappedRescue.longitude;
                }
              }
              const rescueTarget = clampCoordStep(
                { latitude: ui.lat, longitude: ui.lng },
                { latitude: rescueLat, longitude: rescueLng },
                28,
              );
              bumpActiveMarker(rescueTarget.latitude, rescueTarget.longitude, {
                instant: true,
                speedMs: stallSpeedMs,
              });
              resyncSnapAfterRoadGeometry(raw.latitude, raw.longitude, speedKmhRef.current, null);
              refreshLocationOneShot({ force: true });
              stall.at = now;
              stall.drLat = drLatRef.current;
              stall.drLng = drLngRef.current;
            }
          }
        }

        const wallStale = wallAgeMs >= GPS_ACTIVE_RECOVERY_STALE_MS;
        const tickStale = lastGpsTickAtRef.current > 0
          && tickAgeMs >= GPS_ACTIVE_RECOVERY_STALE_MS;
        const needsActiveRecovery = true
          ? (wallStale && tickStale) || foregroundGpsIntentionallyStoppedRef.current
          : wallStale
            || foregroundGpsIntentionallyStoppedRef.current
            || tickStale;

        if (needsActiveRecovery
          && now - lastActiveRecoveryAtRef.current >= GPS_ACTIVE_RECOVERY_COOLDOWN_MS) {
          lastActiveRecoveryAtRef.current = now;
          if (__DEV__) {
            console.log('[GPSDBG] ACTIVE_RECOVERY', JSON.stringify({
              at: now,
              wallAgeMs: Math.round(wallAgeMs),
              tickAgeMs: Math.round(tickAgeMs),
              mode: isNavigatingRef.current ? 'navigation' : 'driving',
            }));
          }
          restartGPSWatcher('resume');
          refreshLocationOneShot({ force: true });
        }
        return;
      }

      if (!isMapFocusedRef.current) return;

      const gpsAgeMs = wallAgeMs;
      const recent = gpsFixDebugRef.current.slice(-GPS_REJECT_STREAK_THRESHOLD);
      const rejectStreak = recent.length >= GPS_REJECT_STREAK_THRESHOLD
        && recent.every((r) => !r.accepted);

      if (gpsAgeMs >= GPS_HEALTH_STALE_MS) {
        performGpsHealthRecovery('idle_stale');
        return;
      }

      if (rejectStreak && gpsAgeMs >= 8_000) {
        performGpsHealthRecovery('reject_streak');
      }
  }, [
    restartGPSWatcher,
    refreshLocationOneShot,
    resyncSnapAfterRoadGeometry,
    performGpsHealthRecovery,
    maybeClearDrivingManualDisable,
    bumpActiveMarker,
  ]);

  useMapGpsWatchdog({ tick: runGpsHealthWatchdog });

  useEffect(() => {
    const id = setInterval(() => {
      const t = gpsTelemetryRef.current;
      const recent = gpsFixDebugRef.current;
      const rejected = recent.filter((r) => !r.accepted).length;
      if (__DEV__) {
        console.log('[GPS][telemetry]', {
          watcherRestarts: t.watcherRestarts,
          oneShotAttempts: t.oneShotAttempts,
          oneShotApplied: t.oneShotApplied,
          oneShotRejected: t.oneShotRejected,
          clampedFixes: t.clampedFixes,
          snapRecoveryCalls: t.snapRecoveryCalls,
          snapRecoverySuccess: t.snapRecoverySuccess,
          snapRecoveryFail: t.snapRecoveryFail,
          headingBypassNav: (t as any).headingBypassNav ?? 0,
          headingBypassDrive: (t as any).headingBypassDrive ?? 0,
          snapLagCatchup: (t as any).snapLagCatchup ?? 0,
          navSkipLateralClamp: (t as any).navSkipLateralClamp ?? 0,
          accelBypass: (t as any).accelBypass ?? 0,
          stationaryHoldBlocked: (t as any).stationaryHoldBlocked ?? 0,
          launchFromStopReset: (t as any).launchFromStopReset ?? 0,
          rejectedFixesTotal: t.rejectedFixes,
          recentRejectedFixes: rejected,
        });
        console.log('[GPSDBG] TELEMETRY', JSON.stringify({
          at: Date.now(),
          watcherRestarts: t.watcherRestarts,
          oneShotAttempts: t.oneShotAttempts,
          oneShotApplied: t.oneShotApplied,
          oneShotRejected: t.oneShotRejected,
          clampedFixes: t.clampedFixes,
          snapRecoveryCalls: t.snapRecoveryCalls,
          snapRecoverySuccess: t.snapRecoverySuccess,
          snapRecoveryFail: t.snapRecoveryFail,
          headingBypassNav: (t as any).headingBypassNav ?? 0,
          headingBypassDrive: (t as any).headingBypassDrive ?? 0,
          snapLagCatchup: (t as any).snapLagCatchup ?? 0,
          navSkipLateralClamp: (t as any).navSkipLateralClamp ?? 0,
          rejectedFixesTotal: t.rejectedFixes,
          recentRejectedFixes: rejected,
        }));
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!DRIVE_TEST_DIAGNOSTICS) return;
    if (!isMapFocused) return;
    if (!isNavigating && !isDriving) {
      diagLastSnapshotRef.current = null;
      diagStuckStreakRef.current = 0;
      return;
    }

    const id = setInterval(() => {
      const now = Date.now();
      const hasDr =
        Number.isFinite(drLatRef.current)
        && Number.isFinite(drLngRef.current)
        && drLatRef.current !== 0
        && drLngRef.current !== 0;
      const hasUser =
        !!userLocation
        && Number.isFinite(userLocation.latitude)
        && Number.isFinite(userLocation.longitude);
      const activeLat = hasDr ? drLatRef.current : (hasUser ? userLocation!.latitude : NaN);
      const activeLng = hasDr ? drLngRef.current : (hasUser ? userLocation!.longitude : NaN);

      let movedM = -1;
      if (Number.isFinite(activeLat) && Number.isFinite(activeLng)) {
        const prev = diagLastSnapshotRef.current;
        if (prev) {
          movedM = haversineKm(prev.lat, prev.lng, activeLat, activeLng) * 1000;
        }
        diagLastSnapshotRef.current = { at: now, lat: activeLat, lng: activeLng };
      }

      const gpsAgeMs = Math.max(0, now - lastAcceptedFixWallClockRef.current);
      const drAgeMs = Math.max(0, now - drLastFrameAtRef.current);
      const speedNowKmh = Math.max(0, (speedKmhRef.current || 0));
      const appearsStuck =
        movedM >= 0
        && movedM < 2.2
        && speedNowKmh >= 6
        && gpsAgeMs < 12_000;

      if (appearsStuck) {
        diagStuckStreakRef.current += 1;
      } else {
        diagStuckStreakRef.current = 0;
      }

      console.log('[RUNDIAG] HEARTBEAT', JSON.stringify({
        at: now,
        mode: isNavigatingRef.current ? 'navigation' : (isDrivingRef.current ? 'driving' : 'idle'),
        gpsTicks: gpsTickCountRef.current,
        drTicks: drTickCountRef.current,
        gpsAgeMs,
        drAgeMs,
        gpsTickAgeMs: Math.max(0, now - lastGpsTickAtRef.current),
        speedKmh: Number(speedNowKmh.toFixed(1)),
        heading: Number((lastHeadingRef.current || 0).toFixed(1)),
        movedM: movedM >= 0 ? Number(movedM.toFixed(1)) : null,
        hasUser,
        hasDr,
        stuckStreak: diagStuckStreakRef.current,
        userLat: hasUser ? Number(userLocation!.latitude.toFixed(6)) : null,
        userLng: hasUser ? Number(userLocation!.longitude.toFixed(6)) : null,
        drLat: hasDr ? Number(drLatRef.current.toFixed(6)) : null,
        drLng: hasDr ? Number(drLngRef.current.toFixed(6)) : null,
      }));

      if (diagStuckStreakRef.current >= 3) {
        const recent = gpsFixDebugRef.current.slice(-6);
        console.log('[RUNDIAG] STUCK_WINDOW', JSON.stringify({
          at: now,
          mode: isNavigatingRef.current ? 'navigation' : 'driving',
          speedKmh: Number(speedNowKmh.toFixed(1)),
          gpsAgeMs,
          drAgeMs,
          lastFixes: recent.map((r) => ({
            at: r.at,
            accepted: r.accepted,
            reason: r.reason,
            acc: Math.round(r.acc),
            speedKmh: Math.round(r.speedKmh),
            lat: Number(r.lat.toFixed(6)),
            lng: Number(r.lng.toFixed(6)),
          })),
        }));
      }
    }, 2500);

    return () => clearInterval(id);
  }, [isNavigating, isDriving, isMapFocused, userLocation]);

  const ensureRegionBootstrapped = useCallback((source: 'foreground' | 'focus') => {
    if (region) return;
    const anchor =
      (currentLocRef.current
        && Number.isFinite(currentLocRef.current.latitude)
        && Number.isFinite(currentLocRef.current.longitude)
        ? { latitude: currentLocRef.current.latitude, longitude: currentLocRef.current.longitude }
        : (userLocation
          && Number.isFinite(userLocation.latitude)
          && Number.isFinite(userLocation.longitude)
          ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
          : null));
    if (anchor) {
      setRegion({
        latitude: anchor.latitude,
        longitude: anchor.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
      setLocationReady(true);
      if (__DEV__) {
        console.log('[GPSDBG] REGION_BOOTSTRAP', JSON.stringify({
          at: Date.now(),
          source,
          from: 'user_anchor',
          lat: Number(anchor.latitude.toFixed(6)),
          lng: Number(anchor.longitude.toFixed(6)),
        }));
      }
      return;
    }
    const [lng, lat] = lastMapCenterRef.current;
    const hasRealCenter = peekMapLastLocation() != null || lastGoodLocRef.current != null;
    if (!hasRealCenter) return;
    setRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.03, longitudeDelta: 0.03 });
    setLocationReady(true);
    if (__DEV__) {
      console.log('[GPSDBG] REGION_BOOTSTRAP', JSON.stringify({
        at: Date.now(),
        source,
        from: 'last_map_center',
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      }));
    }
  }, [region, userLocation]);

  /** Powrót z tła: natychmiast podnieś mapę z natywnego trackingu jazdy. */
  const syncFromBackgroundDriveSnapshot = useCallback(async (
    source: 'foreground' | 'focus',
    opts?: { force?: boolean },
  ) => {
    // Cross-platform: iOS korzysta z WiroomLocationService (bufor + lastFix),
    // Android z VroomBgTracking — oba przez BackgroundDriveController.
    const tripActive = isDrivingRef.current || isNavigatingRef.current;
    if (!tripActive && !opts?.force) return false;
    const now = Date.now();
    if (!opts?.force && now - lastBgDriveResumeSyncAtRef.current < 1200) return false;
    lastBgDriveResumeSyncAtRef.current = now;

    try {
      const [state, buffered] = await Promise.all([
        BackgroundDriveController.getState(),
        BackgroundDriveController.consumeBufferedLocations(),
      ]);
      const fixes: BackgroundDriveFix[] = [
        ...(Array.isArray(buffered) ? buffered : []),
        ...(state?.lastFix ? [state.lastFix] : []),
      ]
        .filter((fix) => (
          Number.isFinite(fix?.latitude)
          && Number.isFinite(fix?.longitude)
          && !isNullIsland(Number(fix.latitude), Number(fix.longitude))
        ))
        .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));

      if (!fixes.length) {
        vroomGpsLog('BG_DRIVE_RESUME_NO_FIXES', {
          source,
          stateActive: state?.active === true,
          stateMode: state?.mode ?? null,
          buffered: Array.isArray(buffered) ? buffered.length : null,
          hasLastFix: Boolean(state?.lastFix),
        }, 0);
        return false;
      }

      const deduped = fixes.filter((fix, index, arr) => {
        if (index === 0) return true;
        const prev = arr[index - 1];
        return (
          Math.abs(Number(fix.timestamp ?? 0) - Number(prev.timestamp ?? 0)) > 5
          || Math.abs(Number(fix.latitude) - Number(prev.latitude)) > 1e-7
          || Math.abs(Number(fix.longitude) - Number(prev.longitude)) > 1e-7
        );
      });
      const latest = deduped[deduped.length - 1];
      const previous = deduped.length >= 2 ? deduped[deduped.length - 2] : null;
      const latestTs = Number(latest.timestamp ?? 0);
      const latestAgeMs = latestTs > 0 ? Math.max(0, now - latestTs) : 0;
      // Pokaż nawet starszą pozycję natychmiast (lepiej niż freeze); świeży fix z
      // watchera zaktualizuje marker w ~1 s. Ancient (>30 min) pomijamy.
      const latestFreshness = classifyFixFreshness(latest, now);
      if (latestFreshness === 'stale') {
        vroomGpsLog('BG_DRIVE_RESUME_STALE_FIX', {
          source,
          ageMs: Math.round(latestAgeMs),
          fixSource: latest.source ?? null,
          isSeed: latest.isSeed === true,
          buffered: deduped.length,
        }, 0);
        return false;
      }
      const bgPauseMs = lastBackgroundAtRef.current > 0
        ? Math.max(0, now - lastBackgroundAtRef.current)
        : 0;
      if (!resumeRecoveryRef.current.active) {
        beginResumeRecovery(resumeRecoveryRef.current, {
          now,
          bgPauseMs,
          seedFixTimestamp: latestTs,
          lastReliableSpeedKmh: Math.max(
            speedKmhRef.current,
            resumeRecoveryRef.current.lastReliableSpeedKmh,
          ),
        });
      } else {
        resumeRecoveryRef.current.seedFixTimestamp = latestTs;
        resumeRecoveryRef.current.lastReliableSpeedKmh = Math.max(
          speedKmhRef.current,
          resumeRecoveryRef.current.lastReliableSpeedKmh,
        );
      }
      if (latestFreshness === 'seed') {
        resumeRecoveryRef.current.phase = 'waitingForFreshFix';
        seedGpsLockFromResume();
        gpsLockEstablishedRef.current = true;
        setGpsAcquiring(false);
        startGPS();
        refreshLocationOneShot({ force: true });
        vroomGpsLog('BG_DRIVE_RESUME_WAIT_FRESH_FIX', {
          source,
          ageMs: Math.round(latestAgeMs),
          fixSource: latest.source ?? null,
          isSeed: latest.isSeed === true,
        }, 0);
        return false;
      }
      resumeRecoveryRef.current.phase = 'roadLocking';

      const latestLat = Number(latest.latitude);
      const latestLng = Number(latest.longitude);
      let applyLat = latestLat;
      let applyLng = latestLng;
      let heading = Number(latest.heading);
      const speedResolution = resolveResumeSpeedKmh(
        latest,
        previous,
        resumeRecoveryRef.current,
        {
          now,
          previousReliableKmh: Math.max(speedKmhRef.current, rawGpsKmhRef.current),
        },
      );
      let speedMs = speedResolution.speedMs;
      const derivedSpeedKmh = speedResolution.source === 'derived' ? speedResolution.speedKmh : 0;

      if (previous) {
        const prevLat = Number(previous.latitude);
        const prevLng = Number(previous.longitude);
        const prevTs = Number(previous.timestamp ?? 0);
        const movedM = haversineKm(prevLat, prevLng, latestLat, latestLng) * 1000;
        const dtSec = prevTs > 0 && latestTs > prevTs ? (latestTs - prevTs) / 1000 : 0;
        if ((!Number.isFinite(heading) || heading < 0) && movedM >= 2.5) {
          heading = bearingBetween(prevLat, prevLng, latestLat, latestLng);
        }
      }

      if (!Number.isFinite(heading) || heading < 0) {
        heading = lastHeadingRef.current || drHdgRef.current || 0;
      }
      heading = normalizeHeading(heading);
      const speedKmh = normalizeHudSpeedKmh(speedResolution.speedKmh);

      if (isNavigatingRef.current) {
        const navPts = routePointsRef.current.length >= 2
          ? routePointsRef.current
          : (navRouteRef.current?.points ?? []);
        if (navPts.length >= 2 && isOnRoute(latestLat, latestLng, navPts, GPS_ON_ROUTE_THRESHOLD_M)) {
          const snapped = snapToRoute(latestLat, latestLng, navPts, NAV_ROUTE_SNAP_M);
          applyLat = snapped.latitude;
          applyLng = snapped.longitude;
        }
      } else if (isDrivingRef.current) {
        const roadPts = drivingSnapGeometryRef.current;
        const roadGeometryFits = roadPts.length >= 2
          && validateGeometryAgainstRaw(roadPts, latestLat, latestLng, 45);
        if (roadPts.length >= 2 && !roadGeometryFits) {
          drivingSnapGeometryRef.current = [];
          lastGoodDrivingSnapGeometryRef.current = [];
          localRoadGeometryMirror.clear();
        }
        const onRoad = roadGeometryFits
          ? projectOntoDrivingRoad(
              latestLat,
              latestLng,
              latestLat,
              latestLng,
              roadPts,
              85,
            )
          : null;
        if (onRoad) {
          applyLat = onRoad.latitude;
          applyLng = onRoad.longitude;
          heading = resolveTripRoadHeading(applyLat, applyLng, roadPts, DRIVING_ENTRY_MAX_SNAP_M, heading);
        }
      }

      rawGpsCourseRef.current = { lat: latestLat, lng: latestLng };
      lastRawForHeadingRef.current = { lat: latestLat, lng: latestLng };
      lastRawTickRef.current = {
        lat: latestLat,
        lng: latestLng,
        at: latestTs > 0 ? latestTs : now,
        acc: Number.isFinite(Number(latest.accuracy)) ? Number(latest.accuracy) : 10,
      };
      lastGpsTickAtRef.current = now;
      lastAcceptedFixWallClockRef.current = now;
      lastGoodTimeRef.current = now;
      prevGoodTimeRef.current = now;
      setGpsAcquiring(false);
      setLocationReady(true);
      rememberMapLastLocation(applyLat, applyLng, Number(latest.accuracy) || undefined);
      void saveMapLastLocation(applyLat, applyLng, Number(latest.accuracy) || undefined);
      seedGpsLockFromResume();
      gpsLockEstablishedRef.current = true;
      setFollowMode(isNavigatingRef.current ? 'navigationFollow' : 'drivingFollow');
      cameraV3.armTripFollow(heading);
      navV3.reset({ lat: applyLat, lng: applyLng, heading });
      const out = navV3.processGpsFix({
        latitude: latestLat,
        longitude: latestLng,
        accuracy: Number.isFinite(Number(latest.accuracy)) ? Number(latest.accuracy) : 10,
        timestamp: latestTs > 0 ? latestTs : now,
        speed: speedMs != null && Number.isFinite(speedMs) && speedMs >= 0 ? speedMs : null,
        heading,
      });
      if (!out || out.rejected) {
        vroomGpsLog('BG_DRIVE_RESUME_NAVV3_REJECT', {
          source,
          ageMs: Math.round(latestAgeMs),
          freshness: latestFreshness,
          lat: Number(latestLat.toFixed(6)),
          lng: Number(latestLng.toFixed(6)),
        }, 0);
        return false;
      }
      markResumeSourceAccepted(resumeRecoveryRef.current, 'snapshot', now);
      publishUserLocation({ latitude: out.target.lat, longitude: out.target.lng }, true);
      driveMarker.ensureFrameActive?.();
      resumeRecoveryRef.current.hardSnapConsumed = true;
      if (isDrivingRef.current && !isNavigatingRef.current && drivingSnapGeometryRef.current.length < 2) {
        void getLocalSnapTarget(latestLat, latestLng).then((hit) => {
          if (!isDrivingRef.current || isNavigatingRef.current) return;
          if (!hit || hit.polylinePoints.length < 2) return;
          applyRoadMatchPoints(hit.polylinePoints, { skipResync: true });
          bumpMatchedFreshness();
          resyncSnapAfterRoadGeometry(latestLat, latestLng, speedKmhRef.current, null);
        });

        const resumeReqId = mapMatchCoord.allocRequestId();
        void mapMatchCoord.requestRecovery({
          reason: 'MANUAL',
          lat: latestLat,
          lng: latestLng,
          speedKmh,
          forceImmediate: true,
        }).then((pts) => {
          if (mapMatchCoord.isStaleRequest(resumeReqId)) return;
          if (!isDrivingRef.current || isNavigatingRef.current) return;
          if (!pts || pts.length < 2) return;
          applyRoadMatchPoints(pts, { skipResync: true });
          bumpMatchedFreshness();
          resyncSnapAfterRoadGeometry(latestLat, latestLng, speedKmhRef.current, null);
        });
      }

      // Zasil GPS lock natywnym fixem, aby bramka onLocation od razu przepuszczała
      // kolejne fixy z watchera — eliminacja 2-3 min freeze po powrocie z tła.
      if (isDrivingRef.current || isNavigatingRef.current) setGpsAcquiring(false);

      vroomGpsLog('BG_DRIVE_RESUME_SYNC', {
        source,
        buffered: deduped.length,
        ageMs: Math.round(latestAgeMs),
        speedKmh: Number(speedKmh.toFixed(1)),
        derivedSpeedKmh: Number(derivedSpeedKmh.toFixed(1)),
        lat: Number(applyLat.toFixed(6)),
        lng: Number(applyLng.toFixed(6)),
      }, 0);
      return true;
    } catch (e) {
      if (__DEV__) console.log('[GPSDBG] BG_DRIVE_RESUME_SYNC_FAIL', e);
      return false;
    }
  }, [
    driveMarker,
    publishUserLocation,
    seedGpsLockFromResume,
    getLocalSnapTarget,
    applyRoadMatchPoints,
    bumpMatchedFreshness,
    resyncSnapAfterRoadGeometry,
    mapMatchCoord,
    navV3,
    cameraV3,
    setFollowMode,
    startGPS,
    refreshLocationOneShot,
  ]);

  const applyNativeDriveFixToV3Pipeline = useCallback((fix: BackgroundDriveFix) => {
    if (!isDrivingRef.current && !isNavigatingRef.current) return false;
    const now = Date.now();
    markResumeSourceSeen(resumeRecoveryRef.current, 'native', now);
    if (resumeRecoveryRef.current.active) {
      vroomGpsLog('RESUME_NATIVE_SEEN', {
        phase: resumeRecoveryRef.current.phase,
        gpsLock: gpsLockEstablishedRef.current,
        ageMs: Math.round(now - Number(fix.timestamp ?? now)),
        fixSource: fix.source ?? null,
        isSeed: fix.isSeed === true,
        accM: Number.isFinite(Number(fix.accuracy)) ? Math.round(Number(fix.accuracy)) : null,
      }, 500);
    }
    if (
      resumeRecoveryRef.current.active
      && !shouldAcceptResumeSource(resumeRecoveryRef.current, 'native', now, {
        expoFreshMs: lastExpoGpsTickAtRef.current > 0 ? now - lastExpoGpsTickAtRef.current : Number.POSITIVE_INFINITY,
        nativeFreshMs: lastNativeDrivePipelineAtRef.current > 0 ? now - lastNativeDrivePipelineAtRef.current : Number.POSITIVE_INFINITY,
      })
    ) {
      vroomGpsLog('RESUME_NATIVE_SOURCE_BLOCK', {
        phase: resumeRecoveryRef.current.phase,
        lastNativeAcceptedMs: resumeRecoveryRef.current.lastNativeAcceptedAt > 0
          ? Math.round(now - resumeRecoveryRef.current.lastNativeAcceptedAt)
          : null,
        lastExpoAcceptedMs: resumeRecoveryRef.current.lastExpoAcceptedAt > 0
          ? Math.round(now - resumeRecoveryRef.current.lastExpoAcceptedAt)
          : null,
      }, 0);
      return false;
    }
    const lat = Number(fix.latitude);
    const lng = Number(fix.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || isNullIsland(lat, lng)) {
      vroomGpsLog('RESUME_NATIVE_INVALID', {
        phase: resumeRecoveryRef.current.phase,
        lat,
        lng,
      }, 0);
      return false;
    }

    const fixTsRaw = Number(fix.timestamp ?? 0);
    const fixTs = fixTsRaw > 0 ? fixTsRaw : now;
    const nativeFreshness = classifyFixFreshness(fix, now);
    if (nativeFreshness === 'stale') {
      vroomGpsLog('RESUME_NATIVE_STALE', {
        phase: resumeRecoveryRef.current.phase,
        ageMs: Math.round(now - fixTs),
        fixSource: fix.source ?? null,
        isSeed: fix.isSeed === true,
      }, 0);
      return false;
    }
    if (nativeFreshness === 'seed') {
      if (resumeRecoveryRef.current.active) {
        resumeRecoveryRef.current.phase = 'waitingForFreshFix';
        seedGpsLockFromResume();
        gpsLockEstablishedRef.current = true;
        setGpsAcquiring(false);
      }
      vroomGpsLog('RESUME_NATIVE_SEED_WAIT', {
        phase: resumeRecoveryRef.current.phase,
        ageMs: Math.round(now - fixTs),
        fixSource: fix.source ?? null,
      }, 0);
      return false;
    }

    const acc = Number.isFinite(Number(fix.accuracy)) ? Number(fix.accuracy) : 12;
    let heading = Number(fix.heading);
    const prevRaw = lastRawTickRef.current;
    const speedResolution = resumeRecoveryRef.current.active
      ? resolveResumeSpeedKmh(
          fix,
          prevRaw,
          resumeRecoveryRef.current,
          {
            now,
            previousReliableKmh: Math.max(speedKmhRef.current, rawGpsKmhRef.current),
          },
        )
      : null;
    let speedMs: number | null = speedResolution
      ? speedResolution.speedMs
      : (Number.isFinite(Number(fix.speed)) ? Number(fix.speed) : null);
    if (prevRaw) {
      const dtSec = fixTs > 0 && fixTs > prevRaw.at ? (fixTs - prevRaw.at) / 1000 : 0;
      const movedM = haversineKm(prevRaw.lat, prevRaw.lng, lat, lng) * 1000;
      if ((!Number.isFinite(heading) || heading < 0) && movedM >= 2.5) {
        heading = bearingBetween(prevRaw.lat, prevRaw.lng, lat, lng);
      }
      if (!resumeRecoveryRef.current.active && (speedMs == null || speedMs < 0.3) && dtSec >= 0.5 && movedM >= 2.5) {
        speedMs = Math.min(MAX_REALISTIC_DRIVING_KMH, (movedM / dtSec) * 3.6) / 3.6;
      }
    }
    if (!Number.isFinite(heading) || heading < 0) {
      heading = lastHeadingRef.current || drHdgRef.current || 0;
    }
    heading = normalizeHeading(heading);
    if (speedMs == null || !Number.isFinite(speedMs) || speedMs < 0) {
      speedMs = speedKmhRef.current > 0 ? speedKmhRef.current / 3.6 : null;
    }

    seedGpsLockFromResume();
    gpsLockEstablishedRef.current = true;
    setGpsAcquiring(false);
    setLocationReady(true);

    rawGpsCourseRef.current = { lat, lng };
    lastRawTickRef.current = { lat, lng, at: fixTs, acc };
    lastGpsTickAtRef.current = now;
    lastAcceptedFixWallClockRef.current = now;
    currentLocRef.current = { latitude: lat, longitude: lng };
    syncDrivingRoadGeometry(lat, lng, Math.max(0, speedMs != null ? speedMs * 3.6 : speedKmhRef.current), acc);

    const out = navV3.processGpsFix({
      latitude: lat,
      longitude: lng,
      accuracy: acc,
      timestamp: fixTs,
      speed: speedMs != null && Number.isFinite(speedMs) && speedMs >= 0 ? speedMs : null,
      heading,
    });

    if (!out || out.rejected) {
      vroomGpsLog('RESUME_NATIVE_NAVV3_REJECT', {
        phase: resumeRecoveryRef.current.phase,
        accM: Math.round(acc),
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      }, 0);
      return false;
    }
    markResumeSourceAccepted(resumeRecoveryRef.current, 'native', now);
    lastNativeDrivePipelineAtRef.current = now;
    if (resumeRecoveryRef.current.active) {
      vroomGpsLog('RESUME_NATIVE_ACCEPT', {
        phase: resumeRecoveryRef.current.phase,
        accM: Math.round(acc),
        lat: Number(out.target.lat.toFixed(6)),
        lng: Number(out.target.lng.toFixed(6)),
      }, 0);
    }
    currentLocRef.current = {
      latitude: out.target.lat,
      longitude: out.target.lng,
    };
    lastGoodLocRef.current = { lat: out.target.lat, lng: out.target.lng };
    lastSetLocRef.current = { lat: out.target.lat, lng: out.target.lng };
    lastTripMarkerPoseRef.current = { lat: out.target.lat, lng: out.target.lng };
    return true;
  }, [navV3, seedGpsLockFromResume, syncDrivingRoadGeometry]);

  useEffect(() => {
    let lastNativeApplyAt = 0;
    return BackgroundDriveController.addLocationListener((fix) => {
      if (!isDrivingRef.current && !isNavigatingRef.current) return;
      const now = Date.now();
      lastNativeSeenAtRef.current = now;
      if (now - lastNativeApplyAt < 450) return;
      if (appStateRef.current === 'active'
        && lastExpoGpsTickAtRef.current > 0
        && now - lastExpoGpsTickAtRef.current < 1200) return;
      lastNativeApplyAt = now;
      const applied = applyNativeDriveFixToV3Pipeline(fix);
      const markerReady =
        driveMarker.isBootstrapped
        && Number.isFinite(driveMarker.lat.value)
        && Number.isFinite(driveMarker.lng.value)
        && !(Math.abs(driveMarker.lat.value) < 1e-6 && Math.abs(driveMarker.lng.value) < 1e-6);
      if (!applied && !markerReady && now - lastBgDriveResumeSyncAtRef.current > 2500) {
        void syncFromBackgroundDriveSnapshot('foreground', { force: true });
      }
    });
  }, [applyNativeDriveFixToV3Pipeline, driveMarker, syncFromBackgroundDriveSnapshot]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (didColdStartBgDriveRestoreRef.current) return;
    didColdStartBgDriveRestoreRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const [state, navRaw, navFlag, drivingFlag] = await Promise.all([
          BackgroundDriveController.getState(),
          AsyncStorage.getItem(NAV_SESSION_KEY),
          AsyncStorage.getItem(BG_IS_NAVIGATING_KEY),
          AsyncStorage.getItem(BG_IS_DRIVING_KEY),
        ]);
        if (cancelled) return;

        let hasFreshNavSession = false;
        try {
          if (navRaw) {
            const navSession: PersistedNavSession = JSON.parse(navRaw);
            hasFreshNavSession = Boolean(
              navSession?.endLocation
              && navSession.savedAt
              && Date.now() - navSession.savedAt <= NAV_SESSION_MAX_AGE_MS,
            );
          }
        } catch {
          hasFreshNavSession = false;
        }

        const nativeActive = state?.active === true;
        const shouldRestore = nativeActive || navFlag === 'true' || drivingFlag === 'true';
        if (!shouldRestore) {
          navSessionColdStartGuardUntilRef.current = 0;
          return;
        }
        const nativeStats = await BackgroundDriveController.getNativeStats();

        // Cold-start = nowy proces = aplikacja została w pełni zamknięta (swipe-kill
        // lub reclaim systemu). Decyzja UX: nawigacja NIE jest przywracana po pełnym
        // zamknięciu — degradujemy do trybu jazdy (km liczą się dalej, pozycja gotowa
        // natychmiast). Minimalizacja nie powoduje cold-startu, więc nawigacja przy
        // minimalizacji pozostaje aktywna (stan React żyje).
        const wasNavigation =
          state?.mode === 'navigation'
          || navFlag === 'true'
          || hasFreshNavSession;

        const now = Date.now();
        // Wyczyść pozostałości nawigacji ZANIM wystartujemy natywny tryb jazdy —
        // setDrivingFlag(true) odczytuje bg_is_navigating i musi zobaczyć 'false',
        // aby uruchomić natywny serwis w trybie freeDrive (nie navigation).
        await AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false');
        await AsyncStorage.removeItem(NAV_SESSION_KEY);

        isDrivingRef.current = true;
        isNavigatingRef.current = false;
        tripCheckpointActiveRef.current = true;
        setIsNavigating(false);
        setIsDriving(true);
        await startDriveSession('freeDrive');
        await setNavigatingFlag(false);
        drivingManualModeRef.current = false;
        drivingManuallyDisabledRef.current = false;
        drivingManualEntryBusyRef.current = false;
        driveSessionGuardRef.current.reset();
        setTripCameraActive(true);
        setFollowMode('drivingFollow');
        drivingSinceRef.current = now;
        drivingConsecutiveRef.current = DRIVING_CONSECUTIVE_REQ;
        tripSpeedWarmupUntilRef.current = now + 10_000;
        if (!passiveTripStartedRef.current) {
          startTrip(routeDurationMinutesToSeconds(routeInfoRef.current?.duration));
          passiveTripStartedRef.current = true;
        }

        if (Number(nativeStats.distanceKm) > 0) {
          restoreTripSnapshot({
            tripSessionId: String(nativeStats.tripSessionId ?? state?.tripSessionId ?? await ensureTripSessionId()),
            distanceKm: Math.max(0, Number(nativeStats.distanceKm) || 0),
            trackedPoints: Array.isArray(nativeStats.routePoints)
              ? nativeStats.routePoints.filter((p) => (
                  Number.isFinite(p?.latitude)
                  && Number.isFinite(p?.longitude)
                ))
              : [],
            speedSamples: Array.isArray(nativeStats.speedSamples)
              ? nativeStats.speedSamples
                .map(Number)
                .filter((s) => Number.isFinite(s) && s > 0)
              : [],
            startTimeMs: state?.startedAt ?? null,
            estimatedSec: routeDurationMinutesToSeconds(routeInfoRef.current?.duration),
            floorKm: Math.max(0, Number(nativeStats.distanceKm) || 0),
            savedAt: Date.now(),
          });
        }

        tripResumeFreezeUntilRef.current = 0;
        tripResumeAnchorRef.current = null;
        tripResumeConfirmRef.current = null;
        tripMarkerV2BootstrappedRef.current = true;
        driveSessionFirstGpsFrameRef.current = true;
        driveSessionInitFramesRef.current = 0;
        foregroundGpsIntentionallyStoppedRef.current = false;
        if (!gpsForceActiveRef.current) {
          gpsForceActiveRef.current = true;
          applyGpsForceActive(true);
        }
        startGPS();

        const synced = await syncFromBackgroundDriveSnapshot('focus', { force: true });
        if (cancelled) return;

        if (!synced && state?.lastFix) {
          const fix = state.lastFix;
          const lat = Number(fix.latitude);
          const lng = Number(fix.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng) && !isNullIsland(lat, lng)) {
            const heading = Number.isFinite(Number(fix.heading))
              ? normalizeHeading(Number(fix.heading))
              : normalizeHeading(lastHeadingRef.current || drHdgRef.current || 0);
            const speedMs = Number.isFinite(Number(fix.speed)) && Number(fix.speed) > 0
              ? Number(fix.speed)
              : 0;
            speedKmhRef.current = normalizeHudSpeedKmh(speedMs * 3.6);
            emitSpeedometerKmh(speedKmhRef.current);
            currentLocRef.current = { latitude: lat, longitude: lng };
            lastGoodLocRef.current = { lat, lng };
            lastSetLocRef.current = { lat, lng };
            lastTripMarkerPoseRef.current = { lat, lng };
            drLatRef.current = lat;
            drLngRef.current = lng;
            drHdgRef.current = heading;
            lastHeadingRef.current = heading;
            setGpsAcquiring(false);
            setLocationReady(true);
            publishUserLocation({ latitude: lat, longitude: lng }, true);
            tripBootstrapPose(lat, lng, heading, { animateCamera: true });
            // Cold-start z natywnym lastFix: zasil lock, aby watcher od razu podawał fixy.
            seedGpsLockFromResume();
            gpsLockEstablishedRef.current = true;
          }
        }

        vroomGpsLog('BG_DRIVE_COLD_START_RESTORE', {
          mode: 'freeDrive',
          wasNavigation,
          nativeActive,
          synced,
          hasLastFix: Boolean(state?.lastFix),
        }, 0);
      } catch (e) {
        if (__DEV__) console.log('[GPSDBG] BG_DRIVE_COLD_START_RESTORE_FAIL', e);
      } finally {
        navSessionColdStartGuardUntilRef.current = 0;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    startGPS,
    startTrip,
    updateTripEstimate,
    setFollowMode,
    syncFromBackgroundDriveSnapshot,
    publishUserLocation,
    tripBootstrapPose,
    restoreTripSnapshot,
    navV3,
    seedGpsLockFromResume,
  ]);

  /** Krótki powrót z tła (<20s) — bez restartu GPS, map-match i fake 12 km/h. */
  const BRIEF_BG_RESUME_MAX_MS = 20_000;

  const handleGpsResume = useCallback((
    source: 'foreground' | 'focus',
    opts?: { forceWatcherRestart?: boolean; bgPauseMs?: number },
  ) => {
    const now = Date.now();
    if (
      source === 'focus'
      && now - lastForegroundResumeAtRef.current < GPS_SKIP_FOCUS_AFTER_FOREGROUND_MS
      && appStateRef.current === 'active'
    ) {
      if (__DEV__) {
        console.log('[GPSDBG] RESUME_SKIP_FOCUS_AFTER_FOREGROUND', JSON.stringify({
          at: now,
          deltaMs: Math.round(now - lastForegroundResumeAtRef.current),
        }));
      }
      return;
    }
    if (source === 'foreground') {
      lastForegroundResumeAtRef.current = now;
    }
    if (__DEV__) console.log('[GPSDBG] RESUME_FLOW', JSON.stringify({ at: now, source }));

    const bgPauseMs = opts?.bgPauseMs ?? (
      lastBackgroundAtRef.current > 0 ? now - lastBackgroundAtRef.current : 0
    );
    if (bgPauseMs >= GPS_BACKGROUND_STALE_MS && (isDrivingRef.current || isNavigatingRef.current)) {
      tripResumeFreezeUntilRef.current = 0;
      tripResumeAnchorRef.current = null;
      tripResumeConfirmRef.current = null;
      tripResumeMotionWakeHitsRef.current = 0;
    }

    const tripActiveNow = isDrivingRef.current || isNavigatingRef.current;
    const longTripResume = tripActiveNow && bgPauseMs >= GPS_BACKGROUND_STALE_MS;
    if (longTripResume) {
      beginResumeRecovery(resumeRecoveryRef.current, {
        now,
        bgPauseMs,
        seedFixTimestamp: lastAcceptedFixWallClockRef.current,
        lastReliableSpeedKmh: Math.max(
          speedKmhRef.current,
          rawGpsKmhRef.current,
          resumeRecoveryRef.current.lastReliableSpeedKmh,
        ),
      });
      resumeRecoveryRef.current.phase = 'waitingForFreshFix';
      resumeRecoveryRef.current.firstFreshFixAccepted = false;
      seedGpsLockFromResume();
      gpsLockEstablishedRef.current = true;
      setGpsAcquiring(false);
      tripResumeFreezeUntilRef.current = 0;
      tripResumeAnchorRef.current = null;
      tripResumeConfirmRef.current = null;
      tripResumeMotionWakeHitsRef.current = 0;
      resumeAwaitFixUntilRef.current = now + GPS_ONESHOT_AFTER_RESUME_MS;
      tripForegroundRefreshUntilRef.current = 0;
      startGPS();
      refreshLocationOneShot({ force: true });
      vroomGpsLog('RESUME_RECOVERY_ARMED', {
        source,
        bgPauseMs: Math.round(bgPauseMs),
        gpsLock: gpsLockEstablishedRef.current,
        locationReady: locationReadyRef.current,
        lastAcceptedAgeMs: lastAcceptedFixWallClockRef.current > 0
          ? Math.round(now - lastAcceptedFixWallClockRef.current)
          : null,
        lastGpsTickAgeMs: lastGpsTickAtRef.current > 0
          ? Math.round(now - lastGpsTickAtRef.current)
          : null,
      }, 0);
    }
    if (tripActiveNow) {
      void syncFromBackgroundDriveSnapshot(source, {
        force: longTripResume,
      }).then((synced) => {
        if (synced || !resumeRecoveryRef.current.active) return;
        seedGpsLockFromResume();
        gpsLockEstablishedRef.current = true;
        setGpsAcquiring(false);
        startGPS();
        refreshLocationOneShot({ force: true });
        vroomGpsLog('RESUME_RECOVERY_SNAPSHOT_FALLBACK', {
          source,
          bgPauseMs: Math.round(bgPauseMs),
        }, 0);
      });
    }
    const fixAgeMs = lastAcceptedFixWallClockRef.current > 0
      ? now - lastAcceptedFixWallClockRef.current
      : Number.POSITIVE_INFINITY;
    const tickAgeMs = lastGpsTickAtRef.current > 0
      ? now - lastGpsTickAtRef.current
      : Number.POSITIVE_INFINITY;

    if (
      true
      && tripActiveNow
      && bgPauseMs > 0
      && bgPauseMs < BRIEF_BG_RESUME_MAX_MS
      && locationReadyRef.current
    ) {
      if (now - lastResumeHandledAtRef.current < GPS_RESUME_DEDUPE_MS) {
        if (!shouldSkipResumeDedupe(bgPauseMs)) return;
      }
      lastResumeHandledAtRef.current = now;
      setGpsAcquiring(false);
      tripResumeFreezeUntilRef.current = 0;
      tripResumeAnchorRef.current = null;
      tripForegroundRefreshUntilRef.current = 0;
      resumeAwaitFixUntilRef.current = 0;
      resumeForegroundTickCountRef.current = 0;
      if (resumeOneShotTimerRef.current) clearTimeout(resumeOneShotTimerRef.current);
      if (resumeFollowUpOneShotRef.current) clearTimeout(resumeFollowUpOneShotRef.current);
      bgProjectionCooldownUntilRef.current = now + BG_PROJECTION_COOLDOWN_MS;

      const watcherStale = fixAgeMs >= GPS_WATCHER_STALE_MS || tickAgeMs >= GPS_WATCHER_STALE_MS;
      if (watcherStale && !opts?.forceWatcherRestart) {
        restartGPSWatcher(source === 'focus' ? 'focus' : 'resume', { force: false });
      }
      if (tickAgeMs > 3500 || fixAgeMs > 8000) {
        refreshLocationOneShot({ force: true });
      }

      driveMarker.ensureFrameActive?.();
      vroomGpsLog('RESUME_BRIEF_V2', {
        bgPauseMs: Math.round(bgPauseMs),
        fixAgeMs: Math.round(fixAgeMs),
        tickAgeMs: Math.round(tickAgeMs),
        watcherStale,
      });
      if (__DEV__) {
        console.log('[GPSDBG] RESUME_BRIEF_V2', JSON.stringify({
          at: now,
          bgPauseMs: Math.round(bgPauseMs),
          fixAgeMs: Math.round(fixAgeMs),
        }));
      }
      return;
    }

    ensureRegionBootstrapped(source);
    void loadMapLastLocation().then((cached) => {
      if (!cached) return;
      if (isDrivingRef.current || isNavigatingRef.current) return;
      if (!locationReadyRef.current || !currentLocRef.current) {
        applyBootstrapLocation(cached.latitude, cached.longitude, {
          approximate: true,
          accuracy: cached.accuracy,
        });
      }
    });
    if (!locationReadyRef.current) {
      // Cold/warm reopen path: don't wait for "locationReady" gate, force
      // a watcher + one-shot so the map reacquires GPS immediately.
      setGpsAcquiring(false);
      startGPS();
      refreshLocationOneShot({ force: true });
      if (__DEV__) console.log('[GPSDBG] RESUME_FORCE_REACQUIRE', JSON.stringify({ at: Date.now(), source }));
      return;
    }
    if (now - lastResumeHandledAtRef.current < GPS_RESUME_DEDUPE_MS) {
      if (!shouldSkipResumeDedupe(bgPauseMs)) return;
    }
    lastResumeHandledAtRef.current = now;
    setGpsAcquiring(false);
    console.log(`[GPS] Resume flow (${source})`);
    if (!opts?.forceWatcherRestart) {
      restartGPSWatcher(
        source === 'focus' ? 'focus' : 'resume',
        { force: bgPauseMs >= GPS_BACKGROUND_STALE_MS },
      );
    }
    if (source === 'focus') {
      refreshLocationOneShot({ force: true });
    }
    if (isNavigatingRef.current || isDrivingRef.current) {
      tripForegroundRefreshUntilRef.current = bgPauseMs >= GPS_BACKGROUND_STALE_MS
        ? 0
        : now + TRIP_FOREGROUND_REFRESH_MS;
      resumeForegroundTickCountRef.current = 0;
      refreshLocationOneShot({ force: true });
      if (resumeFollowUpOneShotRef.current) clearTimeout(resumeFollowUpOneShotRef.current);
      resumeFollowUpOneShotRef.current = setTimeout(() => {
        const tickFresh = lastGpsTickAtRef.current >= lastResumeHandledAtRef.current + 500;
        if (!tickFresh) {
          refreshLocationOneShot({ force: true });
        }
      }, RESUME_FOLLOWUP_ONESHOT_MS);
    }
    resumeAwaitFixUntilRef.current = now + GPS_ONESHOT_AFTER_RESUME_MS;
    if (resumeOneShotTimerRef.current) clearTimeout(resumeOneShotTimerRef.current);
    resumeOneShotTimerRef.current = setTimeout(() => {
      // If watcher delivered a valid fix already, skip one-shot fallback.
      if (lastAcceptedFixWallClockRef.current >= lastResumeHandledAtRef.current) {
        resumeAwaitFixUntilRef.current = 0;
        return;
      }
      refreshLocationOneShot({ force: isNavigatingRef.current || isDrivingRef.current });
    }, GPS_ONESHOT_AFTER_RESUME_MS);

    bgProjectionCooldownUntilRef.current = now + BG_PROJECTION_COOLDOWN_MS;
    if (bgMarkerTickRef.current) {
      clearInterval(bgMarkerTickRef.current);
      bgMarkerTickRef.current = null;
    }
    if (isNavigatingRef.current || isDrivingRef.current) {
      const holdLat = Number.isFinite(drLatRef.current) && drLatRef.current !== 0
        ? drLatRef.current
        : (lastSetLocRef.current?.lat ?? 0);
      const holdLng = Number.isFinite(drLngRef.current) && drLngRef.current !== 0
        ? drLngRef.current
        : (lastSetLocRef.current?.lng ?? 0);
      const holdHdg = lastHeadingRef.current || 0;
      const holdSpeedMs = Math.max(0, speedKmhRef.current / 3.6);
      if (Number.isFinite(holdLat) && Number.isFinite(holdLng) && holdLat !== 0 && holdLng !== 0) {
        const holdAt = Date.now();
        markerProjRef.current = {
          lat: holdLat,
          lng: holdLng,
          hdg: holdHdg,
          speedMs: holdSpeedMs,
          at: holdAt,
        };
        markerDisplayRef.current = {
          lat: holdLat,
          lng: holdLng,
          hdg: holdHdg,
          speedMs: holdSpeedMs,
          at: holdAt,
        };
      }
    } else {
      markerProjRef.current = { lat: 0, lng: 0, hdg: 0, speedMs: 0, at: 0 };
    }

    // Po odblokowaniu: utrzymaj ostatnią snapped pozycję; nie resetuj DR (unika teleportu).
    if (isNavigatingRef.current || isDrivingRef.current) {
      const bgPauseMs = lastBackgroundAtRef.current > 0 ? now - lastBackgroundAtRef.current : 0;
      const cachedLive = peekMapLastLocation();
      const anchorLatLng = (() => {
        if (
          Number.isFinite(drLatRef.current)
          && Number.isFinite(drLngRef.current)
          && drLatRef.current !== 0
          && drLngRef.current !== 0
        ) {
          return { lat: drLatRef.current, lng: drLngRef.current };
        }
        if (lastSetLocRef.current) {
          return { lat: lastSetLocRef.current.lat, lng: lastSetLocRef.current.lng };
        }
        if (lastGoodLocRef.current) return lastGoodLocRef.current;
        const cur = currentLocRef.current;
        if (cur && Number.isFinite(cur.latitude) && Number.isFinite(cur.longitude)) {
          return { lat: cur.latitude, lng: cur.longitude };
        }
        return null;
      })();
      if (anchorLatLng) {
        const hdg = lastHeadingRef.current || 0;
        const jumpFromAnchorM = cachedLive
          ? haversineKm(anchorLatLng.lat, anchorLatLng.lng, cachedLive.latitude, cachedLive.longitude) * 1000
          : 0;
        const resumeInstantSync = true
          || bgPauseMs >= TRIP_RESUME_BG_PAUSE_INSTANT_MS
          || jumpFromAnchorM >= TRIP_RESUME_INSTANT_JUMP_M;
        const freezeMs = (true || resumeInstantSync)
          ? 0
          : Math.min(
              TRIP_RESUME_FREEZE_MAX_MS,
              Math.max(
                TRIP_RESUME_FREEZE_SHORT_MS,
                bgPauseMs > 800 ? Math.min(bgPauseMs + 2000, 10_000) : TRIP_RESUME_FREEZE_SHORT_MS,
              ),
            );
        tripResumeAnchorRef.current = resumeInstantSync
          ? null
          : { lat: anchorLatLng.lat, lng: anchorLatLng.lng, hdg };
        tripResumeFreezeUntilRef.current = freezeMs > 0 ? now + freezeMs : 0;
        tripResumeConfirmRef.current = null;
        tripResumeMotionWakeHitsRef.current = 0;
        const hadMovementBeforeResume =
          speedKmhRef.current >= 4
          || jumpFromAnchorM >= 8;
        if (!hadMovementBeforeResume) {
          tripMoveSamplesRef.current = [];
        } else if (
          tripMoveSamplesRef.current.length === 0
          && cachedLive
          && lastSetLocRef.current
        ) {
          tripMoveSamplesRef.current = [
            {
              lat: lastSetLocRef.current.lat,
              lng: lastSetLocRef.current.lng,
              t: now - 1200,
            },
            {
              lat: anchorLatLng.lat,
              lng: anchorLatLng.lng,
              t: now,
            },
          ];
        }
        speedSignalHoldUntilRef.current = now + TRIP_FOREGROUND_SPEED_HOLD_MS;
        const syncLat = anchorLatLng.lat;
        const syncLng = anchorLatLng.lng;
        drLatRef.current = syncLat;
        drLngRef.current = syncLng;
        lastSetLocRef.current = { lat: syncLat, lng: syncLng };
        lastGoodLocRef.current = { lat: syncLat, lng: syncLng };
        if (lastDrivingPosRef.current) {
          lastDrivingPosRef.current = { lat: syncLat, lng: syncLng };
        }
        driveMarker.ensureFrameActive?.();
        vroomGpsLog('RESUME_PROTOCOL', {
          bgPauseMs: Math.round(bgPauseMs),
          freezeMs,
          jumpFromAnchorM: Math.round(jumpFromAnchorM),
          instantSync: resumeInstantSync,
          lat: Number(syncLat.toFixed(5)),
          lng: Number(syncLng.toFixed(5)),
        }, 0);
        markerLogCritical('RESUME_TRIP_ANCHOR', {
          lat: Number(syncLat.toFixed(5)),
          lng: Number(syncLng.toFixed(5)),
          bgPauseMs: Math.round(bgPauseMs),
          freezeMs,
          instantSync: resumeInstantSync,
          v10: true,
          isDriving: isDrivingRef.current,
        });
      }
    }
  }, [
    restartGPSWatcher,
    refreshLocationOneShot,
    startGPS,
    hardRestartGPS,
    ensureRegionBootstrapped,
    applyBootstrapLocation,
    
    bumpActiveMarker,
    getMatchedPoints,
    applyRoadMatchPoints,
    bumpMatchedFreshness,
    runMapMatchRecovery,
    resyncSnapAfterRoadGeometry,
    resetBrowseCamera,
    publishUserLocation,
    driveMarker,
    syncFromBackgroundDriveSnapshot,
  ]);
  const handleGpsResumeRef = useRef(handleGpsResume);
  useEffect(() => {
    handleGpsResumeRef.current = handleGpsResume;
  }, [handleGpsResume]);
  const bumpMatchedFreshnessRef = useRef(bumpMatchedFreshness);
  useEffect(() => {
    bumpMatchedFreshnessRef.current = bumpMatchedFreshness;
  }, [bumpMatchedFreshness]);
  const stopGPSRef = useRef(stopGPS);
  useEffect(() => {
    stopGPSRef.current = () => {
      foregroundGpsIntentionallyStoppedRef.current = true;
      stopGPS();
    };
  }, [stopGPS]);
  const startGPSRef = useRef(startGPS);
  useEffect(() => {
    startGPSRef.current = startGPS;
  }, [startGPS]);
  // ── Restart GPS when app returns to foreground ──────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      const bgTrackingEnabled = backgroundTrackingRef.current;
      if (__DEV__) {
        console.log('[GPSDBG] APP_STATE', JSON.stringify({
          at: Date.now(),
          prev: prevState,
          next: nextState,
          isDriving: isDrivingRef.current,
          isNavigating: isNavigatingRef.current,
        }));
      }
      const tripActive = isDrivingRef.current || isNavigatingRef.current;
      // AppState inactive (banner powiadomienia) — NIE kończy sesji jazdy, NIE ustawia tła Mapbox.
      // Tylko pełne background wstrzymuje agresywne odpytywanie Map Matching.
      if (nextState === 'inactive' && tripActive) {
        bumpMatchedFreshnessRef.current();
      }
      if (nextState === 'background') {
        lastBackgroundAtRef.current = Date.now();
        if (true) {
          setMapMatchAppBackground(true);
        }
        setMapMatchAppBackground(true);
        if (tripActive) {
          bumpMatchedFreshnessRef.current();
          const holdLat = drLatRef.current;
          const holdLng = drLngRef.current;
          if (
            Number.isFinite(holdLat)
            && Number.isFinite(holdLng)
            && holdLat !== 0
            && holdLng !== 0
          ) {
            lastGoodLocRef.current = { lat: holdLat, lng: holdLng };
            rememberMapLastLocation(holdLat, holdLng);
            void saveMapLastLocation(holdLat, holdLng);
          }
          const bgStats = finishTrip();
          void writeEmergencyTripSave({
            distanceKm: bgStats.distanceKm,
            trackedPoints: bgStats.trackedPoints,
            speedSamples: [],
            startTimeMs: null,
            estimatedSec: bgStats.estimatedSec,
            floorKm: bgStats.distanceKm,
            savedAt: Date.now(),
          });
          void flushTripDistanceCheckpointRef.current({
            minKm: TRIP_CHECKPOINT_FORCE_MIN_KM,
            forceAll: true,
            reason: 'app_background',
          });
        }
        // FGS / GPS w tle tylko dla Premium — darmowi nie dostają pusha przy minimize.
        if (!bgTrackingEnabled) {
          // Bez śledzenia w tle: zatrzymaj GPS po zminimalizowaniu (także podczas jazdy).
          stopGPSRef.current();
        } else {
          // bgEnabled=true → trzymamy watcher i DR przy życiu w tle (Premium).
          if (!tripActive) {
            void 0;
          }
        }
        // Live zostaje włączone w preferencjach — po powrocie z tła wznawiamy socket (resumeLiveSession).
      }
      const resumed =
        (prevState === 'background' || prevState === 'inactive') &&
        nextState === 'active';
      if (resumed) {
        if (true) {
          setMapMatchAppBackground(false);
        }
        setMapMatchAppBackground(false);
        const now = Date.now();
        const bgPauseMs = lastBackgroundAtRef.current > 0 ? now - lastBackgroundAtRef.current : 0;
        const fixAgeMs = lastAcceptedFixWallClockRef.current > 0
          ? now - lastAcceptedFixWallClockRef.current
          : Number.POSITIVE_INFINITY;
        const tickAgeMs = lastGpsTickAtRef.current > 0
          ? now - lastGpsTickAtRef.current
          : Number.POSITIVE_INFINITY;
        const transientStateBounce =
          !tripActive
          && !foregroundGpsIntentionallyStoppedRef.current
          && bgPauseMs > 0
          && bgPauseMs < GPS_RESUME_MIN_BG_PAUSE_MS
          && fixAgeMs < GPS_WATCHER_STALE_MS
          && tickAgeMs < GPS_WATCHER_STALE_MS
          && !gpsAcquiringRef.current;
        if (transientStateBounce) {
          if (__DEV__) {
            console.log('[GPSDBG] RESUME_SKIP_BOUNCE', JSON.stringify({
              at: now,
              bgPauseMs: Math.round(bgPauseMs),
              fixAgeMs: Math.round(fixAgeMs),
            }));
          }
          return;
        }
        drivingManualEntryBusyRef.current = false;
        void (async () => {
          const optedOut = await AsyncStorage.getItem(LIVE_SHARING_USER_PREF_KEY);
          if (optedOut === 'false') return;
          if (!tripActive) return;
          if (!isSharingRef.current) return;
          await resumeLiveSession();
        })();
      }
    });
    return () => sub.remove();
  }, [resumeLiveSession]);

  useGpsForegroundLifecycle({
    getTripActive: () => isDrivingRef.current || isNavigatingRef.current,
    getLastBackgroundAt: () => lastBackgroundAtRef.current,
    getFixAgeMs: () => {
      const t = lastAcceptedFixWallClockRef.current;
      return t > 0 ? Date.now() - t : Number.POSITIVE_INFINITY;
    },
    getTickAgeMs: () => {
      const t = lastGpsTickAtRef.current;
      return t > 0 ? Date.now() - t : Number.POSITIVE_INFINITY;
    },
    hardRestart: hardRestartGPS,
    onResume: (ctx) => {
      if (ctx.source !== 'foreground') return;
      const now = Date.now();
      const fixAgeMs = lastAcceptedFixWallClockRef.current > 0
        ? now - lastAcceptedFixWallClockRef.current
        : Number.POSITIVE_INFINITY;
      const tickAgeMs = lastGpsTickAtRef.current > 0
        ? now - lastGpsTickAtRef.current
        : Number.POSITIVE_INFINITY;
      const transientStateBounce =
        !ctx.tripActive
        && !foregroundGpsIntentionallyStoppedRef.current
        && ctx.bgPauseMs > 0
        && ctx.bgPauseMs < GPS_RESUME_MIN_BG_PAUSE_MS
        && fixAgeMs < GPS_WATCHER_STALE_MS
        && tickAgeMs < GPS_WATCHER_STALE_MS
        && !gpsAcquiringRef.current;
      if (transientStateBounce) {
        if (__DEV__) {
          console.log('[GPSDBG] RESUME_SKIP_BOUNCE', JSON.stringify({
            at: now,
            bgPauseMs: Math.round(ctx.bgPauseMs),
            fixAgeMs: Math.round(fixAgeMs),
          }));
        }
        return;
      }
      drivingManualEntryBusyRef.current = false;
      handleGpsResumeRef.current('foreground', {
        forceWatcherRestart: ctx.forceWatcherRestart,
        bgPauseMs: ctx.bgPauseMs,
      });
      if (ctx.tripActive) driveMarker.ensureFrameActive?.();
    },
  });

  // ── Map tab focus: start/stop GPS (battery — no watch on other tabs) ─────
  const refreshMyProfile = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token')
        ?? await AsyncStorage.getItem('userToken');
      const data = await fetchProfileMeCached({ token });
      if (!data) return;
      const profileAvatar = (data.avatarUrl ?? data.avatar) as string | null;
      if (profileAvatar && typeof profileAvatar === 'string') {
        setMyAvatarUrl(
          profileAvatar.startsWith('http')
            ? profileAvatar
            : `${API_URL}${profileAvatar.startsWith('/') ? profileAvatar : `/${profileAvatar}`}`,
        );
      }
      if (data.username) setMyUsername(String(data.username));
      if (Number.isFinite(Number(data.totalDistance))) {
        profileTotalDistanceKmRef.current = Math.max(0, Number(data.totalDistance));
      }

      const uid = data.userId ?? data.id;
      if (uid && token) {
        const carsRes = await fetch(`${API_URL}/api/profile/${uid}/cars`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (carsRes.ok) {
          const cars = await carsRes.json();
          if (Array.isArray(cars)) {
            const main = cars.find((c: any) => c?.isMain) ?? cars[0];
            setPreferredFuel(main?.preferredFuel ?? null);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useFocusEffect(useCallback(() => {
    isMapFocusedRef.current = true;
    setIsMapFocused(true);
    void refreshMyProfile();
    foregroundGpsIntentionallyStoppedRef.current = false;
    if (locationReadyRef.current) {
      startGPSRef.current();
    }
    handleGpsResumeRef.current('focus');
    return () => {
      isMapFocusedRef.current = false;
      setIsMapFocused(false);
      const keepTripOnMapBlur = isDrivingRef.current || isNavigatingRef.current;
      if (keepTripOnMapBlur) {
        void flushActiveTripCheckpointForProfile();
      }
      if (!keepTripOnMapBlur) {
        void 0;
        stopGPSRef.current();
      }
      if (resumeOneShotTimerRef.current) {
        clearTimeout(resumeOneShotTimerRef.current);
        resumeOneShotTimerRef.current = null;
      }
    };
  }, [refreshMyProfile]));

  useEffect(() => () => {
    if (resumeOneShotTimerRef.current) {
      clearTimeout(resumeOneShotTimerRef.current);
      resumeOneShotTimerRef.current = null;
    }
  }, []);

  // ── Symulator ─────────────────────────────────────────────
  const { startSimulation, stopSimulation } = useNavigationSimulator({
    onFrame: useCallback((lat: number, lng: number, speedMs: number, hdg: number) => {
      isNavigatingRef.current = true;
      currentLocRef.current = { latitude: lat, longitude: lng };
      processMotionFix({
        latitude: lat,
        longitude: lng,
        accuracy: 2,
        timestamp: Date.now(),
        speed: speedMs,
        heading: hdg,
      });

      const points = routePointsRef.current.length > 0
        ? routePointsRef.current
        : (navRouteRef.current?.points ?? []);

      if (points.length > 0 && routePointsRef.current.length === 0) {
        routePointsRef.current = points;
      }

      if (points.length > 1) {
        const snapped = snapToRoute(lat, lng, points, NAV_ROUTE_SNAP_M);
        const idx     = findClosestPointIndex(snapped.latitude, snapped.longitude, points);
        setRemainingRoutePoints([
          { latitude: snapped.latitude, longitude: snapped.longitude },
          ...points.slice(idx + 1),
        ]);
      }

      feedSpeedSample(speedMs);
      lastNavLocRef.current = { latitude: lat, longitude: lng };
    }, [processMotionFix]),
    speedKmh:   120,
    intervalMs: 100,
  });

  useEffect(() => {
    if (isNavigating) return;
    if (isOffroadRoute && offroadPreviewRoute) {
      setRouteInfo({
        distance: offroadPreviewRoute.distance,
        duration: 0,
        durationText: '—',
      });
      remainingDurationMinRef.current = null;
      setRemainingDurationMin(null);
      return;
    }
    if (previewRoute) {
      setRouteInfo({
        distance: (previewRoute.distanceValue / 1000).toFixed(1),
        duration: previewRoute.duration,
      });
      remainingDurationMinRef.current = previewRoute.duration;
      setRemainingDurationMin(previewRoute.duration);
    }
  }, [previewRoute, isOffroadRoute, offroadPreviewRoute, isNavigating]);

  useEffect(() => {
    if (!__DEV__) return;
    if (!startLocation || !endLocation || isNavigating) return;
    console.log('[ROUTE_PREVIEW]', JSON.stringify({
      at: Date.now(),
      loading: previewLoading,
      error: previewError ?? null,
      alternatives: alternativeRoutes.length,
      selectedIdx: selectedRouteIndex,
      hasRouteInfo: !!routeInfo,
      offroad: isOffroadRoute,
    }));
  }, [
    startLocation,
    endLocation,
    isNavigating,
    previewLoading,
    previewError,
    alternativeRoutes.length,
    selectedRouteIndex,
    routeInfo,
    isOffroadRoute,
  ]);

  useEffect(() => {
    if (!offRoute || !rerouteResult || !userLocation) return;
    const pts = rerouteResult.points ?? [];
    const rerouteSig = buildRerouteRouteSignature(pts);
    if (rerouteSig && lastAppliedRerouteSigRef.current === rerouteSig) {
      // Nawet identyczna geometria musi zostać ponownie przycięta od bieżącej
      // pozycji. Samo wznowienie starej trasy zostawiało auto na starym odcinku.
      visionEvent('NAV_REROUTE_DEDUP', { pts: pts.length, sig: rerouteSig });
    } else {
      lastAppliedRerouteSigRef.current = rerouteSig;
    }

    const now = Date.now();
    reroutePendingRef.current = false;
    reroutePendingSinceRef.current = 0;
    rerouteBlockedUntilRef.current = 0;
    rerouteGraceUntilRef.current = now + REROUTE_GRACE_AFTER_APPLY_MS;
    setNavRouteOverride(rerouteResult);
    const rerouteDuration = Number(rerouteResult.duration);
    if (Number.isFinite(rerouteDuration) && rerouteDuration > 0) {
      const rerouteDistanceKm = Math.max(0, Number(rerouteResult.distanceValue) / 1_000);
      setRouteInfo({
        distance: rerouteDistanceKm.toFixed(1),
        duration: rerouteDuration,
        durationText: rerouteResult.durationText,
      });
      remainingDurationMinRef.current = rerouteDuration;
      setRemainingDurationMin(rerouteDuration);
    }
    if (rerouteResult.points?.length) {
      const curLat = Number.isFinite(drLatRef.current) && drLatRef.current !== 0
        ? drLatRef.current
        : userLocation.latitude;
      const curLng = Number.isFinite(drLngRef.current) && drLngRef.current !== 0
        ? drLngRef.current
        : userLocation.longitude;
      const trimmedReroute = rerouteResult.steps?.length
        ? trimNavigationRouteFromVehicle(rerouteResult, curLat, curLng, NAV_ROUTE_SNAP_M)
        : rerouteResult;
      if (trimmedReroute !== rerouteResult) {
        setNavRouteOverride(trimmedReroute);
      }
      routePointsRef.current = trimmedReroute.points;
      stepArcIndexRef.current = { points: [], steps: [], index: [] };
      const idx = findClosestPointIndex(curLat, curLng, trimmedReroute.points);
      const snapped = snapToRoute(curLat, curLng, trimmedReroute.points, NAV_ROUTE_SNAP_M);
      const syncLat = snapped.latitude;
      const syncLng = snapped.longitude;
      const syncHdg = normalizeHeading(lastHeadingRef.current || 0);

      offRouteRef.current = false;
      v3SnapToRouteSuppressedRef.current = false;
      setOffRoute(false);
      const displayedLat = Number.isFinite(driveMarker.lat.value)
        ? driveMarker.lat.value
        : syncLat;
      const displayedLng = Number.isFinite(driveMarker.lng.value)
        ? driveMarker.lng.value
        : syncLng;
      navV3.setRoutePolyline(
        trimmedReroute.points.map(p => ({ lat: p.latitude, lng: p.longitude })),
        { lat: displayedLat, lng: displayedLng },
      );
      // The next accepted V3 GPS fix supplies a complete arcWindow for the
      // replacement route. Do not inject a geometry-less marker target here.
      driveMarker.ensureFrameActive?.();
      setFollowMode('navigationFollow');
      vroomGpsLog('NAV_REROUTE_GEOM_APPLY', {
        pts: rerouteResult.points.length,
        at: now,
      }, 0);
      visionEvent('NAV_REROUTE_OK', {
        pts: rerouteResult.points.length,
        at: now,
      });
      navRouteIdxRef.current = idx;
      lastRemainingRouteHeadRef.current = null;
      const remainingPts = [
        { latitude: syncLat, longitude: syncLng },
        ...trimmedReroute.points.slice(idx + 1),
      ];
      requestAnimationFrame(() => {
        setRemainingRoutePoints(remainingPts);
      });
      lastRerouteMotionAnchorRef.current = { lat: curLat, lng: curLng };
    }
    setCurrentStep(0);
    setAnnounceStepIndex(0);
    announceStepIndexRef.current = 0;
    pendingStepArcClampRef.current = false;
    stepArcIndexRef.current = { points: [], steps: [], index: [] };
    announcedPhasesRef.current = new Set();
    lastManeuverDistanceRef.current = null;
    chainedPrepareStepsRef.current.clear();
    longStraightSpokenForStepRef.current = null;
    setResolvedNavigationCue(null);
    resolvedNavigationCueRef.current = null;
    offRouteSinceRef.current = 0;
    offRouteStreakRef.current = 0;
    setRerouteOrigin(null);
    setRerouteHeadingForApi(undefined);
    Toast.show({
      type: 'info',
      text2: 'Nowa trasa od Twojej pozycji (w kierunku jazdy).',
    });
  }, [rerouteResult, offRoute, userLocation, navV3, driveMarker, setFollowMode]);

  useEffect(() => {
    if (!offRoute || !reroutePendingRef.current) return;
    const pendingForMs = Date.now() - reroutePendingSinceRef.current;
    const failed = !!rerouteError || (!rerouteLoading && pendingForMs >= REROUTE_PENDING_TIMEOUT_MS);
    if (!failed) return;
    reroutePendingRef.current = false;
    reroutePendingSinceRef.current = 0;
    rerouteBlockedUntilRef.current = Date.now() + REROUTE_RETRY_AFTER_FAIL_MS;
    setRerouteOrigin(null);
    setRerouteHeadingForApi(undefined);
    visionEvent('NAV_REROUTE_FAIL', {
      error: rerouteError ?? 'timeout',
      pendingForMs,
    });
  }, [offRoute, rerouteLoading, rerouteError]);

  useEffect(() => {
    if (!offRoute || !reroutePendingRef.current) return;
    const pendingForMs = Date.now() - reroutePendingSinceRef.current;
    const waitMs = Math.max(0, REROUTE_PENDING_TIMEOUT_MS - pendingForMs);
    const timeoutId = setTimeout(() => {
      if (!reroutePendingRef.current) return;
      reroutePendingRef.current = false;
      reroutePendingSinceRef.current = 0;
      rerouteBlockedUntilRef.current = Date.now() + REROUTE_RETRY_AFTER_FAIL_MS;
      setRerouteOrigin(null);
      setRerouteHeadingForApi(undefined);
      visionEvent('NAV_REROUTE_FAIL', {
        error: 'timeout',
        pendingForMs: REROUTE_PENDING_TIMEOUT_MS,
      });
    }, waitMs);
    return () => clearTimeout(timeoutId);
  }, [offRoute, rerouteOrigin]);

  // ── Reroute origin management (cooldown gate) ─────────────────────────────
  // Uruchamiane po potwierdzonym zejściu z trasy (OFF_ROUTE_CONFIRM_STREAK × NAV_PROGRESS_UI_MS).
  useEffect(() => {
    if (!offRoute) {
      if (!reroutePendingRef.current) {
        setRerouteOrigin(null);
        setRerouteHeadingForApi(undefined);
      }
      return;
    }
    if (!endLocation) return;
    if (reroutePendingRef.current) return;
    if (Date.now() < rerouteBlockedUntilRef.current) return;
    if (speedKmhRef.current < 5) return;

    const drFresh =
      drLatRef.current !== 0
      && drLngRef.current !== 0
      && Date.now() - drLastFrameAtRef.current <= DR_STALE_MS;
    const fallbackLoc = currentLocRef.current ?? userLocation;
    const vehicleLat = drFresh ? drLatRef.current : fallbackLoc?.latitude;
    const vehicleLng = drFresh ? drLngRef.current : fallbackLoc?.longitude;
    if (!Number.isFinite(vehicleLat) || !Number.isFinite(vehicleLng)) return;
    const vehicleLatNum = Number(vehicleLat);
    const vehicleLngNum = Number(vehicleLng);

    const now   = Date.now();
    const since = now - lastRerouteTimeRef.current;

    if (since < REROUTE_COOLDOWN_MS && lastRerouteLocRef.current) {
      const movedM = haversineKm(
        vehicleLatNum,
        vehicleLngNum,
        lastRerouteLocRef.current.lat,
        lastRerouteLocRef.current.lng,
      ) * 1000;
      if (movedM < REROUTE_MIN_MOVED_M) {
        if (DEBUG_NETWORK) console.log('[reroute] cooldown — moved', movedM.toFixed(0), 'm, since last', since, 'ms');
        return;
      }
    }

    const rawHdg = lastGpsDeviceHeadingRef.current;
    const travelHdg = resolveRerouteApiHeadingDeg(
      rawHdg,
      vehicleLatNum,
      vehicleLngNum,
      lastRerouteMotionAnchorRef.current ?? lastSetLocRef.current,
      lastHeadingRef.current ?? 0,
    );

    if (DEBUG_NETWORK) console.log('[reroute] triggering new reroute request', { travelHdg });
    reroutePendingRef.current = true;
    reroutePendingSinceRef.current = now;
    lastRerouteTimeRef.current = now;
    lastRerouteLocRef.current = { lat: vehicleLatNum, lng: vehicleLngNum };
    setRerouteHeadingForApi(travelHdg);
    setRerouteOrigin(buildRerouteOrigin({ lat: vehicleLatNum, lng: vehicleLngNum }));
    visionEvent('NAV_REROUTE_REQUEST', {
      vehicleLat: Number(vehicleLatNum.toFixed(6)),
      vehicleLng: Number(vehicleLngNum.toFixed(6)),
      travelHdg: Math.round(travelHdg),
      speedKmh: Math.round(speedKmhRef.current),
    });
  }, [offRoute, userLocation, endLocation]);

  useEffect(() => {
    if (isDrivingRef.current || isNavigatingRef.current) return;
    if (!startIsMyLocationRef.current || !userLocation || isNavigating) return;
    // Keep the selected route anchor stable while destination preview is active.
    // Without this, tab switches can silently move "start" and produce bad reroute hints.
    if (endLocation) return;
    setStartLocation(prev => ({ ...userLocation, name: prev?.name ?? 'Moja pozycja' }));
  }, [userLocation, isNavigating, endLocation]);

  // GPS często przychodzi po wyborze celu — bez startu Directions nie wystartuje.
  useEffect(() => {
    if (isDrivingRef.current || isNavigatingRef.current) return;
    if (isNavigating || !endLocation || startLocation) return;
    if (!userLocation) return;
    setStartLocation({ ...userLocation, name: 'Moja pozycja' });
    startIsMyLocationRef.current = !isDrivingRef.current;
  }, [isNavigating, endLocation, startLocation, userLocation]);

  useEffect(() => {
    if (!previewError || isNavigating || !endLocation || isOffroadRoute) return;
    const text2 = previewError === 'NO_ROUTE'
      ? 'Nie znaleziono trasy do tego celu.'
      : 'Sprawdź internet i spróbuj ponownie.';
    Toast.show({ type: 'error', text1: 'Nie udało się wyznaczyć trasy', text2 });
  }, [previewError, isNavigating, endLocation, isOffroadRoute]);

  const rawEffectiveNavRoute = navRouteOverride ?? navRoute ?? (isNavigating ? previewRoute : null);
  const effectiveNavRoute = useMemo(
    () => rawEffectiveNavRoute ? resolveNavigationRoute(rawEffectiveNavRoute) : null,
    [rawEffectiveNavRoute],
  );
  const activeRoute = isNavigating ? effectiveNavRoute : previewRoute;
  navRouteRef.current = effectiveNavRoute ?? null;
  const activeSteps = effectiveNavRoute?.steps ?? previewRoute?.steps ?? [];

  useEffect(() => {
    if (!isNavigating || !effectiveNavRoute?.geometryCorrectionCount) return;
    effectiveNavRoute.steps.forEach((step, stepIndex) => {
      const original = rawEffectiveNavRoute?.steps?.[stepIndex];
      if (
        !original
        || (
          original.maneuver === step.maneuver
          && original.maneuverModifier === step.maneuverModifier
        )
      ) return;
      const diagnostic = effectiveNavRoute.geometryDiagnostics?.[stepIndex];
      visionEvent('NAV_MANEUVER_GEOMETRY_CORRECTION', {
        routeRevision: effectiveNavRoute.routeRevision,
        stepIndex,
        originalDirection: diagnostic?.originalDirection ?? null,
        geometryDirection: diagnostic?.geometryDirection ?? null,
        correctionConfidence: diagnostic?.confidence ?? 0,
        originalManeuver: original.maneuver ?? '',
        originalModifier: original.maneuverModifier ?? '',
        resolvedManeuver: step.maneuver ?? '',
        resolvedModifier: step.maneuverModifier ?? '',
      });
    });
  }, [isNavigating, effectiveNavRoute, rawEffectiveNavRoute]);

  useEffect(() => {
    if (!isNavigating) return;
    const pts = effectiveNavRoute?.points?.length
      ? effectiveNavRoute.points
      : routePointsRef.current;
    const steps = effectiveNavRoute?.steps ?? [];
    if (pts.length < 2 || !steps.length) return;
    if (
      stepArcIndexRef.current.points === pts
      && stepArcIndexRef.current.steps === steps
    ) return;
    const prefix = buildRouteForwardArcPrefix(pts);
    routeForwardPrefixRef.current = { points: pts, prefix };
    stepArcIndexRef.current = {
      points: pts,
      steps,
      index: buildStepArcIndex(pts, steps),
    };
  }, [isNavigating, navigationUiReady, effectiveNavRoute]);

  useEffect(() => {
    import('react-native').then(({ DeviceEventEmitter }) => {
      const sub = DeviceEventEmitter.addListener('CarPlayReportWarning', (type: string) => {
        void handleReportRef.current?.(type as WarningType);
      });
      return () => sub.remove();
    });
  }, []);

  useEffect(() => {
    if (!isNavigating) return;
    const pts = activeRoute?.points?.length
      ? activeRoute.points
      : (routePointsRef.current.length ? routePointsRef.current : []);
    if (pts.length >= 2) {
      drivingSnapGeometryRef.current = pts;
      drivingSnapUsesMatchedRef.current = false;
    }
  }, [activeRoute, isNavigating]);

  // Persist active navigation so it can be restored after app restart.
  useEffect(() => {
    if (!isNavigating || !endLocation) {
      if (Platform.OS === 'android' && Date.now() < navSessionColdStartGuardUntilRef.current) {
        return;
      }
      AsyncStorage.removeItem(NAV_SESSION_KEY).catch(() => {});
      return;
    }

    let cancelled = false;
    void (async () => {
      const tripSessionId = await ensureTripSessionId();
      const payload: PersistedNavSession = {
        version: PERSISTED_NAV_SESSION_VERSION,
        tripSessionId,
        mode: 'navigation',
        savedAt: Date.now(),
        isOffroadRoute,
        startLocation,
        endLocation,
        navStartLoc,
        routeInfo,
        routeSnapshot: activeRoute?.points?.length
          ? {
              ...activeRoute,
              index: Number.isFinite(Number((activeRoute as any).index))
                ? Number((activeRoute as any).index)
                : 0,
              duration: Number.isFinite(Number((activeRoute as any).duration))
                ? Number((activeRoute as any).duration)
                : Number(routeInfo?.duration ?? 0),
              durationText: typeof (activeRoute as any).durationText === 'string'
                ? String((activeRoute as any).durationText)
                : (routeInfo?.duration ? formatDuration(routeInfo.duration) : ''),
            } as DirectionsResult
          : null,
        currentStep,
        offroadPoints: isOffroadRoute ? offroadLoadedPointsRef.current : [],
      };
      if (cancelled || !isNavigatingRef.current) return;
      await AsyncStorage.setItem(NAV_SESSION_KEY, JSON.stringify(payload));
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    isNavigating,
    isOffroadRoute,
    startLocation,
    endLocation,
    navStartLoc,
    routeInfo,
    currentStep,
    activeRoute,
  ]);

  // Cold start / process kill: NIE przywracamy nawigacji (decyzja UX — pełne
  // zamknięcie aplikacji wyłącza nawigację). Czyścimy zapisaną sesję i flagę BG,
  // aby po ponownym otwarciu nie było "zawieszonej" trasy. Minimalizacja nie
  // wywołuje cold-startu, więc nawigacja przy minimalizacji zostaje aktywna.
  useEffect(() => {
    if (didRestoreNavSessionRef.current || !locationReady) return;
    didRestoreNavSessionRef.current = true;

    (async () => {
      try {
        // Na Androidzie cold-start obsługuje BG_DRIVE_COLD_START_RESTORE (degradacja
        // nav->freeDrive). Tutaj tylko usuwamy resztki sesji nawigacji.
        if (isNavigatingRef.current) return;
        const raw = await AsyncStorage.getItem(NAV_SESSION_KEY);
        if (!raw) return;
        await AsyncStorage.removeItem(NAV_SESSION_KEY);
        await AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false');
      } catch (e) {
        console.log('clear nav_session on cold start error:', e);
      }
    })();
  }, [locationReady]);

  useEffect(() => {
    const pts = activeRoute?.points ?? [];
    if (pts.length >= 2) {
      routePointsRef.current = pts;
      return;
    }
    // Żelazny stan trasy — nie kasuj punktów przy przełączeniu zakładek / chwilowym null activeRoute.
    if (isNavigatingRef.current && routePointsRef.current.length >= 2) {
      return;
    }
    if (pts.length > 0) routePointsRef.current = pts;
  }, [activeRoute]);

  useEffect(() => {
    if (!isNavigating || !navigationUiReady || navRouteOverride) return;
    if (navRoute?.points?.length) {
      routePointsRef.current = navRoute.points;
      // Warm only the departure corridor after the first navigation frame.
      // Downloading/indexing the full route competes with GPS snapping.
      if (navRoute.points.length >= 4) {
        const initialCorridor = navRoute.points.slice(0, 96);
        InteractionManager.runAfterInteractions(() => {
          void roadGeometryStore.prefetchAroundRoute(initialCorridor).catch(() => {});
        });
      }
    }
  }, [isNavigating, navigationUiReady, navRoute, navRouteOverride]);

  useEffect(() => {
    const points = activeRoute?.points;
    if (!points?.length) { setRemainingRoutePoints([]); return; }
    // W trybie jazdy nie rysuj trasy podglądu — tylko nawigacja; inaczej „ślad” 483 + marker obok.
    if (!isNavigating) {
      if (!isDriving) setRemainingRoutePoints(points);
      else setRemainingRoutePoints([]);
      return;
    }
    if (!navigationUiReady) return;
    const mLat = driveMarker.lat.value;
    const mLng = driveMarker.lng.value;
    const hasSmoothedMarker = Number.isFinite(mLat) && Number.isFinite(mLng)
      && !(Math.abs(mLat) < 1e-6 && Math.abs(mLng) < 1e-6);
    const anchorLat = hasSmoothedMarker
      ? mLat
      : (lastTripMarkerPoseRef.current?.lat ?? userLocation?.latitude);
    const anchorLng = hasSmoothedMarker
      ? mLng
      : (lastTripMarkerPoseRef.current?.lng ?? userLocation?.longitude);
    if (!Number.isFinite(anchorLat) || !Number.isFinite(anchorLng)) {
      setRemainingRoutePoints(points);
      return;
    }
    const anchorLatNum = Number(anchorLat);
    const anchorLngNum = Number(anchorLng);
    const snapped = snapToRoute(anchorLatNum, anchorLngNum, points, NAV_ROUTE_SNAP_M);
    const idx = findClosestPointIndex(snapped.latitude, snapped.longitude, points);
    const headLat = hasSmoothedMarker ? mLat : snapped.latitude;
    const headLng = hasSmoothedMarker ? mLng : snapped.longitude;
    setRemainingRoutePoints([
      { latitude: headLat, longitude: headLng },
      ...points.slice(idx + 1),
    ]);
  }, [isNavigating, isDriving, navigationUiReady, activeRoute, driveMarker, userLocation]);

  // ── Live location sharing ────────────────────────────────────────────────────
  // Single interval-based mechanism (replaces the previous dual send: event + interval).
  // Sends at most once per SEND_INTERVAL_MS, and only when:
  //   - user moved > SEND_MIN_DIST_M since last send (saves bandwidth while stationary), OR
  //   - SEND_MAX_ELAPSED_MS has elapsed (heartbeat to confirm user is still online).
  // routePointsRef.current is used instead of activeRoute to avoid recreating the
  // interval on every route/location change (was a major source of the duplicate sends).
  const tickLiveLocationSend = useCallback(() => {
    const tripActive = isDrivingRef.current || isNavigatingRef.current;
    let lat: number;
    let lng: number;
    let motion: {
      heading?: number;
      speedKmh?: number;
      trail?: { lat: number; lng: number; t: number }[];
      mode?: 'navigation' | 'freeDrive' | 'idle';
      rawLat?: number;
      rawLng?: number;
      accuracyM?: number;
      snapSource?: string;
      snapAgeMs?: number;
      snapDistanceM?: number;
      fixAt?: number;
      fixId?: string;
    } | undefined;

    if (tripActive) {
      const pose = lastTripMarkerPoseRef.current;
      if (!pose) return;
      lat = pose.lat;
      lng = pose.lng;
      const hdg = drHdgRef.current ?? lastHeadingRef.current;
      const nowTrail = Date.now();
      const trail = liveBroadcastTrailRef.current;
      const tail = trail[trail.length - 1];
      if (!tail || tail.lat !== lat || tail.lng !== lng) {
        liveBroadcastTrailRef.current = [...trail, { lat, lng, t: nowTrail }].slice(-LIVE_BROADCAST_TRAIL_MAX);
      }
      if (Number.isFinite(hdg)) {
        motion = {
          heading: hdg,
          speedKmh: speedKmhRef.current,
          trail: liveBroadcastTrailRef.current,
        };
      } else {
        motion = {
          speedKmh: speedKmhRef.current,
          trail: liveBroadcastTrailRef.current,
        };
      }
    } else {
      const loc = currentLocRef.current;
      if (!loc) return;
      lat = loc.latitude;
      lng = loc.longitude;
      let hdg = drHdgRef.current ?? lastHeadingRef.current;
      if (!Number.isFinite(hdg) && lastSendLocRef.current) {
        const prev = lastSendLocRef.current;
        const dLat = ((lat - prev.lat) * Math.PI) / 180;
        const dLng = ((lng - prev.lng) * Math.PI) / 180;
        const lat1 = (prev.lat * Math.PI) / 180;
        const lat2 = (lat * Math.PI) / 180;
        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        hdg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
      }
      const speedKmh = Number.isFinite(speedKmhRef.current) ? speedKmhRef.current : 0;
      const nowTrail = Date.now();
      const trail = liveBroadcastTrailRef.current;
      const tail = trail[trail.length - 1];
      if (!tail || tail.lat !== lat || tail.lng !== lng) {
        liveBroadcastTrailRef.current = [...trail, { lat, lng, t: nowTrail }].slice(-LIVE_BROADCAST_TRAIL_MAX);
      }
      motion = {
        ...(Number.isFinite(hdg) ? { heading: hdg } : {}),
        speedKmh,
        trail: liveBroadcastTrailRef.current,
      };
    }

    const rawFix = lastRawTickRef.current;
    if (motion && rawFix && Number.isFinite(rawFix.lat) && Number.isFinite(rawFix.lng)) {
      motion.rawLat = rawFix.lat;
      motion.rawLng = rawFix.lng;
      motion.accuracyM = Number.isFinite(rawFix.acc) ? rawFix.acc : (lastGpsAccuracyRef.current ?? 25);
      motion.snapAgeMs = Math.max(0, Date.now() - rawFix.at);
      motion.snapDistanceM = haversineKm(rawFix.lat, rawFix.lng, lat, lng) * 1000;
      motion.snapSource = tripActive
        ? (isNavigatingRef.current ? 'route' : 'local_road')
        : 'raw';
    }

    const now = Date.now();
    const elapsed = now - lastSendTimeRef.current;
    const movedM = lastSendLocRef.current
      ? haversineKm(lat, lng, lastSendLocRef.current.lat, lastSendLocRef.current.lng) * 1000
      : Infinity;
    const minDist = tripActive ? LIVE_SEND_MIN_DIST_TRIP_M : LIVE_SEND_MIN_DIST_M;
    const minInterval = tripActive ? LIVE_SEND_INTERVAL_TRIP_MS : LIVE_SEND_INTERVAL_MS;
    const hasNewGpsFix = !!rawFix && rawFix.at > lastSentLiveFixAtRef.current;

    if (!hasNewGpsFix && movedM < minDist && elapsed < minInterval && elapsed < LIVE_SEND_MAX_ELAPSED_MS) {
      if (DEBUG_NETWORK) console.log('[sendLocation] throttled — moved', movedM.toFixed(0), 'm, elapsed', elapsed, 'ms');
      return;
    }

    if (DEBUG_NETWORK) console.log('[sendLocation] → sending: moved', movedM.toFixed(0), 'm, elapsed', elapsed, 'ms');
    lastSendTimeRef.current = now;
    lastSendLocRef.current = { lat, lng };
    if (rawFix) lastSentLiveFixAtRef.current = Math.max(lastSentLiveFixAtRef.current, rawFix.at);
    const driveMode = isNavigatingRef.current
      ? 'navigation'
      : isDrivingRef.current
        ? 'freeDrive'
        : 'idle';
    if (motion) {
      motion.mode = driveMode;
    } else {
      motion = { mode: driveMode };
    }
    const fixAt = rawFix?.at
      ?? liveBroadcastTrailRef.current[liveBroadcastTrailRef.current.length - 1]?.t
      ?? now;
    motion.fixAt = fixAt;
    motion.fixId = `${fixAt}:${(rawFix?.lat ?? lat).toFixed(6)}:${(rawFix?.lng ?? lng).toFixed(6)}`;
    sendLocation(lat, lng, routePointsRef.current, motion);
  }, [sendLocation]);

  useEffect(() => {
    if (isSharing) return;
    lastSendTimeRef.current = 0;
    lastSendLocRef.current = null;
    lastSentLiveFixAtRef.current = 0;
    liveBroadcastTrailRef.current = [];
  }, [isSharing]);

  useMapLiveSendTick({
    enabled: isSharing,
    send: tickLiveLocationSend,
    intervalMs: LIVE_SEND_TICK_MS,
  });

  useEffect(() => {
    if (!isNavigating) { dismissNavigationNotification(); return; }
    const stepData = resolvedNavigationCue?.step
      ?? effectiveNavRoute?.steps?.[announceStepIndex];
    if (!stepData) return;
    const navRouteInfo = routeInfo as (RouteInfo & { durationText?: string | null }) | null;
    showNavigationNotification(
      stepData,
      navRouteInfo?.distance ?? '',
      navRouteInfo?.durationText ?? '',
      resolvedNavigationCue?.distanceM ?? distToTurnM,
    );
  }, [
    announceStepIndex,
    isNavigating,
    effectiveNavRoute,
    resolvedNavigationCue,
    distToTurnM,
    routeInfo,
    showNavigationNotification,
    dismissNavigationNotification,
  ]);

  const nearbyUsers = useMemo(() => {
    if (!liveUsersEnabled) return [];
    return liveUserIds
      .filter((id) => String(id) !== String(currentUserId))
      .map((id) => {
        const meta = liveMapStore.getMeta(id);
        const pos = liveMapStore.getPosition(id);
        if (!meta || !pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return null;
        return {
          id: String(id),
          name: meta.username,
          latitude: pos.lat,
          longitude: pos.lng,
          avatar: meta.avatarUrl ?? '',
          avatarFrameUrl: meta.avatarFrameUrl ?? '',
          status: 'Online' as const,
          isFriend: meta.isFriend ?? false,
          isPremium: meta.isPremium ?? false,
        } as User;
      })
      .filter((u): u is User => u != null);
  }, [liveUserIds, liveMapStore, currentUserId, liveUsersEnabled]);

  // Bez live — zero cudzych markerów (demo wyłączone).
  useDemoUsers(
    false,
    useCallback((users) => setDemoUsers(users), []),
    userLocation?.latitude,
    userLocation?.longitude,
    1000,
  );

  // ─────────────────────────────────────────────────────────
  const [fleetAnchor, setFleetAnchor] = useState<{ latitude: number; longitude: number } | null>(null);

  const syncFleetAnchor = useCallback(() => {
    const tripActive = isDriving || isNavigating;
    if (tripActive) {
      const pose = lastTripMarkerPoseRef.current;
      if (pose && Number.isFinite(pose.lat) && Number.isFinite(pose.lng)) {
        setFleetAnchor({ latitude: pose.lat, longitude: pose.lng });
        return;
      }
    }
    if (userLocation?.latitude != null && userLocation?.longitude != null) {
      setFleetAnchor({ latitude: userLocation.latitude, longitude: userLocation.longitude });
      return;
    }
    if (
      Number.isFinite(drLatRef.current) && Number.isFinite(drLngRef.current)
      && (drLatRef.current !== 0 || drLngRef.current !== 0)
    ) {
      setFleetAnchor({ latitude: drLatRef.current, longitude: drLngRef.current });
      return;
    }
    setFleetAnchor(null);
  }, [isDriving, isNavigating, userLocation?.latitude, userLocation?.longitude]);

  useEffect(() => { syncFleetAnchor(); }, [syncFleetAnchor]);
  useMapAnchorSync({ enabled: isDriving || isNavigating, syncAnchor: syncFleetAnchor });

  const liveUsersAnchor = fleetAnchor;

  const visibleLiveUserIds = useMemo(() => {
    if (!liveUsersEnabled || liveUserIds.length === 0) return [];
    return liveUserIds.filter((id) => String(id) !== String(currentUserId));
  }, [liveUserIds, currentUserId, liveUsersEnabled]);

  const [fleetMapIdleNonce, setFleetMapIdleNonce] = useState(0);

  const visibleUsers = useMemo(() => {
    return visibleLiveUserIds
      .map((id) => nearbyUsers.find((u) => u.id === String(id)))
      .filter((u): u is User => u != null);
  }, [visibleLiveUserIds, nearbyUsers]);

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────

  const handleSelectStart = useCallback((l: LocationState) => {
    setStartLocation(l);
    startIsMyLocationRef.current = (l.name === 'Moja pozycja');
  }, []);

  const handleSelectEnd = useCallback((l: LocationState) => {
    setEndLocation(l);
    setSelectedRouteIndex(0);
    setRouteInfo(null);
    setStartLocation(prev => {
      if (prev) return prev;
      if (!userLocation) return prev;
      return { ...userLocation, name: 'Moja pozycja' };
    });
    // W trybie jazdy nie podążaj za GPS jako startem po wyborze celu (stabilny podgląd).
    startIsMyLocationRef.current = !isDrivingRef.current;
  }, [userLocation]);

  const handleManualTargetPick = useCallback((latitude: number, longitude: number) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    setEndLocation({
      latitude,
      longitude,
      name: 'Punkt ręczny',
    });
    setSelectedRouteIndex(0);
    setStartLocation(prev => {
      if (prev) return prev;
      if (!userLocation) return prev;
      startIsMyLocationRef.current = true;
      return { ...userLocation, name: 'Moja pozycja' };
    });
    setManualTargetPickMode(false);
    Toast.show({ type: 'success', text1: '📍 Punkt celu ustawiony ręcznie' });
  }, [userLocation]);

  const handleUserMarkerPress = useCallback((user: User) => {
    const anchor = userLocation ?? liveUsersAnchor;
    if (!anchor) return;
    const dist = calculateDistance(
      anchor.latitude, anchor.longitude,
      user.latitude, user.longitude,
    );
    setSelectedUser({ ...user, distance: dist });
    setUserInfoVisible(true);
  }, [userLocation, liveUsersAnchor]);

  const handleLiveUserPress = useCallback((userId: number) => {
    let user = nearbyUsers.find((u) => u.id === String(userId));
    if (!user) {
      const meta = liveMapStore.getMeta(userId);
      const pos = liveMapStore.getPosition(userId);
      if (!meta || !pos) return;
      user = {
        id: String(userId),
        name: meta.username,
        latitude: pos.lat,
        longitude: pos.lng,
        avatar: meta.avatarUrl ?? '',
        avatarFrameUrl: meta.avatarFrameUrl ?? '',
        status: 'Online',
        isFriend: meta.isFriend ?? false,
        isPremium: meta.isPremium ?? false,
      };
    }
    handleUserMarkerPress(user);
  }, [nearbyUsers, handleUserMarkerPress, liveMapStore]);

  const handleNavigateToUser = useCallback(() => {
    if (!selectedUser || !userLocation) return;
    setStartLocation({ ...userLocation, name: 'Moja pozycja' });
    setEndLocation({ latitude: selectedUser.latitude, longitude: selectedUser.longitude, name: selectedUser.name });
    setUserInfoVisible(false);
    Toast.show({ type: 'success', text1: 'CEL USTAWIONY', text2: selectedUser.name });
  }, [selectedUser, userLocation]);

  const handleNavigateToDrop = useCallback(async (drop: any) => {
    if (!drop || navV3Mode !== 'freeDrive') return;
    const livePose = readLiveTripPose();
    const origin = livePose
      ? { latitude: livePose.latitude, longitude: livePose.longitude, name: 'Moja pozycja' }
      : userLocation
        ? { ...userLocation, name: 'Moja pozycja' }
        : null;
    if (!origin) {
      Toast.show({ type: 'error', text1: 'Brak GPS', text2: 'Czekam na lokalizację.' });
      return;
    }

    const ok = await startDropNavigation(drop, { lat: origin.latitude, lng: origin.longitude });
    if (!ok) {
      Toast.show({
        type: 'error',
        text1: 'Zrzut został już odebrany',
        text2: 'Ten drop nie jest już dostępny.',
      });
      return;
    }

    setStartLocation(origin);
    setEndLocation({
      latitude: drop.lat,
      longitude: drop.lng,
      name: `Zrzut ${String(drop.rarity || '').toUpperCase()}`,
    });
    setSelectedRouteIndex(0);
    setRouteInfo(null);
    startIsMyLocationRef.current = false;
    pendingDropAutoStartRef.current = true;
    Toast.show({ type: 'success', text1: 'Zrzut ustawiony jako cel', text2: 'Wyznaczam trasę.' });
  }, [navV3Mode, readLiveTripPose, userLocation, startDropNavigation]);

  const handleViewProfile = useCallback(() => {
    if (!selectedUser) return;
    setUserInfoVisible(false);
    router.push({ pathname: '/profile/[userId]', params: { userId: selectedUser.id } });
  }, [selectedUser, router]);

  const handleMessageUser = useCallback(async () => {
    if (!selectedUser) return;
    setUserInfoVisible(false);
    const id = await startConversation([Number(selectedUser.id)], false);
    if (id) router.push(`/Community/chats/${id}` as any);
    else    Toast.show({ type: 'error', text1: 'Nie można otworzyć czatu' });
  }, [selectedUser, startConversation, router]);

  const handleToggleSharing = useCallback(async () => {
    if (isSharing) {
      liveManuallyDisabledThisSessionRef.current = true;
      setIsSharing(false);
      AsyncStorage.setItem(BG_IS_SHARING_KEY, 'false').catch(() => {});
      void toggleSharing(false);
      return;
    }

    AsyncStorage.setItem(LIVE_SHARING_USER_PREF_KEY, 'true').catch(() => {});
    liveManuallyDisabledThisSessionRef.current = false;
    setIsSharing(true);
    if (!settings.backgroundTracking) {
      Toast.show({
        type: 'info',
        text1: 'Live Map',
        text2: isPremium
          ? 'Działa przy otwartej aplikacji. Włącz „Pracę w tle” w ustawieniach, aby udostępniać lokalizację po zminimalizowaniu.'
          : 'Działa przy otwartej aplikacji. Udostępnianie w tle wymaga Premium.',
      });
    }
    const next = await toggleSharing(true);
    setIsSharing(true);
    AsyncStorage.setItem(LIVE_SHARING_USER_PREF_KEY, 'true').catch(() => {});
    AsyncStorage.setItem(
      BG_IS_SHARING_KEY,
      settings.backgroundTracking ? 'true' : 'false',
    ).catch(() => {});
    if (next) void resumeLiveSession();
  }, [toggleSharing, isSharing, settings.backgroundTracking, resumeLiveSession, isPremium]);

  const handleReport = useCallback(async (report: WarningType | CreateWarningInput) => {
    const acc = getCurrentAccurateLocation();
    if (acc.lat == null || acc.lng == null) { 
      Toast.show({ type: 'error', text1: 'Brak lokalizacji GPS' }); 
      return; 
    }
    setIsSubmittingWarning(true);
    try {
      const routePoints = activeRoute?.points ?? [];
      const input: CreateWarningInput = typeof report === 'string'
        ? { type: report }
        : report;
      const payload: CreateWarningInput = {
        ...input,
        direction: input.direction ?? 'same',
        heading: input.heading ?? acc.heading ?? null,
        source: input.source ?? 'phone',
      };
      await addWarning(payload, acc.lat, acc.lng, routePoints);
      Toast.show({ type: 'success', text1: '✅ ZGŁOSZONO', text2: getWarningLabel(payload.type) });
    } finally {
      setIsSubmittingWarning(false);
    }
  }, [getCurrentAccurateLocation, addWarning, activeRoute]);
  handleReportRef.current = handleReport;

  const handleSubmitSpeedLimit = useCallback(async (limitKmh: number) => {
    const current = getCurrentAccurateLocation();
    if (current.lat == null || current.lng == null) {
      throw new Error('Brak lokalizacji GPS.');
    }
    try {
      const next = await submitSpeedLimit({
        lat: current.lat,
        lng: current.lng,
        heading: current.heading,
        accuracy: current.accuracy ?? Number.POSITIVE_INFINITY,
        limitKmh,
      });
      Toast.show({
        type: 'success',
        text1: next.status === 'queued'
          ? 'LIMIT ZAPISANY DO WYSŁANIA'
          : next.status === 'pending'
            ? 'LIMIT OCZEKUJE'
            : 'LIMIT POTWIERDZONY',
        text2: next.status === 'queued'
          ? 'Brak odpowiedzi serwera — limit zapisano do wysłania'
          : `${limitKmh} km/h`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nie udało się zapisać limitu.';
      Toast.show({ type: 'error', text1: 'NIE ZAPISANO LIMITU', text2: message });
      throw error;
    }
  }, [getCurrentAccurateLocation, submitSpeedLimit]);

  const handleCenterOnUser = useCallback(() => {
    if (isDrivingRef.current || isNavigatingRef.current) {
      cameraV3.resumeFollow();
      setFollowMode(isNavigatingRef.current ? 'navigationFollow' : 'drivingFollow');
      const mLat = driveMarker.lat.value;
      const mLng = driveMarker.lng.value;
      const mHdg = Number.isFinite(driveMarker.heading.value)
        ? normalizeHeading(driveMarker.heading.value)
        : normalizeHeading(lastHeadingRef.current || 0);
      if (
        Number.isFinite(mLat)
        && Number.isFinite(mLng)
        && !(Math.abs(mLat) < 1e-6 && Math.abs(mLng) < 1e-6)
      ) {
        // Natywna kamera
        cameraV3.recenter(
          { latitude: mLat, longitude: mLng },
          { heading: mHdg, speedKmh: speedKmhRef.current, animate: true },
        );
      }
      return;
    }

    const cached = peekMapLastLocation();
    const lat = userLocation?.latitude
      ?? currentLocRef.current?.latitude
      ?? lastGoodLocRef.current?.lat
      ?? (Number.isFinite(drLatRef.current) && drLatRef.current !== 0 ? drLatRef.current : undefined)
      ?? cached?.latitude;
    const lng = userLocation?.longitude
      ?? currentLocRef.current?.longitude
      ?? lastGoodLocRef.current?.lng
      ?? (Number.isFinite(drLngRef.current) && drLngRef.current !== 0 ? drLngRef.current : undefined)
      ?? cached?.longitude;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      refreshLocationOneShot({ force: true });
      return;
    }

    releaseTripCameraState();
    setFollowMode('idleBrowse');
    const safeLat = Number(lat);
    const safeLng = Number(lng);
    lastMapCenterRef.current = [safeLng, safeLat];
    resetBrowseCamera({ latitude: safeLat, longitude: safeLng }, { animate: true });
  }, [
    userLocation,
    resetBrowseCamera,
    refreshLocationOneShot,
    setFollowMode,
    cameraV3,
    driveMarker,
    releaseTripCameraState,
  ]);

  // ── transitionFromApproachToRouteRun ─────────────────────
  const transitionFromApproachToRouteRun = useCallback(() => {
    if (transitioningToRouteRunRef.current) return;
    const loaded = loadedRouteRef.current;
    if (!loaded || !approachingRouteStartRef.current) return;
    transitioningToRouteRunRef.current = true;

    isNavigatingRef.current = false;
    setNavigatingFlag(false).catch(() => {});
    resetDRRefs();
    stopSimulation();
    setIsSimulating(false);
    void 0;
    setIsNavigating(false);
    setOffRoute(false);
    v3SnapToRouteSuppressedRef.current = false;
    offRouteSinceRef.current = 0;
    offRouteStreakRef.current = 0;

    finishTrip();
    // Entering the route from its approach is still the same drive. Keep the
    // ledger open; only arrival/manual stop/idle may create history.
    void flushTripDistanceCheckpointRef.current({
      minKm: TRIP_CHECKPOINT_FORCE_MIN_KM,
      forceAll: true,
      reason: 'route_run_transition',
    });
    passiveTripStartedRef.current = false;

    if (timerRunning) {
      stopTimer();
      resetTimer();
    }

    approachingRouteStartRef.current = false;

    setIsOffroadRoute(loaded.isOffroad);
    isOffroadRef.current = loaded.isOffroad;
    if (loaded.isOffroad && loaded.points.length > 1) {
      offroadLoadedPointsRef.current = loaded.points;
      offroadPointsRef.current = loaded.points;
      routePointsRef.current = loaded.points;
    } else {
      offroadLoadedPointsRef.current = [];
    }

    setStartLocation(loaded.start);
    setEndLocation(loaded.end);
    autoStartRouteAfterApproachRef.current = false;

    Toast.show({
      type: 'success',
      text1: '🏁 TRYB GOTOWOŚCI',
      text2: 'Rozpocznij jazdę lub kliknij Ruszaj',
    });
    navigationVoice.enqueue({
      id: `route-start-zone:${loadedRouteRef.current?.routeId ?? 'active'}`,
      text: 'Jesteś w strefie startowej. Ruszaj, aby rozpocząć pomiar czasu.',
      category: 'info',
    });

    transitioningToRouteRunRef.current = false;
  }, [
    dismissNavigationNotification,
    flushNavigationStatsOnce,
    onNavigationCancel,
    resetDRRefs,
    resetTimer,
    navigationVoice.enqueue,
    stopSimulation,
    stopTimer,
    timerRunning,
    finishTrip,
  ]);

  // ── handleArrived ─────────────────────────────────────────
  const handleArrived = useCallback(async () => {
    if (approachingRouteStartRef.current && loadedRouteRef.current) {
      transitionFromApproachToRouteRun();
      return;
    }

    // Drop destinations: do not tear down nav / wipe the drop — force claim in zone.
    if (dropNavigationTargetIdRef.current) {
      const pose = lastTripMarkerPoseRef.current;
      const lat = pose?.lat ?? currentLocRef.current?.latitude ?? userLocation?.latitude;
      const lng = pose?.lng ?? currentLocRef.current?.longitude ?? userLocation?.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        void tryClaimGamificationDropRef.current({
          lat: lat!,
          lng: lng!,
          mode: 'navigation',
          headingDeg: drHdgRef.current ?? lastHeadingRef.current ?? null,
          speedKmh: Number.isFinite(speedKmhRef.current) ? speedKmhRef.current : 0,
        });
      }
      if (Date.now() - dropZoneClaimToastAtRef.current > 8_000) {
        dropZoneClaimToastAtRef.current = Date.now();
        Toast.show({
          type: 'info',
          text1: 'Strefa zrzutu',
          text2: 'Odbieram zrzut — jedź przez strefę.',
          visibilityTime: 3200,
        });
      }
      return;
    }

    driveTraceSession('nav_end', { reason: 'arrived' });
    track({
      eventName: 'navigation_completed',
      screenName: 'map',
      surface: 'route_navigation',
      entityType: 'map',
      entityId: String(loadedRouteRef.current?.routeId ?? 'ad_hoc'),
      priority: 'high',
      properties: { offroad: isOffroadRef.current },
    });
    isNavigatingRef.current = false;
    navigationBootstrapTokenRef.current += 1;
    setNavigationUiReady(false);
    await setNavigatingFlag(false);
    void 0;
    const finalStats = finishTrip();
    tripPeakSpeedRef.current = Math.max(tripPeakSpeedRef.current, finalStats.maxSpeedKmh || 0);
    profileTotalDistanceKmRef.current += Math.max(
      0,
      Math.max(Number(finalStats.distanceKm || 0), tripCheckpointSavedKmRef.current) - tripCheckpointSavedKmRef.current,
    );
    setIsNavigating(false);
    setArrived(true);
    setDistToTurnM(null);
    setRemainingDistKm(null);
    remainingDurationMinRef.current = null;
    setRemainingDurationMin(null);
    notifThrottleRef.current = 0;
    dismissNavigationNotification();
    navigationVoice.stop();
    navigationVoice.enqueue({
      id: `arrival:${effectiveNavRoute?.routeRevision ?? Date.now()}`,
      text: 'Dotarłeś do celu!',
      category: 'maneuver-now',
    });
    Toast.show({ type: 'success', text1: '🏁 DOTARŁEŚ DO CELU!', text2: endLocation?.name ?? '' });

    if (userLocation) resetBrowseCamera(userLocation);

    InteractionManager.runAfterInteractions(() => {
      void deliverGamificationRewards();
      flushNavigationStatsOnce(finalStats);
      if (routeInfo?.distance) onNavigationComplete(parseFloat(routeInfo.distance));
      setTimeout(() => setTripStatsVisible(true), 2000);
    });

    if (timerRunning) {
      const elapsed = stopTimer();
      Toast.show({ type: 'success', text1: '🏁 TRASA UKOŃCZONA!', text2: `Czas: ${formatElapsed(elapsed)}`, visibilityTime: 5000 });

      const routeId = leaderboardRouteId;
      if (routeId) {
        await saveRun(routeId, elapsed);
        await Promise.all([fetchLeaderboard(routeId), fetchRuns(routeId)]);
        setMyFinishedTime(elapsed);
        setTimeout(() => setLeaderboardVisible(true), 1800);
      }
      loadedRouteRef.current = null;
    }

    setTimeout(() => {
      setStartLocation(null);
      setEndLocation(null);
      setRouteInfo(null);
      setArrived(false);
      setNavStartLoc(null);
    }, 3000);
  }, [
    endLocation, userLocation, routeInfo, navigationVoice.stop, navigationVoice.enqueue, resetBrowseCamera,
    onNavigationComplete, timerRunning, stopTimer, formatElapsed,
    leaderboardRouteId, saveRun, fetchLeaderboard, fetchRuns,
    flushNavigationStatsOnce,
    deliverGamificationRewards,
    transitionFromApproachToRouteRun,
  ]);

  useEffect(() => {
    if (!isNavigating || !navigationUiReady || !effectiveNavRoute?.steps?.length) {
      navRouteIdxRef.current = -1;
      lastUserArcMRef.current = null;
      runNavProgressRef.current = () => {};
      return;
    }

    const steps  = effectiveNavRoute.steps;
    const points = effectiveNavRoute.points?.length
      ? effectiveNavRoute.points
      : routePointsRef.current;

    const runNavProgress = () => {
      const mLat = driveMarker.lat.value;
      const mLng = driveMarker.lng.value;
      const hasSmoothedMarker = Number.isFinite(mLat) && Number.isFinite(mLng)
        && !(Math.abs(mLat) < 1e-6 && Math.abs(mLng) < 1e-6);
      const drFresh =
        drLatRef.current !== 0
        && drLngRef.current !== 0
        && Date.now() - drLastFrameAtRef.current <= DR_STALE_MS;
      const fallbackLoc = currentLocRef.current;
      const currentLat = hasSmoothedMarker
        ? mLat
        : (drFresh ? drLatRef.current : fallbackLoc?.latitude);
      const currentLng = hasSmoothedMarker
        ? mLng
        : (drFresh ? drLngRef.current : fallbackLoc?.longitude);
      if (!currentLat || !currentLng) return;

      const inRerouteGrace = Date.now() < rerouteGraceUntilRef.current;
      const thresholdM = inRerouteGrace
        ? Math.max(REROUTE_THRESHOLD_M, REROUTE_THRESHOLD_RECOVERY_M)
        : GPS_ON_ROUTE_THRESHOLD_M;
      const routeProjection = points.length > 1
        ? projectPointToRouteWindow(
            currentLat,
            currentLng,
            points,
            navRouteIdxRef.current,
            Math.max(thresholdM, NAV_ROUTE_SNAP_M),
          )
        : null;
      const onRoad = routeProjection != null && routeProjection.distM <= thresholdM;
      const snapped = onRoad && !offRouteRef.current && routeProjection
        ? { latitude: routeProjection.latitude, longitude: routeProjection.longitude }
        : { latitude: currentLat, longitude: currentLng };
      const { latitude: lat, longitude: lng } = snapped;

      if (endLocation) {
        const distToEnd = haversineKm(lat, lng, endLocation.latitude, endLocation.longitude) * 1000;
        const dropNavId = dropNavigationTargetIdRef.current;
        if (dropNavId) {
          const drop = gamificationDropsRef.current.find((d) => Number(d.id) === Number(dropNavId));
          const zoneM = Math.max(85, Number(drop?.radiusM) || 85);
          if (distToEnd < zoneM) {
            // Claim in zone; keep nav HUD running until claim handler stops route.
            void handleArrived();
          }
        } else {
          const arriveThreshold = approachingRouteStartRef.current ? 75 : 30;
          if (distToEnd < arriveThreshold && !arrivedRef.current) { handleArrived(); return; }
        }
      }

      const prevStep = currentStepRef.current;
      let nextStep = prevStep;
      let distToManeuver = Number.POSITIVE_INFINITY;
      let userArcM = Number.NaN;
      if (onRoad && !offRouteRef.current && routeProjection && points.length > 1) {
        const arcCache = stepArcIndexRef.current;
        if (arcCache.points !== points || arcCache.steps !== steps) {
          const prefix = buildRouteForwardArcPrefix(points);
          routeForwardPrefixRef.current = { points, prefix };
          stepArcIndexRef.current = {
            points,
            steps,
            index: buildStepArcIndex(points, steps),
          };
          lastUserArcMRef.current = null;
        }
        const forwardPrefix = routeForwardPrefixRef.current.points === points
          ? routeForwardPrefixRef.current.prefix
          : buildRouteForwardArcPrefix(points);
        if (routeForwardPrefixRef.current.points !== points) {
          routeForwardPrefixRef.current = { points, prefix: forwardPrefix };
        }
        const rawUserArcM = computeUserArcM(points, routeProjection, forwardPrefix);
        const prevArc = lastUserArcMRef.current;
        // A route revision resets this ref. Within one revision progress is
        // monotonic: projection jitter must never move the car backwards and
        // make the distance to the same maneuver increase.
        userArcM = stabilizeRouteArcProgress(prevArc, rawUserArcM);
        lastUserArcMRef.current = userArcM;
        const stepArcIndex = stepArcIndexRef.current.index;

        if (pendingStepArcClampRef.current && stepArcIndex.length) {
          const clamped = findStepIndexForArcM(userArcM, stepArcIndex);
          pendingStepArcClampRef.current = false;
          nextStep = clamped;
          if (clamped !== prevStep) {
            currentStepRef.current = clamped;
            setCurrentStep(clamped);
            announcedPhasesRef.current = new Set();
            lastManeuverDistanceRef.current = null;
          }
        } else {
          nextStep = detectCurrentStep(userArcM, steps, prevStep, stepArcIndex);
          if (nextStep !== prevStep) {
            currentStepRef.current = nextStep;
            setCurrentStep(nextStep);
            announcedPhasesRef.current = new Set();
            lastManeuverDistanceRef.current = null;
          }
        }

        const announceTarget = resolveAnnouncementTarget(
          steps,
          nextStep,
          userArcM,
          lat,
          lng,
          stepArcIndex,
          points,
          forwardPrefix,
        );
        // Stabilize the canonical cue too (HUD, notification and Android Auto
        // all consume it), not only the text rendered on the phone.
        distToManeuver = stabilizeManeuverDistance(
          lastDistToTurnUiRef.current,
          announceTarget.distanceM,
          announceTarget.stepIndex === announceStepIndexRef.current,
        );
        const routeRevision = effectiveNavRoute.routeRevision
          ?? `${points.length}:${steps.length}`;
        const canonicalCue = createResolvedNavigationCue({
          stepIndex: announceTarget.stepIndex,
          step: announceTarget.step,
        originalStep: rawEffectiveNavRoute?.steps?.[announceTarget.stepIndex],
        distanceM: distToManeuver,
        routeRevision,
        geometryDiagnostic:
          effectiveNavRoute.geometryDiagnostics?.[announceTarget.stepIndex] ?? null,
      });
        if (
          !resolvedNavigationCueRef.current
          || resolvedCueKey(resolvedNavigationCueRef.current) !== resolvedCueKey(canonicalCue)
        ) {
          resolvedNavigationCueRef.current = canonicalCue;
          setResolvedNavigationCue(canonicalCue);
        }
        if (announceTarget.stepIndex !== announceStepIndexRef.current) {
          announceStepIndexRef.current = announceTarget.stepIndex;
          setAnnounceStepIndex(announceTarget.stepIndex);
          lastDistToTurnUiRef.current = null;
        }
        if (nextStep !== prevStep) {
          visionEvent('NAV_STEP_CHANGE', {
            prevStep,
            nextStep,
            distToManeuverM: Math.round(distToManeuver),
            userArcM: Math.round(userArcM),
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
          });
        }
        const previousManeuver = lastManeuverDistanceRef.current;
        const previousDistance = previousManeuver?.stepIndex === announceTarget.stepIndex
          ? previousManeuver.distanceM
          : undefined;
        const speechPhase = getAdaptiveGuidancePhase({
          distanceM: distToManeuver,
          previousDistanceM: previousDistance,
          speedKmh: speedKmhRef.current,
          step: announceTarget.step,
        });
        lastManeuverDistanceRef.current = {
          stepIndex: announceTarget.stepIndex,
          distanceM: distToManeuver,
        };

        if (
          speechPhase
          && shouldSpeakForStep(announceTarget.step, distToManeuver)
        ) {
          const phaseKey = `${routeRevision}:${announceTarget.stepIndex}:${speechPhase}`;
          const wasChained = speechPhase === 'prepare'
            && chainedPrepareStepsRef.current.has(`${routeRevision}:${announceTarget.stepIndex}`);
          if (!announcedPhasesRef.current.has(phaseKey)) {
            const followingStep = steps[announceTarget.stepIndex + 1] ?? null;
            const followingArc = stepArcIndex[announceTarget.stepIndex + 1];
            const currentArc = stepArcIndex[announceTarget.stepIndex];
            const followingDistanceM = followingArc && currentArc
              ? Math.max(0, followingArc.startArcM - currentArc.startArcM)
              : null;
            const speechText = wasChained
              ? ''
              : buildAdaptiveNavigationSpeech({
                  step: announceTarget.step,
                  distanceM: distToManeuver,
                  phase: speechPhase,
                  followingStep,
                  followingDistanceM,
                  speedKmh: speedKmhRef.current,
                });
            if (!speechText && wasChained) {
              announcedPhasesRef.current.add(phaseKey);
            } else if (speechText) {
              navigationVoice.enqueue({
                id: `maneuver:${phaseKey}`,
                text: speechText,
                category: speechPhase === 'now' ? 'maneuver-now' : 'maneuver',
                onStart: () => {
                  announcedPhasesRef.current.add(phaseKey);
                  lastGuidanceStartedAtRef.current = Date.now();
                  if (
                    speechPhase === 'prepare'
                    && followingStep
                    && shouldChainFollowingManeuver(followingDistanceM, speedKmhRef.current)
                  ) {
                    chainedPrepareStepsRef.current.add(
                      `${routeRevision}:${announceTarget.stepIndex + 1}`,
                    );
                  }
                },
              });
            }
          }
        } else if (
          !shouldSpeakForStep(announceTarget.step, distToManeuver)
          && distToManeuver >= 2_000
          && Date.now() - lastGuidanceStartedAtRef.current >= 4 * 60_000
        ) {
          const reassuranceKey = `${routeRevision}:${announceTarget.stepIndex}`;
          if (longStraightSpokenForStepRef.current !== reassuranceKey) {
            const km = Math.max(2, Math.round(distToManeuver / 1_000));
            navigationVoice.enqueue({
              id: `reassurance:${reassuranceKey}`,
              text: `Kontynuuj prosto przez około ${km} kilometry`,
              category: 'info',
              onStart: () => {
                longStraightSpokenForStepRef.current = reassuranceKey;
                lastGuidanceStartedAtRef.current = Date.now();
              },
            });
          }
        }

        if (steps[nextStep]) {
          const uiDist = distToManeuver;
          const prevUiDist = lastDistToTurnUiRef.current;
          const roundedTurn = Math.round(uiDist / 10) * 10;
          if (prevUiDist == null || Math.abs(roundedTurn - prevUiDist) >= 10) {
            lastDistToTurnUiRef.current = roundedTurn;
            setDistToTurnM(uiDist);
          }
        }
      }

      if (points.length) {
        const nowOff = Date.now();
        if (onRoad && !reroutePendingRef.current) {
          offRouteSinceRef.current = 0;
          offRouteStreakRef.current = 0;
          if (offRouteRef.current) {
            offRouteRef.current = false;
            v3SnapToRouteSuppressedRef.current = false;
            setOffRoute(false);
          }
        } else if (
          !reroutePendingRef.current
          && !inRerouteGrace
          && Date.now() >= rerouteBlockedUntilRef.current
        ) {
          if (speedKmhRef.current < 5) {
            offRouteStreakRef.current = 0;
            offRouteSinceRef.current = 0;
          } else {
            offRouteStreakRef.current += 1;
            if (!offRouteSinceRef.current) offRouteSinceRef.current = nowOff;
            if (
              offRouteStreakRef.current >= OFF_ROUTE_CONFIRM_STREAK
              && !offRouteRef.current
            ) {
              offRouteRef.current = true;
              v3SnapToRouteSuppressedRef.current = true;
              setOffRoute(true);
              lastManeuverDistanceRef.current = null;
              announcedPhasesRef.current = new Set();
              navigationVoice.stop();
              visionEvent('NAV_OFF_ROUTE', {
                streak: offRouteStreakRef.current,
                sinceMs: nowOff ? Date.now() - offRouteSinceRef.current : 0,
                speedKmh: Math.round(speedKmhRef.current),
                lat: Number(lat.toFixed(6)),
                lng: Number(lng.toFixed(6)),
              });
            }
          }
        }
      }

      if (points.length > 1 && !offRouteRef.current && routeProjection) {
        const idx = routeProjection.segmentIndex;
        const prevIdx = navRouteIdxRef.current;
        if (prevIdx < 0 || idx >= prevIdx - 2) {
          navRouteIdxRef.current = Math.max(0, idx);
        }

        const previousHead = lastRemainingRouteHeadRef.current;
        // Linia trasy zawsze zaczyna się na geometrii drogi. Łączenie jej z
        // animowanym markerem tworzyło ukośny, trójkątny artefakt na zakrętach.
        const headLat = routeProjection.latitude;
        const headLng = routeProjection.longitude;
        const headMovedM = previousHead
          ? haversineKm(
              previousHead.lat,
              previousHead.lng,
              headLat,
              headLng,
            ) * 1000
          : Number.POSITIVE_INFINITY;
        const routeLineNowMs = Date.now();
        const shouldRefreshRouteLine = !previousHead
          || previousHead.idx !== idx
          || (headMovedM >= 8 && routeLineNowMs - previousHead.atMs >= 1_000);
        if (shouldRefreshRouteLine) {
          lastRemainingRouteHeadRef.current = {
            lat: headLat,
            lng: headLng,
            idx,
            atMs: routeLineNowMs,
          };
          setRemainingRoutePoints([
            { latitude: headLat, longitude: headLng },
            ...points.slice(idx + 1),
          ]);
        }

        if (routePrefixSumsRef.current.points !== points) {
          const sums = new Array(points.length).fill(0);
          for (let i = points.length - 2; i >= 0; i--) {
            sums[i] = sums[i + 1] + haversineKm(
              points[i].latitude, points[i].longitude,
              points[i + 1].latitude, points[i + 1].longitude
            );
          }
          routePrefixSumsRef.current = { points, sums };
        }
        
        let remKm = 0;
        if (idx < points.length - 1) {
          const distToNextPoint = haversineKm(
            routeProjection.latitude, routeProjection.longitude,
            points[idx + 1].latitude, points[idx + 1].longitude
          );
          remKm = distToNextPoint + routePrefixSumsRef.current.sums[idx + 1];
        }

        const roundedRem = parseFloat(remKm.toFixed(2));
        if (lastRemainingKmUiRef.current == null || Math.abs(roundedRem - lastRemainingKmUiRef.current) >= 0.01) {
          lastRemainingKmUiRef.current = roundedRem;
          setRemainingDistKm(remKm);
        }

        const routeForEta = effectiveNavRoute;
        const nextDurationMin = estimateRemainingRouteMinutes({
          routeDurationMinutes: routeForEta?.duration ?? routeInfoRef.current?.duration,
          routeDistanceMeters: routeForEta?.distanceValue,
          remainingDistanceKm: remKm,
        });
        if (
          nextDurationMin != null
          && nextDurationMin !== remainingDurationMinRef.current
        ) {
          remainingDurationMinRef.current = nextDurationMin;
          setRemainingDurationMin(nextDurationMin);
        }

        const nowMs = Date.now();
        if (nowMs - notifThrottleRef.current > 30_000) {
          notifThrottleRef.current = nowMs;
          const stepForNotif = resolvedNavigationCueRef.current?.step
            ?? steps[announceStepIndexRef.current]
            ?? steps[nextStep];
          if (stepForNotif) {
            const distStr = remKm < 1
              ? `${Math.round(remKm * 1000)} m`
              : `${remKm.toFixed(1)} km`;
            const ri = routeInfoRef.current;
            const etaMin = remainingDurationMinRef.current ?? ri?.duration ?? null;
            showNavigationNotification(
              stepForNotif,
              distStr,
              etaMin != null ? formatDuration(etaMin) : '',
              resolvedNavigationCueRef.current?.distanceM ?? distToManeuver,
            );
          }
        }
      }
    };

    runNavProgressRef.current = runNavProgress;
    runNavProgress();
  }, [
    isNavigating,
    navigationUiReady,
    effectiveNavRoute,
    rawEffectiveNavRoute,
    endLocation,
    handleArrived,
    showNavigationNotification,
    navigationVoice.enqueue,
    navigationVoice.stop,
    driveMarker,
  ]);

  useMapNavigationSession({
    enabled: isNavigating && navigationUiReady && !!effectiveNavRoute?.steps?.length,
    runNavProgress: () => runNavProgressRef.current(),
  });

  // ── beginNavigation ───────────────────────────────────────
  const beginNavigation = useCallback(() => {
    const hadActiveTrip = isDrivingRef.current || isNavigatingRef.current;
    const livePose = readLiveTripPose();
    const fallbackLoc = userLocation
      ? { latitude: userLocation.latitude, longitude: userLocation.longitude, headingDeg: lastHeadingRef.current || 0 }
      : null;
    const pose = livePose ?? fallbackLoc;
    if (!pose) return;

    // Nie wołaj pełnego exitDrivingMode (finishTrip + reset silnika) — to kasowało trip
    // i mogło crashować przy przejściu jazda → nawigacja.
    isDrivingRef.current = false;
    drivingEntryAnchorRef.current = null;
    drivingEntryGraceUntilRef.current = 0;
    drivingManualModeRef.current = false;
    // Preserve live trip pose when switching freeDrive -> navigation.
    // Clearing it here caused a visible pause/jump because downstream UI would
    // temporarily lose the SSOT pose while the nav pipeline was bootstrapping.
    if (!hadActiveTrip) {
      lastTripMarkerPoseRef.current = null;
    }
    setIsDriving(false);

    if (passiveTripStartedRef.current) {
      updateTripEstimate(routeDurationMinutesToSeconds(routeInfo?.duration));
    } else {
      startTrip(routeDurationMinutesToSeconds(routeInfo?.duration));
    }
    passiveTripStartedRef.current = true;
    navStatsFlushedRef.current = false;

    // Switching modes should not wipe DR/marker continuity when a trip is already running.
    if (!hadActiveTrip) {
      resetDRRefs();
    }
    setFollowMode('navigationFollow');
    isNavigatingRef.current = true;
    setTripCameraActive(true);
    const navigationBootstrapToken = ++navigationBootstrapTokenRef.current;
    setNavigationUiReady(false);
    tripSpeedWarmupUntilRef.current = Date.now() + 10_000;
    lastAppliedRerouteSigRef.current = '';

    lastNavLocRef.current = null;
    resetSpeedStats();
    tripCheckpointActiveRef.current = true;
    void (hadActiveTrip
      ? continueDriveSessionAsNavigation()
      : startDriveSession('navigation')
    ).catch(() => {});
    if (!hadActiveTrip) {
      resetDRRefs();
    }
    navLatFilter.reset();
    navLngFilter.reset();
    startIsMyLocationRef.current = false;
    announcedPhasesRef.current   = new Set();
    chainedPrepareStepsRef.current.clear();
    longStraightSpokenForStepRef.current = null;
    setResolvedNavigationCue(null);
    resolvedNavigationCueRef.current = null;

    const navStart = { latitude: pose.latitude, longitude: pose.longitude, name: 'Moja pozycja' };
    const seededRoute = previewRouteRef.current ?? navRouteRef.current;
    const initialDurationMin = Number(seededRoute?.duration ?? routeInfo?.duration);
    remainingDurationMinRef.current = Number.isFinite(initialDurationMin) && initialDurationMin > 0
      ? initialDurationMin
      : null;
    setRemainingDurationMin(remainingDurationMinRef.current);

    if (seededRoute?.points?.length) {
      const routePts = trimRoutePointsFromVehicle(
        seededRoute.points,
        navStart.latitude,
        navStart.longitude,
        NAV_ROUTE_SNAP_M,
      );
      routePointsRef.current = routePts;
      setNavRouteOverride({ ...seededRoute, points: routePts });
      stepArcIndexRef.current = { points: [], steps: [], index: [] };
    } else {
      setNavRouteOverride(null);
      routePointsRef.current = [];
    }

    // ── Offroad: ustaw punkty z załadowanej trasy ─────────
    if (isOffroadRef.current) {
      const pts = offroadLoadedPointsRef.current.length > 1
        ? offroadLoadedPointsRef.current
        : (routePointsRef.current.length >= 2 ? routePointsRef.current : (seededRoute?.points ?? activeRoute?.points ?? []));
      offroadPointsRef.current = pts;
      routePointsRef.current   = pts.length >= 2
        ? trimRoutePointsFromVehicle(pts, navStart.latitude, navStart.longitude, NAV_ROUTE_SNAP_M)
        : pts;
    }

    let bootLat = navStart.latitude;
    let bootLng = navStart.longitude;
    let bootHdg = pose.headingDeg ?? lastHeadingRef.current ?? drHdgRef.current ?? 0;

    if (routePointsRef.current.length >= 2) {
      const bootSnapped = snapToRoute(bootLat, bootLng, routePointsRef.current, NAV_ROUTE_SNAP_M);
      bootLat = bootSnapped.latitude;
      bootLng = bootSnapped.longitude;
      bootHdg = alignBearingToReference(
        routeHeadingAtPoint(routePointsRef.current, bootLat, bootLng, bootHdg),
        lastGpsDeviceHeadingRef.current ?? bootHdg,
      );
    }

    lastSetLocRef.current = { lat: bootLat, lng: bootLng };
    lastGoodLocRef.current = { lat: bootLat, lng: bootLng };

    setIsNavigating(true);
    track({
      eventName: 'navigation_started',
      screenName: 'map',
      surface: 'route_navigation',
      entityType: 'map',
      entityId: String(loadedRouteRef.current?.routeId ?? 'ad_hoc'),
      priority: 'high',
      properties: { offroad: isOffroadRef.current, switched_from_drive: hadActiveTrip },
    });
    resetTravelHeadingState(bootLat, bootLng, bootHdg);
    getTripHeadingFilter().reset(bootHdg);
    tripMarkerV2BootstrappedRef.current = true;
    driveSessionFirstGpsFrameRef.current = true;
    driveSessionInitFramesRef.current = 0;
    if (routePointsRef.current.length >= 2) {
      navV3.setRoutePolyline(
        routePointsRef.current.map(p => ({ lat: p.latitude, lng: p.longitude })),
      );
    }
    tripBootstrapPose(bootLat, bootLng, bootHdg, { animateCamera: true });
    if (!gpsForceActiveRef.current) {
      gpsForceActiveRef.current = true;
      applyGpsForceActive(true);
    }
    startGPS();

    drLatRef.current = bootLat;
    drLngRef.current = bootLng;
    drHdgRef.current = bootHdg;

    setNavStartLoc(navStart);
    setStartLocation(navStart);
    setCurrentStep(0);
    setAnnounceStepIndex(0);
    announceStepIndexRef.current = 0;
    pendingStepArcClampRef.current = false;
    lastRemainingRouteHeadRef.current = null;
    lastManeuverDistanceRef.current = null;
    setResolvedNavigationCue(null);
    resolvedNavigationCueRef.current = null;
    setArrived(false);
    setOffRoute(false);
    v3SnapToRouteSuppressedRef.current = false;
    offRouteSinceRef.current = 0;
    offRouteStreakRef.current = 0;

    if (routeInfo?.duration) onNavigationStart(routeInfo.duration);
    if (pendingRouteRef.current && !approachingRouteStartRef.current) {
      startTimer(pendingRouteRef.current.id, pendingRouteRef.current.name);
      pendingRouteRef.current = null;
    }

    setFollowMode('navigationFollow');

    requestAnimationFrame(() => {
      InteractionManager.runAfterInteractions(() => {
        if (
          navigationBootstrapTokenRef.current !== navigationBootstrapToken
          || !isNavigatingRef.current
        ) return;
        if (seededRoute?.points?.length && seededRoute.steps?.length) {
          const preparedRoute = trimNavigationRouteFromVehicle(
            seededRoute,
            navStart.latitude,
            navStart.longitude,
            NAV_ROUTE_SNAP_M,
          );
          routePointsRef.current = preparedRoute.points;
          setNavRouteOverride(preparedRoute);
          navV3.setRoutePolyline(
            preparedRoute.points.map(point => ({ lat: point.latitude, lng: point.longitude })),
            { lat: bootLat, lng: bootLng },
          );
        }
        setNavigationUiReady(true);
      });
    });

    driveTraceSession('nav_start', {
      routePts: routePointsRef.current.length,
      bootLat: Number(bootLat.toFixed(6)),
      bootLng: Number(bootLng.toFixed(6)),
      bootHdg: Math.round(bootHdg),
      offroad: isOffroadRef.current,
      routeBootstrap: false,
      livePose: true,
    });

    navigationVoice.clearSessionDedupe();
    navigationVoice.enqueue({
      id: `navigation-start:${Date.now()}`,
      text: 'Nawigacja rozpoczęta. Dobrej drogi!',
      category: 'info',
    });
  }, [userLocation, routeInfo, navigationVoice.clearSessionDedupe, navigationVoice.enqueue, onNavigationStart, startTimer, setFollowMode,
      activeRoute, startGPS, navV3, driveMarker, readLiveTripPose, tripBootstrapPose,
      startTrip, updateTripEstimate]);

  // ── startNavigation ───────────────────────────────────────
  const startNavigation = useCallback(() => {
    if (!endLocation) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wybierz cel podróży' }); return;
    }
    const livePose = readLiveTripPose();
    const navUserLoc = livePose
      ? { latitude: livePose.latitude, longitude: livePose.longitude }
      : userLocation;
    if (!navUserLoc) {
      Toast.show({ type: 'error', text1: 'BŁĄD GPS', text2: 'Czekam na lokalizację...' }); return;
    }
    if (!startLocation) {
      setStartLocation({ ...navUserLoc, name: 'Moja pozycja' });
      startIsMyLocationRef.current = true;
      setTimeout(() => beginNavigation(), 100);
      return;
    }
    const distToStart = haversineKm(
      navUserLoc.latitude, navUserLoc.longitude,
      startLocation.latitude, startLocation.longitude,
    ) * 1000;
    if (distToStart > 100 && !(isDrivingRef.current || isNavigatingRef.current)) {
      approachingRouteStartRef.current = true;
      setEndLocation(startLocation);
      setStartLocation({ ...navUserLoc, name: 'Moja pozycja' });
      return;
    }
    beginNavigation();
  }, [startLocation, endLocation, userLocation, beginNavigation, readLiveTripPose]);

  // ── stopNavigation ────────────────────────────────────────
  const stopNavigation = useCallback(async (opts?: { silent?: boolean; clearRoute?: boolean }) => {
    track({ eventName: 'ui_action', screenName: 'map', surface: 'route_navigation', priority: 'medium', properties: { action: 'navigation_stopped', silent: !!opts?.silent } });
    driveTraceSession('nav_end', { reason: 'user_stop' });
    const wasApproaching = approachingRouteStartRef.current;
    const hadActiveTrip = isNavigatingRef.current || isDrivingRef.current;
    const finalStats = finishTrip();
    tripPeakSpeedRef.current = Math.max(tripPeakSpeedRef.current, finalStats.maxSpeedKmh || 0);

    isNavigatingRef.current = false;
    isDrivingRef.current = false;
    navigationBootstrapTokenRef.current += 1;
    setNavigationUiReady(false);
    await setNavigatingFlag(false).catch(() => {});
    await setDrivingFlag(false).catch(() => {});
    if (hadActiveTrip) {
      await flushNavigationStatsOnce(finalStats, {
        reason: 'manual',
        mode: wasApproaching ? 'freeDrive' : 'navigation',
      });
    }

    stopSimulation();
    setIsSimulating(false);

    setIsNavigating(false);
    setTripCameraActive(false);
    navV3.setRoutePolyline(null);
    routePointsRef.current = [];
    setOffRoute(false);
    v3SnapToRouteSuppressedRef.current = false;
    offRouteSinceRef.current = 0;
    offRouteStreakRef.current = 0;
    setArrived(false);
    setNavStartLoc(null);
    setNavRouteOverride(null);
    setRerouteOrigin(null);
    setDistToTurnM(null);
    setRemainingDistKm(null);
    remainingDurationMinRef.current = null;
    setRemainingDurationMin(null);
    lastRemainingRouteHeadRef.current = null;
    lastManeuverDistanceRef.current = null;
    notifThrottleRef.current = 0;
    dismissNavigationNotification();
    setRouteEndpointImages({});
    navigationVoice.stop();
    clearTimeout(rerouteTimerRef.current);
    onNavigationCancel();
    clearDropNavigationTarget();
    approachingRouteStartRef.current = false;
    autoStartRouteAfterApproachRef.current = false;

    if (wasApproaching && loadedRouteRef.current) {
      const lr = loadedRouteRef.current;
      pendingRouteRef.current = { id: lr.routeId, name: lr.routeName };
      setStartLocation(lr.start);
      setEndLocation(lr.end);
      if (lr.isOffroad) {
        setIsOffroadRoute(true);
        isOffroadRef.current = true;
        offroadLoadedPointsRef.current = lr.points;
        offroadPointsRef.current = lr.points;
        routePointsRef.current = lr.points;
      }
    } else {
      pendingRouteRef.current = null;
    }

    const hadRouteTimer = timerRunning;
    let elapsedForToast = 0;
    if (hadRouteTimer) {
      elapsedForToast = stopTimer();
      resetTimer();
    }

    if (!opts?.silent) {
      Toast.show({
        type: 'info',
        text1: wasApproaching ? 'DOJAZD ANULOWANY' : 'NAWIGACJA ZATRZYMANA',
        text2: hadRouteTimer && !wasApproaching ? `Czas: ${formatElapsed(elapsedForToast)}` : undefined,
      });
    }

    if (opts?.clearRoute) {
      setEndLocation(null);
      setRouteInfo(null);
      setStartLocation(userLocation ? { ...userLocation, name: 'Moja pozycja' } : null);
      startIsMyLocationRef.current = !!userLocation;
    } else if (userLocation && !wasApproaching) {
      startIsMyLocationRef.current = true;
      setStartLocation({ ...userLocation, name: 'Moja pozycja' });
    }

    // Cancelling navigation ends the trip. Reuse shared cleanup without a
    // second finalization request or a duplicate local profile credit.
    exitDrivingMode({
      skipFlush: true,
      skipProfileCredit: true,
      reason: 'navigation_cancel',
      finalStatsOverride: finalStats,
    });
    setFollowMode('idleBrowse');
  }, [
    userLocation, setFollowMode, onNavigationCancel, flushNavigationStatsOnce,
    timerRunning, stopTimer, resetTimer, formatElapsed,
    navV3, setTripCameraActive, finishTrip, exitDrivingMode,
    clearDropNavigationTarget,
  ]);

  const stopNavigationRef = useRef(stopNavigation);
  stopNavigationRef.current = stopNavigation;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;

    const reconcileNativeFreeDrive = async () => {
      try {
        const state = await BackgroundDriveController.getState();
        if (cancelled) return;
        if (state?.active !== true || state.mode !== 'freeDrive') return;

        await AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false');
        await AsyncStorage.removeItem(NAV_SESSION_KEY);
        if (cancelled) return;

        if (isNavigatingRef.current) {
          await stopNavigationRef.current({ silent: true, clearRoute: true });
          vroomGpsLog('NAV_DROPPED_AFTER_TASK_REMOVED', {
            nativeMode: state.mode,
            hasLastFix: Boolean(state.lastFix),
          }, 0);
        }
      } catch {
        // best effort: cold-start restore also clears the persisted nav session.
      }
    };

    void reconcileNativeFreeDrive();
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void reconcileNativeFreeDrive();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [setFollowMode, setTripCameraActive]);

  useEffect(() => {
    setDropClaimHandler((dropId, _reward, context) => {
      pendingDropAutoStartRef.current = false;
      approachingRouteStartRef.current = false;
      autoStartRouteAfterApproachRef.current = false;
      setRouteEndpointImages({});
      setRemainingDistKm(null);
      remainingDurationMinRef.current = null;
      setRemainingDurationMin(null);
      setDistToTurnM(null);
      setArrived(false);
      endLocationRef.current = null;
      setEndLocation(null);
      setRouteInfo(null);

      const shouldStopNav = isNavigatingRef.current || context.hadNavigationTarget;
      if (shouldStopNav) {
        void stopNavigationRef.current({ silent: true, clearRoute: true });
      } else {
        setStartLocation(userLocation ? { ...userLocation, name: 'Moja pozycja' } : null);
      }

      purgeGamificationDrop(dropId);
    });
    return () => setDropClaimHandler(null);
  }, [setDropClaimHandler, purgeGamificationDrop, userLocation]);

  useEffect(() => {
    if (!autoStartRouteAfterApproachRef.current) return;
    if (isNavigating) return;
    if (!userLocation || !startLocation || !endLocation) return;
    if (!isOffroadRoute && (previewLoading || !routeInfo)) return;

    autoStartRouteAfterApproachRef.current = false;
    beginNavigation();
  }, [
    routeInfo,
    previewLoading,
    startLocation,
    endLocation,
    userLocation,
    isNavigating,
    isOffroadRoute,
    beginNavigation,
  ]);

  useEffect(() => {
    if (!pendingDropAutoStartRef.current) return;
    if (isNavigating || navV3Mode !== 'freeDrive') return;
    if (!userLocation || !startLocation || !endLocation) return;
    if (previewLoading || !routeInfo) return;

    pendingDropAutoStartRef.current = false;
    beginNavigation();
  }, [
    routeInfo,
    previewLoading,
    startLocation,
    endLocation,
    userLocation,
    isNavigating,
    navV3Mode,
    beginNavigation,
  ]);

  // ── AUTO START Z TRYBU GOTOWOŚCI ───────────────────────
  useEffect(() => {
    if (isNavigating || !loadedRouteRef.current || !userLocation) return;
    if (approachingRouteStartRef.current) return;
    
    const startPt = loadedRouteRef.current.start;
    const pts = loadedRouteRef.current.points;
    if (!startPt || pts.length < 2) return;

    const distToStartM = haversineKm(userLocation.latitude, userLocation.longitude, startPt.latitude, startPt.longitude) * 1000;

    if (distToStartM <= 75) {
      routeStartZoneEnteredRef.current = true;
    } else if (distToStartM > 75 && distToStartM < 250 && routeStartZoneEnteredRef.current) {
      const distToSecondM = haversineKm(userLocation.latitude, userLocation.longitude, pts[1].latitude, pts[1].longitude) * 1000;
      const startToSecondM = haversineKm(startPt.latitude, startPt.longitude, pts[1].latitude, pts[1].longitude) * 1000;
      if (distToSecondM < startToSecondM) {
         routeStartZoneEnteredRef.current = false;
         beginNavigation();
         Toast.show({ type: 'success', text1: '🏁 START TRASY', text2: 'Rozpoczęto pomiar czasu' });
      }
    }
  }, [userLocation, isNavigating, beginNavigation]);

  const effectiveVisibleUsers = visibleUsers;
  const effectiveWarnings = clusteredWarnings;
  const upcomingWarning = useMemo(() => {
    const current = getCurrentAccurateLocation();
    if (current.lat == null || current.lng == null) return null;
    return selectUpcomingWarning({
      warnings: effectiveWarnings,
      pose: {
        latitude: current.lat,
        longitude: current.lng,
        heading: current.heading ?? 0,
        speedKmh,
      },
      isNavigating,
      isDriving,
      route: remainingRoutePoints,
    });
  }, [effectiveWarnings, getCurrentAccurateLocation, isNavigating, isDriving, remainingRoutePoints, speedKmh, userLocation]);

  useEffect(() => {
    if (!upcomingWarning) return;
    const warning = upcomingWarning.warning;
    const warningId = String(warning.id);
    if (spokenWarningIdsRef.current.has(warningId)) return;
    const baseLeadM = Math.max(250, Math.min(800, (Math.max(speedKmh, 18) / 3.6) * 18));
    const earlyType = warning.type === 'traffic' || warning.type === 'weather';
    const leadM = earlyType ? Math.max(800, Math.min(1_200, baseLeadM * 1.5)) : baseLeadM;
    if (upcomingWarning.distanceM > leadM) return;

    const distanceM = upcomingWarning.distanceM < 1_000
      ? Math.max(50, Math.round(upcomingWarning.distanceM / 50) * 50)
      : Math.round(upcomingWarning.distanceM / 100) * 100;
    const distanceText = distanceM < 1_000
      ? `${distanceM} metrów`
      : `${(distanceM / 1_000).toFixed(1).replace('.', ',')} kilometra`;
    const label = getWarningLabel(warning.type);
    const detail = warning.message?.trim();
    navigationVoice.enqueue({
      id: `road-object:${warningId}`,
      text: detail
        ? `Uwaga, ${label.toLowerCase()}: ${detail}. Za ${distanceText}`
        : `Uwaga, ${label.toLowerCase()} za ${distanceText}`,
      category: isCriticalWarning(warning.type, warning.subtype) ? 'critical' : 'warning',
      onStart: () => {
        spokenWarningIdsRef.current.add(warningId);
        if (spokenWarningIdsRef.current.size > 500) spokenWarningIdsRef.current.clear();
      },
    });
  }, [upcomingWarning, speedKmh, navigationVoice.enqueue]);

  const effectiveCameras = useMemo(() => {
    if (currentZoom < SPEED_CAMERA_MIN_ZOOM) return [];
    if (!Array.isArray(cameras) || cameras.length === 0) return [];
    const zoomCap =
      currentZoom >= 16 ? 1200
      : currentZoom >= 14.5 ? 600
      : currentZoom >= 13 ? 250
      : 80;
    if (cameras.length <= zoomCap) return cameras;
    return [...cameras]
      .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
      .slice(0, zoomCap);
  }, [currentZoom, cameras]);
  const effectiveFuelStations = useMemo(() => {
    // Keep stations visible on normal city zoom; declutter only when far out.
    if (currentZoom < 12.8) return [];
    const zoomCap =
      currentZoom >= 16 ? 42
      : currentZoom >= 15.5 ? 28
      : currentZoom >= 15 ? 18
      : 10;
    if (!Array.isArray(fuelStations) || fuelStations.length <= zoomCap) return fuelStations;
    if (userLocation) {
      const sorted = [...fuelStations].sort((a, b) => {
        const da = haversineKm(userLocation.latitude, userLocation.longitude, a.lat, a.lng);
        const db = haversineKm(userLocation.latitude, userLocation.longitude, b.lat, b.lng);
        return da - db;
      });
      return sorted.slice(0, zoomCap);
    }
    return fuelStations.slice(0, zoomCap);
  }, [currentZoom, fuelStations, userLocation]);
  const effectivePartnerPois = useMemo(() => {
    // Partner markers stay visible farther out than fuel stations (hide only below ~10.5).
    if (currentZoom < 10.5) return [];
    const zoomCap =
      currentZoom >= 16 ? 36
      : currentZoom >= 15 ? 28
      : currentZoom >= 13.5 ? 20
      : currentZoom >= 12 ? 14
      : currentZoom >= 11 ? 10
      : 8;
    if (!Array.isArray(partnerPois) || partnerPois.length <= zoomCap) return partnerPois;
    if (userLocation) {
      const sorted = [...partnerPois].sort((a, b) => {
        const da = haversineKm(userLocation.latitude, userLocation.longitude, a.lat, a.lng);
        const db = haversineKm(userLocation.latitude, userLocation.longitude, b.lat, b.lng);
        const rankDelta = (b.priorityRank || 0) - (a.priorityRank || 0);
        if (rankDelta !== 0) return rankDelta;
        return da - db;
      });
      return sorted.slice(0, zoomCap);
    }
    return [...partnerPois]
      .sort((a, b) => (b.priorityRank || 0) - (a.priorityRank || 0))
      .slice(0, zoomCap);
  }, [currentZoom, partnerPois, userLocation]);
  const handleAutoNavigationStarted = useCallback((event: AutoNavigationStartedPayload) => {
    if (event.routePoints.length < 2) return;
    const distanceMeters = Math.max(0, event.distanceMeters || 0);
    const durationSeconds = Math.max(0, event.durationSeconds || 0);
    const first = event.routePoints[0];
    const last = event.routePoints[event.routePoints.length - 1];
    const route: DirectionsResult = {
      points: event.routePoints,
      steps: [{
        html_instructions: event.instruction || 'Kontynuuj trasę',
        distance: { text: `${(distanceMeters / 1000).toFixed(1)} km`, value: distanceMeters },
        duration: { text: `${Math.max(1, Math.round(durationSeconds / 60))} min`, value: durationSeconds },
        start_location: { lat: first.latitude, lng: first.longitude },
        end_location: { lat: last.latitude, lng: last.longitude },
        maneuver: 'continue',
        polyline: { points: '' },
      }],
      distanceText: `${(distanceMeters / 1000).toFixed(1)} km`,
      distanceValue: distanceMeters,
      durationText: `${Math.max(1, Math.round(durationSeconds / 60))} min`,
      duration: durationSeconds / 60,
      index: 0,
    };
    const origin = userLocation ?? { latitude: first.latitude, longitude: first.longitude };
    setStartLocation({ latitude: origin.latitude, longitude: origin.longitude, name: 'Moja pozycja' });
    previewRouteRef.current = route;
    navRouteRef.current = route;
    routePointsRef.current = event.routePoints;
    setNavRouteOverride(route);
    if (event.destination) setEndLocation(event.destination);
    const nextRouteInfo = {
      distance: route.distanceText,
      duration: route.duration,
      durationText: route.durationText,
    };
    routeInfoRef.current = nextRouteInfo;
    setRouteInfo(nextRouteInfo);
    setCurrentStep(0);
    setAnnounceStepIndex(0);
    announceStepIndexRef.current = 0;
    setResolvedNavigationCue(null);
    resolvedNavigationCueRef.current = null;
    if (typeof event.selectedRouteIndex === 'number' && Number.isFinite(event.selectedRouteIndex)) {
      setSelectedRouteIndex(event.selectedRouteIndex);
    }
    if (event.routePreview) return;
    if (!isNavigatingRef.current) setTimeout(beginNavigation, 0);
  }, [beginNavigation, userLocation]);

  useAutoNavigationBridge({
    isNavigating,
    isDriving,
    isBuilding,
    arrived,
    offRoute,
    currentStep: announceStepIndex,
    navStep: resolvedNavigationCue?.step
      ?? effectiveNavRoute?.steps?.[announceStepIndex]
      ?? null,
    followingNavStep: effectiveNavRoute?.steps?.[announceStepIndex + 1] ?? null,
    upcomingNavSteps: effectiveNavRoute?.steps?.slice(announceStepIndex + 1, announceStepIndex + 4) ?? [],
    routeInfo: routeInfo as (RouteInfo & { durationText?: string | null }) | null,
    remainingDistKm,
    distToTurnM,
    mapStyle,
    locationMarkerStyle: settings.locationMarkerStyle,
    currentUserAvatarUrl: myAvatarUrl,
    selfMarker: {
      style: settings.locationMarkerStyle,
      vehicleModelUrl: useNativeVehicleModel ? equippedMapVehicle?.assetUrl ?? '' : '',
      vehicleModelMeta: useNativeVehicleModel ? equippedMapVehicle?.metadata ?? null : null,
      modelHealth,
    },
    hideLocation: settings.hideLocation,
    startLocation,
    endLocation,
    userLocation,
    speedKmh: speed,
    heading,
    speedLimitKmh: effectiveSpeedLimit,
    voicePreferences: navigationVoice.preferences,
    voiceIdentifier: navigationVoice.selectedVoice?.identifier ?? null,
    remainingRoutePoints,
    navRoutePoints: effectiveNavRoute?.points,
    previewRoutePoints: previewRoute?.points,
    alternativeRoutes,
    builderPins: pins,
    builderRoutePoints: snappedRoute,
    visibleUsers: effectiveVisibleUsers,
    warnings: effectiveWarnings,
    speedCameras: effectiveCameras,
    fuelStations: fuelStations,
    preferredFuel,
    partnerPois: partnerPois,
    geoDrops: gamificationDrops,
    activeDropPrompt: availableDropPrompt,
    onStopRequested: () => { stopNavigation(); },
    onReportRequested: () => { setReportVisible(true); },
    onReportTypeRequested: (type) => { void handleReport(type as WarningType); },
    onSearchRequested: () => { setSearchModalVisible(true); },
    onAutoNavigationStarted: handleAutoNavigationStarted,
    onAutoSearchQuery: () => { setSearchModalVisible(true); },
    onAutoSearchResult: () => { setSearchModalVisible(true); },
  });

  const handleReset = useCallback(() => {
    if (isNavigating) stopNavigation();
    approachingRouteStartRef.current = false;
    autoStartRouteAfterApproachRef.current = false;
    loadedRouteRef.current = null;
    pendingRouteRef.current = null;
    resetTimer();
    setLeaderboardRouteId(null);
    setLeaderboardRouteName('');
    startIsMyLocationRef.current        = false;
    setStartLocation(null);
    setEndLocation(null);
    setRouteInfo(null);
    setCurrentStep(0);
    setAnnounceStepIndex(0);
    announceStepIndexRef.current = 0;
    setResolvedNavigationCue(null);
    resolvedNavigationCueRef.current = null;
    setRouteEndpointImages({});
    setIsOffroadRoute(false);
    isOffroadRef.current                = false;
    offroadLoadedPointsRef.current      = [];  // ← NOWE
    offroadPointsRef.current            = [];  // ← NOWE
  }, [isNavigating, stopNavigation, resetTimer]);

  // ─────────────────────────────────────────────────────────
  // RENDER GUARDS
  // ─────────────────────────────────────────────────────────

  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }}>
        <Text style={{ color: theme.text, fontFamily: 'Orbitron' }}>Tylko mobilne</Text>
      </View>
    );
  }

  if (!region) {
    return (
      <View style={styles.loader}>
        <MaterialCommunityIcons name="car-sports" size={36} color="#e33835" />
        <Text style={styles.loaderText}>ŁADOWANIE GPS...</Text>
        <ActivityIndicator size="small" color="#e3383560" style={{ marginTop: 8 }} />
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────

  const displayStepData = resolvedNavigationCue?.step
    ?? activeSteps[announceStepIndex]
    ?? activeSteps[currentStep];
  const bannerDistPoints = snappedRoute.length > 0
    ? snappedRoute
    : pins.map(p => ({ latitude: p.latitude, longitude: p.longitude }));

  const isTripActive = isTripActiveMap;
  /**
   * v10.9: PRZYWRACAMY SmoothDrPositionMarker w trip mode (driving/nav).
   * Worklet Reanimated 60fps interpoluje LERP miedzy GPS fixami (~1.5s na iOS).
   * Bez tego marker teleportowal sie co 1.5s o ~27m przy 65 km/h = uzytkownik
   * widzial "zacinanie + skoki + brak plynnosci".
   *
   * Karmienie worklet teraz z applyTripPosition (true path),
   * NIE z DR.onFrame (ktore w v10 jest no-op). Dlatego bez "pulsacji" jakie
   * widzielismy w v8/v9 — czysta interpolacja A→B raz na fix.
   */
    const markerLat = isTripActive
    ? (() => {
      const mLat = driveMarker.lat.value;
      const mLng = driveMarker.lng.value;
      if (
        Number.isFinite(mLat)
        && Number.isFinite(mLng)
        && !(Math.abs(mLat) < 1e-6 && Math.abs(mLng) < 1e-6)
      ) {
        return mLat;
      }
      if (Number.isFinite(drLatRef.current) && drLatRef.current !== 0) return drLatRef.current;
      const snap = lastSetLocRef.current;
      if (snap) return snap.lat;
      return userLocation?.latitude ?? NaN;
    })()
    : (userLocation?.latitude ?? NaN);
  const markerLng = isTripActive
    ? (() => {
      const mLat = driveMarker.lat.value;
      const mLng = driveMarker.lng.value;
      if (
        Number.isFinite(mLat)
        && Number.isFinite(mLng)
        && !(Math.abs(mLat) < 1e-6 && Math.abs(mLng) < 1e-6)
      ) {
        return mLng;
      }
      if (Number.isFinite(drLngRef.current) && drLngRef.current !== 0) return drLngRef.current;
      const snap = lastSetLocRef.current;
      if (snap) return snap.lng;
      return userLocation?.longitude ?? NaN;
    })()
    : (userLocation?.longitude ?? NaN);
  const markerHdg = isTripActive
    ? (() => {
      const mHdg = driveMarker.heading.value;
      if (Number.isFinite(mHdg)) return normalizeHeading(mHdg);
      if (Number.isFinite(drHdgRef.current)) return normalizeHeading(drHdgRef.current);
      return lastHeadingRef.current !== 0 ? lastHeadingRef.current : heading;
    })()
    : (lastHeadingRef.current !== 0 ? lastHeadingRef.current : heading);

  // ── Prędkościomierz: mały kafelek (lewy dół) — jazda, nawigacja lub browsing ──
  const isRoutePreviewOpen = !isNavigating && !isBuilding && !!endLocation;
  const canReportSpeedLimit = canReportCommunitySpeedLimit(speedLimitResolution);
  const showSpeedPanel =
    !isRoutePreviewOpen
    && (isNavigating || isDriving || speedKmh > 5 || speedLimit !== null || canReportSpeedLimit);
  const showSideControls = !isRoutePreviewOpen && !isBuilding;
  const sideControlsBottom = insets.bottom + 16;
  const isDropRouteActive = !!dropNavigationTargetId;

  // ─────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────

  return (
    <>
      <StatusBar translucent backgroundColor="transparent" barStyle={isDark ? 'light-content' : 'dark-content'} />
      <GeoDropClaimedModal
        visible={!!claimedDropReward}
        reward={claimedDropReward}
        onClose={dismissClaimedDropReward}
      />
      <NavStartHudBar visible={navHudVisible} onDone={() => setNavHudVisible(false)} />
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* Baner nad mapą (layout kolumnowy — nie zasłania wyszukiwania) */}
        <View style={{ paddingTop: insets.top, backgroundColor: theme.bg }}>
          <AdSlot placement="map_banner" variant="banner" />
        </View>

        <View style={{ flex: 1, minHeight: 0, position: 'relative' }}>

        <MapScreenHud
          section="top"
          theme={theme}
          styles={styles}
          gpsAcquiring={gpsAcquiring}
          hasUserLocation={!!userLocation}
          isNavigating={isNavigating}
          timerRunning={timerRunning}
          timerRouteName={timerRouteName}
          formatElapsed={formatElapsed}
          elapsedSec={elapsedSec}
          showSpeedPanel={showSpeedPanel}
          isBuilding={isBuilding}
          showSideControls={showSideControls}
          sideControlsBottom={sideControlsBottom}
          effectiveSpeedLimit={effectiveSpeedLimit}
          speedLimitTolerance={SPEED_LIMIT_TOLERANCE}
          liveDistanceKm={liveDistanceKm}
          isTripActiveMap={isTripActiveMap}
          onExportNavTrace={exportNavDriveTrace}
          onHudBottomLayout={ignoreHudLayout}
          isDriving={isDriving}
          onToggleDriving={handleToggleDrivingMode}
          onOpenSearch={() => { setSearchModalVisible(true); setMapFabModalVisible(false); }}
          isSharing={isSharing}
          onToggleSharing={handleToggleSharing}
          onCenterOnUser={handleCenterOnUser}
          connected={connected}
          onOpenFabModal={() => setMapFabModalVisible(true)}
          onOpenReport={() => setReportVisible(true)}
          upcomingWarning={upcomingWarning}
          onOpenUpcomingWarning={() => {
            if (upcomingWarning) setSelectedWarning(upcomingWarning.warning);
          }}
        />

        {/* ── Route endpoint renderers ─────────────────────── */}
        {pendingRouteRef.current && !isNavigating && (
          <>
            <RouteEndpointRenderer
              type="start"
              label={startLocation?.name ?? 'Start'}
              onCapture={uri => setRouteEndpointImages(prev => ({ ...prev, start: uri }))}
            />
            <RouteEndpointRenderer
              type="end"
              label={endLocation?.name ?? 'Koniec'}
              onCapture={uri => setRouteEndpointImages(prev => ({ ...prev, end: uri }))}
            />
          </>
        )}

        {/* ── Off-screen renderers ─────────────────────────── */}
        {userLocation && isMapFocused && (
          <CarMarkerRenderer
            avatarUrl={myAvatarUrl}
            username={myUsername}
            onCapture={setCarMarkerImage}
          />
        )}

        {userLocation && isMapFocused && (
          <ArrowMarkerRenderer onCapture={setArrowMarkerImage} />
        )}

        {isBuilding && pins.map((pin, index) => (
          <RoutePinRenderer
            key={`pinrender_${pin.id}_${index}_${pins.length}`}
            index={index}
            total={pins.length}
            label={pin.label}
            onCapture={uri => setPinImages(prev => ({ ...prev, [pin.id]: uri }))}
          />
        ))}

        {/* ── Baner tworzenia trasy ────────────────────────── */}
        {isBuilding && (
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
            backgroundColor: '#e33835',
            paddingTop:    12,
            paddingBottom: 14, paddingHorizontal: 16,
            flexDirection: 'row', alignItems: 'center', gap: 10,
            shadowColor: '#e33835', shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.6, shadowRadius: 14, elevation: 14,
          }}>
            <MaterialCommunityIcons name="map-marker-path" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', letterSpacing: 2, fontWeight: '700' }}>
                TWORZENIE TRASY
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff90', marginTop: 3 }}>
                {pins.length === 0
                  ? 'Dotknij mapę aby dodać punkt startowy'
                  : pins.length === 1
                  ? 'Dodaj kolejny punkt lub cel trasy'
                  : `${pins.length} pkt · ${totalDistance(bannerDistPoints).toFixed(1)} km · dotknij pin aby usunąć`
                }
              </Text>
            </View>
            <View style={{
              backgroundColor: '#ffffff25', borderRadius: 20,
              paddingHorizontal: 12, paddingVertical: 5, minWidth: 32, alignItems: 'center',
            }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#fff', fontWeight: '900' }}>
                {pins.length}
              </Text>
            </View>
            <TouchableOpacity onPress={cancelBuilding} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={24} color="#ffffff90" />
            </TouchableOpacity>
          </View>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/* MAPA                                              */}
        {/* ══════════════════════════════════════════════════ */}
        <View
          style={{ flex: 1 }}
          collapsable={false}
          onLayout={(event) => setMapViewHeight(event.nativeEvent.layout.height)}
        >
        <MapCanvas
          ref={mapRef}
          styleURL={mapStyle}
          onPress={(e: any) => {
            if (!isBuilding) return;
            const [longitude, latitude] = e.geometry.coordinates;
            addPin(latitude, longitude);
          }}
          onLongPress={(e: any) => {
            const coords = e?.geometry?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) return;
            const [longitude, latitude] = coords;
            if (fuelAddMode && !isBuilding) {
              setAddFuelStationCoords({ latitude, longitude });
              setAddFuelStationVisible(true);
              return;
            }
            if (isBuilding || cameraPickMode || isDriving || isNavigating) return;
            handleManualTargetPick(latitude, longitude);
          }}
          onMapIdle={(e: any) => {
            const z = e?.properties?.zoomLevel ?? e?.properties?.zoom;
            const zoom = Number.isFinite(z) ? Number(z) : 15;
            setCurrentZoom(zoom);
            setFleetMapIdleNonce((n) => n + 1);
          }}
          onDidFinishLoadingStyle={() => {
            setMapStyleEpoch((n) => n + 1);
          }}
          onCameraChanged={(e: any) => {
            const z = e?.properties?.zoomLevel ?? e?.properties?.zoom;
            const zoomLive = Number.isFinite(z) ? Number(z) : null;
            if (MAP_RENDER_DEBUG) {
              const now = Date.now();
              if (now - lastCameraChangeLogAtRef.current >= 250) {
                lastCameraChangeLogAtRef.current = now;
                const center = e?.properties?.center;
                mapDbg('CAMERA_CHANGED', {
                  zoom: Number((e?.properties?.zoomLevel ?? 0).toFixed?.(2) ?? 0),
                  pitch: Number((e?.properties?.pitch ?? 0).toFixed?.(1) ?? 0),
                  heading: Number((e?.properties?.heading ?? 0).toFixed?.(1) ?? 0),
                  centerLat: Array.isArray(center) ? Number((center[1] ?? 0).toFixed?.(6) ?? 0) : null,
                  centerLng: Array.isArray(center) ? Number((center[0] ?? 0).toFixed?.(6) ?? 0) : null,
                  isGesture: Boolean(e?.properties?.isUserInteraction || e?.gestures?.isGestureActive),
                });
              }
            }
            if (cameraPickMode && e?.properties?.center && Array.isArray(e.properties.center)) {
              const [lng, lat] = e.properties.center;
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                pickCenterRef.current = { lat, lng };
              }
            }
            const gestureActive = Boolean(e?.gestures?.isGestureActive);
            const tripActive = isDrivingRef.current || isNavigatingRef.current;
            const pitchRaw = e?.properties?.pitch;
            const pitchLive = Number.isFinite(pitchRaw) ? Number(pitchRaw) : undefined;
            if (tripActive && gestureActive) {
              // 60fps follow aktualizuje kamerę co klatkę — nie filtruj programmatic guard
              // (inaczej pinch/pan nigdy nie włącza wolnej kamery).
              cameraV3.notifyUserMapInteraction(zoomLive ?? undefined);
              notifyUserMapInteraction(
                zoomLive ?? undefined,
                pitchLive,
              );
            } else if (
              gestureActive
              && (Platform.OS === 'ios' ? (e?.properties?.isUserInteraction !== false) : true)
            ) {
              markUserGesture();
            }
          }}
        >
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={cameraDefaultSettingsRef.current}
          />
          <VroomMapCameraFollower
            {...cameraV3.nativeFollower}
            markerVisible={isTripActive && (showSelf2DMarker || useVehicle3DMarker || showTripArrowUnderlay)}
          />
          <Mapbox.LocationPuck visible={false} />
          <MapTerrainLayers
            enabled={showTerrainLayers}
            showBuildings={showThreeDBuildings}
            isDark={isDark}
            minZoom={BUILDINGS_3D_MIN_ZOOM}
          />
          <MapVehicleModelsHost
            selfModelUrl={useNativeVehicleModel ? equippedMapVehicle?.assetUrl : null}
            styleEpoch={mapStyleEpoch}
          />
          <MapVividLayers enabled={showVividMapLayers} isDark={isDark} />

          {endLocation && !arrived && !claimedDropReward && !isDropRouteActive && (
            <Mapbox.MarkerView coordinate={[endLocation.longitude, endLocation.latitude]} anchor={{ x: 0.5, y: 1 }}>
              <View style={{
                backgroundColor: theme.surface, padding: 8, borderRadius: 12,
                borderWidth: 2, borderColor: theme.primary, alignItems: 'center',
                shadowColor: theme.primary, shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.6, shadowRadius: 6, elevation: 8,
              }}>
                <MaterialIcons name="flag" size={20} color="#e33835" />
              </View>
            </Mapbox.MarkerView>
          )}

          {startLocation && !isNavigating && !isBuilding && !claimedDropReward && !isDropRouteActive && (
            <Mapbox.MarkerView coordinate={[startLocation.longitude, startLocation.latitude]} anchor={{ x: 0.5, y: 1 }}>
              <View style={{
                backgroundColor: theme.surface, padding: 8, borderRadius: 12,
                borderWidth: 2, borderColor: theme.online, alignItems: 'center',
              }}>
                <MaterialIcons name="radio-button-on" size={18} color="#4de926" />
              </View>
            </Mapbox.MarkerView>
          )}

          {isBuilding && pins.map((pin, index) => (
            pinImages[pin.id] ? (
              <Mapbox.MarkerView
                key={`pin_${pin.id}`}
                coordinate={[pin.longitude, pin.latitude]}
                anchor={{ x: 0.5, y: 1 }}
              >
                <TouchableOpacity onPress={() => removePin(pin.id)} activeOpacity={0.8}>
                  <View style={{ width: 48, height: 48 }}>
                    <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: index === 0 ? '#4de92640' : index === pins.length - 1 ? '#e3383540' : '#ff922b40', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: index === 0 ? '#4de926' : index === pins.length - 1 ? '#e33835' : '#ff922b' }}>
                      <MaterialIcons name="place" size={20} color={index === 0 ? '#4de926' : index === pins.length - 1 ? '#e33835' : '#ff922b'} />
                    </View>
                  </View>
                </TouchableOpacity>
              </Mapbox.MarkerView>
            ) : (
              <Mapbox.MarkerView
                key={`pin_${pin.id}`}
                coordinate={[pin.longitude, pin.latitude]}
                anchor={{ x: 0.5, y: 1 }}
              >
                <TouchableOpacity onPress={() => removePin(pin.id)} activeOpacity={0.8}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: index === 0 ? '#4de926' : index === pins.length - 1 ? '#e33835' : '#ff922b', borderWidth: 2, borderColor: '#fff' }} />
                </TouchableOpacity>
              </Mapbox.MarkerView>
            )
          ))}

          <SpeedCameraMapLayers
            cameras={effectiveCameras}
            onSelectCamera={handleSelectCamera}
          />

          {(navV3Mode === 'freeDrive' || navV3Mode === 'navigation') ? (
            <GeoDropMapLayer
              key={gamificationDrops.map((d) => d.id).join('-') || 'no-drops'}
              drops={gamificationDrops}
              onSelectDrop={showDropPrompt}
            />
          ) : null}

          {effectiveFuelStations.map(station => (
            <FuelStationMarker
              key={`fuel_${station.id}`}
              station={station}
              preferredFuel={preferredFuel}
              compact={currentZoom < 15.2}
              onPress={() => { setSelectedFuelStation(station); setFuelStationModalVisible(true); }}
            />
          ))}

          {effectivePartnerPois.map(poi => (
            <PartnerPoiMarker
              key={`partner_${poi.id}`}
              poi={poi}
              compact={false}
              onPress={() => {
                router.push(`/partner/${poi.id}` as any);
              }}
            />
          ))}

          {officialMapMeets.map(meet => (
            <OfficialMeetMarker
              key={`official_meet_${meet.id}`}
              meet={meet}
              onPress={() => {
                setSelectedOfficialMeet(meet);
                setOfficialMeetModalVisible(true);
              }}
            />
          ))}

          {isBuilding ? (
            <MapBuilderRouteLayers
              displaySnappedRoute={displaySnappedRoute}
              pins={pins}
              isBuilding={isBuilding}
              snappedRoute={snappedRoute}
            />
          ) : null}

          <LiveFleetMapController
            store={liveMapStore}
            enabled={liveUsersEnabled}
            anchor={liveUsersAnchor}
            selfUserId={currentUserId}
            mapRef={mapRef}
            mapIdleNonce={fleetMapIdleNonce}
            onUserPress={handleLiveUserPress}
          />

          <MapActiveRouteLayers
            remainingRoutePoints={navigationUiReady && !arrived ? remainingRoutePoints : []}
            isNavigating={isNavigating}
            isDriving={isDriving}
          />

          {startLocation && !isNavigating && !claimedDropReward && !isDropRouteActive && routeEndpointImages.start && (
            <Mapbox.MarkerView coordinate={[startLocation.longitude, startLocation.latitude]} anchor={{ x: 0.5, y: 1 }}>
              <View style={{ width: 48, height: 48 }}>
                <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: '#4de92620', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#4de926' }}>
                  <MaterialIcons name="radio-button-on" size={20} color="#4de926" />
                </View>
              </View>
            </Mapbox.MarkerView>
          )}
          {endLocation && !arrived && !claimedDropReward && !isDropRouteActive && routeEndpointImages.end && (
            <Mapbox.MarkerView coordinate={[endLocation.longitude, endLocation.latitude]} anchor={{ x: 0.5, y: 1 }}>
              <View style={{ width: 48, height: 48 }}>
                <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: '#e3383520', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#e33835' }}>
                  <MaterialIcons name="flag" size={20} color="#e33835" />
                </View>
              </View>
            </Mapbox.MarkerView>
          )}

          <WarningMapLayers
            warnings={effectiveWarnings}
            onSelectWarning={setSelectedWarning}
          />

          <DriveMarkerLayer
            enabled={isTripActive}
            showVisual={showSelf2DMarker || showTripArrowUnderlay}
            marker={driveMarker}
            useNativeArrow={selfMarkerUsesArrow || showTripArrowUnderlay}
            imageUri={selfMarkerUsesArrow || showTripArrowUnderlay ? null : carMarkerImage}
            avatarUrl={selfMarkerUsesArrow || showTripArrowUnderlay ? null : myAvatarUrl}
            cursorSkin={cursorSkinOverlay}
          />
          <VehicleModelMarker
            enabled={useVehicle3DMarker}
            isTripActive={isTripActive}
            driveMarker={driveMarker}
            browseLat={markerLat}
            browseLng={markerLng}
            browseHeading={markerHdg}
            metadata={equippedMapVehicle?.metadata}
            modelReady={useNativeVehicleModel}
          />
          {!isTripActive
            && Number.isFinite(markerLat)
            && Number.isFinite(markerLng)
            && showSelf2DMarker && (
            <DrPositionMarker
              latitude={markerLat}
              longitude={markerLng}
              heading={markerHdg}
              avatarUrl={selfMarkerUsesArrow ? null : myAvatarUrl}
              imageUri={selfMarkerUsesArrow ? arrowMarkerImage : carMarkerImage}
              cursorSkin={cursorSkinOverlay}
            />
          )}
        </MapCanvas>
        <TripMapLabelGuard
          mapRef={mapRef}
          enabled={isTripActiveMap}
          styleEpoch={mapStyleEpoch}
        />
        </View>

        <CameraPickOverlay
          visible={cameraPickMode}
          onCancel={cancelCameraPick}
          onConfirm={() => void confirmCameraPick()}
        />

        <ManualTargetPickOverlay
          visible={manualTargetPickMode && !cameraPickMode}
          onCancel={cancelManualTargetPick}
        />

        {/* ── Panel nawigacji (góra) ───────────────────────── */}
        {isNavigating && (
          <View pointerEvents="box-none" style={styles.navigationPanelTop}>
            <HudPanelShell>
              {isOffroadRef.current ? (
                <View style={styles.instructionBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[hudStyles.maneuverBox, { borderColor: theme.warning + '55' }]}>
                      <MaterialCommunityIcons name="terrain" size={28} color={theme.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[hudStyles.label, { color: theme.warning, fontWeight: '700' }]}>
                        Tryb offroad
                      </Text>
                      <Text style={[hudStyles.instruction, { marginTop: 4 }]}>
                        Nawigacja w linii prostej
                      </Text>
                      {routeInfo && (
                        <Text style={[hudStyles.metaPrimary, { marginTop: 6 }]}>
                          {routeInfo.distance} km
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              ) : displayStepData ? (
                <View style={styles.instructionBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <View style={hudStyles.maneuverBox}>
                      <MaterialIcons
                        name={getManeuverIcon(displayStepData.maneuver) as any}
                        size={28}
                        color={theme.text}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={hudStyles.navDistance}>
                        {distToTurnM !== null
                          ? distToTurnM < 1000
                            ? `${Math.round(distToTurnM / 10) * 10} m`
                            : `${(distToTurnM / 1000).toFixed(1)} km`
                          : displayStepData.distance?.text}
                      </Text>
                      <Text style={[hudStyles.instruction, { marginTop: 4 }]} numberOfLines={2}>
                        {formatNavigationInstruction(displayStepData)}
                      </Text>
                    </View>
                  </View>

                  {activeSteps[announceStepIndex + 1] && (
                    <View style={hudStyles.thenRow}>
                      <MaterialIcons name="subdirectory-arrow-right" size={16} color={theme.textMuted} />
                      <Text style={hudStyles.thenText} numberOfLines={1}>
                        Potem: {formatNavigationInstruction(activeSteps[announceStepIndex + 1])}
                      </Text>
                    </View>
                  )}

                  <View style={hudStyles.metaRow}>
                    <Text style={hudStyles.meta}>
                      Krok {announceStepIndex + 1}/{activeSteps.length}
                    </Text>
                    {remainingDistKm !== null && (
                      <>
                        <View style={hudStyles.metaDot} />
                        <Text style={hudStyles.metaAccent}>
                          {remainingDistKm < 1
                            ? `${Math.round(remainingDistKm * 1000)} m do celu`
                            : `${remainingDistKm.toFixed(1)} km do celu`}
                        </Text>
                      </>
                    )}
                    {routeInfo && (
                      <>
                        <View style={hudStyles.metaDot} />
                        <Text style={hudStyles.metaPrimary}>
                          {formatDuration(remainingDurationMin ?? routeInfo.duration)}
                        </Text>
                        <View style={hudStyles.metaDot} />
                        <Text style={hudStyles.meta}>
                          Cel {new Date(Date.now() + (remainingDurationMin ?? routeInfo.duration ?? 0) * 60 * 1000).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              ) : (
                <View style={styles.instructionBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={hudStyles.maneuverBox}>
                      <ActivityIndicator size="small" color={theme.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[hudStyles.label, { fontWeight: '700', color: theme.text }]}>
                        Ładowanie manewrów…
                      </Text>
                      <Text style={[hudStyles.instruction, { marginTop: 4 }]}>
                        Trwa pobieranie szczegółów trasy
                      </Text>
                      {routeInfo && (
                        <Text style={[hudStyles.metaAccent, { marginTop: 6 }]}>
                          {routeInfo.distance} km
                          {routeInfo.duration ? ` · ${formatDuration(routeInfo.duration)}` : ''}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              )}
              <TouchableOpacity style={hudStyles.closeBtn} onPress={stopNavigation}>
                <MaterialIcons name="close" size={18} color={theme.textMuted} />
              </TouchableOpacity>
            </HudPanelShell>
          </View>
        )}

        {/* ── Off-route banner ─────────────────────────────── */}
        {isNavigating && offRoute && !isOffroadRef.current && (
          <View style={[styles.hudOffRouteBanner, { top: insets.top + 100 }]}>
            <MaterialIcons name="warning" size={22} color={theme.warning} />
            <Text style={styles.hudOffRouteText}>
              {(rerouteLoading || rerouteOrigin != null || reroutePendingRef.current)
                ? 'Przeliczam trasę…'
                : 'Poza trasą — ponawiam…'}
            </Text>
            {(rerouteLoading || rerouteOrigin != null || reroutePendingRef.current) && (
              <ActivityIndicator size="small" color={theme.warning} />
            )}
          </View>
        )}

        {/* ── Przycisk Zatwierdź Trasę ─────────────────────── */}
        {isBuilding && (
          <View style={{
            position: 'absolute',
            bottom: showSideControls ? sideControlsBottom : (insets.bottom + 20),
            left: 16,
            right: 16,
            zIndex: 100,
          }}>
            <TouchableOpacity
              style={{
                backgroundColor: theme.primary,
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 4,
                elevation: 6,
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
              }}
              onPress={() => {
                if (pins.length < 2) {
                  Toast.show({ type: 'info', text1: 'Wymagane min. 2 punkty trasy' });
                  return;
                }
                setSaveRouteVisible(true);
              }}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialIcons name="check" size={20} color="#fff" />
              )}
              <Text style={{ fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700', color: '#fff' }}>
                Zatwierdź trasę
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <MapScreenHud
          section="bottom"
          theme={theme}
          styles={styles}
          gpsAcquiring={gpsAcquiring}
          hasUserLocation={!!userLocation}
          isNavigating={isNavigating}
          timerRunning={timerRunning}
          timerRouteName={timerRouteName}
          formatElapsed={formatElapsed}
          elapsedSec={elapsedSec}
          showSpeedPanel={showSpeedPanel}
          isBuilding={isBuilding}
          showSideControls={showSideControls}
          sideControlsBottom={sideControlsBottom}
          effectiveSpeedLimit={effectiveSpeedLimit}
          speedLimitStatus={speedLimitResolution.status}
          canReportSpeedLimit={canReportSpeedLimit}
          onPressSpeedLimit={() => setSpeedLimitReportVisible(true)}
          speedLimitTolerance={SPEED_LIMIT_TOLERANCE}
          liveDistanceKm={liveDistanceKm}
          isTripActiveMap={isTripActiveMap}
          onExportNavTrace={exportNavDriveTrace}
          onHudBottomLayout={ignoreHudLayout}
          isDriving={isDriving}
          onToggleDriving={handleToggleDrivingMode}
          onOpenSearch={() => { setSearchModalVisible(true); setMapFabModalVisible(false); }}
          isSharing={isSharing}
          onToggleSharing={handleToggleSharing}
          onCenterOnUser={handleCenterOnUser}
          connected={connected}
          onOpenFabModal={() => setMapFabModalVisible(true)}
          onOpenReport={() => setReportVisible(true)}
          upcomingWarning={upcomingWarning}
          onOpenUpcomingWarning={() => {
            if (upcomingWarning) setSelectedWarning(upcomingWarning.warning);
          }}
        />

        <MapFabActionsModal
          visible={mapFabModalVisible}
          isSpeechEnabled={isSpeechEnabled}
          onClose={() => setMapFabModalVisible(false)}
          onRoute={() => setSearchModalVisible(true)}
          onCreateRoute={() => {
            startBuilding();
            Toast.show({
              type: 'info',
              text1: 'Tworzenie trasy',
              text2: 'Dotykaj mapę, aby dodać punkty.',
            });
          }}
          onFuel={() => {
            refetchFuelStations();
            const next = !fuelAddMode;
            setFuelAddMode(next);
            Toast.show({
              type: 'info',
              text1: next ? 'Tryb dodawania stacji' : 'Stacje paliw',
              text2: next
                ? 'Przytrzymaj mapę w miejscu stacji, aby dodać.'
                : 'Odświeżono na mapie',
            });
          }}
          onCenter={handleCenterOnUser}
          onManualPoint={() => {
            setManualTargetPickMode(true);
            Toast.show({ type: 'info', text1: 'Tryb punktu ręcznego', text2: 'Przytrzymaj mapę, aby ustawić cel.' });
          }}
          onToggleSpeech={() => { void navigationVoice.toggleMaster(); }}
          onReport={() => setReportVisible(true)}
          onSpot={() => router.push('/(tabs)/spotmap' as any)}
          onCamera={() => setAddCameraVisible(true)}
          onLayers={() => setSettingsVisible(true)}
        />

        {/* ── Search bar ───────────────────────────────────── */}
        {!isNavigating && !isBuilding && (
          <TouchableOpacity
            style={styles.topSearchButton}
            onPress={() => setSearchModalVisible(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="search" size={18} color="#e33835ce" />
            <Text style={styles.topSearchButtonText}>
              {startLocation && endLocation
                ? `${startLocation.name ?? 'Start'} → ${endLocation.name ?? 'Cel'}`
                : 'Wyszukaj adres lub miejsce...'
              }
            </Text>
            {(startLocation || endLocation) ? (
              <TouchableOpacity onPress={handleReset} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={18} color="#ffffff35" />
              </TouchableOpacity>
            ) : (
              <MaterialIcons name="tune" size={18} color="#ffffff35" />
            )}
          </TouchableOpacity>
        )}

        {/* ── Bottom sheet (podgląd trasy) ─────────────────── */}
        {!isNavigating && !isBuilding && endLocation && (
          <View style={styles.bottomSheet}>
            <View style={styles.expandHandle} />
            <View style={styles.infoPreview}>

              {/* ── Offroad badge ────────────────────────────── */}
              {isOffroadRoute && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: '#ff922b18', borderRadius: 8,
                  borderWidth: 1, borderColor: '#ff922b40',
                  paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12,
                }}>
                  <MaterialCommunityIcons name="terrain" size={14} color="#ff922b" />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ff922b', letterSpacing: 2 }}>
                    TRASA OFFROAD — LINIA PROSTA
                  </Text>
                </View>
              )}

              <View style={styles.routeInfoCard}>
                <View style={styles.routeInfoRow}>
                  <View style={styles.routeInfoLocation}>
                    <View style={[styles.routeInfoDot, { backgroundColor: '#4de926' }]} />
                    <Text style={styles.routeInfoLocationName} numberOfLines={1}>
                      {startLocation?.name ?? 'Punkt startowy'}
                    </Text>
                  </View>
                </View>
                <View style={styles.routeInfoDivider} />
                <View style={styles.routeInfoRow}>
                  <View style={styles.routeInfoLocation}>
                    <View style={[styles.routeInfoDot, { backgroundColor: '#e33835ce' }]} />
                    <Text style={styles.routeInfoLocationName} numberOfLines={1}>
                      {endLocation.name ?? 'Cel'}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.routeStatsRow}>
                <View style={styles.statItem}>
                  <View style={styles.statIcon}>
                    <MaterialIcons name="straighten" size={16} color="#e33835ce" />
                  </View>
                  <View>
                    <Text style={styles.statLabel}>DYSTANS</Text>
                    {!isOffroadRoute && previewLoading
                      ? <ActivityIndicator size="small" color="#e33835ce" style={{ marginTop: 2 }} />
                      : routeInfo
                        ? <Text style={styles.statValue}>{routeInfo.distance} km</Text>
                        : <Text style={[styles.statValue, { color: '#7f7f7f' }]}>--</Text>
                    }
                  </View>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <View style={styles.statIcon}>
                    <MaterialIcons name="schedule" size={16} color="#e33835ce" />
                  </View>
                  <View>
                    <Text style={styles.statLabel}>CZAS</Text>
                    {!isOffroadRoute && previewLoading
                      ? <ActivityIndicator size="small" color="#e33835ce" style={{ marginTop: 2 }} />
                      : isOffroadRoute
                        ? <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#ff922b', fontWeight: '700' }}>—</Text>
                        : routeInfo
                          ? <Text style={styles.statValue}>{formatDuration(routeInfo.duration)}</Text>
                          : <Text style={[styles.statValue, { color: '#7f7f7f' }]}>--</Text>
                    }
                  </View>
                </View>
              </View>

              {/* ── Alternatywne trasy — tylko dla tras drogowych ── */}
              {!isOffroadRoute && alternativeRoutes.length > 1 && (
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                  {alternativeRoutes.map((r, i) => (
                    <TouchableOpacity
                      key={i}
                      onPress={() => setSelectedRouteIndex(i)}
                      style={{
                        flex: 1, padding: 10, borderRadius: 12, alignItems: 'center',
                        backgroundColor: selectedRouteIndex === i ? '#e3383520' : (isDark ? '#ffffff08' : '#00000008'),
                        borderWidth: 1.5,
                        borderColor: selectedRouteIndex === i ? '#e33835' : (isDark ? '#ffffff15' : '#00000015'),
                      }}
                    >
                      <Text style={{ color: selectedRouteIndex === i ? '#e33835' : theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>
                        TRASA {i + 1}
                      </Text>
                      <Text style={{ color: selectedRouteIndex === i ? '#fff' : theme.textMuted, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700', marginTop: 3 }}>
                        {r.durationText}
                      </Text>
                      <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, marginTop: 2 }}>
                        {r.distanceText}
                      </Text>
                      {i === 0 && (
                        <View style={{ marginTop: 4, backgroundColor: '#e3383520', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 7 }}>NAJSZYBSZA</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.bottomSheetButtons}>
                <TouchableOpacity
                  style={[styles.navigateButton, ((!isOffroadRoute && previewLoading) || (!routeInfo && !isOffroadRoute)) && { opacity: 0.5 }]}
                  onPress={startNavigation}
                  activeOpacity={0.85}
                  disabled={(!isOffroadRoute && previewLoading) || (!routeInfo && !isOffroadRoute)}
                >
                  {!isOffroadRoute && previewLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <MaterialIcons name="navigation" size={18} color="#fff" />
                  }
                  <Text style={styles.navigateButtonText}>
                    {!isOffroadRoute && previewLoading ? 'OBLICZAM...' : (
                      pendingRouteRef.current && !approachingRouteStartRef.current && userLocation && startLocation && (haversineKm(userLocation.latitude, userLocation.longitude, startLocation.latitude, startLocation.longitude) * 1000 <= 100)
                        ? 'RUSZAJ'
                        : 'NAWIGUJ'
                    )}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editButton} onPress={() => setSearchModalVisible(true)} activeOpacity={0.8}>
                  <MaterialIcons name="edit" size={18} color="#e33835ce" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.resetButtonSmall} onPress={handleReset} activeOpacity={0.8}>
                  <MaterialIcons name="close" size={18} color={isDark ? '#f73f3fb4' : '#000'} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        </View>

        {/* ── Modale ───────────────────────────────────────── */}
        {navV3Mode === 'freeDrive' && availableDropPrompt && !claimedDropReward && !isRoutePreviewOpen ? (
          <GeoDropAvailableSheet
            drop={availableDropPrompt}
            bottomInset={insets.bottom + 56}
            onNavigate={() => handleNavigateToDrop(availableDropPrompt)}
            onLater={() => snoozeDropPrompt(availableDropPrompt.id)}
            onHide={() => hideDropPrompt(availableDropPrompt.id)}
          />
        ) : null}

        <MapModalsHost
          router={router}
          isPremium={isPremium}
          userLocation={userLocation}
          nearbyUsers={nearbyUsers}
          homeLocation={homeLocation}
          currentUserId={currentUserId}
          mapType={mapType}
          pins={pins}
          snappedRoute={snappedRoute}
          saving={saving}
          snapping={snapping}
          tripStats={tripStats}
          selectedUser={selectedUser}
          selectedWarning={selectedWarning}
          selectedCamera={selectedCamera}
          selectedFuelStation={selectedFuelStation}
          selectedPartnerPoi={selectedPartnerPoi}
          selectedOfficialMeet={selectedOfficialMeet}
          addFuelStationCoords={addFuelStationCoords}
          pendingAddCameraParams={pendingAddCameraParams}
          pickCenterRef={pickCenterRef}
          leaderboardRouteId={leaderboardRouteId}
          leaderboardRouteName={leaderboardRouteName}
          leaderboardData={leaderboardData}
          leaderboardRunsData={leaderboardRunsData}
          leaderboardLoading={leaderboardLoading}
          myFinishedTime={myFinishedTime}
          searchModalVisible={searchModalVisible}
          userInfoVisible={userInfoVisible}
          settingsVisible={settingsVisible}
          reportVisible={reportVisible}
          saveRouteVisible={saveRouteVisible}
          tripStatsVisible={tripStatsVisible}
          addCameraVisible={addCameraVisible}
          cameraDetailVisible={cameraDetailVisible}
          fuelStationModalVisible={fuelStationModalVisible}
          partnerPoiModalVisible={partnerPoiModalVisible}
          officialMeetModalVisible={officialMeetModalVisible}
          leaderboardVisible={leaderboardVisible}
          addFuelStationVisible={addFuelStationVisible}
          isSubmittingWarning={isSubmittingWarning}
          onCloseSearch={() => setSearchModalVisible(false)}
          onSelectStart={handleSelectStart}
          onSelectEnd={handleSelectEnd}
          onCloseUserInfo={() => setUserInfoVisible(false)}
          onNavigateToUser={handleNavigateToUser}
          onViewProfile={handleViewProfile}
          onMessageUser={handleMessageUser}
          onChangeMapType={handleChangeMapType}
          onCloseSettings={() => setSettingsVisible(false)}
          onCloseReport={() => setReportVisible(false)}
          onReport={handleReport}
          onCloseWarning={() => setSelectedWarning(null)}
          onConfirmWarning={confirmWarning}
          onCancelWarning={cancelWarning}
          onDismissWarning={dismissWarning}
          onCancelSaveRoute={() => setSaveRouteVisible(false)}
          onSnapToRoad={() => snapToRoad(pins)}
          onSaveRoute={async (name, desc, isPublic, isOffroad) => {
            const result = await saveRoute(name, desc, isPublic, isOffroad);
            setSaveRouteVisible(false);
            if (result) Toast.show({ type: 'success', text1: '✅ TRASA ZAPISANA', text2: name });
            else Toast.show({ type: 'error', text1: 'Błąd zapisu trasy' });
          }}
          totalDistance={totalDistance}
          onCloseLeaderboard={() => { setLeaderboardVisible(false); setMyFinishedTime(null); }}
          onCloseTripStats={() => { setTripStatsVisible(false); clearStats(); }}
          onCloseAddCamera={() => setAddCameraVisible(false)}
          onConfirmAddCamera={handleAddCamera}
          onPickCameraOnMap={(params) => {
            setPendingAddCameraParams(params);
            setCameraPickMode(true);
          }}
          onCloseCameraDetail={() => setCameraDetailVisible(false)}
          onConfirmCamera={confirmCamera}
          onDeleteCamera={deleteCamera}
          onCloseAddFuel={() => {
            setAddFuelStationVisible(false);
            setAddFuelStationCoords(null);
          }}
          onCreateFuelStation={createFuelStation}
          onCloseFuelStation={() => setFuelStationModalVisible(false)}
          onNavigateToFuel={(lat, lng, name) => {
            if (!userLocation || !Number.isFinite(userLocation.latitude) || !Number.isFinite(userLocation.longitude)) {
              Toast.show({ type: 'error', text1: 'GPS', text2: 'Poczekaj na lokalizację, potem ponów Nawiguj.' });
              return;
            }
            setStartLocation({ ...userLocation, name: 'Moja pozycja' });
            setEndLocation({ latitude: lat, longitude: lng, name: name || 'Stacja paliw' });
            setFuelStationModalVisible(false);
            Toast.show({ type: 'success', text1: '📍 CEL USTAWIONY', text2: name || 'Stacja paliw' });
          }}
          onFuelPricesUpdated={refetchFuelStations}
          updateFuelPrices={updateFuelPrices}
          onClosePartnerPoi={() => setPartnerPoiModalVisible(false)}
          onNavigateToPartner={(lat, lng, name) => {
            if (!userLocation || !Number.isFinite(userLocation.latitude) || !Number.isFinite(userLocation.longitude)) {
              Toast.show({ type: 'error', text1: 'GPS', text2: 'Poczekaj na lokalizację, potem ponów Nawiguj.' });
              return;
            }
            setStartLocation({ ...userLocation, name: 'Moja pozycja' });
            setEndLocation({ latitude: lat, longitude: lng, name: name || 'Partner' });
            setPartnerPoiModalVisible(false);
            Toast.show({ type: 'success', text1: '📍 CEL USTAWIONY', text2: name || 'Partner' });
          }}
          onCloseOfficialMeet={() => setOfficialMeetModalVisible(false)}
          onOpenOfficialMeet={(meetId) => {
            setOfficialMeetModalVisible(false);
            router.push({ pathname: '/Community/meets/meet', params: { id: String(meetId) } } as any);
          }}
          onNavigateToOfficialMeet={(lat, lng, name) => {
            if (!userLocation || !Number.isFinite(userLocation.latitude) || !Number.isFinite(userLocation.longitude)) {
              Toast.show({ type: 'error', text1: 'GPS', text2: 'Poczekaj na lokalizację, potem ponów Nawiguj.' });
              return;
            }
            setStartLocation({ ...userLocation, name: 'Moja pozycja' });
            setEndLocation({ latitude: lat, longitude: lng, name: name || 'Wydarzenie' });
            setOfficialMeetModalVisible(false);
            Toast.show({ type: 'success', text1: '📍 CEL USTAWIONY', text2: name || 'Wydarzenie' });
          }}
        />

        <SpeedLimitReportModal
          visible={speedLimitReportVisible}
          resolution={speedLimitResolution}
          onClose={() => setSpeedLimitReportVisible(false)}
          onSubmit={handleSubmitSpeedLimit}
        />

        
      </View>
    </>
  );
}

export default function MapScreen() {
  const { settings } = useSettings();
  const { blocked, message, checking, refresh } = useMapMaintenanceGate(!!settings.isAdmin);
  const innerMountedRef = useRef(false);

  if (!settings.isAdmin && blocked) {
    return <MapMaintenanceScreen message={message} onCleared={refresh} />;
  }

  if (!settings.isAdmin && checking && !innerMountedRef.current) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e33835" />
      </View>
    );
  }

  innerMountedRef.current = true;
  return <MapScreenInner />;
}
