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
import { MAPBOX_TOKEN } from '../../constants/mapConfig';
import { API_URL } from '../../constants/mapConfig';
import { useTheme } from '../../contexts/ThemeContext';
import { usePremium } from '../../contexts/PremiumContext';
import { useChat } from '../../hooks/useChats';
import { DrPositionMarker } from '../../components/map/DrPositionMarker';
import { makeMapStyles } from '../../styles/mapstyle';
Mapbox.setAccessToken(MAPBOX_TOKEN);

import {
  MAPBOX_STYLE_DARK,
  MAPBOX_STYLE_LIGHT,
  MAPBOX_STYLE_SATELLITE,
  MAPBOX_STYLE_HYBRID,
  MAX_NEARBY_USERS_DISTANCE
} from '../../constants/mapConfig';
import { LocationState, RouteInfo, User } from '../../constants/types';
import { loadMapLastLocation, saveMapLastLocation } from '../../lib/mapLastLocation';

import { latFilter, lngFilter, navLatFilter, navLngFilter, drivLatFilter, drivLngFilter } from '../../scripts/kalmanFilter';
// ── NOWE: sanity check ────────────────────────────────────
import { isSaneLocation } from '../../scripts/kalmanFilter';

import { useAdaptiveGPS } from '../../hooks/useAdaptiveGPS';
import {
  BG_IS_SHARING_KEY,
  feedSpeedSample,
  recordDrivingTracePoint,
  resetSpeedStats,
  setDrivingFlag,
  setNavigatingFlag,
  useBackgroundTracking,
} from '../../hooks/useBackgroundTracking';
import { useSettings } from '../../hooks/useSettings';
import { useCameraAnimation } from '../../hooks/useCameraAnimation';
import { useDeadReckoning } from '../../hooks/useDeadReckoning';
import { useDemoUsers } from '../../hooks/useDemoUsers';
import { useDrivingMapMatch } from '../../hooks/useDrivingMapMatch';
import { useDrivingSnap } from '../../hooks/useDrivingSnap';
import { useGoogleDirections, useGoogleDirectionsAlternatives } from '../../hooks/useGoogleDirections';
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
  formatSpeed,
  getManeuverIcon,
  haversineKm,
  isOnRoute,
  maxIdleBrowsingJumpM,
  snapToRoute,
} from '../../scripts/navigationUtils';

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
import { FuelStationModal }     from '../../components/modals/FuelStationModal';
import { AddFuelStationModal }  from '../../components/modals/AddFuelStationModal';

// ─────────────────────────────────────────────────────────────────────────────
const REROUTE_THRESHOLD_M = 40;
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

// Live location sharing — interval + distance/time gate
const SEND_INTERVAL_MS    = 15_000; // poll period (ms)
const SEND_MIN_DIST_M     = 40;     // min movement before sending (saves bandwidth while stationary)
const SEND_MAX_ELAPSED_MS = 60_000; // heartbeat: force-send after this long even without movement
const FORCE_MAP_MATCH_COOLDOWN_MS = 120_000;
const FORCE_MAP_MATCH_MIN_MOVE_M = 120;
const FORCE_MAP_MATCH_RECOVER_MIN_INTERVAL_MS = 7_000;
const FORCE_MAP_MATCH_RECOVER_STREAK = 2;
const NAV_SESSION_KEY     = 'nav_session_v1';
const NAV_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

// updateCameras + updateSpeedLimit — skip if user hasn't moved this far
// (each hook also has its own internal throttle; this gate prevents even the
//  cheap recalc/sort from running on every sub-second GPS tick)
const CAMERA_SPEED_LIMIT_GATE_M = 30; // meters
const CAMERA_SPEED_LIMIT_GATE_NAV_M = 10; // meters in driving/navigation

// Reroute cooldown — avoids hammering Directions API while continuously off-route
const REROUTE_COOLDOWN_MS = 10_000; // minimum ms between reroute requests
const REROUTE_MIN_MOVED_M = 200;    // OR allow early reroute if user moved this far from last point

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

  if (appliedSnap.snapped && Number.isFinite(appliedSnap.targetHeading)) {
    let roadHeading = alignBearingToReference(appliedSnap.targetHeading, travelRef);
    if (moveBearing != null) {
      roadHeading = smoothHeading(roadHeading, moveBearing, 0.4, 22);
    }
    return smoothHeading(lastHeading, roadHeading, 0.52, 42);
  }

  if (moveBearing != null) {
    return smoothHeading(lastHeading, moveBearing, 0.48, 48);
  }

  if (gpsHeading != null && gpsHeading >= 0 && kmh >= 6) {
    const gpsFlip = Math.abs(((gpsHeading - lastHeading + 540) % 360) - 180);
    if (gpsFlip <= 110) {
      return smoothHeading(lastHeading, gpsHeading, 0.38, 40);
    }
  }

  return null;
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
// ─────────────────────────────────────────────────────────────────────────────

// ── DRIVING MODE ──────────────────────────────────────────
// Czas (ms) jazdy <10 km/h zanim wyłączymy tryb driving
const DRIVING_STOP_DELAY_MS      = 12 * 60 * 1000; // 12 minut
const DRIVING_SPEED_KMH          = 10;
// Ile km/h ponad limit zanim kolor prędkości zmienia się na czerwony
const SPEED_LIMIT_TOLERANCE      = 5;

// ── Driving-mode distance accumulator safety caps ──────────
// Maximum realistic speed for per-tick distance cap (km/h)
const MAX_PLAUSIBLE_SPEED_KMH    = 140;
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
const GPS_RESUME_GRACE_PERIOD_MS = 5000;
const GPS_RESTART_COOLDOWN_MS    = 2000;
/** Nie restartuj watchera po focus, jeśli fix jest świeży (mniej lagów). */
const GPS_WATCHER_STALE_MS       = 12_000;
/** Po długiej pauzie w tle — zawsze restart. */
const GPS_BACKGROUND_STALE_MS    = 25_000;
/** Min. prędkość do pasywnego liczenia km na mapie (bez trybu jazdy / nawigacji). */
const PASSIVE_DISTANCE_MIN_KMH   = 7;
/** Throttle publikacji markera na UI (Hz) poza nawigacją/jazdą. */
const UI_LOCATION_THROTTLE_MS    = 125;
/** Podczas jazdy/nawigacji marker idzie z DR — userLocation tylko dla fuel/live map. */
const SECONDARY_LOC_PUBLISH_MS   = 2500;
const HEADING_UI_THROTTLE_MS     = 160;
const SPEED_UI_THROTTLE_MS       = 350;
const NAV_PROGRESS_UI_MS         = 650;
const CAMERA_SPEED_POLL_MS       = 4500;
const GPS_RESUME_DEDUPE_MS       = 3000;
const GPS_ONESHOT_COOLDOWN_MS    = 6000;
const GPS_ONESHOT_AFTER_RESUME_MS = 1500;
/** Odrzuć pierwszy fix inicjalizacji, jeśli provider zwraca zbyt zgrubną niedokładność (często cache sieci). */
const GPS_INIT_MAX_ACCURACY_M = 150;
/** Po wznowieniu apki — pokaż „Szukam GPS” dopiero gdy ostatni fix jest starszy niż tyle. */
const GPS_RESUME_SPINNER_MIN_AGE_MS = 90_000;
/** Jednorazowy fix po wznowieniu — powyżej tego promienia zwykle jest to last-known z komórki, nie GPS. */
const GPS_ONESHOT_MAX_ACCURACY_M = 100;
/** Loader "Szukam GPS" nie powinien wisieć przy działających fixach o średniej dokładności. */
const GPS_ACQUIRING_RELEASE_ACCURACY_M = 130;
const GPS_ACQUIRING_RELEASE_AFTER_TICKS = 2;
const GPS_ACQUIRING_RELEASE_FALLBACK_ACCURACY_M = 180;
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
const GPS_IDLE_HARD_REJECT_ESCAPE_HITS = 8;
const GPS_IDLE_HARD_REJECT_ESCAPE_MAX_SPEED_KMH = 7;
const GPS_IDLE_HARD_REJECT_ESCAPE_MAX_ACC_M = 55;
const GPS_IDLE_UI_SOFT_JUMP_M = 20;
const GPS_IDLE_UI_HARD_JUMP_M = 120;
const GPS_IDLE_UI_CONFIRM_RADIUS_M = 35;
const GPS_IDLE_UI_CONFIRM_WINDOW_MS = 10_000;
/** Przy takiej prędkości traktujemy mapę jako stojącą/wolną i blokujemy skoki względem aktualnego UI. */
const GPS_IDLE_UI_LOCK_SPEED_KMH = 8;
/** Dodatkowy anti-teleport tylko dla prawie-stojącego auta i słabego sygnału. */
const GPS_STILL_LOCK_SPEED_KMH = 3.5;
const GPS_STILL_LOCK_SOFT_JUMP_M = 90;
const GPS_STILL_LOCK_CONFIRM_RADIUS_M = 60;
const GPS_STILL_LOCK_CONFIRM_WINDOW_MS = 10_000;
const GPS_STILL_LOCK_CONFIRM_HITS = 2;
const GPS_STILL_LOCK_HARD_REJECT_M = 260;
const GPS_DEBUG_BUFFER_SIZE = 30;
/** Active modes: instead of hard-dropping suspicious fixes, clamp step to keep motion smooth. */
const GPS_ACTIVE_SOFT_REBASE_MAX_STEP_M = 95;
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

  // ── Refs – nawigacja / mowa ───────────────────────────────
  const lastSpokenRef        = useRef('');
  const lastSpeechAtRef      = useRef(0);
  const speechTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rerouteTimerRef      = useRef<any>(null);
  const announcedPhasesRef   = useRef<Set<string>>(new Set());
  const isSpeechRef          = useRef(true);
  const startIsMyLocationRef = useRef(false);
  const pendingRouteRef      = useRef<{ id: number; name: string } | null>(null);


  const drivingConsecutiveRef = useRef(0);       // ile z rzędu odczytów ponad próg
  const DRIVING_CONSECUTIVE_REQ = 4;             // wymagane kolejne odczyty zanim wejdziemy w driving
  const lastSetLocRef = useRef<{ lat: number; lng: number } | null>(null);
  const MIN_MOVE_M = 8;                          // ignoruj ruch < 8m gdy wolno
  /** Poza nawigacją/jazdą — rzadkie odświeżenie (marker i tak z GPS). */
  const DR_UI_TICK_MS = 700;
  /** W nawigacji / driving: marker z DR — ~10 fps UI wystarczy, mniej re-renderów MapScreen. */
  const DR_UI_TICK_ACTIVE_MS = 120;
  const DR_STALE_MS = 18_000;


  // ── Refs – dead-reckoning ─────────────────────────────────
  const drLatRef    = useRef(0);
  const drLngRef    = useRef(0);
  const drHdgRef    = useRef(0);
  const drTickLastEmitAtRef = useRef(0);
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

  // ── Cost-optimisation refs ────────────────────────────────
  // sendLocation: track last sent position + time to apply distance/heartbeat gate
  const lastSendTimeRef    = useRef<number>(0);
  const lastSendLocRef     = useRef<{ lat: number; lng: number } | null>(null);
  // updateCameras / updateSpeedLimit: skip if user hasn't moved CAMERA_SPEED_LIMIT_GATE_M
  const lastCameraUpdateLocRef = useRef<{ lat: number; lng: number } | null>(null);
  // reroute cooldown: limit reroute trigger frequency
  const lastRerouteTimeRef  = useRef<number>(0);
  const lastRerouteLocRef   = useRef<{ lat: number; lng: number } | null>(null);
  // forceMapMatch: avoid repeated paid entry snaps in the same area
  const lastForceMapMatchRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const lastDrivingNoSnapForceRef = useRef<number>(0);
  const drivingNoSnapStreakRef = useRef(0);
  /** Throttle okresowego forceMatch w driving (świeża oś drogi). */
  const lastDrivingSoftRefreshRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  /** Gdy zniknie dopasowanie — szybki re-fetch bez spamowania API. */
  const lastDrivingRecoverMatchRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  /** Zapobiega równoległemu wejściu w driving (podwójny tap podczas await forceMatch). */
  const drivingManualEntryBusyRef = useRef(false);
  // currentLocRef: latest userLocation readable inside stable interval callbacks
  const currentLocRef       = useRef<{ latitude: number; longitude: number } | null>(null);
  /** Ostatnie znane centrum mapy — żeby Camera nie wracała na domyślne 19/52 przy migawce stanu. */
  const lastMapCenterRef    = useRef<[number, number]>([19.0, 52.0]);

  // ── NOWE Refs — GPS sanity + driving mode ─────────────────
  const lastGoodLocRef        = useRef<{ lat: number; lng: number } | null>(null);
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
  const drivingManuallyDisabledRef = useRef(false);
  const drivingLastLocRef     = useRef<{ lat: number; lng: number } | null>(null);
  const lastDrivingPosRef     = useRef<{ lat: number; lng: number } | null>(null);
  const lastRawForHeadingRef  = useRef<{ lat: number; lng: number } | null>(null);
  const lastGoodTimeRef       = useRef<number>(Date.now());
  /** Rzeczywisty czas ostatniego zaakceptowanego fixu — bez cofania przy resume (walidacja one-shot). */
  const lastAcceptedFixWallClockRef = useRef<number>(Date.now());
  const lastGpsRestartAtRef   = useRef<number>(0);
  const lastResumeHandledAtRef = useRef<number>(0);
  const lastOneShotAtRef       = useRef<number>(0);
  const resumeAwaitFixUntilRef = useRef<number>(0);
  const appStateRef            = useRef(AppState.currentState);
  const resumeOneShotTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didRestoreNavSessionRef = useRef(false);
  // Tracks the timestamp of the previous GPS tick for per-tick distance capping.
  const prevGoodTimeRef       = useRef<number>(Date.now());
  const navStatsFlushedRef    = useRef(false);
  const passiveTripStartedRef = useRef(false);
  const lastUiLocPublishRef   = useRef(0);
  const lastSecondaryLocPublishRef = useRef(0);
  const lastHeadingEmitRef    = useRef(0);
  const lastHeadingUiRef      = useRef(0);
  const lastSpeedEmitRef      = useRef(0);
  const roadMatchSigRef       = useRef('');
  const navRouteIdxRef        = useRef(-1);
  const lastDistToTurnUiRef   = useRef<number | null>(null);
  const lastRemainingKmUiRef  = useRef<number | null>(null);
  const reroutePendingRef     = useRef(false);
  const lastBackgroundAtRef   = useRef<number>(0);
  const gpsTickCountRef       = useRef(0);
  const drTickCountRef        = useRef(0);
  const lastGpsTickAtRef      = useRef(0);
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
    const now = Date.now();
    const drActive =
      (isNavigatingRef.current || isDrivingRef.current)
      && drLatRef.current !== 0
      && drLngRef.current !== 0
      && now - drLastFrameAtRef.current <= DR_STALE_MS;
    if (drActive && !force) {
      if (now - lastSecondaryLocPublishRef.current < SECONDARY_LOC_PUBLISH_MS) return;
      lastSecondaryLocPublishRef.current = now;
      setUserLocation(loc);
      return;
    }
    const highPriority = isNavigatingRef.current || isDrivingRef.current;
    if (force || highPriority || now - lastUiLocPublishRef.current >= UI_LOCATION_THROTTLE_MS) {
      lastUiLocPublishRef.current = now;
      setUserLocation(loc);
      if (force || highPriority) {
        persistMapLocation(loc.latitude, loc.longitude);
      }
    }
  }, [persistMapLocation]);

  const publishHeading = useCallback((hdg: number) => {
    lastHeadingRef.current = hdg;
    const now = Date.now();
    const active = isNavigatingRef.current || isDrivingRef.current;
    if (active) {
      const diff = Math.abs(((hdg - lastHeadingUiRef.current + 540) % 360) - 180);
      if (now - lastHeadingEmitRef.current < HEADING_UI_THROTTLE_MS && diff < 6) return;
      lastHeadingEmitRef.current = now;
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

  // ── State – lokalizacja ───────────────────────────────────
  const [userLocation,  setUserLocation]  = useState<LocationState | null>(null);
  /** Wymusza odświeżenie markera przy DR (refs nie triggerują re-renderu). */
  const [drUiTick, setDrUiTick] = useState(0);
  const [startLocation, setStartLocation] = useState<LocationState | null>(null);
  const [endLocation,   setEndLocation]   = useState<LocationState | null>(null);
  const [region,        setRegion]        = useState<any>(null);
  const [heading,       setHeading]       = useState(0);
  const [speed,         setSpeed]         = useState<number | null>(null);
  const [locationReady, setLocationReady] = useState(false);
  /** true = mapa pokazuje cache / czeka na świeży fix GPS. */
  const [gpsAcquiring, setGpsAcquiring] = useState(true);
  const gpsAcquiringRef = useRef(true);

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
  const { isPremium } = usePremium();
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
  const showThreeDBuildings = enableThreeDScene && currentZoom >= BUILDINGS_3D_MIN_ZOOM;
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

  const { snap: drivingSnap, setRoutePoints: setSnapPoints, setRoadMatchPoints, reset: resetSnap } = useDrivingSnap();
  const {
    addPosition: addMatchPosition,
    getMatchedPoints,
    reset: resetMapMatch,
    forceMatch: forceMapMatch,
    bumpMatchedFreshness,
  } = useDrivingMapMatch();

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

  const resyncSnapAfterRoadGeometry = useCallback((
    rawLat: number,
    rawLng: number,
    speedKmh: number,
    acc: number | null | undefined,
  ) => {
    if (!isDrivingRef.current && !isNavigatingRef.current) return;
    const snap = drivingSnap(rawLat, rawLng, speedKmh, false, true, acc ?? null);
    if (!snap.snapped || !Number.isFinite(snap.latitude) || !Number.isFinite(snap.longitude)) return;

    const anchor = resolveDrivingAnchor();
    let lat = snap.latitude;
    let lng = snap.longitude;
    if (anchor) {
      const c = clampCoordStep(anchor, { latitude: snap.latitude, longitude: snap.longitude }, 36);
      lat = c.latitude;
      lng = c.longitude;
    }

    drLatRef.current = lat;
    drLngRef.current = lng;
    lastSetLocRef.current = { lat, lng };
    lastGoodLocRef.current = { lat, lng };
    publishUserLocation({ latitude: lat, longitude: lng }, true);
    feedDR({ latitude: lat, longitude: lng }, (speedKmh / 3.6), snap.targetHeading);
  }, [drivingSnap, feedDR, publishUserLocation, resolveDrivingAnchor]);

  const applyRoadMatchPoints = useCallback((pts: { latitude: number; longitude: number }[] | null | undefined) => {
    const list = pts && pts.length >= 2 ? pts : [];
    if (list.length < 2) return;
    const sig = `${list.length}:${list[0].latitude.toFixed(5)},${list[0].longitude.toFixed(5)},${list[list.length - 1].latitude.toFixed(5)},${list[list.length - 1].longitude.toFixed(5)}`;
    if (sig === roadMatchSigRef.current) return;
    roadMatchSigRef.current = sig;
    setRoadMatchPoints(list);

    const raw = lastRawForHeadingRef.current ?? lastGoodLocRef.current;
    if (raw) {
      resyncSnapAfterRoadGeometry(raw.lat, raw.lng, speedKmhRef.current, null);
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
  // The hook internally throttles by time (30s) and distance (500m) to avoid excessive API calls.
  useEffect(() => {
    if (userLocation) onFuelLocationChange(userLocation);
  }, [userLocation?.latitude, userLocation?.longitude]);

  const handleChangeMapType = useCallback((type: string) => {
    setMapType(type);
    AsyncStorage.setItem('map_type', type).catch(() => {});
  }, []);

  const {
    startTrip, feedSpeed, feedPosition,
    finishTrip, clearStats, stats: tripStats, liveDistanceKm,
  } = useTripStats();

  const publishSpeed = useCallback((rawSpeedMs: number | null) => {
    feedSpeedSample(rawSpeedMs);
    feedSpeed(rawSpeedMs != null && rawSpeedMs > 0 ? rawSpeedMs : null);
    const display = rawSpeedMs != null && rawSpeedMs > 0 ? rawSpeedMs : null;
    const now = Date.now();
    if (isNavigatingRef.current || isDrivingRef.current) {
      if (now - lastSpeedEmitRef.current < SPEED_UI_THROTTLE_MS) return;
      lastSpeedEmitRef.current = now;
    }
    setSpeed(display);
  }, [feedSpeed]);

  const {
    liveUsers, warnings, connected,
    sendLocation, toggleSharing, addWarning, confirmWarning,cancelWarning,
  } = useLiveMap(
    isSharing,
    userLocation,
    isSpeechEnabled,
    settings.backgroundTracking,
    isMapFocused,
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
    setFollowMode,
  } = useCameraAnimation(cameraRef);

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

  // ── Dead-reckoning — płynny marker na mapie (browse + jazda + nawigacja) ──
  const drEnabled = isMapFocused && locationReady;

  const { feed: feedDR, reset: resetDR, stop: stopDR } = useDeadReckoning({
    enabled: drEnabled,
    frameInterval: 16,
    onFrame: useCallback((pos: any, hdg: number) => {
      drTickCountRef.current += 1;
      drLastFrameAtRef.current = Date.now();

      let snappedPos = pos;

      if (isNavigatingRef.current) {
        const points = routePointsRef.current;
        if (points.length > 1) {
          const snapped = snapToRoute(pos.latitude, pos.longitude, points, 35);
          snappedPos = { latitude: snapped.latitude, longitude: snapped.longitude };
        }
        drHdgRef.current = hdg;
      } else if (!isDrivingRef.current && Number.isFinite(hdg)) {
        drHdgRef.current = hdg;
      }

      drLatRef.current = snappedPos.latitude;
      drLngRef.current = snappedPos.longitude;

      setDrUiTick((t) => (t + 1) % 1_000_000);

      const activeFollow = isNavigatingRef.current || isDrivingRef.current;
      const uiNow = Date.now();

      if (activeFollow) {
        const drEmitMs = DR_UI_TICK_ACTIVE_MS;
        if (uiNow - drTickLastEmitAtRef.current >= drEmitMs) {
          drTickLastEmitAtRef.current = uiNow;
          publishUserLocation({ latitude: snappedPos.latitude, longitude: snappedPos.longitude });
        }
      }
      // Browse: marker z userLocation (GPS), nie z DR — unika jitteru przy postoju.
      if (!activeFollow) return;

      const camHeading = (drHdgRef.current !== 0)
        ? drHdgRef.current
        : (lastHeadingRef.current !== 0 ? lastHeadingRef.current : hdg);

      updateCameraFrame({
        center: snappedPos,
        heading: camHeading,
        speedKmh: speedKmhRef.current,
        isNavigating: isNavigatingRef.current,
        isDriving: isDrivingRef.current,
        timestamp: uiNow,
      });
    }, [publishUserLocation, updateCameraFrame]),
    stallTimeout: (isNavigating || isDriving) ? 18_000 : 12_000,
  });

  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);

  const { flushPendingKm } = useBackgroundTracking(
    isSharing,
    settings.backgroundTracking,
    isNavigating || isDriving,
    sharingHydrated,
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

  const { routes: alternativeRoutes, loading: previewLoading } = useGoogleDirectionsAlternatives(
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

  const { route: navRoute } = useGoogleDirections(
    navStartLoc,
    isNavigating ? endLocation : null,
  );

  const { route: rerouteResult } = useGoogleDirections(
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
    drTickLastEmitAtRef.current = 0;
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

      setStartLocation({ latitude: first.latitude, longitude: first.longitude, name: 'Start trasy' });
      setEndLocation({ latitude: last.latitude, longitude: last.longitude, name: data.routeName });

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
    lastGoodLocRef.current = { lat, lng };
    lastAcceptedFixWallClockRef.current = Date.now();
    drLatRef.current = lat;
    drLngRef.current = lng;
    setUserLocation({ latitude: lat, longitude: lng });
    setRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.015, longitudeDelta: 0.015 });
    setLocationReady(true);
    locationReadyRef.current = true;
    const acc = opts?.accuracy;
    const showSpinner = !!opts?.approximate
      && (typeof acc !== 'number' || acc > GPS_ACQUIRING_RELEASE_ACCURACY_M);
    setGpsAcquiring(showSpinner);
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
      if (acc <= 80) {
        latFilter.reset();
        lngFilter.reset();
      }
      const lat = latFilter.filter(rawLat, acc);
      const lng = lngFilter.filter(rawLng, acc);
      lastMapCenterRef.current = [lng, lat];
      setUserLocation({ latitude: lat, longitude: lng });
      setRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.015, longitudeDelta: 0.015 });
      lastGoodLocRef.current = { lat, lng };
      lastAcceptedFixWallClockRef.current = Date.now();
      drLatRef.current = lat;
      drLngRef.current = lng;
      setLocationReady(true);
      locationReadyRef.current = true;
      persistMapLocation(lat, lng, acc);
      if (approximate && acc > GPS_ACQUIRING_RELEASE_ACCURACY_M) {
        setGpsAcquiring(true);
      } else {
        setGpsAcquiring(false);
      }
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
            maxAge: 86_400_000,
            requiredAccuracy: 150,
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

  const exitDrivingMode = useCallback((opts?: { skipFlush?: boolean }) => {
    mapMatchApplySeqRef.current += 1;
    passiveTripStartedRef.current = false;
    const finalStats = finishTrip();
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
    lastDrivingNoSnapForceRef.current = 0;
    lastDrivingSoftRefreshRef.current = null;
    lastDrivingRecoverMatchRef.current = null;
    applyRoadMatchPoints([]);
    setIsDriving(false);
    if (!opts?.skipFlush) {
      // Persist driving sessions with full fg+bg merge (same strategy as navigation),
      // so top speed and km don't get lost when provider reports sparse/zero speed.
      void flushPendingKm(true, {
        distanceKm: finalStats.distanceKm,
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
    clearStats();
    console.log('[DrivingMode] Exited driving mode');
    // NIE wywołuj exitDrivingCamera gdy wywołane z beginNavigation
    // — nawigacja sama przejmuje kamerę przez lockForStart
  }, [stopDR, resetDRRefs, resetSnap, resetMapMatch, applyRoadMatchPoints, flushPendingKm, clearStats, finishTrip]);

  // Ręczny przełącznik trybu jazdy (przycisk w UI) — wejście natychmiastowe,
  // dopasowanie drogi dogrywane asynchronicznie w tle (bez "poczekaj").
  const handleToggleDrivingMode = useCallback(() => {
    if (isNavigating) return;
    if (isDriving) {
      drivingManuallyDisabledRef.current = true;
      // Zawsze zwalnij busy przy wyjściu — inaczej szybkie OFF→ON może zostawić blokadę i „nic się nie dzieje”.
      drivingManualEntryBusyRef.current = false;
      const exitCenter =
        Number.isFinite(drLatRef.current) &&
        Number.isFinite(drLngRef.current) &&
        drLatRef.current !== 0 &&
        drLngRef.current !== 0
          ? { latitude: drLatRef.current, longitude: drLngRef.current }
          : userLocation;
      exitDrivingMode();
      if (exitCenter) resetBrowseCamera(exitCenter);
    } else {
      if (!userLocation || !Number.isFinite(userLocation.latitude) || !Number.isFinite(userLocation.longitude)) {
        Toast.show({ type: 'error', text1: 'GPS', text2: 'Poczekaj na fix lokalizacji zanim włączysz jazdę.' });
        return;
      }
      const startLat = userLocation.latitude;
      const startLng = userLocation.longitude;

      drivingManuallyDisabledRef.current = false;
      drivingManualEntryBusyRef.current = false;
      // Snap ALWAYS-ON: najpierw użyj ostatniej znanej geometrii drogi (instant local snap),
      // a dopiero potem koryguj siecią w tle.
      const cachedRoad = getMatchedPoints();
      resetSnap();
      drivingNoSnapStreakRef.current = 0;
      lastDrivingNoSnapForceRef.current = 0;
      lastDrivingSoftRefreshRef.current = null;
      lastDrivingRecoverMatchRef.current = null;
      if (cachedRoad && cachedRoad.length >= 2) {
        applyRoadMatchPoints(cachedRoad);
        bumpMatchedFreshness();
      }

      const localSnap = drivingSnap(
        startLat,
        startLng,
        Math.max(0, speedKmhRef.current),
        false,
        true,
        null,
      );
      const holdAnchor =
        (Number.isFinite(drLatRef.current) && Number.isFinite(drLngRef.current)
          && drLatRef.current !== 0 && drLngRef.current !== 0
          ? { latitude: drLatRef.current, longitude: drLngRef.current }
          : (lastSetLocRef.current
            ? { latitude: lastSetLocRef.current.lat, longitude: lastSetLocRef.current.lng }
            : null));

      const entryLat = localSnap.snapped && Number.isFinite(localSnap.latitude)
        ? localSnap.latitude
        : (holdAnchor?.latitude ?? startLat);
      const entryLng = localSnap.snapped && Number.isFinite(localSnap.longitude)
        ? localSnap.longitude
        : (holdAnchor?.longitude ?? startLng);
      const entryHeading = localSnap.snapped && Number.isFinite(localSnap.targetHeading)
        ? localSnap.targetHeading
        : (Number.isFinite(lastHeadingRef.current) ? lastHeadingRef.current : 0);
      console.log('[DrivingMode] entry_snap_seed', JSON.stringify({
        cachedRoadPts: cachedRoad?.length ?? 0,
        localSnapped: !!localSnap.snapped,
        startLat,
        startLng,
        entryLat,
        entryLng,
      }));

      lastForceMapMatchRef.current = { at: Date.now(), lat: startLat, lng: startLng };
      isDrivingRef.current = true;
      drivingConsecutiveRef.current = DRIVING_CONSECUTIVE_REQ;
      startTrip(Number(routeInfoRef.current?.duration) || 0);
      drivingLastLocRef.current = null;
      lastDrivingPosRef.current = null;
      navLatFilter.reset();
      navLngFilter.reset();
      drivLatFilter.reset();
      drivLngFilter.reset();

      setIsDriving(true);
      drLatRef.current = entryLat;
      drLngRef.current = entryLng;
      lastSetLocRef.current = { lat: entryLat, lng: entryLng };
      setUserLocation({ latitude: entryLat, longitude: entryLng });
      feedDR({ latitude: entryLat, longitude: entryLng }, 0, entryHeading);
      setFollowMode('drivingFollow');
      recenterTo({
        center: { latitude: entryLat, longitude: entryLng },
        heading: entryHeading,
        speedKmh: Math.max(speedKmhRef.current, 28),
        active: true,
      });
      recordDrivingTracePoint(entryLat, entryLng, { speedKmh: 0 }).catch(() => {});

      // Dograj map matching w tle — bez blokowania aktywacji trybu.
      const reqId = ++mapMatchApplySeqRef.current;
      void forceMapMatch(entryLat, entryLng, { manual: true })
        .then((p) => {
          if (reqId !== mapMatchApplySeqRef.current) return;
          if (!p || p.length < 2 || !isDrivingRef.current) return;
          applyRoadMatchPoints(p);
          bumpMatchedFreshness();
          resyncSnapAfterRoadGeometry(entryLat, entryLng, speedKmhRef.current, null);
          if (__DEV__) {
            console.log('[DrivingMode] entry_forceMatch_applied', JSON.stringify({
              pts: p.length,
            }));
          }
        })
        .catch(() => {});

      console.log('[DrivingMode] Manually entered immediately — road snap warmup in background');
    }
  }, [isNavigating, isDriving, userLocation, exitDrivingMode, resetBrowseCamera, setFollowMode, recenterTo, getMatchedPoints, bumpMatchedFreshness, resetSnap, forceMapMatch, feedDR, drivingSnap, startTrip, recordDrivingTracePoint, applyRoadMatchPoints, resyncSnapAfterRoadGeometry]);

  // ─────────────────────────────────────────────────────────
  // Adaptive GPS
  // ─────────────────────────────────────────────────────────
  speedKmhRef.current = (speed ?? 0) * 3.6;

  const { start: startGPS, stop: stopGPS } = useAdaptiveGPS({
    isNavigating,
    isDriving,
    isMapFocused,
    speedKmh: speedKmhRef.current,
    onLocation: useCallback((loc) => {
      gpsTickCountRef.current += 1;
      lastGpsTickAtRef.current = Date.now();
      const rawLat0 = loc.latitude;
      const rawLng0 = loc.longitude;
      let rawLat = rawLat0;
      let rawLng = rawLng0;
      const acc    = loc.accuracy ?? 10;
      const now    = Date.now();
      const speedKmhRaw = (loc.speed != null && loc.speed >= 0) ? loc.speed * 3.6 : 0;
      if (!Number.isFinite(rawLat0) || !Number.isFinite(rawLng0) || !Number.isFinite(acc)) return;

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

      if (isStaleGpsTimestamp(now, loc.timestamp)) {
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

      const reportedKmhIdle = (loc.speed != null && loc.speed >= 0) ? loc.speed * 3.6 : 0;
      const wallSinceAcceptIdle = now - lastAcceptedFixWallClockRef.current;
      if (
        lastGoodLocRef.current
        && wallSinceAcceptIdle > GPS_IDLE_GAP_FOR_JUMP_GUARD_MS
        && reportedKmhIdle < GPS_IDLE_SPEED_GUARD_KMH
        && !isDrivingRef.current
        && !isNavigatingRef.current
      ) {
        const jumpIdleM = haversineKm(
          lastGoodLocRef.current.lat, lastGoodLocRef.current.lng,
          rawLat, rawLng,
        ) * 1000;
        if (jumpIdleM > GPS_IDLE_MAX_JUMP_AFTER_GAP_M) {
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

      // ══ 1. SANITY CHECK ══════════════════════════════════════
      const rollbackRejectedRawAnchor = rollbackIdleAnchor;
      if (lastGoodLocRef.current) {
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
        if (idleMode && speedKmhRaw < GPS_IDLE_UI_LOCK_SPEED_KMH) {
          const uiAnchor =
            lastSetLocRef.current
            ?? (currentLocRef.current
              && Number.isFinite(currentLocRef.current.latitude)
              && Number.isFinite(currentLocRef.current.longitude)
              ? { lat: currentLocRef.current.latitude, lng: currentLocRef.current.longitude }
              : null);
          if (uiAnchor) {
            const uiJumpM = haversineKm(uiAnchor.lat, uiAnchor.lng, rawLat, rawLng) * 1000;
            const maxUiJumpM = maxIdleBrowsingJumpM(safeDt, speedKmhRaw, acc);
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
              && safeDt < 12_000
              && speedKmhRaw < GPS_STILL_LOCK_SPEED_KMH
              && acc > 32;
            if (stillLockApplies) {
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
        if (idleMode && jumpM > GPS_IDLE_RANDOM_JUMP_M) {
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
            if (
              hits >= GPS_IDLE_HARD_REJECT_ESCAPE_HITS
              && speedKmhRaw <= GPS_IDLE_HARD_REJECT_ESCAPE_MAX_SPEED_KMH
              && acc <= GPS_IDLE_HARD_REJECT_ESCAPE_MAX_ACC_M
            ) {
              // Recovery path: if we keep getting a stable cluster of fixes far away
              // from the current anchor while stationary, the anchor was likely poisoned
              // by a stale/cached fix after resume. Rebase to current cluster.
              console.warn('[GPS map] Idle hard-reject escape: rebase anchor to stable cluster');
              latFilter.reset();
              lngFilter.reset();
              navLatFilter.reset();
              navLngFilter.reset();
              drivLatFilter.reset();
              drivLngFilter.reset();
              lastGoodLocRef.current = { lat: rawLat, lng: rawLng };
              lastGoodTimeRef.current = now;
              lastAcceptedFixWallClockRef.current = now;
              idleJumpCandidateRef.current = null;
              stillLockCandidateRef.current = null;
              pushGpsDebugFix({
                lat: rawLat,
                lng: rawLng,
                acc,
                speedKmh: speedKmhRaw,
                accepted: true,
                reason: 'idle_hard_reject_escape_rebase',
              });
              // Continue processing this fix normally so UI recovers immediately.
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
        } else if (jumpM <= GPS_IDLE_RANDOM_JUMP_M) {
          idleJumpCandidateRef.current = null;
        }

        const sane   = isSaneLocation(
          rawLat, rawLng,
          lastGoodLocRef.current.lat,
          lastGoodLocRef.current.lng,
          activeMode ? 520 : 250,
          safeDt,
          isDrivingRef.current,
        );
        if (!sane) {
          if (activeMode) {
            const clamped = clampRawTowardAnchor(
              lastGoodLocRef.current,
              rawLat,
              rawLng,
              GPS_ACTIVE_SOFT_REBASE_MAX_STEP_M,
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

        // Absolute-distance cap: a medium-sized drift (e.g. 200 m over 30 s =
        // 24 km/h) passes the speed check but is still a bad fix when the vehicle
        // is slow or stationary. Allow 3× expected distance + 100 m headroom.
        // safeDt uses a 100 ms floor so a very short time-delta between consecutive
        // GPS fixes never makes an ordinary displacement look unreasonably fast.
        // In driving mode, use a higher floor (300 m) to accommodate GPS drift at
        // highway speeds when loc.speed may report 0 on Android.
        const distM2    = haversineKm(lastGoodLocRef.current.lat, lastGoodLocRef.current.lng, rawLat, rawLng) * 1000;
        const reportedKmhRaw = (loc.speed != null && loc.speed >= 0) ? loc.speed * 3.6 : 0;
        const reportedKmh = (!isDrivingRef.current && !isNavigatingRef.current)
          ? Math.min(reportedKmhRaw, 10)
          : reportedKmhRaw;
        const expectedM2  = (reportedKmh / 3.6) * (safeDt / 1000);
        const distFloor   = isDrivingRef.current ? 420 : (isNavigatingRef.current ? 320 : 100);
        let maxDistM2   = Math.max(distFloor, expectedM2 * 3 + 100);
        if (idleMode && reportedKmhRaw < 22) {
          maxDistM2 = Math.min(maxDistM2, maxIdleBrowsingJumpM(safeDt, reportedKmhRaw, acc));
        }
        if (distM2 > maxDistM2) {
          if (activeMode) {
            const clamped = clampRawTowardAnchor(
              lastGoodLocRef.current,
              rawLat,
              rawLng,
              GPS_ACTIVE_SOFT_REBASE_MAX_STEP_M,
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
      prevGoodTimeRef.current = lastGoodTimeRef.current;
      lastGoodTimeRef.current = now;
      lastGoodLocRef.current  = { lat: rawLat, lng: rawLng };
      lastAcceptedFixWallClockRef.current = now;
      stillLockCandidateRef.current = null;
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
      if (
        acc <= GPS_ACQUIRING_RELEASE_ACCURACY_M
        || (gpsTickCountRef.current >= GPS_ACQUIRING_RELEASE_AFTER_TICKS
          && acc <= GPS_ACQUIRING_RELEASE_FALLBACK_ACCURACY_M)
      ) {
        setGpsAcquiring(false);
        persistMapLocation(rawLat, rawLng, acc);
      }

      // ══ 2. Kalman ════════════════════════════════════════════
      // Driving mode uses dedicated filters with higher process noise for faster
      // response to direction changes. Navigation uses nav-quality filters.
      // Idle uses standard (low-noise) filters.
      const lat = isDrivingRef.current
        ? drivLatFilter.filter(rawLat, acc)
        : isNavigatingRef.current
          ? navLatFilter.filter(rawLat, acc)
          : latFilter.filter(rawLat, acc);
      const lng = isDrivingRef.current
        ? drivLngFilter.filter(rawLng, acc)
        : isNavigatingRef.current
          ? navLngFilter.filter(rawLng, acc)
          : lngFilter.filter(rawLng, acc);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.warn('[GPS map] Kalman produced non-finite coord');
        latFilter.reset();
        lngFilter.reset();
        navLatFilter.reset();
        navLngFilter.reset();
        drivLatFilter.reset();
        drivLngFilter.reset();
        return;
      }

      // ══ 3. Prędkość (UI + trip stats dopiero po zaakceptowanej pozycji) ═══════
      const rawSpeedMs = loc.speed != null && loc.speed >= 0 ? loc.speed : null;
      const kmh        = (rawSpeedMs ?? 0) * 3.6;
      const safeDtForSnappedUi = Math.max(100, now - prevGoodTimeRef.current);

      // ══ 4. (feed speed — przeniesione na koniec callbacku) ═══════════════════

      // ══ 5/6 moved below ═══════════════════════════════════════
      // For navigation we update distance + DR after snapping to route.

      // ══ 7. Heading ═══════════════════════════════════════════
      // In driving mode, heading is derived from the movement vector
      // (calculated below in the driving pipeline after snapping).
      // For navigation / idle modes, use the GPS-reported heading.
      if (!isDrivingRef.current) {
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
          isDrivingRef.current
          || kmh >= DRIVING_SPEED_KMH
          || movedRawEarly >= 18
          || (movedRawEarly >= 12 && kmh >= 4);

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
            && kmh < GPS_IDLE_UI_LOCK_SPEED_KMH
            && browseMovedRawM < MIN_MOVE_M
            && browseMovedFilteredM < MIN_MOVE_M + 3
          ) {
            rollbackIdleAnchor();
            pushGpsDebugFix({
              lat: rawLat,
              lng: rawLng,
              acc,
              speedKmh: speedKmhRaw,
              accepted: false,
              reason: 'browse_stationary_deadzone',
            });
            publishSpeed(rawSpeedMs);
            return;
          }
          lastSetLocRef.current = { lat, lng };
          lastGoodLocRef.current = { lat, lng };
          const browseHdg =
            loc.heading != null && loc.heading >= 0 && kmh > 2
              ? loc.heading
              : lastHeadingRef.current;
          let browseLat = lat;
          let browseLng = lng;
          if (kmh >= 12) {
            const softSnap = drivingSnap(lat, lng, kmh, false, false, loc.accuracy ?? null);
            if (softSnap.snapped) {
              browseLat = softSnap.latitude;
              browseLng = softSnap.longitude;
            }
          }
          publishUserLocation({ latitude: browseLat, longitude: browseLng });
          publishSpeed(rawSpeedMs);
          const likelyMotorMotion =
            kmh >= 6
            || browseMovedRawM >= 24
            || browseMovedFilteredM >= 20;
          if (likelyMotorMotion) {
            const segKm = feedPosition(lat, lng, rawSpeedMs ?? undefined);
            if (segKm > 0) {
              recordDrivingTracePoint(lat, lng, { addDistanceKm: segKm, speedKmh: kmh }).catch(() => {});
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
          kmh >= DRIVING_SPEED_KMH
          || movedRawEarly >= 18
          || (movedRawEarly >= 12 && kmh >= 4);

        const matchedPts = getMatchedPoints();
        const noRoad = !matchedPts || matchedPts.length < 2;
        if (matchedPts && matchedPts.length > 1) {
          applyRoadMatchPoints(matchedPts);
          if (isDrivingRef.current) bumpMatchedFreshness();
        } else if (
          !isDrivingRef.current
          && movingForDriving
          && drivingConsecutiveRef.current === 1
        ) {
          const reqId = ++mapMatchApplySeqRef.current;
          void forceMapMatch(lat, lng, { refresh: true })
            .then((p) => {
              if (reqId !== mapMatchApplySeqRef.current) return;
              if (p && p.length >= 2) applyRoadMatchPoints(p);
            })
            .catch(() => {});
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
            ? kmh >= 1 || movedForSnap >= 8
            : kmh >= 3 || movedForSnap >= 22;
        if (isDrivingRef.current && accForMatch && feedMoveOk && feedSpeedOk) {
          void addMatchPosition(lat, lng, {
            speedKmh: kmh,
            accuracyM: loc.accuracy ?? null,
            noRoad,
          });
        }

        // Driving: odświeżenie osi drogi (force) + recovery gdy segment wygasł / API milczy.
        const nowMatch = Date.now();
        if (isDrivingRef.current && accForMatch) {
          if (noRoad) {
            const lr = lastDrivingRecoverMatchRef.current;
            const movedRec = lr ? haversineKm(lr.lat, lr.lng, lat, lng) * 1000 : Infinity;
            const minMove = 3;
            const minRec = 3;
            const minGap = 2600;
            const gapOk = !lr || nowMatch - lr.at > minGap;
            const movedOk = movedForSnap >= minMove && movedRec >= minRec;
            const sinceLastForce = lastForceMapMatchRef.current
              ? nowMatch - lastForceMapMatchRef.current.at
              : 999999;
            const bootstrapOk =
              !lr && sinceLastForce > 1400 && movedForSnap >= 2 && movedForSnap < minMove;
            const periodicStationary =
              lr && nowMatch - lr.at > 16_000 && movedForSnap < minMove;
            const longWaitNoRecover = !lr && sinceLastForce > 14_000;
            if (gapOk && (movedOk || bootstrapOk || periodicStationary || longWaitNoRecover)) {
              lastDrivingRecoverMatchRef.current = { at: nowMatch, lat, lng };
              const reqId = ++mapMatchApplySeqRef.current;
              void forceMapMatch(lat, lng, { refresh: true })
                .then((p) => {
                  if (reqId !== mapMatchApplySeqRef.current) return;
                  if (p && p.length >= 2 && isDrivingRef.current) applyRoadMatchPoints(p);
                })
                .catch(() => {});
            }
          } else {
            const ls = lastDrivingSoftRefreshRef.current;
            if (!ls) {
              lastDrivingSoftRefreshRef.current = { at: nowMatch, lat, lng };
            } else {
              const movedSoft = haversineKm(ls.lat, ls.lng, lat, lng) * 1000;
              if (movedSoft >= 48 && nowMatch - ls.at >= 58_000) {
                lastDrivingSoftRefreshRef.current = { at: nowMatch, lat, lng };
                const reqId = ++mapMatchApplySeqRef.current;
                void forceMapMatch(lat, lng, { refresh: true })
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
          || (
            movingForDriving
            && drivingConsecutiveRef.current >= DRIVING_CONSECUTIVE_REQ - 1
            && !drivingManuallyDisabledRef.current
          );

        const snapped = drivingSnap(lat, lng, kmh, false, hardRoadSnap, loc.accuracy ?? null);
        if (!Number.isFinite(snapped.latitude) || !Number.isFinite(snapped.longitude)) {
          console.warn('[GPS map] drivingSnap produced non-finite coord');
          return;
        }
        let appliedSnap = snapped;
        if (hardRoadSnap && !snapped.snapped) {
          const anchor = resolveDrivingAnchor();
          if (!anchor) {
            publishSpeed(rawSpeedMs);
            return;
          }
          const rawDistM = haversineKm(lat, lng, anchor.latitude, anchor.longitude) * 1000;
          if (rawDistM <= 100) {
            const blend = Math.min(1, rawDistM / 70) * 0.3;
            appliedSnap = {
              ...snapped,
              latitude: anchor.latitude + (lat - anchor.latitude) * blend,
              longitude: anchor.longitude + (lng - anchor.longitude) * blend,
              snapped: true,
            };
          } else {
            appliedSnap = { ...snapped, latitude: anchor.latitude, longitude: anchor.longitude, snapped: true };
          }
        } else if (hardRoadSnap && snapped.snapped && lastSetLocRef.current) {
          const jumpM = haversineKm(
            lastSetLocRef.current.lat, lastSetLocRef.current.lng,
            snapped.latitude, snapped.longitude,
          ) * 1000;
          const maxJumpM = isDrivingRef.current ? 42 : 28;
          if (jumpM > maxJumpM) {
            const c = clampCoordStep(
              { latitude: lastSetLocRef.current.lat, longitude: lastSetLocRef.current.lng },
              { latitude: snapped.latitude, longitude: snapped.longitude },
              maxJumpM,
            );
            appliedSnap = { ...snapped, latitude: c.latitude, longitude: c.longitude, snapped: true };
          }
        }
        if (hardRoadSnap && !snapped.snapped) {
          console.warn('[GPS map] drivingSnap returned raw — holding previous snapped anchor');
          drivingNoSnapStreakRef.current += 1;
          if (accForMatch) {
            const nowNoSnap = Date.now();
            const useManualRecover =
              drivingNoSnapStreakRef.current >= FORCE_MAP_MATCH_RECOVER_STREAK
              && (nowNoSnap - lastDrivingNoSnapForceRef.current) >= FORCE_MAP_MATCH_RECOVER_MIN_INTERVAL_MS;
            if (useManualRecover) {
              lastDrivingNoSnapForceRef.current = nowNoSnap;
            }
            gpsTelemetryRef.current.snapRecoveryCalls += 1;
            const reqId = ++mapMatchApplySeqRef.current;
            void forceMapMatch(lat, lng, useManualRecover ? { manual: true } : { refresh: true })
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
        if (trackDistance) {
          if (trackPassiveKm && !passiveTripStartedRef.current) {
            startTrip(0);
            passiveTripStartedRef.current = true;
          }
          const segKm = feedPosition(appliedSnap.latitude, appliedSnap.longitude, rawSpeedMs ?? undefined);
          if (segKm > 0) {
            recordDrivingTracePoint(appliedSnap.latitude, appliedSnap.longitude, { addDistanceKm: segKm, speedKmh: kmh }).catch(() => {});
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
          const resolved = resolveDrivingHeading(
            appliedSnap,
            lastHeadingRef.current,
            lastDrivingPosRef.current,
            loc.heading,
            kmh,
          );
          if (resolved != null) {
            drivingHeading = resolved;
            lastHeadingRef.current = drivingHeading;
            publishHeading(drivingHeading);
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
          if (kmh < GPS_IDLE_UI_LOCK_SPEED_KMH) {
            const maxFilteredUiM = maxIdleBrowsingJumpM(safeDtForSnappedUi, kmh, acc);
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
          if (movedUiM > GPS_IDLE_UI_HARD_JUMP_M && kmh < 15) {
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
          if (movedUiM > GPS_IDLE_UI_SOFT_JUMP_M && kmh < 10) {
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

        const drFreshForUi =
          (isDrivingRef.current || isNavigatingRef.current)
          && drLatRef.current !== 0
          && drLngRef.current !== 0
          && Date.now() - drLastFrameAtRef.current <= DR_STALE_MS;
        if (!drFreshForUi) {
          publishUserLocation({ latitude: appliedSnap.latitude, longitude: appliedSnap.longitude });
        }

        if (movingForDriving) {
          // ── Wymaga N kolejnych odczytów przed wejściem w driving
          drivingConsecutiveRef.current += 1;

          if (drivingStopTimerRef.current) {
            clearTimeout(drivingStopTimerRef.current);
            drivingStopTimerRef.current = null;
          }

          if (!isDrivingRef.current) {
            if (drivingManuallyDisabledRef.current) {
              publishSpeed(rawSpeedMs);
              return;
            }
            if (drivingConsecutiveRef.current < DRIVING_CONSECUTIVE_REQ) {
              publishSpeed(rawSpeedMs);
              return; // czekaj na potwierdzenie
            }
            isDrivingRef.current      = true;
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
            feedDR({ latitude: entryLat, longitude: entryLng }, rawSpeedMs ?? 0, drivingHeading);
            setIsDriving(true);
            recordDrivingTracePoint(entryLat, entryLng, { speedKmh: kmh }).catch(() => {});
            setFollowMode('drivingFollow');
            recenterTo({
              center: { latitude: entryLat, longitude: entryLng },
              heading: drivingHeading,
              speedKmh: Math.max(kmh, 20),
              active: true,
            });
            publishSpeed(rawSpeedMs);

            const lastForce = lastForceMapMatchRef.current;
            const movedFromLastForceM = lastForce
              ? haversineKm(lastForce.lat, lastForce.lng, lat, lng) * 1000
              : Infinity;
            const canForceMatch =
              !lastForce
              || Date.now() - lastForce.at >= FORCE_MAP_MATCH_COOLDOWN_MS
              || movedFromLastForceM >= FORCE_MAP_MATCH_MIN_MOVE_M;
            if (canForceMatch) {
              lastForceMapMatchRef.current = { at: Date.now(), lat, lng };
              const reqId = ++mapMatchApplySeqRef.current;
              void forceMapMatch(lat, lng, { manual: true })
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

          feedDR(
            { latitude: appliedSnap.latitude, longitude: appliedSnap.longitude },
            rawSpeedMs ?? 0,
            drivingHeading,
          );
          // Camera is now driven by DR onFrame at ~60fps (same as navigation mode)

        } else {
          // ── Wolno / stoi — reset licznika ────────────────────
          drivingConsecutiveRef.current = 0;

          // Keep DR anchored to the current snapped position even when stopped.
          // Without this, DR keeps extrapolating from its last feed point (which
          // may be the un-snapped GPS position), causing drLatRef to be
          // overwritten at 60fps with stale coordinates and undoing the snap.
          if (isDrivingRef.current) {
            feedDR(
              { latitude: appliedSnap.latitude, longitude: appliedSnap.longitude },
              0,
              drivingHeading,
            );
            // Kamera podąża za DR onFrame — tu tylko kotwica pozycji przy postoju.
          }

          if (isDrivingRef.current && !drivingStopTimerRef.current && !isNavigatingRef.current) {
            drivingStopTimerRef.current = setTimeout(() => {
              passiveTripStartedRef.current = false;
              const finalStats = finishTrip();
              isDrivingRef.current        = false;
              drivingLastLocRef.current   = null;
              lastDrivingPosRef.current   = null;
              drivingStopTimerRef.current = null;
              // Sync userLocation to last DR position before switching marker source
              // to prevent a visible teleport when isDriving flips to false.
              if (drLatRef.current !== 0 && drLngRef.current !== 0) {
                setUserLocation({ latitude: drLatRef.current, longitude: drLngRef.current });
              }
              setIsDriving(false);
              void flushPendingKm(true, {
                distanceKm: finalStats.distanceKm,
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
              if (exitLoc) {
                resetBrowseCamera({
                  latitude:  exitLoc.lat,
                  longitude: exitLoc.lng,
                });
              }
            }, DRIVING_STOP_DELAY_MS);
          }
        }

      } else {
        // ── Nawigacja — snap do trasy ─────────────────────────
        const navPts = routePointsRef.current;
        if (navPts.length > 1) {
          const navSnapped = snapToRoute(lat, lng, navPts, 35);
          // Distance/statistics for navigation should use snapped route position,
          // not raw filtered GPS (reduces jitter overcount and missing km spikes).
          feedPosition(navSnapped.latitude, navSnapped.longitude, rawSpeedMs ?? undefined);
          lastNavLocRef.current = { latitude: navSnapped.latitude, longitude: navSnapped.longitude };
          feedDR(
            { latitude: navSnapped.latitude, longitude: navSnapped.longitude },
            rawSpeedMs ?? 0,
            loc.heading ?? lastHeadingRef.current,
          );
        } else {
          // Fallback when route points are not available yet: keep DR in sync
          // with filtered GPS to avoid frozen marker position during navigation.
          feedDR(
            { latitude: lat, longitude: lng },
            rawSpeedMs ?? 0,
            loc.heading ?? lastHeadingRef.current,
          );
          feedPosition(lat, lng, rawSpeedMs ?? undefined);
          lastNavLocRef.current = { latitude: lat, longitude: lng };
        }
      }

      publishSpeed(rawSpeedMs);
    // clearStats / startTrip / routeInfo are read via stable refs (clearStats+startTrip from useTripStats are stable;
    // routeInfo via routeInfoRef) — do NOT list them here or every route preview tick tears down GPS watch.
    }, [drivingSnap, feedPosition, feedDR, startTrip, finishTrip, publishUserLocation, publishHeading, publishSpeed, setFollowMode, recenterTo, resetBrowseCamera, updateCameraFrame, addMatchPosition, getMatchedPoints, applyRoadMatchPoints, resetMapMatch, resetSnap, forceMapMatch, bumpMatchedFreshness, flushPendingKm, resolveDrivingAnchor, resyncSnapAfterRoadGeometry]),
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
      distanceKm: finalStats.distanceKm,
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
    if (isMapFocusedRef.current) startGPS();
    return () => {
      stopGPS();
      if (drivingStopTimerRef.current) clearTimeout(drivingStopTimerRef.current);
    };
  }, [locationReady, startGPS, stopGPS]);

  // Keep locationReadyRef in sync for use inside AppState/focus callbacks
  useEffect(() => { locationReadyRef.current = locationReady; }, [locationReady]);
  useEffect(() => { gpsAcquiringRef.current = gpsAcquiring; }, [gpsAcquiring]);

  useEffect(() => {
    if (!isMapFocused || !userLocation || !gpsAcquiring) return;
    feedDR(
      { latitude: userLocation.latitude, longitude: userLocation.longitude },
      0,
      lastHeadingRef.current || 0,
    );
  }, [isMapFocused, userLocation, gpsAcquiring, feedDR]);

  const restartGPSWatcher = useCallback((reason: 'foreground' | 'focus' | 'resume') => {
    const now = Date.now();
    if (now - lastGpsRestartAtRef.current < GPS_RESTART_COOLDOWN_MS) return;
    const fixAge = now - lastAcceptedFixWallClockRef.current;
    const bgPause = lastBackgroundAtRef.current > 0 ? now - lastBackgroundAtRef.current : 0;
    if (
      reason === 'focus'
      && fixAge < GPS_WATCHER_STALE_MS
      && bgPause < GPS_BACKGROUND_STALE_MS
      && !gpsAcquiringRef.current
    ) {
      if (__DEV__) console.log('[GPS] Skip watcher restart — fresh fix');
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
    startGPS();
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
          const navSnapped = snapToRoute(lat, lng, routePointsRef.current, 35);
          lastGoodLocRef.current = { lat: navSnapped.latitude, lng: navSnapped.longitude };
          lastNavLocRef.current = { latitude: navSnapped.latitude, longitude: navSnapped.longitude };
          publishUserLocation({ latitude: navSnapped.latitude, longitude: navSnapped.longitude }, true);
          feedPosition(navSnapped.latitude, navSnapped.longitude, speedMs);
          feedDR(
            { latitude: navSnapped.latitude, longitude: navSnapped.longitude },
            speedMs,
            lastHeadingRef.current,
          );
          lastAcceptedFixWallClockRef.current = Date.now();
          setGpsAcquiring(false);
          persistMapLocation(navSnapped.latitude, navSnapped.longitude, acc);
          gpsTelemetryRef.current.oneShotApplied += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_APPLY', JSON.stringify({ at: Date.now(), mode: 'navigation', snapped: true }));
          return;
        }

        if (isDrivingRef.current) {
          const matchedPts = getMatchedPoints();
          if (matchedPts && matchedPts.length > 1) applyRoadMatchPoints(matchedPts);
          const snapped = drivingSnap(lat, lng, speedKmh, false, true, acc);
          const fallbackAnchor =
            !snapped.snapped
              ? (
                (Number.isFinite(drLatRef.current) && Number.isFinite(drLngRef.current)
                  && drLatRef.current !== 0 && drLngRef.current !== 0
                  ? { latitude: drLatRef.current, longitude: drLngRef.current }
                  : (lastSetLocRef.current
                    ? { latitude: lastSetLocRef.current.lat, longitude: lastSetLocRef.current.lng }
                    : null))
              )
              : null;
          const appliedSnap = fallbackAnchor
            ? { ...snapped, latitude: fallbackAnchor.latitude, longitude: fallbackAnchor.longitude, snapped: true }
            : snapped;
          if (!snapped.snapped) {
            drivingNoSnapStreakRef.current += 1;
            const nowNoSnap = Date.now();
            const useManualRecover =
              drivingNoSnapStreakRef.current >= FORCE_MAP_MATCH_RECOVER_STREAK
              && (nowNoSnap - lastDrivingNoSnapForceRef.current) >= FORCE_MAP_MATCH_RECOVER_MIN_INTERVAL_MS;
            if (useManualRecover) {
              lastDrivingNoSnapForceRef.current = nowNoSnap;
            }
            gpsTelemetryRef.current.snapRecoveryCalls += 1;
            const reqId = ++mapMatchApplySeqRef.current;
            void forceMapMatch(lat, lng, useManualRecover ? { manual: true } : { refresh: true })
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
          } else {
            drivingNoSnapStreakRef.current = 0;
          }
          lastGoodLocRef.current = { lat: appliedSnap.latitude, lng: appliedSnap.longitude };
          drivingLastLocRef.current = { lat: appliedSnap.latitude, lng: appliedSnap.longitude };
          publishUserLocation({ latitude: appliedSnap.latitude, longitude: appliedSnap.longitude }, true);
          const segKm = feedPosition(appliedSnap.latitude, appliedSnap.longitude, speedMs);
          if (segKm > 0) {
            recordDrivingTracePoint(appliedSnap.latitude, appliedSnap.longitude, { addDistanceKm: segKm, speedKmh: speedKmh }).catch(() => {});
          }
          feedDR(
            { latitude: appliedSnap.latitude, longitude: appliedSnap.longitude },
            speedMs,
            lastHeadingRef.current,
          );
          lastAcceptedFixWallClockRef.current = Date.now();
          setGpsAcquiring(false);
          persistMapLocation(appliedSnap.latitude, appliedSnap.longitude, acc);
          gpsTelemetryRef.current.oneShotApplied += 1;
          if (__DEV__) console.log('[GPSDBG] ONE_SHOT_APPLY', JSON.stringify({ at: Date.now(), mode: 'driving', snapped: true }));
          return;
        }

        lastGoodLocRef.current = { lat, lng };
        lastAcceptedFixWallClockRef.current = Date.now();
        setGpsAcquiring(false);
        persistMapLocation(lat, lng, acc);
        console.log('[GPS] One-shot fix applied');
        gpsTelemetryRef.current.oneShotApplied += 1;
        if (__DEV__) console.log('[GPSDBG] ONE_SHOT_APPLY', JSON.stringify({ at: Date.now(), mode: 'idle' }));
        publishUserLocation({ latitude: lat, longitude: lng }, true);
      })
      .catch((e) => console.warn('[GPS] One-shot fix failed:', e));
  }, [drivingSnap, feedDR, feedPosition, forceMapMatch, getMatchedPoints, applyRoadMatchPoints, publishUserLocation, persistMapLocation]);

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
    if (__DEV__) console.log('[GPSDBG] RESUME_FLOW', JSON.stringify({ at: Date.now(), source }));
    ensureRegionBootstrapped(source);
    void loadMapLastLocation().then((cached) => {
      if (!cached) return;
      if (!locationReadyRef.current || !currentLocRef.current) {
        applyBootstrapLocation(cached.latitude, cached.longitude, {
          approximate: true,
          accuracy: cached.accuracy,
        });
      } else {
        lastGoodLocRef.current = { lat: cached.latitude, lng: cached.longitude };
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
    const now = Date.now();
    if (now - lastResumeHandledAtRef.current < GPS_RESUME_DEDUPE_MS) return;
    lastResumeHandledAtRef.current = now;
    const fixAgeMs = now - lastAcceptedFixWallClockRef.current;
    if (!lastAcceptedFixWallClockRef.current || fixAgeMs > GPS_RESUME_SPINNER_MIN_AGE_MS) {
      setGpsAcquiring(true);
    } else {
      setGpsAcquiring(false);
    }
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

    // Po odblokowaniu: natychmiastowy fix (bez czekania na DR „dopływający” po linii prostej).
    if (isNavigatingRef.current || isDrivingRef.current) {
      resetDR();
      refreshLocationOneShot({ force: true });
    }
  }, [restartGPSWatcher, refreshLocationOneShot, startGPS, ensureRegionBootstrapped, applyBootstrapLocation, resetDR]);
  const handleGpsResumeRef = useRef(handleGpsResume);
  useEffect(() => {
    handleGpsResumeRef.current = handleGpsResume;
  }, [handleGpsResume]);
  const stopGPSRef = useRef(stopGPS);
  useEffect(() => {
    stopGPSRef.current = stopGPS;
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
      if (nextState === 'background' || nextState === 'inactive') {
        lastBackgroundAtRef.current = Date.now();
        const keepForegroundWatcher =
          !settings.backgroundTracking
          && (isDrivingRef.current || isNavigatingRef.current);
        if (!keepForegroundWatcher) {
          stopGPSRef.current();
        }
        const keepTripMotion = isDrivingRef.current || isNavigatingRef.current;
        if (!keepTripMotion) {
          stopDRRef.current();
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
        stopGPSRef.current();
        stopDRRef.current();
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

      setUserLocation({ latitude: lat, longitude: lng });
      setSpeed(speedMs);
      setHeading(hdg);

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
        const snapped = snapToRoute(lat, lng, points, 35);
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
    if (!offRoute || !rerouteResult || !userLocation) return;
    reroutePendingRef.current = false;
    setNavStartLoc({ ...userLocation, name: 'Moja pozycja' });
    setCurrentStep(0);
    announcedPhasesRef.current = new Set();
    lastSpokenRef.current    = '';
    setOffRoute(false);
    setRerouteOrigin(null); // clear so hook doesn't keep the stale request alive
  }, [rerouteResult, offRoute, userLocation]);

  // ── Reroute origin management (cooldown gate) ─────────────────────────────
  // Only update rerouteOrigin when:
  //   - offRoute just became true AND
  //   - REROUTE_COOLDOWN_MS has elapsed since the last reroute, OR
  //   - user moved REROUTE_MIN_MOVED_M from the point that triggered the last reroute.
  // This prevents the Directions API from being called on every GPS tick while
  // the user is continuously off-route.
  useEffect(() => {
    if (!offRoute) {
      setRerouteOrigin(null);
      reroutePendingRef.current = false;
      return;
    }
    if (!userLocation || !endLocation) return;
    if (reroutePendingRef.current) return;

    const now   = Date.now();
    const since = now - lastRerouteTimeRef.current;

    // Cooldown check: only enter this block when time budget has NOT yet expired.
    // The haversine distance is computed only here — once the cooldown expires,
    // we skip straight to triggering the reroute without any distance calculation.
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

  const activeRoute = isNavigating ? navRoute : previewRoute;
  navRouteRef.current = navRoute ?? null;
  const activeSteps = navRoute?.steps ?? previewRoute?.steps ?? [];

  useEffect(() => {
    setSnapPoints(activeRoute?.points ?? []);
  }, [activeRoute, setSnapPoints]);

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
    routePointsRef.current = activeRoute?.points ?? [];
  }, [activeRoute]);

  useEffect(() => {
    const points = activeRoute?.points;
    if (!points?.length) { setRemainingRoutePoints([]); return; }
    if (!isNavigating || !userLocation) {
      setRemainingRoutePoints(points); return;
    }
    const snapped = snapToRoute(userLocation.latitude, userLocation.longitude, points, 35);
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
    const stepData = navRoute?.steps?.[currentStep];
    if (!stepData) return;
    showNavigationNotification(stepData, routeInfo?.distance ?? '', routeInfo?.durationText ?? '');
  }, [currentStep, isNavigating, navRoute]);

  useEffect(() => {
    if (!userLocation) return;
    if (!isSharing) { setNearbyUsers([]); return; }
    setNearbyUsers(
      liveUsers
        .filter(u => String(u.id) !== String(currentUserId))
        .map(u => ({
          id: String(u.id), name: u.username,
          latitude: u.lat, longitude: u.lng,
          avatar: u.avatarUrl ?? '🚗', status: 'Online' as const, isFriend: false,
          isPremium: u.isPremium ?? false,
        })),
    );
  }, [liveUsers, currentUserId, userLocation, isSharing]);

  useDemoUsers(
    locationReady && isMapFocused && !isNavigating && !isSharing,
    useCallback((users) => setDemoUsers(users), []),
    userLocation?.latitude,
    userLocation?.longitude,
    1000,
  );

  // ─────────────────────────────────────────────────────────
  const visibleUsers = useMemo(() => {
    if (!userLocation) return [];
    return nearbyUsers
      .filter(u =>
        u.isFriend ||
        calculateDistance(
          userLocation.latitude, userLocation.longitude,
          u.latitude, u.longitude,
        ) <= MAX_NEARBY_USERS_DISTANCE,
      )
      .slice(0, 24);
  }, [userLocation, nearbyUsers]);

  const getUserMarkerSignature = useCallback((u: User): string => (
    `${u.avatar ?? ''}|${u.name}|${u.isFriend ? '1' : '0'}|${u.isPremium ? '1' : '0'}`
  ), []);

  useEffect(() => {
    const activeIds = new Set(visibleUsers.map((u) => u.id));
    setMarkerImages((prev) => {
      const next: Record<string, string> = {};
      Object.keys(prev).forEach((id) => {
        if (activeIds.has(id)) next[id] = prev[id];
      });
      return next;
    });
    setMarkerImageSignatures((prev) => {
      const next: Record<string, string> = {};
      Object.keys(prev).forEach((id) => {
        if (activeIds.has(id)) next[id] = prev[id];
      });
      return next;
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
    const liveCenter = ((isNavigating || isDriving) && drLatRef.current !== 0 && drLngRef.current !== 0)
      ? { latitude: drLatRef.current, longitude: drLngRef.current }
      : userLocation;
    if (!liveCenter) return;
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
  }, [userLocation, isNavigating, isDriving, recenterTo, resetBrowseCamera]);

  // ── handleArrived ─────────────────────────────────────────
  const handleArrived = useCallback(async () => {
    isNavigatingRef.current = false;
    setNavigatingFlag(false).catch(() => {});
    stopDR();
    const finalStats = finishTrip();
    setTimeout(() => setTripStatsVisible(true), 2000);
    setIsNavigating(false);
    setArrived(true);
    setDistToTurnM(null);
    setRemainingDistKm(null);
    notifThrottleRef.current = 0;
    dismissNavigationNotification();
    flushNavigationStatsOnce(finalStats);
    Speech.stop().catch(() => {});
    speak('Dotarłeś do celu!');
    Toast.show({ type: 'success', text1: '🏁 DOTARŁEŚ DO CELU!', text2: endLocation?.name ?? '' });

    if (routeInfo?.distance) onNavigationComplete(parseFloat(routeInfo.distance));
    if (userLocation) resetBrowseCamera(userLocation);

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
  ]);

  useEffect(() => {
    if (!isNavigating || !navRoute?.steps?.length) {
      navRouteIdxRef.current = -1;
      return;
    }

    const steps  = navRoute.steps;
    const points = navRoute.points ?? [];

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
        ? snapToRoute(currentLat, currentLng, points, 35)
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
        const onRoad = isOnRoute(lat, lng, points, REROUTE_THRESHOLD_M);
        if (!onRoad && !offRouteRef.current) {
          offRouteRef.current = true;
          setOffRoute(true);
          clearTimeout(rerouteTimerRef.current);
          rerouteTimerRef.current = setTimeout(() => {
            offRouteRef.current = false;
            setOffRoute(false);
          }, 3000);
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
  }, [isNavigating, navRoute, endLocation, handleArrived, showNavigationNotification, speak]);

  // ── beginNavigation ───────────────────────────────────────
  const beginNavigation = useCallback(() => {
    if (!userLocation) return;

    exitDrivingMode({ skipFlush: true });

    startTrip(routeInfo?.duration ?? 0);
    passiveTripStartedRef.current = true;
    navStatsFlushedRef.current = false;

    resetDRRefs();
    setFollowMode('navigationFollow');
    isNavigatingRef.current = true;

    lastNavLocRef.current = null;
    resetSpeedStats();
    // Keep pending passive km; final nav flush merges bg pending with nav stats.
    setNavigatingFlag(true).catch(() => {});
    resetDR();
    navLatFilter.reset();
    navLngFilter.reset();
    startIsMyLocationRef.current = false;
    lastSpokenRef.current        = '';
    announcedPhasesRef.current   = new Set();

    const navStart = { ...userLocation, name: 'Moja pozycja' };
    setIsNavigating(true);
    setNavStartLoc(navStart);
    setStartLocation(navStart);
    setCurrentStep(0);
    setArrived(false);
    setOffRoute(false);

    // ── Offroad: ustaw punkty z załadowanej trasy ─────────
    if (isOffroadRef.current) {
      const pts = offroadLoadedPointsRef.current.length > 1
        ? offroadLoadedPointsRef.current
        : (activeRoute?.points ?? []);
      offroadPointsRef.current = pts;
      routePointsRef.current   = pts;
    }

    if (routeInfo?.duration) onNavigationStart(routeInfo.duration);
    if (pendingRouteRef.current) {
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
      recenterTo, resetDR, resetDRRefs, exitDrivingMode, activeRoute]);

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
            setEndLocation(startLocation);
            setStartLocation({ ...userLocation, name: 'Moja pozycja' });
          }},
          { text: 'Startuj z mojej pozycji', onPress: () => {
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
    setIsNavigating(false);
    setOffRoute(false);
    setArrived(false);
    setNavStartLoc(null);
    setDistToTurnM(null);
    setRemainingDistKm(null);
    notifThrottleRef.current = 0;
    dismissNavigationNotification();
    setRouteEndpointImages({});
    Speech.stop().catch(() => {});
    clearTimeout(rerouteTimerRef.current);
    onNavigationCancel();
    const finalStats = finishTrip();
    passiveTripStartedRef.current = false;
    flushNavigationStatsOnce(finalStats);
    pendingRouteRef.current = null;

    if (timerRunning) {
      const elapsed = stopTimer();
      const routeId = leaderboardRouteId;

      if (routeId && elapsed > 30) {
        await saveRun(routeId, elapsed);
        Toast.show({ type: 'info', text1: '⏹️ NAWIGACJA ZATRZYMANA', text2: `Czas: ${formatElapsed(elapsed)}` });
        await Promise.all([fetchLeaderboard(routeId), fetchRuns(routeId)]);
        setMyFinishedTime(elapsed);
        setTimeout(() => setLeaderboardVisible(true), 800);
      } else {
        resetTimer();
        clearStats();
        Toast.show({ type: 'info', text1: 'NAWIGACJA ZATRZYMANA' });
      }
    } else {
      Toast.show({ type: 'info', text1: 'NAWIGACJA ZATRZYMANA' });
    }

    if (userLocation) {
      startIsMyLocationRef.current = true;
      setStartLocation({ ...userLocation, name: 'Moja pozycja' });
      resetBrowseCamera(userLocation);
    }
  }, [
    userLocation, resetBrowseCamera, onNavigationCancel, flushNavigationStatsOnce,
    timerRunning, stopTimer, resetTimer, formatElapsed, elapsedSec,
    leaderboardRouteId, saveRun, fetchLeaderboard, fetchRuns, resetDRRefs,
  ]);

  useAutoNavigationBridge({
    isNavigating,
    isDriving,
    isBuilding,
    arrived,
    offRoute,
    currentStep,
    navStep: navRoute?.steps?.[currentStep] ?? null,
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
    navRoutePoints: navRoute?.points,
    previewRoutePoints: previewRoute?.points,
    builderPins: pins,
    builderRoutePoints: snappedRoute,
    visibleUsers,
    warnings,
    speedCameras: snappedCameras,
    fuelStations,
    onStopRequested: () => { stopNavigation(); },
    onReportRequested: () => { setReportVisible(true); },
    onReportTypeRequested: (type) => { void handleReport(type); },
  });

  const handleReset = useCallback(() => {
    if (isNavigating) stopNavigation();
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
  }, [isNavigating, stopNavigation]);

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

  void drUiTick;

  const hasFiniteDrPos =
    Number.isFinite(drLatRef.current) &&
    Number.isFinite(drLngRef.current) &&
    Math.abs(drLatRef.current) > 1e-6 &&
    Math.abs(drLngRef.current) > 1e-6 &&
    Date.now() - drLastFrameAtRef.current <= DR_STALE_MS;
  const useDrMarker = hasFiniteDrPos && (isNavigating || isDriving);
  const markerLat = useDrMarker
    ? drLatRef.current
    : (userLocation?.latitude ?? NaN);

  const markerLng = useDrMarker
    ? drLngRef.current
    : (userLocation?.longitude ?? NaN);

  const markerHdg = useDrMarker && drHdgRef.current !== 0
    ? drHdgRef.current
    : lastHeadingRef.current !== 0
      ? lastHeadingRef.current
      : heading;

  // ── Czy pokazać prędkościomierz (lewy) — w trybie jazdy prędkość + limit są w górnym HUD ──
  const isRoutePreviewOpen = !isNavigating && !isBuilding && !!startLocation && !!endLocation;
  const showSpeedPanel =
    !isRoutePreviewOpen
    && (isNavigating || (!isDriving && (speedKmh > 5 || speedLimit !== null)));

  const drivingGoalDistKm =
    isDriving && !isNavigating && endLocation
    && Number.isFinite(markerLat) && Number.isFinite(markerLng)
      ? haversineKm(markerLat, markerLng, endLocation.latitude, endLocation.longitude)
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

        {gpsAcquiring && (
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
        {userLocation && visibleUsers.map(user =>
          (() => {
            const signature = getUserMarkerSignature(user);
            return !markerImages[user.id] || markerImageSignatures[user.id] !== signature;
          })() ? (
            <MarkerRenderer
              key={`renderer_${user.id}_${getUserMarkerSignature(user)}`}
              user={user}
              distance={calculateDistance(
                userLocation.latitude, userLocation.longitude,
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
        <Mapbox.MapView
          ref={mapRef}
          style={{ flex: 1 }}
          styleURL={mapStyle}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          // TextureView zamiast GLSurfaceView — typowa poprawka na Androidzie gdy mapa
          // „staje” po przejściu do innej apki i powrocie (kompozycja widoku / lifecycle).
          surfaceView={Platform.OS === 'android' ? false : undefined}
          pitchEnabled
          rotateEnabled
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
            // `isUserInteraction` can be true for programmatic camera animations on
            // some Android builds. Trust explicit gesture signal only, otherwise
            // follow mode can be disabled during navigation/driving.
            if (e?.gestures?.isGestureActive) markUserGesture();
          }}
        >
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{
              centerCoordinate: userLocation
                ? [userLocation.longitude, userLocation.latitude]
                : lastMapCenterRef.current,
              zoomLevel: 14,
              pitch: enableThreeDScene ? BROWSE_3D_PITCH : 0,
            }}
          />
          <Mapbox.UserLocation visible={false} />
          {enableThreeDScene && (
            <>
              <Mapbox.RasterDemSource
                id="mapboxTerrainDem"
                url="mapbox://mapbox.mapbox-terrain-dem-v1"
                tileSize={512}
                maxZoomLevel={14}
              />
              <Mapbox.Terrain id="mapboxTerrain3d" sourceID="mapboxTerrainDem" style={{ exaggeration: 1.15 }} />
              <Mapbox.SkyLayer
                id="mapboxSkyAtmosphere"
                style={{
                  skyType: 'atmosphere',
                  skyAtmosphereSun: [0.0, 90.0],
                  skyAtmosphereSunIntensity: 12,
                }}
              />
            </>
          )}
          {showThreeDBuildings && (
            <Mapbox.FillExtrusionLayer
              id="mapbox3dBuildings"
              sourceID="composite"
              sourceLayerID="building"
              filter={['==', ['get', 'extrude'], 'true']}
              minZoomLevel={BUILDINGS_3D_MIN_ZOOM}
              style={{
                fillExtrusionColor: isDark ? '#2f2f35' : '#d6d8de',
                fillExtrusionOpacity: 0.88,
                fillExtrusionHeight: ['coalesce', ['get', 'height'], 18],
                fillExtrusionBase: ['coalesce', ['get', 'min_height'], 0],
                fillExtrusionVerticalGradient: true,
              }}
            />
          )}

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

          {fuelStations.map(station => (
            <FuelStationMarker
              key={`fuel_${station.id}`}
              station={station}
              onPress={() => { setSelectedFuelStation(station); setFuelStationModalVisible(true); }}
            />
          ))}

          {isBuilding && displaySnappedRoute.length > 1 && (
            <>
              <Mapbox.ShapeSource id="snappedShadowSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: displaySnappedRoute.map((c: any) => [c.longitude, c.latitude]) }, properties: {} }}>
                <Mapbox.LineLayer id="snappedShadowLayer" style={{ lineColor: '#00000070', lineWidth: 10, lineCap: 'round', lineJoin: 'round' }} />
              </Mapbox.ShapeSource>
              <Mapbox.ShapeSource id="snappedRouteSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: displaySnappedRoute.map((c: any) => [c.longitude, c.latitude]) }, properties: {} }}>
                <Mapbox.LineLayer id="snappedRouteLayer" style={{ lineColor: '#e33835', lineWidth: 6, lineCap: 'round', lineJoin: 'round' }} />
              </Mapbox.ShapeSource>
              <Mapbox.ShapeSource id="snappedGlowSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: displaySnappedRoute.map((c: any) => [c.longitude, c.latitude]) }, properties: {} }}>
                <Mapbox.LineLayer id="snappedGlowLayer" style={{ lineColor: '#ffffff20', lineWidth: 3, lineCap: 'round', lineJoin: 'round' }} />
              </Mapbox.ShapeSource>
            </>
          )}

          {isBuilding && pins.length > 1 && snappedRoute.length === 0 && (
            <>
              <Mapbox.ShapeSource id="pinsShadowSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: pins.map(p => [p.longitude, p.latitude]) }, properties: {} }}>
                <Mapbox.LineLayer id="pinsShadowLayer" style={{ lineColor: '#00000080', lineWidth: 8, lineCap: 'round', lineJoin: 'round' }} />
              </Mapbox.ShapeSource>
              <Mapbox.ShapeSource id="pinsDashedSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: pins.map(p => [p.longitude, p.latitude]) }, properties: {} }}>
                <Mapbox.LineLayer id="pinsDashedLayer" style={{ lineColor: '#ff922b', lineWidth: 4, lineDasharray: [12, 7], lineCap: 'round', lineJoin: 'round' }} />
              </Mapbox.ShapeSource>
            </>
          )}

          {userLocation && visibleUsers.map(user => (
            <UserCarMarker
              key={`user_${user.id}`}
              user={user}
              distance={calculateDistance(
                userLocation.latitude, userLocation.longitude,
                user.latitude, user.longitude,
              )}
              onPress={() => handleUserMarkerPress(user)}
              imageUri={markerImages[user.id] ?? null}
            />
          ))}

          {remainingRoutePoints.length > 1 && !arrived && (
            <>
              <Mapbox.ShapeSource id="routeShadowSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: remainingRoutePoints.map((c: any) => [c.longitude, c.latitude]) }, properties: {} }}>
                <Mapbox.LineLayer id="routeShadowLayer" style={{ lineColor: '#00000055', lineWidth: 11, lineCap: 'round', lineJoin: 'round' }} />
              </Mapbox.ShapeSource>
              <Mapbox.ShapeSource id="routeMainSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: remainingRoutePoints.map((c: any) => [c.longitude, c.latitude]) }, properties: {} }}>
                <Mapbox.LineLayer id="routeMainLayer" style={{ lineColor: isNavigating ? '#e33835dd' : '#00bfff', lineWidth: 6, lineCap: 'round', lineJoin: 'round' }} />
              </Mapbox.ShapeSource>
              {isNavigating && (
                <Mapbox.ShapeSource id="routeGlowSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: remainingRoutePoints.map((c: any) => [c.longitude, c.latitude]) }, properties: {} }}>
                  <Mapbox.LineLayer id="routeGlowLayer" style={{ lineColor: '#ffffff15', lineWidth: 8, lineCap: 'round', lineJoin: 'round' }} />
                </Mapbox.ShapeSource>
              )}
            </>
          )}

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

          {clusteredWarnings
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

          {/* CarMarker rendered last — always on top of all other markers */}
          {userLocation && Number.isFinite(markerLat) && Number.isFinite(markerLng) && (
            <DrPositionMarker
              latitude={markerLat}
              longitude={markerLng}
              heading={markerHdg}
              avatarUrl={settings.locationMarkerStyle === 'arrow' ? null : myAvatarUrl}
              imageUri={settings.locationMarkerStyle === 'arrow' ? arrowMarkerImage : carMarkerImage}
            />
          )}
        </Mapbox.MapView>
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
            ) : null
          )
        )}

        {/* ── Off-route banner ─────────────────────────────── */}
        {isNavigating && offRoute && !isOffroadRef.current && (
          <View style={{
            position: 'absolute', top: 110,
            left: 12, right: 12,
            backgroundColor: '#ff922b18', borderRadius: 12,
            borderWidth: 1, borderColor: '#ff922b45',
            padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 20,
          }}>
            <MaterialIcons name="warning" size={18} color="#ff922b" />
            <Text style={{ color: '#ff922b', fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>
              PRZELICZAM TRASĘ...
            </Text>
            <ActivityIndicator size="small" color="#ff922b" style={{ marginLeft: 'auto' }} />
          </View>
        )}

        {/* ── Prędkościomierz (nawigacja + driving mode) ───── */}
        {showSpeedPanel && (
          <View style={[
            styles.speedPanelNav,
            !isNavigating && { bottom: 200 },
          ]}>
            {/* Znak ograniczenia prędkości — zawsze widoczny */}
            <View style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: '#fff', borderWidth: 4,
              borderColor: effectiveSpeedLimit !== null && speedKmh > effectiveSpeedLimit + SPEED_LIMIT_TOLERANCE ? '#e33835' : '#333',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 4, alignSelf: 'center',
            }}>
              <Text style={{
                fontFamily: 'Orbitron', fontSize: 11, fontWeight: '900',
                color: effectiveSpeedLimit !== null && speedKmh > effectiveSpeedLimit + SPEED_LIMIT_TOLERANCE ? '#e33835' : '#111',
              }}>
                {effectiveSpeedLimit ?? '—'}
              </Text>
            </View>
            <Text style={[
              styles.speedValue,
              effectiveSpeedLimit !== null && speedKmh > effectiveSpeedLimit + SPEED_LIMIT_TOLERANCE && { color: '#e33835' },
            ]}>
              {formatSpeed(speed)}
            </Text>
            <Text style={styles.speedLabel}>KM/H</Text>
          </View>
        )}

        {/* ── Tryb jazdy: górny HUD (prawie pełna szerokość) — prędkość, limit, dystans do celu ── */}
        {isDriving && !isNavigating && (
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
                  <Text style={{
                    fontFamily: 'Orbitron',
                    fontSize: 30,
                    fontWeight: '900',
                    color: effectiveSpeedLimit !== null && speedKmh > effectiveSpeedLimit + SPEED_LIMIT_TOLERANCE ? '#e33835' : '#fff',
                    letterSpacing: -1,
                    marginTop: 2,
                  }}>
                    {formatSpeed(speed)}
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#ffffff55', fontWeight: '700' }}> km/h</Text>
                  </Text>
                </View>
              </View>
              {(() => {
                const overLimit = effectiveSpeedLimit !== null && speedKmh > effectiveSpeedLimit + SPEED_LIMIT_TOLERANCE;
                const smallFont = effectiveSpeedLimit != null && effectiveSpeedLimit >= 100;
                return (
                  <View style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: '#fff',
                    borderWidth: 3,
                    borderColor: overLimit ? '#e33835' : '#222',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Text style={{
                      fontFamily: 'Orbitron',
                      fontSize: smallFont ? 10 : 13,
                      fontWeight: '900',
                      color: overLimit ? '#e33835' : '#111',
                    }}>
                      {effectiveSpeedLimit ?? '—'}
                    </Text>
                  </View>
                );
              })()}
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
                    {(!isOffroadRoute && previewLoading) || !routeInfo
                      ? <ActivityIndicator size="small" color="#e33835ce" style={{ marginTop: 2 }} />
                      : <Text style={styles.statValue}>{routeInfo.distance} km</Text>
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
                    {(!isOffroadRoute && previewLoading) || !routeInfo
                      ? <ActivityIndicator size="small" color="#e33835ce" style={{ marginTop: 2 }} />
                      : isOffroadRoute
                        ? <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#ff922b', fontWeight: '700' }}>—</Text>
                        : <Text style={styles.statValue}>{formatDuration(routeInfo.duration)}</Text>
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