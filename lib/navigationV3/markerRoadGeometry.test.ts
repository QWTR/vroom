import { describe, expect, it } from 'vitest';
import {
  exactRoadSegmentHeading,
  roadHeadingDeltaAbs,
  shouldAcceptArcGeometryTransition,
} from './markerRoadGeometry';

const points = [
  { lat: 52, lng: 21 },
  { lat: 52.001, lng: 21 },
  { lat: 52.001, lng: 21.001 },
];
const cumM = [0, 111, 179];

describe('exact road marker geometry', () => {
  it('uses the occupied segment instead of averaging across a bend', () => {
    expect(exactRoadSegmentHeading(points, cumM, 100, 1, 180)).toBeCloseTo(0, 1);
    expect(exactRoadSegmentHeading(points, cumM, 120, 1, 180)).toBeCloseTo(90, 1);
  });

  it('uses the outgoing segment at a vertex in both travel directions', () => {
    expect(exactRoadSegmentHeading(points, cumM, 111, 1, 180)).toBeCloseTo(90, 1);
    expect(exactRoadSegmentHeading(points, cumM, 111, -1, 180)).toBeCloseTo(180, 1);
  });

  it('follows each local tangent through a gentle curve and a roundabout-like bend', () => {
    const curve = [
      { lat: 52, lng: 21 },
      { lat: 52.001, lng: 21.0002 },
      { lat: 52.0018, lng: 21.0008 },
      { lat: 52.002, lng: 21.0018 },
    ];
    const curveCum = [0, 112, 210, 281];
    const first = exactRoadSegmentHeading(curve, curveCum, 50, 1, 0);
    const middle = exactRoadSegmentHeading(curve, curveCum, 150, 1, 0);
    const last = exactRoadSegmentHeading(curve, curveCum, 240, 1, 0);
    expect(first).toBeGreaterThan(0);
    expect(middle).toBeGreaterThan(first);
    expect(last).toBeGreaterThan(middle);
  });

  it('corrects reversed polylines against the selected travel direction, including at standstill', () => {
    const reversed = [
      { lat: 52.001, lng: 21 },
      { lat: 52, lng: 21 },
    ];
    expect(exactRoadSegmentHeading(reversed, [0, 111], 55, -1, 0)).toBeCloseTo(0, 1);
    expect(exactRoadSegmentHeading(reversed, [0, 111], 55, -1, 180)).toBeCloseTo(0, 1);
  });

  it('measures heading differences through north by the shortest arc', () => {
    expect(roadHeadingDeltaAbs(359, 1)).toBe(2);
    expect(roadHeadingDeltaAbs(1, 359)).toBe(2);
  });

  it('accepts only continuous replacement geometry', () => {
    expect(shouldAcceptArcGeometryTransition({
      hasCurrentGeometry: true,
      allowInstant: false,
      projectionDistanceM: 3.9,
      candidateHeadingDeg: 90,
      travelHeadingDeg: 0,
    })).toBe(true);
    expect(shouldAcceptArcGeometryTransition({
      hasCurrentGeometry: true,
      allowInstant: false,
      projectionDistanceM: 6,
      candidateHeadingDeg: 20,
      travelHeadingDeg: 0,
    })).toBe(true);
    expect(shouldAcceptArcGeometryTransition({
      hasCurrentGeometry: true,
      allowInstant: false,
      projectionDistanceM: 6,
      candidateHeadingDeg: 90,
      travelHeadingDeg: 0,
    })).toBe(false);
    expect(shouldAcceptArcGeometryTransition({
      hasCurrentGeometry: true,
      allowInstant: false,
      projectionDistanceM: 9,
      candidateHeadingDeg: 0,
      travelHeadingDeg: 0,
    })).toBe(false);
    expect(shouldAcceptArcGeometryTransition({
      hasCurrentGeometry: true,
      allowInstant: true,
      projectionDistanceM: 50,
      candidateHeadingDeg: 180,
      travelHeadingDeg: 0,
    })).toBe(true);
  });
});
