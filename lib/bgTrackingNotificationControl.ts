import { AppState, DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  BACKGROUND_LOCATION_TASK,
  mirrorBackgroundTrackingSetting,
  stopBackgroundLocationTaskIfRunning,
} from '../hooks/useBackgroundTracking';
import { stopVroomBgForegroundNotification } from './vroomBgForegroundService';

const { VroomBgTracking } = NativeModules;

export type BgTrackingEndHandler = () => Promise<void>;

let endHandler: BgTrackingEndHandler | null = null;
let wired = false;

async function handleBgTrackingEndFromNotification(): Promise<void> {
  await stopVroomBgForegroundNotification();
  await stopBackgroundLocationTaskIfRunning();
  await mirrorBackgroundTrackingSetting(false);
  try {
    const isRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
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

  const sub = DeviceEventEmitter.addListener(
    BgTrackingModuleEventName,
    () => { void handleBgTrackingEndFromNotification(); },
  );

  const appSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void consumeNativePendingStop();
  });

  return () => {
    wired = false;
    sub.remove();
    appSub.remove();
  };
}

const BgTrackingModuleEventName = 'VROOM_BG_TRACKING_END';
