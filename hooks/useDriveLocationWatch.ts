import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { haversineKm } from '../scripts/navigationUtils';
import { logTelemetry } from '../lib/telemetryLogger';
import {
  createGpsLockState,
  resetGpsLockState,
  shouldEmitLocationFix,
  updateGpsLock,
  type GpsLockState,
} from '../lib/driveLocation/gpsLock';
import {
  GPS_LAYER_A_ACTIVE_REJECT_ACC_M,
  isActiveLayerATeleport,
} from '../lib/driveCore/gpsQualityGate';

export type DriveLocationFix = {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  timestamp?: number;
};

export type GPSMode = 'idle' | 'driving' | 'navigating';

interface Options {
  isNavigating: boolean;
  isDriving?: boolean;
  isMapFocused?: boolean;
  speedKmh: number;
  forceActive?: boolean;
  onLocation: (loc: DriveLocationFix) => void;
  onGpsLockChange?: (locked: boolean) => void;
}

const DRIVE_SPEED_KMH = 6;
const MAX_ACCURACY_BROWSING_M = 140;
const MAX_ACCURACY_ACTIVE_M = 220;
const MAX_ACCURACY_ACTIVE_HARD_M = GPS_LAYER_A_ACTIVE_REJECT_ACC_M;
const MAX_SPEED_ACTIVE_KMH = 360;
const ACTIVE_FIX_TIMEOUT_MS = 10000;
const IDLE_FIX_TIMEOUT_MS = 22000;
const WATCHDOG_CHECK_MS = 8000;
const ACTIVE_STALE_STRIKES_BEFORE_RESUBSCRIBE = 1;
const LAST_GOOD_STALE_RESET_MS = 45000;
const GPS_DEBUG_LOGS = false;
const DERIVED_SPEED_MIN_DT_MS = 900;
const DERIVED_SPEED_MIN_EMIT_KMH = 2;
/** Mniej callbacków onLocation na main thread (UI freeze przy 20–30 ms). */
const ACTIVE_EMIT_MIN_INTERVAL_MS = 55;
const ACTIVE_EMIT_MIN_INTERVAL_FAST_MS = 40;
const HIGHWAY_EMIT_SPEED_KMH = 45;
const ACTIVE_FORCE_EMIT_GAP_MS = 200;
const ACTIVE_EMIT_MIN_HEADING_DELTA = 6;
const ACTIVE_DISTANCE_INTERVAL_M = 3;

type GpsProfile = 'offMap' | 'browsing' | 'active';

const GPS_CONFIG: Record<GpsProfile, {
  accuracy: Location.Accuracy;
  timeInterval: number;
  distanceInterval: number;
}> = {
  offMap: {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 25000,
    distanceInterval: 80,
  },
  browsing: {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 3000,
    distanceInterval: 10,
  },
  active: {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 100,
    distanceInterval: ACTIVE_DISTANCE_INTERVAL_M,
  },
};

function buildWatchOptions(profile: GpsProfile): Location.LocationOptions {
  const cfg = GPS_CONFIG[profile];
  const opts: Location.LocationOptions = {
    accuracy: cfg.accuracy,
    timeInterval: cfg.timeInterval,
    distanceInterval: cfg.distanceInterval,
  };
  if (profile === 'active' && Platform.OS === 'ios') {
    opts.activityType = Location.ActivityType.AutomotiveNavigation;
    opts.pausesUpdatesAutomatically = false;
  }
  return opts;
}

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
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLon / 2) ** 2;
  const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (distM / (dtMs / 1000)) * 3.6;
}

export function useDriveLocationWatch({
  isNavigating,
  isDriving,
  isMapFocused = true,
  speedKmh,
  forceActive = false,
  onLocation,
  onGpsLockChange,
}: Options) {
  const subRef = useRef<Location.LocationSubscription | null>(null);
  const profileRef = useRef<GpsProfile>('browsing');
  const onLocRef = useRef(onLocation);
  const onLockRef = useRef(onGpsLockChange);
  const speedRef = useRef(speedKmh);
  const navRef = useRef(isNavigating);
  const drivingRef = useRef(isDriving ?? false);
  const mapFocusedRef = useRef(isMapFocused);
  const forceActiveRef = useRef(forceActive);
  const lockRef = useRef<GpsLockState>(createGpsLockState());

  const lastGoodRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const consecutiveBadRef = useRef(0);
  const lastFixAtRef = useRef<number>(0);
  const staleStrikeRef = useRef(0);
  const opSeqRef = useRef(0);
  const lastEmitRef = useRef<{
    at: number;
    lat: number;
    lng: number;
    heading: number | null;
  } | null>(null);
  const lastGpsRestartAtRef = useRef(0);

  const [gpsLockEstablished, setGpsLockEstablished] = useState(false);
  const gpsLockEstablishedRef = useRef(false);

  useEffect(() => { onLocRef.current = onLocation; }, [onLocation]);
  useEffect(() => { onLockRef.current = onGpsLockChange; }, [onGpsLockChange]);
  useEffect(() => { speedRef.current = speedKmh; }, [speedKmh]);
  useEffect(() => { navRef.current = isNavigating; }, [isNavigating]);
  useEffect(() => { drivingRef.current = isDriving ?? false; }, [isDriving]);
  useEffect(() => { mapFocusedRef.current = isMapFocused; }, [isMapFocused]);
  useEffect(() => { forceActiveRef.current = forceActive; }, [forceActive]);

  const applyLockState = useCallback((locked: boolean) => {
    if (gpsLockEstablishedRef.current === locked) return;
    gpsLockEstablishedRef.current = locked;
    setGpsLockEstablished(locked);
    onLockRef.current?.(locked);
    if (locked) {
      void logTelemetry('GPS_LOCK_ACQUIRED', { at: Date.now() });
      if (__DEV__) console.log('[GPSDBG] GPS_LOCK_ACQUIRED', JSON.stringify({ at: Date.now() }));
    }
  }, []);

  const subscribe = useCallback(async (profile: GpsProfile, resetLock = false) => {
    const opId = ++opSeqRef.current;
    subRef.current?.remove();
    subRef.current = null;
    if (resetLock) {
      resetGpsLockState(lockRef.current);
      applyLockState(false);
    }
    if (lastGoodRef.current && Date.now() - lastGoodRef.current.time > LAST_GOOD_STALE_RESET_MS) {
      lastGoodRef.current = null;
    }

    try {
      const sub = await Location.watchPositionAsync(
        buildWatchOptions(profile),
        (loc) => {
          try {
            const now = Date.now();
            lastFixAtRef.current = now;
            staleStrikeRef.current = 0;
            const rawLat = loc.coords.latitude;
            const rawLng = loc.coords.longitude;
            const acc = loc.coords.accuracy ?? 999;
            if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng) || !Number.isFinite(acc)) {
              return;
            }

            const activeMode = profileRef.current === 'active';
            if (activeMode) {
              const justLocked = updateGpsLock(lockRef.current, acc, now);
              if (justLocked) applyLockState(true);
              if (!shouldEmitLocationFix(lockRef.current, acc)) {
                void logTelemetry('GPS_REJECT_PRELOCK_ACCURACY', {
                  acc: Math.round(acc),
                  lat: Number(rawLat.toFixed(6)),
                  lng: Number(rawLng.toFixed(6)),
                });
                return;
              }
            }

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

            const maybeEmitLocation = (
              payload: DriveLocationFix,
              force = false,
            ) => {
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
                prevHeading != null && nextHeading != null
                && Number.isFinite(prevHeading) && Number.isFinite(nextHeading)
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

            if (activeMode) {
              if (acc > MAX_ACCURACY_ACTIVE_HARD_M) {
                void logTelemetry('GPS_REJECT_ACCURACY_ACTIVE', {
                  acc: Math.round(acc),
                  maxAcc: MAX_ACCURACY_ACTIVE_HARD_M,
                  lat: Number(rawLat.toFixed(6)),
                  lng: Number(rawLng.toFixed(6)),
                });
                return;
              }
              if (lastGoodRef.current) {
                const dtMs = now - lastGoodRef.current.time;
                const distM =
                  haversineKm(lastGoodRef.current.lat, lastGoodRef.current.lng, rawLat, rawLng)
                  * 1000;
                if (isActiveLayerATeleport(distM, dtMs)) {
                  void logTelemetry('GPS_REJECT_ACTIVE_TELEPORT', {
                    distM: Math.round(distM),
                    dtMs,
                    acc: Math.round(acc),
                  });
                  return;
                }
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

            if (lastGoodRef.current) {
              const dtMs = now - lastGoodRef.current.time;
              const distM = haversineKm(
                lastGoodRef.current.lat, lastGoodRef.current.lng, rawLat, rawLng,
              ) * 1000;
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

            lastGoodRef.current = { lat: rawLat, lng: rawLng, time: now };
            speedRef.current = effectiveSpeedKmh;

            maybeEmitLocation({
              latitude: rawLat,
              longitude: rawLng,
              speed: emitSpeedMs,
              heading: loc.coords.heading,
              accuracy: acc,
              timestamp: loc.timestamp ?? now,
            });
            void logTelemetry('GPS_ACCEPT', {
              lat: Number(rawLat.toFixed(6)),
              lng: Number(rawLng.toFixed(6)),
              acc: Math.round(acc),
              speedKmh: Number(effectiveSpeedKmh.toFixed(1)),
              gpsLock: lockRef.current.established,
            });

            const nextProfile = resolveGpsProfile(
              mapFocusedRef.current,
              navRef.current,
              drivingRef.current,
              effectiveSpeedKmh,
              forceActiveRef.current,
            );
            if (nextProfile === 'active' && profileRef.current !== 'active') {
              setTimeout(() => {
                void subscribe('active', true);
              }, 0);
            }
          } catch (e) {
            console.warn('useDriveLocationWatch location callback error:', e);
          }
        },
      );
      if (opId !== opSeqRef.current) {
        sub.remove();
        return;
      }
      subRef.current = sub;
      profileRef.current = profile;
      lastFixAtRef.current = Date.now();
    } catch (e) {
      console.warn('useDriveLocationWatch subscribe error:', e);
    }
  }, [applyLockState]);

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
      const resetLock = next === 'active' && profileRef.current !== 'active';
      void subscribe(next, resetLock);
    }
  }, [isNavigating, isDriving, isMapFocused, speedKmh, forceActive, subscribe]);

  const start = useCallback(async () => {
    const profile =
      navRef.current || drivingRef.current || forceActiveRef.current
        ? 'active'
        : currentProfile();
    await subscribe(profile, profile === 'active');
  }, [currentProfile, subscribe]);

  const stop = useCallback(() => {
    opSeqRef.current += 1;
    subRef.current?.remove();
    subRef.current = null;
    staleStrikeRef.current = 0;
    speedRef.current = 0;
    lastEmitRef.current = null;
  }, []);

  const hardRestart = useCallback(async (reason: string) => {
    void logTelemetry('GPS_RESUME_HARD_RESTART', { reason, at: Date.now() });
    if (__DEV__) console.log('[GPSDBG] GPS_RESUME_HARD_RESTART', JSON.stringify({ reason, at: Date.now() }));
    lastGpsRestartAtRef.current = Date.now();
    stop();
    resetGpsLockState(lockRef.current);
    applyLockState(false);
    lastEmitRef.current = null;
    speedRef.current = 0;
    await subscribe('active', true);
  }, [stop, subscribe, applyLockState]);

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
      void subscribe(currentProfile(), profileRef.current === 'active');
    }, WATCHDOG_CHECK_MS);
    return () => clearInterval(id);
  }, [currentProfile, subscribe]);

  return {
    start,
    stop,
    hardRestart,
    gpsLockEstablished,
    gpsLockEstablishedRef,
  };
}
