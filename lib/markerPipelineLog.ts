import { vroomGpsLog, vroomGpsLogNow } from './vroomGpsLog';
import { DRIVE_SESSION_TRACE_ENABLED } from './driveLogConfig';

/** Krytyczne przejścia stanu — bez throttlingu (resume, instant, reject feed). */
export function markerLogCritical(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (!DRIVE_SESSION_TRACE_ENABLED) return;
  vroomGpsLogNow(tag, payload);
}

/** Częste ticki pipeline — throttle per tag. */
export function markerLogTick(
  tag: string,
  payload: Record<string, unknown>,
  throttleMs = 900,
): void {
  if (!DRIVE_SESSION_TRACE_ENABLED) return;
  vroomGpsLog(tag, payload, throttleMs);
}
