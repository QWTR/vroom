import { useEffect } from 'react';
import { usePerformance } from '../contexts/PerformanceContext';
import {
  acquireManagedTask,
  releaseManagedTask,
  shouldRunManagedTask,
  type ManagedTaskPolicy,
} from '../lib/performance/taskRegistry';

export function useManagedInterval(options: {
  id: string;
  callback: () => void;
  intervalMs: number;
  policy: ManagedTaskPolicy;
  sceneActive?: boolean;
  tripActive?: boolean;
  runImmediately?: boolean;
}) {
  const { appActive } = usePerformance();
  const enabled = shouldRunManagedTask({
    policy: options.policy,
    sceneActive: options.sceneActive ?? false,
    appActive,
    tripActive: options.tripActive ?? false,
  });

  useEffect(() => {
    if (!enabled || options.intervalMs <= 0) return undefined;
    if (!acquireManagedTask(options.id)) return undefined;
    if (options.runImmediately) options.callback();
    const timer = setInterval(options.callback, options.intervalMs);
    return () => {
      clearInterval(timer);
      releaseManagedTask(options.id);
    };
  }, [enabled, options.callback, options.id, options.intervalMs, options.runImmediately]);
}
