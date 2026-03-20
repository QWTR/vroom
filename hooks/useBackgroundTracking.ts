import { useEffect, useRef, useCallback } from 'react';
import * as Location      from 'expo-location';
import * as TaskManager   from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage       from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { API_URL }        from '../constants/mapConfig';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';
export const NAV_NOTIFICATION_ID      = 'navigation-live';

// ── Rejestracja taska — POZA komponentem ─────────────────────────────────────
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error) { console.log('BG task error:', error); return; }
  if (!data) return;

  const { locations } = data;
  const location = locations?.[0];
  if (!location) return;

  try {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const { latitude, longitude } = location.coords;

    await fetch(`${API_URL}/api/live/location`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${token}`,
      },
      body: JSON.stringify({ lat: latitude, lng: longitude, shareLocation: true }),
    });

    const lastRaw = await AsyncStorage.getItem('bg_last_location');
    if (lastRaw) {
      const last    = JSON.parse(lastRaw);
      const distKm  = haversineKm(last.latitude, last.longitude, latitude, longitude);

      if (distKm > 0.01) {
        const todayKey = `bg_distance_${new Date().toDateString()}`;
        const existing = parseFloat(await AsyncStorage.getItem(todayKey) ?? '0');
        await AsyncStorage.setItem(todayKey, String(existing + distKm));

        const pending = parseFloat(await AsyncStorage.getItem('bg_pending_km') ?? '0');
        await AsyncStorage.setItem('bg_pending_km', String(pending + distKm));
      }
    }

    await AsyncStorage.setItem('bg_last_location', JSON.stringify({ latitude, longitude }));
  } catch (e) {
    console.log('BG task fetch error:', e);
  }
});

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useBackgroundTracking(isSharing: boolean) {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Śledź AppState
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, []);

  // ── Flush pending km ──────────────────────────────────────────────────
  const flushPendingKm = useCallback(async () => {
    try {
      const pendingStr = await AsyncStorage.getItem('bg_pending_km');
      const pending    = parseFloat(pendingStr ?? '0');
      if (pending < 0.1) return;

      const token = await AsyncStorage.getItem('token');
      if (!token) return;

      await fetch(`${API_URL}/api/live/distance`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ km: pending }),
      });

      await AsyncStorage.setItem('bg_pending_km', '0');
      console.log(`📊 Flushed ${pending.toFixed(2)} km`);
    } catch (e) {
      console.log('flushPendingKm error:', e);
    }
  }, []);

  // ── Start background tracking ─────────────────────────────────────────
  const startBackgroundTracking = useCallback(async () => {
    // ✅ KLUCZOWE: nie startuj gdy apka jest w tle
    if (appStateRef.current !== 'active') {
      console.log('⚠️ Apka w tle — pomijam startLocationUpdatesAsync');
      return;
    }

    const bgEnabled = await AsyncStorage.getItem('setting_background_tracking');
    if (bgEnabled === 'false') return;

    try {
      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== 'granted') return;

      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') return;

      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRegistered) {
        console.log('ℹ️ BG task już działa');
        return;
      }

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

      console.log('✅ Background tracking started');
    } catch (e: any) {
      // Złap błąd cicho — nie crashuj apki
      console.log('⚠️ startBackgroundTracking error:', e?.message ?? e);
    }
  }, []);

  // ── Stop background tracking ──────────────────────────────────────────
  const stopBackgroundTracking = useCallback(async () => {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRegistered) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        console.log('🛑 Background tracking stopped');
      }
    } catch (e: any) {
      console.log('⚠️ stopBackgroundTracking error:', e?.message ?? e);
    }
    await flushPendingKm();
  }, [flushPendingKm]);

  // ── Reaguj na isSharing ───────────────────────────────────────────────
  useEffect(() => {
    if (isSharing) {
      // Małe opóźnienie żeby AppState zdążył się zaktualizować
      const timer = setTimeout(() => {
        startBackgroundTracking();
      }, 300);
      return () => clearTimeout(timer);
    } else {
      stopBackgroundTracking();
    }
  }, [isSharing]);

  return { startBackgroundTracking, stopBackgroundTracking, flushPendingKm };
}