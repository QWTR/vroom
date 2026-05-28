import { SPEED_EMA_SAMPLES, SPEED_MIN_DT_SEC } from './config';
import { distanceM } from './geo';
import type { RawGpsFix } from './types';

export class SpeedMeter {
  private lastRaw: RawGpsFix | null = null;
  private samples: number[] = [];

  reset(): void {
    this.lastRaw = null;
    this.samples = [];
  }

  update(raw: RawGpsFix, isMoving: boolean): number {
    if (!isMoving) {
      this.lastRaw = raw;
      this.samples = [];
      return 0;
    }
    if (!this.lastRaw) {
      this.lastRaw = raw;
      return 0;
    }
    const dtSec = Math.max(
      SPEED_MIN_DT_SEC,
      (raw.timestamp - this.lastRaw.timestamp) / 1000,
    );
    const distM = distanceM(this.lastRaw.lat, this.lastRaw.lng, raw.lat, raw.lng);
    const instantKmh = (distM / dtSec) * 3.6;
    this.samples.push(instantKmh);
    if (this.samples.length > SPEED_EMA_SAMPLES) {
      this.samples.shift();
    }
    this.lastRaw = raw;
    const sum = this.samples.reduce((a, b) => a + b, 0);
    return Math.max(0, Math.round((sum / this.samples.length) * 10) / 10);
  }
}
