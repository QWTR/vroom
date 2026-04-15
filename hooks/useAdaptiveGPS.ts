import { useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';

export type GPSMode = 'idle' | 'driving' | 'navigating';

interface Options {
  isNavigating: boolean;
  speedKmh:     number;
  onLocation:   (loc: {
    latitude:  number;
    longitude: number;
    speed:     number | null;
    heading:   number | null;
    accuracy:  number | null;
  }) => void;
}

const DRIVE_SPEED_KMH  = 12;
const MAX_ACCURACY_M   = 40;
const MAX_SPEED_KMH    = 250;

const GPS_CONFIG = {
  idle: {
    accuracy:         Location.Accuracy.Balanced,
    timeInterval:     3000,
    distanceInterval: 8,
  },
  active: {
    accuracy:         Location.Accuracy.BestForNavigation,
    timeInterval:     250,
    distanceInterval: 1,
  },
};

function calcSpeedKmh(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  dtMs: number,
): number {
  if (dtMs <= 0) return 0;
  const R    = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (distM / (dtMs / 1000)) * 3.6;
}

export function useAdaptiveGPS({ isNavigating, speedKmh, onLocation }: Options) {
  const subRef            = useRef<any>(null);
  const isActiveRef       = useRef(false);
  const onLocRef          = useRef(onLocation);
  const speedRef          = useRef(speedKmh);
  const navRef            = useRef(isNavigating);

  const lastGoodRef       = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const consecutiveBadRef = useRef(0);

  useEffect(() => { onLocRef.current = onLocation; }, [onLocation]);
  useEffect(() => { speedRef.current = speedKmh;   }, [speedKmh]);
  useEffect(() => { navRef.current   = isNavigating; }, [isNavigating]);

  const subscribe = useCallback(async (active: boolean) => {
    subRef.current?.remove();
    subRef.current = null;

    const cfg = active ? GPS_CONFIG.active : GPS_CONFIG.idle;
    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy:         cfg.accuracy,
          timeInterval:     cfg.timeInterval,
          distanceInterval: cfg.distanceInterval,
        },
        (loc) => {
          const now    = Date.now();
          const rawLat = loc.coords.latitude;
          const rawLng = loc.coords.longitude;
          const acc    = loc.coords.accuracy ?? 999;

          // ══ 1. ODRZUĆ słaby sygnał GPS ═══════════════════════
          if (acc > MAX_ACCURACY_M) {
            consecutiveBadRef.current += 1;
            if (consecutiveBadRef.current >= 5 && lastGoodRef.current) {
              onLocRef.current({
                latitude:  lastGoodRef.current.lat,
                longitude: lastGoodRef.current.lng,
                speed:     0,
                heading:   loc.coords.heading,
                accuracy:  acc,
              });
            }
            return;
          }
          consecutiveBadRef.current = 0;

          // ══ 2. SANITY CHECK — odrzuć teleport ════════════════
          if (lastGoodRef.current) {
            const dtMs    = now - lastGoodRef.current.time;
            const jumpKmh = calcSpeedKmh(
              lastGoodRef.current.lat, lastGoodRef.current.lng,
              rawLat, rawLng, dtMs,
            );
            if (jumpKmh > MAX_SPEED_KMH) {
              console.warn(`[GPS] Skok odrzucony: ${Math.round(jumpKmh)} km/h`);
              return;
            }
          }

          // ══ 3. Prędkość — TYLKO z GPS coords, bez obliczania ═
          // Podczas nawigacji nigdy nie obliczamy prędkości ze skoków
          // bo to właśnie powoduje teleportowanie markera
          const speedMs = loc.coords.speed != null && loc.coords.speed >= 0
            ? loc.coords.speed
            : 0;

          // ══ 4. Aktualizuj lastGoodRef ════════════════════════
          lastGoodRef.current = { lat: rawLat, lng: rawLng, time: now };
          speedRef.current    = speedMs * 3.6;

          // ══ 5. Wyślij surowe dane — Kalman jest w map.tsx ════
          onLocRef.current({
            latitude:  rawLat,
            longitude: rawLng,
            speed:     speedMs,
            heading:   loc.coords.heading,
            accuracy:  acc,
          });

          // ══ 6. Auto-upgrade idle → active ════════════════════
          if (!isActiveRef.current &&
              (navRef.current || speedMs * 3.6 > DRIVE_SPEED_KMH)) {
            isActiveRef.current = true;
            subscribe(true);
          }
        },
      );
      subRef.current      = sub;
      isActiveRef.current = active;
    } catch (e) {
      console.warn('useAdaptiveGPS subscribe error:', e);
    }
  }, []);

  const needsActiveConfig = useCallback((): boolean => {
    return navRef.current || speedRef.current > DRIVE_SPEED_KMH;
  }, []);

  useEffect(() => {
    const shouldBeActive = needsActiveConfig();
    if (shouldBeActive !== isActiveRef.current) {
      subscribe(shouldBeActive);
    }
  }, [isNavigating, needsActiveConfig, subscribe]);

  const start = useCallback(async () => {
    await subscribe(needsActiveConfig());
  }, [needsActiveConfig, subscribe]);

  const stop = useCallback(() => {
    subRef.current?.remove();
    subRef.current      = null;
    lastGoodRef.current = null;
  }, []);

  return { start, stop };
}