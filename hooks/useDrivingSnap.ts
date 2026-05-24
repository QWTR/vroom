import { useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { alignBearingToReference, bearingBetween, distanceToSegmentMeters, haversineKm } from '../scripts/navigationUtils';
import { vroomGpsLog } from '../lib/vroomGpsLog';

// v10 CLIENT-FIRST snap: ciasne radii zeby snap NIGDY nie przeciagal markera
// na sasiednia ulice/budynek. Jesli najblizszy road segment dalej niz radius,
// zwracamy snapped:false (= raw GPS). Validacja po stronie map.tsx zlapuje
// pozostale niewiarygodne snap'y. Konsekwencja: marker zawsze blisko prawdziwej
// pozycji GPS (max ~25-30m offset = szerokosc drogi/pasa), nigdy 90m w bok.
const SNAP_RADIUS_M_BASE    = 22;
const SNAP_RADIUS_M_FAST    = 35;
const SNAP_RADIUS_M_MATCHED = 30;
const SNAP_RADIUS_M_MATCHED_TIER2 = 45;
const SNAP_RADIUS_M_MATCHED_TIER3 = 60;
const SNAP_RADIUS_M_ROUTE_HARD    = 80;
const SNAP_RADIUS_EMERGENCY_M     = 60;
/** HARD LATERAL REJECT: snap dalej niz to od raw GPS = snapped:false (raw). */
const DRIVING_LATERAL_REJECT_M = 25;
const DRIVING_LATERAL_REJECT_MIN_KMH = 25;
const MAX_SNAP_TO_RAW_DISTANCE_M = 60;
const HARD_SNAP_DROP_M = 120;
const MAX_SEGMENT_INDEX_LEAP      = 25;
const MIN_MOVE_DEG          = 0.00002; // ~2m
const SNAP_MAX_JUMP_M       = 45;      // guard against sudden lane/segment jumps
const RAW_FALLBACK_MAX_STEP_M = 30;    // max krok fallbacku gdy chwilowo brak snapa
const IOS_WRONG_ROAD_GUARD_MAX_SPEED_KMH = 26;
const IOS_WRONG_ROAD_GUARD_MIN_JUMP_M = 24;
const IOS_WRONG_ROAD_GUARD_MAX_RAW_MOVE_M = 18;
const IOS_WRONG_ROAD_GUARD_MIN_ACC_M = 18;
const IOS_WRONG_ROAD_GUARD_SEGMENT_LEAP = 14;
const IOS_WRONG_ROAD_GUARD_MAX_HEADING_DELTA = 68;
const IOS_SEGMENT_SWITCH_CONFIRM_HITS = 2;
const IOS_SEGMENT_SWITCH_CONFIRM_WINDOW_MS = 3000;
const IOS_SEGMENT_SWITCH_CONFIRM_RADIUS_M = 32;

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
function angleDeltaDeg(a: number, b: number): number {
  return Math.abs((((a - b) + 540) % 360) - 180);
}

/**
 * v10: Walidacja czy polyline (np. z map-match API albo z queryRenderedFeatures)
 * faktycznie pasuje do raw GPS. Jesli zaden punkt geometrii nie jest blizej
 * niz `maxDistM` od raw GPS, geometria jest dla SASIEDNIEJ drogi — odrzuc ja.
 *
 * Zapobiega scenariuszu z mphg6mph: API zwracalo polyline dla rownoleglej ulicy,
 * snap przeciagal marker 30-70m w bok od raw GPS.
 */
export function validateGeometryAgainstRaw(
  pts: { latitude: number; longitude: number }[],
  rawLat: number,
  rawLng: number,
  maxDistM: number = 35,
): boolean {
  if (!Array.isArray(pts) || pts.length < 2) return false;
  let minDistM = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = haversineKm(rawLat, rawLng, pts[i].latitude, pts[i].longitude) * 1000;
    if (d < minDistM) minDistM = d;
    if (minDistM <= maxDistM) return true;
  }
  return false;
}
/** Max odleglosc snapu od surowego GPS — v10: ciasniej, marker blisko GPS. */
function lateralSnapCapFromAccuracy(accuracyM: number | null | undefined): number {
  const a = accuracyM != null && Number.isFinite(accuracyM) ? Math.max(8, accuracyM) : 20;
  return Math.min(45, Math.max(20, a * 1.5));
}

function clampSnapTowardRaw(
  rawLat: number,
  rawLng: number,
  snapLat: number,
  snapLng: number,
  distM: number,
  maxLateralM: number,
): { latitude: number; longitude: number; distM: number } {
  if (distM <= maxLateralM) {
    return { latitude: snapLat, longitude: snapLng, distM };
  }
  const t = maxLateralM / distM;
  return {
    latitude:  rawLat + (snapLat - rawLat) * t,
    longitude: rawLng + (snapLng - rawLng) * t,
    distM:     maxLateralM,
  };
}

/**
 * Interpolacja kątowa z uwzględnieniem przejścia przez 0°/360°.
 * @param a Start angle in degrees [0, 360)
 * @param b Target angle in degrees [0, 360)
 * @param t Interpolation factor [0, 1] — 0 returns a, 1 returns b
 * @returns Interpolated angle in degrees [0, 360)
 */
function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180;
  return ((a + diff * t) + 360) % 360;
}

interface SnapResult {
  latitude:      number;
  longitude:     number;
  distM:         number;
  segmentIndex:  number;
  segmentBearing: number;
}

/**
 * Snap to the nearest road segment and return snap metadata.
 * @param userLat  User latitude in degrees
 * @param userLng  User longitude in degrees
 * @param pts      Polyline points (road geometry)
 * @param maxRadiusM  Maximum distance in metres — returns null if all segments are farther
 * @returns Snap result with snapped coordinates, distance, and segment bearing; null when too far
 */
function snapToRouteWithInfo(
  userLat: number,
  userLng: number,
  pts: { latitude: number; longitude: number }[],
  maxRadiusM: number,
  opts?: { expectedHeading?: number | null; expectedSegIndex?: number | null },
): SnapResult | null {
  if (pts.length < 2) return null;

  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;

  let minDist      = Infinity;
  let bestScore    = Infinity;
  let bestLat      = userLat;
  let bestLng      = userLng;
  let bestSegIdx   = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const aLat = pts[i].latitude;
    const aLon = pts[i].longitude;
    const bLat = pts[i + 1].latitude;
    const bLon = pts[i + 1].longitude;

    const dist = distanceToSegmentMeters(userLat, userLng, aLat, aLon, bLat, bLon);
    const segBearing = bearingBetween(aLat, aLon, bLat, bLon);
    let score = dist;
    if (opts?.expectedHeading != null && Number.isFinite(opts.expectedHeading)) {
      const delta = angleDeltaDeg(segBearing, Number(opts.expectedHeading));
      // Penalize segments going in a very different direction (parallel wrong road / opposite lane).
      score += Math.max(0, delta - 55) * 0.45;
    }
    if (opts?.expectedSegIndex != null && Number.isFinite(opts.expectedSegIndex)) {
      const leap = Math.abs(i - Number(opts.expectedSegIndex));
      if (leap > 36) score += (leap - 36) * 0.9;
    }
    if (score < bestScore) {
      bestScore = score;
      minDist    = dist;
      bestSegIdx = i;

      const ax = R * Math.cos(toRad(aLat)) * toRad(aLon);
      const ay = R * toRad(aLat);
      const bx = R * Math.cos(toRad(bLat)) * toRad(bLon);
      const by = R * toRad(bLat);
      const px = R * Math.cos(toRad(userLat)) * toRad(userLng);
      const py = R * toRad(userLat);

      const dx    = bx - ax;
      const dy    = by - ay;
      const lenSq = dx * dx + dy * dy;
      let   t     = 0;
      if (lenSq > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }
      bestLat = aLat + t * (bLat - aLat);
      bestLng = aLon + t * (bLon - aLon);
    }
  }

  if (minDist > maxRadiusM) return null;

  const seg = pts[bestSegIdx];
  const segNext = pts[bestSegIdx + 1];
  const segBearing = bearingBetween(seg.latitude, seg.longitude, segNext.latitude, segNext.longitude);

  return {
    latitude:       bestLat,
    longitude:      bestLng,
    distM:          minDist,
    segmentIndex:   bestSegIdx,
    segmentBearing: segBearing,
  };
}

export function useDrivingSnap() {
  const lastRawRef           = useRef<{ lat: number; lng: number } | null>(null);
  const lastSnappedRef       = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastTargetHeadingRef = useRef<number>(0);
  const routePtsRef          = useRef<{ latitude: number; longitude: number }[]>([]);
  const roadMatchPtsRef      = useRef<{ latitude: number; longitude: number }[]>([]);
  const lastSegmentIndexRef  = useRef<number>(-1);
  const lastSnapAtRef        = useRef<number>(0);
  const iosSegmentSwitchCandidateRef = useRef<{
    lat: number;
    lng: number;
    segIdx: number;
    hits: number;
    at: number;
  } | null>(null);

  const logSnapReject = useCallback((reason: string, payload?: Record<string, unknown>) => {
    vroomGpsLog(`SNAP_${reason}`, { source: 'useDrivingSnap', ...(payload ?? {}) }, 1500);
  }, []);

  const setRoutePoints = useCallback((pts: { latitude: number; longitude: number }[]) => {
    routePtsRef.current = pts;
  }, []);

  const setRoadMatchPoints = useCallback((pts: { latitude: number; longitude: number }[]) => {
    // Map Matching daje nam realną geometrię drogi
    roadMatchPtsRef.current = pts;
  }, []);

  const snap = useCallback((
    lat: number,
    lng: number,
    speedKmh: number,
    isNavigating: boolean,
    hardRoadLock = false,
    accuracyM?: number | null,
  ): {
    latitude:      number;
    longitude:     number;
    snapped:       boolean;
    targetHeading: number;
  } => {
    if (isNavigating) return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      logSnapReject('snap_invalid_coord');
      if (lastSnappedRef.current) {
        return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
      }
      return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };
    }

    // Wybieramy punkty. Priorytet ma roadMatchPtsRef, bo to jest aktualna GEOMETRIA drogi,
    // po której jedziesz, a nie tylko linia prosta do celu.
    const pts = roadMatchPtsRef.current.length >= 2
      ? roadMatchPtsRef.current
      : routePtsRef.current;
    const last = lastRawRef.current;

    // Snap whenever we have road points — speed gate removed because loc.speed is
    // unreliable on many Android devices (can read 0 km/h even while moving).
    const stationary = speedKmh < 6;

    if (pts.length < 2) {
    logSnapReject('snap_no_geometry', {
      hardRoadLock,
      matchedPts: roadMatchPtsRef.current.length,
      routePts: routePtsRef.current.length,
    });
    if (hardRoadLock && lastSnappedRef.current) {
        if (stationary) {
          return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
        }
        const now = Date.now();
        const dtMs = lastSnapAtRef.current > 0 ? Math.max(0, now - lastSnapAtRef.current) : 0;
        if (last && Number.isFinite(last.lat) && Number.isFinite(last.lng)) {
          const rawMoveM = haversineKm(last.lat, last.lng, lat, lng) * 1000;
          const scale = rawMoveM > RAW_FALLBACK_MAX_STEP_M && rawMoveM > 0
            ? RAW_FALLBACK_MAX_STEP_M / rawMoveM
            : 1;
          const stepped = {
            latitude: lastSnappedRef.current.latitude + (lat - last.lat) * scale,
            longitude: lastSnappedRef.current.longitude + (lng - last.lng) * scale,
          };
          lastSnappedRef.current = stepped;
          lastSnapAtRef.current = now;
          return { ...stepped, snapped: true, targetHeading: lastTargetHeadingRef.current };
        }
        if (speedKmh < 3) {
          return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };
        }
        const stepM = dtMs > 0
          ? Math.min(28, Math.max(1.2, (Math.max(0, speedKmh) / 3.6) * (dtMs / 1000)))
          : Math.min(18, Math.max(1.2, Math.max(0, speedKmh) / 3.2));
        const projected = projectByBearingMeters(
          lastSnappedRef.current.latitude,
          lastSnappedRef.current.longitude,
          lastTargetHeadingRef.current || 0,
          stepM,
        );
        lastSnappedRef.current = projected;
        lastSnapAtRef.current = now;
        return { ...projected, snapped: true, targetHeading: lastTargetHeadingRef.current };
      }
      return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };
    }

    if (last && lastSnappedRef.current) {
      const rawMoveM = haversineKm(last.lat, last.lng, lat, lng) * 1000;
      // HARD GUARD: jeśli lastSnappedRef jest daleko od bieżącego raw GPS,
      // znaczy że geometria/snap są martwe — nie zwracamy starego snap.
      const lastSnapToRawM = haversineKm(
        lat,
        lng,
        lastSnappedRef.current.latitude,
        lastSnappedRef.current.longitude,
      ) * 1000;
      const lastSnapTooFar = lastSnapToRawM > MAX_SNAP_TO_RAW_DISTANCE_M;
      if (lastSnapTooFar) {
        logSnapReject('snap_last_too_far', {
          lastSnapToRawM: Math.round(lastSnapToRawM),
          speedKmh: Math.round(speedKmh),
        });
        lastSnappedRef.current = null;
        lastSegmentIndexRef.current = -1;
      } else {
        if (hardRoadLock && stationary && rawMoveM < 8) {
          return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
        }
        if (!hardRoadLock) {
          const dLat = Math.abs(lat - last.lat);
          const dLng = Math.abs(lng - last.lng);
          if (dLat < MIN_MOVE_DEG && dLng < MIN_MOVE_DEG && speedKmh < 60) {
            return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
          }
        }
      }
    }

    const prevRawForHeading = lastRawRef.current;
    lastRawRef.current = { lat, lng };

    // Dynamiczny promień snapowania.
    // Dla geometrii z Map Matching API (roadMatchPtsRef) używamy szerszego promienia —
    // ta geometria jest zweryfikowana przez Mapbox i zawsze odpowiada prawdziwej drodze.
    // Dla zwykłej trasy (routePtsRef) używamy mniejszego promienia, żeby nie skakać
    // na odległe drogi gdy użytkownik jedzie po polnej drodze lub poza trasą.
    const usingMatchedRoad = roadMatchPtsRef.current.length >= 2;
    // Matched-road radius: keep baseline strict to avoid wrong parallel roads,
    // and apply +15% only when GPS accuracy is poor or hard lock is active.
    const matchedRadiusBoost =
      usingMatchedRoad && (
        (accuracyM != null && Number.isFinite(accuracyM) && accuracyM > 40)
        || hardRoadLock
      )
        ? 1.15
        : 1;
    let matchedRoadRadius = Math.round(SNAP_RADIUS_M_MATCHED * matchedRadiusBoost);
    if (stationary && usingMatchedRoad) {
      matchedRoadRadius = Math.max(matchedRoadRadius, 80);
    }
    if (
      Platform.OS === 'ios'
      && usingMatchedRoad
      && hardRoadLock
      && speedKmh < 30
    ) {
      // iOS potrafi dać przesunięty fix na równoległą jezdnię; ciaśniejszy promień
      // ogranicza łapanie odległej geometrii przy wolnej jeździe.
      matchedRoadRadius = Math.min(matchedRoadRadius, 105);
    }
    if (usingMatchedRoad && accuracyM != null && Number.isFinite(accuracyM) && accuracyM < 25) {
      matchedRoadRadius = Math.min(matchedRoadRadius, 95);
    }
    const dynamicRadius = usingMatchedRoad
      ? matchedRoadRadius
      : speedKmh > 70 ? SNAP_RADIUS_M_FAST : SNAP_RADIUS_M_BASE;

    const movedRawM = last ? haversineKm(last.lat, last.lng, lat, lng) * 1000 : 0;
    const expectedHeading =
      last && movedRawM >= 5
        ? bearingBetween(last.lat, last.lng, lat, lng)
        : null;
    const expectedSegIndex = lastSegmentIndexRef.current >= 0 ? lastSegmentIndexRef.current : null;

    let result = snapToRouteWithInfo(lat, lng, pts, dynamicRadius, {
      expectedHeading,
      expectedSegIndex,
    });
    // Jeśli stale-matched-geometry chwilowo nie pasuje, spróbuj fallbacku
    // do routePts (często ratuje płynność po ostrych zakrętach / zmianie pasa).
    if (!result && usingMatchedRoad && routePtsRef.current.length >= 2) {
      result = snapToRouteWithInfo(lat, lng, routePtsRef.current, SNAP_RADIUS_M_FAST, {
        expectedHeading,
        expectedSegIndex,
      });
    }

    // Driving: nigdy nie zostawaj na surowym GPS poza geometrią — szersze promienie,
    // potem projekcja na polyline (nawet przy dużym błędzie GPS).
    if (!result && hardRoadLock) {
      const rm = roadMatchPtsRef.current;
      const rt = routePtsRef.current;
      if (rm.length >= 2) {
        result = snapToRouteWithInfo(lat, lng, rm, SNAP_RADIUS_M_MATCHED_TIER2, {
          expectedHeading,
          expectedSegIndex,
        })
          || snapToRouteWithInfo(lat, lng, rm, SNAP_RADIUS_M_MATCHED_TIER3, {
            expectedHeading,
            expectedSegIndex,
          })
          || snapToRouteWithInfo(lat, lng, rm, SNAP_RADIUS_EMERGENCY_M, {
            expectedHeading,
            expectedSegIndex,
          });
      }
      if (!result && rt.length >= 2) {
        result = snapToRouteWithInfo(lat, lng, rt, SNAP_RADIUS_M_ROUTE_HARD, {
          expectedHeading,
          expectedSegIndex,
        })
          || snapToRouteWithInfo(lat, lng, rt, SNAP_RADIUS_EMERGENCY_M, {
            expectedHeading,
            expectedSegIndex,
          });
      }
    }

    // v10.8 LATERAL CLAMP (zastapienie REJECT):
    // Analiza logow 1741 (iOS, 65 km/h):
    //   * 152 lateral_reject z distM mediana 29m, max 59m
    //   * 304 raw_fallback (marker zostaje na starym anchor → user jedzie → snap
    //     wraca → marker teleportuje sie do przodu)
    // Reject powoduje WLASNIE to o czym user pisze: "pokazuje nas wszedzie".
    //
    // NOWE PODEJSCIE: zamiast rejekcji, KLAMPUJEMY snap w strone raw GPS.
    // Marker zawsze blisko prawdziwej pozycji, nigdy nie freezuje, ZERO teleportow.
    //   * distM <= softLimitM → snap akceptowany w 100%
    //   * softLimitM < distM <= hardLimitM → snap przesuwany w kierunku raw
    //     do softLimitM (max ~40m offset od raw, czyli ok. szerokosci 2 pasow)
    //   * distM > hardLimitM → tylko wtedy oddajemy raw (geometria absurdalna)
    const usingHighConfidenceGeom = usingMatchedRoad;
    const softLimitM = (() => {
      // Bazowy soft = 30m (= szerokosc drogi 2 pasy = realistyczny offset GPS)
      // Booster predkosciowy bo lepsza geometria nadaza wolniej.
      const speedBoost =
        speedKmh >= 95 ? 22
          : speedKmh >= 75 ? 18
            : speedKmh >= 55 ? 12
              : speedKmh >= 35 ? 8
                : 0;
      const acc = accuracyM != null && Number.isFinite(accuracyM) ? accuracyM : 12;
      const accBoost = acc >= 18 ? Math.min(12, Math.round((acc - 16) * 0.5)) : 0;
      // Matched road = +6 (Mapbox sprawdzilo geometrie)
      const matchedBoost = usingHighConfidenceGeom ? 6 : 0;
      return Math.min(70, 30 + speedBoost + accBoost + matchedBoost);
    })();
    const hardLimitM = Math.max(120, softLimitM + 50);
    if (
      result
      && hardRoadLock
      && speedKmh >= DRIVING_LATERAL_REJECT_MIN_KMH
      && result.distM > hardLimitM
    ) {
      // v10.14: nigdy raw/reject przy absurdalnym dist — klamruj do hardLimit lub hold.
      const clamped = clampSnapTowardRaw(
        lat, lng,
        result.latitude, result.longitude,
        result.distM,
        hardLimitM,
      );
      logSnapReject('snap_lateral_hard_clamp_v10', {
        origDistM: Math.round(result.distM),
        newDistM: Math.round(clamped.distM),
        hardLimitM: Math.round(hardLimitM),
        speedKmh: Math.round(speedKmh),
        usingMatchedRoad,
      });
      result = {
        ...result,
        latitude: clamped.latitude,
        longitude: clamped.longitude,
        distM: clamped.distM,
      };
    }
    if (
      result
      && hardRoadLock
      && speedKmh >= DRIVING_LATERAL_REJECT_MIN_KMH
      && result.distM > softLimitM
    ) {
      // Soft clamp: przesuwamy snap w strone raw do softLimitM.
      // Marker NIE teleportuje, NIE freezuje, jest blisko realnej pozycji.
      const clamped = clampSnapTowardRaw(
        lat, lng,
        result.latitude, result.longitude,
        result.distM,
        softLimitM,
      );
      if (Math.random() < 0.15) {
        logSnapReject('snap_lateral_blend_v10', {
          origDistM: Math.round(result.distM),
          newDistM: Math.round(clamped.distM),
          softLimitM: Math.round(softLimitM),
          speedKmh: Math.round(speedKmh),
        });
      }
      result = {
        ...result,
        latitude: clamped.latitude,
        longitude: clamped.longitude,
        distM: clamped.distM,
      };
    }

    // Brak drogi w promieniu — w driving mode trzymamy ostatni pewny snap,
    // żeby marker nie zrzucał się z drogi przy chwilowych brakach geometrii.
    // ALE TYLKO jeśli ten ostatni snap jest blisko aktualnego raw GPS.
    // Inaczej zwracamy raw z snapped:false (geometria odjechała, czekamy na match).
    const lastSnapToRawM = lastSnappedRef.current
      ? haversineKm(lat, lng, lastSnappedRef.current.latitude, lastSnappedRef.current.longitude) * 1000
      : Infinity;
    const lastSnapUsable = lastSnappedRef.current && lastSnapToRawM <= MAX_SNAP_TO_RAW_DISTANCE_M;

    if (!result) {
      if (lastSnapUsable && lastSnappedRef.current) {
        if (hardRoadLock && pts.length >= 2) {
          const reproject = snapToRouteWithInfo(lat, lng, pts, SNAP_RADIUS_EMERGENCY_M, {
            expectedHeading,
            expectedSegIndex,
          });
          if (reproject) {
            result = reproject;
          }
        }
        if (!result && !hardRoadLock && last) {
          const rawMoveM = haversineKm(last.lat, last.lng, lat, lng) * 1000;
          const scale = rawMoveM > RAW_FALLBACK_MAX_STEP_M && rawMoveM > 0
            ? RAW_FALLBACK_MAX_STEP_M / rawMoveM
            : 1;
          const extrapolated = {
            latitude: lastSnappedRef.current.latitude + (lat - last.lat) * scale,
            longitude: lastSnappedRef.current.longitude + (lng - last.lng) * scale,
          };
          lastSnappedRef.current = extrapolated;
          return { ...extrapolated, snapped: true, targetHeading: lastTargetHeadingRef.current };
        }
        if (!result) {
          return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
        }
      }
      if (hardRoadLock && pts.length >= 2) {
        const emergency = snapToRouteWithInfo(lat, lng, pts, SNAP_RADIUS_EMERGENCY_M, {
          expectedHeading,
          expectedSegIndex,
        });
        if (emergency) {
          result = emergency;
        }
      }
      if (!result) {
        logSnapReject('snap_no_match_hard_lock', {
          usingMatchedRoad,
          dynamicRadius,
          speedKmh: Math.round(speedKmh),
          lastSnapToRawM: Number.isFinite(lastSnapToRawM) ? Math.round(lastSnapToRawM) : null,
        });
        lastSnapAtRef.current = Date.now();
        // KLUCZOWE: nie zwracamy starego lastSnap, jeśli jest daleko od raw —
        // wyżej w pipeline `snapped: false` powoduje raw fallback i wymuszenie
        // map-matchingu zamiast wizualnego "stania" na martwej geometrii.
        if (hardRoadLock && lastSnapUsable && lastSnappedRef.current) {
          return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
        }
        if (lastSnappedRef.current && !lastSnapUsable) {
          lastSnappedRef.current = null;
          lastSegmentIndexRef.current = -1;
        }
        return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };
      }
    }

    // iOS guard: przy niskiej prędkości i słabszym fixie nie pozwól przeskoczyć
    // na równoległą/złą drogę po dużym skoku segmentu.
    if (Platform.OS === 'ios' && hardRoadLock && result && lastSnappedRef.current && lastRawRef.current) {
      const acc = accuracyM != null && Number.isFinite(accuracyM) ? accuracyM : 999;
      const jumpFromPrevSnapM = haversineKm(
        lastSnappedRef.current.latitude,
        lastSnappedRef.current.longitude,
        result.latitude,
        result.longitude,
      ) * 1000;
      const rawMoveM = haversineKm(
        lastRawRef.current.lat,
        lastRawRef.current.lng,
        lat,
        lng,
      ) * 1000;
      const segLeap = lastSegmentIndexRef.current >= 0
        ? Math.abs(result.segmentIndex - lastSegmentIndexRef.current)
        : 0;
      const hdgDelta = angleDeltaDeg(result.segmentBearing, lastTargetHeadingRef.current || 0);
      const likelyWrongRoadJump =
        speedKmh <= IOS_WRONG_ROAD_GUARD_MAX_SPEED_KMH
        && acc >= IOS_WRONG_ROAD_GUARD_MIN_ACC_M
        && rawMoveM <= IOS_WRONG_ROAD_GUARD_MAX_RAW_MOVE_M
        && jumpFromPrevSnapM >= IOS_WRONG_ROAD_GUARD_MIN_JUMP_M
        && segLeap >= IOS_WRONG_ROAD_GUARD_SEGMENT_LEAP
        && hdgDelta >= IOS_WRONG_ROAD_GUARD_MAX_HEADING_DELTA;
      if (likelyWrongRoadJump) {
        logSnapReject('ios_wrong_road_guard_hold', {
          speedKmh: Math.round(speedKmh),
          accM: Math.round(acc),
          rawMoveM: Math.round(rawMoveM),
          snapJumpM: Math.round(jumpFromPrevSnapM),
          segLeap,
          hdgDelta: Math.round(hdgDelta),
        });
        return {
          ...lastSnappedRef.current,
          snapped: true,
          targetHeading: lastTargetHeadingRef.current,
        };
      }
    }
    if (Platform.OS === 'ios' && hardRoadLock && result && lastSnappedRef.current) {
      const segLeap = lastSegmentIndexRef.current >= 0
        ? Math.abs(result.segmentIndex - lastSegmentIndexRef.current)
        : 0;
      const jumpFromPrevSnapM = haversineKm(
        lastSnappedRef.current.latitude,
        lastSnappedRef.current.longitude,
        result.latitude,
        result.longitude,
      ) * 1000;
      if (segLeap >= 10 && jumpFromPrevSnapM >= 20 && speedKmh <= 45) {
        const now = Date.now();
        const cand = iosSegmentSwitchCandidateRef.current;
        const sameCluster =
          !!cand
          && now - cand.at <= IOS_SEGMENT_SWITCH_CONFIRM_WINDOW_MS
          && Math.abs(cand.segIdx - result.segmentIndex) <= 4
          && haversineKm(cand.lat, cand.lng, result.latitude, result.longitude) * 1000 <= IOS_SEGMENT_SWITCH_CONFIRM_RADIUS_M;
        if (!sameCluster) {
          iosSegmentSwitchCandidateRef.current = {
            lat: result.latitude,
            lng: result.longitude,
            segIdx: result.segmentIndex,
            hits: 1,
            at: now,
          };
          logSnapReject('ios_segment_switch_candidate_1', {
            segLeap,
            jumpM: Math.round(jumpFromPrevSnapM),
            speedKmh: Math.round(speedKmh),
          });
          return {
            ...lastSnappedRef.current,
            snapped: true,
            targetHeading: lastTargetHeadingRef.current,
          };
        }
        const hits = (cand?.hits ?? 1) + 1;
        if (hits < IOS_SEGMENT_SWITCH_CONFIRM_HITS) {
          iosSegmentSwitchCandidateRef.current = {
            lat: result.latitude,
            lng: result.longitude,
            segIdx: result.segmentIndex,
            hits,
            at: now,
          };
          logSnapReject(`ios_segment_switch_candidate_${hits}`, {
            segLeap,
            jumpM: Math.round(jumpFromPrevSnapM),
            speedKmh: Math.round(speedKmh),
          });
          return {
            ...lastSnappedRef.current,
            snapped: true,
            targetHeading: lastTargetHeadingRef.current,
          };
        }
        iosSegmentSwitchCandidateRef.current = null;
      } else {
        iosSegmentSwitchCandidateRef.current = null;
      }
    } else {
      iosSegmentSwitchCandidateRef.current = null;
    }

    // Ogranicz projekcję na złą geometrię (równoległa droga) — ale NIE przeciągaj w stronę
    // surowego GPS w driving + Map Matching: wtedy GPS bywa „na polu”, a snap na osi drogi;
    // clamp szedłby dokładnie w złą stronę (typowy bug po zaostrzeniu limitów bocznych).
    if (!(hardRoadLock && usingMatchedRoad)) {
      let lateralCap = lateralSnapCapFromAccuracy(accuracyM);
      if (accuracyM != null && Number.isFinite(accuracyM) && accuracyM < 25) {
        lateralCap = Math.min(lateralCap, 72);
      }
      if (hardRoadLock) {
        lateralCap = Math.min(380, lateralCap * 1.45);
      }
      const distFromGpsM = haversineKm(lat, lng, result.latitude, result.longitude) * 1000;
      if (distFromGpsM > lateralCap) {
        const c = clampSnapTowardRaw(lat, lng, result.latitude, result.longitude, distFromGpsM, lateralCap);
        result = {
          ...result,
          latitude: c.latitude,
          longitude: c.longitude,
          distM: c.distM,
        };
      }
    }

    // Snap udany — anty-jitter / anty-skok (w driving większa płynność przy niskiej prędkości).
    const maxJumpM = hardRoadLock
      ? stationary
        ? 4
        : speedKmh > 88
          ? 78
          : speedKmh > 55
            ? 68
            : speedKmh > 38
              ? 58
              : speedKmh > 18
                ? 52
                : 60
      : speedKmh > 38
        ? (speedKmh > 88 ? 72 : speedKmh > 55 ? 62 : 54)
        : SNAP_MAX_JUMP_M;
    let snappedCoord = { latitude: result.latitude, longitude: result.longitude };
    const prevSnapped = lastSnappedRef.current;
    if (prevSnapped) {
      const jumpM = haversineKm(
        prevSnapped.latitude,
        prevSnapped.longitude,
        result.latitude,
        result.longitude,
      ) * 1000;
      const segmentLeap = lastSegmentIndexRef.current >= 0
        ? Math.abs(result.segmentIndex - lastSegmentIndexRef.current)
        : 0;
      if (jumpM > maxJumpM) {
        let pull = hardRoadLock
          ? speedKmh > 75
            ? 0.68
            : speedKmh > 45
              ? 0.58
              : speedKmh > 15
                ? 0.52
                : 0.48
          : speedKmh > 52
            ? (speedKmh > 75 ? 0.62 : 0.5)
            : (speedKmh > 70 ? 0.5 : 0.35);
        snappedCoord = {
          latitude: prevSnapped.latitude + (result.latitude - prevSnapped.latitude) * pull,
          longitude: prevSnapped.longitude + (result.longitude - prevSnapped.longitude) * pull,
        };
      } else if (hardRoadLock && segmentLeap > MAX_SEGMENT_INDEX_LEAP && jumpM > 20) {
        // Gwałtowna zmiana segmentu po refreshu geometrii często powoduje „lane-hop”.
        const guarded = speedKmh > 60 ? 0.5 : 0.42;
        snappedCoord = {
          latitude: prevSnapped.latitude + (result.latitude - prevSnapped.latitude) * guarded,
          longitude: prevSnapped.longitude + (result.longitude - prevSnapped.longitude) * guarded,
        };
      } else if (hardRoadLock && jumpM > 18) {
        // Driving mode should stay visually smooth even when geometry changes segment.
        const smoothHard = speedKmh > 70 ? 0.8 : speedKmh > 35 ? 0.72 : 0.64;
        snappedCoord = {
          latitude: prevSnapped.latitude + (result.latitude - prevSnapped.latitude) * smoothHard,
          longitude: prevSnapped.longitude + (result.longitude - prevSnapped.longitude) * smoothHard,
        };
      } else if (jumpM > 8) {
        const smooth = hardRoadLock
          ? speedKmh > 70
            ? 0.9
            : speedKmh > 35
              ? 0.86
              : 0.92
          : speedKmh > 70
            ? 0.8
            : speedKmh > 50
              ? 0.78
              : 0.65;
        snappedCoord = {
          latitude: prevSnapped.latitude + (result.latitude - prevSnapped.latitude) * smooth,
          longitude: prevSnapped.longitude + (result.longitude - prevSnapped.longitude) * smooth,
        };
      }
    }

    if (hardRoadLock && prevSnapped) {
      const travelHeading = expectedHeading ?? lastTargetHeadingRef.current;
      const stepBearing = bearingBetween(
        prevSnapped.latitude,
        prevSnapped.longitude,
        snappedCoord.latitude,
        snappedCoord.longitude,
      );
      const stepM = haversineKm(
        prevSnapped.latitude,
        prevSnapped.longitude,
        snappedCoord.latitude,
        snappedCoord.longitude,
      ) * 1000;
      const headingTurnDelta = expectedHeading != null
        ? angleDeltaDeg(expectedHeading, lastTargetHeadingRef.current)
        : 0;
      const likelyUTurn = expectedHeading != null && headingTurnDelta > 108 && movedRawM >= 6;
      const backwardJump =
        speedKmh >= 8
        && stepM >= 8
        && angleDeltaDeg(stepBearing, travelHeading) > 122;

      if (backwardJump && !likelyUTurn) {
        // Reject hard-lock snap behind the car; keep forward continuity.
        const projectedStepM = Math.min(
          16,
          Math.max(2.5, movedRawM > 0 ? movedRawM * 0.85 : speedKmh / 5),
        );
        snappedCoord = projectByBearingMeters(
          prevSnapped.latitude,
          prevSnapped.longitude,
          travelHeading,
          projectedStepM,
        );
      }
    }

    // FINAL HARD GUARD: jeśli po wszystkich obróbkach snappedCoord wylądował
    // dalej niż HARD_SNAP_DROP_M od raw GPS, geometria jest zmarznięta —
    // resetuj snap i zwróć raw z snapped:false, niech wyżej w pipeline kod
    // wymusi force-match i ustawi marker na raw.
    const finalDistFromRawM = haversineKm(lat, lng, snappedCoord.latitude, snappedCoord.longitude) * 1000;
    if (finalDistFromRawM > HARD_SNAP_DROP_M) {
      logSnapReject('snap_drop_too_far', {
        distM: Math.round(finalDistFromRawM),
        speedKmh: Math.round(speedKmh),
      });
      lastSnappedRef.current = null;
      lastSegmentIndexRef.current = -1;
      lastSnapAtRef.current = Date.now();
      return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };
    }

    lastSnappedRef.current = snappedCoord;
    lastSegmentIndexRef.current = result.segmentIndex;
    lastSnapAtRef.current = Date.now();

    // Heading wzdłuż drogi — segment dopasowany do kierunku jazdy (nie „pod skosem”).
    let segmentBearing = result.segmentBearing;
    const lastRaw = prevRawForHeading;
    if (lastRaw) {
      const travelBearing = bearingBetween(lastRaw.lat, lastRaw.lng, lat, lng);
      if (haversineKm(lastRaw.lat, lastRaw.lng, lat, lng) * 1000 >= 1.5) {
        segmentBearing = alignBearingToReference(segmentBearing, travelBearing);
      } else {
        segmentBearing = alignBearingToReference(segmentBearing, lastTargetHeadingRef.current);
      }
    } else {
      segmentBearing = alignBearingToReference(segmentBearing, lastTargetHeadingRef.current);
    }

    const smoothedBearing = lerpAngle(
      lastTargetHeadingRef.current,
      segmentBearing,
      hardRoadLock ? 0.58 : 0.4,
    );
    lastTargetHeadingRef.current = smoothedBearing;

    return { ...snappedCoord, snapped: true, targetHeading: smoothedBearing };
  }, []);

  const resetSnapState = useCallback(() => {
    lastRawRef.current           = null;
    lastSnappedRef.current       = null;
    lastTargetHeadingRef.current = 0;
    lastSegmentIndexRef.current  = -1;
    lastSnapAtRef.current        = 0;
    iosSegmentSwitchCandidateRef.current = null;
  }, []);

  const reset = useCallback(() => {
    resetSnapState();
    roadMatchPtsRef.current = [];
    routePtsRef.current     = [];
  }, [resetSnapState]);

  return { snap, setRoutePoints, setRoadMatchPoints, resetSnapState, reset };
}