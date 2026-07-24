import { describe, expect, it } from 'vitest';
import { deriveTripCameraPadding, TRIP_MARKER_SCREEN_Y_RATIO } from './tripCameraPadding';

describe('trip camera padding contract', () => {
  it('anchors the camera center at exactly 80% of map height', () => {
    const height = 800;
    const padding = deriveTripCameraPadding(height);
    expect((height + padding.paddingTop - padding.paddingBottom) / 2).toBe(640);
    expect(TRIP_MARKER_SCREEN_Y_RATIO).toBe(0.8);
  });

  it('preserves the 80% anchor with a bottom occlusion', () => {
    const height = 900;
    const padding = deriveTripCameraPadding(height, 80);
    expect((height + padding.paddingTop - padding.paddingBottom) / 2).toBe(720);
  });

  it('returns zero vertical padding for an unavailable layout', () => {
    expect(deriveTripCameraPadding(Number.NaN, -20).paddingTop).toBe(0);
  });

  it('keeps horizontal padding symmetric', () => {
    const padding = deriveTripCameraPadding(700, 0, 32);
    expect(padding.paddingLeft).toBe(32);
    expect(padding.paddingRight).toBe(32);
  });
});
