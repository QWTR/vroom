import { afterEach, describe, expect, it } from 'vitest';
import {
  isMapPathname,
  setMapScreenVisible,
  shouldSuppressMapForegroundOverlay,
} from './mapScreenVisibility';

describe('map screen overlay suppression', () => {
  afterEach(() => setMapScreenVisible(false));

  it('recognizes normalized and grouped map paths', () => {
    expect(isMapPathname('/map')).toBe(true);
    expect(isMapPathname('/(tabs)/map')).toBe(true);
    expect(isMapPathname('/map/')).toBe(true);
    expect(isMapPathname('/spotmap')).toBe(false);
  });

  it('suppresses overlays only while the map is visible in foreground', () => {
    setMapScreenVisible(true);
    expect(shouldSuppressMapForegroundOverlay('active')).toBe(true);
    expect(shouldSuppressMapForegroundOverlay('background')).toBe(false);
    expect(shouldSuppressMapForegroundOverlay('inactive')).toBe(false);
  });
});
