import { describe, expect, it } from 'vitest';
import { centeredAvatarDecorationMetrics } from '../../lib/avatarDecorationUi';

describe('ShopAvatarDecoration placement', () => {
  it.each([34, 42, 72, 96])('centers the decoration for avatar size %i', (size) => {
    const metrics = centeredAvatarDecorationMetrics(size);
    expect(metrics.outer / 2 + metrics.margin).toBeCloseTo(0, 8);
    for (const parentSize of [size, size * 1.3, size * 2]) {
      const decorationCenter = (parentSize / 2) + metrics.margin + (metrics.outer / 2);
      expect(decorationCenter).toBeCloseTo(parentSize / 2, 8);
    }
  });
});
