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

const DRIVE_SPEED_KMH = 8; // trochę niżej niż 10 żeby uniknąć migotania

// Konfiguracje GPS per tryb
const GPS_CONFIG = {
  idle: {
    accuracy:         Location.Accuracy.Balanced,
    timeInterval:     3000,
    distanceInterval: 8,
  },
  // driving i navigating — identyczna wysoka częstotliwość
  active: {
    accuracy:         Location.Accuracy.BestForNavigation,
    timeInterval:     250,
    distanceInterval: 1,
  },
};

export function useAdaptiveGPS({ isNavigating, speedKmh, onLocation }: Options) {
  const subRef       = useRef<any>(null);
  const isActiveRef  = useRef(false); // czy jesteśmy na "active" config
  const onLocRef     = useRef(onLocation);
  const speedRef     = useRef(speedKmh);
  const navRef       = useRef(isNavigating);

  useEffect(() => { onLocRef.current = onLocation; }, [onLocation]);
  useEffect(() => { speedRef.current = speedKmh;   }, [speedKmh]);
  useEffect(() => { navRef.current   = isNavigating; }, [isNavigating]);

  const needsActiveConfig = useCallback((): boolean => {
    return navRef.current || speedRef.current > DRIVE_SPEED_KMH;
  }, []);

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
          onLocRef.current({
            latitude:  loc.coords.latitude,
            longitude: loc.coords.longitude,
            speed:     loc.coords.speed,
            heading:   loc.coords.heading,
            accuracy:  loc.coords.accuracy,
          });

          // ── Auto-upgrade: idle → active ──────────────────
          // Tylko upgrade idle→active, nigdy downgrade podczas jazdy
          // (downgrade przez osobny useEffect z opóźnieniem)
          const kmh = (loc.coords.speed ?? 0) * 3.6;
          speedRef.current = kmh;

          if (!isActiveRef.current && (navRef.current || kmh > DRIVE_SPEED_KMH)) {
            isActiveRef.current = true;
            subscribe(true);
          }
        },
      );
      subRef.current    = sub;
      isActiveRef.current = active;
    } catch (e) {
      console.warn('useAdaptiveGPS subscribe error:', e);
    }
  }, []);

  // Reaguj na zmianę isNavigating
  useEffect(() => {
    const shouldBeActive = needsActiveConfig();
    if (shouldBeActive !== isActiveRef.current) {
      subscribe(shouldBeActive);
    }
  }, [isNavigating, needsActiveConfig, subscribe]);

  const start = useCallback(async () => {
    const active = needsActiveConfig();
    await subscribe(active);
  }, [needsActiveConfig, subscribe]);

  const stop = useCallback(() => {
    subRef.current?.remove();
    subRef.current = null;
  }, []);

  return { start, stop };
}