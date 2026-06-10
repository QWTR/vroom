import { describe, expect, it } from 'vitest';
import {
  resolveNavRouteStartAnchor,
  trimRoutePointsFromVehicle,
} from './navRouteBootstrap';

describe('resolveNavRouteStartAnchor', () => {
  it('returns first point and eastbound heading', () => {
    const anchor = resolveNavRouteStartAnchor([
      { latitude: 52.0, longitude: 21.0 },
      { latitude: 52.0, longitude: 21.01 },
    ]);
    expect(anchor).not.toBeNull();
    expect(anchor!.lat).toBe(52.0);
    expect(anchor!.lng).toBe(21.0);
    expect(anchor!.headingDeg).toBeGreaterThan(85);
    expect(anchor!.headingDeg).toBeLessThan(95);
  });

  it('skips degenerate first segment', () => {
    const anchor = resolveNavRouteStartAnchor([
      { latitude: 52.0, longitude: 21.0 },
      { latitude: 52.00001, longitude: 21.00001 },
      { latitude: 52.001, longitude: 21.0 },
    ]);
    expect(anchor!.headingDeg).toBeLessThan(10);
  });
});

describe('trimRoutePointsFromVehicle', () => {
  const route = [
    { latitude: 52.0, longitude: 21.0 },
    { latitude: 52.0, longitude: 21.01 },
    { latitude: 52.0, longitude: 21.02 },
    { latitude: 52.0, longitude: 21.03 },
  ];

  it('starts trimmed route near vehicle, not at route[0]', () => {
    const trimmed = trimRoutePointsFromVehicle(route, 52.0, 21.015, 120);
    expect(trimmed.length).toBeGreaterThanOrEqual(2);
    expect(trimmed[0].longitude).toBeGreaterThan(21.01);
    expect(trimmed[0].longitude).toBeLessThan(21.02);
  });
});
