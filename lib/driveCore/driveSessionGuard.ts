/** Hold last trusted speed when Doppler is null (ms). */
export const SPEED_UNKNOWN_HOLD_MS = 45_000;

/** Keeps a short trusted-speed memory without making trip lifecycle decisions. */
export class DriveSessionGuard {
  private lastTrustedSpeedKmh = 0;

  private lastTrustedSpeedAt = 0;

  reset(): void {
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
}
