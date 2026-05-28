import { TRIP_PIPELINE_SIMPLE } from '../tripPipelineConfig';

export type SpeedStabilizerInput = {
  /** Sanitized HUD speed from speedSanitizer (km/h). */
  displayKmh: number;
  rawGpsKmh: number;
  derivedKmh: number;
  sustainedKmh: number;
  netMoveM: number;
  pathMoveM: number;
  isTripActive: boolean;
  rawMotionDetected?: boolean;
  accuracyM?: number | null;
  /** Previous stabilized value. */
  previousKmh: number;
};

const MOVING_NET_M = 5;
const MOVING_SUSTAINED_KMH = 3;
const ZERO_HOLD_MS = 1900;
const CRAWL_HOLD_MS = 2100;

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
      rawMotionDetected = false,
      accuracyM = null,
      previousKmh,
    } = input;

    if (!isTripActive) {
      this.hasEma = false;
      return Math.max(0, displayKmh);
    }
    if (!TRIP_PIPELINE_SIMPLE) {
      if (!rawMotionDetected) {
        this.emaKmh = 0;
        this.hasEma = false;
        return 0;
      }
      if (accuracyM != null && Number.isFinite(accuracyM) && accuracyM > 10 && rawGpsKmh < 5) {
        this.emaKmh = 0;
        return 0;
      }
    } else if (rawGpsKmh < 1.5 && displayKmh < 1.5 && netMoveM < 3 && pathMoveM < 4) {
      return 0;
    }

    const geoKmh = Math.max(sustainedKmh, derivedKmh * 0.92);
    const motionEvidence =
      netMoveM >= MOVING_NET_M
      || sustainedKmh >= MOVING_SUSTAINED_KMH
      || (pathMoveM >= 14 && netMoveM >= 5)
      || (pathMoveM >= 8 && netMoveM >= 3);

    if (motionEvidence || displayKmh >= 3 || rawGpsKmh >= 4) {
      this.lastMovingAtMs = nowMs;
    }

    let out = displayKmh;

    // Ghost zero: Doppler/sanitizer says 0 but geometry says we're rolling.
    if (
      out < 2
      && motionEvidence
      && (rawGpsKmh >= 5 || geoKmh >= 5)
    ) {
      out = Math.max(geoKmh, rawGpsKmh * 0.8, previousKmh * 0.88, 5);
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

    // Wolna jazda / rondo: nie spadaj do 0 przy pathMove w oknie.
    if (
      out < 3
      && previousKmh >= 4
      && pathMoveM >= 8
      && nowMs - this.lastMovingAtMs < CRAWL_HOLD_MS
    ) {
      out = Math.max(previousKmh * 0.9, geoKmh, motionEvidence ? 5 : 4);
    }

    // EMA smoothing — reduces flicker 0↔small without killing real stops.
    const accelerationLag =
      rawGpsKmh >= 8
      && out > 0
      && rawGpsKmh >= out * 1.45
      && (motionEvidence || rawMotionDetected);
    const hardAccelDelta = rawGpsKmh - Math.max(out, previousKmh) >= 15;
    const alpha = accelerationLag
      ? (hardAccelDelta ? 0.95 : 0.9)
      : out >= 25
        ? 0.74
        : 0.62;
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

    const emaFloor = accelerationLag ? 0.995 : 0.97;
    return Math.max(0, Math.min(280, Math.max(out, this.emaKmh * emaFloor)));
  }
}
