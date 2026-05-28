/**
 * Pełna diagnostyka jazdy pod ADB:
 * Po jeździe (jak wcześniej — logcat + findstr):
 *   D:\Android\Sdk\platform-tools\adb.exe logcat -d -v time | findstr /C:"[VROOM-TEL]" > vroom_telemetry_logcat.txt
 *   lub: cd vroom\scripts && .\adb-dump-vroom-logs.ps1
 *
 * Każdy tick = jedna linia NAV_TRACE_TICK (raw → snap → speed → feed).
 */
import { markNavTraceDrivingSession } from './navDriveTraceStore';
import { TRIP_PIPELINE_SIMPLE } from './tripPipelineConfig';
import { vroomGpsLogNow } from './vroomGpsLog';

export { NAV_DRIVE_TRACE_ENABLED } from './navDriveTraceStore';
import { NAV_DRIVE_TRACE_ENABLED } from './navDriveTraceStore';

/** Min. ms między WORKLET_FRAME (worklet → JS). */
const WORKLET_FRAME_MIN_MS = 400;

let lastWorkletFrameAt = 0;

const PHASE_THROTTLE_MS: Record<string, number> = {
  RAW: 0,
  SNAP: 0,
  TICK: 0,
  FEED: 0,
  APPLY: 0,
  WORKLET: 400,
  GHOST_JUMP_HOLD: 0,
  SNAP_IN: 0,
  SNAP_HOLD: 0,
};

const phaseLastAt: Record<string, number> = {};

export function navDriveTrace(
  phase: string,
  data?: Record<string, unknown>,
): void {
  if (!NAV_DRIVE_TRACE_ENABLED) return;
  const throttleMs = PHASE_THROTTLE_MS[phase] ?? 0;
  const now = Date.now();
  if (throttleMs > 0) {
    const last = phaseLastAt[phase] ?? 0;
    if (now - last < throttleMs) return;
    phaseLastAt[phase] = now;
  }
  vroomGpsLogNow(`NAV_TRACE_${phase}`, {
    ...(data ?? {}),
    ts: now,
  });
}

/** Wywołaj przy starcie / końcu trybu jazdy (zapis w SQLite na telefonie). */
export function navDriveTraceSession(
  event: 'driving_start' | 'driving_end' | 'nav_start' | 'nav_end',
  extra?: Record<string, unknown>,
): void {
  if (!NAV_DRIVE_TRACE_ENABLED) return;
  void markNavTraceDrivingSession(event, { ...extra, tripPipelineSimple: TRIP_PIPELINE_SIMPLE });
  vroomGpsLogNow('NAV_TRACE_PIPELINE_MODE', {
    simple: TRIP_PIPELINE_SIMPLE,
    event,
  });
}

export function navDriveTraceWorkletFrame(data: Record<string, unknown>): void {
  if (!NAV_DRIVE_TRACE_ENABLED) return;
  const now = Date.now();
  if (now - lastWorkletFrameAt < WORKLET_FRAME_MIN_MS) return;
  lastWorkletFrameAt = now;
  navDriveTrace('WORKLET', data);
}
