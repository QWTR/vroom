import {
  MICRO_SLEEP_HOLD_MS,
  MICRO_SLEEP_MAX_SPEED_KMH,
  MICRO_SLEEP_WAKE_DIST_M,
  MICRO_SLEEP_WAKE_SPEED_KMH,
} from './config';
import { distanceM } from './geo';

/** Zamraża snap/L2/scoring gdy pojazd stoi — oszczędność baterii. */
export class MicroSleepController {
  private sleepStartMs: number | null = null;
  private sleeping = false;
  private anchor: { lat: number; lng: number } | null = null;

  reset(): void {
    this.sleepStartMs = null;
    this.sleeping = false;
    this.anchor = null;
  }

  isSleeping(): boolean {
    return this.sleeping;
  }

  update(lat: number, lng: number, speedKmh: number, nowMs = Date.now()): boolean {
    if (this.sleeping && this.anchor) {
      const movedM = distanceM(this.anchor.lat, this.anchor.lng, lat, lng);
      if (movedM >= MICRO_SLEEP_WAKE_DIST_M || speedKmh >= MICRO_SLEEP_WAKE_SPEED_KMH) {
        this.sleeping = false;
        this.sleepStartMs = null;
        this.anchor = null;
        return false;
      }
      return true;
    }

    if (speedKmh < MICRO_SLEEP_MAX_SPEED_KMH) {
      if (this.sleepStartMs == null) {
        this.sleepStartMs = nowMs;
      } else if (nowMs - this.sleepStartMs >= MICRO_SLEEP_HOLD_MS) {
        this.sleeping = true;
        this.anchor = { lat, lng };
        return true;
      }
    } else {
      this.sleepStartMs = null;
    }
    return false;
  }
}
