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
  /** Jazda/nawigacja — nie pomijaj feedu przy speed=0 gdy GPS faktycznie się przesunął. */
  tripMode?:      boolean;
}

// iOS często ma 1.5-3s przerwy między fixami lat/lng przy żywym Dopplerze.
// Dawniej 3.5s cap powodował freeze markera między fixami — dlatego wydłużamy
// budżet ekstrapolacji do 7s i 500m, żeby true DR ciągnął marker płynnie.
const EXTRAPOLATION_MAX_MS = 7000;
const EXTRAPOLATION_MAX_DISTANCE_M = 500;
const EXTRAPOLATION_MIN_SPEED_MS = 1.4;

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

function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R)
    - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360;
}

function angleDeltaDeg(a: number, b: number): number {
  return Math.abs((((a - b) + 540) % 360) - 180);
}

function projectByBearingMeters(
  lat: number,
  lng: number,
  headingDeg: number,
  distM: number,
): { latitude: number; longitude: number } {
  const R = 6371000;
  const br = (headingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const d = distM / R;
  const nextLat = Math.asin(
    Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(br),
  );
  const nextLng = lngRad + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(latRad),
    Math.cos(d) - Math.sin(latRad) * Math.sin(nextLat),
  );
  return {
    latitude: (nextLat * 180) / Math.PI,
    longitude: (nextLng * 180) / Math.PI,
  };
}

export function useDeadReckoning({
  onFrame,
  frameInterval = 16,
  stallTimeout = 2500,
  enabled = true,
  tripMode = false,
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
  const lerpDurMs      = useRef(220);
  const lastFeedMs     = useRef(0);
  const hasFirstFeed   = useRef(false);
  const rafRef         = useRef<number | null>(null);
  const stoppedRef     = useRef(true);
  const onFrameRef     = useRef(onFrame);
  const stallTimeoutRef = useRef(stallTimeout);
  const enabledRef     = useRef(enabled);
  const tripModeRef    = useRef(tripMode);
  const frameIntervalRef = useRef(frameInterval);
  const lastFrameEmitRef = useRef(0);

  // True Dead Reckoning — ekstrapolacja markera między fixami GPS.
  const lastSpeedMsRef = useRef(0);
  const lastFrameWallMsRef = useRef(0);

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
    tripModeRef.current = tripMode;
  }, [tripMode]);

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

      // ── TRUE DEAD RECKONING ────────────────────────────────────────────────
      // Po dotarciu do GPS-targetu projektuj marker dalej z ostatniej znanej
      // prędkości i headingu — bez tego marker stoi nieruchomo aż do następnego
      // fixa (1 Hz GPS = 800–900 ms zamrożenia co tick = wizualny "freeze").
      const speedMs = Math.min(Math.max(0, lastSpeedMsRef.current), 55);
      if (tripModeRef.current && speedMs >= EXTRAPOLATION_MIN_SPEED_MS) {
        const sinceFeedMs = now - lastFeedMs.current;
        if (sinceFeedMs > 0 && sinceFeedMs <= EXTRAPOLATION_MAX_MS) {
          const lastWall = lastFrameWallMsRef.current > 0
            ? lastFrameWallMsRef.current
            : now;
          const dtMs = Math.min(80, Math.max(8, now - lastWall));
          let stepM = speedMs * (dtMs / 1000);
          // Cap akumulowanej projekcji od ostatniego feedu (safety).
          const remainingBudgetM = Math.max(
            0,
            EXTRAPOLATION_MAX_DISTANCE_M - speedMs * (sinceFeedMs / 1000 - dtMs / 1000),
          );
          if (stepM > remainingBudgetM) stepM = remainingBudgetM;
          if (stepM > 0.05 && Number.isFinite(hdg)) {
            const projected = projectByBearingMeters(lat, lng, hdg, stepM);
            lat = projected.latitude;
            lng = projected.longitude;
            // Aktualizuj displayLat/Lng od razu — kolejna klatka bazuje na nich.
          }
        }
      }
    }

    displayLat.current = lat;
    displayLng.current = lng;
    displayHdg.current = hdg;
    lastFrameWallMsRef.current = now;

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
    let nextLat = pos.latitude;
    let nextLng = pos.longitude;
    let nextHeading = heading;
    const anchorLat = displayLat.current || toLat.current;
    const anchorLng = displayLng.current || toLng.current;

    if (hasFirstFeed.current && lastFeedMs.current > 0) {
      let jumpM = haversineMeters(anchorLat, anchorLng, nextLat, nextLng);
      const dt = now - lastFeedMs.current;
      // Android często zgłasza speed=0 mimo ruchu — wylicz z delty pozycji.
      const impliedSpeedMs = dt > 0 ? jumpM / (dt / 1000) : 0;
      const speedMs = Math.min(55, Math.max(_speedMs ?? 0, impliedSpeedMs));
      const travelHeading = Number.isFinite(toHdg.current) ? toHdg.current : nextHeading;

      // ── ANTI-BACKWARD ──────────────────────────────────────────────────────
      // Gdy bridge w map.tsx projektuje marker forward, kolejny GPS fix często
      // jest "za markerem" (bo raw lat/lng spóźnia się za Doppler movement).
      // Bez anti-backward feedDR cofa marker do raw_snap → marker oscyluje.
      //
      // Próg `jumpM >= 3` (było 8) łapie też slow ruchy 10–15 km/h gdzie
      // skok jest naturalnie mały, ale raw GPS jest za bridge'em.
      // `backwardDelta > 110°` (było 124°) — nieco luźniej dla małych jumps.
      if (tripModeRef.current && jumpM >= 3 && speedMs >= 1.5) {
        const stepBearing = bearingBetween(anchorLat, anchorLng, nextLat, nextLng);
        const backwardDelta = angleDeltaDeg(stepBearing, travelHeading);
        if (backwardDelta > 110) {
          const projectedStepM = Math.min(24, Math.max(2.5, speedMs * 1.8));
          const projected = projectByBearingMeters(anchorLat, anchorLng, travelHeading, projectedStepM);
          nextLat = projected.latitude;
          nextLng = projected.longitude;
          nextHeading = travelHeading;
          jumpM = haversineMeters(anchorLat, anchorLng, nextLat, nextLng);
        }
      }

      const maxTargetStepM = tripModeRef.current
        ? Math.min(72, Math.max(14, speedMs * 2.4 + 6))
        : 50;
      if (jumpM > maxTargetStepM && jumpM > 0) {
        const t = maxTargetStepM / jumpM;
        nextLat = anchorLat + (nextLat - anchorLat) * t;
        nextLng = anchorLng + (nextLng - anchorLng) * t;
        jumpM = maxTargetStepM;
      }

      const keepAlive = () => {
        lastFeedMs.current = now;
        if (_speedMs != null && Number.isFinite(_speedMs)) {
          lastSpeedMsRef.current = Math.max(0, _speedMs);
        }
      };
      const tripActive = tripModeRef.current;
      if (tripActive && jumpM >= 0.5) {
        // W trybie jazdy/nawigacji zawsze aktualizuj cel przy realnym ruchu (Android speed=0).
      } else if (jumpM < 0.4 && dt < 500) {
        keepAlive();
        return;
      } else if (speedMs >= 2.5) {
        if (jumpM < 0.2 && dt < 350) {
          keepAlive();
          return;
        }
      } else if (speedMs < 0.7) {
        if (jumpM < 1.5 && dt < 2500) {
          keepAlive();
          return;
        }
      } else if (jumpM < 0.4 && dt < 2200 && speedMs < 1.2) {
        keepAlive();
        return;
      }
      // In trip mode do not starve DR target updates for too long: tiny accepted GPS
      // shifts still need periodic feed to avoid visible marker freeze.
      if (tripActive && jumpM < 0.7 && dt > 800) {
        // continue to commit this feed (no return)
      }
      // snapDisplayToTarget cofa marker do raw_GPS i KASUJE ekstrapolację. W tripMode
      // gdy marker jest projektowany do przodu (bridge / DR ekstrapolacja), a raw GPS
      // przyszedł "z tyłu" (jumpM<1.2 z perspektywy display), NIE snapuj — niech lerp
      // płynnie dogoni nowy target.
      if (!tripActive && jumpM < 1.2) {
        snapDisplayToTarget();
      }
      if (dt > 0 && dt < 10_000) {
        // W trip mode DR ma DOGANIAĆ snap target szybko — przy GPS 1 Hz lerp
        // 1400 ms powodował, że marker był stale ~20–80 m za snap targetem
        // (drToTargetM mediana 21 m, p95 77 m), bo lerp jeszcze nie kończył
        // gdy nowy fix nadchodził. Cap 650 ms w trip mode = w pełni dogonić
        // target w ramach jednego GPS ticka (1000 ms) z marginesem.
        const trip = tripModeRef.current;
        const targetDur = Math.max(140, dt * (trip ? 0.55 : 0.92));
        const blended = lerpDurMs.current * 0.22 + targetDur * 0.78;
        const minDur = 140;
        const maxDur = trip ? 650 : 1400;
        lerpDurMs.current = Math.max(minDur, Math.min(maxDur, blended));
      }
    }

    lastFeedMs.current  = now;
    lerpStartMs.current = now;

    // Zapisz prędkość do ekstrapolacji (Doppler GPS, m/s).
    if (_speedMs != null && Number.isFinite(_speedMs) && _speedMs >= 0) {
      lastSpeedMsRef.current = _speedMs;
    } else if (hasFirstFeed.current && lastFeedMs.current > 0) {
      // Estymuj z delty (np. Android często zgłasza speed=0).
      const dist = haversineMeters(
        displayLat.current,
        displayLng.current,
        nextLat,
        nextLng,
      );
      const dtSec = Math.max(0.1, (now - lastFeedMs.current) / 1000);
      const implied = dist / dtSec;
      lastSpeedMsRef.current = Math.max(0, Math.min(83, implied)); // cap 300km/h
    }

    if (hasFirstFeed.current) {
      // Wystartuj z aktualnej (potencjalnie ekstrapolowanej) display-pozycji,
      // żeby marker płynnie skorygował kurs zamiast teleportować się do nowego GPS-a.
      fromLat.current = displayLat.current;
      fromLng.current = displayLng.current;
      fromHdg.current = displayHdg.current;
    } else {
      fromLat.current = nextLat;
      fromLng.current = nextLng;
      fromHdg.current = nextHeading;
      displayLat.current = nextLat;
      displayLng.current = nextLng;
      displayHdg.current = nextHeading;
      hasFirstFeed.current = true;
    }

    toLat.current = nextLat;
    toLng.current = nextLng;
    toHdg.current = nextHeading;

    startLoop();
  }, [startLoop, snapDisplayToTarget]);

  const reset = useCallback(() => {
    hasFirstFeed.current = false;
    lastFeedMs.current   = 0;
    lerpDurMs.current    = 220;
    lerpStartMs.current  = 0;
    lastFrameEmitRef.current = 0;
    lastFrameWallMsRef.current = 0;
    lastSpeedMsRef.current = 0;
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
