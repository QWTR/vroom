import {
  createGpsLockState,
  resetGpsLockState,
  shouldEmitLocationFix,
  updateGpsLock,
  GPS_LOCK_MAX_ACC_M,
  GPS_LOCK_TIMEOUT_MS,
} from './gpsLock';

describe('gpsLock', () => {
  it('does not emit before lock when accuracy is poor', () => {
    const state = createGpsLockState(1000);
    updateGpsLock(state, 80, 1100);
    expect(state.established).toBe(false);
    expect(shouldEmitLocationFix(state, 80)).toBe(false);
  });

  it('establishes lock after two consecutive good fixes', () => {
    const state = createGpsLockState(1000);
    expect(updateGpsLock(state, 18, 1400)).toBe(false);
    expect(updateGpsLock(state, 15, 1800)).toBe(true);
    expect(state.established).toBe(true);
    expect(shouldEmitLocationFix(state, 25)).toBe(true);
  });

  it('establishes lock on timeout with single good fix', () => {
    const state = createGpsLockState(0);
    const at = GPS_LOCK_TIMEOUT_MS + 100;
    expect(updateGpsLock(state, GPS_LOCK_MAX_ACC_M, at)).toBe(true);
    expect(state.established).toBe(true);
  });

  it('resets lock state on hard restart', () => {
    const state = createGpsLockState(1000);
    updateGpsLock(state, 12, 1500);
    updateGpsLock(state, 10, 1900);
    expect(state.established).toBe(true);
    resetGpsLockState(state, 5000);
    expect(state.established).toBe(false);
    expect(shouldEmitLocationFix(state, 12)).toBe(true);
  });
});
