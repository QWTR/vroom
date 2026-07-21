import { AppState, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  BACKGROUND_LOCATION_TASK,
  BG_IS_DRIVING_KEY,
  BG_IS_NAVIGATING_KEY,
  finalizeTripSession,
  mirrorBackgroundTrackingSetting,
  stopBackgroundLocationTaskIfRunning,
} from '../hooks/useBackgroundTracking';
import { stopVroomBgForegroundNotification } from './vroomBgForegroundService';
import { BackgroundDriveController } from './backgroundDriveController';

const { VroomBgTracking } = NativeModules;
export type BgTrackingEndHandler = () => Promise<void>;

let endHandler: BgTrackingEndHandler | null = null;
let wired = false;
let handlingEnd = false;

async function saveNativeFinalFromNotification(): Promise<void> {
  try {
    const [state, stats] = await Promise.all([
      BackgroundDriveController.getState(),
      BackgroundDriveController.getNativeStats(),
    ]);

    const distance = Number(stats.distanceKm);
    if (!Number.isFinite(distance) || distance < 0.05) return;

    const speedSamples = Array.isArray(stats.speedSamples)
      ? stats.speedSamples.map(Number).filter((v) => Number.isFinite(v) && v >= 0)
      : [];
    const avgSpeed = speedSamples.length
      ? speedSamples.reduce((sum, v) => sum + v, 0) / speedSamples.length
      : 0;
    const maxSpeed = Math.max(Number(stats.maxSpeedKmh || 0), ...speedSamples, 0);
    const mode = state.mode === 'navigation' ? 'navigation' : 'freeDrive';
    await finalizeTripSession({
      reason: 'manual',
      mode,
      distanceKm: distance,
      maxSpeedKmh: maxSpeed,
      avgSpeedKmh: avgSpeed,
      durationSec: Math.max(0, Math.round((Number(state.updatedAt || Date.now()) - Number(state.startedAt || Date.now())) / 1000)),
      routePoints: stats.routePoints,
    });
  } catch {
    // finalizeTripSession persists an outbox item before attempting the network.
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
    (payload) => {
      if (payload?.reason === 'notification' || payload?.reason === 'manual' || payload?.reason === 'user') {
        void handleBgTrackingEndFromNotification();
      }
    },
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
