import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Mapbox from '@rnmapbox/maps';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, {
  useCallback,
  useEffect,
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
import { API_URL } from '../../constants/mapConfig';
import { useTheme } from '../../contexts/ThemeContext';
import { useSubscriptionStatus } from '../../hooks/useSubscriptionStatus';
import { notifyBackgroundPremiumRequired } from '../../lib/backgroundPremiumGate';
import { useChat } from '../../hooks/useChats';
import { DriveMarkerLayer } from '../../components/map/DriveMarkerLayer';
import { DrPositionMarker } from '../../components/map/DrPositionMarker';
import { SmoothDrPositionMarker } from '../../components/map/SmoothDrPositionMarker';
import {
  SpeedometerHUD,
  SpeedLimitBadge,
  SpeedValueText,
  emitSpeedometerKmh,
  normalizeHudSpeedKmh,
  resetSpeedometerEmitterThrottle,
} from '../../components/map/SpeedometerHUD';
import { createTripCameraScheduler } from '../../lib/driveUi/driveUiScheduler';
import { MapTerrainLayers } from '../../components/map/MapTerrainLayers';
import { MapVividLayers } from '../../components/map/MapVividLayers';
import { MapCanvas } from '../../components/map/MapCanvas';
import { MapActiveRouteLayers, MapBuilderRouteLayers } from '../../components/map/MapRouteLayers';
import { makeMapStyles } from '../../styles/mapstyle';
import { ensureMapboxToken } from '../../lib/mapboxInit';
import {
  feedSmoothPositionTarget,
  clearSmoothPositionFeed,
  setMarkerStaleRawToSnapM,
} from '../../lib/mapPosition/smoothPositionFeed';
import { useSmoothMapPosition } from '../../hooks/useSmoothMapPosition';
import { useMapTilePrefetch } from '../../hooks/useMapTilePrefetch';
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
import { visionEvent, visionTickFromV2 } from '../../lib/driveVisionTrace';
import { getGpsTickId } from '../../lib/gpsTickTrace';
import { clearTelemetry, logTelemetry } from '../../lib/telemetryLogger';
import {
  buildRerouteOrigin,
  quantizeHeading,
  resolveRerouteTravelHeadingDeg,
} from '../../lib/navigation/reroute';

ensureMapboxToken();

import {
  resolveMapStyle,
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
  sustainedTripSpeedFromSamples,
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
  flushTracePendingKmToStorage,
  setDrivingFlag,
  setNavigatingFlag,
  useBackgroundTracking,
} from '../../hooks/useBackgroundTracking';
import { useSettings } from '../../hooks/useSettings';
import { useMapMaintenanceGate } from '../../hooks/useMapMaintenanceGate';
import { MapMaintenanceScreen } from '../../components/maintenance/MapMaintenanceScreen';
import { useCameraAnimation, PROGRAMMATIC_CAMERA_GESTURE_GUARD_MS } from '../../hooks/useCameraAnimation';
import { useDriveCore } from '../../hooks/useDriveCore';
import { useDriveMarker, type DriveMarkerCameraSink } from '../../hooks/useDriveMarker';
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
import { resetMarkerFeedState } from '../../lib/driveCore/markerFeedV2';
import { localRoadGeometryMirror } from '../../lib/driveCore/localRoadSnap';
import {
  getRoadMarkerSegmentIndex,
  resetRoadMarkerPoseState,
  resolveRoadMarkerPose,
} from '../../lib/driveCore/roadMarkerPose';
import { useDeadReckoning } from '../../hooks/useDeadReckoning';
import { useDemoUsers } from '../../hooks/useDemoUsers';
import { useDrivingMapMatch } from '../../hooks/useDrivingMapMatch';
import { useDrivingSnap, validateGeometryAgainstRaw } from '../../hooks/useDrivingSnap';
import { useDriveTrackingPipeline } from '../../hooks/useDriveTrackingPipeline';
import {
  useGoogleDirections,
  useGoogleDirectionsAlternatives,
  type DirectionsResult,
} from '../../hooks/useGoogleDirections';
import {
  clusterWarnings,
  getWarningColor,
  getWarningIcon,
  getWarningLabel,
  LiveWarning,
  useLiveMap,
} from '../../hooks/useLiveMap';
import { useNavigationNotification } from '../../hooks/useNavigationNotification';
import { useNavigationPoints } from '../../hooks/useNavigationPoints';
import { useNavigationSimulator } from '../../hooks/useNavigationSimulator';
import { useRouteBuilder } from '../../hooks/useRouteBuilder';
import { useRouteLeaderboard } from '../../hooks/useRouteLeaderboard';
import { useRouteTimer } from '../../hooks/useRouteTimer';
import { useSnapCameras } from '../../hooks/useSnapCameras';
import { useSpeedCameras } from '../../hooks/useSpeedCamera';
import { useSpeedLimit } from '../../hooks/useSpeedLimit';
import { useTripStats } from '../../hooks/useTripStats';
import { useAutoNavigationBridge } from '../../hooks/useAutoNavigationBridge';
import { calculateDistance } from '../../scripts/distance';
import {
  bearingBetween,
  alignBearingToReference,
  buildNavigationSpeech,
  cleanInstruction,
  detectCurrentStep,
  getNavigationSpeechPhase,
  resolveAnnouncementTarget,
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
  densifyPolyline,
} from '../../scripts/navigationUtils';
// testd sdsd

import { RouteEndpointRenderer } from '@/components/markers/RouteEndpointRenderer';
import { ArrowMarkerRenderer } from '../../components/markers/ArrowMarkerRenderer';
import { CarMarkerRenderer } from '../../components/markers/CarMarkerRenderer';
import { MarkerRenderer } from '../../components/markers/MarkerRenderer';
import { RoutePinRenderer } from '../../components/markers/RoutePinRenderer';
import { SpeedCameraMarker } from '../../components/markers/SpeedCameraMarker';
import { SpeedCameraRenderer } from '../../components/markers/SpeedCameraRenderer';
import { LiveUserMarker } from '../../components/markers/LiveUserMarker';
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
import { AdSlot }               from '../../components/ads/AdSlot';
import { useFuelStations }      from '../../hooks/useFuelStations';
import { FuelStationMarker }    from '../../components/markers/FuelStationMarker';
import { PartnerPoiMarker }     from '../../components/markers/PartnerPoiMarker';
import { PartnerPoiModal }      from '../../components/modals/PartnerPoiModal';
import { usePartnerPois, type PartnerPoi } from '../../hooks/usePartnerPois';
import { useCursorSkin }        from '../../hooks/useCursorSkin';
import { FuelStationModal }     from '../../components/modals/FuelStationModal';
import { AddFuelStationModal }  from '../../components/modals/AddFuelStationModal';

// ─────────────────────────────────────────────────────────────────────────────
// v10 CLIENT-FIRST — jeden pipeline ruchu (bez konfliktow writerow):
//   GPS tick -> snap -> applyTripPosition -> feedSmoothPositionTarget (1x)
//   -> worklet 60 FPS LERP -> marker SharedValue
//   Kamera: applyTripPosition (GPS) -> useCameraAnimation RAF 60 FPS
// ZAKAZ: DR.onFrame feed, RAF glide, setTimeout sub-kotwice, kamera z worklet display.
const V10_CLIENT_FIRST = true;
/** Drive Core V2 — motion/snap/marker/API budget (`lib/driveCore`). */
const DRIVE_CORE_V2 = true;
/** Legacy — raw marker tylko gdy brak geometrii drogi (patrz hasRoadGeometry w drive tick). */
const FREE_DRIVE_RAW_MARKER_KMH = 40;
/** 2D Kalman legacy — wyłączone gdy Drive Core V2. */
const USE_DRIVE_TRACKING_PIPELINE = !DRIVE_CORE_V2;

// v10: zwiekszony z 40 do 100 — w polaczeniu z NAV_ROUTE_SNAP_M=80 marker
// zostaje na trasie az do realnego zjazdu w bok. Mniej falszywych reroute'ow.
const REROUTE_THRESHOLD_M = 80;
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

// Live location sharing — interval + distance/time gate
const SEND_INTERVAL_MS    = 15_000; // poll period (ms)
const SEND_MIN_DIST_M     = 40;     // min movement before sending (saves bandwidth while stationary)
const SEND_MAX_ELAPSED_MS = 60_000; // heartbeat: force-send after this long even without movement
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

function roadPolylineShiftM(
  prev: { latitude: number; longitude: number }[],
  next: { latitude: number; longitude: number }[],
): number {
  if (prev.length < 2 || next.length < 2) return Infinity;
  const startM = haversineKm(
    prev[0].latitude,
    prev[0].longitude,
    next[0].latitude,
    next[0].longitude,
  ) * 1000;
  const endM = haversineKm(
    prev[prev.length - 1].latitude,
    prev[prev.length - 1].longitude,
    next[next.length - 1].latitude,
    next[next.length - 1].longitude,
  ) * 1000;
  const pi = Math.floor(prev.length / 2);
  const qi = Math.floor(next.length / 2);
  const midM = haversineKm(
    prev[pi].latitude,
    prev[pi].longitude,
    next[qi].latitude,
    next[qi].longitude,
  ) * 1000;
  return Math.max(startM, endM, midM);
}
/** Min. odstęp między lokalnym resolve (SQLite / tile / trasa) bez Mapbox. */
const CLIENT_FIRST_RESOLVE_MIN_MS = 4_000;
const NAV_SESSION_KEY     = 'nav_session_v1';
const NAV_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

// updateCameras + updateSpeedLimit — skip if user hasn't moved this far
// (each hook also has its own internal throttle; this gate prevents even the
//  cheap recalc/sort from running on every sub-second GPS tick)
const CAMERA_SPEED_LIMIT_GATE_M = 30; // meters
const CAMERA_SPEED_LIMIT_GATE_NAV_M = 10; // meters in driving/navigation

// Reroute cooldown — avoids hammering Directions API while continuously off-route
const REROUTE_COOLDOWN_MS = 45_000; // min. odstęp między requestami Directions przy reroute
const REROUTE_MIN_MOVED_M = 220;    // wcześniejszy reroute po zejściu z trasy (bez czekania 700 m)
/** ~3× NAV_PROGRESS_UI_MS — szybsze potwierdzenie zjazdu z trasy. */
const OFF_ROUTE_CONFIRM_STREAK = 3;
// v10: route polyline snap radius zwiekszony z 48 do 80 — w nawigacji ufamy
// route polyline jako PRIMARY snap source (L1 w client snap hierarchy). Wieksza
// tolerancja = marker zawsze plynnie na trasie nawet gdy GPS dryfuje +-30m.
const NAV_ROUTE_SNAP_M = 80;
const REROUTE_PENDING_TIMEOUT_MS = 18_000;
const REROUTE_RETRY_AFTER_FAIL_MS = 20_000;
const REROUTE_GRACE_AFTER_APPLY_MS = 12_000;
const REROUTE_THRESHOLD_RECOVERY_M = 60;

/**
 * Smoothly blends current heading toward target heading using a low-pass filter.
 * Handles the 0°/360° wraparound correctly and clamps the per-tick change to
 * maxChangeDeg to prevent large jumps when the snap point shifts abruptly.
 * @param current   Current heading in degrees [0, 360)
 * @param target    Desired heading in degrees [0, 360)
 * @param alpha     Smoothing factor [0, 1] — higher = faster tracking
 * @param maxChange Maximum allowed change per call in degrees
 * @returns New smoothed heading in degrees [0, 360)
 */
function smoothHeading(
  current:   number,
  target:    number,
  alpha:     number,
  maxChange: number,
): number {
  const diff     = ((target - current + 540) % 360) - 180;
  const clamped  = Math.sign(diff) * Math.min(Math.abs(diff), maxChange);
  const smoothed = current + clamped * alpha;
  return ((smoothed % 360) + 360) % 360;
}

/** Poniżej tej prędkości dopuszczalny kompas urządzenia (loc.coords.heading). */
const TRIP_COMPASS_HEADING_MAX_KMH = TRAVEL_VECTOR_LOCK_SPEED_KMH;

/** Heading zgodny z drogą (segment polyline), nie surowy GPS pod kątem. */
function resolveDrivingHeading(
  appliedSnap: { snapped: boolean; targetHeading: number; latitude: number; longitude: number },
  lastHeading: number,
  lastDrivingPos: { lat: number; lng: number } | null,
  gpsHeading: number | null | undefined,
  kmh: number,
  _isNavigating: boolean,
): number | null {
  const useCompass = kmh < TRIP_COMPASS_HEADING_MAX_KMH;
  const compassHdg = useCompass && gpsHeading != null && Number.isFinite(gpsHeading) && Number(gpsHeading) >= 0
    ? Number(gpsHeading)
    : null;

  let moveBearing: number | null = null;
  if (lastDrivingPos) {
    const distM = haversineKm(
      lastDrivingPos.lat, lastDrivingPos.lng,
      appliedSnap.latitude, appliedSnap.longitude,
    ) * 1000;
    if (distM >= 2.5) {
      moveBearing = bearingBetween(
        lastDrivingPos.lat, lastDrivingPos.lng,
        appliedSnap.latitude, appliedSnap.longitude,
      );
    }
  }

  const travelRef = moveBearing ?? lastHeading;

  if (kmh >= TRIP_COMPASS_HEADING_MAX_KMH) {
    if (moveBearing != null) {
      const flip = Math.abs(((moveBearing - lastHeading + 540) % 360) - 180);
      if (flip >= 92) return lastHeading;
      return smoothHeading(lastHeading, moveBearing, 0.88, 34);
    }
    return null;
  }

  if (moveBearing != null && kmh >= 7) {
    if (appliedSnap.snapped && Number.isFinite(appliedSnap.targetHeading)) {
      let roadHeading = alignBearingToReference(appliedSnap.targetHeading, moveBearing);
      const roadDiff = Math.abs(((roadHeading - moveBearing + 540) % 360) - 180);
      if (roadDiff <= 26) {
        roadHeading = smoothHeading(roadHeading, moveBearing, 0.5, 16);
        return smoothHeading(lastHeading, roadHeading, 0.42, 26);
      }
    }
    return smoothHeading(lastHeading, moveBearing, 0.5, 32);
  }

  if (appliedSnap.snapped && Number.isFinite(appliedSnap.targetHeading)) {
    let roadHeading = alignBearingToReference(appliedSnap.targetHeading, travelRef);
    if (moveBearing != null) {
      roadHeading = smoothHeading(roadHeading, moveBearing, 0.45, 18);
    }
    return smoothHeading(lastHeading, roadHeading, 0.48, 32);
  }

  if (moveBearing != null) {
    return smoothHeading(lastHeading, moveBearing, 0.48, 40);
  }

  if (compassHdg != null) {
    const gpsFlip = Math.abs(((compassHdg - lastHeading + 540) % 360) - 180);
    if (gpsFlip <= 110) {
      return smoothHeading(lastHeading, compassHdg, 0.38, 40);
    }
  }

  return null;
}

function resolveUnifiedHeading(params: {
  snapHeading?: number | null;
  movementHeading?: number | null;
  gpsHeading?: number | null;
  previousHeading: number;
  speedKmh: number;
}): number {
  const prev = Number.isFinite(params.previousHeading) ? params.previousHeading : 0;
  const speedKmh = Number.isFinite(params.speedKmh) ? Math.max(0, params.speedKmh) : 0;
  const hasSnap = params.snapHeading != null && Number.isFinite(params.snapHeading);
  const hasMove = params.movementHeading != null && Number.isFinite(params.movementHeading);
  const useCompass = speedKmh < TRIP_COMPASS_HEADING_MAX_KMH;
  const hasGps = useCompass
    && params.gpsHeading != null
    && Number.isFinite(params.gpsHeading);

  const ref = hasMove
    ? Number(params.movementHeading)
    : hasSnap
      ? Number(params.snapHeading)
      : prev;
  const alignedSnap = hasSnap ? alignBearingToReference(Number(params.snapHeading), ref) : null;
  const alignedMove = hasMove ? alignBearingToReference(Number(params.movementHeading), ref) : null;
  const alignedGps = hasGps ? alignBearingToReference(Number(params.gpsHeading), ref) : null;

  let target = prev;

  if (speedKmh >= TRIP_COMPASS_HEADING_MAX_KMH) {
    if (alignedMove != null) {
      const flip = Math.abs(((alignedMove - prev + 540) % 360) - 180);
      if (flip < 92) {
        target = alignedMove;
      }
    } else if (alignedSnap != null) {
      const flip = Math.abs(((alignedSnap - prev + 540) % 360) - 180);
      if (flip < 92) {
        target = smoothHeading(prev, alignedSnap, 0.35, 18);
      }
    }
  } else {
    if (alignedMove != null) {
      target = smoothHeading(target, alignedMove, speedKmh >= 8 ? 0.55 : 0.45, 28);
    }
    if (alignedSnap != null) {
      const snapWeight = alignedMove != null && speedKmh >= 6
        ? (Math.abs(((alignedSnap - alignedMove + 540) % 360) - 180) > 22 ? 0.18 : 0.3)
        : (speedKmh >= 10 ? 0.4 : 0.32);
      target = smoothHeading(target, alignedSnap, snapWeight, 20);
    }
    if (alignedGps != null && speedKmh < 8) {
      target = smoothHeading(target, alignedGps, 0.28, 22);
    }
  }

  const maxTurn = speedKmh < 6 ? 12 : speedKmh < 20 ? 20 : speedKmh < 55 ? 30 : 38;
  const delta = ((target - prev + 540) % 360) - 180;
  const limited = prev + Math.sign(delta) * Math.min(Math.abs(delta), maxTurn);
  return ((limited % 360) + 360) % 360;
}

/** Przy ~8 km/h net w oknie 3 s ≈ 6–7 m; stary próg 12 m = fałszywy postój. */
function tripStandstillNetM(speedKmh: number, motionKmh = 0): number {
  return speedKmh < 15 || motionKmh < 15 ? 4 : 12;
}

/** V10: zatrzymaj worklet / prędkość — postój lub ghost Doppler (np. 160 km/h bez ruchu). */
function isWorkletStationaryHold(
  parkedLike: boolean,
  speedKmh: number,
  rawGpsKmh: number,
  motionKmh: number = 0,
  netMoveM: number = 0,
  accelBypassActive = false,
  isDriving = false,
  coordsFrozenDriving = false,
): boolean {
  if (accelBypassActive) return false;
  if (coordsFrozenDriving && (rawGpsKmh >= 6 || motionKmh >= 6)) return false;
  if (isDriving && (rawGpsKmh > 3 || motionKmh > 3)) return false;
  // Twardy bezpiecznik: natychmiastowy sygnal ruchu z GPS/motion ma pierwszenstwo
  // nad buforami "postoju", zeby nie zamykac pipeline przy ruszaniu.
  if (rawGpsKmh >= 8 || motionKmh >= 8) return false;
  if (parkedLike) return true;
  if (rawGpsKmh >= 15 && netMoveM >= 12) return false;
  // Highway: Doppler high + sanitized speed low used to freeze marker — require total data paralysis.
  if (rawGpsKmh >= 85) {
    if (netMoveM < 4 && motionKmh < 5 && speedKmh < 10) return true;
    return false;
  }
  if (rawGpsKmh >= 55 && speedKmh < 12 && motionKmh < 10 && netMoveM < 18) return true;
  if (rawGpsKmh >= 70 && netMoveM < 18 && motionKmh < 12) return true;
  if (rawGpsKmh >= 45 && netMoveM < 8 && motionKmh < 5 && speedKmh < 6) return true;
  // Ghost Doppler 8–80 km/h przy braku realnego ruchu — najczęstsza przyczyna dryfu na postoju.
  if (rawGpsKmh >= 8 && speedKmh < 6 && netMoveM < 16 && motionKmh < 14) return true;
  return speedKmh < 1.5 && rawGpsKmh < 25 && motionKmh < 4 && netMoveM < 10;
}

/** Postój / parking — nie ufaj Dopplerowi (ghost 20–80 km/h), nie karm workletu. */
function isParkedLikeTripEvidence(opts: {
  netMoveM: number;
  sustainedKmh: number;
  motionKmh: number;
  pathMoveM?: number;
  rawGpsKmh?: number;
  /** lat/lng nie ruszają się, Doppler żywy — jazda z zamrożonym GPS, nie postój. */
  coordsFrozenDriving?: boolean;
  foregroundRefreshGrace?: boolean;
}): boolean {
  const rawGps = opts.rawGpsKmh ?? 0;
  if (opts.foregroundRefreshGrace && rawGps >= 6) return false;
  const standstillNetM = tripStandstillNetM(rawGps, opts.motionKmh);
  const pathM = opts.pathMoveM ?? 0;
  if (pathM >= 12 && (opts.motionKmh >= 2.5 || opts.netMoveM >= 3)) {
    return false;
  }
  if (
    opts.coordsFrozenDriving
    && rawGps >= 15
    && opts.netMoveM < 10
    && pathM < 22
  ) {
    return false;
  }
  if (
    opts.netMoveM < standstillNetM
    && opts.sustainedKmh < 4
    && opts.motionKmh < 5
    && pathM < 14
  ) {
    return true;
  }
  // Doppler na postoju (20–50 km/h) bez ruchu w oknie — nie karm chase/worklet.
  // Luźniej niż wcześniej: wolna jazda / korek z jitterem net nie = postój.
  if (
    rawGps >= 8
    && rawGps <= 55
    && opts.netMoveM < 5
    && opts.sustainedKmh < 3.5
    && opts.motionKmh < 5
    && pathM < 10
  ) {
    return true;
  }
  if (
    opts.netMoveM < 10
    && pathM < 12
    && opts.motionKmh > 35
    && opts.sustainedKmh < 8
  ) {
    return true;
  }
  // Pojedynczy skok GPS (motionKmh 40+) bez potwierdzenia w oknie 3 s.
  if (
    opts.netMoveM < 12
    && opts.sustainedKmh < 5
    && opts.motionKmh > 12
    && pathM < 22
    && rawGps < 18
  ) {
    return true;
  }
  // Skok GPS (motionKmh z sanity cap 200) bez realnego ruchu w oknie 5 s.
  // Highway: delayed batch often shows low netMoveM — require stronger paralysis before parked-like.
  if (
    opts.netMoveM < 8
    && opts.sustainedKmh < 5
    && opts.motionKmh >= 80
    && pathM < 12
  ) {
    return true;
  }
  if (rawGps >= 55 && opts.netMoveM < 20 && opts.motionKmh < 15) {
    return true;
  }
  if (rawGps >= 100 && opts.netMoveM < 25 && opts.motionKmh < 20) {
    return true;
  }
  return false;
}

/** Chase/arc/GAP tylko przy realnej jeździe — nie przy postoju ani teleporcie GPS. */
function canV10ProgressMarker(opts: {
  parkedLike: boolean;
  speedMs: number;
  kmh: number;
  rawGpsKmh: number;
  rawStepM: number;
  rawToMarkerM: number;
}): boolean {
  if (opts.parkedLike) return false;
  if (!Number.isFinite(opts.rawStepM) || opts.rawStepM > 42) return false;
  if (opts.rawToMarkerM > 95) return false;
  return opts.rawGpsKmh >= 8 || opts.kmh >= 8 || opts.speedMs >= 2.4;
}

function trustDopplerInTripEvidence(opts: {
  netMoveM: number;
  sustainedKmh: number;
  motionKmh: number;
  pathMoveM?: number;
  rawGpsKmh: number;
}): boolean {
  if (opts.rawGpsKmh < 8 || isParkedLikeTripEvidence(opts)) return false;
  const geoKmh = Math.max(opts.motionKmh, opts.sustainedKmh);
  const delta = Math.abs(opts.rawGpsKmh - geoKmh);
  return opts.netMoveM >= 10 || delta < 25;
}

function hasDrivingMotionEvidence(opts: {
  rawGpsKmh: number;
  motionKmh: number;
  netMoveM: number;
  sustainedKmh: number;
  pathMoveM?: number;
}): boolean {
  const pathM = opts.pathMoveM ?? 0;
  const dopplerWithGeometry =
    opts.rawGpsKmh >= 6
    && (opts.netMoveM >= 5 || opts.motionKmh >= 3.5 || opts.sustainedKmh >= 3 || pathM >= 7);
  return (
    dopplerWithGeometry
    || opts.motionKmh >= 5
    || opts.sustainedKmh >= 4
    || opts.netMoveM >= 6
    || pathM >= 8
  );
}

/**
 * Postój fizyczny — zamroź marker na drodze mimo ghost Dopplera (20–50 km/h bez ruchu).
 */
function isTripMarkerFrozen(opts: {
  parkedLike: boolean;
  netMoveM: number;
  motionKmh: number;
  sustainedKmh: number;
  pathMoveM?: number;
  speedKmh: number;
  rawGpsKmh: number;
  rawStepM?: number;
  foregroundRefreshGrace?: boolean;
}): boolean {
  if (opts.foregroundRefreshGrace && (opts.rawGpsKmh >= 6 || opts.motionKmh >= 6)) {
    return false;
  }
  if (opts.parkedLike) return true;
  const pathM = opts.pathMoveM ?? 0;
  if (pathM >= 12 && (opts.motionKmh >= 2.5 || opts.netMoveM >= 3)) {
    return false;
  }
  const standstillNetM = tripStandstillNetM(opts.rawGpsKmh, opts.motionKmh);
  const rawStep = opts.rawStepM ?? 0;
  if (
    opts.netMoveM < standstillNetM
    && opts.motionKmh < 6
    && opts.sustainedKmh < 5
    && pathM < 14
    && opts.speedKmh < 8
    && rawStep < 2.5
  ) {
    return true;
  }
  if (
    opts.rawGpsKmh >= 10
    && opts.speedKmh < 6
    && opts.netMoveM < 12
    && opts.motionKmh < 6
    && rawStep < 2.5
  ) {
    return true;
  }
  return false;
}

function freezeMarkerOnRoad(
  pin: { lat: number; lng: number },
  roadPts: { latitude: number; longitude: number }[],
): { lat: number; lng: number; snapped: boolean } {
  if (roadPts.length < 2) {
    return { lat: pin.lat, lng: pin.lng, snapped: false };
  }
  const onRoad = projectOntoDrivingRoad(pin.lat, pin.lng, pin.lat, pin.lng, roadPts, 48);
  if (onRoad) {
    return { lat: onRoad.latitude, lng: onRoad.longitude, snapped: true };
  }
  return { lat: pin.lat, lng: pin.lng, snapped: false };
}

function computeSnapFailMaxStepM(kmh: number, rawDriftM: number): number {
  if (kmh >= 25) {
    const dynamic = drivingSnapDynamicStepCapM(kmh);
    return Math.min(dynamic, Math.max(12, rawDriftM * 0.55, kmh * 0.35));
  }
  if (kmh >= 8) {
    const dynamic = drivingSnapDynamicStepCapM(kmh);
    return Math.min(dynamic, Math.max(8, kmh * 0.22, rawDriftM * 0.4));
  }
  if (kmh < 6 && rawDriftM < 45) {
    return 0;
  }
  if (rawDriftM > 1.0) {
    return Math.max(2.0, Math.min(22, Math.max(kmh * 0.3, 2), rawDriftM * 0.35));
  }
  if (rawDriftM >= 0.5) {
    return Math.max(1.5, Math.min(8, kmh * 0.3, rawDriftM * 0.2));
  }
  return 0;
}

/** SNAP_FAIL: najpierw wzdłuż polilinii (5 s), dopiero potem krok do raw GPS. */
function resolveV10SnapFailPosition(
  hold: { lat: number; lng: number },
  rawLat: number,
  rawLng: number,
  kmh: number,
  roadPts: { latitude: number; longitude: number }[],
  snapFailAgeMs: number,
  rawDriftM: number,
  motionKmhHint = 0,
): { latitude: number; longitude: number } {
  const effectiveKmh = Math.max(kmh, motionKmhHint);
  const stepM = effectiveKmh < 6 && rawDriftM < 45
    ? 0
    : Math.max(1.5, Math.min(16, effectiveKmh * 0.28, rawDriftM * 0.4));
  if (stepM > 0 && roadPts.length >= 2 && snapFailAgeMs < 5000) {
    return stepTowardSnapOnPolyline(
      hold.lat,
      hold.lng,
      rawLat,
      rawLng,
      roadPts,
      stepM,
      90,
    );
  }
  const maxStepM = computeSnapFailMaxStepM(effectiveKmh, rawDriftM);
  if (maxStepM > 0 && roadPts.length >= 2) {
    return stepTowardSnapOnPolyline(
      hold.lat,
      hold.lng,
      rawLat,
      rawLng,
      roadPts,
      maxStepM,
      85,
    );
  }
  if (maxStepM > 0) {
    return clampCoordStep(
      { latitude: hold.lat, longitude: hold.lng },
      { latitude: rawLat, longitude: rawLng },
      maxStepM,
    );
  }
  return { latitude: hold.lat, longitude: hold.lng };
}

/** Twardy rzut markera na polilinię drogi — nawet gdy drivingSnap zwrócił punkt „obok” łuku. */
function projectOntoDrivingRoad(
  lat: number,
  lng: number,
  rawLat: number,
  rawLng: number,
  roadPts: { latitude: number; longitude: number }[],
  maxProjM = 58,
): { latitude: number; longitude: number } | null {
  if (roadPts.length < 2) return null;
  const dense = roadPts.length <= 8 ? densifyPolyline(roadPts, 6) : roadPts;
  const snapProj = projectOntoPolylineWithIndex(lat, lng, dense, maxProjM);
  if (snapProj) {
    return { latitude: snapProj.latitude, longitude: snapProj.longitude };
  }
  const rawProj = projectOntoPolylineWithIndex(rawLat, rawLng, dense, maxProjM + 20);
  if (rawProj) {
    return { latitude: rawProj.latitude, longitude: rawProj.longitude };
  }
  return null;
}

/**
 * Snap na 2-punktowej geometrii trzyma tę samą kotwicę → raw ucieka 40–98 m (MARKER_PIPELINE_GAP).
 * Krokuj marker od bieżącej pozycji w stronę raw/snap, żeby feedMoveM > 0 co tick GPS.
 */
function advanceV10MarkerTowardRaw(
  markerLat: number,
  markerLng: number,
  snapLat: number,
  snapLng: number,
  rawLat: number,
  rawLng: number,
  roadPts: { latitude: number; longitude: number }[],
  speedMs: number,
  kmh: number,
): { latitude: number; longitude: number; chaseM: number; failReason?: string } {
  const rawFromMarkerM = haversineKm(markerLat, markerLng, rawLat, rawLng) * 1000;
  if (rawFromMarkerM < 6 || (speedMs < 0.35 && kmh < 5)) {
    return {
      latitude: snapLat,
      longitude: snapLng,
      chaseM: 0,
      failReason: rawFromMarkerM < 6 ? 'raw_too_close' : 'parked',
    };
  }
  const snapFromMarkerM = haversineKm(markerLat, markerLng, snapLat, snapLng) * 1000;
  const hasRoad = roadPts.length >= 2;
  let goalLat = snapLat;
  let goalLng = snapLng;
  if (hasRoad) {
    const rawOnRoad = projectOntoDrivingRoad(rawLat, rawLng, rawLat, rawLng, roadPts, 52);
    if (rawOnRoad) {
      goalLat = rawOnRoad.latitude;
      goalLng = rawOnRoad.longitude;
    }
  } else {
    const towardRaw = rawFromMarkerM > snapFromMarkerM + 6;
    goalLat = towardRaw ? rawLat : snapLat;
    goalLng = towardRaw ? rawLng : snapLng;
  }
  const distGoalM = haversineKm(markerLat, markerLng, goalLat, goalLng) * 1000;
  const effectiveKmh = Math.max(kmh, speedMs * 3.6);
  const maxCatchupStepM = ((effectiveKmh + 25) / 3.6) * 1.05;
  const stepM = Math.min(
    distGoalM,
    Math.max(4, Math.min(kmh >= 55 ? 52 : kmh >= 30 ? 36 : 28, speedMs * 1.8 + 8)),
    rawFromMarkerM * 0.72,
    maxCatchupStepM,
  );
  if (stepM < 2) {
    return { latitude: snapLat, longitude: snapLng, chaseM: 0, failReason: 'step_too_small' };
  }
  const densePts = roadPts.length >= 2 && roadPts.length <= 8
    ? densifyPolyline(roadPts, 8)
    : roadPts;
  let next = densePts.length >= 2
    ? stepTowardSnapOnPolyline(markerLat, markerLng, goalLat, goalLng, densePts, stepM, 92)
    : clampCoordStep(
      { latitude: markerLat, longitude: markerLng },
      { latitude: goalLat, longitude: goalLng },
      stepM,
    );
  let movedM = haversineKm(markerLat, markerLng, next.latitude, next.longitude) * 1000;
  if (movedM < 2.5 && !hasRoad) {
    const rawStepM = Math.max(4, Math.min(stepM, rawFromMarkerM * 0.45, 8));
    next = clampCoordStep(
      { latitude: markerLat, longitude: markerLng },
      { latitude: goalLat, longitude: goalLng },
      rawStepM,
    );
    movedM = haversineKm(markerLat, markerLng, next.latitude, next.longitude) * 1000;
  }
  if (movedM < 1) {
    return { latitude: snapLat, longitude: snapLng, chaseM: 0, failReason: 'polyline_step_failed' };
  }
  return { latitude: next.latitude, longitude: next.longitude, chaseM: movedM };
}

function clampCoordStep(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  maxStepM: number,
): { latitude: number; longitude: number } {
  const distM = haversineKm(from.latitude, from.longitude, to.latitude, to.longitude) * 1000;
  if (!Number.isFinite(distM) || distM <= maxStepM) return to;
  const t = maxStepM / distM;
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    longitude: from.longitude + (to.longitude - from.longitude) * t,
  };
}

function projectCoord(
  from: { latitude: number; longitude: number },
  headingDeg: number,
  distanceM: number,
): { latitude: number; longitude: number } {
  const R = 6371000;
  const br = (headingDeg * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lng1 = (from.longitude * Math.PI) / 180;
  const d = distanceM / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  );
  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lng2 * 180) / Math.PI,
  };
}
// ─────────────────────────────────────────────────────────────────────────────

// ── DRIVING MODE ──────────────────────────────────────────
// Czas postoju (<3 km/h) zanim auto-wyłączymy tryb driving (guard w driveSessionGuard.ts)
const DRIVING_STOP_DELAY_MS      = 12 * 60 * 1000; // legacy — unused; guard uses 3 min @ <3 km/h
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

function isDriveMarkerBootstrapped(marker: { lat: { value: number }; lng: { value: number } }): boolean {
  return Number.isFinite(marker.lat.value) && Number.isFinite(marker.lng.value);
}

/** Wszystkie polilinie dostępne w ticku GPS (map-match + trasa + L2 cache + lustro L2). */
function collectTripRoadPolylines(
  matchedGeometry: { latitude: number; longitude: number }[],
  routePoints: { latitude: number; longitude: number }[],
  isNavigating: boolean,
  driveCoreCachePoints: { latitude: number; longitude: number }[] | null,
): { latitude: number; longitude: number }[][] {
  const out: { latitude: number; longitude: number }[][] = [];
  const seen = new Set<string>();
  const add = (pts: { latitude: number; longitude: number }[] | null | undefined) => {
    if (!pts || pts.length < 2) return;
    const key = `${pts.length}:${pts[0].latitude.toFixed(5)},${pts[0].longitude.toFixed(5)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(pts);
  };
  add(matchedGeometry);
  if (isNavigating) add(routePoints);
  add(driveCoreCachePoints);
  for (const poly of localRoadGeometryMirror.getPolylines()) {
    add(poly);
  }
  return out;
}

/** ADB: filtrowanie logcat — np. `adb logcat | grep DEBUG_CATCHUP` (działa też na produkcji). */
const DRIVE_V2_PIPELINE_DEBUG = true;

function resolveV2SnapSourceLabel(opts: {
  isNavigating: boolean;
  hasRoadGeometry: boolean;
  geometrySource?: string;
  clientSnapSource?: string;
  freeDriveRaw: boolean;
  hasRoutePolyline: boolean;
}): string {
  if (opts.freeDriveRaw) return 'raw_gps';
  if (opts.isNavigating && opts.hasRoutePolyline) return 'route';
  const client = opts.clientSnapSource;
  if (client && client !== 'raw') {
    if (client === 'sqlite') return 'local_cache';
    if (client === 'tile') return 'local_tile';
    if (client === 'route') return 'route';
    return client;
  }
  if (opts.geometrySource === 'segment_cache') return 'api';
  if (opts.hasRoadGeometry) return 'local_cache';
  if (opts.geometrySource === 'tangent_fallback') return 'engine_fallback';
  return 'raw';
}

/** V2: gate-free feed — każdy tick GPS → pushTarget (bez decideMarkerFeed). */
function pushDriveMarkerV2(
  driveMarker: {
    pushTarget: (t: {
      lat: number;
      lng: number;
      heading: number;
      durationMs?: number;
      speedMs?: number;
      hudKmh?: number;
      allowExtrapolation?: boolean;
      allowInstant?: boolean;
      syncHeading?: boolean;
      easeOutPosition?: boolean;
    }) => void;
    ensureFrameActive?: () => void;
    heading?: { value: number };
  },
  lat: number,
  lng: number,
  heading: number,
  opts?: {
    durationMs?: number;
    speedMs?: number;
    hudKmh?: number;
    allowInstant?: boolean;
    syncHeading?: boolean;
    allowExtrapolation?: boolean;
    easeOutPosition?: boolean;
  },
): void {
  if (!DRIVE_CORE_V2 || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const hudKmh = opts?.hudKmh ?? 0;
  const speedMs = opts?.speedMs != null && opts.speedMs > 0
    ? opts.speedMs
    : hudKmh >= 2
      ? Math.max(0.12, Math.min(52, hudKmh / 3.6))
      : 0;
  const rawDur = opts?.durationMs;
  const durationMs = Math.max(
    TRIP_GPS_FEED_MIN_MS,
    Number.isFinite(rawDur) && (rawDur as number) > 0 ? (rawDur as number) : 500,
  );
  driveMarker.pushTarget({
    lat,
    lng,
    heading,
    durationMs,
    speedMs,
    hudKmh,
    allowExtrapolation: opts?.allowExtrapolation !== false,
    allowInstant: opts?.allowInstant,
    easeOutPosition: opts?.easeOutPosition === true,
  });
  if (DRIVE_V2_PIPELINE_DEBUG) {
    const svHdgRaw = driveMarker.heading?.value;
    const svHdg = Number.isFinite(svHdgRaw) ? svHdgRaw! : null;
    const hdgFlipDeg = svHdg != null
      ? Math.abs(headingDelta(svHdg, heading))
      : null;
    const syncHeadingEquivalent =
      opts?.syncHeading === true
      || (hdgFlipDeg != null && hdgFlipDeg >= 45);
    const shouldLogHeading =
      syncHeadingEquivalent
      || opts?.allowInstant === true
      || (hdgFlipDeg != null && hdgFlipDeg >= 28);
    if (shouldLogHeading) {
      console.log('[DEBUG_HEADING]', {
        incomingHdg: Math.round(heading),
        svHdg: svHdg != null ? Math.round(svHdg) : null,
        hdgFlipDeg: hdgFlipDeg != null ? Math.round(hdgFlipDeg) : null,
        syncHeading: opts?.syncHeading === true,
        syncHeadingEquivalent,
        allowInstant: opts?.allowInstant === true,
        easeOutPosition: opts?.easeOutPosition === true,
        durationMs,
        hudKmh: round1(hudKmh),
      });
    }
  }
  driveMarker.ensureFrameActive?.();
  driveSessionLog('DRIVE_TRACE_FEED', {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    hdg: Math.round(heading),
    durationMs,
    speedKmh: round1(hudKmh > 0 ? hudKmh : speedMs * 3.6),
  });
}

/** Lookahead kamery (m) — lustrzane z useCameraAnimation.lookaheadFromSpeed. */
function tripLookaheadFromSpeedM(speedKmh: number, isNavigating: boolean): number {
  const s = Math.max(0, speedKmh);
  let m = 0;
  if (s < 18) m = 0;
  else if (s <= 40) m = ((s - 18) / 22) * 10;
  else if (s <= 80) m = 10 + ((s - 40) / 40) * 8;
  else m = 18 + Math.min(1, (s - 80) / 50) * 6;
  if (isNavigating && s >= 18) {
    m = m * 1.06 + 3;
  }
  return m;
}

function round1(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(1)) : n;
}

function round6(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(6)) : n;
}

/** HUD: nawigacja i free-drive — Doppler gdy silnik=0 (Android / off-route). */
function mergeTripHudKmh(engineKmh: number, dopplerKmh: number): number {
  const engine = normalizeHudSpeedKmh(engineKmh);
  const doppler = normalizeHudSpeedKmh(dopplerKmh);
  if (engine < 3 && doppler >= 8) return doppler;
  return Math.max(engine, doppler);
}

function computeDriveFeedSpeedMs(
  hudKmh: number,
  dopplerKmh: number,
  isFreeDrive: boolean,
  isMoving: boolean,
): number {
  if (isFreeDrive) {
    const motionKmh = Math.max(hudKmh, dopplerKmh);
    if (isMoving || motionKmh >= 3) {
      return Math.max(0.12, Math.min(52, motionKmh / 3.6));
    }
    return 0;
  }
  // Nawigacja: tylko przy potwierdzonym ruchu lub sensownej prędkości silnika (nie sam Doppler).
  if (isMoving || hudKmh >= 5) {
    return Math.max(0.12, Math.min(52, Math.max(hudKmh, isMoving ? dopplerKmh : 0) / 3.6));
  }
  return 0;
}

// Ile km/h ponad limit zanim kolor prędkości zmienia się na czerwony
const SPEED_LIMIT_TOLERANCE      = 5;

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
const UI_LOCATION_THROTTLE_MS    = 400;
/** Podczas jazdy: userLocation state tylko dla fuel/socket — marker/kamera z workletu. */
/** Rzadsze setUserLocation w jazdzie — mniej re-renderow MapScreen (marker = worklet). */
const ACTIVE_UI_LOCATION_THROTTLE_MS = 2000;
/** Podczas jazdy/nawigacji userLocation state jest tylko dla secondary/live state. */
const SECONDARY_LOC_PUBLISH_MS   = 2500;
const NAV_PROGRESS_UI_MS         = 1000;
const CAMERA_SPEED_POLL_MS       = 4500;
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
const GPS_WATCHDOG_TICK_MS = 2_500;
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
const LIVE_ACHIEVEMENT_PERIODIC_MS = 45_000;
const LIVE_ACHIEVEMENT_SPEED_DELTA_TRIGGER_KMH = 2;
const LIVE_ACHIEVEMENT_DISTANCE_DELTA_TRIGGER_KM = 0.4;
const LIVE_ACHIEVEMENT_MIN_MOVING_DISTANCE_KM = 1.0;
const DRIVE_HEALTH_LOG_MS = 15_000;
/** Co tyle km zapisujemy postęp trasy na serwer (profil nie „zamraża się” na długiej jeździe). */
const TRIP_CHECKPOINT_KM = 2.0;
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
const GPS_MAX_FIX_AGE_MS = 30_000;
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
function snapStaleHardResetThresholdM(kmh: number, motionKmh = 0): number {
  const v = Math.max(kmh, motionKmh);
  if (v >= 90) return 38;
  if (v >= 70) return 48;
  if (v >= 50) return 58;
  if (v >= 30) return 68;
  return SNAP_STALE_HARD_RESET_M;
}

const tripAccelState = {
  bypassUntilMs: 0,
  lagStreak: { count: 0, lastM: 0 },
  prevFeedSpeedKmh: 0,
  launchResetAtMs: 0,
};

/** Limit kroku snap/jump w jazdzie — rośnie z prędkością, żeby nadrobić lag w 1 ticku GPS. */
function drivingSnapDynamicStepCapM(
  kmh: number,
  jumpM?: number,
  opts?: { intervalSec?: number; accelBypass?: boolean },
): number {
  const intervalSec = Math.max(0.25, opts?.intervalSec ?? 0.5);
  const physicsStepM = (Math.max(0, kmh) / 3.6) * intervalSec;
  const dynamicStepCap = Math.max(35, physicsStepM);
  if (opts?.accelBypass) {
    return Math.max(dynamicStepCap, jumpM ?? 999, physicsStepM * 1.35);
  }
  if (jumpM != null && Number.isFinite(jumpM)) {
    return Math.max(dynamicStepCap, jumpM);
  }
  return dynamicStepCap;
}

/** Prędkość do feed/worklet — max z pipeline (nie tylko sanitized). */
function tripFeedSpeedKmh(
  pipelineSpeedKmh: number,
  speedMs?: number,
  motionKmh?: number,
  sustainedKmh?: number,
  rawGpsKmh?: number,
): number {
  const fromMs = speedMs != null && Number.isFinite(speedMs) && speedMs > 0 ? speedMs * 3.6 : 0;
  const candidates = [
    fromMs,
    pipelineSpeedKmh,
    motionKmh ?? 0,
    sustainedKmh ?? 0,
    rawGpsKmh ?? 0,
  ];
  let best = 0;
  for (const v of candidates) {
    if (Number.isFinite(v) && v > best) best = v;
  }
  return best;
}

/** Czas animacji worklet — nigdy krócej niż kadencja GPS (brak „dziury” między tickami). */
function workletFeedDurationMs(cadenceMs: number, _speedKmh: number, accelBypass = false): number {
  if (accelBypass) return 0;
  return Math.max(180, Math.min(1200, Math.max(cadenceMs, 1000)));
}

type AccelBypassState = {
  active: boolean;
  until: number;
  reason: string;
};

function updateTripAccelBypass(opts: {
  rawGpsKmh: number;
  feedSpeedKmh: number;
  rawToSnapM: number;
  netMoveM: number;
  tripActive: boolean;
  markerFrozen?: boolean;
}): AccelBypassState | null {
  if (!opts.tripActive || opts.markerFrozen) {
    if (opts.markerFrozen) {
      tripAccelState.bypassUntilMs = 0;
      tripAccelState.lagStreak = { count: 0, lastM: 0 };
    }
    return null;
  }
  const now = Date.now();
  const streak = tripAccelState.lagStreak;
  if (opts.rawToSnapM >= 12) {
    streak.count += 1;
    streak.lastM = opts.rawToSnapM;
  } else {
    streak.count = 0;
    streak.lastM = opts.rawToSnapM;
  }
  const speedAccel =
    opts.rawGpsKmh >= 15
    && opts.rawGpsKmh < 85
    && opts.feedSpeedKmh < opts.rawGpsKmh - 10
    && opts.netMoveM >= 14;
  const lagAccel = streak.count >= 3 && streak.lastM > 8 && opts.netMoveM >= 12;
  if (speedAccel || lagAccel) {
    tripAccelState.bypassUntilMs = now + 4500;
    return {
      active: true,
      until: tripAccelState.bypassUntilMs,
      reason: speedAccel ? 'speed_delta' : 'raw_lag_streak',
    };
  }
  if (tripAccelState.bypassUntilMs > now) {
    return { active: true, until: tripAccelState.bypassUntilMs, reason: 'hold' };
  }
  return null;
}

/**
 * Skraca glide workletu gdy marker/snap laguje za raw GPS.
 * Zwraca ms (min 180) lub 0 gdy instant.
 */
function workletGlideMsForLag(
  cadenceMs: number,
  opts: {
    forceInstant?: boolean;
    rawLat?: number;
    rawLng?: number;
    applyLat: number;
    applyLng: number;
    feedMoveM: number;
    kmh: number;
    markerAnchor?: { lat: number; lng: number } | null;
  },
): number {
  if (opts.forceInstant || cadenceMs <= 0) return 0;
  let glide = Math.max(cadenceMs, 1000);
  if (
    Number.isFinite(opts.rawLat)
    && Number.isFinite(opts.rawLng)
    && opts.kmh >= 6
  ) {
    const snapLagM = haversineKm(
      opts.applyLat,
      opts.applyLng,
      opts.rawLat as number,
      opts.rawLng as number,
    ) * 1000;
    const rawToMarkerM = opts.markerAnchor
      ? haversineKm(
        opts.markerAnchor.lat,
        opts.markerAnchor.lng,
        opts.rawLat as number,
        opts.rawLng as number,
      ) * 1000
      : snapLagM;
    const lagM = Math.max(snapLagM, rawToMarkerM);
    if (lagM >= 10 || opts.feedMoveM >= 14) {
      const factor = lagM >= 15 ? 1.12 : 1.06;
      glide = Math.max(glide, Math.round(cadenceMs * factor));
    }
  }
  return Math.max(Math.max(cadenceMs, 1000), Math.min(1200, glide));
}
/**
 * ANALIZA mph9uzxa: 337 DR_CRITICAL_REANCHOR w 3.5 min, driftFromSnapM mediana
 * 18 657 m to artefakt — `anchor (lastSetLocRef)` jest okresowo niesynchronizowany
 * z snappedPos po stałej akumulacji DR clamp + map-match catch-up. Realne dryfy
 * krytyczne są zawsze >300 m. Podbicie progu i streak'a likwiduje false-positives
 * bez utraty ratowania. Po tej zmianie spodziewamy się <80 wpisów na sesję 4-min.
 */
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
/** Max realistyczna prędkość auta w driving mode — wszystko powyżej to artefakt skoku GPS. */
const MAX_REALISTIC_DRIVING_KMH = 200;
const MAX_REALISTIC_NAV_KMH = 250;
const HEADING_FLIP_ALERT_DEG = 95;
const CAMERA_LAG_ALERT_M = 34;
// Płynność feedu worklet: 50–250 ms pokrywa opóźnienia między tickami GPS/DR (bez „dojazdu w 75 ms i stania”).
// Worklet dostaje target co 16 ms, więc duration musi być w tym rzędzie wielkości
// żeby segment się zakończył zanim przyjdzie nowy. Krótsze duration = marker
// jest CIĄGLE blisko aktualnego DR position, nie zostawia śladu animacji.
const TRIP_SMOOTH_MIN_MS = 35;
const TRIP_SMOOTH_MAX_MS = 220;
function isNullIsland(lat: number, lng: number): boolean {
  return Math.abs(lat) < 1e-4 && Math.abs(lng) < 1e-4;
}

/** Zwraca true, gdy timestamp fixu wskazuje na przestarzały odczyt z cache OS. */
function isStaleGpsTimestamp(nowMs: number, timestamp?: number | null): boolean {
  if (timestamp == null || !Number.isFinite(timestamp)) return false;
  let ts = timestamp;
  if (ts > 0 && ts < 1e12) ts *= 1000;
  const age = nowMs - ts;
  return age > GPS_MAX_FIX_AGE_MS || age < -15_000;
}

function clampRawTowardAnchor(
  anchor: { lat: number; lng: number },
  rawLat: number,
  rawLng: number,
  maxStepM: number,
): { lat: number; lng: number; movedM: number } {
  const movedM = haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000;
  if (!Number.isFinite(movedM) || movedM <= maxStepM || movedM <= 0) {
    return { lat: rawLat, lng: rawLng, movedM };
  }
  const ratio = maxStepM / movedM;
  return {
    lat: anchor.lat + (rawLat - anchor.lat) * ratio,
    lng: anchor.lng + (rawLng - anchor.lng) * ratio,
    movedM,
  };
}

/** Te same progi co w `onLocation`, ale z rzeczywistym Δt (nie psuje go `GPS_RESUME_GRACE_PERIOD_MS`). */
function isRawGpsPlausibleVsAnchor(
  rawLat: number,
  rawLng: number,
  anchor: { lat: number; lng: number },
  wallDtMs: number,
  reportedSpeedMs: number | null | undefined,
  isDriving: boolean,
  accuracyM?: number | null,
): boolean {
  const safeDt = Math.max(wallDtMs, 100);
  if (!isSaneLocation(rawLat, rawLng, anchor.lat, anchor.lng, 250, safeDt, isDriving)) return false;
  const distM2 = haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000;
  const reportMs =
    wallDtMs > GPS_WALLDT_IGNORE_SPEED_MS
      ? 0
      : (reportedSpeedMs != null && reportedSpeedMs >= 0 ? reportedSpeedMs : 0);
  const reportedKmh = reportMs * 3.6;
  const expectedM2 = (reportedKmh / 3.6) * (safeDt / 1000);
  if (isDriving) {
    const maxDistM2 = Math.max(300, expectedM2 * 3 + 100);
    return distM2 <= maxDistM2;
  }
  let maxDistM2 = Math.max(100, expectedM2 * 3 + 100);
  maxDistM2 = Math.min(maxDistM2, maxIdleBrowsingJumpM(safeDt, reportedKmh, accuracyM ?? 40));
  return distM2 <= maxDistM2;
}

/** Po powrocie z tła: pierwszy fix OS bywa cache (inny kontynent) — nie teleportuj markera. */
function isTripResumeJumpAcceptable(
  jumpM: number,
  bgPauseMs: number,
): { ok: boolean; allowMegaTeleport: boolean } {
  if (!Number.isFinite(jumpM) || jumpM <= TRIP_RESUME_HOLD_JUMP_M) {
    return { ok: true, allowMegaTeleport: false };
  }
  if (jumpM > 50_000) return { ok: false, allowMegaTeleport: false };
  if (bgPauseMs < 45_000 && jumpM > 1_500) return { ok: false, allowMegaTeleport: false };
  if (bgPauseMs < 120_000 && jumpM > 8_000) return { ok: false, allowMegaTeleport: false };
  const allowMegaTeleport = bgPauseMs >= 30_000 && jumpM > 1_500;
  if (allowMegaTeleport) return { ok: true, allowMegaTeleport: true };
  return { ok: jumpM <= TRIP_RESUME_MAX_JUMP_M, allowMegaTeleport: false };
}

/** Maks. krok markera między tickami GPS — powyżej = teleport, nie commituj kotwicy. */
function maxPlausibleDrivingStepM(speedMs: number, kmh: number): number {
  const ms = Math.max(speedMs > 0 ? speedMs : 0, kmh > 0.5 ? kmh / 3.6 : 0);
  if (ms < 0.5) return 40;
  return Math.max(40, Math.min(150, ms * 2.0 + 20));
}

/** Skok raw GPS względem ostatniej dobrej kotwicy (m). */
function rawStepFromAnchorM(
  anchor: { lat: number; lng: number } | null | undefined,
  rawLat: number,
  rawLng: number,
): number {
  if (!anchor) return 0;
  return haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000;
}

/**
 * Pojedynczy zły fix (cache OS / Wi‑Fi) z żywym Dopplerem — nie wolno go karmić snap/worklet.
 */
function isImplausibleGpsTeleport(
  anchor: { lat: number; lng: number },
  rawLat: number,
  rawLng: number,
  dtMs: number,
  speedMs: number,
  kmh: number,
  motionKmh: number,
  netMoveM: number,
  rawGpsKmh: number,
): boolean {
  const stepM = rawStepFromAnchorM(anchor, rawLat, rawLng);
  // Postój: pojedynczy skok GPS 6–20 m bez ruchu w oknie = teleport (nie czekaj na 22 m).
  if (
    netMoveM < 8
    && motionKmh < 6
    && kmh < 6
    && rawGpsKmh < 12
  ) {
    if (stepM > 10) return true;
    if (stepM > 5 && rawGpsKmh < 4) return true;
  }
  if (stepM < 22) return false;
  if (stepM > 120) return true;
  if (rawGpsKmh >= 35 && netMoveM < 22 && motionKmh < 14) return true;
  if (netMoveM < 25 && kmh < 4 && stepM > 32) return true;
  if (stepM > 55 && netMoveM < 18) return true;
  if (stepM > 85) return true;
  if (netMoveM < 15 && stepM > 28) return true;
  if (rawGpsKmh >= 50 && netMoveM < 10) return true;
  if (rawGpsKmh >= 90 && stepM > 35) return true;
  const maxStep = maxPlausibleDrivingStepM(speedMs, Math.max(kmh, motionKmh, rawGpsKmh));
  const dtSec = Math.max(0.35, Math.min(12, dtMs / 1000));
  const physicsCapM = Math.min(95, maxStep * dtSec * 1.35 + 18);
  const hardCapM = Math.min(110, Math.max(physicsCapM, maxStep * 1.35));
  if (stepM <= hardCapM) return false;
  if (netMoveM < 10 && stepM > 42) return true;
  if (rawGpsKmh >= 12 && motionKmh < 8 && stepM > 50) return true;
  if (kmh >= 10 && netMoveM < stepM * 0.2 && stepM > 55) return true;
  return false;
}

function angleDeltaDegSimple(a: number, b: number): number {
  return Math.abs((((a - b) + 540) % 360) - 180);
}

/** Snap na równoległą ulicę — ciągnij w stronę raw GPS i kierunku jazdy. */
function correctParallelRoadSnap(
  rawLat: number,
  rawLng: number,
  snapLat: number,
  snapLng: number,
  snapHeading: number,
  prevRaw: { lat: number; lng: number } | null,
  kmh: number,
): { lat: number; lng: number; heading: number; corrected: boolean } {
  const rawToSnapM = haversineKm(rawLat, rawLng, snapLat, snapLng) * 1000;
  if (rawToSnapM < 16 || kmh < 4) {
    return { lat: snapLat, lng: snapLng, heading: snapHeading, corrected: false };
  }
  const motionBrg = prevRaw
    ? bearingBetween(prevRaw.lat, prevRaw.lng, rawLat, rawLng)
    : null;
  if (!motionBrg || angleDeltaDegSimple(motionBrg, snapHeading) < 42) {
    return { lat: snapLat, lng: snapLng, heading: snapHeading, corrected: false };
  }
  const stepM = Math.min(rawToSnapM * 0.7, Math.max(8, kmh * 0.2 + 6));
  const c = clampCoordStep(
    { latitude: snapLat, longitude: snapLng },
    { latitude: rawLat, longitude: rawLng },
    stepM,
  );
  return {
    lat: c.latitude,
    lng: c.longitude,
    heading: motionBrg,
    corrected: true,
  };
}

/** Krok w tył względem kierunku jazdy — główna przyczyna „do przodu → cofka → znowu przód”. */
function isStepBackwardAlongHeading(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  headingDeg: number,
  minDistM = 1.2,
): boolean {
  if (!Number.isFinite(headingDeg)) return false;
  const distM = haversineKm(fromLat, fromLng, toLat, toLng) * 1000;
  if (distM < minDistM) return false;
  const stepBearing = bearingBetween(fromLat, fromLng, toLat, toLng);
  return angleDeltaDegSimple(stepBearing, headingDeg) > 108;
}

/** Po wejściu w jazdę: blokuj tylko duży skok snapu od kotwicy wejścia (nie raw↔snap). */
function clampDrivingEntryMarkerPose(
  _rawLat: number,
  _rawLng: number,
  snappedLat: number,
  snappedLng: number,
  graceUntilMs: number,
  entryAnchor: { lat: number; lng: number } | null,
): { lat: number; lng: number } {
  if (!entryAnchor || Date.now() >= graceUntilMs) {
    return { lat: snappedLat, lng: snappedLng };
  }
  const jumpFromEntryM = haversineKm(
    entryAnchor.lat,
    entryAnchor.lng,
    snappedLat,
    snappedLng,
  ) * 1000;
  if (jumpFromEntryM > DRIVING_ENTRY_MAX_MARKER_JUMP_M) {
    return { lat: entryAnchor.lat, lng: entryAnchor.lng };
  }
  return { lat: snappedLat, lng: snappedLng };
}

/** Tangenta polilinii w punkcie (do forward/backward guard na zakrętach). */
function bearingAlongRoadAt(
  lat: number,
  lng: number,
  roadPts: { latitude: number; longitude: number }[],
): number | null {
  if (roadPts.length < 2) return null;
  const dense = roadPts.length <= 8 ? densifyPolyline(roadPts, 6) : roadPts;
  const proj = projectOntoPolylineWithIndex(lat, lng, dense, 85);
  if (!proj) return null;
  const i = proj.segmentIndex;
  if (i < 0 || i >= dense.length - 1) return null;
  return bearingBetween(
    dense[i].latitude,
    dense[i].longitude,
    dense[i + 1].latitude,
    dense[i + 1].longitude,
  );
}

function enforceForwardOnlyPosition(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  headingDeg: number,
): { latitude: number; longitude: number; held: boolean } {
  if (!isStepBackwardAlongHeading(fromLat, fromLng, toLat, toLng, headingDeg)) {
    return { latitude: toLat, longitude: toLng, held: false };
  }
  return { latitude: fromLat, longitude: fromLng, held: true };
}

/** Feed w tył względem wyświetlanego markera — główna przyczyna „mrugnięcia” na drodze. */
function shouldBlockBackwardDisplayFeed(
  display: { lat: number; lng: number; at: number },
  feedLat: number,
  feedLng: number,
  headingDeg: number,
  speedKmh: number,
  maxDistM = 55,
  roadPts?: { latitude: number; longitude: number }[],
  turnMode = false,
): boolean {
  if (turnMode) return false;
  if (display.at <= 0 || speedKmh < 4) return false;
  const distM = haversineKm(display.lat, display.lng, feedLat, feedLng) * 1000;
  if (distM < 2.5 || distM > maxDistM) return false;
  const refHdg = roadPts && roadPts.length >= 2
    ? (bearingAlongRoadAt(display.lat, display.lng, roadPts) ?? headingDeg)
    : headingDeg;
  return isStepBackwardAlongHeading(display.lat, display.lng, feedLat, feedLng, refHdg, 2.5);
}

/** Snap/chase potrafi odsunąć marker od raw — ciągnij z powrotem do GPS, nie teleportuj dalej. */
function reconcileV10ApplyWithGpsTruth(
  applyLat: number,
  applyLng: number,
  anchor: { lat: number; lng: number },
  rawLat: number,
  rawLng: number,
  speedMs: number,
  kmh: number,
  headingDeg: number,
  roadPts: { latitude: number; longitude: number }[] = [],
): { lat: number; lng: number; reason: string | null } {
  const onRoadRaw = (() => {
    if (roadPts.length < 2) return null;
    const p = projectOntoDrivingRoad(rawLat, rawLng, rawLat, rawLng, roadPts, 52);
    return p ? { lat: p.latitude, lng: p.longitude } : null;
  })();
  const rawTruthLat = onRoadRaw?.lat ?? rawLat;
  const rawTruthLng = onRoadRaw?.lng ?? rawLng;
  const maxStep = maxPlausibleDrivingStepM(speedMs, kmh);
  // Postój: nie ciągnij do surowego GPS — to losowe teleporty na trawnik.
  if (kmh < 2 && speedMs < 0.65) {
    const applyJumpMStill = haversineKm(anchor.lat, anchor.lng, applyLat, applyLng) * 1000;
    if (applyJumpMStill <= 6) {
      return { lat: applyLat, lng: applyLng, reason: null };
    }
    const c = clampCoordStep(
      { latitude: anchor.lat, longitude: anchor.lng },
      { latitude: applyLat, longitude: applyLng },
      3,
    );
    return { lat: c.latitude, lng: c.longitude, reason: 'stationary_clamp_apply' };
  }
  const applyJumpM = haversineKm(anchor.lat, anchor.lng, applyLat, applyLng) * 1000;
  const rawJumpM = haversineKm(anchor.lat, anchor.lng, rawTruthLat, rawTruthLng) * 1000;
  const applyToRawM = haversineKm(applyLat, applyLng, rawTruthLat, rawTruthLng) * 1000;
  const forbidRawTruth = roadPts.length >= 2;

  if (applyJumpM <= maxStep && applyToRawM <= 48) {
    return { lat: applyLat, lng: applyLng, reason: null };
  }
  // Nigdy nie ciągnij markera do surowego GPS po skoku >45 m — to właśnie „teleport w pizdu”.
  if (
    !forbidRawTruth
    && rawJumpM <= maxStep * 1.25
    && rawJumpM <= 45
    && applyToRawM >= 22
    && applyToRawM <= 52
    && !isStepBackwardAlongHeading(anchor.lat, anchor.lng, rawTruthLat, rawTruthLng, headingDeg)
  ) {
    return { lat: rawTruthLat, lng: rawTruthLng, reason: 'snap_to_raw_truth' };
  }
  if (applyJumpM > maxStep) {
    if (
      !forbidRawTruth
      && rawJumpM < applyJumpM * 0.7
      && rawJumpM <= 45
      && applyToRawM > 18
      && !isStepBackwardAlongHeading(anchor.lat, anchor.lng, rawTruthLat, rawTruthLng, headingDeg)
    ) {
      return { lat: rawTruthLat, lng: rawTruthLng, reason: 'raw_closer_than_apply' };
    }
    const c = clampCoordStep(
      { latitude: anchor.lat, longitude: anchor.lng },
      { latitude: applyLat, longitude: applyLng },
      maxStep,
    );
    return { lat: c.latitude, lng: c.longitude, reason: 'clamp_apply_jump' };
  }
  if (applyToRawM > 42) {
    // WYŁĄCZONE pull_toward_raw — logi mpmkymfa: marker skacze do przodu, reconcile
    // cofał go do surowego GPS (wstecz), następny tick znowu do przodu → szarpanie 1-2-3-4.
    if (applyJumpM > maxStep) {
      const c = clampCoordStep(
        { latitude: anchor.lat, longitude: anchor.lng },
        { latitude: applyLat, longitude: applyLng },
        maxStep,
      );
      return { lat: c.latitude, lng: c.longitude, reason: 'clamp_apply_keep_snap' };
    }
    return { lat: applyLat, lng: applyLng, reason: null };
  }
  return { lat: applyLat, lng: applyLng, reason: null };
}

function logSnapPipelineEnd(
  rawLat: number,
  rawLng: number,
  applyLat: number,
  applyLng: number,
  extra?: Record<string, unknown>,
): void {
  const rawToApplyM = haversineKm(rawLat, rawLng, applyLat, applyLng) * 1000;
  const offRoadLeak = rawToApplyM >= 35;
  logGpsTickLayer('SNAP_PIPELINE_END', {
    rawLat: Number(rawLat.toFixed(6)),
    rawLng: Number(rawLng.toFixed(6)),
    applyLat: Number(applyLat.toFixed(6)),
    applyLng: Number(applyLng.toFixed(6)),
    rawToApplyM: Math.round(rawToApplyM),
    offRoadLeak,
    ...(extra ?? {}),
  });
  if (offRoadLeak) {
    visionEvent('OFF_ROAD', {
      rawLat: Number(rawLat.toFixed(6)),
      rawLng: Number(rawLng.toFixed(6)),
      snapLat: Number(applyLat.toFixed(6)),
      snapLng: Number(applyLng.toFixed(6)),
      crossTrackM: Math.round(rawToApplyM),
      action: 'snap_pipeline_leak',
      ...(extra ?? {}),
    });
  }
}

type PersistedNavSession = {
  savedAt: number;
  isOffroadRoute: boolean;
  startLocation: LocationState | null;
  endLocation: LocationState | null;
  navStartLoc: LocationState | null;
  routeInfo: RouteInfo | null;
  currentStep: number;
  offroadPoints: { latitude: number; longitude: number }[];
};

/** Załadowana trasa użytkownika (ranking) — osobno od bieżącego celu nawigacji. */
type LoadedRouteContext = {
  routeId: number;
  routeName: string;
  start: LocationState;
  end: LocationState;
  isOffroad: boolean;
  points: { latitude: number; longitude: number }[];
};

// ─────────────────────────────────────────────────────────────────────────────
function MapScreenInner() {
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

  /** Throttle native setCamera — max ~4 Hz; marker/worklet bez zmian. */
  const tripCameraSchedulerRef = useRef<ReturnType<typeof createTripCameraScheduler> | null>(null);
  /** Sync z useCameraAnimation — wcześniej niż scheduler (hook jest niżej w pliku). */
  const isUserExploringMapRef = useRef<() => boolean>(() => false);
  const getLastProgrammaticCameraApplyMsRef = useRef<() => number>(() => 0);
  const pushCameraFromSmoothRef = useRef<(lat: number, lng: number, hdg: number) => void>(() => {});
  const ensureTripCameraScheduler = useCallback(() => {
    if (!tripCameraSchedulerRef.current) {
      tripCameraSchedulerRef.current = createTripCameraScheduler((frame) => {
        if (!isDrivingRef.current && !isNavigatingRef.current) return;
        updateCameraFrameRef.current?.({
          center: { latitude: frame.lat, longitude: frame.lng },
          heading: frame.heading,
          speedKmh: speedKmhRef.current,
          isNavigating: isNavigatingRef.current,
          isDriving: isDrivingRef.current,
          timestamp: Date.now(),
          headingFromTripPipeline: true,
          followFromWorkletFrame: DRIVE_CORE_V2,
        });
      });
    }
    return tripCameraSchedulerRef.current;
  }, []);
  const disposeTripCameraScheduler = useCallback(() => {
    tripCameraSchedulerRef.current?.dispose();
    tripCameraSchedulerRef.current = null;
  }, []);
  /** Kamera: bootstrap / entry + segment GPS (V2). */
  const pushTripCameraFromApply = useCallback((
    lat: number,
    lng: number,
    heading: number,
    opts?: { instant?: boolean },
  ) => {
    if (!isDrivingRef.current && !isNavigatingRef.current) return;
    const speedKmh = speedKmhRef.current < 3 ? 0 : speedKmhRef.current;
    let hdg = Number.isFinite(heading) ? normalizeHeading(heading) : 0;
    lastCamResolvedHdgRef.current = hdg;
    lastCamVehicleForBearingRef.current = { lat, lng };
    updateCameraFrameRef.current?.({
      center: { latitude: lat, longitude: lng },
      heading: hdg,
      speedKmh,
      isNavigating: isNavigatingRef.current,
      isDriving: isDrivingRef.current,
      timestamp: Date.now(),
      headingFromTripPipeline: true,
      followFromWorkletFrame: DRIVE_CORE_V2,
      segmentDurationMs: opts?.instant ? 0 : lastSegmentDurationMsRef.current,
    });
  }, []);

  /** V2: jedna animacja kamery na segment GPS — zsynchronizowana z LERP markera. */
  const pushCameraFromGpsSegment = useCallback((
    lat: number,
    lng: number,
    hdg: number,
    feedDurMs: number,
    speedKmh: number,
    opts?: { instant?: boolean },
  ) => {
    if (!DRIVE_CORE_V2) return;
    if (!isDrivingRef.current && !isNavigatingRef.current) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const cameraSpeedKmh = speedKmh < 3 ? 0 : speedKmh;
    const hintHdg = normalizeHeading(hdg);
    lastCamResolvedHdgRef.current = hintHdg;
    const segMs = opts?.instant
      ? 0
      : Math.max(320, Math.min(1200, Math.round(feedDurMs)));
    updateCameraFrameRef.current?.({
      center: { latitude: lat, longitude: lng },
      heading: hintHdg,
      speedKmh: cameraSpeedKmh,
      isNavigating: isNavigatingRef.current,
      isDriving: isDrivingRef.current,
      timestamp: Date.now(),
      headingFromTripPipeline: true,
      followFromWorkletFrame: true,
      segmentDurationMs: segMs,
    });
    markerLogTick('CAM_SEGMENT_PUSH', {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      hdg: Math.round(hintHdg),
      segMs,
      speedKmh: Math.round(cameraSpeedKmh),
      instant: !!opts?.instant,
    }, 600);
  }, []);

  /** V10: bump/resume bez feedDR — jeden applyTripPosition. */
  const applyTripPositionRef = useRef<
    ((lat: number, lng: number, opts?: {
      heading?: number;
      speedMs?: number;
      forcePublish?: boolean;
      instant?: boolean;
      commitGood?: boolean;
      skipWorkletFeed?: boolean;
      rawLat?: number;
      rawLng?: number;
      roadPts?: { latitude: number; longitude: number }[];
      skipChase?: boolean;
      parkedLike?: boolean;
      rawStepM?: number;
    }) => void) | null
  >(null);

  // ── Refs – nawigacja / mowa ───────────────────────────────
  const lastSpokenRef        = useRef('');
  const lastSpeechAtRef      = useRef(0);
  const speechTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rerouteTimerRef      = useRef<any>(null);
  const announcedPhasesRef   = useRef<Set<string>>(new Set());
  const isSpeechRef          = useRef(true);
  const startIsMyLocationRef = useRef(false);
  const pendingRouteRef      = useRef<{ id: number; name: string } | null>(null);
  const loadedRouteRef       = useRef<LoadedRouteContext | null>(null);
  /** Dojazd do punktu startowego trasy — bez liczenia czasu / zapisu w rankingu. */
  const approachingRouteStartRef = useRef(false);
  const autoStartRouteAfterApproachRef = useRef(false);
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
    const deviceCourse = lastGpsDeviceHeadingRef.current;
    const compassDeg = deviceCourse != null
      && Number.isFinite(deviceCourse)
      && deviceCourse >= 0
      && speedKmh >= 6
      ? deviceCourse
      : null;
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
        compassDeg,
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
  const feedDRRef   = useRef<(pos: { latitude: number; longitude: number }, speedMs: number, heading: number) => void>(() => {});
  const lastSmoothFeedAtRef = useRef(0);
  const lastWorkletFeedAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastWorkletFeedAtRef = useRef(0);
  const lastFeedWorkletCallAtRef = useRef(0);
  const lastWorkletFeedSourceRef = useRef('');
  const subAnchorTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const drLastFrameAtRef = useRef(0);

  // ── Ref – isNavigating synchronicznie ────────────────────
  const isNavigatingRef = useRef(false);

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
  const tripCheckpointInFlightRef = useRef(false);

  // ── Cost-optimisation refs ────────────────────────────────
  // sendLocation: track last sent position + time to apply distance/heartbeat gate
  const lastSendTimeRef    = useRef<number>(0);
  const lastSendLocRef     = useRef<{ lat: number; lng: number } | null>(null);
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
  const roadMatchSigRef       = useRef('');
  const drivingSnapGeometryRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const markerStaleSnapTicksRef = useRef(0);
  const drivingSnapUsesMatchedRef = useRef(false);
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
  const reroutePendingRef     = useRef(false);
  const reroutePendingSinceRef = useRef<number>(0);
  const rerouteBlockedUntilRef = useRef<number>(0);
  const rerouteGraceUntilRef = useRef<number>(0);
  const lastAppliedRerouteSigRef = useRef<string>('');
  const lastBackgroundAtRef   = useRef<number>(0);
  const gpsTickCountRef       = useRef(0);
  const drTickCountRef        = useRef(0);
  const lastGpsTickAtRef      = useRef(0);
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

  /** GPS → marker (legacy DR) lub V10 instant bootstrap przez applyTripPositionRef. */
  const bumpActiveMarker = useCallback((
    lat: number,
    lng: number,
    opts?: { heading?: number; forcePublish?: boolean; instant?: boolean; speedMs?: number },
  ) => {
    if (!isNavigatingRef.current && !isDrivingRef.current) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (opts?.heading != null && Number.isFinite(opts.heading)) {
      drHdgRef.current = opts.heading;
    }
    const tripActive = isNavigatingRef.current || isDrivingRef.current;
    const isInstant = !!opts?.instant;

    if (V10_CLIENT_FIRST && tripActive) {
      applyTripPositionRef.current?.(lat, lng, {
        heading: opts?.heading ?? drHdgRef.current ?? lastHeadingRef.current ?? 0,
        speedMs: opts?.speedMs ?? 0,
        forcePublish: opts?.forcePublish ?? true,
        instant: isInstant,
        allowInstantFeed: !!opts?.allowInstantFeed,
      });
      return;
    }

    if (tripActive && !isInstant) {
      lastBumpActiveMarkerAtRef.current = Date.now();
      publishUserLocation(
        { latitude: lat, longitude: lng },
        opts?.forcePublish ?? true,
      );
      return;
    }

    // v10: w v10 wszystkie wywolania w drivingu beda non-instant; instant path
    // ponizej jest tylko dla bootstrap/entry przed wlaczeniem trip mode. Tam
    // worklet feed wciaz potrzebny dla plynnej animacji entry-camera.

    // Path instant (entry/resume/bootstrap/one-shot) — TAK, snapuj wszystko.
    drLatRef.current = lat;
    drLngRef.current = lng;
    drLastFrameAtRef.current = Date.now();
    const smoothMs = isInstant
      ? 0
      : Math.max(350, Math.min(1100, lastSmoothFeedAtRef.current > 0
          ? Date.now() - lastSmoothFeedAtRef.current
          : 900));
    lastSmoothFeedAtRef.current = Date.now();
    const speedMsForExtrapolation = (() => {
      if (isInstant) return 0;
      if (opts?.speedMs != null && Number.isFinite(opts.speedMs)) return Math.max(0, opts.speedMs);
      return 0;
    })();
    feedSmoothPositionTarget({
      latitude: lat,
      longitude: lng,
      heading: drHdgRef.current,
      durationMs: smoothMs,
      speedMs: speedMsForExtrapolation,
      source: isInstant ? 'bump_active_instant' : 'bump_active_smooth',
    });
    lastBumpActiveMarkerAtRef.current = Date.now();
    publishUserLocation(
      { latitude: lat, longitude: lng },
      opts?.forcePublish ?? true,
    );
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
   * V10 SSOT: jeden feed worklet na tick GPS. durationMs = gpsCadenceMs (250–1200 ms);
   * worklet robi liniowy LERP A→B przez ten czas, potem dead reckoning do następnego fixa.
   */
  const feedWorkletAnchorsAlongRoad = useCallback((
    lat: number,
    lng: number,
    heading: number,
    speedMs: number,
    smoothDurationMs: number,
    source: string,
    roadPtsWindow?: { latitude: number; longitude: number }[] | null,
    rawMotionDetected = false,
    rawMotionM = 0,
  ) => {
    clearSubAnchorTimers();
    const prev = lastWorkletFeedAnchorRef.current;
    let feedLat = lat;
    let feedLng = lng;
    const feedAnchorGuard =
      lastWorkletFeedAnchorRef.current
      ?? lastSetLocRef.current
      ?? lastGoodLocRef.current;
    if (feedAnchorGuard) {
      const tripActiveNow = isDrivingRef.current || isNavigatingRef.current;
      const guardStepM = haversineKm(
        feedAnchorGuard.lat,
        feedAnchorGuard.lng,
        feedLat,
        feedLng,
      ) * 1000;
      if (guardStepM > 800) {
        markerLogCritical('WORKLET_FEED_MEGA_JUMP_BLOCK', {
          guardStepM: Math.round(guardStepM),
          source,
          speedMs: Number(speedMs.toFixed(2)),
        });
        return;
      }
      const tripStill = !TRIP_PIPELINE_SIMPLE
        && (
          (
            speedMs < 1.1
            || speedKmhRef.current < 4.5
            || source === 'v10_stationary_hold'
          )
          && rawGpsKmhRef.current < 15
          && !rawMotionDetected
          && rawMotionM < 3.0
        );
      const drivingMotionEvidenceFeed =
        isDrivingRef.current
        && (
          TRIP_PIPELINE_SIMPLE
          || rawMotionDetected
          || (rawGpsKmhRef.current >= 8 && guardStepM >= 4)
          || (speedKmhRef.current >= 8 && guardStepM >= 4)
          || guardStepM >= 2.5
        );
      const drivingActiveNow =
        tripActiveNow
        && isDrivingRef.current
        && (TRIP_PIPELINE_SIMPLE || drivingMotionEvidenceFeed);
      const effectiveGuardStepMax = tripActiveNow ? 20.0 : 2.5;
      if (tripStill && !drivingActiveNow) {
        if (guardStepM <= effectiveGuardStepMax) {
          feedLat = feedAnchorGuard.lat;
          feedLng = feedAnchorGuard.lng;
          feedSmoothPositionTarget({
            latitude: feedLat,
            longitude: feedLng,
            heading,
            durationMs: 0,
            speedMs: 0,
            source: 'v10_stationary_hold',
            rawMotionDetected,
            rawMotionM,
          });
          lastWorkletFeedAnchorRef.current = { lat: feedLat, lng: feedLng };
          lastWorkletFeedAtRef.current = Date.now();
          lastWorkletFeedSourceRef.current = 'v10_stationary_hold';
          return;
        }
        vroomGpsLog('ACCEL_FORCE_RELEASE_GUARD', {
          guardStepM: Number(guardStepM.toFixed(2)),
          effectiveGuardStepMax,
          source,
          speedKmh: Number(speedKmhRef.current.toFixed(1)),
          rawGpsKmh: Number(rawGpsKmhRef.current.toFixed(1)),
        }, 1000);
      }
      const slowGuard = speedMs < 0.55 || speedKmhRef.current < 2.5;
      if (slowGuard && guardStepM > 12 && !drivingActiveNow) {
        markerLogCritical('WORKLET_FEED_STATIONARY_JUMP_BLOCK', {
          guardStepM: Math.round(guardStepM),
          source,
        });
        return;
      }
    }
    let movedM = prev
      ? haversineKm(prev.lat, prev.lng, feedLat, feedLng) * 1000
      : Infinity;
    const displayPos = markerDisplayRef.current.at > 0
      ? markerDisplayRef.current
      : markerProjRef.current;
    const displayToAnchorM = displayPos.at > 0
      ? haversineKm(displayPos.lat, displayPos.lng, feedLat, feedLng) * 1000
      : null;
    const turnModeFeed = turnModeUntilRef.current > Date.now();
    const roadPtsFeed = roadPtsWindow ?? drivingSnapGeometryRef.current;
    if (
      shouldBlockBackwardDisplayFeed(
        displayPos,
        feedLat,
        feedLng,
        heading,
        speedKmhRef.current,
        55,
        roadPtsFeed.length >= 2 ? roadPtsFeed : undefined,
        turnModeFeed,
      )
    ) {
      markerLogCritical('WORKLET_FEED_BACKWARD_BLOCK', {
        distM: displayToAnchorM != null ? Math.round(displayToAnchorM) : null,
        source,
        speedKmh: Math.round(speedKmhRef.current),
      });
      return;
    }
    const hardSnapResetThreshold = (() => {
      const v = speedKmhRef.current;
      if (v >= 70) return 12;
      if (v >= 45) return 15;
      if (v >= 25) return 18;
      return 20;
    })();
    const hardSnapReset = !turnModeFeed
      && displayToAnchorM != null
      && displayToAnchorM > hardSnapResetThreshold
      && (
        !isDrivingRef.current
        || movedM >= 1.5
        || speedMs >= 1.2
      );
    // v10_arc_stale_snap wyłączone — drugi target na polilinii powodował shake (marker vs kotwica GPS).
    // Rerouting guard: jeśli DR przestrzelił manewr (duży skok + duża zmiana heading),
    // resetuj segment natychmiast zamiast „miękkiej korekty”.
    const prevHdg = lastHeadingRef.current;
    const hdgDelta = Math.abs(((heading - prevHdg + 540) % 360) - 180);
    const forceInstantFeed =
      hardSnapReset
      || (
        movedM >= 18
        && speedMs >= 8.3 // ~30 km/h
        && hdgDelta >= 55
      );
    let feedSpeedMs = speedMs > 0 ? speedMs : 0;
    const cadenceMs = Math.max(180, Math.min(1200, gpsCadenceMsRef.current || 500));
    const feedCapKmhAlong = tripFeedSpeedKmh(
      speedKmhRef.current,
      speedMs,
      undefined,
      undefined,
      rawGpsKmhRef.current,
    );
    let glideMs = forceInstantFeed || smoothDurationMs === 0
      ? 0
      : workletFeedDurationMs(
        smoothDurationMs > 0 ? smoothDurationMs : cadenceMs,
        feedCapKmhAlong,
        false,
      );
    if (
      !forceInstantFeed
      && glideMs > 0
      && displayToAnchorM != null
      && displayToAnchorM >= 10
      && feedCapKmhAlong >= 6
      && feedCapKmhAlong < 25
    ) {
      const lagFactor = displayToAnchorM >= 28 ? 0.68 : displayToAnchorM >= 18 ? 0.74 : 0.8;
      glideMs = Math.max(180, Math.round(glideMs * lagFactor));
    }
    if (
      turnModeFeed
      && displayToAnchorM != null
      && displayToAnchorM > 35
      && glideMs === 0
      && !forceInstantFeed
    ) {
      glideMs = Math.max(280, workletFeedDurationMs(cadenceMs, feedCapKmhAlong, false));
    }
    // Bez podbijania prędkości z dużego skoku snapu — to wyprzedzało auto przy hamowaniu.
    const feedSource = hardSnapReset
      ? 'v10_hard_snap_reset'
      : forceInstantFeed
      ? 'v10_feed_instant_catchup'
      : source === 'v10_arc_stale_snap'
        ? 'v10_arc_stale_snap'
        : (speedMs > 0 && (movedM >= 4 || speedMs >= 4.2)
          ? 'v10_direct_cruise_feed'
          : source);
    const setLocFeed = lastSetLocRef.current;
    const distFromSetLocM = setLocFeed
      ? haversineKm(setLocFeed.lat, setLocFeed.lng, feedLat, feedLng) * 1000
      : null;
    const nowFeedCall = Date.now();
    const sincePrevFeedCallMs = lastFeedWorkletCallAtRef.current > 0
      ? nowFeedCall - lastFeedWorkletCallAtRef.current
      : null;
    lastFeedWorkletCallAtRef.current = nowFeedCall;
    logGpsTickLayer('FEED_WORKLET_CALL', {
      layer: 'feedWorkletAnchorsAlongRoad',
      durationMs: glideMs,
      speedMs: speedMs > 0 ? Number(speedMs.toFixed(2)) : 0,
      distFromSetLocM: distFromSetLocM != null ? Math.round(distFromSetLocM) : null,
      displayToAnchorM: displayToAnchorM != null ? Math.round(displayToAnchorM) : null,
      hardSnapReset,
      feedMoveFromWorkletAnchorM: Number.isFinite(movedM) ? Number(movedM.toFixed(2)) : null,
      sincePrevFeedCallMs,
      feedSpamSuspect: sincePrevFeedCallMs != null && sincePrevFeedCallMs < 40,
      source: feedSource,
      instant: glideMs === 0,
    });
    navDriveTrace('APPLY', {
      mode: 'cruise',
      source: feedSource,
      lat: Number(feedLat.toFixed(6)),
      lng: Number(feedLng.toFixed(6)),
      glideMs,
      speedMs: Number(feedSpeedMs.toFixed(2)),
      movedM: Number.isFinite(movedM) ? Number(movedM.toFixed(2)) : null,
      displayToAnchorM: displayToAnchorM != null ? Math.round(displayToAnchorM) : null,
      rawMotion: rawMotionDetected,
      rawMotionM: Number(rawMotionM.toFixed(2)),
    });
    feedSmoothPositionTarget({
      latitude: feedLat,
      longitude: feedLng,
      heading,
      durationMs: glideMs,
      speedMs: feedSpeedMs,
      source: feedSource,
      roadPts: roadPtsWindow ?? undefined,
      rawMotionDetected,
      rawMotionM,
    });
    lastWorkletFeedAnchorRef.current = { lat: feedLat, lng: feedLng };
    lastWorkletFeedAtRef.current = Date.now();
    lastWorkletFeedSourceRef.current = feedSource;
  }, [clearSubAnchorTimers]);

  const applyTripPosition = useCallback((
    lat: number,
    lng: number,
    opts?: {
      heading?: number;
      speedMs?: number;
      forcePublish?: boolean;
      instant?: boolean;
      commitGood?: boolean;
      /** Nie karm worklet (np. async local snap refinement) — unika mikro-skokow. */
      skipWorkletFeed?: boolean;
      /** Tylko bootstrap (ręczne wejście w jazdę) — instant feed do workletu. */
      allowInstantFeed?: boolean;
      rawLat?: number;
      rawLng?: number;
      roadPts?: { latitude: number; longitude: number }[];
      skipChase?: boolean;
      /** Nie ciągnij markera za surowym GPS przy stabilnej geometrii drogi (>2 pkt). */
      skipRawChase?: boolean;
      parkedLike?: boolean;
      rawStepM?: number;
      motionKmh?: number;
      netMoveM?: number;
      pathMoveM?: number;
      rawMotionDetected?: boolean;
      /** Dynamiczne przyspieszenie — bez stationary hold, krótki glide, pełny krok. */
      accelBypass?: boolean;
    },
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (DRIVE_CORE_V2 && (isDrivingRef.current || isNavigatingRef.current)) {
      return;
    }
    const accelBypass = !!opts?.accelBypass;
    if (isNullIsland(lat, lng)) return;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const heading = opts?.heading ?? drHdgRef.current ?? lastHeadingRef.current ?? 0;
    const speedMs = opts?.speedMs ?? 0;
    lastTripTargetUpdateAtRef.current = Date.now();

    let applyLat = lat;
    let applyLng = lng;
    let chaseM = 0;
    let rawToMarkerM: number | null = null;
    const tripActiveEarly = isNavigatingRef.current || isDrivingRef.current;

    if (V10_CLIENT_FIRST && tripActiveEarly) {
      const feedAnchor =
        lastWorkletFeedAnchorRef.current
        ?? lastSetLocRef.current
        ?? lastGoodLocRef.current;
      if (feedAnchor) {
        const feedJumpM = haversineKm(feedAnchor.lat, feedAnchor.lng, applyLat, applyLng) * 1000;
        if (feedJumpM > 800 && !opts?.allowInstantFeed) {
          markerLogCritical('APPLY_TRIP_MEGA_JUMP_BLOCK', {
            feedJumpM: Math.round(feedJumpM),
          });
          return;
        }
        if (
          feedJumpM > 45
          && !!opts?.parkedLike
          && !opts?.allowInstantFeed
        ) {
          markerLogCritical('APPLY_TRIP_PARKED_JUMP_BLOCK', {
            feedJumpM: Math.round(feedJumpM),
          });
          return;
        }
        const speedForCap = opts?.speedMs ?? speedKmhRef.current / 3.6;
        const parkedHold = isWorkletStationaryHold(
          !!opts?.parkedLike,
          speedKmhRef.current,
          rawGpsKmhRef.current,
          opts?.motionKmh ?? 0,
          opts?.netMoveM ?? 0,
          accelBypass,
          isDrivingRef.current,
        );
        if (parkedHold && feedJumpM > 12 && !opts?.allowInstantFeed && !accelBypass) {
          applyLat = feedAnchor.lat;
          applyLng = feedAnchor.lng;
        }
        const feedCapKmh = tripFeedSpeedKmh(
          speedKmhRef.current,
          speedForCap,
          opts?.motionKmh,
          undefined,
          rawGpsKmhRef.current,
        );
        const maxFeedJumpM = parkedHold
          ? 4
          : accelBypass
            ? Math.max(72, drivingSnapDynamicStepCapM(feedCapKmh, feedJumpM, { accelBypass: true }))
            : Math.min(
              72,
              maxPlausibleDrivingStepM(speedForCap, feedCapKmh) * 1.15,
            );
        const feedJumpThresholdM = parkedHold ? 2.5 : (accelBypass ? 4 : 38);
        if (!accelBypass && feedJumpM > maxFeedJumpM && feedJumpM > feedJumpThresholdM) {
          const clamped = clampCoordStep(
            { latitude: feedAnchor.lat, longitude: feedAnchor.lng },
            { latitude: applyLat, longitude: applyLng },
            maxFeedJumpM,
          );
          applyLat = clamped.latitude;
          applyLng = clamped.longitude;
          markerLogCritical('V10_FEED_TELEPORT_CLAMP', {
            feedJumpM: Math.round(feedJumpM),
            maxFeedJumpM: Math.round(maxFeedJumpM),
          });
        }
      }
    }

    // v10 SSOT: jeden feed/tick ze snapu — worklet LERP + forward prediction.
    if (V10_CLIENT_FIRST) {
      const rawLat = opts?.rawLat;
      const rawLng = opts?.rawLng;
      const roadPts = opts?.roadPts ?? drivingSnapGeometryRef.current;
      const roadPtsWindow = (() => {
        if (!roadPts || roadPts.length < 2) return null;
        // Małe okno geometrii wokół kotwicy — używane przez worklet do DR po łuku.
        let bestI = 0;
        let bestD = Infinity;
        const step = roadPts.length > 140 ? 3 : 1;
        for (let i = 0; i < roadPts.length; i += step) {
          const p = roadPts[i];
          const d = haversineKm(applyLat, applyLng, p.latitude, p.longitude) * 1000;
          if (d < bestD) {
            bestD = d;
            bestI = i;
          }
        }
        const start = Math.max(0, bestI - 22);
        const end = Math.min(roadPts.length, bestI + 22);
        const win = roadPts.slice(start, end);
        return win.length >= 2 ? win : null;
      })();

      const applyPhysicalMovementEvidence =
        (opts?.speedMs ?? 0) >= 2.2
        || (opts?.motionKmh ?? 0) >= 8
        || rawGpsKmhRef.current >= 8
        || !!opts?.rawMotionDetected
        || (opts?.rawStepM ?? 0) >= 3.0;
      const fgRefreshApply =
        tripForegroundRefreshUntilRef.current > Date.now()
        && (isDrivingRef.current || isNavigatingRef.current);
      const turnModeApply = turnModeUntilRef.current > Date.now();
      const tripStillHold = !TRIP_PIPELINE_SIMPLE
        && !fgRefreshApply
        && !accelBypass
        && !!opts?.parkedLike
        && !applyPhysicalMovementEvidence
        && isWorkletStationaryHold(
          true,
          speedKmhRef.current,
          rawGpsKmhRef.current,
          opts?.motionKmh ?? 0,
          opts?.netMoveM ?? 0,
          false,
          isDrivingRef.current,
          Number.isFinite(opts?.rawStepM)
            && (opts?.rawStepM ?? 0) < 2.8
            && rawGpsKmhRef.current >= 12,
        );
      const instantRawWakeApply =
        !!opts?.rawMotionDetected
        || (opts?.rawStepM ?? 0) >= 3.0;

      // Postój: pin do ostatniej stabilnej pozycji — bez chase/snap jitteru.
      if (
        tripStillHold
        && tripActiveEarly
        && !opts?.allowInstantFeed
        && !(
          isDrivingRef.current
          && (
            instantRawWakeApply
            ||
            (opts?.motionKmh ?? 0) > 3.5
            || (opts?.netMoveM ?? 0) >= 5
            || (opts?.pathMoveM ?? 0) >= 7
            || speedKmhRef.current > 4
          )
        )
      ) {
        const pin =
          lastSetLocRef.current
          ?? lastWorkletFeedAnchorRef.current
          ?? lastGoodLocRef.current
          ?? { lat: applyLat, lng: applyLng };
        applyLat = pin.lat;
        applyLng = pin.lng;
        if (!opts?.skipWorkletFeed) {
          feedSmoothPositionTarget({
            latitude: applyLat,
            longitude: applyLng,
            heading,
            durationMs: 0,
            speedMs: 0,
            source: 'v10_stationary_hold',
            rawMotionDetected: instantRawWakeApply,
            rawMotionM: opts?.rawStepM,
          });
          lastWorkletFeedAnchorRef.current = { lat: applyLat, lng: applyLng };
          lastWorkletFeedAtRef.current = Date.now();
          lastWorkletFeedSourceRef.current = 'v10_stationary_hold';
        }
        lastSetLocRef.current = { lat: applyLat, lng: applyLng };
        drLatRef.current = applyLat;
        drLngRef.current = applyLng;
        drHdgRef.current = heading;
        drLastFrameAtRef.current = Date.now();
        currentLocRef.current = { latitude: applyLat, longitude: applyLng };
        speedKmhRef.current = 0;
        emitSpeedometerKmh(0);
        publishUserLocation(
          { latitude: applyLat, longitude: applyLng },
          opts?.forcePublish ?? false,
        );
        return;
      }

      if (
        tripActiveEarly
        && !opts?.parkedLike
        && !opts?.allowInstantFeed
        && !turnModeApply
        && roadPts.length >= 2
        && Number.isFinite(rawLat)
        && Number.isFinite(rawLng)
      ) {
        const locked = projectOntoDrivingRoad(
          applyLat,
          applyLng,
          rawLat as number,
          rawLng as number,
          roadPts,
          speedKmhRef.current >= 35 ? 50 : 42,
        );
        if (locked) {
          applyLat = locked.latitude;
          applyLng = locked.longitude;
        }
      }
      const reliableSpeedEarly = (() => {
        if (speedMs != null && Number.isFinite(speedMs) && speedMs > 0) return speedMs;
        if (speedKmhRef.current > 0.5) return speedKmhRef.current / 3.6;
        return 0;
      })();
      const rStepM = opts?.rawStepM ?? 0;
      const skipRawChase =
        !!opts?.skipChase
        || !!opts?.skipRawChase
        || (isDrivingRef.current && roadPts.length >= 2);
      const chaseAllowed = canV10ProgressMarker({
        parkedLike: !!opts?.parkedLike,
        speedMs: reliableSpeedEarly,
        kmh: speedKmhRef.current,
        rawGpsKmh: speedKmhRef.current > 0.5 ? speedKmhRef.current : (reliableSpeedEarly * 3.6),
        rawStepM: rStepM,
        rawToMarkerM: 0,
      });
      if (
        tripActiveEarly
        && !turnModeApply
        && !opts?.skipWorkletFeed
        && !opts?.instant
        && !skipRawChase
        && chaseAllowed
        && Number.isFinite(rawLat)
        && Number.isFinite(rawLng)
      ) {
        const rLat = rawLat as number;
        const rLng = rawLng as number;
        const markerAnchor = lastWorkletFeedAnchorRef.current
          ?? lastSetLocRef.current
          ?? { lat: applyLat, lng: applyLng };
        rawToMarkerM = Math.round(
          haversineKm(markerAnchor.lat, markerAnchor.lng, rLat, rLng) * 1000,
        );
        if (!canV10ProgressMarker({
          parkedLike: !!opts?.parkedLike,
          speedMs: reliableSpeedEarly,
          kmh: speedKmhRef.current,
          rawGpsKmh: speedKmhRef.current,
          rawStepM: rStepM,
          rawToMarkerM,
        })) {
          // skip chase — postój / teleport / suchy dryf
        } else {
        const snapMoveM = haversineKm(markerAnchor.lat, markerAnchor.lng, applyLat, applyLng) * 1000;
        if ((snapMoveM < 1.5 && rawToMarkerM >= 8) || rawToMarkerM >= 12) {
          const chased = advanceV10MarkerTowardRaw(
            markerAnchor.lat,
            markerAnchor.lng,
            applyLat,
            applyLng,
            rLat,
            rLng,
            roadPts,
            reliableSpeedEarly,
            speedKmhRef.current,
          );
          if (chased.chaseM >= 1) {
            const beforeChaseLat = applyLat;
            const beforeChaseLng = applyLng;
            applyLat = chased.latitude;
            applyLng = chased.longitude;
            chaseM = chased.chaseM;
            if (Number.isFinite(rawLat) && Number.isFinite(rawLng)) {
              const beforeRawM = haversineKm(beforeChaseLat, beforeChaseLng, rawLat as number, rawLng as number) * 1000;
              const afterRawM = haversineKm(applyLat, applyLng, rawLat as number, rawLng as number) * 1000;
              if (afterRawM > beforeRawM + 10) {
                applyLat = beforeChaseLat;
                applyLng = beforeChaseLng;
                chaseM = 0;
                markerLogTick('V10_CHASE_REJECT_DRIFT', {
                  beforeRawM: Math.round(beforeRawM),
                  afterRawM: Math.round(afterRawM),
                }, 900);
              }
            }
            markerLogTick('V10_APPLY_CHASE', {
              chaseM: Math.round(chaseM),
              rawToMarkerM,
              roadPts: roadPts.length,
              speedMs: Number(reliableSpeedEarly.toFixed(2)),
            }, 900);
          } else {
            markerLogTick('V10_CHASE_FAIL', {
              rawToMarkerM,
              reason: chased.failReason ?? 'step_too_small',
              roadPts: roadPts.length,
            }, 900);
          }
        }
        }
        if (roadPts.length >= 2 && chaseM >= 1) {
          const beforeProj = { lat: applyLat, lng: applyLng };
          const projected = projectOntoDrivingRoad(
            applyLat,
            applyLng,
            rLat,
            rLng,
            roadPts,
            58,
          );
          if (projected) {
            const undoM = haversineKm(beforeProj.lat, beforeProj.lng, projected.latitude, projected.longitude) * 1000;
            if (undoM < chaseM * 0.45) {
              applyLat = projected.latitude;
              applyLng = projected.longitude;
            }
          }
        }
      }

      const truthAnchor =
        lastGoodLocRef.current
        ?? lastSetLocRef.current
        ?? lastWorkletFeedAnchorRef.current;
      if (
        truthAnchor
        && Number.isFinite(opts?.rawLat)
        && Number.isFinite(opts?.rawLng)
      ) {
        const reconciled = reconcileV10ApplyWithGpsTruth(
          applyLat,
          applyLng,
          truthAnchor,
          opts.rawLat as number,
          opts.rawLng as number,
          reliableSpeedEarly,
          speedKmhRef.current,
          heading,
          roadPts,
        );
        if (reconciled.reason) {
          applyLat = reconciled.lat;
          applyLng = reconciled.lng;
          markerLogTick('V10_APPLY_RECONCILE', {
            reason: reconciled.reason,
            lat: Number(applyLat.toFixed(6)),
            lng: Number(applyLng.toFixed(6)),
          }, 800);
        }
      }

      const displayAnchor = markerDisplayRef.current;
      const forwardFrom = displayAnchor.at > 0 && speedKmhRef.current >= 4
        ? { lat: displayAnchor.lat, lng: displayAnchor.lng }
        : (lastWorkletFeedAnchorRef.current ?? lastSetLocRef.current);
      if (forwardFrom && !turnModeApply) {
        const fwdHdg = roadPts.length >= 2
          ? (bearingAlongRoadAt(forwardFrom.lat, forwardFrom.lng, roadPts) ?? heading)
          : heading;
        const fwd = enforceForwardOnlyPosition(
          forwardFrom.lat,
          forwardFrom.lng,
          applyLat,
          applyLng,
          fwdHdg,
        );
        if (fwd.held) {
          applyLat = fwd.latitude;
          applyLng = fwd.longitude;
          markerLogTick('V10_FORWARD_ONLY_HOLD', {
            lat: Number(applyLat.toFixed(6)),
            lng: Number(applyLng.toFixed(6)),
            heading: Math.round(heading),
          }, 900);
        }
      }

      if (
        tripActiveEarly
        && !opts?.parkedLike
        && !accelBypass
        && isDrivingRef.current
        && roadPts.length >= 2
        && Number.isFinite(opts?.rawLat)
        && Number.isFinite(opts?.rawLng)
        && (opts?.speedMs ?? 0) >= 0.5
        && speedKmhRef.current >= 5
      ) {
        const hardLock = projectOntoDrivingRoad(
          applyLat,
          applyLng,
          opts.rawLat as number,
          opts.rawLng as number,
          roadPts,
          speedKmhRef.current >= 35 ? 50 : 42,
        );
        if (hardLock) {
          const lateralM = haversineKm(applyLat, applyLng, hardLock.latitude, hardLock.longitude) * 1000;
          if (lateralM > 1.5) {
            applyLat = hardLock.latitude;
            applyLng = hardLock.longitude;
          }
        }
      }

      lastSetLocRef.current = { lat: applyLat, lng: applyLng };
      const wantCommitGood = (opts?.commitGood || isDrivingRef.current) && !opts?.parkedLike && chaseM < 3;
      if (wantCommitGood) {
        let canCommitGood = true;
        if (truthAnchor) {
          const commitJumpM = haversineKm(truthAnchor.lat, truthAnchor.lng, applyLat, applyLng) * 1000;
          const maxCommitStep = maxPlausibleDrivingStepM(reliableSpeedEarly, speedKmhRef.current) * 1.25;
          if (commitJumpM > maxCommitStep) canCommitGood = false;
          if (
            canCommitGood
            && Number.isFinite(opts?.rawLat)
            && Number.isFinite(opts?.rawLng)
          ) {
            const commitToRawM = haversineKm(
              applyLat,
              applyLng,
              opts.rawLat as number,
              opts.rawLng as number,
            ) * 1000;
            if (commitToRawM > 42) canCommitGood = false;
          }
        }
        if (canCommitGood) {
          lastGoodLocRef.current = { lat: applyLat, lng: applyLng };
        }
      }

      drLatRef.current = applyLat;
      drLngRef.current = applyLng;
      drHdgRef.current = heading;
      drLastFrameAtRef.current = Date.now();
      currentLocRef.current = { latitude: applyLat, longitude: applyLng };
      const tripActive = tripActiveEarly;
      let tripFeedSpeedMs: number | null = null;
      let tripFeedMoveM: number | null = null;
      let tripGlideMs: number | null = null;
      let tripFeedSource = 'none';
      if (tripActive && !opts?.skipWorkletFeed) {
        const isInstant = !!opts?.instant;
        const lagRawToMarkerM =
          Number.isFinite(opts?.rawLat) && Number.isFinite(opts?.rawLng)
            ? (() => {
              const anchor = lastWorkletFeedAnchorRef.current
                ?? lastSetLocRef.current
                ?? { lat: applyLat, lng: applyLng };
              return haversineKm(anchor.lat, anchor.lng, opts?.rawLat as number, opts?.rawLng as number) * 1000;
            })()
            : null;
        const lagCatchupNow = Date.now();
        const lagCatchupInstant =
          lagRawToMarkerM != null
          && lagRawToMarkerM > 65
          && speedKmhRef.current >= 18
          && (opts?.speedMs ?? 0) >= 4.5
          && lagCatchupNow - lastLagCatchupInstantAtRef.current > 2500;
        if (lagCatchupInstant) {
          lastLagCatchupInstantAtRef.current = lagCatchupNow;
        }
        const forceInstantFeed =
          (isInstant && !!opts?.allowInstantFeed)
          || lagCatchupInstant;
        const reliableSpeedMs = (() => {
          if (speedMs != null && Number.isFinite(speedMs) && speedMs > 0) return speedMs;
          const kmh = speedKmhRef.current;
          if (kmh > 0.5) return kmh / 3.6;
          const rawKmh = rawGpsKmhRef.current;
          const truth = lastGoodLocRef.current ?? lastSetLocRef.current;
          const rawStepM = truth && Number.isFinite(opts?.rawLat) && Number.isFinite(opts?.rawLng)
            ? haversineKm(truth.lat, truth.lng, opts.rawLat as number, opts.rawLng as number) * 1000
            : 0;
          if (
            tripActiveEarly
            && rawKmh >= 8
            && (isDrivingRef.current || isNavigatingRef.current)
            && rawStepM > 0
            && rawStepM <= maxPlausibleDrivingStepM(0, rawKmh) * 1.3
          ) {
            return Math.min(MAX_REALISTIC_DRIVING_KMH, rawKmh) / 3.6;
          }
          return 0;
        })();
        const prevFeed = lastWorkletFeedAnchorRef.current;
        const feedMoveM = prevFeed
          ? haversineKm(prevFeed.lat, prevFeed.lng, applyLat, applyLng) * 1000
          : Infinity;
        const cadenceApplyMs = Math.max(250, Math.min(1200, gpsCadenceMsRef.current || 500));
        const feedCapKmh = tripFeedSpeedKmh(
          speedKmhRef.current,
          reliableSpeedMs > 0 ? reliableSpeedMs : speedMs,
          opts?.motionKmh,
          undefined,
          rawGpsKmhRef.current,
        );
        const smoothDurationMs = forceInstantFeed || accelBypass
          ? 0
          : workletFeedDurationMs(
            workletGlideMsForLag(cadenceApplyMs, {
              forceInstant: false,
              rawLat: opts?.rawLat,
              rawLng: opts?.rawLng,
              applyLat,
              applyLng,
              feedMoveM: Number.isFinite(feedMoveM) ? feedMoveM : 0,
              kmh: feedCapKmh,
              markerAnchor: lastSetLocRef.current,
            }),
            feedCapKmh,
            false,
          );
        const feedSpeedMs = (() => {
          const netM = opts?.netMoveM ?? 99;
          if (
            !accelBypass
            && speedKmhRef.current < 4.5
            && netM < 14
            && rawGpsKmhRef.current < 15
            && (opts?.motionKmh ?? 0) < 2.5
            && (opts?.pathMoveM ?? 0) < 8
          ) {
            return 0;
          }
          const capKmh = tripFeedSpeedKmh(
            speedKmhRef.current,
            reliableSpeedMs > 0 ? reliableSpeedMs : speedMs,
            opts?.motionKmh,
            undefined,
            rawGpsKmhRef.current,
          );
          if (capKmh >= 3) return capKmh / 3.6;
          if (reliableSpeedMs > 0) return reliableSpeedMs;
          if (speedMs != null && Number.isFinite(speedMs) && speedMs > 0) return speedMs;
          if (speedKmhRef.current > 2) return speedKmhRef.current / 3.6;
          return 0;
        })();
        const liveFollowTrip =
          !forceInstantFeed
          && speedKmhRef.current >= 4
          && feedSpeedMs >= 1.0
          && ((opts?.netMoveM ?? 99) >= 8 || (opts?.pathMoveM ?? 0) >= 8);
        tripFeedSpeedMs = feedSpeedMs;
        tripFeedMoveM = Number.isFinite(feedMoveM) ? feedMoveM : null;
        tripGlideMs = forceInstantFeed ? 0 : smoothDurationMs;
        tripFeedSource = forceInstantFeed
          ? (lagCatchupInstant
            ? 'v10_lag_catchup_instant'
            : chaseM >= 1
              ? 'v10_apply_chase_instant'
              : 'v10_apply_trip_instant')
          : liveFollowTrip
            ? 'v10_live_follow'
            : 'v10_live_cruise';
        const blockBackwardFeed = shouldBlockBackwardDisplayFeed(
          markerDisplayRef.current,
          applyLat,
          applyLng,
          heading,
          speedKmhRef.current,
          55,
          roadPts.length >= 2 ? roadPts : undefined,
          turnModeApply,
        );
        if (blockBackwardFeed) {
          markerLogTick('V10_FEED_BACKWARD_SKIP', {
            lat: Number(applyLat.toFixed(6)),
            lng: Number(applyLng.toFixed(6)),
            source: tripFeedSource,
            speedKmh: Math.round(speedKmhRef.current),
          }, 700);
        } else if (forceInstantFeed) {
          const setLocInstant = lastSetLocRef.current;
          const distFromSetInstantM = setLocInstant
            ? haversineKm(setLocInstant.lat, setLocInstant.lng, applyLat, applyLng) * 1000
            : null;
          const nowFeedInstant = Date.now();
          const sincePrevInstantMs = lastFeedWorkletCallAtRef.current > 0
            ? nowFeedInstant - lastFeedWorkletCallAtRef.current
            : null;
          lastFeedWorkletCallAtRef.current = nowFeedInstant;
          logGpsTickLayer('FEED_WORKLET_CALL', {
            layer: 'applyTripPosition',
            durationMs: 0,
            speedMs: feedSpeedMs != null ? Number(feedSpeedMs.toFixed(2)) : 0,
            distFromSetLocM: distFromSetInstantM != null ? Math.round(distFromSetInstantM) : null,
            feedMoveFromWorkletAnchorM: tripFeedMoveM,
            sincePrevFeedCallMs: sincePrevInstantMs,
            feedSpamSuspect: sincePrevInstantMs != null && sincePrevInstantMs < 40,
            source: chaseM >= 1 ? 'v10_apply_chase_instant' : 'v10_apply_trip_instant',
            instant: true,
            rawToMarkerM,
          });
          navDriveTrace('APPLY', {
            mode: 'instant',
            source: chaseM >= 1 ? 'v10_apply_chase_instant' : 'v10_apply_trip_instant',
            lat: Number(applyLat.toFixed(6)),
            lng: Number(applyLng.toFixed(6)),
            speedMs: feedSpeedMs != null ? Number(feedSpeedMs.toFixed(2)) : 0,
            chaseM: Math.round(chaseM),
            parkedLike: !!opts?.parkedLike,
          });
          feedSmoothPositionTarget({
            latitude: applyLat,
            longitude: applyLng,
            heading,
            durationMs: 0,
            speedMs: feedSpeedMs,
            source: chaseM >= 1 ? 'v10_apply_chase_instant' : 'v10_apply_trip_instant',
            rawMotionDetected: !!opts?.rawMotionDetected,
            rawMotionM: opts?.rawStepM,
          });
          lastWorkletFeedAnchorRef.current = { lat: applyLat, lng: applyLng };
          lastWorkletFeedAtRef.current = Date.now();
          lastWorkletFeedSourceRef.current = chaseM >= 1 ? 'v10_apply_chase_instant' : 'v10_apply_trip_instant';
        } else if (!blockBackwardFeed) {
          const setLocCruise = lastSetLocRef.current;
          const distFromSetCruiseM = setLocCruise
            ? haversineKm(setLocCruise.lat, setLocCruise.lng, applyLat, applyLng) * 1000
            : null;
          const nowFeedCruise = Date.now();
          const sincePrevCruiseMs = lastFeedWorkletCallAtRef.current > 0
            ? nowFeedCruise - lastFeedWorkletCallAtRef.current
            : null;
          lastFeedWorkletCallAtRef.current = nowFeedCruise;
          if (
            liveFollowTrip
            && Number.isFinite(opts?.rawLat)
            && Number.isFinite(opts?.rawLng)
            && speedKmhRef.current < 14
            && !(
              isDrivingRef.current
              && (
                (opts?.parkedLike ?? false)
                || (opts?.netMoveM ?? 0) < 8
                || (opts?.pathMoveM ?? 0) < 10
                || (opts?.motionKmh ?? 0) < 5
                || (opts?.speedMs ?? 0) < 1.4
              )
            )
          ) {
            const rawLatLive = opts.rawLat as number;
            const rawLngLive = opts.rawLng as number;
            const rawDistM = haversineKm(applyLat, applyLng, rawLatLive, rawLngLive) * 1000;
            if (rawDistM > 4 && rawDistM < 45) {
              applyLat = applyLat + (rawLatLive - applyLat) * 0.45;
              applyLng = applyLng + (rawLngLive - applyLng) * 0.45;
            }
          }
          feedWorkletAnchorsAlongRoad(
            applyLat,
            applyLng,
            heading,
            feedSpeedMs,
            smoothDurationMs,
            tripFeedSource,
            roadPtsWindow,
            !!opts?.rawMotionDetected,
            opts?.rawStepM ?? 0,
          );
        }
        {
          const dispNow = markerDisplayRef.current;
          const dispFresh = dispNow.at > 0 && Date.now() - dispNow.at < 800;
          markerProjRef.current = dispFresh
            ? { ...dispNow, speedMs: feedSpeedMs, at: Date.now() }
            : {
              lat: applyLat,
              lng: applyLng,
              hdg: heading,
              speedMs: feedSpeedMs,
              at: Date.now(),
            };
        }
        const hudTruth = lastGoodLocRef.current ?? lastSetLocRef.current;
        const hudRawStepM = hudTruth && Number.isFinite(opts?.rawLat) && Number.isFinite(opts?.rawLng)
          ? haversineKm(hudTruth.lat, hudTruth.lng, opts.rawLat as number, opts.rawLng as number) * 1000
          : 0;
        const hudKmh = Math.max(
          speedKmhRef.current,
          rawGpsKmhRef.current >= 15
          && hudRawStepM > 0
          && hudRawStepM <= maxPlausibleDrivingStepM(0, rawGpsKmhRef.current) * 1.25
            ? rawGpsKmhRef.current * 0.92
            : 0,
        );
        emitSpeedometerKmh(Math.max(0, hudKmh));
        if (!V10_CLIENT_FIRST) {
          pushTripCameraFromApply(applyLat, applyLng, heading);
        }
      }
      publishUserLocation(
        { latitude: applyLat, longitude: applyLng },
        opts?.forcePublish ?? false,
      );
      currentLocRef.current = { latitude: applyLat, longitude: applyLng };
      lastBumpActiveMarkerAtRef.current = Date.now();
      // V2: marker tylko z driveCoreProcessRef (SSOT) — applyTripPosition nie feeduje markera.
      markerLogTick('V10_APPLY_TRIP', {
        lat: Number(applyLat.toFixed(6)),
        lng: Number(applyLng.toFixed(6)),
        heading: Math.round(heading),
        tripActive,
        isDriving: isDrivingRef.current,
        isNav: isNavigatingRef.current,
        instant: !!opts?.instant,
        skipWorkletFeed: !!opts?.skipWorkletFeed,
        feedSpeedMs: tripFeedSpeedMs != null ? Number(tripFeedSpeedMs.toFixed(2)) : null,
        feedMoveM: tripFeedMoveM != null ? Number(tripFeedMoveM.toFixed(2)) : null,
        chaseM: chaseM > 0 ? Number(chaseM.toFixed(2)) : null,
        rawToMarkerM,
        roadPts: (opts?.roadPts ?? drivingSnapGeometryRef.current).length,
        speedKmhRef: Number(speedKmhRef.current.toFixed(1)),
        glideMs: tripGlideMs,
        feedSource: tripFeedSource,
        lastFeedAgeMs: lastWorkletFeedAtRef.current > 0
          ? Date.now() - lastWorkletFeedAtRef.current
          : null,
      }, 700);
      return;
    }

    lastSetLocRef.current = { lat, lng };
    if (opts?.commitGood || isDrivingRef.current) {
      lastGoodLocRef.current = { lat, lng };
    }

    feedDRRef.current(
      { latitude: lat, longitude: lng },
      speedMs,
      heading,
    );
    const tripActive = isNavigatingRef.current || isDrivingRef.current;
    const isInstant = !!opts?.instant;
    if (tripActive && !isInstant) {
      // DR.onFrame karmi worklet, marker płynie sam. Tylko publishUserLocation
      // dla socket/UI; refy DR aktualizuje DR onFrame.
      publishUserLocation({ latitude: lat, longitude: lng }, opts?.forcePublish ?? true);
      lastBumpActiveMarkerAtRef.current = Date.now();
      return;
    }
    bumpActiveMarker(lat, lng, {
      heading,
      forcePublish: opts?.forcePublish ?? true,
      instant: isInstant,
    });
  }, [bumpActiveMarker, publishUserLocation, clearSubAnchorTimers, feedWorkletAnchorsAlongRoad, pushTripCameraFromApply]);

  useEffect(() => {
    applyTripPositionRef.current = applyTripPosition;
  }, [applyTripPosition]);

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
    const mem = drivingSnapGeometryRef.current;
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
        clientSnapHierarchy: V10_CLIENT_FIRST,
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
        simpleMarkerInDriving: V10_CLIENT_FIRST,
        lightWorkletPosition: V10_CLIENT_FIRST,
        noDrInDriving: V10_CLIENT_FIRST,
        gpsPipelineSimplified: V10_CLIENT_FIRST,
        rescueMechanismsDisabled: V10_CLIENT_FIRST,
        apiMapMatchCooldown60s: V10_CLIENT_FIRST,
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
        v10_26_gateFreePushTarget: DRIVE_CORE_V2,
        v10_27_shapeSourceMarkerNoMarkerView: DRIVE_CORE_V2,
        v10_27_1_noAnimatedShapeSource: DRIVE_CORE_V2,
        v10_27_2_noMapboxImagesSymbolLayer: DRIVE_CORE_V2,
        v10_27_cameraFromDriveMarkerSv60fps: DRIVE_CORE_V2,
        v10_27_noGpsTickCameraPush: DRIVE_CORE_V2,
        v10_28_navHudDopplerMerge: DRIVE_CORE_V2,
        v10_28_navV2RejectRawGlide: DRIVE_CORE_V2,
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
  const [locationReady, setLocationReady] = useState(() => peekMapLastLocation() != null);
  /** true tylko gdy nie mamy żadnej pozycji do pokazania — nie blokuje live GPS przy słabszym sygnale. */
  const [gpsAcquiring, setGpsAcquiring] = useState(() => peekMapLastLocation() == null);
  const gpsAcquiringRef = useRef(gpsAcquiring);

  // ── State – nawigacja ─────────────────────────────────────
  const [isNavigating, setIsNavigating] = useState(false);
  const [navStartLoc,  setNavStartLoc]  = useState<LocationState | null>(null);
  const [currentStep,  setCurrentStep]  = useState(0);
  const currentStepRef = useRef(0);
  currentStepRef.current = currentStep;
  const [offRoute,     setOffRoute]     = useState(false);
  const offRouteRef = useRef(false);
  offRouteRef.current = offRoute;
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
  const [routeInfo,    setRouteInfo]    = useState<RouteInfo | null>(null);
  /** Ref synced every render — GPS callback must not depend on `routeInfo` (object churn resubscribes watch). */
  const routeInfoRef = useRef(routeInfo);
  routeInfoRef.current = routeInfo;
  const [isOffroadRoute, setIsOffroadRoute] = useState(false);

  // ── State – dr tick ───────────────────────────────────────
  // ── NOWY State — tryb driving ─────────────────────────────
  const [isDriving,    setIsDriving]    = useState(false);
  useEffect(() => {
    if (!isNavigating && !isDriving) return;
    const tag = 'vroom-map-nav';
    activateKeepAwakeAsync(tag).catch(() => {});
    return () => {
      deactivateKeepAwake(tag).catch(() => {});
    };
  }, [isNavigating, isDriving]);
  /** Co 5 s w trip — widać w logcat nawet po krótkim buforze / restarcie procesu. */
  useEffect(() => {
    if (!isDriving && !isNavigating) return;
    const beat = () => {
      const loc = lastGoodLocRef.current;
      driveTraceHeartbeat({
        driving: isDrivingRef.current,
        navigating: isNavigatingRef.current,
        tripActive: isDrivingRef.current || isNavigatingRef.current,
        lat: loc?.lat,
        lng: loc?.lng,
        gpsAgeMs: lastGpsTickAtRef.current > 0 ? Date.now() - lastGpsTickAtRef.current : null,
      });
    };
    beat();
    const id = setInterval(beat, 5000);
    return () => clearInterval(id);
  }, [isNavigating, isDriving]);
  const [mapFabModalVisible, setMapFabModalVisible] = useState(false);
  const isMapFocusedRef = useRef(true);
  const [isMapFocused, setIsMapFocused] = useState(true);
  /** Opóźnione wyłączenie live — unika mrugania socketu przy szybkim przełączeniu tabów. */
  const [liveMapEnabled, setLiveMapEnabled] = useState(true);
  const navProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraSpeedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveSendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapMatchApplySeqRef = useRef(0);

  // ── State — live distances (nawigacja) ────────────────────
  const [distToTurnM,     setDistToTurnM]     = useState<number | null>(null);
  const [remainingDistKm, setRemainingDistKm] = useState<number | null>(null);

  // ── State – markery ───────────────────────────────────────
  const [carMarkerImage,      setCarMarkerImage]      = useState<string | null>(null);
  const [arrowMarkerImage,    setArrowMarkerImage]    = useState<string | null>(null);
  const [myAvatarUrl,         setMyAvatarUrl]         = useState<string | null>(null);
  const [myUsername,          setMyUsername]          = useState('');
  const [markerImages,        setMarkerImages]        = useState<Record<string, string>>({});
  const [markerImageSignatures, setMarkerImageSignatures] = useState<Record<string, string>>({});
  const [pinImages,           setPinImages]           = useState<Record<string, string>>({});
  const [routeEndpointImages, setRouteEndpointImages] = useState<{ start?: string; end?: string }>({});

  // ── State – UI ────────────────────────────────────────────
  const [mapType,            setMapType]            = useState('standard');
  const [settingsVisible,    setSettingsVisible]    = useState(false);
  const [reportVisible,      setReportVisible]      = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [userInfoVisible,    setUserInfoVisible]    = useState(false);
  const [selectedUser,       setSelectedUser]       = useState<User | null>(null);
  const [isSpeechEnabled,    setIsSpeechEnabled]    = useState(true);
  const mapSpeechHydratedRef = useRef(false);
  const [saveRouteVisible,   setSaveRouteVisible]   = useState(false);
  const [remainingRoutePoints, setRemainingRoutePoints] = useState<
    { latitude: number; longitude: number }[]
  >([]);
  const [selectedRouteIndex,   setSelectedRouteIndex]   = useState(0);
  const [tripStatsVisible,     setTripStatsVisible]     = useState(false);
  const [cameraImages,         setCameraImages]         = useState<Record<string, string>>({});
  const [addCameraVisible,     setAddCameraVisible]     = useState(false);
  const [cameraPickMode,       setCameraPickMode]       = useState(false);
  const [manualTargetPickMode, setManualTargetPickMode] = useState(false);
  const [pendingAddCameraParams, setPendingAddCameraParams] = useState<{
    maxspeed: number | null;
    type: CameraType;
    description: string | null;
  } | null>(null);
  const pickCenterRef = useRef<{ lat: number; lng: number }>({ lat: 0, lng: 0 });
  const [selectedCamera,       setSelectedCamera]       = useState<any>(null);
  const [cameraDetailVisible,  setCameraDetailVisible]  = useState(false);
  const { snapCameras } = useSnapCameras();
  const [snappedCameras, setSnappedCameras] = useState<any[]>([]);
  const [stableStartLocation, setStableStartLocation] = useState<LocationState | null>(null);

  // ── State – fuel stations ─────────────────────────────────
  const [selectedFuelStation,     setSelectedFuelStation]     = useState<any>(null);
  const [fuelStationModalVisible, setFuelStationModalVisible] = useState(false);
  const [selectedPartnerPoi, setSelectedPartnerPoi] = useState<PartnerPoi | null>(null);
  const [partnerPoiModalVisible, setPartnerPoiModalVisible] = useState(false);
  const [fuelAddMode, setFuelAddMode] = useState(false);
  const [addFuelStationVisible, setAddFuelStationVisible] = useState(false);
  const [addFuelStationCoords, setAddFuelStationCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const { stations: fuelStations, updatePrices: updateFuelPrices, refetch: refetchFuelStations, onLocationChange: onFuelLocationChange, createStation: createFuelStation } = useFuelStations(userLocation);
  const { pois: partnerPois } = usePartnerPois(userLocation);
  // ── State – live / ostrzeżenia ────────────────────────────
  const [isSharing,           setIsSharing]           = useState(true);
  const isSharingRef          = useRef(true);
  /** Po pierwszym odczycie shareLocation z /api/profile/me — wtedy syncujemy flagę BG. */
  const [sharingHydrated,    setSharingHydrated]    = useState(false);
  const [isSubmittingWarning, setIsSubmittingWarning] = useState(false);
  const [selectedWarning,     setSelectedWarning]     = useState<LiveWarning | null>(null);
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

  useEffect(() => {
    void clearTelemetry();
    void logTelemetry('TELEMETRY_BOOT', { scope: 'map_screen' });
  }, []);

  // ─────────────────────────────────────────────────────────
  // Hooki
  // ─────────────────────────────────────────────────────────

  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { isPremium } = useSubscriptionStatus();
  const isPremiumRef = useRef(isPremium);
  useEffect(() => {
    isPremiumRef.current = isPremium;
  }, [isPremium]);
  const { activeSkin: cursorSkinActive } = useCursorSkin();
  const cursorSkinOverlay = cursorSkinActive?.imageUrl
    ? { imageUrl: cursorSkinActive.imageUrl, borderColor: cursorSkinActive.borderColor }
    : null;
  const { startConversation } = useChat();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const styles = makeMapStyles(theme, isDark, insets.top, { mapControlsTop: 12 });
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
  const mapStyle = resolveMapStyle(mapType, isDark);
  const enableThreeDScene = mapType !== 'satellite';
  const isTripActiveMap = isNavigating || isDriving;
  const getTripActive = useCallback(
    () => isDrivingRef.current || isNavigatingRef.current,
    [],
  );
  /** V2: kamera z tego samego workletu co marker (60 fps). */
  const driveMarkerCameraSinkRef = useRef<DriveMarkerCameraSink>({
    enabled: false,
    onFrame: () => {},
  });
  /** V2: marker 60 FPS — useDriveMarker SV + DriveMarkerLayer. */
  const useSmoothWorkletPath = isTripActiveMap && !DRIVE_CORE_V2;
  /** Hook zawsze załączony — trip start/stop tylko przez getTripActive (bez lagu React state). */
  const driveMarker = useDriveMarker(true, getTripActive, driveMarkerCameraSinkRef);
  const driveCore = useDriveCore({
    isDriving,
    isNavigating,
    getTripActive,
    onPoseAfterMatch: (out) => {
      if (!isDrivingRef.current && !isNavigatingRef.current) return;
      const engineKmh = normalizeHudSpeedKmh(out.speedKmh);
      const doppler = rawGpsKmhRef.current;
      const hudKmh = mergeTripHudKmh(engineKmh, doppler);
      if (hudKmh >= 1 || doppler >= 8) {
        speedKmhRef.current = Math.max(hudKmh, speedKmhRef.current);
        emitSpeedometerKmh(speedKmhRef.current);
      }
      // SSOT: bez aktualizacji pozycji markera (async map-match ≠ GPS stream).
      lastAcceptedFixWallClockRef.current = Date.now();
    },
  });
  const driveCoreProcessRef = useRef<
    (lat: number, lng: number, acc: number, ts: number, gpsSpeedMs: number | null) => boolean
  >(() => false);
  /** Worklet 60fps — hook na MapScreen, zeby handler byl zarejestrowany PRZED feedem z GPS. */
  const tripSmoothPosition = useSmoothMapPosition(useSmoothWorkletPath);

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
      if (!V10_CLIENT_FIRST || !tripActive || !inBackground) return;

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
        feedSmoothPositionTarget({
          latitude: next.latitude,
          longitude: next.longitude,
          heading: p.hdg,
          durationMs: 120,
          speedMs: spd,
          source: 'bg_projection',
        });
      }, 500);
    };

    syncBgMarkerTick();
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
      if (next === 'active') {
        bgProjectionCooldownUntilRef.current = Date.now() + BG_PROJECTION_COOLDOWN_MS;
        stopBgMarkerTick();
      }
      syncBgMarkerTick();
    });
    return () => {
      sub.remove();
      stopBgMarkerTick();
    };
  }, [isTripActiveMap]);

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
    snap: drivingSnap,
    setRoutePoints: setSnapPoints,
    setRoadMatchPoints,
    resetSnapState,
    reset: resetSnap,
  } = useDrivingSnap();
  const driveTracking = useDriveTrackingPipeline();
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
    if (
      drLatRef.current !== 0
      && drLngRef.current !== 0
      && Date.now() - drLastFrameAtRef.current <= DR_STALE_MS
    ) {
      return { latitude: drLatRef.current, longitude: drLngRef.current };
    }
    if (lastSetLocRef.current) {
      return { latitude: lastSetLocRef.current.lat, longitude: lastSetLocRef.current.lng };
    }
    if (lastGoodLocRef.current) {
      return { latitude: lastGoodLocRef.current.lat, longitude: lastGoodLocRef.current.lng };
    }
    const u = currentLocRef.current;
    if (u && Number.isFinite(u.latitude) && Number.isFinite(u.longitude)) {
      return { latitude: u.latitude, longitude: u.longitude };
    }
    return null;
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
    opts?: { maxStepM?: number; instant?: boolean },
  ) => {
    if (!isDrivingRef.current && !isNavigatingRef.current) return;
    if (DRIVE_CORE_V2) {
      const resyncSpeedMs = speedKmh > 0
        ? speedKmh / 3.6
        : (rawGpsKmhRef.current > 0 ? rawGpsKmhRef.current / 3.6 : null);
      const handled = driveCoreProcessRef.current(
        rawLat,
        rawLng,
        acc ?? 12,
        Date.now(),
        resyncSpeedMs,
      );
      if (handled) return;
    }
    const snap = drivingSnap(rawLat, rawLng, speedKmh, isNavigatingRef.current, true, acc ?? null);
    if (!snap.snapped || !Number.isFinite(snap.latitude) || !Number.isFinite(snap.longitude)) return;

    const anchor = resolveDrivingAnchor();
    let lat = snap.latitude;
    let lng = snap.longitude;
    if (anchor) {
      const moveBearing = bearingBetween(
        anchor.latitude,
        anchor.longitude,
        snap.latitude,
        snap.longitude,
      );
      const headingRef = lastHeadingRef.current || snap.targetHeading || 0;
      const headingDelta = Math.abs(((moveBearing - headingRef + 540) % 360) - 180);
      const moveFromAnchorM = haversineKm(
        anchor.latitude,
        anchor.longitude,
        snap.latitude,
        snap.longitude,
      ) * 1000;
      const likelyBackJump =
        speedKmh >= 12
        && moveFromAnchorM >= 10
        && headingDelta > 120;
      if (likelyBackJump) {
        return;
      }
      const defaultStep = speedKmh < DRIVING_ENTRY_STATIONARY_KMH ? 15 : 36;
      const maxStepM = opts?.maxStepM ?? defaultStep;
      const c = clampCoordStep(anchor, { latitude: snap.latitude, longitude: snap.longitude }, maxStepM);
      lat = c.latitude;
      lng = c.longitude;
    }

    // Karm DR — marker będzie lerpował płynnie. NIE nadpisuj drLatRef i NIE bump.
    // Wyjątek: instant=true (driving entry) — wtedy snapuj wszystko, bo to bootstrap.
    if (opts?.instant) {
      drLatRef.current = lat;
      drLngRef.current = lng;
      lastSetLocRef.current = { lat, lng };
      lastGoodLocRef.current = { lat, lng };
      publishUserLocation({ latitude: lat, longitude: lng }, true);
      feedDRRef.current({ latitude: lat, longitude: lng }, (speedKmh / 3.6), snap.targetHeading);
      bumpActiveMarker(lat, lng, {
        heading: snap.targetHeading,
        forcePublish: true,
        instant: true,
      });
      return;
    }
    lastSetLocRef.current = { lat, lng };
    lastGoodLocRef.current = { lat, lng };
    feedDRRef.current({ latitude: lat, longitude: lng }, (speedKmh / 3.6), snap.targetHeading);
    publishUserLocation({ latitude: lat, longitude: lng }, true);
  }, [drivingSnap, publishUserLocation, resolveDrivingAnchor, bumpActiveMarker, DRIVE_CORE_V2]);

  const applyRoadMatchPoints = useCallback((
    pts: { latitude: number; longitude: number }[] | null | undefined,
    opts?: { skipResync?: boolean },
  ) => {
    const list = pts && pts.length >= 2 ? pts : [];
    if (list.length < 2) {
      if (pts && pts.length === 0) {
        drivingSnapUsesMatchedRef.current = false;
        drivingSnapGeometryRef.current = routePointsRef.current.length >= 2
          ? routePointsRef.current
          : [];
        roadMatchSigRef.current = '';
      }
      return;
    }
    const densified = densifyPolyline(list, list.length <= 4 ? 6 : 8);
    const sig = `${densified.length}:${densified[0].latitude.toFixed(5)},${densified[0].longitude.toFixed(5)},${densified[densified.length - 1].latitude.toFixed(5)},${densified[densified.length - 1].longitude.toFixed(5)}`;
    if (sig === roadMatchSigRef.current) return;

    const prevGeom = drivingSnapGeometryRef.current;
    const shiftM = prevGeom.length >= 2 ? roadPolylineShiftM(prevGeom, densified) : 0;

    // Nie stosuj krótkiego cache — psuje snap (marker stoi / obrót w bok).
    if (densified.length <= 8 && prevGeom.length >= 4 && shiftM > 35) {
      vroomGpsLog('ROAD_MATCH_SKIP_TRUNCATED', {
        pts: densified.length,
        prevPts: prevGeom.length,
        shiftM: Math.round(shiftM),
      }, 3000);
      return;
    }
    if (densified.length <= 4 && prevGeom.length >= 2) {
      vroomGpsLog('ROAD_MATCH_SKIP_TRUNCATED', {
        pts: densified.length,
        prevPts: prevGeom.length,
        shiftM: Math.round(shiftM),
      }, 3000);
      return;
    }
    // Geometria przesunięta w bok (równoległa ulica) — nie psuj snapu.
    if (prevGeom.length >= 2 && shiftM > 55) {
      vroomGpsLog('ROAD_MATCH_SKIP_SHIFT', {
        pts: densified.length,
        prevPts: prevGeom.length,
        shiftM: Math.round(shiftM),
      }, 3000);
      return;
    }

    roadMatchSigRef.current = sig;
    setRoadMatchPoints(densified);
    drivingSnapGeometryRef.current = densified;
    drivingSnapUsesMatchedRef.current = true;
    roadGeometryStore.insert(list).catch(() => {});

    if (DRIVE_CORE_V2) {
      driveCore.applyMatchGeometry(densified);
    }

    vroomGpsLog('ROAD_MATCH_SOFT_APPLY_V2', {
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
      const maxStepM = shiftM > 80 ? 18 : shiftM > 40 ? 12 : 8;
      resyncSnapAfterRoadGeometry(raw.lat, raw.lng, resyncSpeedKmh, null, {
        maxStepM,
      });
    }
  }, [setRoadMatchPoints, resyncSnapAfterRoadGeometry, driveCore]);

  /** Po async map-match z driveCore — zsynchronizuj geometrię snapu w map.tsx. */
  useEffect(() => {
    driveCore.engine.setCallbacks({
      onPoseAfterMatch: (out) => {
        if (!isDrivingRef.current && !isNavigatingRef.current) return;
        const engineKmh = normalizeHudSpeedKmh(out.speedKmh);
        const doppler = rawGpsKmhRef.current;
        const hudKmh = mergeTripHudKmh(engineKmh, doppler);
        if (hudKmh >= 1 || doppler >= 8) {
          speedKmhRef.current = Math.max(hudKmh, speedKmhRef.current);
          emitSpeedometerKmh(speedKmhRef.current);
        }
        lastAcceptedFixWallClockRef.current = Date.now();
        const pts = driveCore.engine.cache.getPolyline()?.points;
        if (pts && pts.length >= 2) {
          applyRoadMatchPoints(
            pts.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
          );
        }
      },
    });
  }, [driveCore, applyRoadMatchPoints]);

  /** V2 omija legacy GPS block — geometria musi być odświeżana przed driveCoreProcessRef. */
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
    const needsLocalResolve =
      drivingSnapGeometryRef.current.length < 2
      && !driveCore.engine.cache.hasGeometry();
    if (needsLocalResolve && nowCf - lastClientFirstResolveRef.current >= CLIENT_FIRST_RESOLVE_MIN_MS) {
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

    // Drive Core V2 batches matching inside driveEngine — avoid duplicate trace calls.
    if (DRIVE_CORE_V2) return;

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
    driveCore,
    resolveLocalRoadPolylineForMatch,
    bumpMatchedFreshness,
  ]);

  const {
    cameras, nearestCamera,
    updateCameras, addCamera, confirmCamera,
    checkAlert, markAlerted, invalidate, deleteCamera,
  } = useSpeedCameras();

  const { speedLimit, updateSpeedLimit } = useSpeedLimit(true);
  const updateSpeedLimitRef = useRef(updateSpeedLimit);
  useEffect(() => {
    updateSpeedLimitRef.current = updateSpeedLimit;
  }, [updateSpeedLimit]);
  const speedKmh = (speed ?? 0) * 3.6;
  const effectiveSpeedLimit = speedLimit ?? (nearestCamera?.maxspeed ?? null);
  const showCameras = true;

  const ALERT_DIST = 400;
  const cameraAlertVisible = nearestCamera !== null && nearestCamera.distanceM <= ALERT_DIST;

  useEffect(() => {
    if (!nearestCamera) return;
    if (!checkAlert(nearestCamera, ALERT_DIST)) return;
    markAlerted(nearestCamera.id);
    if (isSpeechEnabled) {
      const dist   = Math.round(nearestCamera.distanceM);
      const isBump = nearestCamera.type === 'bump';
      const msg    = isBump
        ? `uwaga, próg zwalniający za ${dist} metrów`
        : nearestCamera.maxspeed
          ? `uwaga, fotoradar za ${dist} metrów, limit ${nearestCamera.maxspeed} kilometrów na godzinę`
          : `uwaga, fotoradar za ${dist} metrów`;
      speak(msg);
    }
  }, [nearestCamera?.id, nearestCamera?.distanceM, isSpeechEnabled, checkAlert, markAlerted]);

  useEffect(() => {
    const activeIds = new Set(cameras.map(c => String(c.id)));
    setCameraImages(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (!activeIds.has(k)) delete next[k]; });
      return next;
    });
  }, [cameras]);

  // ── mapType persistence ────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('map_type').then(val => {
      if (val) setMapType(val);
    }).catch(() => {});
  }, []);

  // ── voice guidance persistence (nie nadpisuj zanim wczytamy z dysku) ──
  useEffect(() => {
    AsyncStorage.getItem('map_speech_enabled')
      .then((val) => {
        if (val != null) setIsSpeechEnabled(val === '1');
        mapSpeechHydratedRef.current = true;
      })
      .catch(() => { mapSpeechHydratedRef.current = true; });
  }, []);

  useEffect(() => {
    if (!mapSpeechHydratedRef.current) return;
    AsyncStorage.setItem('map_speech_enabled', isSpeechEnabled ? '1' : '0').catch(() => {});
  }, [isSpeechEnabled]);

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
    startTrip, feedSpeed, feedPosition,
    finishTrip, clearStats, stats: tripStats, liveDistanceKm,
  } = useTripStats();

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
    if (tripActive) {
      const nowTs = opts?.now ?? Date.now();
      const netMoveM = opts?.netMoveM ?? 0;
      const motionKmh = opts?.motionKmh ?? 0;
      const sustainedKmh = opts?.sustainedKmh ?? 0;
      const rawGpsKmh = opts?.rawGpsKmh ?? (gpsSpeedMs != null ? gpsSpeedMs * 3.6 : 0);
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
        rawGpsKmh < 15
        && netMoveM < standstillNetM
        && sustainedKmh < 3.5
        && motionKmh < 2.5;
      if (fgRefreshPublish && rawGpsKmh >= 6) {
        stationaryEvidence = false;
      }
      if (drivingMotionEvidence) {
        stationaryEvidence = false;
      }
      let dopplerGhostWhileStill =
        stationaryEvidence
        && rawGpsKmh >= 6
        && rawGpsKmh <= 45;

      let reliableSpeedKmh = display != null && display > 0 ? display * 3.6 : 0;
      if (
        rawGpsKmh >= 8
        && netMoveM >= 8
        && (sustainedKmh >= 4.5 || motionKmh >= 5)
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
        if (motionKmh >= 3 && netMoveM >= 4) {
          reliableSpeedKmh = Math.min(
            MAX_REALISTIC_DRIVING_KMH,
            Math.max(motionKmh, Number.isFinite(derivedKmhEarly) ? derivedKmhEarly : 0),
          );
        } else if (motionKmh >= 6 && netMoveM >= 14) {
          reliableSpeedKmh = Math.min(MAX_REALISTIC_DRIVING_KMH, motionKmh);
        } else if (sustainedKmh >= 6 && netMoveM >= 14) {
          reliableSpeedKmh = Math.min(MAX_REALISTIC_DRIVING_KMH, sustainedKmh);
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
          reliableSpeedKmh > MAX_REALISTIC_DRIVING_KMH + 15
          || (
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
            && rawGpsKmh >= 15
            && netMoveM >= 14
            && motionKmh >= 10
          ) {
            reliableSpeedKmh = Math.min(MAX_SPEED_HUD_KMH, rawGpsKmh);
          } else {
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
        && motionKmh >= 6
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
        reliableSpeedKmh = Math.min(
          MAX_REALISTIC_DRIVING_KMH,
          Math.max(rawGpsKmh, motionKmh, sustainedKmh, 6),
        );
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
      reliableSpeedKmh = Math.max(0, Math.min(MAX_SPEED_HUD_KMH, reliableSpeedKmh));
      if (reliableSpeedKmh > 0.5 && !stationaryEvidence) {
        lastReliableSpeedMsRef.current = Math.min(
          reliableSpeedKmh / 3.6,
          MAX_REALISTIC_DRIVING_KMH / 3.6,
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
        && reliableSpeedKmh >= 8
        && reliableSpeedKmh <= MAX_REALISTIC_DRIVING_KMH
        && peakNetM >= 15
        && peakSustained >= 8
        && dopplerPeakOk;
      const peakKmh = Math.min(MAX_REALISTIC_DRIVING_KMH, reliableSpeedKmh);
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
    feedSpeedSample(display, peakTrusted);
    feedSpeed(display != null && display > 0 ? display : null);
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
    const currentSpeedKmh = Math.min(
      MAX_REALISTIC_DRIVING_KMH,
      MAX_SPEED_HUD_KMH,
      Math.max(
        0,
        Number(speedKmhRef.current || 0),
        Number(liveAchSessionPeakSpeedRef.current || 0),
        includeTripEndPeak ? Math.min(MAX_REALISTIC_DRIVING_KMH, Number(extraPeakKmh || 0)) : 0,
      ),
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
    const currentSpeedKmh = Math.min(
      MAX_SPEED_HUD_KMH,
      Math.max(
        0,
        Number(speedKmhRef.current || 0),
        Number(liveAchSessionPeakSpeedRef.current || 0),
      ),
    );
    const projectedDistanceKm = Math.max(
      0,
      Number(profileTotalDistanceKmRef.current || 0) + Number(liveDistanceKm || 0),
    );
    if (currentSpeedKmh - liveAchLastSpeedSubmittedRef.current >= LIVE_ACHIEVEMENT_SPEED_DELTA_TRIGGER_KMH) {
      void checkLiveAchievements('speed');
      return;
    }
    if (projectedDistanceKm - liveAchLastDistanceSubmittedRef.current >= LIVE_ACHIEVEMENT_DISTANCE_DELTA_TRIGGER_KM) {
      void checkLiveAchievements('distance');
    }
  }, [isDriving, isNavigating, liveDistanceKm, checkLiveAchievements]);

  /** Checkpoint km w trakcie jazdy — profil i serwer nie czekają na koniec trasy. */
  useEffect(() => {
    if (!(isDriving || isNavigating)) {
      tripCheckpointSavedKmRef.current = 0;
      return;
    }
    const unsavedKm = Number(liveDistanceKm || 0) - tripCheckpointSavedKmRef.current;
    if (unsavedKm < TRIP_CHECKPOINT_KM || tripCheckpointInFlightRef.current) return;

    const chunkKm = Math.floor(unsavedKm / TRIP_CHECKPOINT_KM) * TRIP_CHECKPOINT_KM;
    if (chunkKm < TRIP_CHECKPOINT_KM) return;

    tripCheckpointInFlightRef.current = true;
    void (async () => {
      try {
        const ok = await saveIncrementalTripKm({
          distanceKm: chunkKm,
          maxSpeedKmh: tripPeakSpeedRef.current,
        });
        if (ok) {
          tripCheckpointSavedKmRef.current += chunkKm;
          profileTotalDistanceKmRef.current += chunkKm;
        }
      } finally {
        tripCheckpointInFlightRef.current = false;
      }
    })();
  }, [liveDistanceKm, isDriving, isNavigating]);

  useEffect(() => {
    if (!(isDriving || isNavigating)) return;
    const id = setInterval(() => {
      void flushTracePendingKmToStorage();
    }, 60_000);
    return () => clearInterval(id);
  }, [isDriving, isNavigating]);

  useEffect(() => {
    if (!(isDriving || isNavigating)) return;
    const id = setInterval(() => {
      if (appStateRef.current !== 'active') return;
      if (!isMapFocusedRef.current) return;
      void checkLiveAchievements('periodic');
    }, LIVE_ACHIEVEMENT_PERIODIC_MS);
    return () => clearInterval(id);
  }, [isDriving, isNavigating, checkLiveAchievements]);

  useEffect(() => {
    if (!(isDriving || isNavigating)) return;
    const id = setInterval(() => {
      const now = Date.now();
      const gpsAgeMs = lastAcceptedFixWallClockRef.current > 0
        ? now - lastAcceptedFixWallClockRef.current
        : Number.POSITIVE_INFINITY;
      const drAgeMs = drLastFrameAtRef.current > 0
        ? now - drLastFrameAtRef.current
        : Number.POSITIVE_INFINITY;
      const gpsTickAgeMs = lastGpsTickAtRef.current > 0
        ? now - lastGpsTickAtRef.current
        : Number.POSITIVE_INFINITY;
      const gpsToDriftM = (
        lastGoodLocRef.current
        && drLatRef.current !== 0
        && drLngRef.current !== 0
      )
        ? haversineKm(
          lastGoodLocRef.current.lat,
          lastGoodLocRef.current.lng,
          drLatRef.current,
          drLngRef.current,
        ) * 1000
        : null;
      const snapAnchorDriftM = (
        lastSetLocRef.current
        && drLatRef.current !== 0
        && drLngRef.current !== 0
      )
        ? haversineKm(
          lastSetLocRef.current.lat,
          lastSetLocRef.current.lng,
          drLatRef.current,
          drLngRef.current,
        ) * 1000
        : null;
      vroomGpsLog('DRIVE_HEALTH', {
        mode: isNavigatingRef.current ? 'navigation' : (isDrivingRef.current ? 'driving' : 'idle'),
        speedHudKmh: Number((speedKmhRef.current || 0).toFixed(1)),
        speedPipeKmh: Number((speedKmhRef.current || 0).toFixed(1)),
        gpsAgeMs: Number.isFinite(gpsAgeMs) ? Math.round(gpsAgeMs) : null,
        drAgeMs: Number.isFinite(drAgeMs) ? Math.round(drAgeMs) : null,
        gpsToDriftM: gpsToDriftM != null ? Math.round(gpsToDriftM) : null,
        snapAnchorDriftM: snapAnchorDriftM != null ? Math.round(snapAnchorDriftM) : null,
        offRoute: offRouteRef.current,
        reroutePending: reroutePendingRef.current,
        rerouteLoading: rerouteOrigin != null || reroutePendingRef.current,
        hasRoutePts: routePointsRef.current.length,
      }, DRIVE_HEALTH_LOG_MS);
    }, 5000);
    return () => clearInterval(id);
  }, [isDriving, isNavigating, rerouteOrigin]);

  const {
    liveUserIds, liveMapStore, warnings, connected,
    sendLocation, toggleSharing, resumeLiveSession, addWarning, confirmWarning, cancelWarning,
  } = useLiveMap(
    isSharing,
    userLocation,
    isSpeechEnabled,
    settings.backgroundTracking || isSharing,
    liveMapEnabled && (isSharing || isMapFocused),
    isTripActiveMap,
  );

  useEffect(() => {
    if (isMapFocused) {
      setLiveMapEnabled(true);
      return;
    }
    const t = setTimeout(() => setLiveMapEnabled(false), 800);
    return () => clearTimeout(t);
  }, [isMapFocused]);

  const liveResumeOnLocRef = useRef(false);
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
        // Preferencja live (przełącznik) — domyślnie ON; OFF tylko po jawnym wyłączeniu przez usera.
        let userPref = await AsyncStorage.getItem(LIVE_SHARING_USER_PREF_KEY);
        if (userPref == null) {
          const legacyBg = await AsyncStorage.getItem(BG_IS_SHARING_KEY);
          if (legacyBg === 'true') {
            userPref = 'true';
          } else {
            userPref = 'true';
            await AsyncStorage.setItem(LIVE_SHARING_USER_PREF_KEY, 'true');
          }
        }
        if (!cancelled) {
          setIsSharing(userPref !== 'false');
        }

        const token = await AsyncStorage.getItem('token');
        if (!token) return;
        const res = await fetch(`${API_URL}/api/profile/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled || !data) return;
        const profileAvatar = data.avatarUrl ?? data.avatar ?? null;
        if (profileAvatar && typeof profileAvatar === 'string') {
          setMyAvatarUrl(
            profileAvatar.startsWith('http')
              ? profileAvatar
              : `${API_URL}${profileAvatar.startsWith('/') ? profileAvatar : `/${profileAvatar}`}`,
          );
        }
        const userOptedOutLive = userPref === 'false';
        if (!cancelled) {
          if (userOptedOutLive) {
            setIsSharing(false);
          } else {
            setIsSharing(true);
            await AsyncStorage.setItem(LIVE_SHARING_USER_PREF_KEY, 'true');
            void resumeLiveSession();
          }
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
  }, [resumeLiveSession]);

  useEffect(() => {
    if (!isMapFocused || !sharingHydrated) return;
    void (async () => {
      const optedOut = await AsyncStorage.getItem(LIVE_SHARING_USER_PREF_KEY);
      if (optedOut === 'false') return;
      setIsSharing(true);
      await resumeLiveSession();
    })();
  }, [isMapFocused, sharingHydrated, resumeLiveSession]);

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
    setFollowMode,
    setTripCameraActive,
    getLastProgrammaticCameraApplyMs,
    isUserExploringMap,
    resumeTripCameraFollow,
    syncUserExploreView,
    notifyUserMapInteraction,
    getLastAppliedCameraZoom,
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
      return;
    }
    resetBrowseCamera(center, { animate: opts?.animate !== false });
  }, [resolveBrowseCameraCenter, resetBrowseCamera, releaseTripCameraState]);

  /** Po wyjściu z jazdy/nawigacji: widok browse (zoom, pitch, padding, północ). */
  useEffect(() => {
    const wasTrip = prevTripActiveMapRef.current;
    prevTripActiveMapRef.current = isTripActiveMap;
    if (isTripActiveMap) return;
    clearSmoothPositionFeed();
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

  useEffect(() => () => {
    disposeTripCameraScheduler();
    resetSpeedometerEmitterThrottle();
  }, [disposeTripCameraScheduler]);

  useEffect(() => {
    if (!DRIVE_CORE_V2) return;
    driveCoreProcessRef.current = (lat, lng, accuracy, timestamp, gpsSpeedMs) => {
      const out = driveCore.onRawGps({
        lat,
        lng,
        accuracy,
        timestamp,
        gpsSpeedMs,
      });
      if (!out) return false;

      const dopplerKmhTick = gpsSpeedMs != null && gpsSpeedMs >= 0
        ? normalizeHudSpeedKmh(gpsSpeedMs * 3.6)
        : 0;
      const engineKmh = normalizeHudSpeedKmh(out.speedKmh);
      const isFreeDriveTick = !isNavigatingRef.current;
      const parkedLike = !out.isMoving
        && engineKmh < 2.5
        && dopplerKmhTick < 4;
      const hudKmh = parkedLike
        ? Math.min(engineKmh, dopplerKmhTick)
        : mergeTripHudKmh(engineKmh, dopplerKmhTick);
      speedKmhRef.current = hudKmh;
      rawGpsKmhRef.current = dopplerKmhTick > 0 ? dopplerKmhTick : hudKmh;
      emitSpeedometerKmh(hudKmh);

      const cachePts = driveCore.engine.cache.getPolyline()?.points ?? null;
      const roadPolylines = collectTripRoadPolylines(
        drivingSnapGeometryRef.current,
        routePointsRef.current,
        !isFreeDriveTick,
        cachePts,
      );

      let displayLat = lat;
      let displayLng = lng;
      let displayHdg = normalizeHeading(
        Number.isFinite(out.pose.heading) ? out.pose.heading : 0,
      );
      let onRoad = false;
      const hasRoadGeometry = roadPolylines.some((p) => p.length >= 2);
      // Snap gdy jest geometria — raw tylko bez drogi w cache (nie „zawsze >40 km/h”).
      const freeDriveRaw = isFreeDriveTick && !hasRoadGeometry;

      if (!freeDriveRaw) {
        const headingHint = headingForDriveMarker(
          displayLat,
          displayLng,
          { heading: out.pose.heading, crossTrackM: out.pose.crossTrackM },
          hudKmh,
          lat,
          lng,
        );

        try {
          const snapped = resolveRoadMarkerPose({
            prev: lastTripMarkerPoseRef.current,
            enginePose: out.pose,
            roadPolylines,
            speedKmh: hudKmh,
            travelHeadingDeg: headingHint,
            rawLat: lat,
            rawLng: lng,
            isNavigating: !isFreeDriveTick,
            lastSegmentIndex: getRoadMarkerSegmentIndex(),
          });
          if (Number.isFinite(snapped.lat) && Number.isFinite(snapped.lng)) {
            displayLat = snapped.lat;
            displayLng = snapped.lng;
            onRoad = snapped.onRoad;
            if (Number.isFinite(snapped.heading)) {
              displayHdg = normalizeHeading(snapped.heading);
            }
            visionEvent('SNAP_SOURCE', {
              source: 'drive_core_road_marker_pose',
              onRoad: snapped.onRoad,
              crossTrackM: out.pose.crossTrackM,
              snappedLat: Number(displayLat.toFixed(6)),
              snappedLng: Number(displayLng.toFixed(6)),
              rawLat: Number(lat.toFixed(6)),
              rawLng: Number(lng.toFixed(6)),
              speedKmh: Math.round(hudKmh),
            });
            if (!snapped.onRoad) {
              visionEvent('OFF_ROAD', {
                source: 'resolveRoadMarkerPose',
                crossTrackM: out.pose.crossTrackM,
                rawLat: Number(lat.toFixed(6)),
                rawLng: Number(lng.toFixed(6)),
                action: 'marker_pose_off_road',
              });
            }
          }
        } catch {
          displayLat = lat;
          displayLng = lng;
        }
      } else {
        displayLat = lat;
        displayLng = lng;
        onRoad = false;
      }

      const engineSnapLat = freeDriveRaw ? out.pose.lat : displayLat;
      const engineSnapLng = freeDriveRaw ? out.pose.lng : displayLng;
      let markerRawGapM = freeDriveRaw
        ? 0
        : haversineKm(displayLat, displayLng, lat, lng) * 1000;
      let catchupSoft = false;
      let chaseM = 0;
      // Longitudinal catch-up is handled inside resolveRoadMarkerPose (1D arc progress).
      // Only chase off-road when snap failed and gap is large.
      if (!freeDriveRaw && !parkedLike && !onRoad && markerRawGapM > 28 && hudKmh >= 5) {
        const chaseSnapLat = markerRawGapM > 42 ? lat : out.pose.lat;
        const chaseSnapLng = markerRawGapM > 42 ? lng : out.pose.lng;
        const bestRoad = roadPolylines.reduce(
          (best, poly) => (poly.length > best.length ? poly : best),
          [] as { latitude: number; longitude: number }[],
        );
        const tripSpeedMs = hudKmh >= 1.5 ? hudKmh / 3.6 : 0;
        const advanced = advanceV10MarkerTowardRaw(
          displayLat,
          displayLng,
          chaseSnapLat,
          chaseSnapLng,
          lat,
          lng,
          bestRoad,
          tripSpeedMs,
          hudKmh,
        );
        if (advanced.chaseM > 0.5) {
          chaseM = advanced.chaseM;
          displayLat = advanced.latitude;
          displayLng = advanced.longitude;
          onRoad = bestRoad.length >= 2;
        }
        markerRawGapM = haversineKm(displayLat, displayLng, lat, lng) * 1000;
      }
      if (!parkedLike && catchupSoft) {
        vroomGpsLog('MARKER_RAW_CATCHUP', {
          hudKmh: Math.round(hudKmh),
          rawLat: Number(lat.toFixed(5)),
          rawLng: Number(lng.toFixed(5)),
        }, 1200);
      } else if (!parkedLike && markerRawGapM > 75) {
        resetRoadMarkerPoseState();
        vroomGpsLog('MARKER_STUCK', {
          markerRawGapM: Math.round(markerRawGapM),
          hudKmh: Math.round(hudKmh),
          snapLat: Number(displayLat.toFixed(5)),
          rawLat: Number(lat.toFixed(5)),
        });
      }

      if (parkedLike && markerRawGapM > 8) {
        displayLat = lat;
        displayLng = lng;
        markerRawGapM = 0;
      }

      if (!(onRoad || out.isMoving || hudKmh >= 2.5)) {
        const clamped = clampDrivingEntryMarkerPose(
          lat,
          lng,
          displayLat,
          displayLng,
          drivingEntryGraceUntilRef.current,
          drivingEntryAnchorRef.current,
        );
        displayLat = clamped.lat;
        displayLng = clamped.lng;
      }

      if (!onRoad) {
        displayHdg = headingForDriveMarker(
          displayLat,
          displayLng,
          { heading: displayHdg, crossTrackM: out.pose.crossTrackM },
          hudKmh,
          lat,
          lng,
        );
      }

      const cadenceMs = gpsCadenceMsRef.current > 0 && Number.isFinite(gpsCadenceMsRef.current)
        ? gpsCadenceMsRef.current
        : (Number.isFinite(out.durationMs) && out.durationMs > 0 ? out.durationMs : 500);
      const prevPose = lastTripMarkerPoseRef.current;
      const pushSegM = prevPose
        ? haversineKm(prevPose.lat, prevPose.lng, displayLat, displayLng) * 1000
        : 0;
      const tripSpeedMs = hudKmh >= 1.5 ? hudKmh / 3.6 : 2;
      const catchupCorrection =
        catchupSoft
        || chaseM >= 1
        || (!freeDriveRaw && !parkedLike && markerRawGapM > 22 && pushSegM > 4);
      // Animacja musi pokryć pełny interwał GPS — nigdy krócej niż cadenceMs.
      const baseFeedDurMs = Math.max(cadenceMs, 1000);
      let moveDurMs = baseFeedDurMs;
      if (pushSegM > 1.5 && !parkedLike) {
        const impliedMs = (pushSegM / Math.max(tripSpeedMs, 2.5)) * 1000;
        moveDurMs = Math.max(baseFeedDurMs, impliedMs);
        moveDurMs = Math.min(1200, moveDurMs);
      }
      const feedDur = Math.round(moveDurMs);
      const feedSpeedMs = parkedLike
        ? 0
        : computeDriveFeedSpeedMs(hudKmh, dopplerKmhTick, isFreeDriveTick, out.isMoving);
      if (DRIVE_V2_PIPELINE_DEBUG) {
        const isExtremeCatchup =
          catchupSoft
          || catchupCorrection
          || markerRawGapM > 18
          || pushSegM > 15
          || chaseM >= 1;
        if (isExtremeCatchup) {
          console.log('[DEBUG_CATCHUP]', {
            markerRawGapM: round1(markerRawGapM),
            pushSegM: round1(pushSegM),
            feedDur,
            catchupSoft,
            catchupCorrection,
            chaseM: round1(chaseM),
            cadenceMs: Math.round(cadenceMs),
            snapSource: resolveV2SnapSourceLabel({
              isNavigating: !isFreeDriveTick,
              hasRoadGeometry,
              geometrySource: out.geometrySource,
              clientSnapSource: lastClientSnapSourceRef.current,
              freeDriveRaw,
              hasRoutePolyline: routePointsRef.current.length >= 2,
            }),
            geometrySource: out.geometrySource ?? null,
            onRoad,
            freeDriveRaw,
          });
        }
      }
      const snapMarkerBack = parkedLike && pushSegM > 12;

      lastTripMarkerPoseRef.current = { lat: displayLat, lng: displayLng };
      drLatRef.current = displayLat;
      drLngRef.current = displayLng;
      drHdgRef.current = displayHdg;
      lastSetLocRef.current = { lat: displayLat, lng: displayLng };
      lastGoodLocRef.current = { lat, lng };
      lastHeadingRef.current = displayHdg;
      lastGoodTimeRef.current = timestamp;
      lastSegmentDurationMsRef.current = feedDur;
      lastAcceptedFixWallClockRef.current = Date.now();
      lastDriveMarkerPushAtRef.current = Date.now();

      if (!isDriveMarkerBootstrapped(driveMarker)) {
        driveMarker.resetTo(displayLat, displayLng, displayHdg);
      } else if (snapMarkerBack) {
        driveMarker.resetTo(displayLat, displayLng, displayHdg);
      }
      const svHdgBeforePush = driveMarker.heading.value;
      const pipelineHdgFlip = Number.isFinite(svHdgBeforePush)
        ? Math.abs(headingDelta(svHdgBeforePush, displayHdg))
        : 0;
      pushDriveMarkerV2(driveMarker, displayLat, displayLng, displayHdg, {
        durationMs: feedDur,
        hudKmh: parkedLike ? 0 : hudKmh,
        speedMs: feedSpeedMs,
        allowExtrapolation: !parkedLike,
        easeOutPosition: false,
      });
      const svLat = driveMarker.lat.value;
      const svLng = driveMarker.lng.value;
      const svHdg = driveMarker.heading.value;
      const svGapM = Number.isFinite(svLat) && Number.isFinite(svLng)
        ? haversineKm(svLat, svLng, displayLat, displayLng) * 1000
        : 0;
      const hdgFlipDeg = Number.isFinite(svHdg)
        ? Math.abs(headingDelta(svHdg, displayHdg))
        : 0;
      driveTraceMarkerPipeline({
        rawLat: round6(lat),
        rawLng: round6(lng),
        engineSnapLat: round6(engineSnapLat),
        engineSnapLng: round6(engineSnapLng),
        displayLat: round6(displayLat),
        displayLng: round6(displayLng),
        displayHdg: Math.round(displayHdg),
        svLat: Number.isFinite(svLat) ? round6(svLat) : null,
        svLng: Number.isFinite(svLng) ? round6(svLng) : null,
        svHdg: Number.isFinite(svHdg) ? Math.round(svHdg) : null,
        markerRawGapM: round1(markerRawGapM),
        svGapM: round1(svGapM),
        hdgFlipDeg: Math.round(hdgFlipDeg),
        pushSegM: round1(pushSegM),
        feedDurMs: Math.round(feedDur),
        feedSpeedMs: round1(feedSpeedMs),
        hudKmh: round1(hudKmh),
        engineKmh: round1(engineKmh),
        crossTrackM: round1(out.pose.crossTrackM),
        catchupSoft,
        onRoad,
        chaseM: round1(chaseM),
        parkedLike,
        freeDriveRaw,
      });
      drLastFrameAtRef.current = Date.now();
      publishUserLocation({ latitude: displayLat, longitude: displayLng });
      feedSpeed(feedSpeedMs > 0 ? feedSpeedMs : null);
      if (isDrivingRef.current || isNavigatingRef.current) {
        const segKm = feedPosition(
          displayLat,
          displayLng,
          feedSpeedMs > 0.1 ? feedSpeedMs : undefined,
        );
        if (segKm > 0) {
          maybeClearDrivingManualDisable(segKm, Date.now());
        }
        lastDrivingPosRef.current = { lat: displayLat, lng: displayLng };
      }
      void recordDrivingTracePoint(displayLat, displayLng, { speedKmh: out.speedKmh });
      driveTraceTick({
        rawLat: lat,
        rawLng: lng,
        snapLat: displayLat,
        snapLng: displayLng,
        markerLat: displayLat,
        markerLng: displayLng,
        markerHdg: displayHdg,
        markerSvLat: svLat,
        markerSvLng: svLng,
        markerSvHdg: svHdg,
        accM: accuracy,
        hudKmh,
        engineKmh,
        dopplerKmh: dopplerKmhTick,
        feedDurMs: feedDur,
        cadenceMs,
        feedSpeedMs,
        isNavigating: !isFreeDriveTick,
        isFreeDrive: isFreeDriveTick,
        isMoving: out.isMoving,
        source: 'drive_core_v2',
        markerRawGapM,
        svGapM,
        hdgFlipDeg,
        pushSegM,
        catchupSoft,
        onRoad,
        chaseM,
        engineSnapLat,
        engineSnapLng,
        crossTrackM: out.pose.crossTrackM,
      });
      const prevRawAnchor = lastRawForHeadingRef.current;
      const rawStepM = prevRawAnchor
        ? haversineKm(prevRawAnchor.lat, prevRawAnchor.lng, lat, lng) * 1000
        : 0;
      visionTickFromV2({
        mode: isFreeDriveTick ? 'drive' : 'nav',
        rawLat: lat,
        rawLng: lng,
        snapLat: engineSnapLat,
        snapLng: engineSnapLng,
        markerLat: displayLat,
        markerLng: displayLng,
        markerHdg: displayHdg,
        markerSvLat: svLat,
        markerSvLng: svLng,
        markerSvHdg: svHdg,
        accM: accuracy,
        hudKmh,
        engineKmh,
        dopplerKmh: dopplerKmhTick,
        crossTrackM: out.pose.crossTrackM,
        onRoad,
        source: freeDriveRaw ? 'free_drive_raw' : 'drive_core_v2',
        rawStepM,
        markerRawGapM,
        svGapM,
        chaseM,
        catchupSoft,
        hdgFlipDeg,
        pushSegM,
        feedDurMs: feedDur,
        teleportClamp: false,
        megaJumpBlocked: false,
        feedSkipGate: false,
        stationaryHold: parkedLike,
      });
      lastRawForHeadingRef.current = { lat, lng, at: Date.now() };
      if (isDrivingRef.current || isNavigatingRef.current) {
        updateSpeedLimitRef.current(rawLat, rawLng, { nav: true });
      }
      return true;
    };
  }, [driveCore, driveMarker, publishUserLocation, recordDrivingTracePoint, headingForDriveMarker, pushTripCameraFromApply, feedPosition, feedSpeed, maybeClearDrivingManualDisable]);

  useEffect(() => {
    if (!DRIVE_CORE_V2 || !isNavigating) return;
    const pts = routePointsRef.current;
    if (pts.length >= 2) {
      driveCore.setRoutePolyline(pts);
    }
  }, [isNavigating, driveCore, remainingRoutePoints]);

  const resolveCameraFollowHeading = useCallback((
    centerLat: number,
    centerLng: number,
    hintHeading: number,
    speedKmh: number,
  ): number => {
    const hint = normalizeHeading(hintHeading);
    const prev = lastCamResolvedHdgRef.current;

    if (Number.isFinite(prev) && speedKmh < 5) {
      return prev;
    }

    if (!Number.isFinite(prev)) {
      lastCamVehicleForBearingRef.current = { lat: centerLat, lng: centerLng };
      lastCamResolvedHdgRef.current = hint;
      return hint;
    }

    const delta = Math.abs(headingDelta(prev, hint));

    // Skrzyżowanie / ostry skręt — szybko w stronę kierunku jazdy (pipeline SSOT).
    let maxStep: number;
    if (delta >= 75) {
      maxStep = speedKmh >= 25 ? 32 : 22;
    } else if (delta >= 45) {
      maxStep = speedKmh >= 25 ? 22 : 16;
    } else if (delta >= 22) {
      maxStep = speedKmh >= 25 ? 14 : 10;
    } else if (speedKmh >= 40) {
      maxStep = 5;
    } else if (speedKmh >= 20) {
      maxStep = 3.5;
    } else {
      maxStep = 2.5;
    }

    const followHdg = lerpHeadingWithMaxStep(prev, hint, maxStep);
    lastCamVehicleForBearingRef.current = { lat: centerLat, lng: centerLng };
    lastCamResolvedHdgRef.current = followHdg;
    return followHdg;
  }, []);

  const pushCameraFromDriveMarkerFrame = useCallback((
    lat: number,
    lng: number,
    workletHdg?: number,
  ) => {
    if (!DRIVE_CORE_V2) return;
    if (!isDrivingRef.current && !isNavigatingRef.current) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return;
    const motionKmh = Math.max(speedKmhRef.current, rawGpsKmhRef.current);
    const cameraSpeedKmh = motionKmh < 3 ? 0 : motionKmh;
    const pipelineHdg = Number.isFinite(lastHeadingRef.current)
      ? lastHeadingRef.current
      : (drHdgRef.current ?? 0);
    const hintHdg = normalizeHeading(
      Number.isFinite(workletHdg) ? workletHdg! : pipelineHdg,
    );
    const exploring = isUserExploringMapRef.current();
    const now = Date.now();
    const followHdg = hintHdg;
    const prevCam = lastCamPushFromMarkerFrameRef.current;
    const msSinceCamPush = prevCam > 0 ? now - prevCam : 0;
    const prevPushCenter = lastCamPushCenterRef.current;
    const camFrameMoveM = prevPushCenter
      ? haversineKm(prevPushCenter.lat, prevPushCenter.lng, lat, lng) * 1000
      : 999;
    const rawAnchor = lastRawForHeadingRef.current;
    const rawGapM = rawAnchor
      ? haversineKm(rawAnchor.lat, rawAnchor.lng, lat, lng) * 1000
      : 0;
    const camHdgFlip = Math.abs(headingDelta(hintHdg, followHdg));
    if (exploring) {
      driveTraceCamera({
        lat,
        lng,
        hdg: followHdg,
        speedKmh: cameraSpeedKmh,
        exploring: true,
        frameMoveM: 0,
      });
      return;
    }
    lastCamPushFromMarkerFrameRef.current = now;
    lastCamPushCenterRef.current = { lat, lng };
    driveTraceCameraPipeline({
      gpsTickId: getGpsTickId(),
      lat: round6(lat),
      lng: round6(lng),
      hintHdg: Math.round(hintHdg),
      followHdg: Math.round(followHdg),
      pipelineHdg: Math.round(pipelineHdg),
      workletHdg: Number.isFinite(workletHdg) ? Math.round(workletHdg!) : null,
      camHdgFlipDeg: Math.round(camHdgFlip),
      speedKmh: Math.round(cameraSpeedKmh),
      frameMoveM: round1(camFrameMoveM),
      rawGapM: round1(rawGapM),
      segMs: Math.round(lastSegmentDurationMsRef.current),
      msSinceCamPush: Math.round(msSinceCamPush),
      offRoute: offRouteRef.current,
      source: 'drive_marker_sv',
    });
    const targetLookaheadM = tripLookaheadFromSpeedM(
      cameraSpeedKmh,
      isNavigatingRef.current,
    );
    const prevLook = cameraLookaheadEmaRef.current;
    const lookaheadM = prevLook <= 0.5
      ? targetLookaheadM
      : prevLook * 0.92 + targetLookaheadM * 0.08;
    cameraLookaheadEmaRef.current = lookaheadM;
    const workletSegMs = 16;
    if (DRIVE_V2_PIPELINE_DEBUG) {
      const camLogGapMs = now - lastDebugCameraLogAtRef.current;
      const shouldLogCamera =
        camFrameMoveM >= 1.5
        || camLogGapMs >= 450
        || camHdgFlip >= 18;
      if (shouldLogCamera) {
        lastDebugCameraLogAtRef.current = now;
        console.log('[DEBUG_CAMERA]', {
          layer: 'pushCameraFromDriveMarkerFrame',
          workletSegMs,
          markerSegMs: Math.round(lastSegmentDurationMsRef.current),
          cameraSpeedKmh: round1(cameraSpeedKmh),
          hintHdg: Math.round(hintHdg),
          followHdg: Math.round(followHdg),
          centerDeltaM: round1(camFrameMoveM),
          lookaheadM: round1(lookaheadM),
          targetLookaheadM: round1(targetLookaheadM),
          hdgDeltaHintToFollow: Math.round(camHdgFlip),
          msSincePrevPush: Math.round(msSinceCamPush),
        });
      }
    }
    updateCameraFrameRef.current?.({
      center: { latitude: lat, longitude: lng },
      heading: followHdg,
      speedKmh: cameraSpeedKmh,
      isNavigating: isNavigatingRef.current,
      isDriving: isDrivingRef.current,
      timestamp: now,
      headingFromTripPipeline: true,
      followFromWorkletFrame: true,
      segmentDurationMs: workletSegMs,
      smoothedLookaheadM: lookaheadM,
    });
    markerLogTick('CAM_FOLLOW_PUSH', {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      hdg: Math.round(followHdg),
      snapHdg: Math.round(hintHdg),
      speedKmh: Math.round(cameraSpeedKmh),
      exploring: false,
      source: 'drive_marker_sv',
    }, 800);
    driveTraceCamera({
      lat,
      lng,
      hdg: followHdg,
      speedKmh: cameraSpeedKmh,
      exploring: false,
      frameMoveM: camFrameMoveM,
    });
  }, []);

  useEffect(() => {
    driveMarkerCameraSinkRef.current.onFrame = pushCameraFromDriveMarkerFrame;
  }, [pushCameraFromDriveMarkerFrame]);

  useEffect(() => {
    const on = DRIVE_CORE_V2 && (isDrivingRef.current || isNavigatingRef.current || isDriving || isNavigating);
    driveMarkerCameraSinkRef.current.enabled = on;
    driveMarker.setCameraFollowEnabled(on);
  }, [isDriving, isNavigating, driveMarker]);

  const pushCameraFromSmooth = useCallback((
    lat: number,
    lng: number,
    hdg: number,
    markerSegMs?: number,
  ) => {
    if (DRIVE_CORE_V2) return;
    if (!V10_CLIENT_FIRST) return;
    if (!isDrivingRef.current && !isNavigatingRef.current) return;
    const exploring = isUserExploringMapRef.current();
    const now = Date.now();
    const prevDisp = markerDisplayRef.current;
    const frameMoveM = prevDisp.at > 0
      ? haversineKm(prevDisp.lat, prevDisp.lng, lat, lng) * 1000
      : 0;
    if (exploring) {
      driveTraceCamera({
        lat,
        lng,
        hdg,
        speedKmh: speedKmhRef.current,
        exploring: true,
        frameMoveM,
      });
      return;
    }
    const frameDtSec = prevDisp.at > 0
      ? Math.max(0.016, Math.min(0.2, (now - prevDisp.at) / 1000))
      : 0.016;
    const dispSpeedKmh = (prevDisp.speedMs ?? 0) * 3.6;
    const impliedKmh = frameMoveM > 0.15
      ? Math.min(220, (frameMoveM / frameDtSec) * 3.6)
      : 0;
    const followSpeedKmh = Math.max(
      speedKmhRef.current,
      rawGpsKmhRef.current * 0.88,
      dispSpeedKmh,
      impliedKmh,
    );
    markerDisplayRef.current = {
      lat,
      lng,
      hdg,
      speedMs: followSpeedKmh > 0.5 ? followSpeedKmh / 3.6 : 0,
      at: now,
    };
    const segMs = (() => {
      const fromMarker = Number.isFinite(markerSegMs) && (markerSegMs as number) > 0
        ? (markerSegMs as number)
        : 0;
      const fromFeed = lastSegmentDurationMsRef.current;
      return Math.max(
        TRIP_MARKER_LERP_MIN_MS,
        fromMarker > 0 ? fromMarker : fromFeed,
      );
    })();
    const camMinGapMs = Math.max(56, Math.min(160, Math.round(segMs * 0.42)));
    if (now - lastCamPushFromSmoothRef.current < camMinGapMs) return;
    lastCamPushFromSmoothRef.current = now;
    const cameraSpeedKmh =
      speedKmhRef.current < 3 && frameMoveM < 1.5
        ? 0
        : Math.min(
          followSpeedKmh,
          speedKmhRef.current + (frameMoveM < 2 ? 6 : 18),
        );
    updateCameraFrameRef.current?.({
      center: { latitude: lat, longitude: lng },
      heading: hdg,
      speedKmh: cameraSpeedKmh,
      isNavigating: isNavigatingRef.current,
      isDriving: isDrivingRef.current,
      timestamp: now,
      headingFromTripPipeline: true,
      followFromWorkletFrame: DRIVE_CORE_V2,
      segmentDurationMs: segMs,
    });
    markerLogTick('CAM_FOLLOW_PUSH', {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      hdg: Math.round(hdg),
      speedKmh: Math.round(cameraSpeedKmh),
      exploring: false,
    }, 800);
    driveTraceCamera({
      lat,
      lng,
      hdg,
      speedKmh: cameraSpeedKmh,
      exploring: false,
      frameMoveM,
    });
  }, []);

  useEffect(() => {
    pushCameraFromSmoothRef.current = pushCameraFromSmooth;
  }, [pushCameraFromSmooth]);

  useAnimatedReaction(
    () => ({
      lat: tripSmoothPosition.lat.value,
      lng: tripSmoothPosition.lng.value,
      hdg: tripSmoothPosition.heading.value,
    }),
    (next, prev) => {
      if (DRIVE_CORE_V2) return;
      if (
        prev
        && Math.abs(next.lat - prev.lat) < 1e-8
        && Math.abs(next.lng - prev.lng) < 1e-8
        && Math.abs(next.hdg - prev.hdg) < 0.05
      ) {
        return;
      }
      if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;
      runOnJS(pushCameraFromSmooth)(next.lat, next.lng, next.hdg);
    },
    [pushCameraFromSmooth, isNavigating],
  );

  /** Po wejściu w trip: jednorazowy bootstrap kamery (follow = worklet markera). */
  useEffect(() => {
    if (!isTripActiveMap || (!V10_CLIENT_FIRST && !DRIVE_CORE_V2)) return;
    if (DRIVE_CORE_V2) {
      const lat = driveMarker.lat.value;
      const lng = driveMarker.lng.value;
      const hdg = driveMarker.heading.value;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        pushTripCameraFromApply(lat, lng, Number.isFinite(hdg) ? hdg : 0, { instant: true });
      }
      return;
    }
    const lat = tripSmoothPosition.lat.value;
    const lng = tripSmoothPosition.lng.value;
    const hdg = tripSmoothPosition.heading.value;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    pushCameraFromSmooth(lat, lng, Number.isFinite(hdg) ? hdg : 0);
  }, [isDriving, isNavigating, isTripActiveMap, pushCameraFromSmooth, pushTripCameraFromApply, tripSmoothPosition]);

  /** Wejście w jazdę: padding HUD + marker na dole ekranu (recenter wymusza setCamera padding). */
  useEffect(() => {
    if (!isDriving || isNavigating) return;
    if (drivingEntryJustStartedRef.current) return;
    setFollowMode('drivingFollow');
    let lat = drLatRef.current;
    let lng = drLngRef.current;
    let followHeading = Number.isFinite(drHdgRef.current)
      ? drHdgRef.current
      : (Number.isFinite(lastHeadingRef.current) ? lastHeadingRef.current : 0);
    if (DRIVE_CORE_V2) {
      const mLat = driveMarker.lat.value;
      const mLng = driveMarker.lng.value;
      if (Number.isFinite(mLat) && Number.isFinite(mLng) && !(Math.abs(mLat) < 1e-6 && Math.abs(mLng) < 1e-6)) {
        lat = mLat;
        lng = mLng;
      } else if (userLocation && Number.isFinite(userLocation.latitude) && Number.isFinite(userLocation.longitude)) {
        lat = userLocation.latitude;
        lng = userLocation.longitude;
      }
      if (Number.isFinite(driveMarker.heading.value)) {
        followHeading = driveMarker.heading.value;
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;
    recenterTo({
      center: { latitude: lat, longitude: lng },
      heading: followHeading,
      speedKmh: speedKmhRef.current,
      active: true,
      isNavigating: false,
      entryAnim: true,
    });
    if (!DRIVE_CORE_V2) {
      updateCameraFrame({
        center: { latitude: lat, longitude: lng },
        heading: followHeading,
        speedKmh: speedKmhRef.current,
        isNavigating: false,
        isDriving: true,
        timestamp: Date.now(),
      });
    } else {
      pushTripCameraFromApply(lat, lng, followHeading, { instant: true });
    }
  }, [isDriving, isNavigating, setFollowMode, updateCameraFrame, recenterTo, driveMarker, userLocation, pushTripCameraFromApply]);

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

  useEffect(() => {
    const runCameraSpeedUpdate = () => {
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
      updateSpeedLimit(lat, lng, { nav: isNavigating || isDriving });
    };

    // W trakcie jazdy limit pobieramy nawet gdy focus mapy migocze (ref vs state).
    if (!isMapFocused && !isNavigating && !isDriving) return;

    if (!isNavigating && !isDriving) {
      if (!userLocation) return;
      runCameraSpeedUpdate();
      return;
    }

    runCameraSpeedUpdate();
    const id = setInterval(runCameraSpeedUpdate, CAMERA_SPEED_POLL_MS);
    return () => clearInterval(id);
  }, [userLocation?.latitude, userLocation?.longitude, isNavigating, isDriving, isMapFocused, updateCameras, updateSpeedLimit]);

  useEffect(() => {
    isNavigatingRef.current = isNavigating;
  }, [isNavigating]);

  // ── Sync isDrivingRef ─────────────────────────────────────
  useEffect(() => {
    isDrivingRef.current = isDriving;
  }, [isDriving]);
  useEffect(() => {
    setDrivingFlag(isDriving).catch(() => {});
  }, [isDriving]);

  // Bootstrap markera raz na wejście w trip (driveMarker w deps powodował reset co re-render HUD).
  useEffect(() => {
    const tripActive = isDriving || isNavigating;
    if (!tripActive) {
      tripMarkerV2BootstrappedRef.current = false;
      return;
    }
    if (tripMarkerV2BootstrappedRef.current) return;
    const boot = lastSetLocRef.current ?? lastGoodLocRef.current;
    const plat = boot?.lat ?? drLatRef.current;
    const plng = boot?.lng ?? drLngRef.current;
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) return;
    if (Math.abs(plat) < 1e-6 && Math.abs(plng) < 1e-6) return;
    tripMarkerV2BootstrappedRef.current = true;
    const kmh = speedKmhRef.current;
    if (DRIVE_CORE_V2) {
      driveMarker.reset({ lat: plat, lng: plng, heading: drHdgRef.current });
      resetMarkerFeedState();
      resetRoadMarkerPoseState();
      pushDriveMarkerV2(driveMarker, plat, plng, drHdgRef.current, {
        durationMs: TRIP_GPS_FEED_MIN_MS,
        speedMs: kmh > 0.5 ? kmh / 3.6 : 0,
        hudKmh: kmh,
        allowInstant: true,
      });
    } else {
      feedSmoothPositionTarget({
        latitude: plat,
        longitude: plng,
        heading: drHdgRef.current,
        durationMs: 0,
        speedMs: kmh > 0.5 ? kmh / 3.6 : 0,
        source: 'driving_nav_bootstrap',
      });
    }
  }, [isDriving, isNavigating, driveMarker]);

  // ── Dead-reckoning — w v10 wylaczone (marker = worklet live cruise + snap). ──
  const drEnabled = !V10_CLIENT_FIRST && locationReady && (isNavigating || isDriving);

  const { feed: feedDR, reset: resetDR, stop: stopDR } = useDeadReckoning({
    enabled: drEnabled,
    tripMode: drEnabled,
    // PŁYNNOŚĆ v7: 16 ms = 60 fps DR emit (sync z worklet 60 fps useFrameCallback).
    // Stare 33 ms (30 fps) powodowało że worklet z animacją 70-120 ms restartował
    // się co frame zanim zdążył dobrze zinterpolować — widoczne 30 fps szarpanie.
    frameInterval: 16,
    onFrame: useCallback((pos: any, hdg: number) => {
      drTickCountRef.current += 1;
      const frameNow = Date.now();
      drLastFrameAtRef.current = frameNow;

      // v10 CLIENT-FIRST: w driving/nav marker pochodzi bezposrednio z
      // userLocation (aktualizowany w applyTripPosition). DR.onFrame nie
      // robi tu nic poza synchronizacja refow — bez snap-per-frame, bez
      // DRIFT_CLAMP, bez DR_CRITICAL_REANCHOR, bez CAMERA_LAG_WATCHDOG,
      // bez DR_ANTI_STALE_RESET. Wszystkie te mechanizmy ratowaly DR,
      // ktore w v10 jest wylaczone.
      if (V10_CLIENT_FIRST && (isDrivingRef.current || isNavigatingRef.current)) {
        if (Number.isFinite(hdg)) drHdgRef.current = hdg;
        if (Number.isFinite(pos?.latitude) && Number.isFinite(pos?.longitude)) {
          drLatRef.current = pos.latitude;
          drLngRef.current = pos.longitude;
          currentLocRef.current = { latitude: pos.latitude, longitude: pos.longitude };
        }
        return;
      }

      let snappedPos = pos;

      if (isNavigatingRef.current) {
        const points = routePointsRef.current;
        if (points.length > 1) {
          const snapped = snapToRoute(pos.latitude, pos.longitude, points, NAV_ROUTE_SNAP_M);
          snappedPos = { latitude: snapped.latitude, longitude: snapped.longitude };
        }
        drHdgRef.current = hdg;
      } else if (isDrivingRef.current) {
        // ── DRIVING SNAP-TO-ROAD W DR.onFrame ──────────────────────────────────
        // Bez tego DR.loop ekstrapoluje pos na bearing forward (np. przy bridge'u
        // gdy raw lat/lng zamarły). Po zakręcie bearing jest STARY i marker
        // ucieka po polach. Snap'owanie do matched road geometry co klatkę
        // przyciąga marker z powrotem na drogę — to samo co w nawigacji.
        //
        // Snap radius 70m (matched geometry), ale korekta idzie krokowo (clamp),
        // żeby marker nie robił gwałtownych przeskoków gdy geometria dogoni po opóźnieniu.
        const shouldFrameSnap = frameNow - lastTripTargetUpdateAtRef.current > 220;
        const roadPts = drivingSnapGeometryRef.current;
        if (shouldFrameSnap && roadPts && roadPts.length > 1) {
          const snapped = snapToRoute(pos.latitude, pos.longitude, roadPts, 70);
          const moveM = haversineKm(pos.latitude, pos.longitude, snapped.latitude, snapped.longitude) * 1000;
          if (moveM >= 0.3 && moveM <= 70) {
            // PŁYNNOŚĆ v7: cap snap-step na 4-12 m (było 8-20). Przy 60 fps emit
            // 12 m/klatka = 720 m/s teoretyczny limit (nigdy nie osiągniemy),
            // ale praktycznie marker NIE skacze widocznie przy korekcie snap.
            // Stare 20 m było widocznym jitterem na ekranie.
            const maxSnapStepM = Math.min(12, Math.max(4, speedKmhRef.current * 0.2 + 4));
            if (moveM > maxSnapStepM) {
              const c = clampCoordStep(
                { latitude: pos.latitude, longitude: pos.longitude },
                { latitude: snapped.latitude, longitude: snapped.longitude },
                maxSnapStepM,
              );
              snappedPos = { latitude: c.latitude, longitude: c.longitude };
            } else {
              snappedPos = { latitude: snapped.latitude, longitude: snapped.longitude };
            }
          }
        }
        if (Number.isFinite(hdg)) {
          drHdgRef.current = hdg;
        }
      } else if (!isDrivingRef.current && Number.isFinite(hdg)) {
        drHdgRef.current = hdg;
      }

      // ── DRIFT CLAMP — uzależniony od Doppler GPS ──────────────────────────
      // KRYTYCZNE: anchor = lastSetLocRef.current (= drTarget z bridge'a po fix).
      // W normalnej jeździe drift od anchora powinien być mały (~0–30m), bo
      // bridge co tick aktualizuje anchor.
      //
      // Sytuacje:
      //   1) Doppler żywy (rawGpsKmh ≥ 5) — auto JEDZIE. Bridge projektuje
      //      sensownie, drift do ~100m to OK (iOS lat/lng freeze). Powyżej
      //      120m to bug — clamp. Wcześniej było 300m → marker uciekał za daleko.
      //   2) Doppler martwy (rawGpsKmh < 5) — auto STOI. Każdy drift > 30m
      //      to GPS jitter lub błąd. Ostry clamp do 30m (sanitizer już zerował
      //      kmh, więc bridge nie powinien być aktywny — ale safety).
      if (isDrivingRef.current && lastSetLocRef.current) {
        const anchor = lastSetLocRef.current;
        const driftFromSnapM = haversineKm(
          anchor.lat,
          anchor.lng,
          snappedPos.latitude,
          snappedPos.longitude,
        ) * 1000;
        const dopplerKmh = rawGpsKmhRef.current;
        const dopplerActive = dopplerKmh >= 5;
        // ANALIZA mph9uzxa: 120 m przy doppler aktywnym powodowało 337 reanchorów
        // przez sumę drobnych dryftów (DR ekstrapoluje + bridge dosypuje co tick).
        // Realne wymyki to >200 m, krytyczne >300 m (już SNAP_STALE_HARD_RESET tam łapie).
        const driftThresholdM = dopplerActive ? 200 : 60;

        // ANTI-STALE ANCHOR (v8, analiza mphew0b2):
        // W v6 próg 600m był ZA PÓŹNY — drift potrafił dojść do 555m i odpalić
        // DRIFT_CLAMP × 6 z 80m instant teleportem zanim anti-stale wskoczył
        // (przy 602m). Obniżamy do 350m żeby zatrzymać kumulację wcześniej,
        // PRZED tym jak DR_CRITICAL_REANCHOR / clamp zacznie się aktywować.
        // Cooldown 800 → 1200 ms = mniej spam reset w turbulencjach.
        if (isDrivingRef.current && dopplerActive && driftFromSnapM > 350) {
          const antiStaleNow = frameNow;
          if (antiStaleNow - lastAntiStaleResetAtRef.current > 1200) {
            lastAntiStaleResetAtRef.current = antiStaleNow;
            vroomGpsLog('DR_ANTI_STALE_RESET', {
              driftFromSnapM: Math.round(driftFromSnapM),
              dopplerKmh: Number(dopplerKmh.toFixed(1)),
              sanitizedKmh: Math.round(speedKmhRef.current),
              anchorLat: Number(anchor.lat.toFixed(5)),
              anchorLng: Number(anchor.lng.toFixed(5)),
              snapPosLat: Number(snappedPos.latitude.toFixed(5)),
              snapPosLng: Number(snappedPos.longitude.toFixed(5)),
            }, 0);
            lastSetLocRef.current = {
              lat: snappedPos.latitude,
              lng: snappedPos.longitude,
            };
            driftCriticalStreakRef.current = 0;
            // Skip dalszy drift handling — marker NIE skacze, tylko anchor reset.
            drLatRef.current = snappedPos.latitude;
            drLngRef.current = snappedPos.longitude;
            currentLocRef.current = { latitude: snappedPos.latitude, longitude: snappedPos.longitude };
            return;
          }
        }
        if (driftFromSnapM > driftThresholdM) {
          driftCriticalStreakRef.current += driftFromSnapM >= DRIFT_CRITICAL_M ? 1 : 0;
          // PŁYNNOŚĆ v8 (analiza mphew0b2): stare 80 m maxStep robiło INSTANT 80m
          // teleport w 1 ramce worklet 35 ms = WIZUALNY TELEPORT MARKERA.
          // 6× DR_DRIFT_CLAMP w 12 s × 80 m = 6 widocznych skoków.
          // Cap 18 m / klatkę = ~1080 m/s teoretycznie, realnie 60 fps × 18 m
          // = drift 500 m dogonimy w ~25 ramek (≈420 ms) PŁYNNIE bez skoku.
          const maxDriftStepM = dopplerActive
            ? Math.min(18, Math.max(8, speedKmhRef.current * 0.12 + 6))
            : Math.min(10, Math.max(4, dopplerKmh));
          const clamped = clampCoordStep(
            { latitude: anchor.lat, longitude: anchor.lng },
            { latitude: snappedPos.latitude, longitude: snappedPos.longitude },
            maxDriftStepM,
          );
          vroomGpsLog('DR_DRIFT_CLAMP', {
            mode: 'driving',
            driftM: Math.round(driftFromSnapM),
            thresholdM: driftThresholdM,
            maxStepM: Math.round(maxDriftStepM),
            dopplerKmh: Number(dopplerKmh.toFixed(1)),
            sanitizedKmh: Math.round(speedKmhRef.current),
            anchorLat: Number(anchor.lat.toFixed(6)),
            anchorLng: Number(anchor.lng.toFixed(6)),
            preLat: Number(snappedPos.latitude.toFixed(6)),
            preLng: Number(snappedPos.longitude.toFixed(6)),
            postLat: Number(clamped.latitude.toFixed(6)),
            postLng: Number(clamped.longitude.toFixed(6)),
            criticalStreak: driftCriticalStreakRef.current,
          }, 1500);
          snappedPos = { latitude: clamped.latitude, longitude: clamped.longitude };
          if (driftCriticalStreakRef.current >= DRIFT_CRITICAL_STREAK) {
            // CORE FIX z analizy mph7of5x: 1347 reanchorów ciągnęło marker
            // krokami 70-180 m po STAREJ polilinii (snap zwracał `snapped:true`
            // przy 47 km rozjeździe). Skutek: zielone kropki obok drogi z rysunku.
            //
            // Nowa strategia (zachowawcza):
            //   1) Próbuj rzutować raw na bieżącą polilinię z promieniem 150 m
            //      (mniej niż 220, bo dalsze "trafienia" to fałszywe rzuty na
            //      stary segment kilometr za nami).
            //   2) Jeśli polilinia trafiona blisko (<150 m) — krok max 35 m do snap.
            //   3) Jeśli polilinia jest dalej lub jej nie ma:
            //        - clamp marker do raw z krokiem max 25 m,
            //        - inkrementuj `drNoRoadStreakRef`,
            //        - wymuś `force-match` jeśli >= 2 frame'y bez geometrii
            //          (rate-limit przez `lastDrForceMatchAtRef`).
            //   4) Log throttle 500 ms (było co klatkę = 12×/s).
            const raw = lastRawForHeadingRef.current;
            const hasRaw =
              !!raw
              && Number.isFinite(raw.lat)
              && Number.isFinite(raw.lng)
              && !isNullIsland(raw.lat, raw.lng);
            const roadPts = drivingSnapGeometryRef.current;
            let catchTargetLat = anchor.lat;
            let catchTargetLng = anchor.lng;
            let catchSource: 'road' | 'anchor' | 'raw_clamp' = 'anchor';
            let snapHitDistM = -1;

            if (hasRaw && roadPts.length >= 2) {
              const rawLat = Number(raw?.lat);
              const rawLng = Number(raw?.lng);
              const snappedToRoad = snapToRoute(rawLat, rawLng, roadPts, 150);
              const projectedDifferentFromRaw =
                snappedToRoad.latitude !== rawLat
                || snappedToRoad.longitude !== rawLng;
              if (projectedDifferentFromRaw) {
                const projDistM = haversineKm(
                  rawLat,
                  rawLng,
                  snappedToRoad.latitude,
                  snappedToRoad.longitude,
                ) * 1000;
                if (projDistM <= 150) {
                  catchTargetLat = snappedToRoad.latitude;
                  catchTargetLng = snappedToRoad.longitude;
                  catchSource = 'road';
                  snapHitDistM = projDistM;
                  drNoRoadStreakRef.current = 0;
                }
              }
            }
            if (catchSource === 'anchor' && hasRaw) {
              // Polilinia za daleko lub brak geometrii — ZAWSZE clamp do raw
              // (max 25 m), nigdy w stronę starego anchora. Lepiej żeby marker
              // szedł do raw przez kilka klatek niż "zamarzł" na martwej polilinii.
              catchTargetLat = Number(raw?.lat);
              catchTargetLng = Number(raw?.lng);
              catchSource = 'raw_clamp';
              drNoRoadStreakRef.current += 1;
            }

            const hardCatchStepM = catchSource === 'road' ? DR_REANCHOR_MAX_HARD_STEP_M : 25;
            // PING-PONG DEBOUNCE (v8, analiza mphew0b2):
            // W v6 window 500ms łapał tylko najbliższe pary; widzieliśmy 8×
            // DR_CRITICAL_REANCHOR w 4s z tym samym targetem (52.686909) 
            // odpalonym na 53.288s i 53.862s = 574ms apart → poza window.
            // Window 500→1500ms łapie pełny burst. Plus porównujemy też
            // anchor (nie tylko catchTarget) — jeśli OBA są w ±8m od
            // poprzedniego, to jasny ping-pong → skip.
            const recentAnchor = lastReanchorAnchorRef.current;
            let pingPong = false;
            if (recentAnchor && frameNow - recentAnchor.at < 1500) {
              const dTarget = haversineKm(
                recentAnchor.lat, recentAnchor.lng,
                catchTargetLat, catchTargetLng,
              ) * 1000;
              const dAnchor = recentAnchor.srcLat != null && recentAnchor.srcLng != null
                ? haversineKm(
                    recentAnchor.srcLat, recentAnchor.srcLng,
                    anchor.lat, anchor.lng,
                  ) * 1000
                : Infinity;
              pingPong = dTarget < 8 || (dTarget < 20 && dAnchor < 8);
            }
            if (pingPong) {
              // Pomijamy reanchor — marker zostaje gdzie był, ale resetujemy
              // streak żeby dać szansę naturalnemu DR.onFrame snap.
              driftCriticalStreakRef.current = 0;
              return;
            }
            lastReanchorAnchorRef.current = {
              lat: catchTargetLat,
              lng: catchTargetLng,
              at: frameNow,
              srcLat: anchor.lat,
              srcLng: anchor.lng,
            };
            const catchUp = clampCoordStep(
              { latitude: anchor.lat, longitude: anchor.lng },
              { latitude: catchTargetLat, longitude: catchTargetLng },
              hardCatchStepM,
            );
            snappedPos = { latitude: catchUp.latitude, longitude: catchUp.longitude };
            lastSetLocRef.current = { lat: catchUp.latitude, lng: catchUp.longitude };
            driftCriticalStreakRef.current = 0;
            feedDRRef.current(
              { latitude: snappedPos.latitude, longitude: snappedPos.longitude },
              Math.max(0, speedKmhRef.current / 3.6),
              Number.isFinite(drHdgRef.current) ? drHdgRef.current : (lastHeadingRef.current || 0),
            );

            const reanchorNow = frameNow;
            if (reanchorNow - lastReanchorLogAtRef.current >= DR_REANCHOR_LOG_THROTTLE_MS) {
              lastReanchorLogAtRef.current = reanchorNow;
              vroomGpsLog('DR_CRITICAL_REANCHOR', {
                source: catchSource,
                roadPts: roadPts.length,
                snapHitDistM: Number.isFinite(snapHitDistM) && snapHitDistM >= 0 ? Math.round(snapHitDistM) : null,
                noRoadStreak: drNoRoadStreakRef.current,
                driftFromSnapM: Math.round(driftFromSnapM),
                anchorLat: Number(anchor.lat.toFixed(6)),
                anchorLng: Number(anchor.lng.toFixed(6)),
                targetLat: Number(snappedPos.latitude.toFixed(6)),
                targetLng: Number(snappedPos.longitude.toFixed(6)),
                dopplerKmh: Number(dopplerKmh.toFixed(1)),
                sanitizedKmh: Math.round(speedKmhRef.current),
              }, 0);
            }

            // Force-match: gdy 2+ frame'y bez polilinii lub bardzo duży drift,
            // i ostatni force-match był > 8 s temu, popchnij map-match.
            const needsForceMatch =
              hasRaw
              && (drNoRoadStreakRef.current >= 3 || driftFromSnapM > 500);
            if (needsForceMatch && raw && !DRIVE_CORE_V2) {
              runMapMatchRecoveryRef.current({
                reason: 'DR_DRIFT',
                lat: raw.lat,
                lng: raw.lng,
                speedKmh: speedKmhRef.current,
                forceImmediate: true,
              }, (p) => {
                if (p && p.length >= 2 && isDrivingRef.current) {
                  applyRoadMatchPoints(p);
                  drNoRoadStreakRef.current = 0;
                }
              });
            }
          }
        } else {
          driftCriticalStreakRef.current = 0;
        }
      }

      drLatRef.current = snappedPos.latitude;
      drLngRef.current = snappedPos.longitude;
      currentLocRef.current = { latitude: snappedPos.latitude, longitude: snappedPos.longitude };

      const activeFollow = isNavigatingRef.current || isDrivingRef.current;
      const uiNow = frameNow;

      const camHeading = Number.isFinite(drHdgRef.current)
        ? drHdgRef.current
        : (Number.isFinite(lastHeadingRef.current) ? lastHeadingRef.current : hdg);

      const headingDelta = Math.abs(((camHeading - lastHeadingRef.current + 540) % 360) - 180);
      if (
        activeFollow
        && headingDelta >= HEADING_FLIP_ALERT_DEG
        && uiNow - lastHeadingFlipLogAtRef.current > 1500
      ) {
        lastHeadingFlipLogAtRef.current = uiNow;
        vroomGpsLog('HEADING_FLIP_GUARD', {
          prev: Math.round(lastHeadingRef.current || 0),
          next: Math.round(camHeading || 0),
          delta: Math.round(headingDelta),
          speedKmh: Math.round(speedKmhRef.current),
          isDriving: isDrivingRef.current,
          isNavigating: isNavigatingRef.current,
        }, 0);
      }

      if (activeFollow) {
        const cameraLagM = lastSetLocRef.current
          ? haversineKm(
            lastSetLocRef.current.lat,
            lastSetLocRef.current.lng,
            snappedPos.latitude,
            snappedPos.longitude,
          ) * 1000
          : 0;
        if (
          isDrivingRef.current
          && cameraLagM >= CAMERA_LAG_ALERT_M
          && uiNow - lastCameraLagLogAtRef.current > 1200
        ) {
          lastCameraLagLogAtRef.current = uiNow;
          vroomGpsLog('CAMERA_LAG_PROXY', {
            lagM: Math.round(cameraLagM),
            speedKmh: Math.round(speedKmhRef.current),
            heading: Math.round(camHeading || 0),
          }, 0);
        }
        // CAMERA WATCHDOG (analiza mphbhukq v4):
        // W v4 watchdog odpalał się 8× ale tylko 1/8 było skuteczne (lag wracał
        // do 59-188 m w 5 s). Po 19:34:18 z kolei 214 s bez watchdog bo lag
        // siedział w paśmie 40-49 m (poniżej starego progu >50). Obniżamy
        // próg na 40 m, streak na 2 s, cooldown na 3 s. Plus po recenter
        // czyścimy markerStuckStreakRef bo recovery i watchdog często idą razem.
        if (isDrivingRef.current && cameraLagM > 40 && !isUserExploringMapRef.current()) {
          const streak = cameraLagStreakRef.current;
          if (!streak) {
            cameraLagStreakRef.current = { startAt: uiNow, lastLagM: cameraLagM };
          } else {
            streak.lastLagM = cameraLagM;
            if (
              uiNow - streak.startAt > 2000
              && uiNow - lastCameraWatchdogAtRef.current > 3000
            ) {
              lastCameraWatchdogAtRef.current = uiNow;
              vroomGpsLog('CAMERA_LAG_WATCHDOG', {
                lagM: Math.round(cameraLagM),
                durationMs: Math.round(uiNow - streak.startAt),
                speedKmh: Math.round(speedKmhRef.current),
                heading: Math.round(camHeading || 0),
              }, 0);
              recenterTo({
                center: { latitude: snappedPos.latitude, longitude: snappedPos.longitude },
                heading: camHeading || 0,
                speedKmh: speedKmhRef.current,
                active: true,
                instant: true,
              });
              lastSetLocRef.current = { lat: snappedPos.latitude, lng: snappedPos.longitude };
              cameraLagStreakRef.current = null;
              markerStuckStreakRef.current = null;
            }
          }
        } else if (cameraLagM < 25) {
          // Wyzeruj streak tylko gdy faktyczna poprawa — w paśmie 25-40 m
          // trzymamy stary streak, bo to jest "pre-watchdog" zone (lag rośnie
          // ale jeszcze nie chcemy szarpnąć).
          cameraLagStreakRef.current = null;
        }
        const targetDur = isDrivingRef.current
          ? Math.max(
            TRIP_SMOOTH_MIN_MS,
            Math.min(TRIP_SMOOTH_MAX_MS, uiNow - lastSmoothFeedAtRef.current || TRIP_SMOOTH_MIN_MS),
          )
          : 80;
        lastSmoothFeedAtRef.current = uiNow;
        feedSmoothPositionTarget({
          latitude: snappedPos.latitude,
          longitude: snappedPos.longitude,
          heading: camHeading,
          durationMs: targetDur,
          source: isDrivingRef.current ? 'dr_onframe_driving' : 'dr_onframe_nav',
        });
      }
    }, []),
    stallTimeout: (isNavigating || isDriving) ? 45_000 : 12_000,
  });
  useEffect(() => {
    feedDRRef.current = feedDR;
  }, [feedDR]);

  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);
  useEffect(() => { backgroundTrackingRef.current = settings.backgroundTracking; }, [settings.backgroundTracking]);

  const { flushPendingKm } = useBackgroundTracking(
    isSharing,
    settings.backgroundTracking,
    isNavigating || isDriving,
    sharingHydrated,
    isPremium,
  );

  const { showNavigationNotification, dismissNavigationNotification } = useNavigationNotification();

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
    if (
      startLocation
      && Number.isFinite(startLocation.latitude)
      && Number.isFinite(startLocation.longitude)
    ) {
      return startLocation;
    }
    if (userLocation && Number.isFinite(userLocation.latitude) && Number.isFinite(userLocation.longitude)) {
      return { ...userLocation, name: 'Moja pozycja' };
    }
    return null;
  }, [isNavigating, isOffroadRoute, startLocation, userLocation]);

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
      duration:      null,
      durationText:  '—',
      distanceText:  `${dist.toFixed(1)} km`,
      steps:         [],
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
    { isReroute: true, continueStraight: true },
  );

  const clusteredWarnings = useMemo(
    () => clusterWarnings(warnings ?? []),
    [warnings],
  );

  const handleAddCamera = useCallback(async (
    params: {
      maxspeed: number | null;
      type: 'fixed' | 'section' | 'mobile' | 'bump';
      description: string | null;
    },
    coords?: { lat: number; lng: number } | null,
  ) => {
    const lat = coords?.lat ?? userLocation?.latitude;
    const lng = coords?.lng ?? userLocation?.longitude;
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
      const refLat = userLocation?.latitude ?? lat;
      const refLng = userLocation?.longitude ?? lng;
      updateCameras(refLat, refLng, {
        headingDeg: lastHeadingRef.current,
        speedKmh,
      });
    } else {
      Toast.show({ type: 'info', text1: 'Fotoradar już istnieje w tym miejscu' });
    }
  }, [userLocation, addCamera, invalidate, updateCameras, speedKmh]);

  const cancelCameraPick = useCallback(() => {
    setCameraPickMode(false);
    setPendingAddCameraParams(null);
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
    isSpeechRef.current = isSpeechEnabled;
    if (!isSpeechEnabled) Speech.stop().catch(() => {});
  }, [isSpeechEnabled]);

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

  useEffect(() => {
    if (!cameras.length) { setSnappedCameras([]); return; }
    if (speedKmh < 5 && !isNavigating) {
      setSnappedCameras(cameras);
      return;
    }
    snapCameras(cameras, setSnappedCameras);
  }, [cameras, isNavigating]);

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
    if (!isNavigatingRef.current) {
      setNavigatingFlag(false).catch(() => {});
    }
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
    let watchSub: { remove: () => void } | null = null;
    let initUnlockTimer: ReturnType<typeof setTimeout> | null = null;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    void loadMapLastLocation().then((cached) => {
      if (cancelled || !cached) return;
      applyBootstrapLocation(cached.latitude, cached.longitude, {
        approximate: true,
        accuracy: cached.accuracy,
      });
    });

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

        Toast.show({ type: 'error', text1: 'BŁĄD GPS', text2: 'Nie można pobrać lokalizacji' });
        unlockMapWithFallback();
      } catch {
        Toast.show({ type: 'error', text1: 'BŁĄD GPS', text2: 'Nie można pobrać lokalizacji' });
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

  const exitDrivingMode = useCallback((opts?: { skipFlush?: boolean; reason?: string }) => {
    mapMatchCoord.invalidateCoordinatorRequests();
    passiveTripStartedRef.current = false;
    const finalStats = finishTrip();
    tripPeakSpeedRef.current = Math.max(tripPeakSpeedRef.current, finalStats.maxSpeedKmh || 0);
    profileTotalDistanceKmRef.current += Math.max(
      0,
      Number(finalStats.distanceKm || 0) - tripCheckpointSavedKmRef.current,
    );
    void checkLiveAchievements('trip_end', finalStats.maxSpeedKmh);
    // Sync userLocation to last DR position before clearing isDriving so that
    // the marker source switch (drLatRef → userLocation) is seamless.
    if (drLatRef.current !== 0 && drLngRef.current !== 0) {
      setUserLocation({ latitude: drLatRef.current, longitude: drLngRef.current });
    }
    isDrivingRef.current        = false;
    drivingSinceRef.current     = 0;
    drivingLastLocRef.current   = null;
    lastDrivingPosRef.current   = null;
    lastRawForHeadingRef.current = null;
    tripHeadingFilterRef.current?.reset();
    tripHeadingFilterRef.current = null;
    driveSessionGuardRef.current.reset();
    // Zachowaj kotwicę sanity-checku na ostatniej pozycji (DR / pojazd), zamiast
    // nullować — inaczej pierwszy fix po wyjściu z jazdy omijał teleport-guard
    // i mógł „przenieść” użytkownika na losowy cache providera.
    if (drLatRef.current !== 0 && drLngRef.current !== 0) {
      lastGoodLocRef.current = { lat: drLatRef.current, lng: drLngRef.current };
    }
    lastGoodTimeRef.current = Date.now();
    lastAcceptedFixWallClockRef.current = Date.now();
    stopDR();
    resetDRRefs();
    resetSnap();
    resetMapMatch();
    if (USE_DRIVE_TRACKING_PIPELINE) driveTracking.reset();
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
    drivingManualModeRef.current = false;
    setIsDriving(false);
    if (!opts?.skipFlush) {
      // Persist driving sessions with full fg+bg merge (same strategy as navigation),
      // so top speed and km don't get lost when provider reports sparse/zero speed.
      void flushPendingKm(true, {
        distanceKm: Math.max(0, Number(finalStats.distanceKm || 0) - tripCheckpointSavedKmRef.current),
        maxSpeedKmh: Math.max(tripPeakSpeedRef.current, finalStats.maxSpeedKmh || 0),
        avgSpeedKmh: finalStats.avgSpeedKmh,
        durationSec: finalStats.elapsedSec,
        routePoints: finalStats.trackedPoints,
      }, 'driving');
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
    tripCheckpointSavedKmRef.current = 0;
    tripMoveSamplesRef.current = [];
    speedKmhRef.current = 0;
    setSpeed(null);
    clearStats();
    tripPeakSpeedRef.current = 0;
    disposeTripCameraScheduler();
    resetSpeedometerEmitterThrottle();
    emitSpeedometerKmh(0);
    if (DRIVE_CORE_V2) {
      driveCore.reset();
      driveMarker.reset();
      resetMarkerFeedState();
      resetRoadMarkerPoseState();
      tripMarkerV2BootstrappedRef.current = false;
      resetTravelHeadingState();
      drivingEntryAnchorRef.current = null;
      drivingEntryGraceUntilRef.current = 0;
      lastTripMarkerPoseRef.current = null;
    }
    navDriveTraceSession('driving_end', {
      reason: opts?.reason ?? 'unspecified',
      skipFlush: !!opts?.skipFlush,
    });
    console.log('[DrivingMode] Exited driving mode', JSON.stringify({
      reason: opts?.reason ?? 'unspecified',
      skipFlush: !!opts?.skipFlush,
    }));
  }, [stopDR, resetDRRefs, resetSnap, resetMapMatch, applyRoadMatchPoints, flushPendingKm, clearStats, finishTrip, checkLiveAchievements, mapMatchCoord, driveCore, driveMarker, disposeTripCameraScheduler]);

  const maybeAutoStopFromSessionGuard = useCallback((
    effectiveSpeedKmh: number,
    movingForDriving: boolean,
  ) => {
    if (!isDrivingRef.current || drivingManualModeRef.current || isNavigatingRef.current) {
      return;
    }
    driveSessionGuardRef.current.noteSample({
      effectiveSpeedKmh,
      movingForDriving,
      appStateActive: appStateRef.current === 'active',
      manualDriving: drivingManualModeRef.current,
    });
    if (!driveSessionGuardRef.current.canAutoStop()) return;
    if (__DEV__) {
      console.log('[DrivingMode] auto_stop_guard', JSON.stringify({
        stationaryMs: driveSessionGuardRef.current.getStationaryDurationMs(),
        lockRemainingMs: driveSessionGuardRef.current.getHighSpeedLockRemainingMs(),
      }));
    }
    exitDrivingMode({ reason: 'auto_stop_guard' });
    setFollowMode('idleBrowse');
  }, [exitDrivingMode]);

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
    if (isDriving) {
      drivingManuallyDisabledRef.current = true;
      drivingManualDisabledAtRef.current = Date.now();
      kmSinceManualOffRef.current = 0;
      drivingManualModeRef.current = false;
      pendingDrivingEntryOneShotRef.current = false;
      // Zawsze zwalnij busy przy wyjściu — inaczej szybkie OFF→ON może zostawić blokadę i „nic się nie dzieje”.
      drivingManualEntryBusyRef.current = false;
      exitDrivingMode({ reason: 'manual_toggle_off' });
      setFollowMode('idleBrowse');
    } else {
      if (!userLocation || !Number.isFinite(userLocation.latitude) || !Number.isFinite(userLocation.longitude)) {
        Toast.show({ type: 'error', text1: 'GPS', text2: 'Poczekaj na fix lokalizacji zanim włączysz jazdę.' });
        return;
      }
      drivingManualEntryBusyRef.current = true;
      const rawFix = currentLocRef.current;
      const startLat = rawFix?.latitude ?? userLocation.latitude;
      const startLng = rawFix?.longitude ?? userLocation.longitude;
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
      if (!instantRoad || instantRoad.length < 2) {
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
          if (sqliteHit?.points && sqliteHit.points.length >= 2) {
            const nearStartM = haversineKm(
              startLat,
              startLng,
              sqliteHit.points[0].latitude,
              sqliteHit.points[0].longitude,
            ) * 1000;
            if (nearStartM <= 55) instantRoad = sqliteHit.points;
          }
        } catch {
          /* ignore */
        }
      }

      resetSnapState();
      if (instantRoad && instantRoad.length >= 2) {
        applyRoadMatchPoints(instantRoad, { skipResync: true });
        bumpMatchedFreshness();
      } else if (previewPts.length >= 2) {
        setSnapPoints(previewPts);
        drivingSnapGeometryRef.current = previewPts;
        drivingSnapUsesMatchedRef.current = false;
      }

      let entryLat = startLat;
      let entryLng = startLng;
      let entryHeading = Number.isFinite(lastHeadingRef.current) ? lastHeadingRef.current : 0;
      drivingEntryGraceUntilRef.current = Date.now() + DRIVING_ENTRY_GRACE_MS;

      const localSnap = drivingSnap(
        startLat,
        startLng,
        Math.max(0, speedKmhRef.current),
        isNavigatingRef.current,
        true,
        rawFix?.accuracy ?? null,
      );
      if (localSnap.snapped && Number.isFinite(localSnap.latitude) && Number.isFinite(localSnap.longitude)) {
        const snapDistM = haversineKm(startLat, startLng, localSnap.latitude, localSnap.longitude) * 1000;
        const maxSnapM = stationaryEntry
          ? DRIVING_ENTRY_INITIAL_SNAP_M
          : DRIVING_ENTRY_MAX_SNAP_M;
        if (snapDistM <= maxSnapM) {
          entryLat = localSnap.latitude;
          entryLng = localSnap.longitude;
          if (Number.isFinite(localSnap.targetHeading)) {
            entryHeading = localSnap.targetHeading;
          }
        }
      }

      drivingEntryAnchorRef.current = { lat: entryLat, lng: entryLng };

      const seedPolyline =
        (instantRoad && instantRoad.length >= 2 ? instantRoad : null)
        ?? (isNavigatingRef.current && previewPts.length >= 2 ? previewPts : null)
        ?? (isNavigatingRef.current && drivingSnapGeometryRef.current.length >= 2
          ? drivingSnapGeometryRef.current
          : undefined);

      if (DRIVE_CORE_V2) {
        driveCore.reset(
          { lat: entryLat, lng: entryLng },
          { heading: entryHeading, seedPolyline: seedPolyline ?? undefined },
        );
        const seeded = driveCore.engine.snap.getFrozenPose();
        if (seeded) {
          const seededPose = clampDrivingEntryMarkerPose(
            startLat,
            startLng,
            seeded.lat,
            seeded.lng,
            drivingEntryGraceUntilRef.current,
            drivingEntryAnchorRef.current,
          );
          entryLat = seededPose.lat;
          entryLng = seededPose.lng;
          if (Number.isFinite(seeded.heading) && seeded.heading !== 0) {
            entryHeading = seeded.heading;
          }
        }
        if (!seedPolyline) {
          void driveCore.primeLocalGeometry(startLat, startLng).then(() => {
            const re = driveCore.engine.snap.getFrozenPose();
            if (!re || !isDrivingRef.current) return;
            const rePose = clampDrivingEntryMarkerPose(
              startLat,
              startLng,
              re.lat,
              re.lng,
              drivingEntryGraceUntilRef.current,
              drivingEntryAnchorRef.current,
            );
            driveMarker.resetTo(rePose.lat, rePose.lng, re.heading);
            pushTripCameraFromApply(rePose.lat, rePose.lng, re.heading, { instant: true });
            drLatRef.current = rePose.lat;
            drLngRef.current = rePose.lng;
            lastHeadingRef.current = re.heading;
          });
        }
      }
      vroomGpsLog('ENTRY_SNAP', {
        cachedRoadPts: instantRoad?.length ?? 0,
        previewPts: previewPts.length,
        localSnapped: true,
        stationaryEntry,
        entryLat: Number(entryLat.toFixed(5)),
        entryLng: Number(entryLng.toFixed(5)),
      });

      isDrivingRef.current = true;
      drivingSinceRef.current = Date.now();
      drivingEntryJustStartedRef.current = true;
      drivingEntryHeadingRef.current = entryHeading;
      setTimeout(() => {
        drivingEntryJustStartedRef.current = false;
      }, 800);
      tripSpeedWarmupUntilRef.current = Date.now() + 10_000;
      drivingConsecutiveRef.current = DRIVING_CONSECUTIVE_REQ;
      startTrip(Number(routeInfoRef.current?.duration) || 0);
      drivingLastLocRef.current = null;
      lastDrivingPosRef.current = { lat: entryLat, lng: entryLng };
      if (!stationaryEntry) {
        navLatFilter.reset();
        navLngFilter.reset();
        drivLatFilter.reset();
        drivLngFilter.reset();
        if (USE_DRIVE_TRACKING_PIPELINE) driveTracking.reset();
      }

      setIsDriving(true);
      if (DRIVE_CORE_V2) {
        driveCore.engine.setNavigating(false);
        resetTravelHeadingState(startLat, startLng, entryHeading);
        getTripHeadingFilter().reset(entryHeading);
        driveMarker.reset({ lat: entryLat, lng: entryLng, heading: entryHeading });
        resetMarkerFeedState();
        resetRoadMarkerPoseState();
        tripMarkerV2BootstrappedRef.current = true;
        lastTripMarkerPoseRef.current = { lat: entryLat, lng: entryLng };
        driveMarker.resetTo(entryLat, entryLng, entryHeading);
        pushDriveMarkerV2(driveMarker, entryLat, entryLng, entryHeading, {
          durationMs: TRIP_GPS_FEED_MIN_MS,
          speedMs: stationaryEntry ? 0 : Math.max(0.08, speedKmhRef.current / 3.6),
          hudKmh: speedKmhRef.current,
          allowInstant: true,
        });
        lastDriveMarkerPushAtRef.current = Date.now();
        pushTripCameraFromApply(entryLat, entryLng, entryHeading, { instant: true });
      }
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
      const entrySpeedMs = stationaryEntry
        ? 0
        : Math.max(0, speedKmhRef.current / 3.6);
      if (!DRIVE_CORE_V2) {
        applyTripPosition(entryLat, entryLng, {
          heading: entryHeading,
          speedMs: entrySpeedMs,
          forcePublish: true,
          instant: true,
          allowInstantFeed: true,
          commitGood: true,
        });
      }
      recenterTo({
        center: { latitude: displayEntryLat, longitude: displayEntryLng },
        heading: entryHeading,
        speedKmh: Math.max(0, speedKmhRef.current),
        active: true,
        entryAnim: true,
      });
      setFollowMode('drivingFollow');
      pushCameraFromSmoothRef.current(displayEntryLat, displayEntryLng, entryHeading);
      recordDrivingTracePoint(entryLat, entryLng, { speedKmh: speedKmhRef.current }).catch(() => {});
      drivingManualEntryBusyRef.current = false;

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
          if (DRIVE_CORE_V2) {
            driveCore.applyMatchGeometry(apiRoad);
            driveCore.seedLocalMirror(apiRoad);
          } else {
            resyncSnapAfterRoadGeometry();
          }
          if (!isDrivingRef.current || isNavigatingRef.current) return;
          if (Date.now() < drivingEntryGraceUntilRef.current) return;
          const curLat = drLatRef.current;
          const curLng = drLngRef.current;
          const asyncSnap = drivingSnap(
            curLat,
            curLng,
            Math.max(0, speedKmhRef.current),
            false,
            true,
            null,
          );
          if (
            !asyncSnap.snapped
            || !Number.isFinite(asyncSnap.latitude)
            || !Number.isFinite(asyncSnap.longitude)
          ) {
            return;
          }
          const corrM = haversineKm(curLat, curLng, asyncSnap.latitude, asyncSnap.longitude) * 1000;
          if (corrM > DRIVING_ENTRY_ASYNC_MAX_CORRECTION_M || corrM < 0.4) return;
          const corrHdg = Number.isFinite(asyncSnap.targetHeading)
            ? asyncSnap.targetHeading
            : drHdgRef.current;
          drLatRef.current = asyncSnap.latitude;
          drLngRef.current = asyncSnap.longitude;
          drHdgRef.current = corrHdg;
          lastSetLocRef.current = { lat: asyncSnap.latitude, lng: asyncSnap.longitude };
          // SSOT: bez async snap → marker (unika raw/snap yo-yo).
        } catch {
          /* background entry match optional */
        }
      })();

      console.log('[DrivingMode] Manually entered — snap-first entry');
    }
  }, [isNavigating, isDriving, userLocation, exitDrivingMode, setFollowMode, recenterTo, getMatchedPoints, bumpMatchedFreshness, resetSnapState, mapMatchCoord, drivingSnap, startTrip, recordDrivingTracePoint, applyRoadMatchPoints, resyncSnapAfterRoadGeometry, setSnapPoints, applyTripPosition, driveCore, driveMarker, pushTripCameraFromApply]);

  // ─────────────────────────────────────────────────────────
  // Adaptive GPS
  // ─────────────────────────────────────────────────────────
  const [gpsForceActive, setGpsForceActive] = useState(false);
  const applyGpsForceActive = useCallback((active: boolean) => {
    if (gpsForceActiveRef.current === active) return;
    gpsForceActiveRef.current = active;
    setGpsForceActive(active);
  }, []);

  const { start: startGPS, stop: stopGPS, hardRestart: hardRestartGPS } = useDriveLocationWatch({
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
      lastGpsTickAtRef.current = tickNow;
      const rawLat0 = loc.latitude;
      const rawLng0 = loc.longitude;
      let rawLat = rawLat0;
      let rawLng = rawLng0;
      const acc    = loc.accuracy ?? 10;
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
      const prevRaw = lastRawTickRef.current;
      if (prevRaw) {
        const dtMs = now - prevRaw.at;
        const movedM = haversineKm(prevRaw.lat, prevRaw.lng, rawLat0, rawLng0) * 1000;
        const hardJumpM = Math.max(
          1800,
          ((Math.max(speedKmhRef.current, 15) / 3.6) * (Math.max(dtMs, 1000) / 1000)) * 10,
        );
        if (movedM > hardJumpM) {
          if (tripActiveEarly && DRIVE_CORE_V2) {
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
            return;
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

      if (DRIVE_CORE_V2 && tripActiveNow && isDrivingRef.current && !isNavigatingRef.current) {
        syncDrivingRoadGeometry(rawLat, rawLng, speedKmhRaw, acc);
      }

      if (DRIVE_CORE_V2 && tripActiveNow) {
        const gpsSpeedMs =
          loc.speed != null && loc.speed >= 0 && Number.isFinite(loc.speed)
            ? loc.speed
            : null;
        const handled = driveCoreProcessRef.current(
          rawLat,
          rawLng,
          acc,
          loc.timestamp ?? now,
          gpsSpeedMs,
        );
        if (handled) {
          if (isDrivingRef.current && !isNavigatingRef.current) {
            const movingForDrivingV2 =
              speedKmhRaw >= DRIVING_SPEED_KMH
              || speedKmhRef.current >= DRIVING_SPEED_KMH;
            maybeAutoStopFromSessionGuard(speedKmhRaw, movingForDrivingV2);
          }
          lastRawForHeadingRef.current = { lat: rawLat, lng: rawLng, at: now };
          lastAcceptedFixWallClockRef.current = now;
          return;
        }
        driveTraceReject('v2_core_reject', {
          rawLat: Number(rawLat.toFixed(6)),
          rawLng: Number(rawLng.toFixed(6)),
          accM: Math.round(acc),
          speedKmh: round1(speedKmhRaw),
        });
        // Bramka V2 odrzuciła fix — HUD zawsze; marker: nawigacja = raw glide, jazda = snap lock.
        if (!gpsForceActiveRef.current) {
          gpsForceActiveRef.current = true;
          applyGpsForceActive(true);
        }
        const dopplerKmhReject = gpsSpeedMs != null && gpsSpeedMs >= 0
          ? normalizeHudSpeedKmh(gpsSpeedMs * 3.6)
          : 0;
        const fallbackKmh = mergeTripHudKmh(speedKmhRef.current, dopplerKmhReject);
        speedKmhRef.current = fallbackKmh;
        emitSpeedometerKmh(fallbackKmh);

        const isNavTick = isNavigatingRef.current;
        const allowMapFallback =
          isNavTick
          || (gpsLockEstablishedRef.current && acc <= 30);
        if (!allowMapFallback) {
          driveTraceReject('v2_no_fallback', {
            accM: Math.round(acc),
            gpsLock: gpsLockEstablishedRef.current,
            speedKmh: round1(fallbackKmh),
            isNavigating: false,
          });
          lastAcceptedFixWallClockRef.current = now;
          return;
        }

        const frozenSnap = driveCore.engine.snap.getFrozenPose();
        let fbLat: number;
        let fbLng: number;
        if (isNavTick) {
          fbLat = rawLat;
          fbLng = rawLng;
        } else {
          fbLat = frozenSnap?.lat
            ?? (Number.isFinite(drLatRef.current) && drLatRef.current !== 0 ? drLatRef.current : rawLat);
          fbLng = frozenSnap?.lng
            ?? (Number.isFinite(drLngRef.current) && drLngRef.current !== 0 ? drLngRef.current : rawLng);
        }
        const snapHint = frozenSnap?.heading ?? lastHeadingRef.current ?? 0;
        const fbHdg = headingForDriveMarker(
          fbLat,
          fbLng,
          { heading: snapHint, crossTrackM: frozenSnap?.crossTrackM ?? 999 },
          fallbackKmh,
          rawLat,
          rawLng,
        );
        drLatRef.current = fbLat;
        drLngRef.current = fbLng;
        drHdgRef.current = fbHdg;
        lastHeadingRef.current = fbHdg;
        const fbCadence = gpsCadenceMsRef.current > 0 ? gpsCadenceMsRef.current : 500;
        const fbDur = Math.max(fbCadence, 1000);
        lastSegmentDurationMsRef.current = fbDur;
        if (!isDriveMarkerBootstrapped(driveMarker)) {
          driveMarker.resetTo(fbLat, fbLng, fbHdg);
        }
        pushDriveMarkerV2(driveMarker, fbLat, fbLng, fbHdg, {
          durationMs: fbDur,
          speedMs: fallbackKmh >= 1.5 ? fallbackKmh / 3.6 : 0,
          hudKmh: fallbackKmh,
        });
        drLastFrameAtRef.current = Date.now();
        if (!isNavTick) {
          pushTripCameraFromApply(fbLat, fbLng, fbHdg, { instant: true });
        }
        driveTraceFallback({
          fbLat: Number(fbLat.toFixed(6)),
          fbLng: Number(fbLng.toFixed(6)),
          fbHdg: Math.round(fbHdg),
          rawLat: Number(rawLat.toFixed(6)),
          rawLng: Number(rawLng.toFixed(6)),
          speedKmh: round1(fallbackKmh),
          accM: Math.round(acc),
        });
        driveTraceTick({
          rawLat,
          rawLng,
          snapLat: frozenSnap?.lat ?? fbLat,
          snapLng: frozenSnap?.lng ?? fbLng,
          markerLat: fbLat,
          markerLng: fbLng,
          markerHdg: fbHdg,
          markerSvLat: driveMarker.lat.value,
          markerSvLng: driveMarker.lng.value,
          markerSvHdg: driveMarker.heading.value,
          accM: acc,
          hudKmh: fallbackKmh,
          engineKmh: fallbackKmh,
          dopplerKmh: fallbackKmh,
          feedDurMs: fbDur,
          cadenceMs: fbCadence,
          feedSpeedMs: Math.max(0, fallbackKmh / 3.6),
          isNavigating: isNavigatingRef.current,
          isFreeDrive: !isNavigatingRef.current,
          isMoving: fallbackKmh >= 3,
          source: 'v2_fallback',
        });
        lastRawForHeadingRef.current = { lat: rawLat, lng: rawLng, at: now };
        lastAcceptedFixWallClockRef.current = now;
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
      if (V10_CLIENT_FIRST && tripActiveNow) {
        if (tripForegroundRefreshUntilRef.current > now) {
          tripResumeFreezeUntilRef.current = 0;
          tripResumeAnchorRef.current = null;
          tripResumeConfirmRef.current = null;
        }
      }
      if (
        V10_CLIENT_FIRST
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
        && !(V10_CLIENT_FIRST && tripActiveNow)
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
            lastRawForHeadingRef.current = { lat: rawLat, lng: rawLng, at: now };
            const releaseSpeedMs = Math.max(0, Math.max(speedKmhRaw, motionKmh) / 3.6);
            const releaseHdg = lastHeadingRef.current ?? 0;
            if (V10_CLIENT_FIRST && tripActiveNow) {
              // Refs only — jeden applyTripPosition po drivingSnap poniżej (bez raw leak).
              drLatRef.current = releaseTargetLat;
              drLngRef.current = releaseTargetLng;
              lastSetLocRef.current = { lat: releaseTargetLat, lng: releaseTargetLng };
            } else {
              feedDR(
                { latitude: releaseTargetLat, longitude: releaseTargetLng },
                releaseSpeedMs,
                releaseHdg,
              );
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
          lastRawForHeadingRef.current = { lat: rawLat, lng: rawLng, at: now };
          lastRawTickRef.current = { lat: rawLat, lng: rawLng, at: now, acc };
          prevGoodTimeRef.current = now;
          const releaseHdg2 = lastHeadingRef.current ?? 0;
          if (!(V10_CLIENT_FIRST && tripActiveNow)) {
            feedDR({ latitude: rawLat, longitude: rawLng }, 0, releaseHdg2);
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
            applyTripPositionRef.current?.(pin.lat, pin.lng, {
              heading: lastHeadingRef.current ?? 0,
              speedMs: 0,
              forcePublish: true,
              parkedLike: true,
              rawLat,
              rawLng,
              rawMotionDetected: false,
              rawStepM: rawStepWakeM,
              motionKmh,
              netMoveM: 0,
            });
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
      let lat: number;
      let lng: number;
      if (USE_DRIVE_TRACKING_PIPELINE && tripActivePreKalman) {
        const filtered = driveTracking.filterGpsFix({
          latitude: rawLat,
          longitude: rawLng,
          accuracyM: acc,
          speedMs: loc.speed != null && loc.speed >= 0 ? loc.speed : null,
          headingDeg: loc.heading != null && loc.heading >= 0 ? loc.heading : null,
          timestampMs: now,
          isDriving: isDrivingRef.current,
          isNavigating: isNavigatingRef.current,
          accelBypass: accelBypassKalman,
          rawMotionDetected: rawMotionWakeActive,
          microMoveGraceTicks: startupMicroMoveGraceTicksRef.current,
        });
        lat = filtered.latitude;
        lng = filtered.longitude;
        if (startupMicroMoveGraceTicksRef.current > 0) {
          startupMicroMoveGraceTicksRef.current -= 1;
        }
      } else {
        if (useDrivingKalman) {
          configureDrivingKalmanForSpeed(kalmanSpeedKmh);
        } else if (isNavigatingRef.current && kalmanSpeedKmh >= 20) {
          configureNavKalmanForSpeed(kalmanSpeedKmh);
        }
        lat = accelBypassKalman
          ? rawLat
          : useDrivingKalman
            ? drivLatFilter.filter(rawLat, acc)
            : isDrivingRef.current
              ? latFilter.filter(rawLat, acc)
              : isNavigatingRef.current
                ? navLatFilter.filter(rawLat, acc)
                : latFilter.filter(rawLat, acc);
        lng = accelBypassKalman
          ? rawLng
          : useDrivingKalman
            ? drivLngFilter.filter(rawLng, acc)
            : isDrivingRef.current
              ? lngFilter.filter(rawLng, acc)
              : isNavigatingRef.current
                ? navLngFilter.filter(rawLng, acc)
                : lngFilter.filter(rawLng, acc);
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.warn('[GPS map] Kalman produced non-finite coord');
        latFilter.reset();
        lngFilter.reset();
        navLatFilter.reset();
        navLngFilter.reset();
        drivLatFilter.reset();
        drivLngFilter.reset();
        if (isDrivingRef.current || isNavigatingRef.current) {
          const fallbackHdg = lastHeadingRef.current || 0;
          const fallbackSpeedMs = loc.speed != null && loc.speed >= 0 ? loc.speed : 0;
          let fbLat = rawLat;
          let fbLng = rawLng;
          const anchor =
            lastSetLocRef.current
            ?? (lastGoodLocRef.current
              ? { latitude: lastGoodLocRef.current.lat, longitude: lastGoodLocRef.current.lng }
              : null);
          if (anchor) {
            const c = clampCoordStep(anchor, { latitude: rawLat, longitude: rawLng }, 40);
            fbLat = c.latitude;
            fbLng = c.longitude;
          }
          applyTripPosition(fbLat, fbLng, {
            heading: fallbackHdg,
            speedMs: fallbackSpeedMs,
            forcePublish: true,
            commitGood: true,
          });
          if (appStateRef.current === 'active') {
            const segKm = feedPosition(fbLat, fbLng, fallbackSpeedMs > 0 ? fallbackSpeedMs : undefined);
            if (segKm > 0) {
              recordDrivingTracePoint(fbLat, fbLng, { speedKmh: fallbackSpeedMs * 3.6 }).catch(() => {});
            }
          }
          publishSpeed(fallbackSpeedMs, {
            sanitizedMs: null,
            lat: fbLat,
            lng: fbLng,
            now,
            dtMs: Math.max(100, now - prevGoodTimeRef.current),
          });
        }
        return;
      }

      // ══ 3. Prędkość (UI + trip stats dopiero po zaakceptowanej pozycji) ═══════
      const rawSpeedMs = loc.speed != null && loc.speed >= 0 ? loc.speed : null;
      // Doppler GPS — niezależne od delta-pozycji, niewrażliwe na GPS jitter.
      // Używamy w DR.onFrame (drift clamp) i bridge (gpsFrozenWhileMoving guard).
      rawGpsKmhRef.current = rawSpeedMs != null ? rawSpeedMs * 3.6 : 0;
      const rawSpeedAnchor = lastSpeedRawAnchorRef.current;
      const speedPrevAnchor = tripActiveNow && rawSpeedAnchor
        ? { lat: rawSpeedAnchor.lat, lng: rawSpeedAnchor.lng }
        : (lastGoodLocRef.current ?? lastSetLocRef.current);
      const speedDtMs = rawSpeedAnchor
        ? Math.max(100, now - rawSpeedAnchor.at)
        : Math.max(100, now - prevGoodTimeRef.current);

      let netMoveM = 0;
      let pathMoveM = 0;
      let sustainedKmh = 0;
      if (tripActiveNow) {
        const buf = tripMoveSamplesRef.current;
        // Speed uses accepted raw GPS/Doppler, not snapped/Kalman position.
        // Snapped/Kalman is for marker stability; using it for HUD under-reported real speed.
        buf.push({ lat: rawLat, lng: rawLng, t: now });
        while (buf.length > 24) buf.shift();
        while (buf.length > 2 && now - buf[0].t > 5000) buf.shift();
        const sustained = sustainedTripSpeedFromSamples(buf, now);
        netMoveM = sustained.netMoveM;
        pathMoveM = sustained.pathMoveM;
        // Cap analogiczny jak motionKmh — duże skoki GPS dawały >50000 km/h.
        sustainedKmh = Math.min(
          sustained.sustainedKmh,
          isNavigatingRef.current ? MAX_REALISTIC_NAV_KMH : MAX_REALISTIC_DRIVING_KMH,
        );
      } else {
        tripMoveSamplesRef.current = [];
      }

      let rawGpsKmhForSpike = rawSpeedMs != null ? rawSpeedMs * 3.6 : 0;
      const tripSpeedWarmupActive = Date.now() < tripSpeedWarmupUntilRef.current;
      if (tripSpeedWarmupActive) {
        const physicallyMoving =
          netMoveM >= 8
          || motionKmh >= 6
          || sustainedKmh >= 6
          || pathMoveM >= 10;
        // Startup anti-spike: ignore absurd Doppler bursts at trip start.
        if (!physicallyMoving && rawGpsKmhForSpike > 70) {
          rawGpsKmhForSpike = 0;
        } else if (rawGpsKmhForSpike > 120) {
          rawGpsKmhForSpike = Math.min(90, Math.max(motionKmh, sustainedKmh, 0));
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
      if (USE_DRIVE_TRACKING_PIPELINE && tripActiveNow) {
        kmh = driveTracking.stabilizeSpeedKmh(
          kmh,
          {
            rawGpsKmh: rawGpsKmhForSpike,
            derivedKmh: derivedKmhEarly,
            sustainedKmh,
            netMoveM,
            pathMoveM,
            isTripActive: true,
            rawMotionDetected: rawMotionWakeActive,
            accuracyM: acc,
          },
          now,
        );
        if (kmh > 0.5) {
          sanitizedSpeedMs = kmh / 3.6;
        }
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
        V10_CLIENT_FIRST
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
            const segKm = feedPosition(lat, lng, sanitizedSpeedMs ?? undefined);
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

        // Feed map matching only in confirmed driving mode (legacy — V2 uses driveEngine).
        const accStrict = (loc.accuracy ?? 999) <= 48;
        const accRelaxedDriving = (loc.accuracy ?? 999) <= 100;
        const accForMatch = isDrivingRef.current ? accRelaxedDriving : accStrict;
        const staleSnapHintEarly =
          (snapAnchorStaleRef.current?.streak ?? 0) >= 3;
        if (!DRIVE_CORE_V2) {
        const nowMatch = Date.now();
        const feedMoveOk =
          noRoad && isDrivingRef.current ? movedForSnap >= 12 : movedForSnap >= 14;
        const feedSpeedOk =
          noRoad && isDrivingRef.current
            ? motionKmh >= 4 || movedForSnap >= 18
            : motionKmh >= 5 || sustainedKmh >= 5 || movedForSnap >= 28;
        const clientFirstHealthy = isClientFirstGeometryHealthy();
        const addMatchFeedGapMs = noRoad
          ? ADD_MATCH_FEED_NO_ROAD_MIN_MS
          : clientFirstHealthy
            ? ADD_MATCH_FEED_HEALTHY_MIN_MS
            : ADD_MATCH_FEED_MIN_MS;
        const addMatchFeedDue =
          nowMatch - lastAddMatchFeedRef.current >= addMatchFeedGapMs
          || (noRoad && staleSnapHintEarly);
        if (
          drivingMapboxGateOk
          && isDrivingRef.current
          && accForMatch
          && feedMoveOk
          && feedSpeedOk
          && addMatchFeedDue
          && (kmh >= DRIVING_ENTRY_STATIONARY_KMH || noRoad)
        ) {
          const roadPtsFeed = drivingSnapGeometryRef.current.length;
          const markerRawDriftM = lastSetLocRef.current
            ? haversineKm(rawLat, rawLng, lastSetLocRef.current.lat, lastSetLocRef.current.lng) * 1000
            : 0;
          const staleSnapHint =
            staleSnapHintEarly
            || roadPtsFeed < 8
            || markerRawDriftM >= 35;
          if (shouldAllowNetworkMapMatch({ noRoad, staleSnap: staleSnapHint })) {
            lastAddMatchFeedRef.current = nowMatch;
            void addMatchPosition(lat, lng, {
              speedKmh: Math.max(kmh, motionKmh, sustainedKmh),
              accuracyM: loc.accuracy ?? null,
              noRoad,
              staleSnap: staleSnapHint,
            });
          }
        }

        // Sieć Mapbox tylko gdy polityka client-first na to pozwala (lokalna geometria ma pierwszeństwo).
        if (drivingMapboxGateOk && isDrivingRef.current && accForMatch && motionKmh >= DRIVING_ENTRY_STATIONARY_KMH) {
          if (noRoad) {
            if (shouldAllowNetworkMapMatch({ noRoad: true, staleSnap: staleSnapHintEarly })) {
              const movedRec = lastSetLocRef.current
                ? haversineKm(lastSetLocRef.current.lat, lastSetLocRef.current.lng, lat, lng) * 1000
                : Infinity;
              vroomGpsLog('FORCE_MATCH_NO_ROAD', { kmh: Math.round(motionKmh), accM: loc.accuracy != null ? Math.round(loc.accuracy) : null });
              runMapMatchRecovery(
                {
                  reason: 'NO_ROAD',
                  lat,
                  lng,
                  speedKmh: kmh,
                  staleSnap: staleSnapHintEarly,
                  context: {
                    movedForSnapM: movedForSnap,
                    movedRecoverM: movedRec,
                  },
                },
                (p) => {
                  if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                },
              );
            }
          } else {
            const roadPtsSparse = drivingSnapGeometryRef.current.length;
            if (
              roadPtsSparse > 0
              && roadPtsSparse < 8
              && kmh >= 15
              && shouldAllowNetworkMapMatch({})
            ) {
              vroomGpsLog('FORCE_MATCH_SPARSE_GEOM', { roadPts: roadPtsSparse, kmh: Math.round(kmh) });
              runMapMatchRecovery(
                {
                  reason: 'SPARSE_GEOM',
                  lat,
                  lng,
                  speedKmh: kmh,
                  context: { roadPtsSparse },
                },
                (p) => {
                  if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                },
              );
            }
            const movedSoft = lastSetLocRef.current
              ? haversineKm(lastSetLocRef.current.lat, lastSetLocRef.current.lng, lat, lng) * 1000
              : 0;
            if (
              movedSoft >= 180
              && shouldAllowNetworkMapMatch({ staleSnap: staleSnapHintEarly })
            ) {
              runMapMatchRecovery(
                {
                  reason: 'SOFT_REFRESH',
                  lat,
                  lng,
                  speedKmh: kmh,
                  context: { movedSoftM: movedSoft },
                },
                (p) => {
                  if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                },
              );
            }
          }
        }
        }

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
          snapped = drivingSnap(
            snapInputLat,
            snapInputLng,
            snapSpeedKmh,
            isNavigatingRef.current,
            hardRoadSnap,
            loc.accuracy ?? null,
            rawGpsKmhForSpike,
            snapMotionWake,
          );
        }
        let rawToSnapAfterSnapM = haversineKm(rawLat, rawLng, snapped.latitude, snapped.longitude) * 1000;
        if (
          USE_DRIVE_TRACKING_PIPELINE
          && (isDrivingRef.current || isNavigatingRef.current)
          && drivingSnapGeometryRef.current.length >= 2
        ) {
          const prevRawH = lastRawForHeadingRef.current;
          const motionBearingDeg = prevRawH
            ? bearingBetween(prevRawH.lat, prevRawH.lng, rawLat, rawLng)
            : snapped.targetHeading;
          const refined = driveTracking.refineSnap(snapped, {
            rawLat,
            rawLng,
            filteredLat: lat,
            filteredLng: lng,
            speedKmh: snapSpeedKmh,
            motionBearingDeg,
            routeHeadingDeg: snapped.targetHeading,
            geometry: drivingSnapGeometryRef.current,
            isNavigating: isNavigatingRef.current,
            hardRoadLock: hardRoadSnap,
            accuracyM: loc.accuracy ?? null,
          });
          snapped = {
            latitude: refined.latitude,
            longitude: refined.longitude,
            snapped: refined.snapped,
            targetHeading: refined.targetHeading,
          };
        }
        rawToSnapAfterSnapM = haversineKm(rawLat, rawLng, snapped.latitude, snapped.longitude) * 1000;
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
        if (isDrivingRef.current && !V10_CLIENT_FIRST) {
          const rawToSnapM = haversineKm(rawLat, rawLng, snapped.latitude, snapped.longitude) * 1000;
          vroomGpsLog('SNAP_TICK', {
            kmh: Math.round(kmh),
            snapped: snapped.snapped,
            hardRoadSnap,
            noRoad,
            accM: loc.accuracy != null ? Math.round(loc.accuracy) : null,
            rawToSnapM: Math.round(rawToSnapM),
            rawLat: Number(rawLat.toFixed(5)),
            rawLng: Number(rawLng.toFixed(5)),
            snapLat: Number(snapped.latitude.toFixed(5)),
            snapLng: Number(snapped.longitude.toFixed(5)),
          }, 1000);
          const stale = snapAnchorStaleRef.current;
          const movedFastEnough =
            kmh >= SNAP_STALE_MIN_KMH
            || motionKmh >= SNAP_STALE_MIN_KMH
            || sustainedKmh >= (SNAP_STALE_MIN_KMH - 3)
            || movedForSnap >= 8;
          const looksStaleAnchor =
            snapped.snapped
            && movedFastEnough
            && rawToSnapM >= SNAP_STALE_MIN_RAW_TO_SNAP_M
            && !!stale
            && haversineKm(stale.lat, stale.lng, snapped.latitude, snapped.longitude) * 1000 <= 0.9;
          if (looksStaleAnchor && stale) {
            stale.streak += 1;
          } else {
            snapAnchorStaleRef.current = {
              lat: snapped.latitude,
              lng: snapped.longitude,
              streak: 1,
              lastResyncAt: stale?.lastResyncAt ?? 0,
            };
          }
          // HARD RESCUE: gdy rozjazd raw vs snap jest skrajny (>180 m), nie czekamy
          // na streak. Geometria jest martwa — natychmiast czyścimy ją, resetujemy
          // snap state, i wymuszamy świeży map-match. Bez tego marker zostaje
          // przylepiony do starego anchora (np. 47 km z poprzedniego logu).
          const staleHardResetM = snapStaleHardResetThresholdM(
            kmh,
            Math.max(motionKmh, sustainedKmh, rawGpsKmhRef.current),
          );
          const hardRescueDue =
            snapped.snapped
            && rawToSnapM >= staleHardResetM
            && (kmh >= 5 || motionKmh >= 5 || rawGpsKmhRef.current >= 5)
            && now - (snapAnchorStaleRef.current?.lastResyncAt ?? 0) > 3000;
          if (
            hardRescueDue
            || (
              snapAnchorStaleRef.current
              && snapAnchorStaleRef.current.streak >= SNAP_STALE_RESCUE_STREAK
              && now - snapAnchorStaleRef.current.lastResyncAt > 6000
            )
          ) {
            const cur = snapAnchorStaleRef.current;
            if (cur) {
              cur.lastResyncAt = now;
            } else {
              snapAnchorStaleRef.current = {
                lat: snapped.latitude,
                lng: snapped.longitude,
                streak: 1,
                lastResyncAt: now,
              };
            }
            const geometryStale = rawToSnapM > staleHardResetM;
            vroomGpsLog('SNAP_STALE_ANCHOR', {
              streak: snapAnchorStaleRef.current?.streak ?? 1,
              rawToSnapM: Math.round(rawToSnapM),
              staleHardResetM,
              kmh: Math.round(kmh),
              motionKmh: Math.round(Math.min(motionKmh, 9999)),
              sustainedKmh: Math.round(Math.min(sustainedKmh, 9999)),
              snapLat: Number(snapped.latitude.toFixed(5)),
              snapLng: Number(snapped.longitude.toFixed(5)),
              hardRescue: hardRescueDue,
              geometryReset: geometryStale,
            }, 0);
            if (geometryStale) {
              // Keep last road polyline until fresh Map Match returns — clearing forces chord/raw snap.
              runMapMatchRecovery({
                reason: 'STALE_GEOM',
                lat: rawLat,
                lng: rawLng,
                speedKmh: Math.max(kmh, motionKmh, rawGpsKmhRef.current),
                forceImmediate: true,
              }, (p) => {
                if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
              });
              const rescueFrom = lastSetLocRef.current ?? { lat: rawLat, lng: rawLng };
              // v9: SNAP_RESCUE_MAX_STEP_M=15 zamiast DR_REANCHOR_MAX_HARD_STEP_M=35.
              // Marker w 2-3 ramki dotrze do raw zamiast 1× teleport 35m.
              const rescueStepM = Math.max(
                SNAP_RESCUE_MAX_STEP_M,
                drivingSnapDynamicStepCapM(Math.max(kmh, motionKmh, rawGpsKmhRef.current)),
              );
              const rescueTarget = clampCoordStep(
                { latitude: rescueFrom.lat, longitude: rescueFrom.lng },
                { latitude: rawLat, longitude: rawLng },
                rescueStepM,
              );
              lastSetLocRef.current = { lat: rescueTarget.latitude, lng: rescueTarget.longitude };
              if (drLatRef.current !== rescueTarget.latitude || drLngRef.current !== rescueTarget.longitude) {
                drLatRef.current = rescueTarget.latitude;
                drLngRef.current = rescueTarget.longitude;
              }
              if (V10_CLIENT_FIRST && isDrivingRef.current) {
                applyTripPositionRef.current?.(
                  rescueTarget.latitude,
                  rescueTarget.longitude,
                  {
                    heading: lastHeadingRef.current || 0,
                    speedMs: Math.max(0, (kmh || rawGpsKmhRef.current) / 3.6),
                    forcePublish: true,
                    rawLat,
                    rawLng,
                    roadPts: drivingSnapGeometryRef.current,
                  },
                );
              } else {
                feedDRRef.current(
                  { latitude: rescueTarget.latitude, longitude: rescueTarget.longitude },
                  Math.max(0, (kmh || rawGpsKmhRef.current) / 3.6),
                  lastHeadingRef.current || 0,
                );
              }
            } else {
              // v9: maxStepM 32 \u2192 18. Dla soft stale anchor (geometryReset=false)
              // marker p\u0142ynnie dosko\u0107y do raw zamiast 32m teleport.
              InteractionManager.runAfterInteractions(() => {
                if (!isDrivingRef.current) return;
                resyncSnapAfterRoadGeometry(rawLat, rawLng, kmh, loc.accuracy ?? null, {
                  maxStepM: drivingSnapDynamicStepCapM(kmh),
                });
              });
            }
            const rescueSpeedKmh = Math.max(
              kmh,
              Math.min(motionKmh, MAX_REALISTIC_DRIVING_KMH),
              Math.min(sustainedKmh, MAX_REALISTIC_DRIVING_KMH),
            );
            runMapMatchRecovery({
              reason: 'HARD_RESCUE',
              lat: rawLat,
              lng: rawLng,
              speedKmh: rescueSpeedKmh,
              forceImmediate: true,
              staleSnap: staleSnapHintEarly,
            }, (p) => {
              if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
            });
            mapMatchCoordApiRef.current.scheduleHardRescueStaleRetry(
              () => {
                const raw2 = lastRawForHeadingRef.current;
                if (!raw2 || !Number.isFinite(raw2.lat) || !Number.isFinite(raw2.lng)) return null;
                return { lat: raw2.lat, lng: raw2.lng };
              },
              rescueSpeedKmh,
              () => {
                if (!isDrivingRef.current) return false;
                const raw2 = lastRawForHeadingRef.current;
                if (!raw2 || !Number.isFinite(raw2.lat) || !Number.isFinite(raw2.lng)) return false;
                const roadPtsNow = drivingSnapGeometryRef.current;
                const lastSnapNow = lastSetLocRef.current;
                return (
                  roadPtsNow.length < 2
                  || !lastSnapNow
                  || haversineKm(raw2.lat, raw2.lng, lastSnapNow.lat, lastSnapNow.lng) * 1000 > 100
                );
              },
            );
          }
          if (!snapped.snapped || noRoad) {
            vroomGpsLog('SNAP_LOST', {
              kmh: Math.round(kmh),
              hardRoadSnap,
              noRoad,
              accM: loc.accuracy != null ? Math.round(loc.accuracy) : null,
              roadPts: drivingSnapGeometryRef.current.length,
              rawToSnapM: Math.round(rawToSnapM),
            }, 1000);
          }
        }
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
              applyTripPosition(hold.lat, hold.lng, {
                heading: fallbackHdg,
                speedMs: sanitizedSpeedMs ?? 0,
                forcePublish: true,
                skipWorkletFeed: !V10_CLIENT_FIRST,
              });
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
          if (V10_CLIENT_FIRST && isDrivingRef.current) {
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
                applyTripPosition(lat, lng, {
                  heading: idleHdg,
                  speedMs: sanitizedSpeedMs ?? 0,
                  forcePublish: true,
                });
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
            : V10_CLIENT_FIRST && isDrivingRef.current
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
            V10_CLIENT_FIRST
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
          V10_CLIENT_FIRST
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
            && rawMoveM > snapMoveM * 1.35
            && (kmh >= 20 || rawGpsKmhForSpike >= 20);
          const distLat = useRawForDistance ? rawLat : appliedSnap.latitude;
          const distLng = useRawForDistance ? rawLng : appliedSnap.longitude;
          const segKm = feedPosition(distLat, distLng, sanitizedSpeedMs ?? undefined);
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
        // Safety net: while driving/navigation keep speed alive when physical movement is present.
        if (
          (isDrivingRef.current || isNavigatingRef.current)
          && (deviceSpeedKmh >= 6 || rawGpsKmhForSpike >= 6 || motionKmh >= 6 || netMoveM >= 8 || pathMoveM >= 10)
          && kmh < 4
        ) {
          const recoveredKmh = Math.min(
            MAX_REALISTIC_DRIVING_KMH,
            Math.max(deviceSpeedKmh, rawGpsKmhForSpike, motionKmh, sustainedKmh, 6),
          );
          kmh = recoveredKmh;
          sanitizedSpeedMs = recoveredKmh / 3.6;
          speedKmhRef.current = Math.max(speedKmhRef.current, recoveredKmh);
        }

        // ── Driving stationary hold — zamrożenie tylko gdy faktyczny postój ──
        const shouldHardStationaryZero =
          isDrivingRef.current
          && appliedSnap.snapped
          && (tripMarkerFrozen || parkedLikeNow)
          && deviceSpeedKmh < 1.2
          && rawGpsKmhForSpike < 1.2
          && motionKmh < 1.5
          && netMoveM < 1.8
          && pathMoveM < 2.2
          && (Number.isFinite(rawStepParkM) ? rawStepParkM < 0.9 : true)
          && !(tripForegroundRefreshUntilRef.current > now)
          && !(rawGpsKmhForSpike > 3 || motionKmh > 3);
        if (shouldHardStationaryZero) {
          const anchor = lastSetLocRef.current
            ?? lastDrivingPosRef.current
            ?? (lastGoodLocRef.current
              ? { lat: lastGoodLocRef.current.lat, lng: lastGoodLocRef.current.lng }
              : null);
          if (anchor) {
            const frozen = freezeMarkerOnRoad(anchor, drivingSnapGeometryRef.current);
            markerLogCritical('STATIONARY_HOLD', {
              tripMarkerFrozen,
              parkedLike: parkedLikeNow,
              kmh: Math.round(kmh),
              rawGpsKmh: Math.round(rawGpsKmhForSpike),
              netMoveM: Math.round(netMoveM),
              anchorLat: Number(frozen.lat.toFixed(6)),
              anchorLng: Number(frozen.lng.toFixed(6)),
            });
            void logTelemetry('MAP_STATIONARY_HOLD', {
              event: 'enter',
              speedMs: Number((kmh / 3.6).toFixed(3)),
              netMoveM: Number(netMoveM.toFixed(2)),
              pathMoveM: Number(pathMoveM.toFixed(2)),
              anchorLat: Number(frozen.lat.toFixed(6)),
              anchorLng: Number(frozen.lng.toFixed(6)),
            });
            kmh = Math.min(kmh, 2.5);
            sanitizedSpeedMs = Math.min(sanitizedSpeedMs ?? (kmh / 3.6), 0.7);
            speedKmhRef.current = kmh;
            accelBypassActive = false;
            appliedSnap = {
              ...appliedSnap,
              latitude: frozen.lat,
              longitude: frozen.lng,
              snapped: frozen.snapped || appliedSnap.snapped,
            };
          }
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
              feedDR(
                { latitude: appliedSnap.latitude, longitude: appliedSnap.longitude },
                0,
                drivingHeading,
              );
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
        if (isDrivingRef.current) {
          lastGoodLocRef.current = { lat: appliedSnap.latitude, lng: appliedSnap.longitude };
          const prevMarkerDiag = lastMarkerDiagRef.current;
          const drToTargetM = (
            drLatRef.current !== 0
            && drLngRef.current !== 0
          )
            ? haversineKm(drLatRef.current, drLngRef.current, appliedSnap.latitude, appliedSnap.longitude) * 1000
            : null;
          const markerMovedM = prevMarkerDiag
            ? haversineKm(prevMarkerDiag.lat, prevMarkerDiag.lng, appliedSnap.latitude, appliedSnap.longitude) * 1000
            : Infinity;
          // Dodano: rawToSnapM + roadPts, żeby w logach widać było kontekst
          // (czy dryf wynika z geometrii martwej, czy DR lagu).
          const markerRawToSnapM = haversineKm(
            rawLat,
            rawLng,
            appliedSnap.latitude,
            appliedSnap.longitude,
          ) * 1000;
          const mp = markerDisplayRef.current.at > 0
            ? markerDisplayRef.current
            : markerProjRef.current;
          const displayToTargetM = mp.at > 0
            ? haversineKm(mp.lat, mp.lng, appliedSnap.latitude, appliedSnap.longitude) * 1000
            : null;
          const feedAgeMs = lastWorkletFeedAtRef.current > 0
            ? now - lastWorkletFeedAtRef.current
            : null;
          setMarkerStaleRawToSnapM(markerRawToSnapM);
          if (markerRawToSnapM >= 20) {
            markerStaleSnapTicksRef.current += 1;
          } else {
            markerStaleSnapTicksRef.current = 0;
          }
          if (
            V10_CLIENT_FIRST
            && markerStaleSnapTicksRef.current >= 2
            && isDrivingRef.current
            && !parkedLikeNow
            && trustDopplerInTrip
            && kmh >= 8
          ) {
            runMapMatchRecovery(
              {
                reason: 'STALE_ANCHOR',
                lat: rawLat,
                lng: rawLng,
                speedKmh: kmh,
                forceImmediate: true,
                staleSnap: true,
              },
              (p) => {
                if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
              },
            );
            markerStaleSnapTicksRef.current = 0;
          }
          markerLogTick('MARKER_PIPE', {
            mode: 'driving',
            targetLat: Number(appliedSnap.latitude.toFixed(6)),
            targetLng: Number(appliedSnap.longitude.toFixed(6)),
            drLat: Number((drLatRef.current || 0).toFixed(6)),
            drLng: Number((drLngRef.current || 0).toFixed(6)),
            drToTargetM: drToTargetM != null ? Math.round(drToTargetM) : null,
            markerMovedM: Number.isFinite(markerMovedM) ? Number(markerMovedM.toFixed(2)) : null,
            displayToTargetM: displayToTargetM != null ? Math.round(displayToTargetM) : null,
            speedKmh: Math.round(kmh),
            motionKmh: Math.round(motionKmh),
            rawGpsKmh: Math.round(rawGpsKmhForSpike),
            heading: Math.round(drivingHeading || 0),
            rawToSnapM: Math.round(markerRawToSnapM),
            roadPts: drivingSnapGeometryRef.current.length,
            snapped: !!appliedSnap.snapped,
            lastFeedSource: lastWorkletFeedSourceRef.current || null,
            lastFeedAgeMs: feedAgeMs,
            workletSpeedMs: mp.speedMs != null ? Number(mp.speedMs.toFixed(2)) : null,
          }, 800);
          if (
            (markerRawToSnapM >= 25 || (displayToTargetM != null && displayToTargetM >= 15))
            && (markerMovedM < 1 || (displayToTargetM != null && displayToTargetM >= 12))
          ) {
            markerLogCritical('MARKER_PIPELINE_GAP', {
              rawToSnapM: Math.round(markerRawToSnapM),
              markerMovedM: Number.isFinite(markerMovedM) ? Number(markerMovedM.toFixed(2)) : null,
              displayToTargetM: displayToTargetM != null ? Math.round(displayToTargetM) : null,
              speedKmh: Math.round(kmh),
              roadPts: drivingSnapGeometryRef.current.length,
              lastFeedSource: lastWorkletFeedSourceRef.current,
              lastFeedAgeMs: feedAgeMs,
              feedAgeMsGtGps: feedAgeMs != null && feedAgeMs > 2500,
            });
            const gapNeedsCatchup =
              V10_CLIENT_FIRST
              && isDrivingRef.current
              && !parkedLikeNow
              && kmh >= 8
              && (
                (displayToTargetM != null && displayToTargetM >= 14 && feedAgeMs != null && feedAgeMs > 450)
                || (
                  markerRawToSnapM >= 12
                  && markerMovedM < 1.2
                  && feedAgeMs != null
                  && feedAgeMs > 1200
                )
              );
            if (gapNeedsCatchup) {
              const gapAnchor = lastSetLocRef.current ?? lastGoodLocRef.current;
              const gapStepM = gapAnchor
                ? haversineKm(gapAnchor.lat, gapAnchor.lng, appliedSnap.latitude, appliedSnap.longitude) * 1000
                : 0;
              const gapDisplay = markerDisplayRef.current;
              const gapRoadPts = drivingSnapGeometryRef.current;
              const gapTurnMode = turnModeUntilRef.current > Date.now();
              const gapStuckPolyline =
                markerMovedM < 1.2
                && markerRawToSnapM >= 15
                && gapRoadPts.length >= 2
                && gapDisplay.at > 0;
              const gapBackward =
                !gapStuckPolyline
                && shouldBlockBackwardDisplayFeed(
                  gapDisplay,
                  appliedSnap.latitude,
                  appliedSnap.longitude,
                  drivingHeading,
                  kmh,
                  55,
                  gapRoadPts.length >= 2 ? gapRoadPts : undefined,
                  gapTurnMode,
                );
              if (gapBackward) {
                markerLogTick('GAP_CATCHUP_BACKWARD_SKIP', {
                  rawToSnapM: Math.round(markerRawToSnapM),
                  speedKmh: Math.round(kmh),
                }, 900);
              } else {
              let gapCatchLat = appliedSnap.latitude;
              let gapCatchLng = appliedSnap.longitude;
              if (gapStuckPolyline) {
                const polyStepM = Math.min(48, Math.max(10, markerRawToSnapM * 0.5));
                const polyStep = stepTowardSnapOnPolyline(
                  gapDisplay.lat,
                  gapDisplay.lng,
                  appliedSnap.latitude,
                  appliedSnap.longitude,
                  gapRoadPts,
                  polyStepM,
                  95,
                );
                gapCatchLat = polyStep.latitude;
                gapCatchLng = polyStep.longitude;
                markerLogTick('GAP_CATCHUP_POLYLINE', {
                  stepM: Math.round(polyStepM),
                  rawToSnapM: Math.round(markerRawToSnapM),
                }, 900);
              }
              const gapSpeedMs = Math.max(
                sanitizedSpeedMs ?? 0,
                speedKmhRef.current / 3.6,
                rawGpsKmhForSpike / 3.6,
              );
              const gapCatchupTs = Date.now();
              const gapInstant =
                gapStepM > 85
                && kmh >= 15
                && gapCatchupTs - lastLagCatchupInstantAtRef.current > 2500;
              if (gapInstant) {
                lastLagCatchupInstantAtRef.current = gapCatchupTs;
                markerLogCritical('GAP_CATCHUP_INSTANT', {
                  gapStepM: Math.round(gapStepM),
                  rawToSnapM: Math.round(markerRawToSnapM),
                });
              }
              applyTripPosition(gapCatchLat, gapCatchLng, {
                heading: drivingHeading,
                speedMs: gapSpeedMs,
                forcePublish: true,
                commitGood: false,
                allowInstantFeed: !gapStuckPolyline && (gapInstant || (gapStepM > 40 && kmh >= 12)),
                instant: !gapStuckPolyline && gapInstant,
                rawLat,
                rawLng,
                roadPts: drivingSnapGeometryRef.current,
                parkedLike: isWorkletStationaryHold(
                  parkedLikeNow,
                  speedKmhRef.current,
                  rawGpsKmhForSpike,
                  motionKmh,
                  netMoveM,
                  false,
                  isDrivingRef.current,
                ),
                rawStepM: rawStepParkM,
              });
              }
            }
          }
          // SPLIT METRIC GUARD (analiza mphbhukq v4): SNAP_TICK rawToSnapM=14
          // ale MARKER_PIPE rawToSnapM=302 w tym samym tickcie — to znaczy że
          // DR ekstrapoluje 300 m daleko od appliedSnap. Force feedDR ściąga
          // DR z powrotem na świeży snap point.
          if (
            !V10_CLIENT_FIRST
            && markerRawToSnapM > 100
            && drToTargetM != null
            && drToTargetM > 80
            && appliedSnap.snapped
            && (kmh >= 20 || motionKmh >= 20 || sustainedKmh >= 20)
            && now - lastMarkerStuckRecoveryAtRef.current > 2500
          ) {
            vroomGpsLog('MARKER_PIPE_SPLIT_RESYNC', {
              markerRawToSnapM: Math.round(markerRawToSnapM),
              drToTargetM: Math.round(drToTargetM),
              speedKmh: Math.round(kmh),
            }, 0);
            drLatRef.current = appliedSnap.latitude;
            drLngRef.current = appliedSnap.longitude;
            lastSetLocRef.current = {
              lat: appliedSnap.latitude,
              lng: appliedSnap.longitude,
            };
            feedDRRef.current(
              { latitude: appliedSnap.latitude, longitude: appliedSnap.longitude },
              Math.max(0, (kmh || sustainedKmh || motionKmh) / 3.6),
              drivingHeading || lastHeadingRef.current || 0,
            );
          }
          if (
            !V10_CLIENT_FIRST
            && prevMarkerDiag
            && (kmh >= 6 || motionKmh >= 8 || sustainedKmh >= 6)
            && markerMovedM < 0.8
            && now - prevMarkerDiag.at > 3000
            && (drToTargetM == null || drToTargetM >= 3)
          ) {
            vroomGpsLog('MARKER_STUCK_SUSPECT', {
              speedKmh: Math.round(kmh),
              motionKmh: Math.round(motionKmh),
              sustainedKmh: Math.round(sustainedKmh),
              markerMovedM: Number(markerMovedM.toFixed(2)),
              ageMs: Math.round(now - prevMarkerDiag.at),
              drToTargetM: drToTargetM != null ? Math.round(drToTargetM) : null,
            }, 1000);
            // MARKER STUCK RECOVERY (analiza mphanl3x): 28× MARKER_STUCK_SUSPECT
            // z drToTargetM do 240 m mimo speed 93 km/h. DR ekstrapoluje POZA
            // appliedSnap, marker wylatuje poza ekran. Fix: po 2+ stucks w 4 s
            // robimy hard reset DR na appliedSnap.
            if (
              drToTargetM != null
              && drToTargetM >= 40
              && now - lastMarkerStuckRecoveryAtRef.current > 4000
            ) {
              const streak = markerStuckStreakRef.current;
              if (!streak || now - streak.startAt > 4000) {
                markerStuckStreakRef.current = { startAt: now, drToTargetM };
              } else if (now - streak.startAt >= 2000) {
                lastMarkerStuckRecoveryAtRef.current = now;
                markerStuckStreakRef.current = null;
                // RECOVERY LOOP DETECTION (analiza mphbhukq):
                // jeśli ten sam snap point (≤8 m) odpala recovery 2+ raz,
                // znaczy że snap geometria jest martwa — czyścimy ją i wymuszamy
                // świeży map-match. Bez tego marker tkwi 64 m off przez minuty.
                const prevRecovery = lastRecoverySnapRef.current;
                const sameAsLast =
                  prevRecovery
                  && haversineKm(
                    prevRecovery.lat,
                    prevRecovery.lng,
                    appliedSnap.latitude,
                    appliedSnap.longitude,
                  ) * 1000 < 8;
                const recoveryCount = sameAsLast && prevRecovery
                  ? prevRecovery.count + 1
                  : 1;
                lastRecoverySnapRef.current = {
                  lat: appliedSnap.latitude,
                  lng: appliedSnap.longitude,
                  count: recoveryCount,
                };
                const shouldNukeGeometry =
                  recoveryCount >= 2
                  && now - lastRecoveryGeometryResetAtRef.current > 8000;
                vroomGpsLog('MARKER_STUCK_RECOVERY', {
                  drToTargetM: Math.round(drToTargetM),
                  speedKmh: Math.round(kmh),
                  appliedSnapLat: Number(appliedSnap.latitude.toFixed(6)),
                  appliedSnapLng: Number(appliedSnap.longitude.toFixed(6)),
                  loopCount: recoveryCount,
                  geometryReset: shouldNukeGeometry,
                }, 0);
                drLatRef.current = appliedSnap.latitude;
                drLngRef.current = appliedSnap.longitude;
                lastSetLocRef.current = {
                  lat: appliedSnap.latitude,
                  lng: appliedSnap.longitude,
                };
                feedDRRef.current(
                  { latitude: appliedSnap.latitude, longitude: appliedSnap.longitude },
                  Math.max(0, (kmh || sustainedKmh || motionKmh) / 3.6),
                  drivingHeading || lastHeadingRef.current || 0,
                );
                if (shouldNukeGeometry) {
                  lastRecoveryGeometryResetAtRef.current = now;
                  lastRecoverySnapRef.current = null;
                  applyRoadMatchPoints([], { skipResync: true });
                  runMapMatchRecovery(
                    {
                      reason: 'MARKER_STUCK',
                      lat: rawLat,
                      lng: rawLng,
                      speedKmh: Math.max(kmh, Math.min(motionKmh, MAX_REALISTIC_DRIVING_KMH)),
                      forceImmediate: true,
                    },
                    (p) => {
                      if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                    },
                  );
                }
              }
            }
          } else if (drToTargetM != null && drToTargetM < 20) {
            markerStuckStreakRef.current = null;
          }
          if (!prevMarkerDiag || markerMovedM >= 0.8) {
            lastMarkerDiagRef.current = { lat: appliedSnap.latitude, lng: appliedSnap.longitude, at: now };
          }
        }

        if (isDrivingRef.current) {
          const stall = drivingMarkerStallRef.current;
          stall.rawLat = lat;
          stall.rawLng = lng;
          const drMovedM = haversineKm(stall.drLat, stall.drLng, drLatRef.current, drLngRef.current) * 1000;
          if (drMovedM >= 1.5 || stall.at === 0) {
            stall.drLat = drLatRef.current;
            stall.drLng = drLngRef.current;
            stall.at = Date.now();
          }
        }

        // ── RECOVERY TELEPORT WYŁĄCZONY W TRYBIE JAZDY ──
        // Stary recovery odpalał bumpActiveMarker({instant:true}) co ~2s, co
        // teleportowało marker z powrotem na surowy GPS i kasowało projekcję
        // bridge'a. Marker oscylował ±14m. Bridge + anti-backward w useDeadReckoning
        // robią pełną robotę bez teleportów. Pomocnicze: poniżej tylko sprawdzamy
        // czy lastBumpActiveMarkerAt nie zestarzeje się dla diagnostyki.
        // (intencjonalnie pusty blok — żeby zachować lokalną telemetrię na bumpAgeMs)
        void isDrivingRef.current;

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
            drivingManualModeRef.current = false;
            driveSessionGuardRef.current.reset();
            startTrip(Number(routeInfoRef.current?.duration) || 0);
            passiveTripStartedRef.current = true;
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

            const reSnap = drivingSnap(lat, lng, kmh, isNavigatingRef.current, true, acc ?? null);
            let entryLat = reSnap.snapped ? reSnap.latitude : appliedSnap.latitude;
            let entryLng = reSnap.snapped ? reSnap.longitude : appliedSnap.longitude;
            const anchor = resolveDrivingAnchor();
            if (!reSnap.snapped && anchor) {
              entryLat = anchor.latitude;
              entryLng = anchor.longitude;
            }
            if (anchor) {
              const c = clampCoordStep(anchor, { latitude: entryLat, longitude: entryLng }, 40);
              entryLat = c.latitude;
              entryLng = c.longitude;
            }

            isDrivingRef.current = true;
            drLatRef.current = entryLat;
            drLngRef.current = entryLng;
            lastSetLocRef.current = { lat: entryLat, lng: entryLng };
            lastGoodLocRef.current = { lat, lng };
            drivingEntryAnchorRef.current = { lat: entryLat, lng: entryLng };
            drivingEntryGraceUntilRef.current = Date.now() + DRIVING_ENTRY_GRACE_MS;

            if (DRIVE_CORE_V2) {
              driveCore.reset({ lat: entryLat, lng: entryLng }, { heading: drivingHeading });
              resetTravelHeadingState(entryLat, entryLng, drivingHeading);
              getTripHeadingFilter().reset(drivingHeading);
              driveMarker.reset({ lat: entryLat, lng: entryLng, heading: drivingHeading });
              resetMarkerFeedState();
              resetRoadMarkerPoseState();
              tripMarkerV2BootstrappedRef.current = true;
              lastTripMarkerPoseRef.current = { lat: entryLat, lng: entryLng };
              driveMarker.resetTo(entryLat, entryLng, drivingHeading);
              pushDriveMarkerV2(driveMarker, entryLat, entryLng, drivingHeading, {
                durationMs: TRIP_GPS_FEED_MIN_MS,
                speedMs: 0,
                hudKmh: kmh,
                allowInstant: true,
              });
            } else {
              applyTripPosition(entryLat, entryLng, {
                heading: drivingHeading,
                speedMs: sanitizedSpeedMs ?? 0,
                forcePublish: true,
                instant: true,
                allowInstantFeed: true,
              });
            }
            setIsDriving(true);
            recordDrivingTracePoint(entryLat, entryLng, { speedKmh: kmh }).catch(() => {});
            recenterTo({
              center: { latitude: entryLat, longitude: entryLng },
              heading: drivingHeading,
              speedKmh: kmh > 0 ? kmh : 0,
              active: true,
              entryAnim: true,
            });
            setFollowMode('drivingFollow');
            pushCameraFromSmoothRef.current(entryLat, entryLng, drivingHeading);
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

          drivingLastLocRef.current = { lat: appliedSnap.latitude, lng: appliedSnap.longitude };

          let drTarget = { latitude: appliedSnap.latitude, longitude: appliedSnap.longitude };
          const drAnchorOk =
            Number.isFinite(drLatRef.current)
            && Number.isFinite(drLngRef.current)
            && drLatRef.current !== 0
            && drLngRef.current !== 0;
          const drAnchor = drAnchorOk
            ? { latitude: drLatRef.current, longitude: drLngRef.current }
            : drTarget;
          const targetStepM = haversineKm(
            drAnchor.latitude,
            drAnchor.longitude,
            drTarget.latitude,
            drTarget.longitude,
          ) * 1000;
          const rawStepM = lastRawForHeadingRef.current
            ? haversineKm(lastRawForHeadingRef.current.lat, lastRawForHeadingRef.current.lng, rawLat, rawLng) * 1000
            : Infinity;
          // Bridge tylko gdy GPS realnie dostarcza fixy (lat/lng zamrożone, ale Doppler żywy)
          // i nie jesteśmy w trakcie resume-freeze — inaczej po wybudzeniu z tła projekcja
          // wymyślałaby trasę zanim przyjdzie pierwszy świeży fix.
          const gpsTickAgeForBridgeMs = lastGpsTickAtRef.current > 0
            ? now - lastGpsTickAtRef.current
            : Number.POSITIVE_INFINITY;
          const inResumeFreeze =
            tripResumeFreezeUntilRef.current > now
            && !!tripResumeAnchorRef.current;
          const dtSecForBridge = Math.max(0.2, Math.min(speedDtMs / 1000, 2.5));
          const expectedStepM = drInputSpeedMs * dtSecForBridge;
          // raw "zamarł" gdy jego realne przesunięcie jest <40% przewidywanego z prędkości
          const rawLooksFrozen = rawStepM < Math.max(2.5, expectedStepM * 0.4);
          // ── KRYTYCZNE: bridge wymaga DOPPLER GPS (rawSpeedMs) ──
          // sanitized `kmh` może być zatrute fałszywym derivedKmh z GPS jitter
          // (Android stoi w garażu, lat/lng skacze 30m co tick → derivedKmh=140
          // km/h MIMO POSTOJU). Doppler GPS (loc.coords.speed) jest niezależny
          // od lat/lng i poprawnie zwraca 0 km/h gdy auto stoi. Bridge MUSI
          // używać Dopplera — bez tego marker uciekał po mapie przy postoju.
          const rawGpsKmhForBridge = rawSpeedMs != null && rawSpeedMs > 0
            ? rawSpeedMs * 3.6
            : 0;
          // Bridge ma działać NIEZALEŻNIE od targetStepM — gdy raw GPS jest zamrożony
          // a prędkość Dopplera jest żywa, projektujemy marker DALEJ od ostatniej
          // pozycji DR (drAnchor), żeby utrzymać płynny ruch klatka po klatce.
          const gpsFrozenWhileMoving =
            !V10_CLIENT_FIRST
            && isDrivingRef.current
            && kmh >= 8
            && rawGpsKmhForBridge >= 5
            && rawLooksFrozen
            && Number.isFinite(drivingHeading)
            && drAnchorOk
            && gpsTickAgeForBridgeMs <= 2500
            && !inResumeFreeze;
          // v10.12: bridge WYLACZONY w V10 — marker plynie przez worklet+snap,
          // bridge sztucznie przesuwal pozycje gdy GPS drgnal o 1-2m.
          let bridgeFired = false;
          if (gpsFrozenWhileMoving) {
            const stepM = Math.min(44, Math.max(4, expectedStepM));
            const projected = projectCoord(drAnchor, drivingHeading, stepM);
            drTarget = clampCoordStep(drAnchor, projected, stepM);
            appliedSnap = {
              ...appliedSnap,
              latitude: drTarget.latitude,
              longitude: drTarget.longitude,
              snapped: true,
            };
            bridgeFired = true;
            vroomGpsLog('DR_FROZEN_GPS_BRIDGE', {
              kmh: Math.round(kmh),
              rawGpsKmh: Number(rawGpsKmhForBridge.toFixed(1)),
              rawStepM: Number(rawStepM.toFixed(1)),
              targetStepM: Number(targetStepM.toFixed(1)),
              stepM: Number(stepM.toFixed(1)),
              heading: Math.round(drivingHeading),
              drInputSpeedMs: Number(drInputSpeedMs.toFixed(2)),
              gpsTickAgeMs: Math.round(gpsTickAgeForBridgeMs),
              drAnchorLat: Number(drAnchor.latitude.toFixed(6)),
              drAnchorLng: Number(drAnchor.longitude.toFixed(6)),
              drTargetLat: Number(drTarget.latitude.toFixed(6)),
              drTargetLng: Number(drTarget.longitude.toFixed(6)),
            }, 1200);
          } else if (
            isDrivingRef.current
            && kmh >= 8
            && drAnchorOk
            && targetStepM > 6
            && targetStepM <= 60
          ) {
            // Raw się odświeżył ale jest DUŻO za nami w stosunku do drift — nie cofaj
            // markera siłą; pozwól DR anti-backward w feedDR poprowadzić go dalej
            // forward, a appliedSnap pozostaje raw — DR sam zdecyduje.
            // (no-op: zostawiamy oryginalny drTarget = appliedSnap; feedDR sam projektuje)
          }

          // ── KRYTYCZNE: zaktualizuj lastSetLocRef do drTarget (PO bridge) ──
          // Bez tego anchor zostaje na raw_snap (zamrożone na iOS lat/lng) a DR
          // ekstrapoluje DO PRZODU → driftFromSnapM rośnie i kasowało projekcję.
          // Teraz anchor podąża za bridge'em, więc drift jest mały (~0–30m).
          lastSetLocRef.current = { lat: drTarget.latitude, lng: drTarget.longitude };

          // ── DRIVE_PIPELINE_TICK: snapshot stanu pipeline (throttled 2s) ──
          vroomGpsLog('DRIVE_PIPELINE_TICK', {
            mode: 'driving',
            rawLat: Number(rawLat.toFixed(6)),
            rawLng: Number(rawLng.toFixed(6)),
            drAnchorLat: Number(drAnchor.latitude.toFixed(6)),
            drAnchorLng: Number(drAnchor.longitude.toFixed(6)),
            drTargetLat: Number(drTarget.latitude.toFixed(6)),
            drTargetLng: Number(drTarget.longitude.toFixed(6)),
            speedKmh: Math.round(kmh),
            rawGpsKmh: Number(rawGpsKmhForBridge.toFixed(1)),
            heading: Math.round(drivingHeading || 0),
            bridgeFired,
            rawStepM: Number(rawStepM.toFixed(1)),
            targetStepM: Number(targetStepM.toFixed(1)),
            gpsTickAgeMs: Math.round(gpsTickAgeForBridgeMs),
            inResumeFreeze,
            rawLooksFrozen,
          }, 2000);

          if (V10_CLIENT_FIRST) {
            // v10.4: driving marker primary MUST follow hard snap output.
            // raw GPS bywa zaszumiony na postoju (teleporty), a appliedSnap ma
            // juz clampy + stationary hold + hardRoadSnap guarantees.
            let primaryLat = appliedSnap.latitude;
            let primaryLng = appliedSnap.longitude;
            const roadPtsDrive = drivingSnapGeometryRef.current;
            const workletSpeedMs = (() => {
              const ignoreHold = speedKmhRaw >= 12 || rawGpsKmhRef.current >= 12;
              if (
                isWorkletStationaryHold(
                  parkedLikeNow,
                  kmh,
                  rawGpsKmhForSpike,
                  motionKmh,
                  netMoveM,
                  accelBypassActive,
                  isDrivingRef.current,
                )
                && !ignoreHold
              ) return 0;
              if (coordsFrozenDrivingTick && !accelBypassActive) return 0;
              const feedKmh = tripFeedSpeedKmh(
                kmh,
                drInputSpeedMs > 0 ? drInputSpeedMs : undefined,
                motionKmh,
                sustainedKmh,
                rawGpsKmhForSpike,
              );
              const finalFeedKmh = feedKmh <= 0 && ignoreHold
                ? Math.max(speedKmhRaw, rawGpsKmhRef.current)
                : feedKmh;
              if (finalFeedKmh >= 3) return finalFeedKmh / 3.6;
              if (drInputSpeedMs > 0.08) return drInputSpeedMs;
              if (motionKmh >= 4) return motionKmh / 3.6;
              return 0;
            })();
            if (
              roadPtsDrive.length >= 2
              && !tripMarkerFrozen
              && !parkedLikeNow
              && !isWorkletStationaryHold(
                parkedLikeNow,
                kmh,
                rawGpsKmhForSpike,
                motionKmh,
                netMoveM,
                accelBypassActive,
                isDrivingRef.current,
              )
            ) {
              const locked = projectOntoDrivingRoad(
                primaryLat,
                primaryLng,
                rawLat,
                rawLng,
                roadPtsDrive,
                kmh >= 35 ? 62 : 52,
              );
              if (locked) {
                primaryLat = locked.latitude;
                primaryLng = locked.longitude;
              }
            }
            if (tripMarkerFrozen || parkedLikeNow) {
              const pin = lastSetLocRef.current ?? { lat: primaryLat, lng: primaryLng };
              const frozen = freezeMarkerOnRoad(pin, roadPtsDrive);
              primaryLat = frozen.lat;
              primaryLng = frozen.lng;
            }
            const markerAnchor = lastSetLocRef.current ?? { lat: primaryLat, lng: primaryLng };
            let rawToMarkerM = haversineKm(markerAnchor.lat, markerAnchor.lng, rawLat, rawLng) * 1000;
            if (
              rawToMarkerM > 18
              && roadPtsDrive.length >= 2
              && !parkedLikeNow
              && kmh >= 6
              && netMoveM >= 12
            ) {
              const rawOnRoad = projectOntoDrivingRoad(
                rawLat,
                rawLng,
                rawLat,
                rawLng,
                roadPtsDrive,
                62,
              );
              if (rawOnRoad) {
                const catchupStepM = accelBypassActive
                  ? rawToMarkerM
                  : Math.min(
                    drivingSnapDynamicStepCapM(
                      snapCapSpeedKmh,
                      rawToMarkerM,
                      { intervalSec: snapIntervalSec, accelBypass: true },
                    ),
                    Math.max(12, rawToMarkerM * 0.48),
                  );
                const stepped = stepTowardSnapOnPolyline(
                  markerAnchor.lat,
                  markerAnchor.lng,
                  rawOnRoad.latitude,
                  rawOnRoad.longitude,
                  roadPtsDrive,
                  catchupStepM,
                  90,
                );
                primaryLat = stepped.latitude;
                primaryLng = stepped.longitude;
                markerLogTick('V10_PRIMARY_ROAD_CATCHUP', {
                  rawToMarkerM: Math.round(rawToMarkerM),
                  catchupStepM: Number(catchupStepM.toFixed(1)),
                  roadPts: roadPtsDrive.length,
                }, 900);
              }
            }
            vroomGpsLog('V10_PRIMARY_SNAP', {
              snapped: appliedSnap.snapped,
              noRoad,
              kmh: Math.round(kmh),
              rawStepM: Number(rawStepM.toFixed(1)),
              primaryLat: Number(primaryLat.toFixed(6)),
              primaryLng: Number(primaryLng.toFixed(6)),
              rawLat: Number(rawLat.toFixed(6)),
              rawLng: Number(rawLng.toFixed(6)),
              rawToMarkerM: Math.round(rawToMarkerM),
            }, 2000);
            logSnapPipelineEnd(rawLat, rawLng, primaryLat, primaryLng, {
              path: 'v10_primary',
              snapped: appliedSnap.snapped,
              roadPts: roadPtsDrive.length,
              workletSpeedMs: Number(workletSpeedMs.toFixed(2)),
              kmh: Math.round(kmh),
            });

            let headingForFeed = drivingHeading;
            // Snap Lock Guard: przy szybkiej jeździe (>=30 km/h) pojedynczy odczyt snapu na boczną uliczkę
            // blokujemy dopóki nie potwierdzi się 2× kolejnymi fixami (lub kierunek się utrwali).
            if (kmh >= 30 && Number.isFinite(drivingHeading)) {
              const cand = { lat: primaryLat, lng: primaryLng };
              const candHdg = drivingHeading;
              const lock = snapLockPosRef.current;
              const nowLock = Date.now();
              const turnModeSnap = turnModeUntilRef.current > nowLock;
              if (!lock) {
                snapLockPosRef.current = cand;
                snapLockHdgRef.current = candHdg;
                snapLockStreakRef.current = 0;
                snapLockLastAtRef.current = nowLock;
              } else if (turnModeSnap) {
                snapLockPosRef.current = cand;
                snapLockHdgRef.current = candHdg;
                snapLockStreakRef.current = 0;
                snapLockLastAtRef.current = nowLock;
              } else {
                const movedM = haversineKm(lock.lat, lock.lng, cand.lat, cand.lng) * 1000;
                const hdgDelta = Math.abs(((candHdg - snapLockHdgRef.current + 540) % 360) - 180);
                if (hdgDelta >= 42) {
                  turnModeUntilRef.current = nowLock + TURN_MODE_DURATION_MS;
                  vroomGpsLog('TURN_MODE_ON', { hdgDelta: Math.round(hdgDelta) }, 1200);
                }
                const lateralFromRoadM = (() => {
                  const pts = drivingSnapGeometryRef.current;
                  if (pts.length < 2) return 0;
                  const dense = pts.length <= 8 ? densifyPolyline(pts, 6) : pts;
                  const proj = projectOntoPolylineWithIndex(rawLat, rawLng, dense, 90);
                  return proj?.distM ?? 999;
                })();
                const probSideStreet =
                  movedM >= 4
                  && hdgDelta >= 45
                  && lateralFromRoadM >= 18;
                if (probSideStreet) {
                  const withinWindow = nowLock - snapLockLastAtRef.current <= 1800;
                  snapLockStreakRef.current = withinWindow ? snapLockStreakRef.current + 1 : 1;
                  snapLockLastAtRef.current = nowLock;
                  // Ostry zakręt (>=45°): akceptuj segment od 1. ticka — nie czekaj na 2×
                  // (worklet + marker inaczej jadą starą polilinią, potem teleport).
                  const minLockStreak = hdgDelta >= 45 ? 1 : 2;
                  if (snapLockStreakRef.current >= minLockStreak) {
                    snapLockPosRef.current = cand;
                    snapLockHdgRef.current = candHdg;
                    snapLockStreakRef.current = 0;
                  } else {
                    primaryLat = lock.lat;
                    primaryLng = lock.lng;
                    headingForFeed = snapLockHdgRef.current;
                  }
                } else {
                  snapLockPosRef.current = cand;
                  snapLockHdgRef.current = candHdg;
                  snapLockStreakRef.current = 0;
                  snapLockLastAtRef.current = nowLock;
                }
              }
            }

            applyTripPosition(primaryLat, primaryLng, {
              heading: headingForFeed,
              speedMs: (tripMarkerFrozen || parkedLikeNow) ? 0 : workletSpeedMs,
              forcePublish: false,
              instant: !tripMarkerFrozen && (accelBypassActive || launchFromStop),
              allowInstantFeed: !tripMarkerFrozen && (accelBypassActive || launchFromStop),
              accelBypass: !tripMarkerFrozen && accelBypassActive,
              skipChase: tripMarkerFrozen || parkedLikeNow,
              skipRawChase: tripMarkerFrozen || parkedLikeNow,
              commitGood:
                !parkedLikeNow
                && !tripMarkerFrozen
                && rawStepParkM < maxPlausibleDrivingStepM(0, Math.max(kmh, rawGpsKmhForSpike)) * 1.35,
              rawLat,
              rawLng,
              roadPts: roadPtsDrive,
              parkedLike: tripMarkerFrozen || isWorkletStationaryHold(
                parkedLikeNow,
                speedKmhRef.current,
                rawGpsKmhForSpike,
                motionKmh,
                netMoveM,
                accelBypassActive,
                isDrivingRef.current,
              ),
              rawStepM: rawStepParkM,
              motionKmh,
              netMoveM,
              pathMoveM,
              rawMotionDetected: snapMotionWake,
            });
            navDriveTrace('TICK', {
              kmh: Math.round(kmh),
              rawGpsKmh: Math.round(rawGpsKmhForSpike),
              netMoveM: Math.round(netMoveM),
              pathMoveM: Math.round(pathMoveM),
              sustainedKmh: Number(sustainedKmh.toFixed(1)),
              parkedLike: parkedLikeNow,
              frozen: tripMarkerFrozen,
              primaryLat: Number(primaryLat.toFixed(6)),
              primaryLng: Number(primaryLng.toFixed(6)),
              workletSpeedMs: Number(workletSpeedMs.toFixed(2)),
              accelBypass: accelBypassActive,
              feedSource: lastWorkletFeedSourceRef.current,
            });
            tripAccelState.prevFeedSpeedKmh = tripFeedSpeedKmh(
              kmh,
              workletSpeedMs,
              motionKmh,
              sustainedKmh,
              rawGpsKmhForSpike,
            );
            // Local snap refinement only when we do NOT have a reliable snap yet.
            // Bez tego potrafilo "przerzucac" marker miedzy geometriami na postoju.
            // Refinement tylko gdy brak snapu — inaczej ping-pong miedzy geometriami.
            if (!V10_CLIENT_FIRST && !parkedLikeNow && (!appliedSnap.snapped || noRoad)) {
              void getLocalSnapTarget(rawLat, rawLng).then((result: { latitude: number; longitude: number; source: string } | null) => {
                if (!result || !isDrivingRef.current) return;
                const driftFromPrimaryM = haversineKm(
                  primaryLat,
                  primaryLng,
                  result.latitude,
                  result.longitude,
                ) * 1000;
                if (driftFromPrimaryM < 4 || driftFromPrimaryM > 16) return;
                lastClientSnapSourceRef.current = result.source;
                applyTripPosition(result.latitude, result.longitude, {
                  heading: drivingHeading,
                  speedMs: drInputSpeedMs,
                  forcePublish: false,
                  commitGood: false,
                  skipWorkletFeed: true,
                });
              }).catch(() => {});
            }
          } else {
            feedDR(
              drTarget,
              drInputSpeedMs,
              drivingHeading,
            );
            // Camera is now driven by DR onFrame at ~60fps (same as navigation mode)
          }

        } else if (isDrivingRef.current && V10_CLIENT_FIRST) {
          // Wolna jazda / coords frozen — nadal snap + worklet (bez gałęzi hold speed=0).
          drivingConsecutiveRef.current = 0;
          let slowLat = appliedSnap.latitude;
          let slowLng = appliedSnap.longitude;
          const roadPtsSlow = drivingSnapGeometryRef.current;
          const slowSpeedMs = drInputSpeedMs > 0.08
            ? drInputSpeedMs
            : (motionKmh >= 3 ? motionKmh / 3.6 : (kmh >= 3 ? kmh / 3.6 : 0));
          if (
            roadPtsSlow.length >= 2
            && !isWorkletStationaryHold(
              parkedLikeNow,
              kmh,
              rawGpsKmhForSpike,
              motionKmh,
              netMoveM,
              false,
              isDrivingRef.current,
            )
          ) {
            const locked = projectOntoDrivingRoad(
              slowLat,
              slowLng,
              rawLat,
              rawLng,
              roadPtsSlow,
              52,
            );
            if (locked) {
              slowLat = locked.latitude;
              slowLng = locked.longitude;
            }
          }
          logSnapPipelineEnd(rawLat, rawLng, slowLat, slowLng, {
            path: 'v10_slow',
            snapped: appliedSnap.snapped,
            roadPts: roadPtsSlow.length,
            workletSpeedMs: Number(slowSpeedMs.toFixed(2)),
            kmh: Math.round(kmh),
          });
          if (tripMarkerFrozen || parkedLikeNow) {
            const pin = lastSetLocRef.current ?? { lat: slowLat, lng: slowLng };
            const frozen = freezeMarkerOnRoad(pin, roadPtsSlow);
            slowLat = frozen.lat;
            slowLng = frozen.lng;
          }
          applyTripPosition(slowLat, slowLng, {
            heading: drivingHeading,
            speedMs: (tripMarkerFrozen || parkedLikeNow) ? 0 : slowSpeedMs,
            skipChase: tripMarkerFrozen || parkedLikeNow,
            skipRawChase: tripMarkerFrozen || parkedLikeNow,
            parkedLike: tripMarkerFrozen || isWorkletStationaryHold(
              parkedLikeNow,
              speedKmhRef.current,
              rawGpsKmhForSpike,
              motionKmh,
              netMoveM,
              false,
              isDrivingRef.current,
            ),
            forcePublish: true,
            commitGood:
              !parkedLikeNow
              && rawStepParkM < maxPlausibleDrivingStepM(0, Math.max(kmh, rawGpsKmhForSpike)) * 1.35,
            rawLat,
            rawLng,
            roadPts: roadPtsSlow,
            rawStepM: rawStepParkM,
            motionKmh,
            netMoveM,
            rawMotionDetected: snapMotionWake,
          });
        } else if (!isDrivingRef.current) {
          // ── Wolno / stoi — reset licznika (nie w aktywnej jeździe) ───────────
          drivingConsecutiveRef.current = 0;
        } else {
          drivingConsecutiveRef.current = 0;
          if (!V10_CLIENT_FIRST) {
            const anchorOk =
              Number.isFinite(drLatRef.current)
              && Number.isFinite(drLngRef.current)
              && drLatRef.current !== 0
              && drLngRef.current !== 0;
            const anchor = anchorOk
              ? { latitude: drLatRef.current, longitude: drLngRef.current }
              : { latitude: appliedSnap.latitude, longitude: appliedSnap.longitude };
            const holdSpeedMs = parkedLikeNow ? 0 : (kmh >= 8 ? drInputSpeedMs : 0);
            const holdTarget = { latitude: appliedSnap.latitude, longitude: appliedSnap.longitude };
            // Anchor podąża za holdTarget — to samo rozwiązanie co w gorącej ścieżce,
            // żeby DR.onFrame nigdy nie ściągnęło markera siłą do raw_snap.
            lastSetLocRef.current = { lat: holdTarget.latitude, lng: holdTarget.longitude };
            vroomGpsLog('DRIVE_PIPELINE_TICK', {
              mode: 'driving_hold',
              rawLat: Number(rawLat.toFixed(6)),
              rawLng: Number(rawLng.toFixed(6)),
              drLat: Number((drLatRef.current || 0).toFixed(6)),
              drLng: Number((drLngRef.current || 0).toFixed(6)),
              holdTargetLat: Number(holdTarget.latitude.toFixed(6)),
              holdTargetLng: Number(holdTarget.longitude.toFixed(6)),
              speedKmh: Math.round(kmh),
              holdSpeedMs: Number(holdSpeedMs.toFixed(2)),
              heading: Math.round(drivingHeading || 0),
            }, 3000);
            feedDR(
              holdTarget,
              holdSpeedMs,
              drivingHeading,
            );
          }
        }

          if (
            isDrivingRef.current
            && !drivingManualModeRef.current
            && !isNavigatingRef.current
          ) {
            const guardKmh = driveSessionGuardRef.current.resolveSpeedKmh(
              loc.speed,
              Math.max(kmh, motionKmh, sustainedKmh, speedKmhRef.current, rawGpsKmhForSpike),
              now,
            );
            maybeAutoStopFromSessionGuard(guardKmh, movingForDriving);
          }

      } else {
        // ── Nawigacja — snap do trasy ─────────────────────────
        const navPts = routePointsRef.current;
        if (navPts.length > 1) {
          const navSnapped = snapToRoute(lat, lng, navPts, NAV_ROUTE_SNAP_M);
          const prevNavLoc = lastNavLocRef.current;
          let navMoveHeading: number | null = null;
          if (prevNavLoc) {
            const navMoveM = haversineKm(
              prevNavLoc.latitude,
              prevNavLoc.longitude,
              navSnapped.latitude,
              navSnapped.longitude,
            ) * 1000;
            if (navMoveM >= 2.5) {
              navMoveHeading = bearingBetween(
                prevNavLoc.latitude,
                prevNavLoc.longitude,
                navSnapped.latitude,
                navSnapped.longitude,
              );
            }
          }
          // Distance/statistics for navigation should use snapped route position,
          // not raw filtered GPS (reduces jitter overcount and missing km spikes).
          if (
            appStateRef.current === 'active'
            && !parkedLikeNow
            && kmh >= 3
          ) {
            const navSegKm = feedPosition(navSnapped.latitude, navSnapped.longitude, sanitizedSpeedMs ?? undefined);
            if (navSegKm > 0) {
              recordDrivingTracePoint(navSnapped.latitude, navSnapped.longitude, { speedKmh: kmh }).catch(() => {});
            }
          }
          lastNavLocRef.current = { latitude: navSnapped.latitude, longitude: navSnapped.longitude };
          lastGoodLocRef.current = { lat: navSnapped.latitude, lng: navSnapped.longitude };
          const navIdx = findClosestPointIndex(navSnapped.latitude, navSnapped.longitude, navPts);
          let segmentBearing: number | null = null;
          if (navIdx < navPts.length - 1) {
            const nextPt = navPts[navIdx + 1];
            segmentBearing = bearingBetween(
              navSnapped.latitude,
              navSnapped.longitude,
              nextPt.latitude,
              nextPt.longitude,
            );
          } else if (navIdx > 0) {
            const prevPt = navPts[navIdx - 1];
            segmentBearing = bearingBetween(
              prevPt.latitude,
              prevPt.longitude,
              navSnapped.latitude,
              navSnapped.longitude,
            );
          }
          const headingRef = lastHeadingRef.current ?? 0;
          const navHeadingRaw = segmentBearing != null
            ? alignBearingToReference(segmentBearing, headingRef)
            : headingRef;
          const navCompassHdg = kmh < TRIP_COMPASS_HEADING_MAX_KMH ? loc.heading ?? null : null;
          const navHdg = resolveUnifiedHeading({
            snapHeading: segmentBearing,
            movementHeading: navMoveHeading,
            gpsHeading: navCompassHdg,
            previousHeading: lastHeadingRef.current || navHeadingRaw,
            speedKmh: kmh,
          });
          publishHeading(navHdg);
          lastHeadingRef.current = navHdg;
          applyTripPosition(navSnapped.latitude, navSnapped.longitude, {
            heading: navHdg,
            speedMs: parkedLikeNow ? 0 : drInputSpeedMs,
            forcePublish: true,
            commitGood: true,
          });
        } else {
          // Fallback when route points are not available yet: keep DR in sync
          // with filtered GPS to avoid frozen marker position during navigation.
          const navRaw = lastHeadingRef.current ?? 0;
          const navCompassFallback = kmh < TRIP_COMPASS_HEADING_MAX_KMH
            ? (loc.heading ?? navRaw)
            : null;
          const navHdg = resolveUnifiedHeading({
            snapHeading: null,
            movementHeading: null,
            gpsHeading: navCompassFallback,
            previousHeading: lastHeadingRef.current || navRaw,
            speedKmh: kmh,
          });
          publishHeading(navHdg);
          lastHeadingRef.current = navHdg;
          applyTripPosition(lat, lng, {
            heading: navHdg,
            speedMs: parkedLikeNow ? 0 : drInputSpeedMs,
            forcePublish: true,
            commitGood: true,
          });
          if (
            appStateRef.current === 'active'
            && !parkedLikeNow
            && kmh >= 3
          ) {
            const navSegKm = feedPosition(lat, lng, sanitizedSpeedMs ?? undefined);
            if (navSegKm > 0) {
              recordDrivingTracePoint(lat, lng, { speedKmh: kmh }).catch(() => {});
            }
          }
          lastNavLocRef.current = { latitude: lat, longitude: lng };
        }
      }

      publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });
    // clearStats / startTrip / routeInfo are read via stable refs (clearStats+startTrip from useTripStats are stable;
    // routeInfo via routeInfoRef) — do NOT list them here or every route preview tick tears down GPS watch.
    }, [drivingSnap, feedPosition, feedDR, startTrip, finishTrip, publishUserLocation, publishHeading, publishSpeed, setFollowMode, recenterTo, resetBrowseCamera, updateCameraFrame, addMatchPosition, getMatchedPoints, applyRoadMatchPoints, resetMapMatch, resetSnap, runMapMatchRecovery, mapMatchCoord, bumpMatchedFreshness, flushPendingKm, resolveDrivingAnchor, resyncSnapAfterRoadGeometry, bumpActiveMarker, bumpMapMarker, maybeClearDrivingManualDisable, applyTripPosition, syncDrivingRoadGeometry]),
  });

  const flushNavigationStatsOnce = useCallback((finalStats: {
    distanceKm: number;
    maxSpeedKmh: number;
    avgSpeedKmh: number;
    elapsedSec: number;
    trackedPoints: { latitude: number; longitude: number }[];
  }) => {
    if (navStatsFlushedRef.current) return;
    navStatsFlushedRef.current = true;
    flushPendingKm(true, {
      distanceKm: Math.max(0, Number(finalStats.distanceKm || 0) - tripCheckpointSavedKmRef.current),
      maxSpeedKmh: finalStats.maxSpeedKmh,
      avgSpeedKmh: finalStats.avgSpeedKmh,
      durationSec: finalStats.elapsedSec,
      routePoints: finalStats.trackedPoints,
    });
  }, [flushPendingKm]);

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

  // W trybie przeglądania wyczyść geometrię snapu z poprzedniej jazdy — unika teleportów na starą drogę.
  useEffect(() => {
    if (!isMapFocused || isDriving || isNavigating) return;
    resetSnapState();
    applyRoadMatchPoints([], { skipResync: true });
    drivingSnapGeometryRef.current = [];
    drivingSnapUsesMatchedRef.current = false;
    snapAnchorStaleRef.current = null;
    driftCriticalStreakRef.current = 0;
  }, [isMapFocused, isDriving, isNavigating, resetSnapState, applyRoadMatchPoints]);

  useEffect(() => {
    if (!isMapFocused || !userLocation) return;
    if (isDrivingRef.current || isNavigatingRef.current) return;
    feedDR(
      { latitude: userLocation.latitude, longitude: userLocation.longitude },
      0,
      lastHeadingRef.current || 0,
    );
  }, [isMapFocused, userLocation, feedDR]);

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
      void hardRestartGPS(`restart_${reason}`);
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
          applyTripPosition(navSnapped.latitude, navSnapped.longitude, {
            heading: navHdg,
            speedMs,
            forcePublish: true,
            instant: true,
            commitGood: true,
          });
          if (appStateRef.current === 'active') {
            feedPosition(navSnapped.latitude, navSnapped.longitude, speedMs);
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
          applyTripPosition(lat, lng, {
            heading: lastHeadingRef.current || 0,
            speedMs,
            forcePublish: true,
            instant: true,
            commitGood: true,
          });
          if (appStateRef.current === 'active') {
            feedPosition(lat, lng, speedMs);
          }
          lastAcceptedFixWallClockRef.current = Date.now();
          setGpsAcquiring(false);
          persistMapLocation(lat, lng, acc);
          gpsTelemetryRef.current.oneShotApplied += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_APPLY', JSON.stringify({ at: Date.now(), mode: 'navigation', snapped: false }));
          return;
        }

        if (isDrivingRef.current) {
          if (DRIVE_CORE_V2) {
            lastAcceptedFixWallClockRef.current = Date.now();
            setGpsAcquiring(false);
            persistMapLocation(lat, lng, acc);
            gpsTelemetryRef.current.oneShotApplied += 1;
            return;
          }
          const resumeFrozen = tripResumeFreezeUntilRef.current > Date.now();
          const snapAnchor = resolveDrivingAnchor();
          const matchedPts = getMatchedPoints();
          if (matchedPts && matchedPts.length > 1) applyRoadMatchPoints(matchedPts);
          const snapped = drivingSnap(lat, lng, speedKmh, isNavigatingRef.current, true, acc);
          let appliedLat = snapped.latitude;
          let appliedLng = snapped.longitude;
          if (!snapped.snapped || resumeFrozen) {
            const hold = snapAnchor
              ?? (tripResumeAnchorRef.current
                ? { latitude: tripResumeAnchorRef.current.lat, longitude: tripResumeAnchorRef.current.lng }
                : null);
            if (hold) {
              if (resumeFrozen && (speedKmh >= 6 || rawGpsKmhRef.current >= 6)) {
                tripResumeFreezeUntilRef.current = 0;
                tripResumeAnchorRef.current = null;
                tripResumeConfirmRef.current = null;
                tripResumeMotionWakeHitsRef.current = 0;
              }
              appliedLat = hold.latitude;
              appliedLng = hold.longitude;
              vroomGpsLog('ONE_SHOT_HOLD', {
                snapped: snapped.snapped,
                resumeFrozen,
                lat: Number(appliedLat.toFixed(5)),
                lng: Number(appliedLng.toFixed(5)),
              });
            }
          } else if (snapAnchor) {
            const correctionM = haversineKm(
              snapAnchor.latitude, snapAnchor.longitude,
              snapped.latitude, snapped.longitude,
            ) * 1000;
            const maxStepM = speedKmh < DRIVING_ENTRY_STATIONARY_KMH
              ? DRIVING_ENTRY_MAX_SNAP_M
              : 36;
            if (correctionM > maxStepM) {
              const c = clampCoordStep(snapAnchor, { latitude: snapped.latitude, longitude: snapped.longitude }, maxStepM);
              appliedLat = c.latitude;
              appliedLng = c.longitude;
            }
          }
          if (!snapped.snapped) {
            drivingNoSnapStreakRef.current += 1;
            if (speedKmh >= DRIVING_ENTRY_STATIONARY_KMH) {
              const nowNoSnap = Date.now();
              const useManualRecover =
                drivingNoSnapStreakRef.current >= FORCE_MAP_MATCH_RECOVER_STREAK
                && (nowNoSnap - lastDrivingNoSnapForceRef.current) >= FORCE_MAP_MATCH_RECOVER_MIN_INTERVAL_MS;
              if (useManualRecover) {
                lastDrivingNoSnapForceRef.current = nowNoSnap;
              }
              gpsTelemetryRef.current.snapRecoveryCalls += 1;
              runMapMatchRecovery(
                {
                  reason: useManualRecover ? 'SNAP_RECOVERY_MANUAL' : 'SNAP_RECOVERY',
                  lat,
                  lng,
                  speedKmh,
                },
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
          } else {
            drivingNoSnapStreakRef.current = 0;
          }
          lastSetLocRef.current = { lat: appliedLat, lng: appliedLng };
          drivingLastLocRef.current = { lat: appliedLat, lng: appliedLng };
          if (lastDrivingPosRef.current) {
            lastDrivingPosRef.current = { lat: appliedLat, lng: appliedLng };
          }
          applyTripPosition(appliedLat, appliedLng, {
            heading: lastHeadingRef.current,
            speedMs,
            forcePublish: true,
            commitGood: true,
            rawLat: lat,
            rawLng: lng,
            roadPts: drivingSnapGeometryRef.current,
          });
          if (appStateRef.current === 'active') {
            const segKm = feedPosition(appliedLat, appliedLng, speedMs);
            if (segKm > 0) {
              recordDrivingTracePoint(appliedLat, appliedLng, { speedKmh: speedKmh }).catch(() => {});
            }
          }
          lastAcceptedFixWallClockRef.current = Date.now();
          setGpsAcquiring(false);
          persistMapLocation(appliedLat, appliedLng, acc);
          gpsTelemetryRef.current.oneShotApplied += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_APPLY', JSON.stringify({ at: Date.now(), mode: 'driving', snapped: snapped.snapped }));
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
  }, [drivingSnap, feedPosition, runMapMatchRecovery, getMatchedPoints, applyRoadMatchPoints, publishUserLocation, persistMapLocation, resolveDrivingAnchor, applyTripPosition]);

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
  useEffect(() => {
    const id = setInterval(() => {
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
              V10_CLIENT_FIRST
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
              if (V10_CLIENT_FIRST) {
                applyTripPosition(rescueTarget.latitude, rescueTarget.longitude, {
                  heading: lastHeadingRef.current || 0,
                  speedMs: stallSpeedMs,
                  forcePublish: true,
                  rawLat: raw.latitude,
                  rawLng: raw.longitude,
                  roadPts: stallRoadPts,
                });
              } else {
                feedDRRef.current({ latitude: rescueTarget.latitude, longitude: rescueTarget.longitude }, stallSpeedMs, lastHeadingRef.current || 0);
              }
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
        const needsActiveRecovery = DRIVE_CORE_V2
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
    }, GPS_WATCHDOG_TICK_MS);
    return () => clearInterval(id);
  }, [
    restartGPSWatcher,
    refreshLocationOneShot,
    resyncSnapAfterRoadGeometry,
    performGpsHealthRecovery,
    maybeClearDrivingManualDisable,
    feedDR,
    bumpActiveMarker,
  ]);

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

  const syncTripCameraAfterResume = useCallback((lat: number, lng: number, heading: number) => {
    if (!isDrivingRef.current && !isNavigatingRef.current) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const hdg = Number.isFinite(heading) ? heading : 0;
    driveMarker.resetTo(lat, lng, hdg);
    driveMarker.ensureFrameActive?.();
    setFollowMode(isNavigatingRef.current ? 'navigationFollow' : 'drivingFollow');
    if (DRIVE_CORE_V2) {
      pushTripCameraFromApply(lat, lng, hdg, { instant: true });
      return;
    }
    recenterTo({
      center: { latitude: lat, longitude: lng },
      heading: hdg,
      speedKmh: speedKmhRef.current,
      active: true,
      isNavigating: isNavigatingRef.current,
      instant: true,
    });
    pushCameraFromSmooth(lat, lng, hdg);
    lastCamPushFromSmoothRef.current = Date.now();
    if (__DEV__) {
      console.log('[GPSDBG] CAMERA_RESYNC', JSON.stringify({
        at: Date.now(),
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
      }));
    }
    void logTelemetry('CAMERA_RESYNC', {
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
    });
  }, [driveMarker, setFollowMode, recenterTo, pushCameraFromSmooth, pushTripCameraFromApply]);

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
      driveCore.engine.quality.reset();
    }

    const tripActiveNow = isDrivingRef.current || isNavigatingRef.current;
    const fixAgeMs = lastAcceptedFixWallClockRef.current > 0
      ? now - lastAcceptedFixWallClockRef.current
      : Number.POSITIVE_INFINITY;
    const tickAgeMs = lastGpsTickAtRef.current > 0
      ? now - lastGpsTickAtRef.current
      : Number.POSITIVE_INFINITY;

    if (
      DRIVE_CORE_V2
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

      const syncLat = Number.isFinite(drLatRef.current) && drLatRef.current !== 0
        ? drLatRef.current
        : (lastSetLocRef.current?.lat ?? lastGoodLocRef.current?.lat);
      const syncLng = Number.isFinite(drLngRef.current) && drLngRef.current !== 0
        ? drLngRef.current
        : (lastSetLocRef.current?.lng ?? lastGoodLocRef.current?.lng);
      if (Number.isFinite(syncLat) && Number.isFinite(syncLng)) {
        syncTripCameraAfterResume(syncLat!, syncLng!, lastHeadingRef.current || 0);
      }
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
      tripForegroundRefreshUntilRef.current = now + TRIP_FOREGROUND_REFRESH_MS;
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
      const holdSpeedMs = Math.max(speedKmhRef.current / 3.6, 12 / 3.6);
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
        const resumeInstantSync = V10_CLIENT_FIRST
          || bgPauseMs >= TRIP_RESUME_BG_PAUSE_INSTANT_MS
          || jumpFromAnchorM >= TRIP_RESUME_INSTANT_JUMP_M;
        const freezeMs = (V10_CLIENT_FIRST || resumeInstantSync)
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
              lat: cachedLive.latitude,
              lng: cachedLive.longitude,
              t: now,
            },
          ];
        }
        speedSignalHoldUntilRef.current = now + TRIP_FOREGROUND_SPEED_HOLD_MS;
        const syncLat = V10_CLIENT_FIRST && cachedLive
          ? cachedLive.latitude
          : (resumeInstantSync && cachedLive ? cachedLive.latitude : anchorLatLng.lat);
        const syncLng = V10_CLIENT_FIRST && cachedLive
          ? cachedLive.longitude
          : (resumeInstantSync && cachedLive ? cachedLive.longitude : anchorLatLng.lng);
        drLatRef.current = syncLat;
        drLngRef.current = syncLng;
        lastSetLocRef.current = { lat: syncLat, lng: syncLng };
        lastGoodLocRef.current = { lat: syncLat, lng: syncLng };
        if (lastDrivingPosRef.current) {
          lastDrivingPosRef.current = { lat: syncLat, lng: syncLng };
        }
        if (V10_CLIENT_FIRST && !DRIVE_CORE_V2) {
          const resumeSpeedMs = Math.max(
            speedKmhRef.current / 3.6,
            12 / 3.6,
          );
          speedKmhRef.current = Math.max(speedKmhRef.current, 12);
          emitSpeedometerKmh(speedKmhRef.current);
          lastReliableSpeedMsRef.current = resumeSpeedMs;
          clearSmoothPositionFeed();
          applyTripPosition(syncLat, syncLng, {
            heading: hdg,
            forcePublish: true,
            allowInstantFeed: true,
            instant: true,
            rawLat: syncLat,
            rawLng: syncLng,
            speedMs: resumeSpeedMs,
            motionKmh: Math.max(speedKmhRef.current, 12),
          });
          publishUserLocation({ latitude: syncLat, longitude: syncLng }, true);
          syncTripCameraAfterResume(syncLat, syncLng, hdg);
        } else if (DRIVE_CORE_V2) {
          syncTripCameraAfterResume(syncLat, syncLng, hdg);
        } else {
          bumpActiveMarker(syncLat, syncLng, { heading: hdg, forcePublish: true, instant: true });
          feedDR({ latitude: syncLat, longitude: syncLng }, 0, hdg);
          syncTripCameraAfterResume(syncLat, syncLng, hdg);
        }
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
          v10: V10_CLIENT_FIRST,
          isDriving: isDrivingRef.current,
        });
        if (isDrivingRef.current && !DRIVE_CORE_V2) {
          const matched = getMatchedPoints();
          if (matched && matched.length > 1) {
            applyRoadMatchPoints(matched);
            bumpMatchedFreshness();
          }
          const matchLat = resumeInstantSync && cachedLive ? cachedLive.latitude : anchorLatLng.lat;
          const matchLng = resumeInstantSync && cachedLive ? cachedLive.longitude : anchorLatLng.lng;
          if (resumeInstantSync || speedKmhRef.current >= DRIVING_ENTRY_STATIONARY_KMH) {
            runMapMatchRecovery(
              {
                reason: 'GPS_RESUME',
                lat: matchLat,
                lng: matchLng,
                speedKmh: Math.max(speedKmhRef.current, 12),
                forceImmediate: resumeInstantSync,
              },
              (p) => {
                if (!isDrivingRef.current) return;
                if (p && p.length >= 2) {
                  applyRoadMatchPoints(p);
                  resyncSnapAfterRoadGeometry(
                    matchLat,
                    matchLng,
                    speedKmhRef.current,
                    null,
                    { maxStepM: DRIVING_ENTRY_MAX_SNAP_M },
                  );
                }
              },
            );
          }
        }
      }
    }
  }, [
    restartGPSWatcher,
    refreshLocationOneShot,
    startGPS,
    hardRestartGPS,
    ensureRegionBootstrapped,
    applyBootstrapLocation,
    feedDR,
    bumpActiveMarker,
    getMatchedPoints,
    applyRoadMatchPoints,
    bumpMatchedFreshness,
    runMapMatchRecovery,
    resyncSnapAfterRoadGeometry,
    resetBrowseCamera,
    publishUserLocation,
    applyTripPosition,
    syncTripCameraAfterResume,
    driveCore,
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
  const stopDRRef = useRef(stopDR);
  useEffect(() => {
    stopDRRef.current = stopDR;
  }, [stopDR]);

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
        if (DRIVE_CORE_V2) {
          driveCore.setAppBackground(true);
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
        }
        if (!isPremiumRef.current && tripActive) {
          void notifyBackgroundPremiumRequired();
        }
        if (!bgTrackingEnabled) {
          // Bez śledzenia w tle: zatrzymaj GPS tylko poza aktywną jazdą.
          // Krótkie przejście (np. zmiana muzyki) — watcher zostaje, powrót bez 15s freeze.
          if (!tripActive) {
            stopGPSRef.current();
            stopDRRef.current();
          }
        } else {
          // bgEnabled=true → trzymamy watcher i DR przy życiu w tle (Premium).
          if (!tripActive) {
            stopDRRef.current();
          }
        }
        // Live zostaje włączone w preferencjach — po powrocie z tła wznawiamy socket (resumeLiveSession).
      }
      const resumed =
        (prevState === 'background' || prevState === 'inactive') &&
        nextState === 'active';
      if (resumed) {
        if (DRIVE_CORE_V2) {
          driveCore.setAppBackground(false);
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
          setIsSharing(true);
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
      const camStaleMs = now - lastCamPushFromSmoothRef.current;
      if (
        ctx.tripActive
        && camStaleMs > 2000
        && lastSetLocRef.current
      ) {
        const { lat, lng } = lastSetLocRef.current;
        syncTripCameraAfterResume(lat, lng, lastHeadingRef.current || 0);
      }
    },
  });

  // ── Map tab focus: start/stop GPS (battery — no watch on other tabs) ─────
  const refreshMyProfile = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token')
        ?? await AsyncStorage.getItem('userToken');
      if (!token) return;
      const res = await fetch(`${API_URL}/api/profile/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const profileAvatar = data.avatarUrl ?? data.avatar ?? null;
      if (profileAvatar && typeof profileAvatar === 'string') {
        setMyAvatarUrl(
          profileAvatar.startsWith('http')
            ? profileAvatar
            : `${API_URL}${profileAvatar.startsWith('/') ? profileAvatar : `/${profileAvatar}`}`,
        );
      }
      if (data.username) setMyUsername(data.username);
      if (Number.isFinite(Number(data.totalDistance))) {
        profileTotalDistanceKmRef.current = Math.max(0, Number(data.totalDistance));
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
      if (!keepTripOnMapBlur) {
        stopDRRef.current();
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

      drLatRef.current  = lat;
      drLngRef.current  = lng;
      drHdgRef.current  = hdg;
      lastHeadingRef.current = hdg;

      currentLocRef.current = { latitude: lat, longitude: lng };
      speedKmhRef.current = Math.max(0, speedMs * 3.6);
      emitSpeedometerKmh(speedKmhRef.current);

      updateCameraFrame({
        center: { latitude: lat, longitude: lng },
        heading: hdg,
        speedKmh: speedMs * 3.6,
        isNavigating: true,
        isDriving: false,
        timestamp: Date.now(),
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
    }, [updateCameraFrame]),
    speedKmh:   120,
    intervalMs: 100,
  });

  useEffect(() => {
    if (isOffroadRoute && offroadPreviewRoute) {
      setRouteInfo({
        distance: offroadPreviewRoute.distance,
        duration: null,
        durationText: '—',
      });
      return;
    }
    if (previewRoute) {
      setRouteInfo({
        distance: (previewRoute.distanceValue / 1000).toFixed(1),
        duration: previewRoute.duration,
      });
    }
  }, [previewRoute, isOffroadRoute, offroadPreviewRoute]);

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
    const rerouteSig = pts.length >= 2
      ? `${pts.length}:${pts[0].latitude.toFixed(5)},${pts[0].longitude.toFixed(5)}:${pts[pts.length - 1].latitude.toFixed(5)},${pts[pts.length - 1].longitude.toFixed(5)}`
      : '';
    if (rerouteSig && lastAppliedRerouteSigRef.current === rerouteSig) return;
    lastAppliedRerouteSigRef.current = rerouteSig;

    const now = Date.now();
    reroutePendingRef.current = false;
    reroutePendingSinceRef.current = 0;
    rerouteBlockedUntilRef.current = 0;
    rerouteGraceUntilRef.current = now + REROUTE_GRACE_AFTER_APPLY_MS;
    setNavRouteOverride(rerouteResult);
    if (rerouteResult.points?.length) {
      routePointsRef.current = rerouteResult.points;
      if (DRIVE_CORE_V2) {
        driveCore.setRoutePolyline(rerouteResult.points);
        driveCore.applyMatchGeometry(rerouteResult.points);
        vroomGpsLog('NAV_REROUTE_GEOM_APPLY', {
          pts: rerouteResult.points.length,
          at: now,
        }, 0);
        visionEvent('NAV_REROUTE_OK', {
          pts: rerouteResult.points.length,
          at: now,
        });
      }
      const curLat = Number.isFinite(drLatRef.current) && drLatRef.current !== 0
        ? drLatRef.current
        : userLocation.latitude;
      const curLng = Number.isFinite(drLngRef.current) && drLngRef.current !== 0
        ? drLngRef.current
        : userLocation.longitude;
      const idx = findClosestPointIndex(curLat, curLng, rerouteResult.points);
      navRouteIdxRef.current = idx;
      setRemainingRoutePoints([
        { latitude: curLat, longitude: curLng },
        ...rerouteResult.points.slice(idx + 1),
      ]);
      lastRerouteMotionAnchorRef.current = { lat: curLat, lng: curLng };
    }
    setCurrentStep(0);
    announcedPhasesRef.current = new Set();
    lastSpokenRef.current    = '';
    offRouteSinceRef.current = 0;
    offRouteStreakRef.current = 0;
    setOffRoute(false);
    setRerouteOrigin(null);
    setRerouteHeadingForApi(undefined);
    Toast.show({
      type: 'info',
      text2: 'Nowa trasa od Twojej pozycji (w kierunku jazdy).',
    });
  }, [rerouteResult, offRoute, userLocation, driveCore]);

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

    const now   = Date.now();
    const since = now - lastRerouteTimeRef.current;

    if (since < REROUTE_COOLDOWN_MS && lastRerouteLocRef.current) {
      const movedM = haversineKm(
        vehicleLat,
        vehicleLng,
        lastRerouteLocRef.current.lat,
        lastRerouteLocRef.current.lng,
      ) * 1000;
      if (movedM < REROUTE_MIN_MOVED_M) {
        if (DEBUG_NETWORK) console.log('[reroute] cooldown — moved', movedM.toFixed(0), 'm, since last', since, 'ms');
        return;
      }
    }

    const travelHdg = resolveRerouteTravelHeadingDeg(
      vehicleLat,
      vehicleLng,
      lastHeadingRef.current,
      lastRerouteMotionAnchorRef.current ?? lastSetLocRef.current,
    );

    if (DEBUG_NETWORK) console.log('[reroute] triggering new reroute request', { travelHdg });
    reroutePendingRef.current = true;
    reroutePendingSinceRef.current = now;
    lastRerouteTimeRef.current = now;
    lastRerouteLocRef.current = { lat: vehicleLat, lng: vehicleLng };
    setRerouteHeadingForApi(quantizeHeading(travelHdg));
    setRerouteOrigin(buildRerouteOrigin({ lat: vehicleLat, lng: vehicleLng }));
    visionEvent('NAV_REROUTE_REQUEST', {
      vehicleLat: Number(vehicleLat.toFixed(6)),
      vehicleLng: Number(vehicleLng.toFixed(6)),
      travelHdg: Math.round(travelHdg),
      speedKmh: Math.round(speedKmhRef.current),
    });
  }, [offRoute, userLocation, endLocation]);

  useEffect(() => {
    if (!startIsMyLocationRef.current || !userLocation || isNavigating) return;
    // Keep the selected route anchor stable while destination preview is active.
    // Without this, tab switches can silently move "start" and produce bad reroute hints.
    if (endLocation) return;
    setStartLocation(prev => ({ ...userLocation, name: prev?.name ?? 'Moja pozycja' }));
  }, [userLocation, isNavigating, endLocation]);

  // GPS często przychodzi po wyborze celu — bez startu Directions nie wystartuje.
  useEffect(() => {
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

  const effectiveNavRoute = navRouteOverride ?? navRoute ?? (isNavigating ? previewRoute : null);
  const activeRoute = isNavigating ? effectiveNavRoute : previewRoute;
  navRouteRef.current = effectiveNavRoute ?? null;
  const activeSteps = effectiveNavRoute?.steps ?? previewRoute?.steps ?? [];

  useEffect(() => {
    const pts = activeRoute?.points?.length
      ? activeRoute.points
      : (isNavigating && routePointsRef.current.length ? routePointsRef.current : []);
    setSnapPoints(pts);
    if (pts.length >= 2 && !drivingSnapUsesMatchedRef.current) {
      drivingSnapGeometryRef.current = pts;
    }
  }, [activeRoute, isNavigating, setSnapPoints]);

  // Persist active navigation so it can be restored after app restart.
  useEffect(() => {
    if (!isNavigating || !endLocation) {
      AsyncStorage.removeItem(NAV_SESSION_KEY).catch(() => {});
      return;
    }

    const payload: PersistedNavSession = {
      savedAt: Date.now(),
      isOffroadRoute,
      startLocation,
      endLocation,
      navStartLoc,
      routeInfo,
      currentStep,
      offroadPoints: isOffroadRoute ? offroadLoadedPointsRef.current : [],
    };

    AsyncStorage.setItem(NAV_SESSION_KEY, JSON.stringify(payload)).catch(() => {});
  }, [
    isNavigating,
    isOffroadRoute,
    startLocation,
    endLocation,
    navStartLoc,
    routeInfo,
    currentStep,
  ]);

  // Restore pending navigation session after cold start / process kill.
  useEffect(() => {
    if (didRestoreNavSessionRef.current || !locationReady) return;
    didRestoreNavSessionRef.current = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(NAV_SESSION_KEY);
        if (!raw) return;

        const data: PersistedNavSession = JSON.parse(raw);
        if (!data?.endLocation) return;
        if (!data.savedAt || Date.now() - data.savedAt > NAV_SESSION_MAX_AGE_MS) {
          await AsyncStorage.removeItem(NAV_SESSION_KEY);
          return;
        }

        setIsOffroadRoute(Boolean(data.isOffroadRoute));
        isOffroadRef.current = Boolean(data.isOffroadRoute);

        if (data.isOffroadRoute && data.offroadPoints?.length > 1) {
          offroadLoadedPointsRef.current = data.offroadPoints;
          routePointsRef.current = data.offroadPoints;
        } else {
          offroadLoadedPointsRef.current = [];
        }

        if (data.startLocation) setStartLocation(data.startLocation);
        setEndLocation(data.endLocation);
        setNavStartLoc(data.navStartLoc ?? data.startLocation ?? userLocation);
        setRouteInfo(data.routeInfo ?? null);
        setCurrentStep(Math.max(0, data.currentStep ?? 0));
        setArrived(false);
        setOffRoute(false);
        announcedPhasesRef.current = new Set();
        lastSpokenRef.current = '';

        isNavigatingRef.current = true;
        setIsNavigating(true);
        setNavigatingFlag(true).catch(() => {});

        Toast.show({
          type: 'success',
          text1: '↩️ PRZYWRÓCONO NAWIGACJĘ',
          text2: data.endLocation.name ?? 'Kontynuuj trasę',
        });
      } catch (e) {
        console.log('restore nav_session error:', e);
      }
    })();
  }, [locationReady, userLocation]);

  useEffect(() => {
    const pts = activeRoute?.points ?? [];
    if (pts.length > 0) routePointsRef.current = pts;
  }, [activeRoute]);

  useEffect(() => {
    if (!isNavigating || navRouteOverride) return;
    if (navRoute?.points?.length) {
      routePointsRef.current = navRoute.points;
      // v10: prefetch geometrii calej trasy do SQLite cache (jednorazowo).
      // W trakcie jazdy L2 (findNearest) trafia od razu w cache zamiast wolac API.
      if (V10_CLIENT_FIRST && navRoute.points.length >= 4) {
        void roadGeometryStore.prefetchAroundRoute(navRoute.points).catch(() => {});
      }
    }
  }, [isNavigating, navRoute, navRouteOverride]);

  useEffect(() => {
    const points = activeRoute?.points;
    if (!points?.length) { setRemainingRoutePoints([]); return; }
    if (!isNavigating || !userLocation) {
      setRemainingRoutePoints(points); return;
    }
    const snapped = snapToRoute(userLocation.latitude, userLocation.longitude, points, NAV_ROUTE_SNAP_M);
    const idx     = findClosestPointIndex(snapped.latitude, snapped.longitude, points);
    setRemainingRoutePoints([
      { latitude: snapped.latitude, longitude: snapped.longitude },
      ...points.slice(idx + 1),
    ]);
  }, [isNavigating, activeRoute]);

  // ── Live location sharing ────────────────────────────────────────────────────
  // Single interval-based mechanism (replaces the previous dual send: event + interval).
  // Sends at most once per SEND_INTERVAL_MS, and only when:
  //   - user moved > SEND_MIN_DIST_M since last send (saves bandwidth while stationary), OR
  //   - SEND_MAX_ELAPSED_MS has elapsed (heartbeat to confirm user is still online).
  // routePointsRef.current is used instead of activeRoute to avoid recreating the
  // interval on every route/location change (was a major source of the duplicate sends).
  useEffect(() => {
    if (!isSharing) {
      // Clear throttle state so the first send after re-enabling goes through immediately.
      lastSendTimeRef.current = 0;
      lastSendLocRef.current  = null;
      return;
    }
    const interval = setInterval(() => {
      const loc = currentLocRef.current;
      if (!loc) return;

      const now     = Date.now();
      const elapsed = now - lastSendTimeRef.current;
      const movedM  = lastSendLocRef.current
        ? haversineKm(loc.latitude, loc.longitude,
            lastSendLocRef.current.lat, lastSendLocRef.current.lng) * 1000
        : Infinity; // no previous position → treat as "moved far enough", always send first time

      if (movedM < SEND_MIN_DIST_M && elapsed < SEND_MAX_ELAPSED_MS) {
        if (DEBUG_NETWORK) console.log('[sendLocation] throttled — moved', movedM.toFixed(0), 'm, elapsed', elapsed, 'ms');
        return;
      }

      if (DEBUG_NETWORK) console.log('[sendLocation] → sending: moved', movedM.toFixed(0), 'm, elapsed', elapsed, 'ms');
      lastSendTimeRef.current = now;
      lastSendLocRef.current  = { lat: loc.latitude, lng: loc.longitude };
      sendLocation(loc.latitude, loc.longitude, routePointsRef.current);
    }, SEND_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      lastSendTimeRef.current = 0;
      lastSendLocRef.current  = null;
    };
  }, [isSharing, sendLocation]);

  useEffect(() => {
    if (!isNavigating) { dismissNavigationNotification(); return; }
    const stepData = effectiveNavRoute?.steps?.[currentStep];
    if (!stepData) return;
    showNavigationNotification(stepData, routeInfo?.distance ?? '', routeInfo?.durationText ?? '');
  }, [currentStep, isNavigating, effectiveNavRoute]);

  const nearbyUsers = useMemo(() => {
    if (!isMapFocused) return [];
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
  }, [liveUserIds, liveMapStore, currentUserId, isMapFocused]);

  // Bez live — zero cudzych markerów (demo wyłączone).
  useDemoUsers(
    false,
    useCallback((users) => setDemoUsers(users), []),
    userLocation?.latitude,
    userLocation?.longitude,
    1000,
  );

  // ─────────────────────────────────────────────────────────
  const visibleLiveUserIds = useMemo(() => {
    if (!isMapFocused || liveUserIds.length === 0) return [];
    const anchor =
      userLocation
      ?? (
        Number.isFinite(drLatRef.current) && Number.isFinite(drLngRef.current)
        && (drLatRef.current !== 0 || drLngRef.current !== 0)
          ? { latitude: drLatRef.current, longitude: drLngRef.current }
          : null
      );
    const candidates = liveUserIds.filter((id) => String(id) !== String(currentUserId));
    if (!anchor) return candidates.slice(0, 48);
    return candidates
      .filter((id) => {
        const meta = liveMapStore.getMeta(id);
        const pos = liveMapStore.getPosition(id);
        if (!meta || !pos) return false;
        if (meta.isFriend) return true;
        return calculateDistance(
          anchor.latitude,
          anchor.longitude,
          pos.lat,
          pos.lng,
        ) <= MAX_NEARBY_USERS_DISTANCE;
      })
      .sort((a, b) => a - b)
      .slice(0, 48);
  }, [userLocation, liveUserIds, liveMapStore, currentUserId, isMapFocused]);

  const visibleUsers = useMemo(() => {
    return visibleLiveUserIds
      .map((id) => nearbyUsers.find((u) => u.id === String(id)))
      .filter((u): u is User => u != null);
  }, [visibleLiveUserIds, nearbyUsers]);

  const getUserMarkerSignature = useCallback((u: User): string => (
    `${u.avatar ?? ''}|${u.avatarFrameUrl ?? ''}|${u.name}|${u.isFriend ? '1' : '0'}|${u.isPremium ? '1' : '0'}`
  ), []);

  useEffect(() => {
    const activeIds = new Set(visibleUsers.map((u) => u.id));
    setMarkerImages((prev) => {
      let changed = false;
      const next: Record<string, string> = { ...prev };
      Object.keys(next).forEach((id) => {
        if (!activeIds.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setMarkerImageSignatures((prev) => {
      let changed = false;
      const next: Record<string, string> = { ...prev };
      Object.keys(next).forEach((id) => {
        if (!activeIds.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [visibleUsers]);

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  const speak = useCallback((text: string) => {
    if (!isSpeechRef.current) return;
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    if (!normalizedText) return;
    if (normalizedText === lastSpokenRef.current && Date.now() - lastSpeechAtRef.current < 12_000) return;

    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    const elapsed = Date.now() - lastSpeechAtRef.current;
    const delay = elapsed < 900 ? 900 - elapsed : 80;

    speechTimeoutRef.current = setTimeout(() => {
      if (!isSpeechRef.current) return;
      lastSpokenRef.current = normalizedText;
      lastSpeechAtRef.current = Date.now();
      Speech.speak(normalizedText, { language: 'pl-PL', pitch: 1.0, rate: 0.9 });
    }, delay);
  }, []);

  useEffect(() => {
    return () => {
      if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
    };
  }, []);


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
    if (!userLocation) return;
    const dist = calculateDistance(
      userLocation.latitude, userLocation.longitude,
      user.latitude, user.longitude,
    );
    setSelectedUser({ ...user, distance: dist });
    setUserInfoVisible(true);
  }, [userLocation]);

  const handleNavigateToUser = useCallback(() => {
    if (!selectedUser || !userLocation) return;
    setStartLocation({ ...userLocation, name: 'Moja pozycja' });
    setEndLocation({ latitude: selectedUser.latitude, longitude: selectedUser.longitude, name: selectedUser.name });
    setUserInfoVisible(false);
    Toast.show({ type: 'success', text1: 'CEL USTAWIONY', text2: selectedUser.name });
  }, [selectedUser, userLocation]);

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
    if (!isSharing && !settings.backgroundTracking) {
      Toast.show({
        type: 'info',
        text1: 'Live Map',
        text2: 'Działa przy otwartej aplikacji. Włącz „Pracę w tle” w ustawieniach, aby udostępniać lokalizację po zminimalizowaniu.',
      });
    }
    const next = await toggleSharing();
    setIsSharing(next);
    AsyncStorage.setItem(LIVE_SHARING_USER_PREF_KEY, next ? 'true' : 'false').catch(() => {});
    AsyncStorage.setItem(
      BG_IS_SHARING_KEY,
      next && settings.backgroundTracking ? 'true' : 'false',
    ).catch(() => {});
    if (next) {
      void resumeLiveSession();
    }
  }, [toggleSharing, isSharing, settings.backgroundTracking, resumeLiveSession]);

  const handleReport = useCallback(async (type: any) => {
    if (!userLocation) { Toast.show({ type: 'error', text1: 'Brak lokalizacji GPS' }); return; }
    setIsSubmittingWarning(true);
    try {
      const routePoints = activeRoute?.points ?? [];
      await addWarning(type, userLocation.latitude, userLocation.longitude, undefined, routePoints);
      Toast.show({ type: 'success', text1: '✅ ZGŁOSZONO', text2: getWarningLabel(type) });
    } finally {
      setIsSubmittingWarning(false);
    }
  }, [userLocation, addWarning, activeRoute]);

  const handleCenterOnUser = useCallback(() => {
    const cached = peekMapLastLocation();
    const liveCenter = ((isNavigating || isDriving) && drLatRef.current !== 0 && drLngRef.current !== 0)
      ? { latitude: drLatRef.current, longitude: drLngRef.current }
      : userLocation
        ?? (lastGoodLocRef.current
          ? { latitude: lastGoodLocRef.current.lat, longitude: lastGoodLocRef.current.lng }
          : (cached
            ? { latitude: cached.latitude, longitude: cached.longitude }
            : null));
    if (!liveCenter) {
      refreshLocationOneShot({ force: true });
      return;
    }
    if (isNavigating || isDriving) {
      setFollowMode(isNavigating ? 'navigationFollow' : 'drivingFollow');
      recenterTo({
        center: liveCenter,
        heading: lastHeadingRef.current,
        speedKmh: speedKmhRef.current,
        active: true,
        isNavigating,
      });
      return;
    }
    resetBrowseCamera(liveCenter);
  }, [userLocation, isNavigating, isDriving, recenterTo, resetBrowseCamera, refreshLocationOneShot, setFollowMode]);

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
    stopDR();
    setIsNavigating(false);
    setOffRoute(false);
    offRouteSinceRef.current = 0;
    offRouteStreakRef.current = 0;
    setArrived(false);
    setNavStartLoc(null);
    setNavRouteOverride(null);
    setRerouteOrigin(null);
    setDistToTurnM(null);
    setRemainingDistKm(null);
    notifThrottleRef.current = 0;
    dismissNavigationNotification();
    Speech.stop().catch(() => {});
    clearTimeout(rerouteTimerRef.current);
    onNavigationCancel();

    const approachStats = finishTrip();
    flushNavigationStatsOnce(approachStats);
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
    autoStartRouteAfterApproachRef.current = true;

    Toast.show({
      type: 'success',
      text1: '🏁 START TRASY',
      text2: 'Rozpoczynam pomiar czasu trasy',
    });
    speak('Dotarłeś do startu. Rozpoczynam pomiar czasu trasy.');

    transitioningToRouteRunRef.current = false;
  }, [
    dismissNavigationNotification,
    flushNavigationStatsOnce,
    onNavigationCancel,
    resetDRRefs,
    resetTimer,
    speak,
    stopDR,
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

    driveTraceSession('nav_end', { reason: 'arrived' });
    isNavigatingRef.current = false;
    setNavigatingFlag(false).catch(() => {});
    stopDR();
    const finalStats = finishTrip();
    tripPeakSpeedRef.current = Math.max(tripPeakSpeedRef.current, finalStats.maxSpeedKmh || 0);
    profileTotalDistanceKmRef.current += Math.max(
      0,
      Number(finalStats.distanceKm || 0) - tripCheckpointSavedKmRef.current,
    );
    setIsNavigating(false);
    setArrived(true);
    setDistToTurnM(null);
    setRemainingDistKm(null);
    notifThrottleRef.current = 0;
    dismissNavigationNotification();
    Speech.stop().catch(() => {});
    speak('Dotarłeś do celu!');
    Toast.show({ type: 'success', text1: '🏁 DOTARŁEŚ DO CELU!', text2: endLocation?.name ?? '' });

    if (userLocation) resetBrowseCamera(userLocation);

    InteractionManager.runAfterInteractions(() => {
      void checkLiveAchievements('trip_end', finalStats.maxSpeedKmh);
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
    endLocation, userLocation, routeInfo, speak, resetBrowseCamera,
    onNavigationComplete, timerRunning, stopTimer, formatElapsed,
    leaderboardRouteId, saveRun, fetchLeaderboard, fetchRuns,
    flushNavigationStatsOnce,
    checkLiveAchievements,
    transitionFromApproachToRouteRun,
  ]);

  useEffect(() => {
    if (!isNavigating || !effectiveNavRoute?.steps?.length) {
      navRouteIdxRef.current = -1;
      return;
    }

    const steps  = effectiveNavRoute.steps;
    const points = effectiveNavRoute.points?.length
      ? effectiveNavRoute.points
      : routePointsRef.current;

    const runNavProgress = () => {
      const drFresh =
        drLatRef.current !== 0
        && drLngRef.current !== 0
        && Date.now() - drLastFrameAtRef.current <= DR_STALE_MS;
      const fallbackLoc = currentLocRef.current;
      const currentLat = drFresh ? drLatRef.current : fallbackLoc?.latitude;
      const currentLng = drFresh ? drLngRef.current : fallbackLoc?.longitude;
      if (!currentLat || !currentLng) return;

      const snapped = points.length
        ? snapToRoute(currentLat, currentLng, points, NAV_ROUTE_SNAP_M)
        : { latitude: currentLat, longitude: currentLng };
      const { latitude: lat, longitude: lng } = snapped;

      if (endLocation) {
        const distToEnd = haversineKm(lat, lng, endLocation.latitude, endLocation.longitude) * 1000;
        if (distToEnd < 30 && !arrivedRef.current) { handleArrived(); return; }
      }

      const prevStep = currentStepRef.current;
      const nextStep = detectCurrentStep(lat, lng, steps, prevStep);
      if (nextStep !== prevStep) {
        currentStepRef.current = nextStep;
        setCurrentStep(nextStep);
        announcedPhasesRef.current = new Set();
      }

      const announceTarget = resolveAnnouncementTarget(steps, nextStep, lat, lng);
      const distToManeuver = announceTarget.distanceM;
      if (nextStep !== prevStep) {
        visionEvent('NAV_STEP_CHANGE', {
          prevStep,
          nextStep,
          distToManeuverM: Math.round(distToManeuver),
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
        });
      }
      const speechPhase = getNavigationSpeechPhase(distToManeuver);

      if (speechPhase && isSpeechRef.current) {
        const phaseKey = `${announceTarget.stepIndex}:${speechPhase}`;
        if (!announcedPhasesRef.current.has(phaseKey)) {
          announcedPhasesRef.current.add(phaseKey);
          speak(buildNavigationSpeech(announceTarget.step, distToManeuver, speechPhase));
        }
      }

      if (steps[nextStep]) {
        const roundedTurn = Math.round(distToManeuver / 20) * 20;
        if (lastDistToTurnUiRef.current == null || Math.abs(roundedTurn - lastDistToTurnUiRef.current) >= 20) {
          lastDistToTurnUiRef.current = roundedTurn;
          setDistToTurnM(distToManeuver);
        }
      }

      if (points.length) {
        const inRerouteGrace = Date.now() < rerouteGraceUntilRef.current;
        const thresholdM = inRerouteGrace
          ? Math.max(REROUTE_THRESHOLD_M, REROUTE_THRESHOLD_RECOVERY_M)
          : REROUTE_THRESHOLD_M;
        const onRoad = isOnRoute(currentLat, currentLng, points, thresholdM);
        const nowOff = Date.now();
        if (onRoad) {
          offRouteSinceRef.current = 0;
          offRouteStreakRef.current = 0;
          if (offRouteRef.current) {
            offRouteRef.current = false;
            setOffRoute(false);
          }
        } else if (!reroutePendingRef.current && !inRerouteGrace) {
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
              setOffRoute(true);
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

      if (points.length > 1 && !offRouteRef.current) {
        const idx = findClosestPointIndex(lat, lng, points);
        const prevIdx = navRouteIdxRef.current;
        const idxDelta = prevIdx >= 0 ? Math.abs(idx - prevIdx) : 0;
        if (idx !== prevIdx && (prevIdx < 0 || idxDelta <= 8)) {
          navRouteIdxRef.current = idx;
          setRemainingRoutePoints([
            { latitude: lat, longitude: lng },
            ...points.slice(idx + 1),
          ]);
        }

        let remKm = 0;
        const remStart = idx;
        for (let i = remStart; i < points.length - 1; i++) {
          remKm += haversineKm(
            i === remStart ? lat : points[i].latitude,
            i === remStart ? lng : points[i].longitude,
            points[i + 1].latitude,
            points[i + 1].longitude,
          );
        }
        const roundedRem = parseFloat(remKm.toFixed(2));
        if (lastRemainingKmUiRef.current == null || Math.abs(roundedRem - lastRemainingKmUiRef.current) >= 0.08) {
          lastRemainingKmUiRef.current = roundedRem;
          setRemainingDistKm(remKm);
        }

        const nowMs = Date.now();
        if (nowMs - notifThrottleRef.current > 30_000) {
          notifThrottleRef.current = nowMs;
          const stepForNotif = steps[nextStep];
          if (stepForNotif) {
            const distStr = remKm < 1
              ? `${Math.round(remKm * 1000)} m`
              : `${remKm.toFixed(1)} km`;
            const ri = routeInfoRef.current;
            showNavigationNotification(
              stepForNotif,
              distStr,
              ri ? formatDuration(ri.duration) : '',
            );
          }
        }
      }
    };

    runNavProgress();
    const id = setInterval(runNavProgress, NAV_PROGRESS_UI_MS);
    return () => clearInterval(id);
  }, [isNavigating, effectiveNavRoute, endLocation, handleArrived, showNavigationNotification, speak]);

  // ── beginNavigation ───────────────────────────────────────
  const beginNavigation = useCallback(() => {
    if (!userLocation) return;

    // Nie wołaj pełnego exitDrivingMode (finishTrip + reset silnika) — to kasowało trip
    // i mogło crashować przy przejściu jazda → nawigacja.
    isDrivingRef.current = false;
    drivingEntryAnchorRef.current = null;
    drivingEntryGraceUntilRef.current = 0;
    drivingManualModeRef.current = false;
    lastTripMarkerPoseRef.current = null;
    setIsDriving(false);

    startTrip(routeInfo?.duration ?? 0);
    passiveTripStartedRef.current = true;
    navStatsFlushedRef.current = false;

    resetDRRefs();
    setFollowMode('navigationFollow');
    isNavigatingRef.current = true;
    tripSpeedWarmupUntilRef.current = Date.now() + 10_000;
    lastAppliedRerouteSigRef.current = '';

    lastNavLocRef.current = null;
    resetSpeedStats();
    setNavigatingFlag(true).catch(() => {});
    resetDR();
    navLatFilter.reset();
    navLngFilter.reset();
    startIsMyLocationRef.current = false;
    lastSpokenRef.current        = '';
    announcedPhasesRef.current   = new Set();

    const navStart = { ...userLocation, name: 'Moja pozycja' };
    const seededRoute = previewRouteRef.current ?? navRouteRef.current;
    if (seededRoute?.points?.length) {
      setNavRouteOverride(seededRoute);
      routePointsRef.current = seededRoute.points;
    } else {
      setNavRouteOverride(null);
    }

    // ── Offroad: ustaw punkty z załadowanej trasy ─────────
    if (isOffroadRef.current) {
      const pts = offroadLoadedPointsRef.current.length > 1
        ? offroadLoadedPointsRef.current
        : (seededRoute?.points ?? activeRoute?.points ?? []);
      offroadPointsRef.current = pts;
      routePointsRef.current   = pts;
    }

    let bootLat = navStart.latitude;
    let bootLng = navStart.longitude;
    const bootHdg = lastHeadingRef.current || 0;
    if (routePointsRef.current.length > 1) {
      const bootSnapped = snapToRoute(bootLat, bootLng, routePointsRef.current, NAV_ROUTE_SNAP_M);
      bootLat = bootSnapped.latitude;
      bootLng = bootSnapped.longitude;
    }
    lastSetLocRef.current = { lat: bootLat, lng: bootLng };
    lastGoodLocRef.current = { lat: bootLat, lng: bootLng };

    setIsNavigating(true);
    if (DRIVE_CORE_V2) {
      driveCore.engine.setNavigating(true);
      const navSeed =
        routePointsRef.current.length >= 2 ? routePointsRef.current : undefined;
      driveCore.reset(
        { lat: bootLat, lng: bootLng },
        { heading: bootHdg, seedPolyline: navSeed },
      );
      resetTravelHeadingState(bootLat, bootLng, bootHdg);
      getTripHeadingFilter().reset(bootHdg);
      driveMarker.reset({ lat: bootLat, lng: bootLng, heading: bootHdg });
      resetMarkerFeedState();
      resetRoadMarkerPoseState();
      tripMarkerV2BootstrappedRef.current = true;
      if (routePointsRef.current.length >= 2) {
        driveCore.setRoutePolyline(routePointsRef.current);
      }
      lastTripMarkerPoseRef.current = { lat: bootLat, lng: bootLng };
      pushDriveMarkerV2(driveMarker, bootLat, bootLng, bootHdg, {
        durationMs: TRIP_GPS_FEED_MIN_MS,
        speedMs: 0,
        hudKmh: speedKmhRef.current,
        allowInstant: true,
      });
    }
    if (!gpsForceActiveRef.current) {
      gpsForceActiveRef.current = true;
      applyGpsForceActive(true);
    }
    startGPS();

    if (!DRIVE_CORE_V2) {
      applyTripPosition(bootLat, bootLng, {
        heading: bootHdg,
        speedMs: Math.max(0, speedKmhRef.current) / 3.6,
        forcePublish: true,
        instant: true,
        commitGood: true,
      });
    }

    drLatRef.current = bootLat;
    drLngRef.current = bootLng;
    drHdgRef.current = bootHdg;

    setNavStartLoc(navStart);
    setStartLocation(navStart);
    setCurrentStep(0);
    setArrived(false);
    setOffRoute(false);
    offRouteSinceRef.current = 0;
    offRouteStreakRef.current = 0;

    if (routeInfo?.duration) onNavigationStart(routeInfo.duration);
    if (pendingRouteRef.current && !approachingRouteStartRef.current) {
      startTimer(pendingRouteRef.current.id, pendingRouteRef.current.name);
      pendingRouteRef.current = null;
    }

    recenterTo({
      center: { latitude: bootLat, longitude: bootLng },
      heading: bootHdg,
      speedKmh: Math.max(speedKmhRef.current, 20),
      active: true,
      isNavigating: true,
      entryAnim: true,
    });
    setFollowMode('navigationFollow');
    pushCameraFromSmooth(bootLat, bootLng, bootHdg);

    driveTraceSession('nav_start', {
      routePts: routePointsRef.current.length,
      bootLat: Number(bootLat.toFixed(6)),
      bootLng: Number(bootLng.toFixed(6)),
      bootHdg: Math.round(bootHdg),
      offroad: isOffroadRef.current,
    });

    speak('Nawigacja rozpoczęta. Dobrej drogi!');
  }, [userLocation, routeInfo, speak, onNavigationStart, startTimer, setFollowMode,
      recenterTo, resetDR, resetDRRefs, activeRoute, startGPS, applyTripPosition, driveCore, driveMarker, pushCameraFromSmooth]);

  // ── startNavigation ───────────────────────────────────────
  const startNavigation = useCallback(() => {
    if (!endLocation) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wybierz cel podróży' }); return;
    }
    if (!userLocation) {
      Toast.show({ type: 'error', text1: 'BŁĄD GPS', text2: 'Czekam na lokalizację...' }); return;
    }
    if (!startLocation) {
      setStartLocation({ ...userLocation, name: 'Moja pozycja' });
      startIsMyLocationRef.current = true;
      setTimeout(() => beginNavigation(), 100);
      return;
    }
    const distToStart = haversineKm(
      userLocation.latitude, userLocation.longitude,
      startLocation.latitude, startLocation.longitude,
    ) * 1000;
    if (distToStart > 100) {
      Alert.alert(
        'Daleko od startu',
        `Jesteś ${Math.round(distToStart)}m od punktu startowego.`,
        [
          { text: 'Anuluj', style: 'cancel' },
          { text: 'Nawiguj do startu', onPress: () => {
            approachingRouteStartRef.current = true;
            setEndLocation(startLocation);
            setStartLocation({ ...userLocation, name: 'Moja pozycja' });
          }},
          { text: 'Startuj z mojej pozycji', onPress: () => {
            approachingRouteStartRef.current = false;
            setStartLocation({ ...userLocation, name: 'Moja pozycja' });
            startIsMyLocationRef.current = true;
            beginNavigation();
          }},
        ],
      );
      return;
    }
    beginNavigation();
  }, [startLocation, endLocation, userLocation, beginNavigation]);

  // ── stopNavigation ────────────────────────────────────────
  const stopNavigation = useCallback(async () => {
    driveTraceSession('nav_end', { reason: 'user_stop' });
    isNavigatingRef.current = false;
    setNavigatingFlag(false).catch(() => {});
    resetDRRefs();

    stopSimulation();
    setIsSimulating(false);

    stopDR();
    setFollowMode('idleBrowse');
    setIsNavigating(false);
    setOffRoute(false);
    offRouteSinceRef.current = 0;
    offRouteStreakRef.current = 0;
    setArrived(false);
    setNavStartLoc(null);
    setNavRouteOverride(null);
    setRerouteOrigin(null);
    setDistToTurnM(null);
    setRemainingDistKm(null);
    notifThrottleRef.current = 0;
    dismissNavigationNotification();
    setRouteEndpointImages({});
    Speech.stop().catch(() => {});
    clearTimeout(rerouteTimerRef.current);
    onNavigationCancel();
    const finalStats = finishTrip();
    profileTotalDistanceKmRef.current += Math.max(
      0,
      Number(finalStats.distanceKm || 0) - tripCheckpointSavedKmRef.current,
    );
    void checkLiveAchievements('trip_end');
    passiveTripStartedRef.current = false;
    flushNavigationStatsOnce(finalStats);

    const wasApproaching = approachingRouteStartRef.current;
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

    Toast.show({
      type: 'info',
      text1: wasApproaching ? 'DOJAZD ANULOWANY' : 'NAWIGACJA ZATRZYMANA',
      text2: hadRouteTimer && !wasApproaching ? `Czas: ${formatElapsed(elapsedForToast)}` : undefined,
    });

    if (userLocation && !wasApproaching) {
      startIsMyLocationRef.current = true;
      setStartLocation({ ...userLocation, name: 'Moja pozycja' });
    }
  }, [
    userLocation, setFollowMode, onNavigationCancel, flushNavigationStatsOnce,
    timerRunning, stopTimer, resetTimer, formatElapsed,
    resetDRRefs, checkLiveAchievements,
  ]);

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

  const effectiveVisibleUsers = visibleUsers;
  const effectiveWarnings = clusteredWarnings;
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
    if (currentZoom < 12.8) return [];
    const zoomCap =
      currentZoom >= 16 ? 24
      : currentZoom >= 15.5 ? 16
      : currentZoom >= 15 ? 10
      : 6;
    if (!Array.isArray(partnerPois) || partnerPois.length <= zoomCap) return partnerPois;
    if (userLocation) {
      const sorted = [...partnerPois].sort((a, b) => {
        const da = haversineKm(userLocation.latitude, userLocation.longitude, a.lat, a.lng);
        const db = haversineKm(userLocation.latitude, userLocation.longitude, b.lat, b.lng);
        return da - db;
      });
      return sorted.slice(0, zoomCap);
    }
    return partnerPois.slice(0, zoomCap);
  }, [currentZoom, partnerPois, userLocation]);

  useAutoNavigationBridge({
    isNavigating,
    isDriving,
    isBuilding,
    arrived,
    offRoute,
    currentStep,
    navStep: effectiveNavRoute?.steps?.[currentStep] ?? null,
    routeInfo: routeInfo as (RouteInfo & { durationText?: string | null }) | null,
    remainingDistKm,
    distToTurnM,
    mapStyle,
    locationMarkerStyle: settings.locationMarkerStyle,
    hideLocation: settings.hideLocation,
    startLocation,
    endLocation,
    userLocation,
    speed,
    heading,
    speedLimitKmh: effectiveSpeedLimit,
    remainingRoutePoints,
    navRoutePoints: effectiveNavRoute?.points,
    previewRoutePoints: previewRoute?.points,
    builderPins: pins,
    builderRoutePoints: snappedRoute,
    visibleUsers: effectiveVisibleUsers,
    warnings: effectiveWarnings,
    speedCameras: snappedCameras,
    fuelStations: effectiveFuelStations,
    onStopRequested: () => { stopNavigation(); },
    onReportRequested: () => { setReportVisible(true); },
    onReportTypeRequested: (type) => { void handleReport(type); },
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

  const currentStepData  = activeSteps[currentStep];
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
   * Karmienie worklet teraz z applyTripPosition (V10_CLIENT_FIRST path),
   * NIE z DR.onFrame (ktore w v10 jest no-op). Dlatego bez "pulsacji" jakie
   * widzielismy w v8/v9 — czysta interpolacja A→B raz na fix.
   */
  const useTripSmoothMarker = isTripActive;
  const markerLat = isTripActive
    ? (() => {
      if (Number.isFinite(drLatRef.current) && drLatRef.current !== 0) return drLatRef.current;
      const snap = lastSetLocRef.current;
      return snap ? snap.lat : NaN;
    })()
    : (userLocation?.latitude ?? NaN);
  const markerLng = isTripActive
    ? (() => {
      if (Number.isFinite(drLngRef.current) && drLngRef.current !== 0) return drLngRef.current;
      const snap = lastSetLocRef.current;
      return snap ? snap.lng : NaN;
    })()
    : (userLocation?.longitude ?? NaN);
  const markerHdg = lastHeadingRef.current !== 0 ? lastHeadingRef.current : heading;

  // ── Czy pokazać prędkościomierz (lewy) — w trybie jazdy prędkość + limit są w górnym HUD ──
  const isRoutePreviewOpen = !isNavigating && !isBuilding && !!endLocation;
  const showSpeedPanel =
    !isRoutePreviewOpen
    && (isNavigating || (!isDriving && (speedKmh > 5 || speedLimit !== null)));

  const goalLat = useTripSmoothMarker ? drLatRef.current : markerLat;
  const goalLng = useTripSmoothMarker ? drLngRef.current : markerLng;
  const drivingGoalDistKm =
    isDriving && !isNavigating && endLocation
    && Number.isFinite(goalLat) && Number.isFinite(goalLng)
      ? haversineKm(goalLat, goalLng, endLocation.latitude, endLocation.longitude)
      : null;

  // ─────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────

  return (
    <>
      <StatusBar translucent backgroundColor="transparent" barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* Baner nad mapą (layout kolumnowy — nie zasłania wyszukiwania) */}
        <View style={{ paddingTop: insets.top, backgroundColor: theme.bg }}>
          <AdSlot placement="map_banner" variant="banner" />
        </View>

        <View style={{ flex: 1, minHeight: 0, position: 'relative' }}>

        {gpsAcquiring && !userLocation && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 6,
              alignSelf: 'center',
              zIndex: 40,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: theme.mapOverlay,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.primaryBorder,
            }}
          >
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.mapOverlayText, letterSpacing: 0.5 }}>
              SZUKAM GPS…
            </Text>
          </View>
        )}

        {/* ── Timer trasy ─────────────────────────────────── */}
        {isNavigating && timerRunning && (
          <View style={{
            position: 'absolute',
            bottom: Platform.OS === 'ios' ? 110 : 90,
            alignSelf: 'center',
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: theme.mapOverlay,
            borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10,
            borderWidth: 1, borderColor: theme.primaryBorder,
            shadowColor: theme.primary, shadowOpacity: 0.3,
            shadowOffset: { width: 0, height: 0 }, shadowRadius: 10,
            elevation: 8, zIndex: 25,
          }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
            <View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, letterSpacing: 2 }}>
                {timerRouteName.toUpperCase()}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: theme.mapOverlayText, fontWeight: '700', letterSpacing: 2 }}>
                {formatElapsed(elapsedSec)}
              </Text>
            </View>
            <MaterialCommunityIcons name="timer-outline" size={20} color="#e33835" />
          </View>
        )}


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
        {visibleUsers.length > 0 && visibleUsers.map(user =>
          (() => {
            const signature = getUserMarkerSignature(user);
            return !markerImages[user.id] || markerImageSignatures[user.id] !== signature;
          })() ? (
            <MarkerRenderer
              key={`renderer_${user.id}_${getUserMarkerSignature(user)}`}
              user={user}
              distance={calculateDistance(
                (userLocation?.latitude ?? drLatRef.current),
                (userLocation?.longitude ?? drLngRef.current),
                user.latitude, user.longitude,
              )}
              onCapture={uri => {
                const signature = getUserMarkerSignature(user);
                setMarkerImages(prev => ({ ...prev, [user.id]: uri }));
                setMarkerImageSignatures(prev => ({ ...prev, [user.id]: signature }));
              }}
            />
          ) : null,
        )}

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

        {showCameras && snappedCameras.map(c => (
          <SpeedCameraRenderer
            key={`camrender_${String(c.id)}_${c.type}_${Math.floor(c.distanceM / 500)}`}
            camera={c}
            userSpeed={speedKmh}
            onCapture={uri => setCameraImages(prev => ({ ...prev, [String(c.id)]: uri }))}
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
        <View style={{ flex: 1 }} collapsable={false}>
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
            if (!manualTargetPickMode || isBuilding) return;
            handleManualTargetPick(latitude, longitude);
          }}
          onMapIdle={(e: any) => {
            const z = e?.properties?.zoomLevel ?? e?.properties?.zoom;
            const zoom = Number.isFinite(z) ? Number(z) : 15;
            setCurrentZoom(zoom);
          }}
          onCameraChanged={(e: any) => {
            const z = e?.properties?.zoomLevel ?? e?.properties?.zoom;
            const zoomLive = Number.isFinite(z) ? Number(z) : null;
            if (zoomLive != null) {
              setCurrentZoom(zoomLive);
            }
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
            const isUserInteraction = e?.properties?.isUserInteraction === true;
            const tripActive = isDrivingRef.current || isNavigatingRef.current;
            const pitchRaw = e?.properties?.pitch;
            const pitchLive = Number.isFinite(pitchRaw) ? Number(pitchRaw) : undefined;
            if (tripActive) {
              const progMs = getLastProgrammaticCameraApplyMsRef.current();
              const withinProgrammaticGuard =
                Date.now() - progMs < PROGRAMMATIC_CAMERA_GESTURE_GUARD_MS;
              // 60fps follow: Mapbox często oznacza setCamera jako isUserInteraction — ufaj tylko gestureActive.
              const realUserGesture =
                gestureActive
                && !withinProgrammaticGuard;
              if (realUserGesture) {
                notifyUserMapInteraction(
                  zoomLive ?? undefined,
                  pitchLive,
                );
              }
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
          <Mapbox.UserLocation visible={false} />
          <MapTerrainLayers
            enabled={showTerrainLayers}
            showBuildings={showThreeDBuildings}
            isDark={isDark}
            minZoom={BUILDINGS_3D_MIN_ZOOM}
          />
          <MapVividLayers enabled={showVividMapLayers} isDark={isDark} />

          {endLocation && !arrived && (
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

          {startLocation && !isNavigating && !isBuilding && (
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

          {showCameras && snappedCameras.map(c => (
            <SpeedCameraMarker
              key={`cam_${String(c.id)}`}
              camera={c}
              imageUri={cameraImages[String(c.id)] ?? null}
              onPress={() => { setSelectedCamera(c); setCameraDetailVisible(true); }}
            />
          ))}

          {effectiveFuelStations.map(station => (
            <FuelStationMarker
              key={`fuel_${station.id}`}
              station={station}
              compact={currentZoom < 15.2}
              onPress={() => { setSelectedFuelStation(station); setFuelStationModalVisible(true); }}
            />
          ))}

          {effectivePartnerPois.map(poi => (
            <PartnerPoiMarker
              key={`partner_${poi.id}`}
              poi={poi}
              compact={currentZoom < 15.2}
              onPress={() => {
                setSelectedPartnerPoi(poi);
                setPartnerPoiModalVisible(true);
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

          {visibleLiveUserIds.map((userId) => {
            const user = nearbyUsers.find((u) => u.id === String(userId));
            if (!user) return null;
            const dist = calculateDistance(
              (userLocation?.latitude ?? drLatRef.current),
              (userLocation?.longitude ?? drLngRef.current),
              user.latitude,
              user.longitude,
            );
            return (
              <LiveUserMarker
                key={`user_${userId}`}
                userId={userId}
                store={liveMapStore}
                distanceKm={dist}
                imageUri={markerImages[user.id] ?? null}
                onPress={() => handleUserMarkerPress(user)}
              />
            );
          })}

          {remainingRoutePoints.length > 1 && !arrived ? (
            <MapActiveRouteLayers
              remainingRoutePoints={remainingRoutePoints}
              isNavigating={isNavigating}
              isDriving={isDriving}
            />
          ) : null}

          {startLocation && !isNavigating && routeEndpointImages.start && (
            <Mapbox.MarkerView coordinate={[startLocation.longitude, startLocation.latitude]} anchor={{ x: 0.5, y: 1 }}>
              <View style={{ width: 48, height: 48 }}>
                <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: '#4de92620', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#4de926' }}>
                  <MaterialIcons name="radio-button-on" size={20} color="#4de926" />
                </View>
              </View>
            </Mapbox.MarkerView>
          )}
          {endLocation && !arrived && routeEndpointImages.end && (
            <Mapbox.MarkerView coordinate={[endLocation.longitude, endLocation.latitude]} anchor={{ x: 0.5, y: 1 }}>
              <View style={{ width: 48, height: 48 }}>
                <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: '#e3383520', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#e33835' }}>
                  <MaterialIcons name="flag" size={20} color="#e33835" />
                </View>
              </View>
            </Mapbox.MarkerView>
          )}

          {effectiveWarnings
            .filter(w => !isNaN(Number(w.lat)) && !isNaN(Number(w.lng)))
            .map(w => {
              const color = getWarningColor(w.type);
              const icon  = getWarningIcon(w.type);
              return (
                <Mapbox.MarkerView
                  key={`warning_${w.id}`}
                  coordinate={[Number(w.lng), Number(w.lat)]}
                  anchor={{ x: 0.5, y: 0.5 }}
                  allowOverlapWithPuck
                >
                  <TouchableOpacity onPress={() => setSelectedWarning(w)} activeOpacity={0.8}>
                    <View style={{ alignItems: 'center' }}>
                      {w.confirmCount > 0 && (
                        <View style={{
                          backgroundColor: color, borderRadius: 10,
                          paddingHorizontal: 6, paddingVertical: 2, marginBottom: 3,
                          minWidth: 28, alignItems: 'center',
                        }}>
                          <Text style={{ color: '#000', fontSize: 8, fontWeight: '700' }}>
                            +{w.confirmCount}
                          </Text>
                        </View>
                      )}
                      <View style={{
                        width: 44, height: 44, borderRadius: 22,
                        backgroundColor: `${color}22`, borderWidth: 2.5, borderColor: color,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <MaterialCommunityIcons name={icon as any} size={22} color={color} />
                      </View>
                    </View>
                  </TouchableOpacity>
                </Mapbox.MarkerView>
              );
            })
          }

          {DRIVE_CORE_V2 && isTripActive ? (
            <DriveMarkerLayer
              enabled={isTripActive}
              marker={driveMarker}
              avatarUrl={settings.locationMarkerStyle === 'arrow' ? null : myAvatarUrl}
              imageUri={settings.locationMarkerStyle === 'arrow' ? arrowMarkerImage : carMarkerImage}
              cursorSkin={cursorSkinOverlay}
            />
          ) : useTripSmoothMarker ? (
            <SmoothDrPositionMarker
              enabled={isTripActive}
              sharedPosition={tripSmoothPosition}
              workletOnly={V10_CLIENT_FIRST}
              latitude={markerLat}
              longitude={markerLng}
              heading={markerHdg}
              avatarUrl={settings.locationMarkerStyle === 'arrow' ? null : myAvatarUrl}
              imageUri={settings.locationMarkerStyle === 'arrow' ? arrowMarkerImage : carMarkerImage}
              cursorSkin={cursorSkinOverlay}
            />
          ) : (
            Number.isFinite(markerLat) && Number.isFinite(markerLng) && (
              <DrPositionMarker
                latitude={markerLat}
                longitude={markerLng}
                heading={markerHdg}
                avatarUrl={settings.locationMarkerStyle === 'arrow' ? null : myAvatarUrl}
                imageUri={settings.locationMarkerStyle === 'arrow' ? arrowMarkerImage : carMarkerImage}
                cursorSkin={cursorSkinOverlay}
              />
            )
          )}
        </MapCanvas>
        </View>

        {cameraPickMode && (
          <View
            pointerEvents="box-none"
            style={[StyleSheet.absoluteFillObject, { zIndex: 52 }]}
          >
            <View
              pointerEvents="none"
              style={{
                marginTop:     48,
                alignSelf:     'center',
                backgroundColor: theme.mapOverlay,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius:    12,
                borderWidth:     1,
                borderColor:     theme.border2,
              }}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.mapOverlayText, textAlign: 'center', letterSpacing: 0.5 }}>
                PRZESUŃ MAPĘ · ŚRODEK = MIEJSCE FOTORADARU
              </Text>
            </View>
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}
            >
              <MaterialCommunityIcons name="crosshairs-gps" size={58} color={isDark ? '#ffffffaa' : theme.textDim} style={{ marginTop: -28 }} />
            </View>
            <View style={{
              position:        'absolute',
              left:            12,
              right:           12,
              bottom:          insets.bottom + 88,
              flexDirection:   'row',
              gap:             10,
            }}
            >
              <TouchableOpacity
                onPress={cancelCameraPick}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius:    14,
                  backgroundColor: isDark ? theme.surface3 : theme.surface2,
                  borderWidth:     1,
                  borderColor:     theme.border,
                  alignItems:      'center',
                }}
              >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>ANULUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void confirmCameraPick()}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius:    14,
                  backgroundColor: '#e33835',
                  alignItems:      'center',
                }}
              >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.onPrimary, fontWeight: '700' }}>DODAJ</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {manualTargetPickMode && !cameraPickMode && (
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, { zIndex: 51 }]}>
            <View
              pointerEvents="none"
              style={{
                marginTop: 48,
                alignSelf: 'center',
                backgroundColor: theme.mapOverlay,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.border2,
              }}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.mapOverlayText, textAlign: 'center', letterSpacing: 0.5 }}>
                PRZYTRZYMAJ MAPĘ W MIEJSCU DOCELOWYM
              </Text>
            </View>
            <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 88 }}>
              <TouchableOpacity
                onPress={cancelManualTargetPick}
                style={{
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: isDark ? theme.surface3 : theme.surface2,
                  borderWidth: 1,
                  borderColor: theme.border,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>ANULUJ TRYB PUNKTU</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Panel nawigacji (góra) ───────────────────────── */}
        {isNavigating && (
          isOffroadRef.current ? (
            // ── OFFROAD panel ──────────────────────────────
            <View style={styles.navigationPanelTop}>
              <View style={styles.instructionBox}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{
                    width: 56, height: 56, backgroundColor: theme.surface3, borderRadius: 14,
                    borderWidth: 1.5, borderColor: '#ff922b45',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MaterialCommunityIcons name="terrain" size={32} color="#ff922b" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: '#ff922b', fontWeight: '900', letterSpacing: 2 }}>
                      TRYB OFFROAD
                    </Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textMuted, marginTop: 2 }}>
                      Nawigacja w linii prostej
                    </Text>
                    {routeInfo && (
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ff922b', marginTop: 2 }}>
                        {routeInfo.distance} km
                      </Text>
                    )}
                  </View>
                </View>
              </View>
              <TouchableOpacity style={styles.closeNavBtn} onPress={stopNavigation}>
                <MaterialIcons name="close" size={18} color={theme.textDim} />
              </TouchableOpacity>
            </View>
          ) : (
            currentStepData ? (
              // ── STANDARDOWY panel kroków ───────────────────
              <View style={styles.navigationPanelTop}>
                <View style={styles.instructionBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <View style={{
                      width: 56, height: 56, backgroundColor: theme.surface3, borderRadius: 14,
                      borderWidth: 1.5, borderColor: '#e3383545',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <MaterialIcons name={getManeuverIcon(currentStepData.maneuver) as any} size={32} color={theme.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      {/* Live dystans do następnego skrętu */}
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 26, color: theme.text, fontWeight: '900', letterSpacing: 1 }}>
                        {distToTurnM !== null
                          ? distToTurnM < 1000
                            ? `${Math.round(distToTurnM / 10) * 10} m`
                            : `${(distToTurnM / 1000).toFixed(1)} km`
                          : currentStepData.distance?.text}
                      </Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textMuted, marginTop: 2 }} numberOfLines={1}>
                        {cleanInstruction(currentStepData.html_instructions)}
                      </Text>
                    </View>
                  </View>

                  {activeSteps[currentStep + 1] && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 8,
                      backgroundColor: theme.border, borderRadius: 10,
                      paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6,
                    }}>
                      <MaterialIcons name="subdirectory-arrow-right" size={14} color={theme.textDim} />
                      <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>Potem: </Text>
                      <MaterialIcons name={getManeuverIcon(activeSteps[currentStep + 1].maneuver) as any} size={14} color={theme.textMuted} />
                      <Text style={{ color: theme.textMuted, fontFamily: 'Orbitron', fontSize: 9, flex: 1 }} numberOfLines={1}>
                        {cleanInstruction(activeSteps[currentStep + 1].html_instructions)}
                      </Text>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 1 }}>
                      Krok {currentStep + 1}/{activeSteps.length}
                    </Text>
                    {/* Live pozostały dystans do celu */}
                    {remainingDistKm !== null && (
                      <>
                        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.border3 }} />
                        <MaterialIcons name="straighten" size={10} color="#00bfff" />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#00bfff', fontWeight: '700' }}>
                          {remainingDistKm < 1
                            ? `${Math.round(remainingDistKm * 1000)} m`
                            : `${remainingDistKm.toFixed(1)} km`}
                        </Text>
                      </>
                    )}
                    {routeInfo && (
                      <>
                        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.border3 }} />
                        <MaterialIcons name="schedule" size={10} color="#e33835" />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#e33835', fontWeight: '700' }}>
                          {formatDuration(routeInfo.duration)}
                        </Text>
                        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.border3 }} />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>
                          cel: {new Date(Date.now() + (routeInfo.duration ?? 0) * 60 * 1000).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
                <TouchableOpacity style={styles.closeNavBtn} onPress={stopNavigation}>
                  <MaterialIcons name="close" size={18} color={theme.textDim} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.navigationPanelTop}>
                <View style={styles.instructionBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{
                      width: 56, height: 56, backgroundColor: theme.surface3, borderRadius: 14,
                      borderWidth: 1.5, borderColor: '#e3383545',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <ActivityIndicator size="small" color={theme.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: theme.text, fontWeight: '800', letterSpacing: 1 }}>
                        ŁADOWANIE MANEWRÓW...
                      </Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textMuted, marginTop: 3 }}>
                        Trwa pobieranie szczegółów trasy
                      </Text>
                      {routeInfo && (
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#00bfff', marginTop: 4 }}>
                          {routeInfo.distance} km {routeInfo.duration ? `· ${formatDuration(routeInfo.duration)}` : ''}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
                <TouchableOpacity style={styles.closeNavBtn} onPress={stopNavigation}>
                  <MaterialIcons name="close" size={18} color={theme.textDim} />
                </TouchableOpacity>
              </View>
            )
          )
        )}

        {/* ── Off-route banner ─────────────────────────────── */}
        {isNavigating && offRoute && !isOffroadRef.current && (
          <View style={{
            position: 'absolute', top: insets.top + 84,
            left: 12, right: 12,
            backgroundColor: '#ff922b12', borderRadius: 12,
            borderWidth: 1, borderColor: '#ff922b45',
            padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 20,
            opacity: 0.82,
          }}>
            <MaterialIcons name="warning" size={18} color="#ff922b" />
            <Text style={{ color: '#ff922b', fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>
              {(rerouteLoading || rerouteOrigin != null || reroutePendingRef.current) ? 'PRZELICZAM TRASĘ...' : 'POZA TRASĄ — PONAWIAM...'}
            </Text>
            {(rerouteLoading || rerouteOrigin != null || reroutePendingRef.current) && (
              <ActivityIndicator size="small" color="#ff922b" style={{ marginLeft: 'auto' }} />
            )}
          </View>
        )}

        {/* ── Prędkościomierz (nawigacja + driving mode) ───── */}
        {showSpeedPanel && (
          <SpeedometerHUD initialKmh={0}>
            {(hudKmh: number) => (
              <Pressable
                onLongPress={isTripActiveMap ? exportNavDriveTrace : undefined}
                delayLongPress={700}
                style={[
                  styles.speedPanelNav,
                  !isNavigating && { bottom: 200 },
                ]}
              >
                <SpeedLimitBadge
                  initialKmh={0}
                  kmh={hudKmh}
                  speedLimit={effectiveSpeedLimit}
                  tolerance={SPEED_LIMIT_TOLERANCE}
                  size={44}
                  style={{ marginBottom: 4, alignSelf: 'center' }}
                />
                <SpeedValueText
                  initialKmh={0}
                  kmh={hudKmh}
                  speedLimit={effectiveSpeedLimit}
                  tolerance={SPEED_LIMIT_TOLERANCE}
                  style={styles.speedValue}
                />
                <Text style={styles.speedLabel}>KM/H</Text>
              </Pressable>
            )}
          </SpeedometerHUD>
        )}

        {/* ── Tryb jazdy: górny HUD (prawie pełna szerokość) — prędkość, limit, dystans do celu ── */}
        {isDriving && !isNavigating && (
          <SpeedometerHUD initialKmh={0}>
            {(hudKmh: number) => (
              <Pressable
                onLongPress={exportNavDriveTrace}
                delayLongPress={700}
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 6,
                  right: 6,
                  zIndex: 96,
                  backgroundColor: theme.mapOverlay,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.primaryBorder,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 3 },
                  shadowOpacity: isDark ? 0.4 : 0.15,
                  shadowRadius: 10,
                  elevation: 12,
                }}
              >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialCommunityIcons name="car-sports" size={22} color={theme.primary} />
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.primary, letterSpacing: 2, fontWeight: '800' }}>
                    TRYB JAZDY
                  </Text>
                  <SpeedValueText
                    initialKmh={0}
                    kmh={hudKmh}
                    speedLimit={effectiveSpeedLimit}
                    tolerance={SPEED_LIMIT_TOLERANCE}
                    showUnit
                    style={{
                      fontFamily: 'Orbitron',
                      fontSize: 30,
                      fontWeight: '900',
                      color: theme.text,
                      letterSpacing: -1,
                      marginTop: 2,
                    }}
                    unitStyle={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim, fontWeight: '700' }}
                  />
                </View>
              </View>
              <SpeedLimitBadge
                initialKmh={0}
                kmh={hudKmh}
                speedLimit={effectiveSpeedLimit}
                tolerance={SPEED_LIMIT_TOLERANCE}
                size={48}
              />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 1 }}>PRZEJECHANE (SILNIK TRASY)</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, fontWeight: '800', color: theme.primary }}>
                {(Number.isFinite(liveDistanceKm) ? liveDistanceKm : 0).toFixed(2)} km
              </Text>
            </View>

            <View style={{
              marginTop: 10,
              paddingTop: 10,
              borderTopWidth: 1,
              borderTopColor: theme.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}>
              <MaterialIcons name="navigation" size={16} color="#00bfff" />
              <View style={{ flex: 1, minWidth: 0 }}>
                {endLocation ? (
                  <>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }} numberOfLines={1}>
                      {endLocation.name ?? 'Cel trasy'}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <MaterialIcons name="straighten" size={12} color="#00bfff" />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#00bfff', fontWeight: '800' }}>
                          {drivingGoalDistKm != null
                            ? (drivingGoalDistKm < 1
                              ? `${Math.round(drivingGoalDistKm * 1000)} m`
                              : `${drivingGoalDistKm.toFixed(1)} km`)
                            : '—'}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>do celu (linia prosta)</Text>
                      {routeInfo?.distance != null && (
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textMuted }}>
                          · trasa ~{routeInfo.distance} km
                        </Text>
                      )}
                    </View>
                  </>
                ) : (
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#ffffff55' }}>
                    Ustaw cel w wyszukiwarce — zobaczysz dystans i podgląd trasy.
                  </Text>
                )}
              </View>
            </View>
              </Pressable>
            )}
          </SpeedometerHUD>
        )}

        {/* ── Przyciski boczne + FAB (akcje w modalu) ─────── */}
        <View style={[
          styles.rightBottomControls,
          !isNavigating && !isDriving && {
            bottom: startLocation && endLocation && routeInfo ? 248 : 188
          },
          isDriving && startLocation && endLocation && routeInfo && {bottom: 328}
        ]}>
          {!isNavigating && (
            <TouchableOpacity
              style={[
                styles.sideBtn,
                isDriving
                  ? { backgroundColor: '#e3383522', borderColor: '#e3383555' }
                  : { backgroundColor: isDark ? '#ffffff08' : '#ffffffee', borderColor: isDark ? '#ffffff10' : '#00000018' },
              ]}
              onPress={handleToggleDrivingMode}
              activeOpacity={0.75}
            >
              <MaterialCommunityIcons
                name="car-outline"
                size={20}
                color={isDriving ? '#e33835' : theme.textDim}
              />
            </TouchableOpacity>
          )}

          {!isDriving && (
            <TouchableOpacity
              style={[
                styles.sideBtn,
                isBuilding
                  ? { backgroundColor: '#db1e1e', borderColor: '#000000c7' }
                  : { backgroundColor: isDark ? '#0c0c0cd2' : '#ffffffee', borderColor: isDark ? '#fa07079a' : '#c0201d40' },
              ]}
              onPress={() => {
                if (isBuilding) {
                  if (pins.length >= 2) { finishPin(); setSaveRouteVisible(true); }
                  else { cancelBuilding(); Toast.show({ type: 'info', text1: 'Dodaj min. 2 punkty' }); }
                } else {
                  startBuilding();
                  Toast.show({ type: 'info', text1: '📍 TRYB TWORZENIA TRASY', text2: 'Dotykaj mapę aby dodać punkty' });
                }
              }}
              activeOpacity={0.75}
            >
              <MaterialCommunityIcons
                name={isBuilding ? 'check' : 'map-marker-path'}
                size={20}
                color={isBuilding ? '#ffffff' : theme.primary}
              />
            </TouchableOpacity>
          )}

          {isNavigating && (
            <TouchableOpacity
              style={[styles.sideBtn, { backgroundColor: isDark ? '#ffffff08' : '#ffffffee', borderColor: isDark ? '#fa07079a' : '#c0201d40' }]}
              onPress={() => { setSearchModalVisible(true); setMapFabModalVisible(false); }}
              activeOpacity={0.75}
            >
              <MaterialIcons name="alt-route" size={20} color={theme.primary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.sideBtn,
              isSharing
                ? { backgroundColor: '#4de92620', borderColor: '#4de92645' }
                : { backgroundColor: isDark ? '#ffffff08' : '#ffffffee', borderColor: isDark ? '#ffffff10' : '#00000018' },
            ]}
            onPress={handleToggleSharing}
            activeOpacity={0.75}
          >
            <MaterialIcons
              name={isSharing ? 'location-on' : 'location-off'}
              size={20}
              color={isSharing ? '#4de926' : theme.textDim}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sideBtn, { backgroundColor: isDark ? '#ffffff08' : '#ffffffee', borderColor: isDark ? '#ffffff10' : '#00000018' }]}
            onPress={handleCenterOnUser}
            activeOpacity={0.75}
          >
            <MaterialIcons name="my-location" size={20} color={theme.textDim} />
          </TouchableOpacity>

          {connected && isSharing && (
            <View style={{
              position: 'absolute',
              top: 12 + (isDriving && !isNavigating ? 178 : 120),
              right: 12,
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: '#4de92618', paddingHorizontal: 8, paddingVertical: 4,
              borderRadius: 20, borderWidth: 1, borderColor: '#4de92635', zIndex: 15,
              pointerEvents: 'none',
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#4de926' }} />
              <Text style={{ color: '#4de926', fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1 }}>LIVE</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.sideBtn, { backgroundColor: isDark ? '#ffffff08' : '#ffffffee', borderColor: isDark ? '#ffffff10' : '#00000018' }]}
            onPress={() => setMapFabModalVisible(true)}
            activeOpacity={0.75}
          >
            <MaterialCommunityIcons name="widgets-outline" size={22} color={theme.textMuted} />
          </TouchableOpacity>
        </View>

        <Modal
          visible={mapFabModalVisible}
          animationType="slide"
          transparent
          statusBarTranslucent
          onRequestClose={() => setMapFabModalVisible(false)}
        >
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setMapFabModalVisible(false)} />
            <View style={{
              backgroundColor: isDark ? '#141416' : '#f4f4f5',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingTop: 10,
              paddingHorizontal: 16,
              paddingBottom: (insets.bottom || 0) + 16,
              borderTopWidth: 1,
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: isDark ? '#ffffff25' : '#00000020', alignSelf: 'center', marginBottom: 14 }} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '900', letterSpacing: 1, marginBottom: 16 }}>
                AKCJE MAPY
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 }}>
                {[
                  {
                    key: 'route',
                    label: 'Trasa',
                    icon: 'alt-route' as const,
                    lib: 'mi' as const,
                    onPress: () => { setMapFabModalVisible(false); setSearchModalVisible(true); },
                  },
                  {
                    key: 'fuel',
                    label: 'Paliwo',
                    icon: 'gas-station' as const,
                    lib: 'mci' as const,
                    onPress: () => {
                      setMapFabModalVisible(false);
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
                    },
                  },
                  {
                    key: 'center',
                    label: 'Centruj',
                    icon: 'my-location' as const,
                    lib: 'mi' as const,
                    onPress: () => { setMapFabModalVisible(false); handleCenterOnUser(); },
                  },
                  {
                    key: 'manualPoint',
                    label: 'Punkt',
                    icon: 'place' as const,
                    lib: 'mi' as const,
                    onPress: () => {
                      setMapFabModalVisible(false);
                      setManualTargetPickMode(true);
                      Toast.show({ type: 'info', text1: 'Tryb punktu ręcznego', text2: 'Przytrzymaj mapę, aby ustawić cel.' });
                    },
                  },
                  {
                    key: 'mute',
                    label: isSpeechEnabled ? 'Dźwięk' : 'Wycisz',
                    icon: (isSpeechEnabled ? 'volume-up' : 'volume-off') as const,
                    lib: 'mi' as const,
                    onPress: () => { setMapFabModalVisible(false); setIsSpeechEnabled(v => !v); },
                  },
                  {
                    key: 'alert',
                    label: 'Zgłoś',
                    icon: 'warning' as const,
                    lib: 'mi' as const,
                    onPress: () => { setMapFabModalVisible(false); setReportVisible(true); },
                  },
                  {
                    key: 'spot',
                    label: 'Spoty',
                    icon: 'map-marker-star' as const,
                    lib: 'mci' as const,
                    onPress: () => { setMapFabModalVisible(false); router.push('/(tabs)/spotmap' as any); },
                  },
                  {
                    key: 'cam',
                    label: 'Fotoradar',
                    icon: 'camera-plus-outline' as const,
                    lib: 'mci' as const,
                    onPress: () => { setMapFabModalVisible(false); setAddCameraVisible(true); },
                  },
                  {
                    key: 'layers',
                    label: 'Warstwy',
                    icon: 'layers-outline' as const,
                    lib: 'mci' as const,
                    onPress: () => { setMapFabModalVisible(false); setSettingsVisible(true); },
                  },
                ].map(tile => (
                  <TouchableOpacity
                    key={tile.key}
                    style={{
                      width: '23%',
                      minWidth: 72,
                      maxWidth: 110,
                      aspectRatio: 1,
                      borderRadius: 14,
                      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#fff',
                      borderWidth: 1,
                      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 6,
                    }}
                    onPress={tile.onPress}
                    activeOpacity={0.85}
                  >
                    {tile.lib === 'mi' ? (
                      <MaterialIcons name={tile.icon as any} size={26} color={tile.key === 'alert' ? '#e33835' : theme.textMuted} />
                    ) : (
                      <MaterialCommunityIcons name={tile.icon as any} size={26} color={theme.textMuted} />
                    )}
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 6, textAlign: 'center' }} numberOfLines={2}>
                      {tile.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={{ marginTop: 18, alignItems: 'center', paddingVertical: 12 }}
                onPress={() => setMapFabModalVisible(false)}
              >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim }}>ZAMKNIJ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ── Search bar ───────────────────────────────────── */}
        {!isNavigating && !isBuilding && (
          <TouchableOpacity
            style={[
              styles.topSearchButton,
              isDriving && !isNavigating && { top: 148 },
            ]}
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
                      {startLocation.name ?? 'Punkt startowy'}
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
                  style={[styles.navigateButton, ((!isOffroadRoute && previewLoading) || !routeInfo) && { opacity: 0.5 }]}
                  onPress={startNavigation}
                  activeOpacity={0.85}
                  disabled={(!isOffroadRoute && previewLoading) || !routeInfo}
                >
                  {!isOffroadRoute && previewLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <MaterialIcons name="navigation" size={18} color="#fff" />
                  }
                  <Text style={styles.navigateButtonText}>
                    {!isOffroadRoute && previewLoading ? 'OBLICZAM...' : 'NAWIGUJ'}
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

        {/* ── Empty state ──────────────────────────────────── */}
        {!isNavigating && !isBuilding && !isDriving && !startLocation && !endLocation && !searchModalVisible && (
          <View style={styles.emptyStateContainer}>
            <View style={styles.emptyState}>
              <MaterialIcons name="location-on" size={40} color="#e33835ce" />
              <Text style={styles.emptyTitle}>WYBIERZ TRASĘ</Text>
              <Text style={styles.emptySubtitle}>Dotknij paska wyszukiwania</Text>
            </View>
          </View>
        )}

        </View>

        {/* ── Modale ───────────────────────────────────────── */}
        <SearchModal
          visible={searchModalVisible}
          onClose={() => setSearchModalVisible(false)}
          onSelectStart={handleSelectStart}
          onSelectEnd={handleSelectEnd}
          userLocation={userLocation}
          nearbyUsers={nearbyUsers}
          homeLocation={homeLocation}
          onPressSetHome={() => {
            setSearchModalVisible(false);
            router.push('/profile/settings' as any);
          }}
        />
        <UserInfoModal
          visible={userInfoVisible}
          user={selectedUser}
          distance={selectedUser?.distance ?? 0}
          onNavigate={handleNavigateToUser}
          onClose={() => setUserInfoVisible(false)}
          onViewProfile={handleViewProfile}
          onMessage={handleMessageUser}
        />
        <SettingsModal
          visible={settingsVisible}
          mapType={mapType}
          onChangeMapType={handleChangeMapType}
          onClose={() => setSettingsVisible(false)}
        />
        <ReportModal
          visible={reportVisible}
          onClose={() => setReportVisible(false)}
          onReport={handleReport}
          isSubmitting={isSubmittingWarning}
        />
        <WarningDetailModal
          visible={!!selectedWarning}
          warning={selectedWarning}
          onClose={() => setSelectedWarning(null)}
          onConfirm={confirmWarning}
          onCancel={cancelWarning}
          currentUserId={currentUserId ?? undefined}
        />
        <SaveRouteModal
          visible={saveRouteVisible}
          pinCount={pins.length}
          distanceKm={totalDistance(
            snappedRoute.length > 0
              ? snappedRoute
              : pins.map(p => ({ latitude: p.latitude, longitude: p.longitude })),
          )}
          saving={saving}
          snapping={snapping}
          isSnapped={snappedRoute.length > 0}
          onSnapToRoad={() => snapToRoad(pins)}
          onCancel={() => setSaveRouteVisible(false)}
          onSave={async (name, desc, isPublic, isOffroad) => {
            if (!isPublic && !isPremium) {
              try {
                const token = await AsyncStorage.getItem('token');
                if (token) {
                  const res  = await fetch(`${API_URL}/api/routes/my`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  const json = await res.json();
                  const privateCount = Array.isArray(json) ? json.filter((r: any) => !r.isPublic).length : 0;
                  if (privateCount >= 5) {
                    Toast.show({ type: 'info', text1: '🔒 Limit prywatnych tras', text2: 'Free: max 5 · Odblokuj Premium' });
                    setSaveRouteVisible(false);
                    router.push('/premium' as any);
                    return;
                  }
                }
              } catch {}
            }
            const result = await saveRoute(name, desc, isPublic, isOffroad);
            setSaveRouteVisible(false);
            if (result) Toast.show({ type: 'success', text1: '✅ TRASA ZAPISANA', text2: name });
            else        Toast.show({ type: 'error',   text1: 'Błąd zapisu trasy' });
          }}
        />

        <RouteLeaderboardModal
          visible={leaderboardVisible}
          routeId={leaderboardRouteId}
          routeName={leaderboardRouteName}
          data={leaderboardData}
          runsData={leaderboardRunsData}
          loading={leaderboardLoading}
          newTime={myFinishedTime}
          onClose={() => { setLeaderboardVisible(false); setMyFinishedTime(null); }}
        />

        <TripStatsModal
          visible={tripStatsVisible}
          stats={tripStats}
          onClose={() => { setTripStatsVisible(false); clearStats(); }}
        />

        <AddSpeedCameraModal
          visible={addCameraVisible}
          onClose={() => setAddCameraVisible(false)}
          onConfirm={handleAddCamera}
          onPickOnMap={(params) => {
            setPendingAddCameraParams(params);
            setCameraPickMode(true);
            if (userLocation) {
              pickCenterRef.current = {
                lat: userLocation.latitude,
                lng: userLocation.longitude,
              };
            }
          }}
        />

        <SpeedCameraDetailModal
          visible={cameraDetailVisible}
          camera={selectedCamera}
          onClose={() => setCameraDetailVisible(false)}
          onConfirm={confirmCamera}
          onDelete={async (id) => {
            const ok = await deleteCamera(id);
            if (ok) {
              setCameraImages(prev => {
                const next = { ...prev };
                delete next[String(id)];
                return next;
              });
              Toast.show({ type: 'success', text1: '🗑️ USUNIĘTO' });
            } else {
              Toast.show({ type: 'error', text1: 'Błąd usuwania' });
            }
            return ok;
          }}
          currentUserId={currentUserId}
        />

        <AddFuelStationModal
          visible={addFuelStationVisible}
          latitude={addFuelStationCoords?.latitude ?? null}
          longitude={addFuelStationCoords?.longitude ?? null}
          onClose={() => {
            setAddFuelStationVisible(false);
            setAddFuelStationCoords(null);
          }}
          onSubmit={async (data) => {
            const ok = await createFuelStation(data);
            if (ok) refetchFuelStations();
            return ok;
          }}
        />

        <FuelStationModal
          visible={fuelStationModalVisible}
          station={selectedFuelStation}
          onClose={() => setFuelStationModalVisible(false)}
          onNavigate={(lat, lng, name) => {
            if (!userLocation || !Number.isFinite(userLocation.latitude) || !Number.isFinite(userLocation.longitude)) {
              Toast.show({ type: 'error', text1: 'GPS', text2: 'Poczekaj na lokalizację, potem ponów Nawiguj.' });
              return;
            }
            setStartLocation({ ...userLocation, name: 'Moja pozycja' });
            setEndLocation({ latitude: lat, longitude: lng, name: name || 'Stacja paliw' });
            setFuelStationModalVisible(false);
            Toast.show({ type: 'success', text1: '📍 CEL USTAWIONY', text2: name || 'Stacja paliw' });
          }}
          onPricesUpdated={refetchFuelStations}
          updatePrices={updateFuelPrices}
        />

        <PartnerPoiModal
          visible={partnerPoiModalVisible}
          poi={selectedPartnerPoi}
          onClose={() => setPartnerPoiModalVisible(false)}
          onNavigate={(lat, lng, name) => {
            if (!userLocation || !Number.isFinite(userLocation.latitude) || !Number.isFinite(userLocation.longitude)) {
              Toast.show({ type: 'error', text1: 'GPS', text2: 'Poczekaj na lokalizację, potem ponów Nawiguj.' });
              return;
            }
            setStartLocation({ ...userLocation, name: 'Moja pozycja' });
            setEndLocation({ latitude: lat, longitude: lng, name: name || 'Partner' });
            setPartnerPoiModalVisible(false);
            Toast.show({ type: 'success', text1: '📍 CEL USTAWIONY', text2: name || 'Partner' });
          }}
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