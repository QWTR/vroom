/** RouteInfo.duration is expressed in minutes; trip statistics use seconds. */
export function routeDurationMinutesToSeconds(durationMinutes: unknown): number {
  const minutes = Number(durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round(minutes * 60);
}

/**
 * Recalculate ETA from progress along the current route. Directions duration is
 * the estimate for the whole route, so keeping it unchanged after every GPS
 * tick makes the HUD permanently show the original value.
 */
export function estimateRemainingRouteMinutes(input: {
  routeDurationMinutes: unknown;
  routeDistanceMeters: unknown;
  remainingDistanceKm: unknown;
}): number | null {
  const durationMinutes = Number(input.routeDurationMinutes);
  const routeDistanceMeters = Number(input.routeDistanceMeters);
  const remainingDistanceKm = Number(input.remainingDistanceKm);
  if (
    !Number.isFinite(durationMinutes)
    || durationMinutes <= 0
    || !Number.isFinite(routeDistanceMeters)
    || routeDistanceMeters <= 0
    || !Number.isFinite(remainingDistanceKm)
    || remainingDistanceKm < 0
  ) return null;

  const remainingMeters = remainingDistanceKm * 1_000;
  if (remainingMeters <= 30) return 0;
  const routeFraction = Math.min(1, remainingMeters / routeDistanceMeters);
  return Math.max(1, Math.ceil(durationMinutes * routeFraction));
}
