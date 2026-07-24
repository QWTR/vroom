export type TripCameraPadding = {
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
};

export const TRIP_MARKER_SCREEN_Y_RATIO = 0.8;

/** Mapbox places center at (height + top - bottom) / 2. */
export function deriveTripCameraPadding(
  mapHeight: number,
  bottomOcclusion = 0,
  horizontalPadding = 24,
): TripCameraPadding {
  const height = Number.isFinite(mapHeight) ? Math.max(0, mapHeight) : 0;
  const bottom = Number.isFinite(bottomOcclusion) ? Math.max(0, bottomOcclusion) : 0;
  const horizontal = Number.isFinite(horizontalPadding) ? Math.max(0, horizontalPadding) : 0;
  return {
    paddingTop: Math.max(0, (2 * TRIP_MARKER_SCREEN_Y_RATIO - 1) * height + bottom),
    paddingBottom: bottom,
    paddingLeft: horizontal,
    paddingRight: horizontal,
  };
}

