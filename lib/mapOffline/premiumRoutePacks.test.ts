import { describe, expect, it } from 'vitest';
import { corridorRegions, estimateCorridorDownload, PREMIUM_OFFLINE_GEOMETRY } from './premiumRoutePackGeometry';

describe('premium offline corridors', () => {
  it('creates overlapping 3 km buffered regions for a long route', () => {
    const points = Array.from({ length: 80 }, (_, index) => ({ latitude: 52 + index * 0.001, longitude: 21 + index * 0.001 }));
    const regions = corridorRegions(points);
    expect(regions.length).toBe(3);
    expect(regions[0][0][0]).toBeGreaterThan(regions[1][1][0]);
    expect(PREMIUM_OFFLINE_GEOMETRY.bufferKm).toBe(3);
  });

  it('estimates zoom 8-16 tiles and bytes before download', () => {
    const estimate = estimateCorridorDownload([{ latitude: 52.2, longitude: 21 }, { latitude: 52.25, longitude: 21.08 }]);
    expect(estimate.tiles).toBeGreaterThan(0);
    expect(estimate.bytes).toBe(estimate.tiles * 36_000);
    expect(PREMIUM_OFFLINE_GEOMETRY.minZoom).toBe(8);
  });
});
