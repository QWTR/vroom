/** Maks. HUD — jazda free-drive. */
export const MAX_DRIVING_SPEED_KMH = 200;
/** Maks. HUD — nawigacja (autostrada). */
export const MAX_NAV_SPEED_KMH = 250;
/** Odrzuć pojedynczy pomiar snapped > tego progu (filtr spike, nie limit HUD). */
export const MAX_SNAPPED_INSTANT_KMH = 200;
/** Limit przyrostu km/h na sekundę (anty-skok GPS). */
export const MAX_SPEED_DELTA_KMH_PER_SEC = 28;

export function sanitizeTripSpeedKmh(
  candidateKmh: number,
  prevKmh: number,
  dtSec: number,
  isNavigating: boolean,
): number {
  if (!Number.isFinite(candidateKmh) || candidateKmh <= 0) return 0;
  const cap = isNavigating ? MAX_NAV_SPEED_KMH : MAX_DRIVING_SPEED_KMH;
  let v = Math.min(candidateKmh, cap);
  if (dtSec > 0.04 && Number.isFinite(prevKmh) && prevKmh >= 0) {
    const maxUp = MAX_SPEED_DELTA_KMH_PER_SEC * dtSec;
    const maxDown = MAX_SPEED_DELTA_KMH_PER_SEC * 1.4 * dtSec;
    if (v > prevKmh + maxUp) v = prevKmh + maxUp;
    if (v < prevKmh - maxDown) v = Math.max(0, prevKmh - maxDown);
  }
  return Math.round(Math.max(0, v) * 10) / 10;
}
