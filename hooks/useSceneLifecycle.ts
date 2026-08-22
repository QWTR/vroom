import { useIsFocused } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { usePerformance } from '../contexts/PerformanceContext';
import {
  resolveSceneCapabilities,
  SCENE_SUSPEND_DELAY_MS,
  type SceneCapabilities,
} from '../lib/performance/policy';
import { recordSceneResume } from '../lib/performance/telemetry';

export type SceneLifecyclePolicy = {
  tripActive?: boolean;
  covered?: boolean;
  suspendDelayMs?: number;
};

export function useSceneLifecycle(_sceneId: string, policy: SceneLifecyclePolicy = {}): SceneCapabilities {
  const focused = useIsFocused();
  const { appActive, profile } = usePerformance();
  const [suspended, setSuspended] = useState(!focused);

  useEffect(() => {
    if (focused) {
      setSuspended(false);
      const startedAt = Date.now();
      let secondFrame = 0;
      const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => recordSceneResume(Date.now() - startedAt));
      });
      return () => {
        cancelAnimationFrame(firstFrame);
        if (secondFrame) cancelAnimationFrame(secondFrame);
      };
    }
    const timer = setTimeout(
      () => setSuspended(true),
      Math.max(0, policy.suspendDelayMs ?? SCENE_SUSPEND_DELAY_MS),
    );
    return () => clearTimeout(timer);
  }, [focused, policy.suspendDelayMs]);

  return useMemo(() => resolveSceneCapabilities({
    focused,
    appActive,
    suspended,
    tripActive: policy.tripActive,
    covered: policy.covered,
    profile,
  }), [appActive, focused, policy.covered, policy.tripActive, profile, suspended]);
}
