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

/**
 * Reject only an explicitly stale server timestamp. A missing timestamp must
 * remain valid because older socket deployments do not attach one, while a
 * client fix timestamp is unsafe for this check due to clock skew.
 */
export function isLiveServerEventFresh(
  serverAt?: number | null,
  now = Date.now(),
  maxAgeMs = 90_000,
): boolean {
  if (!Number.isFinite(serverAt) || Number(serverAt) <= 0) return true;
  return now - Number(serverAt) <= maxAgeMs;
}
