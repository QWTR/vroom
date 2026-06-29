import { describe, expect, it } from 'vitest';
import { collectTripHiddenLayerIds, shouldHideTripMapLabelLayer } from './tripMapLabelLayers';

describe('tripMapLabelLayers', () => {
  it('matches Mapbox road shields and route number layers used at high pitch', () => {
    expect(shouldHideTripMapLabelLayer('road-number-shield')).toBe(true);
    expect(shouldHideTripMapLabelLayer('road-route-number-shield')).toBe(true);
    expect(shouldHideTripMapLabelLayer('route-number-label')).toBe(true);
    expect(shouldHideTripMapLabelLayer('motorway-junction')).toBe(true);
  });

  it('does not hide normal map geometry layers', () => {
    expect(shouldHideTripMapLabelLayer('road-primary')).toBe(false);
    expect(shouldHideTripMapLabelLayer('building-3d')).toBe(false);
    expect(shouldHideTripMapLabelLayer('waterway-label')).toBe(false);
  });

  it('keeps known fallback ids even when style discovery returns nothing', () => {
    expect(collectTripHiddenLayerIds([])).toContain('road-number-shield');
  });
});
