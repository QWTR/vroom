// Covered by the app test runner: deterministic state machine, no native dependencies.
import { describe, expect, it } from 'vitest';
import { evaluateSmartStart, initialSmartStartState } from './smartStart';

describe('Smart Start', () => {
  it('starts only after two reliable moving fixes and 250 metres within two minutes', () => {
    const first = { latitude: 52, longitude: 21, timestamp: 0, speedKmh: 15, accuracyM: 5 };
    const candidate = evaluateSmartStart(initialSmartStartState(), first, { navigating: false, now: 0 });
    const started = evaluateSmartStart(candidate.state, { ...first, longitude: 21.004, timestamp: 60_000 }, { navigating: false, now: 60_000 });
    expect(started.action).toBe('start');
  });

  it('does not finish a stationary drive while navigation is active', () => {
    const fix = { latitude: 52, longitude: 21, timestamp: 0, speedKmh: 0, accuracyM: 5 };
    const state = { ...initialSmartStartState(), phase: 'driving' as const, stationarySince: 0, stationaryOrigin: fix, lastReliableAt: 0 };
    expect(evaluateSmartStart(state, { ...fix, timestamp: 700_000 }, { navigating: true, now: 700_000 }).action).toBe('none');
  });
});
