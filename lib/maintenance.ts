import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export type MaintenanceStatus = {
  enabled: boolean;
  message: string;
  bypassAllowed: boolean;
  mapEnabled: boolean;
  mapMessage: string;
  mapBypassAllowed: boolean;
};

export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  const token =
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'));

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api/maintenance/status`, {
    headers,
    cache: 'no-store',
  });

  if (!res.ok) {
    return {
      enabled: false,
      message: '',
      bypassAllowed: false,
      mapEnabled: false,
      mapMessage: '',
      mapBypassAllowed: false,
    };
  }

  const data = await res.json().catch(() => ({}));
  return {
    enabled: data?.enabled === true,
    message: typeof data?.message === 'string' ? data.message : '',
    bypassAllowed: data?.bypassAllowed === true,
    mapEnabled: data?.mapEnabled === true,
    mapMessage: typeof data?.mapMessage === 'string' ? data.mapMessage : '',
    mapBypassAllowed: data?.mapBypassAllowed === true,
  };
}

export function shouldBlockApp(status: MaintenanceStatus): boolean {
  return status.enabled && !status.bypassAllowed;
}

export function shouldBlockMap(status: MaintenanceStatus): boolean {
  return status.mapEnabled && !status.mapBypassAllowed;
}
