import { useRef, useState, useCallback } from 'react';

export interface TripStats {
  maxSpeedKmh:   number;
  avgSpeedKmh:   number;
  elapsedSec:    number;
  estimatedSec:  number;
  distanceKm:    number;
  trackedPoints: { latitude: number; longitude: number }[];
}

export function useTripStats() {
  const speedSamples = useRef<number[]>([]);
  const trackedPts   = useRef<{ latitude: number; longitude: number }[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const estSecRef    = useRef<number>(0);
  const distanceRef  = useRef<number>(0);

  const [stats, setStats] = useState<TripStats | null>(null);

  const startTrip = useCallback((estimatedDurationSec: number) => {
    speedSamples.current = [];
    trackedPts.current   = [];
    distanceRef.current  = 0;
    startTimeRef.current = Date.now();
    estSecRef.current    = estimatedDurationSec;
    setStats(null);
  }, []);

  const feedSpeed = useCallback((speedMs: number | null) => {
    if (speedMs === null || speedMs < 0) return;
    const kmh = speedMs * 3.6;
    if (kmh > 1 && kmh <= 260) speedSamples.current.push(kmh); // ignoruj postoje + spike GPS
  }, []);

  const feedPosition = useCallback((lat: number, lng: number, speedMs?: number) => {
    // Skip if GPS reports speed below 2 km/h — prevents jitter accumulation while stopped.
    // Matches the same threshold used in feedNavDistance for consistency.
    if (speedMs !== undefined && speedMs * 3.6 < 2) return;

    const pts = trackedPts.current;
    if (!pts.length) { pts.push({ latitude: lat, longitude: lng }); return; }
    const last = pts[pts.length - 1];

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

    if (distKm < 0.010 || distKm > 2.0) return; // < 10 m or > 2 km → skip

    pts.push({ latitude: lat, longitude: lng });
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
  }, []);

  return { startTrip, feedSpeed, feedPosition, finishTrip, clearStats, stats };
}