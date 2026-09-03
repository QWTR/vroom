import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { AppState, AppStateStatus, DeviceEventEmitter } from 'react-native';
import { API_URL } from '../constants/config';
import { resolveOnlineCountPayload } from '../lib/appPresencePayload';

export const STREAK_UPDATED = 'STREAK_UPDATED';

const REFRESH_MS_FOREGROUND = 30_000;

type Listener = (count: number | null) => void;

let sharedCount: number | null = null;
const listeners = new Set<Listener>();
let loopStarted = false;
let cancelled = false;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
// W starszej architekturze RN currentState może być chwilowo null przy starcie.
// Hook montuje się w widocznej aplikacji, więc nie blokujemy przez to pierwszego pinga.
const appStateRef = { current: (AppState.currentState ?? 'active') as AppStateStatus };

async function getAuthToken(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

function notifyListeners(count: number | null) {
  sharedCount = count;
  for (const fn of listeners) fn(count);
}

async function fetchOnline() {
  if (appStateRef.current !== 'active') return;
  try {
    const res = await fetch(`${API_URL}/api/stats/online`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const j = (await res.json()) as { online?: number; activeInApp?: number };
    const count = resolveOnlineCountPayload(j);
    if (!cancelled && count != null) {
      notifyListeners(count);
    }
  } catch {
    /* ignore */
  }
}

async function applyStreakToCache(streak: number, streakResetAt?: string | null) {
  try {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return;
    const user = JSON.parse(raw) as Record<string, unknown>;
    user.streak = streak;
    if (streakResetAt) user.streakResetAt = streakResetAt;
    await AsyncStorage.setItem('user', JSON.stringify(user));
    DeviceEventEmitter.emit(STREAK_UPDATED, {
      streak,
      streakResetAt: streakResetAt ?? user.streakResetAt ?? null,
    });
  } catch {
    /* ignore */
  }
}

async function ping(force = false) {
  if (!force && appStateRef.current !== 'active') return;
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
    const j = (await res.json()) as { streak?: number; streakResetAt?: string };
    if (typeof j.streak === 'number') {
      await applyStreakToCache(j.streak, j.streakResetAt ?? null);
    }
  } catch {
    /* ignore */
  }
}

async function pingThenFetch() {
  await ping();
  await fetchOnline();
}

function scheduleRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = null;
  if (appStateRef.current !== 'active') return;
  refreshInterval = setInterval(() => void pingThenFetch(), REFRESH_MS_FOREGROUND);
}

function startPresenceLoop() {
  if (loopStarted) return;
  loopStarted = true;
  cancelled = false;

  void pingThenFetch();
  scheduleRefresh();

  appStateSub = AppState.addEventListener('change', (s) => {
    const prev = appStateRef.current;
    const cameToForeground = prev.match(/inactive|background/) && s === 'active';
    const wentToBackground = prev === 'active' && !!s.match(/inactive|background/);
    // Event przekazuje już nowy stan. Ustaw ref przed wywołaniem funkcji,
    // których guard sprawdza, czy aplikacja jest na pierwszym planie.
    appStateRef.current = s;
    if (cameToForeground) {
      void pingThenFetch();
    } else if (wentToBackground) {
      // Ostatni ping przy minimalizacji — lastSeen świeży, by liczyć jako online (apka w tle)
      // przez pełne okno serwera. force=true, bo appState właśnie przestaje być 'active'.
      void ping(true);
    }
    scheduleRefresh();
  });
}

function stopPresenceLoop() {
  if (!loopStarted) return;
  cancelled = true;
  loopStarted = false;
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = null;
  appStateSub?.remove();
  appStateSub = null;
}

/** Polling licznika online + ping lastSeen oraz dzienny check-in streaka. */
export function useAppPresence() {
  const [onlineCount, setOnlineCount] = useState<number | null>(sharedCount);

  useEffect(() => {
    startPresenceLoop();
    listeners.add(setOnlineCount);
    setOnlineCount(sharedCount);

    return () => {
      listeners.delete(setOnlineCount);
      if (listeners.size === 0) stopPresenceLoop();
    };
  }, []);

  return onlineCount;
}
