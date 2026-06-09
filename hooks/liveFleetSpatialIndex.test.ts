import { describe, expect, it } from 'vitest';
import {
  boundsFromCenterZoom,
  isInViewport,
} from './liveFleetSpatialIndex';

describe('liveFleetSpatialIndex', () => {
  it('filters coordinates outside viewport bbox', () => {
    const bounds = boundsFromCenterZoom(52, 21, 15, 1);
    expect(bounds.valid).toBe(1);
    expect(isInViewport(52, 21, bounds)).toBe(true);
    expect(isInViewport(52.5, 21, bounds)).toBe(false);
  });
});
