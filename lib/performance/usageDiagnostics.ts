import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PerformanceProfile } from './policy';

const STORAGE_KEY = '@vroom/performance_usage_samples:v1';
const MAX_SAMPLES = 720;
const MAX_SAMPLE_GAP_MS = 120_000;

export type PerformanceUsageSample = {
  version: 1;
  at: number;
  elapsedMs: number;
  route: string;
  profile: PerformanceProfile;
  batteryLevelPct: number | null;
  charging: boolean | null;
  lowPowerMode: boolean | null;
  fps: number;
  droppedFramePct: number;
  jsStalls: number;
  activeTasks: number;
  hiddenTaskViolations: number;
  heavySurfaces: number;
};

export type PerformanceUsageSummary = {
  samples: number;
  trackedMs: number;
  batteryLevelPct: number | null;
  batteryDropPct: number;
  dischargeObservedMs: number;
  estimatedBatteryPctPerHour: number | null;
  averageFps: number;
  droppedFramePct: number;
  jsStalls: number;
  activeTasks: number;
  hiddenTaskViolations: number;
  heavySurfaces: number;
  routes: Array<{ route: string; trackedMs: number; batteryDropPct: number; averageFps: number }>;
};

let cache: PerformanceUsageSample[] | null = null;
let storageQueue = Promise.resolve();
const listeners = new Set<() => void>();

function isSample(value: unknown): value is PerformanceUsageSample {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PerformanceUsageSample>;
  return row.version === 1 && Number.isFinite(row.at) && typeof row.route === 'string';
}

async function loadSamples(): Promise<PerformanceUsageSample[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isSample).slice(-MAX_SAMPLES) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function notify(): void {
  listeners.forEach(listener => listener());
}

export function subscribePerformanceUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function readPerformanceUsageSamples(): Promise<PerformanceUsageSample[]> {
  return [...await loadSamples()];
}

export function appendPerformanceUsageSample(
  input: Omit<PerformanceUsageSample, 'version' | 'elapsedMs'>,
): Promise<void> {
  storageQueue = storageQueue.then(async () => {
    const samples = await loadSamples();
    const previous = samples[samples.length - 1];
    const gapMs = previous ? input.at - previous.at : 0;
    const elapsedMs = previous && gapMs >= 0 && gapMs <= MAX_SAMPLE_GAP_MS ? gapMs : 0;
    samples.push({ ...input, version: 1, elapsedMs });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
    notify();
  }).catch(() => {});
  return storageQueue;
}

export async function clearPerformanceUsageSamples(): Promise<void> {
  cache = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
  notify();
}

export function summarizePerformanceUsage(samples: PerformanceUsageSample[]): PerformanceUsageSummary {
  let trackedMs = 0;
  let dischargeObservedMs = 0;
  let batteryDropPct = 0;
  let fpsWeighted = 0;
  let droppedWeighted = 0;
  let jsStalls = 0;
  const routes = new Map<string, { trackedMs: number; batteryDropPct: number; fpsWeighted: number }>();

  samples.forEach((sample, index) => {
    trackedMs += sample.elapsedMs;
    fpsWeighted += sample.fps * sample.elapsedMs;
    droppedWeighted += sample.droppedFramePct * sample.elapsedMs;
    jsStalls += sample.jsStalls;
    const route = routes.get(sample.route) ?? { trackedMs: 0, batteryDropPct: 0, fpsWeighted: 0 };
    route.trackedMs += sample.elapsedMs;
    route.fpsWeighted += sample.fps * sample.elapsedMs;

    const previous = samples[index - 1];
    if (
      previous
      && previous.batteryLevelPct != null
      && sample.batteryLevelPct != null
      && previous.charging === false
      && sample.charging === false
      && sample.elapsedMs > 0
    ) {
      const drop = sample.batteryLevelPct <= previous.batteryLevelPct
        ? Math.max(0, previous.batteryLevelPct - sample.batteryLevelPct)
        : 0;
      batteryDropPct += drop;
      dischargeObservedMs += sample.elapsedMs;
      route.batteryDropPct += drop;
    }
    routes.set(sample.route, route);
  });

  const latest = samples[samples.length - 1];
  return {
    samples: samples.length,
    trackedMs,
    batteryLevelPct: latest?.batteryLevelPct ?? null,
    batteryDropPct,
    dischargeObservedMs,
    estimatedBatteryPctPerHour: dischargeObservedMs >= 5 * 60_000 && batteryDropPct > 0
      ? batteryDropPct / (dischargeObservedMs / 3_600_000)
      : null,
    averageFps: trackedMs > 0 ? fpsWeighted / trackedMs : latest?.fps ?? 0,
    droppedFramePct: trackedMs > 0 ? droppedWeighted / trackedMs : latest?.droppedFramePct ?? 0,
    jsStalls,
    activeTasks: latest?.activeTasks ?? 0,
    hiddenTaskViolations: latest?.hiddenTaskViolations ?? 0,
    heavySurfaces: latest?.heavySurfaces ?? 0,
    routes: Array.from(routes.entries())
      .map(([route, value]) => ({
        route,
        trackedMs: value.trackedMs,
        batteryDropPct: value.batteryDropPct,
        averageFps: value.trackedMs > 0 ? value.fpsWeighted / value.trackedMs : 0,
      }))
      .filter(row => row.trackedMs > 0)
      .sort((a, b) => b.trackedMs - a.trackedMs),
  };
}
