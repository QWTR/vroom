import { describe, expect, it } from 'vitest';
import {
  FLEET_FULL_ANIMATION_EXIT_KM,
  FLEET_FULL_ANIMATION_RADIUS_KM,
} from './liveFleetMotion';
import {
  interpolateAlongTrail,
  interpolateAlongPolyline,
  interpolateEntity,
  isImplausibleJump,
  buildAnimationTrail,
  extrapolateFleetPosition,
  isTrailChordFlat,
  resolveFleetAnimationTier,
  resolveFleetAnimationTierWithHysteresis,
  samplePolylineForSlot,
  computeFleetPushDurationMs,
} from './fleetTrailInterpolation';

describe('fleetTrailInterpolation', () => {
  it('interpolates along trail by timestamp', () => {
    const trail = [
      { lat: 52.0, lng: 21.0, t: 1000 },
      { lat: 52.001, lng: 21.001, t: 2000 },
    ];
    const mid = interpolateAlongTrail(trail, 1500);
    expect(mid).not.toBeNull();
    expect(mid!.lat).toBeGreaterThan(52.0);
    expect(mid!.lat).toBeLessThan(52.001);
  });

  it('entity interpolation does not extrapolate past next fix', () => {
    const pos = interpolateEntity(52, 21, 1000, 52.002, 21.002, 2000, 5000);
    expect(pos.lat).toBeCloseTo(52.002, 4);
    expect(pos.lng).toBeCloseTo(21.002, 4);
  });

  it('rejects implausible jumps', () => {
    expect(isImplausibleJump(52, 21, 1000, 52.5, 21.5, 1100)).toBe(true);
    expect(isImplausibleJump(52, 21, 1000, 52.0001, 21.0001, 2000)).toBe(false);
  });

  it('animation tier respects friends and 10km radius', () => {
    expect(resolveFleetAnimationTier(true, 50, 10)).toBe('full');
    expect(resolveFleetAnimationTier(false, 5, 10)).toBe('full');
    expect(resolveFleetAnimationTier(false, 12, 10)).toBe('static');
  });

  it('hysteresis keeps full tier until exit radius', () => {
    expect(resolveFleetAnimationTierWithHysteresis(
      false, 10.5, true,
      FLEET_FULL_ANIMATION_RADIUS_KM,
      FLEET_FULL_ANIMATION_EXIT_KM,
    )).toBe('full');
    expect(resolveFleetAnimationTierWithHysteresis(
      false, 11.5, true,
      FLEET_FULL_ANIMATION_RADIUS_KM,
      FLEET_FULL_ANIMATION_EXIT_KM,
    )).toBe('static');
    expect(resolveFleetAnimationTierWithHysteresis(
      false, 9.5, false,
      FLEET_FULL_ANIMATION_RADIUS_KM,
      FLEET_FULL_ANIMATION_EXIT_KM,
    )).toBe('full');
    expect(resolveFleetAnimationTierWithHysteresis(
      false, 10.5, false,
      FLEET_FULL_ANIMATION_RADIUS_KM,
      FLEET_FULL_ANIMATION_EXIT_KM,
    )).toBe('static');
  });

  it('computeFleetPushDurationMs scales with distance and speed', () => {
    const fast = computeFleetPushDurationMs(52, 21, 52.001, 21, 25, null);
    expect(fast).toBeGreaterThanOrEqual(400);
    expect(fast).toBeLessThanOrEqual(5000);
    const slow = computeFleetPushDurationMs(52, 21, 52.001, 21, 0, 2000);
    expect(slow).toBe(2000);
  });

  it('samplePolylineForSlot reduces dense geometry', () => {
    const dense = Array.from({ length: 20 }, (_, i) => ({
      lat: 52 + i * 0.0001,
      lng: 21 + i * 0.0001,
    }));
    const sampled = samplePolylineForSlot(dense, 8);
    expect(sampled.length).toBe(8);
    expect(sampled[0].lat).toBeCloseTo(dense[0].lat, 5);
    expect(sampled[7].lat).toBeCloseTo(dense[dense.length - 1].lat, 4);
  });

  it('polyline interpolation matches segment walk at midpoint', () => {
    const polyline = [
      { lat: 52.0, lng: 21.0 },
      { lat: 52.001, lng: 21.0 },
      { lat: 52.002, lng: 21.0 },
    ];
    const mid = interpolateAlongPolyline(polyline, 0.5);
    expect(mid).not.toBeNull();
    expect(mid!.lat).toBeGreaterThan(52.0);
    expect(mid!.lat).toBeLessThan(52.002);
  });

  it('buildAnimationTrail creates synthetic segment with extrapolation point', () => {
    const trail = buildAnimationTrail({
      prevServerLat: 52.0,
      prevServerLng: 21.0,
      prevServerAt: 1000,
      serverLat: 52.001,
      serverLng: 21.0,
      serverAt: 2000,
      heading: 90,
      speedMps: 15,
    });
    expect(trail.length).toBeGreaterThanOrEqual(3);
    expect(trail[0].t).toBe(1000);
    expect(trail[trail.length - 1].t).toBeGreaterThan(2000);
  });

  it('extrapolates position after last server fix', () => {
    const pos = extrapolateFleetPosition(52.0, 21.0, 90, 20, 1000, 2000);
    expect(pos.lng).toBeGreaterThan(21.0);
  });

  it('detects flat trail chord', () => {
    const flat = [
      { lat: 52.0, lng: 21.0, t: 1 },
      { lat: 52.001, lng: 21.001, t: 2 },
      { lat: 52.002, lng: 21.002, t: 3 },
    ];
    expect(isTrailChordFlat(flat)).toBe(true);
  });
});
