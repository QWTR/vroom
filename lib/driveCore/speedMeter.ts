import { SPEED_EMA_SAMPLES, SPEED_MIN_DT_SEC } from './config';
import { GATE_ACC_FULL_M } from './gpsQualityGate';
import { distanceM } from './geo';
import {
  MAX_SNAPPED_INSTANT_KMH,
  sanitizeTripSpeedKmh,
} from './speedSanitizer';
import type { GpsQualityResult } from './gpsQualityGate';
import type { RawGpsFix, SnappedPose } from './types';

const SPEED_MIN_DT_DEGRADED_ACC_SEC = 0.5;

export type SpeedMeterQuality = Pick<
  GpsQualityResult,
  'verdict' | 'allowSpeedDelta' | 'allowDoppler'
>;

export type SpeedMeterUpdateOpts = {
  /** Wolna jazda bez trasy — HUD z Dopplera nawet gdy motion.isMoving === false. */
  freeDriveDoppler?: boolean;
  /** Nawigacja — Doppler gdy silnik uważa postój (off-route / Android speed=0). */
  navDopplerHud?: boolean;
};

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
    quality: SpeedMeterQuality,
    opts?: SpeedMeterUpdateOpts,
  ): number {
    const now = raw.timestamp;

    if (!isMoving) {
      const gpsMs = raw.gpsSpeedMs;
      const hasGpsMs = gpsMs != null && Number.isFinite(gpsMs) && gpsMs >= 0;
      const freeDriveDoppler =
        !!opts?.freeDriveDoppler
        && !isNavigating
        && hasGpsMs;
      const navDopplerHud =
        !!opts?.navDopplerHud
        && isNavigating
        && hasGpsMs
        && gpsMs >= 0.5;

      if (freeDriveDoppler || navDopplerHud) {
        const gpsKmh = gpsMs * 3.6;
        const instant = sanitizeTripSpeedKmh(
          gpsKmh,
          this.lastOutputKmh,
          SPEED_MIN_DT_SEC,
          false,
        );
        this.lastTs = now;
        if (quality.verdict === 'FULL_ACCEPT') {
          this.lastSnapped = { lat: pose.lat, lng: pose.lng, ts: now };
        }
        this.samples.push(instant);
        if (this.samples.length > SPEED_EMA_SAMPLES) {
          this.samples.shift();
        }
        const sum = this.samples.reduce((a, b) => a + b, 0);
        const ema = this.samples.length > 0 ? sum / this.samples.length : 0;
        this.lastOutputKmh = Math.round(Math.max(0, ema) * 10) / 10;
        return this.lastOutputKmh;
      }

      this.samples = [];
      if (quality.verdict === 'FULL_ACCEPT') {
        this.lastSnapped = { lat: pose.lat, lng: pose.lng, ts: now };
      }
      this.lastOutputKmh = 0;
      this.lastTs = now;
      return 0;
    }

    if (quality.verdict !== 'FULL_ACCEPT') {
      return this.lastOutputKmh;
    }

    let dtSec = this.lastTs > 0
      ? Math.max(SPEED_MIN_DT_SEC, (now - this.lastTs) / 1000)
      : SPEED_MIN_DT_SEC;
    if (raw.accuracy > GATE_ACC_FULL_M - 10) {
      dtSec = Math.max(SPEED_MIN_DT_DEGRADED_ACC_SEC, dtSec);
    }
    this.lastTs = now;

    const candidates: number[] = [];

    const gpsMs = raw.gpsSpeedMs;
    if (quality.allowDoppler && gpsMs != null && Number.isFinite(gpsMs) && gpsMs >= 0) {
      candidates.push(gpsMs * 3.6);
    }

    if (quality.allowSpeedDelta && this.lastSnapped) {
      const snapDt = Math.max(SPEED_MIN_DT_SEC, (now - this.lastSnapped.ts) / 1000);
      const effectiveSnapDt = raw.accuracy > 20
        ? Math.max(SPEED_MIN_DT_DEGRADED_ACC_SEC, snapDt)
        : snapDt;
      const distM = distanceM(
        this.lastSnapped.lat,
        this.lastSnapped.lng,
        pose.lat,
        pose.lng,
      );
      const snapKmh = (distM / effectiveSnapDt) * 3.6;
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
        quality.allowDoppler
        && Number.isFinite(gpsKmh)
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
