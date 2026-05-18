import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { API_URL } from '../constants/config';

const REFRESH_MS_FOREGROUND = 120_000;

async function getAuthToken(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

/** Polling licznika online + ping `lastSeen` dla zalogowanych. */
export function useAppPresence() {
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let cancelled = false;

    const fetchOnline = async () => {
      if (appStateRef.current !== 'active') return;
      try {
        const res = await fetch(`${API_URL}/api/stats/online`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const j = (await res.json()) as { activeInApp?: number };
        if (!cancelled && typeof j.activeInApp === 'number') {
          setOnlineCount(j.activeInApp);
        }
      } catch {
        /* ignore */
      }
    };

    const ping = async () => {
      if (appStateRef.current !== 'active') return;
      try {
        const token = await getAuthToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/profile/ping`, {
          method:  'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept:        'application/json',
          },
        });
        if (!res.ok) return;
      } catch {
        /* ignore */
      }
    };

    /** Najpierw ping (invaliduje cache + wpisuje lastSeen), potem GET — ta kolejność jest kluczowa. */
    const pingThenFetch = async () => {
      await ping();
      await fetchOnline();
    };

    void pingThenFetch();

    let refreshInterval: ReturnType<typeof setInterval> | null = null;

    const scheduleRefresh = () => {
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = null;
      if (appStateRef.current !== 'active') return;
      refreshInterval = setInterval(() => void pingThenFetch(), REFRESH_MS_FOREGROUND);
    };

    scheduleRefresh();

    const sub = AppState.addEventListener('change', (s) => {
      if (appStateRef.current.match(/inactive|background/) && s === 'active') {
        void pingThenFetch();
      }
      appStateRef.current = s;
      scheduleRefresh();
    });

    return () => {
      cancelled = true;
      if (refreshInterval) clearInterval(refreshInterval);
      sub.remove();
    };
  }, []);

  return onlineCount;
}
