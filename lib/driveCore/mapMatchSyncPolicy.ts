import {
  BACKGROUND_NETWORK_MIN_INTERVAL_MS,
  BACKGROUND_NETWORK_MIN_PATH_M,
  MAP_MATCH_TRAFFIC_LIGHT_KMH,
  NETWORK_MIN_BUFFER_PATH_M,
  NETWORK_MIN_INTERVAL_MS,
} from './config';

export type MapMatchSyncMode = 'foreground' | 'background';

export type MapMatchSyncContext = {
  mode: MapMatchSyncMode;
  speedKmh: number;
  isMoving: boolean;
  now: number;
  lastNetworkAt: number;
  bufferPathM: number;
  bufferPoints: number;
  bypassThrottleOnce: boolean;
  /** GPS Doppler unknown — do not pause Map Matching on a single null frame. */
  speedUnknown?: boolean;
};

export type MapMatchSyncDecision = {
  allowBuffer: boolean;
  allowNetwork: boolean;
  velocityPaused: boolean;
  minIntervalMs: number;
  minPathM: number;
  minBufferPoints: number;
};

/** Traffic-light rule: freeze Map Matching sync below crawl speed (foreground only). */
export function isVelocityPaused(
  speedKmh: number,
  mode: MapMatchSyncMode,
  opts?: { recentlyMoving?: boolean },
): boolean {
  if (mode === 'background') return false;
  if (opts?.recentlyMoving && speedKmh < MAP_MATCH_TRAFFIC_LIGHT_KMH) {
    return false;
  }
  return speedKmh < MAP_MATCH_TRAFFIC_LIGHT_KMH;
}

export function evaluateMapMatchSync(ctx: MapMatchSyncContext): MapMatchSyncDecision {
  const velocityPaused = isVelocityPaused(ctx.speedKmh, ctx.mode, {
    recentlyMoving: !!ctx.speedUnknown && ctx.speedKmh >= MAP_MATCH_TRAFFIC_LIGHT_KMH * 0.5,
  });

  if (ctx.mode === 'background') {
    const minIntervalMs = BACKGROUND_NETWORK_MIN_INTERVAL_MS;
    const minPathM = BACKGROUND_NETWORK_MIN_PATH_M;
    const minBufferPoints = 2;
    const intervalReady =
      ctx.lastNetworkAt === 0
      || ctx.now - ctx.lastNetworkAt >= minIntervalMs;
    const pathReady = ctx.bufferPathM >= minPathM;
    const allowNetwork =
      intervalReady
      && pathReady
      && ctx.bufferPoints >= minBufferPoints;

    return {
      allowBuffer: true,
      allowNetwork,
      velocityPaused: false,
      minIntervalMs,
      minPathM,
      minBufferPoints,
    };
  }

  if (velocityPaused || !ctx.isMoving) {
    return {
      allowBuffer: false,
      allowNetwork: false,
      velocityPaused,
      minIntervalMs: NETWORK_MIN_INTERVAL_MS,
      minPathM: NETWORK_MIN_BUFFER_PATH_M,
      minBufferPoints: 3,
    };
  }

  const minIntervalMs = NETWORK_MIN_INTERVAL_MS;
  const minPathM = ctx.bypassThrottleOnce ? 18 : NETWORK_MIN_BUFFER_PATH_M;
  const minBufferPoints = ctx.bypassThrottleOnce ? 2 : 3;
  const intervalReady =
    ctx.bypassThrottleOnce
    || ctx.lastNetworkAt === 0
    || ctx.now - ctx.lastNetworkAt >= minIntervalMs;

  return {
    allowBuffer: true,
    allowNetwork:
      intervalReady
      && ctx.bufferPathM >= minPathM
      && ctx.bufferPoints >= minBufferPoints,
    velocityPaused: false,
    minIntervalMs,
    minPathM,
    minBufferPoints,
  };
}
