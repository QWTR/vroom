import { ApiBudgetManager } from './apiBudgetManager';
import { MARKER_TIMING_MAX_MS } from './config';
import { flushMapMatchBatch } from './mapMatchClient';
import { GeometryCache } from './geometryCache';
import { GpsQualityGate, type GpsQualityResult } from './gpsQualityGate';
import { MotionStateMachine } from './motionState';
import { RoadSnapEngine } from './roadSnap';
import { SpeedMeter } from './speedMeter';
import type { DriveTickOutput, RawGpsFix, RoadPoint } from './types';

export type DriveEngineCallbacks = {
  onPoseAfterMatch?: (output: DriveTickOutput) => void;
};

const KINEMATIC_SPEED_CAP_KMH = 130;

export class DriveEngine {
  readonly motion = new MotionStateMachine();
  readonly speed = new SpeedMeter();
  readonly cache = new GeometryCache();
  readonly snap = new RoadSnapEngine();
  readonly budget = new ApiBudgetManager();
  readonly quality = new GpsQualityGate();

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
    this.quality.reset();
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
      this.quality.commitAccepted({
        lat: opts.anchor.lat,
        lng: opts.anchor.lng,
        accuracy: 12,
        timestamp: Date.now(),
      });
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

    const freeDriveNoRoute = !this.isNavigating && !this.cache.hasGeometry();
    const motionBefore = this.motion.getSnapshot();
    const drivingActive =
      motionBefore.isMoving
      || freeDriveNoRoute
      || this.speed.getLastKmh() >= 2
      || (raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0 && raw.gpsSpeedMs * 3.6 >= 2);

    const gate = this.quality.evaluate(raw, {
      isMoving: motionBefore.isMoving,
      isNavigating: this.isNavigating,
      lastSpeedKmh: this.speed.getLastKmh(),
      freeDriveNoRoute,
    });

    if (this.quality.registerBadVerdict(gate.verdict, drivingActive)) {
      this.quality.commitAccepted(raw);
    }

    if (gate.verdict === 'REJECT') {
      if (freeDriveNoRoute) {
        const out = this.buildFreeDriveTick(raw, gate, false);
        this.maybeCommitEnvelope(raw, gate, out.isMoving, freeDriveNoRoute);
        return out;
      }
      const held = this.snap.getFrozenPose();
      if (held && motionBefore.isMoving) {
        return {
          pose: { ...held },
          speedKmh: this.speed.getLastKmh(),
          isMoving: true,
          durationMs: Math.max(320, Math.min(1200, this.computeRawDtMs(raw.timestamp))),
          geometrySource: this.cache.source() ?? 'tangent_fallback',
        };
      }
      if (held) {
        return {
          pose: { ...held },
          speedKmh: 0,
          isMoving: false,
          durationMs: Math.max(320, Math.min(1200, this.computeRawDtMs(raw.timestamp))),
          geometrySource: this.cache.source() ?? 'tangent_fallback',
        };
      }
      return null;
    }

    let isMoving = this.motion.update(raw, {
      positionTrusted: gate.allowPositionUpdate,
      qualityVerdict: gate.verdict,
    });

    if (!isMoving && gate.verdict !== 'REJECT' && this.quality.registerWakeSample(raw, gate.verdict)) {
      this.motion.wakeFromGps();
      isMoving = true;
    } else if (isMoving) {
      this.quality.resetWakeStreak();
    }

    const rawDtMs = this.computeRawDtMs(raw.timestamp);
    const durationMs = Math.max(320, Math.min(1200, rawDtMs));
    const qualityPick = {
      verdict: gate.verdict,
      allowSpeedDelta: gate.allowSpeedDelta,
      allowDoppler: gate.allowDoppler,
    };

    if (!isMoving) {
      if (freeDriveNoRoute) {
        const out = this.buildFreeDriveTick(raw, gate, true);
        this.maybeCommitEnvelope(raw, gate, out.isMoving, freeDriveNoRoute);
        return out;
      }
      const frozen = this.snap.snap(raw, this.cache, {
        isMoving: false,
        isNavigating: this.isNavigating,
        allowRawFallback: false,
      });
      const speedKmh = this.speed.update(
        raw,
        frozen,
        false,
        this.isNavigating,
        qualityPick,
      );
      this.maybeCommitEnvelope(raw, gate, false, freeDriveNoRoute);
      return {
        pose: frozen,
        speedKmh,
        isMoving: false,
        durationMs,
        geometrySource: this.cache.source() ?? 'tangent_fallback',
      };
    }

    const speedForStep = Math.min(
      KINEMATIC_SPEED_CAP_KMH,
      Math.max(0, this.speed.getLastKmh()),
    );
    const snapStepMs = Math.max(200, Math.min(2000, rawDtMs));
    const maxStepM = computeSnapMaxStepM(speedForStep, snapStepMs);

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
      qualityPick,
    );

    this.maybeCommitEnvelope(raw, gate, true, freeDriveNoRoute);

    if (gate.verdict === 'FULL_ACCEPT') {
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
    }

    return {
      pose,
      speedKmh: speedKmhMoving,
      isMoving: true,
      durationMs,
      geometrySource: this.cache.source() ?? 'tangent_fallback',
    };
  }

  private computeRawDtMs(ts: number): number {
    let ms = 650;
    if (this.lastTimestamp > 0) {
      ms = ts - this.lastTimestamp;
    }
    this.lastTimestamp = ts;
    return ms;
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
        const fullAccept = {
          verdict: 'FULL_ACCEPT' as const,
          allowSpeedDelta: true,
          allowDoppler: true,
        };
        const out: DriveTickOutput = {
          pose,
          speedKmh: this.speed.update(raw, pose, true, false, fullAccept),
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

  /**
   * Koperta kinematyczna — FULL_ACCEPT zawsze; DEGRADED gdy Doppler/ruch do przodu.
   */
  private maybeCommitEnvelope(
    raw: RawGpsFix,
    gate: GpsQualityResult,
    isMoving: boolean,
    freeDriveNoRoute: boolean,
  ): void {
    if (gate.verdict === 'FULL_ACCEPT') {
      this.quality.commitAccepted(raw);
      this.quality.resetBadVerdictStreak();
      return;
    }
    if (gate.verdict !== 'DEGRADED') {
      return;
    }

    const dopplerKmh =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0
        ? raw.gpsSpeedMs * 3.6
        : 0;
    const lastKmh = this.speed.getLastKmh();
    const forwardEvidence =
      isMoving
      || dopplerKmh >= 3
      || (freeDriveNoRoute && (dopplerKmh >= 2 || lastKmh >= 2));

    if (forwardEvidence) {
      this.quality.commitAccepted(raw);
      this.quality.resetBadVerdictStreak();
    }
  }

  /** Wolna jazda bez polilinii trasy — RAW GPS + Doppler, bez blokady isMoving. */
  private buildFreeDriveTick(
    raw: RawGpsFix,
    gate: { verdict: 'FULL_ACCEPT' | 'DEGRADED' | 'REJECT'; allowSpeedDelta: boolean; allowDoppler: boolean },
    motionSaysMoving: boolean,
  ): DriveTickOutput {
    const durationMs = Math.max(320, Math.min(1200, this.computeRawDtMs(raw.timestamp)));
    const qualityPick = {
      verdict: gate.verdict,
      allowSpeedDelta: gate.allowSpeedDelta,
      allowDoppler: gate.allowDoppler,
    };
    const pose = this.snap.snap(raw, this.cache, {
      isMoving: motionSaysMoving,
      isNavigating: false,
      allowRawFallback: true,
      maxStepM: 28,
    });
    const speedKmh = this.speed.update(
      raw,
      pose,
      motionSaysMoving,
      false,
      qualityPick,
      { freeDriveDoppler: true },
    );
    const dopplerKmh =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0 ? raw.gpsSpeedMs * 3.6 : 0;
    const effectiveKmh = Math.max(speedKmh, dopplerKmh > 0 ? dopplerKmh : 0);
    const outputMoving = motionSaysMoving || effectiveKmh >= 2.5;
    return {
      pose,
      speedKmh: effectiveKmh,
      isMoving: outputMoving,
      durationMs,
      geometrySource: 'tangent_fallback',
    };
  }
}

function computeSnapMaxStepM(speedKmh: number, durationMs: number): number {
  const dtSec = Math.max(0.12, durationMs / 1000);
  const travelM = (Math.max(0, speedKmh) / 3.6) * dtSec;
  return Math.min(38, Math.max(4, travelM * 1.25 + 3));
}
