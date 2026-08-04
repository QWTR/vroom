import { describe, expect, it } from 'vitest';
import { resolveFinalTripDistanceKm } from './tripDistanceMerge';

describe('resolveFinalTripDistanceKm', () => {
  it('uses native distance when it is ahead of foreground', () => {
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

  it('ignores native ownership when native distance is still zero', () => {
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

  it('takes the larger of native and foreground when both report progress', () => {
    expect(resolveFinalTripDistanceKm({
      nativeOwnsSession: true,
      nativeDistanceKm: 40,
      foregroundTripKm: 42,
    })).toBe(42);
  });
});
