// Covered by the app test runner: deterministic state machine, no native dependencies.
import { describe, expect, it } from 'vitest';
import { evaluateSmartStart, initialSmartStartState, normalizeSmartStartState } from './smartStart';

describe('Smart Start', () => {
  it('starts only after two reliable moving fixes and 250 metres within two minutes', () => {
    const first = { latitude: 52, longitude: 21, timestamp: 0, speedKmh: 15, accuracyM: 5 };
    const candidate = evaluateSmartStart(initialSmartStartState(), first, { navigating: false, now: 0 });
    const started = evaluateSmartStart(candidate.state, { ...first, longitude: 21.004, timestamp: 60_000 }, { navigating: false, now: 60_000 });
    expect(started.action).toBe('start');
  });

  it('pauses but does not finish a stationary drive while navigation is active', () => {
    const fix = { latitude: 52, longitude: 21, timestamp: 0, speedKmh: 0, accuracyM: 5 };
    const state = { ...initialSmartStartState(), phase: 'driving' as const, stationarySince: 0, stationaryOrigin: fix, lastReliableAt: 0 };
    expect(evaluateSmartStart(state, { ...fix, timestamp: 700_000 }, { navigating: true, now: 700_000 }).action).toBe('pause');
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

  it('pauses after ten stationary minutes and finishes after another thirty', () => {
    const fix = { latitude: 52, longitude: 21, timestamp: 0, speedKmh: 0, accuracyM: 5 };
    const state = { ...initialSmartStartState('trip-a'), phase: 'driving' as const, lastReliableAt: 0 };
    const parked = evaluateSmartStart(state, fix, { navigating: false, now: 0 });
    const paused = evaluateSmartStart(parked.state, { ...fix, timestamp: 600_000 }, { navigating: false, now: 600_000, tripSessionId: 'trip-a' });
    expect(paused.action).toBe('pause');
    const finished = evaluateSmartStart(paused.state, { ...fix, timestamp: 2_400_000 }, { navigating: false, now: 2_400_000, tripSessionId: 'trip-a' });
    expect(finished.action).toBe('finish');
  });

  it('resumes the same session after two reliable moving fixes during the pause window', () => {
    const fix = { latitude: 52, longitude: 21, timestamp: 600_000, speedKmh: 0, accuracyM: 5 };
    const paused = { ...initialSmartStartState('trip-a'), phase: 'paused' as const, pausedAt: 600_000, finalizeAt: 2_400_000, stationarySince: 0, stationaryOrigin: fix };
    const first = evaluateSmartStart(paused, { ...fix, speedKmh: 8, timestamp: 700_000 }, { navigating: false, now: 700_000, tripSessionId: 'trip-a' });
    expect(first.action).toBe('none');
    const resumed = evaluateSmartStart(first.state, { ...fix, longitude: 21.001, speedKmh: 9, timestamp: 705_000 }, { navigating: false, now: 705_000, tripSessionId: 'trip-a' });
    expect(resumed.action).toBe('resume');
    expect(resumed.state.tripSessionId).toBe('trip-a');
  });

  it('rejects state from an older or different trip session', () => {
    const stale = { ...initialSmartStartState('old-trip'), phase: 'paused' as const, finalizeAt: 1 };
    expect(normalizeSmartStartState(stale, 'new-trip')).toEqual(initialSmartStartState('new-trip'));
    expect(normalizeSmartStartState({ phase: 'driving' }, 'new-trip')).toEqual(initialSmartStartState('new-trip'));
  });

  it('does not finish the whole drive when the navigation destination is a drop', () => {
    const destination = { latitude: 52, longitude: 21 };
    const fix = { ...destination, timestamp: 0, speedKmh: 1, accuracyM: 5 };
    const state = { ...initialSmartStartState('trip-a'), phase: 'driving' as const, lastReliableAt: 0 };
    const first = evaluateSmartStart(state, fix, { navigating: true, destination, destinationKind: 'drop', now: 0, tripSessionId: 'trip-a' });
    const second = evaluateSmartStart(first.state, { ...fix, timestamp: 5_000 }, { navigating: true, destination, destinationKind: 'drop', now: 5_000, tripSessionId: 'trip-a' });
    expect(second.action).not.toBe('finish');
  });
});
