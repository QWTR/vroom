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
