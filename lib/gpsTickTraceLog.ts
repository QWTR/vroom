import { gpsTickPayload } from './gpsTickTrace';
import { vroomGpsLogNow } from './vroomGpsLog';

/** Warstwa 1–5: zawsze z gpsTickId, bez throttlingu. */
export function logGpsTickLayer(
  tag: string,
  payload: Record<string, unknown>,
): void {
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
