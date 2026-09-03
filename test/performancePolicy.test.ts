import { describe, expect, it } from 'vitest';
import { mediaPreloadRadius, resolveMapFps, resolveSceneCapabilities } from '../lib/performance/policy';
import {
  acquireManagedTask,
  managedTaskStats,
  releaseManagedTask,
  resetManagedTaskRegistryForTests,
  shouldRunManagedTask,
} from '../lib/performance/taskRegistry';

describe('performance policy', () => {
  it('fully suspends an inactive scene', () => {
    expect(resolveSceneCapabilities({ focused: false, appActive: true, suspended: true })).toMatchObject({
      phase: 'suspended', networkAllowed: false, locationMode: 'off', nativeSurfaceAllowed: false,
    });
  });

  it('keeps only the trip engine alive outside the map', () => {
    expect(resolveSceneCapabilities({ focused: false, appActive: true, suspended: true, tripActive: true })).toMatchObject({
      phase: 'backgroundDrive', locationMode: 'trip', uiVisible: false, nativeSurfaceAllowed: false,
    });
  });

  it('uses the selected fps policy', () => {
    expect(resolveMapFps({ profile: 'standard', speedKmh: 40 })).toBe(60);
    expect(resolveMapFps({ profile: 'standard', speedKmh: 0, idleForMs: 5_000 })).toBe(15);
    expect(resolveMapFps({ profile: 'battery', speedKmh: 60 })).toBe(30);
    expect(resolveMapFps({ profile: 'smooth', speedKmh: 0, idleForMs: 10_000 })).toBe(30);
    expect(resolveMapFps({ profile: 'standard', speedKmh: 0, interacting: true, idleForMs: 60_000 })).toBe(60);
    expect(resolveMapFps({ profile: 'smooth', speedKmh: 0, interacting: true, idleForMs: 60_000 })).toBe(60);
  });

  it('limits media preload in battery mode', () => {
    expect(mediaPreloadRadius('battery')).toBe(0);
    expect(mediaPreloadRadius('standard')).toBe(1);
  });
});

describe('managed task registry', () => {
  it('deduplicates a task id', () => {
    resetManagedTaskRegistryForTests();
    expect(acquireManagedTask('poll')).toBe(true);
    expect(acquireManagedTask('poll')).toBe(false);
    expect(managedTaskStats()).toEqual({ active: 1, duplicateStarts: 1, hiddenViolations: 0 });
    releaseManagedTask('poll');
  });

  it('allows active-only work only for an active foreground scene', () => {
    expect(shouldRunManagedTask({ policy: 'activeOnly', sceneActive: false, appActive: true, tripActive: false })).toBe(false);
    expect(shouldRunManagedTask({ policy: 'activeOnly', sceneActive: true, appActive: true, tripActive: false })).toBe(true);
  });
});
