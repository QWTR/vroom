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

const MAINTENANCE_TIMEOUT_MS = 5_000;

const OPEN_STATUS: MaintenanceStatus = {
  enabled: false,
  message: '',
  bypassAllowed: false,
  mapEnabled: false,
  mapMessage: '',
  mapBypassAllowed: false,
};

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  try {
    const token =
      (await AsyncStorage.getItem('userToken')) ??
      (await AsyncStorage.getItem('token'));

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await withTimeout(
      fetch(`${API_URL}/api/maintenance/status`, {
        headers,
        cache: 'no-store',
      }),
      MAINTENANCE_TIMEOUT_MS,
      null as any,
    );

    if (!res || !res.ok) return OPEN_STATUS;

    const data = await res.json().catch(() => ({}));
    return {
      enabled: data?.enabled === true,
      message: typeof data?.message === 'string' ? data.message : '',
      bypassAllowed: data?.bypassAllowed === true,
      mapEnabled: data?.mapEnabled === true,
      mapMessage: typeof data?.mapMessage === 'string' ? data.mapMessage : '',
      mapBypassAllowed: data?.mapBypassAllowed === true,
    };
  } catch {
    return OPEN_STATUS;
  }
}

export function shouldBlockApp(status: MaintenanceStatus): boolean {
  return status.enabled && !status.bypassAllowed;
}

export function shouldBlockMap(status: MaintenanceStatus): boolean {
  return status.mapEnabled && !status.mapBypassAllowed;
}
