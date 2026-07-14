export type FinalTripDistanceInputs = {
  foregroundTripKm?: number | null;
  backgroundPendingKm?: number | null;
  checkpointKm?: number | null;
  emergencySnapshotKm?: number | null;
  /** When true, native accumulator is the single source of truth for session distance. */
  nativeOwnsSession?: boolean;
  nativeDistanceKm?: number | null;
};

function safeKm(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Resolves final trip distance using a priority chain — never sums overlapping streams.
 * When native background tracking owns the session, native distance is authoritative.
 */
export function resolveFinalTripDistanceKm(inputs: FinalTripDistanceInputs): number {
  const nativeKm = safeKm(inputs.nativeDistanceKm);
  if (inputs.nativeOwnsSession && nativeKm > 0) {
    return nativeKm;
  }

  const foregroundKm = safeKm(inputs.foregroundTripKm);
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
