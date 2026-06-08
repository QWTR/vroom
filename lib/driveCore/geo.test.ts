import { describe, expect, it } from 'vitest';
import {
  projectOnPolylineForward,
  snapSegmentScore,
} from './geo';
import type { RoadPoint } from './types';

describe('snapSegmentScore', () => {
  it('rejects perpendicular segment even when closer', () => {
    const along = snapSegmentScore(5, 0, 0, 30);
    const cross = snapSegmentScore(2, 90, 0, 30);
    expect(along).not.toBeNull();
    expect(cross).toBeNull();
  });

  it('penalizes angled segment vs aligned', () => {
    const aligned = snapSegmentScore(3, 0, 0, 30)!;
    const angled = snapSegmentScore(2, 30, 0, 30)!;
    expect(aligned).toBeLessThan(angled);
  });
});

describe('projectOnPolylineForward', () => {
  const mainRoad: RoadPoint[] = [
    { latitude: 52.0, longitude: 21.0 },
    { latitude: 52.001, longitude: 21.0 },
    { latitude: 52.002, longitude: 21.0 },
  ];
  const crossRoad: RoadPoint[] = [
    { latitude: 52.001, longitude: 20.9995 },
    { latitude: 52.001, longitude: 21.0005 },
  ];

  it('prefers aligned segment over perpendicular branch at intersection', () => {
    const combined: RoadPoint[] = [...mainRoad.slice(0, 2), ...crossRoad.slice(1)];
    const rawLat = 52.001;
    const rawLng = 21.0003;
    const proj = projectOnPolylineForward(
      rawLat,
      rawLng,
      combined,
      0,
      80,
      0,
      30,
    );
    expect(proj).not.toBeNull();
    expect(proj!.segmentIndex).toBeLessThan(2);
  });
});
