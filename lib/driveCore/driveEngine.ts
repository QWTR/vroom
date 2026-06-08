import { ApiBudgetManager } from './apiBudgetManager';
import { MARKER_TIMING_MAX_MS } from './config';
import { bearingBetween, distanceM } from './geo';
import { flushMapMatchBatch } from './mapMatchClient';
import { evaluateLocalGeometryGate } from './localGeometryMatchGate';
import { GeometryCache } from './geometryCache';
import { GpsQualityGate, GPS_WAKE_MIN_KMH, type GpsQualityResult } from './gpsQualityGate';
import { localRoadGeometryMirror } from './localRoadSnap';
import type { NavRouteStartAnchor } from './navRouteBootstrap';
import { MotionStateMachine } from './motionState';
import { RoadSnapEngine } from './roadSnap';
import { SpeedMeter } from './speedMeter';
import { roadGeometryStore } from '../roadGeometry/RoadGeometryStore';
import type { DriveTickOutput, RawGpsFix, RoadPoint, SnappedPose } from './types';

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
  private isAppBackground = false;
  private callbacks: DriveEngineCallbacks = {};
  private navBootstrap: NavRouteStartAnchor | null = null;

  setAppBackground(active: boolean): void {
    this.isAppBackground = active;
    this.budget.setAppBackground(active);
  }

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
    this.navBootstrap = null;

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
    if (!active) {
      this.navBootstrap = null;
    }
  }

  setRoutePolyline(points: RoadPoint[]): void {
    if (points.length >= 2) {
      this.cache.setRoute(points);
    }
  }

  /** Teleport markera na start trasy — ignoruj słaby GPS do pierwszego ruchu. */
  setNavRouteBootstrap(anchor: NavRouteStartAnchor | null): void {
    this.navBootstrap = anchor;
    if (!anchor) return;
    this.motion.reset({ lat: anchor.lat, lng: anchor.lng });
    this.snap.seedPose(
      anchor.lat,
      anchor.lng,
      this.cache,
      anchor.headingDeg,
    );
    this.quality.commitAccepted({
      lat: anchor.lat,
      lng: anchor.lng,
      accuracy: 8,
      timestamp: Date.now(),
    });
  }

  clearNavRouteBootstrap(): void {
    this.navBootstrap = null;
  }

  isNavRouteBootstrapActive(): boolean {
    return this.isNavigating && this.navBootstrap != null;
  }

  getNavRouteBootstrap(): NavRouteStartAnchor | null {
    return this.navBootstrap;
  }

  onRawGps(raw: RawGpsFix): DriveTickOutput | null {
    if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;

    const isFreeDrive = !this.isNavigating;
    const freeDriveNoRoute = isFreeDrive && !this.cache.hasGeometry();
    const motionBefore = this.motion.getSnapshot();
    const bootstrapActive = this.isNavigating && this.navBootstrap != null;
    const gate = this.quality.evaluate(raw, {
      isMoving: motionBefore.isMoving,
      isNavigating: this.isNavigating,
      lastSpeedKmh: this.speed.getLastKmh(),
      freeDriveNoRoute,
      navBootstrapActive: bootstrapActive && !motionBefore.isMoving,
    });

    if (this.quality.registerBadVerdict(gate.verdict, motionBefore.isMoving)) {
      this.quality.commitAccepted(raw);
    }

    if (isFreeDrive) {
      this.scheduleLocalL2Refresh(raw);
    }

    if (gate.verdict === 'REJECT') {
      if (bootstrapActive) {
        const woke = this.processNavBootstrapMotion(raw, gate);
        if (woke) {
          return this.onRawGps(raw);
        }
        return this.buildNavBootstrapTick(raw);
      }
      const rejectDopplerKmh =
        raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0 ? raw.gpsSpeedMs * 3.6 : 0;
      if (isFreeDrive) {
        const rejectMoving =
          motionBefore.isMoving || rejectDopplerKmh >= 4;
        const out = this.buildFreeDriveTick(raw, gate, rejectMoving);
        this.maybeCommitEnvelope(raw, gate, out.isMoving, isFreeDrive);
        return out;
      }
      const held = this.snap.getFrozenPose();
      if (held && (motionBefore.isMoving || rejectDopplerKmh >= 5)) {
        return {
          pose: { ...held },
          speedKmh: Math.max(this.speed.getLastKmh(), rejectDopplerKmh),
          isMoving: true,
          durationMs: Math.max(320, Math.min(1200, this.computeRawDtMs(raw.timestamp))),
          geometrySource: this.cache.source() ?? 'tangent_fallback',
        };
      }
      if (held) {
        return {
          pose: { ...held },
          speedKmh: rejectDopplerKmh,
          isMoving: rejectDopplerKmh >= 5,
          durationMs: Math.max(320, Math.min(1200, this.computeRawDtMs(raw.timestamp))),
          geometrySource: this.cache.source() ?? 'tangent_fallback',
        };
      }
      if (rejectDopplerKmh >= 3) {
        const routeHeld = this.snap.snap(raw, this.cache, {
          isMoving: true,
          isNavigating: true,
          allowRawFallback: false,
          travelHeadingDeg: this.snap.getFrozenPose()?.heading,
        });
        if (routeHeld && routeHeld.crossTrackM < 999) {
          return {
            pose: routeHeld,
            speedKmh: Math.max(this.speed.getLastKmh(), rejectDopplerKmh),
            isMoving: rejectDopplerKmh >= 5,
            durationMs: Math.max(320, Math.min(1200, this.computeRawDtMs(raw.timestamp))),
            geometrySource: this.cache.source() ?? 'route',
          };
        }
        const frozen = this.snap.getFrozenPose();
        if (frozen) {
          return {
            pose: { ...frozen },
            speedKmh: Math.max(this.speed.getLastKmh(), rejectDopplerKmh),
            isMoving: rejectDopplerKmh >= 5,
            durationMs: Math.max(320, Math.min(1200, this.computeRawDtMs(raw.timestamp))),
            geometrySource: this.cache.source() ?? 'route',
          };
        }
      }
      return null;
    }

    let isMoving = this.motion.update(raw, {
      positionTrusted: gate.allowPositionUpdate,
      qualityVerdict: gate.verdict,
    });

    const dopplerWakeKmh =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0 ? raw.gpsSpeedMs * 3.6 : 0;
    if (!isMoving && dopplerWakeKmh >= 8) {
      this.motion.wakeFromGps();
      isMoving = true;
    }

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
      if (bootstrapActive) {
        const woke = this.processNavBootstrapMotion(raw, gate);
        if (woke) {
          return this.onRawGps(raw);
        }
        return this.buildNavBootstrapTick(raw);
      }
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
        { navDopplerHud: this.isNavigating },
      );
      this.maybeCommitEnvelope(raw, gate, false, isFreeDrive);
      this.tryMapMatchSync(raw, frozen, speedKmh, false, gate);
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
    if (frozenMove) {
      const movedM = distanceM(frozenMove.lat, frozenMove.lng, raw.lat, raw.lng);
      if (movedM >= 1.2) {
        travelHeadingDeg = bearingBetween(frozenMove.lat, frozenMove.lng, raw.lat, raw.lng);
      }
    }
    const lateralM = frozenMove
      ? distanceM(frozenMove.lat, frozenMove.lng, raw.lat, raw.lng)
      : 0;
    const freeDriveMaxStep = lateralM > 12 ? Math.min(lateralM * 0.6, 45) : maxStepM;

    if (
      isFreeDrive
      && frozenMove
      && (lateralM > 45 || frozenMove.crossTrackM > 50)
      && this.cache.hasGeometry()
    ) {
      this.cache.reset();
    }

    let pose = this.snap.snap(raw, this.cache, {
      isMoving: true,
      isNavigating: this.isNavigating,
      allowRawFallback: this.isNavigating ? false : !hasLocalGeom,
      preferLocalL2: isFreeDrive,
      travelHeadingDeg,
      maxStepM: isFreeDrive ? freeDriveMaxStep : maxStepM,
    });
    if (
      isFreeDrive
      && frozenMove
      && pose.crossTrackM > 38
      && distanceM(frozenMove.lat, frozenMove.lng, raw.lat, raw.lng) > 18
    ) {
      this.cache.reset();
      pose = this.snap.snap(raw, this.cache, {
        isMoving: true,
        isNavigating: false,
        allowRawFallback: !localRoadGeometryMirror.hasGeometry(),
        preferLocalL2: true,
        travelHeadingDeg,
        maxStepM: Math.max(maxStepM, freeDriveMaxStep),
      });
    }
    pose = this.snap.finalizeSnapPose(pose, this.cache, raw);

    const speedKmhMoving = this.speed.update(
      raw,
      pose,
      true,
      this.isNavigating,
      qualityPick,
      { freeDriveDoppler: isFreeDrive },
    );

    this.maybeCommitEnvelope(raw, gate, true, isFreeDrive);

    this.tryMapMatchSync(raw, pose, speedKmhMoving, true, gate);

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

  private tryMapMatchSync(
    raw: RawGpsFix,
    pose: SnappedPose,
    speedKmh: number,
    isMoving: boolean,
    gate: GpsQualityResult,
  ): void {
    if (this.isNavigating) return;

    const gateOk =
      gate.verdict === 'FULL_ACCEPT'
      || (this.isAppBackground && gate.verdict === 'DEGRADED');
    if (!gateOk) return;

    const dopplerKmh =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0 ? raw.gpsSpeedMs * 3.6 : 0;
    const speedUnknown = raw.gpsSpeedMs == null || raw.gpsSpeedMs < 0 || !Number.isFinite(raw.gpsSpeedMs);
    const effectiveSpeedKmh = Math.max(
      speedKmh,
      dopplerKmh,
      speedUnknown ? this.speed.getLastKmh() : 0,
    );

    const decision = this.budget.evaluate({
      raw,
      pose,
      isNavigating: this.isNavigating,
      isMoving: this.isAppBackground ? true : isMoving,
      speedKmh: effectiveSpeedKmh,
      speedUnknown,
      cache: this.cache,
    });

    if (decision.allowNetwork && !this.fetchInFlight) {
      void this.scheduleNetworkFlush(this.isAppBackground);
    }
  }

  private async scheduleNetworkFlush(backgroundHistorical = false): Promise<void> {
    if (this.fetchInFlight || this.isNavigating) return;

    const peek = this.budget.peekBuffer();
    if (peek.length < 1) return;

    const lastPeek = peek[peek.length - 1];
    const isBg = backgroundHistorical || this.isAppBackground;

    if (!isBg) {
      const movedM = this.budget.getMovedSinceLastNetworkM(lastPeek.lat, lastPeek.lng);
      const localGate = await evaluateLocalGeometryGate(lastPeek.lat, lastPeek.lng, movedM);
      if (localGate.skipNetwork && localGate.segment) {
        this.budget.takeBuffer();
        this.budget.recordLocalGeometrySkip();
        this.applyMatchGeometry(localGate.segment);
        return;
      }
    }

    this.fetchInFlight = true;
    const batch = this.budget.takeBuffer();
    if (batch.length < 1) {
      this.fetchInFlight = false;
      return;
    }
    try {
      const last = batch[batch.length - 1];
      const speedKmh = Math.max(0, this.speed.getLastKmh());
      const points = await flushMapMatchBatch(batch, {
        background: isBg,
        speedKmh,
      });
      if (points && points.length >= 2) {
        this.budget.recordNetworkRequest(last.lat, last.lng, { background: isBg });
        this.applyMatchGeometry(points);
        if (!isBg) {
          const hint = this.snap.getFrozenPose();
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

    this.tryMapMatchSync(raw, pose, effectiveKmh, outputMoving, {
      verdict: gate.verdict,
      allowPositionUpdate: true,
      allowSpeedDelta: gate.allowSpeedDelta,
      allowDoppler: gate.allowDoppler,
    });

    return {
      pose,
      speedKmh: effectiveKmh,
      isMoving: outputMoving,
      durationMs,
      geometrySource,
    };
  }

  private buildNavBootstrapTick(raw: RawGpsFix): DriveTickOutput {
    const anchor = this.navBootstrap!;
    const dopplerKmh =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0 ? raw.gpsSpeedMs * 3.6 : 0;
    return {
      pose: {
        lat: anchor.lat,
        lng: anchor.lng,
        heading: anchor.headingDeg,
        crossTrackM: 0,
        segmentIndex: 0,
      },
      speedKmh: dopplerKmh,
      isMoving: false,
      durationMs: Math.max(320, Math.min(1200, this.computeRawDtMs(raw.timestamp))),
      geometrySource: this.cache.source() ?? 'route',
    };
  }

  /** Wykryj ruszenie z postoju na starcie nawigacji (Doppler / dystans). */
  private processNavBootstrapMotion(
    raw: RawGpsFix,
    gate: GpsQualityResult,
  ): boolean {
    if (!this.navBootstrap) return false;

    const softVerdict =
      gate.verdict === 'REJECT' ? 'DEGRADED' as const : gate.verdict;
    let isMoving = this.motion.update(raw, {
      positionTrusted: gate.allowPositionUpdate,
      qualityVerdict: softVerdict,
    });

    const dopplerKmh =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0 ? raw.gpsSpeedMs * 3.6 : 0;
    if (!isMoving && dopplerKmh >= 8) {
      this.motion.wakeFromGps();
      isMoving = true;
    }
    if (
      !isMoving
      && softVerdict !== 'REJECT'
      && this.quality.registerWakeSample(raw, softVerdict)
    ) {
      this.motion.wakeFromGps();
      isMoving = true;
    }
    if (
      !isMoving
      && gate.verdict === 'REJECT'
      && dopplerKmh >= GPS_WAKE_MIN_KMH
      && this.quality.registerWakeSample(raw, 'DEGRADED')
    ) {
      this.motion.wakeFromGps();
      isMoving = true;
    }

    if (isMoving) {
      this.navBootstrap = null;
      this.quality.resetWakeStreak();
    }
    return isMoving;
  }
}

function computeSnapMaxStepM(speedKmh: number, durationMs: number): number {
  const dtSec = Math.max(0.12, durationMs / 1000);
  const travelM = (Math.max(0, speedKmh) / 3.6) * dtSec;
  return Math.min(38, Math.max(4, travelM * 1.25 + 3));
}
