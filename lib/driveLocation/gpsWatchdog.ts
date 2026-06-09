/** Watchdog GPS — stałe i backoff (testowalne bez expo-location). */
export const WATCHDOG_POLL_MS = 2500;
export const ACTIVE_STALE_MS = 6000;
export const IDLE_STALE_MS = 8000;
export const GPS_RESTART_BACKOFF_BASE_MS = 1000;
export const GPS_RESTART_BACKOFF_MAX_MS = 30000;

/** Exponential backoff po martwym strumieniu / błędzie subskrypcji. */
export function computeGpsRestartBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(
    GPS_RESTART_BACKOFF_MAX_MS,
    GPS_RESTART_BACKOFF_BASE_MS * (2 ** safeAttempt),
  );
}
