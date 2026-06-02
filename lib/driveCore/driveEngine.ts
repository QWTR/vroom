import { ApiBudgetManager } from './apiBudgetManager';
import { MARKER_TIMING_MAX_MS } from './config';
import { bearingBetween, distanceM } from './geo';
import { flushMapMatchBatch } from './mapMatchClient';
import { GeometryCache } from './geometryCache';
import { GpsQualityGate, type GpsQualityResult } from './gpsQualityGate';
import { localRoadGeometryMirror } from './localRoadSnap';
import { MotionStateMachine } from './motionState';
import { RoadSnapEngine } from './roadSnap';
import { SpeedMeter } from './speedMeter';
import { roadGeometryStore } from '../roadGeometry/RoadGeometryStore';
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
  private localL2RefreshInFlight = false;
  private lastLocalL2RefreshAt = 0;
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
    localRoadGeometryMirror.clear();
    this.lastTimestamp = 0;
    this.fetchInFlight = false;
    this.localL2RefreshInFlight = false;

    if (opts?.seedPolyline && opts.seedPolyline.length >= 2) {
      this.cache.setFromMatch(opts.seedPolyline);
      localRoadGeometryMirror.setPolylines([opts.seedPolyline]);
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
      if (opts?.anchor) {
        void this.primeLocalGeometry(opts.anchor.lat, opts.anchor.lng);
      }
    }
  }

  /** Sync seed L2 mirror (np. przy wejściu w tryb jazdy). */
  seedLocalMirror(points: RoadPoint[]): void {
    if (points.length >= 2) {
      localRoadGeometryMirror.setPolylines([points]);
    }
  }

  /** Natychmiastowe dociągnięcie geometrii drogi z SQLite (free-drive). */
  async primeLocalGeometry(lat: number, lng: number): Promise<void> {
    if (this.localL2RefreshInFlight) return;
    this.localL2RefreshInFlight = true;
    const radiusM = 80;
    const dLat = radiusM / 111_320;
    const cos = Math.cos((lat * Math.PI) / 180);
    const dLng = radiusM / (111_320 * Math.max(0.25, Math.abs(cos)));
    try {
      const segments = await roadGeometryStore.findInBbox(
        lat - dLat,
        lat + dLat,
        lng - dLng,
        lng + dLng,
        32,
      );
      if (segments.length > 0) {
        localRoadGeometryMirror.setPolylines(segments);
        this.resnapFrozenOntoLocalRoad(lat, lng);
        return;
      }
      const nearest = await roadGeometryStore.findNearest(lat, lng, 80);
      if (nearest?.points.length >= 2) {
        localRoadGeometryMirror.setPolylines([nearest.points]);
        this.resnapFrozenOntoLocalRoad(lat, lng);
      }
    } finally {
      this.localL2RefreshInFlight = false;
    }
  }

  /** Po załadowaniu L2 — dociągnij zamrożoną pozę na oś drogi (bez czekania na kolejny GPS). */
  private resnapFrozenOntoLocalRoad(lat: number, lng: number): void {
    const frozen = this.snap.getFrozenPose();
    if (!frozen || !localRoadGeometryMirror.hasGeometry()) return;
    const hdg = frozen.heading;
    const onRoad = localRoadGeometryMirror.snapToLocalRoadBest(lat, lng, hdg)
      ?? localRoadGeometryMirror.snapToLocalRoadNearest(lat, lng);
    if (!onRoad || onRoad.crossTrackM > 95) return;
    this.snap.seedPose(onRoad.lat, onRoad.lng, this.cache, onRoad.heading);
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

    const isFreeDrive = !this.isNavigating;
    const freeDriveNoRoute = isFreeDrive && !this.cache.hasGeometry();
    const motionBefore = this.motion.getSnapshot();
    const gate = this.quality.evaluate(raw, {
      isMoving: motionBefore.isMoving,
      isNavigating: this.isNavigating,
      lastSpeedKmh: this.speed.getLastKmh(),
      freeDriveNoRoute,
    });

    if (this.quality.registerBadVerdict(gate.verdict, motionBefore.isMoving)) {
      this.quality.commitAccepted(raw);
    }

    if (isFreeDrive) {
      this.scheduleLocalL2Refresh(raw);
    }

    if (gate.verdict === 'REJECT') {
      if (isFreeDrive) {
        const out = this.buildFreeDriveTick(raw, gate, false);
        this.maybeCommitEnvelope(raw, gate, out.isMoving, isFreeDrive);
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
      if (isFreeDrive) {
        const out = this.buildFreeDriveTick(raw, gate, true);
        this.maybeCommitEnvelope(raw, gate, out.isMoving, isFreeDrive);
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
      this.maybeCommitEnvelope(raw, gate, false, isFreeDrive);
      return {
        pose: frozen,
        speedKmh,
        isMoving: false,
        durationMs,
        geometrySource: this.cache.source() ?? 'tangent_fallback',
      };
    }

    const dopplerKmhForStep =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0 ? raw.gpsSpeedMs * 3.6 : 0;
    const speedForStep = Math.min(
      KINEMATIC_SPEED_CAP_KMH,
      Math.max(this.speed.getLastKmh(), dopplerKmhForStep),
    );
    const snapStepMs = Math.max(200, Math.min(2000, rawDtMs));
    const maxStepM = computeSnapMaxStepM(speedForStep, snapStepMs);
    const hasLocalGeom = localRoadGeometryMirror.hasGeometry()
      || (this.isNavigating && this.cache.hasGeometry());
    const frozenMove = this.snap.getFrozenPose();
    let travelHeadingDeg = frozenMove?.heading;
    if (isFreeDrive && frozenMove) {
      const movedM = distanceM(frozenMove.lat, frozenMove.lng, raw.lat, raw.lng);
      if (movedM >= 1.2) {
        travelHeadingDeg = bearingBetween(frozenMove.lat, frozenMove.lng, raw.lat, raw.lng);
      }
    }
    const lateralM = frozenMove
      ? distanceM(frozenMove.lat, frozenMove.lng, raw.lat, raw.lng)
      : 0;
    const freeDriveMaxStep = lateralM > 12 ? Math.min(lateralM * 0.6, 45) : maxStepM;

    let pose = this.snap.snap(raw, this.cache, {
      isMoving: true,
      isNavigating: this.isNavigating,
      allowRawFallback: this.isNavigating ? false : !hasLocalGeom,
      preferLocalL2: isFreeDrive,
      travelHeadingDeg,
      maxStepM: isFreeDrive ? freeDriveMaxStep : maxStepM,
    });
    pose = this.snap.finalizeSnapPose(pose, this.cache, raw);

    const speedKmhMoving = this.speed.update(
      raw,
      pose,
      true,
      this.isNavigating,
      qualityPick,
    );

    this.maybeCommitEnvelope(raw, gate, true, isFreeDrive);

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
        localRoadGeometryMirror.setPolylines([points]);
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
          allowRawFallback: true,
          preferLocalL2: true,
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
      localRoadGeometryMirror.setPolylines([points]);
    }
  }

  /**
   * Koperta kinematyczna — FULL_ACCEPT zawsze; DEGRADED gdy Doppler/ruch do przodu.
   */
  private maybeCommitEnvelope(
    raw: RawGpsFix,
    gate: GpsQualityResult,
    isMoving: boolean,
    isFreeDrive: boolean,
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
    const headingForward = this.freeDriveHeadingForwardEvidence(raw);
    const forwardEvidence =
      isMoving
      || dopplerKmh >= 3
      || (isFreeDrive && (dopplerKmh >= 2 || lastKmh >= 2 || headingForward));

    if (forwardEvidence) {
      this.quality.commitAccepted(raw);
      this.quality.resetBadVerdictStreak();
    }
  }

  /** Doppler lub zmiana heading wskazują ruch do przodu (free-drive, DEGRADED). */
  private freeDriveHeadingForwardEvidence(raw: RawGpsFix): boolean {
    const frozen = this.snap.getFrozenPose();
    if (!frozen) return false;
    const movedM = distanceM(frozen.lat, frozen.lng, raw.lat, raw.lng);
    if (movedM < 1.5) return false;
    const travelBearing = bearingBetween(frozen.lat, frozen.lng, raw.lat, raw.lng);
    const err = Math.abs(((travelBearing - frozen.heading + 540) % 360) - 180);
    return err <= 45;
  }

  /** Asynchroniczne dociągnięcie L2 → synchroniczny mirror dla roadSnap. */
  private scheduleLocalL2Refresh(raw: RawGpsFix): void {
    const now = Date.now();
    const minGapMs = localRoadGeometryMirror.hasGeometry() ? 4000 : 1200;
    if (now - this.lastLocalL2RefreshAt < minGapMs) return;
    this.lastLocalL2RefreshAt = now;
    void this.primeLocalGeometry(raw.lat, raw.lng);
  }

  /** Wolna jazda bez polilinii trasy — L2 snap + Doppler. */
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
    const frozen = this.snap.getFrozenPose();
    const hasLocalGeom = localRoadGeometryMirror.hasGeometry()
      || (this.isNavigating && this.cache.hasGeometry());
    let travelHeadingDeg = frozen?.heading;
    if (frozen && frozen.crossTrackM > 15) {
      const movedM = distanceM(frozen.lat, frozen.lng, raw.lat, raw.lng);
      if (movedM >= 1.2) {
        travelHeadingDeg = bearingBetween(frozen.lat, frozen.lng, raw.lat, raw.lng);
      }
    } else if (motionSaysMoving && frozen) {
      const movedM = distanceM(frozen.lat, frozen.lng, raw.lat, raw.lng);
      if (movedM >= 1.2) {
        travelHeadingDeg = bearingBetween(frozen.lat, frozen.lng, raw.lat, raw.lng);
      }
    }
    const lateralM = frozen
      ? distanceM(frozen.lat, frozen.lng, raw.lat, raw.lng)
      : 0;
    const maxStepM = lateralM > 12 ? Math.min(lateralM * 0.6, 45) : 28;
    let pose = this.snap.snap(raw, this.cache, {
      isMoving: motionSaysMoving,
      isNavigating: false,
      allowRawFallback: !hasLocalGeom,
      preferLocalL2: true,
      travelHeadingDeg,
      maxStepM,
    });
    pose = this.snap.finalizeSnapPose(pose, this.cache, raw);
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
    const geometrySource =
      pose.crossTrackM < 200 ? 'segment_cache' : 'tangent_fallback';

    return {
      pose,
      speedKmh: effectiveKmh,
      isMoving: outputMoving,
      durationMs,
      geometrySource,
    };
  }
}

function computeSnapMaxStepM(speedKmh: number, durationMs: number): number {
  const dtSec = Math.max(0.12, durationMs / 1000);
  const travelM = (Math.max(0, speedKmh) / 3.6) * dtSec;
  return Math.min(38, Math.max(4, travelM * 1.25 + 3));
}
