import { describe, expect, it } from 'vitest';
import { EMPTY_VIEWPORT, isInViewport } from './liveFleetSpatialIndex';
import {
  correctionDurationForDistance,
  shouldPublishFleetFrame,
} from './liveFleetMotion';

describe('useLiveFleetAnimator viewport culling', () => {
  it('keeps only in-viewport fleet slots in worklet filter', () => {
    const bounds = {
      north: 52.01,
      south: 51.99,
      east: 21.01,
      west: 20.99,
      valid: 1 as const,
    };
    const slots = [
      { lat: 52, lng: 21 },
      { lat: 52.5, lng: 21 },
    ];
    const visible = slots.filter((s) => isInViewport(s.lat, s.lng, bounds));
    expect(visible).toHaveLength(1);
    expect(visible[0]).toEqual({ lat: 52, lng: 21 });
  });

  it('does not cull when viewport is invalid', () => {
    const slots = [{ lat: 52, lng: 21 }, { lat: 60, lng: 10 }];
    const visible = slots.filter((s) => isInViewport(s.lat, s.lng, EMPTY_VIEWPORT));
    expect(visible).toHaveLength(2);
  });

  it('throttles Mapbox shape publishing to the 30Hz fleet cadence', () => {
    expect(shouldPublishFleetFrame(1_000, 0)).toBe(true);
    expect(shouldPublishFleetFrame(1_016, 1_000)).toBe(false);
    expect(shouldPublishFleetFrame(1_033, 1_000)).toBe(true);
  });

  it('uses soft corrections for normal drift and snap for huge drift', () => {
    expect(correctionDurationForDistance(1)).toBeGreaterThan(0);
    expect(correctionDurationForDistance(40)).toBeGreaterThan(correctionDurationForDistance(1));
    expect(correctionDurationForDistance(100)).toBe(0);
  });
});
