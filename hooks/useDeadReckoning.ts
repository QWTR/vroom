import { useEffect, useRef, useCallback } from 'react';

interface Position {
  latitude:  number;
  longitude: number;
}

interface DeadReckoningOptions {
  /** Wywołuje się przy każdej klatce animacji (~60fps) */
  onFrame:       (pos: Position, heading: number) => void;
  frameInterval?: number;
  stallTimeout?:  number;
}

export function useDeadReckoning({
  onFrame,
  stallTimeout = 2500,
}: DeadReckoningOptions) {

  const displayLat = useRef(0);
  const displayLng = useRef(0);
  const displayHdg = useRef(0);

  const fromLat = useRef(0);
  const fromLng = useRef(0);
  const fromHdg = useRef(0);
  const toLat   = useRef(0);
  const toLng   = useRef(0);
  const toHdg   = useRef(0);

  const lerpStartMs    = useRef(0);
  const lerpDurMs      = useRef(300);
  const lastFeedMs     = useRef(0);
  const hasFirstFeed   = useRef(false);
  const rafRef         = useRef<number | null>(null);
  const stoppedRef     = useRef(false);
  // Ref do onFrame żeby nie restartować pętli rAF przy zmianie callbacka
  const onFrameRef     = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const lerpAngle = (a: number, b: number, t: number) => {
    const diff = ((b - a + 540) % 360) - 180;
    return ((a + diff * t) + 360) % 360;
  };

  // Pętla startuje RAZ przy montowaniu — nie zależy od onFrame
  const loop = useCallback(() => {
    if (stoppedRef.current) return;
    rafRef.current = requestAnimationFrame(loop);

    if (!hasFirstFeed.current) return;

    const now = performance.now();

    if (now - lastFeedMs.current > stallTimeout) {
      stoppedRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const elapsed = now - lerpStartMs.current;
    const t = Math.min(elapsed / Math.max(lerpDurMs.current, 50), 1.2);

    const lat = fromLat.current + (toLat.current - fromLat.current) * t;
    const lng = fromLng.current + (toLng.current - fromLng.current) * t;
    const hdg = lerpAngle(fromHdg.current, toHdg.current, Math.min(t, 1));

    displayLat.current = lat;
    displayLng.current = lng;
    displayHdg.current = hdg;

    // Wywołaj przez ref — bez restartu pętli gdy callback się zmieni
    onFrameRef.current({ latitude: lat, longitude: lng }, hdg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ← celowo pusta — pętla tworzona raz

  useEffect(() => {
    stoppedRef.current = false;
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      stoppedRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [loop]);

  const feed = useCallback((pos: Position, _speedMs: number, heading: number) => {
    const now = performance.now();

    if (hasFirstFeed.current && lastFeedMs.current > 0) {
      const dt = now - lastFeedMs.current;
      if (dt > 0 && dt < 3000) {
        lerpDurMs.current = lerpDurMs.current * 0.6 + dt * 0.4;
      }
    }

    lastFeedMs.current  = now;
    lerpStartMs.current = now;

    if (hasFirstFeed.current) {
      fromLat.current = displayLat.current;
      fromLng.current = displayLng.current;
      fromHdg.current = displayHdg.current;
    } else {
      fromLat.current = pos.latitude;
      fromLng.current = pos.longitude;
      fromHdg.current = heading;
      displayLat.current = pos.latitude;
      displayLng.current = pos.longitude;
      displayHdg.current = heading;
      hasFirstFeed.current = true;
    }

    toLat.current = pos.latitude;
    toLng.current = pos.longitude;
    toHdg.current = heading;

    if (stoppedRef.current) {
      stoppedRef.current = false;
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [loop]);

  const reset = useCallback(() => {
    hasFirstFeed.current = false;
    lastFeedMs.current   = 0;
    lerpDurMs.current    = 300;
    lerpStartMs.current  = 0;
    fromLat.current = toLat.current = displayLat.current = 0;
    fromLng.current = toLng.current = displayLng.current = 0;
    fromHdg.current = toHdg.current = displayHdg.current = 0;
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Zwróć refy do odczytu pozycji bez setState
  return { feed, reset, stop, displayLat, displayLng, displayHdg };
}