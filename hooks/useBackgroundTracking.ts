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
  // Skip increments < 3 m (GPS jitter while stationary) and > 500 m (bad fix).
  // The lower bound prevents phantom km from accumulating when the phone sits still.
  if (d < 0.003 || d >= 0.5) return;
  _navDistKm += d;
}

export function resetSpeedStats() {
  _speedSamples = [];
  _speedMax     = 0;
  _navDistKm    = 0;
}

export function getSpeedDebug() {
  return { samples: _speedSamples.length, max: _speedMax, distKm: _navDistKm };
}

// ── Flush foreground stats and return ────────────────────────────────────────
function flushSpeedStatsSync(): { avgSpeed: number; maxSpeed: number; distKm: number } {
  const avg = _speedSamples.length > 0
    ? _speedSamples.reduce((a, b) => a + b, 0) / _speedSamples.length
    : 0;
  const result = {
    avgSpeed: Math.round(avg       * 10) / 10,
    maxSpeed: Math.round(_speedMax * 10) / 10,
    distKm:   Math.round(_navDistKm * 1000) / 1000,
  };
  _speedSamples = [];
  _speedMax     = 0;
  _navDistKm    = 0;
  return result;
}

// ── AsyncStorage keys ─────────────────────────────────────────────────────────
const BG_SPEED_SAMPLES_KEY      = 'nav_speed_samples';
const BG_SPEED_MAX_KEY          = 'nav_speed_max';
export const BG_PENDING_KM_KEY  = 'bg_pending_km';
const BG_LAST_LOC_KEY           = 'bg_last_location';
// Flag: 'true' when live-sharing is active — read by the background task
const BG_IS_SHARING_KEY         = 'bg_is_sharing';
// Flag: 'true' when foreground navigation is active — suppresses BG auto-flush
const BG_IS_NAVIGATING_KEY      = 'bg_is_navigating';
// Threshold (km) at which background stats are auto-saved as a passive trip
const BG_AUTO_FLUSH_KM          = 5;

// ── Navigation flag helpers (called from map.tsx) ─────────────────────────────
export async function setNavigatingFlag(active: boolean): Promise<void> {
  await AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, active ? 'true' : 'false');
}

// ── BG task ───────────────────────────────────────────────────────────────────
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  const location = data.locations?.[0];
  if (!location) return;

  try {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const { latitude, longitude, speed } = location.coords;

    // ── Send live location only when sharing is active ────────────────────
    const sharingFlag = await AsyncStorage.getItem(BG_IS_SHARING_KEY);
    if (sharingFlag === 'true') {
      await fetch(`${API_URL}/api/live/location`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: latitude, lng: longitude, shareLocation: true }),
      }).catch(() => {});
    }

    // ── Accumulate speed stats ────────────────────────────────────────────
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

    // ── Accumulate distance ───────────────────────────────────────────────
    const lastRaw = await AsyncStorage.getItem(BG_LAST_LOC_KEY);
    if (lastRaw) {
      const last   = JSON.parse(lastRaw);
      const distKm = haversineKm(last.latitude, last.longitude, latitude, longitude);
      if (distKm > 0.01 && distKm < 0.5) {
        const pending = parseFloat(await AsyncStorage.getItem(BG_PENDING_KM_KEY) ?? '0');
        const newPending = pending + distKm;
        await AsyncStorage.setItem(BG_PENDING_KM_KEY, String(newPending));

        // ── Auto-flush as passive trip when threshold is reached ──────────
        // Skip auto-flush while foreground navigation is active — the nav
        // pipeline will flush the correct distance via flushPendingKm(true).
        const navFlag = await AsyncStorage.getItem(BG_IS_NAVIGATING_KEY);
        if (newPending >= BG_AUTO_FLUSH_KM && navFlag !== 'true') {
          const samplesRaw = await AsyncStorage.getItem(BG_SPEED_SAMPLES_KEY);
          const samples: number[] = samplesRaw ? JSON.parse(samplesRaw) : [];
          const maxRaw     = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
          const maxSpeed   = parseFloat(maxRaw ?? '0');
          const avgSpeed   = samples.length > 0
            ? samples.reduce((a, b) => a + b, 0) / samples.length
            : 0;

          await fetch(`${API_URL}/api/activity/save`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              distance: Math.round(newPending * 1000) / 1000,
              maxSpeed: Math.round(maxSpeed * 10) / 10,
              avgSpeed: Math.round(avgSpeed * 10) / 10,
              duration: null,
            }),
          }).catch(() => {});

          // Reset accumulators after save
          await Promise.all([
            AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
            AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
            AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
          ]);
        }
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

// ── Hook ──────────────────────────────────────────────────────────────────────
// bgEnabled: comes from settings.backgroundTracking — starts the task independently
//            of live sharing so that stats are collected whenever the user drives.
export function useBackgroundTracking(isSharing: boolean, bgEnabled: boolean = true) {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Keep bg_is_sharing flag in sync so the task knows whether to POST live location
  useEffect(() => {
    AsyncStorage.setItem(BG_IS_SHARING_KEY, isSharing ? 'true' : 'false').catch(() => {});
  }, [isSharing]);

  // ── Flush helpers ─────────────────────────────────────────────────────────
  const flushPendingKm = useCallback(async (fromNavigation = false) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;

      if (fromNavigation) {
        // Collect foreground stats (fg) + background distance (bg) together
        const { avgSpeed, maxSpeed, distKm } = flushSpeedStatsSync();

        const bgPendingStr = await AsyncStorage.getItem(BG_PENDING_KM_KEY);
        const bgPending    = parseFloat(bgPendingStr ?? '0');
        // Take the larger of fg and bg measurements to avoid double-counting
        const finalDist    = Math.max(distKm, bgPending);

        // Clear bg accumulators and navigation flag
        await AsyncStorage.setItem(BG_PENDING_KM_KEY, '0');
        await Promise.all([
          AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
          AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
          AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false'),
        ]);

        if (finalDist < 0.05) return;

        await fetch(`${API_URL}/api/activity/save`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ distance: finalDist, maxSpeed, avgSpeed, duration: null }),
        });

      } else {
        // Passive flush: no navigation was active, save whatever background accumulated
        const bgPendingStr = await AsyncStorage.getItem(BG_PENDING_KM_KEY);
        const bgPending    = parseFloat(bgPendingStr ?? '0');
        if (bgPending < 0.1) return;

        const samplesRaw = await AsyncStorage.getItem(BG_SPEED_SAMPLES_KEY);
        const samples: number[] = samplesRaw ? JSON.parse(samplesRaw) : [];
        const maxRaw    = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
        const maxSpeed  = parseFloat(maxRaw ?? '0');
        const avgSpeed  = samples.length > 0
          ? samples.reduce((a, b) => a + b, 0) / samples.length
          : 0;

        await fetch(`${API_URL}/api/activity/save`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            distance: Math.round(bgPending * 1000) / 1000,
            maxSpeed: Math.round(maxSpeed * 10) / 10,
            avgSpeed: Math.round(avgSpeed * 10) / 10,
            duration: null,
          }),
        });

        await AsyncStorage.setItem(BG_PENDING_KM_KEY, '0');
        await Promise.all([
          AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
          AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
        ]);
      }
    } catch (e) {
      console.log('flushPendingKm error:', e);
    }
  }, []);

  // ── Task management ───────────────────────────────────────────────────────
  const startBackgroundTracking = useCallback(async () => {
    if (appStateRef.current !== 'active') return;

    // Read setting from app_settings JSON (the SettingsContext storage key)
    const cached   = await AsyncStorage.getItem('app_settings');
    const parsed   = cached ? JSON.parse(cached) : {};
    if (parsed.backgroundTracking === false) return;

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
  }, []);

  // ── Auto-start when bgEnabled is on (independent of isSharing) ───────────
  useEffect(() => {
    if (bgEnabled || isSharing) {
      const timer = setTimeout(() => startBackgroundTracking(), 300);
      return () => clearTimeout(timer);
    } else {
      // Stop task and flush passive stats only when BOTH are off
      stopBackgroundTracking().then(() => flushPendingKm(false));
    }
  }, [isSharing, bgEnabled]);

  // ── Flush passive stats when app returns to foreground ───────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if ((prev === 'background' || prev === 'inactive') && nextState === 'active') {
        // Skip passive flush while foreground navigation is active — the nav end
        // handler calls flushPendingKm(true) which consolidates bg+fg distances
        // without double-saving the same km to the API.
        AsyncStorage.getItem(BG_IS_NAVIGATING_KEY)
          .then(flag => { if (flag !== 'true') flushPendingKm(false); })
          .catch(() => { flushPendingKm(false); });
      }
    });
    return () => sub.remove();
  }, [flushPendingKm]);

  return { startBackgroundTracking, stopBackgroundTracking, flushPendingKm };
}