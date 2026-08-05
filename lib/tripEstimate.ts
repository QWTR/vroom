/** RouteInfo.duration is expressed in minutes; trip statistics use seconds. */
export function routeDurationMinutesToSeconds(durationMinutes: unknown): number {
  const minutes = Number(durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round(minutes * 60);
}
