import { describe, expect, it } from 'vitest';
import {
  clampArcM,
  computeHeadingRateDps,
  isSharpManeuver,
  isZeroVelocityLock,
  resolveCameraSegmentDuration,
  resolveTripHudKmh,
} from '../lib/driveCore/navigationSanityCore';

describe('navigationSanityCore', () => {
  it('detects sharp turn by heading rate', () => {
    expect(isSharpManeuver(30)).toBe(true);
    expect(isSharpManeuver(5)).toBe(false);
    expect(isSharpManeuver(5, true)).toBe(true);
  });

  it('computes heading rate dps', () => {
    const rate = computeHeadingRateDps(0, 30, 1000);
    expect(rate).toBeCloseTo(30, 1);
  });

  it('shortens camera duration on sharp turn', () => {
    const dur = resolveCameraSegmentDuration(1000, { sharpTurn: true });
    expect(dur).toBeGreaterThanOrEqual(300);
    expect(dur).toBeLessThanOrEqual(400);
    expect(resolveCameraSegmentDuration(1000, { sharpTurn: false })).toBe(1000);
  });

  it('zero velocity lock uses engine priority over doppler noise', () => {
    expect(isZeroVelocityLock(0, 20)).toBe(true);
    expect(isZeroVelocityLock(2, 5)).toBe(true);
    expect(isZeroVelocityLock(2, 8)).toBe(false);
    expect(isZeroVelocityLock(5, 20)).toBe(false);
  });

  it('resolveTripHudKmh returns 0 on lock', () => {
    expect(resolveTripHudKmh(0, 20, { zeroVelocityLock: true })).toBe(0);
    expect(resolveTripHudKmh(0, 20)).toBe(20);
  });

  it('clampArcM handles NaN and bounds', () => {
    expect(clampArcM(Number.NaN, 100, 12)).toBe(12);
    expect(clampArcM(150, 100)).toBe(100);
    expect(clampArcM(-5, 100)).toBe(0);
  });
});
