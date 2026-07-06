import { describe, expect, it } from 'vitest';
import { mergeTripHudKmh, resolveUnifiedHeading, smoothHeading } from './tripHeadingSnap';

describe('tripHeadingSnap', () => {
  it('smoothHeading wraps 0/360 correctly', () => {
    const h = smoothHeading(350, 10, 1, 90);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it('mergeTripHudKmh prefers doppler when engine is near zero', () => {
    expect(mergeTripHudKmh(0, 45)).toBe(45);
    expect(mergeTripHudKmh(30, 10)).toBe(30);
  });

  it('resolveUnifiedHeading limits turn rate at low speed', () => {
    const out = resolveUnifiedHeading({
      snapHeading: 90,
      movementHeading: null,
      gpsHeading: null,
      previousHeading: 0,
      speedKmh: 3,
    });
    expect(Math.abs(out - 0)).toBeLessThanOrEqual(12);
  });
});
