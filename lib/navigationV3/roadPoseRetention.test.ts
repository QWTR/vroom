import { describe, expect, it } from 'vitest';
import {
  TRANSIENT_OFF_ROAD_HOLD_MS,
  shouldHoldTransientOffRoadPose,
} from './roadPoseRetention';

describe('transient road-pose retention', () => {
  const movingDropout = {
    previousWasOnRoad: true,
    hasRoadWindow: true,
    speedMs: 14,
    elapsedSinceRoadMs: 900,
    allowInstant: false,
  };

  it('keeps a moving marker on the road during a short map-match dropout', () => {
    expect(shouldHoldTransientOffRoadPose(movingDropout)).toBe(true);
  });

  it('releases the road after the grace window for a genuine off-road drive', () => {
    expect(shouldHoldTransientOffRoadPose({
      ...movingDropout,
      elapsedSinceRoadMs: TRANSIENT_OFF_ROAD_HOLD_MS + 1,
    })).toBe(false);
  });

  it('does not retain the road for a stopped or instant-reset marker', () => {
    expect(shouldHoldTransientOffRoadPose({ ...movingDropout, speedMs: 0 })).toBe(false);
    expect(shouldHoldTransientOffRoadPose({ ...movingDropout, allowInstant: true })).toBe(false);
  });
});
