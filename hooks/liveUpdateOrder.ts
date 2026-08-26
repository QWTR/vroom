export function isLiveUpdateNewer(input: {
  previousSeq?: number | null;
  previousServerAt?: number | null;
  incomingSeq?: number | null;
  incomingServerAt?: number | null;
}): boolean {
  if (Number.isFinite(input.incomingSeq) && Number.isFinite(input.previousSeq)) {
    return Number(input.incomingSeq) > Number(input.previousSeq);
  }
  if (Number.isFinite(input.incomingServerAt) && Number.isFinite(input.previousServerAt)) {
    return Number(input.incomingServerAt) > Number(input.previousServerAt);
  }
  return !Number.isFinite(input.previousSeq) && !Number.isFinite(input.previousServerAt);
}

/**
 * Liveness opiera się na chwili odebrania danych przez ten telefon.
 * Czas fixa pochodzi z obcego urządzenia i może mieć przesunięty zegar.
 */
export function resolveLiveUserLivenessAt(
  lastReceivedAt?: number | null,
  fixAt?: number | null,
): number {
  if (Number.isFinite(lastReceivedAt) && Number(lastReceivedAt) > 0) {
    return Number(lastReceivedAt);
  }
  if (Number.isFinite(fixAt) && Number(fixAt) > 0) {
    return Number(fixAt);
  }
  return 0;
}
