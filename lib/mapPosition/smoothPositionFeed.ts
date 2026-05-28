import { DISPLAY_NOTIFY_MIN_MS } from '../../constants/mapPerformance';
import { gpsTickPayload } from '../gpsTickTrace';
import { logGpsTickLayer } from '../gpsTickTraceLog';
import { markerLogCritical } from '../markerPipelineLog';
import { vroomGpsLog } from '../vroomGpsLog';

export { DISPLAY_NOTIFY_MIN_MS };
import {
  feedJumpRejectReason,
  isAbsurdGlobeCoordinate,
  logFeedJumpReject,
} from './feedCoordinateGuard';

export type SmoothTarget = {
  latitude: number;
  longitude: number;
  heading: number;
  /** Expected time until next GPS fix (ms). */
  durationMs?: number;
  /** Speed in m/s — worklet forward cruise po dotarciu do kotwicy. */
  speedMs?: number;
  /** Opcjonalna geometria drogi/route w oknie wokół kotwicy (do DR po łuku). */
  roadPts?: { latitude: number; longitude: number }[];
  /** Diagnostyka — źródło feedu (tylko v10_* w trybie jazdy). */
  source?: string;
};

type FeedHandler = (target: SmoothTarget) => void;
type DisplayListener = (lat: number, lng: number, hdg: number) => void;

let handler: FeedHandler | null = null;
let handlerOwnerId: string | null = null;
const displayListeners = new Set<DisplayListener>();
let lastDisplayNotifyMs = 0;

const INSTANT_FEED_SOURCES = new Set([
  'v10_apply_trip_instant',
  'v10_apply_chase_instant',
  'v10_bootstrap_instant',
  'bump_active_instant',
  'bootstrap',
  'recovery',
  'driving_nav_bootstrap',
  'stall_recovery',
  'v10_lag_catchup_instant',
]);

const DEPRECATED_SOURCES = new Set([
  'v10_sub_anchor_stream',
  'v10_foreground_glide',
  'road_frame_glide',
]);

function sourcePriority(source: string): number {
  if (FORCE_PRIORITY_SOURCES.has(source)) return 95;
  if (source.includes('instant') || source.includes('bootstrap')) return 100;
  if (source === 'v10_live_follow') return 85;
  if (source === 'v10_direct_cruise_feed' || source === 'v10_live_cruise') return 80;
  if (source === 'v10_arc_stale_snap') return 88;
  if (source === 'v10_stationary_hold') return 70;
  if (source === 'bg_projection') return 10;
  return 40;
}

function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeSmoothTarget(target: SmoothTarget): SmoothTarget {
  if (target.durationMs !== 0) return target;
  const src = String(target.source ?? '');
  if (
    INSTANT_FEED_SOURCES.has(src)
    || src.includes('bootstrap')
    || src === 'v10_stationary_hold'
  ) {
    return target;
  }
  markerLogCritical('FEED_INSTANT_COERCED', {
    source: src,
    coercedMs: 320,
  });
  return { ...target, durationMs: 320 };
}

function isTrueInstantBootstrap(target: SmoothTarget): boolean {
  if (target.durationMs !== 0) return false;
  const src = String(target.source ?? '');
  return INSTANT_FEED_SOURCES.has(src) || src.includes('bootstrap');
}

let lastTarget: SmoothTarget | null = null;
let lastFeedAtMs = 0;
let lastFeedSource = '';
let lastFeedWithMoveAtMs = 0;
let markerStaleRawToSnapM = 0;

/** Ustawiane z MARKER_PIPE — poluzowanie v10_duplicate_micro przy dużym dryfie raw↔snap. */
export function setMarkerStaleRawToSnapM(m: number): void {
  markerStaleRawToSnapM = Number.isFinite(m) ? Math.max(0, m) : 0;
}

const FORCE_PRIORITY_SOURCES = new Set([
  'stall_recovery',
  'v10_arc_stale_snap',
  'v10_apply_trip_instant',
  'v10_apply_chase_instant',
]);

function shouldDropFeed(normalized: SmoothTarget): string | null {
  const src = String(normalized.source ?? 'unknown');
  if (DEPRECATED_SOURCES.has(src)) {
    return 'deprecated_source';
  }
  const now = Date.now();
  if (
    src === 'smooth_marker_mount'
    && lastFeedSource.startsWith('v10_')
    && now - lastFeedAtMs < 8000
  ) {
    return 'smooth_marker_mount_after_v10';
  }
  if (!lastTarget) return null;

  if (src === 'bg_projection' && lastFeedSource.startsWith('v10_') && now - lastFeedAtMs < 2500) {
    return 'bg_projection_blocked';
  }

  const movedM = haversineM(
    lastTarget.latitude,
    lastTarget.longitude,
    normalized.latitude,
    normalized.longitude,
  );
  const dtMs = now - lastFeedAtMs;
  const newPri = sourcePriority(src);
  const oldPri = sourcePriority(lastFeedSource);

  if (
    FORCE_PRIORITY_SOURCES.has(src)
    || src === 'v10_arc_stale_snap'
  ) {
    return null;
  }

  const isV10TripFeed =
    src === 'v10_live_cruise'
    || src === 'v10_direct_cruise_feed'
    || src === 'v10_apply_trip_instant';
  if (src === 'v10_stationary_hold') {
    if (movedM < 0.55 && dtMs < 1200) return 'stationary_duplicate';
    return null;
  }

  if (isV10TripFeed) {
    const staleBypass = markerStaleRawToSnapM > 15 || dtMs > 800;
    if (dtMs < 8 && movedM < 0.02 && !staleBypass) return 'v10_duplicate_micro';
    return null;
  }

  if (
    dtMs < 50
    && movedM < 0.2
    && lastFeedSource
    && src !== lastFeedSource
    && newPri <= oldPri
  ) {
    markerLogCritical('WRITER_CONFLICT', {
      newSource: src,
      lastSource: lastFeedSource,
      dtMs,
      movedM: Number(movedM.toFixed(3)),
      newPri,
      oldPri,
    });
  }
  if (dtMs < 45 && movedM < 0.35 && newPri <= oldPri) {
    return 'coalesce_low_pri';
  }
  if (dtMs < 120 && movedM < 1.2 && src === lastFeedSource) {
    // iOS bg: kroki ~1.2 m co 100 ms — nie wycinaj całego strumienia (535× REJECT w telemetrii).
    if (src === 'bg_projection' && movedM >= 0.85) return null;
    return 'coalesce_same_source';
  }
  return null;
}

/** UI→JS sync pozycji markera (opcjonalni słuchacze). */
export function subscribeSmoothPositionDisplay(fn: DisplayListener): () => void {
  displayListeners.add(fn);
  return () => {
    displayListeners.delete(fn);
  };
}

export function notifySmoothPositionDisplay(lat: number, lng: number, hdg: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const now = Date.now();
  if (now - lastDisplayNotifyMs < DISPLAY_NOTIFY_MIN_MS) return;
  lastDisplayNotifyMs = now;
  displayListeners.forEach((fn) => {
    try {
      fn(lat, lng, hdg);
    } catch {
      /* listener po unmount */
    }
  });
}

export function clearSmoothPositionFeed(): void {
  lastTarget = null;
  lastFeedAtMs = 0;
  lastFeedSource = '';
  lastFeedWithMoveAtMs = 0;
  markerStaleRawToSnapM = 0;
}

export function registerSmoothPositionHandler(fn: FeedHandler | null, ownerId = 'default'): void {
  if (fn) {
    handler = fn;
    handlerOwnerId = ownerId;
  } else if (handlerOwnerId === ownerId || ownerId === 'default') {
    handler = null;
    handlerOwnerId = null;
  } else {
    return;
  }
  if (fn && lastTarget) {
    vroomGpsLog('WORKLET_HANDLER_REGISTERED', {
      hasLastTarget: !!lastTarget,
    }, 0);
    const replay = normalizeSmoothTarget(lastTarget);
    fn(replay);
    if (isTrueInstantBootstrap(replay)) {
      notifySmoothPositionDisplay(
        replay.latitude,
        replay.longitude,
        replay.heading,
      );
    }
  } else if (!fn) {
    vroomGpsLog('WORKLET_HANDLER_UNREGISTERED', {}, 0);
  }
}

/**
 * JEDYNY wpis pozycji markera w V10. Wszystkie inne ścieżki muszą iść przez applyTripPosition.
 */
export function feedSmoothPositionTarget(target: SmoothTarget): void {
  const cleaned: SmoothTarget = { ...target };
  if (!Number.isFinite(cleaned.heading)) {
    cleaned.heading = 0;
  }
  if (cleaned.speedMs != null && !Number.isFinite(cleaned.speedMs)) {
    cleaned.speedMs = 0;
  }

  if (!Number.isFinite(cleaned.latitude) || !Number.isFinite(cleaned.longitude)) {
    vroomGpsLog('WORKLET_FEED_CRITICAL_INVALID', {
      lat: cleaned.latitude,
      lng: cleaned.longitude,
      hdg: cleaned.heading,
      source: cleaned.source ?? 'unknown',
    }, 0);
    return;
  }

  if (isAbsurdGlobeCoordinate(cleaned.latitude, cleaned.longitude)) {
    markerLogCritical('WORKLET_FEED_COORD_REJECT', {
      reason: 'absurd_coordinate_precheck',
      source: cleaned.source ?? 'unknown',
      lat: cleaned.latitude,
      lng: cleaned.longitude,
    });
    return;
  }

  const normalized = normalizeSmoothTarget(cleaned);
  const src = String(normalized.source ?? 'unknown');

  const movedFromIncomingM = lastTarget
    ? haversineM(
      lastTarget.latitude,
      lastTarget.longitude,
      normalized.latitude,
      normalized.longitude,
    )
    : null;
  const dtSinceIncomingMs = lastFeedAtMs > 0 ? Date.now() - lastFeedAtMs : null;
  logGpsTickLayer('FEED_WORKLET_CALL', {
    layer: 'feedSmoothPositionTarget',
    lat: Number(normalized.latitude.toFixed(6)),
    lng: Number(normalized.longitude.toFixed(6)),
    durationMs: normalized.durationMs ?? null,
    speedMs: normalized.speedMs != null ? Number(normalized.speedMs.toFixed(2)) : null,
    source: src,
    movedFromLastM: movedFromIncomingM != null ? Number(movedFromIncomingM.toFixed(2)) : null,
    dtSinceLastMs: dtSinceIncomingMs,
    instantTeleport: normalized.durationMs === 0,
    asyncSpamSuspect: dtSinceIncomingMs != null && dtSinceIncomingMs < 8 && (movedFromIncomingM ?? 0) < 0.05,
  });

  const coordReject = feedJumpRejectReason(normalized, lastTarget);
  if (coordReject) {
    logFeedJumpReject(coordReject, normalized, lastTarget);
    return;
  }

  const dropReason = shouldDropFeed(normalized);
  if (dropReason) {
    markerLogCritical('WORKLET_FEED_REJECT', gpsTickPayload({
      reason: dropReason,
      source: src,
      dtMs: dtSinceIncomingMs,
      movedM: movedFromIncomingM != null ? Number(movedFromIncomingM.toFixed(2)) : null,
      lastSource: lastFeedSource || null,
      lat: Number(normalized.latitude.toFixed(6)),
      lng: Number(normalized.longitude.toFixed(6)),
      speedMs: normalized.speedMs ?? null,
      instantTeleport: normalized.durationMs === 0,
    }));
    return;
  }

  const movedFromLastM = lastTarget
    ? haversineM(
      lastTarget.latitude,
      lastTarget.longitude,
      normalized.latitude,
      normalized.longitude,
    )
    : null;
  vroomGpsLog('WORKLET_FEED', {
    source: src,
    lat: Number(normalized.latitude.toFixed(6)),
    lng: Number(normalized.longitude.toFixed(6)),
    hdg: Math.round(normalized.heading || 0),
    durationMs: normalized.durationMs ?? null,
    speedMs: normalized.speedMs != null ? Number(normalized.speedMs.toFixed(2)) : null,
    movedFromLastM: movedFromLastM != null ? Number(movedFromLastM.toFixed(2)) : null,
    dtSinceLastMs: lastFeedAtMs > 0 ? Date.now() - lastFeedAtMs : null,
    hasHandler: !!handler,
  }, 1200);

  lastTarget = normalized;
  const feedNow = Date.now();
  lastFeedAtMs = feedNow;
  lastFeedSource = src;
  if (movedFromLastM != null && movedFromLastM >= 0.35) {
    lastFeedWithMoveAtMs = feedNow;
  }
  handler?.(normalized);
  if (handler && isTrueInstantBootstrap(normalized)) {
    notifySmoothPositionDisplay(normalized.latitude, normalized.longitude, normalized.heading);
  }
}
