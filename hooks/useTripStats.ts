import { useRef, useState, useCallback, useEffect } from 'react';
import { evaluateDistanceSegment, haversineKm } from '../scripts/distanceEngine';
import { vroomGpsLog } from '../lib/vroomGpsLog';

export interface TripStats {
  maxSpeedKmh:   number;
  avgSpeedKmh:   number;
  elapsedSec:    number;
  estimatedSec:  number;
  distanceKm:    number;
  trackedPoints: { latitude: number; longitude: number }[];
}

const TRIP_MAX_PLAUSIBLE_KMH = 360;
/** Dłuższe przerwy GPS (tunel, Doze) — po tym segmencie reset kotwicy zamiast wiecznego odrzucania. */
const TRIP_MAX_FIX_GAP_SEC   = 480;
const TRIP_FALLBACK_MAX_GAP_SEC = 900;
const TRIP_MAX_SPEED_SAMPLES = 3000;
const TRIP_MAX_TRACKED_POINTS = 2500;
const TRIP_MIN_SEGMENT_KM = 0.003;
const TRIP_MAX_SEGMENT_KM = 2.5;
const TRIP_FALLBACK_MAX_SEGMENT_KM = 1.1;
const TRIP_FALLBACK_MIN_SPEED_KMH = 5;
const TRIP_MAX_DISTANCE_KM = 1200;
const TRIP_STATS_DIAGNOSTICS = __DEV__;

function compactTrackPoints(points: { latitude: number; longitude: number }[]) {
  if (points.length <= TRIP_MAX_TRACKED_POINTS) return points;
  let compacted = points;
  while (compacted.length > TRIP_MAX_TRACKED_POINTS) {
    const next: { latitude: number; longitude: number }[] = [];
    for (let i = 0; i < compacted.length; i += 2) {
      next.push(compacted[i]);
    }
    const last = compacted[compacted.length - 1];
    const tail = next[next.length - 1];
    if (!tail || tail.latitude !== last.latitude || tail.longitude !== last.longitude) {
      next.push(last);
    }
    compacted = next;
  }
  return compacted;
}

export function useTripStats() {
  const speedSamples = useRef<number[]>([]);
  const trackedPts   = useRef<{ latitude: number; longitude: number }[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const estSecRef    = useRef<number>(0);
  const distanceRef  = useRef<number>(0);
  const lastPointRef = useRef<{ latitude: number; longitude: number; time: number } | null>(null);
  const lastLiveKmEmitRef = useRef(0);
  const lastLiveKmValueRef = useRef(0);
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
  });

  const [stats, setStats] = useState<TripStats | null>(null);
  /** Aktualny dystans trasy (ten sam silnik co zapis trasy / nawigacja) — do HUD w trybie jazdy. */
  const [liveDistanceKm, setLiveDistanceKm] = useState(0);

  const startTrip = useCallback((estimatedDurationSec: number) => {
    speedSamples.current = [];
    trackedPts.current   = [];
    distanceRef.current  = 0;
    startTimeRef.current = Date.now();
    estSecRef.current    = estimatedDurationSec;
    lastPointRef.current = null;
    lastLiveKmEmitRef.current = 0;
    lastLiveKmValueRef.current = 0;
    setStats(null);
    setLiveDistanceKm(0);
  }, []);

  const feedSpeed = useCallback((speedMs: number | null) => {
    if (speedMs === null || speedMs < 0) return;
    const kmh = speedMs * 3.6;
    if (kmh > 1 && kmh <= 360) {
      speedSamples.current.push(kmh); // ignoruj postoje + spike GPS
      if (speedSamples.current.length > TRIP_MAX_SPEED_SAMPLES) {
        speedSamples.current = speedSamples.current.slice(-TRIP_MAX_SPEED_SAMPLES);
      }
    }
  }, []);

  const feedPosition = useCallback((lat: number, lng: number, speedMs?: number): number => {
    const now = Date.now();
    // Some Android devices often report 0 m/s while actually moving.
    // Treat non-positive speed as "unknown" instead of "stationary" to avoid
    // dropping valid distance segments during active navigation.
    const speedKmh = speedMs != null && speedMs > 0 ? speedMs * 3.6 : null;
    const pts = trackedPts.current;
    const lastMeta = lastPointRef.current;
    // Android często zgłasza 0 m/s przy jeździe — nie odrzucaj segmentu wyłącznie z powodu prędkości.
    if (speedKmh != null && speedKmh < 2 && lastMeta) {
      const movedKm = haversineKm(lastMeta.latitude, lastMeta.longitude, lat, lng);
      if (movedKm < TRIP_MIN_SEGMENT_KM * 2) return 0;
    }
    if (!lastMeta) {
      pts.push({ latitude: lat, longitude: lng });
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      return 0;
    }
    const dtSecRaw = Math.max(0, (now - lastMeta.time) / 1000);

    const segment = evaluateDistanceSegment(
      {
        latitude: lastMeta.latitude,
        longitude: lastMeta.longitude,
        timestampMs: lastMeta.time,
        speedKmh,
      },
      {
        latitude: lat,
        longitude: lng,
        timestampMs: now,
        speedKmh,
      },
      {
        minSegmentKm: TRIP_MIN_SEGMENT_KM,
        maxSegmentKm: TRIP_MAX_SEGMENT_KM,
        maxFixGapSec: TRIP_MAX_FIX_GAP_SEC,
        maxPlausibleKmh: TRIP_MAX_PLAUSIBLE_KMH,
        minSpeedKmh: 2,
      },
    );
    if (!segment.accepted) {
      segmentDiagRef.current.rejected[segment.reason] = (segmentDiagRef.current.rejected[segment.reason] ?? 0) + 1;
      const dtSec = Math.max(0, (now - lastMeta.time) / 1000);
      const isRecoverable = segment.reason === 'jump' || segment.reason === 'impossible_speed' || segment.reason === 'stale_gap';
      if (isRecoverable && dtSec > 0 && dtSec <= TRIP_FALLBACK_MAX_GAP_SEC) {
        const rawKm = haversineKm(lastMeta.latitude, lastMeta.longitude, lat, lng);
        const cappedByTimeKm = (TRIP_MAX_PLAUSIBLE_KMH / 3600) * Math.min(dtSec, TRIP_MAX_FIX_GAP_SEC);
        const derivedRawKmh = dtSecRaw > 0 ? (rawKm * 3600) / dtSecRaw : 0;
        const hasMotionSignal =
          (speedKmh != null && speedKmh >= TRIP_FALLBACK_MIN_SPEED_KMH)
          || (Number.isFinite(derivedRawKmh) && derivedRawKmh >= TRIP_FALLBACK_MIN_SPEED_KMH);
        const fallbackCapKm = hasMotionSignal
          ? TRIP_FALLBACK_MAX_SEGMENT_KM
          : Math.min(0.2, TRIP_FALLBACK_MAX_SEGMENT_KM);
        // With no motion signal (speed unknown/low), reject larger jumps so standing
        // jitter cannot leak into trip distance.
        if (!hasMotionSignal && rawKm > 0.25) {
          lastPointRef.current = { latitude: lat, longitude: lng, time: now };
          return 0;
        }
        const fallbackKm = Math.min(rawKm, cappedByTimeKm, fallbackCapKm);
        if (fallbackKm >= TRIP_MIN_SEGMENT_KM * 1.2) {
          const derivedKmh = dtSecRaw > 0 ? (fallbackKm * 3600) / dtSecRaw : 0;
          if ((speedKmh == null || speedKmh < 2) && Number.isFinite(derivedKmh) && derivedKmh >= 2 && derivedKmh <= 360) {
            speedSamples.current.push(derivedKmh);
            if (speedSamples.current.length > TRIP_MAX_SPEED_SAMPLES) {
              speedSamples.current = speedSamples.current.slice(-TRIP_MAX_SPEED_SAMPLES);
            }
            segmentDiagRef.current.derivedSpeedUsed += 1;
          } else if (speedKmh == null || speedKmh < 2) {
            segmentDiagRef.current.derivedSpeedRejected += 1;
          }
          pts.push({ latitude: lat, longitude: lng });
          if (pts.length > TRIP_MAX_TRACKED_POINTS) {
            trackedPts.current = compactTrackPoints(pts);
          }
          lastPointRef.current = { latitude: lat, longitude: lng, time: now };
          const nextDistance = distanceRef.current + fallbackKm;
          if (Number.isFinite(nextDistance) && nextDistance <= TRIP_MAX_DISTANCE_KM) {
            distanceRef.current = nextDistance;
            const rounded = parseFloat(distanceRef.current.toFixed(2));
            const emitNow = Date.now();
            if (
              emitNow - lastLiveKmEmitRef.current >= 450
              || Math.abs(rounded - lastLiveKmValueRef.current) >= 0.05
            ) {
              lastLiveKmEmitRef.current = emitNow;
              lastLiveKmValueRef.current = rounded;
              setLiveDistanceKm(rounded);
            }
            segmentDiagRef.current.fallbackAccepted += 1;
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
      return 0;
    }

    const derivedKmh = dtSecRaw > 0 ? (segment.distanceKm * 3600) / dtSecRaw : 0;
    if (speedKmh == null || speedKmh < 2) {
      if (Number.isFinite(derivedKmh) && derivedKmh >= 2 && derivedKmh <= 360) {
        speedSamples.current.push(derivedKmh);
        if (speedSamples.current.length > TRIP_MAX_SPEED_SAMPLES) {
          speedSamples.current = speedSamples.current.slice(-TRIP_MAX_SPEED_SAMPLES);
        }
        segmentDiagRef.current.derivedSpeedUsed += 1;
      } else {
        segmentDiagRef.current.derivedSpeedRejected += 1;
      }
    }

    pts.push({ latitude: lat, longitude: lng });
    if (pts.length > TRIP_MAX_TRACKED_POINTS) {
      trackedPts.current = compactTrackPoints(pts);
    }
    lastPointRef.current = { latitude: lat, longitude: lng, time: now };
    const nextDistance = distanceRef.current + segment.distanceKm;
    if (!Number.isFinite(nextDistance) || nextDistance > TRIP_MAX_DISTANCE_KM) {
      return 0;
    }
    distanceRef.current = nextDistance;
    const rounded = parseFloat(distanceRef.current.toFixed(2));
    const emitNow = Date.now();
    if (
      emitNow - lastLiveKmEmitRef.current >= 450
      || Math.abs(rounded - lastLiveKmValueRef.current) >= 0.05
    ) {
      lastLiveKmEmitRef.current = emitNow;
      lastLiveKmValueRef.current = rounded;
      setLiveDistanceKm(rounded);
    }
    return segment.distanceKm;
  }, []);

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
      const rejected = segmentDiagRef.current.rejected;
      const totalRejected = (Object.values(rejected) as number[]).reduce((sum: number, n: number) => sum + Number(n || 0), 0);
      if (totalRejected <= 0) return;
      vroomGpsLog('TRIP_SEGMENT_STATS', {
        rejected: totalRejected,
        fallbackAccepted: segmentDiagRef.current.fallbackAccepted,
        derivedUsed: segmentDiagRef.current.derivedSpeedUsed,
      }, 60_000);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const finishTrip = useCallback(() => {
    const elapsed  = startTimeRef.current
      ? Math.round((Date.now() - startTimeRef.current) / 1000)
      : 0;
    const samples  = speedSamples.current.filter((s: number) => s > 2);
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
    };
    setStats(result);
    setLiveDistanceKm(result.distanceKm);
    return result;
  }, []);

  const clearStats = useCallback(() => {
    setStats(null);
    speedSamples.current = [];
    trackedPts.current   = [];
    distanceRef.current  = 0;
    startTimeRef.current = null;
    lastPointRef.current = null;
    setLiveDistanceKm(0);
  }, []);

  return { startTrip, feedSpeed, feedPosition, finishTrip, clearStats, stats, liveDistanceKm };
}