/** Wspólny throttle UI↔JS z workletu (marker Mapbox + kamera follow). ~20 Hz. */
export const DISPLAY_NOTIFY_MIN_MS = 50;

/** Map polling / UI refresh intervals (ms). */
export const MAP_PERF = {
  navProgressUi: 250,
  cameraSpeedPoll: 4500,
  cameraSpeedFast: 2_000,
  liveAchievementPeriodic: 45_000,
  liveAchievementCheckCooldown: 2500,
  gpsWatchdogTick: 2_500,
  gpsMaxFixAge: 30_000,
  uiLocationThrottle: 400,
  anchorSync: 400,
  activeUiLocationThrottle: 2000,
  secondaryLocPublish: 2500,
  liveSendTick: 1_000,
  liveSendIntervalTrip: 800,
  liveSendInterval: 2_000,
  geoDropClaimPoll: 5_000,
  geoDropRefreshActive: 2_000,
  geoDropRefreshIdle: 5_000,
  geoDropClaimCheck: 5_000,
  tripCheckpointPeriodic: 30_000,
  heartbeat: 5_000,
  driveHealthLog: 15_000,
} as const;

/** @deprecated use MAP_PERF — kept for gradual migration */
export const NAV_PROGRESS_UI_MS = MAP_PERF.navProgressUi;
export const CAMERA_SPEED_POLL_MS = MAP_PERF.cameraSpeedPoll;
export const LIVE_ACHIEVEMENT_PERIODIC_MS = MAP_PERF.liveAchievementPeriodic;
export const GPS_WATCHDOG_TICK_MS = MAP_PERF.gpsWatchdogTick;
export const GPS_MAX_FIX_AGE_MS = MAP_PERF.gpsMaxFixAge;
export const UI_LOCATION_THROTTLE_MS = MAP_PERF.uiLocationThrottle;
