import { describe, expect, it } from 'vitest';
import { shouldStopNavigationForDropClaim } from './dropClaimNavigation';

describe('drop claim navigation continuity', () => {
  it('keeps an unrelated active route after a drive-by claim', () => {
    expect(shouldStopNavigationForDropClaim({ hadNavigationTarget: false })).toBe(false);
  });

  it('ends navigation only when the claimed drop was the selected target', () => {
    expect(shouldStopNavigationForDropClaim({ hadNavigationTarget: true })).toBe(true);
  });
});
