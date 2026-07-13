/** Auto-stop only after sustained crawl — never on a single bad GPS frame. */
export const AUTO_STOP_MAX_SPEED_KMH = 3;
export const AUTO_STOP_STATIONARY_MS = 10 * 60_000;
export const AUTO_STOP_HIGH_SPEED_KMH = 20;
export const AUTO_STOP_HIGH_SPEED_LOCK_MS = 5 * 60_000;
/** Hold last trusted speed when Doppler is null (ms). */
export const SPEED_UNKNOWN_HOLD_MS = 45_000;

export type DriveSessionGuardInput = {
  effectiveSpeedKmh: number;
  movingForDriving: boolean;
  /** Only accumulate stationary time while app is active (not inactive/background overlay). */
  appStateActive: boolean;
  manualDriving: boolean;
  now?: number;
};

export class DriveSessionGuard {
  private stationarySince = 0;

  private highSpeedLockUntil = 0;

  private lastTrustedSpeedKmh = 0;

  private lastTrustedSpeedAt = 0;

  reset(): void {
    this.stationarySince = 0;
    this.highSpeedLockUntil = 0;
    this.lastTrustedSpeedKmh = 0;
    this.lastTrustedSpeedAt = 0;
  }

  /**
   * Null / negative GPS speed is "unknown" — keep last trusted speed for a short window.
   */
  resolveSpeedKmh(
    gpsSpeedMs: number | null | undefined,
    fallbackKmh: number,
    now = Date.now(),
  ): number {
    const fallback = Math.max(0, Number.isFinite(fallbackKmh) ? fallbackKmh : 0);
    if (gpsSpeedMs != null && gpsSpeedMs >= 0 && Number.isFinite(gpsSpeedMs)) {
      const kmh = gpsSpeedMs * 3.6;
      this.lastTrustedSpeedKmh = kmh;
      this.lastTrustedSpeedAt = now;
      return Math.max(fallback, kmh);
    }
    if (
      this.lastTrustedSpeedKmh > 0
      && now - this.lastTrustedSpeedAt <= SPEED_UNKNOWN_HOLD_MS
    ) {
      return Math.max(fallback, this.lastTrustedSpeedKmh);
    }
    return fallback;
  }

  noteSample(input: DriveSessionGuardInput): void {
    const now = input.now ?? Date.now();
    const speedKmh = Math.max(0, input.effectiveSpeedKmh);

    if (speedKmh >= AUTO_STOP_HIGH_SPEED_KMH) {
      this.highSpeedLockUntil = now + AUTO_STOP_HIGH_SPEED_LOCK_MS;
    }

    if (
      input.manualDriving
      || !input.appStateActive
      || input.movingForDriving
      || speedKmh >= AUTO_STOP_MAX_SPEED_KMH
    ) {
      this.stationarySince = 0;
      return;
    }

    if (this.stationarySince === 0) {
      this.stationarySince = now;
    }
  }

  canAutoStop(now = Date.now()): boolean {
    if (now < this.highSpeedLockUntil) return false;
    if (this.stationarySince === 0) return false;
    return now - this.stationarySince >= AUTO_STOP_STATIONARY_MS;
  }

  getHighSpeedLockRemainingMs(now = Date.now()): number {
    return Math.max(0, this.highSpeedLockUntil - now);
  }

  getStationaryDurationMs(now = Date.now()): number {
    if (this.stationarySince === 0) return 0;
    return Math.max(0, now - this.stationarySince);
  }
}
