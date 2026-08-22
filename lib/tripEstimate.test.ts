import { describe, expect, it } from 'vitest';
import {
  estimateRemainingRouteMinutes,
  routeDurationMinutesToSeconds,
} from './tripEstimate';

describe('routeDurationMinutesToSeconds', () => {
  it('converts the routing duration from minutes to trip-stat seconds', () => {
    expect(routeDurationMinutesToSeconds(20)).toBe(1200);
    expect(routeDurationMinutesToSeconds(20.5)).toBe(1230);
  });

  it('rejects missing and invalid estimates', () => {
    expect(routeDurationMinutesToSeconds(null)).toBe(0);
    expect(routeDurationMinutesToSeconds(-4)).toBe(0);
    expect(routeDurationMinutesToSeconds('not-a-number')).toBe(0);
  });
});

describe('estimateRemainingRouteMinutes', () => {
  it('reduces the original route duration as distance is completed', () => {
    expect(estimateRemainingRouteMinutes({
      routeDurationMinutes: 27,
      routeDistanceMeters: 11_500,
      remainingDistanceKm: 3.2,
    })).toBe(8);
  });

  it('keeps at least one minute until the arrival zone', () => {
    expect(estimateRemainingRouteMinutes({
      routeDurationMinutes: 6,
      routeDistanceMeters: 3_800,
      remainingDistanceKm: 0.04,
    })).toBe(1);
    expect(estimateRemainingRouteMinutes({
      routeDurationMinutes: 6,
      routeDistanceMeters: 3_800,
      remainingDistanceKm: 0.02,
    })).toBe(0);
  });

  it('rejects an incomplete route estimate', () => {
    expect(estimateRemainingRouteMinutes({
      routeDurationMinutes: 27,
      routeDistanceMeters: 0,
      remainingDistanceKm: 3.2,
    })).toBeNull();
  });
});
