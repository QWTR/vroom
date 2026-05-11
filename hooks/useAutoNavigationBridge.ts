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
  currentStep: number;
  navStep: Step | null;
  routeInfo: (RouteInfo & { durationText?: string | null }) | null;
  remainingDistKm: number | null;
  distToTurnM: number | null;
  endLocation: LocationState | null;
  userLocation: LocationState | null;
  speed: number | null;
  heading: number;
  navRoutePoints: { latitude: number; longitude: number }[] | null | undefined;
  previewRoutePoints: { latitude: number; longitude: number }[] | null | undefined;
  onStopRequested: () => void;
}

export function useAutoNavigationBridge(params: UseAutoNavigationBridgeParams) {
  const {
    isNavigating,
    currentStep,
    navStep,
    routeInfo,
    remainingDistKm,
    distToTurnM,
    endLocation,
    userLocation,
    speed,
    heading,
    navRoutePoints,
    previewRoutePoints,
    onStopRequested,
  } = params;
  const lastSnapshotAtRef = useRef(0);

  const activeRoutePoints = isNavigating ? navRoutePoints : previewRoutePoints;
  const compactPolyline = useMemo(
    () => compactRoutePolyline(activeRoutePoints, 280),
    [activeRoutePoints],
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
}
