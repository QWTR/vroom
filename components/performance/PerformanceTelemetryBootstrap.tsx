import { useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';
import { usePerformance } from '../../contexts/PerformanceContext';
import { flushPerformanceSummary } from '../../lib/performance/telemetry';
import { performanceRuntimeStats, recordFrameWindow } from '../../lib/performance/telemetry';
import { managedTaskStats } from '../../lib/performance/taskRegistry';
import { appendPerformanceUsageSample } from '../../lib/performance/usageDiagnostics';

const SUMMARY_INTERVAL_MS = 15 * 60 * 1000;

type BatterySnapshot = {
  batteryLevelPct: number | null;
  charging: boolean | null;
  lowPowerMode: boolean | null;
};

async function readBatterySnapshot(): Promise<BatterySnapshot> {
  try {
    // Dynamic import keeps this OTA safe for runtime 1.0.28, whose native binary
    // does not contain expo-battery yet.
    const Battery = await import('expo-battery');
    const available = await Battery.isAvailableAsync().catch(() => false);
    if (!available) return { batteryLevelPct: null, charging: null, lowPowerMode: null };
    const [batteryLevel, batteryState, lowPowerMode] = await Promise.all([
      Battery.getBatteryLevelAsync().catch(() => -1),
      Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN),
      Battery.isLowPowerModeEnabledAsync().catch(() => false),
    ]);
    return {
      batteryLevelPct: batteryLevel >= 0 ? Math.round(batteryLevel * 1000) / 10 : null,
      charging: batteryState === Battery.BatteryState.UNKNOWN
        ? null
        : batteryState === Battery.BatteryState.CHARGING || batteryState === Battery.BatteryState.FULL,
      lowPowerMode,
    };
  } catch {
    return { batteryLevelPct: null, charging: null, lowPowerMode: null };
  }
}

export function PerformanceTelemetryBootstrap() {
  const { appState, profile, diagnosticsEnabled } = usePerformance();
  const pathname = usePathname();
  const previousAppState = useRef(appState);
  const pathnameRef = useRef(pathname);
  const profileRef = useRef(profile);
  const diagnosticsEnabledRef = useRef(diagnosticsEnabled);

  pathnameRef.current = pathname;
  profileRef.current = profile;
  diagnosticsEnabledRef.current = diagnosticsEnabled;

  useEffect(() => {
    if (previousAppState.current === 'active' && appState !== 'active') {
      flushPerformanceSummary(profile, 'background');
    }
    previousAppState.current = appState;
  }, [appState, profile]);

  useEffect(() => {
    if (appState !== 'active') return undefined;
    let samplerTimer: ReturnType<typeof setInterval> | null = null;
    let frame = 0;
    let cancelled = false;

    const sample = () => {
      const startedAt = performance.now();
      let previousAt = startedAt;
      let frames = 0;
      let dropped = 0;
      const tick = (at: number) => {
        if (cancelled) return;
        const delta = at - previousAt;
        previousAt = at;
        frames += 1;
        if (delta > 24) dropped += Math.max(1, Math.round(delta / 16.67) - 1);
        if (at - startedAt < 1000) frame = requestAnimationFrame(tick);
        else {
          const totalFrames = frames + dropped;
          recordFrameWindow(totalFrames, dropped);
          if (diagnosticsEnabledRef.current) {
            const tasks = managedTaskStats();
            const surfaces = performanceRuntimeStats();
            void readBatterySnapshot().then((battery) => {
              if (!diagnosticsEnabledRef.current) return undefined;
              return appendPerformanceUsageSample({
              at: Date.now(),
              route: pathnameRef.current || '/',
              profile: profileRef.current,
              batteryLevelPct: battery.batteryLevelPct,
              charging: battery.charging,
              lowPowerMode: battery.lowPowerMode,
              fps: Math.max(0, Math.min(60, Math.round(frames))),
              droppedFramePct: totalFrames > 0 ? Math.round((dropped / totalFrames) * 10_000) / 100 : 0,
              jsStalls: dropped,
              activeTasks: tasks.active,
              hiddenTaskViolations: tasks.hiddenViolations,
              heavySurfaces: surfaces.heavySurfaces,
              });
            });
          }
        }
      };
      frame = requestAnimationFrame(tick);
    };

    sample();
    samplerTimer = setInterval(sample, 60_000);
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      if (samplerTimer) clearInterval(samplerTimer);
    };
  }, [appState]);

  useEffect(() => {
    if (appState !== 'active') return undefined;
    const timer = setInterval(() => flushPerformanceSummary(profile, 'interval'), SUMMARY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [appState, profile]);

  return null;
}
