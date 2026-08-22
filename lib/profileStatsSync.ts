import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { invalidateProfileMeClientCache } from './cachedProfileMe';

type StatsListener = () => void;
const listeners = new Set<StatsListener>();

/** Odśwież statystyki na profilu po zapisie przejazdu / km. */
export function onProfileStatsUpdated(fn: StatsListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyProfileStatsUpdated(): void {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
}

function mergeProfileStatsCache(old: Record<string, unknown> | null, data: Record<string, unknown>) {
  const base = old ?? {};
  return {
    ...base,
    totalDistance: data.totalDistance ?? base.totalDistance,
    dailyDistance: data.dailyDistance ?? base.dailyDistance,
    weeklyDistance: data.weeklyDistance ?? base.weeklyDistance,
    monthlyDistance: data.monthlyDistance ?? base.monthlyDistance,
    topSpeed: data.topSpeed ?? base.topSpeed,
    avgSpeed: data.avgSpeed ?? base.avgSpeed,
    avgMaxSpeed: data.avgMaxSpeed ?? base.avgMaxSpeed,
    totalRides: data.totalRides ?? base.totalRides,
    monthlyRides: data.monthlyRides ?? base.monthlyRides,
    streak: data.streak ?? base.streak,
    points: data.points ?? base.points,
    position: data.position ?? base.position,
  };
}

/** Pobierz /api/profile/me i zaktualizuj cache użytkownika (km, prędkości, streak). */
export async function syncProfileStatsFromServer(): Promise<boolean> {
  try {
    const token =
      (await AsyncStorage.getItem('userToken'))
      ?? (await AsyncStorage.getItem('token'));
    if (!token) return false;

    invalidateProfileMeClientCache();

    const res = await fetch(`${API_URL}/api/profile/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;

    const data = await res.json();
    const localRaw = await AsyncStorage.getItem('user');
    const old = localRaw ? JSON.parse(localRaw) : null;
    await AsyncStorage.setItem('user', JSON.stringify(mergeProfileStatsCache(old, data)));

    notifyProfileStatsUpdated();
    return true;
  } catch {
    return false;
  }
}

/** Optimistic local bump when server returns checkpoint totals before profile refresh. */
export async function applyOptimisticProfileDistanceKm(
  userTotalDistance?: number,
  creditedDeltaKm?: number,
): Promise<void> {
  try {
    const localRaw = await AsyncStorage.getItem('user');
    const old = localRaw ? JSON.parse(localRaw) : {};
    const prev = Number(old.totalDistance ?? 0) || 0;
    const next = Number.isFinite(Number(userTotalDistance))
      ? Math.max(prev, Number(userTotalDistance))
      : prev + Math.max(0, Number(creditedDeltaKm ?? 0) || 0);
    if (!Number.isFinite(next) || next <= prev) return;
    await AsyncStorage.setItem('user', JSON.stringify({
      ...old,
      totalDistance: next,
    }));
    notifyProfileStatsUpdated();
  } catch { /* ignore */ }
}
