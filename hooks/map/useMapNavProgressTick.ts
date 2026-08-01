import type { MutableRefObject } from 'react';
import { useEffect, useRef } from 'react';
import { MAP_TICK } from '../useMapTick';
import { useMapTick } from '../useMapTick';

export type UseMapAnchorSyncParams = {
  enabled: boolean;
  syncAnchor: () => void;
};

/** Anchor sync between marker pose and snap state (~600ms). */
export function useMapAnchorSync({ enabled, syncAnchor }: UseMapAnchorSyncParams) {
  const syncRef = useRef(syncAnchor);
  syncRef.current = syncAnchor;

  useMapTick(
    MAP_TICK.anchorSync,
    [() => syncRef.current()],
    enabled,
  );
}

export type UseMapNavProgressTickParams = {
  enabled: boolean;
  runNavProgress: () => void;
};

/** Navigation step progress UI refresh. */
export function useMapNavProgressTick({ enabled, runNavProgress }: UseMapNavProgressTickParams) {
  const runRef = useRef(runNavProgress);
  runRef.current = runNavProgress;

  useEffect(() => {
    if (!enabled) return;
    runRef.current();
  }, [enabled]);

  useMapTick(
    MAP_TICK.navigationProgress,
    [() => runRef.current()],
    enabled,
  );
}
