import { describe, expect, it } from 'vitest';
import { summarizePerformanceUsage, type PerformanceUsageSample } from './usageDiagnostics';

const sample = (patch: Partial<PerformanceUsageSample>): PerformanceUsageSample => ({
  version: 1,
  at: 0,
  elapsedMs: 60_000,
  route: '/home',
  profile: 'standard',
  batteryLevelPct: 80,
  charging: false,
  lowPowerMode: false,
  fps: 60,
  droppedFramePct: 0,
  jsStalls: 0,
  activeTasks: 1,
  hiddenTaskViolations: 0,
  heavySurfaces: 0,
  ...patch,
});

describe('performance usage diagnostics', () => {
  it('calculates discharge rate and attributes cost to screens', () => {
    const summary = summarizePerformanceUsage([
      sample({ at: 1_000, elapsedMs: 0, route: '/home', batteryLevelPct: 80 }),
      sample({ at: 301_000, elapsedMs: 300_000, route: '/(tabs)/map', batteryLevelPct: 79.5, fps: 50 }),
      sample({ at: 601_000, elapsedMs: 300_000, route: '/(tabs)/map', batteryLevelPct: 79, fps: 40 }),
    ]);

    expect(summary.batteryDropPct).toBe(1);
    expect(summary.estimatedBatteryPctPerHour).toBe(6);
    expect(summary.routes.find(row => row.route.includes('/map'))?.batteryDropPct).toBe(1);
  });

  it('does not count charging as application battery drain', () => {
    const summary = summarizePerformanceUsage([
      sample({ at: 1_000, elapsedMs: 0, batteryLevelPct: 50, charging: true }),
      sample({ at: 61_000, batteryLevelPct: 49, charging: true }),
    ]);
    expect(summary.batteryDropPct).toBe(0);
    expect(summary.estimatedBatteryPctPerHour).toBeNull();
  });
});
