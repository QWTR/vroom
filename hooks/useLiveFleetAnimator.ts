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
  shouldPublishFleetFrame,
  FLEET_FULL_ANIMATION_RADIUS_KM,
  FLEET_FULL_ANIMATION_EXIT_KM,
  FLEET_SLOT_MAX_POINTS,
  FLEET_EXTRAPOLATE_MAX_MS,
  FLEET_CLIENT_SEG_MIN_MS,
  FLEET_CLIENT_SEG_MAX_MS,
  FLEET_CLIENT_SEG_DEFAULT_MS,
} from './liveFleetMotion';
import {
  interpolateAlongTrail,
  interpolateAlongPolyline,
  interpolateEntity,
  isImplausibleJump,
  resolveFleetAnimationTierWithHysteresis,
  samplePolylineForSlot,
  isTrailChordFlat,
  buildAnimationTrail,
  extrapolateFleetPosition,
  haversineM as haversineMShared,
  bearingDeg as bearingDegShared,
  clamp01 as clamp01Shared,
  lerp as lerpShared,
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
  trail4Lat: number;
  trail4Lng: number;
  trail4T: number;
  trail5Lat: number;
  trail5Lng: number;
  trail5T: number;
  trail6Lat: number;
  trail6Lng: number;
  trail6T: number;
  trail7Lat: number;
  trail7Lng: number;
  trail7T: number;
  polylineLen: number;
  polyline0Lat: number;
  polyline0Lng: number;
  polyline1Lat: number;
  polyline1Lng: number;
  polyline2Lat: number;
  polyline2Lng: number;
  polyline3Lat: number;
  polyline3Lng: number;
  polyline4Lat: number;
  polyline4Lng: number;
  polyline5Lat: number;
  polyline5Lng: number;
  polyline6Lat: number;
  polyline6Lng: number;
  polyline7Lat: number;
  polyline7Lng: number;
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
  clientSegFromLat: number;
  clientSegFromLng: number;
  clientSegToLat: number;
  clientSegToLng: number;
  clientSegStartMs: number;
  clientSegDurMs: number;
  clientRecvAt: number;
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

function emptyTrailPack() {
  return {
    trailLen: 0,
    trail0Lat: 0, trail0Lng: 0, trail0T: 0,
    trail1Lat: 0, trail1Lng: 0, trail1T: 0,
    trail2Lat: 0, trail2Lng: 0, trail2T: 0,
    trail3Lat: 0, trail3Lng: 0, trail3T: 0,
    trail4Lat: 0, trail4Lng: 0, trail4T: 0,
    trail5Lat: 0, trail5Lng: 0, trail5T: 0,
    trail6Lat: 0, trail6Lng: 0, trail6T: 0,
    trail7Lat: 0, trail7Lng: 0, trail7T: 0,
  };
}

function emptyPolylinePack() {
  return {
    polylineLen: 0,
    polyline0Lat: 0, polyline0Lng: 0,
    polyline1Lat: 0, polyline1Lng: 0,
    polyline2Lat: 0, polyline2Lng: 0,
    polyline3Lat: 0, polyline3Lng: 0,
    polyline4Lat: 0, polyline4Lng: 0,
    polyline5Lat: 0, polyline5Lng: 0,
    polyline6Lat: 0, polyline6Lng: 0,
    polyline7Lat: 0, polyline7Lng: 0,
  };
}

function packTrail(trail: FleetTrailPoint[] | undefined) {
  const pts = trail ?? [];
  const base = emptyTrailPack();
  const len = Math.min(pts.length, FLEET_SLOT_MAX_POINTS);
  const latKeys = ['trail0Lat', 'trail1Lat', 'trail2Lat', 'trail3Lat', 'trail4Lat', 'trail5Lat', 'trail6Lat', 'trail7Lat'] as const;
  const lngKeys = ['trail0Lng', 'trail1Lng', 'trail2Lng', 'trail3Lng', 'trail4Lng', 'trail5Lng', 'trail6Lng', 'trail7Lng'] as const;
  const tKeys = ['trail0T', 'trail1T', 'trail2T', 'trail3T', 'trail4T', 'trail5T', 'trail6T', 'trail7T'] as const;
  for (let i = 0; i < len; i++) {
    (base as Record<string, number>)[latKeys[i]] = pts[i].lat;
    (base as Record<string, number>)[lngKeys[i]] = pts[i].lng;
    (base as Record<string, number>)[tKeys[i]] = pts[i].t;
  }
  return { ...base, trailLen: len };
}

function unpackTrail(s: FleetSlot): FleetTrailPoint[] {
  const out: FleetTrailPoint[] = [];
  const latVals = [s.trail0Lat, s.trail1Lat, s.trail2Lat, s.trail3Lat, s.trail4Lat, s.trail5Lat, s.trail6Lat, s.trail7Lat];
  const lngVals = [s.trail0Lng, s.trail1Lng, s.trail2Lng, s.trail3Lng, s.trail4Lng, s.trail5Lng, s.trail6Lng, s.trail7Lng];
  const tVals = [s.trail0T, s.trail1T, s.trail2T, s.trail3T, s.trail4T, s.trail5T, s.trail6T, s.trail7T];
  for (let i = 0; i < s.trailLen && i < FLEET_SLOT_MAX_POINTS; i++) {
    out.push({ lat: latVals[i], lng: lngVals[i], t: tVals[i] });
  }
  return out;
}

function packPolyline(polyline: { lat: number; lng: number }[] | undefined) {
  const sampled = samplePolylineForSlot(polyline ?? [], FLEET_SLOT_MAX_POINTS);
  const base = emptyPolylinePack();
  const latKeys = ['polyline0Lat', 'polyline1Lat', 'polyline2Lat', 'polyline3Lat', 'polyline4Lat', 'polyline5Lat', 'polyline6Lat', 'polyline7Lat'] as const;
  const lngKeys = ['polyline0Lng', 'polyline1Lng', 'polyline2Lng', 'polyline3Lng', 'polyline4Lng', 'polyline5Lng', 'polyline6Lng', 'polyline7Lng'] as const;
  for (let i = 0; i < sampled.length; i++) {
    (base as Record<string, number>)[latKeys[i]] = sampled[i].lat;
    (base as Record<string, number>)[lngKeys[i]] = sampled[i].lng;
  }
  return { ...base, polylineLen: sampled.length };
}

function unpackPolyline(s: FleetSlot): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = [];
  const latVals = [s.polyline0Lat, s.polyline1Lat, s.polyline2Lat, s.polyline3Lat, s.polyline4Lat, s.polyline5Lat, s.polyline6Lat, s.polyline7Lat];
  const lngVals = [s.polyline0Lng, s.polyline1Lng, s.polyline2Lng, s.polyline3Lng, s.polyline4Lng, s.polyline5Lng, s.polyline6Lng, s.polyline7Lng];
  for (let i = 0; i < s.polylineLen && i < FLEET_SLOT_MAX_POINTS; i++) {
    out.push({ lat: latVals[i], lng: lngVals[i] });
  }
  return out;
}

function getTrailPointFromSlot(s: FleetSlot, idx: number): { lat: number; lng: number; t: number } {
  'worklet';
  const lats = [s.trail0Lat, s.trail1Lat, s.trail2Lat, s.trail3Lat, s.trail4Lat, s.trail5Lat, s.trail6Lat, s.trail7Lat];
  const lngs = [s.trail0Lng, s.trail1Lng, s.trail2Lng, s.trail3Lng, s.trail4Lng, s.trail5Lng, s.trail6Lng, s.trail7Lng];
  const ts = [s.trail0T, s.trail1T, s.trail2T, s.trail3T, s.trail4T, s.trail5T, s.trail6T, s.trail7T];
  return { lat: lats[idx], lng: lngs[idx], t: ts[idx] };
}

function getPolylinePointFromSlot(s: FleetSlot, idx: number): { lat: number; lng: number } {
  'worklet';
  const lats = [s.polyline0Lat, s.polyline1Lat, s.polyline2Lat, s.polyline3Lat, s.polyline4Lat, s.polyline5Lat, s.polyline6Lat, s.polyline7Lat];
  const lngs = [s.polyline0Lng, s.polyline1Lng, s.polyline2Lng, s.polyline3Lng, s.polyline4Lng, s.polyline5Lng, s.polyline6Lng, s.polyline7Lng];
  return { lat: lats[idx], lng: lngs[idx] };
}

function copyFleetSlotWithRender(
  s: FleetSlot,
  lat: number,
  lng: number,
  lastGoodLat: number,
  lastGoodLng: number,
  heading: number,
  correctionElapsedMs: number,
): FleetSlot {
  'worklet';
  return {
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
    trail4Lat: s.trail4Lat,
    trail4Lng: s.trail4Lng,
    trail4T: s.trail4T,
    trail5Lat: s.trail5Lat,
    trail5Lng: s.trail5Lng,
    trail5T: s.trail5T,
    trail6Lat: s.trail6Lat,
    trail6Lng: s.trail6Lng,
    trail6T: s.trail6T,
    trail7Lat: s.trail7Lat,
    trail7Lng: s.trail7Lng,
    trail7T: s.trail7T,
    polylineLen: s.polylineLen,
    polyline0Lat: s.polyline0Lat,
    polyline0Lng: s.polyline0Lng,
    polyline1Lat: s.polyline1Lat,
    polyline1Lng: s.polyline1Lng,
    polyline2Lat: s.polyline2Lat,
    polyline2Lng: s.polyline2Lng,
    polyline3Lat: s.polyline3Lat,
    polyline3Lng: s.polyline3Lng,
    polyline4Lat: s.polyline4Lat,
    polyline4Lng: s.polyline4Lng,
    polyline5Lat: s.polyline5Lat,
    polyline5Lng: s.polyline5Lng,
    polyline6Lat: s.polyline6Lat,
    polyline6Lng: s.polyline6Lng,
    polyline7Lat: s.polyline7Lat,
    polyline7Lng: s.polyline7Lng,
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
    clientSegFromLat: s.clientSegFromLat,
    clientSegFromLng: s.clientSegFromLng,
    clientSegToLat: s.clientSegToLat,
    clientSegToLng: s.clientSegToLng,
    clientSegStartMs: s.clientSegStartMs,
    clientSegDurMs: s.clientSegDurMs,
    clientRecvAt: s.clientRecvAt,
    isPremium: s.isPremium,
    isFriend: s.isFriend,
    avatarUrl: s.avatarUrl,
    avatarFrameUrl: s.avatarFrameUrl,
    hasAvatar: s.hasAvatar,
    username: s.username,
    initials: s.initials,
    distanceLabel: s.distanceLabel,
    pinColor: s.pinColor,
  };
}

function resolveClientSegmentJs(
  s: FleetSlot,
  nowMs: number,
): { lat: number; lng: number; heading: number } | null {
  if (s.animationTier === 0 || s.clientSegDurMs <= 0) return null;
  const hdg = bearingDegJs(
    s.clientSegFromLat,
    s.clientSegFromLng,
    s.clientSegToLat,
    s.clientSegToLng,
  );
  const t = Math.max(0, Math.min(1, (nowMs - s.clientSegStartMs) / s.clientSegDurMs));
  if (t < 1) {
    return {
      lat: s.clientSegFromLat + (s.clientSegToLat - s.clientSegFromLat) * t,
      lng: s.clientSegFromLng + (s.clientSegToLng - s.clientSegFromLng) * t,
      heading: hdg,
    };
  }
  return extrapolateFleetPosition(
    s.clientSegToLat,
    s.clientSegToLng,
    hdg,
    s.speedMps,
    s.clientSegStartMs + s.clientSegDurMs,
    nowMs,
    FLEET_EXTRAPOLATE_MAX_MS,
  );
}

function extrapolateFleetPositionWorklet(
  lat: number,
  lng: number,
  heading: number,
  speedMps: number,
  lastServerAt: number,
  nowMs: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  const ageMs = nowMs - lastServerAt;
  if (!Number.isFinite(ageMs) || ageMs <= 0 || !Number.isFinite(speedMps) || speedMps < 0.8) {
    return { lat, lng, heading };
  }
  const cappedMs = Math.min(ageMs, 2800);
  const distM = speedMps * (cappedMs / 1000);
  const moved = moveAlongBearing(lat, lng, heading, distM);
  return { lat: moved.lat, lng: moved.lng, heading };
}

function finalizeFleetMotion(
  base: { lat: number; lng: number; heading: number },
  s: FleetSlot,
  nowMs: number,
): { lat: number; lng: number; heading: number } {
  if (nowMs <= s.lastServerAt) return base;
  return extrapolateFleetPosition(
    base.lat,
    base.lng,
    base.heading || s.targetHeading,
    s.speedMps,
    s.lastServerAt,
    nowMs,
    FLEET_EXTRAPOLATE_MAX_MS,
  );
}

function finalizeFleetMotionWorklet(
  base: { lat: number; lng: number; heading: number },
  s: FleetSlot,
  nowMs: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  if (nowMs <= s.lastServerAt) return base;
  return extrapolateFleetPositionWorklet(
    base.lat,
    base.lng,
    base.heading || s.targetHeading,
    s.speedMps,
    s.lastServerAt,
    nowMs,
  );
}

function resolveClientSegmentWorklet(
  s: FleetSlot,
  nowMs: number,
): { lat: number; lng: number; heading: number } | null {
  'worklet';
  if (s.animationTier === 0 || s.clientSegDurMs <= 0) return null;
  const hdg = bearingDegShared(
    s.clientSegFromLat,
    s.clientSegFromLng,
    s.clientSegToLat,
    s.clientSegToLng,
  );
  const t = clamp01Shared((nowMs - s.clientSegStartMs) / s.clientSegDurMs);
  if (t < 1) {
    return {
      lat: lerpShared(s.clientSegFromLat, s.clientSegToLat, t),
      lng: lerpShared(s.clientSegFromLng, s.clientSegToLng, t),
      heading: hdg,
    };
  }
  return extrapolateFleetPositionWorklet(
    s.clientSegToLat,
    s.clientSegToLng,
    hdg,
    s.speedMps,
    s.clientSegStartMs + s.clientSegDurMs,
    nowMs,
  );
}

function resolveFleetPositionJs(
  s: FleetSlot,
  now: number,
): { lat: number; lng: number; heading: number } {
  if (s.animationTier === 0) {
    return { lat: s.serverLat, lng: s.serverLng, heading: s.heading };
  }

  const client = resolveClientSegmentJs(s, now);
  if (client) return client;

  let base = { lat: s.serverLat, lng: s.serverLng, heading: s.heading || s.targetHeading };

  const trail = unpackTrail(s);
  if (trail.length >= 2) {
    const pos = interpolateAlongTrail(trail, now);
    if (pos) base = pos;
    else return finalizeFleetMotion(base, s, now);
    return finalizeFleetMotion(base, s, now);
  }

  const polyline = unpackPolyline(s);
  if (polyline.length >= 2 && s.lastServerAt > s.prevServerAt) {
    const progress = (now - s.prevServerAt) / (s.lastServerAt - s.prevServerAt);
    const pos = interpolateAlongPolyline(polyline, progress);
    if (pos) base = pos;
    return finalizeFleetMotion(base, s, now);
  }

  if (
    Number.isFinite(s.prevServerLat)
    && Number.isFinite(s.prevServerLng)
    && Number.isFinite(s.prevServerAt)
    && Number.isFinite(s.lastServerAt)
    && s.lastServerAt > s.prevServerAt
  ) {
    base = interpolateEntity(
      s.prevServerLat,
      s.prevServerLng,
      s.prevServerAt,
      s.serverLat,
      s.serverLng,
      s.lastServerAt,
      now,
    );
  }

  return finalizeFleetMotion(base, s, now);
}

function resolveFleetPositionWorklet(
  s: FleetSlot,
  nowMs: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  if (s.animationTier === 0) {
    return { lat: s.serverLat, lng: s.serverLng, heading: s.heading };
  }

  const client = resolveClientSegmentWorklet(s, nowMs);
  if (client) return client;

  let baseLat = s.serverLat;
  let baseLng = s.serverLng;
  let baseHeading = s.heading || s.targetHeading;
  let resolved = false;

  if (s.trailLen >= 2) {
    const first = getTrailPointFromSlot(s, 0);
    const last = getTrailPointFromSlot(s, s.trailLen - 1);
    if (Number.isFinite(first.t) && Number.isFinite(last.t) && last.t > first.t) {
      const tNorm = clamp01Shared((nowMs - first.t) / (last.t - first.t));
      let acc = 0;
      for (let i = 1; i < s.trailLen; i++) {
        const a = getTrailPointFromSlot(s, i - 1);
        const b = getTrailPointFromSlot(s, i);
        acc += haversineMShared(a.lat, a.lng, b.lat, b.lng);
      }
      if (acc > 0.5) {
        const targetM = tNorm * acc;
        let walked = 0;
        for (let i = 1; i < s.trailLen; i++) {
          const a = getTrailPointFromSlot(s, i - 1);
          const b = getTrailPointFromSlot(s, i);
          const seg = haversineMShared(a.lat, a.lng, b.lat, b.lng);
          if (walked + seg >= targetM) {
            const segT = seg > 0 ? (targetM - walked) / seg : 0;
            baseLat = lerpShared(a.lat, b.lat, segT);
            baseLng = lerpShared(a.lng, b.lng, segT);
            baseHeading = bearingDegShared(a.lat, a.lng, b.lat, b.lng);
            resolved = true;
            break;
          }
          walked += seg;
        }
        if (!resolved) {
          const prev = getTrailPointFromSlot(s, s.trailLen - 2);
          baseLat = last.lat;
          baseLng = last.lng;
          baseHeading = bearingDegShared(prev.lat, prev.lng, last.lat, last.lng);
          resolved = true;
        }
      }
    }
  }

  if (!resolved && s.polylineLen >= 2 && s.lastServerAt > s.prevServerAt) {
    const progress = (nowMs - s.prevServerAt) / (s.lastServerAt - s.prevServerAt);
    const tNorm = clamp01Shared(progress);
    let acc = 0;
    for (let i = 1; i < s.polylineLen; i++) {
      const a = getPolylinePointFromSlot(s, i - 1);
      const b = getPolylinePointFromSlot(s, i);
      acc += haversineMShared(a.lat, a.lng, b.lat, b.lng);
    }
    if (acc > 0.5) {
      const targetM = tNorm * acc;
      let walked = 0;
      for (let i = 1; i < s.polylineLen; i++) {
        const a = getPolylinePointFromSlot(s, i - 1);
        const b = getPolylinePointFromSlot(s, i);
        const seg = haversineMShared(a.lat, a.lng, b.lat, b.lng);
        if (walked + seg >= targetM) {
          const segT = seg > 0 ? (targetM - walked) / seg : 0;
          baseLat = lerpShared(a.lat, b.lat, segT);
          baseLng = lerpShared(a.lng, b.lng, segT);
          baseHeading = bearingDegShared(a.lat, a.lng, b.lat, b.lng);
          resolved = true;
          break;
        }
        walked += seg;
      }
      if (!resolved) {
        const prev = getPolylinePointFromSlot(s, s.polylineLen - 2);
        const tail = getPolylinePointFromSlot(s, s.polylineLen - 1);
        baseLat = tail.lat;
        baseLng = tail.lng;
        baseHeading = bearingDegShared(prev.lat, prev.lng, tail.lat, tail.lng);
        resolved = true;
      }
    }
  }

  if (
    !resolved
    && Number.isFinite(s.prevServerLat)
    && Number.isFinite(s.prevServerLng)
    && Number.isFinite(s.prevServerAt)
    && Number.isFinite(s.lastServerAt)
    && s.lastServerAt > s.prevServerAt
  ) {
    const dt = s.lastServerAt - s.prevServerAt;
    const t = dt > 50 ? clamp01Shared((nowMs - s.prevServerAt) / dt) : 1;
    baseLat = lerpShared(s.prevServerLat, s.serverLat, t);
    baseLng = lerpShared(s.prevServerLng, s.serverLng, t);
    baseHeading = bearingDegShared(s.prevServerLat, s.prevServerLng, s.serverLat, s.serverLng);
  }

  return finalizeFleetMotionWorklet(
    { lat: baseLat, lng: baseLng, heading: baseHeading },
    s,
    nowMs,
  );
}

function buildGeoJsonLive(
  slots: FleetSlot[],
  nowMs: number,
  exitBounds: ViewportBounds,
): LiveFleetGeoJson {
  'worklet';
  const features: LiveFleetFeature[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const resolved = resolveClientSegmentWorklet(s, nowMs)
      ?? resolveFleetPositionWorklet(s, nowMs);
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
      properties: { id: s.id, heading: resolved.heading },
    });
  }
  return { type: 'FeatureCollection', features };
}

function computeClientSegmentDurationMs(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  speedMps: number,
): number {
  const distM = haversineM(fromLat, fromLng, toLat, toLng);
  if (distM < 0.5) return 0;
  let durMs = FLEET_CLIENT_SEG_DEFAULT_MS;
  if (speedMps > 0.5) {
    durMs = Math.round((distM / speedMps) * 1000);
  }
  return Math.max(FLEET_CLIENT_SEG_MIN_MS, Math.min(FLEET_CLIENT_SEG_MAX_MS, durMs));
}

function resolveClientSegOrigin(
  prev: FleetSlot,
  now: number,
): { lat: number; lng: number } {
  const seg = resolveClientSegmentJs(prev, now);
  if (seg) return { lat: seg.lat, lng: seg.lng };
  if (isValidFleetCoordJs(prev.renderLat, prev.renderLng)) {
    return { lat: prev.renderLat, lng: prev.renderLng };
  }
  return { lat: prev.serverLat, lng: prev.serverLng };
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
  let serverSpeedMps = pos.speedMps != null && Number.isFinite(pos.speedMps) && pos.speedMps >= 0
    ? pos.speedMps
    : 0;
  if (serverSpeedMps < 0.8 && Number.isFinite(prevServerAt) && serverAt > prevServerAt) {
    const dtSec = (serverAt - prevServerAt) / 1000;
    const distM = haversineM(
      Number(prevServerLat),
      Number(prevServerLng),
      pos.lat,
      pos.lng,
    );
    if (dtSec > 0.05 && distM > 0.5) {
      serverSpeedMps = distM / dtSec;
    }
  }

  let targetHeading = serverHeading ?? prev?.targetHeading ?? 0;
  if (serverHeading == null && prev && (prev.serverLat !== pos.lat || prev.serverLng !== pos.lng)) {
    targetHeading = bearingDegJs(prev.serverLat, prev.serverLng, pos.lat, pos.lng);
  }

  const distKm = anchor
    ? calculateDistance(anchor.latitude, anchor.longitude, pos.lat, pos.lng)
    : 0;
  const wasFull = prev?.animationTier === 1;
  const tier = resolveFleetAnimationTierWithHysteresis(
    !!meta.isFriend,
    distKm,
    wasFull,
    FLEET_FULL_ANIMATION_RADIUS_KM,
    FLEET_FULL_ANIMATION_EXIT_KM,
  );
  const animationTier: AnimationTier = tier === 'full' ? 1 : 0;

  const animationTrail = buildAnimationTrail({
    trail: pos.trail,
    prevServerLat,
    prevServerLng,
    prevServerAt,
    serverLat: pos.lat,
    serverLng: pos.lng,
    serverAt,
    heading: targetHeading,
    speedMps: serverSpeedMps,
  });
  const polyline = pos.osrmPolyline;
  const packedTrail = packTrail(animationTrail.length >= 2 ? animationTrail : pos.trail);
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
    clientSegFromLat: pos.lat,
    clientSegFromLng: pos.lng,
    clientSegToLat: pos.lat,
    clientSegToLng: pos.lng,
    clientSegStartMs: now,
    clientSegDurMs: 0,
    clientRecvAt: now,
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

  let nextRenderLat: number;
  let nextRenderLng: number;
  let resolvedHeading = targetHeading;
  let correctionDurationMs = 0;

  if (animationTier === 0) {
    const serverMoved = !prev || prev.serverLat !== pos.lat || prev.serverLng !== pos.lng;
    if (prev && prev.animationTier === 1 && !serverMoved) {
      nextRenderLat = prev.renderLat;
      nextRenderLng = prev.renderLng;
      resolvedHeading = prev.heading;
    } else if (prev && !serverMoved) {
      nextRenderLat = prev.renderLat;
      nextRenderLng = prev.renderLng;
      resolvedHeading = prev.heading;
    } else {
      nextRenderLat = pos.lat;
      nextRenderLng = pos.lng;
    }
  } else if (isNew) {
    const resolved = resolveFleetPositionJs(draftSlot, now);
    nextRenderLat = resolved.lat;
    nextRenderLng = resolved.lng;
    resolvedHeading = resolved.heading;
  } else if (prev) {
    const serverMoved = prev.serverLat !== pos.lat || prev.serverLng !== pos.lng;
    if (serverMoved && animationTier === 1) {
      const origin = resolveClientSegOrigin(prev, now);
      nextRenderLat = origin.lat;
      nextRenderLng = origin.lng;
      resolvedHeading = prev.heading;
    } else if (!serverMoved) {
      nextRenderLat = prev.renderLat;
      nextRenderLng = prev.renderLng;
      resolvedHeading = prev.heading;
    } else {
      nextRenderLat = pos.lat;
      nextRenderLng = pos.lng;
    }
  } else {
    const resolved = resolveFleetPositionJs(draftSlot, now);
    nextRenderLat = resolved.lat;
    nextRenderLng = resolved.lng;
    resolvedHeading = resolved.heading;
  }

  const trailForSnap = animationTrail.length >= 2 ? animationTrail : pos.trail;
  if (animationTier === 1 && (!trailForSnap || trailForSnap.length < 2 || isTrailChordFlat(trailForSnap))) {
    maybeEnqueueFleetOsrmSnap({
      store,
      userId: id,
      isFriend: !!meta.isFriend,
      distKm,
      animationTier: tier,
      trail: trailForSnap,
      speedMps: serverSpeedMps,
      lat: pos.lat,
      lng: pos.lng,
      prevLat: prevServerLat,
      prevLng: prevServerLng,
    });
  }

  const avatarUri = normalizeMediaUri(meta.avatarUrl);
  const frameUri = normalizeMediaUri(meta.avatarFrameUrl ?? null);
  const hasAvatar = avatarUri && /^https?:\/\//i.test(avatarUri) ? 1 : 0;
  const username = meta.username?.trim() || 'Użytkownik';
  const initials = username.slice(0, 2).toUpperCase();

  let clientSegFromLat = pos.lat;
  let clientSegFromLng = pos.lng;
  let clientSegToLat = pos.lat;
  let clientSegToLng = pos.lng;
  let clientSegStartMs = now;
  let clientSegDurMs = 0;
  const clientRecvAt = now;

  if (animationTier === 1) {
    const serverMoved = !prev || prev.serverLat !== pos.lat || prev.serverLng !== pos.lng;
    if (serverMoved) {
      const origin = prev ? resolveClientSegOrigin(prev, now) : { lat: pos.lat, lng: pos.lng };
      clientSegFromLat = origin.lat;
      clientSegFromLng = origin.lng;
      clientSegToLat = pos.lat;
      clientSegToLng = pos.lng;
      clientSegStartMs = now;
      clientSegDurMs = computeClientSegmentDurationMs(
        origin.lat,
        origin.lng,
        pos.lat,
        pos.lng,
        serverSpeedMps,
      );
    } else if (prev?.animationTier === 1) {
      clientSegFromLat = prev.clientSegFromLat;
      clientSegFromLng = prev.clientSegFromLng;
      clientSegToLat = prev.clientSegToLat;
      clientSegToLng = prev.clientSegToLng;
      clientSegStartMs = prev.clientSegStartMs;
      clientSegDurMs = prev.clientSegDurMs;
    }
  }

  return {
    ...draftSlot,
    renderLat: nextRenderLat,
    renderLng: nextRenderLng,
    lastGoodLat: isValidFleetCoordJs(nextRenderLat, nextRenderLng) ? nextRenderLat : pos.lat,
    lastGoodLng: isValidFleetCoordJs(nextRenderLat, nextRenderLng) ? nextRenderLng : pos.lng,
    heading: resolvedHeading,
    correctionDurationMs,
    correctionElapsedMs: 0,
    correctionFromLat: nextRenderLat,
    correctionFromLng: nextRenderLng,
    correctionToLat: nextRenderLat,
    correctionToLng: nextRenderLng,
    clientSegFromLat,
    clientSegFromLng,
    clientSegToLat,
    clientSegToLng,
    clientSegStartMs,
    clientSegDurMs,
    clientRecvAt,
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
  const lastStatsAtSv = useSharedValue(0);
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
    shapeSv.value = next.length > 0
      ? buildGeoJsonLive(next, now, exitViewportSv.value)
      : EMPTY_FC;
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
      if (next.length > 0) {
        shapeSv.value = buildGeoJsonLive(next, now, exitViewportSv.value);
        lastPublishAtSv.value = now;
      }
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

    const nowMs = frame.timestamp ?? 0;
    const geo = buildGeoJsonLive(slots, nowMs, exitBounds);
    shapeSv.value = geo;
    lastPublishAtSv.value = nowMs;
    if (lastStatsAtSv.value <= 0 || nowMs - lastStatsAtSv.value >= 66) {
      lastStatsAtSv.value = nowMs;
      fleetStatsSv.value = {
        candidates: fleetStatsSv.value.candidates,
        visible: geo.features.length,
        culled: Math.max(0, fleetStatsSv.value.candidates - geo.features.length),
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
