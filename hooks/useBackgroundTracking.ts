import { useEffect, useRef, useCallback } from 'react';
import * as Location      from 'expo-location';
import * as TaskManager   from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage       from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { API_URL }        from '../constants/mapConfig';
import { evaluateDistanceSegment } from '../scripts/distanceEngine';
import { haversineKm } from '../scripts/navigationUtils';
import { syncProfileStatsFromServer, applyOptimisticProfileDistanceKm } from '../lib/profileStatsSync';
import { hasAcceptedBackgroundLocationDisclosure } from '../lib/backgroundLocationConsent';
import {
  startVroomBgForegroundNotification,
  stopVroomBgForegroundNotification,
} from '../lib/vroomBgForegroundService';
import { BackgroundDriveController, resolveNativeDistanceOwnership } from '../lib/backgroundDriveController';
import {
  ingestGamificationPing,
} from '../lib/gamificationClient';
import { resolveFinalTripDistanceKm } from '../lib/tripDistanceMerge';
import { syncQuestTrackAfterDistanceSave } from '../lib/questTrackSync';
import {
  averageLedgerSpeed,
  clearTripSessionLedger,
  compactTripRoute,
  createTripSessionLedger,
  loadTripSessionLedger,
  markLedgerFinalizationPending,
  mergeForegroundLedgerSnapshot,
  mergeNativeLedgerSnapshot,
  resolveTripSessionIdentity,
  saveTripSessionLedger,
  shouldSnapshotLedger,
  TRIP_FINALIZATION_OUTBOX_KEY,
  type TripFinalizationReason,
  type TripSessionLedger,
} from '../lib/tripSessionLedger';
import {
  enqueueTripFinalization,
  parseTripFinalizationOutbox,
  removeTripFinalization,
  serializeTripFinalizationOutbox,
  type PendingTripFinalization,
} from '../lib/tripFinalizationOutbox';
import {
  acknowledgePendingTripCheckpoint,
  queuePendingTripCheckpoint,
  readPendingTripCheckpoint,
  recordTripPersistenceEvent,
  type PendingTripCheckpoint,
} from '../lib/tripPersistenceCoordinator';
import type { NavMode } from '../lib/navigationV3/types';
import { sendLiveLocation } from '../lib/liveLocationBroker';
import { evaluateSmartStart, initialSmartStartState, type SmartStartState } from '../lib/smartStart';
import { compactDriveTelemetry, type DriveTelemetryPoint } from '../lib/driveTelemetry';

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
const FOREGROUND_SPEED_SAMPLE_LIMIT = 1200;

/** trusted=true: ten sam gate co trip peak (ruch potwierdzony). */
export function feedSpeedSample(speedMs: number | null, trusted = false) {
  if (!trusted || speedMs == null || speedMs < 0) return;
  const kmh = speedMs * 3.6;
  if (!Number.isFinite(kmh) || kmh < 1) return;
  _speedSamples.push(kmh);
  if (_speedSamples.length > FOREGROUND_SPEED_SAMPLE_LIMIT) {
    _speedSamples = _speedSamples.filter((_, index) => index % 2 === 0);
  }
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
/** Local hand-off for finish cards created by Smart Start/headless recovery. */
export const PENDING_TRIP_FINISH_CARD_KEY = 'vroom_pending_trip_finish_card_v1';
/** Ile km z bieżącej trasy już trafiło na serwer (checkpointy) — przetrwa kill procesu. */
export const TRIP_CHECKPOINT_SAVED_KM_KEY = 'trip_checkpoint_saved_km';
/** Session that owns the persisted checkpoint watermark. Old app versions stored
 * only a number here, which could block a later trip whose UI distance restarted
 * from zero. */
export const TRIP_CHECKPOINT_SESSION_ID_KEY = 'trip_checkpoint_session_id';
const BG_PENDING_ACTIVITY_SAVE_KEY = 'bg_pending_activity_save';
const BG_LAST_LOC_KEY           = 'bg_last_location';
const BG_ROUTE_POINTS_KEY       = 'bg_route_points';
// Flag: 'true' when live-sharing is active — read by the background task
export const BG_IS_SHARING_KEY  = 'bg_is_sharing';
/** Preferencja użytkownika (przełącznik na mapie). Domyślnie brak klucza = ON. */
export const LIVE_SHARING_USER_PREF_KEY = 'vroom_live_sharing_user_pref';
/** Mirror premium for BACKGROUND_LOCATION_TASK (React state unavailable in headless task). */
export const USER_IS_PREMIUM_KEY = 'USER_IS_PREMIUM';
export const BG_ACTIVE_CONVOY_ID_KEY = 'bg_active_convoy_id';
export const BG_ACTIVE_CONVOY_HOST_KEY = 'bg_active_convoy_host';
/** Mirror of settings.backgroundTracking — read by BACKGROUND_LOCATION_TASK (defense in depth). */
export const BG_TRACKING_SETTING_KEY = 'bg_tracking_setting_enabled';
export const SMART_START_ENABLED_KEY = 'smart_start_enabled';
const SMART_START_STATE_KEY = 'smart_start_state_v1';
/** Destination mirrored for headless Smart Stop when the map screen is asleep. */
export const BG_NAV_DESTINATION_KEY = 'bg_navigation_destination_v1';
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
const BG_LAST_INGEST_LOC_KEY           = 'bg_last_ingest_loc';
const BG_LAST_INGEST_AT_KEY            = 'bg_last_ingest_at';
const BG_INGEST_REFRESH_MS             = 8_000;
const BG_INGEST_MIN_MOVE_M             = 8;
export const TRIP_SESSION_ID_KEY       = 'active_trip_session_id';
export const TRIP_SESSION_STARTED_AT_KEY = 'active_trip_session_started_at';
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
const BG_TRIP_CHECKPOINT_KM     = 0.2;
const BG_TRIP_CHECKPOINT_FORCE_MIN_KM = 0.05;
const BG_TRIP_CHECKPOINT_FORCE_MS = 30_000;
let _bgCheckpointInFlight       = false;
let _bgLastCheckpointAttemptAt  = 0;
const TRIP_NETWORK_TIMEOUT_MS = 10_000;
let _checkpointFlushPromise: Promise<CheckpointSaveResult | null> | null = null;
let _tripSessionStartPromise: Promise<string> | null = null;
let _finalizationFlushPromise: Promise<boolean> | null = null;
let _finalizationOperationLock: Promise<void> = Promise.resolve();

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

/** Single source of truth: user enabled „Praca w tle” (readable from headless BG task). */
export async function isBackgroundWorkAllowed(): Promise<boolean> {
  const bgSetting = await AsyncStorage.getItem(BG_TRACKING_SETTING_KEY);
  return bgSetting === 'true';
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
  tripSessionId: string;
  distanceKm: number;
  trackedPoints: DriveTelemetryPoint[];
  speedSamples: number[];
  startTimeMs: number | null;
  estimatedSec: number;
  floorKm: number;
  savedAt: number;
};

export async function writeEmergencyTripSave(
  payload: Omit<EmergencyTripSavePayload, 'tripSessionId'> & { tripSessionId?: string },
): Promise<void> {
  try {
    if (_tripSessionStartPromise) await _tripSessionStartPromise;
    const tripSessionId = payload.tripSessionId ?? await ensureTripSessionId();
    await AsyncStorage.setItem(EMERGENCY_TRIP_SAVE_KEY, JSON.stringify({ ...payload, tripSessionId }));
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
      await AsyncStorage.multiRemove([
        TRIP_CHECKPOINT_SAVED_KM_KEY,
        TRIP_CHECKPOINT_SESSION_ID_KEY,
      ]);
      return;
    }
    const sessionId = await ensureTripSessionId();
    await AsyncStorage.multiSet([
      [TRIP_CHECKPOINT_SAVED_KM_KEY, String(n)],
      [TRIP_CHECKPOINT_SESSION_ID_KEY, sessionId],
    ]);
  } catch { /* ignore */ }
}

export async function loadTripCheckpointSavedKm(): Promise<number> {
  try {
    const [[, rawKm], [, checkpointSessionId], [, activeSessionId]] = await AsyncStorage.multiGet([
      TRIP_CHECKPOINT_SAVED_KM_KEY,
      TRIP_CHECKPOINT_SESSION_ID_KEY,
      TRIP_SESSION_ID_KEY,
    ]);
    // An unscoped legacy watermark is deliberately ignored. It cannot safely
    // be applied to a fresh trip, and used to make 1 km drives wait for an old
    // 18 km checkpoint before sending anything.
    if (!checkpointSessionId || !activeSessionId || checkpointSessionId !== activeSessionId) return 0;
    return safePendingKm(rawKm);
  } catch {
    return 0;
  }
}

export async function clearTripCheckpointSavedKm(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      TRIP_CHECKPOINT_SAVED_KM_KEY,
      TRIP_CHECKPOINT_SESSION_ID_KEY,
    ]);
  } catch { /* ignore */ }
}

function createTripSessionId(): string {
  return `trip_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function ensureTripSessionId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(TRIP_SESSION_ID_KEY);
    if (existing) return existing;
    const id = createTripSessionId();
    const startedAt = new Date().toISOString();
    await AsyncStorage.multiSet([
      [TRIP_SESSION_ID_KEY, id],
      [TRIP_SESSION_STARTED_AT_KEY, startedAt],
    ]);
    return id;
  } catch {
    return createTripSessionId();
  }
}

export async function getTripSessionContext(): Promise<{
  tripSessionId: string;
  startedAt: string;
  endedAt: string;
}> {
  const tripSessionId = await ensureTripSessionId();
  let startedAt = await AsyncStorage.getItem(TRIP_SESSION_STARTED_AT_KEY);
  if (!startedAt) {
    startedAt = new Date().toISOString();
    await AsyncStorage.setItem(TRIP_SESSION_STARTED_AT_KEY, startedAt);
  }
  return { tripSessionId, startedAt, endedAt: new Date().toISOString() };
}

export async function clearTripSession(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([TRIP_SESSION_ID_KEY, TRIP_SESSION_STARTED_AT_KEY]);
  } catch { /* ignore */ }
}

type CheckpointSaveResult = {
  tripSessionId: string;
  creditedDeltaKm: number;
  checkpointDistanceKm: number;
  userTotalDistance?: number;
  dailyDistance?: number;
  newAchievements?: Array<{
    id?: string | number;
    key?: string;
    label?: string;
    definition?: { key?: string; label?: string };
  }>;
};

async function fetchWithTripTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRIP_NETWORK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function postPendingTripCheckpoint(
  pending: PendingTripCheckpoint,
): Promise<CheckpointSaveResult | null> {
  const token = await getAuthToken();
  if (!token) return null;
  const body = JSON.stringify({
    tripSessionId: pending.tripSessionId,
    distanceTotal: Math.round(pending.distanceKm * 1000) / 1000,
    maxSpeed: Math.round(pending.maxSpeedKmh * 10) / 10,
    avgSpeed: Math.round(pending.avgSpeedKmh * 10) / 10,
    source: pending.source,
    visibleInHistory: false,
  });
  const postCheckpoint = () => fetchWithTripTimeout(`${API_URL}/api/activity/session/checkpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
  });
  try {
    let res = await postCheckpoint();
    if (!res.ok && res.status >= 500) res = await postCheckpoint();
    if (!res.ok) {
      void recordTripPersistenceEvent('checkpoint_fail', {
        tripSessionId: pending.tripSessionId,
        distanceKm: pending.distanceKm,
        status: res.status,
      });
      return null;
    }
    const data = await res.json().catch(() => ({}));
    const checkpointDistanceKm = Number(data?.checkpointDistanceKm);
    const creditedDeltaKm = Number(data?.creditedDeltaKm);
    const result: CheckpointSaveResult = {
      tripSessionId: String(data?.tripSessionId ?? pending.tripSessionId),
      creditedDeltaKm: Number.isFinite(creditedDeltaKm) ? creditedDeltaKm : 0,
      checkpointDistanceKm: Number.isFinite(checkpointDistanceKm)
        ? checkpointDistanceKm
        : Math.round(pending.distanceKm * 1000) / 1000,
      userTotalDistance: Number.isFinite(Number(data?.userTotalDistance))
        ? Number(data.userTotalDistance)
        : undefined,
      dailyDistance: Number.isFinite(Number(data?.dailyDistance))
        ? Number(data.dailyDistance)
        : undefined,
      newAchievements: Array.isArray(data?.newAchievements)
        ? data.newAchievements
        : [],
    };
    await acknowledgePendingTripCheckpoint(pending.tripSessionId, result.checkpointDistanceKm);
    await applyOptimisticProfileDistanceKm(result.userTotalDistance, result.creditedDeltaKm);
    void syncProfileStatsFromServer();
    void recordTripPersistenceEvent('checkpoint_ok', {
      tripSessionId: pending.tripSessionId,
      distanceKm: result.checkpointDistanceKm,
      status: res.status,
    });
    return result;
  } catch (error) {
    void recordTripPersistenceEvent('checkpoint_fail', {
      tripSessionId: pending.tripSessionId,
      distanceKm: pending.distanceKm,
      reason: error instanceof Error ? error.name : 'network',
    });
    return null;
  }
}

export async function flushPendingTripCheckpoint(): Promise<CheckpointSaveResult | null> {
  if (_checkpointFlushPromise) return _checkpointFlushPromise;
  _checkpointFlushPromise = (async () => {
    let lastResult: CheckpointSaveResult | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pending = await readPendingTripCheckpoint();
      if (!pending) return lastResult;
      const result = await postPendingTripCheckpoint(pending);
      if (!result) return lastResult;
      lastResult = result;
      const remaining = await readPendingTripCheckpoint();
      if (!remaining || remaining.tripSessionId !== pending.tripSessionId) return lastResult;
      if (remaining.distanceKm <= result.checkpointDistanceKm + 0.0005) return lastResult;
    }
    return lastResult;
  })().finally(() => {
    _checkpointFlushPromise = null;
  });
  return _checkpointFlushPromise;
}

export async function saveIncrementalTripKm(payload: {
  distanceKm: number;
  maxSpeedKmh?: number;
  avgSpeedKmh?: number;
  source?: 'navigation' | 'driving' | 'trip-checkpoint' | 'background-passive';
}): Promise<CheckpointSaveResult | null> {
  const dist = Number(payload.distanceKm);
  if (!Number.isFinite(dist) || dist < 0.05) return null;
  try {
    if (_tripSessionStartPromise) await _tripSessionStartPromise;
    const tripSessionId = await ensureTripSessionId();
    const pending = await queuePendingTripCheckpoint({
      tripSessionId,
      distanceKm: Math.round(dist * 1000) / 1000,
      maxSpeedKmh: Math.max(0, payload.maxSpeedKmh ?? 0),
      avgSpeedKmh: Math.max(0, payload.avgSpeedKmh ?? 0),
      source: payload.source ?? 'trip-checkpoint',
      updatedAt: Date.now(),
    });
    void recordTripPersistenceEvent('checkpoint_queued', {
      tripSessionId,
      distanceKm: pending.distanceKm,
    });
    return flushPendingTripCheckpoint().then((result) => {
      if (result && result.creditedDeltaKm > 0) {
        void syncQuestTrackAfterDistanceSave();
      }
      return result;
    });
  } catch (error) {
    void recordTripPersistenceEvent('checkpoint_fail', {
      distanceKm: dist,
      reason: error instanceof Error ? error.name : 'storage',
    });
    return null;
  }
}

async function maybeFlushBgTripCheckpoint(pendingKm: number): Promise<number> {
  const now = Date.now();
  const dueByDistance = pendingKm >= BG_TRIP_CHECKPOINT_KM;
  const dueByForce =
    pendingKm >= BG_TRIP_CHECKPOINT_FORCE_MIN_KM &&
    now - _bgLastCheckpointAttemptAt >= BG_TRIP_CHECKPOINT_FORCE_MS;
  if (_bgCheckpointInFlight || (!dueByDistance && !dueByForce)) return pendingKm;

  const savedTotal = await loadTripCheckpointSavedKm();
  const chunkKm = dueByForce
    ? pendingKm
    : Math.floor(pendingKm / BG_TRIP_CHECKPOINT_KM) * BG_TRIP_CHECKPOINT_KM;
  if (chunkKm < BG_TRIP_CHECKPOINT_FORCE_MIN_KM) return pendingKm;
  const targetTotal = savedTotal + chunkKm;

  _bgCheckpointInFlight = true;
  _bgLastCheckpointAttemptAt = now;
  try {
    const maxRaw = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
    const maxSpeed = parseFloat(maxRaw ?? '0');
    const ok = await saveIncrementalTripKm({
      distanceKm: targetTotal,
      maxSpeedKmh: Number.isFinite(maxSpeed) ? maxSpeed : 0,
      source: 'trip-checkpoint',
    });
    if (ok) {
      const checkpointTotal = Math.max(savedTotal, ok.checkpointDistanceKm);
      await persistTripCheckpointSavedKm(checkpointTotal);
      return Math.max(0, savedTotal + pendingKm - checkpointTotal);
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
  points?: DriveTelemetryPoint[],
): DriveTelemetryPoint[] | undefined {
  if (!points || points.length <= 1) return undefined;
  return compactBgRoutePoints(points).slice(0, BG_ROUTE_MAX_POINTS);
}

function compactBgRoutePoints(
  points: DriveTelemetryPoint[],
): DriveTelemetryPoint[] {
  return compactDriveTelemetry(points, BG_ROUTE_MAX_POINTS);
}

export async function consumeNativeDriveStatsToStorage(): Promise<void> {
  await syncNativeTripSessionLedger();
}

/**
 * Keeps a genuinely running native session intact, but starts a clean session
 * when only stale keys from an already-ended/older build remain. This is the
 * boundary that prevents a previous checkpoint total from poisoning a new trip.
 */
async function prepareTripSessionForStart(mode: 'navigation' | 'freeDrive'): Promise<string> {
  const [nativeState, ledger, existingSessionId] = await Promise.all([
    BackgroundDriveController.getState(),
    loadTripSessionLedger(),
    AsyncStorage.getItem(TRIP_SESSION_ID_KEY),
  ]);
  const nativeSessionId = typeof nativeState.tripSessionId === 'string' ? nativeState.tripSessionId : null;
  const nativeOwnsSession = nativeState.active && !!nativeSessionId && !existingSessionId;
  const ledgerIsRecoverable = !!(
    ledger?.active
    && ledger.tripSessionId === existingSessionId
    && ledger.finalization.state === 'open'
  );

  if (ledgerIsRecoverable) return ledger.tripSessionId;
  if (nativeOwnsSession && nativeSessionId) {
    await AsyncStorage.multiSet([
      [TRIP_SESSION_ID_KEY, nativeSessionId],
      [TRIP_SESSION_STARTED_AT_KEY, new Date(Number(nativeState.startedAt) || Date.now()).toISOString()],
    ]);
    return nativeSessionId;
  }

  await Promise.all([
    clearTripSession(),
    clearTripCheckpointSavedKm(),
    clearEmergencyTripSave(),
    clearTripSessionLedger(),
    AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
    AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
    AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
    AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
  ]);
  const tripSessionId = await ensureTripSessionId();
  const startedAt = await AsyncStorage.getItem(TRIP_SESSION_STARTED_AT_KEY);
  await saveTripSessionLedger(createTripSessionLedger({
    tripSessionId,
    startedAt: startedAt ?? undefined,
    mode,
  }));
  void recordTripPersistenceEvent('session_started', { tripSessionId });
  return tripSessionId;
}

/** Bootstrap a fresh or recovered trip session before distance accumulation. */
export async function startDriveSession(mode: 'navigation' | 'freeDrive'): Promise<string> {
  if (_tripSessionStartPromise) return _tripSessionStartPromise;
  _tripSessionStartPromise = (async () => {
    const tripSessionId = await prepareTripSessionForStart(mode);
    await AsyncStorage.setItem(BG_IS_DRIVING_KEY, 'true');
    if (mode === 'navigation') {
      await AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'true');
    }
    if (await isBackgroundWorkAllowed()) {
      await BackgroundDriveController.start(mode, tripSessionId);
    }
    return tripSessionId;
  })().finally(() => {
    _tripSessionStartPromise = null;
  });
  return _tripSessionStartPromise;
}

/** Switch an in-progress free-drive session into navigation without resetting km. */
export async function continueDriveSessionAsNavigation(): Promise<string> {
  await AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'true');
  await AsyncStorage.setItem(BG_IS_DRIVING_KEY, 'true');
  const tripSessionId = await ensureTripSessionId();
  if (await isBackgroundWorkAllowed()) {
    await BackgroundDriveController.start('navigation', tripSessionId);
  }
  return tripSessionId;
}

/**
 * Copies the native, session-total ledger into durable JS storage without
 * consuming or resetting the native tracker. It is safe to call repeatedly.
 */
export async function syncNativeTripSessionLedger(): Promise<TripSessionLedger | null> {
  try {
    const [state, stats, currentSessionId] = await Promise.all([
      BackgroundDriveController.getState(),
      BackgroundDriveController.getNativeStats(),
      AsyncStorage.getItem(TRIP_SESSION_ID_KEY),
    ]);
    const nativeSessionId = typeof stats.tripSessionId === 'string' ? stats.tripSessionId : null;
    const nativeKm = Number(stats.distanceKm);
    const nativeCheckpointKm = Number(stats.lastServerCheckpointKm);
    const identity = resolveTripSessionIdentity({
      jsSessionId: currentSessionId,
      nativeStateActive: state.active,
      nativeStateSessionId: typeof state.tripSessionId === 'string' ? state.tripSessionId : null,
      nativeStatsSessionId: nativeSessionId,
    });
    if (identity.conflict) {
      void recordTripPersistenceEvent('session_id_conflict', {
        tripSessionId: currentSessionId,
        reason: state.active ? 'active_native_mismatch' : 'stale_native_mismatch',
      });
    }
    const sessionId = identity.sessionId;
    if (!sessionId || !identity.acceptNativeStats || !Number.isFinite(nativeKm)) {
      const ledger = await loadTripSessionLedger();
      return ledger?.tripSessionId === sessionId ? ledger : null;
    }
    if (!currentSessionId) {
      await AsyncStorage.multiSet([
        [TRIP_SESSION_ID_KEY, String(sessionId)],
        [TRIP_SESSION_STARTED_AT_KEY, new Date(Number(state.startedAt) || Date.now()).toISOString()],
      ]);
    }
    const previous = await loadTripSessionLedger();
    const next = mergeNativeLedgerSnapshot(previous, {
      tripSessionId: String(sessionId),
      startedAt: state.startedAt ?? null,
      mode: state.mode,
      distanceKm: Number.isFinite(nativeKm) ? nativeKm : 0,
      checkpointKm: Number.isFinite(nativeCheckpointKm) ? nativeCheckpointKm : 0,
      routePoints: Array.isArray(stats.routePoints)
        ? stats.routePoints.filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude))
        : [],
      speedSamples: Array.isArray(stats.speedSamples) ? stats.speedSamples : [],
      maxSpeedKmh: stats.maxSpeedKmh,
      movedAt: state.updatedAt ?? Date.now(),
    });
    if (shouldSnapshotLedger(previous, next)) {
      await saveTripSessionLedger(next);
    }

    if (Number.isFinite(nativeCheckpointKm) && nativeCheckpointKm > 0) {
      await persistTripCheckpointSavedKm(Math.max(await loadTripCheckpointSavedKm(), nativeCheckpointKm));
    }
    return next;
  } catch {
    return null;
  }
}

export type TripSessionFinalizationInput = {
  reason: TripFinalizationReason;
  mode?: 'navigation' | 'freeDrive';
  distanceKm?: number;
  maxSpeedKmh?: number;
  avgSpeedKmh?: number;
  durationSec?: number;
  routePoints?: DriveTelemetryPoint[];
};

export type PendingTripFinishCard = {
  version: 1;
  tripSessionId: string;
  distanceKm: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  durationSec: number;
  routePoints: DriveTelemetryPoint[];
  reason: TripFinalizationReason;
  createdAt: number;
};

export async function readPendingTripFinishCard(): Promise<PendingTripFinishCard | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_TRIP_FINISH_CARD_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingTripFinishCard;
    if (value?.version !== 1 || !value.tripSessionId || !Number.isFinite(Number(value.distanceKm))) return null;
    return {
      ...value,
      distanceKm: Math.max(0, Number(value.distanceKm) || 0),
      maxSpeedKmh: Math.max(0, Number(value.maxSpeedKmh) || 0),
      avgSpeedKmh: Math.max(0, Number(value.avgSpeedKmh) || 0),
      durationSec: Math.max(0, Number(value.durationSec) || 0),
      routePoints: compactTripRoute(Array.isArray(value.routePoints) ? value.routePoints : []),
    };
  } catch {
    return null;
  }
}

export async function clearPendingTripFinishCard(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_TRIP_FINISH_CARD_KEY);
}

async function readPendingTripFinalizations(): Promise<PendingTripFinalization[]> {
  try {
    const raw = await AsyncStorage.getItem(TRIP_FINALIZATION_OUTBOX_KEY);
    return parseTripFinalizationOutbox(raw);
  } catch {
    return [];
  }
}

async function writePendingTripFinalizations(items: PendingTripFinalization[]): Promise<void> {
  if (!items.length) {
    await AsyncStorage.removeItem(TRIP_FINALIZATION_OUTBOX_KEY);
    return;
  }
  await AsyncStorage.setItem(TRIP_FINALIZATION_OUTBOX_KEY, serializeTripFinalizationOutbox(items));
}

async function clearFinalizedActiveSession(tripSessionId: string): Promise<void> {
  const activeSessionId = await AsyncStorage.getItem(TRIP_SESSION_ID_KEY);
  if (activeSessionId !== tripSessionId) return;

  await Promise.all([
    AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
    AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
    AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
    AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
    AsyncStorage.removeItem(BG_PENDING_ACTIVITY_SAVE_KEY),
    clearEmergencyTripSave(),
    clearTripCheckpointSavedKm(),
    acknowledgePendingTripCheckpoint(tripSessionId, Number.POSITIVE_INFINITY),
    clearTripSession(),
  ]);

  const nativeState = await BackgroundDriveController.getState().catch(() => null);
  if (nativeState?.tripSessionId === tripSessionId && !nativeState.active) {
    await BackgroundDriveController.consumeNativeStats().catch(() => ({ distanceKm: 0 }));
  }
  const ledger = await loadTripSessionLedger();
  if (ledger?.tripSessionId === tripSessionId) {
    await clearTripSessionLedger();
  }
}

async function flushTripSessionFinalizationOutboxOnce(): Promise<boolean> {
  let pendingItems = await readPendingTripFinalizations();
  if (!pendingItems.length) return true;
  const token = await getAuthToken();
  if (!token) return false;
  let allSaved = true;
  for (const pending of pendingItems) {
    try {
    let payload = pending.payload;
    let res = await fetchWithTripTimeout(`${API_URL}/api/activity/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    // A malformed/overlong trace must not block the distance history. Retry the
    // same idempotent session once without geometry, retaining all km/stats.
    if (!res.ok && res.status === 400 && payload.routePoints) {
      payload = { ...payload, routePoints: undefined, routePointsCount: 0 };
      res = await fetchWithTripTimeout(`${API_URL}/api/activity/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
    }
      if (!res.ok) {
        allSaved = false;
        void recordTripPersistenceEvent('finalization_fail', {
          tripSessionId: pending.tripSessionId,
          distanceKm: Number(payload.distance),
          routePointsCount: Number(payload.routePointsCount),
          status: res.status,
        });
        continue;
      }
      pendingItems = removeTripFinalization(pendingItems, pending.tripSessionId);
      await writePendingTripFinalizations(pendingItems);
      await clearFinalizedActiveSession(pending.tripSessionId);
      void syncProfileStatsFromServer();
      void recordTripPersistenceEvent('finalization_ok', {
        tripSessionId: pending.tripSessionId,
        distanceKm: Number(payload.distance),
        routePointsCount: Number(payload.routePointsCount),
      });
    } catch (error) {
      allSaved = false;
      void recordTripPersistenceEvent('finalization_fail', {
        tripSessionId: pending.tripSessionId,
        distanceKm: Number(pending.payload.distance),
        routePointsCount: Number(pending.payload.routePointsCount),
        reason: error instanceof Error ? error.name : 'network',
      });
    }
  }
  return allSaved && pendingItems.length === 0;
}

export async function flushTripSessionFinalizationOutbox(): Promise<boolean> {
  if (_finalizationFlushPromise) return _finalizationFlushPromise;
  _finalizationFlushPromise = flushTripSessionFinalizationOutboxOnce().finally(() => {
    _finalizationFlushPromise = null;
  });
  return _finalizationFlushPromise;
}

async function finalizeTripSessionOnce(
  input: TripSessionFinalizationInput,
  options?: { deferFlush?: boolean },
): Promise<boolean> {
  const nativeLedger = await syncNativeTripSessionLedger();
  const session = await getTripSessionContext();
  const effectiveSessionId = session.tripSessionId;
  const storedLedger = await loadTripSessionLedger();
  const previous = nativeLedger?.tripSessionId === effectiveSessionId
    ? nativeLedger
    : storedLedger?.tripSessionId === effectiveSessionId
      ? storedLedger
      : null;
  const [checkpointKm, emergency] = await Promise.all([
    loadTripCheckpointSavedKm(),
    readEmergencyTripSave(),
  ]);
  const matchingEmergency = emergency?.tripSessionId === effectiveSessionId ? emergency : null;
  const foregroundRoute = compactTripRoute(input.routePoints ?? []);
  const nativeRoute = nativeLedger?.tripSessionId === effectiveSessionId
    ? compactTripRoute(nativeLedger.routePoints)
    : [];
  const emergencyRoute = matchingEmergency
    ? compactTripRoute(matchingEmergency.trackedPoints ?? [])
    : [];
  const selectedRoute = foregroundRoute.length >= 2
    ? foregroundRoute
    : nativeRoute.length >= 2
      ? nativeRoute
      : emergencyRoute;
  const seed = previous?.tripSessionId === effectiveSessionId
    ? { ...previous, routePoints: [] }
    : createTripSessionLedger({ tripSessionId: effectiveSessionId, startedAt: session.startedAt, mode: input.mode });
  const foregroundKm = Math.max(0, Number(input.distanceKm || 0));
  const resolvedKm = resolveFinalTripDistanceKm({
    nativeOwnsSession: nativeLedger?.tripSessionId === effectiveSessionId
      && Number(nativeLedger?.distanceKm ?? 0) > 0,
    nativeDistanceKm: nativeLedger?.distanceKm,
    foregroundTripKm: foregroundKm,
    backgroundPendingKm: 0,
    checkpointKm,
    emergencySnapshotKm: matchingEmergency?.distanceKm ?? 0,
    previousLedgerKm: previous?.distanceKm,
  });
  // Never let a lagging stream discard HUD/JS kilometers at save time.
  const finalDistanceKm = Math.max(
    resolvedKm,
    foregroundKm,
    Number(previous?.distanceKm) || 0,
    Number(checkpointKm) || 0,
  );
  const ledger = mergeForegroundLedgerSnapshot(seed, {
    distanceKm: finalDistanceKm,
    routePoints: selectedRoute,
    maxSpeedKmh: input.maxSpeedKmh,
    avgSpeedKmh: input.avgSpeedKmh,
    mode: input.mode,
  });
  if (['idle', 'crash', 'auto_stop', 'premium_expired'].includes(input.reason)) {
    const durationSec = input.durationSec ?? Math.max(0, Math.round((Date.now() - Date.parse(ledger.startedAt)) / 1000));
    const finishCard: PendingTripFinishCard = {
      version: 1,
      tripSessionId: ledger.tripSessionId,
      distanceKm: ledger.distanceKm,
      maxSpeedKmh: Math.max(ledger.maxSpeedKmh, Number(input.maxSpeedKmh) || 0),
      avgSpeedKmh: Number(input.avgSpeedKmh) > 0 ? Number(input.avgSpeedKmh) : averageLedgerSpeed(ledger),
      durationSec,
      routePoints: compactTripRoute(selectedRoute),
      reason: input.reason,
      createdAt: Date.now(),
    };
    await AsyncStorage.setItem(PENDING_TRIP_FINISH_CARD_KEY, JSON.stringify(finishCard));
  }
  if (ledger.distanceKm < 0.05) {
    // A very short/accidental session is intentionally not uploaded, but it is
    // still finished. Leaving its ledger "open" made the crash-recovery dialog
    // return on every app launch after the user chose "Zakończ i zapisz".
    await clearFinalizedActiveSession(ledger.tripSessionId);
    void recordTripPersistenceEvent('short_session_discarded', {
      tripSessionId: ledger.tripSessionId,
      distanceKm: ledger.distanceKm,
      reason: input.reason,
    });
    return false;
  }

  const pendingLedger = markLedgerFinalizationPending(ledger, input.reason);
  const routePoints = trimRoutePointsForActivitySave(pendingLedger.routePoints);
  const payload = {
    tripSessionId: pendingLedger.tripSessionId,
    distance: Math.round(pendingLedger.distanceKm * 1000) / 1000,
    maxSpeed: Math.round(Math.max(pendingLedger.maxSpeedKmh, input.maxSpeedKmh ?? 0) * 10) / 10,
    avgSpeed: Math.round((input.avgSpeedKmh && input.avgSpeedKmh > 0
      ? input.avgSpeedKmh
      : averageLedgerSpeed(pendingLedger)) * 10) / 10,
    duration: input.durationSec ?? Math.max(0, Math.round((Date.now() - Date.parse(pendingLedger.startedAt)) / 1000)),
    routePoints: routePoints && routePoints.length >= 2 ? routePoints : undefined,
    routePointsCount: routePoints?.length ?? 0,
    source: pendingLedger.mode === 'navigation' ? 'navigation_final' : 'drive_final',
    startedAt: pendingLedger.startedAt,
    endedAt: new Date().toISOString(),
  };
  await saveTripSessionLedger(pendingLedger);
  const queued = await readPendingTripFinalizations();
  await writePendingTripFinalizations(enqueueTripFinalization(queued, {
    tripSessionId: pendingLedger.tripSessionId,
    payload,
    createdAt: Date.now(),
  }));
  void recordTripPersistenceEvent('finalization_queued', {
    tripSessionId: pendingLedger.tripSessionId,
    distanceKm: pendingLedger.distanceKm,
    routePointsCount: payload.routePointsCount,
    reason: input.reason,
  });
  if (options?.deferFlush) return true;
  return flushTripSessionFinalizationOutbox();
}

export function finalizeTripSession(
  input: TripSessionFinalizationInput,
  options?: { deferFlush?: boolean },
): Promise<boolean> {
  const operation = _finalizationOperationLock.then(
    () => finalizeTripSessionOnce(input, options),
    () => finalizeTripSessionOnce(input, options),
  );
  _finalizationOperationLock = operation.then(() => undefined, () => undefined);
  return operation;
}

/* Legacy bridge kept for older callers. Native totals are no longer appended to
 * bg_pending_km, which previously made repeated reads duplicate fragments. */
export async function consumeNativeDriveStatsToLegacyStorage(): Promise<void> {
  try {
    const stats = await BackgroundDriveController.getNativeStats();
    const nativeRoute = Array.isArray(stats.routePoints)
      ? stats.routePoints.filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude))
      : [];
    if (nativeRoute.length > 0) {
      await AsyncStorage.setItem(BG_ROUTE_POINTS_KEY, JSON.stringify(compactBgRoutePoints(nativeRoute)));
    }
  } catch { /* ignore */ }
}

// ── Navigation flag helpers (called from map.tsx) ─────────────────────────────
export async function setNavigatingFlag(active: boolean): Promise<void> {
  await AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, active ? 'true' : 'false');
  if (active) {
    const tripSessionId = await prepareTripSessionForStart('navigation');
    if (await isBackgroundWorkAllowed()) {
      await BackgroundDriveController.start('navigation', tripSessionId);
    }
    return;
  }
  const driving = await AsyncStorage.getItem(BG_IS_DRIVING_KEY);
  if (driving !== 'true') await BackgroundDriveController.stop('app');
}

export async function setDrivingFlag(active: boolean): Promise<void> {
  await AsyncStorage.setItem(BG_IS_DRIVING_KEY, active ? 'true' : 'false');
  if (active) {
    const navigating = await AsyncStorage.getItem(BG_IS_NAVIGATING_KEY);
    const mode = navigating === 'true' ? 'navigation' : 'freeDrive';
    const tripSessionId = await prepareTripSessionForStart(mode);
    if (await isBackgroundWorkAllowed()) {
      await BackgroundDriveController.start(mode, tripSessionId);
    }
    return;
  }
  const navigating = await AsyncStorage.getItem(BG_IS_NAVIGATING_KEY);
  if (navigating !== 'true') await BackgroundDriveController.stop('app');
}

export async function recordDrivingTracePoint(
  latitude: number,
  longitude: number,
  opts?: {
    addDistanceKm?: number;
    speedKmh?: number;
    recordedAt?: number | string;
    altitudeM?: number | null;
    accuracyM?: number | null;
    headingDeg?: number | null;
    source?: 'foreground' | 'background' | 'native' | 'recovered';
  },
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
    const telemetryPoint: DriveTelemetryPoint = {
      latitude,
      longitude,
      recordedAt: new Date(opts?.recordedAt ?? now).toISOString(),
      speedKmh: Number.isFinite(Number(opts?.speedKmh)) ? Number(opts?.speedKmh) : null,
      altitudeM: Number.isFinite(Number(opts?.altitudeM)) ? Number(opts?.altitudeM) : null,
      accuracyM: Number.isFinite(Number(opts?.accuracyM)) ? Number(opts?.accuracyM) : null,
      headingDeg: Number.isFinite(Number(opts?.headingDeg)) ? Number(opts?.headingDeg) : null,
      source: opts?.source ?? 'foreground',
      accepted: true,
    };
    const seeded = routePts.length === 0
      ? [telemetryPoint]
      : routePts;
    const nextRoute = compactBgRoutePoints([...seeded, telemetryPoint]);

    const writes: Promise<any>[] = [
      AsyncStorage.setItem(BG_ROUTE_POINTS_KEY, JSON.stringify(nextRoute)),
    ];

    if (_tracePendingKm > 0) {
      const pending = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
      const nextPending = pending + _tracePendingKm;
      if (Number.isFinite(nextPending)) {
        writes.push(AsyncStorage.setItem(BG_PENDING_KM_KEY, String(nextPending)));
      }
    }

    if (opts?.speedKmh != null && Number.isFinite(opts.speedKmh) && opts.speedKmh >= 1) {
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

async function maybeIngestGamificationInBackground(
  latitude: number,
  longitude: number,
  speedMs: number | null | undefined,
  headingDeg: number | null | undefined,
): Promise<void> {
  const [navFlag, driveFlag] = await Promise.all([
    AsyncStorage.getItem(BG_IS_NAVIGATING_KEY),
    AsyncStorage.getItem(BG_IS_DRIVING_KEY),
  ]);
  if (navFlag !== 'true' && driveFlag !== 'true') return;

  const mode: NavMode = navFlag === 'true' ? 'navigation' : 'freeDrive';
  const now = Date.now();
  const lastAt = Number(await AsyncStorage.getItem(BG_LAST_INGEST_AT_KEY) ?? 0);
  const lastRaw = await AsyncStorage.getItem(BG_LAST_INGEST_LOC_KEY);
  let movedEnough = true;
  if (lastRaw) {
    try {
      const last = JSON.parse(lastRaw) as { lat?: number; lng?: number };
      const lastLat = Number(last?.lat);
      const lastLng = Number(last?.lng);
      if (Number.isFinite(lastLat) && Number.isFinite(lastLng)) {
        const movedM = haversineKm(lastLat, lastLng, latitude, longitude) * 1000;
        movedEnough = movedM >= BG_INGEST_MIN_MOVE_M;
      }
    } catch {
      movedEnough = true;
    }
  }
  if (!movedEnough && now - lastAt < BG_INGEST_REFRESH_MS) return;

  await ingestGamificationPing({
    lat: latitude,
    lng: longitude,
    mode,
    headingDeg: headingDeg ?? null,
    speedKmh: speedMs != null && speedMs >= 0 ? speedMs * 3.6 : null,
    ts: now,
  });
  await Promise.all([
    AsyncStorage.setItem(BG_LAST_INGEST_LOC_KEY, JSON.stringify({ lat: latitude, lng: longitude })),
    AsyncStorage.setItem(BG_LAST_INGEST_AT_KEY, String(now)),
  ]);
}

// ── BG task ───────────────────────────────────────────────────────────────────
// Hard rule: gdy użytkownik wyłączył „Śledzenie w tle" w ustawieniach, BG task
// MUSI być nieaktywny niezależnie od jazdy/nawigacji/share. Wcześniej navFlag/
// driveFlag potrafiły obejść przełącznik (BG GPS pracował podczas jazdy mimo
// wyłączonego BG w ustawieniach) — to złamanie obietnicy UX i baterii.
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;

  if (!(await isBackgroundWorkAllowed())) return;

  const locations = Array.isArray(data.locations) ? data.locations : [];
  const location = locations[locations.length - 1];
  if (!location) return;

  const [premiumStatus, activeConvoyId, activeConvoyHost] = await Promise.all([
    AsyncStorage.getItem(USER_IS_PREMIUM_KEY),
    AsyncStorage.getItem(BG_ACTIVE_CONVOY_ID_KEY),
    AsyncStorage.getItem(BG_ACTIVE_CONVOY_HOST_KEY),
  ]);
  if (premiumStatus !== 'true') {
    try {
      const rawState = await AsyncStorage.getItem(SMART_START_STATE_KEY);
      const state = rawState ? JSON.parse(rawState) as SmartStartState : initialSmartStartState();
      if (state.phase === 'driving') await finalizeTripSession({ reason: 'premium_expired', mode: 'freeDrive' });
      await AsyncStorage.removeItem(SMART_START_STATE_KEY);
    } catch { /* safe shutdown only */ }
    if (!activeConvoyId || activeConvoyHost !== 'true') return;
  }

  try {
    const token = await getAuthToken();
    if (!token) return;

    const { latitude, longitude, speed, accuracy, heading, altitude } = location.coords;
    const fixAt = Number.isFinite(Number(location.timestamp)) ? Number(location.timestamp) : Date.now();

    if (activeConvoyId && (premiumStatus === 'true' || activeConvoyHost === 'true')) {
      await fetch(`${API_URL}/api/convoys/${encodeURIComponent(activeConvoyId)}/position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ latitude, longitude, heading, speedKmh: Math.max(0, Number(speed || 0) * 3.6), accuracyM: accuracy, foreground: false, fixAt }),
      }).catch(() => null);
    }
    if (premiumStatus !== 'true') return;

    const [smartStartEnabled, navigationFlag, manualDriveFlag, destinationRaw] = await Promise.all([
      AsyncStorage.getItem(SMART_START_ENABLED_KEY),
      AsyncStorage.getItem(BG_IS_NAVIGATING_KEY),
      AsyncStorage.getItem(BG_IS_DRIVING_KEY),
      AsyncStorage.getItem(BG_NAV_DESTINATION_KEY),
    ]);
    const navigationSmartStopActive = navigationFlag === 'true' && manualDriveFlag === 'true' && destinationRaw != null;
    if (smartStartEnabled === 'true' || navigationSmartStopActive) {
      const rawState = await AsyncStorage.getItem(SMART_START_STATE_KEY);
      let smartState: SmartStartState;
      try { smartState = rawState ? JSON.parse(rawState) as SmartStartState : initialSmartStartState(); } catch { smartState = initialSmartStartState(); }
      // Smart Stop also protects a trip started manually. Previously the
      // manual-drive flag skipped the state machine entirely, so such a trip
      // could stay open for hours after parking.
      if (manualDriveFlag === 'true' && smartState.phase === 'idle') {
        smartState = { ...initialSmartStartState(), phase: 'driving', lastReliableAt: fixAt };
      }
      let destination: { latitude: number; longitude: number } | null = null;
      try {
        const parsed = destinationRaw ? JSON.parse(destinationRaw) : null;
        if (Number.isFinite(Number(parsed?.latitude)) && Number.isFinite(Number(parsed?.longitude))) {
          destination = { latitude: Number(parsed.latitude), longitude: Number(parsed.longitude) };
        }
      } catch { destination = null; }
      const evaluated = evaluateSmartStart(smartState, {
        latitude, longitude, timestamp: fixAt, speedKmh: Math.max(0, Number(speed || 0) * 3.6), accuracyM: accuracy ?? null,
      }, { navigating: navigationFlag === 'true', destination, now: Date.now() });
      await AsyncStorage.setItem(SMART_START_STATE_KEY, JSON.stringify(evaluated.state));
      if (evaluated.action === 'start' && smartStartEnabled === 'true') {
        await startDriveSession('freeDrive');
        const bufferedRoute = evaluated.state.buffer.map((point) => ({
          latitude: point.latitude, longitude: point.longitude, recordedAt: new Date(point.timestamp).toISOString(), speedKmh: point.speedKmh, accuracyM: point.accuracyM,
        }));
        await AsyncStorage.setItem(BG_ROUTE_POINTS_KEY, JSON.stringify(bufferedRoute));
        await Notifications.scheduleNotificationAsync({
          content: { title: 'Smart Start rozpoczął jazdę', body: 'VROOM wykrył ruch. Dotknij „Odrzuć”, jeśli to pomyłka.', categoryIdentifier: 'smart-start', data: { smartStart: true } },
          trigger: null,
        }).catch(() => {});
      } else if (evaluated.action === 'finish') {
        await finalizeTripSession({
          reason: 'auto_stop',
          mode: navigationFlag === 'true' ? 'navigation' : 'freeDrive',
        });
        await AsyncStorage.multiSet([
          [BG_IS_DRIVING_KEY, 'false'],
          [BG_IS_NAVIGATING_KEY, 'false'],
        ]);
        await AsyncStorage.multiRemove([SMART_START_STATE_KEY, BG_NAV_DESTINATION_KEY]);
        await BackgroundDriveController.stop('app').catch(() => {});
      }
    }

    // ── Send live location only when sharing is active (Ghost = zero POST) ─
    const sharingFlag = await AsyncStorage.getItem(BG_IS_SHARING_KEY);
    if (sharingFlag !== 'true') {
      // Ghost Mode / live off — skip live location entirely.
    } else {
      await sendLiveLocation({
          protocolVersion: 2,
          lat: latitude,
          lng: longitude,
          rawLat: latitude,
          rawLng: longitude,
          accuracyM: accuracy,
          heading,
          speedMps: speed,
          shareLocation: true,
          fixAt,
          fixId: `background:${fixAt}:${Number(latitude).toFixed(6)}:${Number(longitude).toFixed(6)}`,
          fixAgeMs: Math.max(0, Date.now() - fixAt),
          source: 'background',
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
      const trimmed = samples.slice(-400);
      await Promise.all([
        AsyncStorage.setItem(BG_SPEED_SAMPLES_KEY, JSON.stringify(trimmed)),
        AsyncStorage.setItem(BG_SPEED_MAX_KEY, String(kmh > curMax ? kmh : curMax)),
      ]);
    }

    // ── Accumulate distance ───────────────────────────────────────────────
    const nowMs = fixAt;
    const appActiveRaw = await AsyncStorage.getItem(BG_APP_ACTIVE_KEY);
    // Foreground TripStats already counts distance — skip BG accumulation when app is active.
    const shouldAccumulateDistance = !isAppLikelyActive(appActiveRaw, nowMs);
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
      const hasReliableSpeed = speedKmh != null && Number.isFinite(speedKmh) && speedKmh >= BG_MIN_REPORTED_SPEED_KMH;
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
        if (!Number.isFinite(newPending)) {
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
        const currentTelemetryPoint: DriveTelemetryPoint = {
          latitude,
          longitude,
          recordedAt: new Date(nowMs).toISOString(),
          speedKmh,
          altitudeM: Number.isFinite(Number(altitude)) ? Number(altitude) : null,
          accuracyM: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
          headingDeg: Number.isFinite(Number(heading)) ? Number(heading) : null,
          source: 'background',
          accepted: true,
        };
        const seedPts = routePts.length === 0
          ? [{
              latitude: lastLat,
              longitude: lastLng,
              recordedAt: new Date(lastTs).toISOString(),
              accuracyM: Number.isFinite(lastAcc) ? lastAcc : null,
              source: 'background',
              accepted: true,
            }]
          : routePts;
        const nextRoute = compactBgRoutePoints([
          ...seedPts,
          currentTelemetryPoint,
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
      altitude: altitude ?? null,
      heading: heading ?? null,
      speedKmh: speed != null && speed >= 0 ? speed * 3.6 : null,
    }));

    await maybeIngestGamificationInBackground(
      latitude,
      longitude,
      speed,
      heading ?? null,
    );
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
  smartStartEnabled: boolean = false,
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

  useEffect(() => {
    AsyncStorage.setItem(SMART_START_ENABLED_KEY, smartStartEnabled && isPremium && bgEnabled ? 'true' : 'false').catch(() => {});
  }, [bgEnabled, isPremium, smartStartEnabled]);

  useEffect(() => {
    void Notifications.setNotificationCategoryAsync('smart-start', [{ identifier: 'reject', buttonTitle: 'Odrzuć', options: { opensAppToForeground: true } }]);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.actionIdentifier !== 'reject' || response.notification.request.content.data?.smartStart !== true) return;
      void (async () => {
        const sessionId = await AsyncStorage.getItem(TRIP_SESSION_ID_KEY);
        if (sessionId) await clearFinalizedActiveSession(sessionId);
        await BackgroundDriveController.stop('app').catch(() => {});
        await AsyncStorage.multiRemove([
          SMART_START_STATE_KEY,
          TRIP_SESSION_ID_KEY,
          BG_ROUTE_POINTS_KEY,
        ]);
        await AsyncStorage.setItem(BG_IS_DRIVING_KEY, 'false');
      })();
    });
    return () => subscription.remove();
  }, []);
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
      routePoints?: DriveTelemetryPoint[];
      checkpointDistanceKm?: number;
    },
    sourceTag: 'navigation' | 'driving' = 'navigation',
  ) => {
    if (flushInFlightRef.current) return;
    flushInFlightRef.current = true;
    try {
      await consumeNativeDriveStatsToStorage();
      const token = await getAuthToken();
      if (token) {
        await flushPendingActivitySave(token);
      }

      if (fromNavigation) {
        // Collect foreground stats (fg) + background distance (bg) together
        const { avgSpeed, maxSpeed } = flushSpeedStatsSync();

        const bgPending    = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
        const bgRouteRaw   = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
        const bgRoutePoints: DriveTelemetryPoint[] = bgRouteRaw ? JSON.parse(bgRouteRaw) : [];
        const savedCheckpointKm = Math.max(
          safePendingKm(String(navPayload?.checkpointDistanceKm ?? 0)),
          await loadTripCheckpointSavedKm(),
        );
        const emergencySnapshot = await readEmergencyTripSave();
        const session = await getTripSessionContext();
        const navDistance = Number.isFinite(navPayload?.distanceKm) ? Number(navPayload?.distanceKm) : 0;
        const nativeOwnership = await resolveNativeDistanceOwnership(session.tripSessionId);
        const nativeStats = await BackgroundDriveController.getNativeStats();
        const distanceToSaveRaw = resolveFinalTripDistanceKm({
          nativeOwnsSession: nativeOwnership.nativeOwnsSession
            || (nativeStats.tripSessionId === session.tripSessionId && Number(nativeStats.distanceKm) > 0),
          nativeDistanceKm: Number(nativeStats.distanceKm),
          foregroundTripKm: navDistance,
          backgroundPendingKm: bgPending,
          checkpointKm: savedCheckpointKm,
          emergencySnapshotKm: emergencySnapshot?.distanceKm,
        });
        telemetryRef.current.navMergedFlushes += 1;
        telemetryRef.current.navMergedBgKm += bgPending;
        const distanceToSave = Math.max(
          Number.isFinite(distanceToSaveRaw) ? distanceToSaveRaw : 0,
          navDistance,
          savedCheckpointKm,
          Number(emergencySnapshot?.distanceKm) || 0,
        );
        const maxSpeedToSave = Math.max(navPayload?.maxSpeedKmh ?? 0, 0);
        const avgSpeedToSave = navPayload?.avgSpeedKmh != null && navPayload.avgSpeedKmh > 0
          ? navPayload.avgSpeedKmh
          : avgSpeed;
        const routePointsRaw = navPayload?.routePoints && navPayload.routePoints.length > 1
          ? navPayload.routePoints
          : (bgRoutePoints.length > 1
            ? bgRoutePoints
            : (emergencySnapshot?.trackedPoints && emergencySnapshot.trackedPoints.length > 1
              ? emergencySnapshot.trackedPoints
              : undefined));
        const routePointsToSave = trimRoutePointsForActivitySave(routePointsRaw);

        if (distanceToSave < 0.05) return;

        const payload = {
          tripSessionId: session.tripSessionId,
          distance: distanceToSave,
          maxSpeed: maxSpeedToSave,
          avgSpeed: avgSpeedToSave,
          duration: navPayload?.durationSec ?? null,
          routePoints: routePointsToSave,
          source: sourceTag === 'driving' ? 'drive_final' : 'navigation_final',
          startedAt: session.startedAt,
          endedAt: session.endedAt,
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
        if (!token) {
          await Promise.all([
            AsyncStorage.setItem(BG_PENDING_ACTIVITY_SAVE_KEY, JSON.stringify(payload)),
            AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false'),
          ]);
          telemetryRef.current.pendingRetrySaved += 1;
          return;
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
            false &&
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
              await clearTripSession();
              void syncProfileStatsFromServer();
              return;
            }
          }

          await Promise.all([
            AsyncStorage.setItem(BG_PENDING_ACTIVITY_SAVE_KEY, JSON.stringify(payload)),
            AsyncStorage.setItem(BG_IS_NAVIGATING_KEY, 'false'),
          ]);
          await clearTripSession();
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
        await clearTripSession();
        void syncProfileStatsFromServer();

      } else {
        if (!token) return;
        // Passive flush: no navigation was active, save whatever background accumulated
        const bgPending    = safePendingKm(await AsyncStorage.getItem(BG_PENDING_KM_KEY));
        const bgRouteRaw   = await AsyncStorage.getItem(BG_ROUTE_POINTS_KEY);
        const bgRoutePoints: DriveTelemetryPoint[] = bgRouteRaw ? JSON.parse(bgRouteRaw) : [];
        if (bgPending < 0.05) return;

        const samplesRaw = await AsyncStorage.getItem(BG_SPEED_SAMPLES_KEY);
        const samples: number[] = samplesRaw ? JSON.parse(samplesRaw) : [];
        const maxRaw    = await AsyncStorage.getItem(BG_SPEED_MAX_KEY);
        const maxSpeed  = parseFloat(maxRaw ?? '0');
        const avgSpeed  = samples.length > 0
          ? samples.reduce((a, b) => a + b, 0) / samples.length
          : 0;

        const savedCheckpointKm = await loadTripCheckpointSavedKm();
        const saveResOk = await saveIncrementalTripKm({
          distanceKm: savedCheckpointKm + bgPending,
          maxSpeedKmh: maxSpeed,
          avgSpeedKmh: avgSpeed,
          source: 'background-passive',
        });
        if (!saveResOk) {
          console.log('flushPendingKm(passive checkpoint) failed - BG_PENDING_KM preserved for retry');
          telemetryRef.current.flushFail += 1;
          return;
        }
        /*
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
        */
        telemetryRef.current.flushSuccess += 1;
        await persistTripCheckpointSavedKm(Math.max(savedCheckpointKm, saveResOk.checkpointDistanceKm));
        void syncProfileStatsFromServer();

        await Promise.all([
          AsyncStorage.setItem(BG_PENDING_KM_KEY, '0'),
          AsyncStorage.removeItem(BG_ROUTE_POINTS_KEY),
          AsyncStorage.removeItem(BG_SPEED_SAMPLES_KEY),
          AsyncStorage.removeItem(BG_SPEED_MAX_KEY),
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

  useEffect(() => {
    void flushPendingTripCheckpoint();
    void flushTripSessionFinalizationOutbox();
    const id = setInterval(() => {
      void flushPendingTripCheckpoint();
      void flushTripSessionFinalizationOutbox();
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Task management ───────────────────────────────────────────────────────
  const shouldPreserveNativeDrive = useCallback(async () => {
    if (!(await isBackgroundWorkAllowed())) return false;
    try {
      const state = await BackgroundDriveController.getState();
      // Both platforms own the background distance ledger natively.  Keep the
      // Expo task off while that ledger is active or it would double-count km.
      return state?.active === true;
    } catch {
      return false;
    }
  }, []);

  const startBackgroundTracking = useCallback(async () => {
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    try {
      // Hard runtime guard: never run BG task when user disabled the toggle.
      const persistedBgSetting = await AsyncStorage.getItem(BG_TRACKING_SETTING_KEY);
      const bgAllowed = bgEnabledRef.current && persistedBgSetting === 'true';
      if (!bgAllowed || !isPremium) {
        const preserveNativeDrive = await shouldPreserveNativeDrive();
        if (Platform.OS === 'android' && !preserveNativeDrive) {
          await stopVroomBgForegroundNotification();
        }
        if (!preserveNativeDrive) await BackgroundDriveController.stop('app');
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          telemetryRef.current.bgStops += 1;
        }
        return;
      }

      const shouldTrack = forceEnabled && bgAllowed;
      if (!shouldTrack) {
        const preserveNativeDrive = await shouldPreserveNativeDrive();
        if (!preserveNativeDrive) await BackgroundDriveController.stop('app');
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          telemetryRef.current.bgStops += 1;
        }
        return;
      }

      const [navFlagBeforeStart, stationaryFlagBeforeStart] = await Promise.all([
        AsyncStorage.getItem(BG_IS_NAVIGATING_KEY),
        AsyncStorage.getItem(BG_GPS_STATIONARY_KEY),
      ]);

      const disclosureAccepted = await hasAcceptedBackgroundLocationDisclosure();
      if (!disclosureAccepted) return;

      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== 'granted') return;
      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') return;
      const [navFlag, stationaryFlag, driveFlag] = await Promise.all([
        AsyncStorage.getItem(BG_IS_NAVIGATING_KEY),
        AsyncStorage.getItem(BG_GPS_STATIONARY_KEY),
        AsyncStorage.getItem(BG_IS_DRIVING_KEY),
      ]);
      const isNavigatingBg = navFlag === 'true';
      const isDrivingBg = driveFlag === 'true';
      const isStationaryBg = stationaryFlag === 'true';
      const tripSessionId = await ensureTripSessionId();
      const nativeDriveStarted = await BackgroundDriveController.start(
        isNavigatingBg ? 'navigation' : 'freeDrive',
        tripSessionId,
      );
      // Prefer native even if start() was a no-op on an already-running session.
      const nativeOwnsGps = nativeDriveStarted || (await shouldPreserveNativeDrive());

      // The native ledger owns GPS and checkpointing on both Android and iOS.
      // Retain Expo only as a fallback for an older binary without the module.
      if (nativeOwnsGps) {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          telemetryRef.current.bgStops += 1;
        }
        lastBgCadenceRef.current = null;
        return;
      }

      const appIsActive = AppState.currentState === 'active';
      // Foreground: native service stays alive for Android kill/recents survival;
      // Expo task is disabled to avoid a second JS distance ledger.
      if (appIsActive) {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          telemetryRef.current.bgStops += 1;
        }
        lastBgCadenceRef.current = null;
        return;
      }

      // Last-chance guard: never co-exist with a native broker that came online mid-start.
      if (await shouldPreserveNativeDrive()) {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          telemetryRef.current.bgStops += 1;
        }
        lastBgCadenceRef.current = null;
        return;
      }

      const highCadence = isSharing || isNavigatingBg || isDrivingBg || (forceEnabled && !isStationaryBg);
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
        ...(Platform.OS === 'android'
          ? {
              foregroundService: {
                notificationTitle: 'VROOM — statystyki jazdy',
                notificationBody:  'Zliczanie km w tle · dotknij Zakończ aby wyłączyć',
                notificationColor: '#e33835',
                killServiceOnDestroy: false,
              },
            }
          : {
              pausesUpdatesAutomatically: false,
              activityType: Location.ActivityType.AutomotiveNavigation,
              ...(highCadence
                ? {}
                : {
                    deferredUpdatesInterval: 30_000,
                    deferredUpdatesDistance: 120,
                  }),
            }),
      });
      lastBgCadenceRef.current = cadenceKey;
      telemetryRef.current.bgStarts += 1;
      if (forceEnabled) telemetryRef.current.forceStarts += 1;
    } catch (e: any) {
      console.log('⚠️ startBackgroundTracking error:', e?.message ?? e);
    } finally {
      startInFlightRef.current = false;
    }
  }, [bgEnabled, isSharing, forceEnabled, isPremium, shouldPreserveNativeDrive]);

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
      await BackgroundDriveController.stop('app');
      await stopBgLocationUpdates();
    } finally {
      stopInFlightRef.current = false;
    }
  }, [stopBgLocationUpdates]);

  // Powiadomienie Android gdy włączone śledzenie w tle (lekki, jednorazowy).
  useEffect(() => {
    if (!bgEnabled || !isPremium) {
      void (async () => {
        const preserveNativeDrive = await shouldPreserveNativeDrive();
        if (Platform.OS === 'android' && !preserveNativeDrive) {
          await stopVroomBgForegroundNotification();
        }
        if (!preserveNativeDrive) {
          await BackgroundDriveController.stop('app');
        }
        await stopBgLocationUpdates();
      })();
      return;
    }
  }, [bgEnabled, isPremium, shouldPreserveNativeDrive, stopBgLocationUpdates]);

  // Auto-start GPS w tle tylko podczas aktywnej jazdy/nawigacji i włączonej Pracy w tle.
  useEffect(() => {
    if (forceEnabled && bgEnabled) {
      const timer = setTimeout(() => startBackgroundTracking(), 500);
      return () => clearTimeout(timer);
    }
    void (async () => {
      const preserveNativeDrive = await shouldPreserveNativeDrive();
      await stopBgLocationUpdates();
      if (preserveNativeDrive) return;
      await BackgroundDriveController.stop('app');
      if (!forceEnabled) flushPendingKm(false);
    })();
  }, [bgEnabled, forceEnabled, startBackgroundTracking, stopBgLocationUpdates, flushPendingKm, shouldPreserveNativeDrive]);

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
        void flushPendingTripCheckpoint();
        void flushTripSessionFinalizationOutbox();
        if (!activeHeartbeat) {
          activeHeartbeat = setInterval(() => {
            persistAppActive(true);
          }, BG_APP_ACTIVE_HEARTBEAT_MS);
        }
        void (async () => {
          const preserveNativeDrive = await shouldPreserveNativeDrive();
          if (!preserveNativeDrive) {
            await flushPendingKm(false);
          }
          await stopBgLocationUpdates();
        })();
        return;
      }
      if (activeHeartbeat) {
        clearInterval(activeHeartbeat);
        activeHeartbeat = null;
      }
      if (s === 'inactive' || s === 'background') {
        if (s === 'background') void flushTracePendingKmToStorage();
        persistAppActive(false);
        if (forceEnabledRef.current && bgEnabledRef.current) {
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

  return {
    startBackgroundTracking,
    stopBackgroundTracking,
    flushPendingKm,
    finalizeTripSession,
  };
}
