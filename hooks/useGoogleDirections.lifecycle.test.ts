import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  let cursor = 0;
  const slots: any[] = [];
  let effects: (() => void)[] = [];
  return {
    fetch: vi.fn(),
    begin() { cursor = 0; },
    flush() { const pending = effects; effects = []; pending.forEach(fn => fn()); },
    useState(initial: any) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (value: any) => { slots[index].value = value; }];
    },
    useRef(value: any) { const index = cursor++; return slots[index] ??= { current: value }; },
    useEffect(fn: () => any, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((v, i) => !Object.is(v, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
  };
});
vi.mock('react', () => ({ useState: runtime.useState, useRef: runtime.useRef, useEffect: runtime.useEffect }));
vi.mock('../scripts/mapboxProxyClient', () => ({ fetchDirectionsViaProxyResult: runtime.fetch }));
vi.mock('../lib/offlineNavigation', () => ({ requestOfflineNavigationRoute: vi.fn(async () => null) }));

import { useGoogleDirections } from './useGoogleDirections';

function render(latitude: number | null) {
  runtime.begin();
  return useGoogleDirections(latitude == null ? null : { latitude, longitude: 21 }, { latitude: 53, longitude: 22 }, undefined, 0, { isReroute: true });
}
const response = (distance: number) => ({ ok: true, data: { routes: [{ geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', legs: [{ distance, duration: 120, steps: [] }] }] } });
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('reroute response ownership', () => {
  it('hides the previous route immediately on a new origin, ignores a late response, and clears on stop', async () => {
    const pending: ((value: any) => void)[] = [];
    runtime.fetch.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    expect(render(52).route).toBeNull();
    runtime.flush();
    pending[0](response(1000));
    await settle();
    expect(render(52).route?.distanceValue).toBe(1000);
    runtime.flush();

    // This check precedes effects: the old result must not reach the map for even one render.
    expect(render(52.01).route).toBeNull();
    runtime.flush();
    expect(render(52.02).route).toBeNull();
    runtime.flush();
    pending[2](response(3000));
    await settle();
    expect(render(52.02).route?.distanceValue).toBe(3000);
    runtime.flush();
    pending[1](response(2000));
    await settle();
    expect(render(52.02).route?.distanceValue).toBe(3000);
    runtime.flush();
    expect(render(null).route).toBeNull();
    runtime.flush();
  });
});
