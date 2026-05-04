import { useRef, useState, useCallback } from 'react';
import { evaluateDistanceSegment } from '../scripts/distanceEngine';

export interface TripStats {
  maxSpeedKmh:   number;
  avgSpeedKmh:   number;
  elapsedSec:    number;
  estimatedSec:  number;
  distanceKm:    number;
  trackedPoints: { latitude: number; longitude: number }[];
}

const TRIP_MAX_PLAUSIBLE_KMH = 220;
const TRIP_MAX_FIX_GAP_SEC   = 60;
const TRIP_MAX_SPEED_SAMPLES = 3000;
const TRIP_MAX_TRACKED_POINTS = 2500;

function compactTrackPoints(points: { latitude: number; longitude: number }[]) {
  if (points.length <= TRIP_MAX_TRACKED_POINTS) return points;
  const compacted: { latitude: number; longitude: number }[] = [];
  for (let i = 0; i < points.length; i += 2) {
    compacted.push(points[i]);
  }
  const last = points[points.length - 1];
  const tail = compacted[compacted.length - 1];
  if (!tail || tail.latitude !== last.latitude || tail.longitude !== last.longitude) {
    compacted.push(last);
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
    setStats(null);
    setLiveDistanceKm(0);
  }, []);

  const feedSpeed = useCallback((speedMs: number | null) => {
    if (speedMs === null || speedMs < 0) return;
    const kmh = speedMs * 3.6;
    if (kmh > 1 && kmh <= 260) {
      speedSamples.current.push(kmh); // ignoruj postoje + spike GPS
      if (speedSamples.current.length > TRIP_MAX_SPEED_SAMPLES) {
        speedSamples.current = speedSamples.current.slice(-TRIP_MAX_SPEED_SAMPLES);
      }
    }
  }, []);

  const feedPosition = useCallback((lat: number, lng: number, speedMs?: number): number => {
    const now = Date.now();
    // Skip if GPS reports speed below 2 km/h — prevents jitter accumulation while stopped.
    // Matches the same threshold used in feedNavDistance for consistency.
    if (speedMs !== undefined && speedMs * 3.6 < 2) return 0;

    const pts = trackedPts.current;
    if (!pts.length) {
      pts.push({ latitude: lat, longitude: lng });
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      return 0;
    }
    const last = pts[pts.length - 1];
    const lastMeta = lastPointRef.current;

    const segment = evaluateDistanceSegment(
      {
        latitude: last.latitude,
        longitude: last.longitude,
        timestampMs: lastMeta?.time ?? now,
        speedKmh: speedMs != null ? speedMs * 3.6 : null,
      },
      {
        latitude: lat,
        longitude: lng,
        timestampMs: now,
        speedKmh: speedMs != null ? speedMs * 3.6 : null,
      },
      {
        minSegmentKm: 0.010,
        maxSegmentKm: 2.0,
        maxFixGapSec: TRIP_MAX_FIX_GAP_SEC,
        maxPlausibleKmh: TRIP_MAX_PLAUSIBLE_KMH,
        minSpeedKmh: 2,
      },
    );
    if (!segment.accepted) {
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      return 0;
    }

    pts.push({ latitude: lat, longitude: lng });
    if (pts.length > TRIP_MAX_TRACKED_POINTS) {
      trackedPts.current = compactTrackPoints(pts);
    }
    lastPointRef.current = { latitude: lat, longitude: lng, time: now };
    distanceRef.current += segment.distanceKm;
    setLiveDistanceKm(parseFloat(distanceRef.current.toFixed(2)));
    return segment.distanceKm;
  }, []);

  const finishTrip = useCallback(() => {
    const elapsed  = startTimeRef.current
      ? Math.round((Date.now() - startTimeRef.current) / 1000)
      : 0;
    const samples  = speedSamples.current.filter(s => s > 2);
    const maxSpeed = samples.length ? Math.max(...samples) : 0;
    const avgSpeed = samples.length
      ? samples.reduce((a, b) => a + b, 0) / samples.length
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