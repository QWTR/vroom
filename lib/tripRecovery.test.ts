import { describe, expect, it } from 'vitest';
import { resolveTripRecovery } from './tripRecovery';

describe('trip recovery', () => {
  it('never lets a stale zero-kilometre ledger overwrite a richer emergency copy', () => {
    const result = resolveTripRecovery({
      tripSessionId: 'trip_566',
      checkpointKm: 565.8,
      candidates: [
        { sessionId: 'trip_566', distanceKm: 0, routePoints: [], savedAt: 2 },
        { sessionId: 'trip_566', distanceKm: 566, routePoints: [{ latitude: 52, longitude: 21 }, { latitude: 53, longitude: 22 }], savedAt: 1 },
      ],
    });
    expect(result.distanceKm).toBe(566);
    expect(result.trackedPoints).toHaveLength(2);
  });

  it('never mixes copies from another session', () => {
    const result = resolveTripRecovery({
      tripSessionId: 'current',
      checkpointKm: 7,
      candidates: [
        { sessionId: 'old', distanceKm: 566, routePoints: [{ latitude: 52, longitude: 21 }] },
        { sessionId: 'current', distanceKm: 7, routePoints: [] },
      ],
    });
    expect(result.distanceKm).toBe(7);
    expect(result.trackedPoints).toEqual([]);
  });
});
