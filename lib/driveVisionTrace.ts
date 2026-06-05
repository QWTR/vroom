/**
 * Skorelowany „widok oczami kierowcy” — jeden strumień DRIVE_VISION_* na test jazdy.
 */
import { DRIVE_FULL_VISION_LOG, DRIVE_SESSION_TRACE_ENABLED } from './driveLogConfig';
import { getGpsTickId, gpsTickPayload } from './gpsTickTrace';
import { vroomGpsLogNow } from './vroomGpsLog';

let seq = 0;
const throttleAt: Record<string, number> = {};

const VISION_FRAME_THROTTLE_MS = DRIVE_FULL_VISION_LOG ? 500 : 2000;
const VISION_CAMERA_THROTTLE_MS = DRIVE_FULL_VISION_LOG ? 500 : 2000;

function visionEnabled(): boolean {
  return DRIVE_SESSION_TRACE_ENABLED;
}

function round6(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(6)) : n;
}

function round1(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(1)) : n;
}

function emitVision(
  tag: string,
  payload: Record<string, unknown>,
  throttleMs = 0,
): void {
  if (!visionEnabled()) return;
  const now = Date.now();
  if (throttleMs > 0) {
    const last = throttleAt[tag] ?? 0;
    if (now - last < throttleMs) return;
    throttleAt[tag] = now;
  }
  seq += 1;
  vroomGpsLogNow(tag, {
    seq,
    gpsTickId: getGpsTickId(),
    ...gpsTickPayload(),
    ...payload,
  });
}

export type VisionTickPayload = {
  mode: 'drive' | 'nav' | 'idle';
  rawLat: number;
  rawLng: number;
  snapLat?: number;
  snapLng?: number;
  markerLat: number;
  markerLng: number;
  markerHdg: number;
  markerSvLat?: number;
  markerSvLng?: number;
  markerSvHdg?: number;
  accM?: number;
  hudKmh?: number;
  engineKmh?: number;
  dopplerKmh?: number;
  crossTrackM?: number | null;
  onRoad?: boolean | null;
  source?: string;
  rawStepM?: number | null;
  markerRawGapM?: number | null;
  svGapM?: number | null;
  chaseM?: number | null;
  catchupSoft?: boolean;
  hdgFlipDeg?: number | null;
  pushSegM?: number | null;
  feedDurMs?: number;
  teleportClamp?: boolean;
  megaJumpBlocked?: boolean;
  feedSkipGate?: boolean;
  stationaryHold?: boolean;
};

/** Pełny snapshot jednego ticka GPS (V2 SSOT) — bez throttlingu. */
export function visionTickFromV2(payload: VisionTickPayload): void {
  emitVision('DRIVE_VISION_TICK', {
    mode: payload.mode,
    rawLat: round6(payload.rawLat),
    rawLng: round6(payload.rawLng),
    snapLat: payload.snapLat != null ? round6(payload.snapLat) : null,
    snapLng: payload.snapLng != null ? round6(payload.snapLng) : null,
    markerLat: round6(payload.markerLat),
    markerLng: round6(payload.markerLng),
    markerHdg: Math.round(payload.markerHdg),
    markerSvLat: payload.markerSvLat != null ? round6(payload.markerSvLat) : null,
    markerSvLng: payload.markerSvLng != null ? round6(payload.markerSvLng) : null,
    markerSvHdg: payload.markerSvHdg != null ? Math.round(payload.markerSvHdg) : null,
    accM: payload.accM != null ? Math.round(payload.accM) : null,
    hudKmh: payload.hudKmh != null ? round1(payload.hudKmh) : null,
    engineKmh: payload.engineKmh != null ? round1(payload.engineKmh) : null,
    dopplerKmh: payload.dopplerKmh != null ? round1(payload.dopplerKmh) : null,
    crossTrackM: payload.crossTrackM != null ? round1(payload.crossTrackM) : null,
    onRoad: payload.onRoad ?? null,
    source: payload.source ?? null,
    smoothness: {
      rawStepM: payload.rawStepM != null ? round1(payload.rawStepM) : null,
      markerRawGapM: payload.markerRawGapM != null ? round1(payload.markerRawGapM) : null,
      svGapM: payload.svGapM != null ? round1(payload.svGapM) : null,
      chaseM: payload.chaseM != null ? round1(payload.chaseM) : null,
      catchupSoft: payload.catchupSoft ?? false,
      hdgFlipDeg: payload.hdgFlipDeg != null ? Math.round(payload.hdgFlipDeg) : null,
      pushSegM: payload.pushSegM != null ? round1(payload.pushSegM) : null,
      feedDurMs: payload.feedDurMs != null ? Math.round(payload.feedDurMs) : null,
    },
    flags: {
      teleportClamp: payload.teleportClamp ?? false,
      megaJumpBlocked: payload.megaJumpBlocked ?? false,
      feedSkipGate: payload.feedSkipGate ?? false,
      stationaryHold: payload.stationaryHold ?? false,
    },
  });
}

/** Marker SV interpolacja — throttle 500ms w trybie MAX. */
export function visionFrame(payload: {
  layer: 'sv' | 'ui';
  svLat?: number;
  svLng?: number;
  svHdg?: number;
  uiLat?: number;
  uiLng?: number;
  uiHdg?: number;
  uiGapM?: number;
  frameDtMs?: number;
  impliedKmh?: number;
  stuck?: boolean;
  msSinceCommit?: number;
}): void {
  emitVision('DRIVE_VISION_FRAME', {
    layer: payload.layer,
    svLat: payload.svLat != null ? round6(payload.svLat) : null,
    svLng: payload.svLng != null ? round6(payload.svLng) : null,
    svHdg: payload.svHdg != null ? Math.round(payload.svHdg) : null,
    uiLat: payload.uiLat != null ? round6(payload.uiLat) : null,
    uiLng: payload.uiLng != null ? round6(payload.uiLng) : null,
    uiHdg: payload.uiHdg != null ? Math.round(payload.uiHdg) : null,
    uiGapM: payload.uiGapM != null ? round1(payload.uiGapM) : null,
    frameDtMs: payload.frameDtMs != null ? Math.round(payload.frameDtMs) : null,
    impliedKmh: payload.impliedKmh != null ? round1(payload.impliedKmh) : null,
    stuck: payload.stuck ?? false,
    msSinceCommit: payload.msSinceCommit != null ? Math.round(payload.msSinceCommit) : null,
  }, VISION_FRAME_THROTTLE_MS);
}

/** Kamera po zbudowaniu target pose — throttle 500ms w trybie MAX. */
export function visionCamera(payload: {
  centerLat: number;
  centerLng: number;
  offsetLat?: number;
  offsetLng?: number;
  heading?: number;
  zoom?: number;
  pitch?: number;
  lookaheadM?: number;
  speedKmh?: number;
  movedM?: number;
  nativeSkipped?: boolean;
  skipReason?: string | null;
  followFromWorkletFrame?: boolean;
}): void {
  emitVision('DRIVE_VISION_CAMERA', {
    centerLat: round6(payload.centerLat),
    centerLng: round6(payload.centerLng),
    offsetLat: payload.offsetLat != null ? round6(payload.offsetLat) : null,
    offsetLng: payload.offsetLng != null ? round6(payload.offsetLng) : null,
    heading: payload.heading != null ? Math.round(payload.heading) : null,
    zoom: payload.zoom != null ? round1(payload.zoom) : null,
    pitch: payload.pitch != null ? round1(payload.pitch) : null,
    lookaheadM: payload.lookaheadM != null ? round1(payload.lookaheadM) : null,
    speedKmh: payload.speedKmh != null ? round1(payload.speedKmh) : null,
    movedM: payload.movedM != null ? round1(payload.movedM) : null,
    nativeSkipped: payload.nativeSkipped ?? false,
    skipReason: payload.skipReason ?? null,
    followFromWorkletFrame: payload.followFromWorkletFrame ?? false,
  }, VISION_CAMERA_THROTTLE_MS);
}

/** Zdarzenia krytyczne — natychmiast, bez throttle. */
export function visionEvent(
  event:
    | 'OFF_ROAD'
    | 'SNAP_SOURCE'
    | 'MAP_MATCH_RECOVERY'
    | 'NAV_OFF_ROUTE'
    | 'NAV_REROUTE_REQUEST'
    | 'NAV_REROUTE_OK'
    | 'NAV_REROUTE_FAIL'
    | 'NAV_STEP_CHANGE'
    | 'STALL_DETECT',
  extra?: Record<string, unknown>,
): void {
  emitVision('DRIVE_VISION_EVENT', { event, ...(extra ?? {}) });
}

/** Alias zgodny z planem. */
export const currentGpsTickId = getGpsTickId;
