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
  /** Gdy false — brak pętli rAF (oszczędność baterii). */
  enabled?:       boolean;
}

function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180) *
    Math.cos((bLat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useDeadReckoning({
  onFrame,
  frameInterval = 16,
  stallTimeout = 2500,
  enabled = true,
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
  const lerpDurMs      = useRef(280);
  const lastFeedMs     = useRef(0);
  const hasFirstFeed   = useRef(false);
  const rafRef         = useRef<number | null>(null);
  const stoppedRef     = useRef(true);
  const onFrameRef     = useRef(onFrame);
  const stallTimeoutRef = useRef(stallTimeout);
  const enabledRef     = useRef(enabled);
  const frameIntervalRef = useRef(frameInterval);
  const lastFrameEmitRef = useRef(0);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    stallTimeoutRef.current = stallTimeout;
  }, [stallTimeout]);

  useEffect(() => {
    frameIntervalRef.current = frameInterval;
  }, [frameInterval]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      stoppedRef.current = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [enabled]);

  const lerpAngle = (a: number, b: number, t: number) => {
    const diff = ((b - a + 540) % 360) - 180;
    return ((a + diff * t) + 360) % 360;
  };

  const snapDisplayToTarget = useCallback(() => {
    displayLat.current = toLat.current;
    displayLng.current = toLng.current;
    displayHdg.current = toHdg.current;
    fromLat.current = toLat.current;
    fromLng.current = toLng.current;
    fromHdg.current = toHdg.current;
    lerpStartMs.current = performance.now();
  }, []);

  const loop = useCallback(() => {
    if (stoppedRef.current || !enabledRef.current) return;
    rafRef.current = requestAnimationFrame(loop);

    if (!hasFirstFeed.current) return;

    const now = performance.now();

    if (now - lastFeedMs.current > stallTimeoutRef.current) {
      stoppedRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const elapsed = now - lerpStartMs.current;
    const rawT = Math.min(elapsed / Math.max(lerpDurMs.current, 90), 1.0);
    const t = easeOutCubic(rawT);

    let lat = fromLat.current + (toLat.current - fromLat.current) * t;
    let lng = fromLng.current + (toLng.current - fromLng.current) * t;
    let hdg = lerpAngle(fromHdg.current, toHdg.current, Math.min(t, 1));

    if (rawT >= 0.999) {
      lat = toLat.current;
      lng = toLng.current;
      hdg = toHdg.current;
    }

    displayLat.current = lat;
    displayLng.current = lng;
    displayHdg.current = hdg;

    if (now - lastFrameEmitRef.current < frameIntervalRef.current) return;
    lastFrameEmitRef.current = now;
    onFrameRef.current({ latitude: lat, longitude: lng }, hdg);
  }, []);

  const startLoop = useCallback(() => {
    if (!enabledRef.current) return;
    stoppedRef.current = false;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [loop]);

  const feed = useCallback((pos: Position, _speedMs: number, heading: number) => {
    if (!enabledRef.current) {
      // Gdy rAF wyłączone — nadal zapamiętaj cel; rodzic może odświeżyć marker przez bumpActiveMarker.
      if (
        Number.isFinite(pos.latitude) &&
        Number.isFinite(pos.longitude) &&
        Number.isFinite(heading)
      ) {
        toLat.current = pos.latitude;
        toLng.current = pos.longitude;
        toHdg.current = heading;
        displayLat.current = pos.latitude;
        displayLng.current = pos.longitude;
        displayHdg.current = heading;
        hasFirstFeed.current = true;
        lastFeedMs.current = performance.now();
      }
      return;
    }
    if (
      !Number.isFinite(pos.latitude) ||
      !Number.isFinite(pos.longitude) ||
      !Number.isFinite(heading)
    ) {
      return;
    }
    const now = performance.now();

    if (hasFirstFeed.current && lastFeedMs.current > 0) {
      const jumpM = haversineMeters(
        toLat.current, toLng.current,
        pos.latitude, pos.longitude,
      );
      const dt = now - lastFeedMs.current;
      if (jumpM < 0.4 && dt < 500) {
        return;
      }
      const speedMs = Math.max(0, _speedMs ?? 0);
      if (speedMs >= 2.5) {
        if (jumpM < 0.2 && dt < 350) return;
      } else if (speedMs < 0.7) {
        if (jumpM < 8 && dt < 6000) return;
        if (jumpM < 2.5 && dt < 2500) return;
      } else if (jumpM < 0.4 && dt < 2200 && speedMs < 1.2) {
        return;
      }
      if (jumpM < 1.2) {
        snapDisplayToTarget();
      }
      if (dt > 0 && dt < 10_000) {
        const targetDur = Math.max(200, dt * 0.98);
        const blended = lerpDurMs.current * 0.22 + targetDur * 0.78;
        lerpDurMs.current = Math.max(200, Math.min(1800, blended));
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

    startLoop();
  }, [startLoop, snapDisplayToTarget]);

  const reset = useCallback(() => {
    hasFirstFeed.current = false;
    lastFeedMs.current   = 0;
    lerpDurMs.current    = 280;
    lerpStartMs.current  = 0;
    lastFrameEmitRef.current = 0;
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

  return { feed, reset, stop, startLoop, displayLat, displayLng, displayHdg };
}
