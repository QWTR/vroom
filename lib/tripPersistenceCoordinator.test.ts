import { describe, expect, it } from 'vitest';
import {
  mergePendingTripCheckpoint,
  parsePendingTripCheckpoint,
  type PendingTripCheckpoint,
} from './tripPersistenceCoordinator';

const checkpoint = (distanceKm: number): PendingTripCheckpoint => ({
  tripSessionId: 'trip_one',
  distanceKm,
  maxSpeedKmh: 100,
  avgSpeedKmh: 70,
  source: 'driving',
  updatedAt: distanceKm * 1_000,
});

describe('trip checkpoint outbox', () => {
  it('keeps the greatest idempotent session total during simultaneous ticks', () => {
    const merged = mergePendingTripCheckpoint(checkpoint(1.2), checkpoint(1.5));
    expect(merged.distanceKm).toBe(1.5);
  });

  it('does not merge checkpoint totals across session ids', () => {
    const next = { ...checkpoint(0.2), tripSessionId: 'trip_two' };
    expect(mergePendingTripCheckpoint(checkpoint(10), next)).toEqual(next);
  });

  it('rejects malformed or too-small persisted targets', () => {
    expect(parsePendingTripCheckpoint('{"tripSessionId":"x","distanceKm":0.01}')).toBeNull();
    expect(parsePendingTripCheckpoint('broken')).toBeNull();
  });
});
