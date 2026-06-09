import { describe, expect, it } from 'vitest';
import {
  resolveTripSegmentDurationMs,
  TRIP_SEGMENT_MAX_MS,
  TRIP_SEGMENT_MIN_MS,
} from './tripSegmentDuration';

describe('resolveTripSegmentDurationMs', () => {
  it('clamps to min 320ms', () => {
    expect(resolveTripSegmentDurationMs(100, 0)).toBe(TRIP_SEGMENT_MIN_MS);
  });

  it('uses cadence when above min', () => {
    expect(resolveTripSegmentDurationMs(500, 12)).toBe(500);
  });

  it('clamps to max 1200ms', () => {
    expect(resolveTripSegmentDurationMs(2000, 80)).toBe(TRIP_SEGMENT_MAX_MS);
  });

  it('ignores pushSegM (no lag modifiers)', () => {
    expect(resolveTripSegmentDurationMs(600, 0)).toBe(
      resolveTripSegmentDurationMs(600, 90),
    );
  });
});
