import { describe, expect, it } from 'vitest';
import {
  interpolateAlongTrail,
  interpolateEntity,
  isImplausibleJump,
  resolveFleetAnimationTier,
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
});
