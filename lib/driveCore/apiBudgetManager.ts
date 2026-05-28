import {
  CACHE_HIT_MAX_CROSS_TRACK_M,
  GPS_BATCH_MAX_POINTS,
  NEAR_SEGMENT_END_M,
  NETWORK_MIN_INTERVAL_MS,
  OFF_BUFFER_TRIGGER_M,
} from './config';
import { remainingAlongPolylineM } from './geo';
import type { GeometryCache } from './geometryCache';
import type {
  BufferedGpsPoint,
  MapMatchBudgetDecision,
  MapMatchNetworkTrigger,
  RawGpsFix,
  SnappedPose,
} from './types';
import { logTelemetry } from '../telemetryLogger';

export type ApiMetrics = {
  networkRequests: number;
  cacheHits: number;
  throttleBlocked: number;
  navigationBlocked: number;
  stationaryBlocked: number;
};

export class ApiBudgetManager {
  private buffer: BufferedGpsPoint[] = [];
  private lastNetworkAt = 0;
  private bypassThrottleOnce = false;
  private metrics: ApiMetrics = {
    networkRequests: 0,
    cacheHits: 0,
    throttleBlocked: 0,
    navigationBlocked: 0,
    stationaryBlocked: 0,
  };

  reset(): void {
    this.buffer = [];
    this.lastNetworkAt = 0;
    this.bypassThrottleOnce = false;
    this.metrics = {
      networkRequests: 0,
      cacheHits: 0,
      throttleBlocked: 0,
      navigationBlocked: 0,
      stationaryBlocked: 0,
    };
  }

  getMetrics(): ApiMetrics {
    return { ...this.metrics };
  }

  bufferPoint(raw: RawGpsFix): void {
    this.buffer.push({ lat: raw.lat, lng: raw.lng, timestamp: raw.timestamp });
    if (this.buffer.length > GPS_BATCH_MAX_POINTS) {
      this.buffer.shift();
    }
  }

  takeBuffer(): BufferedGpsPoint[] {
    const out = [...this.buffer];
    this.buffer = [];
    return out;
  }

  peekBuffer(): BufferedGpsPoint[] {
    return [...this.buffer];
  }

  recordNetworkRequest(): void {
    this.lastNetworkAt = Date.now();
    this.metrics.networkRequests += 1;
  }

  /** Pierwszy match po starcie free-drive — bez 4 s throttle. */
  armImmediateNetworkIfNoCache(): void {
    this.bypassThrottleOnce = true;
  }

  evaluate(input: {
    raw: RawGpsFix;
    pose: SnappedPose;
    isNavigating: boolean;
    isMoving: boolean;
    cache: GeometryCache;
  }): MapMatchBudgetDecision {
    const { raw, pose, isNavigating, isMoving, cache } = input;
    const now = Date.now();

    if (isNavigating) {
      this.metrics.navigationBlocked += 1;
      return {
        allowNetwork: false,
        trigger: null,
        crossTrackM: pose.crossTrackM,
        remainingAlongCacheM: null,
        throttleBlocked: false,
        navigationBlocked: true,
        stationaryBlocked: false,
      };
    }

    if (!isMoving) {
      this.metrics.stationaryBlocked += 1;
      return {
        allowNetwork: false,
        trigger: null,
        crossTrackM: pose.crossTrackM,
        remainingAlongCacheM: null,
        throttleBlocked: false,
        navigationBlocked: false,
        stationaryBlocked: true,
      };
    }

    this.bufferPoint(raw);

    const poly = cache.getPolyline();
    if (!poly || poly.points.length < 2) {
      return this.tryAllowNetwork(now, 'no_cache', pose.crossTrackM, null);
    }

    const remainingM = remainingAlongPolylineM(
      poly.points,
      pose.segmentIndex,
      pose.lat,
      pose.lng,
    );

    if (
      pose.crossTrackM <= CACHE_HIT_MAX_CROSS_TRACK_M
      && remainingM > NEAR_SEGMENT_END_M
    ) {
      this.metrics.cacheHits += 1;
      return {
        allowNetwork: false,
        trigger: null,
        crossTrackM: pose.crossTrackM,
        remainingAlongCacheM: remainingM,
        throttleBlocked: false,
        navigationBlocked: false,
        stationaryBlocked: false,
      };
    }

    let trigger: MapMatchNetworkTrigger | null = null;
    if (pose.crossTrackM > OFF_BUFFER_TRIGGER_M) {
      trigger = 'off_buffer';
    } else if (remainingM <= NEAR_SEGMENT_END_M) {
      trigger = 'near_segment_end';
    }

    if (!trigger) {
      return {
        allowNetwork: false,
        trigger: null,
        crossTrackM: pose.crossTrackM,
        remainingAlongCacheM: remainingM,
        throttleBlocked: false,
        navigationBlocked: false,
        stationaryBlocked: false,
      };
    }

    return this.tryAllowNetwork(now, trigger, pose.crossTrackM, remainingM);
  }

  private tryAllowNetwork(
    now: number,
    trigger: MapMatchNetworkTrigger,
    crossTrackM: number,
    remainingAlongCacheM: number | null,
  ): MapMatchBudgetDecision {
    const throttleBlocked =
      !this.bypassThrottleOnce
      && this.lastNetworkAt > 0
      && now - this.lastNetworkAt < NETWORK_MIN_INTERVAL_MS;

    if (throttleBlocked) {
      this.metrics.throttleBlocked += 1;
    }

    const allowNetwork = !throttleBlocked && this.buffer.length >= 1;
    if (allowNetwork && this.bypassThrottleOnce) {
      this.bypassThrottleOnce = false;
    }

    const decision: MapMatchBudgetDecision = {
      allowNetwork,
      trigger: allowNetwork ? trigger : null,
      crossTrackM,
      remainingAlongCacheM,
      throttleBlocked,
      navigationBlocked: false,
      stationaryBlocked: false,
    };

    void logTelemetry('DRIVE_API', {
      allow: decision.allowNetwork,
      trigger: decision.trigger,
      crossTrackM: Number(crossTrackM.toFixed(1)),
      buffered: this.buffer.length,
      throttleBlocked,
    });

    return decision;
  }
}
