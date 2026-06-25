import { NativeModules, Platform } from 'react-native';

const { VroomBgTracking } = NativeModules;

let notificationActive = false;

export function isVroomBgForegroundNotificationActive(): boolean {
  return notificationActive;
}

export async function startVroomBgForegroundNotification(): Promise<boolean> {
  if (Platform.OS !== 'android' || !VroomBgTracking?.startForegroundNotification) {
    return false;
  }
  if (notificationActive) return true;
  try {
    await VroomBgTracking.startForegroundNotification();
    notificationActive = true;
    return true;
  } catch (e) {
    if (__DEV__) console.log('[BG] startVroomBgForegroundNotification failed:', e);
    return false;
  }
}

export async function stopVroomBgForegroundNotification(): Promise<void> {
  if (Platform.OS !== 'android' || !VroomBgTracking?.stopForegroundNotification) return;
  if (!notificationActive) return;
  try {
    await VroomBgTracking.stopForegroundNotification();
  } catch (e) {
    if (__DEV__) console.log('[BG] stopVroomBgForegroundNotification failed:', e);
  } finally {
    notificationActive = false;
  }
}
