import { describe, expect, it } from 'vitest';
import { resolveFinalTripDistanceKm } from './tripDistanceMerge';

describe('resolveFinalTripDistanceKm', () => {
  it('never lets the final activity distance fall below the session checkpoint', () => {
    expect(resolveFinalTripDistanceKm({
      foregroundTripKm: 15,
      backgroundPendingKm: 0,
      checkpointKm: 90,
      emergencySnapshotKm: 0,
    })).toBe(90);
  });

  it('does not double count overlapping foreground and background streams', () => {
    expect(resolveFinalTripDistanceKm({
      foregroundTripKm: 42,
      backgroundPendingKm: 40,
      checkpointKm: 0,
      emergencySnapshotKm: 0,
    })).toBe(42);
  });

  it('uses an emergency snapshot when it is the best surviving source', () => {
    expect(resolveFinalTripDistanceKm({
      foregroundTripKm: 12,
      backgroundPendingKm: 0,
      checkpointKm: 18,
      emergencySnapshotKm: 73.4,
    })).toBe(73.4);
  });
});
