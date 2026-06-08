/** Progi potwierdzenia fizycznego skrętu (free-drive). */
export const TURN_CONFIRM_MIN_KMH = 8;
export const TURN_CONFIRM_DELTA_DEG = 45;
export const TURN_CONFIRM_STRONG_DEG = 55;
export const TURN_CONFIRM_TICKS_REQUIRED = 3;
export const TURN_CONFIRM_STRONG_TICKS = 2;
export const TURN_BUFFER_MAX = 4;

export type TurnConfirmSample = {
  rawDeltaDeg: number;
  atMs: number;
};

export type TurnConfirmState = {
  samples: TurnConfirmSample[];
};

export function createTurnConfirmState(): TurnConfirmState {
  return { samples: [] };
}

export function resetTurnConfirmState(state: TurnConfirmState): void {
  state.samples = [];
}

function headingDeltaAbs(from: number, to: number): number {
  return Math.abs(((to - from + 540) % 360) - 180);
}

/**
 * Pojedynczy tick — czy kąt sugeruje skręt (bez potwierdzenia).
 */
export function isTurnSample(
  prevHeadingDeg: number,
  rawTravelHeadingDeg: number,
  engineHeadingDeg: number,
  speedKmh: number,
): boolean {
  if (speedKmh < TURN_CONFIRM_MIN_KMH) return false;
  if (!Number.isFinite(prevHeadingDeg)) return false;
  const rawDelta = headingDeltaAbs(prevHeadingDeg, rawTravelHeadingDeg);
  const engineDelta = headingDeltaAbs(prevHeadingDeg, engineHeadingDeg);
  return rawDelta >= TURN_CONFIRM_DELTA_DEG || engineDelta >= TURN_CONFIRM_DELTA_DEG;
}

/**
 * Aktualizuje bufor i zwraca czy skręt jest potwierdzony (debounce).
 */
export function updateTurnConfirmState(
  state: TurnConfirmState,
  prevHeadingDeg: number,
  rawTravelHeadingDeg: number,
  engineHeadingDeg: number,
  speedKmh: number,
  nowMs = Date.now(),
): { turnSample: boolean; confirmedTurn: boolean } {
  const turnSample = isTurnSample(
    prevHeadingDeg,
    rawTravelHeadingDeg,
    engineHeadingDeg,
    speedKmh,
  );

  if (!turnSample || speedKmh < TURN_CONFIRM_MIN_KMH) {
    state.samples = [];
    return { turnSample: false, confirmedTurn: false };
  }

  const rawDelta = headingDeltaAbs(prevHeadingDeg, rawTravelHeadingDeg);
  state.samples.push({ rawDeltaDeg: rawDelta, atMs: nowMs });
  if (state.samples.length > TURN_BUFFER_MAX) {
    state.samples.shift();
  }

  const strongCount = state.samples.filter(
    (s) => s.rawDeltaDeg >= TURN_CONFIRM_STRONG_DEG,
  ).length;
  const moderateCount = state.samples.filter(
    (s) => s.rawDeltaDeg >= TURN_CONFIRM_DELTA_DEG,
  ).length;

  const confirmedTurn =
    strongCount >= TURN_CONFIRM_STRONG_TICKS
    || moderateCount >= TURN_CONFIRM_TICKS_REQUIRED;

  return { turnSample, confirmedTurn };
}
