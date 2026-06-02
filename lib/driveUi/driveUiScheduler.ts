/**
 * Throttle UI-facing drive updates (speedometer + Mapbox camera).
 * Marker/worklet stays at full rate; only React/native bridge is paced.
 */

export const DRIVE_SPEEDOMETER_MIN_MS = 200;
export const DRIVE_CAMERA_MIN_MS = 250;
/** Po tym czasie wymuś klatkę kamery nawet przy stałym throttle. */
export const DRIVE_CAMERA_MAX_LATENCY_MS = 450;

export type TripCameraFrame = {
  lat: number;
  lng: number;
  heading: number;
};

export function createTripCameraScheduler(
  applyFrame: (frame: TripCameraFrame) => void,
): {
  push: (lat: number, lng: number, heading: number) => void;
  flush: () => void;
  dispose: () => void;
} {
  let pending: TripCameraFrame | null = null;
  let lastApplyAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstPendingAt = 0;

  const flush = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const frame = pending;
    pending = null;
    firstPendingAt = 0;
    lastApplyAt = Date.now();
    applyFrame(frame);
  };

  const schedule = () => {
    if (!pending || timer != null) return;
    const now = Date.now();
    const elapsed = lastApplyAt > 0 ? now - lastApplyAt : DRIVE_CAMERA_MIN_MS;
    const delay = Math.max(0, DRIVE_CAMERA_MIN_MS - elapsed);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, delay);
  };

  const push = (lat: number, lng: number, heading: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(heading)) return;
    pending = { lat, lng, heading };
    const now = Date.now();
    if (firstPendingAt <= 0) firstPendingAt = now;

    const elapsed = lastApplyAt > 0 ? now - lastApplyAt : DRIVE_CAMERA_MIN_MS;
    const maxLatencyExceeded =
      firstPendingAt > 0 && now - firstPendingAt >= DRIVE_CAMERA_MAX_LATENCY_MS;

    if (elapsed >= DRIVE_CAMERA_MIN_MS || maxLatencyExceeded) {
      flush();
      return;
    }
    schedule();
  };

  const dispose = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
    firstPendingAt = 0;
  };

  return { push, flush, dispose };
}

let lastSpeedEmitAt = 0;
let lastSpeedEmitRounded = -1;

export function resetDriveSpeedometerThrottle(): void {
  lastSpeedEmitAt = 0;
  lastSpeedEmitRounded = -1;
}

export function shouldEmitSpeedometerKmh(kmh: number): boolean {
  const rounded = Math.round(Math.max(0, kmh));
  const now = Date.now();
  if (rounded !== lastSpeedEmitRounded) {
    if (now - lastSpeedEmitAt >= DRIVE_SPEEDOMETER_MIN_MS) return true;
    if (Math.abs(rounded - lastSpeedEmitRounded) >= 3) return true;
  }
  return now - lastSpeedEmitAt >= DRIVE_SPEEDOMETER_MIN_MS * 2;
}

export function markSpeedometerEmitted(kmh: number): void {
  lastSpeedEmitAt = Date.now();
  lastSpeedEmitRounded = Math.round(Math.max(0, kmh));
}
