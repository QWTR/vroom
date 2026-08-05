import { describe, expect, it } from 'vitest';
import { routeDurationMinutesToSeconds } from './tripEstimate';

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
