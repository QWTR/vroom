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
import { registerModelUrl } from '../lib/vehicleModelRegistry';
import { resolveMapVehicleScale } from '../lib/mapVehicleScale';
import {
  buildModelLayerTranslationWorklet,
  computeVehicleModelYawWorklet,
  normalizeVehicleModelMeta,
} from '../lib/vehicleModelMeta';
import {
  FLEET_EXTRAPOLATE_MAX_MS,
  FLEET_EXTRAPOLATE_DECAY_START_MS,
  FLEET_FULL_ANIMATION_RADIUS_KM,
  FLEET_FULL_ANIMATION_EXIT_KM,
  FLEET_INTERPOLATION_BUFFER_MS,
  FLEET_PUBLISH_INTERVAL_MS,
  correctionDurationForDistance,
  shouldExtrapolatePastTrailTail,
  shouldPublishFleetFrame,
  shouldRenderFleet2dPin,
} from './liveFleetMotion';
import {
  isImplausibleJump,
  computeFleetPushDurationMs,
  resolveFleetAnimationTierWithHysteresis,
  extrapolateFleetPosition,
  clamp01 as clamp01Shared,
  lerp as lerpShared,
  type FleetTrailPoint,
} from './fleetTrailInterpolation';
import {
  EMPTY_VIEWPORT,
  expandBoundsByMeters,
  isInViewport,
  type ViewportBounds,
} from './liveFleetSpatialIndex';
import type { LiveMapStore } from './liveMapStore';
import { buildLiveVehicleIdentityProperties } from '../lib/liveVehicleLabel';

const VIEWPORT_ENTER_MARGIN_M = 1_000;
const VIEWPORT_EXIT_MARGIN_M = 1_500;
const FLEET_STATS_THROTTLE_MS = 66;

type AnimationTier = 0 | 1; // 0 = static (snap), 1 = full (lerp + dead reckoning)

/**
 * Lekki slot floty (V3-Lite). Jeden wspólny zegar Date.now() dla JS i worklet.
 * tier=full: lerp from->to przez durationMs, potem dead reckoning wzdłuż motionHeading.
 * tier=static: render bezpośrednio z serverLat/serverLng (snap przy każdej paczce).
 */
type FleetSlot = {
  id: number;
  animationTier: AnimationTier;
  // ostatnio wyrenderowana pozycja (ciągłość origin między segmentami)
  renderLat: number;
  renderLng: number;
  heading: number;
  // segment ruchu
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  startMs: number;
  durationMs: number;
  segmentEndMs: number;
  fromHeading: number;
  motionHeading: number;
  speedMps: number;
  roadTrail: FleetTrailPoint[];
  // ostatnia pozycja serwera (detekcja ruchu / snap / teleport guard)
  serverLat: number;
  serverLng: number;
  lastServerAt: number;
  pendingTeleportLat: number | null;
  pendingTeleportLng: number | null;
  pendingTeleportAt: number | null;
  // fallback przy niepoprawnych współrzędnych
  lastGoodLat: number;
  lastGoodLng: number;
  // meta pinów
  isPremium: 0 | 1;
  isFriend: 0 | 1;
  stale: 0 | 1;
  avatarUrl: string;
  avatarFrameUrl: string;
  hasAvatar: 0 | 1;
  username: string;
  initials: string;
  distanceLabel: string;
  pinColor: string;
  vehicleModelKey: string;
  vehicleRotOffset: number;
  vehiclePitch: number;
  vehicleRoll: number;
  vehicleElevationZ: number;
  vehicleScale0: number;
  vehicleScale1: number;
  vehicleScale2: number;
  vehicleMinZoom: number;
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
    username?: string;
    pinColor?: string;
    modelKey?: string;
    modelRot0?: number;
    modelRot1?: number;
    modelRot2?: number;
    transX?: number;
    transY?: number;
    transZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    minZoom?: number;
    stale?: number;
  };
};

export type LiveFleetGeoJson = {
  type: 'FeatureCollection';
  features: LiveFleetFeature[];
};

const EMPTY_VEHICLE_FC: LiveFleetGeoJson = {
  type: 'FeatureCollection',
  features: [],
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

function fleetGeoJsonKey(...collections: LiveFleetGeoJson[]): string {
  return collections
    .flatMap((collection) => collection.features)
    .map((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      return [
        feature.id,
        lat.toFixed(6),
        lng.toFixed(6),
        Number(feature.properties.heading || 0).toFixed(1),
        feature.properties.modelKey ?? '',
      ].join(':');
    })
    .join('|');
}

function pinColorFor(meta: { isPremium?: boolean; isFriend?: boolean }): string {
  if (meta.isPremium) return '#FFD700';
  if (meta.isFriend) return '#4de926';
  return '#00bfff';
}

function bearingDegJs(aLat: number, aLng: number, bLat: number, bLng: number): number {
  'worklet';
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Haversine w metrach — callable z JS i worklet. */
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

function clamp01Js(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Interpolacja kąta po krótszym łuku (lekki low-pass headingu w obrębie segmentu). */
function lerpAngleJs(from: number, to: number, t: number): number {
  if (!Number.isFinite(from)) return to;
  if (!Number.isFinite(to)) return from;
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

function lerpAngleWorklet(from: number, to: number, t: number): number {
  'worklet';
  if (!Number.isFinite(from)) return to;
  if (!Number.isFinite(to)) return from;
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

function extrapolateFleetPositionWorklet(
  lat: number,
  lng: number,
  heading: number,
  speedMps: number,
  segmentEndMs: number,
  nowMs: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  const ageMs = nowMs - segmentEndMs;
  if (!Number.isFinite(ageMs) || ageMs <= 0 || !Number.isFinite(speedMps) || speedMps < 0.5) {
    return { lat, lng, heading };
  }
  const cappedMs = Math.min(ageMs, FLEET_EXTRAPOLATE_MAX_MS);
  const decayWindowMs = Math.max(
    1,
    FLEET_EXTRAPOLATE_MAX_MS - FLEET_EXTRAPOLATE_DECAY_START_MS,
  );
  const tailMs = Math.max(0, cappedMs - FLEET_EXTRAPOLATE_DECAY_START_MS);
  const effectiveMs = cappedMs <= FLEET_EXTRAPOLATE_DECAY_START_MS
    ? cappedMs
    : FLEET_EXTRAPOLATE_DECAY_START_MS
      + tailMs
      - (tailMs * tailMs) / (2 * decayWindowMs);
  const distM = speedMps * (effectiveMs / 1000);
  const moved = moveAlongBearing(lat, lng, heading, distM);
  return { lat: moved.lat, lng: moved.lng, heading };
}

function trailLengthM(points: FleetTrailPoint[]): number {
  'worklet';
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return acc;
}

function walkTrailAtDistance(
  points: FleetTrailPoint[],
  targetM: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segM = haversineM(a.lat, a.lng, b.lat, b.lng);
    if (walked + segM >= targetM) {
      const t = segM > 0 ? clamp01Shared((targetM - walked) / segM) : 0;
      return {
        lat: lerpShared(a.lat, b.lat, t),
        lng: lerpShared(a.lng, b.lng, t),
        heading: bearingDegJs(a.lat, a.lng, b.lat, b.lng),
      };
    }
    walked += segM;
  }
  const tail = points[points.length - 1];
  const prev = points[Math.max(0, points.length - 2)];
  return {
    lat: tail.lat,
    lng: tail.lng,
    heading: bearingDegJs(prev.lat, prev.lng, tail.lat, tail.lng),
  };
}

function resolveTrailPosition(
  trail: FleetTrailPoint[],
  nowMs: number,
): { lat: number; lng: number; heading: number } | null {
  'worklet';
  if (!trail || trail.length < 2) return null;
  const first = trail[0];
  const last = trail[trail.length - 1];
  if (!Number.isFinite(first.t) || !Number.isFinite(last.t) || last.t <= first.t) return null;
  const totalM = trailLengthM(trail);
  if (!Number.isFinite(totalM) || totalM <= 0.5) {
    return { lat: last.lat, lng: last.lng, heading: 0 };
  }
  const progress = clamp01Shared((nowMs - first.t) / (last.t - first.t));
  return walkTrailAtDistance(trail, totalM * progress);
}

/**
 * Rozwiązanie pozycji slotu w chwili nowMs (zegar Date.now()).
 * Wersja JS — używana przy merge (seed origin / render).
 */
function resolveMotionJs(
  s: FleetSlot,
  nowMs: number,
): { lat: number; lng: number; heading: number } {
  const renderAtMs = nowMs - FLEET_INTERPOLATION_BUFFER_MS;
  if (s.animationTier === 0) {
    return { lat: s.serverLat, lng: s.serverLng, heading: s.motionHeading };
  }
  if (s.roadTrail.length >= 2) {
    const resolvedTrail = resolveTrailPosition(s.roadTrail, renderAtMs);
    if (resolvedTrail) {
      const tail = s.roadTrail[s.roadTrail.length - 1];
      if (shouldExtrapolatePastTrailTail(renderAtMs, tail.t)) {
        return extrapolateFleetPosition(
          tail.lat,
          tail.lng,
          Number.isFinite(resolvedTrail.heading) ? resolvedTrail.heading : s.motionHeading,
          s.speedMps,
          tail.t,
          renderAtMs,
          FLEET_EXTRAPOLATE_MAX_MS,
        );
      }
      return resolvedTrail;
    }
  }
  if (s.durationMs <= 0) {
    return extrapolateFleetPosition(
      s.toLat, s.toLng, s.motionHeading, s.speedMps, s.startMs, renderAtMs, FLEET_EXTRAPOLATE_MAX_MS,
    );
  }
  const t = clamp01Js((renderAtMs - s.startMs) / s.durationMs);
  if (t < 1) {
    return {
      lat: s.fromLat + (s.toLat - s.fromLat) * t,
      lng: s.fromLng + (s.toLng - s.fromLng) * t,
      heading: lerpAngleJs(s.fromHeading, s.motionHeading, t),
    };
  }
  return extrapolateFleetPosition(
    s.toLat, s.toLng, s.motionHeading, s.speedMps, s.segmentEndMs, renderAtMs, FLEET_EXTRAPOLATE_MAX_MS,
  );
}

/** Bliźniacza wersja worklet — używana w pętli klatek na wątku UI. */
function resolveMotionWorklet(
  s: FleetSlot,
  nowMs: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  const renderAtMs = nowMs - FLEET_INTERPOLATION_BUFFER_MS;
  if (s.animationTier === 0) {
    return { lat: s.serverLat, lng: s.serverLng, heading: s.motionHeading };
  }
  if (s.roadTrail.length >= 2) {
    const resolvedTrail = resolveTrailPosition(s.roadTrail, renderAtMs);
    if (resolvedTrail) {
      const tail = s.roadTrail[s.roadTrail.length - 1];
      if (shouldExtrapolatePastTrailTail(renderAtMs, tail.t)) {
        return extrapolateFleetPositionWorklet(
          tail.lat,
          tail.lng,
          Number.isFinite(resolvedTrail.heading) ? resolvedTrail.heading : s.motionHeading,
          s.speedMps,
          tail.t,
          renderAtMs,
        );
      }
      return resolvedTrail;
    }
  }
  if (s.durationMs <= 0) {
    return extrapolateFleetPositionWorklet(
      s.toLat, s.toLng, s.motionHeading, s.speedMps, s.startMs, renderAtMs,
    );
  }
  const t = clamp01Shared((renderAtMs - s.startMs) / s.durationMs);
  if (t < 1) {
    return {
      lat: lerpShared(s.fromLat, s.toLat, t),
      lng: lerpShared(s.fromLng, s.toLng, t),
      heading: lerpAngleWorklet(s.fromHeading, s.motionHeading, t),
    };
  }
  return extrapolateFleetPositionWorklet(
    s.toLat, s.toLng, s.motionHeading, s.speedMps, s.segmentEndMs, renderAtMs,
  );
}

function buildGeoJsonLive(
  slots: FleetSlot[],
  nowMs: number,
  exitBounds: ViewportBounds,
  animationTier: AnimationTier,
): LiveFleetGeoJson {
  'worklet';
  const features: LiveFleetFeature[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!shouldRenderFleet2dPin(s.animationTier, animationTier)) continue;
    const resolved = resolveMotionWorklet(s, nowMs);
    let lat = resolved.lat;
    let lng = resolved.lng;
    if (!isValidFleetCoord(lat, lng)) {
      if (isValidFleetCoord(s.lastGoodLat, s.lastGoodLng)) {
        lat = s.lastGoodLat;
        lng = s.lastGoodLng;
      } else {
        continue;
      }
    }
    if (!isInViewport(lat, lng, exitBounds)) continue;
    features.push({
      type: 'Feature',
      id: s.id,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        id: s.id,
        heading: resolved.heading,
        stale: s.stale,
        pinColor: s.pinColor,
        username: s.username,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function buildVehicleGeoJson(
  slots: FleetSlot[],
  nowMs: number,
  exitBounds: ViewportBounds,
  currentZoom: number,
  animationTier: AnimationTier,
): LiveFleetGeoJson {
  'worklet';
  const features: LiveFleetFeature[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.animationTier !== animationTier || !s.vehicleModelKey) continue;
    const resolved = resolveMotionWorklet(s, nowMs);
    let lat = resolved.lat;
    let lng = resolved.lng;
    if (!isValidFleetCoord(lat, lng)) {
      if (isValidFleetCoord(s.lastGoodLat, s.lastGoodLng)) {
        lat = s.lastGoodLat;
        lng = s.lastGoodLng;
      } else {
        continue;
      }
    }
    if (!isInViewport(lat, lng, exitBounds)) continue;
    if (Number.isFinite(currentZoom) && currentZoom < s.vehicleMinZoom) continue;
    const yaw = computeVehicleModelYawWorklet(resolved.heading, s.vehicleRotOffset);
    const translation = buildModelLayerTranslationWorklet(s.vehicleElevationZ);
    features.push({
      type: 'Feature',
      id: s.id,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        ...buildLiveVehicleIdentityProperties(s.id, s.username, s.pinColor),
        heading: yaw,
        modelKey: s.vehicleModelKey,
        modelRot0: Number(s.vehiclePitch) || 0,
        modelRot1: Number(s.vehicleRoll) || 0,
        modelRot2: yaw,
        transX: translation[0],
        transY: translation[1],
        transZ: translation[2],
        scaleX: Number(s.vehicleScale0) || 1,
        scaleY: Number(s.vehicleScale1) || 1,
        scaleZ: Number(s.vehicleScale2) || 1,
        minZoom: Number.isFinite(Number(s.vehicleMinZoom)) ? Number(s.vehicleMinZoom) : 10,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function buildMetaPinRequests(
  store: LiveMapStore,
  visibleUserIds: number[],
): FleetMetaPinRequest[] {
  const out: FleetMetaPinRequest[] = [];
  const prioritizedIds = [...visibleUserIds].sort((a, b) => {
    const aMeta = store.getMeta(a);
    const bMeta = store.getMeta(b);
    const aPriority = aMeta?.isFriend || aMeta?.motionTier === 'full' ? 0 : 1;
    const bPriority = bMeta?.isFriend || bMeta?.motionTier === 'full' ? 0 : 1;
    return aPriority - bPriority;
  });
  for (const id of prioritizedIds) {
    const meta = store.getMeta(id);
    if (!meta) continue;
    const avatarUri = normalizeMediaUri(meta.avatarUrl);
    const frameUri = normalizeMediaUri(meta.avatarFrameUrl ?? null);
    const hasAvatar = avatarUri && /^https?:\/\//i.test(avatarUri);
    const username = meta.username?.trim() || 'Użytkownik';
    const initials = username.slice(0, 2).toUpperCase();
    const distanceLabel = 'LIVE';
    out.push({
      id,
      signature: buildPinSpriteSignature({
        id,
        username,
        avatarUrl: avatarUri ?? '',
        avatarFrameUrl: frameUri ?? '',
        isPremium: !!meta.isPremium,
        isFriend: !!meta.isFriend,
        initials,
        distanceLabel,
        stale: !!meta.stale,
        visualVersion: meta.premiumVisual?.visualVersion ?? null,
      }),
      data: {
        username,
        initials,
        distanceLabel,
        avatarUrl: hasAvatar ? avatarUri : null,
        avatarFrameUrl: frameUri || null,
        isPremium: !!meta.isPremium,
        premiumVisual: meta.premiumVisual ?? null,
        isFriend: !!meta.isFriend,
        stale: !!meta.stale,
      },
    });
  }
  return out;
}

/**
 * Złóż slot floty ze stanu store (V3-Lite pushTarget).
 * Nowa paczka (full): origin = bieżąca pozycja render -> brak skoku; duration z dystans/speed.
 * Teleport / nowy / static: snap do pozycji serwera.
 */
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

  const serverAt = Number.isFinite(Number(meta.serverAt))
    ? Number(meta.serverAt)
    : (pos.lastServerAt ?? now);
  const prevServerLat = pos.prevServerLat ?? prev?.serverLat ?? pos.lat;
  const prevServerLng = pos.prevServerLng ?? prev?.serverLng ?? pos.lng;
  const prevServerAt = pos.prevServerAt ?? prev?.lastServerAt ?? serverAt;

  // Prędkość: z serwera lub estymata z prev->server.
  const serverHeading = pos.heading != null && Number.isFinite(pos.heading) ? pos.heading : null;
  let speedMps = pos.speedMps != null && Number.isFinite(pos.speedMps) && pos.speedMps >= 0
    ? pos.speedMps
    : 0;
  if (speedMps < 0.8 && Number.isFinite(prevServerAt) && serverAt > prevServerAt) {
    const dtSec = (serverAt - prevServerAt) / 1000;
    const distM = haversineM(Number(prevServerLat), Number(prevServerLng), pos.lat, pos.lng);
    if (dtSec > 0.05 && distM > 0.5) speedMps = distM / dtSec;
  }

  // Heading: z serwera, inaczej bearing prev->server.
  let motionHeading = serverHeading ?? prev?.motionHeading ?? 0;
  if (serverHeading == null && prev && (prev.serverLat !== pos.lat || prev.serverLng !== pos.lng)) {
    motionHeading = bearingDegJs(prev.serverLat, prev.serverLng, pos.lat, pos.lng);
  }

  const distKm = anchor
    ? calculateDistance(anchor.latitude, anchor.longitude, pos.lat, pos.lng)
    : 0;
  const wasFull = prev?.animationTier === 1;
  const tier = meta.motionTier === 'full'
    ? 'full'
    : meta.motionTier === 'reduced' && !anchor
      ? 'static'
      : resolveFleetAnimationTierWithHysteresis(
      !!meta.isFriend,
      distKm,
      wasFull,
      FLEET_FULL_ANIMATION_RADIUS_KM,
      FLEET_FULL_ANIMATION_EXIT_KM,
      );
  const animationTier: AnimationTier = tier === 'full' ? 1 : 0;
  const roadTrail = animationTier === 1 && pos.trail && pos.trail.length >= 2
    ? pos.trail.slice()
    : [];

  const toLat = pos.lat;
  const toLng = pos.lng;
  const serverMoved = !prev || prev.serverLat !== pos.lat || prev.serverLng !== pos.lng;
  const teleport = !!prev
    && isImplausibleJump(prev.serverLat, prev.serverLng, prev.lastServerAt, pos.lat, pos.lng, serverAt);
  const confirmsPendingTeleport = !!prev
    && prev.pendingTeleportLat != null
    && prev.pendingTeleportLng != null
    && prev.pendingTeleportAt != null
    && serverAt > prev.pendingTeleportAt
    && haversineM(prev.pendingTeleportLat, prev.pendingTeleportLng, pos.lat, pos.lng) <= 150;

  if (teleport && !confirmsPendingTeleport && prev) {
    return {
      ...prev,
      pendingTeleportLat: pos.lat,
      pendingTeleportLng: pos.lng,
      pendingTeleportAt: serverAt,
    };
  }

  let fromLat: number;
  let fromLng: number;
  let fromHeading: number;
  let startMs = now;
  let durationMs = 0;

  if (animationTier === 0 || confirmsPendingTeleport || !prev || (prev.animationTier === 0 && animationTier === 1)) {
    // Static / teleport / nowy slot -> natychmiastowy snap na pozycję serwera.
    fromLat = toLat;
    fromLng = toLng;
    fromHeading = motionHeading;
    durationMs = 0;
  } else if (!serverMoved) {
    // Brak nowej pozycji serwera -> kontynuuj poprzedni segment (bez restartu).
    fromLat = prev.fromLat;
    fromLng = prev.fromLng;
    fromHeading = prev.fromHeading;
    startMs = prev.startMs;
    durationMs = prev.durationMs;
    motionHeading = prev.motionHeading;
  } else {
    // Full + ruch -> nowy segment lerp z bieżącej wyrenderowanej pozycji.
    const origin = resolveMotionJs(prev, now);
    fromLat = isValidFleetCoordJs(origin.lat, origin.lng) ? origin.lat : prev.renderLat;
    fromLng = isValidFleetCoordJs(origin.lat, origin.lng) ? origin.lng : prev.renderLng;
    fromHeading = Number.isFinite(origin.heading) ? origin.heading : (prev.heading ?? motionHeading);
    const serverIntervalMs = prev.lastServerAt > 0 ? serverAt - prev.lastServerAt : null;
    const correctionDistanceM = haversineM(fromLat, fromLng, toLat, toLng);
    const correctionDurationMs = correctionDurationForDistance(correctionDistanceM);
    durationMs = correctionDurationMs > 0
      ? correctionDurationMs
      : computeFleetPushDurationMs(fromLat, fromLng, toLat, toLng, speedMps, serverIntervalMs);
  }
  const segmentEndMs = startMs + durationMs;

  const avatarUri = normalizeMediaUri(meta.avatarUrl);
  const frameUri = normalizeMediaUri(meta.avatarFrameUrl ?? null);
  const hasAvatar = avatarUri && /^https?:\/\//i.test(avatarUri) ? 1 : 0;
  const username = meta.username?.trim() || 'Użytkownik';
  const initials = username.slice(0, 2).toUpperCase();
  const vMeta = meta.vehicleModelMeta;
  const vNorm = normalizeVehicleModelMeta(vMeta);
  const vehicleModelKey = meta.vehicleModelUrl ? registerModelUrl(meta.vehicleModelUrl) : '';
  const vehicleRotOffset = Number(vNorm.yawOffset) || 0;
  const vehiclePitch = Number(vNorm.pitch) || 0;
  const vehicleRoll = Number(vNorm.roll) || 0;
  const vehicleScale = resolveMapVehicleScale(vNorm.scale);
  const vehicleScale0 = vehicleScale[0];
  const vehicleScale1 = vehicleScale[1];
  const vehicleScale2 = vehicleScale[2];
  const vehicleMinZoom = Number.isFinite(Number(vNorm.minZoom)) ? Number(vNorm.minZoom) : 10;

  const draft: FleetSlot = {
    id,
    animationTier,
    renderLat: pos.lat,
    renderLng: pos.lng,
    heading: motionHeading,
    fromLat,
    fromLng,
    toLat,
    toLng,
    startMs,
    durationMs,
    segmentEndMs,
    fromHeading,
    motionHeading,
    speedMps,
    roadTrail,
    serverLat: pos.lat,
    serverLng: pos.lng,
    lastServerAt: serverAt,
    pendingTeleportLat: null,
    pendingTeleportLng: null,
    pendingTeleportAt: null,
    lastGoodLat: pos.lat,
    lastGoodLng: pos.lng,
    isPremium: meta.isPremium ? 1 : 0,
    isFriend: meta.isFriend ? 1 : 0,
    stale: meta.stale ? 1 : 0,
    avatarUrl: avatarUri ?? '',
    avatarFrameUrl: frameUri ?? '',
    hasAvatar,
    username,
    initials,
    distanceLabel: `${distKm.toFixed(1)} km`,
    pinColor: pinColorFor(meta),
    vehicleModelKey,
    vehicleRotOffset,
    vehiclePitch,
    vehicleRoll,
    vehicleElevationZ: Number.isFinite(Number(vNorm.elevationZ)) ? Number(vNorm.elevationZ) : 0.8,
    vehicleScale0,
    vehicleScale1,
    vehicleScale2,
    vehicleMinZoom,
  };

  const resolved = resolveMotionJs(draft, now);
  const renderValid = isValidFleetCoordJs(resolved.lat, resolved.lng);
  return {
    ...draft,
    renderLat: renderValid ? resolved.lat : pos.lat,
    renderLng: renderValid ? resolved.lng : pos.lng,
    heading: resolved.heading,
    lastGoodLat: renderValid ? resolved.lat : pos.lat,
    lastGoodLng: renderValid ? resolved.lng : pos.lng,
  };
}

export function useLiveFleetAnimator(
  store: LiveMapStore,
  visibleUserIds: number[],
  enabled: boolean,
  anchor: { latitude: number; longitude: number } | null,
  viewportBounds: ViewportBounds = EMPTY_VIEWPORT,
  currentZoom = 0,
) {
  const [metaRevision, setMetaRevision] = useState(0);
  const [metaPinRequests, setMetaPinRequests] = useState<FleetMetaPinRequest[]>([]);
  const metaPinsKeyRef = useRef('');
  const coldShapesKeyRef = useRef('');
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const visibleKey = useMemo(
    () => visibleUserIds.slice().sort((a, b) => a - b).join(','),
    [visibleUserIds],
  );

  const viewportKey = viewportBounds.valid === 1
    ? `${viewportBounds.north.toFixed(4)}:${viewportBounds.south.toFixed(4)}:${viewportBounds.east.toFixed(4)}:${viewportBounds.west.toFixed(4)}`
    : 'invalid';

  const fleetSv = useSharedValue<FleetSlot[]>([]);
  const hotShapeSv = useSharedValue<LiveFleetGeoJson>(EMPTY_FC);
  const coldShapeSv = useSharedValue<LiveFleetGeoJson>(EMPTY_FC);
  const hotVehicleShapeSv = useSharedValue<LiveFleetGeoJson>(EMPTY_VEHICLE_FC);
  const coldVehicleShapeSv = useSharedValue<LiveFleetGeoJson>(EMPTY_VEHICLE_FC);
  const enterViewportSv = useSharedValue<ViewportBounds>(EMPTY_VIEWPORT);
  const exitViewportSv = useSharedValue<ViewportBounds>(EMPTY_VIEWPORT);
  const lastPublishAtSv = useSharedValue(0);
  const lastStatsAtSv = useSharedValue(0);
  const fleetStatsSv = useSharedValue<LiveFleetStats>({
    candidates: 0,
    visible: 0,
    culled: 0,
    published: 0,
  });
  const currentZoomSv = useSharedValue(currentZoom);

  useEffect(() => {
    currentZoomSv.value = currentZoom;
  }, [currentZoom, currentZoomSv]);

  useEffect(() => {
    enterViewportSv.value = expandBoundsByMeters(viewportBounds, VIEWPORT_ENTER_MARGIN_M);
    exitViewportSv.value = expandBoundsByMeters(viewportBounds, VIEWPORT_EXIT_MARGIN_M);
  }, [
    viewportBounds,
    enterViewportSv,
    exitViewportSv,
  ]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = store.subscribeUserIds(() => setMetaRevision((r) => r + 1));
    return () => {
      unsubscribe();
    };
  }, [store, enabled]);

  const publishMetaPins = useCallback((ids: number[]) => {
    const requests = buildMetaPinRequests(store, ids);
    const key = requests.map((request) => request.signature).join(';;');
    if (key === metaPinsKeyRef.current) return;
    metaPinsKeyRef.current = key;
    setMetaPinRequests(requests);
  }, [store]);

  const publishColdShapes = useCallback((
    slots: FleetSlot[],
    now: number,
    bounds: ViewportBounds,
  ) => {
    const coldPins = buildGeoJsonLive(slots, now, bounds, 0);
    const coldVehicles = buildVehicleGeoJson(
      slots,
      now,
      bounds,
      currentZoomSv.value,
      0,
    );
    const key = fleetGeoJsonKey(coldPins, coldVehicles);
    if (key === coldShapesKeyRef.current) return;
    coldShapesKeyRef.current = key;
    coldShapeSv.value = coldPins;
    coldVehicleShapeSv.value = coldVehicles;
  }, [coldShapeSv, coldVehicleShapeSv, currentZoomSv]);

  const clearFleet = useCallback(() => {
    fleetSv.value = [];
    hotShapeSv.value = EMPTY_FC;
    coldShapeSv.value = EMPTY_FC;
    hotVehicleShapeSv.value = EMPTY_VEHICLE_FC;
    coldVehicleShapeSv.value = EMPTY_VEHICLE_FC;
    lastPublishAtSv.value = -1;
    fleetStatsSv.value = {
      candidates: 0,
      visible: 0,
      culled: 0,
      published: fleetStatsSv.value.published,
    };
    metaPinsKeyRef.current = '';
    coldShapesKeyRef.current = '';
    setMetaPinRequests([]);
  }, [
    fleetSv,
    hotShapeSv,
    coldShapeSv,
    hotVehicleShapeSv,
    coldVehicleShapeSv,
    lastPublishAtSv,
    fleetStatsSv,
  ]);

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
      const slot = mergeSlotFromStore(id, store, prev, anchorRef.current, now);
      if (slot) next.push(slot);
    }

    fleetSv.value = next;
    hotShapeSv.value = next.length > 0
      ? buildGeoJsonLive(next, now, exitViewportSv.value, 1)
      : EMPTY_FC;
    hotVehicleShapeSv.value = next.length > 0
      ? buildVehicleGeoJson(next, now, exitViewportSv.value, currentZoomSv.value, 1)
      : EMPTY_VEHICLE_FC;
    publishColdShapes(next, now, exitViewportSv.value);
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
    fleetSv,
    hotShapeSv,
    hotVehicleShapeSv,
    currentZoomSv,
    enterViewportSv,
    exitViewportSv,
    lastPublishAtSv,
    fleetStatsSv,
    clearFleet,
    isStorePositionInBounds,
    publishMetaPins,
    publishColdShapes,
    viewportBounds.valid,
  ]);

  useEffect(() => {
    rebuildFleetFromStore();
  }, [rebuildFleetFromStore, visibleKey, metaRevision, viewportKey, currentZoom]);

  useEffect(() => {
    if (!enabled || visibleUserIds.length === 0) return;

    const visibleSet = new Set(visibleUserIds);

    const onPositions = (ids: number[]) => {
      if (enterViewportSv.value.valid !== 1) return;
      const slots = fleetSv.value;
      const now = Date.now();
      const next = slots.slice();
      let changed = false;

      for (const id of ids) {
        if (!visibleSet.has(id)) continue;
        const pos = store.getPosition(id);
        if (!pos) continue;
        const idx = next.findIndex((slot) => slot.id === id);
        const prev = idx >= 0 ? next[idx] : undefined;
        if (!prev && !isInViewport(pos.lat, pos.lng, enterViewportSv.value)) continue;
        const merged = mergeSlotFromStore(id, store, prev, anchorRef.current, now);
        if (!merged) continue;

        if (idx >= 0) {
          if (isInViewport(merged.renderLat, merged.renderLng, exitViewportSv.value)) {
            next[idx] = merged;
          } else {
            next.splice(idx, 1);
          }
        } else {
          next.push(merged);
        }
        changed = true;
      }

      if (!changed) return;
      fleetSv.value = next;
      fleetStatsSv.value = {
        candidates: visibleUserIds.length,
        visible: next.length,
        culled: Math.max(0, visibleUserIds.length - next.length),
        published: fleetStatsSv.value.published,
      };
      if (next.length > 0) {
        hotShapeSv.value = buildGeoJsonLive(next, now, exitViewportSv.value, 1);
        hotVehicleShapeSv.value = buildVehicleGeoJson(
          next,
          now,
          exitViewportSv.value,
          currentZoomSv.value,
          1,
        );
        publishColdShapes(next, now, exitViewportSv.value);
        lastPublishAtSv.value = now;
      } else {
        hotShapeSv.value = EMPTY_FC;
        coldShapeSv.value = EMPTY_FC;
        hotVehicleShapeSv.value = EMPTY_VEHICLE_FC;
        coldVehicleShapeSv.value = EMPTY_VEHICLE_FC;
      }
      const prevKey = slots.map((s) => s.id).join(',');
      const nextKey = next.map((s) => s.id).join(',');
      if (prevKey !== nextKey) {
        publishMetaPins(next.map((s) => s.id));
      }
    };

    const unsubscribe = store.subscribeFleetDeltas(onPositions);
    return () => {
      unsubscribe();
    };
  }, [
    store,
    visibleKey,
    enabled,
    visibleUserIds,
    fleetSv,
    enterViewportSv,
    exitViewportSv,
    fleetStatsSv,
    lastPublishAtSv,
    hotShapeSv,
    coldShapeSv,
    hotVehicleShapeSv,
    coldVehicleShapeSv,
    currentZoomSv,
    publishMetaPins,
    publishColdShapes,
  ]);

  const frameWorklet = useCallback(() => {
    'worklet';
    const exitBounds = exitViewportSv.value;
    if (exitBounds.valid !== 1) return;

    const slots = fleetSv.value;
    if (!slots.length) {
      if (lastPublishAtSv.value !== -1) {
        hotShapeSv.value = EMPTY_FC;
        coldShapeSv.value = EMPTY_FC;
        hotVehicleShapeSv.value = EMPTY_VEHICLE_FC;
        coldVehicleShapeSv.value = EMPTY_VEHICLE_FC;
        lastPublishAtSv.value = -1;
      }
      return;
    }

    const nowMs = Date.now();
    if (!shouldPublishFleetFrame(nowMs, lastPublishAtSv.value, FLEET_PUBLISH_INTERVAL_MS)) return;
    const hotPins = buildGeoJsonLive(slots, nowMs, exitBounds, 1);
    const hotVehicles = buildVehicleGeoJson(
      slots,
      nowMs,
      exitBounds,
      currentZoomSv.value,
      1,
    );
    hotShapeSv.value = hotPins;
    hotVehicleShapeSv.value = hotVehicles;
    lastPublishAtSv.value = nowMs;
    if (lastStatsAtSv.value <= 0 || nowMs - lastStatsAtSv.value >= FLEET_STATS_THROTTLE_MS) {
      lastStatsAtSv.value = nowMs;
      const visible =
        hotPins.features.length
        + hotVehicles.features.length
        + coldShapeSv.value.features.length
        + coldVehicleShapeSv.value.features.length;
      fleetStatsSv.value = {
        candidates: fleetStatsSv.value.candidates,
        visible,
        culled: Math.max(0, fleetStatsSv.value.candidates - visible),
        published: fleetStatsSv.value.published + 1,
      };
    }
  }, [
    coldShapeSv,
    coldVehicleShapeSv,
    currentZoomSv,
    exitViewportSv,
    fleetStatsSv,
    fleetSv,
    hotShapeSv,
    hotVehicleShapeSv,
    lastPublishAtSv,
    lastStatsAtSv,
  ]);

  const frameCallback = useFrameCallback(frameWorklet, false);

  useEffect(() => {
    frameCallback.setActive(enabled && visibleUserIds.length > 0);
    return () => frameCallback.setActive(false);
  }, [enabled, visibleUserIds.length, frameCallback]);

  // RNMBXShapeSource.setShape wymaga GeoJSON string (nie obiektu) przy animatedProps.
  const hotAnimatedShapeProps = useAnimatedProps(() => {
    'worklet';
    return {
      shape: JSON.stringify(hotShapeSv.value),
    };
  });

  const coldAnimatedShapeProps = useAnimatedProps(() => {
    'worklet';
    return {
      shape: JSON.stringify(coldShapeSv.value),
    };
  });

  const hotVehicleAnimatedShapeProps = useAnimatedProps(() => {
    'worklet';
    return {
      shape: JSON.stringify(hotVehicleShapeSv.value),
    };
  });

  const coldVehicleAnimatedShapeProps = useAnimatedProps(() => {
    'worklet';
    return {
      shape: JSON.stringify(coldVehicleShapeSv.value),
    };
  });

  const hasFleet = metaPinRequests.length > 0;

  return {
    hotAnimatedShapeProps,
    coldAnimatedShapeProps,
    hotVehicleAnimatedShapeProps,
    coldVehicleAnimatedShapeProps,
    metaPinRequests,
    hasFleet,
    fleetStats: fleetStatsSv,
  };
}
