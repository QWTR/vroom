import {

  CACHE_HIT_MAX_CROSS_TRACK_M,

  GPS_BATCH_MAX_POINTS,

  NEAR_SEGMENT_END_M,

  NETWORK_MIN_BUFFER_PATH_M,

  OFF_BUFFER_TRIGGER_M,

} from './config';

import { distanceM } from './geo';

import { remainingAlongPolylineM } from './geo';

import { GpsBufferJitterFilter } from './gpsBufferJitterFilter';

import { evaluateMapMatchSync } from './mapMatchSyncPolicy';

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

  velocityPaused: number;

  jitterRejected: number;

  localGeometrySkipped: number;

  backgroundFlushes: number;

};



export class ApiBudgetManager {

  private buffer: BufferedGpsPoint[] = [];



  private lastNetworkAt = 0;



  private lastNetworkAnchor: { lat: number; lng: number } | null = null;



  private bypassThrottleOnce = false;



  private isBackground = false;



  private jitterFilter = new GpsBufferJitterFilter();



  private metrics: ApiMetrics = {

    networkRequests: 0,

    cacheHits: 0,

    throttleBlocked: 0,

    navigationBlocked: 0,

    stationaryBlocked: 0,

    velocityPaused: 0,

    jitterRejected: 0,

    localGeometrySkipped: 0,

    backgroundFlushes: 0,

  };



  reset(): void {

    this.buffer = [];

    this.lastNetworkAt = 0;

    this.lastNetworkAnchor = null;

    this.bypassThrottleOnce = false;

    this.isBackground = false;

    this.jitterFilter.reset();

    this.metrics = {

      networkRequests: 0,

      cacheHits: 0,

      throttleBlocked: 0,

      navigationBlocked: 0,

      stationaryBlocked: 0,

      velocityPaused: 0,

      jitterRejected: 0,

      localGeometrySkipped: 0,

      backgroundFlushes: 0,

    };

  }



  setAppBackground(active: boolean): void {

    this.isBackground = active;

  }



  getMetrics(): ApiMetrics {

    const jitter = this.jitterFilter.getMetrics();

    return {

      ...this.metrics,

      jitterRejected: jitter.rejectedDistance + jitter.rejectedSpeed,

    };

  }



  getMovedSinceLastNetworkM(lat: number, lng: number): number {

    if (!this.lastNetworkAnchor) return Infinity;

    return distanceM(

      this.lastNetworkAnchor.lat,

      this.lastNetworkAnchor.lng,

      lat,

      lng,

    );

  }



  takeBuffer(): BufferedGpsPoint[] {

    const out = [...this.buffer];

    this.buffer = [];

    return out;

  }



  peekBuffer(): BufferedGpsPoint[] {

    return [...this.buffer];

  }



  recordNetworkRequest(lat: number, lng: number, opts?: { background?: boolean }): void {

    this.lastNetworkAt = Date.now();

    this.lastNetworkAnchor = { lat, lng };

    this.metrics.networkRequests += 1;

    if (opts?.background) {

      this.metrics.backgroundFlushes += 1;

    }

  }



  recordLocalGeometrySkip(): void {

    this.metrics.localGeometrySkipped += 1;

  }



  /** Pierwszy match po starcie free-drive — bez pełnego throttle path/distance. */

  armImmediateNetworkIfNoCache(): void {

    this.bypassThrottleOnce = true;

  }



  evaluate(input: {

    raw: RawGpsFix;

    pose: SnappedPose;

    isNavigating: boolean;

    isMoving: boolean;

    speedKmh: number;

    speedUnknown?: boolean;

    cache: GeometryCache;

  }): MapMatchBudgetDecision {

    const { raw, pose, isNavigating, isMoving, speedKmh, speedUnknown, cache } = input;

    const now = Date.now();



    if (isNavigating) {

      this.metrics.navigationBlocked += 1;

      return this.blockedDecision(pose, { navigationBlocked: true });

    }



    const sync = evaluateMapMatchSync({

      mode: this.isBackground ? 'background' : 'foreground',

      speedKmh,

      isMoving,

      now,

      lastNetworkAt: this.lastNetworkAt,

      bufferPathM: this.bufferPathDistanceM(),

      bufferPoints: this.buffer.length,

      bypassThrottleOnce: this.bypassThrottleOnce,

      speedUnknown,

    });



    if (sync.velocityPaused) {

      this.metrics.velocityPaused += 1;

      this.metrics.stationaryBlocked += 1;

      return this.blockedDecision(pose, { stationaryBlocked: true, velocityPaused: true });

    }



    if (sync.allowBuffer && this.jitterFilter.accept(raw)) {

      this.buffer.push({ lat: raw.lat, lng: raw.lng, timestamp: raw.timestamp });

      if (this.buffer.length > GPS_BATCH_MAX_POINTS) {

        this.buffer.shift();

      }

    } else if (sync.allowBuffer) {

      this.metrics.jitterRejected += 1;

    }



    if (this.isBackground) {

      const pathM = this.bufferPathDistanceM();

      const allowNetwork =

        sync.allowNetwork

        && this.buffer.length >= sync.minBufferPoints

        && pathM >= sync.minPathM;

      if (allowNetwork && this.bypassThrottleOnce) {

        this.bypassThrottleOnce = false;

      }

      return this.decision(allowNetwork, allowNetwork ? 'no_cache' : null, pose, null, false);

    }



    if (!isMoving) {

      this.metrics.stationaryBlocked += 1;

      return this.blockedDecision(pose, { stationaryBlocked: true });

    }



    const poly = cache.getPolyline();

    if (!poly || poly.points.length < 2) {

      return this.tryAllowForegroundNetwork(now, 'no_cache', pose, null, sync);

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

      return this.blockedDecision(pose, {

        crossTrackRemainingM: remainingM,

      });

    }



    let trigger: MapMatchNetworkTrigger | null = null;

    if (pose.crossTrackM > OFF_BUFFER_TRIGGER_M) {

      trigger = 'off_buffer';

    } else if (remainingM <= NEAR_SEGMENT_END_M) {

      trigger = 'near_segment_end';

    }



    if (!trigger) {

      return this.blockedDecision(pose, { crossTrackRemainingM: remainingM });

    }



    return this.tryAllowForegroundNetwork(now, trigger, pose, remainingM, sync);

  }



  private tryAllowForegroundNetwork(

    now: number,

    trigger: MapMatchNetworkTrigger,

    pose: SnappedPose,

    remainingAlongCacheM: number | null,

    sync: ReturnType<typeof evaluateMapMatchSync>,

  ): MapMatchBudgetDecision {

    const urgentOffRoad = pose.crossTrackM > OFF_BUFFER_TRIGGER_M;

    const throttleBlocked =

      !this.bypassThrottleOnce

      && !urgentOffRoad

      && this.lastNetworkAt > 0

      && now - this.lastNetworkAt < sync.minIntervalMs;



    if (throttleBlocked) {

      this.metrics.throttleBlocked += 1;

    }



    const pathM = this.bufferPathDistanceM();

    const allowNetwork =

      !throttleBlocked

      && this.buffer.length >= sync.minBufferPoints

      && pathM >= sync.minPathM;



    if (allowNetwork && this.bypassThrottleOnce) {

      this.bypassThrottleOnce = false;

    }



    return this.decision(allowNetwork, allowNetwork ? trigger : null, pose, remainingAlongCacheM, throttleBlocked);

  }



  private blockedDecision(

    pose: SnappedPose,

    opts: {

      navigationBlocked?: boolean;

      stationaryBlocked?: boolean;

      velocityPaused?: boolean;

      crossTrackRemainingM?: number | null;

    },

  ): MapMatchBudgetDecision {

    return {

      allowNetwork: false,

      trigger: null,

      crossTrackM: pose.crossTrackM,

      remainingAlongCacheM: opts.crossTrackRemainingM ?? null,

      throttleBlocked: false,

      navigationBlocked: !!opts.navigationBlocked,

      stationaryBlocked: !!opts.stationaryBlocked,

      velocityPaused: !!opts.velocityPaused,

    };

  }



  private decision(

    allowNetwork: boolean,

    trigger: MapMatchNetworkTrigger | null,

    pose: SnappedPose,

    remainingAlongCacheM: number | null,

    throttleBlocked: boolean,

  ): MapMatchBudgetDecision {

    const decision: MapMatchBudgetDecision = {

      allowNetwork,

      trigger,

      crossTrackM: pose.crossTrackM,

      remainingAlongCacheM,

      throttleBlocked,

      navigationBlocked: false,

      stationaryBlocked: false,

      velocityPaused: false,

    };



    void logTelemetry('DRIVE_API', {

      allow: decision.allowNetwork,

      trigger: decision.trigger,

      crossTrackM: Number((pose.crossTrackM ?? 0).toFixed(1)),

      buffered: this.buffer.length,

      throttleBlocked,

      background: this.isBackground,

    });



    return decision;

  }



  private bufferPathDistanceM(): number {

    if (this.buffer.length < 2) return 0;

    let sum = 0;

    for (let i = 1; i < this.buffer.length; i++) {

      sum += distanceM(

        this.buffer[i - 1].lat,

        this.buffer[i - 1].lng,

        this.buffer[i].lat,

        this.buffer[i].lng,

      );

    }

    return sum;

  }

}


