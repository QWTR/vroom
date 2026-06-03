import { DRIVE_SESSION_TRACE_ENABLED } from './driveLogConfig';
import { gpsTickPayload } from './gpsTickTrace';
import { vroomGpsLogNow } from './vroomGpsLog';

/** Warstwa GPS pipeline — logcat [VROOM-TEL] gdy __DEV__ lub DRIVE_SESSION_TRACE. */
export function logGpsTickLayer(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (!__DEV__ && !DRIVE_SESSION_TRACE_ENABLED) return;
  vroomGpsLogNow(tag, gpsTickPayload(payload));
}

const tickLayerThrottleAt: Record<string, number> = {};

/** Ten sam gpsTickId, ale max 1 wpis / tag / minMs (HUD, UI render). */
export function logGpsTickLayerThrottled(
  tag: string,
  payload: Record<string, unknown>,
  minMs: number,
): void {
  const now = Date.now();
  if (minMs > 0 && now - (tickLayerThrottleAt[tag] ?? 0) < minMs) return;
  tickLayerThrottleAt[tag] = now;
  logGpsTickLayer(tag, payload);
}
