import { track } from '../analytics/client';
import type { PerformanceProfile } from './policy';
import { managedTaskStats } from './taskRegistry';

const resumeSamples: number[] = [];
let summariesSent = 0;
const heavySurfaces = new Set<string>();
let maxHeavySurfaces = 0;
let sampledFrames = 0;
let sampledDroppedFrames = 0;

export function registerHeavySurface(id: string): () => void {
  heavySurfaces.add(id);
  maxHeavySurfaces = Math.max(maxHeavySurfaces, heavySurfaces.size);
  return () => { heavySurfaces.delete(id); };
}

export function performanceRuntimeStats(): { heavySurfaces: number; maxHeavySurfaces: number } {
  return { heavySurfaces: heavySurfaces.size, maxHeavySurfaces };
}

export function recordFrameWindow(totalFrames: number, droppedFrames: number): void {
  sampledFrames += Math.max(0, Math.round(totalFrames));
  sampledDroppedFrames += Math.max(0, Math.round(droppedFrames));
}

export function recordSceneResume(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  resumeSamples.push(Math.min(10_000, Math.round(durationMs)));
  if (resumeSamples.length > 100) resumeSamples.shift();
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))] ?? 0;
}

export function flushPerformanceSummary(profile: PerformanceProfile, reason: 'interval' | 'background'): void {
  const tasks = managedTaskStats();
  const p95 = percentile(resumeSamples, 0.95);
  const droppedRatio = sampledFrames > 0 ? sampledDroppedFrames / sampledFrames : 0;
  track({
    eventName: 'ui_action',
    surface: 'performance',
    priority: 'low',
    properties: {
      action: 'performance_summary',
      reason,
      profile,
      resume_p95_bucket_ms: p95 <= 100 ? 100 : p95 <= 250 ? 250 : p95 <= 500 ? 500 : p95 <= 1000 ? 1000 : 10000,
      resume_samples: resumeSamples.length,
      managed_tasks: tasks.active,
      duplicate_task_starts: tasks.duplicateStarts,
      hidden_task_violations: tasks.hiddenViolations,
      heavy_surfaces_active: heavySurfaces.size,
      heavy_surfaces_max: maxHeavySurfaces,
      dropped_frame_bucket: droppedRatio < 0.01 ? 'lt_1pct' : droppedRatio < 0.05 ? '1_5pct' : droppedRatio < 0.15 ? '5_15pct' : 'gte_15pct',
      summary_index: summariesSent,
    },
  });
  summariesSent += 1;
  resumeSamples.length = 0;
  sampledFrames = 0;
  sampledDroppedFrames = 0;
  maxHeavySurfaces = heavySurfaces.size;
}
