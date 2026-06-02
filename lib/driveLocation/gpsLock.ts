/** Progi lock GPS — współdzielone z hookiem i testami. */
export const GPS_LOCK_MAX_ACC_M = 20;
export const GPS_LOCK_CONSECUTIVE_FIXES = 2;
export const GPS_LOCK_MIN_GAP_MS = 300;
export const GPS_LOCK_TIMEOUT_MS = 15_000;

export type GpsLockState = {
  established: boolean;
  watchStartedAt: number;
  consecutiveGood: number;
  lastGoodFixAt: number;
};

export function createGpsLockState(now = Date.now()): GpsLockState {
  return {
    established: false,
    watchStartedAt: now,
    consecutiveGood: 0,
    lastGoodFixAt: 0,
  };
}

export function resetGpsLockState(state: GpsLockState, now = Date.now()): void {
  state.established = false;
  state.watchStartedAt = now;
  state.consecutiveGood = 0;
  state.lastGoodFixAt = 0;
}

/**
 * Aktualizuje stan locku. Zwraca true gdy lock został właśnie uzyskany (edge).
 */
export function updateGpsLock(
  state: GpsLockState,
  accuracyM: number,
  now = Date.now(),
): boolean {
  if (state.established) return false;
  if (!Number.isFinite(accuracyM)) return false;

  if (
    now - state.watchStartedAt >= GPS_LOCK_TIMEOUT_MS
    && accuracyM <= GPS_LOCK_MAX_ACC_M
  ) {
    state.established = true;
    return true;
  }

  if (accuracyM <= GPS_LOCK_MAX_ACC_M) {
    if (
      state.lastGoodFixAt > 0
      && now - state.lastGoodFixAt >= GPS_LOCK_MIN_GAP_MS
    ) {
      state.consecutiveGood += 1;
    } else {
      state.consecutiveGood = 1;
    }
    state.lastGoodFixAt = now;
    if (state.consecutiveGood >= GPS_LOCK_CONSECUTIVE_FIXES) {
      state.established = true;
      return true;
    }
  } else {
    state.consecutiveGood = 0;
    state.lastGoodFixAt = 0;
  }

  return false;
}

export function shouldEmitLocationFix(
  state: GpsLockState,
  accuracyM: number,
): boolean {
  if (state.established) return true;
  return accuracyM <= GPS_LOCK_MAX_ACC_M;
}
