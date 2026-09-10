import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  let slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const frame = { active: false, callback: (_: any) => {}, setActive(value: boolean) { this.active = value; } };
  const same = (a: any[], b: any[]) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  function memo(factory: () => any, deps: any[]) {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  }
  return {
    frame, memo,
    reset() { slots = []; cursor = 0; effects = []; frame.active = false; },
    begin() { cursor = 0; },
    flush() { const pending = effects; effects = []; pending.forEach(fn => fn()); },
    ref(value: any) { const index = cursor++; return slots[index] ??= { current: value }; },
    effect(fn: () => any, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !same(previous.deps, deps)) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
    state(initial: any) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (value: any) => { slots[index].value = value; }];
    },
  };
});

vi.mock('react', () => ({
  useRef: harness.ref, useMemo: harness.memo, useState: harness.state, useEffect: harness.effect,
  useCallback: (fn: any, deps: any[]) => harness.memo(() => fn, deps),
}));
vi.mock('react-native-reanimated', () => ({
  useSharedValue: (value: any) => harness.memo(() => ({ value }), []),
  cancelAnimation: vi.fn(),
  useFrameCallback: (callback: any) => { harness.frame.callback = callback; return harness.frame; },
}));

import { coldStartNavigationTarget, useDriveMarkerV3 } from './useDriveMarkerV3';

const seed = () => ({ lat: 52, lng: 21, headingDeg: 0 });
function render(enabled = true, visible = true, fps: 15 | 30 | 60 = 60) {
  harness.begin();
  const marker = useDriveMarkerV3(enabled, seed, visible, fps);
  harness.flush();
  return marker;
}

describe('trip marker rendering lifecycle', () => {
  beforeEach(() => { harness.reset(); vi.useFakeTimers(); vi.setSystemTime(10000); });
  it('stops hidden animation without ending the trip and resumes at the newest target', () => {
    let marker = render();
    expect(harness.frame.active).toBe(true);
    marker = render(true, false);
    marker.ensureFrameActive();
    expect(harness.frame.active).toBe(false);
    marker.pushTarget({ ...coldStartNavigationTarget(52.001, 21), sourceTimestampMs: 10000 });
    marker = render(true, true);
    expect(harness.frame.active).toBe(true);
    expect(marker.lat.value).toBeCloseTo(52.001, 7);
  });
  it('does not reset a moving marker on a HUD render or FPS change', () => {
    let marker = render();
    marker.pushTarget({ ...coldStartNavigationTarget(52.001, 21), allowInstant: false, speedMs: 25, sourceTimestampMs: 10000 });
    const pose = marker.lat.value;
    marker = render(true, true, 30);
    expect(marker.lat.value).toBe(pose);
    marker = render(true, true, 30);
    expect(marker.lat.value).toBe(pose);
  });
  it('ignores older or duplicate GPS targets without restarting interpolation', () => {
    const marker = render();
    marker.pushTarget({ ...coldStartNavigationTarget(52.001, 21), sourceTimestampMs: 10000 });
    marker.pushTarget({ ...coldStartNavigationTarget(53, 22), allowInstant: false, sourceTimestampMs: 9000 });
    expect(marker.targetLat.value).toBeCloseTo(52.001, 7);
  });
  it('throttles motion updates to the selected frame rate', () => {
    const marker = render(true, true, 15);
    marker.pushTarget({ ...coldStartNavigationTarget(52.001, 21), allowInstant: false, speedMs: 25, sourceTimestampMs: 10000 });
    vi.setSystemTime(10100);
    harness.frame.callback({ timestamp: 100, timeSincePreviousFrame: 16 });
    const first = marker.lat.value;
    vi.setSystemTime(10116);
    harness.frame.callback({ timestamp: 116, timeSincePreviousFrame: 16 });
    expect(marker.lat.value).toBe(first);
    vi.setSystemTime(10168);
    harness.frame.callback({ timestamp: 168, timeSincePreviousFrame: 16 });
    expect(marker.lat.value).not.toBe(first);
  });
  it('stops frame work when the trip ends', () => {
    render();
    render(false, true);
    expect(harness.frame.active).toBe(false);
  });
});
