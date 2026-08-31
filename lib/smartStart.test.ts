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

  it('finishes navigation after two reliable fixes at the destination', () => {
    const destination = { latitude: 52, longitude: 21 };
    const fix = { ...destination, timestamp: 0, speedKmh: 1, accuracyM: 5 };
    const state = { ...initialSmartStartState(), phase: 'driving' as const, lastReliableAt: 0 };
    const first = evaluateSmartStart(state, fix, { navigating: true, destination, now: 0 });
    expect(first.action).toBe('none');
    const second = evaluateSmartStart(first.state, { ...fix, timestamp: 5_000 }, { navigating: true, destination, now: 5_000 });
    expect(second.action).toBe('finish');
  });

  it('finishes a manually started free drive after ten stationary minutes', () => {
    const fix = { latitude: 52, longitude: 21, timestamp: 0, speedKmh: 0, accuracyM: 5 };
    const state = { ...initialSmartStartState(), phase: 'driving' as const, lastReliableAt: 0 };
    const parked = evaluateSmartStart(state, fix, { navigating: false, now: 0 });
    const finished = evaluateSmartStart(parked.state, { ...fix, timestamp: 600_000 }, { navigating: false, now: 600_000 });
    expect(finished.action).toBe('finish');
  });
});
