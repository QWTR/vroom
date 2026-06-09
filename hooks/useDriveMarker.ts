import { useCallback, useEffect, useMemo } from 'react';
import {
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import type { ArcWindowSlice } from '../lib/driveCore/geo';

const DRIVE_V2_PIPELINE_DEBUG = false;

const MAX_AHEAD_ARC_M = 12.0;

/** Dynamiczny limit wyprzedzenia targetArcM — skaluje z prędkością (m). */
function maxAheadArcMWorklet(speedMs: number): number {
  'worklet';
  const v = Math.max(0, speedMs);
  return Math.min(18, Math.max(MAX_AHEAD_ARC_M, v * 2.8 + 4));
}

export function maxAheadArcM(speedMs: number): number {
  const v = Math.max(0, speedMs);
  return Math.min(18, Math.max(MAX_AHEAD_ARC_M, v * 2.8 + 4));
}

const MIN_CRUISE_MS = 0.35;
const MAX_HEADING_RATE_DPS = 95;
/** Min. czas segmentu — zsynchronizowany z TRIP_SEGMENT_MIN_MS / kamera segmentSync. */
const SEGMENT_MIN_MS = 320;
/** Przy zmianie okna arc — twardy snap tylko gdy gap przekracza ten próg (m). */
const POLYLINE_KEY_HARD_SNAP_M = 45;

export type DriveMarkerArcFeed = {
  targetArcM: number;
  baseArcM: number;
  /** [lat0,lng0,lat1,lng1,...] */
  ptsFlat: number[];
  cumM: number[];
  polylineKey: string;
};

export type DriveMarkerValues = {
  lat: SharedValue<number>;
  lng: SharedValue<number>;
  heading: SharedValue<number>;
  /** Ostatni segment GPS (ms) — synchronizacja z kamerą Mapbox. */
  segmentDurationMs: SharedValue<number>;
};

export type DriveMarkerTarget = {
  lat: number;
  lng: number;
  heading: number;
  durationMs?: number;
  allowInstant?: boolean;
  onRoad?: boolean;
  targetArcM?: number;
  arcWindow?: ArcWindowSlice | null;
  polylineKey?: string;
  speedMs?: number;
};

function logWorkletDiag(payload: Record<string, unknown>): void {
  if (!DRIVE_V2_PIPELINE_DEBUG) return;
  console.log('[DEBUG_WORKLET_ARC]', payload);
}

function clampSegmentDurationMs(ms: number | undefined, allowInstant: boolean): number {
  if (allowInstant && ms === 0) return 0;
  const v = Number.isFinite(ms) && (ms as number) > 0 ? (ms as number) : 650;
  return Math.max(SEGMENT_MIN_MS, Math.min(1200, v));
}

function smoothstepWorklet(t: number): number {
  'worklet';
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

function normalizeHeadingJs(h: number): number {
  return ((h % 360) + 360) % 360;
}

function normalizeHeadingW(h: number): number {
  'worklet';
  return ((h % 360) + 360) % 360;
}

function headingDeltaW(from: number, to: number): number {
  'worklet';
  return ((to - from + 540) % 360) - 180;
}

function clampWorklet(n: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, n));
}

function haversineMJs(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - s1 - s2));
}

function bearingBetweenJs(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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

function lerpHeadingCappedWorklet(from: number, to: number, maxDeltaDeg: number): number {
  'worklet';
  const diff = headingDeltaW(from, to);
  const clamped = Math.max(-maxDeltaDeg, Math.min(maxDeltaDeg, diff));
  return normalizeHeadingW(from + clamped);
}

function pointAtWindowArcLocalCore(
  ptsFlat: number[],
  cumM: number[],
  localM: number,
): { lat: number; lng: number; heading: number } {
  const n = cumM.length;
  if (n < 2 || ptsFlat.length < 4) {
    return { lat: NaN, lng: NaN, heading: 0 };
  }
  const total = cumM[n - 1];
  const clamped = Math.max(0, Math.min(total, localM));
  let seg = 0;
  for (let i = 0; i < n - 1; i += 1) {
    if (clamped <= cumM[i + 1]) {
      seg = i;
      break;
    }
    seg = i;
  }
  const segLen = Math.max(0.001, cumM[seg + 1] - cumM[seg]);
  const t = (clamped - cumM[seg]) / segLen;
  const aLat = ptsFlat[seg * 2];
  const aLng = ptsFlat[seg * 2 + 1];
  const bLat = ptsFlat[(seg + 1) * 2];
  const bLng = ptsFlat[(seg + 1) * 2 + 1];
  const lat = aLat + (bLat - aLat) * t;
  const lng = aLng + (bLng - aLng) * t;
  const heading = bearingBetweenJs(aLat, aLng, bLat, bLng);
  return { lat, lng, heading };
}

/** Pozycja na wycinku okna arc (localM wzdłuż cumM okna) — UI thread. */
function pointAtWindowArcLocal(
  ptsFlat: number[],
  cumM: number[],
  localM: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  const n = cumM.length;
  if (n < 2 || ptsFlat.length < 4) {
    return { lat: NaN, lng: NaN, heading: 0 };
  }
  const total = cumM[n - 1];
  const clamped = Math.max(0, Math.min(total, localM));
  let seg = 0;
  for (let i = 0; i < n - 1; i += 1) {
    if (clamped <= cumM[i + 1]) {
      seg = i;
      break;
    }
    seg = i;
  }
  const segLen = Math.max(0.001, cumM[seg + 1] - cumM[seg]);
  const t = (clamped - cumM[seg]) / segLen;
  const aLat = ptsFlat[seg * 2];
  const aLng = ptsFlat[seg * 2 + 1];
  const bLat = ptsFlat[(seg + 1) * 2];
  const bLng = ptsFlat[(seg + 1) * 2 + 1];
  const lat = aLat + (bLat - aLat) * t;
  const lng = aLng + (bLng - aLng) * t;
  const heading = bearingBetweenWorklet(aLat, aLng, bLat, bLng);
  return { lat, lng, heading };
}

function packArcWindowFeed(window: ArcWindowSlice, polylineKey: string): DriveMarkerArcFeed | null {
  if (!window || window.points.length < 2 || window.cumM.length < 2) return null;
  const ptsFlat: number[] = [];
  for (let i = 0; i < window.points.length; i += 1) {
    const p = window.points[i];
    if (!p) continue;
    ptsFlat.push(p.lat, p.lng);
  }
  if (ptsFlat.length < 4) return null;
  return {
    targetArcM: 0,
    baseArcM: window.baseArcM,
    ptsFlat,
    cumM: window.cumM.slice(),
    polylineKey,
  };
}

function applyInstantPose(
  lat: number,
  lng: number,
  hdg: number,
  arcM: number,
  sv: {
    lat: SharedValue<number>;
    lng: SharedValue<number>;
    heading: SharedValue<number>;
    displayArcM: SharedValue<number>;
    targetArcM: SharedValue<number>;
    targetLat: SharedValue<number>;
    targetLng: SharedValue<number>;
    targetHdg: SharedValue<number>;
    onRoad: SharedValue<number>;
    frameActive: SharedValue<number>;
  },
): void {
  sv.lat.value = lat;
  sv.lng.value = lng;
  sv.heading.value = hdg;
  sv.displayArcM.value = arcM;
  sv.targetArcM.value = arcM;
  sv.targetLat.value = lat;
  sv.targetLng.value = lng;
  sv.targetHdg.value = hdg;
  sv.onRoad.value = 1;
  sv.frameActive.value = 1;
}

/**
 * Marker V2 — czysty integrator arc (speedMs * dt), 60 FPS.
 * Pozycja i heading wyłącznie z pointAtWindowArcLocal gdy jest geometria drogi.
 */
export function useDriveMarker(
  enabled: boolean,
  getTripActive?: () => boolean,
): DriveMarkerValues & {
  pushTarget: (t: DriveMarkerTarget) => void;
  reset: (anchor?: { lat: number; lng: number; heading?: number }) => void;
  resetTo: (lat: number, lng: number, heading: number) => void;
  ensureFrameActive: () => void;
} {
  const lat = useSharedValue(NaN);
  const lng = useSharedValue(NaN);
  const heading = useSharedValue(0);
  const enabledSv = useSharedValue(enabled ? 1 : 0);
  const segmentDurationMs = useSharedValue(650);

  const displayArcM = useSharedValue(0);
  const targetArcM = useSharedValue(0);
  const baseArcM = useSharedValue(0);
  const roadPtsFlat = useSharedValue<number[]>([]);
  const roadCumM = useSharedValue<number[]>([]);
  const polylineKeySv = useSharedValue('');
  const onRoad = useSharedValue(0);
  const speedMs = useSharedValue(0);
  const targetLat = useSharedValue(NaN);
  const targetLng = useSharedValue(NaN);
  const targetHdg = useSharedValue(0);
  const frameActive = useSharedValue(0);
  const lastFrameTimestamp = useSharedValue(0);
  const segWallStartMs = useSharedValue(0);
  const segFromLat = useSharedValue(NaN);
  const segFromLng = useSharedValue(NaN);
  const segFromHdg = useSharedValue(0);

  const frameCallback = useFrameCallback((frameInfo) => {
    'worklet';
    if (enabledSv.value < 0.5) return;
    if (!Number.isFinite(lat.value) || !Number.isFinite(lng.value)) return;

    const tspf = frameInfo.timeSincePreviousFrame;
    let dt = 1 / 60;
    if (tspf != null && tspf > 0) {
      dt = clampWorklet(tspf / 1000, 0.008, 0.05);
    } else if (lastFrameTimestamp.value > 0) {
      dt = clampWorklet(
        (frameInfo.timestamp - lastFrameTimestamp.value) / 1000,
        0.008,
        0.05,
      );
    }
    lastFrameTimestamp.value = frameInfo.timestamp;
    if (segWallStartMs.value <= 0) {
      segWallStartMs.value = frameInfo.timestamp;
    }

    const cruiseMs = speedMs.value >= MIN_CRUISE_MS ? speedMs.value : 0;
    const maxHdgStep = MAX_HEADING_RATE_DPS * dt;

    if (onRoad.value >= 0.5) {
      const pts = roadPtsFlat.value;
      const cum = roadCumM.value;
      if (pts.length >= 4 && cum.length >= 2) {
        const gap = targetArcM.value - displayArcM.value;
        const samePolyline = polylineKeySv.value.length > 0;
        let effectiveCruiseMs = cruiseMs;
        if (samePolyline && gap < 0) {
          effectiveCruiseMs = 0;
        }

        let nextArcM = displayArcM.value + effectiveCruiseMs * dt;
        if (gap >= 0) {
          if (nextArcM > targetArcM.value) {
            nextArcM = targetArcM.value;
          }
        } else if (samePolyline) {
          nextArcM = displayArcM.value;
        }

        displayArcM.value = nextArcM;

        const localM = displayArcM.value - baseArcM.value;
        const pose = pointAtWindowArcLocal(pts, cum, localM);
        if (Number.isFinite(pose.lat) && Number.isFinite(pose.lng)) {
          lat.value = pose.lat;
          lng.value = pose.lng;
          const roadHdg = normalizeHeadingW(pose.heading);
          heading.value = lerpHeadingCappedWorklet(heading.value, roadHdg, maxHdgStep);
        }
      }
    } else {
      const tLat = targetLat.value;
      const tLng = targetLng.value;
      if (Number.isFinite(tLat) && Number.isFinite(tLng)) {
        const segDur = Math.max(SEGMENT_MIN_MS, segmentDurationMs.value);
        const segStart = segWallStartMs.value;
        const elapsedMs = segStart > 0 ? frameInfo.timestamp - segStart : 0;
        const segT = segDur > 0 ? clampWorklet(elapsedMs / segDur, 0, 1) : 1;
        const u = smoothstepWorklet(segT);

        const fromLat = Number.isFinite(segFromLat.value) ? segFromLat.value : lat.value;
        const fromLng = Number.isFinite(segFromLng.value) ? segFromLng.value : lng.value;
        lat.value = fromLat + (tLat - fromLat) * u;
        lng.value = fromLng + (tLng - fromLng) * u;

        const fromHdg = Number.isFinite(segFromHdg.value) ? segFromHdg.value : heading.value;
        const tgtHdg = Number.isFinite(targetHdg.value) ? targetHdg.value : fromHdg;
        const blendedHdg = lerpHeadingCappedWorklet(
          fromHdg,
          tgtHdg,
          Math.abs(headingDeltaW(fromHdg, tgtHdg)) * u,
        );
        heading.value = lerpHeadingCappedWorklet(heading.value, blendedHdg, maxHdgStep);
      }
    }
  }, false);

  const pushTarget = useCallback((t: DriveMarkerTarget) => {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) return;

    const tgtHdg = Number.isFinite(t.heading)
      ? normalizeHeadingJs(t.heading)
      : (Number.isFinite(heading.value) ? heading.value : 0);
    const allowInstant = t.allowInstant === true;
    const segDur = clampSegmentDurationMs(t.durationMs, allowInstant);
    segmentDurationMs.value = allowInstant && segDur === 0 ? SEGMENT_MIN_MS : segDur;
    segWallStartMs.value = 0;
    segFromLat.value = Number.isFinite(lat.value) ? lat.value : t.lat;
    segFromLng.value = Number.isFinite(lng.value) ? lng.value : t.lng;
    segFromHdg.value = Number.isFinite(heading.value) ? heading.value : tgtHdg;

    const road = t.onRoad === true
      && t.arcWindow != null
      && Number.isFinite(t.targetArcM);
    const arcFeed = road
      ? packArcWindowFeed(t.arcWindow!, t.polylineKey ?? '')
      : null;
    const useArc = road && arcFeed != null;

    const feedSpeed = Number.isFinite(t.speedMs) && (t.speedMs as number) > 0
      ? (t.speedMs as number)
      : 0;
    speedMs.value = feedSpeed;
    targetLat.value = t.lat;
    targetLng.value = t.lng;
    targetHdg.value = tgtHdg;
    frameActive.value = 1;

    const instantSv = {
      lat,
      lng,
      heading,
      displayArcM,
      targetArcM,
      targetLat,
      targetLng,
      targetHdg,
      onRoad,
      frameActive,
    };

    if (!Number.isFinite(lat.value) || !Number.isFinite(lng.value)) {
      if (useArc && arcFeed) {
        roadPtsFlat.value = arcFeed.ptsFlat;
        roadCumM.value = arcFeed.cumM;
        baseArcM.value = arcFeed.baseArcM;
        polylineKeySv.value = arcFeed.polylineKey;
        onRoad.value = 1;
        const arcM = t.targetArcM as number;
        targetArcM.value = arcM;
        const localM = arcM - arcFeed.baseArcM;
        const pose = pointAtWindowArcLocalCore(arcFeed.ptsFlat, arcFeed.cumM, localM);
        applyInstantPose(
          Number.isFinite(pose.lat) ? pose.lat : t.lat,
          Number.isFinite(pose.lng) ? pose.lng : t.lng,
          Number.isFinite(pose.heading) ? pose.heading : tgtHdg,
          arcM,
          instantSv,
        );
      } else {
        onRoad.value = 0;
        applyInstantPose(t.lat, t.lng, tgtHdg, 0, instantSv);
        onRoad.value = 0;
      }
      logWorkletDiag({ mode: 'instant_bootstrap', onRoad: useArc });
      return;
    }

    if (allowInstant && segDur === 0) {
      if (useArc && arcFeed) {
        roadPtsFlat.value = arcFeed.ptsFlat;
        roadCumM.value = arcFeed.cumM;
        baseArcM.value = arcFeed.baseArcM;
        polylineKeySv.value = arcFeed.polylineKey;
        onRoad.value = 1;
        const arcM = t.targetArcM as number;
        const localM = arcM - arcFeed.baseArcM;
        const pose = pointAtWindowArcLocalCore(arcFeed.ptsFlat, arcFeed.cumM, localM);
        applyInstantPose(
          Number.isFinite(pose.lat) ? pose.lat : t.lat,
          Number.isFinite(pose.lng) ? pose.lng : t.lng,
          Number.isFinite(pose.heading) ? pose.heading : tgtHdg,
          arcM,
          instantSv,
        );
      } else {
        onRoad.value = 0;
        applyInstantPose(t.lat, t.lng, tgtHdg, 0, instantSv);
        onRoad.value = 0;
      }
      logWorkletDiag({ mode: 'instant_allowInstant', onRoad: useArc });
      return;
    }

    if (useArc && arcFeed) {
      const key = arcFeed.polylineKey;
      const keyChanged = key.length > 0 && key !== polylineKeySv.value;
      roadPtsFlat.value = arcFeed.ptsFlat;
      roadCumM.value = arcFeed.cumM;
      baseArcM.value = arcFeed.baseArcM;
      polylineKeySv.value = key;
      onRoad.value = 1;
      const arcM = t.targetArcM as number;
      targetArcM.value = arcM;
      const gapBeforeKey = arcM - displayArcM.value;
      if (keyChanged) {
        const localM = arcM - arcFeed.baseArcM;
        const pose = pointAtWindowArcLocalCore(arcFeed.ptsFlat, arcFeed.cumM, localM);
        if (Math.abs(gapBeforeKey) >= POLYLINE_KEY_HARD_SNAP_M) {
          displayArcM.value = arcM;
          if (Number.isFinite(pose.lat) && Number.isFinite(pose.lng)) {
            lat.value = pose.lat;
            lng.value = pose.lng;
            heading.value = Number.isFinite(pose.heading) ? pose.heading : tgtHdg;
          }
        } else if (Number.isFinite(pose.lat) && Number.isFinite(pose.lng)) {
          const reprojGapM = haversineMJs(lat.value, lng.value, pose.lat, pose.lng);
          if (reprojGapM < POLYLINE_KEY_HARD_SNAP_M) {
            displayArcM.value = arcM - reprojGapM * 0.15;
          }
        }
      }
      logWorkletDiag({
        mode: 'arc_target_update',
        targetArcM: Number(arcM.toFixed(1)),
        displayArcM: Number(displayArcM.value.toFixed(1)),
        keyChanged,
      });
    } else {
      onRoad.value = 0;
      logWorkletDiag({ mode: 'offroad_target_update' });
    }
  }, [
    baseArcM,
    displayArcM,
    frameActive,
    heading,
    lat,
    lng,
    onRoad,
    polylineKeySv,
    roadCumM,
    roadPtsFlat,
    segmentDurationMs,
    segFromHdg,
    segFromLat,
    segFromLng,
    segWallStartMs,
    speedMs,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
  ]);

  const reset = useCallback((anchor?: { lat: number; lng: number; heading?: number }) => {
    frameActive.value = 0;
    onRoad.value = 0;
    roadPtsFlat.value = [];
    roadCumM.value = [];
    polylineKeySv.value = '';
    displayArcM.value = 0;
    targetArcM.value = 0;
    baseArcM.value = 0;
    speedMs.value = 0;
    lastFrameTimestamp.value = 0;
    segWallStartMs.value = 0;
    segFromLat.value = NaN;
    segFromLng.value = NaN;
    segFromHdg.value = 0;

    if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
      const hdg = Number.isFinite(anchor.heading) ? anchor.heading! : 0;
      lat.value = anchor.lat;
      lng.value = anchor.lng;
      heading.value = hdg;
      targetLat.value = anchor.lat;
      targetLng.value = anchor.lng;
      targetHdg.value = hdg;
    } else {
      lat.value = NaN;
      lng.value = NaN;
      heading.value = 0;
      targetLat.value = NaN;
      targetLng.value = NaN;
      targetHdg.value = 0;
    }
  }, [
    baseArcM,
    displayArcM,
    frameActive,
    heading,
    lat,
    lastFrameTimestamp,
    lng,
    onRoad,
    polylineKeySv,
    roadCumM,
    roadPtsFlat,
    speedMs,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
    segFromHdg,
    segFromLat,
    segFromLng,
    segWallStartMs,
  ]);

  const resetTo = useCallback((targetLatVal: number, targetLngVal: number, hdg: number) => {
    if (!Number.isFinite(targetLatVal) || !Number.isFinite(targetLngVal)) return;
    const normHdg = Number.isFinite(hdg) ? normalizeHeadingJs(hdg) : 0;
    lat.value = targetLatVal;
    lng.value = targetLngVal;
    heading.value = normHdg;
    targetLat.value = targetLatVal;
    targetLng.value = targetLngVal;
    targetHdg.value = normHdg;
    displayArcM.value = 0;
    targetArcM.value = 0;
    onRoad.value = 0;
    frameActive.value = 1;
    lastFrameTimestamp.value = 0;
    segmentDurationMs.value = SEGMENT_MIN_MS;
    segWallStartMs.value = 0;
    segFromLat.value = targetLatVal;
    segFromLng.value = targetLngVal;
    segFromHdg.value = normHdg;
  }, [
    displayArcM,
    frameActive,
    heading,
    lat,
    lastFrameTimestamp,
    lng,
    onRoad,
    segmentDurationMs,
    segFromHdg,
    segFromLat,
    segFromLng,
    segWallStartMs,
    targetArcM,
    targetHdg,
    targetLat,
    targetLng,
  ]);

  const tripActive = useCallback(() => {
    if (getTripActive) return getTripActive();
    return enabled;
  }, [enabled, getTripActive]);

  const ensureFrameActive = useCallback(() => {
    if (!tripActive()) return;
    enabledSv.value = 1;
    frameCallback.setActive(true);
  }, [tripActive, frameCallback, enabledSv]);

  useEffect(() => {
    const syncActive = () => {
      const on = tripActive();
      enabledSv.value = on ? 1 : 0;
      frameCallback.setActive(on);
    };
    syncActive();
    return () => {
      frameCallback.setActive(false);
    };
  }, [tripActive, frameCallback, enabledSv]);

  return useMemo(
    () => ({
      lat,
      lng,
      heading,
      segmentDurationMs,
      pushTarget,
      reset,
      resetTo,
      ensureFrameActive,
    }),
    [
      ensureFrameActive,
      heading,
      lat,
      lng,
      pushTarget,
      reset,
      resetTo,
      segmentDurationMs,
    ],
  );
}
