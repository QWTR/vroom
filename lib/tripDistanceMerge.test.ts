import { describe, expect, it } from 'vitest';
import { resolveFinalTripDistanceKm } from './tripDistanceMerge';

describe('resolveFinalTripDistanceKm', () => {
  it('takes the max across all streams', () => {
    expect(resolveFinalTripDistanceKm({
      nativeOwnsSession: true,
      nativeDistanceKm: 90,
      foregroundTripKm: 15,
      backgroundPendingKm: 0,
      checkpointKm: 88,
      emergencySnapshotKm: 0,
    })).toBe(90);
  });

  it('prefers larger foreground over native when HUD is ahead', () => {
    expect(resolveFinalTripDistanceKm({
      nativeOwnsSession: true,
      nativeDistanceKm: 40,
      foregroundTripKm: 42,
    })).toBe(42);
  });

  it('falls back through streams when HUD is empty', () => {
    expect(resolveFinalTripDistanceKm({
      foregroundTripKm: 0,
      backgroundPendingKm: 12,
      checkpointKm: 18,
      emergencySnapshotKm: 73.4,
    })).toBe(73.4);
  });

  it('ignores zero native and keeps HUD km', () => {
    expect(resolveFinalTripDistanceKm({
      nativeOwnsSession: true,
      nativeDistanceKm: 0,
      foregroundTripKm: 12.5,
      backgroundPendingKm: 0,
      checkpointKm: 0,
      emergencySnapshotKm: 0,
    })).toBe(12.5);
  });

  it('keeps HUD/JS km when native owns but lags behind (save must not drop)', () => {
    expect(resolveFinalTripDistanceKm({
      nativeOwnsSession: true,
      nativeDistanceKm: 0.03,
      foregroundTripKm: 6.8,
      backgroundPendingKm: 0,
      checkpointKm: 0,
      emergencySnapshotKm: 0,
    })).toBe(6.8);
  });

  it('never discards a larger previous ledger total', () => {
    expect(resolveFinalTripDistanceKm({
      foregroundTripKm: 10,
      nativeDistanceKm: 9,
      checkpointKm: 8,
      previousLedgerKm: 11.2,
    })).toBe(11.2);
  });

  it('returns 0 when every stream is empty', () => {
    expect(resolveFinalTripDistanceKm({})).toBe(0);
  });
});
