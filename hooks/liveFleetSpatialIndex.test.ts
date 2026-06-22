import { describe, expect, it } from 'vitest';
import {
  boundsFromCenterZoom,
  expandBoundsByMeters,
  isInViewport,
} from './liveFleetSpatialIndex';

describe('liveFleetSpatialIndex', () => {
  it('filters coordinates outside viewport bbox', () => {
    const bounds = boundsFromCenterZoom(52, 21, 15, 1);
    expect(bounds.valid).toBe(1);
    expect(isInViewport(52, 21, bounds)).toBe(true);
    expect(isInViewport(52.5, 21, bounds)).toBe(false);
  });

  it('expands viewport bounds by a meter margin', () => {
    const bounds = {
      north: 52.01,
      south: 51.99,
      east: 21.01,
      west: 20.99,
      valid: 1 as const,
    };
    const expanded = expandBoundsByMeters(bounds, 1_000);
    expect(isInViewport(52.018, 21, bounds)).toBe(false);
    expect(isInViewport(52.018, 21, expanded)).toBe(true);
  });

  it('keeps longitudes visible across the antimeridian', () => {
    const bounds = {
      north: 10,
      south: -10,
      east: -179,
      west: 179,
      valid: 1 as const,
    };
    expect(isInViewport(0, 179.5, bounds)).toBe(true);
    expect(isInViewport(0, -179.5, bounds)).toBe(true);
    expect(isInViewport(0, 170, bounds)).toBe(false);
  });

  it('treats very wide zoomed-out bounds as world-visible', () => {
    const bounds = boundsFromCenterZoom(52, 21, 3, 8);
    expect(bounds.valid).toBe(1);
    expect(isInViewport(52, 21, bounds)).toBe(true);
    expect(isInViewport(0, -120, bounds)).toBe(true);
    expect(isInViewport(0, 140, bounds)).toBe(true);
  });

  it('does not wrap expanded near-world bounds into an empty longitude window', () => {
    const expanded = expandBoundsByMeters({
      north: 70,
      south: -70,
      east: 179,
      west: -179,
      valid: 1 as const,
    }, 200_000);
    expect(isInViewport(0, 0, expanded)).toBe(true);
    expect(isInViewport(0, 170, expanded)).toBe(true);
    expect(isInViewport(0, -170, expanded)).toBe(true);
  });
});
