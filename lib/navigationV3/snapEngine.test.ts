import { describe, expect, it } from 'vitest';
import { NAV_V3 } from './config';
import {
  computeRoadBlend,
  createDefaultSnapEngineState,
  makeRoadPolyline,
  resolveSnap,
} from './snapEngine';

describe('computeRoadBlend', () => {
  const cfg = {
    attachThresholdM: NAV_V3.SNAP_ATTACH_M,
    detachStartM: NAV_V3.SNAP_DETACH_START_M,
    detachFullM: NAV_V3.SNAP_DETACH_FULL_M,
  };

  it('returns 1 at or below attach threshold', () => {
    expect(computeRoadBlend(0, cfg)).toBe(1);
    expect(computeRoadBlend(12, cfg)).toBe(1);
  });

  it('returns 0 at or above detach full', () => {
    expect(computeRoadBlend(45, cfg)).toBe(0);
    expect(computeRoadBlend(100, cfg)).toBe(0);
  });

  it('smoothly decreases between detach start and full', () => {
    const mid = computeRoadBlend(31.5, cfg);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
  });
});

describe('resolveSnap', () => {
  const straightRoad = makeRoadPolyline('road-a', [
    { lat: 52.0, lng: 21.0 },
    { lat: 52.001, lng: 21.0 },
    { lat: 52.002, lng: 21.0 },
    { lat: 52.003, lng: 21.0 },
  ])!;

  it('snaps to polyline with full road blend when cross-track is low', () => {
    const out = resolveSnap({
      raw: {
        lat: 52.00105,
        lng: 21.00002,
        accuracyM: 8,
        timestampMs: 1000,
        speedMs: 12,
        headingDeg: 0,
      },
      prev: null,
      polylines: [straightRoad],
      isNavigating: false,
      state: createDefaultSnapEngineState(),
    });

    expect(out.result.polylineKey).toBe('road-a');
    expect(out.result.pathMode).toBe('onRoad');
    expect(out.result.roadBlend).toBeGreaterThan(0.9);
    expect(out.result.arcM).not.toBeNull();
  });

  it('returns off-road with zero blend when no geometry', () => {
    const out = resolveSnap({
      raw: {
        lat: 52.001,
        lng: 21.0,
        accuracyM: 8,
        timestampMs: 1000,
        speedMs: 5,
        headingDeg: 0,
      },
      prev: null,
      polylines: [],
      isNavigating: false,
      state: createDefaultSnapEngineState(),
    });

    expect(out.result.pathMode).toBe('offRoad');
    expect(out.result.roadBlend).toBe(0);
    expect(out.result.lat).toBe(52.001);
  });
});
