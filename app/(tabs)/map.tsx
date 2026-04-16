import React, {
  useState, useEffect, useRef, useMemo, useCallback,
} from 'react';
import {
  View, Text, ActivityIndicator, TouchableOpacity,
  Platform, Alert, StyleSheet, NativeModules, StatusBar,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useRouter } from 'expo-router';
import { useChat } from '../../hooks/useChats';
import { useKeepAwake } from 'expo-keep-awake';

const { UsersModule } = NativeModules;
import { useTheme } from '../../contexts/ThemeContext';
import { makeMapStyles } from '../../styles/mapstyle';

import { User, LocationState, RouteInfo } from '../../constants/types';
import {
  GOOGLE_MAPS_APIKEY,
  customMapStyle,
  lightMapStyle,
  MAX_NEARBY_USERS_DISTANCE,
  API_URL,
} from '../../constants/mapConfig';

import { latFilter, lngFilter, navLatFilter, navLngFilter } from '../../scripts/kalmanFilter';
// ── NOWE: sanity check ────────────────────────────────────
import { isSaneLocation } from '../../scripts/kalmanFilter';

import { calculateDistance }         from '../../scripts/distance';
import {
  cleanInstruction,
  formatDuration,
  formatSpeed,
  detectCurrentStep,
  isOnRoute,
  getManeuverIcon,
  haversineKm,
  findClosestPointIndex,
  snapToRoute,
} from '../../scripts/navigationUtils';
import { useGoogleDirections, useGoogleDirectionsAlternatives } from '../../hooks/useGoogleDirections';
import { useCameraAnimation }        from '../../hooks/useCameraAnimation';
import { useNavigationPoints }       from '../../hooks/useNavigationPoints';
import { useNavigationNotification } from '../../hooks/useNavigationNotification';
import { useDeadReckoning }          from '../../hooks/useDeadReckoning';
import { useDemoUsers }              from '../../hooks/useDemoUsers';
import { useRouteTimer }             from '../../hooks/useRouteTimer';
import { useRouteLeaderboard }       from '../../hooks/useRouteLeaderboard';
import {
  useLiveMap,
  getWarningLabel,
  LiveWarning,
  clusterWarnings,
} from '../../hooks/useLiveMap';
import {
  useBackgroundTracking,
  feedSpeedSample,
  feedNavDistance,
  resetSpeedStats,
} from '../../hooks/useBackgroundTracking';
import { useRouteBuilder }           from '../../hooks/useRouteBuilder';
import { useNavigationSimulator }    from '../../hooks/useNavigationSimulator';
import { useTripStats }              from '../../hooks/useTripStats';
import { useAdaptiveGPS }            from '../../hooks/useAdaptiveGPS';
import { useDrivingSnap }            from '../../hooks/useDrivingSnap';
import { useSpeedCameras }           from '../../hooks/useSpeedCamera';
import { useSpeedLimit }             from '../../hooks/useSpeedLimit';
import { useSnapCameras }            from '../../hooks/useSnapCameras';

import { SpeedCameraDetailModal }    from '../../components/modals/SpeedCameraDetailModal';
import { AddSpeedCameraModal }       from '../../components/modals/AddSpeedCameraModal';
import { SpeedCameraAlert }          from '../../components/ui/SpeedCameraAlert';
import { SpeedCameraRenderer }       from '../../components/markers/SpeedCameraRenderer';
import { SpeedCameraMarker }         from '../../components/markers/SpeedCameraMarker';
import { SaveRouteModal }            from '../../components/modals/SaveRouteModal';
import { CarMarker }                 from '../../components/markers/CarMarker';
import { CarMarkerRenderer }         from '../../components/markers/CarMarkerRenderer';
import { UserCarMarker }             from '../../components/markers/UserCarMarker';
import { MarkerRenderer }            from '../../components/markers/MarkerRenderer';
import { WarningMarkerRenderer }     from '../../components/markers/WarningMarkerRenderer';
import { UserInfoModal }             from '../../components/modals/UserInfoModal';
import { SearchModal }               from '../../components/modals/SearchModal';
import { SettingsModal }             from '../../components/modals/SettingsModal';
import { ReportModal }               from '../../components/modals/ReportModal';
import { WarningDetailModal }        from '../../components/modals/WarningDetailModal';
import { RoutePinRenderer }          from '../../components/markers/RoutePinRenderer';
import { RouteEndpointRenderer }     from '@/components/markers/RouteEndpointRenderer';
import { RouteLeaderboardModal }     from '../../components/modals/RouteLeaderboardModal';
import { TripStatsModal }            from '../../components/modals/TripStatsModal';

// ─────────────────────────────────────────────────────────────────────────────
const REROUTE_THRESHOLD_M = 40;
const ANNOUNCE_M          = 250;
const NAV_ZOOM            = 15.3;
const NAV_PITCH           = 90;

// ── DRIVING MODE ──────────────────────────────────────────
// Czas (ms) jazdy <10 km/h zanim wyłączymy tryb driving
const DRIVING_STOP_DELAY_MS = 12 * 60 * 1000; // 12 minut
const DRIVING_SPEED_KMH     = 10;

// ─────────────────────────────────────────────────────────────────────────────
export default function MapScreen() {
  useKeepAwake(); 

  // ── Refs – mapa i GPS ────────────────────────────────────
  const mapRef               = useRef<MapView>(null);
  const locationSubRef       = useRef<any>(null);
  const lastHeadingRef       = useRef(0);
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

  // ── NOWE Refs — GPS sanity + driving mode ─────────────────
  const lastGoodLocRef        = useRef<{ lat: number; lng: number } | null>(null);
  const drivingStopTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDrivingRef          = useRef(false);
  const drivingKmRef          = useRef(0);
  const drivingLastLocRef     = useRef<{ lat: number; lng: number } | null>(null);
  const lastGoodTimeRef = useRef<number>(Date.now());
  
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
  const [arrived,      setArrived]      = useState(false);
  const [routeInfo,    setRouteInfo]    = useState<RouteInfo | null>(null);
  const [isOffroadRoute, setIsOffroadRoute] = useState(false);

  // ── State – dr tick ───────────────────────────────────────
  const [drTick, setDrTick] = useState(0);

  // ── NOWY State — tryb driving ─────────────────────────────
  const [isDriving,    setIsDriving]    = useState(false);
  const [drivingKm,    setDrivingKm]    = useState(0);   // km przejechane w trybie

  // ── State – markery ───────────────────────────────────────
  const [carMarkerImage,      setCarMarkerImage]      = useState<string | null>(null);
  const [myAvatarUrl,         setMyAvatarUrl]         = useState<string | null>(null);
  const [myUsername,          setMyUsername]          = useState('');
  const [markerImages,        setMarkerImages]        = useState<Record<string, string>>({});
  const [warningImages,       setWarningImages]       = useState<Record<number, string>>({});
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

  // ─────────────────────────────────────────────────────────
  // Hooki
  // ─────────────────────────────────────────────────────────

  const router = useRouter();
  const { theme, isDark } = useTheme();
  const styles = makeMapStyles(theme, isDark);
  const activeMapStyle = isDark ? customMapStyle : lightMapStyle;
  const { startConversation } = useChat();

  const { snap: drivingSnap, setRoutePoints: setSnapPoints, reset: resetSnap } = useDrivingSnap();
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
      const dist = Math.round(nearestCamera.distanceM);
      const msg  = nearestCamera.maxspeed
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
  } = useCameraAnimation(mapRef);

  useEffect(() => {
    if (!userLocation) return;
    updateCameras(userLocation.latitude, userLocation.longitude);
    updateSpeedLimit(userLocation.latitude, userLocation.longitude);
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
      if (!isNavigatingRef.current) return;

      const points = routePointsRef.current;
      let snappedPos = pos;

      if (points.length > 1) {
        const snapped = snapToRoute(pos.latitude, pos.longitude, points, 25);
        snappedPos = { latitude: snapped.latitude, longitude: snapped.longitude };
      }

      drLatRef.current = snappedPos.latitude;
      drLngRef.current = snappedPos.longitude;
      drHdgRef.current = hdg;

      drTickRef.current += 1;
      if (drTickRef.current % 2 === 0) {
        setDrTick(t => t + 1);
      }

      animateCameraLive({
        center:  snappedPos,
        pitch:   NAV_PITCH,
        heading: hdg,
        zoom:    NAV_ZOOM,
      });
    }, [animateCameraLive]),
    stallTimeout: 2500,
  });

  const { flushPendingKm }                                            = useBackgroundTracking(isSharing);
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
    offRoute ? userLocation : null,
    offRoute ? endLocation  : null,
    GOOGLE_MAPS_APIKEY,
    offRoute ? lastHeadingRef.current : undefined,
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

  useEffect(() => {
    const pinIds = new Set(pins.map(p => p.id));
    setPinImages(prev => {
      const next: Record<string, string> = {};
      Object.keys(prev).forEach(k => { if (pinIds.has(k)) next[k] = prev[k]; });
      return next;
    });
  }, [pins]);

  useEffect(() => {
    const activeIds = new Set(warnings.map(w => w.id));
    setWarningImages(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (!activeIds.has(Number(k))) delete next[Number(k)];
      });
      return next;
    });
  }, [warnings]);

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

  const enterDrivingMode = useCallback(() => {
    if (isDrivingRef.current) return;
    isDrivingRef.current = true;
    setIsDriving(true);
    drivingKmRef.current    = 0;
    drivingLastLocRef.current = null;
    setDrivingKm(0);
  }, []);

  const exitDrivingMode = useCallback(() => {
    isDrivingRef.current        = false;
    drivingKmRef.current        = 0;
    drivingLastLocRef.current   = null;
    if (drivingStopTimerRef.current) {
      clearTimeout(drivingStopTimerRef.current);
      drivingStopTimerRef.current = null;
    }
    setIsDriving(false);
    setDrivingKm(0);
    // NIE wywołuj exitDrivingCamera gdy wywołane z beginNavigation
    // — nawigacja sama przejmuje kamerę przez lockForStart
  }, []);

  // Wywołuj przy każdej aktualizacji GPS — zarządza timerem stopu
  const handleDrivingSpeedUpdate = useCallback((kmh: number, lat: number, lng: number) => {
    if (isNavigatingRef.current) return; // nawigacja przejmuje kontrolę

    if (kmh >= DRIVING_SPEED_KMH) {
      // Jedzie — anuluj timer stopu i aktywuj tryb
      if (drivingStopTimerRef.current) {
        clearTimeout(drivingStopTimerRef.current);
        drivingStopTimerRef.current = null;
      }
      enterDrivingMode();

      // Licz km
      if (drivingLastLocRef.current) {
        const dist = haversineKm(
          drivingLastLocRef.current.lat, drivingLastLocRef.current.lng,
          lat, lng,
        );
        drivingKmRef.current += dist;
        setDrivingKm(Math.round(drivingKmRef.current * 10) / 10);
      }
      drivingLastLocRef.current = { lat, lng };

    } else {
      // Wolno / stoi — uruchom timer stopu jeśli jeszcze nie ma
      if (isDrivingRef.current && !drivingStopTimerRef.current) {
        drivingStopTimerRef.current = setTimeout(() => {
          exitDrivingMode();
          drivingStopTimerRef.current = null;
        }, DRIVING_STOP_DELAY_MS);
      }
    }
  }, [enterDrivingMode, exitDrivingMode]);

  // ─────────────────────────────────────────────────────────
  // Adaptive GPS
  // ─────────────────────────────────────────────────────────
  const speedKmhRef = useRef(0);
  speedKmhRef.current = (speed ?? 0) * 3.6;

  const { start: startGPS, stop: stopGPS } = useAdaptiveGPS({
    isNavigating,
    speedKmh: speedKmhRef.current,
    // ── Adaptive GPS onLocation — zastąp cały blok onLocation ──
      onLocation: useCallback((loc) => {
      const rawLat = loc.latitude;
      const rawLng = loc.longitude;
      const acc    = loc.accuracy ?? 10;
      const now    = Date.now();

      // ══ 1. SANITY CHECK — surowe vs surowe ══════════════════
      if (lastGoodLocRef.current) {
        const dtMs   = now - lastGoodTimeRef.current;
        const safeDt = Math.max(dtMs, 100);
        const sane   = isSaneLocation(
          rawLat, rawLng,
          lastGoodLocRef.current.lat,
          lastGoodLocRef.current.lng,
          250,
          safeDt,
        );
        if (!sane) {
          console.warn('[GPS map] Skok odrzucony');
          latFilter.reset();
          lngFilter.reset();
          navLatFilter.reset();
          navLngFilter.reset();
          return;
        }
      }
      lastGoodTimeRef.current    = now;
      lastGoodLocRef.current     = { lat: rawLat, lng: rawLng }; // ← zawsze RAW

      // ══ 2. Kalman ════════════════════════════════════════════
      const lat = isNavigatingRef.current
        ? navLatFilter.filter(rawLat, acc)
        : latFilter.filter(rawLat, acc);
      const lng = isNavigatingRef.current
        ? navLngFilter.filter(rawLng, acc)
        : lngFilter.filter(rawLng, acc);

      // ══ 3. Prędkość — TYLKO z GPS, nigdy obliczana ze skoku ═
      const rawSpeedMs = loc.speed != null && loc.speed >= 0 ? loc.speed : 0;
      const kmh        = rawSpeedMs * 3.6;

      // ══ 4. Feed stats — tylko RAZ ════════════════════════════
      feedSpeedSample(rawSpeedMs);
      feedSpeed(rawSpeedMs > 0 ? rawSpeedMs : null);
      feedPosition(lat, lng);

      // ══ 5. Feed dystansu nawigacji ════════════════════════════
      if (lastNavLocRef.current) {
        feedNavDistance(
          lastNavLocRef.current.latitude, lastNavLocRef.current.longitude,
          lat, lng,
        );
      }
      lastNavLocRef.current = { latitude: lat, longitude: lng };

      // ══ 6. Dead reckoning — tylko nawigacja ══════════════════
      if (isNavigatingRef.current) {
        feedDR(
          { latitude: lat, longitude: lng },
          rawSpeedMs,
          loc.heading ?? lastHeadingRef.current,
        );
      }

      // ══ 7. Heading ═══════════════════════════════════════════
      const newH = loc.heading ?? lastHeadingRef.current;
      if (kmh > 3 && newH >= 0) {
        const diff           = newH - lastHeadingRef.current;
        const normalizedDiff = ((diff + 540) % 360) - 180;
        const smoothed       = lastHeadingRef.current + normalizedDiff * 0.4;
        const finalHeading   = ((smoothed % 360) + 360) % 360;
        if (Math.abs(normalizedDiff) > 2) {
          setHeading(finalHeading);
          lastHeadingRef.current = finalHeading;
        }
      }

      // ══ 8. Pozycja + driving mode ════════════════════════════
      if (!isNavigatingRef.current) {
        const snapped = drivingSnap(lat, lng, kmh, isDrivingRef.current);

        setUserLocation({ latitude: snapped.latitude, longitude: snapped.longitude });

        if (kmh >= DRIVING_SPEED_KMH) {
          if (drivingStopTimerRef.current) {
            clearTimeout(drivingStopTimerRef.current);
            drivingStopTimerRef.current = null;
          }

          if (!isDrivingRef.current) {
            isDrivingRef.current      = true;
            drivingKmRef.current      = 0;
            drivingLastLocRef.current = null;
            setIsDriving(true);
            setDrivingKm(0);
            enterDrivingCamera(
              { latitude: snapped.latitude, longitude: snapped.longitude },
              lastHeadingRef.current,
            );
            return;
          }

          if (drivingLastLocRef.current) {
            const dist = haversineKm(
              drivingLastLocRef.current.lat, drivingLastLocRef.current.lng,
              snapped.latitude, snapped.longitude,
            );
            if (dist > 0 && dist < 0.1) {
              drivingKmRef.current += dist;
              setDrivingKm(Math.round(drivingKmRef.current * 10) / 10);
            }
          }
          drivingLastLocRef.current = { lat: snapped.latitude, lng: snapped.longitude };

          animateCameraLive({
            center:  { latitude: snapped.latitude, longitude: snapped.longitude },
            pitch:   NAV_PITCH,
            heading: lastHeadingRef.current,
            zoom:    NAV_ZOOM,
          });

        } else {
          if (isDrivingRef.current && !drivingStopTimerRef.current) {
            drivingStopTimerRef.current = setTimeout(() => {
              isDrivingRef.current        = false;
              drivingKmRef.current        = 0;
              drivingLastLocRef.current   = null;
              drivingStopTimerRef.current = null;
              setIsDriving(false);
              setDrivingKm(0);
              if (lastGoodLocRef.current) {
                exitDrivingCamera({
                  latitude:  lastGoodLocRef.current.lat,
                  longitude: lastGoodLocRef.current.lng,
                });
              }
            }, DRIVING_STOP_DELAY_MS);
          }
        }
      } else {
        // ── Nawigacja — ustaw pozycję z Kalmana, DR animuje kamerę
        setUserLocation({ latitude: lat, longitude: lng });
      }

      setSpeed(rawSpeedMs > 0 ? rawSpeedMs : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivingSnap, feedSpeed, feedPosition, animateCameraLive, enterDrivingCamera, exitDrivingCamera]),
    // ↑ celowo minimalne deps — reszta przez refy
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

      mapRef.current?.animateCamera(
        { center: { latitude: lookaheadLat, longitude: lookaheadLng }, pitch: NAV_PITCH, heading: hdg, zoom: NAV_ZOOM },
        { duration: 90 },
      );

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
    }, []),
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

    // ── Aktualizuj remainingRoutePoints na bieżąco ──
    if (points.length > 1) {
      const idx = findClosestPointIndex(lat, lng, points);
      setRemainingRoutePoints([
        { latitude: lat, longitude: lng },
        ...points.slice(idx + 1),
      ]);
    }

  // ← DODAJ drTick do deps — efekt odpala się przy każdej klatce DR
  }, [userLocation, isNavigating, drTick]);

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
  }, [rerouteResult, offRoute, userLocation]);

  useEffect(() => {
    if (!startIsMyLocationRef.current || !userLocation || isNavigating) return;
    if (isDriving && endLocation) return; // ← NOWE: w driving mode z celem nie nadpisuj
    setStartLocation(prev => ({ ...userLocation, name: prev?.name ?? 'Moja pozycja' }));
  }, [userLocation, isNavigating, isDriving, endLocation]);

  const activeRoute = isNavigating ? navRoute : previewRoute;
  navRouteRef.current = navRoute ?? null;
  const activeSteps = navRoute?.steps ?? previewRoute?.steps ?? [];

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

  useEffect(() => {
    if (!userLocation || !isSharing) return;
    sendLocation(userLocation.latitude, userLocation.longitude, activeRoute?.points ?? []);
  }, [userLocation, isSharing, activeRoute]);

  useEffect(() => {
    if (!isSharing) return;
    const interval = setInterval(() => {
      if (!userLocation) return;
      sendLocation(userLocation.latitude, userLocation.longitude, activeRoute?.points ?? []);
    }, 5000);
    return () => clearInterval(interval);
  }, [isSharing, userLocation, activeRoute, sendLocation]);

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

  const resetDRRefs = useCallback(() => {
    drLatRef.current  = 0;
    drLngRef.current  = 0;
    drHdgRef.current  = 0;
    drTickRef.current = 0;
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

  const handleWarningCapture = useCallback((id: number, uri: string) => {
    setWarningImages(prev => ({ ...prev, [id]: uri }));
  }, []);

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
      mapRef.current?.animateCamera(
        { center: userLocation, pitch: NAV_PITCH, heading: lastHeadingRef.current, zoom: NAV_ZOOM },
        { duration: 500 },
      );
    } else {
      resetCamera(userLocation);
    }
  }, [userLocation, isNavigating, isDriving, resetCamera, unlockCamera]);

  // ── handleArrived ─────────────────────────────────────────
  const handleArrived = useCallback(async () => {
    isNavigatingRef.current = false;
    stopDR();
    const finalStats = finishTrip();
    setTimeout(() => setTripStatsVisible(true), 2000);
    setIsNavigating(false);
    setArrived(true);
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

    mapRef.current?.animateCamera(
      { center: { latitude: startLat, longitude: startLng }, pitch: NAV_PITCH, heading: startHdg, zoom: NAV_ZOOM },
      { duration: 800 },
    );

    setTimeout(() => {
      if (!isNavigatingRef.current) return;
      mapRef.current?.animateCamera(
        {
          center: {
            latitude:  drLatRef.current || startLat,
            longitude: drLngRef.current || startLng,
          },
          pitch:   NAV_PITCH,
          heading: drHdgRef.current || startHdg,
          zoom:    NAV_ZOOM,
        },
        { duration: 300 },
      );
    }, 900);

    speak('Nawigacja rozpoczęta. Dobrej drogi!');
  }, [userLocation, routeInfo, speak, onNavigationStart, startTimer, unlockCamera,
      lockForStart, resetDR, resetDRRefs, exitDrivingMode, activeRoute]);

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

  const markerLat = (isNavigating && drLatRef.current !== 0)
  ? drLatRef.current
  : userLocation?.latitude ?? 0;

  const markerLng = (isNavigating && drLngRef.current !== 0)
    ? drLngRef.current
    : userLocation?.longitude ?? 0;

  // heading dla driving mode — zawsze lastHeadingRef dla płynności
  const markerHdg = (isNavigating && drHdgRef.current !== 0)
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
            heading={heading}
            avatarUrl={myAvatarUrl}
            username={myUsername}
            onCapture={setCarMarkerImage}
          />
        )}

        {clusteredWarnings.map(w => (
          <WarningMarkerRenderer
            key={`wrenderer_${w.id}_${w.confirmCount}`}
            warning={w}
            onCapture={handleWarningCapture}
          />
        ))}

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
          <View style={[styles.navigationPanelTop, { top: 100 }]}>
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
                    color: '#fff', fontWeight: '700',
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
            {/* Brak close button — wychodzi auto po DRIVING_STOP_DELAY_MS */}
          </View>
        )}

        {/* ── Baner tworzenia trasy ────────────────────────── */}
        {isBuilding && (
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
            backgroundColor: '#e33835',
            paddingTop:    Platform.OS === 'ios' ? 54 : 36,
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
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFillObject}
          customMapStyle={activeMapStyle}
          initialRegion={region}
          mapType={mapType as any}
          showsUserLocation={false}
          pitchEnabled
          rotateEnabled
          moveOnMarkerPress={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          onPanDrag={onUserPan}
          onPress={(e) => {
            if (!isBuilding) return;
            const { latitude, longitude } = e.nativeEvent.coordinate;
            addPin(latitude, longitude);
          }}
        >
          {userLocation && (
            <CarMarker
              latitude={markerLat}
              longitude={markerLng}
              heading={markerHdg}
              imageUri={carMarkerImage}
            />
          )}

          {endLocation && !arrived && (
            <Marker
              coordinate={{ latitude: endLocation.latitude, longitude: endLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }} zIndex={100} tracksViewChanges={false}
            >
              <View style={{
                backgroundColor: '#111111', padding: 8, borderRadius: 12,
                borderWidth: 2, borderColor: '#e33835', alignItems: 'center',
                shadowColor: '#e33835', shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.6, shadowRadius: 6, elevation: 8,
              }}>
                <MaterialIcons name="flag" size={20} color="#e33835" />
              </View>
            </Marker>
          )}

          {startLocation && !isNavigating && !isBuilding && (
            <Marker
              coordinate={{ latitude: startLocation.latitude, longitude: startLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }} zIndex={99} tracksViewChanges={false}
            >
              <View style={{
                backgroundColor: '#111111', padding: 8, borderRadius: 12,
                borderWidth: 2, borderColor: '#4de926', alignItems: 'center',
              }}>
                <MaterialIcons name="radio-button-on" size={18} color="#4de926" />
              </View>
            </Marker>
          )}

          {isBuilding && pins.map((pin, index) => (
            <Marker
              key={`pin_${pin.id}`}
              coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
              onPress={(e) => { e.stopPropagation(); removePin(pin.id); }}
              onCalloutPress={() => removePin(pin.id)}
              zIndex={200 + index}
              title={pin.label}
              description="🗑️ Dotknij aby usunąć"
              {...(pinImages[pin.id]
                ? { image: { uri: pinImages[pin.id] } }
                : { pinColor: index === 0 ? '#4de926' : index === pins.length - 1 ? '#e33835' : '#ff922b' }
              )}
            />
          ))}

          {showCameras && snappedCameras.map(c => (
            <SpeedCameraMarker
              key={`cam_${String(c.id)}`}
              camera={c}
              imageUri={cameraImages[String(c.id)] ?? null}
              onPress={() => { setSelectedCamera(c); setCameraDetailVisible(true); }}
            />
          ))}

          {isBuilding && snappedRoute.length > 1 && (
            <>
              <Polyline coordinates={snappedRoute} strokeColor="#00000070" strokeWidth={10} geodesic lineCap="round" lineJoin="round" />
              <Polyline coordinates={snappedRoute} strokeColor="#e33835"   strokeWidth={6}  geodesic lineCap="round" lineJoin="round" />
              <Polyline coordinates={snappedRoute} strokeColor="#ffffff20" strokeWidth={3}  geodesic lineCap="round" lineJoin="round" />
            </>
          )}

          {isBuilding && pins.length > 1 && snappedRoute.length === 0 && (
            <>
              <Polyline
                coordinates={pins.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
                strokeColor="#00000080" strokeWidth={8}
              />
              <Polyline
                coordinates={pins.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
                strokeColor="#ff922b" strokeWidth={4} lineDashPattern={[12, 7]}
              />
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
              <Polyline
                coordinates={remainingRoutePoints}
                strokeColor="#00000055" strokeWidth={11}
                geodesic lineCap="round" lineJoin="round"
              />
              <Polyline
                coordinates={remainingRoutePoints}
                strokeColor={isNavigating ? '#e33835dd' : '#00bfff'} strokeWidth={6}
                geodesic lineCap="round" lineJoin="round"
              />
              {isNavigating && (
                <Polyline
                  coordinates={remainingRoutePoints}
                  strokeColor="#ffffff15" strokeWidth={8}
                  geodesic lineCap="round" lineJoin="round"
                />
              )}
            </>
          )}

          {startLocation && !isNavigating && routeEndpointImages.start && (
            <Marker
              coordinate={{ latitude: startLocation.latitude, longitude: startLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }} zIndex={99} tracksViewChanges={false}
              image={{ uri: routeEndpointImages.start }}
            />
          )}
          {endLocation && !arrived && routeEndpointImages.end && (
            <Marker
              coordinate={{ latitude: endLocation.latitude, longitude: endLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }} zIndex={100} tracksViewChanges={false}
              image={{ uri: routeEndpointImages.end }}
            />
          )}

          {clusteredWarnings
            .filter(w => warningImages[w.id] && !isNaN(Number(w.lat)) && !isNaN(Number(w.lng)))
            .map(w => (
              <Marker
                key={`warning_${w.id}`}
                coordinate={{ latitude: Number(w.lat), longitude: Number(w.lng) }}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={500}
                tracksViewChanges={false}
                onPress={() => setSelectedWarning(w)}
                image={{ uri: warningImages[w.id] }}
              />
            ))
          }
        </MapView>

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
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 26, color: '#fff', fontWeight: '900', letterSpacing: 1 }}>
                        {currentStepData.distance?.text}
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
                    {routeInfo && (
                      <>
                        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#ffffff30' }} />
                        <MaterialIcons name="schedule" size={10} color="#e33835" />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#e33835', fontWeight: '700' }}>
                          {formatDuration(routeInfo.duration)}
                        </Text>
                        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#ffffff30' }} />
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff50' }}>
                          cel: {new Date(Date.now() + (routeInfo.duration ?? 0) * 1000).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
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
            position: 'absolute', top: Platform.OS === 'ios' ? 160 : 145,
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
            {speedLimit !== null && (
              <View style={{
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: '#fff', borderWidth: 4,
                borderColor: speedKmh > speedLimit + 5 ? '#e33835' : '#333',
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 4, alignSelf: 'center',
              }}>
                <Text style={{
                  fontFamily: 'Orbitron', fontSize: 11, fontWeight: '900',
                  color: speedKmh > speedLimit + 5 ? '#e33835' : '#111',
                }}>
                  {speedLimit}
                </Text>
              </View>
            )}
            <Text style={[
              styles.speedValue,
              speedLimit !== null && speedKmh > speedLimit + 5 && { color: '#e33835' },
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
              position: 'absolute', top: Platform.OS === 'ios' ? 54 : 38, right: 12,
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
          onChangeMapType={setMapType}
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
      </View>
    </>
  );
}