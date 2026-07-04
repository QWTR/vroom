import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Po tym czasie w tle — wymuszony hard restart watchera GPS. */
export const GPS_BACKGROUND_STALE_MS = 25_000;
/** Po długim tle — pomiń dedupe resume (ms). */
export const GPS_RESUME_LONG_BG_MS = 60_000;

export type GpsForegroundResumeContext = {
  source: 'foreground' | 'focus';
  bgPauseMs: number;
  prevState: AppStateStatus;
  nextState: AppStateStatus;
  tripActive: boolean;
  forceWatcherRestart: boolean;
};

type Options = {
  enabled?: boolean;
  getTripActive: () => boolean;
  getLastBackgroundAt: () => number;
  getFixAgeMs: () => number;
  getTickAgeMs: () => number;
  hardRestart: (reason: string, opts?: { preserveLock?: boolean }) => Promise<void>;
  onResume: (ctx: GpsForegroundResumeContext) => void;
};

export function shouldForceGpsHardRestart(bgPauseMs: number): boolean {
  return bgPauseMs >= GPS_BACKGROUND_STALE_MS;
}

export function shouldSkipResumeDedupe(bgPauseMs: number): boolean {
  return bgPauseMs >= GPS_RESUME_LONG_BG_MS;
}

/**
 * Nasłuch AppState — wymusza hardRestart po długim tle i deleguje resync do map.tsx.
 */
export function useGpsForegroundLifecycle({
  enabled = true,
  getTripActive,
  getLastBackgroundAt,
  hardRestart,
  onResume,
}: Options): void {
  const getTripActiveRef = useRef(getTripActive);
  const getLastBackgroundAtRef = useRef(getLastBackgroundAt);
  const hardRestartRef = useRef(hardRestart);
  const onResumeRef = useRef(onResume);

  useEffect(() => { getTripActiveRef.current = getTripActive; }, [getTripActive]);
  useEffect(() => { getLastBackgroundAtRef.current = getLastBackgroundAt; }, [getLastBackgroundAt]);
  useEffect(() => { hardRestartRef.current = hardRestart; }, [hardRestart]);
  useEffect(() => { onResumeRef.current = onResume; }, [onResume]);

  useEffect(() => {
    if (!enabled) return;

    const appStateRef = { current: AppState.currentState as AppStateStatus };

    const sub = AppState.addEventListener('change', (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      const resumed =
        (prevState === 'background' || prevState === 'inactive')
        && nextState === 'active';
      if (!resumed) return;

      const now = Date.now();
      const lastBg = getLastBackgroundAtRef.current();
      const bgPauseMs = lastBg > 0 ? now - lastBg : 0;
      const tripActive = getTripActiveRef.current();
      const forceWatcherRestart = tripActive && shouldForceGpsHardRestart(bgPauseMs);

      if (forceWatcherRestart) {
        void hardRestartRef.current(`app_resume_bg_${Math.round(bgPauseMs)}ms`, {
          preserveLock: true,
        });
      }

      onResumeRef.current({
        source: 'foreground',
        bgPauseMs,
        prevState,
        nextState,
        tripActive,
        forceWatcherRestart,
      });
    });

    return () => sub.remove();
  }, [enabled]);
}
