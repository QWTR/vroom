import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Mapbox from '@rnmapbox/maps';
import { useKeepAwake } from 'expo-keep-awake';
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
  NativeModules,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { MAPBOX_TOKEN } from '../../constants/mapConfig';
import { useTheme } from '../../contexts/ThemeContext';
import { useChat } from '../../hooks/useChats';
import { makeMapStyles } from '../../styles/mapstyle';
Mapbox.setAccessToken(MAPBOX_TOKEN);

const { UsersModule } = NativeModules;

import {
  MAPBOX_STYLE_DARK,
  MAPBOX_STYLE_LIGHT,
  MAPBOX_STYLE_SATELLITE,
  MAPBOX_STYLE_HYBRID,
  MAX_NEARBY_USERS_DISTANCE
} from '../../constants/mapConfig';
import { LocationState, RouteInfo, User } from '../../constants/types';

import { latFilter, lngFilter, navLatFilter, navLngFilter, drivLatFilter, drivLngFilter } from '../../scripts/kalmanFilter';
// ── NOWE: sanity check ────────────────────────────────────
import { isSaneLocation } from '../../scripts/kalmanFilter';

import { useAdaptiveGPS } from '../../hooks/useAdaptiveGPS';
import {
  BG_PENDING_KM_KEY,
  feedNavDistance,
  feedSpeedSample,
  resetSpeedStats,
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
import { calculateDistance } from '../../scripts/distance';
import {
  bearingBetween,
  cleanInstruction,
  detectCurrentStep,
  findClosestPointIndex,
  formatDuration,
  formatSpeed,
  getManeuverIcon,
  haversineKm,
  isOnRoute,
  snapToRoute,
} from '../../scripts/navigationUtils';

import { RouteEndpointRenderer } from '@/components/markers/RouteEndpointRenderer';
import { ArrowMarkerRenderer } from '../../components/markers/ArrowMarkerRenderer';
import { CarMarker } from '../../components/markers/CarMarker';
import { CarMarkerRenderer } from '../../components/markers/CarMarkerRenderer';
import { MarkerRenderer } from '../../components/markers/MarkerRenderer';
import { RoutePinRenderer } from '../../components/markers/RoutePinRenderer';
import { SpeedCameraMarker } from '../../components/markers/SpeedCameraMarker';
import { SpeedCameraRenderer } from '../../components/markers/SpeedCameraRenderer';
import { UserCarMarker } from '../../components/markers/UserCarMarker';
import { AddSpeedCameraModal } from '../../components/modals/AddSpeedCameraModal';
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

// ─────────────────────────────────────────────────────────────────────────────
const REROUTE_THRESHOLD_M = 40;
const ANNOUNCE_M          = 250;
const NAV_ZOOM            = 18.5;
const NAV_PITCH           = 62;

// ── Cost-optimization thresholds ─────────────────────────────────────────────
// Set DEBUG_NETWORK = true to see throttle/suppression logs in the console.
const DEBUG_NETWORK = false;

// Live location sharing — interval + distance/time gate
const SEND_INTERVAL_MS    = 5_000;  // poll period (ms)
const SEND_MIN_DIST_M     = 15;     // min movement before sending (saves bandwidth while stationary)
const SEND_MAX_ELAPSED_MS = 20_000; // heartbeat: force-send after this long even without movement

// updateCameras + updateSpeedLimit — skip if user hasn't moved this far
// (each hook also has its own internal throttle; this gate prevents even the
//  cheap recalc/sort from running on every sub-second GPS tick)
const CAMERA_SPEED_LIMIT_GATE_M = 30; // meters

// Reroute cooldown — avoids hammering Directions API while continuously off-route
const REROUTE_COOLDOWN_MS = 30_000; // minimum ms between reroute requests
const REROUTE_MIN_MOVED_M = 200;    // OR allow early reroute if user moved this far from last point

// ─── Adaptive camera zoom ─────────────────────────────────────────────────────
// faster = smaller zoom (farther), slower = larger zoom (closer)
const ZOOM_NEAR           = 17.5; // 0–20 km/h
const ZOOM_MID            = 17.1; // ~60 km/h
const ZOOM_FAR            = 16.5; // 120+ km/h
const ZOOM_SMOOTHING_ALPHA = 0.15; // low-pass filter weight (0 = no change, 1 = instant)

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function zoomFromSpeedKmh(speedKmh: number): number {
  const s = Math.max(0, speedKmh);
  if (s <= 20)  return ZOOM_NEAR;
  if (s <= 60)  return lerpNum(ZOOM_NEAR, ZOOM_MID, (s - 20) / 40);
  if (s <= 120) return lerpNum(ZOOM_MID,  ZOOM_FAR,  (s - 60) / 60);
  return ZOOM_FAR;
}

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

// ─────────────────────────────────────────────────────────────────────────────
export default function MapScreen() {
  useKeepAwake(); 

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
  const rerouteTimerRef      = useRef<any>(null);
  const announcedStepRef     = useRef(-1);
  const isSpeechRef          = useRef(true);
  const startIsMyLocationRef = useRef(false);
  const pendingRouteRef      = useRef<{ id: number; name: string } | null>(null);


  const drivingConsecutiveRef = useRef(0);       // ile z rzędu odczytów ponad próg
  const DRIVING_CONSECUTIVE_REQ = 4;             // wymagane kolejne odczyty zanim wejdziemy w driving
  const lastSetLocRef = useRef<{ lat: number; lng: number } | null>(null);
  const MIN_MOVE_M = 8;                          // ignoruj ruch < 8m gdy wolno


  // ── Refs – dead-reckoning ─────────────────────────────────
  const drLatRef    = useRef(0);
  const drLngRef    = useRef(0);
  const drHdgRef    = useRef(0);
  const drTickRef   = useRef(0);

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
  // currentLocRef: latest userLocation readable inside stable interval callbacks
  const currentLocRef       = useRef<{ latitude: number; longitude: number } | null>(null);

  // ── NOWE Refs — GPS sanity + driving mode ─────────────────
  const lastGoodLocRef        = useRef<{ lat: number; lng: number } | null>(null);
  const drivingStopTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDrivingRef          = useRef(false);
  const drivingManuallyDisabledRef = useRef(false);
  const drivingKmRef          = useRef(0);
  const drivingLastLocRef     = useRef<{ lat: number; lng: number } | null>(null);
  const lastDrivingPosRef     = useRef<{ lat: number; lng: number } | null>(null);
  const lastGoodTimeRef       = useRef<number>(Date.now());
  // Tracks the timestamp of the previous GPS tick for per-tick distance capping.
  const prevGoodTimeRef       = useRef<number>(Date.now());
  const smoothedZoomRef       = useRef<number>(NAV_ZOOM);

  // Adaptive zoom — low-pass filtered zoom based on current speed
  // Defined early so it can be referenced in useDeadReckoning / onLocation / simulator callbacks below
  const getAdaptiveZoom = useCallback((speedKmhValue: number): number => {
    const target = zoomFromSpeedKmh(speedKmhValue);
    const prev   = smoothedZoomRef.current;
    const next   = prev * (1 - ZOOM_SMOOTHING_ALPHA) + target * ZOOM_SMOOTHING_ALPHA;
    smoothedZoomRef.current = clampNum(next, ZOOM_FAR, ZOOM_NEAR);
    return smoothedZoomRef.current;
  }, []);
  
  // ── State – lokalizacja ───────────────────────────────────
  const [userLocation,  setUserLocation]  = useState<LocationState | null>(null);
  const [startLocation, setStartLocation] = useState<LocationState | null>(null);
  const [endLocation,   setEndLocation]   = useState<LocationState | null>(null);
  const [region,        setRegion]        = useState<any>(null);
  const [heading,       setHeading]       = useState(0);
  const [speed,         setSpeed]         = useState<number | null>(null);
  const [locationReady, setLocationReady] = useState(false);

  // ── State – nawigacja ─────────────────────────────────────
  const [isNavigating, setIsNavigating] = useState(false);
  const [navStartLoc,  setNavStartLoc]  = useState<LocationState | null>(null);
  const [currentStep,  setCurrentStep]  = useState(0);
  const [offRoute,     setOffRoute]     = useState(false);
  // rerouteOrigin is set (with cooldown) when user goes off-route.
  // Using a dedicated state instead of `userLocation` prevents the
  // reroute Directions hook from re-firing on every GPS tick while off-route.
  const [rerouteOrigin, setRerouteOrigin] = useState<LocationState | null>(null);
  const [arrived,      setArrived]      = useState(false);
  const [routeInfo,    setRouteInfo]    = useState<RouteInfo | null>(null);
  const [isOffroadRoute, setIsOffroadRoute] = useState(false);

  // ── State – dr tick ───────────────────────────────────────
  const [drTick, setDrTick] = useState(0);

  // ── NOWY State — tryb driving ─────────────────────────────
  const [isDriving,    setIsDriving]    = useState(false);
  const [drivingKm,    setDrivingKm]    = useState(0);   // km przejechane w trybie

  // ── State — live distances (nawigacja) ────────────────────
  const [distToTurnM,     setDistToTurnM]     = useState<number | null>(null);
  const [remainingDistKm, setRemainingDistKm] = useState<number | null>(null);

  // ── State – markery ───────────────────────────────────────
  const [carMarkerImage,      setCarMarkerImage]      = useState<string | null>(null);
  const [arrowMarkerImage,    setArrowMarkerImage]    = useState<string | null>(null);
  const [myAvatarUrl,         setMyAvatarUrl]         = useState<string | null>(null);
  const [myUsername,          setMyUsername]          = useState('');
  const [markerImages,        setMarkerImages]        = useState<Record<string, string>>({});
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
  const [saveRouteVisible,   setSaveRouteVisible]   = useState(false);
  const [nearbyUsers,        setNearbyUsers]        = useState<User[]>([]);
  const [remainingRoutePoints, setRemainingRoutePoints] = useState<
    { latitude: number; longitude: number }[]
  >([]);
  const [selectedRouteIndex,   setSelectedRouteIndex]   = useState(0);
  const [tripStatsVisible,     setTripStatsVisible]     = useState(false);
  const [cameraImages,         setCameraImages]         = useState<Record<string, string>>({});
  const [addCameraVisible,     setAddCameraVisible]     = useState(false);
  const [selectedCamera,       setSelectedCamera]       = useState<any>(null);
  const [cameraDetailVisible,  setCameraDetailVisible]  = useState(false);
  const { snapCameras } = useSnapCameras();
  const [snappedCameras, setSnappedCameras] = useState<any[]>([]);
  const [stableStartLocation, setStableStartLocation] = useState<LocationState | null>(null);

  // ── State – fuel stations ─────────────────────────────────
  const [selectedFuelStation,     setSelectedFuelStation]     = useState<any>(null);
  const [fuelStationModalVisible, setFuelStationModalVisible] = useState(false);
  const { stations: fuelStations, updatePrices: updateFuelPrices, refetch: refetchFuelStations, onLocationChange: onFuelLocationChange } = useFuelStations(userLocation);
  // ── State – live / ostrzeżenia ────────────────────────────
  const [isSharing,           setIsSharing]           = useState(false);
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
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const styles = makeMapStyles(theme, isDark, insets.top);
  const mapStyle =
    mapType === 'satellite' ? MAPBOX_STYLE_SATELLITE :
    mapType === 'hybrid'    ? MAPBOX_STYLE_HYBRID :
    isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;
  const { startConversation } = useChat();

  const { snap: drivingSnap, setRoutePoints: setSnapPoints, setRoadMatchPoints, reset: resetSnap } = useDrivingSnap();
  const { addPosition: addMatchPosition, getMatchedPoints, reset: resetMapMatch, forceMatch: forceMapMatch } = useDrivingMapMatch();
  const [gpsMode, setGpsMode] = useState<'idle' | 'driving' | 'navigating'>('idle');

  const {
    cameras, nearestCamera,
    updateCameras, addCamera, confirmCamera,
    checkAlert, markAlerted, invalidate, deleteCamera,
  } = useSpeedCameras();

  const { speedLimit, updateSpeedLimit } = useSpeedLimit(true);
  const speedKmh = (speed ?? 0) * 3.6;
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
        ? `Próg zwalniający za ${dist} metrów`
        : nearestCamera.maxspeed
          ? `Fotoradar za ${dist} metrów, limit ${nearestCamera.maxspeed}`
          : `Fotoradar za ${dist} metrów`;
      speak(msg);
    }
  }, [nearestCamera?.id, nearestCamera?.distanceM]);

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
    finishTrip, clearStats, stats: tripStats,
  } = useTripStats();

  const {
    liveUsers, warnings, connected,
    sendLocation, toggleSharing, addWarning, confirmWarning,cancelWarning,
  } = useLiveMap(isSharing, userLocation, isSpeechEnabled);

  const {
    isBuilding, pins, saving, snapping, snappedRoute,
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
    animateCameraSmooth, animateCameraLive,
    resetCamera, onUserPan, unlockCamera, lockForStart,
    cameraLockedRef,
    enterDrivingCamera,   // ← NOWE
    exitDrivingCamera,    // ← NOWE
  } = useCameraAnimation(cameraRef);

  // ── Sync currentLocRef so stable interval callbacks read latest position ──
  useEffect(() => { currentLocRef.current = userLocation; }, [userLocation]);

  useEffect(() => {
    if (!userLocation) return;
    const { latitude: lat, longitude: lng } = userLocation;

    // Distance gate: skip if user hasn't moved CAMERA_SPEED_LIMIT_GATE_M since
    // last call. Both hooks have their own internal guards (useSpeedCameras:
    // REFETCH_DIST_M=500m; useSpeedLimit: 20s + 330m), but this prevents even
    // the cheap recalc/sort from running on every sub-second GPS tick.
    if (lastCameraUpdateLocRef.current) {
      const movedM = haversineKm(lat, lng,
        lastCameraUpdateLocRef.current.lat, lastCameraUpdateLocRef.current.lng) * 1000;
      if (movedM < CAMERA_SPEED_LIMIT_GATE_M) {
        if (DEBUG_NETWORK) console.log('[cameras/speedlimit] gate — moved only', movedM.toFixed(0), 'm');
        return;
      }
    }
    lastCameraUpdateLocRef.current = { lat, lng };

    if (DEBUG_NETWORK) console.log('[cameras/speedlimit] updating at', lat.toFixed(5), lng.toFixed(5));
    updateCameras(lat, lng);
    updateSpeedLimit(lat, lng);
  }, [userLocation]);

  useEffect(() => {
    isNavigatingRef.current = isNavigating;
  }, [isNavigating]);

  // ── Sync isDrivingRef ─────────────────────────────────────
  useEffect(() => {
    isDrivingRef.current = isDriving;
  }, [isDriving]);

  // ── Dead-reckoning ────────────────────────────────────────
  const { feed: feedDR, reset: resetDR, stop: stopDR } = useDeadReckoning({
    onFrame: useCallback((pos: any, hdg: number) => {
      if (!isNavigatingRef.current && !isDrivingRef.current) return;

      let snappedPos = pos;

      if (isNavigatingRef.current) {
        // Navigation mode: snap to route using routePointsRef
        const points = routePointsRef.current;
        if (points.length > 1) {
          const snapped = snapToRoute(pos.latitude, pos.longitude, points, 35);
          snappedPos = { latitude: snapped.latitude, longitude: snapped.longitude };
        }
        drHdgRef.current = hdg;
      }
      // Driving mode: snapping and heading are managed by GPS pipeline (onLocation)
      // — do not snap here, do not overwrite drHdgRef

      drLatRef.current = snappedPos.latitude;
      drLngRef.current = snappedPos.longitude;

      drTickRef.current += 1;
      if (drTickRef.current % 2 === 0) {
        setDrTick(t => t + 1);
      }

      // Camera animation: both navigation and driving modes use DR onFrame for smooth 60fps camera.
      if (isNavigatingRef.current) {
        animateCameraLive({
          center:  snappedPos,
          pitch:   NAV_PITCH,
          heading: hdg,
          zoom:    getAdaptiveZoom(speedKmhRef.current),
        });
      } else if (isDrivingRef.current) {
        // Driving mode: use bearing-based heading (lastHeadingRef) — avoids GPS vs DR heading conflict.
        // Fall back to DR-interpolated hdg if no bearing has been established yet.
        animateCameraLive({
          center:  snappedPos,
          pitch:   NAV_PITCH,
          heading: lastHeadingRef.current !== 0 ? lastHeadingRef.current : hdg,
          zoom:    getAdaptiveZoom(speedKmhRef.current),
        });
      }
    }, [animateCameraLive, getAdaptiveZoom]),
    stallTimeout: 2500,
  });

  const { flushPendingKm }                                            = useBackgroundTracking(isSharing, settings.backgroundTracking);
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

  const handleAddCamera = useCallback(async (params: {
    maxspeed: number | null;
    type: 'fixed' | 'section' | 'mobile' | 'bump';
    description: string | null;
  }) => {
    if (!userLocation) return;
    const result = await addCamera({
      lat:         userLocation.latitude,
      lng:         userLocation.longitude,
      maxspeed:    params.maxspeed,
      type:        params.type,
      description: params.description,
    });
    if (result) {
      Toast.show({ type: 'success', text1: '📷 FOTORADAR DODANY', text2: 'Dziękujemy za zgłoszenie!' });
      invalidate();
      updateCameras(userLocation.latitude, userLocation.longitude);
    } else {
      Toast.show({ type: 'info', text1: 'Fotoradar już istnieje w tym miejscu' });
    }
  }, [userLocation, addCamera, invalidate, updateCameras]);

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
    drTickRef.current = 0;
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
      setMyAvatarUrl(user.avatarUrl ?? user.avatar ?? null);
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
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          setUserLocation(loc);
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

  useEffect(() => {
    const pinIds = new Set(pins.map(p => p.id));
    setPinImages(prev => {
      const next: Record<string, string> = {};
      Object.keys(prev).forEach(k => { if (pinIds.has(k)) next[k] = prev[k]; });
      return next;
    });
  }, [pins]);

  // ── Init GPS ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Toast.show({ type: 'error', text1: 'ODMOWA DOSTĘPU', text2: 'Włącz lokalizację w ustawieniach' });
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
        const lat = latFilter.filter(loc.coords.latitude,  loc.coords.accuracy ?? 10);
        const lng = lngFilter.filter(loc.coords.longitude, loc.coords.accuracy ?? 10);
        setUserLocation({ latitude: lat, longitude: lng });
        setRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.015, longitudeDelta: 0.015 });
        // Inicjalizuj lastGoodLoc
        lastGoodLocRef.current = { lat, lng };
        setLocationReady(true);
      } catch {
        Toast.show({ type: 'error', text1: 'BŁĄD GPS', text2: 'Nie można pobrać lokalizacji' });
      }
    })();
  }, []);

  // ─────────────────────────────────────────────────────────
  // DRIVING MODE helpers
  // ─────────────────────────────────────────────────────────

  const exitDrivingMode = useCallback(() => {
    // Sync userLocation to last DR position before clearing isDriving so that
    // the marker source switch (drLatRef → userLocation) is seamless.
    if (drLatRef.current !== 0 && drLngRef.current !== 0) {
      setUserLocation({ latitude: drLatRef.current, longitude: drLngRef.current });
    }
    isDrivingRef.current        = false;
    drivingKmRef.current        = 0;
    drivingLastLocRef.current   = null;
    lastDrivingPosRef.current   = null;
    if (drivingStopTimerRef.current) {
      clearTimeout(drivingStopTimerRef.current);
      drivingStopTimerRef.current = null;
    }
    // Clear the last-good-location reference so the first GPS fix after
    // exiting driving (e.g. walking away from parked car) is always accepted
    // instead of being rejected as a teleport jump against the stale driving position.
    lastGoodLocRef.current  = null;
    lastGoodTimeRef.current = Date.now();
    stopDR();
    resetDRRefs();
    resetSnap();
    resetMapMatch();
    setRoadMatchPoints([]);
    setIsDriving(false);
    setDrivingKm(0);
    console.log('[DrivingMode] Exited driving mode');
    // NIE wywołuj exitDrivingCamera gdy wywołane z beginNavigation
    // — nawigacja sama przejmuje kamerę przez lockForStart
  }, [stopDR, resetDRRefs, resetSnap, resetMapMatch, setRoadMatchPoints]);

  // Ręczny przełącznik trybu jazdy (przycisk w UI)
  const handleToggleDrivingMode = useCallback(async () => {
    if (isNavigating) return;
    if (isDriving) {
      drivingManuallyDisabledRef.current = true;
      exitDrivingMode();
      if (userLocation) exitDrivingCamera(userLocation);
    } else {
      drivingManuallyDisabledRef.current = false;
      isDrivingRef.current        = true;
      drivingConsecutiveRef.current = DRIVING_CONSECUTIVE_REQ;
      drivingKmRef.current        = 0;
      drivingLastLocRef.current   = null;
      lastDrivingPosRef.current   = null;
      navLatFilter.reset();
      navLngFilter.reset();
      drivLatFilter.reset();
      drivLngFilter.reset();
      // Reset map-matcher so it starts fresh and immediately seeds the
      // buffer with the current position — enables snap-to-road from the
      // very first GPS tick rather than waiting for speed to reach 5 km/h.
      resetMapMatch();
      resetSnap();
      setIsDriving(true);
      setDrivingKm(0);
      if (userLocation) {
        const startLat = userLocation.latitude;
        const startLng = userLocation.longitude;

        // Anchor dead-reckoning at current position immediately.
        feedDR({ latitude: startLat, longitude: startLng }, 0, lastHeadingRef.current);
        enterDrivingCamera(userLocation, lastHeadingRef.current);

        // forceMatch: await the API result so we can snap immediately —
        // this is essential when stationary (speed = 0) because the GPS
        // pipeline's dead-zone guard would otherwise skip the snap update.
        addMatchPosition(startLat, startLng);
        const matchedPts = await forceMapMatch(startLat, startLng);

        if (matchedPts && matchedPts.length >= 2 && isDrivingRef.current) {
          // Push the road geometry into the snap hook so drivingSnap can use it.
          setRoadMatchPoints(matchedPts);
          const snapped = drivingSnap(startLat, startLng, 0, false);
          if (snapped.snapped) {
            // Apply the snapped road position directly — bypasses the GPS pipeline
            // dead-zone which would otherwise block updates while speed is 0.
            drLatRef.current = snapped.latitude;
            drLngRef.current = snapped.longitude;
            lastSetLocRef.current = { lat: snapped.latitude, lng: snapped.longitude };
            setUserLocation({ latitude: snapped.latitude, longitude: snapped.longitude });
            // Re-anchor dead-reckoning at the snapped position so the camera
            // follows the correct road-snapped location.
            feedDR({ latitude: snapped.latitude, longitude: snapped.longitude }, 0, lastHeadingRef.current);
            console.log('[DrivingMode] Immediate entry snap applied:', snapped.latitude.toFixed(6), snapped.longitude.toFixed(6));
          }
        }
      }
      console.log('[DrivingMode] Manually entered driving mode');
    }
  }, [isNavigating, isDriving, userLocation, exitDrivingMode, exitDrivingCamera, enterDrivingCamera, resetMapMatch, resetSnap, addMatchPosition, forceMapMatch, feedDR, drivingSnap, setRoadMatchPoints]);

  // ─────────────────────────────────────────────────────────
  // Adaptive GPS
  // ─────────────────────────────────────────────────────────
  speedKmhRef.current = (speed ?? 0) * 3.6;

  const { start: startGPS, stop: stopGPS } = useAdaptiveGPS({
    isNavigating,
    speedKmh: speedKmhRef.current,
    onLocation: useCallback((loc) => {
      const rawLat = loc.latitude;
      const rawLng = loc.longitude;
      const acc    = loc.accuracy ?? 10;
      const now    = Date.now();

      // ══ 1. SANITY CHECK ══════════════════════════════════════
      if (lastGoodLocRef.current) {
        const dtMs   = now - lastGoodTimeRef.current;
        const safeDt = Math.max(dtMs, 100);
        const sane   = isSaneLocation(
          rawLat, rawLng,
          lastGoodLocRef.current.lat,
          lastGoodLocRef.current.lng,
          250,
          safeDt,
          isDrivingRef.current,
        );
        if (!sane) {
          console.warn('[GPS map] Skok odrzucony');
          latFilter.reset();
          lngFilter.reset();
          navLatFilter.reset();
          navLngFilter.reset();
          drivLatFilter.reset();
          drivLngFilter.reset();
          return;
        }

        // Absolute-distance cap: a medium-sized drift (e.g. 200 m over 30 s =
        // 24 km/h) passes the speed check but is still a bad fix when the vehicle
        // is slow or stationary. Allow 3× expected distance + 100 m headroom.
        // safeDt uses a 100 ms floor so a very short time-delta between consecutive
        // GPS fixes never makes an ordinary displacement look unreasonably fast.
        // In driving mode, use a higher floor (300 m) to accommodate GPS drift at
        // highway speeds when loc.speed may report 0 on Android.
        const distM2    = haversineKm(lastGoodLocRef.current.lat, lastGoodLocRef.current.lng, rawLat, rawLng) * 1000;
        const reportedKmh = (loc.speed != null && loc.speed >= 0) ? loc.speed * 3.6 : 0;
        const expectedM2  = (reportedKmh / 3.6) * (safeDt / 1000);
        const distFloor   = isDrivingRef.current ? 300 : 100;
        const maxDistM2   = Math.max(distFloor, expectedM2 * 3 + 100);
        if (distM2 > maxDistM2) {
          console.warn(`[GPS map] Skok dystansowy odrzucony: ${Math.round(distM2)}m > ${Math.round(maxDistM2)}m`);
          latFilter.reset();
          lngFilter.reset();
          navLatFilter.reset();
          navLngFilter.reset();
          drivLatFilter.reset();
          drivLngFilter.reset();
          return;
        }
      }
      prevGoodTimeRef.current = lastGoodTimeRef.current;
      lastGoodTimeRef.current = now;
      lastGoodLocRef.current  = { lat: rawLat, lng: rawLng };

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

      // ══ 3. Prędkość ══════════════════════════════════════════
      const rawSpeedMs = loc.speed != null && loc.speed >= 0 ? loc.speed : 0;
      const kmh        = rawSpeedMs * 3.6;

      // ══ 4. Feed stats ════════════════════════════════════════
      feedSpeedSample(rawSpeedMs);
      feedSpeed(rawSpeedMs > 0 ? rawSpeedMs : null);
      feedPosition(lat, lng);

      // ══ 5. Feed dystansu nawigacji ════════════════════════════
      // Only accumulate nav distance while actually navigating — calling this
      // unconditionally inflates _navDistKm during driving mode and causes
      // massive overcounting when flushPendingKm(true) runs at nav end.
      if (isNavigatingRef.current) {
        if (lastNavLocRef.current) {
          feedNavDistance(
            lastNavLocRef.current.latitude, lastNavLocRef.current.longitude,
            lat, lng,
          );
        }
        lastNavLocRef.current = { latitude: lat, longitude: lng };
      }

      // ══ 6. Dead reckoning — tylko nawigacja ══════════════════
      if (isNavigatingRef.current) {
        feedDR(
          { latitude: lat, longitude: lng },
          rawSpeedMs,
          loc.heading ?? lastHeadingRef.current,
        );
      }

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
            setHeading(finalHeading);
            lastHeadingRef.current = finalHeading;
          }
        }
      }

      // ══ 8. Pozycja + driving mode ════════════════════════════
      if (!isNavigatingRef.current) {

        // ── DAP-to-Road: refresh snap points + conditionally feed map matcher ──
        // Do this before snapping so the latest matched road is available.

        // Always pull the latest matched road segment into the snap hook.
        // This picks up forceMatch results (called on driving mode entry) even
        // when the user is stationary and no new points have been fed.
        const matchedPts = getMatchedPoints();
        if (matchedPts && matchedPts.length > 1) {
          setRoadMatchPoints(matchedPts);
        }

        // Feed new GPS positions to the API buffer only when there's real movement.
        // Use real movement (meters) as trigger — loc.speed is unreliable on
        // Android and can read 0 km/h even while the vehicle is moving.
        const movedForSnap = lastSetLocRef.current
          ? haversineKm(lastSetLocRef.current.lat, lastSetLocRef.current.lng, lat, lng) * 1000
          : Infinity;
        if (movedForSnap >= 3 || kmh >= 5) {
          addMatchPosition(lat, lng);
        }

        const snapped = drivingSnap(lat, lng, kmh, false);

        // ── Driving heading ────────────────────────────────────────────────────
        // Priority order:
        // 1. GPS loc.heading (course-over-ground) — most reliable at kmh >= 10,
        //    direct measure of travel direction from the GPS chip.
        //    Anti-parallel guard: if it differs from current by >150° it's a GPS
        //    flip/spike — skip and fall through to movement vector.
        // 2. Movement vector between last two snapped positions — reliable on
        //    curves and when GPS heading lags or is unavailable.
        // 3. targetHeading from snap (polyline segment bearing) — last resort,
        //    validated: reject if it differs from current heading by >90°
        //    (anti-parallel snap on the wrong lane direction).
        // 4. GPS loc.heading at any speed — final fallback.
        // Heading updates are frozen when speed is very low (< 7 km/h)
        // to prevent the car icon from spinning when stationary or in low signal.
        let drivingHeading = lastHeadingRef.current;
        const shouldUpdateHeading = kmh >= 7 || movedForSnap >= 5;

        if (shouldUpdateHeading) {
          if (kmh >= 10 && loc.heading != null && loc.heading >= 0) {
            // Primary: GPS course-over-ground — direct measure of travel direction.
            // Anti-parallel guard: reject if GPS heading suddenly flips >150° from
            // current (GPS chip glitch) and fall through to movement vector.
            const gpsDiff = Math.abs(((loc.heading - lastHeadingRef.current + 540) % 360) - 180);
            if (gpsDiff <= 150) {
              drivingHeading = smoothHeading(lastHeadingRef.current, loc.heading, 0.35, 60);
              lastHeadingRef.current = drivingHeading;
              setHeading(drivingHeading);
            } else if (lastDrivingPosRef.current) {
              // GPS flipped 180° — fall back to movement vector immediately
              const distM = haversineKm(
                lastDrivingPosRef.current.lat, lastDrivingPosRef.current.lng,
                snapped.latitude, snapped.longitude,
              ) * 1000;
              if (distM >= 5) {
                const brg = bearingBetween(
                  lastDrivingPosRef.current.lat, lastDrivingPosRef.current.lng,
                  snapped.latitude, snapped.longitude,
                );
                drivingHeading = smoothHeading(lastHeadingRef.current, brg, 0.4, 60);
                lastHeadingRef.current = drivingHeading;
                setHeading(drivingHeading);
              }
            }
          } else if (lastDrivingPosRef.current) {
            // Secondary: bearing from movement vector between consecutive snapped
            // positions — good for curves and low-speed GPS heading unreliability.
            const distM = haversineKm(
              lastDrivingPosRef.current.lat, lastDrivingPosRef.current.lng,
              snapped.latitude, snapped.longitude,
            ) * 1000;
            if (distM >= 5) {
              const brg = bearingBetween(
                lastDrivingPosRef.current.lat, lastDrivingPosRef.current.lng,
                snapped.latitude, snapped.longitude,
              );
              drivingHeading = smoothHeading(lastHeadingRef.current, brg, 0.4, 60);
              lastHeadingRef.current = drivingHeading;
              setHeading(drivingHeading);
            }
          } else if (snapped.snapped) {
            // Tertiary: polyline segment bearing from snap.
            // Anti-parallel guard: reject if it differs from current heading by >90°
            // (snap landed on a segment going the opposite direction).
            const snapDiff = Math.abs(((snapped.targetHeading - lastHeadingRef.current + 540) % 360) - 180);
            if (snapDiff <= 90) {
              drivingHeading = smoothHeading(lastHeadingRef.current, snapped.targetHeading, 0.3, 45);
              lastHeadingRef.current = drivingHeading;
              setHeading(drivingHeading);
            }
          } else if (loc.heading != null && loc.heading >= 0) {
            // Final fallback: GPS heading even at low speed
            const candidate = smoothHeading(lastHeadingRef.current, loc.heading, 0.4, 180);
            if (Math.abs(((loc.heading - lastHeadingRef.current + 540) % 360) - 180) > 2) {
              drivingHeading         = candidate;
              lastHeadingRef.current = drivingHeading;
              setHeading(drivingHeading);
            }
          }
        }
        // Always track last snapped position for next bearing calculation
        lastDrivingPosRef.current = { lat: snapped.latitude, lng: snapped.longitude };

        // Keep DR refs in sync with driving pipeline (heading comes from bearing, not DR)
        drLatRef.current = snapped.latitude;
        drLngRef.current = snapped.longitude;
        drHdgRef.current = drivingHeading;

        // ── DEAD ZONE — ignoruj jitter gdy stoisz ────────────
        if (lastSetLocRef.current && kmh < 5) {
          const movedM = haversineKm(
            lastSetLocRef.current.lat, lastSetLocRef.current.lng,
            snapped.latitude, snapped.longitude,
          ) * 1000;
          if (movedM < MIN_MOVE_M) {
            drivingConsecutiveRef.current = 0;
            setSpeed(null);
            return;
          }
        }
        lastSetLocRef.current = { lat: snapped.latitude, lng: snapped.longitude };

        setUserLocation({ latitude: snapped.latitude, longitude: snapped.longitude });

        if (kmh >= DRIVING_SPEED_KMH) {
          // ── Wymaga N kolejnych odczytów przed wejściem w driving
          drivingConsecutiveRef.current += 1;

          if (drivingStopTimerRef.current) {
            clearTimeout(drivingStopTimerRef.current);
            drivingStopTimerRef.current = null;
          }

          if (!isDrivingRef.current) {
            if (drivingManuallyDisabledRef.current) return;
            if (drivingConsecutiveRef.current < DRIVING_CONSECUTIVE_REQ) {
              return; // czekaj na potwierdzenie
            }
            isDrivingRef.current      = true;
            drivingKmRef.current      = 0;
            drivingLastLocRef.current = null;
            lastDrivingPosRef.current = null;
            // Reset nav-quality Kalman filters to start fresh in driving mode
            navLatFilter.reset();
            navLngFilter.reset();
            drivLatFilter.reset();
            drivLngFilter.reset();
            console.log('[DrivingMode] Entered driving mode, speed:', Math.round(kmh), 'km/h');
            // Immediate warmup snap — apply result as soon as API responds.
            // The GPS callback is synchronous so we use .then() to apply the
            // snapped position on the next event-loop tick after the fetch resolves.
            const entryLat = snapped.latitude;
            const entryLng = snapped.longitude;
            forceMapMatch(entryLat, entryLng).then((matchedPts) => {
              if (!matchedPts || matchedPts.length < 2 || !isDrivingRef.current) return;
              setRoadMatchPoints(matchedPts);
              const forcedSnap = drivingSnap(entryLat, entryLng, 0, false);
              if (forcedSnap.snapped) {
                drLatRef.current = forcedSnap.latitude;
                drLngRef.current = forcedSnap.longitude;
                lastSetLocRef.current = { lat: forcedSnap.latitude, lng: forcedSnap.longitude };
                setUserLocation({ latitude: forcedSnap.latitude, longitude: forcedSnap.longitude });
                feedDR({ latitude: forcedSnap.latitude, longitude: forcedSnap.longitude }, rawSpeedMs, drivingHeading);
              }
            });
            // feedDR before setIsDriving so drLatRef/drLngRef are populated
            // before the re-render, preventing a one-frame marker teleport.
            feedDR(
              { latitude: snapped.latitude, longitude: snapped.longitude },
              rawSpeedMs,
              drivingHeading,
            );
            setIsDriving(true);
            setDrivingKm(0);
            enterDrivingCamera(
              { latitude: snapped.latitude, longitude: snapped.longitude },
              drivingHeading,
            );
            return;
          }

          if (drivingLastLocRef.current) {
            const dist = haversineKm(
              drivingLastLocRef.current.lat, drivingLastLocRef.current.lng,
              snapped.latitude, snapped.longitude,
            );
            // Safety cap: per-tick distance must be > 0 and physically plausible.
            // MAX_DIST_PER_TICK_KM (100 m) per tick is already conservative; additionally
            // cap by dt * MAX_PLAUSIBLE_SPEED_KMH to reject phantom jumps on irregular
            // GPS tick intervals (e.g. after a long background pause).
            const dtSec = Math.max(MIN_GPS_TICK_SEC, (now - prevGoodTimeRef.current) / 1000);
            const maxDistKm = Math.min(
              MAX_DIST_PER_TICK_KM,
              Math.max(MIN_DIST_PER_TICK_KM, (MAX_PLAUSIBLE_SPEED_KMH / 3600) * dtSec),
            );
            if (dist > 0 && dist <= maxDistKm) {
              drivingKmRef.current += dist;
              setDrivingKm(Math.round(drivingKmRef.current * 10) / 10);
            } else if (dist > maxDistKm) {
              console.warn(`[DrivingMode] Tick km odrzucony: ${(dist * 1000).toFixed(0)}m > cap ${(maxDistKm * 1000).toFixed(0)}m (dt=${dtSec.toFixed(1)}s)`);
            }
          }
          drivingLastLocRef.current = { lat: snapped.latitude, lng: snapped.longitude };

          feedDR(
            { latitude: snapped.latitude, longitude: snapped.longitude },
            rawSpeedMs,
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
              { latitude: snapped.latitude, longitude: snapped.longitude },
              0,
              drivingHeading,
            );
          }

          if (isDrivingRef.current && !drivingStopTimerRef.current) {
            drivingStopTimerRef.current = setTimeout(() => {
              isDrivingRef.current        = false;
              drivingKmRef.current        = 0;
              drivingLastLocRef.current   = null;
              lastDrivingPosRef.current   = null;
              drivingStopTimerRef.current = null;
              // Sync userLocation to last DR position before switching marker source
              // to prevent a visible teleport when isDriving flips to false.
              if (drLatRef.current !== 0 && drLngRef.current !== 0) {
                setUserLocation({ latitude: drLatRef.current, longitude: drLngRef.current });
              }
              setIsDriving(false);
              setDrivingKm(0);
              resetSnap();
              resetMapMatch();
              setRoadMatchPoints([]);
              console.log('[DrivingMode] Exited driving mode (stop timer fired)');
              // Capture camera exit target before clearing lastGoodLocRef.
              const exitLoc = lastGoodLocRef.current;
              // Clear stale driving position so the first walking GPS fix is not
              // rejected as a teleport jump against the old driving position.
              lastGoodLocRef.current  = null;
              lastGoodTimeRef.current = Date.now();
              if (exitLoc) {
                exitDrivingCamera({
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
          setUserLocation({ latitude: navSnapped.latitude, longitude: navSnapped.longitude });
        } else {
          setUserLocation({ latitude: lat, longitude: lng });
        }
      }

      setSpeed(rawSpeedMs > 0 ? rawSpeedMs : null);
    }, [drivingSnap, feedSpeed, feedPosition, feedDR, animateCameraLive, enterDrivingCamera, exitDrivingCamera, addMatchPosition, getMatchedPoints, setRoadMatchPoints, resetMapMatch, resetSnap, getAdaptiveZoom, forceMapMatch]),
  });

  useEffect(() => {
    if (!locationReady) return;
    lastGoodLocRef.current = userLocation
      ? { lat: userLocation.latitude, lng: userLocation.longitude }
      : null;
    startGPS();
    return () => {
      stopGPS();
      if (drivingStopTimerRef.current) clearTimeout(drivingStopTimerRef.current);
    };
  }, [locationReady]);

  // Keep locationReadyRef in sync for use inside AppState/focus callbacks
  useEffect(() => { locationReadyRef.current = locationReady; }, [locationReady]);

  // One-shot location refresh: immediately snaps the marker to the current
  // position before the watch subscription has had a chance to emit updates.
  const refreshLocationOneShot = useCallback(() => {
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation })
      .then((loc) => {
        const lat = latFilter.filter(loc.coords.latitude,  loc.coords.accuracy ?? 10);
        const lng = lngFilter.filter(loc.coords.longitude, loc.coords.accuracy ?? 10);
        lastGoodLocRef.current = { lat, lng };
        setUserLocation({ latitude: lat, longitude: lng });
        console.log('[GPS] One-shot fix applied');
      })
      .catch((e) => console.warn('[GPS] One-shot fix failed:', e));
  }, []);

  // ── Restart GPS when app returns to foreground ──────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && locationReadyRef.current) {
        console.log('[GPS] App foregrounded — restarting GPS watcher');
        // Clear stale position so the first GPS fix after resuming is accepted
        // instead of being rejected as a jump against the pre-background position.
        lastGoodLocRef.current  = null;
        lastGoodTimeRef.current = Date.now();
        stopGPS();
        startGPS();
        refreshLocationOneShot();
      }
    });
    return () => sub.remove();
  }, [startGPS, stopGPS, refreshLocationOneShot]);

  // ── Restart GPS when Map screen regains focus ────────────────────────────
  useFocusEffect(useCallback(() => {
    if (!locationReadyRef.current) return;
    console.log('[GPS] Screen focused — restarting GPS watcher');
    // Clear stale position so the first GPS fix after re-focus is not rejected.
    lastGoodLocRef.current  = null;
    lastGoodTimeRef.current = Date.now();
    stopGPS();
    startGPS();
    refreshLocationOneShot();
  }, [startGPS, stopGPS, refreshLocationOneShot]));

  useEffect(() => {
    setSnapPoints(activeRoute?.points ?? []);
  }, [activeRoute, setSnapPoints]);

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
      setDrTick(t => t + 1);

      const R          = 6371000;
      const headingRad = (hdg * Math.PI) / 180;
      const offsetM    = 90;
      const dLat       = (offsetM * Math.cos(headingRad)) / R;
      const dLng       = (offsetM * Math.sin(headingRad)) /
                        (R * Math.cos((lat * Math.PI) / 180));
      const lookaheadLat = lat + (dLat * 180) / Math.PI;
      const lookaheadLng = lng + (dLng * 180) / Math.PI;

      (cameraRef.current as any)?.setCamera({
        centerCoordinate: [lookaheadLng, lookaheadLat],
        pitch:            NAV_PITCH,
        heading:          hdg,
        zoomLevel:        getAdaptiveZoom(speedMs * 3.6),
        animationDuration: 130,
        animationMode:    'linear',
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
      if (lastNavLocRef.current) {
        feedNavDistance(
          lastNavLocRef.current.latitude, lastNavLocRef.current.longitude,
          lat, lng,
        );
      }
      lastNavLocRef.current = { latitude: lat, longitude: lng };
    }, [getAdaptiveZoom]),
    speedKmh:   120,
    intervalMs: 100,
  });

  useEffect(() => {
    if (!isNavigating || !navRoute?.steps?.length) return;

    const steps  = navRoute.steps;
    const points = navRoute.points ?? [];

    // ← UŻYJ DR position gdy dostępna (bardziej aktualna niż state)
    const currentLat = (drLatRef.current !== 0) ? drLatRef.current : userLocation?.latitude;
    const currentLng = (drLngRef.current !== 0) ? drLngRef.current : userLocation?.longitude;

    if (!currentLat || !currentLng) return;

    const snapped = points.length
      ? snapToRoute(currentLat, currentLng, points, 35)
      : { latitude: currentLat, longitude: currentLng };

    const { latitude: lat, longitude: lng } = snapped;

    // ── Sprawdź dotarcie do celu ──
    if (endLocation) {
      const distToEnd = haversineKm(lat, lng, endLocation.latitude, endLocation.longitude) * 1000;
      if (distToEnd < 30 && !arrived) { handleArrived(); return; }
    }

    // ── Wykryj aktualny krok ──
    const nextStep = detectCurrentStep(lat, lng, steps, currentStep);
    if (nextStep !== currentStep) {
      setCurrentStep(nextStep);
      announcedStepRef.current = -1;
    }

    // ── Ogłoszenie głosowe ──
    if (steps[nextStep] && isSpeechRef.current) {
      const stepEnd       = steps[nextStep].end_location;
      const distToStepEnd = haversineKm(lat, lng, stepEnd.lat, stepEnd.lng) * 1000;
      const threshold     = distToStepEnd < 100 ? 100 : ANNOUNCE_M;
      if (distToStepEnd < threshold && announcedStepRef.current !== nextStep) {
        announcedStepRef.current = nextStep;
        const prefix = distToStepEnd < 100 ? 'Teraz' : `Za ${Math.round(distToStepEnd)} metrów`;
        speak(`${prefix}: ${cleanInstruction(steps[nextStep].html_instructions)}`);
      }
      // Aktualizuj live dystans do zakrętu
      setDistToTurnM(distToStepEnd);
    }

    // ── Off-route check ──
    if (points.length) {
      const onRoad = isOnRoute(lat, lng, points, REROUTE_THRESHOLD_M);
      if (!onRoad && !offRoute) {
        setOffRoute(true);
        clearTimeout(rerouteTimerRef.current);
        rerouteTimerRef.current = setTimeout(() => setOffRoute(false), 3000);
      }
    }

    // ── Aktualizuj remainingRoutePoints + live dystans do celu ──
    if (points.length > 1) {
      const idx = findClosestPointIndex(lat, lng, points);
      const remPts = [
        { latitude: lat, longitude: lng },
        ...points.slice(idx + 1),
      ];
      setRemainingRoutePoints(remPts);

      // Suma odległości po pozostałych punktach trasy
      let remKm = 0;
      for (let i = 0; i < remPts.length - 1; i++) {
        remKm += haversineKm(
          remPts[i].latitude, remPts[i].longitude,
          remPts[i + 1].latitude, remPts[i + 1].longitude,
        );
      }
      setRemainingDistKm(remKm);

      // Aktualizuj powiadomienie systemowe z live dystansem (co 30 s)
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

  // ← drTick wyzwala efekt przy każdej klatce DR; showNavigationNotification jest stabilna
  }, [userLocation, isNavigating, drTick, showNavigationNotification]);

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
    setNavStartLoc({ ...userLocation, name: 'Moja pozycja' });
    setCurrentStep(0);
    announcedStepRef.current = -1;
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
      return;
    }
    if (!userLocation || !endLocation) return;

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
    lastRerouteTimeRef.current = now;
    lastRerouteLocRef.current  = { lat: userLocation.latitude, lng: userLocation.longitude };
    setRerouteOrigin({ ...userLocation, name: 'Moja pozycja' });
  }, [offRoute, userLocation, endLocation]);

  useEffect(() => {
    if (!startIsMyLocationRef.current || !userLocation || isNavigating) return;
    if (isDriving && endLocation) return; // ← NOWE: w driving mode z celem nie nadpisuj
    setStartLocation(prev => ({ ...userLocation, name: prev?.name ?? 'Moja pozycja' }));
  }, [userLocation, isNavigating, isDriving, endLocation]);

  const activeRoute = isNavigating ? navRoute : previewRoute;
  navRouteRef.current = navRoute ?? null;
  const activeSteps = navRoute?.steps ?? previewRoute?.steps ?? [];
  // Sync routeInfo into a ref so the DR effect can read it without stale closure
  const routeInfoRef = useRef(routeInfo);
  routeInfoRef.current = routeInfo;

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
        })),
    );
  }, [liveUsers, currentUserId, userLocation, isSharing]);

  useEffect(() => {
    UsersModule?.setNavigatingForAuto?.(isNavigating);
  }, [isNavigating]);

  useEffect(() => {
    if (!UsersModule || !userLocation) return;
    UsersModule.saveMyLocationForAuto?.(userLocation.latitude, userLocation.longitude);
    UsersModule.saveSpeedHeadingForAuto?.(speed ?? 0, heading);
  }, [userLocation, speed, heading]);

  useEffect(() => {
    if (!UsersModule || !isNavigating) return;
    const step = navRoute?.steps?.[currentStep];
    if (!step) return;
    UsersModule.saveNavStepForAuto?.(
      cleanInstruction(step.html_instructions),
      step.distance?.text ?? '',
      routeInfo ? formatDuration(routeInfo.duration) : '',
    );
  }, [isNavigating, currentStep, navRoute]);

  useEffect(() => {
    if (!UsersModule) return;
    const route = isNavigating ? navRoute : previewRoute;
    if (route?.points) {
      UsersModule.saveRouteForAuto?.(JSON.stringify(
        route.points.map((p: any) => ({ lat: p.latitude, lng: p.longitude })),
      ));
    }
  }, [isNavigating, navRoute, previewRoute]);

  useEffect(() => {
    if (!UsersModule || !endLocation) return;
    UsersModule.saveDestinationForAuto?.(
      endLocation.latitude, endLocation.longitude, endLocation.name ?? 'Cel',
    );
  }, [endLocation]);

  useEffect(() => {
    if (!UsersModule || !isNavigating) return;
    const interval = setInterval(async () => {
      try {
        const stop = await UsersModule.checkNavStopRequested?.();
        if (stop) stopNavigation();
      } catch {}
    }, 1500);
    return () => clearInterval(interval);
  }, [isNavigating, stopNavigation]);

  useEffect(() => {
    if (!userLocation) return;
    setNearbyUsers(
      liveUsers
        .filter(u => String(u.id) !== String(currentUserId))
        .map(u => ({
          id: String(u.id), name: u.username,
          latitude: u.lat, longitude: u.lng,
          avatar: u.avatarUrl ?? '🚗', status: 'Online' as const, isFriend: false,
        })),
    );
  }, [liveUsers, currentUserId, userLocation]);

  useDemoUsers(
    locationReady && !isNavigating && !isSharing,
    useCallback((users) => setDemoUsers(users), []),
    userLocation?.latitude,
    userLocation?.longitude,
    100,
  );

  // ─────────────────────────────────────────────────────────
  const visibleUsers = useMemo(() => {
    if (!userLocation) return [];
    return nearbyUsers.filter(u =>
      u.isFriend ||
      calculateDistance(
        userLocation.latitude, userLocation.longitude,
        u.latitude, u.longitude,
      ) <= MAX_NEARBY_USERS_DISTANCE,
    );
  }, [userLocation, nearbyUsers]);

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  const speak = useCallback((text: string) => {
    if (!isSpeechRef.current) return;
    if (text === lastSpokenRef.current) return;
    lastSpokenRef.current = text;
    Speech.stop().catch(() => {});
    setTimeout(() => {
      if (!isSpeechRef.current) return;
      Speech.speak(text, { language: 'pl-PL', pitch: 1.0, rate: 0.88 });
    }, 200);
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
    setIsSharing(await toggleSharing());
  }, [toggleSharing]);

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
    if (!userLocation) return;
    unlockCamera();
    if (isNavigating || isDriving) {
      (cameraRef.current as any)?.setCamera({
        centerCoordinate: [userLocation.longitude, userLocation.latitude],
        pitch:            NAV_PITCH,
        heading:          lastHeadingRef.current,
        zoomLevel:        getAdaptiveZoom(speedKmhRef.current),
        animationDuration: 500,
        animationMode:    'flyTo',
      });
    } else {
      resetCamera(userLocation);
    }
  }, [userLocation, isNavigating, isDriving, resetCamera, unlockCamera, getAdaptiveZoom]);

  // ── handleArrived ─────────────────────────────────────────
  const handleArrived = useCallback(async () => {
    isNavigatingRef.current = false;
    stopDR();
    const finalStats = finishTrip();
    setTimeout(() => setTripStatsVisible(true), 2000);
    setIsNavigating(false);
    setArrived(true);
    setDistToTurnM(null);
    setRemainingDistKm(null);
    notifThrottleRef.current = 0;
    dismissNavigationNotification();
    flushPendingKm(true);
    Speech.stop().catch(() => {});
    speak('Dotarłeś do celu!');
    Toast.show({ type: 'success', text1: '🏁 DOTARŁEŚ DO CELU!', text2: endLocation?.name ?? '' });

    if (routeInfo?.distance) onNavigationComplete(parseFloat(routeInfo.distance));
    if (userLocation) resetCamera(userLocation);

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
    endLocation, userLocation, routeInfo, speak, resetCamera,
    onNavigationComplete, timerRunning, stopTimer, formatElapsed,
    leaderboardRouteId, saveRun, fetchLeaderboard, fetchRuns,
  ]);

  // ── beginNavigation ───────────────────────────────────────
  const beginNavigation = useCallback(() => {
    if (!userLocation) return;

    exitDrivingMode();

    if (routeInfo?.duration) startTrip(routeInfo.duration);

    resetDRRefs();
    unlockCamera();
    lockForStart(850);
    isNavigatingRef.current = true;

    lastNavLocRef.current = null;
    resetSpeedStats();
    // Reset any BG km that accrued before navigation started (would cause double-counting)
    // and tell the background task to suppress its auto-flush while we navigate.
    AsyncStorage.setItem(BG_PENDING_KM_KEY, '0').catch(() => {});
    setNavigatingFlag(true).catch(() => {});
    resetDR();
    navLatFilter.reset();
    navLngFilter.reset();
    startIsMyLocationRef.current = false;
    lastSpokenRef.current        = '';
    announcedStepRef.current     = -1;

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

    (cameraRef.current as any)?.setCamera({
      centerCoordinate: [startLng, startLat],
      pitch:            NAV_PITCH,
      heading:          startHdg,
      zoomLevel:        getAdaptiveZoom(speedKmhRef.current),
      animationDuration: 800,
      animationMode:    'flyTo',
    });

    setTimeout(() => {
      if (!isNavigatingRef.current) return;
      (cameraRef.current as any)?.setCamera({
        centerCoordinate: [
          drLngRef.current || startLng,
          drLatRef.current || startLat,
        ],
        pitch:            NAV_PITCH,
        heading:          drHdgRef.current || startHdg,
        zoomLevel:        getAdaptiveZoom(speedKmhRef.current),
        animationDuration: 300,
        animationMode:    'flyTo',
      });
    }, 900);

    speak('Nawigacja rozpoczęta. Dobrej drogi!');
  }, [userLocation, routeInfo, speak, onNavigationStart, startTimer, unlockCamera,
      lockForStart, resetDR, resetDRRefs, exitDrivingMode, activeRoute, getAdaptiveZoom]);

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
    flushPendingKm(true);
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
      resetCamera(userLocation);
    }
  }, [
    userLocation, resetCamera, onNavigationCancel, flushPendingKm,
    timerRunning, stopTimer, resetTimer, formatElapsed, elapsedSec,
    leaderboardRouteId, saveRun, fetchLeaderboard, fetchRuns, resetDRRefs,
  ]);

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

  const markerLat = ((isNavigating || isDriving) && drLatRef.current !== 0)
  ? drLatRef.current
  : userLocation?.latitude ?? 0;

  const markerLng = ((isNavigating || isDriving) && drLngRef.current !== 0)
    ? drLngRef.current
    : userLocation?.longitude ?? 0;

  // heading dla driving mode — zawsze lastHeadingRef dla płynności
  const markerHdg = ((isNavigating || isDriving) && drHdgRef.current !== 0)
    ? drHdgRef.current
    : lastHeadingRef.current !== 0
      ? lastHeadingRef.current
      : heading;

  // ── Czy pokazać prędkościomierz ───────────────────────────
  const showSpeedPanel = isNavigating || isDriving || speedKmh > 5;

  // ─────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────

  return (
    <>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>

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
          !markerImages[user.id] ? (
            <MarkerRenderer
              key={`renderer_${user.id}`}
              user={user}
              distance={calculateDistance(
                userLocation.latitude, userLocation.longitude,
                user.latitude, user.longitude,
              )}
              onCapture={uri => setMarkerImages(prev => ({ ...prev, [user.id]: uri }))}
            />
          ) : null,
        )}

        {userLocation && (
          <CarMarkerRenderer
            avatarUrl={myAvatarUrl}
            username={myUsername}
            onCapture={setCarMarkerImage}
          />
        )}

        {userLocation && (
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

        {/* ── Panel DRIVING MODE (góra) ────────────────────── */}
        {isDriving && !isNavigating && (
          <View style={[styles.navigationPanelTop, { top: insets.top + 52 }]}>
            <View style={styles.instructionBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{
                  width: 56, height: 56,
                  backgroundColor: '#1a1a1a',
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: '#fa391f',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <MaterialCommunityIcons name="car-sports" size={32} color="#fa391f" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{
                    fontFamily: 'Orbitron', fontSize: 18,
                    color: '#fa391f', fontWeight: '900', letterSpacing: 2,
                  }}>
                    TRYB JAZDY
                  </Text>
                  <Text style={{
                    fontFamily: 'Orbitron', fontSize: 9,
                    color: '#ffffffcc', marginTop: 3, letterSpacing: 1,
                  }}>
                    {drivingKm.toFixed(1)} km · aktywna sesja
                  </Text>
                </View>
                {/* Prędkość w nagłówku */}
                <View style={{ alignItems: 'center', gap: 4 }}>
                  {/* Znak ograniczenia prędkości — zawsze widoczny */}
                  {(() => {
                    const overLimit = speedLimit !== null && speedKmh > speedLimit + SPEED_LIMIT_TOLERANCE;
                    const smallFont = speedLimit !== null && speedLimit >= 100;
                    return (
                      <View style={{
                        width: 36, height: 36, borderRadius: 18,
                        backgroundColor: '#fff', borderWidth: 3,
                        borderColor: overLimit ? '#e33835' : '#333',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Text style={{
                          fontFamily: 'Orbitron', fontSize: smallFont ? 8 : 10,
                          color: overLimit ? '#e33835' : '#111',
                          fontWeight: '900',
                        }}>
                          {speedLimit ?? '—'}
                        </Text>
                      </View>
                    );
                  })()}
                  <View style={{
                    backgroundColor: '#fa391f57',
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderWidth: 1,
                    borderColor: '#fa391f',
                    alignItems: 'center',
                    minWidth: 64,
                  }}>
                    <Text style={{
                      fontFamily: 'Orbitron', fontSize: 24,
                      color: speedLimit !== null && speedKmh > speedLimit + SPEED_LIMIT_TOLERANCE ? '#e33835' : '#fff',
                      fontWeight: '700',
                    }}>
                      {Math.round(speedKmh)}
                    </Text>
                    <Text style={{
                      fontFamily: 'Orbitron', fontSize: 7,
                      color: '#ffffff50', letterSpacing: 2,
                    }}>
                      km/h
                    </Text>
                  </View>
                </View>
              </View>
            </View>
            {/* Brak close button — wychodzi auto po DRIVING_STOP_DELAY_MS */}
          </View>
        )}

        {/* ── Baner tworzenia trasy ────────────────────────── */}
        {isBuilding && (
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
            backgroundColor: '#e33835',
            paddingTop:    insets.top + 12,
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
        {/* ── Ad Banner (tylko gdy nie trwa nawigacja) ──────── */}
        {!isNavigating && !isDriving && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999999999 }}>
            <AdBanner BANNERID='ca-app-pub-1660420496578702/5609918502' />
          </View>
        )}
        <Mapbox.MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          styleURL={mapStyle}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          pitchEnabled
          rotateEnabled
          onPress={(e: any) => {
            if (!isBuilding) return;
            const [longitude, latitude] = e.geometry.coordinates;
            addPin(latitude, longitude);
          }}
          onRegionDidChange={(e: any) => {
            const zoom = e.properties?.zoomLevel ?? 14;
            setCurrentZoom(zoom);
          }}
          onCameraChanged={(e: any) => {
            if (e.properties?.isUserInteraction) onUserPan();
          }}
        >
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{
              centerCoordinate: [userLocation?.longitude ?? 19.0, userLocation?.latitude ?? 52.0],
              zoomLevel: 14,
              pitch: 0,
            }}
          />
          <Mapbox.UserLocation visible={false} />

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

          {currentZoom >= 12 && fuelStations.map(station => (
            <FuelStationMarker
              key={`fuel_${station.id}`}
              station={station}
              onPress={() => { setSelectedFuelStation(station); setFuelStationModalVisible(true); }}
            />
          ))}

          {isBuilding && snappedRoute.length > 1 && (
            <>
              <Mapbox.ShapeSource id="snappedShadowSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: snappedRoute.map((c: any) => [c.longitude, c.latitude]) }, properties: {} }}>
                <Mapbox.LineLayer id="snappedShadowLayer" style={{ lineColor: '#00000070', lineWidth: 10, lineCap: 'round', lineJoin: 'round' }} />
              </Mapbox.ShapeSource>
              <Mapbox.ShapeSource id="snappedRouteSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: snappedRoute.map((c: any) => [c.longitude, c.latitude]) }, properties: {} }}>
                <Mapbox.LineLayer id="snappedRouteLayer" style={{ lineColor: '#e33835', lineWidth: 6, lineCap: 'round', lineJoin: 'round' }} />
              </Mapbox.ShapeSource>
              <Mapbox.ShapeSource id="snappedGlowSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: snappedRoute.map((c: any) => [c.longitude, c.latitude]) }, properties: {} }}>
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
          {userLocation && (
            <CarMarker
              latitude={markerLat}
              longitude={markerLng}
              heading={markerHdg}
              imageUri={settings.locationMarkerStyle === 'arrow' ? arrowMarkerImage : carMarkerImage}
            />
          )}
        </Mapbox.MapView>

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
            position: 'absolute', top: insets.top + 122,
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
              borderColor: speedLimit !== null && speedKmh > speedLimit + SPEED_LIMIT_TOLERANCE ? '#e33835' : '#333',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 4, alignSelf: 'center',
            }}>
              <Text style={{
                fontFamily: 'Orbitron', fontSize: 11, fontWeight: '900',
                color: speedLimit !== null && speedKmh > speedLimit + SPEED_LIMIT_TOLERANCE ? '#e33835' : '#111',
              }}>
                {speedLimit ?? '—'}
              </Text>
            </View>
            <Text style={[
              styles.speedValue,
              speedLimit !== null && speedKmh > speedLimit + SPEED_LIMIT_TOLERANCE && { color: '#e33835' },
            ]}>
              {formatSpeed(speed)}
            </Text>
            <Text style={styles.speedLabel}>KM/H</Text>

            {isDriving && !isNavigating && drivingKm > 0 && (
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#268bffaa', marginTop: 4, letterSpacing: 1 }}>
                {drivingKm.toFixed(1)} km
              </Text>
            )}
          </View>
        )}

        {/* ── Przyciski boczne ─────────────────────────────── */}
        <View style={[
          styles.rightBottomControls,
          !isNavigating && !isDriving && {
            bottom: startLocation && endLocation && routeInfo ? 248 : 188
          },
          isDriving && !isNavigating && {
            bottom: 120
          },
        ]}>
          {/* ── Przycisk trybu jazdy ─────────────────────── */}
          {!isNavigating && (
            <TouchableOpacity
              style={[
                styles.sideBtn,
                isDriving
                  ? { backgroundColor: '#268bff25', borderColor: '#268bff70' }
                  : { backgroundColor: isDark ? '#ffffff08' : '#ffffffee', borderColor: isDark ? '#ffffff10' : '#00000018' },
              ]}
              onPress={handleToggleDrivingMode}
              activeOpacity={0.75}
            >
              <MaterialCommunityIcons
                name="car-outline"
                size={20}
                color={isDriving ? '#268bff' : theme.textDim}
              />
            </TouchableOpacity>
          )}

          {
            !isDriving && (
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
            )
          }

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

          {connected && isSharing && (
            <View style={{
              position: 'absolute', top: insets.top + 8, right: 12,
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: '#4de92618', paddingHorizontal: 8, paddingVertical: 4,
              borderRadius: 20, borderWidth: 1, borderColor: '#4de92635', zIndex: 15,
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#4de926' }} />
              <Text style={{ color: '#4de926', fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 2 }}>LIVE</Text>
            </View>
          )}

          <TouchableOpacity style={styles.sideBtn} onPress={handleCenterOnUser} activeOpacity={0.75}>
            <MaterialIcons name="my-location" size={20} color={theme.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.sideBtn,
              !isSpeechEnabled
                ? { backgroundColor: '#e3383525', borderColor: '#e3383545' }
                : { backgroundColor: isDark ? '#ffffff08' : '#ffffffee', borderColor: isDark ? '#ffffff10' : '#00000018' },
            ]}
            onPress={() => setIsSpeechEnabled(v => !v)}
            activeOpacity={0.75}
          >
            <MaterialIcons
              name={isSpeechEnabled ? 'volume-up' : 'volume-off'}
              size={20}
              color={isSpeechEnabled ? theme.textMuted : theme.primary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sideBtn, { borderColor: '#ff922b45', backgroundColor: '#ff922b12' }]}
            onPress={() => setReportVisible(true)}
            activeOpacity={0.75}
          >
            <MaterialIcons name="warning" size={20} color="#ff922b" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sideBtn, { borderColor: '#FFD70045', backgroundColor: '#FFD70012' }]}
            onPress={() => setAddCameraVisible(true)}
            activeOpacity={0.75}
          >
            <MaterialCommunityIcons name="camera-plus-outline" size={20} color="#FFD700" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.sideBtn} onPress={() => setSettingsVisible(true)} activeOpacity={0.75}>
            <MaterialCommunityIcons name="layers-outline" size={22} color={theme.textMuted} />
          </TouchableOpacity>
        </View>

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
                : 'Wyszukaj trasę...'
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
        {!isNavigating && !isBuilding && !startLocation && !endLocation && !searchModalVisible && !isDriving && (
          <View style={styles.emptyStateContainer}>
            <View style={styles.emptyState}>
              <MaterialIcons name="location-on" size={40} color="#e33835ce" />
              <Text style={styles.emptyTitle}>WYBIERZ TRASĘ</Text>
              <Text style={styles.emptySubtitle}>Dotknij paska wyszukiwania</Text>
            </View>
          </View>
        )}

        {/* ── Modale ───────────────────────────────────────── */}
        <SearchModal
          visible={searchModalVisible}
          onClose={() => setSearchModalVisible(false)}
          onSelectStart={handleSelectStart}
          onSelectEnd={handleSelectEnd}
          userLocation={userLocation}
          nearbyUsers={nearbyUsers}
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

        <FuelStationModal
          visible={fuelStationModalVisible}
          station={selectedFuelStation}
          onClose={() => setFuelStationModalVisible(false)}
          onNavigate={(lat, lng, name) => {
            setEndLocation({ latitude: lat, longitude: lng, name });
            setFuelStationModalVisible(false);
          }}
          onPricesUpdated={refetchFuelStations}
          updatePrices={updateFuelPrices}
        />

        
      </View>
    </>
  );
}