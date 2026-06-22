import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { normalizeMediaUri } from '../lib/mediaUri';
import { calculateDistance } from '../scripts/distance';
import type { LiveUserPinSpriteData } from '../components/map/LiveUserPinSpriteVisual';
import { buildPinSpriteSignature } from './useLiveUserPinSprites';
import {
  correctionDurationForDistance,
  shouldPublishFleetFrame,
} from './liveFleetMotion';
import {
  EMPTY_VIEWPORT,
  expandBoundsByMeters,
  isInViewport,
  type ViewportBounds,
} from './liveFleetSpatialIndex';
import type { LiveMapStore } from './liveMapStore';

const MAX_DT_SEC = 0.05;
/** Czas coasting między pakietami (~15 s cadence wysyłki). */
const COAST_MAX_MS = 17_000;
const MIN_COAST_SPEED_MPS = 0.5;
const MAX_SPEED_MPS = 55;
const HEADING_LERP_RATE = 8;
const VIEWPORT_ENTER_MARGIN_M = 1_000;
const VIEWPORT_EXIT_MARGIN_M = 1_500;

type FleetSlot = {
  id: number;
  renderLat: number;
  renderLng: number;
  serverLat: number;
  serverLng: number;
  lastGoodLat: number;
  lastGoodLng: number;
  heading: number;
  targetHeading: number;
  speedMps: number;
  elapsedSinceFixMs: number;
  lastFixAtMs: number;
  correctionElapsedMs: number;
  correctionDurationMs: number;
  correctionFromLat: number;
  correctionFromLng: number;
  correctionToLat: number;
  correctionToLng: number;
  isPremium: 0 | 1;
  isFriend: 0 | 1;
  avatarUrl: string;
  avatarFrameUrl: string;
  hasAvatar: 0 | 1;
  username: string;
  initials: string;
  distanceLabel: string;
  pinColor: string;
};

export type LiveFleetStats = {
  candidates: number;
  visible: number;
  culled: number;
  published: number;
};

function isValidFleetCoordJs(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180
  );
}

function isValidFleetCoord(lat: number, lng: number): boolean {
  'worklet';
  return (
    Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180
  );
}

export type LiveFleetFeature = {
  type: 'Feature';
  id: number;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: number;
    heading: number;
  };
};

export type LiveFleetGeoJson = {
  type: 'FeatureCollection';
  features: LiveFleetFeature[];
};

export type FleetMetaPinRequest = {
  id: number;
  signature: string;
  data: LiveUserPinSpriteData;
};

const EMPTY_FC: LiveFleetGeoJson = {
  type: 'FeatureCollection',
  features: [],
};

function pinColorFor(meta: { isPremium?: boolean; isFriend?: boolean }): string {
  if (meta.isPremium) return '#FFD700';
  if (meta.isFriend) return '#4de926';
  return '#00bfff';
}

function bearingDegJs(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  'worklet';
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function lerpAngle(from: number, to: number, t: number): number {
  'worklet';
  let delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

function moveAlongBearing(lat: number, lng: number, heading: number, distM: number) {
  'worklet';
  if (distM <= 0) return { lat, lng };
  const R = 6371000;
  const br = (heading * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distM / R)
    + Math.cos(lat1) * Math.sin(distM / R) * Math.cos(br),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(br) * Math.sin(distM / R) * Math.cos(lat1),
    Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

function clamp01(t: number): number {
  'worklet';
  return Math.max(0, Math.min(1, t));
}

function smoothstep(t: number): number {
  'worklet';
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function resolveFleetDisplayCoord(s: FleetSlot): { lat: number; lng: number } | null {
  'worklet';
  if (isValidFleetCoord(s.renderLat, s.renderLng)) return { lat: s.renderLat, lng: s.renderLng };
  if (isValidFleetCoord(s.lastGoodLat, s.lastGoodLng)) {
    return { lat: s.lastGoodLat, lng: s.lastGoodLng };
  }
  if (isValidFleetCoord(s.serverLat, s.serverLng)) {
    return { lat: s.serverLat, lng: s.serverLng };
  }
  return null;
}

function buildGeoJson(slots: FleetSlot[]): LiveFleetGeoJson {
  'worklet';
  const features: LiveFleetFeature[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const display = resolveFleetDisplayCoord(s);
    if (!display) continue;
    features.push({
      type: 'Feature',
      id: s.id,
      geometry: { type: 'Point', coordinates: [display.lng, display.lat] },
      properties: {
        id: s.id,
        heading: s.heading,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function buildMetaPinRequests(
  store: LiveMapStore,
  visibleUserIds: number[],
  anchor: { latitude: number; longitude: number } | null,
): FleetMetaPinRequest[] {
  const out: FleetMetaPinRequest[] = [];
  for (const id of visibleUserIds) {
    const meta = store.getMeta(id);
    const pos = store.getPosition(id);
    if (!meta) continue;
    const avatarUri = normalizeMediaUri(meta.avatarUrl);
    const frameUri = normalizeMediaUri(meta.avatarFrameUrl ?? null);
    const hasAvatar = avatarUri && /^https?:\/\//i.test(avatarUri);
    const username = meta.username?.trim() || 'Użytkownik';
    const initials = username.slice(0, 2).toUpperCase();
    const distKm = pos && anchor
      ? calculateDistance(anchor.latitude, anchor.longitude, pos.lat, pos.lng)
      : 0;
    const distanceLabel = `${distKm.toFixed(1)} km`;
    out.push({
      id,
      signature: buildPinSpriteSignature({
        id,
        avatarUrl: avatarUri ?? '',
        avatarFrameUrl: frameUri ?? '',
        isPremium: !!meta.isPremium,
        isFriend: !!meta.isFriend,
        initials,
        distanceLabel,
      }),
      data: {
        username,
        initials,
        distanceLabel,
        avatarUrl: hasAvatar ? avatarUri : null,
        avatarFrameUrl: frameUri || null,
        isPremium: !!meta.isPremium,
        isFriend: !!meta.isFriend,
      },
    });
  }
  return out;
}

function mergeSlotFromStore(
  id: number,
  store: LiveMapStore,
  prev: FleetSlot | undefined,
  anchor: { latitude: number; longitude: number } | null,
  now: number,
): FleetSlot | null {
  const pos = store.getPosition(id);
  const meta = store.getMeta(id);
  if (!pos || !meta) return null;

  const isNew = !prev;
  const targetChanged = !isNew
    && (prev.serverLat !== pos.lat || prev.serverLng !== pos.lng);

  const serverHeading = pos.heading != null && Number.isFinite(pos.heading)
    ? pos.heading
    : null;
  const serverSpeedMps = pos.speedMps != null && Number.isFinite(pos.speedMps) && pos.speedMps >= 0
    ? Math.min(MAX_SPEED_MPS, pos.speedMps)
    : null;

  let speedMps = prev?.speedMps ?? 0;
  let targetHeading = prev?.targetHeading ?? prev?.heading ?? 0;

  const serverAt = Number.isFinite(Number(meta.serverAt)) ? Number(meta.serverAt) : now;
  const prevFixAt = prev?.lastFixAtMs ?? serverAt;

  if (serverHeading != null) {
    targetHeading = serverHeading;
  } else if (targetChanged && prev) {
    const dtSec = (serverAt - prevFixAt) / 1000;
    if (dtSec > 0.05 && dtSec < 30) {
      const distM = calculateDistance(prev.serverLat, prev.serverLng, pos.lat, pos.lng) * 1000;
      if (distM / dtSec >= MIN_COAST_SPEED_MPS) {
        targetHeading = bearingDegJs(prev.serverLat, prev.serverLng, pos.lat, pos.lng);
      }
    }
  } else if (isNew) {
    targetHeading = 0;
  }

  if (serverSpeedMps != null) {
    speedMps = serverSpeedMps;
  } else if (targetChanged && prev) {
    const dtSec = (serverAt - prevFixAt) / 1000;
    if (dtSec > 0.05 && dtSec < 30) {
      const distM = calculateDistance(prev.serverLat, prev.serverLng, pos.lat, pos.lng) * 1000;
      speedMps = Math.min(MAX_SPEED_MPS, distM / dtSec);
    } else {
      speedMps = 0;
    }
  } else if (isNew) {
    speedMps = 0;
  }

  const motionChanged = !isNew && (
    (serverHeading != null && Math.abs(((serverHeading - (prev?.targetHeading ?? 0) + 540) % 360) - 180) > 2)
    || (serverSpeedMps != null && Math.abs((prev?.speedMps ?? 0) - serverSpeedMps) > 0.4)
  );
  const packetFresh = targetChanged || motionChanged || isNew;

  const avatarUri = normalizeMediaUri(meta.avatarUrl);
  const frameUri = normalizeMediaUri(meta.avatarFrameUrl ?? null);
  const hasAvatar = avatarUri && /^https?:\/\//i.test(avatarUri) ? 1 : 0;
  const username = meta.username?.trim() || 'Użytkownik';
  const initials = username.slice(0, 2).toUpperCase();
  const distKm = anchor
    ? calculateDistance(anchor.latitude, anchor.longitude, pos.lat, pos.lng)
    : 0;

  const renderLat = isNew ? pos.lat : prev!.renderLat;
  const renderLng = isNew ? pos.lng : prev!.renderLng;
  const prevGoodLat = prev?.lastGoodLat ?? renderLat;
  const prevGoodLng = prev?.lastGoodLng ?? renderLng;
  const lastGoodLat = isValidFleetCoordJs(renderLat, renderLng) ? renderLat : prevGoodLat;
  const lastGoodLng = isValidFleetCoordJs(renderLat, renderLng) ? renderLng : prevGoodLng;

  const elapsedSinceServerFixMs = Math.max(0, Math.min(COAST_MAX_MS, now - serverAt));
  const correctionTo = speedMps >= MIN_COAST_SPEED_MPS
    ? moveAlongBearing(pos.lat, pos.lng, targetHeading, speedMps * (elapsedSinceServerFixMs / 1000))
    : { lat: pos.lat, lng: pos.lng };
  const correctionDistanceM = isNew
    ? 0
    : haversineM(renderLat, renderLng, correctionTo.lat, correctionTo.lng);
  const correctionDurationMs = packetFresh
    ? correctionDurationForDistance(correctionDistanceM)
    : (prev?.correctionDurationMs ?? 0);
  const shouldSnap = packetFresh && correctionDurationMs <= 0;
  const nextRenderLat = shouldSnap ? correctionTo.lat : renderLat;
  const nextRenderLng = shouldSnap ? correctionTo.lng : renderLng;

  return {
    id,
    renderLat: nextRenderLat,
    renderLng: nextRenderLng,
    serverLat: pos.lat,
    serverLng: pos.lng,
    lastGoodLat: isValidFleetCoordJs(lastGoodLat, lastGoodLng) ? lastGoodLat : pos.lat,
    lastGoodLng: isValidFleetCoordJs(lastGoodLat, lastGoodLng) ? lastGoodLng : pos.lng,
    heading: isNew || shouldSnap ? targetHeading : (prev?.heading ?? targetHeading),
    targetHeading,
    speedMps,
    elapsedSinceFixMs: packetFresh ? elapsedSinceServerFixMs : (prev?.elapsedSinceFixMs ?? elapsedSinceServerFixMs),
    lastFixAtMs: packetFresh ? serverAt : (prev?.lastFixAtMs ?? serverAt),
    correctionElapsedMs: packetFresh ? 0 : (prev?.correctionElapsedMs ?? 0),
    correctionDurationMs,
    correctionFromLat: packetFresh ? renderLat : (prev?.correctionFromLat ?? renderLat),
    correctionFromLng: packetFresh ? renderLng : (prev?.correctionFromLng ?? renderLng),
    correctionToLat: packetFresh ? correctionTo.lat : (prev?.correctionToLat ?? correctionTo.lat),
    correctionToLng: packetFresh ? correctionTo.lng : (prev?.correctionToLng ?? correctionTo.lng),
    isPremium: meta.isPremium ? 1 : 0,
    isFriend: meta.isFriend ? 1 : 0,
    avatarUrl: avatarUri ?? '',
    avatarFrameUrl: frameUri ?? '',
    hasAvatar,
    username,
    initials,
    distanceLabel: `${distKm.toFixed(1)} km`,
    pinColor: pinColorFor(meta),
  };
}

export function useLiveFleetAnimator(
  store: LiveMapStore,
  visibleUserIds: number[],
  enabled: boolean,
  anchor: { latitude: number; longitude: number } | null,
  viewportBounds: ViewportBounds = EMPTY_VIEWPORT,
) {
  const [metaRevision, setMetaRevision] = useState(0);
  const [metaPinRequests, setMetaPinRequests] = useState<FleetMetaPinRequest[]>([]);
  const metaPinsKeyRef = useRef('');

  const visibleKey = useMemo(
    () => visibleUserIds.slice().sort((a, b) => a - b).join(','),
    [visibleUserIds],
  );

  const anchorKey = anchor
    ? `${anchor.latitude.toFixed(4)},${anchor.longitude.toFixed(4)}`
    : 'none';

  const viewportKey = viewportBounds.valid === 1
    ? `${viewportBounds.north.toFixed(4)}:${viewportBounds.south.toFixed(4)}:${viewportBounds.east.toFixed(4)}:${viewportBounds.west.toFixed(4)}`
    : 'invalid';

  const fleetSv = useSharedValue<FleetSlot[]>([]);
  const shapeSv = useSharedValue<LiveFleetGeoJson>(EMPTY_FC);
  const enterViewportSv = useSharedValue<ViewportBounds>(EMPTY_VIEWPORT);
  const exitViewportSv = useSharedValue<ViewportBounds>(EMPTY_VIEWPORT);
  const lastPublishAtSv = useSharedValue(0);
  const fleetStatsSv = useSharedValue<LiveFleetStats>({
    candidates: 0,
    visible: 0,
    culled: 0,
    published: 0,
  });

  useEffect(() => {
    enterViewportSv.value = expandBoundsByMeters(viewportBounds, VIEWPORT_ENTER_MARGIN_M);
    exitViewportSv.value = expandBoundsByMeters(viewportBounds, VIEWPORT_EXIT_MARGIN_M);
  }, [
    viewportBounds.north,
    viewportBounds.south,
    viewportBounds.east,
    viewportBounds.west,
    viewportBounds.valid,
    enterViewportSv,
    exitViewportSv,
  ]);

  useEffect(() => {
    if (!enabled) return;
    return store.subscribeUserIds(() => setMetaRevision((r) => r + 1));
  }, [store, enabled]);

  const publishMetaPins = useCallback((ids: number[]) => {
    const key = `${ids.join(',')}|${anchorKey}`;
    if (key === metaPinsKeyRef.current) return;
    metaPinsKeyRef.current = key;
    setMetaPinRequests(buildMetaPinRequests(store, ids, anchor));
  }, [store, anchor, anchorKey]);

  const clearFleet = useCallback(() => {
    fleetSv.value = [];
    shapeSv.value = EMPTY_FC;
    lastPublishAtSv.value = -1;
    fleetStatsSv.value = {
      candidates: 0,
      visible: 0,
      culled: 0,
      published: fleetStatsSv.value.published,
    };
    metaPinsKeyRef.current = '';
    setMetaPinRequests([]);
  }, [fleetSv, shapeSv, lastPublishAtSv, fleetStatsSv]);

  const isStorePositionInBounds = useCallback((id: number, bounds: ViewportBounds) => {
    const pos = store.getPosition(id);
    if (!pos) return false;
    return isInViewport(pos.lat, pos.lng, bounds);
  }, [store]);

  const rebuildFleetFromStore = useCallback(() => {
    if (!enabled || visibleUserIds.length === 0 || viewportBounds.valid !== 1) {
      clearFleet();
      return;
    }

    const now = Date.now();
    const prevById = new Map(fleetSv.value.map((s) => [s.id, s]));
    const next: FleetSlot[] = [];
    const enterBounds = enterViewportSv.value;
    const exitBounds = exitViewportSv.value;

    for (const id of visibleUserIds) {
      const prev = prevById.get(id);
      const bounds = prev ? exitBounds : enterBounds;
      if (!isStorePositionInBounds(id, bounds)) continue;
      const slot = mergeSlotFromStore(id, store, prevById.get(id), anchor, now);
      if (slot) next.push(slot);
    }

    fleetSv.value = next;
    shapeSv.value = next.length > 0 ? buildGeoJson(next) : EMPTY_FC;
    lastPublishAtSv.value = next.length > 0 ? 0 : -1;
    fleetStatsSv.value = {
      candidates: visibleUserIds.length,
      visible: next.length,
      culled: Math.max(0, visibleUserIds.length - next.length),
      published: fleetStatsSv.value.published,
    };
    publishMetaPins(next.map((s) => s.id));
  }, [
    store,
    visibleUserIds,
    enabled,
    anchor,
    fleetSv,
    shapeSv,
    enterViewportSv,
    exitViewportSv,
    lastPublishAtSv,
    fleetStatsSv,
    clearFleet,
    isStorePositionInBounds,
    publishMetaPins,
    viewportBounds.valid,
  ]);

  useEffect(() => {
    rebuildFleetFromStore();
  }, [rebuildFleetFromStore, visibleKey, metaRevision, anchorKey, viewportKey]);

  useEffect(() => {
    if (!enabled || visibleUserIds.length === 0) return;

    const visibleSet = new Set(visibleUserIds);

    const onPosition = (id: number) => {
      if (enterViewportSv.value.valid !== 1) return;
      const pos = store.getPosition(id);
      if (!pos) return;
      const slots = fleetSv.value;
      let idx = -1;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].id === id) {
          idx = i;
          break;
        }
      }

      const prev = idx >= 0 ? slots[idx] : undefined;
      if (!prev && !isInViewport(pos.lat, pos.lng, enterViewportSv.value)) return;
      const now = Date.now();
      const merged = mergeSlotFromStore(id, store, prev, anchor, now);
      if (!merged) return;

      const next = slots.slice();
      if (idx >= 0) {
        if (isInViewport(merged.renderLat, merged.renderLng, exitViewportSv.value)) {
          next[idx] = merged;
        } else {
          next.splice(idx, 1);
        }
      } else {
        next.push(merged);
      }
      fleetSv.value = next;
      fleetStatsSv.value = {
        candidates: visibleUserIds.length,
        visible: next.length,
        culled: Math.max(0, visibleUserIds.length - next.length),
        published: fleetStatsSv.value.published,
      };
      const prevKey = slots.map((s) => s.id).join(',');
      const nextKey = next.map((s) => s.id).join(',');
      if (prevKey !== nextKey) {
        publishMetaPins(next.map((s) => s.id));
      }
    };

    return store.subscribeFleetDeltas((ids) => {
      for (const id of ids) {
        if (visibleSet.has(id)) onPosition(id);
      }
    });
  }, [
    store,
    visibleKey,
    enabled,
    visibleUserIds,
    fleetSv,
    anchor,
    enterViewportSv,
    exitViewportSv,
    fleetStatsSv,
    publishMetaPins,
  ]);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    const exitBounds = exitViewportSv.value;
    if (exitBounds.valid !== 1) return;

    const slots = fleetSv.value;
    if (!slots.length) {
      if (lastPublishAtSv.value !== -1) {
        shapeSv.value = EMPTY_FC;
        lastPublishAtSv.value = -1;
      }
      return;
    }

    const dtMs = frame.timeSincePreviousFrame ?? 16.67;
    const dtSec = Math.min(dtMs / 1000, MAX_DT_SEC);
    const headingAlpha = 1 - Math.exp(-HEADING_LERP_RATE * dtSec);
    const nowMs = frame.timestamp ?? 0;

    const nextSlots: FleetSlot[] = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const elapsedSinceFixMs = Math.min(COAST_MAX_MS, s.elapsedSinceFixMs + dtMs);
      const predicted = s.speedMps >= MIN_COAST_SPEED_MPS
        ? moveAlongBearing(
          s.serverLat,
          s.serverLng,
          s.targetHeading,
          s.speedMps * (elapsedSinceFixMs / 1000),
        )
        : { lat: s.serverLat, lng: s.serverLng };

      let lat = predicted.lat;
      let lng = predicted.lng;
      let correctionElapsedMs = s.correctionElapsedMs;

      if (s.correctionDurationMs > 0 && correctionElapsedMs < s.correctionDurationMs) {
        correctionElapsedMs = Math.min(s.correctionDurationMs, correctionElapsedMs + dtMs);
        const t = smoothstep(correctionElapsedMs / s.correctionDurationMs);
        lat = s.correctionFromLat + (predicted.lat - s.correctionFromLat) * t;
        lng = s.correctionFromLng + (predicted.lng - s.correctionFromLng) * t;
      }

      const heading = lerpAngle(s.heading, s.targetHeading, headingAlpha);

      let lastGoodLat = s.lastGoodLat;
      let lastGoodLng = s.lastGoodLng;
      if (isValidFleetCoord(lat, lng)) {
        lastGoodLat = lat;
        lastGoodLng = lng;
      } else if (isValidFleetCoord(s.lastGoodLat, s.lastGoodLng)) {
        lat = s.lastGoodLat;
        lng = s.lastGoodLng;
      } else if (isValidFleetCoord(s.serverLat, s.serverLng)) {
        lat = s.serverLat;
        lng = s.serverLng;
        lastGoodLat = s.serverLat;
        lastGoodLng = s.serverLng;
      }

      if (!isInViewport(lat, lng, exitBounds)) continue;

      nextSlots.push({
        id: s.id,
        renderLat: lat,
        renderLng: lng,
        serverLat: s.serverLat,
        serverLng: s.serverLng,
        lastGoodLat,
        lastGoodLng,
        heading,
        targetHeading: s.targetHeading,
        speedMps: s.speedMps,
        elapsedSinceFixMs,
        lastFixAtMs: s.lastFixAtMs,
        correctionElapsedMs,
        correctionDurationMs: s.correctionDurationMs,
        correctionFromLat: s.correctionFromLat,
        correctionFromLng: s.correctionFromLng,
        correctionToLat: s.correctionToLat,
        correctionToLng: s.correctionToLng,
        isPremium: s.isPremium,
        isFriend: s.isFriend,
        avatarUrl: s.avatarUrl,
        avatarFrameUrl: s.avatarFrameUrl,
        hasAvatar: s.hasAvatar,
        username: s.username,
        initials: s.initials,
        distanceLabel: s.distanceLabel,
        pinColor: s.pinColor,
      });
    }
    fleetSv.value = nextSlots;
    if (shouldPublishFleetFrame(nowMs, lastPublishAtSv.value)) {
      shapeSv.value = buildGeoJson(nextSlots);
      lastPublishAtSv.value = nowMs;
      fleetStatsSv.value = {
        candidates: fleetStatsSv.value.candidates,
        visible: nextSlots.length,
        culled: Math.max(0, fleetStatsSv.value.candidates - nextSlots.length),
        published: fleetStatsSv.value.published + 1,
      };
    }
  }, false);

  useEffect(() => {
    frameCallback.setActive(enabled && visibleUserIds.length > 0);
    return () => frameCallback.setActive(false);
  }, [enabled, visibleUserIds.length, frameCallback]);

  // RNMBXShapeSource.setShape wymaga GeoJSON string (nie obiektu) przy animatedProps.
  const animatedShapeProps = useAnimatedProps(() => {
    'worklet';
    return {
      shape: JSON.stringify(shapeSv.value),
    };
  });

  const hasFleet = metaPinRequests.length > 0;

  return {
    animatedShapeProps,
    metaPinRequests,
    hasFleet,
    fleetStats: fleetStatsSv,
  };
}
