import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const card = readFileSync(resolve('components/profile/ExplorationCoverageMap.tsx'), 'utf8');
const screen = readFileSync(resolve('app/exploration-map.tsx'), 'utf8');

describe('ExplorationCoverageMap safety', () => {
  it('does not mount Mapbox in a scrolling profile or a native modal', () => {
    expect(card).not.toContain('<Mapbox.MapView');
    expect(card).not.toContain('<Modal');
    expect(card).toContain("pathname: '/exploration-map'");
  });

  it('initializes Mapbox centrally on the dedicated router screen', () => {
    expect(screen).toContain('initMapbox()');
    expect(screen.match(/<Mapbox\.MapView/g)).toHaveLength(1);
  });

  it('loads a bounded viewport and validates polygons', () => {
    expect(screen).toContain('MAX_VISIBLE_CELLS = 900');
    expect(screen).toContain('bbox');
    expect(screen).toContain('validRing');
    expect(screen).toContain('requestRef.current');
  });
});
