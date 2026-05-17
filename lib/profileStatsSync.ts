import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

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

/** Pobierz /api/profile/me i zaktualizuj cache użytkownika (km, prędkości, streak). */
export async function syncProfileStatsFromServer(): Promise<boolean> {
  try {
    const token =
      (await AsyncStorage.getItem('userToken'))
      ?? (await AsyncStorage.getItem('token'));
    if (!token) return false;

    const res = await fetch(`${API_URL}/api/profile/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;

    const data = await res.json();
    const localRaw = await AsyncStorage.getItem('user');
    if (localRaw) {
      const old = JSON.parse(localRaw);
      await AsyncStorage.setItem('user', JSON.stringify({
        ...old,
        totalDistance: data.totalDistance ?? old.totalDistance,
        dailyDistance: data.dailyDistance ?? old.dailyDistance,
        weeklyDistance: data.weeklyDistance ?? old.weeklyDistance,
        monthlyDistance: data.monthlyDistance ?? old.monthlyDistance,
        topSpeed: data.topSpeed ?? old.topSpeed,
        avgSpeed: data.avgSpeed ?? old.avgSpeed,
        avgMaxSpeed: data.avgMaxSpeed ?? old.avgMaxSpeed,
        totalRides: data.totalRides ?? old.totalRides,
        monthlyRides: data.monthlyRides ?? old.monthlyRides,
        streak: data.streak ?? old.streak,
        points: data.points ?? old.points,
        position: data.position ?? old.position,
      }));
    }

    notifyProfileStatsUpdated();
    return true;
  } catch {
    return false;
  }
}
