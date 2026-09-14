import { describe, expect, it } from 'vitest';
import { shouldContinueFreeDriveAfterNavigationStop } from './navigationStopPolicy';

describe('navigation stop policy', () => {
  it('returns to free drive when navigation was started during that drive', () => {
    expect(shouldContinueFreeDriveAfterNavigationStop({
      navigationStartedFromFreeDrive: true,
      isNavigating: true,
    })).toBe(true);
  });

  it('finishes a standalone navigation trip', () => {
    expect(shouldContinueFreeDriveAfterNavigationStop({
      navigationStartedFromFreeDrive: false,
      isNavigating: true,
    })).toBe(false);
  });

  it('does not revive free drive after navigation already ended', () => {
    expect(shouldContinueFreeDriveAfterNavigationStop({
      navigationStartedFromFreeDrive: true,
      isNavigating: false,
    })).toBe(false);
  });
});
