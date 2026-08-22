import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const screen = readFileSync(resolve('app/(tabs)/spotmap.tsx'), 'utf8');
const layers = readFileSync(resolve('components/spots/SpotMapLayers.tsx'), 'utf8');
const sprites = readFileSync(resolve('components/spots/SpotCategorySpriteGenerator.tsx'), 'utf8');

describe('spot map surface stability', () => {
  it('mounts Mapbox only after marker resources are settled', () => {
    const mapViewIndex = screen.search(/<Mapbox\.MapView\s/);
    expect(screen).toContain('if (!region || categorySprites === null)');
    expect(screen.indexOf('if (!region || categorySprites === null)')).toBeLessThan(mapViewIndex);
  });

  it('does not churn the native map surface through lifecycle or FPS conditionals', () => {
    expect(screen.match(/<Mapbox\.MapView\s/g)).toHaveLength(1);
    expect(screen).not.toContain('preferredFramesPerSecond');
    expect(screen).not.toContain('nativeSurfaceAllowed');
  });

  it('keeps spot layers memoized and generates sprites sequentially', () => {
    expect(layers).toContain('React.memo(SpotMapLayersComponent)');
    expect(sprites).toContain('for (const cat of CATEGORIES)');
    expect(sprites).not.toContain('Promise.all(');
  });
});
