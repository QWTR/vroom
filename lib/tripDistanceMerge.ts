export type FinalTripDistanceInputs = {
  foregroundTripKm?: number | null;
  backgroundPendingKm?: number | null;
  checkpointKm?: number | null;
  emergencySnapshotKm?: number | null;
  /** When true, prefer native distance — but never discard a larger foreground total. */
  nativeOwnsSession?: boolean;
  nativeDistanceKm?: number | null;
};

function safeKm(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Resolves final trip distance using a priority chain — never sums overlapping streams.
 * Native ownership must not wipe a larger HUD/JS total (lagging native ledger was
 * dropping saves when native was in (0, 0.05) while foreground had real km).
 */
export function resolveFinalTripDistanceKm(inputs: FinalTripDistanceInputs): number {
  const nativeKm = safeKm(inputs.nativeDistanceKm);
  const foregroundKm = safeKm(inputs.foregroundTripKm);

  if (inputs.nativeOwnsSession && nativeKm > 0) {
    return Math.max(nativeKm, foregroundKm);
  }

  if (foregroundKm > 0) {
    return foregroundKm;
  }

  const backgroundKm = safeKm(inputs.backgroundPendingKm);
  if (backgroundKm > 0) {
    return backgroundKm;
  }

  const checkpointKm = safeKm(inputs.checkpointKm);
  if (checkpointKm > 0) {
    return checkpointKm;
  }

  return safeKm(inputs.emergencySnapshotKm);
}
