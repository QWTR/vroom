import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export type MaintenanceStatus = {
  enabled: boolean;
  message: string;
  bypassAllowed: boolean;
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
    return { enabled: false, message: '', bypassAllowed: false };
  }

  const data = await res.json().catch(() => ({}));
  return {
    enabled: data?.enabled === true,
    message: typeof data?.message === 'string' ? data.message : '',
    bypassAllowed: data?.bypassAllowed === true,
  };
}

export function shouldBlockApp(status: MaintenanceStatus): boolean {
  return status.enabled && !status.bypassAllowed;
}
