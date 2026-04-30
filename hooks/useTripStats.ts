import { useRef, useState, useCallback } from 'react';

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

export function useTripStats() {
  const speedSamples = useRef<number[]>([]);
  const trackedPts   = useRef<{ latitude: number; longitude: number }[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const estSecRef    = useRef<number>(0);
  const distanceRef  = useRef<number>(0);
  const lastPointRef = useRef<{ latitude: number; longitude: number; time: number } | null>(null);

  const [stats, setStats] = useState<TripStats | null>(null);

  const startTrip = useCallback((estimatedDurationSec: number) => {
    speedSamples.current = [];
    trackedPts.current   = [];
    distanceRef.current  = 0;
    startTimeRef.current = Date.now();
    estSecRef.current    = estimatedDurationSec;
    lastPointRef.current = null;
    setStats(null);
  }, []);

  const feedSpeed = useCallback((speedMs: number | null) => {
    if (speedMs === null || speedMs < 0) return;
    const kmh = speedMs * 3.6;
    if (kmh > 1 && kmh <= 260) speedSamples.current.push(kmh); // ignoruj postoje + spike GPS
  }, []);

  const feedPosition = useCallback((lat: number, lng: number, speedMs?: number) => {
    const now = Date.now();
    // Skip if GPS reports speed below 2 km/h — prevents jitter accumulation while stopped.
    // Matches the same threshold used in feedNavDistance for consistency.
    if (speedMs !== undefined && speedMs * 3.6 < 2) return;

    const pts = trackedPts.current;
    if (!pts.length) {
      pts.push({ latitude: lat, longitude: lng });
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      return;
    }
    const last = pts[pts.length - 1];
    const lastMeta = lastPointRef.current;

    // Use a proper Haversine distance instead of the old axis-independent check.
    // Minimum 10 m avoids accumulating GPS jitter while stationary.
    // Maximum 2 km rejects GPS teleportation while allowing low-frequency highway updates.
    const R     = 6371;
    const dLatR = (lat - last.latitude)  * Math.PI / 180;
    const dLngR = (lng - last.longitude) * Math.PI / 180;
    const a = Math.sin(dLatR / 2) ** 2 +
      Math.cos(last.latitude * Math.PI / 180) *
      Math.cos(lat * Math.PI / 180) *
      Math.sin(dLngR / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dtSec = lastMeta ? Math.max(0, (now - lastMeta.time) / 1000) : 0;
    const maxByTimeKm = dtSec > 0 ? (TRIP_MAX_PLAUSIBLE_KMH / 3600) * dtSec : 0;

    // Reject stale gaps and physically impossible movement even if the absolute
    // segment is below 2 km (common source of severe overcount on noisy devices).
    if (dtSec <= 0 || dtSec > TRIP_MAX_FIX_GAP_SEC) {
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      return;
    }
    if (distKm < 0.010 || distKm > 2.0 || distKm > maxByTimeKm) {
      lastPointRef.current = { latitude: lat, longitude: lng, time: now };
      return;
    } // < 10 m or implausible jump → skip

    pts.push({ latitude: lat, longitude: lng });
    lastPointRef.current = { latitude: lat, longitude: lng, time: now };
    distanceRef.current += distKm;
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
    return result;
  }, []);

  const clearStats = useCallback(() => {
    setStats(null);
    speedSamples.current = [];
    trackedPts.current   = [];
    distanceRef.current  = 0;
    startTimeRef.current = null;
    lastPointRef.current = null;
  }, []);

  return { startTrip, feedSpeed, feedPosition, finishTrip, clearStats, stats };
}