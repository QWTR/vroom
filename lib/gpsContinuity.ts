export type GpsContinuityDecision = {
  action: 'continue' | 'reject' | 'reanchor';
  remaining: number;
  reason?: 'invalid_or_inaccurate_fix';
};

export function evaluateGpsContinuityFix(
  remaining: number,
  latitude: number,
  longitude: number,
  accuracyM: number | null | undefined,
  maxAccuracyM: number,
): GpsContinuityDecision {
  if (remaining <= 0) return { action: 'continue', remaining: 0 };
  const valid = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180
    && (accuracyM == null || (Number.isFinite(accuracyM) && accuracyM <= maxAccuracyM));
  if (!valid) return { action: 'reject', remaining, reason: 'invalid_or_inaccurate_fix' };
  return { action: 'reanchor', remaining: Math.max(0, remaining - 1) };
}
