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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../constants/mapConfig';
import { useTheme } from '../../contexts/ThemeContext';
import { useSubscriptionStatus } from '../../hooks/useSubscriptionStatus';
import { notifyBackgroundPremiumRequired } from '../../lib/backgroundPremiumGate';
import { useChat } from '../../hooks/useChats';
import { DrPositionMarker } from '../../components/map/DrPositionMarker';
import { SmoothDrPositionMarker } from '../../components/map/SmoothDrPositionMarker';
import {
  SpeedometerHUD,
  SpeedLimitBadge,
  SpeedValueText,
  emitSpeedometerKmh,
  normalizeHudSpeedKmh,
} from '../../components/map/SpeedometerHUD';
import { MapTerrainLayers } from '../../components/map/MapTerrainLayers';
import { MapCanvas } from '../../components/map/MapCanvas';
import { MapActiveRouteLayers, MapBuilderRouteLayers } from '../../components/map/MapRouteLayers';
import { makeMapStyles } from '../../styles/mapstyle';
import { ensureMapboxToken } from '../../lib/mapboxInit';
import {
  feedSmoothPositionTarget,
  clearSmoothPositionFeed,
  setMarkerStaleRawToSnapM,
  subscribeSmoothPositionDisplay,
} from '../../lib/mapPosition/smoothPositionFeed';
import { useSmoothMapPosition } from '../../hooks/useSmoothMapPosition';
import { useMapTilePrefetch } from '../../hooks/useMapTilePrefetch';
import { roadGeometryStore } from '../../lib/roadGeometry/RoadGeometryStore';
import { getLocalRoadGeometry, pickNearestPolyline } from '../../lib/roadGeometry/localTileSnap';
import { markerLogCritical, markerLogTick } from '../../lib/markerPipelineLog';
import { vroomGpsLog, vroomGpsLogNow } from '../../lib/vroomGpsLog';
import { beginGpsTick } from '../../lib/gpsTickTrace';
import { logGpsTickLayer } from '../../lib/gpsTickTraceLog';
import { installRemoteDriveLogger } from '../../lib/remoteDriveLogger';

ensureMapboxToken();

import {
  MAPBOX_STYLE_DARK,
  MAPBOX_STYLE_LIGHT,
  MAPBOX_STYLE_SATELLITE,
  MAPBOX_STYLE_HYBRID,
  MAX_NEARBY_USERS_DISTANCE
} from '../../constants/mapConfig';
import { LocationState, RouteInfo, User } from '../../constants/types';
import {
  loadMapLastLocation,
  saveMapLastLocation,
  peekMapLastLocation,
  rememberMapLastLocation,
} from '../../lib/mapLastLocation';

import { latFilter, lngFilter, navLatFilter, navLngFilter, drivLatFilter, drivLngFilter } from '../../scripts/kalmanFilter';
// ── NOWE: sanity check ────────────────────────────────────
import { isSaneLocation } from '../../scripts/kalmanFilter';
import {
  sanitizeSpeedMs,
  clampSpeedKmhToGeometry,
  MAX_SPEED_HUD_KMH,
  sustainedTripSpeedFromSamples,
  type TripMoveSample,
} from '../../scripts/speedSanitizer';

import { useAdaptiveGPS } from '../../hooks/useAdaptiveGPS';
import {
  BG_IS_SHARING_KEY,
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
import { useCameraAnimation, getTripCameraPadding } from '../../hooks/useCameraAnimation';
import { useDeadReckoning } from '../../hooks/useDeadReckoning';
import { useDemoUsers } from '../../hooks/useDemoUsers';
import { useDrivingMapMatch } from '../../hooks/useDrivingMapMatch';
import { useDrivingSnap, validateGeometryAgainstRaw } from '../../hooks/useDrivingSnap';
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
import { UserCarMarker } from '../../components/markers/UserCarMarker';
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
import { AdBanner }           from '../../components/ads/AdBanner';
import { useFuelStations }      from '../../hooks/useFuelStations';
import { FuelStationMarker }    from '../../components/markers/FuelStationMarker';
import { PartnerPoiMarker }     from '../../components/markers/PartnerPoiMarker';
import { usePartnerPois }       from '../../hooks/usePartnerPois';
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

// v10: zwiekszony z 40 do 100 — w polaczeniu z NAV_ROUTE_SNAP_M=80 marker
// zostaje na trasie az do realnego zjazdu w bok. Mniej falszywych reroute'ow.
const REROUTE_THRESHOLD_M = 100;
const NAV_PITCH           = 62;
const BROWSE_3D_PITCH     = 52;
const BUILDINGS_3D_MIN_ZOOM = 14;
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
const MAP_DIAG_FLUSH_MS = 15_000;
const MAP_DIAG_MAX_BATCH = 25;
const MAP_DIAG_MAX_BUFFER = 180;

// Live location sharing — interval + distance/time gate
const SEND_INTERVAL_MS    = 15_000; // poll period (ms)
const SEND_MIN_DIST_M     = 40;     // min movement before sending (saves bandwidth while stationary)
const SEND_MAX_ELAPSED_MS = 60_000; // heartbeat: force-send after this long even without movement
const FORCE_MAP_MATCH_COOLDOWN_MS = 180_000;
const FORCE_MAP_MATCH_MIN_MOVE_M = 180;
const FORCE_MAP_MATCH_RECOVER_MIN_INTERVAL_MS = 45_000;
const FORCE_MAP_MATCH_RECOVER_STREAK = 4;
/** Min. odstęp forceMatch przy braku geometrii drogi (noRoad). */
const NO_ROAD_FORCE_MATCH_MIN_GAP_MS = 30_000;
const NO_ROAD_FORCE_MATCH_MIN_MOVE_M = 15;
const NO_ROAD_FORCE_MATCH_MIN_REC_M = 25;
const NAV_SESSION_KEY     = 'nav_session_v1';
const NAV_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

// updateCameras + updateSpeedLimit — skip if user hasn't moved this far
// (each hook also has its own internal throttle; this gate prevents even the
//  cheap recalc/sort from running on every sub-second GPS tick)
const CAMERA_SPEED_LIMIT_GATE_M = 30; // meters
const CAMERA_SPEED_LIMIT_GATE_NAV_M = 10; // meters in driving/navigation

// Reroute cooldown — avoids hammering Directions API while continuously off-route
const REROUTE_COOLDOWN_MS = 120_000; // min. odstęp między requestami Directions przy reroute
const REROUTE_MIN_MOVED_M = 700;     // wcześniejszy reroute tylko po dużym zejściu z trasy
const OFF_ROUTE_CONFIRM_MS = 14_000; // musi być poza trasą przez ten czas zanim poleci API
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

/** Heading zgodny z drogą (segment polyline), nie surowy GPS pod kątem. */
function resolveDrivingHeading(
  appliedSnap: { snapped: boolean; targetHeading: number; latitude: number; longitude: number },
  lastHeading: number,
  lastDrivingPos: { lat: number; lng: number } | null,
  gpsHeading: number | null | undefined,
  kmh: number,
): number | null {
  // ANALIZA mphanl3x: heading "next=57" przyklejony przez całą sesję bo snap
  // chwytał boczną polilinię ze stałym bearingiem 57°, a Doppler GPS pokazywał
  // ~237° (przeciwna strona). resolveDrivingHeading() i resolveUnifiedHeading()
  // ważyły snap heading dużo bardziej niż GPS, więc heading zamykał się w pętli
  // 57° → 57° → 57°. 48× HEADING_FLIP_GUARD ze skokami 154-179°.
  //
  // Fix: gdy snap i raw Doppler są drastycznie różne przy ruchu, snap jest
  // najprawdopodobniej na bocznej polilinii — preferuj raw Doppler bezpośrednio,
  // bez aliasingu do snap-bearing.
  if (
    appliedSnap.snapped
    && Number.isFinite(appliedSnap.targetHeading)
    && gpsHeading != null
    && Number.isFinite(gpsHeading)
    && Number(gpsHeading) >= 0
    && kmh >= 12
  ) {
    const snapVsGps = Math.abs(
      ((Number(gpsHeading) - appliedSnap.targetHeading + 540) % 360) - 180,
    );
    // ANALIZA mphbhukq (v4): HEADING_FLIP_GUARD 39× z `next=76` przyklejony,
    // ale `delta` względem `prev` często 100-130° (a nie >60° vs gps_heading).
    // Obniżenie progu na 45° łapie szerszy zakres bocznych polilinii.
    if (snapVsGps > 32) {
      const gpsBypass = smoothHeading(lastHeading, Number(gpsHeading), 0.6, 55);
      return gpsBypass;
    }
  }

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

  if (gpsHeading != null && gpsHeading >= 0 && kmh >= 6) {
    const gpsFlip = Math.abs(((gpsHeading - lastHeading + 540) % 360) - 180);
    if (gpsFlip <= 110) {
      return smoothHeading(lastHeading, gpsHeading, 0.38, 40);
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
  const hasGps = params.gpsHeading != null && Number.isFinite(params.gpsHeading);

  const ref = hasMove
    ? Number(params.movementHeading)
    : hasSnap
      ? Number(params.snapHeading)
      : prev;
  const alignedSnap = hasSnap ? alignBearingToReference(Number(params.snapHeading), ref) : null;
  const alignedMove = hasMove ? alignBearingToReference(Number(params.movementHeading), ref) : null;
  const alignedGps = hasGps ? alignBearingToReference(Number(params.gpsHeading), ref) : null;

  // ANALIZA mphbhukq (v4): obniżamy próg z 60 na 45° (boczne polilinie mają
  // często diff 50-60° vs Doppler) i z 30 na 25 km/h (łapiemy też miejskie scenariusze).
  if (
    alignedSnap != null
    && alignedGps != null
    && speedKmh >= 12
  ) {
    const snapGpsDiff = Math.abs(((alignedSnap - alignedGps + 540) % 360) - 180);
    if (snapGpsDiff > 32) {
      const target = smoothHeading(prev, alignedGps, 0.65, 55);
      return ((target % 360) + 360) % 360;
    }
  }

  let target = prev;
  if (alignedMove != null) {
    target = smoothHeading(target, alignedMove, speedKmh >= 10 ? 0.62 : 0.5, 32);
  }
  if (alignedSnap != null) {
    const snapWeight = alignedMove != null && speedKmh >= 8
      ? (Math.abs(((alignedSnap - alignedMove + 540) % 360) - 180) > 28 ? 0.22 : 0.38)
      : (speedKmh >= 14 ? 0.48 : 0.4);
    target = smoothHeading(target, alignedSnap, snapWeight, 22);
  }
  if (alignedGps != null && speedKmh >= 6) {
    target = smoothHeading(target, alignedGps, 0.32, 24);
  }

  const maxTurn = speedKmh < 6 ? 14 : speedKmh < 20 ? 24 : speedKmh < 55 ? 34 : 42;
  const delta = ((target - prev + 540) % 360) - 180;
  const limited = prev + Math.sign(delta) * Math.min(Math.abs(delta), maxTurn);
  return ((limited % 360) + 360) % 360;
}

/** Przy ~8 km/h net w oknie 3 s ≈ 6–7 m; stary próg 12 m = fałszywy postój. */
function tripStandstillNetM(speedKmh: number, motionKmh = 0): number {
  return speedKmh < 15 || motionKmh < 15 ? 4 : 12;
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
}): boolean {
  const rawGps = opts.rawGpsKmh ?? 0;
  const standstillNetM = tripStandstillNetM(rawGps, opts.motionKmh);
  const pathM = opts.pathMoveM ?? 0;
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
  if (
    opts.netMoveM < 22
    && opts.sustainedKmh < 12
    && opts.motionKmh >= 80
    && pathM < 35
  ) {
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
  // P1: niższy próg — miejska jazda / poszarpany GPS (Android i iOS).
  return opts.rawGpsKmh >= 8 && !isParkedLikeTripEvidence(opts);
}

function computeSnapFailMaxStepM(kmh: number, rawDriftM: number): number {
  if (kmh >= 25) {
    return Math.min(45, Math.max(12, kmh * 0.28, rawDriftM * 0.4));
  }
  if (kmh >= 8) {
    return Math.min(22, Math.max(6, kmh * 0.18, rawDriftM * 0.35));
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
  const towardRaw = rawFromMarkerM > snapFromMarkerM + 6;
  const goalLat = towardRaw ? rawLat : snapLat;
  const goalLng = towardRaw ? rawLng : snapLng;
  const distGoalM = haversineKm(markerLat, markerLng, goalLat, goalLng) * 1000;
  const stepM = Math.min(
    distGoalM,
    Math.max(4, Math.min(kmh >= 45 ? 26 : 20, speedMs * 1.2 + 5)),
    rawFromMarkerM * 0.5,
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
  if (movedM < 2.5) {
    const rawStepM = Math.max(4, Math.min(stepM, rawFromMarkerM * 0.45, 8));
    next = clampCoordStep(
      { latitude: markerLat, longitude: markerLng },
      { latitude: rawLat, longitude: rawLng },
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
// Czas (ms) jazdy <10 km/h zanim wyłączymy tryb driving
const DRIVING_STOP_DELAY_MS      = 12 * 60 * 1000; // 12 minut
const DRIVING_SPEED_KMH          = 10;
/** Postój przy włączeniu trybu jazdy — nie przesuwaj markera na odległą drogę. */
const DRIVING_ENTRY_STATIONARY_KMH = 6;
const DRIVING_ENTRY_MAX_SNAP_M     = 22;
/** Pierwsze przyklejenie do drogi przy włączeniu trybu jazdy (GPS bywa 50–80 m off-road). */
const DRIVING_ENTRY_INITIAL_SNAP_M = 85;
const DRIVING_ENTRY_SQLITE_RADIUS_M = 120;
/** Po async map-match przy wejściu w jazdę — przesuń marker tylko gdy korekta ≤ tego (m). */
const DRIVING_ENTRY_ASYNC_MAX_CORRECTION_M = 8;
const DRIVING_TOGGLE_GUARD_MS      = 400;
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
const MIN_GPS_TICK_SEC           = 0.5;

// ── GPS resume/focus grace period ─────────────────────────
// After restarting GPS on foreground/focus, backdate lastGoodTimeRef by this
// amount so the sanity-check allows larger position jumps for the first few
// fixes (accommodates inaccurate first fix after a cold GPS restart).
const GPS_RESUME_GRACE_PERIOD_MS = 2000;
/** v10: krótki freeze tylko po długim tle — długi blokował GPS ~10s (freeze + teleport). */
const TRIP_RESUME_FREEZE_MS = 1200;
const TRIP_RESUME_FREEZE_MAX_MS = 2800;
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
const UI_LOCATION_THROTTLE_MS    = 125;
/** Podczas jazdy: userLocation state tylko dla fuel/socket — marker/kamera z workletu. */
const ACTIVE_UI_LOCATION_THROTTLE_MS = 480;
/** Kamera = ten sam punkt co marker (bez drugiego LERP). */
const CAM_DISPLAY_FOLLOW_MS = 33;
/** Podczas jazdy/nawigacji userLocation state jest tylko dla secondary/live state. */
const SECONDARY_LOC_PUBLISH_MS   = 2500;
const NAV_PROGRESS_UI_MS         = 650;
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
const GPS_RAW_TICK_DEDUPE_MIN_MS = 320;
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
const LIVE_ACHIEVEMENT_MIN_MOVING_DISTANCE_KM = 0.12;
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
const GPS_IDLE_UI_HARD_JUMP_M = 160;
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
// PŁYNNOŚĆ v7: skróciłem z 70-120 ms (dla 30 fps DR) na 35-75 ms (dla 60 fps DR).
// Worklet dostaje target co 16 ms, więc duration musi być w tym rzędzie wielkości
// żeby segment się zakończył zanim przyjdzie nowy. Krótsze duration = marker
// jest CIĄGLE blisko aktualnego DR position, nie zostawia śladu animacji.
const TRIP_SMOOTH_MIN_MS = 35;
const TRIP_SMOOTH_MAX_MS = 75;
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
  if (ms < 0.5) return 14;
  return Math.max(14, Math.min(72, ms * 1.6 + 10));
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
): { lat: number; lng: number; reason: string | null } {
  const maxStep = maxPlausibleDrivingStepM(speedMs, kmh);
  const applyJumpM = haversineKm(anchor.lat, anchor.lng, applyLat, applyLng) * 1000;
  const rawJumpM = haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000;
  const applyToRawM = haversineKm(applyLat, applyLng, rawLat, rawLng) * 1000;

  if (applyJumpM <= maxStep && applyToRawM <= 48) {
    return { lat: applyLat, lng: applyLng, reason: null };
  }
  if (rawJumpM <= maxStep * 1.4 && applyToRawM >= 22) {
    return { lat: rawLat, lng: rawLng, reason: 'snap_to_raw_truth' };
  }
  if (applyJumpM > maxStep) {
    if (rawJumpM < applyJumpM * 0.7 && applyToRawM > 18) {
      return { lat: rawLat, lng: rawLng, reason: 'raw_closer_than_apply' };
    }
    const c = clampCoordStep(
      { latitude: anchor.lat, longitude: anchor.lng },
      { latitude: applyLat, longitude: applyLng },
      maxStep,
    );
    return { lat: c.latitude, lng: c.longitude, reason: 'clamp_apply_jump' };
  }
  if (applyToRawM > 42) {
    const c = clampCoordStep(
      { latitude: applyLat, longitude: applyLng },
      { latitude: rawLat, longitude: rawLng },
      Math.min(maxStep, applyToRawM * 0.45),
    );
    return { lat: c.latitude, lng: c.longitude, reason: 'pull_toward_raw' };
  }
  return { lat: applyLat, lng: applyLng, reason: null };
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
export default function MapScreen() {
  // ── Refs – mapa i GPS ────────────────────────────────────
  const mapRef               = useRef<Mapbox.MapView>(null);
  const cameraRef            = useRef<Mapbox.Camera>(null);
  const locationSubRef       = useRef<any>(null);
  const lastHeadingRef       = useRef(0);
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
  const updateCameraFrameRef = useRef<((args: {
    center: { latitude: number; longitude: number };
    heading?: number;
    speedKmh?: number;
    isNavigating?: boolean;
    isDriving?: boolean;
    timestamp?: number;
  }) => void) | null>(null);
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
  const feedDRRef   = useRef<(pos: { latitude: number; longitude: number }, speedMs: number, heading: number) => void>(() => {});
  const lastSmoothFeedAtRef = useRef(0);
  const lastWorkletFeedAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastWorkletFeedAtRef = useRef(0);
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
  const tripPeakSpeedRef = useRef(0);
  /** Ostatni feed GPS — projekcja markera w tle gdy worklet Reanimated stoi. */
  const markerProjRef = useRef({
    lat: 0,
    lng: 0,
    hdg: 0,
    speedMs: 0,
    at: 0,
  });
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
  const offRouteSinceRef    = useRef<number>(0);
  // forceMapMatch: avoid repeated paid entry snaps in the same area
  const lastForceMapMatchRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const lastDrivingNoSnapForceRef = useRef<number>(0);
  const drivingNoSnapStreakRef = useRef(0);
  const lastSnapSuccessAtRef = useRef(0);
  /** Throttle okresowego forceMatch w driving (świeża oś drogi). */
  const lastDrivingSoftRefreshRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  /** Gdy zniknie dopasowanie — szybki re-fetch bez spamowania API. */
  const lastDrivingRecoverMatchRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const lastDrivingSqliteRecoverRef = useRef<number>(0);
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
  });
  const gpsDbgLastLogAtRef = useRef(0);
  const gpsDbgLastAcceptedRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const drivingStopTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDrivingRef          = useRef(false);
  const drivingManualModeRef  = useRef(false);
  const lastDrivingToggleAtRef = useRef(0);
  const drivingManuallyDisabledRef = useRef(false);
  const drivingManualDisabledAtRef = useRef(0);
  const kmSinceManualOffRef = useRef(0);
  const gpsForceActiveRef = useRef(false);
  const lastBumpActiveMarkerAtRef = useRef(0);
  const tripMoveSamplesRef = useRef<TripMoveSample[]>([]);
  const lastSpeedRawAnchorRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastSpeedDiagRef = useRef<{ kmh: number; at: number } | null>(null);
  const lastMarkerDiagRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const drivingLastLocRef     = useRef<{ lat: number; lng: number } | null>(null);
  const lastDrivingPosRef     = useRef<{ lat: number; lng: number } | null>(null);
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
  const lastDrForceMatchAtRef = useRef(0);
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
  const mapDiagSessionIdRef = useRef(`map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
  const mapDiagBufferRef = useRef<Array<{
    at: number;
    type: string;
    payload: Record<string, unknown>;
  }>>([]);
  const mapDiagLastFlushAtRef = useRef(0);
  const mapDiagFlushInFlightRef = useRef(false);
  const mapDiagTokenRef = useRef<string | null>(null);
  const mapDiagAppStateRef = useRef(AppState.currentState);
  const persistMapLocation = useCallback((lat: number, lng: number, acc?: number) => {
    const now = Date.now();
    if (now - lastMapPersistAtRef.current < 3500) return;
    lastMapPersistAtRef.current = now;
    void saveMapLastLocation(lat, lng, acc);
  }, []);

  const flushMapDiagnostics = useCallback(async (opts?: { force?: boolean }) => {
    if (mapDiagFlushInFlightRef.current) return;
    const now = Date.now();
    if (!opts?.force && now - mapDiagLastFlushAtRef.current < MAP_DIAG_FLUSH_MS) return;
    if (mapDiagBufferRef.current.length === 0) return;
    mapDiagFlushInFlightRef.current = true;
    const batch = mapDiagBufferRef.current.slice(0, MAP_DIAG_MAX_BATCH);
    mapDiagBufferRef.current = mapDiagBufferRef.current.slice(batch.length);
    try {
      if (!mapDiagTokenRef.current) {
        mapDiagTokenRef.current =
          (await AsyncStorage.getItem('token'))
          ?? (await AsyncStorage.getItem('userToken'));
      }
      if (!mapDiagTokenRef.current) return;
      const activeLoc = currentLocRef.current;
      await fetch(`${API_URL}/api/live/map-telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mapDiagTokenRef.current}`,
        },
        body: JSON.stringify({
          sessionId: mapDiagSessionIdRef.current,
          appState: mapDiagAppStateRef.current,
          events: batch,
          userLocation: activeLoc
            ? { lat: activeLoc.latitude, lng: activeLoc.longitude }
            : null,
        }),
      });
      mapDiagLastFlushAtRef.current = now;
    } catch {
      mapDiagBufferRef.current = [...batch, ...mapDiagBufferRef.current].slice(-MAP_DIAG_MAX_BUFFER);
    } finally {
      mapDiagFlushInFlightRef.current = false;
    }
  }, []);

  const queueMapDiagnostic = useCallback((
    type: string,
    payload: Record<string, unknown>,
    opts?: { immediate?: boolean },
  ) => {
    mapDiagBufferRef.current.push({ at: Date.now(), type, payload });
    if (mapDiagBufferRef.current.length > MAP_DIAG_MAX_BUFFER) {
      mapDiagBufferRef.current = mapDiagBufferRef.current.slice(-MAP_DIAG_MAX_BUFFER);
    }
    if (opts?.immediate || mapDiagBufferRef.current.length >= MAP_DIAG_MAX_BATCH) {
      void flushMapDiagnostics({ force: true });
    }
  }, [flushMapDiagnostics]);

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

    if (V10_CLIENT_FIRST && tripActive && isInstant) {
      applyTripPositionRef.current?.(lat, lng, {
        heading: opts?.heading ?? drHdgRef.current ?? lastHeadingRef.current ?? 0,
        speedMs: opts?.speedMs ?? 0,
        forcePublish: opts?.forcePublish ?? true,
        instant: true,
        allowInstantFeed: opts?.allowInstantFeed ?? false,
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
   * V10 SSOT: jeden feed worklet na tick GPS. Worklet (60 FPS) interpoluje między tickami.
   * Zakaz: setTimeout sub-kotwice, RAF glide, DR.onFrame feed — powodowały shake/teleport.
   */
  const feedWorkletAnchorsAlongRoad = useCallback((
    lat: number,
    lng: number,
    heading: number,
    speedMs: number,
    smoothDurationMs: number,
    source: string,
  ) => {
    clearSubAnchorTimers();
    const prev = lastWorkletFeedAnchorRef.current;
    let feedLat = lat;
    let feedLng = lng;
    let movedM = prev
      ? haversineKm(prev.lat, prev.lng, feedLat, feedLng) * 1000
      : Infinity;
    // v10_arc_stale_snap wyłączone — drugi target na polilinii powodował shake (marker vs kotwica GPS).
    // P0: duży skok GPS → worklet LERP, nie durationMs:0 (teleport).
    const forceInstantFeed = false;
    let feedSpeedMs = speedMs > 0 ? speedMs : 0;
    const glideMs = forceInstantFeed
      ? 0
      : movedM >= 18
        ? Math.min(240, Math.max(140, Math.round(movedM * 4)))
        : speedMs <= 0
          ? 380
          : Math.min(
            380,
            Math.max(
              speedMs >= 4.2 ? 140 : 200,
              smoothDurationMs,
              Math.round(movedM * 8),
            ),
          );
    if (movedM >= 6 && glideMs > 0) {
      feedSpeedMs = Math.max(
        feedSpeedMs,
        Math.min(28, (movedM / Math.max(0.2, glideMs / 1000)) * 0.9),
      );
    }
    const feedSource = forceInstantFeed
      ? 'v10_feed_instant_catchup'
      : source === 'v10_arc_stale_snap'
        ? 'v10_arc_stale_snap'
        : (speedMs > 0 && (movedM >= 4 || speedMs >= 4.2)
          ? 'v10_direct_cruise_feed'
          : source);
    logGpsTickLayer('WORKLET_FEED_INCOMING', {
      layer: 'feedWorkletAnchorsAlongRoad',
      lat: Number(feedLat.toFixed(6)),
      lng: Number(feedLng.toFixed(6)),
      durationMs: glideMs,
      speedMs: feedSpeedMs != null ? Number(feedSpeedMs.toFixed(2)) : null,
      source: feedSource,
      movedM: Number.isFinite(movedM) ? Number(movedM.toFixed(2)) : null,
      instantTeleport: glideMs === 0,
    });
    feedSmoothPositionTarget({
      latitude: feedLat,
      longitude: feedLng,
      heading,
      durationMs: glideMs,
      speedMs: feedSpeedMs,
      source: feedSource,
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
      parkedLike?: boolean;
      rawStepM?: number;
    },
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (isNullIsland(lat, lng)) return;
    const heading = opts?.heading ?? drHdgRef.current ?? lastHeadingRef.current ?? 0;
    const speedMs = opts?.speedMs ?? 0;
    lastTripTargetUpdateAtRef.current = Date.now();

    let applyLat = lat;
    let applyLng = lng;
    let chaseM = 0;
    let rawToMarkerM: number | null = null;
    const tripActiveEarly = isNavigatingRef.current || isDrivingRef.current;

    // v10 SSOT: jeden feed/tick ze snapu — worklet LERP + forward prediction.
    if (V10_CLIENT_FIRST) {
      const rawLat = opts?.rawLat;
      const rawLng = opts?.rawLng;
      const roadPts = opts?.roadPts ?? drivingSnapGeometryRef.current;
      if (
        tripActiveEarly
        && !opts?.allowInstantFeed
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
          58,
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
        && !opts?.skipWorkletFeed
        && !opts?.instant
        && !opts?.skipChase
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
        if (snapMoveM < 1.5 && rawToMarkerM >= 8) {
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
        const reliableSpeedMs = (() => {
          if (speedMs != null && Number.isFinite(speedMs) && speedMs > 0) return speedMs;
          const kmh = speedKmhRef.current;
          if (kmh > 0.5) return kmh / 3.6;
          return 0;
        })();
        const prevFeed = lastWorkletFeedAnchorRef.current;
        const feedMoveM = prevFeed
          ? haversineKm(prevFeed.lat, prevFeed.lng, applyLat, applyLng) * 1000
          : Infinity;
        const smoothDurationMs = isInstant
          ? 0
          : Math.max(
            220,
            Math.min(
              reliableSpeedMs >= 4.2 ? 480 : 620,
              gpsCadenceMsRef.current || 550,
            ),
          );
        const feedSpeedMs = (() => {
          if (reliableSpeedMs > 0) return reliableSpeedMs;
          if (speedMs != null && Number.isFinite(speedMs) && speedMs > 0) return speedMs;
          if (speedKmhRef.current > 2) return speedKmhRef.current / 3.6;
          if (feedMoveM >= 1.5 && smoothDurationMs > 0) {
            return Math.min(28, feedMoveM / Math.max(0.25, smoothDurationMs / 1000));
          }
          return 0;
        })();
        tripFeedSpeedMs = feedSpeedMs;
        tripFeedMoveM = Number.isFinite(feedMoveM) ? feedMoveM : null;
        tripGlideMs = isInstant ? 0 : smoothDurationMs;
        // P0: instant tylko przy jawnym bootstrapie (snapped entry) — nigdy przy surowym GPS ticku.
        const forceInstantFeed = isInstant && !!opts?.allowInstantFeed;
        tripFeedSource = forceInstantFeed
          ? (chaseM >= 1 ? 'v10_apply_chase_instant' : 'v10_apply_trip_instant')
          : 'v10_live_cruise';
        if (forceInstantFeed) {
          logGpsTickLayer('WORKLET_FEED_INCOMING', {
            layer: 'applyTripPosition',
            lat: Number(applyLat.toFixed(6)),
            lng: Number(applyLng.toFixed(6)),
            durationMs: 0,
            speedMs: feedSpeedMs != null ? Number(feedSpeedMs.toFixed(2)) : null,
            source: chaseM >= 1 ? 'v10_apply_chase_instant' : 'v10_apply_trip_instant',
            feedMoveM: tripFeedMoveM,
            instantTeleport: true,
            rawToMarkerM,
          });
          feedSmoothPositionTarget({
            latitude: applyLat,
            longitude: applyLng,
            heading,
            durationMs: 0,
            speedMs: feedSpeedMs,
            source: chaseM >= 1 ? 'v10_apply_chase_instant' : 'v10_apply_trip_instant',
          });
          lastWorkletFeedAnchorRef.current = { lat: applyLat, lng: applyLng };
          lastWorkletFeedAtRef.current = Date.now();
          lastWorkletFeedSourceRef.current = chaseM >= 1 ? 'v10_apply_chase_instant' : 'v10_apply_trip_instant';
        } else {
          logGpsTickLayer('WORKLET_FEED_INCOMING', {
            layer: 'applyTripPosition',
            lat: Number(applyLat.toFixed(6)),
            lng: Number(applyLng.toFixed(6)),
            durationMs: smoothDurationMs,
            speedMs: feedSpeedMs != null ? Number(feedSpeedMs.toFixed(2)) : null,
            source: tripFeedSource,
            feedMoveM: tripFeedMoveM,
            instantTeleport: false,
            rawToMarkerM,
          });
          feedWorkletAnchorsAlongRoad(
            applyLat,
            applyLng,
            heading,
            feedSpeedMs,
            smoothDurationMs,
            'v10_live_cruise',
          );
        }
        markerProjRef.current = {
          lat: applyLat,
          lng: applyLng,
          hdg: heading,
          speedMs: feedSpeedMs,
          at: Date.now(),
        };
        emitSpeedometerKmh(Math.max(0, speedKmhRef.current));
        // Kamera: subscribeSmoothPositionDisplay (worklet 60 FPS) — nie GPS snap (skoki co fix).
      }
      publishUserLocation(
        { latitude: applyLat, longitude: applyLng },
        opts?.forcePublish ?? false,
      );
      currentLocRef.current = { latitude: applyLat, longitude: applyLng };
      lastBumpActiveMarkerAtRef.current = Date.now();
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
  }, [bumpActiveMarker, publishUserLocation, clearSubAnchorTimers, feedWorkletAnchorsAlongRoad]);

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
  ): Promise<{ latitude: number; longitude: number; source: 'route' | 'sqlite' | 'tile' } | null> => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    // L1: NAV route polyline
    if (isNavigatingRef.current && routePointsRef.current.length >= 2) {
      const s = snapToRoute(lat, lng, routePointsRef.current, NAV_ROUTE_SNAP_M);
      const distM = haversineKm(lat, lng, s.latitude, s.longitude) * 1000;
      if (distM <= NAV_ROUTE_SNAP_M) {
        return { latitude: s.latitude, longitude: s.longitude, source: 'route' };
      }
    }

    // L2: SQLite cache
    try {
      const cached = await roadGeometryStore.findNearest(lat, lng, 120);
      if (cached && Array.isArray(cached.points) && cached.points.length >= 2) {
        const s = snapToRoute(lat, lng, cached.points, 35);
        const distM = haversineKm(lat, lng, s.latitude, s.longitude) * 1000;
        if (distM <= 30 && validateGeometryAgainstRaw(cached.points, lat, lng, 35)) {
          return { latitude: s.latitude, longitude: s.longitude, source: 'sqlite' };
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
            return { latitude: s.latitude, longitude: s.longitude, source: 'tile' };
          }
        }
      }
    } catch {
      /* ignore */
    }

    return null;
  }, []);

  const publishHeading = useCallback((hdg: number) => {
    lastHeadingRef.current = hdg;
    const active = isNavigatingRef.current || isDrivingRef.current;
    if (active) {
      // Trip marker/camera read heading from refs/shared values; React state would re-render the whole map.
      lastHeadingUiRef.current = hdg;
      return;
    }
    lastHeadingUiRef.current = hdg;
    setHeading(hdg);
  }, []);

  const pushGpsDebugFix = useCallback((entry: {
    lat: number;
    lng: number;
    acc: number;
    speedKmh: number;
    accepted: boolean;
    reason: string;
  }) => {
    if (
      !entry.accepted
      || entry.reason.includes('clamped')
      || entry.reason.includes('hard_reject')
      || entry.reason.includes('non_finite')
      || entry.reason.includes('stale_timestamp')
    ) {
      queueMapDiagnostic('gps_fix', {
        accepted: entry.accepted,
        reason: entry.reason,
        lat: Number(entry.lat.toFixed(6)),
        lng: Number(entry.lng.toFixed(6)),
        accM: Math.round(entry.acc),
        speedKmh: Math.round(entry.speedKmh),
      }, { immediate: !entry.accepted });
    }
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
  }, [queueMapDiagnostic]);

  // ── BUILD FINGERPRINT ─────────────────────────────────────────────────────
  // Loguje przy każdym mount mapy konkretną wersję patchy. Patrz na pierwszy
  // wpis w telemetrii — jeśli go nie ma, kod NIE doleciał do urządzenia
  // (problem w `eas update` / cache / kanał) i żadne zmiany w kodzie nie
  // zadziałają, bo telefon ich nie widzi.
  useEffect(() => {
    vroomGpsLog('BUILD_FINGERPRINT', {
      version: 'v10.24-marker-live-from-apply-trip-2026-05-23',
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
      },
    }, 0);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      void flushMapDiagnostics();
    }, MAP_DIAG_FLUSH_MS);
    return () => clearInterval(id);
  }, [flushMapDiagnostics]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      mapDiagAppStateRef.current = next;
      if (next === 'background' || next === 'inactive') {
        void flushMapDiagnostics({ force: true });
      }
    });
    return () => sub.remove();
  }, [flushMapDiagnostics]);

  useEffect(() => {
    return () => {
      void flushMapDiagnostics({ force: true });
    };
  }, [flushMapDiagnostics]);

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
  const [mapFabModalVisible, setMapFabModalVisible] = useState(false);
  const isMapFocusedRef = useRef(true);
  const [isMapFocused, setIsMapFocused] = useState(true);
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
  const [nearbyUsers,        setNearbyUsers]        = useState<User[]>([]);
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
  const [fuelAddMode, setFuelAddMode] = useState(false);
  const [addFuelStationVisible, setAddFuelStationVisible] = useState(false);
  const [addFuelStationCoords, setAddFuelStationCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const { stations: fuelStations, updatePrices: updateFuelPrices, refetch: refetchFuelStations, onLocationChange: onFuelLocationChange, createStation: createFuelStation } = useFuelStations(userLocation);
  const { pois: partnerPois } = usePartnerPois(userLocation);
  // ── State – live / ostrzeżenia ────────────────────────────
  const [isSharing,           setIsSharing]           = useState(false);
  const isSharingRef          = useRef(false);
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
  const [currentZoom,  setCurrentZoom]  = useState(14);

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
  const mapStyle =
    mapType === 'satellite' ? MAPBOX_STYLE_SATELLITE :
    mapType === 'hybrid'    ? MAPBOX_STYLE_HYBRID :
    isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;
  const enableThreeDScene = mapType !== 'satellite';
  const isTripActiveMap = isNavigating || isDriving;
  const tripCameraPadding = useMemo(
    () => (isTripActiveMap ? getTripCameraPadding(isNavigating) : undefined),
    [isTripActiveMap, isNavigating],
  );
  /** Worklet 60fps — hook na MapScreen, zeby handler byl zarejestrowany PRZED feedem z GPS. */
  const tripSmoothPosition = useSmoothMapPosition(isTripActiveMap);

  useEffect(() => () => {
    subAnchorTimersRef.current.forEach((t) => clearTimeout(t));
    subAnchorTimersRef.current = [];
  }, []);

  /** Tło iOS: useFrameCallback staje — projekcja markera z JS co 100ms. */
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
      }, 100);
    };

    syncBgMarkerTick();
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
      syncBgMarkerTick();
    });
    return () => {
      sub.remove();
      stopBgMarkerTick();
    };
  }, [isTripActiveMap]);

  const showThreeDBuildings = enableThreeDScene && currentZoom >= BUILDINGS_3D_MIN_ZOOM && !isTripActiveMap;
  const showTerrainLayers = showThreeDBuildings;

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
  const {
    addPosition: addMatchPosition,
    getMatchedPoints,
    reset: resetMapMatch,
    forceMatch: forceMapMatch,
    bumpMatchedFreshness,
  } = useDrivingMapMatch();
  const forceMatchInflightRef = useRef(false);
  const forceMatchGuardRef = useRef({
    manualAt: 0,
    manualLat: 0,
    manualLng: 0,
    refreshAt: 0,
    refreshLat: 0,
    refreshLng: 0,
  });

  const guardedForceMapMatch = useCallback(async (
    lat: number,
    lng: number,
    opts?: { manual?: boolean; refresh?: boolean; forceImmediate?: boolean; speedKmh?: number },
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return getMatchedPoints();

    // Postój: blokuj tylko okresowe refresh/recovery — nie ręczne wejście w jazdę.
    if (!opts?.manual && !opts?.forceImmediate) {
      const speedKmh = opts?.speedKmh;
      if (speedKmh != null && speedKmh < DRIVING_ENTRY_STATIONARY_KMH) {
        return getMatchedPoints();
      }
    }

    const now = Date.now();
    const manual = !!opts?.manual;
    const forceImmediate = !!opts?.forceImmediate;
    const guard = forceMatchGuardRef.current;
    const lastAt = manual ? guard.manualAt : guard.refreshAt;
    const lastLat = manual ? guard.manualLat : guard.refreshLat;
    const lastLng = manual ? guard.manualLng : guard.refreshLng;
    const movedM = lastAt > 0 ? haversineKm(lastLat, lastLng, lat, lng) * 1000 : Infinity;
    const minIntervalMs = manual ? 20_000 : 25_000;
    const minMoveM = manual ? 35 : 12;

    if (!forceImmediate && lastAt > 0 && now - lastAt < minIntervalMs && movedM < minMoveM) {
      return getMatchedPoints();
    }
    if (!forceImmediate && forceMatchInflightRef.current) {
      return getMatchedPoints();
    }

    forceMatchInflightRef.current = true;
    try {
      const matched = await forceMapMatch(lat, lng, opts);
      const doneAt = Date.now();
      if (manual) {
        guard.manualAt = doneAt;
        guard.manualLat = lat;
        guard.manualLng = lng;
      } else {
        guard.refreshAt = doneAt;
        guard.refreshLat = lat;
        guard.refreshLng = lng;
      }
      return matched;
    } finally {
      forceMatchInflightRef.current = false;
    }
  }, [forceMapMatch, getMatchedPoints]);

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
    const snap = drivingSnap(rawLat, rawLng, speedKmh, false, true, acc ?? null);
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
  }, [drivingSnap, publishUserLocation, resolveDrivingAnchor, bumpActiveMarker]);

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
    const rawForGeom = lastRawForHeadingRef.current ?? lastGoodLocRef.current;
    if (rawForGeom && V10_CLIENT_FIRST) {
      const speedForGeom = speedKmhRef.current;
      const maxGeomDistM = isDrivingRef.current || isNavigatingRef.current
        ? (speedForGeom >= 40 ? 68 : speedForGeom >= 20 ? 58 : 52)
        : 80;
      if (!validateGeometryAgainstRaw(densified, rawForGeom.lat, rawForGeom.lng, maxGeomDistM)) {
        vroomGpsLog('ROAD_MATCH_GEOM_REJECT', {
          pts: list.length,
          densePts: densified.length,
          maxGeomDistM,
          keptPrev: drivingSnapGeometryRef.current.length,
          rawLat: Number(rawForGeom.lat.toFixed(6)),
          rawLng: Number(rawForGeom.lng.toFixed(6)),
        }, 2500);
        return;
      }
    }
    const sig = `${densified.length}:${densified[0].latitude.toFixed(5)},${densified[0].longitude.toFixed(5)},${densified[densified.length - 1].latitude.toFixed(5)},${densified[densified.length - 1].longitude.toFixed(5)}`;
    if (sig === roadMatchSigRef.current) return;
    roadMatchSigRef.current = sig;
    setRoadMatchPoints(densified);
    drivingSnapGeometryRef.current = densified;
    drivingSnapUsesMatchedRef.current = true;
    roadGeometryStore.insert(list).catch(() => {});

    if (opts?.skipResync) return;

    const raw = lastRawForHeadingRef.current ?? lastGoodLocRef.current;
    if (raw && (isDrivingRef.current || isNavigatingRef.current)) {
      const stationary = speedKmhRef.current < DRIVING_ENTRY_STATIONARY_KMH;
      resyncSnapAfterRoadGeometry(raw.lat, raw.lng, speedKmhRef.current, null, {
        maxStepM: stationary ? DRIVING_ENTRY_MAX_SNAP_M : undefined,
      });
    }
  }, [setRoadMatchPoints, resyncSnapAfterRoadGeometry]);

  const {
    cameras, nearestCamera,
    updateCameras, addCamera, confirmCamera,
    checkAlert, markAlerted, invalidate, deleteCamera,
  } = useSpeedCameras();

  const { speedLimit, updateSpeedLimit } = useSpeedLimit(true);
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
    if (tripActive) {
      const nowTs = opts?.now ?? Date.now();
      const netMoveM = opts?.netMoveM ?? 0;
      const motionKmh = opts?.motionKmh ?? 0;
      const sustainedKmh = opts?.sustainedKmh ?? 0;
      const rawGpsKmh = opts?.rawGpsKmh ?? (gpsSpeedMs != null ? gpsSpeedMs * 3.6 : 0);
      const standstillNetM = tripStandstillNetM(speedKmhRef.current, motionKmh);
      let stationaryEvidence =
        rawGpsKmh < 15
        && netMoveM < standstillNetM
        && sustainedKmh < 3.5
        && motionKmh < 2.5;
      let dopplerGhostWhileStill =
        stationaryEvidence
        && rawGpsKmh >= 6
        && rawGpsKmh <= 45;

      let reliableSpeedKmh = display != null && display > 0 ? display * 3.6 : 0;
      if (rawGpsKmh >= 8) {
        stationaryEvidence = false;
        dopplerGhostWhileStill = false;
        reliableSpeedKmh = Math.max(reliableSpeedKmh, rawGpsKmh);
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
        const impossibleHud = reliableSpeedKmh > MAX_REALISTIC_DRIVING_KMH + 15;
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
          if (massiveAbsoluteJump && rawGpsKmh >= 8) {
            // P0: po lagu GPS ufamy Dopplerowi zamiast trzymać poprzednie 0.
            reliableSpeedKmh = Math.min(MAX_SPEED_HUD_KMH, rawGpsKmh);
          } else {
            reliableSpeedKmh = standstillHallucination
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
      if (dopplerTrustedEmit && rawGpsKmh >= 8 && reliableSpeedKmh < 8) {
        reliableSpeedKmh = Math.min(MAX_SPEED_HUD_KMH, rawGpsKmh);
      }
      if (
        !parkedLikeEmit
        && !dopplerTrustedEmit
        && rawGpsKmh >= 8
        && reliableSpeedKmh < 6
        && netMoveM < 18
        && opts?.lat != null
        && opts?.lng != null
      ) {
        const prevRaw = lastRawForHeadingRef.current;
        const rawStepM = prevRaw
          ? haversineKm(prevRaw.lat, prevRaw.lng, opts.lat, opts.lng) * 1000
          : Infinity;
        if (Number.isFinite(rawStepM) && rawStepM < 2.8) {
          reliableSpeedKmh = Math.min(MAX_SPEED_HUD_KMH, rawGpsKmh * 0.94);
        }
      }
      if (parkedLikeEmit && reliableSpeedKmh > 1) {
        reliableSpeedKmh = 0;
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
      const peakTrusted =
        !parkedForPeak
        && reliableSpeedKmh >= 5
        && reliableSpeedKmh <= MAX_REALISTIC_DRIVING_KMH
        && (opts?.rawGpsKmh ?? 0) < 120
        && ((opts?.netMoveM ?? 0) >= 12 || (opts?.sustainedKmh ?? 0) >= 8);
      const peakKmh = Math.min(MAX_REALISTIC_DRIVING_KMH, reliableSpeedKmh);
      if (peakTrusted && peakKmh > tripPeakSpeedRef.current) {
        tripPeakSpeedRef.current = peakKmh;
      }
      if (peakTrusted && peakKmh > liveAchSessionPeakSpeedRef.current) {
        liveAchSessionPeakSpeedRef.current = peakKmh;
      }
    }
    feedSpeedSample(display);
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
      queueMapDiagnostic('drive_health', {
        mode: isNavigatingRef.current ? 'navigation' : (isDrivingRef.current ? 'driving' : 'idle'),
        isDriving: isDrivingRef.current,
        isNavigating: isNavigatingRef.current,
        platform: Platform.OS,
        speedHudKmh: Number((speedKmhRef.current || 0).toFixed(1)),
        speedPipeKmh: Number((speedKmhRef.current || 0).toFixed(1)),
        gpsAgeMs: Number.isFinite(gpsAgeMs) ? Math.round(gpsAgeMs) : null,
        drAgeMs: Number.isFinite(drAgeMs) ? Math.round(drAgeMs) : null,
        gpsTickAgeMs: Number.isFinite(gpsTickAgeMs) ? Math.round(gpsTickAgeMs) : null,
        gpsToDriftM: gpsToDriftM != null ? Math.round(gpsToDriftM) : null,
        snapAnchorDriftM: snapAnchorDriftM != null ? Math.round(snapAnchorDriftM) : null,
      });
    }, 5000);
    return () => clearInterval(id);
  }, [isDriving, isNavigating, rerouteOrigin, queueMapDiagnostic]);

  const {
    liveUsers, warnings, connected,
    sendLocation, toggleSharing, addWarning, confirmWarning,cancelWarning,
  } = useLiveMap(
    isSharing,
    userLocation,
    isSpeechEnabled,
    settings.backgroundTracking,
    isMapFocused,
    isTripActiveMap,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Bootstrap from persisted flag so background live sharing survives app restarts.
        const persistedSharing = await AsyncStorage.getItem(BG_IS_SHARING_KEY);
        if (!cancelled && persistedSharing === 'true') {
          setIsSharing(true);
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
        if (typeof data.shareLocation === 'boolean') {
          setIsSharing(data.shareLocation);
          await AsyncStorage.setItem(BG_IS_SHARING_KEY, data.shareLocation ? 'true' : 'false');
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
    setFollowMode,
  } = useCameraAnimation(cameraRef);

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
    if (isNavigatingRef.current || isDrivingRef.current) return;
    restoreBrowseCameraAfterTrip({ animate: true });
  }, [isTripActiveMap, restoreBrowseCameraAfterTrip]);

  // v10: udostepniamy updateCameraFrame przez ref, zeby applyTripPosition
  // (zdefiniowane wczesniej w pliku) mogl wywolac kamere follow.
  useEffect(() => {
    updateCameraFrameRef.current = updateCameraFrame;
  }, [updateCameraFrame]);

  // V10: kamera z worklet display (ten sam strumień co marker) + RAF follow w useCameraAnimation.

  useEffect(() => {
    if (!isTripActiveMap) return;
    let lastCamMs = 0;
    return subscribeSmoothPositionDisplay((lat, lng, hdg) => {
      const now = Date.now();
      if (now - lastCamMs < CAM_DISPLAY_FOLLOW_MS) return;
      lastCamMs = now;
      updateCameraFrame({
        center: { latitude: lat, longitude: lng },
        heading: Number.isFinite(hdg) ? hdg : 0,
        speedKmh: speedKmhRef.current,
        isNavigating: isNavigatingRef.current,
        isDriving: isDrivingRef.current,
        timestamp: now,
      }, { fromWorkletDisplay: true });
    });
  }, [isTripActiveMap, updateCameraFrame]);

  /** Wejście w jazdę: padding HUD + marker na dole ekranu (recenter wymusza setCamera padding). */
  useEffect(() => {
    if (!isDriving || isNavigating) return;
    setFollowMode('drivingFollow');
    const lat = drLatRef.current;
    const lng = drLngRef.current;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;
    const followHeading = Number.isFinite(drHdgRef.current)
      ? drHdgRef.current
      : (Number.isFinite(lastHeadingRef.current) ? lastHeadingRef.current : 0);
    recenterTo({
      center: { latitude: lat, longitude: lng },
      heading: followHeading,
      speedKmh: speedKmhRef.current,
      active: true,
      isNavigating: false,
      entryAnim: true,
    });
    updateCameraFrame({
      center: { latitude: lat, longitude: lng },
      heading: followHeading,
      speedKmh: speedKmhRef.current,
      isNavigating: false,
      isDriving: true,
      timestamp: Date.now(),
    });
  }, [isDriving, isNavigating, setFollowMode, updateCameraFrame, recenterTo]);

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
      updateSpeedLimit(lat, lng);
    };

    if (!isMapFocused) return;

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

  useEffect(() => {
    const enabled = isDriving || isNavigating || __DEV__;
    return installRemoteDriveLogger({
      sessionId: mapDiagSessionIdRef.current,
      enabled,
    });
  }, [isDriving, isNavigating]);

  // Bootstrap worklet po wejsciu w trip — bez czekania na locationReady (marker montuje sie od razu).
  useEffect(() => {
    if (!isDriving && !isNavigating) return;
    const boot = lastSetLocRef.current ?? lastGoodLocRef.current;
    const plat = boot?.lat ?? drLatRef.current;
    const plng = boot?.lng ?? drLngRef.current;
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) return;
    if (Math.abs(plat) < 1e-6 && Math.abs(plng) < 1e-6) return;
    const kmh = speedKmhRef.current;
    feedSmoothPositionTarget({
      latitude: plat,
      longitude: plng,
      heading: drHdgRef.current,
      durationMs: 0,
      speedMs: kmh > 0.5 ? kmh / 3.6 : 0,
      source: 'driving_nav_bootstrap',
    });
  }, [isDriving, isNavigating]);

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
              && (drNoRoadStreakRef.current >= 2 || driftFromSnapM > 400)
              && reanchorNow - lastDrForceMatchAtRef.current > 8000;
            if (needsForceMatch && raw) {
              lastDrForceMatchAtRef.current = reanchorNow;
              const reqId = ++mapMatchApplySeqRef.current;
              void guardedForceMapMatch(raw.lat, raw.lng, {
                manual: true,
                forceImmediate: true,
                speedKmh: speedKmhRef.current,
              })
                .then((p: { latitude: number; longitude: number }[] | null) => {
                  if (reqId !== mapMatchApplySeqRef.current) return;
                  if (p && p.length >= 2 && isDrivingRef.current) {
                    applyRoadMatchPoints(p);
                    drNoRoadStreakRef.current = 0;
                  }
                })
                .catch(() => {});
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
        if (isDrivingRef.current && cameraLagM > 40) {
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
        updateCameraFrame({
          center: snappedPos,
          heading: camHeading,
          speedKmh: speedKmhRef.current,
          isNavigating: isNavigatingRef.current,
          isDriving: isDrivingRef.current,
          timestamp: uiNow,
        });
      }
    }, [updateCameraFrame]),
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

  const directionsStart = isNavigating
    ? null
    : isOffroadRoute                            // ← offroad = brak Google Directions
      ? null
      : (isDriving && stableStartLocation)
        ? stableStartLocation
        : startLocation;

  const { routes: alternativeRoutes, loading: previewLoading, error: previewError } = useGoogleDirectionsAlternatives(
    directionsStart,
    isNavigating ? null : (isOffroadRoute ? null : endLocation),  // ← blokuj dla offroad
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
    rerouteOrigin ? (lastHeadingRef.current as any) : undefined,
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
      const lat = latFilter.filter(rawLat, acc);
      const lng = lngFilter.filter(rawLng, acc);
      const canCommitAnchor = !approximate && acc <= GPS_INIT_MAX_ACCURACY_M;
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
    mapMatchApplySeqRef.current += 1;
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
    drivingLastLocRef.current   = null;
    lastDrivingPosRef.current   = null;
    lastRawForHeadingRef.current = null;
    if (drivingStopTimerRef.current) {
      clearTimeout(drivingStopTimerRef.current);
      drivingStopTimerRef.current = null;
    }
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
    drivingNoSnapStreakRef.current = 0;
    lastSnapSuccessAtRef.current = 0;
    lastWorkletFeedAnchorRef.current = null;
    subAnchorTimersRef.current.forEach((t) => clearTimeout(t));
    subAnchorTimersRef.current = [];
    lastDrivingNoSnapForceRef.current = 0;
    lastDrivingSoftRefreshRef.current = null;
    lastDrivingRecoverMatchRef.current = null;
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
        maxSpeedKmh: finalStats.maxSpeedKmh,
        avgSpeedKmh: finalStats.avgSpeedKmh,
        durationSec: finalStats.elapsedSec,
        routePoints: finalStats.trackedPoints,
      }, 'driving');
      if (DRIVE_TEST_DIAGNOSTICS) {
        console.log('[RUNDIAG] DRIVING_FLUSH', JSON.stringify({
          at: Date.now(),
          reason: 'manual_exit',
          distanceKm: Number(finalStats.distanceKm.toFixed(3)),
          maxSpeedKmh: finalStats.maxSpeedKmh,
          avgSpeedKmh: finalStats.avgSpeedKmh,
          elapsedSec: finalStats.elapsedSec,
          routePoints: finalStats.trackedPoints.length,
        }));
      }
    }
    tripCheckpointSavedKmRef.current = 0;
    tripMoveSamplesRef.current = [];
    speedKmhRef.current = 0;
    setSpeed(null);
    clearStats();
    tripPeakSpeedRef.current = 0;
    console.log('[DrivingMode] Exited driving mode', JSON.stringify({
      reason: opts?.reason ?? 'unspecified',
      skipFlush: !!opts?.skipFlush,
    }));
  }, [stopDR, resetDRRefs, resetSnap, resetMapMatch, applyRoadMatchPoints, flushPendingKm, clearStats, finishTrip, checkLiveAchievements]);

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
      tripResumeFreezeUntilRef.current = 0;
      tripResumeAnchorRef.current = null;
      tripResumeConfirmRef.current = null;
      drivingNoSnapStreakRef.current = 0;
      lastDrivingNoSnapForceRef.current = 0;
      lastDrivingSoftRefreshRef.current = null;
      lastDrivingRecoverMatchRef.current = null;

      let instantRoad = getMatchedPoints();
      if (!instantRoad || instantRoad.length < 2) {
        try {
          const sqliteHit = await roadGeometryStore.findNearest(
            startLat,
            startLng,
            DRIVING_ENTRY_SQLITE_RADIUS_M,
          );
          if (sqliteHit?.points.length >= 2) instantRoad = sqliteHit.points;
        } catch {
          /* ignore */
        }
      }

      const previewPts = routePointsRef.current;
      const entryReqId = ++mapMatchApplySeqRef.current;
      try {
        const apiRoad = await Promise.race([
          guardedForceMapMatch(startLat, startLng, {
            manual: true,
            forceImmediate: true,
            speedKmh: speedKmhRef.current,
          }),
          new Promise<{ latitude: number; longitude: number }[] | null>((resolve) => {
            setTimeout(() => resolve(null), 4500);
          }),
        ]);
        if (entryReqId === mapMatchApplySeqRef.current && apiRoad && apiRoad.length >= 2) {
          instantRoad = apiRoad;
        }
      } catch {
        /* keep sqlite / cache */
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

      const holdAnchor =
        (Number.isFinite(drLatRef.current) && Number.isFinite(drLngRef.current)
          && drLatRef.current !== 0 && drLngRef.current !== 0
          ? { latitude: drLatRef.current, longitude: drLngRef.current }
          : (lastSetLocRef.current
            ? { latitude: lastSetLocRef.current.lat, longitude: lastSetLocRef.current.lng }
            : null));

      let entryLat = holdAnchor?.latitude ?? startLat;
      let entryLng = holdAnchor?.longitude ?? startLng;
      let entryHeading = Number.isFinite(lastHeadingRef.current) ? lastHeadingRef.current : 0;

      const localSnap = drivingSnap(
        startLat,
        startLng,
        Math.max(0, speedKmhRef.current),
        false,
        true,
        rawFix?.accuracy ?? null,
      );
      if (localSnap.snapped && Number.isFinite(localSnap.latitude) && Number.isFinite(localSnap.longitude)) {
        const snapDistM = haversineKm(startLat, startLng, localSnap.latitude, localSnap.longitude) * 1000;
        if (snapDistM <= DRIVING_ENTRY_INITIAL_SNAP_M) {
          entryLat = localSnap.latitude;
          entryLng = localSnap.longitude;
          if (Number.isFinite(localSnap.targetHeading)) {
            entryHeading = localSnap.targetHeading;
          }
        }
      }
      vroomGpsLog('ENTRY_SNAP', {
        cachedRoadPts: instantRoad?.length ?? 0,
        previewPts: previewPts.length,
        localSnapped: !!localSnap.snapped,
        snapDistM: localSnap.snapped
          ? Math.round(haversineKm(startLat, startLng, localSnap.latitude, localSnap.longitude) * 1000)
          : -1,
        stationaryEntry,
        entryLat: Number(entryLat.toFixed(5)),
        entryLng: Number(entryLng.toFixed(5)),
      });

      lastForceMapMatchRef.current = { at: Date.now(), lat: startLat, lng: startLng };
      isDrivingRef.current = true;
      drivingConsecutiveRef.current = DRIVING_CONSECUTIVE_REQ;
      startTrip(Number(routeInfoRef.current?.duration) || 0);
      drivingLastLocRef.current = null;
      lastDrivingPosRef.current = { lat: entryLat, lng: entryLng };
      if (!stationaryEntry) {
        navLatFilter.reset();
        navLngFilter.reset();
        drivLatFilter.reset();
        drivLngFilter.reset();
      }

      setIsDriving(true);
      speedKmhRef.current = normalizeHudSpeedKmh(speedKmhRef.current);
      emitSpeedometerKmh(0);
      pendingDrivingEntryOneShotRef.current = false;
      drLatRef.current = entryLat;
      drLngRef.current = entryLng;
      lastSetLocRef.current = { lat: entryLat, lng: entryLng };
      drivingMarkerStallRef.current = {
        rawLat: startLat,
        rawLng: startLng,
        drLat: entryLat,
        drLng: entryLng,
        at: Date.now(),
      };
      setUserLocation({ latitude: entryLat, longitude: entryLng });
      lastGoodLocRef.current = { lat: entryLat, lng: entryLng };
      const entrySpeedMs = Math.max(
        speedKmhRef.current / 3.6,
        stationaryEntry ? 0 : 3.5,
      );
      applyTripPosition(entryLat, entryLng, {
        heading: entryHeading,
        speedMs: entrySpeedMs,
        forcePublish: true,
        instant: true,
        allowInstantFeed: true,
        commitGood: true,
      });
      recenterTo({
        center: { latitude: entryLat, longitude: entryLng },
        heading: entryHeading,
        speedKmh: Math.max(0, speedKmhRef.current),
        active: true,
        entryAnim: true,
      });
      setFollowMode('drivingFollow');
      recordDrivingTracePoint(entryLat, entryLng, { speedKmh: speedKmhRef.current }).catch(() => {});
      drivingManualEntryBusyRef.current = false;

      console.log('[DrivingMode] Manually entered — snap-first entry');
    }
  }, [isNavigating, isDriving, userLocation, exitDrivingMode, setFollowMode, recenterTo, getMatchedPoints, bumpMatchedFreshness, resetSnapState, guardedForceMapMatch, drivingSnap, startTrip, recordDrivingTracePoint, applyRoadMatchPoints, resyncSnapAfterRoadGeometry, setSnapPoints, applyTripPosition]);

  // ─────────────────────────────────────────────────────────
  // Adaptive GPS
  // ─────────────────────────────────────────────────────────
  const [gpsForceActive, setGpsForceActive] = useState(false);

  const { start: startGPS, stop: stopGPS } = useAdaptiveGPS({
    isNavigating,
    isDriving,
    isMapFocused,
    speedKmh: speedKmhRef.current,
    forceActive: gpsForceActive,
    onLocation: useCallback((loc) => {
      gpsTickCountRef.current += 1;
      const tickNow = Date.now();
      if (lastGpsTickAtRef.current > 0) {
        const cadence = tickNow - lastGpsTickAtRef.current;
        if (cadence >= 200 && cadence <= 5000) {
          // EMA smoothing 0.35 — szybko reaguje na zmiany freq,
          // ale ignoruje pojedyncze opoznienia/sleepy.
          gpsCadenceMsRef.current = Math.round(gpsCadenceMsRef.current * 0.65 + cadence * 0.35);
        }
      }
      lastGpsTickAtRef.current = tickNow;
      const rawLat0 = loc.latitude;
      const rawLng0 = loc.longitude;
      let rawLat = rawLat0;
      let rawLng = rawLng0;
      const acc    = loc.accuracy ?? 10;
      const now    = Date.now();
      const speedKmhRaw = (loc.speed != null && loc.speed >= 0) ? loc.speed * 3.6 : 0;
      if (!Number.isFinite(rawLat0) || !Number.isFinite(rawLng0) || !Number.isFinite(acc)) return;
      const prevRaw = lastRawTickRef.current;
      if (prevRaw) {
        const dtMs = now - prevRaw.at;
        const movedM = haversineKm(prevRaw.lat, prevRaw.lng, rawLat0, rawLng0) * 1000;
        const accImprovedM = prevRaw.acc - acc;
        if (
          dtMs > 0
          && dtMs < GPS_RAW_TICK_DEDUPE_MIN_MS
          && movedM < GPS_RAW_TICK_DEDUPE_MIN_MOVE_M
          && accImprovedM < GPS_RAW_TICK_DEDUPE_ACC_IMPROVE_M
        ) {
          return;
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
      const motionPrev = lastGoodLocRef.current ?? lastSetLocRef.current;
      const motionDtMs = motionPrev ? now - lastGoodTimeRef.current : 0;
      const derivedKmhRaw =
        motionPrev && motionDtMs >= 350
          ? (haversineKm(motionPrev.lat, motionPrev.lng, rawLat0, rawLng0) / (motionDtMs / 1000)) * 3600
          : 0;
      // SANITY CAP: motionKmh osiągało 168 000 km/h po skokach GPS, psując
      // SPEED_PIPE, snap-stale detection (sustainedKmh=51536), hold logic.
      // Realistyczny maks: 200 km/h driving / 250 km/h nawigacja. Wszystko
      // powyżej to artefakt skoku pozycji o setki/tysiące metrów.
      const motionCapKmh = isNavigatingRef.current
        ? MAX_REALISTIC_NAV_KMH
        : MAX_REALISTIC_DRIVING_KMH;
      const derivedKmhEarly = Number.isFinite(derivedKmhRaw)
        ? Math.min(derivedKmhRaw, motionCapKmh)
        : 0;
      let motionKmh = Math.min(
        motionCapKmh,
        Math.max(
          Math.min(speedKmhRaw, motionCapKmh),
          Number.isFinite(derivedKmhEarly) ? derivedKmhEarly : 0,
        ),
      );
      if (
        !tripActiveNow
        && isMapFocusedRef.current
        && motionKmh >= 6
        && !gpsForceActiveRef.current
      ) {
        gpsForceActiveRef.current = true;
        setGpsForceActive(true);
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
            speedKmhRaw >= 12
            || motionKmh >= 12
            || rawGpsKmhRef.current >= 12
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
          if (!isMegaTeleport && jumpM > SMOOTH_CATCH_UP_THRESHOLD_M && lastSetLocRef.current) {
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
              return;
            }
          } else {
            tripResumeMotionWakeHitsRef.current = 0;
          markerLogCritical('RESUME_FREEZE_HOLD', {
            jumpM: Math.round(jumpM),
            kmh: Math.round(speedKmhRaw),
            freezeLeftMs: tripResumeFreezeUntilRef.current - now,
          });
          return;
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
          return;
        }
        const hits = (cand?.hits ?? 1) + 1;
        if (hits < TRIP_RESUME_CONFIRM_HITS) {
          tripResumeConfirmRef.current = { lat: rawLat, lng: rawLng, hits };
          vroomGpsLog('RESUME_FREEZE_REJECT', { jumpM: Math.round(jumpM), hits });
          return;
        }
        vroomGpsLog('RESUME_FREEZE_RELEASE', { jumpM: Math.round(jumpM), hits });
        tripResumeFreezeUntilRef.current = 0;
        tripResumeAnchorRef.current = null;
        tripResumeConfirmRef.current = null;
        tripResumeMotionWakeHitsRef.current = 0;
        // Wybudzenie z tła + potwierdzony świeży klaster — teleport markera natychmiast
        // do nowej pozycji bez ślizgu (inaczej DR animowałby 300–600m w >1s i ciągnął
        // marker po cudzych ulicach). Resetujemy DR i zerujemy historię delta.
        try {
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
            if (
              isDrivingRef.current
              && speedKmhRaw < 12
              && jumpM > drivingLowSpeedJumpCapM(speedKmhRaw, acc)
            ) {
              vroomGpsLog('DRIVING_JUMP_CLAMP', {
                reason: 'sanity_speed',
                jumpM: Math.round(jumpM),
                kmh: Math.round(speedKmhRaw),
                motionKmh: Math.round(motionKmh),
                accM: Math.round(acc),
              });
            } else {
              rollbackIdleAnchor();
            }
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
        const reportedKmh = (isDrivingRef.current || isNavigatingRef.current)
          ? Math.max(reportedKmhRaw, motionKmh)
          : (!isDrivingRef.current && !isNavigatingRef.current)
            ? Math.max(reportedKmhRaw, motionKmh)
            : reportedKmhRaw;
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
        if (distM2 > maxDistM2) {
          if (activeMode) {
            if (
              isDrivingRef.current
              && reportedKmhRaw < 12
              && distM2 > drivingLowSpeedJumpCapM(reportedKmhRaw, acc)
            ) {
              // Android często zgłasza 0 km/h w ruchu — odrzucenie całego ticka
              // zostawia starą kotwicę i blokuje liczenie km w pętli.
              vroomGpsLog('DRIVING_JUMP_CLAMP', {
                reason: 'sanity_distance',
                jumpM: Math.round(distM2),
                kmh: Math.round(reportedKmhRaw),
                accM: Math.round(acc),
              });
            }
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
              reason: isDrivingRef.current && reportedKmhRaw < 12 && distM2 > drivingLowSpeedJumpCapM(reportedKmhRaw, acc)
                ? 'sanity_distance_clamped_driving'
                : 'sanity_distance_clamped',
            });
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
            if (anchorAgeMs > GPS_ANCHOR_STALE_REBASE_MS && acc <= 120) {
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

      // ══ 2. Kalman ════════════════════════════════════════════
      // Driving mode uses dedicated filters with higher process noise for faster
      // response to direction changes. Navigation uses nav-quality filters.
      // Idle uses standard (low-noise) filters.
      const useDrivingKalman = isDrivingRef.current && speedKmhRaw >= 3;
      const lat = useDrivingKalman
        ? drivLatFilter.filter(rawLat, acc)
        : isDrivingRef.current
          ? latFilter.filter(rawLat, acc)
        : isNavigatingRef.current
          ? navLatFilter.filter(rawLat, acc)
          : latFilter.filter(rawLat, acc);
      const lng = useDrivingKalman
        ? drivLngFilter.filter(rawLng, acc)
        : isDrivingRef.current
          ? lngFilter.filter(rawLng, acc)
        : isNavigatingRef.current
          ? navLngFilter.filter(rawLng, acc)
          : lngFilter.filter(rawLng, acc);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.warn('[GPS map] Kalman produced non-finite coord');
        queueMapDiagnostic('kalman_non_finite', {
          rawLat: Number(rawLat.toFixed(6)),
          rawLng: Number(rawLng.toFixed(6)),
          accM: Math.round(acc),
          mode: isNavigatingRef.current ? 'navigation' : (isDrivingRef.current ? 'driving' : 'idle'),
        }, { immediate: true });
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

      const rawGpsKmhForSpike = rawSpeedMs != null ? rawSpeedMs * 3.6 : 0;
      // iOS ghost Doppler spike guard: telefon potrafi raportowac >100 km/h
      // na postoju przy slabym fixie. Gdy ruch z geometrii (derived/sustained/net)
      // tego nie potwierdza, ignorujemy doppler dla sanitizera.
      const likelyGhostHighSpeed =
        tripActiveNow
        && rawGpsKmhForSpike >= 22
        && rawGpsKmhForSpike <= 58
        && derivedKmhEarly < 12
        && sustainedKmh < 6
        && netMoveM < 18;
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
      });
      lastSpeedRawAnchorRef.current = { lat: rawLat, lng: rawLng, at: now };
      let kmh = sanitizedSpeedMs != null ? sanitizedSpeedMs * 3.6 : 0;
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
        && motionKmh < 5
        && sustainedKmh < 4.5
        && netMoveM < 12;
      const rawStepParkM = lastRawForHeadingRef.current
        ? haversineKm(
          lastRawForHeadingRef.current.lat,
          lastRawForHeadingRef.current.lng,
          rawLat,
          rawLng,
        ) * 1000
        : Infinity;
      const coordsFrozenDrivingTick =
        Number.isFinite(rawStepParkM)
        && rawStepParkM < 2.8
        && rawGpsKmhForSpike >= 12;
      const parkedLikeNow = isParkedLikeTripEvidence({
        netMoveM,
        sustainedKmh,
        motionKmh,
        pathMoveM,
        rawGpsKmh: rawGpsKmhForSpike,
        coordsFrozenDriving: coordsFrozenDrivingTick,
      });
      const trustDopplerInTrip = tripActiveNow && trustDopplerInTripEvidence({
        netMoveM,
        sustainedKmh,
        motionKmh,
        pathMoveM,
        rawGpsKmh: rawGpsKmhForSpike,
      });
      if (
        !trustDopplerInTrip
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
        && tripActiveNow
        && rawGpsKmhForSpike >= 25
        && rawGpsKmhForSpike <= 55
        && kmh >= 22
        && (kmh - prevReliableKmh) >= 18
        && sustainedKmh < 6
        && netMoveM < 18;
      if (abruptGhostJump) {
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
      if (
        tripActiveNow
        && sanitizedSpeedMs == null
        && (motionKmh >= 6 || netMoveM >= 6 || sustainedKmh >= 3)
        && lastReliableSpeedMsRef.current != null
      ) {
        speedSignalHoldUntilRef.current = Math.max(
          speedSignalHoldUntilRef.current,
          now + 1400,
        );
      }
      const holdActive = Date.now() < speedSignalHoldUntilRef.current;
      if (
        tripActiveNow
        && holdActive
        && sanitizedSpeedMs == null
        && trustDopplerInTrip
        && rawGpsKmhForSpike >= 15
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
        && netMoveM >= 14
        && (motionKmh >= 10 || sustainedKmh >= 6)
      ) {
        const recoveredKmh = Math.min(
          MAX_REALISTIC_DRIVING_KMH,
          Math.max(
            kmh,
            motionKmh * 0.78,
            sustainedKmh * 0.92,
            6,
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
      if (trustDopplerInTrip && kmh < 8) {
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
      if (trustDopplerInTrip && kmh < 8) {
        kmh = Math.min(MAX_REALISTIC_DRIVING_KMH, rawGpsKmhForSpike);
        sanitizedSpeedMs = kmh / 3.6;
      }
      if (parkedLikeNow && tripActiveNow) {
        kmh = 0;
        sanitizedSpeedMs = 0;
        speedSignalHoldUntilRef.current = 0;
        lastReliableSpeedMsRef.current = null;
      } else if (
        tripActiveNow
        && coordsFrozenDrivingTick
        && rawGpsKmhForSpike >= 8
        && kmh < 6
        && netMoveM < 18
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
      speedKmhRef.current = kmh;
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
            setGpsForceActive(true);
          }
        } else if (
          !isDrivingRef.current
          && !isNavigatingRef.current
          && drivingConsecutiveRef.current === 0
          && gpsForceActiveRef.current
        ) {
          gpsForceActiveRef.current = false;
          setGpsForceActive(false);
        }

        const matchedPts = getMatchedPoints();
        const noRoad = !matchedPts || matchedPts.length < 2;
        if (matchedPts && matchedPts.length > 1) {
          applyRoadMatchPoints(matchedPts);
          if (isDrivingRef.current) bumpMatchedFreshness();
        } else if (isDrivingRef.current && noRoad) {
          const nowSqlite = Date.now();
          if (nowSqlite - lastDrivingSqliteRecoverRef.current >= 5_000) {
            lastDrivingSqliteRecoverRef.current = nowSqlite;
            void roadGeometryStore.findNearest(lat, lng, 150).then((hit) => {
              if (!isDrivingRef.current || !hit || hit.points.length < 2) return;
              vroomGpsLog('SQLITE_RECOVER', { pts: hit.points.length, ageMs: hit.ageMs });
              applyRoadMatchPoints(hit.points);
              bumpMatchedFreshness();
            }).catch(() => {});
          }
        } else if (
          !isDrivingRef.current
          && movingForDriving
          && drivingConsecutiveRef.current === 1
        ) {
          if (kmh >= DRIVING_ENTRY_STATIONARY_KMH) {
            const reqId = ++mapMatchApplySeqRef.current;
            void guardedForceMapMatch(lat, lng, { refresh: true, speedKmh: kmh })
              .then((p) => {
                if (reqId !== mapMatchApplySeqRef.current) return;
                if (p && p.length >= 2) applyRoadMatchPoints(p);
              })
              .catch(() => {});
          }
        }

        // Feed map matching only in confirmed driving mode.
        // Before driving starts, route snapping falls back to route geometry/raw GPS.
        const accStrict = (loc.accuracy ?? 999) <= 48;
        const accRelaxedDriving = (loc.accuracy ?? 999) <= 100;
        const accForMatch = isDrivingRef.current ? accRelaxedDriving : accStrict;
        const feedMoveOk =
          noRoad && isDrivingRef.current ? movedForSnap >= 1.5 : movedForSnap >= 6;
        const feedSpeedOk =
          noRoad && isDrivingRef.current
            ? motionKmh >= 1 || movedForSnap >= 8
            : motionKmh >= 3 || sustainedKmh >= 3 || movedForSnap >= 22;
        if (
          isDrivingRef.current
          && accForMatch
          && feedMoveOk
          && feedSpeedOk
          && (kmh >= DRIVING_ENTRY_STATIONARY_KMH || noRoad)
        ) {
          const roadPtsFeed = drivingSnapGeometryRef.current.length;
          const markerRawDriftM = lastSetLocRef.current
            ? haversineKm(rawLat, rawLng, lastSetLocRef.current.lat, lastSetLocRef.current.lng) * 1000
            : 0;
          const staleSnapHint =
            (snapAnchorStaleRef.current?.streak ?? 0) >= 2
            || roadPtsFeed < 8
            || markerRawDriftM >= 28;
          void addMatchPosition(lat, lng, {
            speedKmh: Math.max(kmh, motionKmh, sustainedKmh),
            accuracyM: loc.accuracy ?? null,
            noRoad,
            staleSnap: staleSnapHint,
          });
        }

        // Driving: odświeżenie osi drogi (force) + recovery gdy segment wygasł / API milczy.
        const nowMatch = Date.now();
        if (isDrivingRef.current && accForMatch && motionKmh >= DRIVING_ENTRY_STATIONARY_KMH) {
          if (noRoad) {
            const lr = lastDrivingRecoverMatchRef.current;
            const movedRec = lr ? haversineKm(lr.lat, lr.lng, lat, lng) * 1000 : Infinity;
            const gapOk = !lr || nowMatch - lr.at > NO_ROAD_FORCE_MATCH_MIN_GAP_MS;
            const movedOk =
              movedForSnap >= NO_ROAD_FORCE_MATCH_MIN_MOVE_M
              && movedRec >= NO_ROAD_FORCE_MATCH_MIN_REC_M;
            if (gapOk && movedOk) {
              lastDrivingRecoverMatchRef.current = { at: nowMatch, lat, lng };
              vroomGpsLog('FORCE_MATCH_NO_ROAD', { kmh: Math.round(motionKmh), accM: loc.accuracy != null ? Math.round(loc.accuracy) : null });
              const reqId = ++mapMatchApplySeqRef.current;
              void guardedForceMapMatch(lat, lng, { refresh: true, speedKmh: kmh })
                .then((p) => {
                  if (reqId !== mapMatchApplySeqRef.current) return;
                  if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                })
                .catch(() => {});
            }
          } else {
            const roadPtsSparse = drivingSnapGeometryRef.current.length;
            const rawToSnapForSparse = lastSetLocRef.current
              ? haversineKm(rawLat, rawLng, lastSetLocRef.current.lat, lastSetLocRef.current.lng) * 1000
              : 0;
            const sparseCooldownMs = rawToSnapForSparse > 25 ? 6_000 : 12_000;
            if (
              roadPtsSparse > 0
              && roadPtsSparse < 8
              && kmh >= 15
              && nowMatch - (lastDrivingSoftRefreshRef.current?.at ?? 0) >= sparseCooldownMs
            ) {
              lastDrivingSoftRefreshRef.current = { at: nowMatch, lat, lng };
              const reqSparse = ++mapMatchApplySeqRef.current;
              vroomGpsLog('FORCE_MATCH_SPARSE_GEOM', { roadPts: roadPtsSparse, kmh: Math.round(kmh) });
              void guardedForceMapMatch(lat, lng, {
                manual: true,
                forceImmediate: true,
                speedKmh: kmh,
              })
                .then((p) => {
                  if (reqSparse !== mapMatchApplySeqRef.current) return;
                  if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                })
                .catch(() => {});
            }
            const ls = lastDrivingSoftRefreshRef.current;
            if (!ls) {
              lastDrivingSoftRefreshRef.current = { at: nowMatch, lat, lng };
            } else {
              const movedSoft = haversineKm(ls.lat, ls.lng, lat, lng) * 1000;
              if (movedSoft >= 180 && nowMatch - ls.at >= 180_000) {
                lastDrivingSoftRefreshRef.current = { at: nowMatch, lat, lng };
                const reqId = ++mapMatchApplySeqRef.current;
                void guardedForceMapMatch(lat, lng, { refresh: true, speedKmh: kmh })
                  .then((p) => {
                    if (reqId !== mapMatchApplySeqRef.current) return;
                    if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                  })
                  .catch(() => {});
              }
            }
          }
        }

        // Twardy snap: zawsze przy aktywnym driving; przed auto-wejściem — ostatnia seria ticków.
        const hardRoadSnap =
          isDrivingRef.current
          || drivingManualModeRef.current
          || (
            movingForDriving
            && drivingConsecutiveRef.current >= DRIVING_CONSECUTIVE_REQ - 1
            && !drivingManuallyDisabledRef.current
          );

        const snapSpeedKmh = Math.max(
          kmh,
          rawGpsKmhForSpike >= 15 ? rawGpsKmhForSpike * 0.85 : 0,
        );
        const snapped = drivingSnap(
          lat,
          lng,
          snapSpeedKmh,
          false,
          hardRoadSnap,
          loc.accuracy ?? null,
          rawGpsKmhForSpike,
        );
        const rawToSnapAfterSnapM = haversineKm(rawLat, rawLng, snapped.latitude, snapped.longitude) * 1000;
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
          const hardRescueDue =
            snapped.snapped
            && rawToSnapM >= SNAP_STALE_HARD_RESET_M
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
            const geometryStale = rawToSnapM > SNAP_STALE_HARD_RESET_M;
            vroomGpsLog('SNAP_STALE_ANCHOR', {
              streak: snapAnchorStaleRef.current?.streak ?? 1,
              rawToSnapM: Math.round(rawToSnapM),
              kmh: Math.round(kmh),
              motionKmh: Math.round(Math.min(motionKmh, 9999)),
              sustainedKmh: Math.round(Math.min(sustainedKmh, 9999)),
              snapLat: Number(snapped.latitude.toFixed(5)),
              snapLng: Number(snapped.longitude.toFixed(5)),
              hardRescue: hardRescueDue,
              geometryReset: geometryStale,
            }, 0);
            if (geometryStale) {
              // Wyczyść geometrię (drivingSnap padnie do raw fallback) i
              // wewnątrz drivingSnap resetuje się też lastSnappedRef (przez
              // hard guard MAX_SNAP_TO_RAW_DISTANCE_M / HARD_SNAP_DROP_M).
              applyRoadMatchPoints([], { skipResync: true });
              // ANALIZA mph9uzxa: w incydencie 18:49:00-06 marker zrobił 3 widoczne
              // skoki 100-141 m bo `feedDR(raw)` ściągał DR od razu do raw.
              // Fix: dochodzimy do raw KROKIEM (max 35 m), marker w kolejnych 3-4
              // klatkach (1-2 s) płynnie wraca na drogę zamiast teleportować.
              const rescueFrom = lastSetLocRef.current ?? { lat: rawLat, lng: rawLng };
              // v9: SNAP_RESCUE_MAX_STEP_M=15 zamiast DR_REANCHOR_MAX_HARD_STEP_M=35.
              // Marker w 2-3 ramki dotrze do raw zamiast 1× teleport 35m.
              const rescueTarget = clampCoordStep(
                { latitude: rescueFrom.lat, longitude: rescueFrom.lng },
                { latitude: rawLat, longitude: rawLng },
                SNAP_RESCUE_MAX_STEP_M,
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
              resyncSnapAfterRoadGeometry(rawLat, rawLng, kmh, loc.accuracy ?? null, { maxStepM: 18 });
            }
            const reqId = ++mapMatchApplySeqRef.current;
            const rescueSpeedKmh = Math.max(
              kmh,
              Math.min(motionKmh, MAX_REALISTIC_DRIVING_KMH),
              Math.min(sustainedKmh, MAX_REALISTIC_DRIVING_KMH),
            );
            void guardedForceMapMatch(rawLat, rawLng, {
              manual: true,
              forceImmediate: true,
              speedKmh: rescueSpeedKmh,
            })
              .then((p: { latitude: number; longitude: number }[] | null) => {
                if (reqId !== mapMatchApplySeqRef.current) return;
                if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
              })
              .catch(() => {});
            // ANALIZA mph9uzxa: po hardRescue interval_gate w useDrivingMapMatch
            // blokuje kolejne requesty na 30 s. Jeden incydent = jedna szansa na
            // pobranie nowej geometrii. Wymuszam drugą próbę po 1.5 s — wtedy
            // staleSnap=true (drivingSnap zwróci snapped=false po hard guard),
            // co odpala bypass w useDrivingMapMatch.STALE_SNAP_BURST.
            setTimeout(() => {
              if (!isDrivingRef.current) return;
              const raw2 = lastRawForHeadingRef.current;
              if (!raw2 || !Number.isFinite(raw2.lat) || !Number.isFinite(raw2.lng)) return;
              const roadPtsNow = drivingSnapGeometryRef.current;
              const lastSnapNow = lastSetLocRef.current;
              const stillStale =
                roadPtsNow.length < 2
                || !lastSnapNow
                || haversineKm(raw2.lat, raw2.lng, lastSnapNow.lat, lastSnapNow.lng) * 1000 > 100;
              if (!stillStale) return;
              const reqId2 = ++mapMatchApplySeqRef.current;
              vroomGpsLog('SNAP_STALE_ANCHOR_RETRY', {
                rawLat: Number(raw2.lat.toFixed(5)),
                rawLng: Number(raw2.lng.toFixed(5)),
                roadPts: roadPtsNow.length,
              }, 0);
              void guardedForceMapMatch(raw2.lat, raw2.lng, {
                manual: true,
                forceImmediate: true,
                speedKmh: rescueSpeedKmh,
              })
                .then((p: { latitude: number; longitude: number }[] | null) => {
                  if (reqId2 !== mapMatchApplySeqRef.current) return;
                  if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                })
                .catch(() => {});
            }, 1500);
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
          queueMapDiagnostic('driving_snap_non_finite', {
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
            speedKmh: Math.round(kmh),
            hardRoadSnap,
            accM: loc.accuracy != null ? Math.round(loc.accuracy) : null,
          }, { immediate: true });
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
                snapLifecycleStage = 'snap_fail_no_hold_raw_leak';
                appliedSnap = {
                  ...snapped,
                  latitude: lat,
                  longitude: lng,
                  snapped: false,
                };
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
                  const c = clampCoordStep(
                    { latitude: hold.lat, longitude: hold.lng },
                    { latitude: lat, longitude: lng },
                    25,
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
              } else if (rawDistM <= 100) {
                // Lekki blend w stronę GPS tylko gdy blisko drogi — nie ciągnij markera „po polu”.
                const blend = Math.min(1, rawDistM / 70) * 0.25;
                appliedSnap = {
                  ...snapped,
                  latitude: anchor.latitude + (lat - anchor.latitude) * blend,
                  longitude: anchor.longitude + (lng - anchor.longitude) * blend,
                  snapped: true,
                };
              } else {
                const maxStepM = Math.min(45, Math.max(10, (kmh / 3.6) * 1.1));
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
        } else if (hardRoadSnap && snapped.snapped && lastSetLocRef.current) {
          const jumpM = haversineKm(
            lastSetLocRef.current.lat, lastSetLocRef.current.lng,
            snapped.latitude, snapped.longitude,
          ) * 1000;
          const maxJumpM = parkedLikeNow
            ? 3
            : V10_CLIENT_FIRST && isDrivingRef.current
              ? (kmh < 8 ? 6 : 20)
              : isDrivingRef.current
                ? 42
                : 28;
          if (jumpM > maxJumpM) {
            const roadPts = drivingSnapGeometryRef.current;
            const stepCap = Math.min(
              jumpM,
              Math.max(5, Math.min(kmh >= 55 ? 18 : 14, kmh * 0.22 + 6)),
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
              kmh >= 35 ? 62 : 52,
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
          queueMapDiagnostic('driving_snap_raw_fallback', {
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
            speedKmh: Math.round(kmh),
            noRoad,
            hardRoadSnap,
            isDriving: isDrivingRef.current,
            isNavigating: isNavigatingRef.current,
            accM: loc.accuracy != null ? Math.round(loc.accuracy) : null,
          });
        } else if (hardRoadSnap && !snapped.snapped) {
          if (snapLifecycleStage === 'snap_miss') {
            snapLifecycleStage = 'snap_fail_held_anchor';
          }
          vroomGpsLog('SNAP_FAIL_HELD_ANCHOR', {
            speedKmh: Math.round(kmh),
            appliedSnapped: appliedSnap.snapped,
          }, 2000);
        }
        const appliedToRawM = haversineKm(appliedSnap.latitude, appliedSnap.longitude, rawLat, rawLng) * 1000;
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
          rawOffRoadLeak: appliedToRawM < 4 && !snapped.snapped,
          roadPts: drivingSnapGeometryRef.current.length,
          isDriving: isDrivingRef.current,
        });
        if (hardRoadSnap && !snapped.snapped) {
          drivingNoSnapStreakRef.current += 1;
          if (accForMatch && kmh >= DRIVING_ENTRY_STATIONARY_KMH) {
            const nowNoSnap = Date.now();
            // v10.8: szybszy odzysk geometrii w v10 (2 fails + 15s zamiast 4 fails + 45s).
            // Analiza logow 1741: 304 snap_raw_fallback w 30s — czekanie 45s na
            // refresh API powoduje ze przez minute marker pokazuje stara pozycje.
            const recoverStreak = V10_CLIENT_FIRST ? 2 : FORCE_MAP_MATCH_RECOVER_STREAK;
            const recoverIntervalMs = V10_CLIENT_FIRST
              ? 15_000
              : FORCE_MAP_MATCH_RECOVER_MIN_INTERVAL_MS;
            const useManualRecover =
              drivingNoSnapStreakRef.current >= recoverStreak
              && (nowNoSnap - lastDrivingNoSnapForceRef.current) >= recoverIntervalMs;
            if (useManualRecover) {
              lastDrivingNoSnapForceRef.current = nowNoSnap;
            }
            gpsTelemetryRef.current.snapRecoveryCalls += 1;
            const reqId = ++mapMatchApplySeqRef.current;
            void guardedForceMapMatch(lat, lng, {
              ...(useManualRecover ? { manual: true } : { refresh: true }),
              speedKmh: kmh,
            })
              .then((p) => {
                if (reqId !== mapMatchApplySeqRef.current) return;
                if (p && p.length >= 2 && isDrivingRef.current) {
                  gpsTelemetryRef.current.snapRecoverySuccess += 1;
                  applyRoadMatchPoints(p);
                } else {
                  gpsTelemetryRef.current.snapRecoveryFail += 1;
                }
              })
              .catch(() => {
                gpsTelemetryRef.current.snapRecoveryFail += 1;
              });
          }
        } else if (hardRoadSnap && snapped.snapped) {
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
            recordDrivingTracePoint(appliedSnap.latitude, appliedSnap.longitude, { speedKmh: kmh }).catch(() => {});
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
          const resolved = resolveDrivingHeading(
            appliedSnap,
            lastHeadingRef.current,
            lastDrivingPosRef.current,
            loc.heading,
            kmh,
          );
          drivingHeading = resolveUnifiedHeading({
            snapHeading: resolved ?? (appliedSnap.snapped ? appliedSnap.targetHeading : null),
            movementHeading: moveHeading,
            gpsHeading: loc.heading ?? null,
            previousHeading: lastHeadingRef.current,
            speedKmh: kmh,
          });
          lastHeadingRef.current = drivingHeading;
          publishHeading(drivingHeading);
        }
        // ── Driving stationary hold — tylko przy realnym postoju (nie przy speed=0 z GPS) ──
        if (isDrivingRef.current && lastDrivingPosRef.current) {
          const anchor = lastDrivingPosRef.current;
          const movedSnapM = haversineKm(
            anchor.lat, anchor.lng,
            appliedSnap.latitude, appliedSnap.longitude,
          ) * 1000;
          const movedRawM = haversineKm(anchor.lat, anchor.lng, rawLat, rawLng) * 1000;
          const movementWake =
            rawGpsKmhForSpike >= 14
            || (motionKmh >= 6 && movedRawM >= 8)
            || sustainedKmh >= 6;
          const skipStationaryPin =
            isDrivingRef.current
            && (trustDopplerInTripEvidence({
              netMoveM,
              sustainedKmh,
              motionKmh,
              pathMoveM,
              rawGpsKmh: rawGpsKmhForSpike,
            }) || rawMovedForHeadingM >= 3);
          if (
            !V10_CLIENT_FIRST
            && !skipStationaryPin
            && !movementWake
            && movedSnapM < MIN_MOVE_M
            && movedRawM < 12
            && (parkedLikeNow || (rawGpsKmhForSpike < 14 && kmh < 8))
          ) {
            markerLogCritical('STATIONARY_HOLD', {
              movedSnapM: Math.round(movedSnapM),
              movedRawM: Math.round(movedRawM),
              kmh: Math.round(kmh),
              rawGpsKmh: Math.round(rawGpsKmhForSpike),
              accM: loc.accuracy != null ? Math.round(loc.accuracy) : null,
              anchorLat: Number(anchor.lat.toFixed(6)),
              anchorLng: Number(anchor.lng.toFixed(6)),
            });
            kmh = 0;
            sanitizedSpeedMs = 0;
            speedKmhRef.current = 0;
            appliedSnap = {
              ...appliedSnap,
              latitude: anchor.lat,
              longitude: anchor.lng,
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
          const mp = markerProjRef.current;
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
            const reqStale = ++mapMatchApplySeqRef.current;
            void guardedForceMapMatch(rawLat, rawLng, {
              manual: true,
              forceImmediate: true,
              speedKmh: kmh,
            })
              .then((p) => {
                if (reqStale !== mapMatchApplySeqRef.current) return;
                if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
              })
              .catch(() => {});
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
              const gapSpeedMs = Math.max(
                sanitizedSpeedMs ?? 0,
                speedKmhRef.current / 3.6,
                rawGpsKmhForSpike / 3.6,
              );
              applyTripPosition(appliedSnap.latitude, appliedSnap.longitude, {
                heading: drivingHeading,
                speedMs: gapSpeedMs,
                forcePublish: true,
                commitGood: false,
                rawLat,
                rawLng,
                roadPts: drivingSnapGeometryRef.current,
                parkedLike: parkedLikeNow,
                rawStepM: rawStepParkM,
              });
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
                  const reqId = ++mapMatchApplySeqRef.current;
                  void guardedForceMapMatch(rawLat, rawLng, {
                    manual: true,
                    forceImmediate: true,
                    speedKmh: Math.max(kmh, Math.min(motionKmh, MAX_REALISTIC_DRIVING_KMH)),
                  })
                    .then((p: { latitude: number; longitude: number }[] | null) => {
                      if (reqId !== mapMatchApplySeqRef.current) return;
                      if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                    })
                    .catch(() => {});
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

          if (drivingStopTimerRef.current) {
            clearTimeout(drivingStopTimerRef.current);
            drivingStopTimerRef.current = null;
          }

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

            const reSnap = drivingSnap(lat, lng, kmh, false, true, acc ?? null);
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
            lastGoodLocRef.current = { lat: entryLat, lng: entryLng };
            applyTripPosition(entryLat, entryLng, {
              heading: drivingHeading,
              speedMs: sanitizedSpeedMs ?? 0,
              forcePublish: true,
              instant: true,
              allowInstantFeed: true,
            });
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
            publishSpeed(rawSpeedMs, { sanitizedMs: sanitizedSpeedMs, ...speedPublishMeta });

            const lastForce = lastForceMapMatchRef.current;
            const movedFromLastForceM = lastForce
              ? haversineKm(lastForce.lat, lastForce.lng, lat, lng) * 1000
              : Infinity;
            const canForceMatch =
              !lastForce
              || Date.now() - lastForce.at >= FORCE_MAP_MATCH_COOLDOWN_MS
              || movedFromLastForceM >= FORCE_MAP_MATCH_MIN_MOVE_M;
            if (canForceMatch && motionKmh >= DRIVING_ENTRY_STATIONARY_KMH) {
              lastForceMapMatchRef.current = { at: Date.now(), lat, lng };
              const reqId = ++mapMatchApplySeqRef.current;
              void guardedForceMapMatch(lat, lng, {
                manual: true,
                forceImmediate: true,
                speedKmh: kmh,
              })
                .then((matchedPts) => {
                  if (reqId !== mapMatchApplySeqRef.current) return;
                  if (!matchedPts || matchedPts.length < 2 || !isDrivingRef.current) return;
                  applyRoadMatchPoints(matchedPts);
                })
                .catch((e) => console.warn('[DrivingMode] forceMapMatch:', e));
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
              if (parkedLikeNow) return 0;
              if (drInputSpeedMs > 0.08) return drInputSpeedMs;
              if (motionKmh >= 4) return motionKmh / 3.6;
              if (coordsFrozenDrivingTick && rawGpsKmhForSpike >= 6) return rawGpsKmhForSpike / 3.6;
              if (kmh >= 3) return kmh / 3.6;
              return 0;
            })();
            if (roadPtsDrive.length >= 2 && !parkedLikeNow) {
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
            const markerAnchor = lastSetLocRef.current ?? { lat: primaryLat, lng: primaryLng };
            let rawToMarkerM = haversineKm(markerAnchor.lat, markerAnchor.lng, rawLat, rawLng) * 1000;
            if (rawToMarkerM > 28 && roadPtsDrive.length >= 2) {
              const rawOnRoad = projectOntoDrivingRoad(
                rawLat,
                rawLng,
                rawLat,
                rawLng,
                roadPtsDrive,
                62,
              );
              if (rawOnRoad) {
                const catchupStepM = Math.min(22, Math.max(8, rawToMarkerM * 0.32));
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
            applyTripPosition(primaryLat, primaryLng, {
              heading: drivingHeading,
              speedMs: workletSpeedMs,
              forcePublish: false,
              commitGood: !parkedLikeNow,
              rawLat,
              rawLng,
              roadPts: roadPtsDrive,
              parkedLike: parkedLikeNow,
              rawStepM: rawStepParkM,
            });
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
          if (roadPtsSlow.length >= 2 && !parkedLikeNow) {
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
          applyTripPosition(slowLat, slowLng, {
            heading: drivingHeading,
            speedMs: slowSpeedMs,
            forcePublish: true,
            commitGood: !parkedLikeNow,
            rawLat,
            rawLng,
            roadPts: roadPtsSlow,
            parkedLike: parkedLikeNow,
            rawStepM: rawStepParkM,
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
            !movingForDriving
            && isDrivingRef.current
            && !drivingManualModeRef.current
            && !drivingStopTimerRef.current
            && !isNavigatingRef.current
          ) {
            drivingStopTimerRef.current = setTimeout(() => {
              passiveTripStartedRef.current = false;
              const finalStats = finishTrip();
              isDrivingRef.current        = false;
              drivingManualModeRef.current = false;
              drivingLastLocRef.current   = null;
              lastDrivingPosRef.current   = null;
              drivingStopTimerRef.current = null;
              // Sync userLocation to last DR position before switching marker source
              // to prevent a visible teleport when isDriving flips to false.
              if (drLatRef.current !== 0 && drLngRef.current !== 0) {
                setUserLocation({ latitude: drLatRef.current, longitude: drLngRef.current });
              }
              setIsDriving(false);
              setFollowMode('idleBrowse');
              profileTotalDistanceKmRef.current += Math.max(
                0,
                Number(finalStats.distanceKm || 0) - tripCheckpointSavedKmRef.current,
              );
              void flushPendingKm(true, {
                distanceKm: Math.max(0, Number(finalStats.distanceKm || 0) - tripCheckpointSavedKmRef.current),
                maxSpeedKmh: finalStats.maxSpeedKmh,
                avgSpeedKmh: finalStats.avgSpeedKmh,
                durationSec: finalStats.elapsedSec,
                routePoints: finalStats.trackedPoints,
              }, 'driving');
              if (DRIVE_TEST_DIAGNOSTICS) {
                console.log('[RUNDIAG] DRIVING_FLUSH', JSON.stringify({
                  at: Date.now(),
                  reason: 'auto_stop_timer',
                  distanceKm: Number(finalStats.distanceKm.toFixed(3)),
                  maxSpeedKmh: finalStats.maxSpeedKmh,
                  avgSpeedKmh: finalStats.avgSpeedKmh,
                  elapsedSec: finalStats.elapsedSec,
                  routePoints: finalStats.trackedPoints.length,
                }));
              }
              tripCheckpointSavedKmRef.current = 0;
              clearStats();
              resetSnap();
              resetMapMatch();
              drivingNoSnapStreakRef.current = 0;
              lastDrivingNoSnapForceRef.current = 0;
              applyRoadMatchPoints([]);
              console.log('[DrivingMode] Exited driving mode (stop timer fired)');
              const exitLoc = lastGoodLocRef.current;
              if (drLatRef.current !== 0 && drLngRef.current !== 0) {
                lastGoodLocRef.current = { lat: drLatRef.current, lng: drLngRef.current };
              }
              lastGoodTimeRef.current = Date.now();
              lastAcceptedFixWallClockRef.current = Date.now();
            }, DRIVING_STOP_DELAY_MS);
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
          const headingRef = loc.heading ?? lastHeadingRef.current ?? 0;
          const navHeadingRaw = segmentBearing != null
            ? alignBearingToReference(segmentBearing, headingRef)
            : headingRef;
          const navHdg = resolveUnifiedHeading({
            snapHeading: segmentBearing,
            movementHeading: navMoveHeading,
            gpsHeading: loc.heading ?? null,
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
          const navRaw = loc.heading ?? lastHeadingRef.current ?? 0;
          const navHdg = resolveUnifiedHeading({
            snapHeading: null,
            movementHeading: null,
            gpsHeading: navRaw,
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
    }, [drivingSnap, feedPosition, feedDR, startTrip, finishTrip, publishUserLocation, publishHeading, publishSpeed, setFollowMode, recenterTo, resetBrowseCamera, updateCameraFrame, addMatchPosition, getMatchedPoints, applyRoadMatchPoints, resetMapMatch, resetSnap, guardedForceMapMatch, bumpMatchedFreshness, flushPendingKm, resolveDrivingAnchor, resyncSnapAfterRoadGeometry, bumpActiveMarker, bumpMapMarker, queueMapDiagnostic, maybeClearDrivingManualDisable, applyTripPosition]),
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
      if (drivingStopTimerRef.current) clearTimeout(drivingStopTimerRef.current);
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

  const restartGPSWatcher = useCallback((reason: 'foreground' | 'focus' | 'resume') => {
    const now = Date.now();
    if (now - lastGpsRestartAtRef.current < GPS_RESTART_COOLDOWN_MS) return;
    const fixAge = now - lastAcceptedFixWallClockRef.current;
    const bgPause = lastBackgroundAtRef.current > 0 ? now - lastBackgroundAtRef.current : 0;
    const tripActive = isDrivingRef.current || isNavigatingRef.current;
    // Watcher zostaje przy życiu w tle TYLKO gdy user włączył BG tracking.
    // Wcześniej tripActive sam podtrzymywał watcher mimo wyłączonego BG —
    // co kłóciło się z zachowaniem oczekiwanym przez użytkownika (stop w tle).
    const watcherLikelyAlive =
      backgroundTrackingRef.current
      || (tripActive && appStateRef.current === 'active');
    if (
      (reason === 'focus' || reason === 'resume')
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
        fixAgeMs: Math.max(0, now - lastAcceptedFixWallClockRef.current),
        bgPauseMs: bgPause,
      }));
    }
    if (__DEV__) console.log(`[GPS] Restart watcher (${reason})`);
    // Allow a slightly larger first jump after watcher re-subscribe.
    lastGoodTimeRef.current = now - GPS_RESUME_GRACE_PERIOD_MS;
    // Avoid counting a stale pre-background anchor as the first segment after resume.
    lastNavLocRef.current = null;
    drivingLastLocRef.current = null;
    idleJumpCandidateRef.current = null;
    idleUiJumpCandidateRef.current = null;
    stillLockCandidateRef.current = null;
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
  }, [startGPS, stopGPS]);

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
          const resumeFrozen = tripResumeFreezeUntilRef.current > Date.now();
          const snapAnchor = resolveDrivingAnchor();
          const matchedPts = getMatchedPoints();
          if (matchedPts && matchedPts.length > 1) applyRoadMatchPoints(matchedPts);
          const snapped = drivingSnap(lat, lng, speedKmh, false, true, acc);
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
              const reqId = ++mapMatchApplySeqRef.current;
              void guardedForceMapMatch(lat, lng, {
                ...(useManualRecover ? { manual: true } : { refresh: true }),
                speedKmh,
              })
                .then((p) => {
                  if (reqId !== mapMatchApplySeqRef.current) return;
                  if (p && p.length >= 2 && isDrivingRef.current) {
                    gpsTelemetryRef.current.snapRecoverySuccess += 1;
                    applyRoadMatchPoints(p);
                  } else {
                    gpsTelemetryRef.current.snapRecoveryFail += 1;
                  }
                })
                .catch(() => {
                  gpsTelemetryRef.current.snapRecoveryFail += 1;
                });
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
            instant: true,
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
  }, [drivingSnap, feedPosition, guardedForceMapMatch, getMatchedPoints, applyRoadMatchPoints, publishUserLocation, persistMapLocation, resolveDrivingAnchor, applyTripPosition]);

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
    queueMapDiagnostic('gps_health_recovery', { reason, gpsAgeMs: Math.round(gpsAgeMs) }, { immediate: true });
    if (__DEV__) {
      console.log('[GPSDBG] HEALTH_RECOVERY', JSON.stringify({ at: now, reason, gpsAgeMs: Math.round(gpsAgeMs) }));
    }

    restartGPSWatcher('resume');
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
    queueMapDiagnostic,
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
      const gpsAgeMs = now - lastAcceptedFixWallClockRef.current;
      const tripActive = isDrivingRef.current || isNavigatingRef.current;

      if (drivingManuallyDisabledRef.current) {
        maybeClearDrivingManualDisable(0, now);
      }

      if (tripActive && isMapFocusedRef.current) {
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
              queueMapDiagnostic('driving_marker_stall', {
                rawMoveM: Math.round(rawMoveM),
                uiMoveM: Math.round(uiMoveM),
                drMoveM: Math.round(drMoveM),
                stallAgeMs: Math.round(stallAgeMs),
              }, { immediate: true });
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
                  instant: true,
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

        if ((gpsAgeMs >= GPS_ACTIVE_RECOVERY_STALE_MS
            || foregroundGpsIntentionallyStoppedRef.current
            || (lastGpsTickAtRef.current > 0 && now - lastGpsTickAtRef.current >= GPS_ACTIVE_RECOVERY_STALE_MS))
          && now - lastActiveRecoveryAtRef.current >= GPS_ACTIVE_RECOVERY_COOLDOWN_MS) {
          lastActiveRecoveryAtRef.current = now;
          queueMapDiagnostic('gps_active_recovery', {
            gpsAgeMs: Math.round(gpsAgeMs),
            mode: isNavigatingRef.current ? 'navigation' : 'driving',
            mapFocused: isMapFocusedRef.current,
          }, { immediate: true });
          if (__DEV__) {
            console.log('[GPSDBG] ACTIVE_RECOVERY', JSON.stringify({
              at: now,
              gpsAgeMs: Math.round(gpsAgeMs),
              mode: isNavigatingRef.current ? 'navigation' : 'driving',
            }));
          }
          restartGPSWatcher('resume');
          refreshLocationOneShot({ force: true });
        }
        return;
      }

      if (!isMapFocusedRef.current) return;

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
    queueMapDiagnostic,
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

  const handleGpsResume = useCallback((source: 'foreground' | 'focus') => {
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

    // Szybki powrót na zakładkę Mapa: nie restartuj GPS, tylko przywróć kamerę i marker.
    if (
      source === 'focus'
      && !isDrivingRef.current
      && !isNavigatingRef.current
      && locationReadyRef.current
      && lastGoodLocRef.current
      && now - lastAcceptedFixWallClockRef.current < GPS_WATCHER_STALE_MS * 4
    ) {
      const loc = currentLocRef.current ?? {
        latitude: lastGoodLocRef.current.lat,
        longitude: lastGoodLocRef.current.lng,
      };
      resetBrowseCamera(loc);
      bumpActiveMarker(loc.latitude, loc.longitude, { forcePublish: true });
      setGpsAcquiring(false);
      if (__DEV__) console.log('[GPSDBG] RESUME_SOFT_FOCUS', JSON.stringify({ at: now }));
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
    if (now - lastResumeHandledAtRef.current < GPS_RESUME_DEDUPE_MS) return;
    lastResumeHandledAtRef.current = now;
    setGpsAcquiring(false);
    console.log(`[GPS] Resume flow (${source})`);
    restartGPSWatcher('resume');
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

    // Po odblokowaniu: utrzymaj ostatnią snapped pozycję; nie resetuj DR (unika teleportu).
    if (isNavigatingRef.current || isDrivingRef.current) {
      const bgPauseMs = lastBackgroundAtRef.current > 0 ? now - lastBackgroundAtRef.current : 0;
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
        const freezeMs = V10_CLIENT_FIRST
          ? (bgPauseMs > 12_000
            ? Math.min(TRIP_RESUME_FREEZE_MAX_MS, TRIP_RESUME_FREEZE_MS + Math.round(bgPauseMs * 0.15))
            : TRIP_RESUME_FREEZE_MS)
          : Math.min(
            TRIP_RESUME_FREEZE_MAX_MS,
            Math.max(
              TRIP_RESUME_FREEZE_MS,
              bgPauseMs > 800 ? Math.min(bgPauseMs + 2000, 10_000) : TRIP_RESUME_FREEZE_MS,
            ),
          );
        tripResumeAnchorRef.current = { lat: anchorLatLng.lat, lng: anchorLatLng.lng, hdg };
        if (freezeMs > 0) {
          tripResumeFreezeUntilRef.current = now + freezeMs;
        } else {
          tripResumeFreezeUntilRef.current = 0;
        }
        tripResumeConfirmRef.current = null;
        tripResumeMotionWakeHitsRef.current = 0;
        drLatRef.current = anchorLatLng.lat;
        drLngRef.current = anchorLatLng.lng;
        lastSetLocRef.current = { lat: anchorLatLng.lat, lng: anchorLatLng.lng };
        lastGoodLocRef.current = { lat: anchorLatLng.lat, lng: anchorLatLng.lng };
        if (lastDrivingPosRef.current) {
          lastDrivingPosRef.current = { lat: anchorLatLng.lat, lng: anchorLatLng.lng };
        }
        // Resume z tła = bootstrap-like; snapuj marker ostro do anchora,
        // inaczej FIX 1 zignoruje feed worklet i marker zostanie na ostatniej
        // klatce sprzed background (może być wiele sekund/metrów stary).
        if (V10_CLIENT_FIRST) {
          applyTripPosition(anchorLatLng.lat, anchorLatLng.lng, {
            heading: hdg,
            forcePublish: true,
            instant: true,
          });
          publishUserLocation(
            { latitude: anchorLatLng.lat, longitude: anchorLatLng.lng },
            true,
          );
        } else {
          bumpActiveMarker(anchorLatLng.lat, anchorLatLng.lng, { heading: hdg, forcePublish: true, instant: true });
          feedDR({ latitude: anchorLatLng.lat, longitude: anchorLatLng.lng }, 0, hdg);
        }
        markerLogCritical('RESUME_TRIP_ANCHOR', {
          lat: Number(anchorLatLng.lat.toFixed(5)),
          lng: Number(anchorLatLng.lng.toFixed(5)),
          bgPauseMs: Math.round(bgPauseMs),
          freezeMs,
          v10: V10_CLIENT_FIRST,
          isDriving: isDrivingRef.current,
        });
        if (isDrivingRef.current) {
          const matched = getMatchedPoints();
          if (matched && matched.length > 1) {
            applyRoadMatchPoints(matched);
            bumpMatchedFreshness();
          }
          if (speedKmhRef.current >= DRIVING_ENTRY_STATIONARY_KMH) {
            const reqId = ++mapMatchApplySeqRef.current;
            void guardedForceMapMatch(anchorLatLng.lat, anchorLatLng.lng, {
              refresh: true,
              speedKmh: speedKmhRef.current,
            })
              .then((p) => {
                if (reqId !== mapMatchApplySeqRef.current || !isDrivingRef.current) return;
                if (p && p.length >= 2) {
                  applyRoadMatchPoints(p);
                  resyncSnapAfterRoadGeometry(
                    anchorLatLng.lat,
                    anchorLatLng.lng,
                    speedKmhRef.current,
                    null,
                    { maxStepM: DRIVING_ENTRY_MAX_SNAP_M },
                  );
                }
              })
              .catch(() => {});
          }
        }
      }
    }
  }, [
    restartGPSWatcher,
    refreshLocationOneShot,
    startGPS,
    ensureRegionBootstrapped,
    applyBootstrapLocation,
    feedDR,
    bumpActiveMarker,
    getMatchedPoints,
    applyRoadMatchPoints,
    bumpMatchedFreshness,
    guardedForceMapMatch,
    resyncSnapAfterRoadGeometry,
    resetBrowseCamera,
    publishUserLocation,
    applyTripPosition,
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
  const stopDRRef = useRef(stopDR);
  useEffect(() => {
    stopDRRef.current = stopDR;
  }, [stopDR]);

  // ── Restart GPS when app returns to foreground ──────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
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
      // inactive = Control Center / przejścia UI — NIE zatrzymuj GPS (inaczej marker stoi).
      if (nextState === 'inactive' && tripActive) {
        bumpMatchedFreshnessRef.current();
      }
      if (nextState === 'background') {
        lastBackgroundAtRef.current = Date.now();
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
          stopGPSRef.current();
          stopDRRef.current();
          void notifyBackgroundPremiumRequired();
        } else if (!settings.backgroundTracking) {
          // Hard rule: użytkownik wyłączył „Śledzenie w tle" w ustawieniach.
          // GPS watcher, DR i wszystko co konsumuje baterię w tle MUSI być
          // wyłączone — nawet w trybie jazdy/nawigacji. Trip stats będą
          // odtworzone z foreground gdy user wróci do aplikacji.
          stopGPSRef.current();
          stopDRRef.current();
        } else {
          // bgEnabled=true → trzymamy watcher i DR przy życiu w tle (Premium).
          if (!tripActive) {
            stopDRRef.current();
          }
        }
        if (!settings.backgroundTracking && isSharingRef.current) {
          setIsSharing(false);
          AsyncStorage.setItem(BG_IS_SHARING_KEY, 'false').catch(() => {});
        }
      }
      const resumed =
        (prevState === 'background' || prevState === 'inactive') &&
        nextState === 'active';
      if (resumed) {
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
        handleGpsResumeRef.current('foreground');
      }
    });
    return () => sub.remove();
  }, [settings.backgroundTracking]);

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
    handleGpsResumeRef.current('focus');
    return () => {
      isMapFocusedRef.current = false;
      setIsMapFocused(false);
      const keepTripOnMapBlur = isDrivingRef.current || isNavigatingRef.current;
      if (!keepTripOnMapBlur) {
        stopDRRef.current();
      }
      // GPS zostaje włączony przy zmianie zakładki — unika losowego skoku po powrocie.
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
    const now = Date.now();
    reroutePendingRef.current = false;
    reroutePendingSinceRef.current = 0;
    rerouteBlockedUntilRef.current = 0;
    rerouteGraceUntilRef.current = now + REROUTE_GRACE_AFTER_APPLY_MS;
    setNavRouteOverride(rerouteResult);
    if (rerouteResult.points?.length) {
      routePointsRef.current = rerouteResult.points;
    }
    setCurrentStep(0);
    announcedPhasesRef.current = new Set();
    lastSpokenRef.current    = '';
    offRouteSinceRef.current = 0;
    setOffRoute(false);
    setRerouteOrigin(null);
  }, [rerouteResult, offRoute, userLocation]);

  useEffect(() => {
    if (!offRoute || !reroutePendingRef.current) return;
    const pendingForMs = Date.now() - reroutePendingSinceRef.current;
    const failed = !!rerouteError || (!rerouteLoading && pendingForMs >= REROUTE_PENDING_TIMEOUT_MS);
    if (!failed) return;
    reroutePendingRef.current = false;
    reroutePendingSinceRef.current = 0;
    rerouteBlockedUntilRef.current = Date.now() + REROUTE_RETRY_AFTER_FAIL_MS;
    setRerouteOrigin(null);
  }, [offRoute, rerouteLoading, rerouteError]);

  // ── Reroute origin management (cooldown gate) ─────────────────────────────
  // Uruchamiane tylko po potwierdzonym zejściu z trasy (OFF_ROUTE_CONFIRM_MS),
  // nie na każdy krótki jitter GPS.
  useEffect(() => {
    if (!offRoute) {
      if (!reroutePendingRef.current) setRerouteOrigin(null);
      return;
    }
    if (!userLocation || !endLocation) return;
    if (reroutePendingRef.current) return;
    if (Date.now() < rerouteBlockedUntilRef.current) return;

    const now   = Date.now();
    const since = now - lastRerouteTimeRef.current;

    if (since < REROUTE_COOLDOWN_MS && lastRerouteLocRef.current) {
      const movedM = haversineKm(
        userLocation.latitude, userLocation.longitude,
        lastRerouteLocRef.current.lat, lastRerouteLocRef.current.lng,
      ) * 1000;
      if (movedM < REROUTE_MIN_MOVED_M) {
        if (DEBUG_NETWORK) console.log('[reroute] cooldown — moved', movedM.toFixed(0), 'm, since last', since, 'ms');
        return;
      }
    }

    if (DEBUG_NETWORK) console.log('[reroute] triggering new reroute request');
    reroutePendingRef.current = true;
    reroutePendingSinceRef.current = now;
    lastRerouteTimeRef.current = now;
    lastRerouteLocRef.current  = { lat: userLocation.latitude, lng: userLocation.longitude };
    setRerouteOrigin({ ...userLocation, name: 'Moja pozycja' });
  }, [offRoute, userLocation, endLocation]);

  useEffect(() => {
    if (!startIsMyLocationRef.current || !userLocation || isNavigating) return;
    // Keep the selected route anchor stable while destination preview is active.
    // Without this, tab switches can silently move "start" and produce bad reroute hints.
    if (endLocation) return;
    setStartLocation(prev => ({ ...userLocation, name: prev?.name ?? 'Moja pozycja' }));
  }, [userLocation, isNavigating, endLocation]);

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

  const nearbyUsersFromLive = useMemo(() => {
    if (!isMapFocused || !isSharing) return [];
    return liveUsers
      .filter((u) => String(u.id) !== String(currentUserId))
      .filter((u) => Number.isFinite(u.lat) && Number.isFinite(u.lng))
      .map((u) => ({
        id: String(u.id),
        name: u.username,
        latitude: u.lat,
        longitude: u.lng,
        avatar: u.avatarUrl ?? '',
        avatarFrameUrl: u.avatarFrameUrl ?? '',
        status: 'Online' as const,
        isFriend: u.isFriend ?? false,
        isPremium: u.isPremium ?? false,
      }));
  }, [liveUsers, currentUserId, isMapFocused, isSharing]);

  useEffect(() => {
    if (!isSharing) {
      setNearbyUsers([]);
      return;
    }
    setNearbyUsers(nearbyUsersFromLive);
  }, [nearbyUsersFromLive, isSharing]);

  // Bez live — zero cudzych markerów (demo wyłączone).
  useDemoUsers(
    false,
    useCallback((users) => setDemoUsers(users), []),
    userLocation?.latitude,
    userLocation?.longitude,
    1000,
  );

  // ─────────────────────────────────────────────────────────
  const visibleUsers = useMemo(() => {
    if (!isSharing || nearbyUsers.length === 0) return [];
    const anchor =
      userLocation
      ?? (
        Number.isFinite(drLatRef.current) && Number.isFinite(drLngRef.current)
        && (drLatRef.current !== 0 || drLngRef.current !== 0)
          ? { latitude: drLatRef.current, longitude: drLngRef.current }
          : null
      );
    if (!anchor) return nearbyUsers.slice(0, 48);
    // Live API już filtruje promień (~35 km); tu tylko twardy limit bezpieczeństwa.
    return nearbyUsers
      .filter((u) =>
        u.isFriend
        || calculateDistance(
          anchor.latitude, anchor.longitude,
          u.latitude, u.longitude,
        ) <= MAX_NEARBY_USERS_DISTANCE,
      )
      .slice(0, 48);
  }, [userLocation, nearbyUsers, isSharing]);

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
    setStartLocation(prev => {
      if (prev) return prev;
      if (!userLocation) return prev;
      startIsMyLocationRef.current = true;
      return { ...userLocation, name: 'Moja pozycja' };
    });
    // ── NOWE: w driving mode zablokuj dalsze aktualizacje startu ──
    startIsMyLocationRef.current = false;
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
    const storeSharing = next && settings.backgroundTracking;
    AsyncStorage.setItem(BG_IS_SHARING_KEY, storeSharing ? 'true' : 'false').catch(() => {});
  }, [toggleSharing, isSharing, settings.backgroundTracking]);

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
      recenterTo({
        center: liveCenter,
        heading: lastHeadingRef.current,
        speedKmh: speedKmhRef.current,
        active: true,
      });
      return;
    }
    resetBrowseCamera(liveCenter);
  }, [userLocation, isNavigating, isDriving, recenterTo, resetBrowseCamera, refreshLocationOneShot]);

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
        const onRoad = isOnRoute(lat, lng, points, thresholdM);
        const nowOff = Date.now();
        if (onRoad) {
          offRouteSinceRef.current = 0;
          if (offRouteRef.current) {
            offRouteRef.current = false;
            setOffRoute(false);
          }
        } else if (!reroutePendingRef.current && !inRerouteGrace) {
          if (!offRouteSinceRef.current) offRouteSinceRef.current = nowOff;
          const offForMs = nowOff - offRouteSinceRef.current;
          if (offForMs >= OFF_ROUTE_CONFIRM_MS && !offRouteRef.current) {
            offRouteRef.current = true;
            setOffRoute(true);
          }
        }
      }

      if (points.length > 1) {
        const idx = findClosestPointIndex(lat, lng, points);
        if (idx !== navRouteIdxRef.current) {
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

    exitDrivingMode({ skipFlush: true, reason: 'begin_navigation' });

    startTrip(routeInfo?.duration ?? 0);
    passiveTripStartedRef.current = true;
    navStatsFlushedRef.current = false;

    resetDRRefs();
    setFollowMode('navigationFollow');
    isNavigatingRef.current = true;

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
    if (!gpsForceActiveRef.current) {
      gpsForceActiveRef.current = true;
      setGpsForceActive(true);
    }
    startGPS();

    applyTripPosition(bootLat, bootLng, {
      heading: bootHdg,
      speedMs: Math.max(0, speedKmhRef.current) / 3.6,
      forcePublish: true,
      instant: true,
      commitGood: true,
    });

    setNavStartLoc(navStart);
    setStartLocation(navStart);
    setCurrentStep(0);
    setArrived(false);
    setOffRoute(false);
    offRouteSinceRef.current = 0;

    if (routeInfo?.duration) onNavigationStart(routeInfo.duration);
    if (pendingRouteRef.current && !approachingRouteStartRef.current) {
      startTimer(pendingRouteRef.current.id, pendingRouteRef.current.name);
      pendingRouteRef.current = null;
    }

    const startLat = userLocation.latitude;
    const startLng = userLocation.longitude;
    const startHdg = lastHeadingRef.current;
    recenterTo({
      center: { latitude: startLat, longitude: startLng },
      heading: startHdg,
      speedKmh: Math.max(speedKmhRef.current, 20),
      active: true,
    });

    speak('Nawigacja rozpoczęta. Dobrej drogi!');
  }, [userLocation, routeInfo, speak, onNavigationStart, startTimer, setFollowMode,
      recenterTo, resetDR, resetDRRefs, exitDrivingMode, activeRoute, startGPS, applyTripPosition]);

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
  const effectiveFuelStations = fuelStations;
  const effectivePartnerPois = partnerPois;

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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a' }}>
        <Text style={{ color: '#fff', fontFamily: 'Orbitron' }}>Tylko mobilne</Text>
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
    ? (Number.isFinite(drLatRef.current) && drLatRef.current !== 0
      ? drLatRef.current
      : NaN)
    : (userLocation?.latitude ?? NaN);
  const markerLng = isTripActive
    ? (Number.isFinite(drLngRef.current) && drLngRef.current !== 0
      ? drLngRef.current
      : NaN)
    : (userLocation?.longitude ?? NaN);
  const markerHdg = lastHeadingRef.current !== 0 ? lastHeadingRef.current : heading;

  // ── Czy pokazać prędkościomierz (lewy) — w trybie jazdy prędkość + limit są w górnym HUD ──
  const isRoutePreviewOpen = !isNavigating && !isBuilding && !!startLocation && !!endLocation;
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
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
        {/* Baner nad mapą (layout kolumnowy — nie zasłania wyszukiwania) */}
        <View style={{ paddingTop: insets.top, backgroundColor: '#0a0a0a' }}>
          <AdBanner BANNERID="ca-app-pub-1660420496578702/3363343740" />
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
              backgroundColor: '#111111dc',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#e3383540',
            }}
          >
            <ActivityIndicator size="small" color="#e33835" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ffffffcc', letterSpacing: 0.5 }}>
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
            backgroundColor: '#111',
            borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10,
            borderWidth: 1, borderColor: '#e3383540',
            shadowColor: '#e33835', shadowOpacity: 0.3,
            shadowOffset: { width: 0, height: 0 }, shadowRadius: 10,
            elevation: 8, zIndex: 25,
          }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#e33835' }} />
            <View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#ffffff50', letterSpacing: 2 }}>
                {timerRouteName.toUpperCase()}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: '#fff', fontWeight: '700', letterSpacing: 2 }}>
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
            const zoom = e.properties?.zoomLevel ?? 14;
            setCurrentZoom(zoom);
          }}
          onCameraChanged={(e: any) => {
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
            // Prevent false "user pan" triggers from programmatic camera frames.
            const gestureActive = Boolean(e?.gestures?.isGestureActive);
            const isUserInteraction = e?.properties?.isUserInteraction === true;
            // Android potrafi raportowac gestureActive rowniez dla programmatic
            // camera updates, co falszywie przełącza follow->userPanning i marker
            // "ucieka" poza ekran. W active trip wymagamy twardego sygnalu
            // isUserInteraction=true; poza trip zostawiamy dotychczasowy fallback.
            const tripActive = isDrivingRef.current || isNavigatingRef.current;
            const shouldMarkGesture = tripActive
              ? isUserInteraction
              : (gestureActive && (Platform.OS === 'ios' ? (e?.properties?.isUserInteraction !== false) : true));
            if (shouldMarkGesture) markUserGesture();
          }}
        >
          <Mapbox.Camera
            ref={cameraRef}
            padding={tripCameraPadding}
            defaultSettings={cameraDefaultSettingsRef.current}
          />
          <Mapbox.UserLocation visible={false} />
          <MapTerrainLayers
            enabled={showTerrainLayers}
            showBuildings={showThreeDBuildings}
            isDark={isDark}
            minZoom={BUILDINGS_3D_MIN_ZOOM}
          />

          {endLocation && !arrived && (
            <Mapbox.MarkerView coordinate={[endLocation.longitude, endLocation.latitude]} anchor={{ x: 0.5, y: 1 }}>
              <View style={{
                backgroundColor: '#111111', padding: 8, borderRadius: 12,
                borderWidth: 2, borderColor: '#e33835', alignItems: 'center',
                shadowColor: '#e33835', shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.6, shadowRadius: 6, elevation: 8,
              }}>
                <MaterialIcons name="flag" size={20} color="#e33835" />
              </View>
            </Mapbox.MarkerView>
          )}

          {startLocation && !isNavigating && !isBuilding && (
            <Mapbox.MarkerView coordinate={[startLocation.longitude, startLocation.latitude]} anchor={{ x: 0.5, y: 1 }}>
              <View style={{
                backgroundColor: '#111111', padding: 8, borderRadius: 12,
                borderWidth: 2, borderColor: '#4de926', alignItems: 'center',
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
              onPress={() => { setSelectedFuelStation(station); setFuelStationModalVisible(true); }}
            />
          ))}

          {effectivePartnerPois.map(poi => (
            <PartnerPoiMarker
              key={`partner_${poi.id}`}
              poi={poi}
              onPress={() => {
                Toast.show({ type: 'info', text1: poi.name, text2: poi.brandSlug ?? 'Partner VROOM' });
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

          {effectiveVisibleUsers.map(user => (
            <UserCarMarker
              key={`user_${user.id}`}
              user={user}
              distance={calculateDistance(
                (userLocation?.latitude ?? drLatRef.current),
                (userLocation?.longitude ?? drLngRef.current),
                user.latitude, user.longitude,
              )}
              onPress={() => handleUserMarkerPress(user)}
              imageUri={markerImages[user.id] ?? null}
            />
          ))}

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

          {useTripSmoothMarker ? (
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
                backgroundColor: isDark ? '#141414e8' : '#111111dc',
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius:    12,
                borderWidth:     1,
                borderColor:     isDark ? '#ffffff28' : '#ffffff35',
              }}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', textAlign: 'center', letterSpacing: 0.5 }}>
                PRZESUŃ MAPĘ · ŚRODEK = MIEJSCE FOTORADARU
              </Text>
            </View>
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}
            >
              <MaterialCommunityIcons name="crosshairs-gps" size={58} color="#ffffffaa" style={{ marginTop: -28 }} />
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
                  backgroundColor: isDark ? '#2a2a2a' : '#e8e8e8',
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
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '700' }}>DODAJ</Text>
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
                backgroundColor: isDark ? '#141414e8' : '#111111dc',
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: isDark ? '#ffffff28' : '#ffffff35',
              }}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', textAlign: 'center', letterSpacing: 0.5 }}>
                PRZYTRZYMAJ MAPĘ W MIEJSCU DOCELOWYM
              </Text>
            </View>
            <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 88 }}>
              <TouchableOpacity
                onPress={cancelManualTargetPick}
                style={{
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: isDark ? '#2a2a2a' : '#e8e8e8',
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
                    width: 56, height: 56, backgroundColor: '#1a1a1a', borderRadius: 14,
                    borderWidth: 1.5, borderColor: '#ff922b45',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MaterialCommunityIcons name="terrain" size={32} color="#ff922b" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: '#ff922b', fontWeight: '900', letterSpacing: 2 }}>
                      TRYB OFFROAD
                    </Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffffcc', marginTop: 2 }}>
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
                <MaterialIcons name="close" size={18} color="#ffffff70" />
              </TouchableOpacity>
            </View>
          ) : (
            currentStepData ? (
              // ── STANDARDOWY panel kroków ───────────────────
              <View style={styles.navigationPanelTop}>
                <View style={styles.instructionBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <View style={{
                      width: 56, height: 56, backgroundColor: '#1a1a1a', borderRadius: 14,
                      borderWidth: 1.5, borderColor: '#e3383545',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <MaterialIcons name={getManeuverIcon(currentStepData.maneuver) as any} size={32} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      {/* Live dystans do następnego skrętu */}
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 26, color: '#fff', fontWeight: '900', letterSpacing: 1 }}>
                        {distToTurnM !== null
                          ? distToTurnM < 1000
                            ? `${Math.round(distToTurnM / 10) * 10} m`
                            : `${(distToTurnM / 1000).toFixed(1)} km`
                          : currentStepData.distance?.text}
                      </Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#ffffffcc', marginTop: 2 }} numberOfLines={1}>
                        {cleanInstruction(currentStepData.html_instructions)}
                      </Text>
                    </View>
                  </View>

                  {activeSteps[currentStep + 1] && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 8,
                      backgroundColor: '#ffffff08', borderRadius: 10,
                      paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6,
                    }}>
                      <MaterialIcons name="subdirectory-arrow-right" size={14} color="#ffffff50" />
                      <Text style={{ color: '#ffffff60', fontFamily: 'Orbitron', fontSize: 9 }}>Potem: </Text>
                      <MaterialIcons name={getManeuverIcon(activeSteps[currentStep + 1].maneuver) as any} size={14} color="#ffffff80" />
                      <Text style={{ color: '#ffffff80', fontFamily: 'Orbitron', fontSize: 9, flex: 1 }} numberOfLines={1}>
                        {cleanInstruction(activeSteps[currentStep + 1].html_instructions)}
                      </Text>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff50', letterSpacing: 1 }}>
                      Krok {currentStep + 1}/{activeSteps.length}
                    </Text>
                    {/* Live pozostały dystans do celu */}
                    {remainingDistKm !== null && (
                      <>
                        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#ffffff30' }} />
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
                        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#ffffff30' }} />
                        <MaterialIcons name="schedule" size={10} color="#e33835" />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#e33835', fontWeight: '700' }}>
                          {formatDuration(routeInfo.duration)}
                        </Text>
                        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#ffffff30' }} />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff50' }}>
                          cel: {new Date(Date.now() + (routeInfo.duration ?? 0) * 60 * 1000).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
                <TouchableOpacity style={styles.closeNavBtn} onPress={stopNavigation}>
                  <MaterialIcons name="close" size={18} color="#ffffff70" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.navigationPanelTop}>
                <View style={styles.instructionBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{
                      width: 56, height: 56, backgroundColor: '#1a1a1a', borderRadius: 14,
                      borderWidth: 1.5, borderColor: '#e3383545',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <ActivityIndicator size="small" color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: '#fff', fontWeight: '800', letterSpacing: 1 }}>
                        ŁADOWANIE MANEWRÓW...
                      </Text>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffffaa', marginTop: 3 }}>
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
                  <MaterialIcons name="close" size={18} color="#ffffff70" />
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
              <View style={[
                styles.speedPanelNav,
                !isNavigating && { bottom: 200 },
              ]}>
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
              </View>
            )}
          </SpeedometerHUD>
        )}

        {/* ── Tryb jazdy: górny HUD (prawie pełna szerokość) — prędkość, limit, dystans do celu ── */}
        {isDriving && !isNavigating && (
          <SpeedometerHUD initialKmh={0}>
            {(hudKmh: number) => (
              <View
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 6,
                  right: 6,
                  zIndex: 96,
                  backgroundColor: 'rgba(12, 12, 14, 0.96)',
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: 'rgba(227, 56, 53, 0.35)',
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 3 },
                  shadowOpacity: 0.4,
                  shadowRadius: 10,
                  elevation: 12,
                }}
              >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialCommunityIcons name="car-sports" size={22} color="#e33835" />
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#e33835', letterSpacing: 2, fontWeight: '800' }}>
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
                      color: '#fff',
                      letterSpacing: -1,
                      marginTop: 2,
                    }}
                    unitStyle={{ fontFamily: 'Orbitron', fontSize: 11, color: '#ffffff55', fontWeight: '700' }}
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
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff45', letterSpacing: 1 }}>PRZEJECHANE (SILNIK TRASY)</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, fontWeight: '800', color: '#e33835' }}>
                {(Number.isFinite(liveDistanceKm) ? liveDistanceKm : 0).toFixed(2)} km
              </Text>
            </View>

            <View style={{
              marginTop: 10,
              paddingTop: 10,
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.08)',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}>
              <MaterialIcons name="navigation" size={16} color="#00bfff" />
              <View style={{ flex: 1, minWidth: 0 }}>
                {endLocation ? (
                  <>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '700' }} numberOfLines={1}>
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
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff45' }}>do celu (linia prosta)</Text>
                      {routeInfo?.distance != null && (
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff55' }}>
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
              </View>
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
        {!isNavigating && !isBuilding && startLocation && endLocation && (
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

        
      </View>
    </>
  );
}