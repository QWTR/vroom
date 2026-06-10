/** V3 navigation constants — keep in sync with snapEngine + useDriveMarkerV3. */
export const NAV_V3 = {
  MARKER_MAX_HEADING_DPS: 90,
  MARKER_MIN_CRUISE_MS: 0.5,
  MARKER_HEADING_EMA: 0.22,
  SNAP_ATTACH_M: 40,
  SNAP_DETACH_START_M: 60,
  SNAP_DETACH_FULL_M: 100,
  SNAP_MAX_RADIUS_M: 80,
  BRANCH_HEADING_DELTA_DEG: 35,
  BRANCH_CONFIRM_TICKS: 3,
  BRANCH_HEADING_CONFIRM_TOLERANCE_DEG: 20,
  ON_ROAD_BLEND_EPS: 0.05,
  /** Min. odstęp setCamera — musi być krótszy niż animacja, inaczej Mapbox przerywa interpolację. */
  CAMERA_FOLLOW_INTERVAL_MS: 80,
  /** Długa natywna interpolacja — jeden płynny ruch, bez „pompowania” zoomu. */
  CAMERA_NATIVE_ANIM_MS: 420,
  /** Zoom aktualizowany max co N ms (osobno od pozycji). */
  CAMERA_ZOOM_UPDATE_MS: 700,
  CAMERA_SPEED_DEADZONE_KMH: 6,
  CAMERA_MAX_HEADING_DPS: 95,
  GPS_IMPOSSIBLE_JUMP_M: 150,
  GPS_IMPOSSIBLE_JUMP_MAX_KMH: 300,
  GPS_MAX_ACCURACY_REJECT_M: 120,
  GPS_MIN_MOVING_SPEED_MS: 0.55,
  GPS_MOVING_MIN_STEP_M: 2.5,
  PIPELINE_MOVING_KMH: 3,
} as const;

export type NavV3Config = typeof NAV_V3;
