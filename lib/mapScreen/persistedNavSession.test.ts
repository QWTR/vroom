import { describe, expect, it } from 'vitest';
import { isFreshPersistedNavSession, parsePersistedNavSession } from './persistedNavSession';

const legacy = {
  savedAt: 1_000,
  endLocation: { latitude: 52, longitude: 21 },
  startLocation: null,
  navStartLoc: null,
  routeInfo: null,
  currentStep: 3,
  offroadPoints: [],
  isOffroadRoute: false,
};

describe('persisted navigation session', () => {
  it('reads the legacy v1 snapshot', () => {
    const parsed = parsePersistedNavSession(JSON.stringify(legacy));
    expect(parsed?.version).toBe(1);
    expect(parsed?.mode).toBe('navigation');
    expect(parsed?.currentStep).toBe(3);
  });

  it('requires a matching session id for v2 snapshots', () => {
    const parsed = parsePersistedNavSession(JSON.stringify({
      ...legacy,
      version: 2,
      tripSessionId: 'trip-a',
      mode: 'navigation',
    }));
    expect(isFreshPersistedNavSession(parsed, {
      tripSessionId: 'trip-b',
      now: 2_000,
      maxAgeMs: 6_000,
    })).toBe(false);
    expect(isFreshPersistedNavSession(parsed, {
      tripSessionId: 'trip-a',
      now: 2_000,
      maxAgeMs: 6_000,
    })).toBe(true);
  });
});
