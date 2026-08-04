import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { clearPendingNotificationReplies, configureNotificationRuntime } from '../lib/notifications/runtime';

const EXPO_TOKEN_KEY = 'vroom_expo_push_token';
const DEVICE_ID_KEY = 'vroom_push_device_id';
let registrationInFlight: Promise<string | null> | null = null;
let lastRegisteredAuthToken: string | null = null;

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

async function sendTokenToServer(token: string): Promise<boolean> {
  const authToken = await getToken();
  if (!authToken) return false;
  const storedToken = await AsyncStorage.getItem(EXPO_TOKEN_KEY);
  if (storedToken === token && lastRegisteredAuthToken === authToken) return true;
  try {
    const response = await fetch(`${API_URL}/api/notifications/push-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
        provider: 'expo',
        deviceId: await getDeviceId(),
      }),
    });
    if (!response.ok) return false;
    await AsyncStorage.setItem(EXPO_TOKEN_KEY, token);
    lastRegisteredAuthToken = authToken;
    return true;
  } catch (error) {
    console.warn('[Notifications] Nie udało się zapisać tokenu:', error);
    return false;
  }
}

export function usePushNotifications() {
  useEffect(() => {
    void registerPushToken();
    const subscription = Notifications.addPushTokenListener(() => {
      void registerPushToken();
    });
    return () => subscription.remove();
  }, []);
}

async function performPushTokenRegistration(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    await configureNotificationRuntime();

    const current = await Notifications.getPermissionsAsync();
    const finalStatus = current.status === 'granted'
      ? current.status
      : (await Notifications.requestPermissionsAsync()).status;
    if (finalStatus !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn('[Notifications] Brak EAS projectId');
      return null;
    }
    const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return (await sendTokenToServer(expoToken)) ? expoToken : null;
  } catch (error) {
    console.error('[Notifications] Rejestracja tokenu nie powiodła się:', error);
    return null;
  }
}

export async function registerPushToken(): Promise<string | null> {
  if (registrationInFlight) return registrationInFlight;
  registrationInFlight = performPushTokenRegistration();
  try {
    return await registrationInFlight;
  } finally {
    registrationInFlight = null;
  }
}

export async function unregisterPushToken(): Promise<void> {
  const [authToken, token, deviceId] = await Promise.all([
    getToken(),
    AsyncStorage.getItem(EXPO_TOKEN_KEY),
    AsyncStorage.getItem(DEVICE_ID_KEY),
  ]);
  if (authToken && (token || deviceId)) {
    await fetch(`${API_URL}/api/notifications/push-token`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceId }),
    }).catch(() => {});
  }
  await Notifications.unregisterForNotificationsAsync().catch(() => {});
  await clearPendingNotificationReplies();
  await AsyncStorage.removeItem(EXPO_TOKEN_KEY).catch(() => {});
  lastRegisteredAuthToken = null;
}

export async function getNotificationPermissionState(): Promise<Notifications.PermissionStatus> {
  return (await Notifications.getPermissionsAsync()).status;
}
