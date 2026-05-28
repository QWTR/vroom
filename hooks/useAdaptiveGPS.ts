import { useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import { haversineKm } from '../scripts/navigationUtils';
import { logTelemetry } from '../lib/telemetryLogger';

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
const MAX_ACCURACY_BROWSING_M = 140;
/** W nawigacji / jeździe słabszy fix jest lepszy niż brak ticka (Android). */
const MAX_ACCURACY_ACTIVE_M = 220;
/** Powyżej tego fix jest zwykle bezużyteczny nawet dla active mode. */
const MAX_ACCURACY_ACTIVE_HARD_M = 500;
const MAX_SPEED_ACTIVE_KMH = 360;
const ACTIVE_FIX_TIMEOUT_MS = 10000;
const IDLE_FIX_TIMEOUT_MS   = 22000;
const WATCHDOG_CHECK_MS = 8000;
const ACTIVE_STALE_STRIKES_BEFORE_RESUBSCRIBE = 1;
/** Przy nowej subskrypcji wyczyść dawno nieaktualny anchor anty-teleportu. */
const LAST_GOOD_STALE_RESET_MS = 45000;
const GPS_DEBUG_LOGS = false;
const DERIVED_SPEED_MIN_DT_MS = 900;
const DERIVED_SPEED_MIN_EMIT_KMH = 2;
/** Min gap between forwarded fixes in active mode (native stream ~100 ms). */
const ACTIVE_EMIT_MIN_INTERVAL_MS = 30;
/** Highway: denser emit gate (20–50 Hz devices) — do not starve map.tsx at 90+ km/h. */
const ACTIVE_EMIT_MIN_INTERVAL_FAST_MS = 20;
const HIGHWAY_EMIT_SPEED_KMH = 45;
/** Po dłuższej ciszy zawsze przepuść fix — inaczej map.tsx nie dostaje ticków. */
const ACTIVE_FORCE_EMIT_GAP_MS = 200;
const ACTIVE_EMIT_MIN_HEADING_DELTA = 6;

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
    timeInterval:     3000,
    distanceInterval: 10,
  },
  active: {
    accuracy:         Location.Accuracy.BestForNavigation,
    /** Maks. agresja — OS co ~100 ms (lub szybciej), distance 0 = każdy fix. */
    timeInterval:     100,
    distanceInterval: 0,
  },
};

function resolveGpsProfile(
  isMapFocused: boolean,
  isNavigating: boolean,
  isDriving: boolean,
  speedKmh: number,
  forceActive: boolean,
): GpsProfile {
  if (isNavigating || isDriving || forceActive || speedKmh > DRIVE_SPEED_KMH) return 'active';
  if (!isMapFocused) return 'offMap';
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
            const emitGapMs = lastEmit ? nowMs - lastEmit.at : ACTIVE_FORCE_EMIT_GAP_MS;
            const fallbackDerivedKmh = lastEmit
              ? (
                (haversineKm(lastEmit.lat, lastEmit.lng, payload.latitude, payload.longitude) * 1000)
                / Math.max(emitGapMs / 1000, 0.05)
              ) * 3.6
              : 0;
            const isFast = activeMode && (
              effectiveSpeedKmh >= HIGHWAY_EMIT_SPEED_KMH
              || fallbackDerivedKmh >= HIGHWAY_EMIT_SPEED_KMH
            );
            const minInterval = isFast
              ? ACTIVE_EMIT_MIN_INTERVAL_FAST_MS
              : ACTIVE_EMIT_MIN_INTERVAL_MS;
            const prevHeading = lastEmit?.heading ?? null;
            const nextHeading = payload.heading;
            const headingDelta =
              prevHeading != null && nextHeading != null && Number.isFinite(prevHeading) && Number.isFinite(nextHeading)
                ? Math.abs((((nextHeading - prevHeading) + 540) % 360) - 180)
                : 0;
            const headingWake = activeMode && headingDelta >= ACTIVE_EMIT_MIN_HEADING_DELTA;
            const forceStaleGap = activeMode && emitGapMs >= ACTIVE_FORCE_EMIT_GAP_MS;
            if (!force && !forceStaleGap && !headingWake && emitGapMs < minInterval) {
              return;
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
          if (activeMode) {
            if (acc > MAX_ACCURACY_ACTIVE_HARD_M) {
              void logTelemetry('GPS_REJECT_ACCURACY_HARD', {
                acc: Math.round(acc),
                maxAcc: MAX_ACCURACY_ACTIVE_HARD_M,
                lat: Number(rawLat.toFixed(6)),
                lng: Number(rawLng.toFixed(6)),
              });
              return;
            }
          } else if (acc > MAX_ACCURACY_BROWSING_M && effectiveSpeedKmh < 3) {
            void logTelemetry('GPS_REJECT_ACCURACY_BROWSING', {
              acc: Math.round(acc),
              maxAcc: MAX_ACCURACY_BROWSING_M,
              speedKmh: Number(effectiveSpeedKmh.toFixed(1)),
            });
            return;
          }
          if (!activeMode && acc > MAX_ACCURACY_ACTIVE_M && consecutiveBadRef.current >= 6) {
            lastGoodRef.current = null;
          }
          consecutiveBadRef.current = 0;

          // ══ 2. SANITY CHECK — odrzuć teleport ════════════════
          if (lastGoodRef.current) {
            const dtMs    = now - lastGoodRef.current.time;
            const distM    = haversineKm(lastGoodRef.current.lat, lastGoodRef.current.lng, rawLat, rawLng) * 1000;
            const hardTeleportM = Math.max(
              1500,
              ((Math.max(effectiveSpeedKmh, 20) / 3.6) * (Math.max(dtMs, 1000) / 1000)) * 8,
            );
            if (distM > hardTeleportM) {
              if (GPS_DEBUG_LOGS) {
                console.warn(`[GPS] Hard teleport reject: ${Math.round(distM)}m > ${Math.round(hardTeleportM)}m`);
              }
              void logTelemetry('GPS_REJECT_HARD_TELEPORT', {
                distM: Math.round(distM),
                hardTeleportM: Math.round(hardTeleportM),
                dtMs,
                acc: Math.round(acc),
              });
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
          void logTelemetry('GPS_ACCEPT', {
            lat: Number(rawLat.toFixed(6)),
            lng: Number(rawLng.toFixed(6)),
            acc: Math.round(acc),
            speedKmh: Number(effectiveSpeedKmh.toFixed(1)),
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