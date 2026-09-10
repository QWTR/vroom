import { describe, expect, it, vi } from 'vitest';
vi.mock('../analytics/client', () => ({ track: vi.fn() }));
import {
  flushPerformanceSummary,
  navigationMotionSnapshot,
  recordNavigationMotion,
  recordNavigationRouteRebuild,
  setNavigationDiagnosticsEnabled,
} from './telemetry';

describe('optional navigation diagnostics', () => {
  it('records only when enabled and resets the reporting window after a summary', () => {
    setNavigationDiagnosticsEnabled(false);
    recordNavigationMotion({ cameraWrites: 10, markerWrites: 10, frames: 10 });
    recordNavigationRouteRebuild(false);
    expect(navigationMotionSnapshot()).toEqual({ cameraWrites: 0, markerWrites: 0, frames: 0, routeRebuilds: 0, hiddenVisualWork: 0 });
    setNavigationDiagnosticsEnabled(true);
    recordNavigationMotion({ cameraWrites: 15, markerWrites: 12, frames: 30 });
    recordNavigationRouteRebuild(true);
    expect(navigationMotionSnapshot()).toEqual({ cameraWrites: 15, markerWrites: 12, frames: 30, routeRebuilds: 1, hiddenVisualWork: 0 });
    flushPerformanceSummary('standard', 'interval');
    expect(navigationMotionSnapshot().cameraWrites).toBe(0);
    setNavigationDiagnosticsEnabled(false);
  });
});
