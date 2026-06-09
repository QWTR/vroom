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

  it('steps toward raw when arc progress stalls with large lateral gap', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const parallelRoad: RoadPoint[] = [
      { latitude: 51.207694, longitude: 19.0035 },
      { latitude: 51.207694, longitude: 19.0045 },
    ];
    const prev = { lat: 51.207694, lng: 19.0039 };
    const rawLat = 51.207324;
    const rawLng = 19.004259;
    const result = resolveRoadMarkerPose({
      prev,
      enginePose: snappedPose(51.207694, 19.0039, 48),
      roadPolylines: [parallelRoad],
      speedKmh: 32,
      travelHeadingDeg: 211,
      rawLat,
      rawLng,
      isNavigating: false,
    });
    const movedM = distanceM(prev.lat, prev.lng, result.lat, result.lng);
    expect(movedM).toBeGreaterThan(0.5);
    expect(distanceM(result.lat, result.lng, rawLat, rawLng)).toBeLessThan(
      distanceM(prev.lat, prev.lng, rawLat, rawLng),
    );
  });

  it('closes large longitudinal lag toward raw GPS in one tick', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const prev = { lat: 52.001, lng: 21.0 };
    const rawLat = 52.00172;
    const rawLng = 21.0;
    const gapBefore = distanceM(prev.lat, prev.lng, rawLat, rawLng);
    expect(gapBefore).toBeGreaterThan(70);
    const result = resolveRoadMarkerPose({
      prev,
      enginePose: snappedPose(52.001, 21.0, 6),
      roadPolylines: [ROAD],
      speedKmh: 72,
      travelHeadingDeg: 0,
      rawLat,
      rawLng,
      isNavigating: false,
    });
    const gapAfter = distanceM(result.lat, result.lng, rawLat, rawLng);
    expect(gapAfter).toBeLessThan(gapBefore * 0.55);
    expect(distanceM(prev.lat, prev.lng, result.lat, result.lng)).toBeGreaterThan(25);
  });

  it('without turnResnap stays on current road at perpendicular intersection', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const eastWest: RoadPoint[] = [
      { latitude: 52.0, longitude: 20.998 },
      { latitude: 52.0, longitude: 21.002 },
    ];
    const northSouth: RoadPoint[] = [
      { latitude: 51.999, longitude: 21.0 },
      { latitude: 52.001, longitude: 21.0 },
    ];
    const prev = { lat: 52.0, lng: 21.0008 };
    resolveRoadMarkerPose({
      prev: { lat: 52.0, lng: 21.0002 },
      enginePose: snappedPose(52.0, 21.0004, 3),
      roadPolylines: [eastWest, northSouth],
      speedKmh: 35,
      travelHeadingDeg: 90,
      rawLat: 52.0,
      rawLng: 21.0002,
      isNavigating: false,
      turnResnap: false,
    });
    const rawLat = 52.00015;
    const rawLng = 21.0;
    const result = resolveRoadMarkerPose({
      prev,
      enginePose: snappedPose(52.0, 21.0009, 5),
      roadPolylines: [eastWest, northSouth],
      speedKmh: 35,
      travelHeadingDeg: 90,
      rawLat,
      rawLng,
      isNavigating: false,
      turnResnap: false,
    });
    expect(result.onRoad).toBe(true);
    expect(Math.abs(result.lat - 52.0)).toBeLessThan(0.0002);
    expect(result.lng).toBeGreaterThan(prev.lng - 0.0001);
  });

  it('turnResnap advances marker toward raw GPS on branch', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const eastWest: RoadPoint[] = [
      { latitude: 52.0, longitude: 20.999 },
      { latitude: 52.0, longitude: 21.001 },
    ];
    const northSouth: RoadPoint[] = [
      { latitude: 51.999, longitude: 21.0 },
      { latitude: 52.001, longitude: 21.0 },
    ];
    const prev = { lat: 52.0, lng: 20.9996 };
    const rawLat = 52.0006;
    const rawLng = 21.0;
    const result = resolveRoadMarkerPose({
      prev,
      enginePose: snappedPose(52.0, 20.9998, 8),
      roadPolylines: [eastWest, northSouth],
      speedKmh: 36,
      travelHeadingDeg: 0,
      rawLat,
      rawLng,
      isNavigating: false,
      turnResnap: true,
    });
    expect(result.lat).toBeGreaterThan(prev.lat);
    expect(distanceM(result.lat, result.lng, rawLat, rawLng)).toBeLessThan(
      distanceM(prev.lat, prev.lng, rawLat, rawLng),
    );
  });

  it('navigation uses route polyline only — ignores OSM mirror', () => {
    resetRoadMarkerPoseState();
    const route: RoadPoint[] = [
      { latitude: 52.0, longitude: 21.0 },
      { latitude: 52.002, longitude: 21.0 },
      { latitude: 52.004, longitude: 21.0 },
    ];
    const parallelOsm: RoadPoint[] = [
      { latitude: 52.0, longitude: 21.0008 },
      { latitude: 52.002, longitude: 21.0008 },
      { latitude: 52.004, longitude: 21.0008 },
    ];
    localRoadGeometryMirror.setPolylines([parallelOsm]);
    const rawLat = 52.001;
    const rawLng = 21.0001;
    const result = resolveRoadMarkerPose({
      prev: { lat: 52.0, lng: 21.0 },
      enginePose: snappedPose(52.001, 21.0001, 4),
      roadPolylines: [route],
      speedKmh: 40,
      travelHeadingDeg: 0,
      rawLat,
      rawLng,
      isNavigating: true,
    });
    expect(result.onRoad).toBe(true);
    expect(Math.abs(result.lng - 21.0)).toBeLessThan(0.0003);
    localRoadGeometryMirror.clear();
  });

  it('navigation hard-snaps arc progress on large segment jump', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const route: RoadPoint[] = [
      { latitude: 52.0, longitude: 21.0 },
      { latitude: 52.0, longitude: 21.002 },
      { latitude: 52.002, longitude: 21.002 },
    ];
    const prev = { lat: 52.0, lng: 21.0015 };
    const rawLat = 52.0018;
    const rawLng = 21.002;
    const result = resolveRoadMarkerPose({
      prev,
      enginePose: snappedPose(52.0, 21.0018, 5),
      roadPolylines: [route],
      speedKmh: 45,
      travelHeadingDeg: 90,
      rawLat,
      rawLng,
      isNavigating: true,
      turnResnap: false,
    });
    expect(result.lat).toBeGreaterThan(51.999);
    expect(Math.abs(result.lng - 21.002)).toBeLessThan(0.0005);
  });

  it('exposes motionHeading and displayHeading', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const result = resolveRoadMarkerPose({
      prev: null,
      enginePose: snappedPose(52.001, 21.0, 2),
      roadPolylines: [ROAD],
      speedKmh: 40,
      travelHeadingDeg: 0,
      rawLat: 52.0015,
      rawLng: 21.0002,
      isNavigating: false,
    });
    expect(result.motionHeading).toBe(0);
    expect(Number.isFinite(result.displayHeading)).toBe(true);
    expect(result.arcWindow?.points.length).toBeGreaterThanOrEqual(2);
  });

  it('blocks branch resnap when angular rate exceeds threshold', () => {
    resetRoadMarkerPoseState();
    localRoadGeometryMirror.clear();
    const along: RoadPoint[] = [
      { latitude: 52.0, longitude: 21.0 },
      { latitude: 52.002, longitude: 21.0 },
    ];
    const branch: RoadPoint[] = [
      { latitude: 52.001, longitude: 20.999 },
      { latitude: 52.001, longitude: 21.001 },
    ];
    resolveRoadMarkerPose({
      prev: { lat: 52.001, lng: 21.0 },
      enginePose: snappedPose(52.001, 21.0, 3),
      roadPolylines: [along, branch],
      speedKmh: 35,
      travelHeadingDeg: 0,
      rawLat: 52.001,
      rawLng: 21.0,
      isNavigating: false,
      turnResnap: false,
    });
    const result = resolveRoadMarkerPose({
      prev: { lat: 52.001, lng: 21.0 },
      enginePose: snappedPose(52.001, 21.0005, 8),
      roadPolylines: [along, branch],
      speedKmh: 35,
      travelHeadingDeg: 90,
      rawLat: 52.001,
      rawLng: 21.0009,
      isNavigating: false,
      turnResnap: true,
    });
    expect(Math.abs(result.lng - 21.0)).toBeLessThan(0.002);
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
