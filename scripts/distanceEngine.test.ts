import { describe, expect, it } from 'vitest';
import { evaluateDistanceSegment, type DistanceFix } from './distanceEngine';

const config = {
  minSegmentKm: 0.003,
  maxSegmentKm: 2,
  maxFixGapSec: 420,
  maxPlausibleKmh: 200,
  minSpeedKmh: 3,
  maxAccuracyM: 65,
};

const fix = (overrides: Partial<DistanceFix> = {}): DistanceFix => ({
  latitude: 52.2297,
  longitude: 21.0122,
  timestampMs: 1_000_000,
  speedKmh: 45,
  accuracyM: 10,
  ...overrides,
});

describe('background drive distance gates', () => {
  it('accepts a plausible automotive segment', () => {
    const result = evaluateDistanceSegment(
      fix(),
      fix({ latitude: 52.2307, timestampMs: 1_010_000 }),
      config,
    );

    expect(result).toMatchObject({ accepted: true, reason: 'ok' });
    expect(result.distanceKm).toBeGreaterThan(0.003);
  });

  it('rejects stationary GPS jitter and inaccurate fixes', () => {
    const jitter = evaluateDistanceSegment(
      fix(),
      fix({ latitude: 52.22971, timestampMs: 1_005_000 }),
      config,
    );
    const inaccurate = evaluateDistanceSegment(
      fix(),
      fix({ latitude: 52.2307, timestampMs: 1_010_000, accuracyM: 90 }),
      config,
    );

    expect(jitter).toMatchObject({ accepted: false, reason: 'jitter' });
    expect(inaccurate).toMatchObject({ accepted: false, reason: 'accuracy' });
  });

  it('rejects stale and teleporting fixes', () => {
    const stale = evaluateDistanceSegment(
      fix(),
      fix({ latitude: 52.2307, timestampMs: 1_421_000 }),
      config,
    );
    const jump = evaluateDistanceSegment(
      fix(),
      fix({ latitude: 52.2807, timestampMs: 1_010_000 }),
      config,
    );

    expect(stale).toMatchObject({ accepted: false, reason: 'stale_gap' });
    expect(jump).toMatchObject({ accepted: false, reason: 'jump' });
  });
});
