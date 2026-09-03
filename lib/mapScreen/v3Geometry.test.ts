import { describe, expect, it } from 'vitest';
import { buildV3GeometryFromRefs } from './v3Geometry';

const route = [
  { latitude: 52.23, longitude: 21.01 },
  { latitude: 52.24, longitude: 21.01 },
];
const actualRoad = [
  { latitude: 52.231, longitude: 21.015 },
  { latitude: 52.232, longitude: 21.025 },
];

describe('buildV3GeometryFromRefs', () => {
  it('keeps local road candidates available during navigation', () => {
    const geometry = buildV3GeometryFromRefs({
      matchedGeometry: route,
      routePoints: route,
      isNavigating: true,
      mirrorPolylines: [actualRoad],
    });
    expect(geometry.routePolyline).toHaveLength(2);
    expect(geometry.roadPolylines.some((road) => road.key.startsWith('mirror:'))).toBe(true);
  });

  it('suppresses route snapping without reusing old matched route as a road', () => {
    const geometry = buildV3GeometryFromRefs({
      matchedGeometry: route,
      routePoints: route,
      isNavigating: true,
      suppressRouteSnap: true,
      mirrorPolylines: [actualRoad],
    });
    expect(geometry.shouldSnapToRoute).toBe(false);
    expect(geometry.routePolyline).toHaveLength(2);
    expect(geometry.roadPolylines.some((road) => road.key === 'road_match')).toBe(false);
  });

  it('prioritizes visible local mirror before matched free-drive geometry', () => {
    const geometry = buildV3GeometryFromRefs({
      matchedGeometry: route,
      routePoints: [],
      isNavigating: false,
      mirrorPolylines: [actualRoad],
    });

    expect(geometry.roadPolylines[0]?.key).toMatch(/^mirror:/);
    expect(geometry.roadPolylines[1]?.key).toBe('road_match');
  });

  it('keeps one packed route input across ordinary GPS geometry reads', () => {
    const first = buildV3GeometryFromRefs({
      matchedGeometry: route,
      routePoints: route,
      isNavigating: true,
      mirrorPolylines: [],
    });
    const second = buildV3GeometryFromRefs({
      matchedGeometry: route,
      routePoints: route,
      isNavigating: true,
      mirrorPolylines: [],
    });

    expect(second.routePolyline).toBe(first.routePolyline);
  });

  it('keeps mirror identity stable when cache ordering changes', () => {
    const otherRoad = [
      { latitude: 52.24, longitude: 21.03 },
      { latitude: 52.25, longitude: 21.04 },
    ];
    const first = buildV3GeometryFromRefs({
      matchedGeometry: [],
      routePoints: [],
      isNavigating: false,
      mirrorPolylines: [actualRoad, otherRoad],
    });
    const second = buildV3GeometryFromRefs({
      matchedGeometry: [],
      routePoints: [],
      isNavigating: false,
      mirrorPolylines: [otherRoad, actualRoad],
    });

    expect(new Set(second.roadPolylines.map((road) => road.key)))
      .toEqual(new Set(first.roadPolylines.map((road) => road.key)));
  });
});
