import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STALE_MS,
  computeGpsRestartBackoffMs,
  GPS_RESTART_BACKOFF_BASE_MS,
  GPS_RESTART_BACKOFF_MAX_MS,
  IDLE_STALE_MS,
  WATCHDOG_POLL_MS,
} from './gpsWatchdog';

describe('computeGpsRestartBackoffMs', () => {
  it('returns base delay on first attempt', () => {
    expect(computeGpsRestartBackoffMs(0)).toBe(GPS_RESTART_BACKOFF_BASE_MS);
  });

  it('doubles delay exponentially', () => {
    expect(computeGpsRestartBackoffMs(1)).toBe(GPS_RESTART_BACKOFF_BASE_MS * 2);
    expect(computeGpsRestartBackoffMs(2)).toBe(GPS_RESTART_BACKOFF_BASE_MS * 4);
  });

  it('caps at max backoff', () => {
    expect(computeGpsRestartBackoffMs(20)).toBe(GPS_RESTART_BACKOFF_MAX_MS);
  });
});

describe('watchdog constants', () => {
  it('uses active stale window within 5-8s range', () => {
    expect(ACTIVE_STALE_MS).toBeGreaterThanOrEqual(5000);
    expect(ACTIVE_STALE_MS).toBeLessThanOrEqual(8000);
  });

  it('uses idle stale window within 5-8s range', () => {
    expect(IDLE_STALE_MS).toBeGreaterThanOrEqual(5000);
    expect(IDLE_STALE_MS).toBeLessThanOrEqual(8000);
  });

  it('polls faster than active stale threshold', () => {
    expect(WATCHDOG_POLL_MS).toBeLessThan(ACTIVE_STALE_MS);
  });
});
