import { useEffect, useRef, useCallback } from 'react';
import * as Location      from 'expo-location';
import * as TaskManager   from 'expo-task-manager';
import AsyncStorage       from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { API_URL }        from '../constants/mapConfig';
import { evaluateDistanceSegment } from '../scripts/distanceEngine';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

async function getAuthToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('token')) ??
    (await AsyncStorage.getItem('userToken'))
  );
}

// ── In-memory speed tracking (foreground) ────────────────────────────────────
let _speedSamples: number[] = [];
let _speedMax     = 0;

export function feedSpeedSample(speedMs: number | null) {
  if (speedMs == null || speedMs < 0) return;
  const kmh = speedMs * 3.6;
  if (kmh < 1 || kmh > 260) return;
  _speedSamples.push(kmh);
  if (kmh > _speedMax) _speedMax = kmh;
}

export function feedNavDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  speedKmh?: number,
) {
  // Deprecated path: distance is now sourced from the route-matched TripStats
  // pipeline in map.tsx/useTripStats to avoid dual foreground ledgers.
  void lat1; void lon1; void lat2; void lon2; void speedKmh;
}

export function resetSpeedStats() {
  _speedSamples = [];
  _speedMax     = 0;
}

export function getSpeedDebug() {
  return { samples: _speedSamples.length, max: _speedMax, distKm: 0 };
}

// ── Flush foreground stats and return ────────────────────────────────────────
function flushSpeedStatsSync(): { avgSpeed: number; maxSpeed: number; distKm: number } {
  const avg = _speedSamples.length > 0
    ? _speedSamples.reduce((a, b) => a + b, 0) / _speedSamples.length
    : 0;
  const result = {
    avgSpeed: Math.round(avg       * 10) / 10,
    maxSpeed: Math.round(_speedMax * 10) / 10,
    distKm:   0,
  };
  _speedSamples = [];
  _speedMax     = 0;
  return result;
}

// ── AsyncStorage keys ─────────────────────────────────────────────────────────
const BG_SPEED_SAMPLES_KEY      = 'nav_speed_samples';
const BG_SPEED_MAX_KEY          = 'nav_speed_max';
export const BG_PENDING_KM_KEY  = 'bg_pending_km';
const BG_LAST_LOC_KEY           = 'bg_last_location';
const BG_ROUTE_POINTS_KEY       = 'bg_route_points';
// Flag: 'true' when live-sharing is active — read by the background task
const BG_IS_SHARING_KEY         = 'bg_is_sharing';
// Flag: 'true' when foreground navigation is active — suppresses BG auto-flush
const BG_IS_NAVIGATING_KEY      = 'bg_is_navigating';
// Threshold (km) at which background stats are auto-saved as a passive trip
const BG_AUTO_FLUSH_KM          = 5;
const BG_LAST_FIX_MAX_GAP_SEC   = 90;
const BG_MAX_PLAUSIBLE_KMH      = 220;
const BG_ROUTE_MAX_POINTS       = 500;

// ── Navigation flag helpers (called from map.tsx) ─────────────────────────────
export async function setNavigatingFlag(active: boolean): Promise<void> {
  await AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, active ? 'true' : 'false');
}

export async function recordDrivingTracePoint(
  latitude: number,
  longitude: number,
  opts?: { addDistanceKm?: number; speedKmh?: number },
): Promise<void> {
  try {
    const routeRaw = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
    const routePts = routeRaw ? JSON.parse(routeRaw) : [];
    const seeded = routePts.length === 0
      ? [{ latitude, longitude }]
      : routePts;
    const nextRoute = [...seeded, { latitude, longitude }].slice(-BG_ROUTE_MAX_POINTS);

    const writes: Promise<any>[] = [
      AsyncStorage.setItem(BG_ROUTE_POINTS_KEY, JSON.stringify(nextRoute)),
    ];

    if (opts?.addDistanceKm && opts.addDistanceKm > 0) {
      const pending = parseFloat(await AsyncStorage.getItem(BG_PENDING_KM_KEY) ?? '0');
      writes.push(AsyncStorage.setItem(BG_PENDING_KM_KEY, String(pending + opts.addDistanceKm)));
    }

    if (opts?.speedKmh != null && Number.isFinite(opts.speedKmh) && opts.speedKmh >= 1 && opts.speedKmh <= 260) {
      const samplesRaw = await AsyncStorage.getItem(BG_SPEED_SAMPLES_KEY);
      const samples: number[] = samplesRaw ? JSON.parse(samplesRaw) : [];
      const maxRaw = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
      const curMax = parseFloat(maxRaw ?? '0');
      const nextMax = Math.max(curMax, opts.speedKmh);
      samples.push(opts.speedKmh);
      writes.push(
        AsyncStorage.setItem(BG_SPEED_SAMPLES_KEY, JSON.stringify(samples)),
        AsyncStorage.setItem(BG_SPEED_MAX_KEY, String(nextMax)),
      );
    }

    await Promise.all(writes);
  } catch {}
}

// ── BG task ───────────────────────────────────────────────────────────────────
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const location = locations[locations.length - 1];
  if (!location) return;

  try {
    const token = await getAuthToken();
    if (!token) return;

    const { latitude, longitude, speed, accuracy } = location.coords;

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
    if (speed != null && speed * 3.6 >= 1 && speed * 3.6 <= 260) {
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
    const nowMs = Date.now();
    const lastRaw = await AsyncStorage.getItem(BG_LAST_LOC_KEY);
    if (lastRaw) {
      const last = JSON.parse(lastRaw);
      const lastLat = Number(last?.latitude);
      const lastLng = Number(last?.longitude);
      const lastTs  = Number(last?.time);
      const lastAcc = Number(last?.accuracy);
      const hasLastFix = Number.isFinite(lastLat) && Number.isFinite(lastLng) && Number.isFinite(lastTs);
      const dtSec = hasLastFix ? Math.max(0, (nowMs - lastTs) / 1000) : 0;
      // Skip if GPS says we're below 2 km/h (stationary jitter).
      // Allow up to 2 km per BG update to support highway driving at lower GPS frequencies.
      const speedKmh = (speed != null && speed >= 0) ? speed * 3.6 : null;
      const isAccurateFix = (accuracy == null || accuracy <= 40) && (!Number.isFinite(lastAcc) || lastAcc <= 40);
      const segment = hasLastFix
        ? evaluateDistanceSegment(
          {
            latitude: lastLat,
            longitude: lastLng,
            timestampMs: lastTs,
            speedKmh,
            accuracyM: Number.isFinite(lastAcc) ? lastAcc : null,
          },
          {
            latitude,
            longitude,
            timestampMs: nowMs,
            speedKmh,
            accuracyM: accuracy ?? null,
          },
          {
            minSegmentKm: 0.010,
            maxSegmentKm: 2.0,
            maxFixGapSec: BG_LAST_FIX_MAX_GAP_SEC,
            maxPlausibleKmh: BG_MAX_PLAUSIBLE_KMH,
            minSpeedKmh: 2,
            maxAccuracyM: 40,
          },
        )
        : { accepted: false, distanceKm: 0 };
      // When speed is unavailable in background updates, accumulated distance can
      // drift heavily on some devices. Require a valid speed fix to count km.
      if (
        hasLastFix &&
        dtSec > 0 &&
        speedKmh !== null &&
        speedKmh >= 2 &&
        isAccurateFix &&
        segment.accepted
      ) {
        const pending = parseFloat(await AsyncStorage.getItem(BG_PENDING_KM_KEY) ?? '0');
        const newPending = pending + segment.distanceKm;
        const routeRaw = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
        const routePts = routeRaw ? JSON.parse(routeRaw) : [];
        const seedPts = routePts.length === 0
          ? [{ latitude: lastLat, longitude: lastLng }]
          : routePts;
        const nextRoute = [
          ...seedPts,
          { latitude, longitude },
        ].slice(-BG_ROUTE_MAX_POINTS);

        await Promise.all([
          AsyncStorage.setItem(BG_PENDING_KM_KEY, String(newPending)),
          AsyncStorage.setItem(BG_ROUTE_POINTS_KEY, JSON.stringify(nextRoute)),
        ]);

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
              routePoints: nextRoute,
            }),
          }).catch(() => {});

          // Reset accumulators after save
          await Promise.all([
            AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
            AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
            AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
            AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
          ]);
        }
      }
    }
    await AsyncStorage.setItem(BG_LAST_LOC_KEY, JSON.stringify({
      latitude,
      longitude,
      time: nowMs,
      accuracy: accuracy ?? null,
    }));
  } catch (e) {
    console.log('BG task error:', e);
  }
});

// ── Hook ──────────────────────────────────────────────────────────────────────
// bgEnabled: comes from settings.backgroundTracking — starts the task independently
//            of live sharing so that stats are collected whenever the user drives.
export function useBackgroundTracking(isSharing: boolean, bgEnabled: boolean = true) {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const flushInFlightRef = useRef(false);

  // Keep bg_is_sharing flag in sync so the task knows whether to POST live location
  useEffect(() => {
    AsyncStorage.setItem(BG_IS_SHARING_KEY, isSharing ? 'true' : 'false').catch(() => {});
  }, [isSharing]);

  // ── Flush helpers ─────────────────────────────────────────────────────────
  const flushPendingKm = useCallback(async (
    fromNavigation = false,
    navPayload?: {
      distanceKm?: number;
      maxSpeedKmh?: number;
      avgSpeedKmh?: number;
      durationSec?: number;
      routePoints?: { latitude: number; longitude: number }[];
    },
  ) => {
    if (flushInFlightRef.current) return;
    flushInFlightRef.current = true;
    try {
      const token = await getAuthToken();
      if (!token) return;

      if (fromNavigation) {
        // Collect foreground stats (fg) + background distance (bg) together
        const { avgSpeed, maxSpeed } = flushSpeedStatsSync();

        const bgPendingStr = await AsyncStorage.getItem(BG_PENDING_KM_KEY);
        const bgPending    = parseFloat(bgPendingStr ?? '0');
        const bgRouteRaw   = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
        const bgRoutePoints: { latitude: number; longitude: number }[] = bgRouteRaw ? JSON.parse(bgRouteRaw) : [];
        // Route-matched navigation distance from map.tsx/useTripStats is source of truth.
        // Fallback to BG pending only if a nav payload was not provided.
        const distanceToSave = navPayload?.distanceKm != null ? navPayload.distanceKm : bgPending;
        const maxSpeedToSave = navPayload?.maxSpeedKmh != null ? navPayload.maxSpeedKmh : maxSpeed;
        const avgSpeedToSave = navPayload?.avgSpeedKmh != null ? navPayload.avgSpeedKmh : avgSpeed;
        const routePointsToSave = navPayload?.routePoints && navPayload.routePoints.length > 1
          ? navPayload.routePoints
          : (bgRoutePoints.length > 1 ? bgRoutePoints : undefined);

        // Clear bg accumulators early to prevent duplicate saves when multiple
        // flush triggers fire close together (foreground, focus, app-state).
        await Promise.all([
          AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
          AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
          AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
          AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
          AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false'),
        ]);

        if (distanceToSave < 0.05) return;

        const saveRes = await fetch(`${API_URL}/api/activity/save`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            distance: distanceToSave,
            maxSpeed: maxSpeedToSave,
            avgSpeed: avgSpeedToSave,
            duration: navPayload?.durationSec ?? null,
            routePoints: routePointsToSave,
          }),
        });
        if (!saveRes.ok) {
          console.log('flushPendingKm(nav) save failed:', saveRes.status);
        }

      } else {
        // Passive flush: no navigation was active, save whatever background accumulated
        const bgPendingStr = await AsyncStorage.getItem(BG_PENDING_KM_KEY);
        const bgPending    = parseFloat(bgPendingStr ?? '0');
        const bgRouteRaw   = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
        const bgRoutePoints: { latitude: number; longitude: number }[] = bgRouteRaw ? JSON.parse(bgRouteRaw) : [];
        if (bgPending < 0.1) return;

        // Claim and zero before network I/O to avoid duplicate passive saves.
        await Promise.all([
          AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
          AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
        ]);

        const samplesRaw = await AsyncStorage.getItem(BG_SPEED_SAMPLES_KEY);
        const samples: number[] = samplesRaw ? JSON.parse(samplesRaw) : [];
        const maxRaw    = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
        const maxSpeed  = parseFloat(maxRaw ?? '0');
        const avgSpeed  = samples.length > 0
          ? samples.reduce((a, b) => a + b, 0) / samples.length
          : 0;

        const saveRes = await fetch(`${API_URL}/api/activity/save`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            distance: Math.round(bgPending * 1000) / 1000,
            maxSpeed: Math.round(maxSpeed * 10) / 10,
            avgSpeed: Math.round(avgSpeed * 10) / 10,
            duration: null,
            routePoints: bgRoutePoints.length > 1 ? bgRoutePoints : undefined,
          }),
        });
        if (!saveRes.ok) {
          console.log('flushPendingKm(passive) save failed:', saveRes.status);
        }

        await Promise.all([
          AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
          AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
        ]);
      }
    } catch (e) {
      console.log('flushPendingKm error:', e);
    } finally {
      flushInFlightRef.current = false;
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