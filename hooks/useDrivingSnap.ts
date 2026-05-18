import { useRef, useCallback } from 'react';
import { alignBearingToReference, bearingBetween, distanceToSegmentMeters, haversineKm } from '../scripts/navigationUtils';

// Dynamiczny promień snapowania: przy wolnej jeździe ufamy GPS bardziej,
// przy szybkiej jeździe GPS ma większy dryf, więc używamy większego promienia.
const SNAP_RADIUS_M_BASE    = 55;
const SNAP_RADIUS_M_FAST    = 85;
// Map Matching API returns verified road geometry — use a wider radius so GPS
// errors in parking lots / courtyards (often 80-150 m) still snap to the road.
const SNAP_RADIUS_M_MATCHED = 180;
// Gdy włączony twardy lock (driving mode): kolejne próby zanim odpuścimy snap.
const SNAP_RADIUS_M_MATCHED_TIER2 = 230;
const SNAP_RADIUS_M_MATCHED_TIER3 = 310;
const SNAP_RADIUS_M_ROUTE_HARD    = 360;
/** Awaryjny promień dla hard lock — nadal ograniczony, żeby nie łapać odległych dróg. */
const SNAP_RADIUS_EMERGENCY_M     = 340;
const MAX_SEGMENT_INDEX_LEAP      = 25;
const MIN_MOVE_DEG          = 0.00002; // ~2m
const SNAP_MAX_JUMP_M       = 45;      // guard against sudden lane/segment jumps
const RAW_FALLBACK_MAX_STEP_M = 30;    // max krok fallbacku gdy chwilowo brak snapa

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
/** Max odległość snapu od surowego GPS — ogranicza „przyklejenie” do złej równoległej drogi (Map Matching). */
function lateralSnapCapFromAccuracy(accuracyM: number | null | undefined): number {
  const a = accuracyM != null && Number.isFinite(accuracyM) ? Math.max(8, accuracyM) : 45;
  return Math.min(280, Math.max(85, a * 3.2));
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

    // Snap whenever we have road points — speed gate removed because loc.speed is
    // unreliable on many Android devices (can read 0 km/h even while moving).
    if (pts.length < 2) {
    const prevRaw = lastRawRef.current;
    const last = prevRaw;

    if (hardRoadLock && lastSnappedRef.current) {
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

    if (last && !hardRoadLock) {
      const dLat = Math.abs(lat - last.lat);
      const dLng = Math.abs(lng - last.lng);
      // Na zakrętach (duża prędkość) nie możemy ignorować małych ruchów.
      // W driving (hardRoadLock) NIE pomijamy — geometria i snap muszą żyć co tick GPS.
      if (dLat < MIN_MOVE_DEG && dLng < MIN_MOVE_DEG && lastSnappedRef.current && speedKmh < 60) {
        return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
      }
    }

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
    const matchedRoadRadius = Math.round(SNAP_RADIUS_M_MATCHED * matchedRadiusBoost);
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

    // Brak drogi w promieniu — w driving mode trzymamy ostatni pewny snap,
    // żeby marker nie zrzucał się z drogi przy chwilowych brakach geometrii.
    if (!result) {
      if (lastSnappedRef.current) {
        // hardRoadLock: bez ekstrapolacji wektorowej z surowego GPS — to odklejało marker od drogi.
        if (!hardRoadLock && last) {
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
        return { ...lastSnappedRef.current, snapped: true, targetHeading: lastTargetHeadingRef.current };
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
        lastSnapAtRef.current = Date.now();
        return { latitude: lat, longitude: lng, snapped: false, targetHeading: lastTargetHeadingRef.current };
      }
    }

    // Ogranicz projekcję na złą geometrię (równoległa droga) — ale NIE przeciągaj w stronę
    // surowego GPS w driving + Map Matching: wtedy GPS bywa „na polu”, a snap na osi drogi;
    // clamp szedłby dokładnie w złą stronę (typowy bug po zaostrzeniu limitów bocznych).
    if (!(hardRoadLock && usingMatchedRoad)) {
      let lateralCap = lateralSnapCapFromAccuracy(accuracyM);
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
      ? speedKmh > 88
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
        const pull = hardRoadLock
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

    lastSnappedRef.current = snappedCoord;
    lastSegmentIndexRef.current = result.segmentIndex;
    lastSnapAtRef.current = Date.now();

    // Heading wzdłuż drogi — segment dopasowany do kierunku jazdy (nie „pod skosem”).
    let segmentBearing = result.segmentBearing;
    const lastRaw = prevRaw;
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

  const reset = useCallback(() => {
    lastRawRef.current           = null;
    lastSnappedRef.current       = null;
    lastTargetHeadingRef.current = 0;
    lastSegmentIndexRef.current  = -1;
    lastSnapAtRef.current        = 0;
    roadMatchPtsRef.current      = [];
  }, []);

  return { snap, setRoutePoints, setRoadMatchPoints, reset };
}