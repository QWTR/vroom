export type FinalTripDistanceInputs = {
  foregroundTripKm?: number | null;
  backgroundPendingKm?: number | null;
  checkpointKm?: number | null;
  emergencySnapshotKm?: number | null;
  /** Kept for callers; merge always takes the max of all streams. */
  nativeOwnsSession?: boolean;
  nativeDistanceKm?: number | null;
  /** Prior ledger total for the same session (never discard progress already recorded). */
  previousLedgerKm?: number | null;
};

function safeKm(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Resolves final trip distance as the max of all non-overlapping streams.
 * Never sums sources (they measure the same trip) and never prefers a lagging
 * native/checkpoint total over a larger HUD/JS reading.
 */
export function resolveFinalTripDistanceKm(inputs: FinalTripDistanceInputs): number {
  return Math.max(
    safeKm(inputs.nativeDistanceKm),
    safeKm(inputs.foregroundTripKm),
    safeKm(inputs.backgroundPendingKm),
    safeKm(inputs.checkpointKm),
    safeKm(inputs.emergencySnapshotKm),
    safeKm(inputs.previousLedgerKm),
  );
}
