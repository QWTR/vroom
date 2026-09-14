import { describe, expect, it } from 'vitest';
import { shouldRestartGpsAfterForegroundResume } from './foregroundResume';

describe('foreground GPS resume policy', () => {
  it('restarts a deliberately stopped watcher even after a short background pause', () => {
    expect(shouldRestartGpsAfterForegroundResume({
      tripActive: true,
      foregroundGpsIntentionallyStopped: true,
      forceWatcherRestart: false,
    })).toBe(true);
  });

  it('does not duplicate a hard restart already requested by the lifecycle', () => {
    expect(shouldRestartGpsAfterForegroundResume({
      tripActive: true,
      foregroundGpsIntentionallyStopped: true,
      forceWatcherRestart: true,
    })).toBe(false);
  });

  it('does not start an active watcher without a trip', () => {
    expect(shouldRestartGpsAfterForegroundResume({
      tripActive: false,
      foregroundGpsIntentionallyStopped: true,
      forceWatcherRestart: false,
    })).toBe(false);
  });
});
