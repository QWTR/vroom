import { useEffect, useRef, useCallback } from 'react';
import * as Location      from 'expo-location';
import * as TaskManager   from 'expo-task-manager';
import AsyncStorage       from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { API_URL }        from '../constants/mapConfig';
import { evaluateDistanceSegment } from '../scripts/distanceEngine';
import { haversineKm } from '../scripts/navigationUtils';
import { syncProfileStatsFromServer } from '../lib/profileStatsSync';
import { hasAcceptedBackgroundLocationDisclosure } from '../lib/backgroundLocationConsent';
import {
  startVroomBgForegroundNotification,
  stopVroomBgForegroundNotification,
} from '../lib/vroomBgForegroundService';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

async function getAuthToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
}

// ── In-memory speed tracking (foreground) ────────────────────────────────────
let _speedSamples: number[] = [];
let _speedMax     = 0;

const MAX_FEED_SPEED_KMH = 200;

/** trusted=true: ten sam gate co trip peak (ruch potwierdzony, cap 200 km/h). */
export function feedSpeedSample(speedMs: number | null, trusted = false) {
  if (!trusted || speedMs == null || speedMs < 0) return;
  const kmh = speedMs * 3.6;
  if (kmh < 1 || kmh > MAX_FEED_SPEED_KMH) return;
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
/** Lokalny snapshot statystyk trasy po każdym pełnym km (Android kill recovery). */
export const EMERGENCY_TRIP_SAVE_KEY = 'vroom_emergency_trip_save';
/** Ile km z bieżącej trasy już trafiło na serwer (checkpointy) — przetrwa kill procesu. */
export const TRIP_CHECKPOINT_SAVED_KM_KEY = 'trip_checkpoint_saved_km';
const BG_PENDING_ACTIVITY_SAVE_KEY = 'bg_pending_activity_save';
const BG_LAST_LOC_KEY           = 'bg_last_location';
const BG_ROUTE_POINTS_KEY       = 'bg_route_points';
// Flag: 'true' when live-sharing is active — read by the background task
export const BG_IS_SHARING_KEY  = 'bg_is_sharing';
/** Preferencja użytkownika (przełącznik na mapie). Domyślnie brak klucza = ON. */
export const LIVE_SHARING_USER_PREF_KEY = 'vroom_live_sharing_user_pref';
/** Mirror premium for BACKGROUND_LOCATION_TASK (React state unavailable in headless task). */
export const USER_IS_PREMIUM_KEY = 'USER_IS_PREMIUM';
/** Mirror of settings.backgroundTracking — read by BACKGROUND_LOCATION_TASK (defense in depth). */
export const BG_TRACKING_SETTING_KEY = 'bg_tracking_setting_enabled';
/** Mirror of app foreground state — prevents BG/FG duplicate km accounting. */
export const BG_APP_ACTIVE_KEY = 'bg_app_state_active';
/** Mirror of foreground stationary-parked (driving idle) — lowers BG GPS cadence. */
export const BG_GPS_STATIONARY_KEY = 'bg_gps_stationary';
const BG_APP_ACTIVE_STALE_MS = 90_000;
const BG_APP_ACTIVE_HEARTBEAT_MS = 30_000;
// Flag: 'true' when foreground navigation is active — suppresses BG auto-flush
export const BG_IS_NAVIGATING_KEY      = 'bg_is_navigating';
// Flag: 'true' when driving mode is active — keep one continuous trip session
export const BG_IS_DRIVING_KEY         = 'bg_is_driving';
const BG_LAST_FIX_MAX_GAP_SEC   = 420;
const BG_MAX_PLAUSIBLE_KMH      = 200;
const BG_MIN_SEGMENT_KM         = 0.003;
const BG_MAX_SEGMENT_KM         = 12;
const BG_ROUTE_MAX_POINTS       = 1500;
const BG_MIN_SPEED_KMH          = 2;
const BG_MIN_REPORTED_SPEED_KMH = 3;
const BG_MAX_ACCURACY_M         = 65;
const BG_MIN_MOVE_ABS_M         = 10;
const BG_TRACE_MIN_WRITE_MS     = 1500;
const BG_TRACE_MIN_MOVE_M       = 8;
const BG_TRACE_MIN_FLUSH_KM     = 0.03;
const BG_TRACE_MAX_JUMP_M       = 220;
const BG_PENDING_KM_HARD_CAP    = 1200;
const BG_TRIP_CHECKPOINT_KM     = 0.3;
let _bgCheckpointInFlight       = false;

export async function stopBackgroundLocationTaskIfRunning(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch { /* ignore */ }
}

export async function mirrorBackgroundTrackingSetting(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(BG_TRACKING_SETTING_KEY, enabled ? 'true' : 'false');
  } catch { /* ignore */ }
}

function encodeAppActiveSnapshot(active: boolean): string {
  return JSON.stringify({ active, at: Date.now() });
}

function shouldPersistAppActiveSnapshot(
  lastPersistedRaw: string | null,
  nextActive: boolean,
  nowMs: number,
): boolean {
  if (!lastPersistedRaw) return true;
  try {
    const parsed = JSON.parse(lastPersistedRaw);
    const prevActive = parsed?.active === true;
    const prevAt = Number(parsed?.at);
    if (prevActive !== nextActive) return true;
    if (!Number.isFinite(prevAt) || prevAt <= 0) return true;
    return nowMs - prevAt >= BG_APP_ACTIVE_HEARTBEAT_MS;
  } catch {
    return true;
  }
}

function isAppLikelyActive(raw: string | null, nowMs: number): boolean {
  if (!raw) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  try {
    const parsed = JSON.parse(raw);
    const active = parsed?.active === true;
    const at = Number(parsed?.at);
    if (!active) return false;
    if (!Number.isFinite(at) || at <= 0) return true;
    return nowMs - at <= BG_APP_ACTIVE_STALE_MS;
  } catch {
    return false;
  }
}

let _tracePendingKm = 0;
let _traceLastWriteAt = 0;
let _traceLastPoint: { latitude: number; longitude: number } | null = null;
let _traceWriteInFlight = false;
let _traceLastPendingFlushAt = 0;
const TRACE_PENDING_FLUSH_INTERVAL_MS = 45_000;

/** Zapisz km z pamięci procesu do AsyncStorage (crash / długa jazda). */
export async function flushTracePendingKmToStorage(): Promise<void> {
  if (_tracePendingKm <= 0) return;
  try {
    const pending = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
    await AsyncStorage.setItem(BG_PENDING_KM_KEY, String(pending + _tracePendingKm));
    _tracePendingKm = 0;
    _traceLastPendingFlushAt = Date.now();
  } catch { /* ignore */ }
}

export type EmergencyTripSavePayload = {
  distanceKm: number;
  trackedPoints: { latitude: number; longitude: number }[];
  speedSamples: number[];
  startTimeMs: number | null;
  estimatedSec: number;
  floorKm: number;
  savedAt: number;
};

export async function writeEmergencyTripSave(payload: EmergencyTripSavePayload): Promise<void> {
  try {
    await AsyncStorage.setItem(EMERGENCY_TRIP_SAVE_KEY, JSON.stringify(payload));
  } catch { /* ignore */ }
}

export async function readEmergencyTripSave(): Promise<EmergencyTripSavePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(EMERGENCY_TRIP_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EmergencyTripSavePayload;
    if (!parsed || !Number.isFinite(parsed.distanceKm)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearEmergencyTripSave(): Promise<void> {
  try {
    await AsyncStorage.removeItem(EMERGENCY_TRIP_SAVE_KEY);
  } catch { /* ignore */ }
}

export async function persistTripCheckpointSavedKm(km: number): Promise<void> {
  try {
    const n = Number(km);
    if (!Number.isFinite(n) || n <= 0) {
      await AsyncStorage.removeItem(TRIP_CHECKPOINT_SAVED_KM_KEY);
      return;
    }
    await AsyncStorage.setItem(TRIP_CHECKPOINT_SAVED_KM_KEY, String(n));
  } catch { /* ignore */ }
}

export async function loadTripCheckpointSavedKm(): Promise<number> {
  try {
    return safePendingKm(await AsyncStorage.getItem(TRIP_CHECKPOINT_SAVED_KM_KEY));
  } catch {
    return 0;
  }
}

export async function clearTripCheckpointSavedKm(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRIP_CHECKPOINT_SAVED_KM_KEY);
  } catch { /* ignore */ }
}

export async function saveIncrementalTripKm(payload: {
  distanceKm: number;
  maxSpeedKmh?: number;
  avgSpeedKmh?: number;
  source?: 'navigation' | 'driving' | 'trip-checkpoint';
}): Promise<boolean> {
  const dist = Number(payload.distanceKm);
  if (!Number.isFinite(dist) || dist < 0.05) return false;
  const token = await getAuthToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/api/activity/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        distance: Math.round(dist * 1000) / 1000,
        maxSpeed: Math.round((payload.maxSpeedKmh ?? 0) * 10) / 10,
        avgSpeed: Math.round((payload.avgSpeedKmh ?? 0) * 10) / 10,
        duration: null,
        source: payload.source ?? 'trip-checkpoint',
      }),
    });
    if (!res.ok) return false;
    void syncProfileStatsFromServer();
    return true;
  } catch {
    return false;
  }
}

async function maybeFlushBgTripCheckpoint(pendingKm: number): Promise<number> {
  if (_bgCheckpointInFlight || pendingKm < BG_TRIP_CHECKPOINT_KM) return pendingKm;

  const chunkKm = Math.floor(pendingKm / BG_TRIP_CHECKPOINT_KM) * BG_TRIP_CHECKPOINT_KM;
  if (chunkKm < BG_TRIP_CHECKPOINT_KM) return pendingKm;

  _bgCheckpointInFlight = true;
  try {
    const maxRaw = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
    const maxSpeed = parseFloat(maxRaw ?? '0');
    const ok = await saveIncrementalTripKm({
      distanceKm: chunkKm,
      maxSpeedKmh: Number.isFinite(maxSpeed) ? maxSpeed : 0,
      source: 'trip-checkpoint',
    });
    if (ok) {
      const savedTotal = await loadTripCheckpointSavedKm();
      await persistTripCheckpointSavedKm(savedTotal + chunkKm);
      return pendingKm - chunkKm;
    }
  } finally {
    _bgCheckpointInFlight = false;
  }
  return pendingKm;
}

function safePendingKm(raw: string | null): number {
  const n = parseFloat(raw ?? '0');
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Align with server ROUTE_POINTS_MAX before POST /api/activity/save. */
export function trimRoutePointsForActivitySave(
  points?: { latitude: number; longitude: number }[],
): { latitude: number; longitude: number }[] | undefined {
  if (!points || points.length <= 1) return undefined;
  return compactBgRoutePoints(points).slice(0, BG_ROUTE_MAX_POINTS);
}

function compactBgRoutePoints(
  points: { latitude: number; longitude: number }[],
): { latitude: number; longitude: number }[] {
  if (points.length <= BG_ROUTE_MAX_POINTS) return points;
  let compacted = points;
  while (compacted.length > BG_ROUTE_MAX_POINTS) {
    const next: { latitude: number; longitude: number }[] = [];
    for (let i = 0; i < compacted.length; i += 2) {
      next.push(compacted[i]);
    }
    const last = compacted[compacted.length - 1];
    const tail = next[next.length - 1];
    if (!tail || tail.latitude !== last.latitude || tail.longitude !== last.longitude) {
      next.push(last);
    }
    compacted = next;
  }
  return compacted;
}

// ── Navigation flag helpers (called from map.tsx) ─────────────────────────────
export async function setNavigatingFlag(active: boolean): Promise<void> {
  await AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, active ? 'true' : 'false');
}

export async function setDrivingFlag(active: boolean): Promise<void> {
  await AsyncStorage.setItem(BG_IS_DRIVING_KEY, active ? 'true' : 'false');
}

export async function recordDrivingTracePoint(
  latitude: number,
  longitude: number,
  opts?: { addDistanceKm?: number; speedKmh?: number },
): Promise<void> {
  try {
    if (opts?.addDistanceKm && opts.addDistanceKm > 0) {
      _tracePendingKm += opts.addDistanceKm;
      const nowFlush = Date.now();
      if (nowFlush - _traceLastPendingFlushAt >= TRACE_PENDING_FLUSH_INTERVAL_MS) {
        await flushTracePendingKmToStorage();
      }
    }
    const now = Date.now();
    const movedM = _traceLastPoint
      ? haversineKm(_traceLastPoint.latitude, _traceLastPoint.longitude, latitude, longitude) * 1000
      : Infinity;
    const canWriteByTime = now - _traceLastWriteAt >= BG_TRACE_MIN_WRITE_MS;
    const canWriteByMove = movedM >= BG_TRACE_MIN_MOVE_M;
    const canWriteByKm = _tracePendingKm >= BG_TRACE_MIN_FLUSH_KM;
    if (_traceLastPoint && Number.isFinite(movedM) && movedM > BG_TRACE_MAX_JUMP_M) {
      const speedKmh = Math.max(0, opts?.speedKmh ?? 0);
      if (speedKmh < 40 && !canWriteByKm) {
        // Nie gub km z pamięci — zapisz oczekujące do AsyncStorage przed resetem punktu.
        if (_tracePendingKm > 0) {
          try {
            const pending = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
            await AsyncStorage.setItem(BG_PENDING_KM_KEY, String(pending + _tracePendingKm));
            _tracePendingKm = 0;
          } catch { /* ignore */ }
        }
        _traceLastPoint = { latitude, longitude };
        _traceLastWriteAt = now;
        return;
      }
    }
    if ((!canWriteByTime && !canWriteByMove && !canWriteByKm) || _traceWriteInFlight) {
      // Odłóż zebrane km nawet gdy nie dopisujemy punktu trasy w tej klatce.
      if (_tracePendingKm > 0 && canWriteByKm) {
        try {
          const pending = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
          await AsyncStorage.setItem(BG_PENDING_KM_KEY, String(pending + _tracePendingKm));
          _tracePendingKm = 0;
        } catch { /* ignore */ }
      }
      return;
    }
    _traceWriteInFlight = true;

    const routeRaw = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
    const routePts = routeRaw ? JSON.parse(routeRaw) : [];
    const seeded = routePts.length === 0
      ? [{ latitude, longitude }]
      : routePts;
    const nextRoute = compactBgRoutePoints([...seeded, { latitude, longitude }]);

    const writes: Promise<any>[] = [
      AsyncStorage.setItem(BG_ROUTE_POINTS_KEY, JSON.stringify(nextRoute)),
    ];

    if (_tracePendingKm > 0) {
      const pending = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
      const nextPending = pending + _tracePendingKm;
      if (nextPending > BG_PENDING_KM_HARD_CAP) {
        writes.push(AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'));
      } else {
        writes.push(AsyncStorage.setItem(BG_PENDING_KM_KEY, String(nextPending)));
      }
    }

    if (opts?.speedKmh != null && Number.isFinite(opts.speedKmh) && opts.speedKmh >= 1 && opts.speedKmh <= MAX_FEED_SPEED_KMH) {
      const samplesRaw = await AsyncStorage.getItem(BG_SPEED_SAMPLES_KEY);
      const samples: number[] = samplesRaw ? JSON.parse(samplesRaw) : [];
      const maxRaw = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
      const curMax = parseFloat(maxRaw ?? '0');
      const nextMax = Math.max(curMax, opts.speedKmh);
      samples.push(opts.speedKmh);
      const trimmedSamples = samples.slice(-400);
      writes.push(
        AsyncStorage.setItem(BG_SPEED_SAMPLES_KEY, JSON.stringify(trimmedSamples)),
        AsyncStorage.setItem(BG_SPEED_MAX_KEY, String(nextMax)),
      );
    }

    await Promise.all(writes);
    _tracePendingKm = 0;
    _traceLastWriteAt = now;
    _traceLastPoint = { latitude, longitude };
  } catch {
  } finally {
    _traceWriteInFlight = false;
  }
}

// ── BG task ───────────────────────────────────────────────────────────────────
// Hard rule: gdy użytkownik wyłączył „Śledzenie w tle" w ustawieniach, BG task
// MUSI być nieaktywny niezależnie od jazdy/nawigacji/share. Wcześniej navFlag/
// driveFlag potrafiły obejść przełącznik (BG GPS pracował podczas jazdy mimo
// wyłączonego BG w ustawieniach) — to złamanie obietnicy UX i baterii.
async function isBgTripTaskAllowed(): Promise<boolean> {
  const bgSetting = await AsyncStorage.getItem(BG_TRACKING_SETTING_KEY);
  return bgSetting === 'true';
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;

  if (!(await isBgTripTaskAllowed())) return;

  const premiumStatus = await AsyncStorage.getItem(USER_IS_PREMIUM_KEY);
  if (premiumStatus !== 'true') return;

  const locations = Array.isArray(data.locations) ? data.locations : [];
  const location = locations[locations.length - 1];
  if (!location) return;

  try {
    const token = await getAuthToken();
    if (!token) return;

    const { latitude, longitude, speed, accuracy } = location.coords;

    // ── Send live location only when sharing is active (Ghost = zero POST) ─
    const sharingFlag = await AsyncStorage.getItem(BG_IS_SHARING_KEY);
    if (sharingFlag !== 'true') {
      // Ghost Mode / live off — skip live location entirely.
    } else {
      await fetch(`${API_URL}/api/live/location`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: latitude, lng: longitude, shareLocation: true }),
      }).catch(() => {});
    }

    // ── Accumulate speed stats ────────────────────────────────────────────
    if (speed != null && speed * 3.6 >= 1 && speed * 3.6 <= MAX_FEED_SPEED_KMH) {
      const kmh        = speed * 3.6;
      const samplesRaw = await AsyncStorage.getItem(BG_SPEED_SAMPLES_KEY);
      const samples    = samplesRaw ? JSON.parse(samplesRaw) : [];
      const maxRaw     = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
      const curMax     = parseFloat(maxRaw ?? '0');
      samples.push(kmh);
      const trimmed = samples.slice(-400);
      await Promise.all([
        AsyncStorage.setItem(BG_SPEED_SAMPLES_KEY, JSON.stringify(trimmed)),
        AsyncStorage.setItem(BG_SPEED_MAX_KEY, String(kmh > curMax ? kmh : curMax)),
      ]);
    }

    // ── Accumulate distance ───────────────────────────────────────────────
    const nowMs = Date.now();
    const appActiveRaw = await AsyncStorage.getItem(BG_APP_ACTIVE_KEY);
    // REMOVED checking appActiveRaw to accumulate distance even when app is active!
    // The previous logic dropped foreground background task events for distance because they are
    // supposed to be handled by TripStats, but if that isn't working we want this as a fallback.
    const shouldAccumulateDistance = true;
    const lastRaw = await AsyncStorage.getItem(BG_LAST_LOC_KEY);
    if (lastRaw && shouldAccumulateDistance) {
      const last = JSON.parse(lastRaw);
      const lastLat = Number(last?.latitude);
      const lastLng = Number(last?.longitude);
      const lastTs  = Number(last?.time);
      const lastAcc = Number(last?.accuracy);
      const hasLastFix = Number.isFinite(lastLat) && Number.isFinite(lastLng) && Number.isFinite(lastTs);
      const dtSec = hasLastFix ? Math.max(0, (nowMs - lastTs) / 1000) : 0;
      // Skip if GPS says we're below 2 km/h (stationary jitter).
      // Allow up to 2 km per BG update to support highway driving at lower GPS frequencies.
      const speedKmh = (speed != null && speed > 0) ? speed * 3.6 : null;
      const hasReliableSpeed = Number.isFinite(speedKmh) && speedKmh >= BG_MIN_REPORTED_SPEED_KMH;
      const isAccurateFix =
        (accuracy == null || accuracy <= BG_MAX_ACCURACY_M)
        && (!Number.isFinite(lastAcc) || lastAcc <= BG_MAX_ACCURACY_M);
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
            minSegmentKm: BG_MIN_SEGMENT_KM,
            maxSegmentKm: BG_MAX_SEGMENT_KM,
            maxFixGapSec: BG_LAST_FIX_MAX_GAP_SEC,
            maxPlausibleKmh: BG_MAX_PLAUSIBLE_KMH,
            minSpeedKmh: hasReliableSpeed ? BG_MIN_REPORTED_SPEED_KMH : undefined,
            maxAccuracyM: BG_MAX_ACCURACY_M,
          },
        )
        : { accepted: false, distanceKm: 0 };
      const segmentMeters = segment.distanceKm * 1000;
      const highwayRelax = hasReliableSpeed && speedKmh! >= 15;
      const accGateM = Math.max(
        highwayRelax ? BG_MIN_MOVE_ABS_M * 0.65 : BG_MIN_MOVE_ABS_M,
        (Number.isFinite(accuracy) ? Number(accuracy) : 0) * 0.9
          + (Number.isFinite(lastAcc) ? Number(lastAcc) : 0) * 0.9,
      );
      const speedGateOk =
        hasReliableSpeed
          ? speedKmh! >= BG_MIN_SPEED_KMH
          : segment.accepted && segmentMeters >= accGateM * 1.15;
      const lowConfidenceShortJump =
        !hasReliableSpeed &&
        dtSec <= 15 &&
        segmentMeters > Math.max(45, accGateM * 1.6);
      if (
        hasLastFix &&
        dtSec > 0 &&
        speedGateOk &&
        isAccurateFix &&
        segment.accepted &&
        !lowConfidenceShortJump &&
        segmentMeters >= (highwayRelax ? accGateM * 0.85 : accGateM)
      ) {
        const pending = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
        const newPending = pending + segment.distanceKm;
        if (!Number.isFinite(newPending) || newPending > BG_PENDING_KM_HARD_CAP) {
          await Promise.all([
            AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
            AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
          ]);
          await AsyncStorage.setItem(BG_LAST_LOC_KEY, JSON.stringify({
            latitude,
            longitude,
            time: nowMs,
            accuracy: accuracy ?? null,
          }));
          return;
        }
        const routeRaw = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
        const routePts = routeRaw ? JSON.parse(routeRaw) : [];
        const seedPts = routePts.length === 0
          ? [{ latitude: lastLat, longitude: lastLng }]
          : routePts;
        const nextRoute = compactBgRoutePoints([
          ...seedPts,
          { latitude, longitude },
        ]);

        const checkpointedPending = await maybeFlushBgTripCheckpoint(newPending);
        const pendingToStore = checkpointedPending;

        await Promise.all([
          AsyncStorage.setItem(BG_PENDING_KM_KEY, String(pendingToStore)),
          AsyncStorage.setItem(BG_ROUTE_POINTS_KEY, JSON.stringify(nextRoute)),
        ]);

        // No auto-flush in background task: saving every 5 km split one real ride
        // into many short activities. We persist counters and flush on lifecycle hooks.
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
export function useBackgroundTracking(
  isSharing: boolean,
  bgEnabled: boolean = true,
  forceEnabled: boolean = false,
  /** Gdy false — nie nadpisuj BG_IS_SHARING do czasu hydracji z API (unikaj false przy starcie). */
  sharingHydrated: boolean = true,
  /** GPS w tle (nawigacja / jazda po zminimalizowaniu) — tylko Premium. */
  isPremium: boolean = false,
) {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const flushInFlightRef = useRef(false);
  const startInFlightRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const lastAppActiveSnapshotRef = useRef<string | null>(null);
  const telemetryRef = useRef({
    flushSuccess: 0,
    flushFail: 0,
    pendingRetrySaved: 0,
    navMergedFlushes: 0,
    navMergedBgKm: 0,
    bgStarts: 0,
    bgStops: 0,
    forceStarts: 0,
  });
  const bgEnabledRef = useRef(bgEnabled);
  const forceEnabledRef = useRef(forceEnabled);
  const lastBgCadenceRef = useRef<'high' | 'low' | null>(null);

  useEffect(() => {
    forceEnabledRef.current = forceEnabled;
  }, [forceEnabled]);

  useEffect(() => {
    AsyncStorage.setItem(USER_IS_PREMIUM_KEY, isPremium ? 'true' : 'false').catch(() => {});
  }, [isPremium]);

  // Mirror user setting + sharing flag for the BG task handler
  useEffect(() => {
    bgEnabledRef.current = bgEnabled;
    AsyncStorage.setItem(BG_TRACKING_SETTING_KEY, bgEnabled ? 'true' : 'false').catch(() => {});
  }, [bgEnabled]);

  useEffect(() => {
    if (!sharingHydrated) return;
    // BG task: tylko gdy user ma live ON i włączone śledzenie w tle.
    AsyncStorage.setItem(BG_IS_SHARING_KEY, isSharing && bgEnabled ? 'true' : 'false').catch(() => {});
    // LIVE na mapie jest domyślnie ON; nie utrwalaj przejściowego OFF z lokalnego stanu.
    if (isSharing) {
      AsyncStorage.setItem(LIVE_SHARING_USER_PREF_KEY, 'true').catch(() => {});
    }
  }, [isSharing, sharingHydrated, bgEnabled]);

  useEffect(() => {
    hasAcceptedBackgroundLocationDisclosure()
      .then(async accepted => {
        if (accepted) return;
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      })
      .catch(() => {});
  }, []);

  // ── Flush helpers ─────────────────────────────────────────────────────────
  const flushPendingActivitySave = useCallback(async (token: string): Promise<boolean> => {
    try {
      const raw = await AsyncStorage.getItem(BG_PENDING_ACTIVITY_SAVE_KEY);
      if (!raw) return true;
      const payload = JSON.parse(raw);
      const routePoints = trimRoutePointsForActivitySave(payload.routePoints);
      const body = {
        ...payload,
        routePoints,
        routePointsCount: routePoints?.length ?? payload.routePointsCount ?? 0,
      };
      const res = await fetch(`${API_URL}/api/activity/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let details = '';
        try { details = await res.text(); } catch {}
        console.log('flushPendingActivitySave failed:', res.status, details?.slice(0, 200));
        telemetryRef.current.flushFail += 1;
        return false;
      }
      await AsyncStorage.removeItem(BG_PENDING_ACTIVITY_SAVE_KEY);
      telemetryRef.current.flushSuccess += 1;
      return true;
    } catch (e) {
      console.log('flushPendingActivitySave error:', e);
      return false;
    }
  }, []);

  const flushPendingKm = useCallback(async (
    fromNavigation = false,
    navPayload?: {
      distanceKm?: number;
      maxSpeedKmh?: number;
      avgSpeedKmh?: number;
      durationSec?: number;
      routePoints?: { latitude: number; longitude: number }[];
    },
    sourceTag: 'navigation' | 'driving' = 'navigation',
  ) => {
    if (flushInFlightRef.current) return;
    flushInFlightRef.current = true;
    try {
      const token = await getAuthToken();
      if (!token) return;
      await flushPendingActivitySave(token);

      if (fromNavigation) {
        // Collect foreground stats (fg) + background distance (bg) together
        const { avgSpeed, maxSpeed } = flushSpeedStatsSync();

        const bgPending    = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
        const bgRouteRaw   = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
        const bgRoutePoints: { latitude: number; longitude: number }[] = bgRouteRaw ? JSON.parse(bgRouteRaw) : [];
        // Merge foreground route-matched distance with any pending passive/background distance.
        // This prevents km loss when switching driving -> navigation.
        const navDistance = Number.isFinite(navPayload?.distanceKm) ? Number(navPayload?.distanceKm) : 0;
        const distanceToSaveRaw = navDistance + bgPending;
        telemetryRef.current.navMergedFlushes += 1;
        telemetryRef.current.navMergedBgKm += bgPending;
        const distanceToSave = Number.isFinite(distanceToSaveRaw) && distanceToSaveRaw > 0 && distanceToSaveRaw <= BG_PENDING_KM_HARD_CAP
          ? distanceToSaveRaw
          : 0;
        const maxSpeedToSave = Math.max(navPayload?.maxSpeedKmh ?? 0, 0);
        const avgSpeedToSave = navPayload?.avgSpeedKmh != null && navPayload.avgSpeedKmh > 0
          ? navPayload.avgSpeedKmh
          : avgSpeed;
        const routePointsRaw = navPayload?.routePoints && navPayload.routePoints.length > 1
          ? navPayload.routePoints
          : (bgRoutePoints.length > 1 ? bgRoutePoints : undefined);
        const routePointsToSave = trimRoutePointsForActivitySave(routePointsRaw);

    if (distanceToSave < 0.05) return;

        const payload = {
          distance: distanceToSave,
          maxSpeed: maxSpeedToSave,
          avgSpeed: avgSpeedToSave,
          duration: navPayload?.durationSec ?? null,
          routePoints: routePointsToSave,
          source: sourceTag,
          routePointsCount: routePointsToSave?.length ?? 0,
        };
        if (__DEV__) {
          console.log('[DRIVESTATS][flush]', {
            source: sourceTag,
            navDistanceKm: navDistance,
            bgPendingKm: bgPending,
            mergedDistanceKm: distanceToSave,
            maxSpeedKmh: maxSpeedToSave,
            avgSpeedKmh: avgSpeedToSave,
            routePointsCount: routePointsToSave?.length ?? 0,
          });
        }
        const saveRes = await fetch(`${API_URL}/api/activity/save`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!saveRes.ok) {
          let details = '';
          let errJson: any = {};
          try {
            details = await saveRes.text();
            errJson = JSON.parse(details);
          } catch { /* ignore */ }
          console.log('flushPendingKm(nav) save failed:', saveRes.status, details?.slice(0, 200));
          telemetryRef.current.flushFail += 1;

          const retryWithoutRoute =
            saveRes.status === 400
            && typeof errJson?.error === 'string'
            && errJson.error.includes('przebiegu trasy');
          if (retryWithoutRoute) {
            const retryRes = await fetch(`${API_URL}/api/activity/save`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ ...payload, routePoints: undefined, routePointsCount: 0 }),
            });
            if (retryRes.ok) {
              telemetryRef.current.flushSuccess += 1;
              await Promise.all([
                AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
                AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
                AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
                AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
                AsyncStorage.removeItem(BG_PENDING_ACTIVITY_SAVE_KEY),
                AsyncStorage.removeItem(EMERGENCY_TRIP_SAVE_KEY),
                AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false'),
              ]);
              void syncProfileStatsFromServer();
              return;
            }
          }

          await Promise.all([
            AsyncStorage.setItem(BG_PENDING_ACTIVITY_SAVE_KEY, JSON.stringify(payload)),
            AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false'),
          ]);
          telemetryRef.current.pendingRetrySaved += 1;
          return;
        }
        telemetryRef.current.flushSuccess += 1;
        await Promise.all([
          AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
          AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
          AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
          AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
          AsyncStorage.removeItem(BG_PENDING_ACTIVITY_SAVE_KEY),
          AsyncStorage.removeItem(EMERGENCY_TRIP_SAVE_KEY),
          AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false'),
        ]);
        void syncProfileStatsFromServer();

      } else {
        // Passive flush: no navigation was active, save whatever background accumulated
        const bgPending    = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
        const bgRouteRaw   = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
        const bgRoutePoints: { latitude: number; longitude: number }[] = bgRouteRaw ? JSON.parse(bgRouteRaw) : [];
        if (bgPending > BG_PENDING_KM_HARD_CAP) {
          await Promise.all([
            AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
            AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
            AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
            AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
          ]);
          return;
        }
        if (bgPending < 0.05) return;

        const samplesRaw = await AsyncStorage.getItem(BG_SPEED_SAMPLES_KEY);
        const samples: number[] = samplesRaw ? JSON.parse(samplesRaw) : [];
        const maxRaw    = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
        const maxSpeed  = parseFloat(maxRaw ?? '0');
        const avgSpeed  = samples.length > 0
          ? samples.reduce((a, b) => a + b, 0) / samples.length
          : 0;

        const passiveRoutePoints = trimRoutePointsForActivitySave(
          bgRoutePoints.length > 1 ? bgRoutePoints : undefined,
        );
        const saveRes = await fetch(`${API_URL}/api/activity/save`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            distance: Math.round(bgPending * 1000) / 1000,
            maxSpeed: Math.round(maxSpeed * 10) / 10,
            avgSpeed: Math.round(avgSpeed * 10) / 10,
            duration: null,
            routePoints: passiveRoutePoints,
            source: 'background-passive',
            routePointsCount: passiveRoutePoints?.length ?? 0,
          }),
        });
        if (!saveRes.ok) {
          let details = '';
          try { details = await saveRes.text(); } catch {}
          console.log('flushPendingKm(passive) save failed — BG_PENDING_KM preserved for retry:', saveRes.status, details?.slice(0, 200));
          telemetryRef.current.flushFail += 1;
          return;
        }
        telemetryRef.current.flushSuccess += 1;
        void syncProfileStatsFromServer();

        await Promise.all([
          AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
          AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
          AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
          AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
          AsyncStorage.removeItem(EMERGENCY_TRIP_SAVE_KEY),
        ]);
      }
    } catch (e) {
      console.log('flushPendingKm error:', e);
    } finally {
      flushInFlightRef.current = false;
    }
  }, [flushPendingActivitySave]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!__DEV__) return;
      console.log('[BG][telemetry]', telemetryRef.current);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Task management ───────────────────────────────────────────────────────
  const startBackgroundTracking = useCallback(async () => {
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    try {
      // Hard runtime guard: never run BG task when user disabled the toggle.
      const persistedBgSetting = await AsyncStorage.getItem(BG_TRACKING_SETTING_KEY);
      const bgAllowed = bgEnabledRef.current && persistedBgSetting === 'true';
      if (!bgAllowed || !isPremium) {
        if (Platform.OS === 'android') {
          await stopVroomBgForegroundNotification();
        }
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          telemetryRef.current.bgStops += 1;
        }
        return;
      }

      if (Platform.OS === 'android') {
        await startVroomBgForegroundNotification();
      }

      const shouldTrack = bgEnabled && forceEnabled;
      if (!shouldTrack) {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          telemetryRef.current.bgStops += 1;
        }
        return;
      }

      const appIsActive = AppState.currentState === 'active';
      // Foreground: mapa ma watcher — zero równoległego BG GPS (lag).
      if (appIsActive) {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          telemetryRef.current.bgStops += 1;
        }
        lastBgCadenceRef.current = null;
        return;
      }
      const disclosureAccepted = await hasAcceptedBackgroundLocationDisclosure();
      if (!disclosureAccepted) return;

      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== 'granted') return;
      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') return;
      const [navFlag, stationaryFlag] = await Promise.all([
        AsyncStorage.getItem(BG_IS_NAVIGATING_KEY),
        AsyncStorage.getItem(BG_GPS_STATIONARY_KEY),
      ]);
      const isNavigatingBg = navFlag === 'true';
      const isStationaryBg = stationaryFlag === 'true';
      const highCadence = isSharing || (forceEnabled && (isNavigatingBg || !isStationaryBg));
      const cadenceKey: 'high' | 'low' = highCadence ? 'high' : 'low';

      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRegistered && lastBgCadenceRef.current === cadenceKey) return;
      if (isRegistered) {
        try {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        } catch { /* restart with new cadence */ }
      }
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy:         highCadence ? Location.Accuracy.High : Location.Accuracy.Balanced,
        distanceInterval: highCadence ? 10 : 35,
        timeInterval:     highCadence ? 5000 : 20000,
        showsBackgroundLocationIndicator: true,
        ...(Platform.OS === 'ios'
          ? {
              foregroundService: {
                notificationTitle: 'VROOM — statystyki jazdy',
                notificationBody:  'Zliczanie km w tle · dotknij Zakończ aby wyłączyć',
                notificationColor: '#e33835',
                killServiceOnDestroy: false,
              },
              pausesUpdatesAutomatically: !highCadence,
              activityType: Location.ActivityType.AutomotiveNavigation,
              deferredUpdatesInterval: highCadence ? 10_000 : 30_000,
              deferredUpdatesDistance: highCadence ? 40 : 120,
            }
          : {}),
      });
      lastBgCadenceRef.current = cadenceKey;
      telemetryRef.current.bgStarts += 1;
      if (forceEnabled) telemetryRef.current.forceStarts += 1;
    } catch (e: any) {
      console.log('⚠️ startBackgroundTracking error:', e?.message ?? e);
    } finally {
      startInFlightRef.current = false;
    }
  }, [bgEnabled, isSharing, forceEnabled, isPremium]);

  const stopBgLocationUpdates = useCallback(async () => {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRegistered) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        telemetryRef.current.bgStops += 1;
      }
      lastBgCadenceRef.current = null;
    } catch (e: any) {
      console.log('⚠️ stopBgLocationUpdates error:', e?.message ?? e);
    }
  }, []);

  const stopBackgroundTracking = useCallback(async () => {
    if (stopInFlightRef.current) return;
    stopInFlightRef.current = true;
    try {
      if (Platform.OS === 'android') {
        await stopVroomBgForegroundNotification();
      }
      await stopBgLocationUpdates();
    } finally {
      stopInFlightRef.current = false;
    }
  }, [stopBgLocationUpdates]);

  // Powiadomienie Android gdy włączone śledzenie w tle (lekki, jednorazowy).
  useEffect(() => {
    if (!bgEnabled || !isPremium) {
      if (Platform.OS === 'android') void stopVroomBgForegroundNotification();
      return;
    }
    if (Platform.OS === 'android') {
      void startVroomBgForegroundNotification();
    }
  }, [bgEnabled, isPremium]);

  // Auto-start GPS w tle tylko podczas aktywnej jazdy/nawigacji.
  useEffect(() => {
    if (forceEnabled && bgEnabled) {
      const timer = setTimeout(() => startBackgroundTracking(), 500);
      return () => clearTimeout(timer);
    }
    stopBgLocationUpdates().then(() => {
      if (!forceEnabled) flushPendingKm(false);
    });
  }, [bgEnabled, forceEnabled, startBackgroundTracking, stopBgLocationUpdates, flushPendingKm]);

  // Recover BG task on foreground only when user enabled background work
  useEffect(() => {
    const persistAppActive = (active: boolean) => {
      const now = Date.now();
      if (!shouldPersistAppActiveSnapshot(lastAppActiveSnapshotRef.current, active, now)) return;
      const encoded = encodeAppActiveSnapshot(active);
      lastAppActiveSnapshotRef.current = encoded;
      AsyncStorage.setItem(BG_APP_ACTIVE_KEY, encoded).catch(() => {});
    };

    persistAppActive(AppState.currentState === 'active');
    let activeHeartbeat: ReturnType<typeof setInterval> | null = null;
    if (AppState.currentState === 'active') {
      activeHeartbeat = setInterval(() => {
        persistAppActive(true);
      }, BG_APP_ACTIVE_HEARTBEAT_MS);
    }
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      persistAppActive(s === 'active');
      if (s === 'active') {
        if (!activeHeartbeat) {
          activeHeartbeat = setInterval(() => {
            persistAppActive(true);
          }, BG_APP_ACTIVE_HEARTBEAT_MS);
        }
        void flushPendingKm(false);
        void stopBgLocationUpdates();
        return;
      }
      if (activeHeartbeat) {
        clearInterval(activeHeartbeat);
        activeHeartbeat = null;
      }
      if (s === 'inactive' || s === 'background') {
        if (s === 'background') void flushTracePendingKmToStorage();
        persistAppActive(false);
        if (bgEnabled && forceEnabledRef.current) {
          void startBackgroundTracking();
        } else if (!bgEnabled) {
          stopBackgroundTracking();
        }
      }
    });
    return () => {
      sub.remove();
      if (activeHeartbeat) clearInterval(activeHeartbeat);
    };
  }, [bgEnabled, forceEnabled, startBackgroundTracking, stopBackgroundTracking, stopBgLocationUpdates, flushPendingKm]);

  // ── Flush passive stats when app goes to background (not on foreground return) ─
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (
        (nextState === 'background' || nextState === 'inactive')
        && prev === 'active'
      ) {
        Promise.all([
          AsyncStorage.getItem(BG_IS_NAVIGATING_KEY),
          AsyncStorage.getItem(BG_IS_DRIVING_KEY),
        ])
          .then(([navFlag, drivingFlag]) => {
            // Aktywna jazda/nawigacja — jeden zapis na koniec trasy, bez chunków w tle.
            if (navFlag === 'true' || drivingFlag === 'true') return;
            flushPendingKm(false);
          })
          .catch(() => { flushPendingKm(false); });
      }
    });
    return () => sub.remove();
  }, [flushPendingKm]);

  return { startBackgroundTracking, stopBackgroundTracking, flushPendingKm };
}
