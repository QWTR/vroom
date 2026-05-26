import { vroomGpsLog, vroomGpsLogNow } from './vroomGpsLog';

/** Krytyczne przejścia stanu — bez throttlingu (resume, instant, reject feed). */
export function markerLogCritical(
  tag: string,
  payload: Record<string, unknown>,
): void {
  vroomGpsLogNow(tag, payload);
}

/** Częste ticki pipeline — throttle per tag. */
export function markerLogTick(
  tag: string,
  payload: Record<string, unknown>,
  throttleMs = 900,
): void {
  vroomGpsLog(tag, payload, throttleMs);
}
