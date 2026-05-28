import { SPEED_EMA_SAMPLES, SPEED_MIN_DT_SEC } from './config';
import { distanceM } from './geo';
import {
  MAX_SNAPPED_INSTANT_KMH,
  sanitizeTripSpeedKmh,
} from './speedSanitizer';
import type { RawGpsFix, SnappedPose } from './types';

export class SpeedMeter {
  private lastSnapped: { lat: number; lng: number; ts: number } | null = null;
  private lastOutputKmh = 0;
  private lastTs = 0;
  private samples: number[] = [];

  reset(): void {
    this.lastSnapped = null;
    this.lastOutputKmh = 0;
    this.lastTs = 0;
    this.samples = [];
  }

  getLastKmh(): number {
    return this.lastOutputKmh;
  }

  update(
    raw: RawGpsFix,
    pose: SnappedPose,
    isMoving: boolean,
    isNavigating: boolean,
  ): number {
    const now = raw.timestamp;
    const dtSec = this.lastTs > 0
      ? Math.max(SPEED_MIN_DT_SEC, (now - this.lastTs) / 1000)
      : SPEED_MIN_DT_SEC;
    this.lastTs = now;

    if (!isMoving) {
      this.samples = [];
      this.lastSnapped = { lat: pose.lat, lng: pose.lng, ts: now };
      this.lastOutputKmh = 0;
      return 0;
    }

    const candidates: number[] = [];

    const gpsMs = raw.gpsSpeedMs;
    if (gpsMs != null && Number.isFinite(gpsMs) && gpsMs >= 0) {
      candidates.push(gpsMs * 3.6);
    }

    if (this.lastSnapped) {
      const snapDt = Math.max(SPEED_MIN_DT_SEC, (now - this.lastSnapped.ts) / 1000);
      const distM = distanceM(
        this.lastSnapped.lat,
        this.lastSnapped.lng,
        pose.lat,
        pose.lng,
      );
      const snapKmh = (distM / snapDt) * 3.6;
      if (Number.isFinite(snapKmh) && snapKmh <= MAX_SNAPPED_INSTANT_KMH) {
        candidates.push(snapKmh);
      }
    }

    this.lastSnapped = { lat: pose.lat, lng: pose.lng, ts: now };

    let instant = 0;
    if (candidates.length === 0) {
      instant = 0;
    } else if (candidates.length === 1) {
      instant = candidates[0];
    } else {
      const gpsKmh = gpsMs != null && gpsMs >= 0 ? gpsMs * 3.6 : NaN;
      const snappedKmh = candidates.find((c) => c !== gpsKmh) ?? candidates[0];
      if (
        Number.isFinite(gpsKmh)
        && gpsKmh >= 3
        && Math.abs(gpsKmh - snappedKmh) <= 22
      ) {
        instant = gpsKmh * 0.55 + snappedKmh * 0.45;
      } else {
        instant = Math.min(...candidates);
      }
    }

    instant = sanitizeTripSpeedKmh(instant, this.lastOutputKmh, dtSec, isNavigating);

    this.samples.push(instant);
    if (this.samples.length > SPEED_EMA_SAMPLES) {
      this.samples.shift();
    }

    const sum = this.samples.reduce((a, b) => a + b, 0);
    const ema = this.samples.length > 0 ? sum / this.samples.length : 0;
    this.lastOutputKmh = Math.round(Math.max(0, ema) * 10) / 10;
    return this.lastOutputKmh;
  }
}
