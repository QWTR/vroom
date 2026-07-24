import { describe, expect, it } from 'vitest';
import { MAP_LAYER_IDS } from './mapLayerContract';

describe('map layer contract', () => {
  it('keeps all layer ids unique', () => {
    const ids = Object.values(MAP_LAYER_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defines the complete route-warning-vehicle stack', () => {
    expect(Object.keys(MAP_LAYER_IDS)).toEqual([
      'routeHalo', 'routeGlow', 'routeMain',
      'warningHalo', 'warningIcon', 'warningCount',
      'vehicleSymbol', 'vehicleFallback',
    ]);
  });
});
