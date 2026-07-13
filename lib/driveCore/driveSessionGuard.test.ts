import {
  AUTO_STOP_HIGH_SPEED_KMH,
  AUTO_STOP_HIGH_SPEED_LOCK_MS,
  AUTO_STOP_STATIONARY_MS,
  DriveSessionGuard,
} from './driveSessionGuard';

describe('DriveSessionGuard', () => {
  it('holds last trusted speed when GPS Doppler is null', () => {
    const guard = new DriveSessionGuard();
    const t0 = 1_000_000;
    expect(guard.resolveSpeedKmh(20 / 3.6, 0, t0)).toBeCloseTo(20, 1);
    expect(guard.resolveSpeedKmh(null, 0, t0 + 1000)).toBeCloseTo(20, 1);
  });

  it('blocks auto-stop for 5 minutes after high speed', () => {
    const guard = new DriveSessionGuard();
    const t0 = 2_000_000;
    guard.noteSample({
      effectiveSpeedKmh: AUTO_STOP_HIGH_SPEED_KMH + 10,
      movingForDriving: true,
      appStateActive: true,
      manualDriving: false,
      now: t0,
    });
    guard.noteSample({
      effectiveSpeedKmh: 0,
      movingForDriving: false,
      appStateActive: true,
      manualDriving: false,
      now: t0 + 1000,
    });
    expect(guard.canAutoStop(t0 + AUTO_STOP_HIGH_SPEED_LOCK_MS - 1000)).toBe(false);
    expect(guard.canAutoStop(t0 + AUTO_STOP_STATIONARY_MS + 1000)).toBe(true);
  });

  it('allows auto-stop only after 10 minutes below crawl speed', () => {
    const guard = new DriveSessionGuard();
    const t0 = 3_000_000;
    guard.noteSample({
      effectiveSpeedKmh: 1,
      movingForDriving: false,
      appStateActive: true,
      manualDriving: false,
      now: t0,
    });
    expect(guard.canAutoStop(t0 + AUTO_STOP_STATIONARY_MS - 1)).toBe(false);
    expect(guard.canAutoStop(t0 + AUTO_STOP_STATIONARY_MS)).toBe(true);
  });

  it('does not accumulate stationary time while app is inactive', () => {
    const guard = new DriveSessionGuard();
    const t0 = 4_000_000;
    guard.noteSample({
      effectiveSpeedKmh: 0,
      movingForDriving: false,
      appStateActive: false,
      manualDriving: false,
      now: t0,
    });
    expect(guard.canAutoStop(t0 + AUTO_STOP_STATIONARY_MS + 60_000)).toBe(false);
  });
});
