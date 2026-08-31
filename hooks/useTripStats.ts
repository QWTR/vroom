import { useRef, useState, useCallback, useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { evaluateDistanceSegment, haversineKm } from '../scripts/distanceEngine';
import { vroomGpsLog } from '../lib/vroomGpsLog';
import { BackgroundDriveController } from '../lib/backgroundDriveController';
import { GPS_DISCONTINUITY_EVENT } from '../lib/recoverableImagePicker';
import { evaluateGpsContinuityFix } from '../lib/gpsContinuity';
import {
  compactDriveTelemetry,
  type DriveTelemetryPoint,
  type DriveTelemetrySource,
} from '../lib/driveTelemetry';
import {
  clearEmergencyTripSave,
  ensureTripSessionId,
  writeEmergencyTripSave,
  type EmergencyTripSavePayload,
} from './useBackgroundTracking';

export interface TripStats {
  maxSpeedKmh:   number;
  avgSpeedKmh:   number;
  elapsedSec:    number;
  estimatedSec:  number;
  distanceKm:    number;
  trackedPoints: DriveTelemetryPoint[];
  tripSessionId?: string | null;
}

/** Segment distance sanity only - not a vmax cap. */
const TRIP_STATS_MAX_PLAUSIBLE_KMH = 320;
const TRIP_SEGMENT_MAX_PLAUSIBLE_KMH = TRIP_STATS_MAX_PLAUSIBLE_KMH;
const TRIP_MAX_DERIVED_SAMPLE_KMH = TRIP_STATS_MAX_PLAUSIBLE_KMH;
/** Long GPS gaps (tunnel / Doze) reset the anchor instead of rejecting forever. */
const TRIP_MAX_FIX_GAP_SEC   = 480;
const TRIP_FALLBACK_MAX_GAP_SEC = 900;
const TRIP_MAX_SPEED_SAMPLES = 3000;
const TRIP_MAX_TRACKED_POINTS = 2500;
const TRIP_MIN_SEGMENT_KM = 0.0022;
const TRIP_MAX_SEGMENT_KM = 2.5;
const TRIP_FALLBACK_MAX_SEGMENT_KM = 1.4;
const TRIP_FALLBACK_MIN_SPEED_KMH = 4;
const TRIP_MAX_DISTANCE_KM = 1200;
/** Local trip snapshot every N km - survives process kill. */
const EMERGENCY_CHECKPOINT_KM = 0.5;
const TRIP_STATS_DIAGNOSTICS = __DEV__;
/** Align with BG tracking — reject noisy GPS fixes. */
const TRIP_MAX_ACCURACY_M = 65;

function isValidSpeedSampleKmh(kmh: number): boolean {
  return Number.isFinite(kmh) && kmh > 2 && kmh <= TRIP_STATS_MAX_PLAUSIBLE_KMH;
}

function compactTrackPoints(points: DriveTelemetryPoint[]) {
  return compactDriveTelemetry(points, TRIP_MAX_TRACKED_POINTS);
}

export function useTripStats() {
  const speedSamples = useRef<number[]>([]);
  const trackedPts   = useRef<DriveTelemetryPoint[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const estSecRef    = useRef<number>(0);
  const distanceRef  = useRef<number>(0);
  const lastPointRef = useRef<{ latitude: number; longitude: number; time: number } | null>(null);
  const lastAccuracyRef = useRef<number | null>(null);
  const reanchorFixesRemainingRef = useRef(0);
  const lastLiveKmEmitRef = useRef(0);
  const lastLiveKmValueRef = useRef(0);
  const lastEmergencyKmRef = useRef(0);
  const segmentDiagRef = useRef({
    rejected: {
      invalid_time: 0,
      stale_gap: 0,
      min_speed: 0,
      accuracy: 0,
      jitter: 0,
      jump: 0,
      impossible_speed: 0,
      ok: 0,
    } as Record<string, number>,
    fallbackAccepted: 0,
    derivedSpeedUsed: 0,
    derivedSpeedRejected: 0,
    /** Accepted by the main segment path (segment.accepted=true). */
    acceptedMain: 0,
    /** Km added by the main segment path. */
    acceptedMainKm: 0,
    /** Suma km dodanych z fallbacku (jump/impossible_speed/stale_gap recovery). */
    fallbackKm: 0,
    /** Segments with zero movement (appliedSnap = previous position). */
    zeroMove: 0,
    /** Lokalny low_speed counter (speedKmh < 2 && movedKm < min*1.5). */
    lowSpeedDropped: 0,
  });

  const [stats, setStats] = useState<TripStats | null>(null);
  /** Current trip distance from the same engine used for trip saving/navigation HUD. */
  const [liveDistanceKm, setLiveDistanceKm] = useState(0);
  const [tripActive, setTripActive] = useState(false);
  const nativeOwnsRef = useRef(false);
  const tripSessionIdRef = useRef<string | null>(null);
  const nativeProgressSyncInFlightRef = useRef(false);

  const maybeEmergencyCheckpoint = useCallback(() => {
    // The native tracker already persists distance, route and speed on every
    // accepted fix. Writing another full JS snapshot every few hundred metres
    // caused increasingly expensive storage work on long Android trips.
    if (nativeOwnsRef.current) return;
    const dist = distanceRef.current;
    const nextMark = Math.floor(dist / EMERGENCY_CHECKPOINT_KM) * EMERGENCY_CHECKPOINT_KM;
    if (nextMark < EMERGENCY_CHECKPOINT_KM || nextMark <= lastEmergencyKmRef.current) return;
    lastEmergencyKmRef.current = nextMark;
    void writeEmergencyTripSave({
      distanceKm: parseFloat(dist.toFixed(3)),
      trackedPoints: [...trackedPts.current],
      speedSamples: [...speedSamples.current],
      startTimeMs: startTimeRef.current,
      estimatedSec: estSecRef.current,
      floorKm: nextMark,
      savedAt: Date.now(),
    });
  }, []);

  const applyNativeDistance = useCallback((nativeKm: number) => {
    if (!Number.isFinite(nativeKm) || nativeKm < 0) return;
    // Never replace a larger JS/HUD total with a lagging native reading.
    distanceRef.current = Math.max(distanceRef.current, nativeKm);
    const rounded = parseFloat(distanceRef.current.toFixed(2));
    const emitNow = Date.now();
    if (
      emitNow - lastLiveKmEmitRef.current >= 450
      || Math.abs(rounded - lastLiveKmValueRef.current) >= 0.02
    ) {
      lastLiveKmEmitRef.current = emitNow;
      lastLiveKmValueRef.current = rounded;
      setLiveDistanceKm(rounded);
    }
    maybeEmergencyCheckpoint();
  }, [maybeEmergencyCheckpoint]);

  useEffect(() => {
    if (!tripActive) return undefined;

    let cancelled = false;
    const syncNativeDistance = async () => {
      if (nativeProgressSyncInFlightRef.current) return;
      nativeProgressSyncInFlightRef.current = true;
      try {
        const [state, progress] = await Promise.all([
          BackgroundDriveController.getState(),
          BackgroundDriveController.getNativeProgress(),
        ]);
        if (cancelled) return;
        const sessionMatches = !progress.tripSessionId || progress.tripSessionId === state.tripSessionId;
        // Hand off to native only after it has caught up with JS/HUD distance.
        // Otherwise feedPosition freezes while finalize can still prefer a lagging
        // native total and drop the save (< 0.05 km gate).
        const nativeKm = Number(progress.distanceKm);
        const nativeCaughtUp = Number.isFinite(nativeKm)
          && nativeKm > 0
          && nativeKm + 1e-6 >= distanceRef.current;
        const nativeOwns = state.active
          && !!state.tripSessionId
          && sessionMatches
          && nativeCaughtUp;
        nativeOwnsRef.current = nativeOwns;
        if (nativeOwns) {
          applyNativeDistance(nativeKm);
        }
      } finally {
        nativeProgressSyncInFlightRef.current = false;
      }
    };

    void syncNativeDistance();
    // Zdarzenie natywnej lokalizacji jest głównym źródłem synchronizacji.
    // Rzadki watchdog leczy wyłącznie utracony event zamiast budzić JS co 1,5 s.
    const pollId = setInterval(() => { void syncNativeDistance(); }, 15_000);
    const removeLocationListener = BackgroundDriveController.addLocationListener(() => {
      void syncNativeDistance();
    });

    return () => {
      cancelled = true;
      clearInterval(pollId);
      removeLocationListener();
    };
  }, [tripActive, applyNativeDistance]);

  const restoreTripSnapshot = useCallback((snapshot: EmergencyTripSavePayload) => {
    const dist = Number(snapshot.distanceKm);
    if (!Number.isFinite(dist) || dist < 0) return;
    distanceRef.current = dist;
    trackedPts.current = snapshot.trackedPoints?.length
      ? [...snapshot.trackedPoints]
      : [];
    speedSamples.current = snapshot.speedSamples?.length
      ? [...snapshot.speedSamples]
      : [];
    startTimeRef.current = snapshot.startTimeMs ?? Date.now();
    estSecRef.current = Number(snapshot.estimatedSec) || 0;
    lastEmergencyKmRef.current = Math.floor(dist / EMERGENCY_CHECKPOINT_KM) * EMERGENCY_CHECKPOINT_KM;
    // A restored snapshot may have been written before Android destroyed the
    // activity for the camera. Never bridge that old point with a new fix.
    lastPointRef.current = null;
    lastAccuracyRef.current = null;
    reanchorFixesRemainingRef.current = 2;
    const rounded = parseFloat(dist.toFixed(2));
    lastLiveKmValueRef.current = rounded;
    setLiveDistanceKm(rounded);
    tripSessionIdRef.current = snapshot.tripSessionId;
    nativeOwnsRef.current = false;
    setTripActive(true);
    // Persist the consolidated monotonic snapshot immediately. If the app is
    // killed again before the next 0.5 km checkpoint, the resumed kilometres
    // and geometry still survive the second restart.
    void writeEmergencyTripSave({
      ...snapshot,
      distanceKm: dist,
      trackedPoints: [...trackedPts.current],
      speedSamples: [...speedSamples.current],
      startTimeMs: startTimeRef.current,
      estimatedSec: estSecRef.current,
      floorKm: Math.max(Number(snapshot.floorKm) || 0, dist),
      savedAt: Date.now(),
    });
  }, []);

  const resetSegmentDiag = useCallback(() => {
    const d = segmentDiagRef.current;
    d.rejected = {
      invalid_time: 0,
      stale_gap: 0,
      min_speed: 0,
      accuracy: 0,
      jitter: 0,
      jump: 0,
      impossible_speed: 0,
      ok: 0,
    };
    d.fallbackAccepted = 0;
    d.derivedSpeedUsed = 0;
    d.derivedSpeedRejected = 0;
    d.acceptedMain = 0;
    d.acceptedMainKm = 0;
    d.fallbackKm = 0;
    d.zeroMove = 0;
    d.lowSpeedDropped = 0;
  }, []);

  const startTrip = useCallback((estimatedDurationSec: number) => {
    speedSamples.current = [];
    trackedPts.current   = [];
    distanceRef.current  = 0;
    startTimeRef.current = Date.now();
    estSecRef.current    = estimatedDurationSec;
    lastPointRef.current = null;
    lastAccuracyRef.current = null;
    reanchorFixesRemainingRef.current = 0;
    lastLiveKmEmitRef.current = 0;
    lastLiveKmValueRef.current = 0;
    lastEmergencyKmRef.current = 0;
    setStats(null);
    setLiveDistanceKm(0);
    nativeOwnsRef.current = false;
    setTripActive(true);
    resetSegmentDiag();
    void clearEmergencyTripSave();
    void ensureTripSessionId().then((value) => { tripSessionIdRef.current = value; }).catch(() => {});
  }, [resetSegmentDiag]);

  /** Continue a route (e.g. drive -> navigation) without resetting distance. */
  const updateTripEstimate = useCallback((estimatedDurationSec: number) => {
    estSecRef.current = estimatedDurationSec;
    if (startTimeRef.current == null) {
      startTimeRef.current = Date.now();
    }
  }, []);

  const feedSpeed = useCallback((speedMs: number | null) => {
    if (speedMs === null || speedMs < 0) return;
    const kmh = speedMs * 3.6;
    if (isValidSpeedSampleKmh(kmh)) {
      speedSamples.current.push(kmh); // ignoruj postoje + spike GPS
      if (speedSamples.current.length > TRIP_MAX_SPEED_SAMPLES) {
        speedSamples.current = speedSamples.current.slice(-TRIP_MAX_SPEED_SAMPLES);
      }
    }
  }, []);

  const feedPosition = useCallback((
    lat: number,
    lng: number,
    speedMs?: number,
    accuracyM?: number | null,
    telemetry?: {
      recordedAt?: number | string | null;
      altitudeM?: number | null;
      headingDeg?: number | null;
      source?: DriveTelemetrySource;
    },
  ): number => {
    const suppliedTime = telemetry?.recordedAt == null
      ? NaN
      : new Date(telemetry.recordedAt).getTime();
    const now = Number.isFinite(suppliedTime) ? suppliedTime : Date.now();
    const speedKmh = speedMs != null && speedMs > 0 ? speedMs * 3.6 : null;
    const pts = trackedPts.current;
    const lastMeta = lastPointRef.current;
    const telemetryPoint = (): DriveTelemetryPoint => ({
      latitude: lat,
      longitude: lng,
      recordedAt: new Date(now).toISOString(),
      speedKmh,
      altitudeM: Number.isFinite(Number(telemetry?.altitudeM)) ? Number(telemetry?.altitudeM) : null,
      accuracyM: Number.isFinite(Number(accuracyM)) ? Number(accuracyM) : null,
      headingDeg: Number.isFinite(Number(telemetry?.headingDeg)) ? Number(telemetry?.headingDeg) : null,
      source: telemetry?.source ?? 'foreground',
      accepted: true,
    });

    if (reanchorFixesRemainingRef.current > 0) {
      const continuity = evaluateGpsContinuityFix(
        reanchorFixesRemainingRef.current, lat, lng, accuracyM, TRIP_MAX_ACCURACY_M,
      );
      if (continuity.action === 'reject') {
        vroomGpsLog('TRIP_REANCHOR_REJECT', {
          reason: 'invalid_or_inaccurate_fix',
          accuracyM: accuracyM ?? null,
          remaining: reanchorFixesRemainingRef.current,
        }, 2_000);
        return 0;
      }
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      lastAccuracyRef.current = accuracyM ?? null;
      const previous = pts[pts.length - 1];
      if (!previous || haversineKm(previous.latitude, previous.longitude, lat, lng) >= 0.03) {
        pts.push(telemetryPoint());
        trackedPts.current = compactTrackPoints(pts);
      }
      reanchorFixesRemainingRef.current = continuity.remaining;
      vroomGpsLog('TRIP_REANCHOR_FIX', {
        reason: 'camera_or_process_resume',
        remaining: reanchorFixesRemainingRef.current,
        accuracyM: accuracyM ?? null,
      }, 0);
      return 0;
    }

    if (nativeOwnsRef.current) {
      // Native owns distance, but keep a sparse JS route so finalize still has
      // geometry if the native route buffer is empty (e.g. speed=0 Android bug).
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      lastAccuracyRef.current = accuracyM ?? null;
      const lastPt = pts[pts.length - 1];
      if (!lastPt || haversineKm(lastPt.latitude, lastPt.longitude, lat, lng) >= 0.03) {
        pts.push(telemetryPoint());
        trackedPts.current = compactTrackPoints(pts);
      }
      return 0;
    }

    // Some Android devices often report 0 m/s while actually moving.
    // Treat non-positive speed as "unknown" instead of "stationary" to avoid
    // dropping valid distance segments during active navigation.
    // Android often reports 0 m/s while moving, so do not reject only by speed.
    if (speedKmh != null && speedKmh < 2 && lastMeta) {
      const movedKm = haversineKm(lastMeta.latitude, lastMeta.longitude, lat, lng);
      if (movedKm < TRIP_MIN_SEGMENT_KM * 1.5) {
        segmentDiagRef.current.lowSpeedDropped += 1;
        if (movedKm < 0.0001) segmentDiagRef.current.zeroMove += 1;
        return 0;
      }
    }
    if (!lastMeta) {
      pts.push(telemetryPoint());
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      lastAccuracyRef.current = accuracyM ?? null;
      return 0;
    }
    const dtSecRaw = Math.max(0, (now - lastMeta.time) / 1000);

    const segment = evaluateDistanceSegment(
      {
        latitude: lastMeta.latitude,
        longitude: lastMeta.longitude,
        timestampMs: lastMeta.time,
        speedKmh,
        accuracyM: lastAccuracyRef.current,
      },
      {
        latitude: lat,
        longitude: lng,
        timestampMs: now,
        speedKmh,
        accuracyM: accuracyM ?? null,
      },
      {
        minSegmentKm: TRIP_MIN_SEGMENT_KM,
        maxSegmentKm: TRIP_MAX_SEGMENT_KM,
        maxFixGapSec: TRIP_MAX_FIX_GAP_SEC,
        maxPlausibleKmh: TRIP_SEGMENT_MAX_PLAUSIBLE_KMH,
        minSpeedKmh: 2,
        maxAccuracyM: TRIP_MAX_ACCURACY_M,
      },
    );
    if (!segment.accepted) {
      segmentDiagRef.current.rejected[segment.reason] = (segmentDiagRef.current.rejected[segment.reason] ?? 0) + 1;
      const dtSec = Math.max(0, (now - lastMeta.time) / 1000);
      const isRecoverable = segment.reason === 'jump' || segment.reason === 'impossible_speed' || segment.reason === 'stale_gap';
      if (isRecoverable && dtSec > 0 && dtSec <= TRIP_FALLBACK_MAX_GAP_SEC) {
        const rawKm = haversineKm(lastMeta.latitude, lastMeta.longitude, lat, lng);
        const cappedByTimeKm = (TRIP_SEGMENT_MAX_PLAUSIBLE_KMH / 3600) * Math.min(dtSec, TRIP_MAX_FIX_GAP_SEC);
        const derivedRawKmh = dtSecRaw > 0 ? (rawKm * 3600) / dtSecRaw : 0;
        const hasMotionSignal =
          (speedKmh != null && speedKmh >= TRIP_FALLBACK_MIN_SPEED_KMH)
          || (Number.isFinite(derivedRawKmh) && derivedRawKmh >= TRIP_FALLBACK_MIN_SPEED_KMH);
        const fallbackCapKm = hasMotionSignal
          ? TRIP_FALLBACK_MAX_SEGMENT_KM
          : Math.min(0.2, TRIP_FALLBACK_MAX_SEGMENT_KM);
        // With no motion signal (speed unknown/low), reject larger jumps so standing
        // jitter cannot leak into trip distance.
        if (!hasMotionSignal && rawKm > 0.35) {
          lastPointRef.current = { latitude: lat, longitude: lng, time: now };
          lastAccuracyRef.current = accuracyM ?? null;
          return 0;
        }
        if (!hasMotionSignal && rawKm > 0.15) {
          lastPointRef.current = { latitude: lat, longitude: lng, time: now };
          lastAccuracyRef.current = accuracyM ?? null;
          return 0;
        }
        const fallbackKm = Math.min(rawKm, cappedByTimeKm, fallbackCapKm);
        if (fallbackKm >= TRIP_MIN_SEGMENT_KM * 1.2) {
          const derivedKmh = dtSecRaw > 0 ? (fallbackKm * 3600) / dtSecRaw : 0;
          if ((speedKmh == null || speedKmh < 2) && Number.isFinite(derivedKmh) && derivedKmh >= 2 && derivedKmh <= TRIP_MAX_DERIVED_SAMPLE_KMH) {
            speedSamples.current.push(derivedKmh);
            if (speedSamples.current.length > TRIP_MAX_SPEED_SAMPLES) {
              speedSamples.current = speedSamples.current.slice(-TRIP_MAX_SPEED_SAMPLES);
            }
            segmentDiagRef.current.derivedSpeedUsed += 1;
          } else if (speedKmh == null || speedKmh < 2) {
            segmentDiagRef.current.derivedSpeedRejected += 1;
          }
          pts.push(telemetryPoint());
          if (pts.length > TRIP_MAX_TRACKED_POINTS) {
            trackedPts.current = compactTrackPoints(pts);
          }
          lastPointRef.current = { latitude: lat, longitude: lng, time: now };
          lastAccuracyRef.current = accuracyM ?? null;
          const nextDistance = distanceRef.current + fallbackKm;
          if (Number.isFinite(nextDistance) && nextDistance <= TRIP_MAX_DISTANCE_KM) {
            distanceRef.current = nextDistance;
            const rounded = parseFloat(distanceRef.current.toFixed(2));
            const emitNow = Date.now();
            if (
              emitNow - lastLiveKmEmitRef.current >= 450
              || Math.abs(rounded - lastLiveKmValueRef.current) >= 0.02
            ) {
              lastLiveKmEmitRef.current = emitNow;
              lastLiveKmValueRef.current = rounded;
              setLiveDistanceKm(rounded);
            }
            segmentDiagRef.current.fallbackAccepted += 1;
            segmentDiagRef.current.fallbackKm += fallbackKm;
            maybeEmergencyCheckpoint();
            return fallbackKm;
          }
        }
      }
      vroomGpsLog('TRIP_SEGMENT_REJECT', {
        reason: segment.reason,
        dtSec: Number(dtSec.toFixed(1)),
        speedKmh: speedKmh != null ? Number(speedKmh.toFixed(1)) : null,
      }, 8_000);
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      lastAccuracyRef.current = accuracyM ?? null;
      return 0;
    }

    const derivedKmh = dtSecRaw > 0 ? (segment.distanceKm * 3600) / dtSecRaw : 0;
    if (speedKmh == null || speedKmh < 2) {
      if (Number.isFinite(derivedKmh) && derivedKmh >= 2 && derivedKmh <= TRIP_MAX_DERIVED_SAMPLE_KMH) {
        speedSamples.current.push(derivedKmh);
        if (speedSamples.current.length > TRIP_MAX_SPEED_SAMPLES) {
          speedSamples.current = speedSamples.current.slice(-TRIP_MAX_SPEED_SAMPLES);
        }
        segmentDiagRef.current.derivedSpeedUsed += 1;
      } else {
        segmentDiagRef.current.derivedSpeedRejected += 1;
      }
    }

    pts.push(telemetryPoint());
    if (pts.length > TRIP_MAX_TRACKED_POINTS) {
      trackedPts.current = compactTrackPoints(pts);
    }
    lastPointRef.current = { latitude: lat, longitude: lng, time: now };
    lastAccuracyRef.current = accuracyM ?? null;
    const nextDistance = distanceRef.current + segment.distanceKm;
    if (!Number.isFinite(nextDistance) || nextDistance > TRIP_MAX_DISTANCE_KM) {
      return 0;
    }
    distanceRef.current = nextDistance;
    const rounded = parseFloat(distanceRef.current.toFixed(2));
    const emitNow = Date.now();
    if (
      emitNow - lastLiveKmEmitRef.current >= 450
      || Math.abs(rounded - lastLiveKmValueRef.current) >= 0.02
    ) {
      lastLiveKmEmitRef.current = emitNow;
      lastLiveKmValueRef.current = rounded;
      setLiveDistanceKm(rounded);
    }
    segmentDiagRef.current.acceptedMain += 1;
    segmentDiagRef.current.acceptedMainKm += segment.distanceKm;
    maybeEmergencyCheckpoint();
    return segment.distanceKm;
  }, [maybeEmergencyCheckpoint]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(GPS_DISCONTINUITY_EVENT, (event) => {
      lastPointRef.current = null;
      lastAccuracyRef.current = null;
      reanchorFixesRemainingRef.current = 2;
      vroomGpsLog('TRIP_CONTINUITY_BREAK', {
        reason: event?.reason ?? 'camera',
        phase: event?.phase ?? 'unknown',
        active: tripActive,
      }, 0);
    });
    return () => subscription.remove();
  }, [tripActive]);

  useEffect(() => {
    if (!TRIP_STATS_DIAGNOSTICS) return undefined;
    const id = setInterval(() => {
      console.log('[TripStats][diag]', segmentDiagRef.current);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (TRIP_STATS_DIAGNOSTICS) return undefined;
    const id = setInterval(() => {
      const diag = segmentDiagRef.current;
      const rejected = diag.rejected;
      const totalRejected = (Object.values(rejected) as number[]).reduce((sum: number, n: number) => sum + Number(n || 0), 0);
      // Emit when the trip is active to show accumulation details.
      if (totalRejected <= 0 && diag.acceptedMain <= 0 && diag.fallbackAccepted <= 0 && diag.lowSpeedDropped <= 0) {
        return;
      }
      vroomGpsLog('TRIP_SEGMENT_STATS', {
        totalDistanceKm: Number(distanceRef.current.toFixed(3)),
        acceptedMain: diag.acceptedMain,
        acceptedMainKm: Number(diag.acceptedMainKm.toFixed(3)),
        fallbackAccepted: diag.fallbackAccepted,
        fallbackKm: Number(diag.fallbackKm.toFixed(3)),
        derivedSpeedUsed: diag.derivedSpeedUsed,
        derivedSpeedRejected: diag.derivedSpeedRejected,
        lowSpeedDropped: diag.lowSpeedDropped,
        zeroMove: diag.zeroMove,
        rejectedTotal: totalRejected,
        rejectedJitter: rejected.jitter || 0,
        rejectedJump: rejected.jump || 0,
        rejectedStaleGap: rejected.stale_gap || 0,
        rejectedMinSpeed: rejected.min_speed || 0,
        rejectedAccuracy: rejected.accuracy || 0,
        rejectedImpossible: rejected.impossible_speed || 0,
        rejectedInvalidTime: rejected.invalid_time || 0,
      }, 30_000);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const snapshotTrip = useCallback((overrides?: Partial<TripStats>) => {
    const elapsed  = startTimeRef.current
      ? Math.round((Date.now() - startTimeRef.current) / 1000)
      : 0;
    const samples  = speedSamples.current.filter(
      (s: number) => isValidSpeedSampleKmh(s),
    );
    const maxSpeed = samples.length ? Math.max(...samples) : 0;
    const avgSpeed = samples.length
      ? samples.reduce((a: number, b: number) => a + b, 0) / samples.length
      : 0;

    const result: TripStats = {
      maxSpeedKmh:   Math.round(maxSpeed),
      avgSpeedKmh:   Math.round(avgSpeed),
      elapsedSec:    elapsed,
      estimatedSec:  estSecRef.current,
      distanceKm:    parseFloat(distanceRef.current.toFixed(2)),
      trackedPoints: [...trackedPts.current],
      tripSessionId: tripSessionIdRef.current,
      ...overrides,
    };
    setStats(result);
    setLiveDistanceKm(result.distanceKm);
    return result;
  }, []);

  const finishTrip = useCallback((overrides?: Partial<TripStats>) => {
    const result = snapshotTrip(overrides);
    setTripActive(false);
    return result;
  }, [snapshotTrip]);

  const clearStats = useCallback((opts?: { preserveEmergency?: boolean }) => {
    setStats(null);
    speedSamples.current = [];
    trackedPts.current   = [];
    distanceRef.current  = 0;
    startTimeRef.current = null;
    lastPointRef.current = null;
    lastAccuracyRef.current = null;
    reanchorFixesRemainingRef.current = 0;
    lastEmergencyKmRef.current = 0;
    nativeOwnsRef.current = false;
    tripSessionIdRef.current = null;
    setTripActive(false);
    setLiveDistanceKm(0);
    if (!opts?.preserveEmergency) {
      void clearEmergencyTripSave();
    }
  }, []);

  return {
    startTrip,
    updateTripEstimate,
    feedSpeed,
    feedPosition,
    snapshotTrip,
    finishTrip,
    clearStats,
    restoreTripSnapshot,
    stats,
    liveDistanceKm,
  };
}
