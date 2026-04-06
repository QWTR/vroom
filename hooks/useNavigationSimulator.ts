import { useRef, useCallback, useEffect } from 'react';

interface Point {
  latitude:  number;
  longitude: number;
}

interface SimulatorOptions {
  onFrame:     (lat: number, lng: number, speedMs: number, heading: number) => void;
  speedKmh?:   number;
  intervalMs?: number;
}

export function useNavigationSimulator({
  onFrame,
  speedKmh   = 50,
  intervalMs = 200,
}: SimulatorOptions) {
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointsRef    = useRef<Point[]>([]);
  const segmentRef   = useRef(0);
  const progressRef  = useRef(0);
  const isRunningRef = useRef(false);

  // Zawsze aktualny onFrame — bez restartu pętli
  const onFrameRef = useRef(onFrame);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  // Aktualne speedKmh i intervalMs przez ref
  const speedRef    = useRef(speedKmh);
  const intervalRef = useRef(intervalMs);
  useEffect(() => { speedRef.current = speedKmh; },    [speedKmh]);
  useEffect(() => { intervalRef.current = intervalMs; }, [intervalMs]);

  function distanceM(a: Point, b: Point): number {
    const R    = 6371000;
    const dLat = ((b.latitude  - a.latitude)  * Math.PI) / 180;
    const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
    const sin2 =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.latitude  * Math.PI) / 180) *
      Math.cos((b.latitude  * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(sin2), Math.sqrt(1 - sin2));
  }

  function bearingDeg(a: Point, b: Point): number {
    const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
    const lat1 = (a.latitude  * Math.PI) / 180;
    const lat2 = (b.latitude  * Math.PI) / 180;
    const y    = Math.sin(dLon) * Math.cos(lat2);
    const x    = Math.cos(lat1) * Math.sin(lat2) -
                 Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  // tick przez ref — żeby setTimeout zawsze miał aktualną wersję
  const tickRef = useRef<() => void>(() => {});

  tickRef.current = () => {
    if (!isRunningRef.current) return;

    const points  = pointsRef.current;
    const seg     = segmentRef.current;

    if (seg >= points.length - 1) {
      isRunningRef.current = false;
      return;
    }

    const speedMs = (speedRef.current * 1000) / 3600;
    const from    = points[seg];
    const to      = points[seg + 1];
    const segDist = distanceM(from, to);
    const step    = (speedMs * intervalRef.current) / 1000;
    const advance = segDist > 0 ? step / segDist : 1;

    progressRef.current += advance;

    // Przeskocz przez tyle segmentów ile trzeba
    while (progressRef.current >= 1 && segmentRef.current < points.length - 2) {
      progressRef.current -= 1;
      segmentRef.current  += 1;
    }

    if (segmentRef.current >= points.length - 1) {
      const last = points[points.length - 1];
      onFrameRef.current(last.latitude, last.longitude, speedMs, 0);
      isRunningRef.current = false;
      return;
    }

    const t       = Math.min(progressRef.current, 1);
    const curFrom = points[segmentRef.current];
    const curTo   = points[segmentRef.current + 1];
    const lat     = curFrom.latitude  + (curTo.latitude  - curFrom.latitude)  * t;
    const lng     = curFrom.longitude + (curTo.longitude - curFrom.longitude) * t;
    const hdg     = bearingDeg(curFrom, curTo);

    onFrameRef.current(lat, lng, speedMs, hdg);

    // Zawsze wywołuj aktualny tick przez ref
    timerRef.current = setTimeout(() => tickRef.current(), intervalRef.current);
  };

  const startSimulation = useCallback((points: Point[]) => {
    if (points.length < 2) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    pointsRef.current   = [...points];
    segmentRef.current  = 0;
    progressRef.current = 0;
    isRunningRef.current = true;

    timerRef.current = setTimeout(() => tickRef.current(), 0); // startuj od razu
  }, []);

  const stopSimulation = useCallback(() => {
    isRunningRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopSimulation(), [stopSimulation]);

  return { startSimulation, stopSimulation };
}