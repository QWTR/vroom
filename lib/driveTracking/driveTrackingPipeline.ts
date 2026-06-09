import { predictDeadReckoning } from './deadReckoningPredictor';
import { checkGpsPhysics, clampGpsStepM, maxPlausibleStepM } from './gpsPhysicsGuard';
import { haversineM, sliceRoadWindow, bearingBetween } from './geoMath';
import { SpeedStabilizer } from './speedStabilizer';
import { SnapToRoadEngine, createSnapEngineState } from './snapToRoadEngine';
import { VehicleKalmanFilter } from './vehicleKalmanFilter';
import type {
  FilteredGpsFix,
  GpsFixInput,
  LatLng,
  LegacySnapInput,
  SnapContext,
  SnapResult,
} from './types';

export type DriveTrackingPipelineOptions = {
  onReject?: (reason: string, payload?: Record<string, unknown>) => void;
};

/**
 * Single entry for Drive Mode: GPS filter → physics guard → snap refine → DR predict.
 * Marker animation remains in useSmoothMapPosition (60 FPS LERP); this pipeline
 * produces stable anchors fed via feedSmoothPositionTarget.
 */
export class DriveTrackingPipeline {
  private kalman = new VehicleKalmanFilter();
  private speedStabilizer = new SpeedStabilizer();
  private snapEngine: SnapToRoadEngine;
  private lastFiltered: LatLng | null = null;
  private lastFilteredAtMs = 0;
  private lastSpeedKmh = 0;
  private lastMotionBearing: number | null = null;

  constructor(private opts: DriveTrackingPipelineOptions = {}) {
    this.snapEngine = new SnapToRoadEngine(createSnapEngineState());
  }

  reset(): void {
    this.kalman.reset();
    this.speedStabilizer.reset();
    this.snapEngine.reset();
    this.lastFiltered = null;
    this.lastFilteredAtMs = 0;
    this.lastSpeedKmh = 0;
    this.lastMotionBearing = null;
  }

  /**
   * Stage 1–2: Kalman + physics guard on raw GPS.
   */
  filterGpsFix(input: GpsFixInput): FilteredGpsFix {
    const { latitude: rawLat, longitude: rawLng, accuracyM, timestampMs, accelBypass } = input;
    const trip = input.isDriving || input.isNavigating;

    if (accelBypass) {
      this.lastFiltered = { latitude: rawLat, longitude: rawLng };
      this.lastFilteredAtMs = timestampMs;
      return {
        latitude: rawLat,
        longitude: rawLng,
        rejected: false,
        speedKmh: input.speedMs != null ? input.speedMs * 3.6 : this.lastSpeedKmh,
        headingDeg: input.headingDeg ?? this.lastMotionBearing ?? 0,
      };
    }

    const prev = this.lastFiltered;
    const dtMs = prev && this.lastFilteredAtMs > 0
      ? Math.max(80, timestampMs - this.lastFilteredAtMs)
      : 1000;

    if (prev) {
      const rawWakeAccuracyOk = Number.isFinite(accuracyM) && accuracyM <= 15;
      const skipPhysicsGuard =
        (!!input.rawMotionDetected && rawWakeAccuracyOk)
        || (input.microMoveGraceTicks ?? 0) > 0;
      const physics = checkGpsPhysics(
        prev.latitude,
        prev.longitude,
        rawLat,
        rawLng,
        dtMs,
        trip,
      );
      if (!physics.accept && !skipPhysicsGuard) {
        this.opts.onReject?.(physics.reason, { impliedSpeedKmh: physics.impliedSpeedKmh });
        return {
          latitude: prev.latitude,
          longitude: prev.longitude,
          rejected: true,
          rejectReason: physics.reason,
          speedKmh: this.lastSpeedKmh,
          headingDeg: this.lastMotionBearing ?? 0,
        };
      }
    }

    const preSpeedKmh = input.speedMs != null ? Math.max(0, input.speedMs * 3.6) : this.lastSpeedKmh;
    if (trip && preSpeedKmh >= 20) {
      this.kalman.setProcessNoise(0.55, 2.4);
    } else if (trip) {
      this.kalman.setProcessNoise(0.28, 1.1);
    } else {
      this.kalman.setProcessNoise(0.12, 0.45);
    }

    const kf = this.kalman.filter(
      rawLat,
      rawLng,
      accuracyM,
      timestampMs,
      preSpeedKmh,
      input.headingDeg,
    );
    let lat = kf.latitude;
    let lng = kf.longitude;

    if (prev && trip) {
      const maxStep = maxPlausibleStepM(Math.max(preSpeedKmh, kf.velocityMs * 3.6), dtMs);
      const clamped = clampGpsStepM(prev.latitude, prev.longitude, lat, lng, maxStep);
      lat = clamped.latitude;
      lng = clamped.longitude;
    }

    if (prev) {
      const moveM = haversineM(prev.latitude, prev.longitude, lat, lng);
      if (moveM >= 2) {
        this.lastMotionBearing = bearingBetween(prev.latitude, prev.longitude, lat, lng);
      }
    }

    this.lastFiltered = { latitude: lat, longitude: lng };
    this.lastFilteredAtMs = timestampMs;

    const predicted = this.kalman.predictForward(timestampMs + 400);

    return {
      latitude: lat,
      longitude: lng,
      rejected: false,
      speedKmh: Math.max(preSpeedKmh, kf.velocityMs * 3.6 * 0.85),
      headingDeg: kf.headingDeg || input.headingDeg || this.lastMotionBearing || 0,
      predicted: predicted ?? undefined,
    };
  }

  stabilizeSpeedKmh(
    displayKmh: number,
    meta: {
      rawGpsKmh: number;
      derivedKmh: number;
      sustainedKmh: number;
      netMoveM: number;
      pathMoveM: number;
      isTripActive: boolean;
      rawMotionDetected?: boolean;
      accuracyM?: number | null;
    },
    nowMs: number,
  ): number {
    const out = this.speedStabilizer.stabilize(
      {
        displayKmh,
        rawGpsKmh: meta.rawGpsKmh,
        derivedKmh: meta.derivedKmh,
        sustainedKmh: meta.sustainedKmh,
        netMoveM: meta.netMoveM,
        pathMoveM: meta.pathMoveM,
        isTripActive: meta.isTripActive,
        rawMotionDetected: meta.rawMotionDetected,
        accuracyM: meta.accuracyM ?? null,
        previousKmh: this.lastSpeedKmh,
      },
      nowMs,
    );
    this.lastSpeedKmh = out;
    return out;
  }

  /**
   * Stage 3: Refine legacy snap with hysteresis / heading / route credit.
   */
  refineSnap(legacy: LegacySnapInput, ctx: SnapContext): SnapResult {
    return this.snapEngine.refine(legacy, ctx);
  }

  getLockedSegmentIndex(): number {
    return this.snapEngine.getLockedSegmentIndex();
  }

  buildRoadWindow(geometry: LatLng[], lat: number, lng: number): LatLng[] | null {
    return sliceRoadWindow(geometry, lat, lng);
  }

  /**
   * Stage 4: Dead reckoning hint for worklet anchor between GPS ticks.
   */
  predictBetweenFixes(
    from: LatLng,
    speedMs: number,
    headingDeg: number,
    dtMs: number,
    roadPts: LatLng[] | null,
  ): LatLng {
    const out = predictDeadReckoning({
      from,
      speedMs,
      headingDeg,
      dtMs,
      roadPts,
      segmentIndex: this.getLockedSegmentIndex(),
    });
    return out.position;
  }
}
