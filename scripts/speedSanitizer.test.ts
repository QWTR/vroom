import { describe, expect, it } from 'vitest';
import { computeStandstillNetM, sanitizeSpeedKmh } from './speedSanitizer';

describe('computeStandstillNetM', () => {
  it('scales with motion speed', () => {
    expect(computeStandstillNetM(8, 0)).toBeCloseTo(4, 1);
    expect(computeStandstillNetM(40, 0)).toBeCloseTo(12, 1);
    expect(computeStandstillNetM(100, 0)).toBe(12);
  });
});

describe('sanitizeSpeedKmh highway doppler', () => {
  it('trusts doppler at 50+ km/h with low net move on curves', () => {
    const kmh = sanitizeSpeedKmh({
      gpsSpeedMs: 55 / 3.6,
      isTripActive: true,
      netMoveM: 5,
      pathMoveM: 8,
      sustainedKmh: 52,
    });
    expect(kmh).toBeGreaterThanOrEqual(50);
  });
});
