import { describe, expect, it } from 'vitest';
import {
  isNullIsland,
  isStaleGpsTimestamp,
  isImplausibleGpsTeleport,
  maxPlausibleDrivingStepM,
} from './gpsSanity';

describe('gpsSanity', () => {
  it('detects null island', () => {
    expect(isNullIsland(0, 0)).toBe(true);
    expect(isNullIsland(52.23, 21.01)).toBe(false);
  });

  it('rejects stale GPS timestamps', () => {
    const now = Date.now();
    expect(isStaleGpsTimestamp(now, now - 60_000)).toBe(true);
    expect(isStaleGpsTimestamp(now, now - 5_000)).toBe(false);
  });

  it('flags implausible teleport while stationary', () => {
    const anchor = { lat: 52.23, lng: 21.01 };
    expect(
      isImplausibleGpsTeleport(
        anchor,
        52.2301,
        21.0101,
        1000,
        0,
        0,
        0,
        2,
        0,
      ),
    ).toBe(true);
  });

  it('caps plausible driving step by speed', () => {
    expect(maxPlausibleDrivingStepM(0, 0)).toBe(40);
    expect(maxPlausibleDrivingStepM(15, 60)).toBeGreaterThan(40);
  });
});
