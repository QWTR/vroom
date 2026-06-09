/** Wspólny czas segmentu GPS — marker LERP i kamera Mapbox linearTo. */
export const TRIP_SEGMENT_MIN_MS = 320;
export const TRIP_SEGMENT_MAX_MS = 1200;

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Jedna wartość durationMs dla markera i kamery na tick GPS.
 * Bez modyfikatorów sharp-turn, lag-catchup ani forward-gate.
 */
export function resolveTripSegmentDurationMs(
  cadenceMs: number,
  _pushSegM = 0,
): number {
  const cadence = Number.isFinite(cadenceMs) && cadenceMs > 0 ? cadenceMs : 500;
  return clampNum(
    Math.round(Math.max(cadence, TRIP_SEGMENT_MIN_MS)),
    TRIP_SEGMENT_MIN_MS,
    TRIP_SEGMENT_MAX_MS,
  );
}
