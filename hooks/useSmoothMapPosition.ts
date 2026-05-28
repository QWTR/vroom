import { useEffect } from 'react';
import {
  runOnJS,
  useSharedValue,
  useFrameCallback,
} from 'react-native-reanimated';
import {
  clearSmoothPositionFeed,
  notifySmoothPositionDisplay,
  registerSmoothPositionHandler,
  type SmoothTarget,
} from '../lib/mapPosition/smoothPositionFeed';
import { logGpsTickLayer } from '../lib/gpsTickTraceLog';
import { markerLogTick } from '../lib/markerPipelineLog';
import { isAbsurdGlobeCoordinate } from '../lib/mapPosition/feedCoordinateGuard';
import { logTelemetry } from '../lib/telemetryLogger';

const DISPLAY_PUSH_MS = 16;
const WORKLET_STALL_MS = 2000;
/** ~2 km/h — poniżej uznajemy postój (bez LERP/DR). */
const CRUISE_MIN_MS = 0.55;
/** Dead reckoning tylko przy realnej jeździe (~5+ km/h). */
const DR_MIN_SPEED_MS = 1.39;
/** Heading z azymutu drogi od ~5 km/h (zgodnie z TRIP_COMPASS_HEADING_MAX_KMH). */
const HEADING_LOCK_SPEED_MS = DR_MIN_SPEED_MS;
/** Brak nowego feedu GPS — worklet jedzie DR wzdłuż drogi. */
const FEED_GAP_DR_MS = 500;
/** Min. punkty w oknie roadFlat do DR po łuku. */
const ROAD_FLAT_MIN_LEN = 4;
const ZERO_SPEED_EPS_MS = 0.05;
const STATIONARY_MAX_ANCHOR_DRIFT_M = 2.5;
/** Wyjście z postoju: feed musi mieć speed + realny ruch od pinu. */
const STATIONARY_RELEASE_SPEED_MS = 0.45;
const STATIONARY_RELEASE_MOVE_M = 1.2;
/** Przy postoju — odrzuć feed dalej niż tyle od display (m). */
const STATIONARY_MAX_FEED_JUMP_M = 8;
/** Bezwzględny limit skoku (inny kontynent / zły fix). */
const MEGA_FEED_JUMP_M = 600;
const STATIONARY_DRIFT_CAP_M = 45;
/** Nie blokuj markera przy "powolnej jeździe" — lock tylko dla realnego postoju. */
const STATIONARY_LOCK_SPEED_MS = 0.12;
/** Duży skok kotwicy — wydłuż segment, nadal liniowy LERP. */
const BIG_CATCHUP_M = 22;
/** Display dalej od feedu — instant snap (live pozycja), tylko przy jeździe. */
const MAX_DISPLAY_LAG_M = 55;
const LAG_SOFT_BLEND_ALPHA = 0.55;
const SEG_DURATION_MIN_MS = 200;
const SEG_DURATION_MAX_MS = 1400;
/** Po zakręcie — krótki freeze dużych skoków indeksu DR na polilinii. */
const TURN_DR_FREEZE_MS = 200;
/** Max obrót markera [°/s]. */
const MAX_HEADING_RATE_DPS = 20;
function logWorkletStall(payload: Record<string, unknown>): void {
  markerLogTick('WORKLET_STALL', payload, WORKLET_STALL_MS);
}

function logWorkletStateCheck(payload: Record<string, unknown>): void {
  logGpsTickLayer('WORKLET_STATE_CHECK', payload);
}

function logWorkletFrameDiag(payload: Record<string, unknown>): void {
  logGpsTickLayer('WORKLET_FRAME_DIAG', payload);
}

function logWorkletMegaFeedReject(payload: Record<string, unknown>): void {
  markerLogTick('WORKLET_ONFEED_MEGA_REJECT', payload, 0);
}

function logDisplayLagClamp(payload: Record<string, unknown>): void {
  markerLogTick('DISPLAY_LAG_CLAMP', payload, 800);
}

function logStationaryLockTelemetry(payload: Record<string, unknown>): void {
  void logTelemetry('STATIONARY_LOCK', payload);
}

function lerpHeadingCappedWorklet(from: number, to: number, maxDeltaDeg: number): number {
  'worklet';
  const diff = ((to - from + 540) % 360) - 180;
  const clamped = Math.max(-maxDeltaDeg, Math.min(maxDeltaDeg, diff));
  return ((from + clamped) + 360) % 360;
}

function lerpHeadingLinearWorklet(from: number, to: number, u: number): number {
  'worklet';
  const t = Math.max(0, Math.min(1, u));
  const diff = ((to - from + 540) % 360) - 180;
  return ((from + diff * t) + 360) % 360;
}

function clampWorklet(n: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, n));
}

function haversineMWorklet(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  'worklet';
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.pow(Math.sin(dLat / 2), 2);
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.pow(Math.sin(dLng / 2), 2);
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function angleDeltaWorklet(a: number, b: number): number {
  'worklet';
  return Math.abs((((a - b) + 540) % 360) - 180);
}

function bearingBetweenWorklet(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  'worklet';
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function isBackwardStepWorklet(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  headingDeg: number,
): boolean {
  'worklet';
  const distM = haversineMWorklet(fromLat, fromLng, toLat, toLng);
  if (distM < 1.5) return false;
  const stepBearing = bearingBetweenWorklet(fromLat, fromLng, toLat, toLng);
  return angleDeltaWorklet(stepBearing, headingDeg) > 110;
}

/** Przesuń punkt o distM wzdłuż bearingDeg (stopnie, 0 = N). */
function moveAlongBearingWorklet(
  lat: number,
  lng: number,
  bearingDeg: number,
  distM: number,
): { lat: number; lng: number } {
  'worklet';
  if (distM < 0.001) return { lat, lng };
  const R = 6371000;
  const br = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const dLat = ((distM * Math.cos(br)) / R) * (180 / Math.PI);
  const cosLat = Math.cos(latRad);
  const dLng = cosLat > 1e-6
    ? ((distM * Math.sin(br)) / (R * cosLat)) * (180 / Math.PI)
    : 0;
  return { lat: lat + dLat, lng: lng + dLng };
}

function stepTowardWorklet(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  maxStepM: number,
  headingDeg: number,
): { lat: number; lng: number } {
  'worklet';
  const distM = haversineMWorklet(fromLat, fromLng, toLat, toLng);
  if (distM < 0.015 || maxStepM < 0.008) {
    return { lat: fromLat, lng: fromLng };
  }
  const t = Math.min(1, maxStepM / distM);
  const nextLat = fromLat + (toLat - fromLat) * t;
  const nextLng = fromLng + (toLng - fromLng) * t;
  if (isBackwardStepWorklet(fromLat, fromLng, nextLat, nextLng, headingDeg)) {
    return { lat: fromLat, lng: fromLng };
  }
  return { lat: nextLat, lng: nextLng };
}

function clampSegmentDurationMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 500;
  return Math.max(SEG_DURATION_MIN_MS, Math.min(SEG_DURATION_MAX_MS, ms));
}

function roadLenWorklet(roadFlat: number[]): number {
  'worklet';
  return Math.floor(roadFlat.length / 2);
}

function roadGetLatWorklet(roadFlat: number[], i: number): number {
  'worklet';
  return roadFlat[i * 2];
}

function roadGetLngWorklet(roadFlat: number[], i: number): number {
  'worklet';
  return roadFlat[i * 2 + 1];
}

/** Najbliższy indeks punktu (prosty scan po oknie; okno jest małe). */
function findNearestRoadIndexWorklet(roadFlat: number[], lat: number, lng: number): number {
  'worklet';
  const n = roadLenWorklet(roadFlat);
  if (n < 2) return 0;
  let bestI = 0;
  let bestD = 1e18;
  for (let i = 0; i < n; i += 1) {
    const d = haversineMWorklet(lat, lng, roadGetLatWorklet(roadFlat, i), roadGetLngWorklet(roadFlat, i));
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI;
}

/**
 * Przesuń się do przodu wzdłuż roadFlat o distM.
 * roadFlat: [lat0,lng0,lat1,lng1,...] (okno geometrii w okolicy kotwicy).
 */
function advanceAlongRoadWorklet(
  roadFlat: number[],
  startIdx: number,
  fromLat: number,
  fromLng: number,
  distM: number,
): { lat: number; lng: number; idx: number } {
  'worklet';
  const n = roadLenWorklet(roadFlat);
  if (n < 2 || distM <= 0.001) return { lat: fromLat, lng: fromLng, idx: startIdx };

  let idx = Math.max(0, Math.min(n - 2, startIdx));
  // Jeśli odlecieliśmy, złap najbliższy punkt okna.
  const snapI = findNearestRoadIndexWorklet(roadFlat, fromLat, fromLng);
  if (Math.abs(snapI - idx) > 6) idx = Math.max(0, Math.min(n - 2, snapI));

  let curLat = fromLat;
  let curLng = fromLng;
  let remaining = distM;

  // Przejdź segmentami; okno jest małe, więc pętla jest tania.
  for (let guard = 0; guard < 24 && remaining > 0.001; guard += 1) {
    const aLat = roadGetLatWorklet(roadFlat, idx);
    const aLng = roadGetLngWorklet(roadFlat, idx);
    const bLat = roadGetLatWorklet(roadFlat, idx + 1);
    const bLng = roadGetLngWorklet(roadFlat, idx + 1);
    const segM = haversineMWorklet(aLat, aLng, bLat, bLng);
    if (segM < 0.05) {
      idx = Math.min(n - 2, idx + 1);
      continue;
    }
    if (remaining < segM) {
      const t = remaining / segM;
      curLat = aLat + (bLat - aLat) * t;
      curLng = aLng + (bLng - aLng) * t;
      remaining = 0;
      break;
    }
    remaining -= segM;
    idx = Math.min(n - 2, idx + 1);
    curLat = bLat;
    curLng = bLng;
    if (idx >= n - 2) break;
  }

  return { lat: curLat, lng: curLng, idx };
}

export type SmoothMapPositionValues = {
  lat: ReturnType<typeof useSharedValue<number>>;
  lng: ReturnType<typeof useSharedValue<number>>;
  heading: ReturnType<typeof useSharedValue<number>>;
};

/**
 * Worklet 60 FPS: liniowy segment A→B przez durationMs (kadencja GPS),
 * potem dead reckoning wzdłuż anchorHdg z speedMs do następnego fixa.
 */
export function useSmoothMapPosition(enabled: boolean): SmoothMapPositionValues {
  const lat = useSharedValue(0);
  const lng = useSharedValue(0);
  const heading = useSharedValue(0);
  const frameActive = useSharedValue(enabled ? 1 : 0);

  const anchorLat = useSharedValue(0);
  const anchorLng = useSharedValue(0);
  const anchorHdg = useSharedValue(0);
  const roadFlat = useSharedValue<number[]>([]);
  const roadIdx = useSharedValue(0);
  const segFromLat = useSharedValue(0);
  const segFromLng = useSharedValue(0);
  const segFromHdg = useSharedValue(0);
  const segToLat = useSharedValue(0);
  const segToLng = useSharedValue(0);
  const segToHdg = useSharedValue(0);
  const segStartMs = useSharedValue(0);
  const segDurationMs = useSharedValue(500);
  /** Odległość [m] między segFrom i segTo (do constraint V×dt). */
  const segDistM = useSharedValue(0);
  const inDeadReckoning = useSharedValue(0);
  const stationaryLocked = useSharedValue(0);
  const pinLat = useSharedValue(0);
  const pinLng = useSharedValue(0);
  const bootstrapped = useSharedValue(0);
  const speedMs = useSharedValue(0);
  const extendedDrUntilMs = useSharedValue(0);
  const extendedDrSpeedMs = useSharedValue(0);
  const extendedDrHeading = useSharedValue(0);
  const lastDisplayPushMs = useSharedValue(0);
  const lastFrameMs = useSharedValue(0);
  const prevFrameLat = useSharedValue(0);
  const prevFrameLng = useSharedValue(0);
  const lastStallLogMs = useSharedValue(0);
  const lastFeedWallMs = useSharedValue(0);
  const lastFrameDiagLogMs = useSharedValue(0);
  const turnDrFreezeUntil = useSharedValue(0);

  useEffect(() => {
    frameActive.value = enabled ? 1 : 0;
    if (!enabled) {
      return;
    }

    const beginSegment = (
      fromLat: number,
      fromLng: number,
      fromHdg: number,
      toLat: number,
      toLng: number,
      toHdg: number,
      durationMs: number,
      now: number,
    ) => {
      segFromLat.value = fromLat;
      segFromLng.value = fromLng;
      segFromHdg.value = fromHdg;
      segToLat.value = toLat;
      segToLng.value = toLng;
      segToHdg.value = toHdg;
      segStartMs.value = now;
      segDurationMs.value = clampSegmentDurationMs(durationMs);
      segDistM.value = haversineMWorklet(fromLat, fromLng, toLat, toLng);
      inDeadReckoning.value = 0;
    };

    const onFeed = (target: SmoothTarget) => {
      if (!Number.isFinite(target.latitude) || !Number.isFinite(target.longitude)) {
        return;
      }
      if (isAbsurdGlobeCoordinate(target.latitude, target.longitude)) {
        return;
      }
      let feedHdg = Number.isFinite(target.heading) ? target.heading : anchorHdg.value;
      let feedLat = target.latitude;
      let feedLng = target.longitude;
      const now = Date.now();
      const instant = target.durationMs === 0;
      const src = String(target.source ?? '');
      const feedSpeedMsRaw = Number.isFinite(target.speedMs as number)
        ? (target.speedMs as number)
        : speedMs.value;
      const isDrivingLiveFeed = src.startsWith('v10_live_') || src === 'v10_apply_trip_instant';
      const isStationaryFeed =
        src === 'v10_stationary_hold'
        || (!isDrivingLiveFeed && (target.speedMs ?? 0) < STATIONARY_LOCK_SPEED_MS && !instant);

      // Low-pass B: gdy nowa kotwica mocno odbiega kierunkowo od aktualnego roadHdg/DR,
      // lekko tłumimy jej pozycję, żeby uniknąć mikro-teleportów i „wjeżdżania w krawężnik”.
      if (!instant && bootstrapped.value === 1) {
        const feedSpeedMs =
          Number.isFinite(target.speedMs as number) ? (target.speedMs as number) : speedMs.value;
        const feedKmh = (feedSpeedMs ?? 0) * 3.6;
        const distRaw = haversineMWorklet(lat.value, lng.value, feedLat, feedLng);
        if (feedKmh >= 30 && distRaw >= 6) {
          const brgToTarget = bearingBetweenWorklet(lat.value, lng.value, feedLat, feedLng);
          const dev = angleDeltaWorklet(brgToTarget, anchorHdg.value);
          if (dev >= 45) {
            const alpha = 0.28;
            feedLat = lat.value + (feedLat - lat.value) * alpha;
            feedLng = lng.value + (feedLng - lng.value) * alpha;
          }
        }
      }

      const distFromDisplayM = bootstrapped.value === 1
        ? haversineMWorklet(lat.value, lng.value, feedLat, feedLng)
        : 0;

      // Road geometry snapshot (small window) for DR along curve — przed backward guard.
      if (target.roadPts && Array.isArray(target.roadPts) && target.roadPts.length >= 2) {
        const flat: number[] = [];
        for (let i = 0; i < target.roadPts.length; i += 1) {
          const p = target.roadPts[i];
          if (!p) continue;
          if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
          flat.push(p.latitude, p.longitude);
        }
        if (flat.length >= 4) {
          const hdgJumpRoad = angleDeltaWorklet(anchorHdg.value, feedHdg);
          roadFlat.value = flat;
          if (hdgJumpRoad > 28 || instant) {
            roadIdx.value = findNearestRoadIndexWorklet(flat, lat.value, lng.value);
            turnDrFreezeUntil.value = now + TURN_DR_FREEZE_MS;
          } else {
            roadIdx.value = findNearestRoadIndexWorklet(flat, feedLat, feedLng);
          }
        }
      }

      let backwardRefHdg = anchorHdg.value;
      if (roadFlat.value.length >= ROAD_FLAT_MIN_LEN * 2) {
        const snapI = findNearestRoadIndexWorklet(roadFlat.value, lat.value, lng.value);
        const nRoad = roadLenWorklet(roadFlat.value);
        if (snapI >= 0 && snapI < nRoad - 1) {
          backwardRefHdg = bearingBetweenWorklet(
            roadGetLatWorklet(roadFlat.value, snapI),
            roadGetLngWorklet(roadFlat.value, snapI),
            roadGetLatWorklet(roadFlat.value, snapI + 1),
            roadGetLngWorklet(roadFlat.value, snapI + 1),
          );
        }
      }

      const feedBackwardAlongRoad =
        bootstrapped.value === 1
        && distFromDisplayM >= 2.5
        && distFromDisplayM <= 55
        && feedSpeedMsRaw >= 1.0
        && isBackwardStepWorklet(lat.value, lng.value, feedLat, feedLng, backwardRefHdg);

      let forceInstantLag = instant;
      const feedKmhForLag = (feedSpeedMsRaw > 0 ? feedSpeedMsRaw : speedMs.value) * 3.6;
      if (
        bootstrapped.value === 1
        && !instant
        && distFromDisplayM > MAX_DISPLAY_LAG_M
        && feedSpeedMsRaw >= 1.1
      ) {
        if (feedKmhForLag >= 22 && !feedBackwardAlongRoad) {
          lat.value = feedLat;
          lng.value = feedLng;
          forceInstantLag = true;
          runOnJS(logDisplayLagClamp)({
            distM: Math.round(distFromDisplayM),
            source: src,
            mode: 'instant',
          });
        } else if (!feedBackwardAlongRoad) {
          feedLat = lat.value + (feedLat - lat.value) * LAG_SOFT_BLEND_ALPHA;
          feedLng = lng.value + (feedLng - lng.value) * LAG_SOFT_BLEND_ALPHA;
          runOnJS(logDisplayLagClamp)({
            distM: Math.round(distFromDisplayM),
            source: src,
            mode: 'blend',
          });
        }
      }

      const distFromPinM = stationaryLocked.value === 1
        ? haversineMWorklet(pinLat.value, pinLng.value, feedLat, feedLng)
        : distFromDisplayM;
      const drivingContinuityEvidence =
        isDrivingLiveFeed
        && (
          feedSpeedMsRaw >= 0.8
          || distFromDisplayM >= 1.2
        );

      // Już zablokowany postój — odrzuć jitter snap/GPS (ghost speed bez ruchu).
      if (stationaryLocked.value === 1 && bootstrapped.value === 1) {
        speedMs.value = 0;
        inDeadReckoning.value = 0;
        const canRelease =
          drivingContinuityEvidence
          || (
          feedSpeedMsRaw >= STATIONARY_RELEASE_SPEED_MS
          || distFromPinM >= STATIONARY_RELEASE_MOVE_M
          || distFromDisplayM > 2.0
          );
        if (!canRelease) {
          anchorLat.value = pinLat.value;
          anchorLng.value = pinLng.value;
          anchorHdg.value = feedHdg;
          lastFeedWallMs.value = now;
          return;
        }
        stationaryLocked.value = 0;
        runOnJS(logStationaryLockTelemetry)({
          event: 'exit',
          source: src,
          speedMs: Number(feedSpeedMsRaw.toFixed(3)),
          distFromPinM: Number(distFromPinM.toFixed(2)),
        });
      }

      const effectivelyStopped =
        (src === 'v10_stationary_hold' && !drivingContinuityEvidence)
        || (!isDrivingLiveFeed && feedSpeedMsRaw < STATIONARY_LOCK_SPEED_MS && distFromDisplayM < 0.9);

      if (effectivelyStopped && bootstrapped.value === 1) {
        const wasLocked = stationaryLocked.value === 1;
        if (stationaryLocked.value === 0) {
          pinLat.value = lat.value;
          pinLng.value = lng.value;
        }
        stationaryLocked.value = 1;
        speedMs.value = 0;
        inDeadReckoning.value = 0;
        anchorLat.value = pinLat.value;
        anchorLng.value = pinLng.value;
        lat.value = pinLat.value;
        lng.value = pinLng.value;
        anchorHdg.value = feedHdg;
        lastFeedWallMs.value = now;
        if (!wasLocked) {
          runOnJS(logStationaryLockTelemetry)({
            event: 'enter',
            source: src,
            speedMs: Number(feedSpeedMsRaw.toFixed(3)),
            distFromDisplayM: Number(distFromDisplayM.toFixed(2)),
          });
        }
        return;
      }

      if (feedBackwardAlongRoad) {
        return;
      }

      if (bootstrapped.value === 1) {
        const hdgJump = angleDeltaWorklet(anchorHdg.value, feedHdg);
        if (hdgJump > 28 && distFromDisplayM < 15) {
          feedHdg = anchorHdg.value;
        }
      }

      if (isStationaryFeed) {
        speedMs.value = 0;
        if (bootstrapped.value === 1 && distFromDisplayM < STATIONARY_MAX_ANCHOR_DRIFT_M) {
          return;
        }
      } else if (target.speedMs != null && Number.isFinite(target.speedMs) && target.speedMs > 0) {
        speedMs.value = target.speedMs;
        if (target.speedMs >= DR_MIN_SPEED_MS) {
          extendedDrUntilMs.value = 0;
          extendedDrSpeedMs.value = target.speedMs;
          extendedDrHeading.value = feedHdg;
        }
      }

      if (
        !instant
        && feedSpeedMsRaw < STATIONARY_LOCK_SPEED_MS
        && speedMs.value >= DR_MIN_SPEED_MS
        && distFromDisplayM >= 6
      ) {
        extendedDrUntilMs.value = now + 5000;
        extendedDrSpeedMs.value = Math.max(extendedDrSpeedMs.value, speedMs.value);
        extendedDrHeading.value = anchorHdg.value;
      }

      anchorLat.value = feedLat;
      anchorLng.value = feedLng;
      anchorHdg.value = feedHdg;
      lastFeedWallMs.value = now;

      let segmentMs = forceInstantLag ? 0 : (target.durationMs ?? 500);
      if (!forceInstantLag && distFromDisplayM >= BIG_CATCHUP_M) {
        const cruise = Math.max(target.speedMs ?? speedMs.value, CRUISE_MIN_MS);
        segmentMs = Math.max(
          segmentMs,
          Math.min(SEG_DURATION_MAX_MS, Math.round(distFromDisplayM / Math.max(cruise, 1.5) * 1000)),
        );
      }

      if (instant || forceInstantLag || bootstrapped.value === 0) {
        lat.value = feedLat;
        lng.value = feedLng;
        heading.value = feedHdg;
        prevFrameLat.value = feedLat;
        prevFrameLng.value = feedLng;
        bootstrapped.value = 1;
        beginSegment(
          feedLat,
          feedLng,
          feedHdg,
          feedLat,
          feedLng,
          feedHdg,
          segmentMs,
          now,
        );
        inDeadReckoning.value = 0;
        if (instant || forceInstantLag) {
          notifySmoothPositionDisplay(feedLat, feedLng, feedHdg);
        }
      } else if (isStationaryFeed && distFromDisplayM < STATIONARY_MAX_ANCHOR_DRIFT_M) {
        lat.value = feedLat;
        lng.value = feedLng;
        heading.value = feedHdg;
        beginSegment(
          feedLat,
          feedLng,
          feedHdg,
          feedLat,
          feedLng,
          feedHdg,
          segmentMs,
          now,
        );
        inDeadReckoning.value = 0;
      } else {
        const fromLat = lat.value;
        const fromLng = lng.value;
        const fromHdg = heading.value;
        beginSegment(
          fromLat,
          fromLng,
          fromHdg,
          feedLat,
          feedLng,
          feedHdg,
          segmentMs,
          now,
        );
      }

      if (instant || distFromDisplayM > 28) {
        logWorkletStateCheck({
          phase: 'onFeed',
          source: src,
          instant,
          distAnchorM: Number(distFromDisplayM.toFixed(2)),
          segmentMs,
          speedMs: target.speedMs ?? null,
        });
      }
    };

    registerSmoothPositionHandler(onFeed, 'trip-smooth-map-position');
    return () => {
      registerSmoothPositionHandler(null, 'trip-smooth-map-position');
      bootstrapped.value = 0;
      speedMs.value = 0;
      extendedDrUntilMs.value = 0;
      extendedDrSpeedMs.value = 0;
      segStartMs.value = 0;
      inDeadReckoning.value = 0;
      stationaryLocked.value = 0;
      pinLat.value = 0;
      pinLng.value = 0;
      roadFlat.value = [];
      roadIdx.value = 0;
      lastFrameMs.value = 0;
      lastStallLogMs.value = 0;
      clearSmoothPositionFeed();
    };
  }, [
    enabled,
    frameActive,
    anchorHdg,
    anchorLat,
    anchorLng,
    roadFlat,
    roadIdx,
    bootstrapped,
    heading,
    inDeadReckoning,
    stationaryLocked,
    pinLat,
    pinLng,
    lat,
    lng,
    prevFrameLat,
    prevFrameLng,
    segDurationMs,
    segDistM,
    segFromHdg,
    segFromLat,
    segFromLng,
    segStartMs,
    segToHdg,
    segToLat,
    segToLng,
    speedMs,
    extendedDrUntilMs,
    extendedDrSpeedMs,
    extendedDrHeading,
    lastStallLogMs,
    lastFeedWallMs,
    lastFrameDiagLogMs,
  ]);

  useFrameCallback(
    () => {
      'worklet';
      if (frameActive.value === 0 || bootstrapped.value === 0) return;

      const now = Date.now();
      const prevFrame = lastFrameMs.value > 0 ? lastFrameMs.value : now - 16;
      const frameDtSec = clampWorklet((now - prevFrame) / 1000, 0.008, 0.1);
      lastFrameMs.value = now;

      const extendedDrActive = now < extendedDrUntilMs.value && extendedDrSpeedMs.value >= DR_MIN_SPEED_MS;
      const fallbackCruiseMs = extendedDrActive
        ? Math.max(DR_MIN_SPEED_MS, extendedDrSpeedMs.value * 0.88)
        : 0;
      const cruiseMs = speedMs.value >= CRUISE_MIN_MS ? speedMs.value : fallbackCruiseMs;
      const headingLockToRoad = cruiseMs >= HEADING_LOCK_SPEED_MS;
      const roadHdg = extendedDrActive ? extendedDrHeading.value : anchorHdg.value;
      const maxHdgStep = MAX_HEADING_RATE_DPS * frameDtSec;
      const frozen =
        stationaryLocked.value === 1
        || cruiseMs < CRUISE_MIN_MS;

      if (frozen) {
        if (stationaryLocked.value === 1) {
          lat.value = pinLat.value;
          lng.value = pinLng.value;
          anchorLat.value = pinLat.value;
          anchorLng.value = pinLng.value;
        } else {
          lat.value = anchorLat.value;
          lng.value = anchorLng.value;
        }
        speedMs.value = 0;
        if (cruiseMs > ZERO_SPEED_EPS_MS) {
          heading.value = lerpHeadingCappedWorklet(heading.value, roadHdg, maxHdgStep);
        }
        inDeadReckoning.value = 0;
        segStartMs.value = now;
        segFromLat.value = lat.value;
        segFromLng.value = lng.value;
        segToLat.value = lat.value;
        segToLng.value = lng.value;
        segDistM.value = 0;
      } else if (cruiseMs < DR_MIN_SPEED_MS) {
        const segDur = Math.max(1, segDurationMs.value);
        const elapsed = now - segStartMs.value;
        const elapsedSec = elapsed / 1000;
        const distU = segDistM.value > 0.05
          ? clampWorklet((cruiseMs * elapsedSec) / segDistM.value, 0, 1)
          : 1;
        const u = distU;
        if (u < 1) {
          inDeadReckoning.value = 0;
          const nextLat = segFromLat.value + (segToLat.value - segFromLat.value) * u;
          const nextLng = segFromLng.value + (segToLng.value - segFromLng.value) * u;
          const maxStepM = Math.max(0.02, cruiseMs * frameDtSec * 1.05);
          const candDistM = haversineMWorklet(lat.value, lng.value, nextLat, nextLng);
          if (candDistM > maxStepM) {
            const stepped = stepTowardWorklet(lat.value, lng.value, nextLat, nextLng, maxStepM, roadHdg);
            lat.value = stepped.lat;
            lng.value = stepped.lng;
          } else if (!isBackwardStepWorklet(lat.value, lng.value, nextLat, nextLng, roadHdg)) {
            lat.value = nextLat;
            lng.value = nextLng;
          }
          if (headingLockToRoad) {
            heading.value = roadHdg;
          } else {
            const segTargetHdg = lerpHeadingLinearWorklet(segFromHdg.value, segToHdg.value, u);
            heading.value = lerpHeadingCappedWorklet(heading.value, segTargetHdg, maxHdgStep);
          }
        } else {
          lat.value = segToLat.value;
          lng.value = segToLng.value;
          inDeadReckoning.value = 0;
          heading.value = headingLockToRoad
            ? roadHdg
            : lerpHeadingCappedWorklet(heading.value, roadHdg, maxHdgStep);
        }
      } else {
        const segDur = Math.max(1, segDurationMs.value);
        const elapsed = now - segStartMs.value;
        const elapsedSec = elapsed / 1000;
        const distU = segDistM.value > 0.05
          ? clampWorklet((cruiseMs * elapsedSec) / segDistM.value, 0, 1)
          : 1;
        const u = distU;
        const feedGapMs = lastFeedWallMs.value > 0 ? now - lastFeedWallMs.value : 0;
        const feedStale = feedGapMs > FEED_GAP_DR_MS;
        const forceGapDr = feedStale && cruiseMs >= DR_MIN_SPEED_MS;

        if (u < 1 && !forceGapDr) {
          inDeadReckoning.value = 0;
          const nextLat = segFromLat.value + (segToLat.value - segFromLat.value) * u;
          const nextLng = segFromLng.value + (segToLng.value - segFromLng.value) * u;
          const maxStepM = Math.max(0.02, cruiseMs * frameDtSec * 1.05);
          const candDistM = haversineMWorklet(lat.value, lng.value, nextLat, nextLng);
          if (candDistM > maxStepM) {
            const stepped = stepTowardWorklet(lat.value, lng.value, nextLat, nextLng, maxStepM, roadHdg);
            lat.value = stepped.lat;
            lng.value = stepped.lng;
          } else if (!isBackwardStepWorklet(lat.value, lng.value, nextLat, nextLng, roadHdg)) {
            lat.value = nextLat;
            lng.value = nextLng;
          }
          if (headingLockToRoad) {
            heading.value = roadHdg;
          } else {
            const segTargetHdg = lerpHeadingLinearWorklet(segFromHdg.value, segToHdg.value, u);
            heading.value = lerpHeadingCappedWorklet(heading.value, segTargetHdg, maxHdgStep);
          }
        } else if (forceGapDr || cruiseMs >= DR_MIN_SPEED_MS) {
          inDeadReckoning.value = 1;
          const drStepM = cruiseMs * frameDtSec;
          // DR along road geometry if available; fallback to bearing only when missing.
          if (roadFlat.value.length >= ROAD_FLAT_MIN_LEN) {
            const nRoad = roadLenWorklet(roadFlat.value);
            const prevRoadIdx = roadIdx.value;
            const next = advanceAlongRoadWorklet(
              roadFlat.value,
              roadIdx.value,
              lat.value,
              lng.value,
              drStepM,
            );
            const roadDrMoveM = haversineMWorklet(lat.value, lng.value, next.lat, next.lng);
            const turnFreeze = now < turnDrFreezeUntil.value;
            if (turnFreeze && Math.abs(next.idx - prevRoadIdx) > 3) {
              roadIdx.value = prevRoadIdx;
            } else {
              roadIdx.value = next.idx;
            }
            const roadDrStalled =
              roadDrMoveM < 0.03
              && nRoad <= ROAD_FLAT_MIN_LEN + 1
              && next.idx >= Math.max(0, nRoad - 2);
            if (roadDrStalled) {
              const advanced = moveAlongBearingWorklet(lat.value, lng.value, roadHdg, drStepM);
              if (!isBackwardStepWorklet(lat.value, lng.value, advanced.lat, advanced.lng, roadHdg)) {
                lat.value = advanced.lat;
                lng.value = advanced.lng;
              }
            } else if (!isBackwardStepWorklet(lat.value, lng.value, next.lat, next.lng, roadHdg)) {
              lat.value = next.lat;
              lng.value = next.lng;
            }
          } else {
            const advanced = moveAlongBearingWorklet(lat.value, lng.value, roadHdg, drStepM);
            const distToAnchorM = haversineMWorklet(
              lat.value,
              lng.value,
              anchorLat.value,
              anchorLng.value,
            );
            if (!isBackwardStepWorklet(lat.value, lng.value, advanced.lat, advanced.lng, roadHdg)) {
              if (distToAnchorM > 25) {
                lat.value = lat.value + (advanced.lat - lat.value) * 0.7;
                lng.value = lng.value + (advanced.lng - lng.value) * 0.7;
              } else {
                lat.value = advanced.lat;
                lng.value = advanced.lng;
              }
            }
          }
          heading.value = headingLockToRoad
            ? roadHdg
            : lerpHeadingCappedWorklet(heading.value, roadHdg, maxHdgStep);
        } else {
          lat.value = segToLat.value;
          lng.value = segToLng.value;
          inDeadReckoning.value = 0;
          heading.value = headingLockToRoad
            ? roadHdg
            : lerpHeadingCappedWorklet(heading.value, roadHdg, maxHdgStep);
        }
      }

      const distAnchorM = haversineMWorklet(lat.value, lng.value, anchorLat.value, anchorLng.value);
      const frameMoveM = haversineMWorklet(prevFrameLat.value, prevFrameLng.value, lat.value, lng.value);
      prevFrameLat.value = lat.value;
      prevFrameLng.value = lng.value;

      if (now - lastDisplayPushMs.value >= DISPLAY_PUSH_MS) {
        lastDisplayPushMs.value = now;
        runOnJS(notifySmoothPositionDisplay)(lat.value, lng.value, heading.value);
      }

      if (
        cruiseMs >= CRUISE_MIN_MS
        && frameMoveM < 0.03
        && distAnchorM > 4
        && inDeadReckoning.value === 0
        && now - lastStallLogMs.value >= WORKLET_STALL_MS
      ) {
        lastStallLogMs.value = now;
        runOnJS(logWorkletStall)({
          distAnchorM: Number(distAnchorM.toFixed(2)),
          cruiseMs: Number(cruiseMs.toFixed(2)),
          segmentMs: segDurationMs.value,
        });
      }

      if (distAnchorM > 18 || now - lastFrameDiagLogMs.value >= 1500) {
        lastFrameDiagLogMs.value = now;
        runOnJS(logWorkletFrameDiag)({
          speedMs: Number(cruiseMs.toFixed(2)),
          distToAnchorM: Number(distAnchorM.toFixed(2)),
          frameMoveM: Number(frameMoveM.toFixed(2)),
          inDeadReckoning: inDeadReckoning.value === 1,
          segmentU: Number(
            clampWorklet((now - segStartMs.value) / Math.max(1, segDurationMs.value), 0, 1).toFixed(3),
          ),
        });
      }
    },
    true,
  );

  return { lat, lng, heading };
}
