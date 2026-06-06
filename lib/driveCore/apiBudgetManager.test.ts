import { ApiBudgetManager } from './apiBudgetManager';
import { GeometryCache } from './geometryCache';

describe('ApiBudgetManager', () => {
  it('blocks network during navigation', () => {
    const budget = new ApiBudgetManager();
    const cache = new GeometryCache();
    const decision = budget.evaluate({
      raw: { lat: 52, lng: 19, accuracy: 8, timestamp: Date.now() },
      pose: { lat: 52, lng: 19, heading: 0, crossTrackM: 5, segmentIndex: 0 },
      isNavigating: true,
      isMoving: true,
      speedKmh: 20,
      cache,
    });
    expect(decision.allowNetwork).toBe(false);
    expect(decision.navigationBlocked).toBe(true);
  });

  it('blocks network when stationary', () => {
    const budget = new ApiBudgetManager();
    const cache = new GeometryCache();
    const decision = budget.evaluate({
      raw: { lat: 52, lng: 19, accuracy: 8, timestamp: Date.now() },
      pose: { lat: 52, lng: 19, heading: 0, crossTrackM: 0, segmentIndex: 0 },
      isNavigating: false,
      isMoving: false,
      speedKmh: 0,
      cache,
    });
    expect(decision.allowNetwork).toBe(false);
    expect(decision.stationaryBlocked).toBe(true);
  });
});
