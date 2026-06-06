/**
 * Pełna historia jazdy/nawigacji pod ADB logcat.
 *
 * Po jeździe (telefon pod USB):
 *   adb logcat -d -v time | findstr "VROOM-TEL"
 *   lub: cd vroom\scripts && .\adb-dump-vroom-logs.ps1
 *
 * Kluczowe tagi:
 *   DRIVE_TRACE_SESSION  — start/koniec trip
 *   DRIVE_TRACE_RAW      — surowy fix GPS (każdy tick)
 *   DRIVE_TRACE_TICK     — pełny snapshot: raw → snap → marker → prędkość → feed
 *   DRIVE_TRACE_REJECT   — odrzucony fix (core / bramka / hard jump)
 *   DRIVE_TRACE_FALLBACK — fallback gdy core zwróci false
 *   DRIVE_TRACE_MARKER_UI — pozycja markera na mapie (throttle ~200 ms)
 *   DRIVE_TRACE_CAMERA   — follow kamery (throttle ~300 ms)
 */
import { DRIVE_SESSION_TRACE_ENABLED, DRIVE_FULL_VISION_LOG } from './driveLogConfig';
import { gpsTickPayload } from './gpsTickTrace';
import { vroomGpsLogNow } from './vroomGpsLog';

let seq = 0;
const throttleAt: Record<string, number> = {};

function round6(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(6)) : n;
}

function round1(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(1)) : n;
}

export function driveSessionLog(
  tag: string,
  payload?: Record<string, unknown>,
): void {
  if (!DRIVE_SESSION_TRACE_ENABLED) return;
  seq += 1;
  vroomGpsLogNow(tag, {
    seq,
    ...gpsTickPayload(payload),
    ...(payload ?? {}),
  });
}

export function driveSessionLogThrottled(
  tag: string,
  payload: Record<string, unknown>,
  minMs: number,
): void {
  if (!DRIVE_SESSION_TRACE_ENABLED) return;
  const now = Date.now();
  if (minMs > 0 && now - (throttleAt[tag] ?? 0) < minMs) return;
  throttleAt[tag] = now;
  driveSessionLog(tag, payload);
}

export function driveTraceHeartbeat(payload: Record<string, unknown>): void {
  driveSessionLogThrottled('DRIVE_TRACE_HEARTBEAT', payload, 5000);
}

export function driveTraceSession(
  event: 'driving_start' | 'driving_end' | 'nav_start' | 'nav_end' | 'trip_sync',
  extra?: Record<string, unknown>,
): void {
  driveSessionLog('DRIVE_TRACE_SESSION', { event, ...(extra ?? {}) });
}

/** Surowy fix z watchPositionAsync — wejście pipeline. */
export function driveTraceRaw(payload: {
  lat: number;
  lng: number;
  acc: number;
  speedKmh: number;
  speedMs: number | null;
  heading: number | null;
  tripActive: boolean;
  driving: boolean;
  navigating: boolean;
  osTimestamp?: number | null;
}): void {
  driveSessionLog('DRIVE_TRACE_RAW', {
    rawLat: round6(payload.lat),
    rawLng: round6(payload.lng),
    accM: Math.round(payload.acc),
    speedKmh: round1(payload.speedKmh),
    speedMs: payload.speedMs != null ? round1(payload.speedMs) : null,
    heading: payload.heading != null && Number.isFinite(payload.heading)
      ? Math.round(payload.heading)
      : null,
    tripActive: payload.tripActive,
    driving: payload.driving,
    navigating: payload.navigating,
    osTimestamp: payload.osTimestamp ?? null,
  });
}

/** Pełny snapshot jednego ticka GPS po przetworzeniu (V2 SSOT). */
export function driveTraceTick(payload: {
  rawLat: number;
  rawLng: number;
  snapLat: number;
  snapLng: number;
  markerLat: number;
  markerLng: number;
  markerHdg: number;
  markerSvLat?: number;
  markerSvLng?: number;
  markerSvHdg?: number;
  accM: number;
  hudKmh: number;
  engineKmh: number;
  dopplerKmh: number;
  feedDurMs: number;
  cadenceMs: number;
  feedSpeedMs: number;
  isNavigating: boolean;
  isFreeDrive: boolean;
  isMoving: boolean;
  feedSkipGate?: boolean;
  feedAccepted?: boolean;
  feedHeadingOnly?: boolean;
  source?: string;
  markerRawGapM?: number;
  svGapM?: number;
  hdgFlipDeg?: number;
  pushSegM?: number;
  catchupSoft?: boolean;
  onRoad?: boolean;
  chaseM?: number;
  engineSnapLat?: number;
  engineSnapLng?: number;
  crossTrackM?: number;
}): void {
  driveSessionLog('DRIVE_TRACE_TICK', {
    rawLat: round6(payload.rawLat),
    rawLng: round6(payload.rawLng),
    snapLat: round6(payload.snapLat),
    snapLng: round6(payload.snapLng),
    markerLat: round6(payload.markerLat),
    markerLng: round6(payload.markerLng),
    markerHdg: Math.round(payload.markerHdg),
    markerSvLat: payload.markerSvLat != null ? round6(payload.markerSvLat) : null,
    markerSvLng: payload.markerSvLng != null ? round6(payload.markerSvLng) : null,
    markerSvHdg: payload.markerSvHdg != null ? Math.round(payload.markerSvHdg) : null,
    accM: Math.round(payload.accM),
    hudKmh: round1(payload.hudKmh),
    engineKmh: round1(payload.engineKmh),
    dopplerKmh: round1(payload.dopplerKmh),
    feedDurMs: Math.round(payload.feedDurMs),
    cadenceMs: Math.round(payload.cadenceMs),
    feedSpeedMs: round1(payload.feedSpeedMs),
    isNavigating: payload.isNavigating,
    isFreeDrive: payload.isFreeDrive,
    isMoving: payload.isMoving,
    feedSkipGate: payload.feedSkipGate ?? false,
    feedAccepted: payload.feedAccepted ?? true,
    feedHeadingOnly: payload.feedHeadingOnly ?? false,
    source: payload.source ?? 'drive_core_v2',
    markerRawGapM: payload.markerRawGapM != null ? round1(payload.markerRawGapM) : null,
    svGapM: payload.svGapM != null ? round1(payload.svGapM) : null,
    hdgFlipDeg: payload.hdgFlipDeg != null ? Math.round(payload.hdgFlipDeg) : null,
    pushSegM: payload.pushSegM != null ? round1(payload.pushSegM) : null,
    catchupSoft: payload.catchupSoft ?? false,
    onRoad: payload.onRoad ?? null,
    chaseM: payload.chaseM != null ? round1(payload.chaseM) : null,
    engineSnapLat: payload.engineSnapLat != null ? round6(payload.engineSnapLat) : null,
    engineSnapLng: payload.engineSnapLng != null ? round6(payload.engineSnapLng) : null,
    crossTrackM: payload.crossTrackM != null ? round1(payload.crossTrackM) : null,
  });
}

/** Szczegółowy pipeline markera — każdy tick GPS (grep: MARKER_PIPELINE). */
export function driveTraceMarkerPipeline(payload: Record<string, unknown>): void {
  driveSessionLog('MARKER_PIPELINE', payload);
}

/** Push kamery z markera SV (grep: CAMERA_PIPELINE). */
export function driveTraceCameraPipeline(payload: Record<string, unknown>): void {
  driveSessionLogThrottled('CAMERA_PIPELINE', payload, DRIVE_FULL_VISION_LOG ? 120 : 240);
}

/** rAF MarkerView — diagnostyka (throttle logów, nie renderu). */
export function driveTraceMarkerUiSmooth(payload: {
  lat: number;
  lng: number;
  hdg: number;
  uiMoveM: number;
  uiHdgDeltaDeg: number;
  msSinceCommit: number;
  svGapM?: number;
}): void {
  driveSessionLogThrottled('MARKER_UI_SMOOTH', {
    lat: round6(payload.lat),
    lng: round6(payload.lng),
    hdg: Math.round(payload.hdg),
    uiMoveM: round1(payload.uiMoveM),
    uiHdgDeltaDeg: Math.round(payload.uiHdgDeltaDeg),
    msSinceCommit: Math.round(payload.msSinceCommit),
    svGapM: payload.svGapM != null ? round1(payload.svGapM) : null,
  }, DRIVE_FULL_VISION_LOG ? 500 : 1000);
}

export function driveTraceReject(
  reason: string,
  payload?: Record<string, unknown>,
): void {
  driveSessionLog('DRIVE_TRACE_REJECT', { reason, ...(payload ?? {}) });
}

export function driveTraceFallback(payload: Record<string, unknown>): void {
  driveSessionLog('DRIVE_TRACE_FALLBACK', payload);
}

export function driveTraceMarkerUi(payload: {
  lat: number;
  lng: number;
  moveM?: number;
  msSinceLast?: number;
}): void {
  driveSessionLogThrottled('DRIVE_TRACE_MARKER_UI', {
    lat: round6(payload.lat),
    lng: round6(payload.lng),
    moveM: payload.moveM != null ? round1(payload.moveM) : null,
    msSinceLast: payload.msSinceLast ?? null,
  }, 200);
}

export function driveTraceCamera(payload: {
  lat: number;
  lng: number;
  hdg: number;
  speedKmh: number;
  exploring: boolean;
  frameMoveM?: number;
}): void {
  driveSessionLogThrottled('DRIVE_TRACE_CAMERA', {
    lat: round6(payload.lat),
    lng: round6(payload.lng),
    hdg: Math.round(payload.hdg),
    speedKmh: round1(payload.speedKmh),
    exploring: payload.exploring,
    frameMoveM: payload.frameMoveM != null ? round1(payload.frameMoveM) : null,
  }, DRIVE_FULL_VISION_LOG ? 80 : 150);
}

export { DRIVE_SESSION_TRACE_ENABLED } from './driveLogConfig';
