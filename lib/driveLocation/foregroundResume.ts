export type ForegroundGpsResumeInput = {
  tripActive: boolean;
  foregroundGpsIntentionallyStopped: boolean;
  forceWatcherRestart: boolean;
};

/** A short background pause still needs a new foreground watcher when we stopped it deliberately. */
export function shouldRestartGpsAfterForegroundResume(
  input: ForegroundGpsResumeInput,
): boolean {
  return input.tripActive
    && input.foregroundGpsIntentionallyStopped
    && !input.forceWatcherRestart;
}
