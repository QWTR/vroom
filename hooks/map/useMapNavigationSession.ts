import { useRef } from 'react';
import { useMapNavProgressTick } from './useMapNavProgressTick';

export type UseMapNavigationSessionParams = {
  enabled: boolean;
  runNavProgress: () => void;
};

/**
 * Navigation session UI tick — step progress, off-route detection, remaining distance.
 * GPS/snap pipeline stays in map.tsx until ref-bag stabilizes.
 */
export function useMapNavigationSession({ enabled, runNavProgress }: UseMapNavigationSessionParams) {
  const runRef = useRef(runNavProgress);
  runRef.current = runNavProgress;

  useMapNavProgressTick({
    enabled,
    runNavProgress: () => runRef.current(),
  });
}
