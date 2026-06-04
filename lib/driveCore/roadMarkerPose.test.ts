import { describe, expect, it } from 'vitest';
import { distanceM } from './geo';
import { localRoadGeometryMirror } from './localRoadSnap';
import {
  resetRoadMarkerPoseState,
  resolveDriveMarkerDisplayPose,
  resolveRoadMarkerPose,
} from './roadMarkerPose';
import type { RoadPoint, SnappedPose } from './types';

const ROAD: RoadPoint[] = [
  { latitude: 52.0, longitude: 21.0 },
  { latitude: 52.001, longitude: 21.0 },
  { latitude: 52.002, longitude: 21.0 },
  { latitude: 52.003, longitude: 21.0 },
];

function rawPose(lat: number, lng: number): SnappedPose {
  return { lat, lng, heading: 0, crossTrackM: 999, segmentIndex: 0 };
}

function snappedPose(lat: number, lng: number, crossTrackM = 2): SnappedPose {
  return { lat, lng, heading: 0, crossTrackM, segmentIndex: 1 };
}

describe('resolveRoadMarkerPose', () => {
  it('projects marker onto road instead of raw GPS', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const rawLat = 52.0015;
    const rawLng = 21.0004;
    const result = resolveRoadMarkerPose({
      prev: null,
      enginePose: rawPose(rawLat, rawLng),
      roadPolylines: [ROAD],
      speedKmh: 30,
      travelHeadingDeg: 0,
      rawLat,
      rawLng,
      isNavigating: false,
    });
    expect(result.onRoad).toBe(true);
    expect(result.crossTrackM).toBeLessThan(40);
    expect(Math.abs(result.lat - rawLat)).toBeLessThan(0.001);
  });

  it('steps toward raw when engine returns raw GPS and road is missing', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const prev = { lat: 52.001, lng: 21.0 };
    const result = resolveRoadMarkerPose({
      prev,
      enginePose: rawPose(52.002, 21.0005),
      roadPolylines: [],
      speedKmh: 40,
      travelHeadingDeg: 0,
      rawLat: 52.002,
      rawLng: 21.0005,
      isNavigating: false,
    });
    expect(result.lat).toBeGreaterThan(prev.lat);
    expect(result.onRoad).toBe(false);
  });

  it('advances when prev is far behind raw (stale entry poly)', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const entryRoad: RoadPoint[] = [
      { latitude: 52.0, longitude: 21.0 },
      { latitude: 52.0005, longitude: 21.0 },
    ];
    const prev = { lat: 52.00025, lng: 21.0 };
    const rawLat = 52.02;
    const rawLng = 21.0004;
    const result = resolveRoadMarkerPose({
      prev,
      enginePose: snappedPose(52.00025, 21.0, 4),
      roadPolylines: [entryRoad],
      speedKmh: 60,
      travelHeadingDeg: 0,
      rawLat,
      rawLng,
      isNavigating: false,
    });
    expect(result.lat).toBeGreaterThan(prev.lat);
    expect(distanceM(result.lat, result.lng, rawLat, rawLng)).toBeLessThan(
      distanceM(prev.lat, prev.lng, rawLat, rawLng),
    );
  });

  it('steps forward along polyline without jumping to raw', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const prev = { lat: 52.001, lng: 21.0 };
    const result = resolveRoadMarkerPose({
      prev,
      enginePose: snappedPose(52.0025, 21.0, 3),
      roadPolylines: [ROAD],
      speedKmh: 50,
      travelHeadingDeg: 0,
      rawLat: 52.0025,
      rawLng: 21.0006,
      isNavigating: false,
    });
    expect(result.onRoad).toBe(true);
    expect(result.lat).toBeGreaterThan(prev.lat);
    expect(result.lat).toBeLessThan(52.0025);
  });
});

describe('resolveDriveMarkerDisplayPose', () => {
  it('advances toward raw when engine snap is frozen', () => {
    localRoadGeometryMirror.clear();
    const prev = { lat: 52.001, lng: 21.0 };
    const frozen = snappedPose(52.001, 21.0, 4);
    const result = resolveDriveMarkerDisplayPose({
      prev,
      enginePose: frozen,
      roadPolyline: [],
      speedKmh: 40,
      rawLat: 52.003,
      rawLng: 21.0004,
    });
    expect(result.lat).toBeGreaterThan(prev.lat);
    expect(result.lng).toBeGreaterThan(prev.lng);
  });

  it('projects raw GPS onto explicit road polyline', () => {
    localRoadGeometryMirror.clear();
    const rawLat = 52.0015;
    const rawLng = 21.0004;
    const result = resolveDriveMarkerDisplayPose({
      prev: null,
      enginePose: rawPose(rawLat, rawLng),
      roadPolyline: ROAD,
      speedKmh: 30,
      rawLat,
      rawLng,
    });
    expect(result.onRoad).toBe(true);
    expect(Math.abs(result.lat - rawLat)).toBeLessThan(0.002);
  });
});
