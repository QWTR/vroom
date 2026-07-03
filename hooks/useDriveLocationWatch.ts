import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { haversineKm } from '../scripts/navigationUtils';
import { BG_GPS_STATIONARY_KEY } from './useBackgroundTracking';
import { logTelemetry } from '../lib/telemetryLogger';
import {
  createGpsLockState,
  resetGpsLockState,
  seedGpsLockEstablished,
  shouldEmitLocationFix,
  updateGpsLock,
  type GpsLockState,
} from '../lib/driveLocation/gpsLock';
import {
  GPS_LAYER_A_ACTIVE_REJECT_ACC_M,
  isActiveLayerATeleport,
} from '../lib/driveCore/gpsQualityGate';
import {
  ACTIVE_STALE_MS,
  computeGpsRestartBackoffMs,
  IDLE_STALE_MS,
  WATCHDOG_POLL_MS,
} from '../lib/driveLocation/gpsWatchdog';

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
/** Poniżej tej prędkości liczymy postój (korek, parking). */
const STATIONARY_SPEED_KMH = 3;
/** Czas postoju zanim obniżymy profil GPS z activeDrive. */
const STATIONARY_HOLD_MS = 45_000;
const MAX_ACCURACY_BROWSING_M = 140;
const MAX_ACCURACY_ACTIVE_M = 220;
const MAX_ACCURACY_ACTIVE_HARD_M = GPS_LAYER_A_ACTIVE_REJECT_ACC_M;
const MAX_SPEED_ACTIVE_KMH = 360;
export {
  ACTIVE_STALE_MS,
  computeGpsRestartBackoffMs,
  GPS_RESTART_BACKOFF_BASE_MS,
  GPS_RESTART_BACKOFF_MAX_MS,
  IDLE_STALE_MS,
  WATCHDOG_POLL_MS,
} from '../lib/driveLocation/gpsWatchdog';

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

type GpsProfile = 'offMap' | 'browsing' | 'activeDrive' | 'activeNav';

function isActiveGpsProfile(profile: GpsProfile): boolean {
  return profile === 'activeDrive' || profile === 'activeNav';
}

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
  activeDrive: {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 250,
    distanceInterval: 5,
  },
  activeNav: {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 150,
    distanceInterval: 4,
  },
};

function buildWatchOptions(profile: GpsProfile): Location.LocationOptions {
  const cfg = GPS_CONFIG[profile];
  const opts: Location.LocationOptions = {
    accuracy: cfg.accuracy,
    timeInterval: cfg.timeInterval,
    distanceInterval: cfg.distanceInterval,
  };
  if ((profile === 'activeDrive' || profile === 'activeNav') && Platform.OS === 'ios') {
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
  isStationaryParked: boolean,
): GpsProfile {
  if (isNavigating || forceActive) return 'activeNav';
  if (isDriving || speedKmh > DRIVE_SPEED_KMH) {
    if (isDriving && isStationaryParked) return 'browsing';
    return 'activeDrive';
  }
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
  /** Ostatni poprawny fix (po bramkach jakości) — SSOT dla watchdogu. */
  const lastValidFixAtRef = useRef<number>(0);
  const restartAttemptRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opSeqRef = useRef(0);
  const lastEmitRef = useRef<{
    at: number;
    lat: number;
    lng: number;
    heading: number | null;
  } | null>(null);
  const lastGpsRestartAtRef = useRef(0);
  const stationarySinceRef = useRef<number | null>(null);
  const isStationaryParkedRef = useRef(false);

  const [gpsLockEstablished, setGpsLockEstablished] = useState(false);
  const [isStationaryParked, setIsStationaryParked] = useState(false);
  const gpsLockEstablishedRef = useRef(false);

  const applyStationaryState = useCallback((speed: number, now = Date.now()) => {
    if (navRef.current || forceActiveRef.current || !drivingRef.current) {
      stationarySinceRef.current = null;
      if (isStationaryParkedRef.current) {
        isStationaryParkedRef.current = false;
        setIsStationaryParked(false);
        AsyncStorage.setItem(BG_GPS_STATIONARY_KEY, 'false').catch(() => {});
      }
      return;
    }

    if (speed < STATIONARY_SPEED_KMH) {
      if (stationarySinceRef.current == null) stationarySinceRef.current = now;
      const parked = now - stationarySinceRef.current >= STATIONARY_HOLD_MS;
      if (parked !== isStationaryParkedRef.current) {
        isStationaryParkedRef.current = parked;
        setIsStationaryParked(parked);
        AsyncStorage.setItem(BG_GPS_STATIONARY_KEY, parked ? 'true' : 'false').catch(() => {});
      }
      return;
    }

    stationarySinceRef.current = null;
    if (isStationaryParkedRef.current) {
      isStationaryParkedRef.current = false;
      setIsStationaryParked(false);
      AsyncStorage.setItem(BG_GPS_STATIONARY_KEY, 'false').catch(() => {});
    }
  }, []);

  useEffect(() => { onLocRef.current = onLocation; }, [onLocation]);
  useEffect(() => { onLockRef.current = onGpsLockChange; }, [onGpsLockChange]);
  useEffect(() => { speedRef.current = speedKmh; }, [speedKmh]);
  useEffect(() => { navRef.current = isNavigating; }, [isNavigating]);
  useEffect(() => { drivingRef.current = isDriving ?? false; }, [isDriving]);
  useEffect(() => { mapFocusedRef.current = isMapFocused; }, [isMapFocused]);
  useEffect(() => { forceActiveRef.current = forceActive; }, [forceActive]);
  useEffect(() => {
    applyStationaryState(speedKmh);
  }, [speedKmh, isDriving, isNavigating, forceActive, applyStationaryState]);

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

  /**
   * Powrót z tła / cold-start: zasil lock natywnym fixem, aby bramka onLocation
   * od razu przepuszczała fixy z watchera (bez czekania na 2 fixy / timeout 15 s).
   */
  const seedLockFromResume = useCallback(() => {
    seedGpsLockEstablished(lockRef.current);
    applyLockState(true);
  }, [applyLockState]);

  const currentProfile = useCallback((): GpsProfile => {
    return resolveGpsProfile(
      mapFocusedRef.current,
      navRef.current,
      drivingRef.current,
      speedRef.current,
      forceActiveRef.current,
      isStationaryParkedRef.current,
    );
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const teardownSubscription = useCallback(() => {
    clearRestartTimer();
    opSeqRef.current += 1;
    subRef.current?.remove();
    subRef.current = null;
  }, [clearRestartTimer]);

  const markValidFix = useCallback(() => {
    lastValidFixAtRef.current = Date.now();
    restartAttemptRef.current = 0;
  }, []);

  const subscribeRef = useRef<
    (profile: GpsProfile, resetLock?: boolean, reason?: string) => Promise<void>
  >(async () => {});

  const scheduleRestart = useCallback((reason: string) => {
    if (restartTimerRef.current) return;
    const attempt = restartAttemptRef.current;
    const backoffMs = computeGpsRestartBackoffMs(attempt);
    restartAttemptRef.current = attempt + 1;
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      void subscribeRef.current(currentProfile(), isActiveGpsProfile(profileRef.current), reason);
    }, backoffMs);
  }, [currentProfile]);

  const forceResubscribe = useCallback((reason: string) => {
    const staleMs = lastValidFixAtRef.current > 0
      ? Date.now() - lastValidFixAtRef.current
      : -1;
    void logTelemetry('GPS_WATCHDOG_RESTART', {
      reason,
      staleMs: staleMs >= 0 ? Math.round(staleMs) : null,
      attempt: restartAttemptRef.current,
      profile: profileRef.current,
      at: Date.now(),
    });
    if (__DEV__) {
      console.log('[GPSDBG] GPS_WATCHDOG_RESTART', JSON.stringify({
        reason,
        staleMs,
        attempt: restartAttemptRef.current,
        profile: profileRef.current,
      }));
    }
    lastGpsRestartAtRef.current = Date.now();
    teardownSubscription();
    scheduleRestart(reason);
  }, [scheduleRestart, teardownSubscription]);

  const subscribe = useCallback(async (
    profile: GpsProfile,
    resetLock = false,
    reason = 'subscribe',
  ) => {
    clearRestartTimer();
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
            const rawLat = loc.coords.latitude;
            const rawLng = loc.coords.longitude;
            const acc = loc.coords.accuracy ?? 999;
            if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng) || !Number.isFinite(acc)) {
              return;
            }

            const activeMode = isActiveGpsProfile(profileRef.current);
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
            markValidFix();

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

            applyStationaryState(effectiveSpeedKmh, now);

            const nextProfile = resolveGpsProfile(
              mapFocusedRef.current,
              navRef.current,
              drivingRef.current,
              effectiveSpeedKmh,
              forceActiveRef.current,
              isStationaryParkedRef.current,
            );
            if (nextProfile !== profileRef.current) {
              const resetLock = isActiveGpsProfile(nextProfile)
                && !isActiveGpsProfile(profileRef.current);
              setTimeout(() => {
                void subscribeRef.current(nextProfile, resetLock, 'profile_runtime');
              }, 0);
            }
          } catch (e) {
            console.warn('useDriveLocationWatch location callback error:', e);
            forceResubscribe('callback_error');
          }
        },
      );
      if (opId !== opSeqRef.current) {
        sub.remove();
        return;
      }
      subRef.current = sub;
      profileRef.current = profile;
      lastValidFixAtRef.current = Date.now();
      restartAttemptRef.current = 0;
      if (__DEV__ && reason !== 'subscribe') {
        console.log('[GPSDBG] watch subscribed', JSON.stringify({ profile, reason }));
      }
    } catch (e) {
      console.warn('useDriveLocationWatch subscribe error:', e);
      if (isActiveGpsProfile(profile)) {
        applyLockState(false);
      }
      scheduleRestart('subscribe_error');
    }
  }, [
    applyLockState,
    applyStationaryState,
    clearRestartTimer,
    forceResubscribe,
    markValidFix,
    scheduleRestart,
  ]);

  subscribeRef.current = subscribe;

  useEffect(() => {
    const next = resolveGpsProfile(
      isMapFocused,
      isNavigating,
      isDriving ?? false,
      speedKmh,
      forceActive,
      isStationaryParked,
    );
    if (next !== profileRef.current) {
      const resetLock = isActiveGpsProfile(next) && !isActiveGpsProfile(profileRef.current);
      void subscribe(next, resetLock, 'profile_change');
    }
  }, [isNavigating, isDriving, isMapFocused, speedKmh, forceActive, isStationaryParked, subscribe]);

  const start = useCallback(async () => {
    restartAttemptRef.current = 0;
    const profile = navRef.current || forceActiveRef.current
      ? resolveGpsProfile(
        mapFocusedRef.current,
        navRef.current,
        drivingRef.current,
        speedRef.current,
        forceActiveRef.current,
        isStationaryParkedRef.current,
      )
      : currentProfile();
    await subscribe(profile, isActiveGpsProfile(profile), 'start');
  }, [currentProfile, subscribe]);

  const stop = useCallback(() => {
    teardownSubscription();
    speedRef.current = 0;
    lastEmitRef.current = null;
    lastValidFixAtRef.current = 0;
  }, [teardownSubscription]);

  const hardRestart = useCallback(async (reason: string, opts?: { preserveLock?: boolean }) => {
    const preserveLock = opts?.preserveLock === true;
    void logTelemetry('GPS_RESUME_HARD_RESTART', { reason, at: Date.now(), preserveLock });
    if (__DEV__) console.log('[GPSDBG] GPS_RESUME_HARD_RESTART', JSON.stringify({ reason, at: Date.now(), preserveLock }));
    lastGpsRestartAtRef.current = Date.now();
    restartAttemptRef.current = 0;
    teardownSubscription();
    // preserveLock: mamy świeżą pozycję z natywnego bufora — nie zerujemy locka,
    // aby pierwszy przychodzący fix nie został odrzucony (eliminacja freeze po resume).
    if (!preserveLock) {
      resetGpsLockState(lockRef.current);
      applyLockState(false);
    }
    lastEmitRef.current = null;
    speedRef.current = 0;
    await subscribe(navRef.current ? 'activeNav' : 'activeDrive', !preserveLock, `hard_${reason}`);
    if (preserveLock) {
      seedGpsLockEstablished(lockRef.current);
      applyLockState(true);
    }
  }, [subscribe, applyLockState, teardownSubscription]);

  useEffect(() => {
    const id = setInterval(() => {
      const profile = profileRef.current;
      const staleThresholdMs = isActiveGpsProfile(profile)
        ? ACTIVE_STALE_MS
        : IDLE_STALE_MS;
      const now = Date.now();
      const lastValid = lastValidFixAtRef.current;

      if (subRef.current) {
        const staleForMs = lastValid > 0 ? now - lastValid : staleThresholdMs + 1;
        if (staleForMs >= staleThresholdMs) {
          forceResubscribe('watchdog_stale');
        }
        return;
      }

      const desiredProfile = currentProfile();
      if (desiredProfile !== 'offMap' || isActiveGpsProfile(profile)) {
        scheduleRestart('watchdog_no_subscription');
      }
    }, WATCHDOG_POLL_MS);
    return () => clearInterval(id);
  }, [currentProfile, forceResubscribe, scheduleRestart]);

  useEffect(() => () => {
    teardownSubscription();
  }, [teardownSubscription]);

  return {
    start,
    stop,
    hardRestart,
    seedLockFromResume,
    gpsLockEstablished,
    gpsLockEstablishedRef,
  };
}
