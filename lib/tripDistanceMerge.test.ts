import { describe, expect, it } from 'vitest';
import { resolveFinalTripDistanceKm } from './tripDistanceMerge';

describe('resolveFinalTripDistanceKm', () => {
  it('uses native distance as the single source when native owns the session', () => {
    expect(resolveFinalTripDistanceKm({
      nativeOwnsSession: true,
      nativeDistanceKm: 90,
      foregroundTripKm: 15,
      backgroundPendingKm: 0,
      checkpointKm: 90,
      emergencySnapshotKm: 0,
    })).toBe(90);
  });

  it('prefers foreground over background when native does not own the session', () => {
    expect(resolveFinalTripDistanceKm({
      nativeOwnsSession: false,
      foregroundTripKm: 42,
      backgroundPendingKm: 40,
      checkpointKm: 0,
      emergencySnapshotKm: 0,
    })).toBe(42);
  });

  it('falls back to emergency snapshot when no primary stream survived', () => {
    expect(resolveFinalTripDistanceKm({
      foregroundTripKm: 0,
      backgroundPendingKm: 0,
      checkpointKm: 18,
      emergencySnapshotKm: 73.4,
    })).toBe(18);
  });

  it('uses native distance even when foreground reports higher (native is authoritative)', () => {
    expect(resolveFinalTripDistanceKm({
      nativeOwnsSession: true,
      nativeDistanceKm: 40,
      foregroundTripKm: 42,
    })).toBe(40);
  });
});
