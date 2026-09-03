export const TRANSIENT_OFF_ROAD_HOLD_MS = 4_500;
export const TRANSIENT_OFF_ROAD_MIN_SPEED_MS = 2.5;

/**
 * Keep the rendered car on its last accepted road arc while a single noisy GPS
 * sample is being rematched. A real off-road transition wins after the short
 * grace window, at low speed, or whenever the caller requests an instant pose.
 */
export function shouldHoldTransientOffRoadPose(input: {
  previousWasOnRoad: boolean;
  hasRoadWindow: boolean;
  speedMs: number;
  elapsedSinceRoadMs: number;
  allowInstant: boolean;
}): boolean {
  return !input.allowInstant
    && input.previousWasOnRoad
    && input.hasRoadWindow
    && Number.isFinite(input.speedMs)
    && input.speedMs >= TRANSIENT_OFF_ROAD_MIN_SPEED_MS
    && input.elapsedSinceRoadMs >= 0
    && input.elapsedSinceRoadMs <= TRANSIENT_OFF_ROAD_HOLD_MS;
}
