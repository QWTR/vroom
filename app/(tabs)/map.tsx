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

const { UsersModule } = NativeModules;

import { styles }          from '../../styles/mapstyle';
import { User, LocationState, RouteInfo } from '../../constants/types';
import {
  GOOGLE_MAPS_APIKEY,
  customMapStyle,
  MAX_NEARBY_USERS_DISTANCE,
} from '../../constants/mapConfig';
import { latFilter, lngFilter, navLatFilter, navLngFilter } from '../../scripts/kalmanFilter';
import { calculateDistance }       from '../../scripts/distance';
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
import { useGoogleDirections }        from '../../hooks/useGoogleDirections';
import { useCameraAnimation }         from '../../hooks/useCameraAnimation';
import { useNavigationPoints }        from '../../hooks/useNavigationPoints';
import { useNavigationNotification }  from '../../hooks/useNavigationNotification';
import { useDeadReckoning }           from '../../hooks/useDeadReckoning';
import { useDemoUsers }               from '../../hooks/useDemoUsers';
import { useRouteTimer } from '../../hooks/useRouteTimer';

import {
  useLiveMap,
  getWarningColor,
  getWarningIcon,
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
import { useRouteBuilder } from '../../hooks/useRouteBuilder';

import { SaveRouteModal }            from '../../components/modals/SaveRouteModal';
import { CarMarker }             from '../../components/markers/CarMarker';
import { CarMarkerRenderer }     from '../../components/markers/CarMarkerRenderer';
import { UserCarMarker }         from '../../components/markers/UserCarMarker';
import { MarkerRenderer }        from '../../components/markers/MarkerRenderer';
import { WarningMarkerRenderer } from '../../components/markers/WarningMarkerRenderer';
import { UserInfoModal }         from '../../components/modals/UserInfoModal';
import { SearchModal }           from '../../components/modals/SearchModal';
import { SettingsModal }         from '../../components/modals/SettingsModal';
import { ReportModal }           from '../../components/modals/ReportModal';
import { WarningDetailModal }    from '../../components/modals/WarningDetailModal';
import { RoutePinRenderer } from '../../components/markers/RoutePinRenderer';
import { RoutePin } from '../../components/markers/RoutePin';
import { RouteEndpointRenderer } from '@/components/markers/RouteEndpointRenderer';

const REROUTE_THRESHOLD_M = 40;
const ANNOUNCE_M          = 250;
const NAV_ZOOM            = 18.5;
const NAV_PITCH           = 65;

export default function MapScreen() {

  // ── Refs ──────────────────────────────────────────────────
  const mapRef               = useRef<MapView>(null);
  const lastSpokenRef        = useRef('');
  const locationSubRef       = useRef<any>(null);
  const lastHeadingRef       = useRef(0);
  const usersInitRef         = useRef(false);
  const rerouteTimerRef      = useRef<any>(null);
  const announcedStepRef     = useRef(-1);
  const isSpeechRef          = useRef(true);
  const startIsMyLocationRef = useRef(false);
  const lastNavLocRef        = useRef<{ latitude: number; longitude: number } | null>(null);
  const pendingRouteRef      = useRef<{ id: number; name: string } | null>(null);

  // ── Lokalizacja ───────────────────────────────────────────
  const [userLocation,  setUserLocation]  = useState<LocationState | null>(null);
  const [startLocation, setStartLocation] = useState<LocationState | null>(null);
  const [endLocation,   setEndLocation]   = useState<LocationState | null>(null);
  const [region,        setRegion]        = useState<any>(null);
  const [heading,       setHeading]       = useState(0);
  const [speed,         setSpeed]         = useState<number | null>(null);
  const [locationReady, setLocationReady] = useState(false);

  // ── Nawigacja ─────────────────────────────────────────────
  const [isNavigating, setIsNavigating] = useState(false);
  const [navStartLoc,  setNavStartLoc]  = useState<LocationState | null>(null);
  const [currentStep,  setCurrentStep]  = useState(0);
  const [offRoute,     setOffRoute]     = useState(false);
  const [arrived,      setArrived]      = useState(false);
  const [routeInfo,    setRouteInfo]    = useState<RouteInfo | null>(null);

  // ── Markery ───────────────────────────────────────────────
  const [carMarkerImage,  setCarMarkerImage]  = useState<string | null>(null);
  const [myAvatarUrl,     setMyAvatarUrl]     = useState<string | null>(null);
  const [myUsername,      setMyUsername]      = useState<string>('');
  const [markerImages,    setMarkerImages]    = useState<Record<string, string>>({});
  const [warningImages,   setWarningImages]   = useState<Record<number, string>>({});

  // ── UI ────────────────────────────────────────────────────
  const [mapType,            setMapType]            = useState('standard');
  const [settingsVisible,    setSettingsVisible]    = useState(false);
  const [reportVisible,      setReportVisible]      = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [userInfoVisible,    setUserInfoVisible]    = useState(false);
  const [selectedUser,       setSelectedUser]       = useState<User | null>(null);
  const [isSpeechEnabled,    setIsSpeechEnabled]    = useState(true);
  const [nearbyUsers,        setNearbyUsers]        = useState<User[]>([]);
  const [saveRouteVisible,   setSaveRouteVisible]   = useState(false);
  const [pinImages, setPinImages] = useState<Record<string, string>>({});
  const [routeEndpointImages, setRouteEndpointImages] = useState<{ start?: string; end?: string }>({});
  // ── Live / Ostrzeżenia ────────────────────────────────────
  const [isSharing,           setIsSharing]           = useState(false);
  const [isSubmittingWarning, setIsSubmittingWarning] = useState(false);
  const [selectedWarning,     setSelectedWarning]     = useState<LiveWarning | null>(null);
  const [currentUserId,       setCurrentUserId]       = useState<number | null>(null);
  const [remainingRoutePoints, setRemainingRoutePoints] = useState<
    { latitude: number; longitude: number }[]
  >([]);

  // ── Demo users ────────────────────────────────────────────
  const [demoUsers, setDemoUsers] = useState<User[]>([]);

  const router = useRouter();

  // ── Hook live ─────────────────────────────────────────────
  const {
    liveUsers,
    warnings,
    connected,
    sendLocation,
    toggleSharing,
    addWarning,
    confirmWarning,
  } = useLiveMap(isSharing, userLocation, isSpeechEnabled);

  // ── Hook budowania trasy ──────────────────────────────────
  const {
    isBuilding, pins, saving,
    snapping, snappedRoute,
    startBuilding, cancelBuilding,
    addPin, removePin, finishPin,
    snapToRoad,
    totalDistance, saveRoute,
  } = useRouteBuilder();
  // ── Hook czas trasy ──────────────────────────────────
  const {
    isRunning:   timerRunning,
    elapsedSec,
    routeName:   timerRouteName,
    startTimer,  stopTimer, resetTimer, formatElapsed,
  } = useRouteTimer();

  const { onNavigationStart, onNavigationComplete, onNavigationCancel } = useNavigationPoints();
  const { animateCameraSmooth, animateCameraLive, resetCamera } = useCameraAnimation(mapRef);
  const { feed: feedDR, reset: resetDR, stop: stopDR } = useDeadReckoning({
    onFrame: useCallback((pos: any, hdg: number) => {
      if (!isNavigating) return;
      animateCameraLive({ center: pos, pitch: NAV_PITCH, heading: hdg, zoom: NAV_ZOOM });
    }, [isNavigating, animateCameraLive]),
    frameInterval: 16,
    stallTimeout:  2500,
  });
  const { flushPendingKm }                                            = useBackgroundTracking(isSharing);
  const { showNavigationNotification, dismissNavigationNotification } = useNavigationNotification();

  // ── Google Directions ─────────────────────────────────────
  const { route: previewRoute, loading: previewLoading } = useGoogleDirections(
    isNavigating ? null : startLocation,
    isNavigating ? null : endLocation,
  );
  const { route: navRoute } = useGoogleDirections(
    navStartLoc,
    isNavigating ? endLocation : null,
  );
  const { route: rerouteResult } = useGoogleDirections(
    offRoute ? userLocation : null,
    offRoute ? endLocation  : null,
  );

  // ── Clustered warnings ───────────────────────────────────��
  const clusteredWarnings = useMemo(
    () => clusterWarnings(warnings ?? []),
    [warnings],
  );

  // ── Sync isSpeechRef ──────────────────────────────────────
  useEffect(() => {
    isSpeechRef.current = isSpeechEnabled;
    if (!isSpeechEnabled) Speech.stop().catch(() => {});
  }, [isSpeechEnabled]);

  // ── Speak ─────────────────────────────────────────────────
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

  // ── Pobierz dane usera ────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (!raw) return;
      const user = JSON.parse(raw);
      setCurrentUserId(user.userId);
      setMyAvatarUrl(user.avatarUrl ?? user.avatar ?? null);
      setMyUsername(user.username ?? '');
    });
  }, []);

  // useFocusEffect — odbierz trasę z profilu
  useFocusEffect(useCallback(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('nav_route');
      if (!raw) return;
      await AsyncStorage.removeItem('nav_route');
      const data = JSON.parse(raw);
      if (!data.points?.length) return;

      const first = data.points[0];
      const last  = data.points[data.points.length - 1];

      setStartLocation({ latitude: first.latitude, longitude: first.longitude, name: 'Start trasy' });
      setEndLocation({   latitude: last.latitude,  longitude: last.longitude,  name: data.routeName });

      // Zapisz routeId żeby timer wiedział co mierzy
      pendingRouteRef.current = { id: data.routeId, name: data.routeName };

      Toast.show({ type: 'success', text1: '🗺️ TRASA ZAŁADOWANA', text2: data.routeName });
    })();
  }, []));

  // Wyczyść obrazki gdy piny się zmieniają
  useEffect(() => {
    const pinIds = new Set(pins.map(p => p.id));
    setPinImages(prev => {
      const next: Record<string, string> = {};
      Object.keys(prev).forEach(k => {
        if (pinIds.has(k)) next[k] = prev[k];
      });
      return next;
    });
  }, [pins]);

  // ── Czyść obrazki usuniętych ostrzeżeń ───────────────────
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

  // ── Cel z SpotMap ─────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
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
    }, [userLocation]),
  );

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
        setLocationReady(true);
      } catch {
        Toast.show({ type: 'error', text1: 'BŁĄD GPS', text2: 'Nie można pobrać lokalizacji' });
      }
    })();
  }, []);

  // ── Watch GPS ─────────────────────────────────────────────
  useEffect(() => {
    if (!locationReady) return;
    (async () => {
      try {
        locationSubRef.current?.remove();
        const sub = await Location.watchPositionAsync(
          {
            accuracy:         isNavigating ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
            timeInterval:     isNavigating ? 200  : 2000,
            distanceInterval: isNavigating ? 1    : 8,
          },
          (loc) => {
            const rawLat = loc.coords.latitude;
            const rawLng = loc.coords.longitude;
            const acc    = loc.coords.accuracy ?? 10;

            let lat: number;
            let lng: number;

            if (isNavigating) {
              lat = navLatFilter.filter(rawLat, acc);
              lng = navLngFilter.filter(rawLng, acc);
            } else {
              lat = latFilter.filter(rawLat, acc);
              lng = lngFilter.filter(rawLng, acc);
            }

            if (isNavigating) {
              feedDR({ latitude: lat, longitude: lng }, loc.coords.speed ?? 0, loc.coords.heading ?? lastHeadingRef.current);
              feedSpeedSample(loc.coords.speed);
              if (lastNavLocRef.current) {
                feedNavDistance(
                  lastNavLocRef.current.latitude,
                  lastNavLocRef.current.longitude,
                  lat, lng,
                );
              }
              lastNavLocRef.current = { latitude: lat, longitude: lng };
            }

            setUserLocation({ latitude: lat, longitude: lng });
            setSpeed(loc.coords.speed);

            const speedKmh = (loc.coords.speed ?? 0) * 3.6;
            const newH     = loc.coords.heading ?? lastHeadingRef.current;

            if (speedKmh > 3 && newH >= 0) {
              const diff           = newH - lastHeadingRef.current;
              const normalizedDiff = ((diff + 540) % 360) - 180;
              const smoothed       = lastHeadingRef.current + normalizedDiff * 0.4;
              const finalHeading   = ((smoothed % 360) + 360) % 360;
              if (Math.abs(normalizedDiff) > 2) {
                setHeading(finalHeading);
                lastHeadingRef.current = finalHeading;
              }
            }
          },
        );
        locationSubRef.current = sub;
      } catch (e) { console.log('watchPosition error:', e); }
    })();
    return () => { locationSubRef.current?.remove(); };
  }, [locationReady, isNavigating]);

  // ── Logika nawigacji ──────────────────────────────────────
  useEffect(() => {
    if (!isNavigating || !userLocation || !navRoute?.steps?.length) return;

    const steps  = navRoute.steps;
    const points = navRoute.points ?? [];

    const snapped = points.length
      ? snapToRoute(userLocation.latitude, userLocation.longitude, points, 35)
      : { latitude: userLocation.latitude, longitude: userLocation.longitude };

    const lat = snapped.latitude;
    const lng = snapped.longitude;

    if (endLocation) {
      const distToEnd = haversineKm(lat, lng, endLocation.latitude, endLocation.longitude) * 1000;
      if (distToEnd < 30 && !arrived) { handleArrived(); return; }
    }

    const nextStep = detectCurrentStep(lat, lng, steps, currentStep);
    if (nextStep !== currentStep) {
      setCurrentStep(nextStep);
      announcedStepRef.current = -1;
    }

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

    if (points.length) {
      const onRoad = isOnRoute(lat, lng, points, REROUTE_THRESHOLD_M);
      if (!onRoad && !offRoute) {
        setOffRoute(true);
        clearTimeout(rerouteTimerRef.current);
        rerouteTimerRef.current = setTimeout(() => setOffRoute(false), 3000);
      }
    }
  }, [userLocation, isNavigating]);

  // ── Sync routeInfo ────────────────────────────────────────
  useEffect(() => {
    if (previewRoute) {
      setRouteInfo({
        distance: (previewRoute.distanceValue / 1000).toFixed(1),
        duration: previewRoute.duration,
      });
    }
  }, [previewRoute]);

  // ── Rerouting ─────────────────────────────────────────────
  useEffect(() => {
    if (!offRoute || !rerouteResult || !userLocation) return;
    Toast.show({ type: 'info', text1: '🔄 PRZELICZAM TRASĘ' });
    speak('Przeliczam trasę');
    setNavStartLoc({ ...userLocation, name: 'Moja pozycja' });
    setCurrentStep(0);
    announcedStepRef.current = -1;
    lastSpokenRef.current    = '';
    setOffRoute(false);
  }, [rerouteResult, offRoute, userLocation]);

  // ── Live start location ───────────────────────────────────
  useEffect(() => {
    if (!startIsMyLocationRef.current) return;
    if (!userLocation) return;
    if (isNavigating) return;
    setStartLocation(prev => ({
      ...userLocation,
      name: prev?.name ?? 'Moja pozycja',
    }));
  }, [userLocation, isNavigating]);

  // ── Handlers ──────────────────────────────────────────────
  const handleSelectStart = useCallback((l: LocationState) => {
    setStartLocation(l);
    startIsMyLocationRef.current = (l.name === 'Moja pozycja');
  }, []);

  const handleSelectEnd = useCallback((l: LocationState) => {
    setEndLocation(l);
    setStartLocation(prev => {
      if (prev) return prev;
      if (!userLocation) return prev;
      startIsMyLocationRef.current = true;
      return { ...userLocation, name: 'Moja pozycja' };
    });
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

  const handleArrived = useCallback(async () => {
    stopDR();
    setArrived(true);
    setIsNavigating(false);
    dismissNavigationNotification();
    flushPendingKm(true);
    Speech.stop().catch(() => {});
    speak('Dotarłeś do celu!');
    Toast.show({ type: 'success', text1: '🏁 DOTARŁEŚ DO CELU!', text2: endLocation?.name ?? '' });
    if (routeInfo?.distance) {
      onNavigationComplete(parseFloat(routeInfo.distance));
    }
    if (userLocation) resetCamera({ latitude: userLocation.latitude, longitude: userLocation.longitude });
    if (timerRunning) {
      const elapsed = await stopTimer();
      Toast.show({
        type:  'success',
        text1: '🏁 TRASA UKOŃCZONA!',
        text2: `Czas: ${formatElapsed(elapsed)}`,
        visibilityTime: 5000,
      });
    }
    setTimeout(() => {
      setStartLocation(null);
      setEndLocation(null);
      setRouteInfo(null);
      setArrived(false);
      setNavStartLoc(null);
    }, 3000);
  }, [endLocation, userLocation, routeInfo, speak, resetCamera, onNavigationComplete, timerRunning, stopTimer, formatElapsed]);

  const beginNavigation = useCallback(() => {
    if (!userLocation) return;
    lastNavLocRef.current = null;
    resetSpeedStats();
    resetDR();
    navLatFilter.reset();
    navLngFilter.reset();
    startIsMyLocationRef.current = false;
    const navStart = { ...userLocation, name: 'Moja pozycja' };
    setIsNavigating(true);
    setNavStartLoc(navStart);
    setStartLocation(navStart);
    setCurrentStep(0);
    setArrived(false);
    setOffRoute(false);
    lastSpokenRef.current    = '';
    announcedStepRef.current = -1;
    if (routeInfo?.duration) {
      onNavigationStart(routeInfo.duration);
    }
    if (pendingRouteRef.current) {
      startTimer(pendingRouteRef.current.id, pendingRouteRef.current.name);
      pendingRouteRef.current = null;
    }
    mapRef.current?.animateCamera(
      { center: { latitude: userLocation.latitude, longitude: userLocation.longitude }, pitch: NAV_PITCH, heading: lastHeadingRef.current, zoom: NAV_ZOOM },
      { duration: 800 },
    );
    speak('Nawigacja rozpoczęta. Dobrej drogi!');
    Toast.show({ type: 'success', text1: '🚗 NAWIGACJA ROZPOCZĘTA', text2: 'Dobrej drogi!' });
  }, [userLocation, routeInfo, speak, onNavigationStart, startTimer]);

  const startNavigation = useCallback(() => {
    if (!endLocation) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wybierz cel podróży' });
      return;
    }
    if (!userLocation) {
      Toast.show({ type: 'error', text1: 'BŁĄD GPS', text2: 'Czekam na lokalizację...' });
      return;
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
          { text: 'Nawiguj do startu', onPress: () => { setEndLocation(startLocation); setStartLocation({ ...userLocation, name: 'Moja pozycja' }); } },
          { text: 'Startuj z mojej pozycji', onPress: () => { setStartLocation({ ...userLocation, name: 'Moja pozycja' }); startIsMyLocationRef.current = true; beginNavigation(); } },
        ],
      );
      return;
    }
    beginNavigation();
  }, [startLocation, endLocation, userLocation, beginNavigation]);

  const stopNavigation = useCallback(() => {
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

    if (timerRunning) resetTimer();
    pendingRouteRef.current = null;
     
    if (userLocation) {
      startIsMyLocationRef.current = true;
      setStartLocation({ ...userLocation, name: 'Moja pozycja' });
      resetCamera({ latitude: userLocation.latitude, longitude: userLocation.longitude });
    }
    flushPendingKm(true);
    Toast.show({ type: 'info', text1: 'NAWIGACJA ZATRZYMANA' });
  }, [userLocation, resetCamera, onNavigationCancel, flushPendingKm, timerRunning, resetTimer]);

  const handleReset = useCallback(() => {
    if (isNavigating) stopNavigation();
    startIsMyLocationRef.current = false;
    setStartLocation(null);
    setEndLocation(null);
    setRouteInfo(null);
    setCurrentStep(0);
    setRouteEndpointImages({});
  }, [isNavigating, stopNavigation]);

  const handleCenterOnUser = useCallback(() => {
    if (!userLocation) return;
    if (isNavigating) {
      mapRef.current?.animateCamera(
        { center: { latitude: userLocation.latitude, longitude: userLocation.longitude }, pitch: NAV_PITCH, heading: lastHeadingRef.current, zoom: NAV_ZOOM },
        { duration: 500 },
      );
    } else {
      resetCamera({ latitude: userLocation.latitude, longitude: userLocation.longitude });
    }
  }, [userLocation, isNavigating, resetCamera]);

  const handleToggleSharing = useCallback(async () => {
    const newVal = await toggleSharing();
    setIsSharing(newVal);
  }, [toggleSharing]);

  const handleReport = useCallback(async (type: any) => {
    if (!userLocation) {
      Toast.show({ type: 'error', text1: 'Brak lokalizacji GPS' });
      return;
    }
    setIsSubmittingWarning(true);
    try {
      await addWarning(type, userLocation.latitude, userLocation.longitude);
      Toast.show({ type: 'success', text1: '✅ ZGŁOSZONO', text2: getWarningLabel(type) });
    } finally {
      setIsSubmittingWarning(false);
    }
  }, [userLocation, addWarning]);

  const handleViewProfile = useCallback(() => {
    if (!selectedUser) return;
    setUserInfoVisible(false);
    router.push({ pathname: '/profile/[userId]', params: { userId: selectedUser.id } });
  }, [selectedUser, router]);

  const handleWarningCapture = useCallback((id: number, uri: string) => {
    setWarningImages(prev => ({ ...prev, [id]: uri }));
  }, []);

  // ── Widoczni użytkownicy ──────────────────────────────────
  const visibleUsers = useMemo(() => {
    if (!userLocation) return [];
    return nearbyUsers.filter(u => {
      if (u.isFriend) return true;
      return calculateDistance(userLocation.latitude, userLocation.longitude, u.latitude, u.longitude) <= MAX_NEARBY_USERS_DISTANCE;
    });
  }, [userLocation, nearbyUsers]);

  useEffect(() => {
    if (!userLocation) return;
    if (!isSharing) { setNearbyUsers([]); return; }
    const mapped = liveUsers
      .filter(u => String(u.id) !== String(currentUserId))
      .map(u => ({
        id: String(u.id), name: u.username,
        latitude: u.lat, longitude: u.lng,
        avatar: u.avatarUrl ?? '🚗', status: 'Online' as const, isFriend: false,
      }));
    setNearbyUsers(mapped);
  }, [liveUsers, currentUserId, userLocation, isSharing]);

  // ── Remaining route ───────────────────────────────────────
  const activeRoute = isNavigating ? navRoute : previewRoute;
  const activeSteps = navRoute?.steps ?? previewRoute?.steps ?? [];

  // const remainingRoutePoints = useMemo(() => {
  //   if (!activeRoute?.points?.length) return [];
  //   if (!isNavigating || !userLocation) return activeRoute.points;
  //   const idx = findClosestPointIndex(userLocation.latitude, userLocation.longitude, activeRoute.points);
  //   return [
  //     { latitude: userLocation.latitude, longitude: userLocation.longitude },
  //     ...activeRoute.points.slice(idx),
  //   ];
  // }, [isNavigating, activeRoute, userLocation?.latitude, userLocation?.longitude]);

  // Aktualizuj linię przy każdej zmianie pozycji
  useEffect(() => {
    const points = activeRoute?.points;
    if (!points?.length) {
      setRemainingRoutePoints([]);
      return;
    }

    if (!isNavigating || !userLocation) {
      setRemainingRoutePoints(points);
      return;
    }

    // Użyj snap-to-road żeby pozycja była na trasie
    const snapped = snapToRoute(
      userLocation.latitude,
      userLocation.longitude,
      points,
      35,
    );

    const idx = findClosestPointIndex(
      snapped.latitude,
      snapped.longitude,
      points,
    );

    const ahead = points.slice(idx + 1);

    setRemainingRoutePoints([
      { latitude: snapped.latitude, longitude: snapped.longitude },
      ...ahead,
    ]);
  }, [
    userLocation?.latitude,   // ← aktualizuj przy każdej zmianie GPS
    userLocation?.longitude,
    isNavigating,
    activeRoute,              // ← i przy reroutingu
  ]);

  // ── Send location ─────────────────────────────────────────
  useEffect(() => {
    if (!userLocation || !isSharing) return;
    sendLocation(userLocation.latitude, userLocation.longitude);
  }, [userLocation, isSharing]);

  // ── Navigation notification ───────────────────────────────
  useEffect(() => {
    if (!isNavigating) { dismissNavigationNotification(); return; }
    const stepData = navRoute?.steps?.[currentStep];
    if (!stepData) return;
    showNavigationNotification(stepData, routeInfo?.distance ?? '', routeInfo?.durationText ?? '');
  }, [currentStep, isNavigating, navRoute]);

  // ── Android Auto ──────────────────────────────────────────
  useEffect(() => {
    if (!UsersModule) return;
    UsersModule.setNavigatingForAuto?.(isNavigating);
  }, [isNavigating]);

  useEffect(() => {
    if (!UsersModule || !userLocation) return;
    UsersModule.saveMyLocationForAuto?.(userLocation.latitude, userLocation.longitude);
    UsersModule.saveSpeedHeadingForAuto?.(speed ?? 0, heading);
  }, [userLocation, speed, heading]);

  useEffect(() => {
    if (!UsersModule || !isNavigating) return;
    const steps = navRoute?.steps ?? [];
    if (steps[currentStep]) {
      const step = steps[currentStep];
      UsersModule.saveNavStepForAuto?.(
        cleanInstruction(step.html_instructions),
        step.distance?.text || '',
        routeInfo ? formatDuration(routeInfo.duration) : '',
      );
    }
  }, [isNavigating, currentStep, navRoute]);

  useEffect(() => {
    if (!UsersModule) return;
    const route = isNavigating ? navRoute : previewRoute;
    if (route?.points) {
      UsersModule.saveRouteForAuto?.(JSON.stringify(
        route.points.map((p: any) => ({ lat: p.latitude, lng: p.longitude }))
      ));
    }
  }, [isNavigating, navRoute, previewRoute]);

  useEffect(() => {
    if (!UsersModule || !endLocation) return;
    UsersModule.saveDestinationForAuto?.(endLocation.latitude, endLocation.longitude, endLocation.name ?? 'Cel');
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
    if (!UsersModule) return;
    UsersModule.saveUsersForAuto?.(JSON.stringify(
      visibleUsers.map(u => ({ id: u.id, name: u.name, latitude: u.latitude, longitude: u.longitude, status: u.status, isFriend: u.isFriend }))
    ));
  }, [visibleUsers]);

  useDemoUsers(
    locationReady && !isNavigating && !isSharing,
    useCallback((users) => setDemoUsers(users), []),
    userLocation?.latitude,
    userLocation?.longitude,
    100,
  );

  // ─────────────────────────────────────────────────────────
  // RENDER
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

  const currentStepData = activeSteps[currentStep];

  // Punkty do wyświetlenia dystansu w banerze
  const bannerDistPoints = snappedRoute.length > 0
    ? snappedRoute
    : pins.map(p => ({ latitude: p.latitude, longitude: p.longitude }));

  return (
    <>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>

        {/* Timer trasy — pokazuje się gdy nawigujemy po zapisanej trasie */}
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

        {/* ── Renderery poza MapView ── */}
        {userLocation && visibleUsers.map(user =>
          !markerImages[user.id] ? (
            <MarkerRenderer
              key={`renderer_${user.id}`}
              user={user}
              distance={calculateDistance(userLocation.latitude, userLocation.longitude, user.latitude, user.longitude)}
              onCapture={uri => setMarkerImages(prev => ({ ...prev, [user.id]: uri }))}
            />
          ) : null
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

        {/* ── Renderery pinów trasy ── */}
        {isBuilding && pins.map((pin, index) => (
          <RoutePinRenderer
            key={`pinrender_${pin.id}_${index}_${pins.length}`}
            index={index}
            total={pins.length}
            label={pin.label}
            onCapture={uri => setPinImages(prev => ({ ...prev, [pin.id]: uri }))}
          />
        ))}

        {/* ── BANER TWORZENIA TRASY — nad mapą ── */}
        {isBuilding && (
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
            backgroundColor: '#e33835',
            paddingTop:        Platform.OS === 'ios' ? 54 : 36,
            paddingBottom:     14,
            paddingHorizontal: 16,
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

        {/* ── MAPA ── */}
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFillObject}
          customMapStyle={customMapStyle}
          initialRegion={region}
          mapType={mapType as any}
          showsUserLocation={false}
          pitchEnabled
          rotateEnabled
          moveOnMarkerPress={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          onPress={(e) => {
            if (!isBuilding) return;
            const { latitude, longitude } = e.nativeEvent.coordinate;
            addPin(latitude, longitude);
          }}
        >
          {/* Mój marker */}
          {userLocation && (
            <CarMarker
              latitude={userLocation.latitude}
              longitude={userLocation.longitude}
              heading={heading}
              imageUri={carMarkerImage}
            />
          )}

          {/* Marker celu */}
          {endLocation && !arrived && (
            <Marker
              coordinate={{ latitude: endLocation.latitude, longitude: endLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={100}
              tracksViewChanges={false}
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

          {/* Marker startu */}
          {startLocation && !isNavigating && !isBuilding && (
            <Marker
              coordinate={{ latitude: startLocation.latitude, longitude: startLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={99}
              tracksViewChanges={false}
            >
              <View style={{
                backgroundColor: '#111111', padding: 8, borderRadius: 12,
                borderWidth: 2, borderColor: '#4de926', alignItems: 'center',
              }}>
                <MaterialIcons name="radio-button-on" size={18} color="#4de926" />
              </View>
            </Marker>
          )}

          {/* ── Piny trasy — kolorowe z etykietą ── */}
    
          {/* ── Piny trasy ── */}
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
          {/* ── Linia snapped (po dopasowaniu do drogi) ── */}
          {isBuilding && snappedRoute.length > 1 && (
            <>
              <Polyline
                coordinates={snappedRoute}
                strokeColor="#00000070"
                strokeWidth={10}
                geodesic lineCap="round" lineJoin="round"
              />
              <Polyline
                coordinates={snappedRoute}
                strokeColor="#e33835"
                strokeWidth={6}
                geodesic lineCap="round" lineJoin="round"
              />
              <Polyline
                coordinates={snappedRoute}
                strokeColor="#ffffff20"
                strokeWidth={3}
                geodesic lineCap="round" lineJoin="round"
              />
            </>
          )}

          {/* ── Linia przerywana (przed snap) ── */}
          {isBuilding && pins.length > 1 && snappedRoute.length === 0 && (
            <>
              <Polyline
                coordinates={pins.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
                strokeColor="#00000080"
                strokeWidth={8}
              />
              <Polyline
                coordinates={pins.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
                strokeColor="#ff922b"
                strokeWidth={4}
                lineDashPattern={[12, 7]}
              />
            </>
          )}

          {/* Użytkownicy */}
          {!isNavigating && userLocation && visibleUsers.map(user => (
            <UserCarMarker
              key={`user_${user.id}`}
              user={user}
              distance={calculateDistance(userLocation.latitude, userLocation.longitude, user.latitude, user.longitude)}
              onPress={() => handleUserMarkerPress(user)}
              imageUri={markerImages[user.id] ?? null}
            />
          ))}

          {/* Trasa nawigacji / podglądu */}
          {remainingRoutePoints.length > 1 && !arrived && (
            <>
              <Polyline
                coordinates={remainingRoutePoints}
                strokeColor="#00000055"
                strokeWidth={11}
                geodesic lineCap="round" lineJoin="round"
              />
              <Polyline
                coordinates={remainingRoutePoints}
                strokeColor={isNavigating ? '#e33835dd' : '#00bfff'}
                strokeWidth={6}
                geodesic lineCap="round" lineJoin="round"
              />
              {isNavigating && (
                <Polyline
                  coordinates={remainingRoutePoints}
                  strokeColor="#ffffff15"
                  strokeWidth={8}
                  geodesic lineCap="round" lineJoin="round"
                />
              )}
            </>
          )}

           {/* Markery w MapView — zastąp istniejące markery start/koniec gdy trasa  */}
          {startLocation && !isNavigating && routeEndpointImages.start && (
            <Marker
              coordinate={{ latitude: startLocation.latitude, longitude: startLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={99}
              tracksViewChanges={false}
              image={{ uri: routeEndpointImages.start }}
            />
          )}
          {endLocation && !arrived && routeEndpointImages.end && (
            <Marker
              coordinate={{ latitude: endLocation.latitude, longitude: endLocation.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={100}
              tracksViewChanges={false}
              image={{ uri: routeEndpointImages.end }}
            />
          )}

          {/* Ostrzeżenia */}
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

        {/* Panel nawigacji góra */}
        {isNavigating && currentStepData && (
          <View style={styles.navigationPanelTop}>
            <View style={styles.instructionBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <View style={{ backgroundColor: '#e3383525', padding: 6, borderRadius: 10, borderWidth: 1, borderColor: '#e3383545' }}>
                  <MaterialIcons name={getManeuverIcon(currentStepData.maneuver) as any} size={22} color="#e33835ce" />
                </View>
                <Text style={styles.instructionDistance}>{currentStepData.distance?.text}</Text>
              </View>
              <Text style={styles.instructionText} numberOfLines={2}>
                {cleanInstruction(currentStepData.html_instructions)}
              </Text>
              {activeSteps[currentStep + 1] && (
                <Text style={[styles.stepCounter, { marginTop: 6 }]} numberOfLines={1}>
                  Potem: {cleanInstruction(activeSteps[currentStep + 1].html_instructions)}
                </Text>
              )}
              <Text style={styles.stepCounter}>
                Krok {currentStep + 1} / {activeSteps.length} · {routeInfo ? formatDuration(routeInfo.duration) : ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeNavBtn} onPress={stopNavigation}>
              <MaterialIcons name="close" size={18} color="#ffffff70" />
            </TouchableOpacity>
          </View>
        )}

        {/* Off-route banner */}
        {isNavigating && offRoute && (
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

        {/* Prędkościomierz */}
        {isNavigating && (
          <View style={styles.speedPanelNav}>
            <Text style={styles.speedValue}>{formatSpeed(speed)}</Text>
            <Text style={styles.speedLabel}>KM/H</Text>
          </View>
        )}

        {/* ── Przyciski boczne ── */}
        <View style={[
          styles.rightBottomControls,
          !isNavigating && { bottom: startLocation && endLocation && routeInfo ? 248 : 188 },
        ]}>
          {/* Przycisk tworzenia trasy */}
          <TouchableOpacity
            style={[
              styles.sideBtn,
              isBuilding
                ? { backgroundColor: '#db1e1e8e', borderColor: '#000000c7' }
                : { backgroundColor: '#0c0c0cd2', borderColor: '#fa07079a' },
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
              color={isBuilding ? '#000000' : '#ffffff70'}
            />
          </TouchableOpacity>

          {/* Sharing */}
          <TouchableOpacity
            style={[
              styles.sideBtn,
              isSharing
                ? { backgroundColor: '#4de92620', borderColor: '#4de92645' }
                : { backgroundColor: '#ffffff08', borderColor: '#ffffff10' },
            ]}
            onPress={handleToggleSharing}
            activeOpacity={0.75}
          >
            <MaterialIcons
              name={isSharing ? 'location-on' : 'location-off'}
              size={20}
              color={isSharing ? '#4de926' : '#ffffff35'}
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
            <MaterialIcons name="my-location" size={20} color="#ffffff70" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sideBtn, !isSpeechEnabled && { backgroundColor: '#e3383525', borderColor: '#e3383545' }]}
            onPress={() => setIsSpeechEnabled(v => !v)}
            activeOpacity={0.75}
          >
            <MaterialIcons
              name={isSpeechEnabled ? 'volume-up' : 'volume-off'}
              size={20}
              color={isSpeechEnabled ? '#ffffff70' : '#e33835ce'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sideBtn, { borderColor: '#ff922b45', backgroundColor: '#ff922b12' }]}
            onPress={() => setReportVisible(true)}
            activeOpacity={0.75}
          >
            <MaterialIcons name="warning" size={20} color="#ff922b" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.sideBtn} onPress={() => setSettingsVisible(true)} activeOpacity={0.75}>
            <MaterialCommunityIcons name="layers-outline" size={22} color="#ffffff70" />
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        {!isNavigating && !isBuilding && (
          <TouchableOpacity style={styles.topSearchButton} onPress={() => setSearchModalVisible(true)} activeOpacity={0.8}>
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

        {/* Bottom sheet */}
        {!isNavigating && !isBuilding && startLocation && endLocation && (
          <View style={styles.bottomSheet}>
            <View style={styles.expandHandle} />
            <View style={styles.infoPreview}>
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
                    {previewLoading || !routeInfo
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
                    {previewLoading || !routeInfo
                      ? <ActivityIndicator size="small" color="#e33835ce" style={{ marginTop: 2 }} />
                      : <Text style={styles.statValue}>{formatDuration(routeInfo.duration)}</Text>
                    }
                  </View>
                </View>
              </View>
              <View style={styles.bottomSheetButtons}>
                <TouchableOpacity
                  style={[styles.navigateButton, (previewLoading || !routeInfo) && { opacity: 0.5 }]}
                  onPress={startNavigation}
                  activeOpacity={0.85}
                  disabled={previewLoading || !routeInfo}
                >
                  {previewLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <MaterialIcons name="navigation" size={18} color="#fff" />
                  }
                  <Text style={styles.navigateButtonText}>
                    {previewLoading ? 'OBLICZAM...' : 'NAWIGUJ'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editButton} onPress={() => setSearchModalVisible(true)} activeOpacity={0.8}>
                  <MaterialIcons name="edit" size={18} color="#e33835ce" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.resetButtonSmall} onPress={handleReset} activeOpacity={0.8}>
                  <MaterialIcons name="close" size={18} color="#ffffff35" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Empty state */}
        {!isNavigating && !isBuilding && !startLocation && !endLocation && !searchModalVisible && (
          <View style={styles.emptyStateContainer}>
            <View style={styles.emptyState}>
              <MaterialIcons name="location-on" size={40} color="#e33835ce" />
              <Text style={styles.emptyTitle}>WYBIERZ TRASĘ</Text>
              <Text style={styles.emptySubtitle}>Dotknij paska wyszukiwania</Text>
            </View>
          </View>
        )}

        {/* Modale */}
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
          currentUserId={currentUserId ?? undefined}
        />
        <SaveRouteModal
          visible={saveRouteVisible}
          pinCount={pins.length}
          distanceKm={totalDistance(snappedRoute.length > 0 ? snappedRoute : pins.map(p => ({ latitude: p.latitude, longitude: p.longitude })))}
          saving={saving}
          snapping={snapping}
          isSnapped={snappedRoute.length > 0}
          onSnapToRoad={() => snapToRoad(pins)}
          onCancel={() => setSaveRouteVisible(false)}
          onSave={async (name, desc, isPublic) => {
            const result = await saveRoute(name, desc, isPublic);
            setSaveRouteVisible(false);
            if (result) Toast.show({ type: 'success', text1: '✅ TRASA ZAPISANA', text2: name });
            else        Toast.show({ type: 'error',   text1: 'Błąd zapisu trasy' });
          }}
        />
      </View>
    </>
  );
}