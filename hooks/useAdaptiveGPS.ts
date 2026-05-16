import { useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import { haversineKm, maxIdleBrowsingJumpM } from '../scripts/navigationUtils';

export type GPSMode = 'idle' | 'driving' | 'navigating';

interface Options {
  isNavigating: boolean;
  isDriving?:   boolean;
  /** Mapa w focus — bez tego używany jest tryb offMap (oszczędny). */
  isMapFocused?: boolean;
  speedKmh:     number;
  onLocation:   (loc: {
    latitude:  number;
    longitude: number;
    speed:     number | null;
    heading:   number | null;
    accuracy:  number | null;
    /** ms od epoki — do odrzucania cache'owanych fixów po wybudzeniu telefonu */
    timestamp?: number;
  }) => void;
}

const DRIVE_SPEED_KMH  = 5;
const MAX_ACCURACY_M   = 40;
/** W nawigacji / jeździe słabszy fix jest lepszy niż brak ticka (Android). */
const MAX_ACCURACY_ACTIVE_M = 120;
/** Powyżej tego fix jest zwykle bezużyteczny nawet dla active mode. */
const MAX_ACCURACY_ACTIVE_HARD_M = 220;
const MAX_SPEED_IDLE_KMH = 110;
const MAX_SPEED_ACTIVE_KMH = 250;
const ACTIVE_FIX_TIMEOUT_MS = 16000;
const IDLE_FIX_TIMEOUT_MS   = 25000;
/** Nie używaj fallbacku do historycznego fixa, jeśli jest zbyt stary po resume. */
const IDLE_FALLBACK_MAX_AGE_MS = 12000;
/** Przy nowej subskrypcji wyczyść dawno nieaktualny anchor anty-teleportu. */
const LAST_GOOD_STALE_RESET_MS = 45000;

type GpsProfile = 'offMap' | 'browsing' | 'active';

const GPS_CONFIG: Record<GpsProfile, {
  accuracy: Location.Accuracy;
  timeInterval: number;
  distanceInterval: number;
}> = {
  offMap: {
    accuracy:         Location.Accuracy.Balanced,
    timeInterval:     15000,
    distanceInterval: 40,
  },
  browsing: {
    accuracy:         Location.Accuracy.Low,
    timeInterval:     10000,
    distanceInterval: 25,
  },
  active: {
    accuracy:         Location.Accuracy.BestForNavigation,
    timeInterval:     1200,
    distanceInterval: 4,
  },
};

function resolveGpsProfile(
  isMapFocused: boolean,
  isNavigating: boolean,
  isDriving: boolean,
  speedKmh: number,
): GpsProfile {
  if (!isMapFocused) return 'offMap';
  if (isNavigating || isDriving || speedKmh > DRIVE_SPEED_KMH) return 'active';
  return 'browsing';
}

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

export function useAdaptiveGPS({ isNavigating, isDriving, isMapFocused = true, speedKmh, onLocation }: Options) {
  const subRef            = useRef<any>(null);
  const profileRef        = useRef<GpsProfile>('browsing');
  const onLocRef          = useRef(onLocation);
  const speedRef          = useRef(speedKmh);
  const navRef            = useRef(isNavigating);
  const drivingRef        = useRef(isDriving ?? false);
  const mapFocusedRef     = useRef(isMapFocused);

  const lastGoodRef       = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const consecutiveBadRef = useRef(0);
  const lastFixAtRef      = useRef<number>(0);
  const opSeqRef          = useRef(0);

  useEffect(() => { onLocRef.current = onLocation; }, [onLocation]);
  useEffect(() => { speedRef.current = speedKmh;   }, [speedKmh]);
  useEffect(() => { navRef.current   = isNavigating; }, [isNavigating]);
  useEffect(() => { drivingRef.current = isDriving ?? false; }, [isDriving]);
  useEffect(() => { mapFocusedRef.current = isMapFocused; }, [isMapFocused]);

  const subscribe = useCallback(async (profile: GpsProfile) => {
    const opId = ++opSeqRef.current;
    subRef.current?.remove();
    subRef.current = null;
    if (lastGoodRef.current && Date.now() - lastGoodRef.current.time > LAST_GOOD_STALE_RESET_MS) {
      lastGoodRef.current = null;
    }

    const cfg = GPS_CONFIG[profile];
    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy:         cfg.accuracy,
          timeInterval:     cfg.timeInterval,
          distanceInterval: cfg.distanceInterval,
        },
        (loc) => {
          try {
            const now    = Date.now();
            lastFixAtRef.current = now;
            const rawLat = loc.coords.latitude;
            const rawLng = loc.coords.longitude;
            const acc    = loc.coords.accuracy ?? 999;
            if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng) || !Number.isFinite(acc)) {
              return;
            }

          const activeMode = profileRef.current === 'active';
          const speedMs = loc.coords.speed != null && loc.coords.speed >= 0
            ? loc.coords.speed
            : 0;

          // ══ 1. ODRZUĆ skrajnie słaby sygnał GPS ═══════════════
          if (activeMode && acc > MAX_ACCURACY_ACTIVE_HARD_M) {
            consecutiveBadRef.current += 1;
            return;
          }

          const maxAcc = activeMode ? MAX_ACCURACY_ACTIVE_M : MAX_ACCURACY_M;
          if (acc > maxAcc) {
            consecutiveBadRef.current += 1;
            if (!activeMode && consecutiveBadRef.current >= 5 && lastGoodRef.current) {
              const fallbackAgeMs = now - lastGoodRef.current.time;
              if (fallbackAgeMs > IDLE_FALLBACK_MAX_AGE_MS) {
                return;
              }
              onLocRef.current({
                latitude:  lastGoodRef.current.lat,
                longitude: lastGoodRef.current.lng,
                speed:     0,
                heading:   loc.coords.heading,
                accuracy:  acc,
                timestamp: now,
              });
            }
            if (activeMode) {
              // During driving/navigation never freeze on stale lastGood fallback.
              // Forward weaker fixes; downstream map.tsx pipeline applies its own
              // anti-teleport guards and snapping.
              lastGoodRef.current = { lat: rawLat, lng: rawLng, time: now };
              speedRef.current    = speedMs * 3.6;
              onLocRef.current({
                latitude:  rawLat,
                longitude: rawLng,
                speed:     speedMs,
                heading:   loc.coords.heading,
                accuracy:  acc,
                timestamp: now,
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
            const maxJumpKmh = (navRef.current || drivingRef.current)
              ? MAX_SPEED_ACTIVE_KMH
              : MAX_SPEED_IDLE_KMH;
            if (jumpKmh > maxJumpKmh) {
              console.warn(`[GPS] Skok odrzucony: ${Math.round(jumpKmh)} km/h`);
              return;
            }

            // Additional absolute-distance cap: when the phone is slow or stationary
            // a medium-sized GPS drift (e.g. 200 m over 30 s = only 24 km/h) passes
            // the speed check but is still a bad fix. Cap allowed distance to
            // 3× the expected travel distance + 100 m headroom (floor: 100 m).
            const distM    = haversineKm(lastGoodRef.current.lat, lastGoodRef.current.lng, rawLat, rawLng) * 1000;
            // In idle mode don't trust stale/high speed carry-over for distance cap.
            const baselineKmh = activeMode
              ? Math.min(Math.max(speedRef.current, speedMs * 3.6), 220)
              : Math.min(speedRef.current, 6);
            const expectedM = (baselineKmh / 3.6) * (dtMs / 1000);
            let maxDistM  = activeMode
              ? Math.max(220, expectedM * 4 + 180)
              : Math.max(70, expectedM * 2 + 70);
            if (!activeMode) {
              const reportedKmh = speedMs * 3.6;
              maxDistM = Math.min(maxDistM, maxIdleBrowsingJumpM(dtMs, reportedKmh, acc));
            }
            if (distM > maxDistM) {
              console.warn(`[GPS] Skok dystansowy odrzucony: ${Math.round(distM)}m > ${Math.round(maxDistM)}m`);
              return;
            }
          }

          // ══ 3. Prędkość — TYLKO z GPS coords, bez obliczania ═
          // Podczas nawigacji nigdy nie obliczamy prędkości ze skoków
          // bo to właśnie powoduje teleportowanie markera
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
            timestamp: activeMode ? now : loc.timestamp,
          });

          // ══ 6. Auto-upgrade browsing → active ════════════════
          // NEVER call subscribe() synchronously from this callback — removing the
          // current watch while its handler runs crashes native Expo Location on Android.
            const nextProfile = resolveGpsProfile(
              mapFocusedRef.current,
              navRef.current,
              drivingRef.current,
              speedMs * 3.6,
            );
            if (nextProfile === 'active' && profileRef.current !== 'active') {
              setTimeout(() => {
                void subscribe('active');
              }, 0);
            }
          } catch (e) {
            console.warn('useAdaptiveGPS location callback error:', e);
          }
        },
      );
      if (opId !== opSeqRef.current) {
        sub.remove();
        return;
      }
      subRef.current      = sub;
      profileRef.current  = profile;
      lastFixAtRef.current = Date.now();
    } catch (e) {
      console.warn('useAdaptiveGPS subscribe error:', e);
    }
  }, []);

  const currentProfile = useCallback((): GpsProfile => {
    return resolveGpsProfile(
      mapFocusedRef.current,
      navRef.current,
      drivingRef.current,
      speedRef.current,
    );
  }, []);

  useEffect(() => {
    const next = resolveGpsProfile(isMapFocused, isNavigating, isDriving ?? false, speedKmh);
    if (next !== profileRef.current) {
      subscribe(next);
    }
  }, [isNavigating, isDriving, isMapFocused, speedKmh, subscribe]);

  const start = useCallback(async () => {
    await subscribe(currentProfile());
  }, [currentProfile, subscribe]);

  const stop = useCallback(() => {
    opSeqRef.current += 1;
    subRef.current?.remove();
    subRef.current = null;
    // Intentionally keep lastGoodRef: clearing it made the first post-restart
    // watch callback skip teleport checks. Stale fused fixes then slipped through
    // before map.tsx had a chance to anchor against the previous position.
    // Zeruj prędkość — inaczej „zapamiętana” prędkość z autostrady poszerza
    // limit dystansu przy pierwszym fixie po wznowieniu (fałszywy teleport).
    speedRef.current = 0;
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!subRef.current) return;
      const timeoutMs = profileRef.current === 'active'
        ? ACTIVE_FIX_TIMEOUT_MS
        : IDLE_FIX_TIMEOUT_MS;
      if (Date.now() - lastFixAtRef.current < timeoutMs) return;
      lastFixAtRef.current = Date.now();
      subscribe(currentProfile());
    }, 10000);
    return () => clearInterval(id);
  }, [currentProfile, subscribe]);

  return { start, stop };
}