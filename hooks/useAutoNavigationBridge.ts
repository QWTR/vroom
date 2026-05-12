import { useEffect, useMemo, useRef } from 'react';
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocationState, RouteInfo } from '../constants/types';
import { Step } from './useGoogleDirections';
import { API_URL } from '../constants/mapConfig';
import {
  compactRoutePolyline,
  toCarSafeNavigationDto,
} from '../core/navigationCore';

const { UsersModule } = NativeModules;

interface UseAutoNavigationBridgeParams {
  isNavigating: boolean;
  isDriving?: boolean;
  isBuilding?: boolean;
  arrived?: boolean;
  offRoute?: boolean;
  currentStep: number;
  navStep: Step | null;
  routeInfo: (RouteInfo & { durationText?: string | null }) | null;
  remainingDistKm: number | null;
  distToTurnM: number | null;
  mapStyle?: string;
  startLocation?: LocationState | null;
  endLocation: LocationState | null;
  userLocation: LocationState | null;
  speed: number | null;
  heading: number;
  speedLimitKmh?: number | null;
  remainingRoutePoints?: { latitude: number; longitude: number }[] | null | undefined;
  navRoutePoints: { latitude: number; longitude: number }[] | null | undefined;
  previewRoutePoints: { latitude: number; longitude: number }[] | null | undefined;
  builderPins?: {
    id: string | number;
    latitude: number;
    longitude: number;
  }[];
  builderRoutePoints?: { latitude: number; longitude: number }[] | null | undefined;
  visibleUsers?: {
    id: string | number;
    name?: string;
    latitude: number;
    longitude: number;
    isFriend?: boolean;
    isPremium?: boolean;
  }[];
  warnings?: {
    id: string | number;
    type?: string;
    lat: number;
    lng: number;
    message?: string;
    confirmCount?: number;
  }[];
  speedCameras?: {
    id: string | number;
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
    type?: string;
    maxspeed?: number | null;
    distanceM?: number;
    confirmCount?: number;
  }[];
  fuelStations?: {
    id: string | number;
    name?: string;
    brand?: string | null;
    lat: number;
    lng: number;
    prices?: { pb95?: number | null }[];
  }[];
  onStopRequested: () => void;
  onReportRequested?: () => void;
  onReportTypeRequested?: (type: string) => void | Promise<void>;
}

export function useAutoNavigationBridge(params: UseAutoNavigationBridgeParams) {
  const {
    isNavigating,
    isDriving,
    isBuilding,
    arrived,
    offRoute,
    currentStep,
    navStep,
    routeInfo,
    remainingDistKm,
    distToTurnM,
    mapStyle,
    startLocation,
    endLocation,
    userLocation,
    speed,
    heading,
    speedLimitKmh,
    remainingRoutePoints,
    navRoutePoints,
    previewRoutePoints,
    builderPins,
    builderRoutePoints,
    visibleUsers,
    warnings,
    speedCameras,
    fuelStations,
    onStopRequested,
    onReportRequested,
    onReportTypeRequested,
  } = params;
  const lastSnapshotAtRef = useRef(0);

  const activeRoutePoints = (remainingRoutePoints?.length ?? 0) > 1
    ? remainingRoutePoints
    : isNavigating ? navRoutePoints : previewRoutePoints;
  const compactPolyline = useMemo(
    () => compactRoutePolyline(activeRoutePoints, 280),
    [activeRoutePoints],
  );
  const compactBuilderRoute = useMemo(
    () => compactRoutePolyline(builderRoutePoints, 220),
    [builderRoutePoints],
  );

  const dto = useMemo(() => (
    toCarSafeNavigationDto({
      isNavigating,
      currentStepIndex: currentStep,
      step: navStep,
      remainingDistKm,
      distToTurnM,
      routeInfo,
      destination: endLocation,
    })
  ), [
    isNavigating,
    currentStep,
    navStep,
    remainingDistKm,
    distToTurnM,
    routeInfo,
    endLocation,
  ]);

  const autoUsers = useMemo(() => (
    (visibleUsers ?? [])
      .filter((user) => (
        Number.isFinite(user.latitude) &&
        Number.isFinite(user.longitude)
      ))
      .slice(0, 40)
      .map((user) => ({
        id: String(user.id),
        label: user.name ?? 'Uzytkownik',
        lat: user.latitude,
        lng: user.longitude,
        type: user.isFriend ? 'friend' : 'user',
        isPremium: !!user.isPremium,
      }))
  ), [visibleUsers]);

  const autoWarnings = useMemo(() => (
    (warnings ?? [])
      .filter((warning) => (
        Number.isFinite(warning.lat) &&
        Number.isFinite(warning.lng)
      ))
      .slice(0, 60)
      .map((warning) => ({
        id: String(warning.id),
        label: warning.message ?? warning.type ?? 'Zgloszenie',
        type: warning.type ?? 'warning',
        lat: warning.lat,
        lng: warning.lng,
        confirmCount: warning.confirmCount ?? 0,
      }))
  ), [warnings]);

  const autoSpeedCameras = useMemo(() => (
    (speedCameras ?? [])
      .map((camera) => {
        const lat = camera.latitude ?? camera.lat;
        const lng = camera.longitude ?? camera.lng;
        return { ...camera, lat, lng };
      })
      .filter((camera) => (
        Number.isFinite(camera.lat) &&
        Number.isFinite(camera.lng)
      ))
      .slice(0, 60)
      .map((camera) => ({
        id: String(camera.id),
        label: camera.maxspeed != null ? String(camera.maxspeed) : camera.type ?? 'camera',
        type: camera.type ?? 'fixed',
        lat: camera.lat,
        lng: camera.lng,
        value: camera.maxspeed != null ? String(camera.maxspeed) : '',
        count: camera.confirmCount ?? 0,
        distanceM: camera.distanceM ?? null,
      }))
  ), [speedCameras]);

  const autoFuelStations = useMemo(() => (
    (fuelStations ?? [])
      .filter((station) => (
        Number.isFinite(station.lat) &&
        Number.isFinite(station.lng)
      ))
      .slice(0, 50)
      .map((station) => ({
        id: String(station.id),
        label: station.brand ?? station.name ?? 'Paliwo',
        type: 'fuel',
        lat: station.lat,
        lng: station.lng,
        value: station.prices?.[0]?.pb95 != null
          ? station.prices[0].pb95.toFixed(2)
          : '',
      }))
  ), [fuelStations]);

  const autoBuilderPins = useMemo(() => (
    (builderPins ?? [])
      .filter((pin) => (
        Number.isFinite(pin.latitude) &&
        Number.isFinite(pin.longitude)
      ))
      .slice(0, 80)
      .map((pin, index) => ({
        id: String(pin.id),
        label: String(index + 1),
        type: index === 0 ? 'start' : index === (builderPins?.length ?? 0) - 1 ? 'end' : 'pin',
        lat: pin.latitude,
        lng: pin.longitude,
        value: String(index + 1),
      }))
  ), [builderPins]);

  const autoMapState = useMemo(() => ({
    mapStyle: mapStyle ?? null,
    isDriving: !!isDriving,
    isBuilding: !!isBuilding,
    arrived: !!arrived,
    offRoute: !!offRoute,
    speedKmh: (speed ?? 0) * 3.6,
    speedLimitKmh: speedLimitKmh ?? null,
    start: startLocation
      ? {
        lat: startLocation.latitude,
        lng: startLocation.longitude,
        name: startLocation.name ?? 'Start',
      }
      : null,
    route: compactPolyline,
    builderRoute: compactBuilderRoute,
    builderPins: autoBuilderPins,
    speedCameras: autoSpeedCameras,
    fuelStations: autoFuelStations,
  }), [
    mapStyle,
    isDriving,
    isBuilding,
    arrived,
    offRoute,
    speed,
    speedLimitKmh,
    startLocation,
    compactPolyline,
    compactBuilderRoute,
    autoBuilderPins,
    autoSpeedCameras,
    autoFuelStations,
  ]);

  useEffect(() => {
    UsersModule?.setNavigatingForAuto?.(isNavigating);
  }, [isNavigating]);

  useEffect(() => {
    if (!UsersModule || !userLocation) return;
    UsersModule.saveMyLocationForAuto?.(userLocation.latitude, userLocation.longitude);
    UsersModule.saveSpeedHeadingForAuto?.(speed ?? 0, heading);
  }, [userLocation, speed, heading]);

  useEffect(() => {
    if (!UsersModule) return;
    UsersModule.saveCarSafeNavStateForAuto?.(JSON.stringify(dto));
  }, [dto]);

  useEffect(() => {
    if (!UsersModule) return;
    (async () => {
      try {
        const token =
          (await AsyncStorage.getItem('token')) ??
          (await AsyncStorage.getItem('userToken'));
        if (!token) return;
        UsersModule.saveAuthTokenForAuto?.(token);
      } catch {
      }
    })();
  }, []);

  useEffect(() => {
    if (!isNavigating) return;
    const now = Date.now();
    if (now - lastSnapshotAtRef.current < 15_000) return;
    lastSnapshotAtRef.current = now;

    (async () => {
      try {
        const token =
          (await AsyncStorage.getItem('token')) ??
          (await AsyncStorage.getItem('userToken'));
        if (!token) return;
        await fetch(`${API_URL}/api/navigation/session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            ...dto,
            routePolyline: compactPolyline,
          }),
        });
      } catch {
      }
    })();
  }, [isNavigating, dto, compactPolyline]);

  useEffect(() => {
    if (!UsersModule) return;
    if (compactPolyline.length > 1) {
      UsersModule.saveRouteForAuto?.(JSON.stringify(compactPolyline));
    }
  }, [compactPolyline]);

  useEffect(() => {
    if (!UsersModule || !endLocation) return;
    UsersModule.saveDestinationForAuto?.(
      endLocation.latitude,
      endLocation.longitude,
      endLocation.name ?? 'Cel',
    );
  }, [endLocation]);

  useEffect(() => {
    if (!UsersModule) return;
    UsersModule.saveVisibleUsersForAuto?.(JSON.stringify(autoUsers));
  }, [autoUsers]);

  useEffect(() => {
    if (!UsersModule) return;
    UsersModule.saveWarningsForAuto?.(JSON.stringify(autoWarnings));
  }, [autoWarnings]);

  useEffect(() => {
    if (!UsersModule) return;
    UsersModule.saveMapStateForAuto?.(JSON.stringify(autoMapState));
  }, [autoMapState]);

  useEffect(() => {
    if (!UsersModule || !isNavigating) return;
    const interval = setInterval(async () => {
      try {
        const stop = await UsersModule.checkNavStopRequested?.();
        if (stop) onStopRequested();
      } catch {
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [isNavigating, onStopRequested]);

  useEffect(() => {
    if (!UsersModule || (!onReportRequested && !onReportTypeRequested)) return;
    const interval = setInterval(async () => {
      try {
        const report = await UsersModule.checkReportRequested?.();
        if (!report) return;
        if (typeof report === 'string' && report !== 'menu') {
          onReportTypeRequested?.(report);
        } else {
          onReportRequested?.();
        }
      } catch {
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [onReportRequested, onReportTypeRequested]);
}
