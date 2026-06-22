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
  FLEET_FULL_ANIMATION_RADIUS_KM,
} from './liveFleetMotion';
import {
  interpolateAlongTrail,
  interpolateAlongPolyline,
  interpolateEntity,
  isImplausibleJump,
  resolveFleetAnimationTier,
  type FleetTrailPoint,
} from './fleetTrailInterpolation';
import { maybeEnqueueFleetOsrmSnap } from './fleetReceiveSnap';
import {
  EMPTY_VIEWPORT,
  expandBoundsByMeters,
  isInViewport,
  type ViewportBounds,
} from './liveFleetSpatialIndex';
import type { LiveMapStore } from './liveMapStore';

const MAX_DT_SEC = 0.05;
const HEADING_LERP_RATE = 8;
const VIEWPORT_ENTER_MARGIN_M = 1_000;
const VIEWPORT_EXIT_MARGIN_M = 1_500;

type AnimationTier = 0 | 1; // 0 = static, 1 = full

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
  animationTier: AnimationTier;
  trailLen: number;
  trail0Lat: number;
  trail0Lng: number;
  trail0T: number;
  trail1Lat: number;
  trail1Lng: number;
  trail1T: number;
  trail2Lat: number;
  trail2Lng: number;
  trail2T: number;
  trail3Lat: number;
  trail3Lng: number;
  trail3T: number;
  polylineLen: number;
  polyline0Lat: number;
  polyline0Lng: number;
  polyline1Lat: number;
  polyline1Lng: number;
  polyline2Lat: number;
  polyline2Lng: number;
  polyline3Lat: number;
  polyline3Lng: number;
  prevServerLat: number;
  prevServerLng: number;
  prevServerAt: number;
  lastServerAt: number;
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

function packTrail(trail: FleetTrailPoint[] | undefined) {
  const pts = trail ?? [];
  return {
    trailLen: pts.length,
    trail0Lat: pts[0]?.lat ?? 0,
    trail0Lng: pts[0]?.lng ?? 0,
    trail0T: pts[0]?.t ?? 0,
    trail1Lat: pts[1]?.lat ?? 0,
    trail1Lng: pts[1]?.lng ?? 0,
    trail1T: pts[1]?.t ?? 0,
    trail2Lat: pts[2]?.lat ?? 0,
    trail2Lng: pts[2]?.lng ?? 0,
    trail2T: pts[2]?.t ?? 0,
    trail3Lat: pts[3]?.lat ?? 0,
    trail3Lng: pts[3]?.lng ?? 0,
    trail3T: pts[3]?.t ?? 0,
  };
}

function unpackTrail(s: FleetSlot): FleetTrailPoint[] {
  const out: FleetTrailPoint[] = [];
  if (s.trailLen > 0) out.push({ lat: s.trail0Lat, lng: s.trail0Lng, t: s.trail0T });
  if (s.trailLen > 1) out.push({ lat: s.trail1Lat, lng: s.trail1Lng, t: s.trail1T });
  if (s.trailLen > 2) out.push({ lat: s.trail2Lat, lng: s.trail2Lng, t: s.trail2T });
  if (s.trailLen > 3) out.push({ lat: s.trail3Lat, lng: s.trail3Lng, t: s.trail3T });
  return out;
}

function packPolyline(polyline: { lat: number; lng: number }[] | undefined) {
  const pts = polyline ?? [];
  return {
    polylineLen: pts.length,
    polyline0Lat: pts[0]?.lat ?? 0,
    polyline0Lng: pts[0]?.lng ?? 0,
    polyline1Lat: pts[1]?.lat ?? 0,
    polyline1Lng: pts[1]?.lng ?? 0,
    polyline2Lat: pts[2]?.lat ?? 0,
    polyline2Lng: pts[2]?.lng ?? 0,
    polyline3Lat: pts[3]?.lat ?? 0,
    polyline3Lng: pts[3]?.lng ?? 0,
  };
}

function unpackPolyline(s: FleetSlot): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = [];
  if (s.polylineLen > 0) out.push({ lat: s.polyline0Lat, lng: s.polyline0Lng });
  if (s.polylineLen > 1) out.push({ lat: s.polyline1Lat, lng: s.polyline1Lng });
  if (s.polylineLen > 2) out.push({ lat: s.polyline2Lat, lng: s.polyline2Lng });
  if (s.polylineLen > 3) out.push({ lat: s.polyline3Lat, lng: s.polyline3Lng });
  return out;
}

function resolveFleetPositionJs(
  s: FleetSlot,
  now: number,
): { lat: number; lng: number; heading: number } {
  if (s.animationTier === 0) {
    return { lat: s.serverLat, lng: s.serverLng, heading: s.heading };
  }

  const trail = unpackTrail(s);
  if (trail.length >= 2) {
    const pos = interpolateAlongTrail(trail, now);
    if (pos) return pos;
  }

  const polyline = unpackPolyline(s);
  if (polyline.length >= 2 && s.lastServerAt > s.prevServerAt) {
    const progress = (now - s.prevServerAt) / (s.lastServerAt - s.prevServerAt);
    const pos = interpolateAlongPolyline(polyline, progress);
    if (pos) return pos;
  }

  if (
    Number.isFinite(s.prevServerLat)
    && Number.isFinite(s.prevServerLng)
    && Number.isFinite(s.prevServerAt)
    && Number.isFinite(s.lastServerAt)
    && s.lastServerAt > s.prevServerAt
  ) {
    return interpolateEntity(
      s.prevServerLat,
      s.prevServerLng,
      s.prevServerAt,
      s.serverLat,
      s.serverLng,
      s.lastServerAt,
      now,
    );
  }

  return { lat: s.serverLat, lng: s.serverLng, heading: s.heading };
}

function resolveFleetPositionWorklet(
  s: FleetSlot,
  nowMs: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  if (s.animationTier === 0) {
    return { lat: s.serverLat, lng: s.serverLng, heading: s.heading };
  }

  if (s.trailLen >= 2) {
    const firstT = s.trail0T;
    const lastT = s.trailLen === 2
      ? s.trail1T
      : s.trailLen === 3
        ? s.trail2T
        : s.trail3T;
    if (Number.isFinite(firstT) && Number.isFinite(lastT) && lastT > firstT) {
      const tNorm = Math.max(0, Math.min(1, (nowMs - firstT) / (lastT - firstT)));
      const lat = s.trail0Lat + (s.serverLat - s.trail0Lat) * tNorm;
      const lng = s.trail0Lng + (s.serverLng - s.trail0Lng) * tNorm;
      return { lat, lng, heading: s.targetHeading };
    }
  }

  if (
    Number.isFinite(s.prevServerAt)
    && Number.isFinite(s.lastServerAt)
    && s.lastServerAt > s.prevServerAt
  ) {
    const tNorm = Math.max(0, Math.min(1, (nowMs - s.prevServerAt) / (s.lastServerAt - s.prevServerAt)));
    return {
      lat: s.prevServerLat + (s.serverLat - s.prevServerLat) * tNorm,
      lng: s.prevServerLng + (s.serverLng - s.prevServerLng) * tNorm,
      heading: s.targetHeading,
    };
  }

  return { lat: s.serverLat, lng: s.serverLng, heading: s.heading };
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
  const serverAt = Number.isFinite(Number(meta.serverAt))
    ? Number(meta.serverAt)
    : (pos.lastServerAt ?? now);
  const prevServerLat = pos.prevServerLat ?? prev?.prevServerLat ?? pos.lat;
  const prevServerLng = pos.prevServerLng ?? prev?.prevServerLng ?? pos.lng;
  const prevServerAt = pos.prevServerAt ?? prev?.prevServerAt ?? serverAt;

  if (
    !isNew
    && prev
    && isImplausibleJump(prev.serverLat, prev.serverLng, prev.lastServerAt, pos.lat, pos.lng, serverAt)
  ) {
    return prev;
  }

  const serverHeading = pos.heading != null && Number.isFinite(pos.heading) ? pos.heading : null;
  const serverSpeedMps = pos.speedMps != null && Number.isFinite(pos.speedMps) && pos.speedMps >= 0
    ? pos.speedMps
    : 0;

  let targetHeading = serverHeading ?? prev?.targetHeading ?? 0;
  if (serverHeading == null && prev && (prev.serverLat !== pos.lat || prev.serverLng !== pos.lng)) {
    targetHeading = bearingDegJs(prev.serverLat, prev.serverLng, pos.lat, pos.lng);
  }

  const distKm = anchor
    ? calculateDistance(anchor.latitude, anchor.longitude, pos.lat, pos.lng)
    : 0;
  const tier = resolveFleetAnimationTier(!!meta.isFriend, distKm, FLEET_FULL_ANIMATION_RADIUS_KM);
  const animationTier: AnimationTier = tier === 'full' ? 1 : 0;

  const trail = pos.trail;
  const polyline = pos.osrmPolyline;
  const packedTrail = packTrail(trail);
  const packedPoly = packPolyline(polyline);

  const draftSlot: FleetSlot = {
    id,
    renderLat: pos.lat,
    renderLng: pos.lng,
    serverLat: pos.lat,
    serverLng: pos.lng,
    lastGoodLat: pos.lat,
    lastGoodLng: pos.lng,
    heading: targetHeading,
    targetHeading,
    speedMps: serverSpeedMps,
    animationTier,
    ...packedTrail,
    ...packedPoly,
    prevServerLat: Number.isFinite(prevServerLat) ? prevServerLat : pos.lat,
    prevServerLng: Number.isFinite(prevServerLng) ? prevServerLng : pos.lng,
    prevServerAt: Number.isFinite(prevServerAt) ? prevServerAt : serverAt,
    lastServerAt: serverAt,
    correctionElapsedMs: 0,
    correctionDurationMs: 0,
    correctionFromLat: pos.lat,
    correctionFromLng: pos.lng,
    correctionToLat: pos.lat,
    correctionToLng: pos.lng,
    isPremium: meta.isPremium ? 1 : 0,
    isFriend: meta.isFriend ? 1 : 0,
    avatarUrl: '',
    avatarFrameUrl: '',
    hasAvatar: 0,
    username: '',
    initials: '',
    distanceLabel: '',
    pinColor: '',
  };

  const resolved = resolveFleetPositionJs(draftSlot, now);
  const renderLat = isNew ? resolved.lat : (prev?.renderLat ?? resolved.lat);
  const renderLng = isNew ? resolved.lng : (prev?.renderLng ?? resolved.lng);
  const correctionDistanceM = isNew
    ? 0
    : haversineM(renderLat, renderLng, resolved.lat, resolved.lng);
  const correctionDurationMs = correctionDurationForDistance(correctionDistanceM);
  const shouldSnap = correctionDurationMs <= 0;
  const nextRenderLat = shouldSnap ? resolved.lat : renderLat;
  const nextRenderLng = shouldSnap ? resolved.lng : renderLng;

  const avatarUri = normalizeMediaUri(meta.avatarUrl);
  const frameUri = normalizeMediaUri(meta.avatarFrameUrl ?? null);
  const hasAvatar = avatarUri && /^https?:\/\//i.test(avatarUri) ? 1 : 0;
  const username = meta.username?.trim() || 'Użytkownik';
  const initials = username.slice(0, 2).toUpperCase();

  if (animationTier === 1 && (!trail || trail.length < 2)) {
    maybeEnqueueFleetOsrmSnap({
      store,
      userId: id,
      isFriend: !!meta.isFriend,
      distKm,
      animationTier: tier,
      trail,
      speedMps: serverSpeedMps,
      lat: pos.lat,
      lng: pos.lng,
      prevLat: prevServerLat,
      prevLng: prevServerLng,
    });
  }

  return {
    ...draftSlot,
    renderLat: nextRenderLat,
    renderLng: nextRenderLng,
    lastGoodLat: isValidFleetCoordJs(nextRenderLat, nextRenderLng) ? nextRenderLat : pos.lat,
    lastGoodLng: isValidFleetCoordJs(nextRenderLat, nextRenderLng) ? nextRenderLng : pos.lng,
    heading: resolved.heading,
    correctionDurationMs,
    correctionFromLat: renderLat,
    correctionFromLng: renderLng,
    correctionToLat: resolved.lat,
    correctionToLng: resolved.lng,
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
      const resolved = resolveFleetPositionWorklet(s, nowMs);
      let lat = resolved.lat;
      let lng = resolved.lng;
      let correctionElapsedMs = s.correctionElapsedMs;

      if (s.correctionDurationMs > 0 && correctionElapsedMs < s.correctionDurationMs) {
        correctionElapsedMs = Math.min(s.correctionDurationMs, correctionElapsedMs + dtMs);
        const t = smoothstep(correctionElapsedMs / s.correctionDurationMs);
        lat = s.correctionFromLat + (resolved.lat - s.correctionFromLat) * t;
        lng = s.correctionFromLng + (resolved.lng - s.correctionFromLng) * t;
      }

      const heading = lerpAngle(s.heading, resolved.heading || s.targetHeading, headingAlpha);

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
        animationTier: s.animationTier,
        trailLen: s.trailLen,
        trail0Lat: s.trail0Lat,
        trail0Lng: s.trail0Lng,
        trail0T: s.trail0T,
        trail1Lat: s.trail1Lat,
        trail1Lng: s.trail1Lng,
        trail1T: s.trail1T,
        trail2Lat: s.trail2Lat,
        trail2Lng: s.trail2Lng,
        trail2T: s.trail2T,
        trail3Lat: s.trail3Lat,
        trail3Lng: s.trail3Lng,
        trail3T: s.trail3T,
        polylineLen: s.polylineLen,
        polyline0Lat: s.polyline0Lat,
        polyline0Lng: s.polyline0Lng,
        polyline1Lat: s.polyline1Lat,
        polyline1Lng: s.polyline1Lng,
        polyline2Lat: s.polyline2Lat,
        polyline2Lng: s.polyline2Lng,
        polyline3Lat: s.polyline3Lat,
        polyline3Lng: s.polyline3Lng,
        prevServerLat: s.prevServerLat,
        prevServerLng: s.prevServerLng,
        prevServerAt: s.prevServerAt,
        lastServerAt: s.lastServerAt,
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
