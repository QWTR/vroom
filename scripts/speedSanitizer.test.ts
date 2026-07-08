import { describe, expect, it } from 'vitest';
import {
  computeStandstillNetM,
  isStationaryGpsSpike,
  sanitizeSpeedKmh,
  sanitizeSpeedMs,
} from './speedSanitizer';

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

describe('sanitizeSpeedKmh stationary spikes', () => {
  it('zeros ghost Doppler while the user is standing still', () => {
    for (const rawKmh of [50, 125, 3000]) {
      const kmh = sanitizeSpeedKmh({
        gpsSpeedMs: rawKmh / 3.6,
        isTripActive: true,
        rawMotionDetected: true,
        netMoveM: 0,
        pathMoveM: 0,
        sustainedKmh: 0,
        accuracyM: 35,
      });
      expect(kmh).toBe(0);
    }
  });

  it('zeros derived GPS jumps without movement evidence', () => {
    const kmh = sanitizeSpeedKmh({
      gpsSpeedMs: 0,
      isTripActive: true,
      rawMotionDetected: true,
      prevLat: 52.2297,
      prevLng: 21.0122,
      newLat: 52.2300,
      newLng: 21.0122,
      dtMs: 1000,
      netMoveM: 0,
      pathMoveM: 0,
      sustainedKmh: 0,
      accuracyM: 30,
    });
    expect(kmh).toBe(0);
  });

  it('does not boost m/s output from a stationary Doppler spike', () => {
    const ms = sanitizeSpeedMs({
      gpsSpeedMs: 125 / 3.6,
      isTripActive: true,
      rawMotionDetected: true,
      netMoveM: 0,
      pathMoveM: 0,
      sustainedKmh: 0,
      accuracyM: 35,
    });
    expect(ms).toBe(0);
  });
});

describe('isStationaryGpsSpike', () => {
  it('detects stationary raw GPS spikes', () => {
    expect(isStationaryGpsSpike({
      rawGpsKmh: 80,
      netMoveM: 2,
      pathMoveM: 3,
      sustainedKmh: 0,
      motionKmh: 1,
      accuracyM: 45,
    })).toBe(true);
  });

  it('keeps confirmed slow driving alive', () => {
    const kmh = sanitizeSpeedKmh({
      gpsSpeedMs: 9 / 3.6,
      isTripActive: true,
      rawMotionDetected: true,
      netMoveM: 9,
      pathMoveM: 12,
      sustainedKmh: 5,
      accuracyM: 8,
    });
    expect(kmh).toBeGreaterThanOrEqual(4);
  });

  it('keeps normal driving alive when geometry confirms motion', () => {
    const kmh = sanitizeSpeedKmh({
      gpsSpeedMs: 90 / 3.6,
      isTripActive: true,
      rawMotionDetected: true,
      netMoveM: 28,
      pathMoveM: 30,
      sustainedKmh: 82,
      accuracyM: 8,
    });
    expect(kmh).toBeGreaterThanOrEqual(70);
  });
});
