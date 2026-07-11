export type FinalTripDistanceInputs = {
  foregroundTripKm?: number | null;
  backgroundPendingKm?: number | null;
  checkpointKm?: number | null;
  emergencySnapshotKm?: number | null;
};

function safeKm(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function resolveFinalTripDistanceKm(inputs: FinalTripDistanceInputs): number {
  const foregroundTripKm = safeKm(inputs.foregroundTripKm);
  const backgroundPendingKm = safeKm(inputs.backgroundPendingKm);
  const checkpointKm = safeKm(inputs.checkpointKm);
  const emergencySnapshotKm = safeKm(inputs.emergencySnapshotKm);

  return Math.max(
    foregroundTripKm,
    backgroundPendingKm,
    checkpointKm,
    emergencySnapshotKm,
  );
}
