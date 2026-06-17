import { useEffect, useMemo, useRef } from 'react';
import { DeviceEventEmitter, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocationState, RouteInfo } from '../constants/types';
import { Step } from './useGoogleDirections';
import { API_URL } from '../constants/mapConfig';
import {
  compactRoutePolyline,
  toCarSafeNavigationDto,
} from '../core/navigationCore';

const { UsersModule, VroomBridgeModule } = NativeModules as {
  UsersModule?: {
    setNavigatingForAuto?: (isNavigating: boolean) => void;
    saveMyLocationForAuto?: (lat: number, lng: number) => void;
    saveSpeedHeadingForAuto?: (speed: number, heading: number) => void;
    saveNavStepForAuto?: (stepText: string, stepDistance: string, etaText: string) => void;
    saveRouteForAuto?: (routeJson: string) => void;
    saveDestinationForAuto?: (lat: number, lng: number, name: string) => void;
    saveCarSafeNavStateForAuto?: (dtoJson: string) => void;
    saveVisibleUsersForAuto?: (usersJson: string) => void;
    saveWarningsForAuto?: (warningsJson: string) => void;
    saveMapStateForAuto?: (mapStateJson: string) => void;
    saveAuthTokenForAuto?: (token: string) => void;
    checkNavStopRequested?: () => Promise<boolean>;
    checkReportRequested?: () => Promise<string>;
  };
  VroomBridgeModule?: {
    sendDataToCar?: (jsonPayload: string) => void;
  };
};

const AUTO_REQUEST_POLL_MS = 1000;

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
  locationMarkerStyle?: 'arrow' | 'profile';
  currentUserAvatarUrl?: string | null;
  hideLocation?: boolean;
  startLocation?: LocationState | null;
  endLocation: LocationState | null;
  userLocation: LocationState | null;
  autoPose?: {
    latitude: number;
    longitude: number;
    speed: number | null;
    heading: number;
    updatedAt: number;
    arcWindow?: {
      points: { lat: number; lng: number }[];
      baseArcM?: number;
      totalM?: number;
    } | null;
    targetArcM?: number | null;
    roadBlend?: number | null;
    pathMode?: string | null;
  } | null;
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
  onSearchRequested?: () => void;
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
    locationMarkerStyle,
    currentUserAvatarUrl,
    hideLocation,
    startLocation,
    endLocation,
    userLocation,
    autoPose,
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
    onSearchRequested,
  } = params;
  const lastSnapshotAtRef = useRef(0);
  const callbacksRef = useRef({
    onStopRequested,
    onReportRequested,
    onReportTypeRequested,
    onSearchRequested,
  });

  useEffect(() => {
    callbacksRef.current = {
      onStopRequested,
      onReportRequested,
      onReportTypeRequested,
      onSearchRequested,
    };
  }, [onStopRequested, onReportRequested, onReportTypeRequested, onSearchRequested]);

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
      .slice(0, 250)
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

  const hasAutoPose = !!autoPose
    && Number.isFinite(autoPose.latitude)
    && Number.isFinite(autoPose.longitude);
  const effectiveUserLocation = hasAutoPose
    ? {
        ...(userLocation ?? {}),
        latitude: autoPose!.latitude,
        longitude: autoPose!.longitude,
        name: userLocation?.name ?? 'Moja pozycja',
      }
    : userLocation;
  const effectiveSpeed = hasAutoPose ? autoPose!.speed : speed;
  const effectiveHeading = hasAutoPose ? autoPose!.heading : heading;

  const autoMapState = useMemo(() => ({
    mapStyle: mapStyle ?? null,
    locationMarkerStyle: locationMarkerStyle ?? 'profile',
    currentUserAvatarUrl: currentUserAvatarUrl ?? '',
    hideLocation: !!hideLocation,
    isDriving: !!isDriving,
    isBuilding: !!isBuilding,
    arrived: !!arrived,
    offRoute: !!offRoute,
    autoPoseActive: hasAutoPose,
    autoPoseUpdatedAt: hasAutoPose ? autoPose!.updatedAt : null,
    autoArcWindow: hasAutoPose ? autoPose!.arcWindow ?? null : null,
    autoTargetArcM: hasAutoPose ? autoPose!.targetArcM ?? null : null,
    autoRoadBlend: hasAutoPose ? autoPose!.roadBlend ?? null : null,
    autoPathMode: hasAutoPose ? autoPose!.pathMode ?? null : null,
    speedKmh: (effectiveSpeed ?? 0) * 3.6,
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
    locationMarkerStyle,
    currentUserAvatarUrl,
    hideLocation,
    isDriving,
    isBuilding,
    arrived,
    offRoute,
    hasAutoPose,
    autoPose,
    effectiveSpeed,
    speedLimitKmh,
    startLocation,
    compactPolyline,
    compactBuilderRoute,
    autoBuilderPins,
    autoSpeedCameras,
    autoFuelStations,
  ]);

  useEffect(() => {
    const payload = {
      isNavigating,
      userLocation: effectiveUserLocation,
      speed: effectiveSpeed,
      heading: effectiveHeading,
      dto,
      route: compactPolyline,
      destination: endLocation,
      users: autoUsers,
      warnings: autoWarnings,
      mapState: autoMapState,
    };

    VroomBridgeModule?.sendDataToCar?.(JSON.stringify(payload));

    if (!UsersModule) return;

    UsersModule.setNavigatingForAuto?.(isNavigating);
    UsersModule.saveCarSafeNavStateForAuto?.(JSON.stringify(dto));
    UsersModule.saveVisibleUsersForAuto?.(JSON.stringify(autoUsers));
    UsersModule.saveWarningsForAuto?.(JSON.stringify(autoWarnings));
    UsersModule.saveMapStateForAuto?.(JSON.stringify(autoMapState));
    UsersModule.saveRouteForAuto?.(JSON.stringify(compactPolyline));

    if (Number.isFinite(effectiveUserLocation?.latitude) && Number.isFinite(effectiveUserLocation?.longitude)) {
      UsersModule.saveMyLocationForAuto?.(effectiveUserLocation!.latitude, effectiveUserLocation!.longitude);
    }

    UsersModule.saveSpeedHeadingForAuto?.(effectiveSpeed ?? 0, effectiveHeading ?? 0);

    if (endLocation && Number.isFinite(endLocation.latitude) && Number.isFinite(endLocation.longitude)) {
      UsersModule.saveDestinationForAuto?.(
        endLocation.latitude,
        endLocation.longitude,
        endLocation.name ?? 'Cel',
      );
    }

    UsersModule.saveNavStepForAuto?.(
      dto.nextInstruction ?? '',
      routeInfo?.distance ?? '',
      routeInfo?.durationText ?? '',
    );
  }, [
    isNavigating,
    effectiveUserLocation,
    effectiveSpeed,
    effectiveHeading,
    dto,
    routeInfo,
    compactPolyline,
    endLocation,
    autoUsers,
    autoWarnings,
    autoMapState,
  ]);

  useEffect(() => {
    let cancelled = false;

    const syncToken = async () => {
      try {
        const token =
          (await AsyncStorage.getItem('token')) ??
          (await AsyncStorage.getItem('userToken'));
        if (!cancelled && token) {
          UsersModule?.saveAuthTokenForAuto?.(token);
        }
      } catch {
      }
    };

    syncToken();
    const interval = setInterval(syncToken, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const reportSub = DeviceEventEmitter.addListener('onReport', () => {
      callbacksRef.current.onReportRequested?.();
    });
    const reportTypeSub = DeviceEventEmitter.addListener('onReportType', (type?: string) => {
      if (type && callbacksRef.current.onReportTypeRequested) {
        void callbacksRef.current.onReportTypeRequested(type);
      } else {
        callbacksRef.current.onReportRequested?.();
      }
    });
    const searchSub = DeviceEventEmitter.addListener('onSearch', () => {
      callbacksRef.current.onSearchRequested?.();
    });
    const stopSub = DeviceEventEmitter.addListener('onStop', () => {
      callbacksRef.current.onStopRequested();
    });

    return () => {
      reportSub.remove();
      reportTypeSub.remove();
      searchSub.remove();
      stopSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!UsersModule?.checkNavStopRequested && !UsersModule?.checkReportRequested) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const stopRequested = await UsersModule.checkNavStopRequested?.();
        if (!cancelled && stopRequested) {
          callbacksRef.current.onStopRequested();
        }

        const reportType = await UsersModule.checkReportRequested?.();
        if (!cancelled && reportType) {
          if (reportType === 'menu') {
            callbacksRef.current.onReportRequested?.();
          } else if (callbacksRef.current.onReportTypeRequested) {
            await callbacksRef.current.onReportTypeRequested(reportType);
          } else {
            callbacksRef.current.onReportRequested?.();
          }
        }
      } catch {
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, AUTO_REQUEST_POLL_MS);
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
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
}
