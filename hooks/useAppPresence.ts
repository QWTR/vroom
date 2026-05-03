import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '../constants/config';

const POLL_MS = 20000;
/** Ping rzadszy niż poll — po ping zawsze odświeżamy licznik (inaczej pierwszy GET widział cache „0”). */
const PING_MS = 60000;

async function getAuthToken(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

/** Polling licznika online + ping `lastSeen` dla zalogowanych. */
export function useAppPresence() {
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    let cancelled = false;

    const fetchOnline = async () => {
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
    const pingInterval = setInterval(() => void pingThenFetch(), PING_MS);
    const pollInterval = setInterval(() => void fetchOnline(), POLL_MS);

    const sub = AppState.addEventListener('change', (s) => {
      if (appStateRef.current.match(/inactive|background/) && s === 'active') {
        void pingThenFetch();
      }
      appStateRef.current = s;
    });

    return () => {
      cancelled = true;
      clearInterval(pingInterval);
      clearInterval(pollInterval);
      sub.remove();
    };
  }, []);

  return onlineCount;
}
