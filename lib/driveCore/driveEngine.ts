import { ApiBudgetManager } from './apiBudgetManager';
import { MARKER_TIMING_MAX_MS, MARKER_TIMING_MIN_MS } from './config';
import { flushMapMatchBatch } from './mapMatchClient';
import { GeometryCache } from './geometryCache';
import { MotionStateMachine } from './motionState';
import { RoadSnapEngine } from './roadSnap';
import { SpeedMeter } from './speedMeter';
import type { DriveTickOutput, RawGpsFix, RoadPoint, SnappedPose } from './types';

export type DriveEngineCallbacks = {
  onPoseAfterMatch?: (output: DriveTickOutput) => void;
};

export class DriveEngine {
  readonly motion = new MotionStateMachine();
  readonly speed = new SpeedMeter();
  readonly cache = new GeometryCache();
  readonly snap = new RoadSnapEngine();
  readonly budget = new ApiBudgetManager();

  private lastTimestamp = 0;
  private isNavigating = false;
  private fetchInFlight = false;
  private callbacks: DriveEngineCallbacks = {};

  setCallbacks(cb: DriveEngineCallbacks): void {
    this.callbacks = cb;
  }

  reset(opts?: {
    anchor?: { lat: number; lng: number };
    heading?: number;
    seedPolyline?: RoadPoint[];
  }): void {
    this.motion.reset(opts?.anchor);
    this.speed.reset();
    this.cache.reset();
    this.snap.reset();
    this.budget.reset();
    this.lastTimestamp = 0;
    this.fetchInFlight = false;

    if (opts?.seedPolyline && opts.seedPolyline.length >= 2) {
      this.cache.setFromMatch(opts.seedPolyline);
    }
    if (opts?.anchor) {
      this.snap.seedPose(
        opts.anchor.lat,
        opts.anchor.lng,
        this.cache,
        opts.heading ?? 0,
      );
    }
    if (!this.cache.hasGeometry()) {
      this.budget.armImmediateNetworkIfNoCache();
    }
  }

  setNavigating(active: boolean): void {
    this.isNavigating = active;
  }

  setRoutePolyline(points: RoadPoint[]): void {
    if (points.length >= 2) {
      this.cache.setRoute(points);
    }
  }

  onRawGps(raw: RawGpsFix): DriveTickOutput | null {
    if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;

    let isMoving = this.motion.update(raw);
    const gpsWakeKmh =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0
        ? raw.gpsSpeedMs * 3.6
        : 0;
    if (!isMoving && gpsWakeKmh >= 4) {
      isMoving = true;
    }
    const durationMs = this.computeDurationMs(raw.timestamp);

    if (!isMoving) {
      const frozen = this.snap.snap(raw, this.cache, {
        isMoving: false,
        isNavigating: this.isNavigating,
      });
      return {
        pose: frozen,
        speedKmh: 0,
        isMoving: false,
        durationMs,
        geometrySource: this.cache.source() ?? 'tangent_fallback',
      };
    }

    const maxStepM = computeSnapMaxStepM(
      Math.max(gpsWakeKmh, this.speed.getLastKmh()),
      durationMs,
    );

    const pose = this.snap.snap(raw, this.cache, {
      isMoving: true,
      isNavigating: this.isNavigating,
      allowRawFallback: !this.cache.hasGeometry(),
      maxStepM,
    });

    const speedKmhMoving = this.speed.update(
      raw,
      pose,
      true,
      this.isNavigating,
    );

    const decision = this.budget.evaluate({
      raw,
      pose,
      isNavigating: this.isNavigating,
      isMoving: true,
      cache: this.cache,
    });

    if (decision.allowNetwork && !this.fetchInFlight) {
      void this.scheduleNetworkFlush();
    }

    return {
      pose,
      speedKmh: speedKmhMoving,
      isMoving: true,
      durationMs,
      geometrySource: this.cache.source() ?? 'tangent_fallback',
    };
  }

  private computeDurationMs(ts: number): number {
    let ms = 280;
    if (this.lastTimestamp > 0) {
      ms = ts - this.lastTimestamp;
    }
    this.lastTimestamp = ts;
    return Math.max(MARKER_TIMING_MIN_MS, Math.min(MARKER_TIMING_MAX_MS, ms));
  }

  private async scheduleNetworkFlush(): Promise<void> {
    if (this.fetchInFlight || this.isNavigating) return;
    this.fetchInFlight = true;
    const batch = this.budget.takeBuffer();
    if (batch.length < 1) {
      this.fetchInFlight = false;
      return;
    }
    try {
      const points = await flushMapMatchBatch(batch);
      if (points && points.length >= 2) {
        this.budget.recordNetworkRequest();
        const hint = this.snap.getFrozenPose();
        this.cache.setFromMatch(points, hint ?? undefined);
        const last = batch[batch.length - 1];
        const raw: RawGpsFix = {
          lat: last.lat,
          lng: last.lng,
          accuracy: 12,
          timestamp: last.timestamp,
        };
        const pose = this.snap.snap(raw, this.cache, {
          isMoving: true,
          isNavigating: false,
          allowRawFallback: false,
          maxStepM: 22,
        });
        const out: DriveTickOutput = {
          pose,
          speedKmh: this.speed.update(raw, pose, true, false),
          isMoving: true,
          durationMs: MARKER_TIMING_MAX_MS,
          geometrySource: 'segment_cache',
        };
        this.callbacks.onPoseAfterMatch?.(out);
      }
    } finally {
      this.fetchInFlight = false;
    }
  }

  applyMatchGeometry(points: RoadPoint[]): void {
    if (points.length >= 2) {
      const hint = this.snap.getFrozenPose();
      this.cache.setFromMatch(points, hint ?? undefined);
    }
  }
}

function computeSnapMaxStepM(speedKmh: number, durationMs: number): number {
  const dtSec = Math.max(0.12, durationMs / 1000);
  const travelM = (Math.max(0, speedKmh) / 3.6) * dtSec;
  return Math.min(38, Math.max(4, travelM * 1.25 + 3));
}
