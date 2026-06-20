/** V3 navigation constants — keep in sync with snapEngine + useDriveMarkerV3. */
export const NAV_V3 = {
  MARKER_MAX_HEADING_DPS: 90,
  MARKER_MIN_CRUISE_MS: 0.5,
  MARKER_HEADING_EMA: 0.22,
  /** Cross-track > tego progu → natychmiastowy snap release (swobodny GPS). */
  OFF_ROUTE_SNAP_RELEASE_M: 35,
  SNAP_ATTACH_M: 35,
  SNAP_DETACH_START_M: 60,
  SNAP_DETACH_FULL_M: 100,
  SNAP_MAX_RADIUS_M: 80,
  BRANCH_HEADING_DELTA_DEG: 35,
  BRANCH_CONFIRM_TICKS: 3,
  BRANCH_HEADING_CONFIRM_TOLERANCE_DEG: 20,
  ON_ROAD_BLEND_EPS: 0.05,
  /** Spadek roadBlend na tick przy utracie snapu (lepkość — bez teleportu na raw). */
  SNAP_BLEND_DECAY_PER_TICK: 0.1,
  /** Ticki zanim blend może spaść do 0 przy wysokim cross-track. */
  SNAP_BLEND_STICKY_TICKS: 8,
  /** Skręt na skrzyżowaniu: delta heading + cross-track → force match. */
  INTERSECTION_TURN_HEADING_DEG: 45,
  INTERSECTION_TURN_CROSS_TRACK_M: 20,
  /** Heading lock — bez kompasu poniżej tej prędkości (km/h). */
  TRAVEL_HEADING_LOCK_SPEED_KMH: 2.5,
  TRAVEL_HEADING_MIN_MOVE_M: 2.5,
  /** COG z surowego GPS — poniżej tego progu heading lock. */
  CAMERA_COG_MIN_SPEED_KMH: 3,
  /** Adaptacyjny throttle setCamera (ms) — szybko / średnio / wolno. */
  CAMERA_THROTTLE_FAST_MS: 33,
  CAMERA_THROTTLE_MID_MS: 42,
  CAMERA_THROTTLE_SLOW_MS: 55,
  CAMERA_THROTTLE_SPEED_FAST_KMH: 40,
  CAMERA_THROTTLE_SPEED_SLOW_KMH: 20,
  CAMERA_THROTTLE_STAND_KMH: 2,
  /** Bramki delta — ignoruj mikro-ruchy. */
  CAMERA_DELTA_MIN_DIST_M: 0.2,
  CAMERA_DELTA_MIN_HEADING_DEG: 0.5,
  /** Postój: emit tylko przy znaczącym obrocie (parking). */
  CAMERA_STAND_HEADING_DEG: 2.5,
  /** Spring heading (Reanimated) — kinowy gimbal. */
  CAMERA_HEADING_SPRING_STIFFNESS: 40,
  CAMERA_HEADING_SPRING_DAMPING: 15,
  /** animationDuration = throttle + buffer (Mapbox native interp). */
  CAMERA_NATIVE_ANIM_BUFFER_MS: 5,
  /** Płynna rotacja kamery na zakrętach (easeTo). */
  CAMERA_EASE_DURATION_MS: 1000,
  /** Max dt workletu markera po wybudzeniu z tła (ms). */
  MARKER_MAX_FRAME_DT_MS: 50,
  MARKER_STALE_FRAME_MS: 60,
  /** Zoom aktualizowany max co N ms (osobno od pozycji). */
  CAMERA_ZOOM_UPDATE_MS: 700,
  CAMERA_SPEED_DEADZONE_KMH: 6,
  CAMERA_MAX_HEADING_DPS: 95,
  /** Wygładzanie bearingu kamery (tylko heading — lat/lng natychmiastowe). */
  CAMERA_BEARING_SMOOTH_DPS_LOW: 38,
  CAMERA_BEARING_SMOOTH_DPS_MID: 62,
  CAMERA_BEARING_SMOOTH_DPS_HIGH: 88,
  /** Czas interpolacji obrotu kamery (withTiming, shortest-path). */
  CAMERA_BEARING_SMOOTH_MS: 250,
  /** easeTo heading na zakrętach — ms na stopień (rondo ≈ 300–450 ms). */
  CAMERA_HEADING_ANIM_PER_DEG_MS: 14,
  CAMERA_HEADING_ANIM_MIN_MS: 120,
  CAMERA_HEADING_ANIM_MAX_MS: 480,
  /** Look-ahead bearing na polilinii (m) — punkt wyprzedzający 15 m. */
  SNAP_HEADING_LOOKAHEAD_M: 15,
  /** Jedyne centralne wygładzanie heading (marker); kamera czyta SV bez drugiego tau. */
  MARKER_HEADING_TIMING_MS: 200,
  /** @deprecated — usunięte drugie EMA; zostawione dla kompatybilności typów. */
  MARKER_HEADING_TARGET_TIMING_MS: 200,
  /** Max prędkość obrotu markera (°/s) — łuki bez stop-motion. */
  MARKER_HEADING_MAX_DPS: 72,
  /** Pełny snap drogi — bez blendu z surowym GPS (eliminuje lateral jitter). */
  MARKER_ON_ROAD_FULL_BLEND: 1,
  /** Wygładzanie targetArcM z GPS (0–1) — mniej skoków wzdłuż polilinii. */
  MARKER_TARGET_ARC_SMOOTH_ALPHA: 0.42,
  /** Max cofka targetArcM przy korekcie (m). */
  MARKER_TARGET_ARC_MAX_BACK_M: 2,
  /** Max skok do przodu targetArcM na tick GPS (m). */
  MARKER_TARGET_ARC_MAX_FWD_M: 18,
  /** Lekkie wygładzenie pozycji na arc (tau ms) — anty lateral jitter. */
  MARKER_POS_TIMING_MS: 72,
  GPS_IMPOSSIBLE_JUMP_M: 150,
  GPS_IMPOSSIBLE_JUMP_MAX_KMH: 300,
  GPS_MAX_ACCURACY_REJECT_M: 120,
  GPS_MIN_MOVING_SPEED_MS: 0.55,
  GPS_MOVING_MIN_STEP_M: 2.5,
  PIPELINE_MOVING_KMH: 3,
} as const;

export type NavV3Config = typeof NAV_V3;
