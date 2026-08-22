import { useCallback, useSyncExternalStore } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { usePerformance } from '../contexts/PerformanceContext';
import { sharedSecondClock } from '../lib/performance/sharedClock';

export function useSharedNow(enabled = true): number {
  const focused = useIsFocused();
  const { appActive } = usePerformance();
  const active = enabled && focused && appActive;
  const subscribe = useCallback((listener: () => void) => {
    if (!active) return () => undefined;
    return sharedSecondClock.subscribe(listener);
  }, [active]);

  return useSyncExternalStore(
    subscribe,
    sharedSecondClock.getSnapshot,
    sharedSecondClock.getSnapshot,
  );
}
