import { describe, expect, it } from 'vitest';
import {
  clampArcM,
  computeHeadingRateDps,
  isSharpManeuver,
  isZeroVelocityLock,
  resolveTripHudKmh,
} from '../lib/driveCore/navigationSanityCore';
import { resolveTripSegmentDurationMs } from '../lib/driveCore/tripSegmentDuration';

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

  it('uses unified segment duration for marker and camera', () => {
    expect(resolveTripSegmentDurationMs(1000, 40)).toBe(1000);
    expect(resolveTripSegmentDurationMs(200, 5)).toBe(320);
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
