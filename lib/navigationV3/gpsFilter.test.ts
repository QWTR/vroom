import { describe, expect, it } from 'vitest';
import { filterGpsFix, shouldBypassGpsFilters } from './gpsFilter';

describe('gpsFilter mock bypass', () => {
  it('keeps safety gates enabled in DEV for non-mocked fixes', () => {
    const result = filterGpsFix(
      {
        lat: 52.1,
        lng: 21.0,
        accuracyM: 500,
        timestampMs: 1000,
        speedMs: 5,
        headingDeg: 90,
      },
      null,
    );
    expect(result.verdict).toBe('reject');
    expect(result.reason).toBe('accuracy_too_poor');
  });

  it('accepts mocked fixes when isMocked is set', () => {
    expect(shouldBypassGpsFilters({ isMocked: true })).toBe(true);
    const result = filterGpsFix(
      {
        lat: 52.2,
        lng: 21.1,
        accuracyM: 999,
        timestampMs: 2000,
        speedMs: 8,
        headingDeg: 90,
        isMocked: true,
      },
      {
        lat: 52.1,
        lng: 21.0,
        accuracyM: 999,
        timestampMs: 1000,
        speedMs: 8,
        headingDeg: 90,
        isMocked: true,
      },
    );
    expect(result.verdict).toBe('accept');
  });
});
