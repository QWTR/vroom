import { gpsTickPayload } from './gpsTickTrace';
import { vroomGpsLogNow } from './vroomGpsLog';

/** Warstwa 1–5: zawsze z gpsTickId, bez throttlingu. */
export function logGpsTickLayer(
  tag: string,
  payload: Record<string, unknown>,
): void {
  vroomGpsLogNow(tag, gpsTickPayload(payload));
}
