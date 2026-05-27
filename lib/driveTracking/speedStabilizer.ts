export type SpeedStabilizerInput = {
  /** Sanitized HUD speed from speedSanitizer (km/h). */
  displayKmh: number;
  rawGpsKmh: number;
  derivedKmh: number;
  sustainedKmh: number;
  netMoveM: number;
  pathMoveM: number;
  isTripActive: boolean;
  /** Previous stabilized value. */
  previousKmh: number;
};

const MOVING_NET_M = 8;
const MOVING_SUSTAINED_KMH = 5;
const ZERO_HOLD_MS = 2200;

/**
 * Prevents false 0 km/h while the vehicle is clearly moving (geometry confirms motion).
 */
export class SpeedStabilizer {
  private lastMovingAtMs = 0;
  private emaKmh = 0;
  private hasEma = false;

  reset(): void {
    this.lastMovingAtMs = 0;
    this.emaKmh = 0;
    this.hasEma = false;
  }

  stabilize(input: SpeedStabilizerInput, nowMs: number): number {
    const {
      displayKmh,
      rawGpsKmh,
      derivedKmh,
      sustainedKmh,
      netMoveM,
      pathMoveM,
      isTripActive,
      previousKmh,
    } = input;

    if (!isTripActive) {
      this.hasEma = false;
      return Math.max(0, displayKmh);
    }

    const geoKmh = Math.max(sustainedKmh, derivedKmh * 0.92);
    const motionEvidence =
      netMoveM >= MOVING_NET_M
      || sustainedKmh >= MOVING_SUSTAINED_KMH
      || (pathMoveM >= 14 && netMoveM >= 5);

    if (motionEvidence || displayKmh >= 4 || rawGpsKmh >= 6) {
      this.lastMovingAtMs = nowMs;
    }

    let out = displayKmh;

    // Ghost zero: Doppler/sanitizer says 0 but geometry says we're rolling.
    if (
      out < 2
      && motionEvidence
      && (rawGpsKmh >= 6 || geoKmh >= 8)
    ) {
      out = Math.max(geoKmh, rawGpsKmh * 0.75, previousKmh * 0.85, 6);
    }

    // Hold last non-zero briefly through GPS cadence gaps (1–2 s).
    if (
      out < 1.5
      && previousKmh >= 12
      && nowMs - this.lastMovingAtMs < ZERO_HOLD_MS
      && netMoveM >= 4
    ) {
      out = Math.max(previousKmh * 0.92, geoKmh, 8);
    }

    // EMA smoothing — reduces flicker 0↔small without killing real stops.
    const alpha = out >= 25 ? 0.55 : 0.38;
    if (!this.hasEma) {
      this.emaKmh = out;
      this.hasEma = true;
    } else if (out > 0.5 || motionEvidence) {
      this.emaKmh = this.emaKmh * (1 - alpha) + out * alpha;
    } else {
      this.emaKmh = this.emaKmh * 0.72;
    }

    if (out < 1 && !motionEvidence && nowMs - this.lastMovingAtMs > ZERO_HOLD_MS) {
      return 0;
    }

    return Math.max(0, Math.min(280, Math.max(out, this.emaKmh * 0.94)));
  }
}
