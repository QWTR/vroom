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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface AutoNavigationStartedPayload {
  routePoints: { latitude: number; longitude: number }[];
  destination: LocationState | null;
  distanceMeters: number;
  durationSeconds: number;
  instruction: string;
  routePreview?: boolean;
  selectedRouteIndex?: number;
}

interface UseAutoNavigationBridgeParams {
  isNavigating: boolean;
  isDriving?: boolean;
  isBuilding?: boolean;
  arrived?: boolean;
  offRoute?: boolean;
  currentStep: number;
  navStep: Step | null;
  followingNavStep?: Step | null;
  upcomingNavSteps?: Step[] | null;
  routeInfo: (RouteInfo & { durationText?: string | null }) | null;
  remainingDistKm: number | null;
  distToTurnM: number | null;
  mapStyle?: string;
  locationMarkerStyle?: 'arrow' | 'profile' | 'vehicle_3d';
  currentUserAvatarUrl?: string | null;
  selfMarker?: {
    style?: 'arrow' | 'profile' | 'vehicle_3d';
    markerSpriteUri?: string | null;
    vehicleModelUrl?: string | null;
    vehicleModelMeta?: unknown;
    modelHealth?: string | null;
  } | null;
  hideLocation?: boolean;
  startLocation?: LocationState | null;
  endLocation: LocationState | null;
  userLocation: LocationState | null;
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
    avatar?: string | null;
    avatarFrameUrl?: string | null;
    distance?: number;
    isFriend?: boolean;
    isPremium?: boolean;
    markerSpriteUri?: string | null;
    vehicleModelUrl?: string | null;
    vehicleModelMeta?: unknown;
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
    brandLogoUrl?: string | null;
    spriteUri?: string | null;
    lat: number;
    lng: number;
    distance?: number;
    prices?: { pb95?: number | null }[];
  }[];
  partnerPois?: {
    id: string | number;
    name?: string;
    category?: string;
    markerAccentColor?: string | null;
    logoUrl?: string | null;
    spriteUri?: string | null;
    lat: number;
    lng: number;
  }[];
  geoDrops?: {
    id: string | number;
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
    label?: string;
    title?: string;
    name?: string;
    type?: string;
    status?: string;
    radiusM?: number | null;
    radius?: number | null;
    spriteUri?: string | null;
    markerSpriteUri?: string | null;
  }[];
  activeDropPrompt?: {
    id: string | number;
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
    label?: string;
    title?: string;
    name?: string;
    type?: string;
    status?: string;
    radiusM?: number | null;
    radius?: number | null;
    spriteUri?: string | null;
    markerSpriteUri?: string | null;
  } | null;
  onStopRequested: () => void;
  onReportRequested?: () => void;
  onReportTypeRequested?: (type: string) => void | Promise<void>;
  onSearchRequested?: () => void;
  onAutoNavigationStarted?: (payload: AutoNavigationStartedPayload) => void | Promise<void>;
  onAutoSearchQuery?: (query: string) => void;
  onAutoSearchResult?: (id: string) => void;
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
    followingNavStep,
    upcomingNavSteps,
    routeInfo,
    remainingDistKm,
    distToTurnM,
    mapStyle,
    locationMarkerStyle,
    currentUserAvatarUrl,
    selfMarker,
    hideLocation,
    startLocation,
    endLocation,
    userLocation,
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
    partnerPois,
    geoDrops,
    activeDropPrompt,
    onStopRequested,
    onReportRequested,
    onReportTypeRequested,
    onSearchRequested,
    onAutoNavigationStarted,
    onAutoSearchQuery,
    onAutoSearchResult,
  } = params;
  const lastSnapshotAtRef = useRef(0);
  const lastFullPayloadAtRef = useRef(0);
  const lastFullPayloadModeRef = useRef('');
  const callbacksRef = useRef({
    onStopRequested,
    onReportRequested,
    onReportTypeRequested,
    onSearchRequested,
    onAutoNavigationStarted,
    onAutoSearchQuery,
    onAutoSearchResult,
  });

  useEffect(() => {
    callbacksRef.current = {
      onStopRequested,
      onReportRequested,
      onReportTypeRequested,
      onSearchRequested,
      onAutoNavigationStarted,
      onAutoSearchQuery,
      onAutoSearchResult,
    };
  }, [onStopRequested, onReportRequested, onReportTypeRequested, onSearchRequested,
    onAutoNavigationStarted, onAutoSearchQuery, onAutoSearchResult]);

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
      followingStep: followingNavStep,
      followingSteps: upcomingNavSteps,
      remainingDistKm,
      distToTurnM,
      routeInfo,
      destination: endLocation,
    })
  ), [
    isNavigating,
    currentStep,
    navStep,
    followingNavStep,
    upcomingNavSteps,
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
      .map((user) => {
        const distanceKm = user.distance ?? (userLocation
          ? haversineKm(
              userLocation.latitude,
              userLocation.longitude,
              user.latitude,
              user.longitude,
            )
          : null);
        return {
          id: String(user.id),
          label: user.name ?? 'Uzytkownik',
          lat: user.latitude,
          lng: user.longitude,
          type: user.isFriend ? 'friend' : 'user',
          avatarUrl: user.avatar ?? '',
          avatarFrameUrl: user.avatarFrameUrl ?? '',
          distanceLabel: distanceKm != null ? `${distanceKm.toFixed(1)} km` : '',
          isFriend: !!user.isFriend,
          isPremium: !!user.isPremium,
          markerSpriteUri: user.markerSpriteUri ?? '',
          vehicleModelUrl: user.vehicleModelUrl ?? '',
          vehicleModelMeta: user.vehicleModelMeta ?? null,
        };
      })
  ), [visibleUsers, userLocation]);

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
        logoUrl: station.brandLogoUrl ?? '',
        spriteUri: station.spriteUri ?? '',
        distanceLabel: station.distance != null
          ? `${(station.distance / 1000).toFixed(1)} km`
          : '',
        value: station.prices?.[0]?.pb95 != null
          ? station.prices[0].pb95.toFixed(2)
          : '',
      }))
  ), [fuelStations]);

  const autoPartnerPois = useMemo(() => (
    (partnerPois ?? [])
      .filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
      .slice(0, 120)
      .map((poi) => ({
        id: String(poi.id),
        label: poi.name ?? 'Partner VROOM',
        type: poi.category ?? 'partner',
        lat: poi.lat,
        lng: poi.lng,
        logoUrl: poi.logoUrl ?? '',
        spriteUri: poi.spriteUri ?? '',
        accentColor: poi.markerAccentColor ?? '#FFD700',
        value: '',
      }))
  ), [partnerPois]);

  const autoSelfMarker = useMemo(() => ({
    style: selfMarker?.style ?? locationMarkerStyle ?? 'profile',
    markerSpriteUri: selfMarker?.markerSpriteUri ?? '',
    vehicleModelUrl: selfMarker?.vehicleModelUrl ?? '',
    vehicleModelMeta: selfMarker?.vehicleModelMeta ?? null,
    modelHealth: selfMarker?.modelHealth ?? '',
  }), [selfMarker, locationMarkerStyle]);

  const mapDrop = (drop: NonNullable<UseAutoNavigationBridgeParams['geoDrops']>[number]) => {
    const lat = Number(drop.latitude ?? drop.lat);
    const lng = Number(drop.longitude ?? drop.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      id: String(drop.id),
      lat,
      lng,
      label: drop.label ?? drop.title ?? drop.name ?? 'Zrzut',
      type: drop.type ?? 'drop',
      status: drop.status ?? '',
      radiusM: drop.radiusM ?? drop.radius ?? null,
      spriteUri: drop.spriteUri ?? drop.markerSpriteUri ?? '',
    };
  };

  const autoGeoDrops = useMemo(() => (
    (geoDrops ?? [])
      .map(mapDrop)
      .filter((drop): drop is NonNullable<ReturnType<typeof mapDrop>> => !!drop)
      .slice(0, 80)
  ), [geoDrops]);

  const autoActiveDropPrompt = useMemo(() => (
    activeDropPrompt ? mapDrop(activeDropPrompt) : null
  ), [activeDropPrompt]);

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
    locationMarkerStyle: locationMarkerStyle ?? 'profile',
    currentUserAvatarUrl: currentUserAvatarUrl ?? '',
    hideLocation: !!hideLocation,
    isDriving: !!isDriving,
    isBuilding: !!isBuilding,
    arrived: !!arrived,
    offRoute: !!offRoute,
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
    selfMarker: autoSelfMarker,
    speedCameras: autoSpeedCameras,
    fuelStations: autoFuelStations,
    partnerPois: autoPartnerPois,
    geoDrops: autoGeoDrops,
    activeDropPrompt: autoActiveDropPrompt,
  }), [
    mapStyle,
    locationMarkerStyle,
    currentUserAvatarUrl,
    hideLocation,
    isDriving,
    isBuilding,
    arrived,
    offRoute,
    speedLimitKmh,
    startLocation,
    compactPolyline,
    compactBuilderRoute,
    autoBuilderPins,
    autoSelfMarker,
    autoSpeedCameras,
    autoFuelStations,
    autoPartnerPois,
    autoGeoDrops,
    autoActiveDropPrompt,
  ]);

  const fullPayloadKey = useMemo(() => JSON.stringify({
    isNavigating,
    isDriving: !!isDriving,
    isBuilding: !!isBuilding,
    arrived: !!arrived,
    offRoute: !!offRoute,
    dto,
    route: compactPolyline,
    destination: endLocation,
    users: autoUsers,
    warnings: autoWarnings,
    mapStyle: mapStyle ?? null,
    locationMarkerStyle: locationMarkerStyle ?? 'profile',
    currentUserAvatarUrl: currentUserAvatarUrl ?? '',
    selfMarker: autoSelfMarker,
    hideLocation: !!hideLocation,
    startLocation,
    speedLimitKmh: speedLimitKmh ?? null,
    builderRoute: compactBuilderRoute,
    builderPins: autoBuilderPins,
    speedCameras: autoSpeedCameras,
    fuelStations: autoFuelStations,
    partnerPois: autoPartnerPois,
    geoDrops: autoGeoDrops,
    activeDropPrompt: autoActiveDropPrompt,
  }), [
    isNavigating,
    isDriving,
    isBuilding,
    arrived,
    offRoute,
    dto,
    compactPolyline,
    endLocation,
    autoUsers,
    autoWarnings,
    mapStyle,
    locationMarkerStyle,
    currentUserAvatarUrl,
    autoSelfMarker,
    hideLocation,
    startLocation,
    speedLimitKmh,
    compactBuilderRoute,
    autoBuilderPins,
    autoSpeedCameras,
    autoFuelStations,
    autoPartnerPois,
    autoGeoDrops,
    autoActiveDropPrompt,
  ]);

  useEffect(() => {
    const now = Date.now();
    const modeKey = `${isNavigating ? 1 : 0}:${isDriving ? 1 : 0}:${isBuilding ? 1 : 0}:${arrived ? 1 : 0}`;
    const modeChanged = lastFullPayloadModeRef.current !== modeKey;
    if (!modeChanged && now - lastFullPayloadAtRef.current < 750) return;
    lastFullPayloadModeRef.current = modeKey;
    lastFullPayloadAtRef.current = now;

    const payload = {
      isNavigating,
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
    isDriving,
    isBuilding,
    arrived,
    dto,
    routeInfo,
    compactPolyline,
    endLocation,
    autoUsers,
    autoWarnings,
    autoMapState,
    fullPayloadKey,
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
    const navigationStartedSub = DeviceEventEmitter.addListener('onAutoNavigationStarted', (event) => {
      try {
        const parsed = typeof event === 'string' ? JSON.parse(event) : event;
        const rawRoute = parsed?.mapState?.route ?? parsed?.route ?? [];
        const routePoints = Array.isArray(rawRoute)
          ? rawRoute.map((point) => ({
              latitude: Number(point?.latitude ?? point?.lat),
              longitude: Number(point?.longitude ?? point?.lng),
            })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
          : [];
        if (routePoints.length < 2) return;
        const rawDestination = parsed?.destination;
        const destination = rawDestination && Number.isFinite(Number(rawDestination.latitude ?? rawDestination.lat))
          && Number.isFinite(Number(rawDestination.longitude ?? rawDestination.lng))
          ? {
              latitude: Number(rawDestination.latitude ?? rawDestination.lat),
              longitude: Number(rawDestination.longitude ?? rawDestination.lng),
              name: String(rawDestination.name ?? 'Cel'),
            }
          : null;
        void callbacksRef.current.onAutoNavigationStarted?.({
          routePoints,
          destination,
          distanceMeters: Number(parsed?.dto?.remainingDistanceMeters ?? parsed?.distanceMeters ?? 0),
          durationSeconds: Number(
            parsed?.dto?.remainingDurationSec
            ?? parsed?.dto?.remainingDurationSeconds
            ?? parsed?.durationSeconds
            ?? 0,
          ),
          instruction: String(parsed?.dto?.nextInstruction ?? ''),
          routePreview: parsed?.mapState?.routePreview === true || parsed?.isNavigating === false,
          selectedRouteIndex: Number(parsed?.mapState?.selectedRouteIndex ?? 0),
        });
      } catch {
      }
    });
    const searchQuerySub = DeviceEventEmitter.addListener('onSearchQuery', (query) => {
      callbacksRef.current.onAutoSearchQuery?.(String(query ?? ''));
    });
    const searchResultSub = DeviceEventEmitter.addListener('onSearchResult', (id) => {
      callbacksRef.current.onAutoSearchResult?.(String(id ?? ''));
    });

    return () => {
      reportSub.remove();
      reportTypeSub.remove();
      searchSub.remove();
      stopSub.remove();
      navigationStartedSub.remove();
      searchQuerySub.remove();
      searchResultSub.remove();
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
