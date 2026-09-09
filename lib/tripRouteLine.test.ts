import { describe, expect, it } from 'vitest';
import { buildTripRouteLine, SUMMARY_SPEED_PALETTE } from './tripRouteLine';

describe('continuous trip route', () => {
  it('keeps a dense 38 km route in one line with every recorded bend', () => {
    const points = Array.from({ length: 4000 }, (_, i) => ({
      longitude: 19.1 + Math.sin(i / 90) * 0.003,
      latitude: 50.8 + i * 0.000085,
      speedKmh: 40 + i % 80,
    }));
    const route = buildTripRouteLine(points, SUMMARY_SPEED_PALETTE)!;
    expect(route.shape.geometry.type).toBe('LineString');
    expect(route.shape.geometry.coordinates).toEqual(points.map((p) => [p.longitude, p.latitude]));
    expect(route.gradient.slice(0, 3)).toEqual(['interpolate', ['linear'], ['line-progress']]);
    expect(route.gradient.length).toBeLessThanOrEqual(3 + 257 * 2);
    expect(route.gradient[3]).toBe(0);
    expect(route.gradient.at(-2)).toBe(1);
  });

  it('positions speed colors by distance rather than irregular GPS sampling', () => {
    const route = buildTripRouteLine([
      { longitude: 19, latitude: 51, speedKmh: 0 },
      { longitude: 19.01, latitude: 51, speedKmh: 60 },
      { longitude: 19.1, latitude: 51, speedKmh: 120 },
    ], SUMMARY_SPEED_PALETTE)!;
    expect(route.gradient[5]).toBeCloseTo(0.1, 8);
  });

  it('avoids duplicate gradient stops when the car is stationary', () => {
    const point = { longitude: 19, latitude: 51, speedKmh: 0 };
    const route = buildTripRouteLine([point, point, { ...point, longitude: 19.1 }, { ...point, longitude: 19.1 }], SUMMARY_SPEED_PALETTE)!;
    expect(route.gradient[3]).toBe(0);
    expect(route.gradient[5]).toBe(1);
    expect(route.gradient).toHaveLength(7);
    expect(buildTripRouteLine([point, point], SUMMARY_SPEED_PALETTE)?.gradient).toBe('#FFD447');
  });

  it('uses a neutral color for missing speed and handles missing coordinates', () => {
    expect(buildTripRouteLine([], SUMMARY_SPEED_PALETTE)).toBeNull();
    expect(buildTripRouteLine([{ longitude: NaN, latitude: 51 }, { longitude: 19, latitude: 51 }], SUMMARY_SPEED_PALETTE)).toBeNull();
    const route = buildTripRouteLine([
      { longitude: 19, latitude: 51, speedKmh: null },
      { longitude: 19.1, latitude: 51 },
    ], SUMMARY_SPEED_PALETTE)!;
    expect(route.gradient).toEqual(['interpolate', ['linear'], ['line-progress'], 0, '#FFD447', 1, '#FFD447']);
  });
});
