import { useEffect, useRef, useCallback } from 'react';
import * as Location      from 'expo-location';
import * as TaskManager   from 'expo-task-manager';
import AsyncStorage       from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { API_URL }        from '../constants/mapConfig';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

// ── In-memory speed tracking (foreground) ────────────────────────────────────
let _speedSamples: number[] = [];
let _speedMax     = 0;
let _navDistKm    = 0;

export function feedSpeedSample(speedMs: number | null) {
  if (speedMs == null || speedMs < 0) return;
  const kmh = speedMs * 3.6;
  if (kmh < 1) return;
  _speedSamples.push(kmh);
  if (kmh > _speedMax) _speedMax = kmh;
}

export function feedNavDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const d = haversineKm(lat1, lon1, lat2, lon2);
  if (d > 0 && d < 0.5) _navDistKm += d;
}

export function resetSpeedStats() {
  _speedSamples = [];
  _speedMax     = 0;
  _navDistKm    = 0;
}

export function getSpeedDebug() {
  return { samples: _speedSamples.length, max: _speedMax, distKm: _navDistKm };
}

// ── Wywołaj RAZ — czyści i zwraca ─────────────────────────────────────────────
function flushSpeedStatsSync(): { avgSpeed: number; maxSpeed: number; distKm: number } {
  const avg = _speedSamples.length > 0
    ? _speedSamples.reduce((a, b) => a + b, 0) / _speedSamples.length
    : 0;
  const result = {
    avgSpeed: Math.round(avg       * 10) / 10,
    maxSpeed: Math.round(_speedMax * 10) / 10,
    distKm:   Math.round(_navDistKm * 1000) / 1000,
  };
  // Wyczyść po pobraniu
  _speedSamples = [];
  _speedMax     = 0;
  _navDistKm    = 0;
  return result;
}

// ── BG task ───────────────────────────────────────────────────────────────────
const BG_SPEED_SAMPLES_KEY = 'nav_speed_samples';
const BG_SPEED_MAX_KEY     = 'nav_speed_max';
const BG_PENDING_KM_KEY    = 'bg_pending_km';
const BG_LAST_LOC_KEY      = 'bg_last_location';

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  const location = data.locations?.[0];
  if (!location) return;

  try {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const { latitude, longitude, speed } = location.coords;

    await fetch(`${API_URL}/api/live/location`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lat: latitude, lng: longitude, shareLocation: true }),
    });

    if (speed != null && speed * 3.6 >= 1) {
      const kmh        = speed * 3.6;
      const samplesRaw = await AsyncStorage.getItem(BG_SPEED_SAMPLES_KEY);
      const samples    = samplesRaw ? JSON.parse(samplesRaw) : [];
      const maxRaw     = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
      const curMax     = parseFloat(maxRaw ?? '0');
      samples.push(kmh);
      await Promise.all([
        AsyncStorage.setItem(BG_SPEED_SAMPLES_KEY, JSON.stringify(samples)),
        AsyncStorage.setItem(BG_SPEED_MAX_KEY, String(kmh > curMax ? kmh : curMax)),
      ]);
    }

    const lastRaw = await AsyncStorage.getItem(BG_LAST_LOC_KEY);
    if (lastRaw) {
      const last   = JSON.parse(lastRaw);
      const distKm = haversineKm(last.latitude, last.longitude, latitude, longitude);
      if (distKm > 0.01 && distKm < 0.5) {
        const pending = parseFloat(await AsyncStorage.getItem(BG_PENDING_KM_KEY) ?? '0');
        await AsyncStorage.setItem(BG_PENDING_KM_KEY, String(pending + distKm));
      }
    }
    await AsyncStorage.setItem(BG_LAST_LOC_KEY, JSON.stringify({ latitude, longitude }));
  } catch (e) {
    console.log('BG task error:', e);
  }
});

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Hook ─────────────────────────────────────────────────────���────────────────
export function useBackgroundTracking(isSharing: boolean) {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { appStateRef.current = s; });
    return () => sub.remove();
  }, []);

  const flushPendingKm = useCallback(async (fromNavigation = false) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.log('❌ flushPendingKm — brak tokenu');
        return;
      }

      if (fromNavigation) {
        // ── Pobierz dane RAZ — flushSpeedStatsSync czyści po pobraniu ──
        const { avgSpeed, maxSpeed, distKm } = flushSpeedStatsSync();

        // Uzupełnij dystansem z BG jeśli apka była w tle
        const bgPendingStr = await AsyncStorage.getItem(BG_PENDING_KM_KEY);
        const bgPending    = parseFloat(bgPendingStr ?? '0');
        const finalDist    = Math.max(distKm, bgPending);

        // Wyczyść BG accumulatory
        await AsyncStorage.setItem(BG_PENDING_KM_KEY, '0');
        await Promise.all([
          AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
          AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
        ]);


        const response = await fetch(`${API_URL}/api/activity/save`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ distance: finalDist, maxSpeed, avgSpeed, duration: null }),
        });

        const json = await response.json();

      } else {
        // ── Tylko sharing bez nawigacji ───────────────────────────────
        const pendingStr = await AsyncStorage.getItem(BG_PENDING_KM_KEY);
        const pending    = parseFloat(pendingStr ?? '0');
        if (pending < 0.1) return;

        await fetch(`${API_URL}/api/live/distance`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ km: pending }),
        });
        await AsyncStorage.setItem(BG_PENDING_KM_KEY, '0');
      }
    } catch (e) {
      console.log('flushPendingKm error:', e);
    }
  }, []);

  const startBackgroundTracking = useCallback(async () => {
    if (appStateRef.current !== 'active') return;
    const bgEnabled = await AsyncStorage.getItem('setting_background_tracking');
    if (bgEnabled === 'false') return;
    try {
      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== 'granted') return;
      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') return;
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRegistered) return;
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy:         Location.Accuracy.Balanced,
        distanceInterval: 50,
        timeInterval:     30000,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: '🚗 VROOM aktywne',
          notificationBody:  'Śledzenie trasy w tle',
          notificationColor: '#e33835',
        },
      });
    } catch (e: any) {
      console.log('⚠️ startBackgroundTracking error:', e?.message ?? e);
    }
  }, []);

  const stopBackgroundTracking = useCallback(async () => {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRegistered) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch (e: any) {
      console.log('⚠️ stopBackgroundTracking error:', e?.message ?? e);
    }
    await flushPendingKm(false);
  }, [flushPendingKm]);

  useEffect(() => {
    if (isSharing) {
      const timer = setTimeout(() => startBackgroundTracking(), 300);
      return () => clearTimeout(timer);
    } else {
      stopBackgroundTracking();
    }
  }, [isSharing]);

  return { startBackgroundTracking, stopBackgroundTracking, flushPendingKm };
}