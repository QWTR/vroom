/**
 * Korelacja logów V10 — jeden gpsTickId na paczkę GPS (łańcuch RAW → SNAP → WORKLET → UI).
 */
let currentGpsTickId: number | null = null;
let currentGpsTickWallMs: number | null = null;

export function beginGpsTick(opts: {
  lat: number;
  lng: number;
  osTimestamp?: number | null;
}): number {
  const osTs = opts.osTimestamp;
  const tickId =
    osTs != null && Number.isFinite(osTs) && osTs > 1_000_000_000_000
      ? Math.round(osTs)
      : Date.now();
  currentGpsTickId = tickId;
  currentGpsTickWallMs = Date.now();
  return tickId;
}

export function getGpsTickId(): number | null {
  return currentGpsTickId;
}

/** Alias — ostatni gpsTickId z beginGpsTick(). */
export const currentGpsTickId = getGpsTickId;

export function gpsTickPayload(extra?: Record<string, unknown>): Record<string, unknown> {
  const wall = currentGpsTickWallMs;
  return {
    gpsTickId: currentGpsTickId,
    gpsTickAgeMs: wall != null ? Date.now() - wall : null,
    ...(extra ?? {}),
  };
}

export function clearGpsTick(): void {
  currentGpsTickId = null;
  currentGpsTickWallMs = null;
}
