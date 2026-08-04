import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { API_URL } from '../../constants/config';
import type { NotificationData } from './routingCore';

export {
  isSafeInternalNotificationUrl,
  notificationNavigationKey,
  resolveNotificationUrl,
  type NotificationData,
} from './routingCore';

const numeric = (value: unknown): string | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : null;
};

export async function markNotificationOpened(data: NotificationData): Promise<void> {
  const notificationId = numeric(data.notificationId);
  if (!notificationId) return;
  const authToken = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
  if (!authToken) return;
  await fetch(`${API_URL}/api/notifications/${notificationId}/open`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  }).catch(() => {});
  await syncNotificationBadge();
}

export async function syncNotificationBadge(): Promise<void> {
  const authToken = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
  if (!authToken) return;
  try {
    const response = await fetch(`${API_URL}/api/notifications?limit=1&page=1`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!response.ok) return;
    const data = await response.json();
    await Notifications.setBadgeCountAsync(Math.max(0, Number(data.unreadCount) || 0));
  } catch { /* badge is best effort */ }
}
