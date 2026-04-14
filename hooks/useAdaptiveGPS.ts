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

// Progi trybów
const DRIVE_SPEED_KMH = 10;

// Konfiguracje GPS per tryb
const GPS_CONFIG: Record<GPSMode, {
  accuracy:         Location.Accuracy;
  timeInterval:     number;
  distanceInterval: number;
}> = {
  idle: {
    accuracy:         Location.Accuracy.Balanced,
    timeInterval:     3000,
    distanceInterval: 10,
  },
  driving: {
    accuracy:         Location.Accuracy.BestForNavigation,
    timeInterval:     300,
    distanceInterval: 2,
  },
  navigating: {
    accuracy:         Location.Accuracy.BestForNavigation,
    timeInterval:     200,
    distanceInterval: 1,
  },
};

export function useAdaptiveGPS({ isNavigating, speedKmh, onLocation }: Options) {
  const subRef      = useRef<any>(null);
  const modeRef     = useRef<GPSMode>('idle');
  const onLocRef    = useRef(onLocation);
  const speedRef    = useRef(speedKmh);
  const navRef      = useRef(isNavigating);

  // Zawsze aktualny callback bez re-subscribe
  useEffect(() => { onLocRef.current = onLocation; }, [onLocation]);
  useEffect(() => { speedRef.current = speedKmh;   }, [speedKmh]);
  useEffect(() => { navRef.current   = isNavigating; }, [isNavigating]);

  const getTargetMode = useCallback((): GPSMode => {
    if (navRef.current)              return 'navigating';
    if (speedRef.current > DRIVE_SPEED_KMH) return 'driving';
    return 'idle';
  }, []);

  const subscribe = useCallback(async (mode: GPSMode) => {
    // Usuń poprzednią subskrypcję
    subRef.current?.remove();
    subRef.current = null;

    const cfg = GPS_CONFIG[mode];
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

          // Auto-upgrade trybu na podstawie aktualnej prędkości
          const kmh        = (loc.coords.speed ?? 0) * 3.6;
          speedRef.current = kmh;
          const newMode    = getTargetMode();
          if (newMode !== modeRef.current) {
            modeRef.current = newMode;
            subscribe(newMode); // re-subscribe z nową konfiguracją
          }
        },
      );
      subRef.current  = sub;
      modeRef.current = mode;
    } catch (e) {
      console.warn('useAdaptiveGPS subscribe error:', e);
    }
  }, [getTargetMode]);

  // Reaguj na zmianę isNavigating z zewnątrz
  useEffect(() => {
    const target = getTargetMode();
    if (target !== modeRef.current) {
      subscribe(target);
    }
  }, [isNavigating, getTargetMode, subscribe]);

  // Start
  const start = useCallback(async () => {
    const mode = getTargetMode();
    await subscribe(mode);
  }, [getTargetMode, subscribe]);

  const stop = useCallback(() => {
    subRef.current?.remove();
    subRef.current = null;
  }, []);

  const currentMode = (): GPSMode => modeRef.current;

  return { start, stop, currentMode };
}