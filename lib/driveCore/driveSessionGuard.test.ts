import {
  DriveSessionGuard,
  SPEED_UNKNOWN_HOLD_MS,
} from './driveSessionGuard';

describe('DriveSessionGuard', () => {
  it('holds last trusted speed when GPS Doppler is null', () => {
    const guard = new DriveSessionGuard();
    const t0 = 1_000_000;
    expect(guard.resolveSpeedKmh(20 / 3.6, 0, t0)).toBeCloseTo(20, 1);
    expect(guard.resolveSpeedKmh(null, 0, t0 + 1000)).toBeCloseTo(20, 1);
  });

  it('expires stale trusted speed and falls back to the current estimate', () => {
    const guard = new DriveSessionGuard();
    const t0 = 2_000_000;
    expect(guard.resolveSpeedKmh(30 / 3.6, 0, t0)).toBeCloseTo(30, 1);
    expect(guard.resolveSpeedKmh(null, 7, t0 + SPEED_UNKNOWN_HOLD_MS + 1)).toBe(7);
  });

  it('reset clears the trusted speed memory', () => {
    const guard = new DriveSessionGuard();
    const t0 = 3_000_000;
    guard.resolveSpeedKmh(25 / 3.6, 0, t0);
    guard.reset();
    expect(guard.resolveSpeedKmh(null, 4, t0 + 1000)).toBe(4);
  });
});
