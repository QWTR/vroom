import { describe, expect, it } from 'vitest';
import {
  createTurnConfirmState,
  resetTurnConfirmState,
  TURN_CONFIRM_DELTA_DEG,
  updateTurnConfirmState,
} from './turnConfirmBuffer';

describe('updateTurnConfirmState', () => {
  it('does not confirm turn on single noisy tick', () => {
    const state = createTurnConfirmState();
    const r = updateTurnConfirmState(state, 0, TURN_CONFIRM_DELTA_DEG + 5, 0, 20);
    expect(r.turnSample).toBe(true);
    expect(r.confirmedTurn).toBe(false);
  });

  it('confirms turn after three moderate ticks', () => {
    const state = createTurnConfirmState();
    let confirmed = false;
    for (let i = 0; i < 3; i++) {
      const r = updateTurnConfirmState(state, 0, 50, 0, 25, 1000 + i * 200);
      confirmed = r.confirmedTurn;
    }
    expect(confirmed).toBe(true);
  });

  it('resets buffer when speed drops', () => {
    const state = createTurnConfirmState();
    updateTurnConfirmState(state, 0, 50, 0, 25);
    updateTurnConfirmState(state, 0, 50, 0, 25);
    resetTurnConfirmState(state);
    const r = updateTurnConfirmState(state, 0, 50, 0, 3);
    expect(r.confirmedTurn).toBe(false);
    expect(state.samples.length).toBe(0);
  });
});
