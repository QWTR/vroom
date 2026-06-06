import { evaluateMapMatchSync } from './mapMatchSyncPolicy';
import {
  BACKGROUND_NETWORK_MIN_INTERVAL_MS,
  BACKGROUND_NETWORK_MIN_PATH_M,
  MAP_MATCH_TRAFFIC_LIGHT_KMH,
  NETWORK_MIN_INTERVAL_MS,
} from './config';

describe('mapMatchSyncPolicy', () => {
  it('pauses foreground sync below traffic-light speed', () => {
    const decision = evaluateMapMatchSync({
      mode: 'foreground',
      speedKmh: MAP_MATCH_TRAFFIC_LIGHT_KMH - 0.5,
      isMoving: true,
      now: 60_000,
      lastNetworkAt: 0,
      bufferPathM: 100,
      bufferPoints: 4,
      bypassThrottleOnce: false,
    });
    expect(decision.velocityPaused).toBe(true);
    expect(decision.allowNetwork).toBe(false);
    expect(decision.allowBuffer).toBe(false);
  });

  it('uses relaxed background batching gates', () => {
    const decision = evaluateMapMatchSync({
      mode: 'background',
      speedKmh: 0,
      isMoving: false,
      now: BACKGROUND_NETWORK_MIN_INTERVAL_MS + 1,
      lastNetworkAt: 0,
      bufferPathM: BACKGROUND_NETWORK_MIN_PATH_M,
      bufferPoints: 3,
      bypassThrottleOnce: false,
    });
    expect(decision.allowBuffer).toBe(true);
    expect(decision.allowNetwork).toBe(true);
    expect(decision.minIntervalMs).toBe(BACKGROUND_NETWORK_MIN_INTERVAL_MS);
  });

  it('respects foreground network interval', () => {
    const decision = evaluateMapMatchSync({
      mode: 'foreground',
      speedKmh: 20,
      isMoving: true,
      now: NETWORK_MIN_INTERVAL_MS - 1,
      lastNetworkAt: 0,
      bufferPathM: 100,
      bufferPoints: 4,
      bypassThrottleOnce: false,
    });
    expect(decision.allowNetwork).toBe(false);
  });
});
