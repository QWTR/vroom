import { describe, expect, it } from 'vitest';
import { buildRerouteRouteSignature } from './reroute';

describe('buildRerouteRouteSignature', () => {
  it('returns empty for short routes', () => {
    expect(buildRerouteRouteSignature([])).toBe('');
    expect(buildRerouteRouteSignature([{ latitude: 52, longitude: 21 }])).toBe('');
  });

  it('includes midpoint samples so similar endpoints differ', () => {
    const a = buildRerouteRouteSignature([
      { latitude: 52.0, longitude: 21.0 },
      { latitude: 52.1, longitude: 21.1 },
      { latitude: 52.2, longitude: 21.2 },
      { latitude: 52.3, longitude: 21.3 },
    ]);
    const b = buildRerouteRouteSignature([
      { latitude: 52.0, longitude: 21.0 },
      { latitude: 52.1, longitude: 21.5 },
      { latitude: 52.2, longitude: 21.2 },
      { latitude: 52.3, longitude: 21.3 },
    ]);
    expect(a).not.toBe(b);
  });

  it('is stable for identical geometry', () => {
    const pts = [
      { latitude: 52.0, longitude: 21.0 },
      { latitude: 52.05, longitude: 21.05 },
      { latitude: 52.1, longitude: 21.1 },
    ];
    expect(buildRerouteRouteSignature(pts)).toBe(buildRerouteRouteSignature(pts));
  });
});
