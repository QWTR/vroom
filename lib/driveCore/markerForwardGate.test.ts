import { describe, expect, it } from 'vitest';
import { BACKWARD_ARC_EPS_M, evaluateMarkerForwardGate } from './markerForwardGate';

describe('evaluateMarkerForwardGate', () => {
  it('rejects backward arcM progress', () => {
    const r = evaluateMarkerForwardGate({
      fromLat: 52.001,
      fromLng: 21.0,
      toLat: 52.0005,
      toLng: 21.0,
      headingDeg: 180,
      hudKmh: 30,
      arcM: 10,
      currentArcM: 50,
      polylineKey: 'abc',
      currentPolylineKey: 'abc',
    });
    expect(r.acceptPosition).toBe(false);
    expect(r.headingOnly).toBe(true);
  });

  it('accepts forward arcM progress', () => {
    const r = evaluateMarkerForwardGate({
      fromLat: 52.001,
      fromLng: 21.0,
      toLat: 52.002,
      toLng: 21.0,
      headingDeg: 0,
      hudKmh: 30,
      arcM: 55,
      currentArcM: 50,
      polylineKey: 'abc',
      currentPolylineKey: 'abc',
    });
    expect(r.acceptPosition).toBe(true);
    expect(r.lat).toBeCloseTo(52.002, 4);
  });

  it('allows small arc regression within epsilon', () => {
    const r = evaluateMarkerForwardGate({
      fromLat: 52.001,
      fromLng: 21.0,
      toLat: 52.0012,
      toLng: 21.0,
      headingDeg: 0,
      hudKmh: 30,
      arcM: 50 - BACKWARD_ARC_EPS_M * 0.5,
      currentArcM: 50,
      polylineKey: 'k',
      currentPolylineKey: 'k',
    });
    expect(r.acceptPosition).toBe(true);
  });
});
