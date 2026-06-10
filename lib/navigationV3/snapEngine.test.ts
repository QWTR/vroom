import { describe, expect, it } from 'vitest';
import { NAV_V3 } from './config';
import {
  applyRoadBlendStickiness,
  computeRoadBlend,
  computeTravelHeadingDeg,
  createDefaultSnapEngineState,
  detectIntersectionTurn,
  makeRoadPolyline,
  resolveSnap,
  safeHeadingDeg,
} from './snapEngine';

describe('computeRoadBlend', () => {
  const cfg = {
    attachThresholdM: NAV_V3.SNAP_ATTACH_M,
    detachStartM: NAV_V3.SNAP_DETACH_START_M,
    detachFullM: NAV_V3.SNAP_DETACH_FULL_M,
  };

  it('returns 1 at or below attach threshold', () => {
    expect(computeRoadBlend(0, cfg)).toBe(1);
    expect(computeRoadBlend(40, cfg)).toBe(1);
  });

  it('returns 0 at or above detach full', () => {
    expect(computeRoadBlend(100, cfg)).toBe(0);
    expect(computeRoadBlend(150, cfg)).toBe(0);
  });

  it('smoothly decreases between detach start and full', () => {
    const mid = computeRoadBlend(80, cfg);
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
  });

  it('detects intersection turn from heading jump and cross-track', () => {
    expect(detectIntersectionTurn(90, 0, 25)).toBe(true);
    expect(detectIntersectionTurn(10, 0, 25)).toBe(false);
    expect(detectIntersectionTurn(90, 0, 10)).toBe(false);
  });

  it('applies road blend stickiness on detach', () => {
    const cfg = { detachFullM: 100, onRoadBlendEps: 0.05 };
    const first = applyRoadBlendStickiness(0, 1, 85, 0, cfg);
    expect(first.blend).toBeGreaterThan(0.05);
    expect(first.stickTicks).toBe(1);
  });

  it('heading lock ignores compass in trip mode', () => {
    const out = computeTravelHeadingDeg(
      {
        lat: 52.0,
        lng: 21.0,
        accuracyM: 8,
        timestampMs: 1000,
        speedMs: 0,
        headingDeg: 270,
      },
      { lat: 52.0, lng: 21.0 },
      45,
      45,
      true,
    );
    expect(out.headingDeg).toBe(45);
    expect(out.lockedTravelHeadingDeg).toBe(45);
  });

  it('uses segment heading at cold start standstill in trip mode', () => {
    const out = computeTravelHeadingDeg(
      {
        lat: 52.0,
        lng: 21.0,
        accuracyM: 8,
        timestampMs: 1000,
        speedMs: 0,
        headingDeg: 270,
      },
      null,
      0,
      -1,
      true,
      127,
    );
    expect(out.headingDeg).toBe(127);
    expect(out.lockedTravelHeadingDeg).toBe(127);
  });

  it('safeHeadingDeg never returns NaN', () => {
    expect(safeHeadingDeg(NaN, 12)).toBe(12);
    expect(safeHeadingDeg(undefined, NaN)).toBe(0);
  });
});
