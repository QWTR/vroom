import { useEffect, useRef, useCallback } from 'react';

interface Position {
  latitude:  number;
  longitude: number;
}

interface DeadReckoningOptions {
  /** Wywołuje się przy każdej klatce animacji (~60fps) podczas nawigacji */
  onFrame:       (pos: Position, heading: number) => void;
  frameInterval?: number; // ms, default 16 (~60fps)
  stallTimeout?:  number; // ms bez GPS → zatrzymaj interpolację, default 2500
}

/**
 * Dead-reckoning: lokalnie interpoluje pozycję między updateami GPS.
 *
 * Wywołaj feed() przy każdym nowym punkcie GPS.
 * Hook emituje onFrame() co frameInterval ms z interpolowaną pozycją.
 * 
 * NIE używa setState — tylko ref + callback, zero re-renderów.
 */
export function useDeadReckoning({
  onFrame,
  frameInterval = 16,
  stallTimeout  = 2500,
}: DeadReckoningOptions) {
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const posRef        = useRef<Position | null>(null);
  const headingRef    = useRef(0);
  const velLatRef     = useRef(0); // deg/ms
  const velLngRef     = useRef(0); // deg/ms
  const lastFeedMs    = useRef(0);
  const lastFrameMs   = useRef(0);
  const isRunningRef  = useRef(false);

  const stopLoop = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    isRunningRef.current = false;
  }, []);

  const tick = useCallback(() => {
    const now = Date.now();
    const dt  = now - lastFrameMs.current;
    lastFrameMs.current = now;

    // Przestań jeśli GPS stoi za długo
    if (now - lastFeedMs.current > stallTimeout) {
      stopLoop();
      return;
    }

    if (posRef.current && dt > 0 && dt < 500) {
      // Przesuń pozycję o wektor prędkości × dt
      posRef.current = {
        latitude:  posRef.current.latitude  + velLatRef.current * dt,
        longitude: posRef.current.longitude + velLngRef.current * dt,
      };
      onFrame(posRef.current, headingRef.current);
    }

    timerRef.current = setTimeout(tick, frameInterval);
  }, [onFrame, frameInterval, stallTimeout, stopLoop]);

  const startLoop = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    lastFrameMs.current  = Date.now();
    timerRef.current     = setTimeout(tick, frameInterval);
  }, [tick, frameInterval]);

  /**
   * Zasilaj nowym punktem GPS.
   * @param pos     nowa pozycja (po Kalmanie / snap-to-road)
   * @param speedMs prędkość m/s (z GPS)
   * @param heading kierunek w stopniach (0=N, 90=E)
   */
  const feed = useCallback((pos: Position, speedMs: number, heading: number) => {
    const now = Date.now();
    const dt  = now - lastFeedMs.current;

    headingRef.current = heading;

    if (posRef.current && dt > 0 && dt < 3000) {
      // Prędkość z rzeczywistego przesunięcia GPS (bardziej dokładne)
      const rawVelLat = (pos.latitude  - posRef.current.latitude)  / dt;
      const rawVelLng = (pos.longitude - posRef.current.longitude) / dt;

      // Low-pass: 30% stara prędkość, 70% nowa — wygładza skoki
      velLatRef.current = velLatRef.current * 0.3 + rawVelLat * 0.7;
      velLngRef.current = velLngRef.current * 0.3 + rawVelLng * 0.7;
    } else if (speedMs > 0.5) {
      // Fallback gdy brak poprzedniej pozycji lub stały — prędkość z GPS + heading
      const headingRad  = (heading * Math.PI) / 180;
      const degPerMs    = speedMs / 1000 / 111320;
      const cosLat      = Math.cos(pos.latitude * Math.PI / 180);

      velLatRef.current = Math.cos(headingRad) * degPerMs;
      velLngRef.current = Math.sin(headingRad) * degPerMs / (cosLat || 1);
    } else {
      // Auto stoi
      velLatRef.current = 0;
      velLngRef.current = 0;
    }

    // Zresetuj bazę do rzeczywistej pozycji GPS (eliminuje dryfowanie)
    posRef.current  = { ...pos };
    lastFeedMs.current = now;

    startLoop();
  }, [startLoop]);

  const reset = useCallback(() => {
    stopLoop();
    posRef.current     = null;
    velLatRef.current  = 0;
    velLngRef.current  = 0;
    lastFeedMs.current = 0;
  }, [stopLoop]);

  // Cleanup
  useEffect(() => () => stopLoop(), [stopLoop]);

  return { feed, reset, stop: stopLoop };
}