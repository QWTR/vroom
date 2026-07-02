import { AppState, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { API_URL } from '../constants/config';
import {
  BACKGROUND_LOCATION_TASK,
  BG_IS_DRIVING_KEY,
  BG_IS_NAVIGATING_KEY,
  mirrorBackgroundTrackingSetting,
  stopBackgroundLocationTaskIfRunning,
} from '../hooks/useBackgroundTracking';
import { stopVroomBgForegroundNotification } from './vroomBgForegroundService';
import { BackgroundDriveController } from './backgroundDriveController';

const { VroomBgTracking } = NativeModules;
const BG_PENDING_ACTIVITY_SAVE_KEY = 'bg_pending_activity_save';
const TRIP_SESSION_ID_KEY = 'active_trip_session_id';
const TRIP_SESSION_STARTED_AT_KEY = 'active_trip_session_started_at';

export type BgTrackingEndHandler = () => Promise<void>;

let endHandler: BgTrackingEndHandler | null = null;
let wired = false;
let handlingEnd = false;

async function getAuthToken(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) || (await AsyncStorage.getItem('token'));
}

function trimRoutePoints(points: Array<{ latitude: number; longitude: number }>): Array<{ latitude: number; longitude: number }> {
  const clean = (Array.isArray(points) ? points : [])
    .map((p) => ({ latitude: Number(p.latitude), longitude: Number(p.longitude) }))
    .filter((p) =>
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude) &&
      p.latitude >= -90 &&
      p.latitude <= 90 &&
      p.longitude >= -180 &&
      p.longitude <= 180
    );
  if (clean.length <= 1500) return clean;
  const step = Math.ceil(clean.length / 1500);
  const sampled = clean.filter((_, index) => index % step === 0);
  const last = clean[clean.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled.slice(0, 1500);
}

async function clearActiveTripSession(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([TRIP_SESSION_ID_KEY, TRIP_SESSION_STARTED_AT_KEY]);
  } catch { /* ignore */ }
}

async function saveNativeFinalFromNotification(): Promise<void> {
  let pendingPayload: any = null;
  try {
    const token = await getAuthToken();
    if (!token) return;
    const [state, stats] = await Promise.all([
      BackgroundDriveController.getState(),
      BackgroundDriveController.consumeNativeStats(),
    ]);

    const distance = Number(stats.distanceKm);
    const routePoints = trimRoutePoints(stats.routePoints || []);
    if (!Number.isFinite(distance) || distance < 0.05 || routePoints.length < 2) return;

    const speedSamples = Array.isArray(stats.speedSamples)
      ? stats.speedSamples.map(Number).filter((v) => Number.isFinite(v) && v >= 0)
      : [];
    const avgSpeed = speedSamples.length
      ? speedSamples.reduce((sum, v) => sum + v, 0) / speedSamples.length
      : 0;
    const maxSpeed = Math.max(Number(stats.maxSpeedKmh || 0), ...speedSamples, 0);
    const startedAtMs = Number(state.startedAt || Date.now());
    const endedAtMs = Number(state.updatedAt || Date.now());
    const mode = state.mode === 'navigation' ? 'navigation' : 'freeDrive';

    const payload = {
      tripSessionId: stats.tripSessionId || state.tripSessionId || undefined,
      distance: Math.round(distance * 1000) / 1000,
      maxSpeed: Math.round(maxSpeed * 10) / 10,
      avgSpeed: Math.round(avgSpeed * 10) / 10,
      duration: Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000)),
      routePoints,
      routePointsCount: routePoints.length,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      source: mode === 'navigation' ? 'navigation_final' : 'drive_final',
    };
    pendingPayload = payload;

    const res = await fetch(`${API_URL}/api/activity/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await AsyncStorage.setItem(BG_PENDING_ACTIVITY_SAVE_KEY, JSON.stringify(payload));
    }
    await clearActiveTripSession();
  } catch {
    if (pendingPayload) {
      try {
        await AsyncStorage.setItem(BG_PENDING_ACTIVITY_SAVE_KEY, JSON.stringify(pendingPayload));
        await clearActiveTripSession();
      } catch { /* ignore */ }
    }
  }
}

async function handleBgTrackingEndFromNotification(): Promise<void> {
  if (handlingEnd) return;
  handlingEnd = true;
  try {
    if (Platform.OS !== 'android') {
      await BackgroundDriveController.stop('notification');
    }
    await saveNativeFinalFromNotification();
    await clearActiveTripSession();
    await stopVroomBgForegroundNotification();
    await stopBackgroundLocationTaskIfRunning();
    await mirrorBackgroundTrackingSetting(false);
    try {
      const isRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRunning) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch { /* ignore */ }

    try {
      await AsyncStorage.multiSet([
        [BG_IS_DRIVING_KEY, 'false'],
        [BG_IS_NAVIGATING_KEY, 'false'],
      ]);
    } catch { /* ignore */ }

    if (endHandler) {
      await endHandler();
      return;
    }

    try {
      const cached = await AsyncStorage.getItem('app_settings');
      const current = cached ? JSON.parse(cached) : {};
      await AsyncStorage.setItem(
        'app_settings',
        JSON.stringify({ ...current, backgroundTracking: false }),
      );
    } catch { /* ignore */ }
  } finally {
    handlingEnd = false;
  }
}

async function consumeNativePendingStop(): Promise<void> {
  if (Platform.OS !== 'android' || !VroomBgTracking?.consumeStopFromNotification) return;
  try {
    const pending = await VroomBgTracking.consumeStopFromNotification();
    if (pending) await handleBgTrackingEndFromNotification();
  } catch { /* ignore */ }
}

export function setBgTrackingEndHandler(handler: BgTrackingEndHandler | null): void {
  endHandler = handler;
}

export function wireBgTrackingNotificationControl(): () => void {
  if (wired) return () => {};
  wired = true;

  void consumeNativePendingStop();

  const removeStopListener = BackgroundDriveController.addStopListener(
    () => { void handleBgTrackingEndFromNotification(); },
  );

  const appSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void consumeNativePendingStop();
  });

  return () => {
    wired = false;
    removeStopListener();
    appSub.remove();
  };
}
