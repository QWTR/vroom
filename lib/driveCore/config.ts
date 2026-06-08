/** Stałe Drive Core V2 — API budget i snap lokalny. */
export const CACHE_HIT_MAX_CROSS_TRACK_M = 22;
export const OFF_BUFFER_TRIGGER_M = 16;
export const NEAR_SEGMENT_END_M = 50;
/** Min gap between Drive Core Map Matching network calls (foreground). */
export const NETWORK_MIN_INTERVAL_MS = 90_000;
export const NETWORK_MIN_BUFFER_PATH_M = 60;
/** Traffic-light: freeze Map Matching sync below this speed (foreground). */
export const MAP_MATCH_TRAFFIC_LIGHT_KMH = 3;
/** Background historical sync — time OR distance gate (whichever comes first). */
export const BACKGROUND_NETWORK_MIN_INTERVAL_MS = 5 * 60_000;
export const BACKGROUND_NETWORK_MIN_PATH_M = 2000;
export const GPS_BATCH_MAX_POINTS = 12;
export const MATCH_RADIUS_M = 50;
export const MOTION_MIN_DIST_M = 1.5;
export const MOTION_GPS_WAKE_KMH = 4;
export const MOTION_MAX_ACCURACY_M = 20;
export const MOTION_STOP_CLUSTER_M = 3;
export const MOTION_STOP_CONSECUTIVE = 3;
export const SPEED_EMA_SAMPLES = 3;
export const SPEED_MIN_DT_SEC = 0.2;
export const MARKER_TIMING_MIN_MS = 200;
export const MARKER_TIMING_MAX_MS = 400;
export const SNAP_MAX_RADIUS_M = 80;
export const SNAP_WIDE_RETRY_RADIUS_M = 120;
export const ROUTE_SNAP_MAX_RADIUS_M = 45;
/** Snap scoring — kara kątowa ponad softDeg (legacy useDrivingSnap ~0.32). */
export const SNAP_ANGLE_SOFT_DEG = 18;
export const SNAP_ANGLE_WEIGHT = 0.35;
export const SNAP_ANGLE_REJECT_DEG = 35;
export const SNAP_ANGLE_REJECT_HIGHWAY_DEG = 45;
export const SNAP_HIGHWAY_SPEED_KMH = 55;
