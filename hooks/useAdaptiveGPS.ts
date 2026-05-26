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
  /** Wcześniejszy profil active (ruch wykryty, zanim state speed dogoni). */
  forceActive?: boolean;
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

const DRIVE_SPEED_KMH  = 6;
/** W przeglądaniu mapy telefon często podaje 50–90 m — 40 m odcinała wszystkie ticki (stojący marker). */
const MAX_ACCURACY_BROWSING_M = 100;
/** W nawigacji / jeździe słabszy fix jest lepszy niż brak ticka (Android). */
const MAX_ACCURACY_ACTIVE_M = 100;
/** Powyżej tego fix jest zwykle bezużyteczny nawet dla active mode. */
const MAX_ACCURACY_ACTIVE_HARD_M = 240;
const MAX_SPEED_IDLE_KMH = 110;
const MAX_SPEED_ACTIVE_KMH = 360;
const ACTIVE_FIX_TIMEOUT_MS = 16000;
const IDLE_FIX_TIMEOUT_MS   = 22000;
const WATCHDOG_CHECK_MS = 8000;
const ACTIVE_STALE_STRIKES_BEFORE_RESUBSCRIBE = 1;
/** Przy nowej subskrypcji wyczyść dawno nieaktualny anchor anty-teleportu. */
const LAST_GOOD_STALE_RESET_MS = 45000;
const GPS_DEBUG_LOGS = false;
const DERIVED_SPEED_MIN_DT_MS = 900;
const DERIVED_SPEED_MIN_EMIT_KMH = 2;
const ACTIVE_EMIT_MIN_INTERVAL_MS = 140;
const BROWSING_EMIT_MIN_INTERVAL_MS = 700;
const ACTIVE_EMIT_MIN_MOVE_M = 0.9;
const BROWSING_EMIT_MIN_MOVE_M = 4.5;
const ACTIVE_EMIT_MIN_HEADING_DELTA = 9;

type GpsProfile = 'offMap' | 'browsing' | 'active';

const GPS_CONFIG: Record<GpsProfile, {
  accuracy: Location.Accuracy;
  timeInterval: number;
  distanceInterval: number;
}> = {
  offMap: {
    accuracy:         Location.Accuracy.Balanced,
    timeInterval:     25000,
    distanceInterval: 80,
  },
  browsing: {
    accuracy:         Location.Accuracy.Balanced,
    timeInterval:     2000,
    distanceInterval: 6,
  },
  active: {
    accuracy:         Location.Accuracy.BestForNavigation,
    // Active driving needs live GPS; render pressure is controlled in map.tsx, not by starving GPS.
    timeInterval:     500,
    distanceInterval: 1,
  },
};

function resolveGpsProfile(
  _isMapFocused: boolean,
  isNavigating: boolean,
  isDriving: boolean,
  speedKmh: number,
  forceActive: boolean,
): GpsProfile {
  // Map screen stays mounted (lazy:false) — keep browsing GPS alive on other tabs
  // instead of throttling to offMap (25s), which caused stale anchors after tab switches.
  if (isNavigating || isDriving || forceActive || speedKmh > DRIVE_SPEED_KMH) return 'active';
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

export function useAdaptiveGPS({
  isNavigating,
  isDriving,
  isMapFocused = true,
  speedKmh,
  forceActive = false,
  onLocation,
}: Options) {
  const subRef            = useRef<any>(null);
  const profileRef        = useRef<GpsProfile>('browsing');
  const onLocRef          = useRef(onLocation);
  const speedRef          = useRef(speedKmh);
  const navRef            = useRef(isNavigating);
  const drivingRef        = useRef(isDriving ?? false);
  const mapFocusedRef     = useRef(isMapFocused);
  const forceActiveRef    = useRef(forceActive);

  const lastGoodRef       = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const consecutiveBadRef = useRef(0);
  const lastFixAtRef      = useRef<number>(0);
  const staleStrikeRef    = useRef(0);
  const opSeqRef          = useRef(0);
  const lastPoorActiveEmitAtRef = useRef(0);
  const lastEmitRef = useRef<{
    at: number;
    lat: number;
    lng: number;
    heading: number | null;
  } | null>(null);

  useEffect(() => { onLocRef.current = onLocation; }, [onLocation]);
  useEffect(() => { speedRef.current = speedKmh;   }, [speedKmh]);
  useEffect(() => { navRef.current   = isNavigating; }, [isNavigating]);
  useEffect(() => { drivingRef.current = isDriving ?? false; }, [isDriving]);
  useEffect(() => { mapFocusedRef.current = isMapFocused; }, [isMapFocused]);
  useEffect(() => { forceActiveRef.current = forceActive; }, [forceActive]);

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
            staleStrikeRef.current = 0;
            const rawLat = loc.coords.latitude;
            const rawLng = loc.coords.longitude;
            const acc    = loc.coords.accuracy ?? 999;
            if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng) || !Number.isFinite(acc)) {
              return;
            }

          const activeMode = profileRef.current === 'active';
          const gpsSpeedMs = loc.coords.speed != null && loc.coords.speed >= 0
            ? loc.coords.speed
            : null;
          const speedMs = gpsSpeedMs ?? 0;
          let derivedSpeedKmh = 0;
          if (lastGoodRef.current) {
            const dtMs = now - lastGoodRef.current.time;
            if (dtMs >= DERIVED_SPEED_MIN_DT_MS) {
              derivedSpeedKmh = calcSpeedKmh(
                lastGoodRef.current.lat,
                lastGoodRef.current.lng,
                rawLat,
                rawLng,
                dtMs,
              );
            }
          }
          const effectiveSpeedKmh = Math.max(
            speedMs * 3.6,
            Math.min(Math.max(0, derivedSpeedKmh), MAX_SPEED_ACTIVE_KMH),
          );
          const emitSpeedMs = gpsSpeedMs != null
            ? gpsSpeedMs
            : (effectiveSpeedKmh >= DERIVED_SPEED_MIN_EMIT_KMH ? effectiveSpeedKmh / 3.6 : 0);
          const maybeEmitLocation = (payload: {
            latitude: number;
            longitude: number;
            speed: number | null;
            heading: number | null;
            accuracy: number | null;
            timestamp?: number;
          }, force = false) => {
            const nowMs = now;
            const lastEmit = lastEmitRef.current;
            if (!force && lastEmit) {
              const activeMinInterval = activeMode ? ACTIVE_EMIT_MIN_INTERVAL_MS : BROWSING_EMIT_MIN_INTERVAL_MS;
              const dt = nowMs - lastEmit.at;
              const movedM = haversineKm(lastEmit.lat, lastEmit.lng, payload.latitude, payload.longitude) * 1000;
              const minMoveM = activeMode ? ACTIVE_EMIT_MIN_MOVE_M : BROWSING_EMIT_MIN_MOVE_M;
              const prevHeading = lastEmit.heading;
              const nextHeading = payload.heading;
              const headingDelta =
                prevHeading != null && nextHeading != null && Number.isFinite(prevHeading) && Number.isFinite(nextHeading)
                  ? Math.abs((((nextHeading - prevHeading) + 540) % 360) - 180)
                  : 0;
              const headingWake =
                activeMode
                && effectiveSpeedKmh >= 8
                && headingDelta >= ACTIVE_EMIT_MIN_HEADING_DELTA;
              if (dt < activeMinInterval && movedM < minMoveM && !headingWake) {
                return;
              }
            }
            lastEmitRef.current = {
              at: nowMs,
              lat: payload.latitude,
              lng: payload.longitude,
              heading: payload.heading,
            };
            onLocRef.current(payload);
          };

          // ══ 1. ODRZUĆ skrajnie słaby sygnał GPS ═══════════════
          if (activeMode && acc > MAX_ACCURACY_ACTIVE_HARD_M) {
            // Very poor active fixes are allowed only occasionally to avoid
            // marker drift from low-quality network locations.
            const nowMs = now;
            if (nowMs - lastPoorActiveEmitAtRef.current < 4500) {
              return;
            }
            lastPoorActiveEmitAtRef.current = nowMs;
            consecutiveBadRef.current += 1;
            lastGoodRef.current = { lat: rawLat, lng: rawLng, time: now };
            speedRef.current    = effectiveSpeedKmh;
            maybeEmitLocation({
              latitude:  rawLat,
              longitude: rawLng,
              speed:     emitSpeedMs,
              heading:   loc.coords.heading,
              accuracy:  acc,
              timestamp: now,
            });
            return;
          }

          const maxAcc = activeMode ? MAX_ACCURACY_ACTIVE_M : MAX_ACCURACY_BROWSING_M;
          if (acc > maxAcc) {
            consecutiveBadRef.current += 1;
            if (!activeMode && consecutiveBadRef.current >= 6) {
              // Reset poisoned anchor so the next acceptable fix can through.
              lastGoodRef.current = null;
            }
            const forwardWeakBrowsing =
              !activeMode
              && mapFocusedRef.current
              && (effectiveSpeedKmh >= 4 || derivedSpeedKmh >= 4);
            if (activeMode || forwardWeakBrowsing) {
              lastGoodRef.current = { lat: rawLat, lng: rawLng, time: now };
              speedRef.current    = effectiveSpeedKmh;
              maybeEmitLocation({
                latitude:  rawLat,
                longitude: rawLng,
                speed:     emitSpeedMs,
                heading:   loc.coords.heading,
                accuracy:  acc,
                timestamp: loc.timestamp ?? now,
              });
            }
            if (!activeMode && !forwardWeakBrowsing) return;
            if (activeMode) return;
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
              if (GPS_DEBUG_LOGS) {
                console.warn(`[GPS] Skok odrzucony: ${Math.round(jumpKmh)} km/h`);
              }
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
              maxDistM = Math.min(
                maxDistM,
                maxIdleBrowsingJumpM(dtMs, reportedKmh, acc, effectiveSpeedKmh),
              );
            }
            if (distM > maxDistM) {
              if (GPS_DEBUG_LOGS) {
                console.warn(`[GPS] Skok dystansowy odrzucony: ${Math.round(distM)}m > ${Math.round(maxDistM)}m`);
              }
              return;
            }
          }

          // ══ 3. Prędkość — TYLKO z GPS coords, bez obliczania ═
          // Podczas nawigacji nigdy nie obliczamy prędkości ze skoków
          // bo to właśnie powoduje teleportowanie markera
          // ══ 4. Aktualizuj lastGoodRef ════════════════════════
          lastGoodRef.current = { lat: rawLat, lng: rawLng, time: now };
          speedRef.current    = effectiveSpeedKmh;

          // ══ 5. Wyślij surowe dane — Kalman jest w map.tsx ════
          maybeEmitLocation({
            latitude:  rawLat,
            longitude: rawLng,
            speed:     emitSpeedMs,
            heading:   loc.coords.heading,
            accuracy:  acc,
            timestamp: loc.timestamp ?? now,
          });

          // ══ 6. Auto-upgrade browsing → active ════════════════
          // NEVER call subscribe() synchronously from this callback — removing the
          // current watch while its handler runs crashes native Expo Location on Android.
            const nextProfile = resolveGpsProfile(
              mapFocusedRef.current,
              navRef.current,
              drivingRef.current,
              effectiveSpeedKmh,
              forceActiveRef.current,
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
      forceActiveRef.current,
    );
  }, []);

  useEffect(() => {
    const next = resolveGpsProfile(
      isMapFocused,
      isNavigating,
      isDriving ?? false,
      speedKmh,
      forceActive,
    );
    if (next !== profileRef.current) {
      subscribe(next);
    }
  }, [isNavigating, isDriving, isMapFocused, speedKmh, forceActive, subscribe]);

  const start = useCallback(async () => {
    const profile =
      navRef.current || drivingRef.current || forceActiveRef.current
        ? 'active'
        : currentProfile();
    await subscribe(profile);
  }, [currentProfile, subscribe]);

  const stop = useCallback(() => {
    opSeqRef.current += 1;
    subRef.current?.remove();
    subRef.current = null;
    staleStrikeRef.current = 0;
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
      const staleForMs = Date.now() - lastFixAtRef.current;
      if (staleForMs < timeoutMs) {
        staleStrikeRef.current = 0;
        return;
      }
      const requiredStrikes = profileRef.current === 'active'
        ? ACTIVE_STALE_STRIKES_BEFORE_RESUBSCRIBE
        : 1;
      staleStrikeRef.current += 1;
      if (staleStrikeRef.current < requiredStrikes) return;
      staleStrikeRef.current = 0;
      lastFixAtRef.current = Date.now();
      subscribe(currentProfile());
    }, WATCHDOG_CHECK_MS);
    return () => clearInterval(id);
  }, [currentProfile, subscribe]);

  return { start, stop };
}