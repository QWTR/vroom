import { useCallback, useEffect, useMemo, useState } from 'react';
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
  EMPTY_VIEWPORT,
  type ViewportBounds,
} from './liveFleetSpatialIndex';
import type { LiveMapStore } from './liveMapStore';

/** Wykładnicza stała czasowa LERP [1/s] — niezależna od FPS. */
const LERP_RATE = 10;
const MAX_DT_SEC = 0.05;
const ARRIVE_EPS_M = 0.4;
const COAST_MAX_MS = 2000;
const MIN_COAST_SPEED_MPS = 0.8;
const MAX_SPEED_MPS = 55;

type FleetSlot = {
  id: number;
  lat: number;
  lng: number;
  targetLat: number;
  targetLng: number;
  lastGoodLat: number;
  lastGoodLng: number;
  heading: number;
  speedMps: number;
  coastElapsedMs: number;
  lastStoreAtMs: number;
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

function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  'worklet';
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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

function resolveFleetDisplayCoord(s: FleetSlot): { lat: number; lng: number } | null {
  'worklet';
  if (isValidFleetCoord(s.lat, s.lng)) return { lat: s.lat, lng: s.lng };
  if (isValidFleetCoord(s.lastGoodLat, s.lastGoodLng)) {
    return { lat: s.lastGoodLat, lng: s.lastGoodLng };
  }
  if (isValidFleetCoord(s.targetLat, s.targetLng)) {
    return { lat: s.targetLat, lng: s.targetLng };
  }
  return null;
}

function buildGeoJson(slots: FleetSlot[], bounds: ViewportBounds): LiveFleetGeoJson {
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
        isPremium: s.isPremium,
        isFriend: s.isFriend,
        avatarUrl: s.avatarUrl,
        avatarFrameUrl: s.avatarFrameUrl,
        hasAvatar: s.hasAvatar,
        username: s.username,
        initials: s.initials,
        distanceLabel: s.distanceLabel,
        pinColor: s.pinColor,
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
    && (prev.targetLat !== pos.lat || prev.targetLng !== pos.lng);

  let speedMps = prev?.speedMps ?? 0;
  let heading = prev?.heading ?? 0;

  if (targetChanged && prev) {
    const dtSec = (now - prev.lastStoreAtMs) / 1000;
    if (dtSec > 0.05 && dtSec < 30) {
      const distM = calculateDistance(prev.targetLat, prev.targetLng, pos.lat, pos.lng) * 1000;
      speedMps = Math.min(MAX_SPEED_MPS, distM / dtSec);
      if (speedMps >= MIN_COAST_SPEED_MPS) {
        heading = bearingDegJs(prev.targetLat, prev.targetLng, pos.lat, pos.lng);
      }
    } else {
      speedMps = 0;
    }
  } else if (isNew) {
    speedMps = 0;
    heading = 0;
  }

  const avatarUri = normalizeMediaUri(meta.avatarUrl);
  const frameUri = normalizeMediaUri(meta.avatarFrameUrl ?? null);
  const hasAvatar = avatarUri && /^https?:\/\//i.test(avatarUri) ? 1 : 0;
  const username = meta.username?.trim() || 'Użytkownik';
  const initials = username.slice(0, 2).toUpperCase();
  const distKm = anchor
    ? calculateDistance(anchor.latitude, anchor.longitude, pos.lat, pos.lng)
    : 0;

  const initLat = isNew ? pos.lat : prev!.lat;
  const initLng = isNew ? pos.lng : prev!.lng;
  const prevGoodLat = prev?.lastGoodLat ?? initLat;
  const prevGoodLng = prev?.lastGoodLng ?? initLng;
  const lastGoodLat = isValidFleetCoordJs(initLat, initLng) ? initLat : prevGoodLat;
  const lastGoodLng = isValidFleetCoordJs(initLat, initLng) ? initLng : prevGoodLng;

  return {
    id,
    lat: initLat,
    lng: initLng,
    targetLat: pos.lat,
    targetLng: pos.lng,
    lastGoodLat: isValidFleetCoordJs(lastGoodLat, lastGoodLng) ? lastGoodLat : pos.lat,
    lastGoodLng: isValidFleetCoordJs(lastGoodLat, lastGoodLng) ? lastGoodLng : pos.lng,
    heading,
    speedMps,
    coastElapsedMs: targetChanged ? 0 : (prev?.coastElapsedMs ?? 0),
    lastStoreAtMs: targetChanged || isNew ? now : (prev?.lastStoreAtMs ?? now),
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

  const visibleKey = useMemo(
    () => visibleUserIds.slice().sort((a, b) => a - b).join(','),
    [visibleUserIds],
  );

  const anchorKey = anchor
    ? `${anchor.latitude.toFixed(4)},${anchor.longitude.toFixed(4)}`
    : 'none';

  const fleetSv = useSharedValue<FleetSlot[]>([]);
  const shapeSv = useSharedValue<LiveFleetGeoJson>(EMPTY_FC);
  const viewportSv = useSharedValue<ViewportBounds>(EMPTY_VIEWPORT);

  useEffect(() => {
    viewportSv.value = viewportBounds;
  }, [
    viewportBounds.north,
    viewportBounds.south,
    viewportBounds.east,
    viewportBounds.west,
    viewportBounds.valid,
    viewportSv,
  ]);

  useEffect(() => {
    if (!enabled) return;
    return store.subscribeUserIds(() => setMetaRevision((r) => r + 1));
  }, [store, enabled]);

  const rebuildFleetFromStore = useCallback(() => {
    if (!enabled || visibleUserIds.length === 0) {
      fleetSv.value = [];
      shapeSv.value = EMPTY_FC;
      setMetaPinRequests([]);
      return;
    }

    const now = Date.now();
    const prevById = new Map(fleetSv.value.map((s) => [s.id, s]));
    const next: FleetSlot[] = [];

    for (const id of visibleUserIds) {
      const slot = mergeSlotFromStore(id, store, prevById.get(id), anchor, now);
      if (slot) next.push(slot);
    }

    fleetSv.value = next;
    shapeSv.value = buildGeoJson(next, viewportSv.value);
    setMetaPinRequests(buildMetaPinRequests(store, visibleUserIds, anchor));
  }, [store, visibleUserIds, enabled, anchor, fleetSv, shapeSv, viewportSv]);

  useEffect(() => {
    rebuildFleetFromStore();
  }, [rebuildFleetFromStore, visibleKey, metaRevision, anchorKey]);

  useEffect(() => {
    if (!enabled || visibleUserIds.length === 0) return;

    const onPosition = (id: number) => {
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
      if (idx < 0) return;

      const prev = slots[idx];
      const now = Date.now();
      const merged = mergeSlotFromStore(id, store, prev, anchor, now);
      if (!merged) return;

      const next = slots.slice();
      next[idx] = merged;
      fleetSv.value = next;
    };

    const unsubs = visibleUserIds.map((id) =>
      store.subscribePosition(id, () => onPosition(id)),
    );
    return () => unsubs.forEach((u) => u());
  }, [store, visibleKey, enabled, visibleUserIds, fleetSv, anchor]);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    const slots = fleetSv.value;
    if (!slots.length) {
      shapeSv.value = EMPTY_FC;
      return;
    }

    const dtMs = frame.timeSincePreviousFrame ?? 16.67;
    const dtSec = Math.min(dtMs / 1000, MAX_DT_SEC);
    const alpha = 1 - Math.exp(-LERP_RATE * dtSec);
    const bounds = viewportSv.value;

    const nextSlots: FleetSlot[] = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      let lat = s.lat;
      let lng = s.lng;
      let coastElapsedMs = s.coastElapsedMs;
      let heading = s.heading;

      const distToTarget = haversineM(lat, lng, s.targetLat, s.targetLng);
      const coastFinished = coastElapsedMs >= COAST_MAX_MS + 80;
      const isCoasting = !coastFinished
        && s.speedMps >= MIN_COAST_SPEED_MPS
        && coastElapsedMs > 80
        && coastElapsedMs < COAST_MAX_MS + 80;

      if (isCoasting) {
        const moved = moveAlongBearing(lat, lng, heading, s.speedMps * dtSec);
        lat = moved.lat;
        lng = moved.lng;
        coastElapsedMs += dtMs;
      } else if (coastFinished) {
        lat = s.lat;
        lng = s.lng;
      } else if (distToTarget < ARRIVE_EPS_M) {
        lat = s.targetLat;
        lng = s.targetLng;
        coastElapsedMs += dtMs;
      } else {
        lat = lat + (s.targetLat - lat) * alpha;
        lng = lng + (s.targetLng - lng) * alpha;
        coastElapsedMs = 0;
        const moveM = haversineM(s.lat, s.lng, lat, lng);
        if (moveM > 0.3) {
          heading = bearingDeg(s.lat, s.lng, lat, lng);
        }
      }

      let lastGoodLat = s.lastGoodLat;
      let lastGoodLng = s.lastGoodLng;
      if (isValidFleetCoord(lat, lng)) {
        lastGoodLat = lat;
        lastGoodLng = lng;
      } else if (isValidFleetCoord(s.lastGoodLat, s.lastGoodLng)) {
        lat = s.lastGoodLat;
        lng = s.lastGoodLng;
      } else if (isValidFleetCoord(s.targetLat, s.targetLng)) {
        lat = s.targetLat;
        lng = s.targetLng;
        lastGoodLat = s.targetLat;
        lastGoodLng = s.targetLng;
      }

      nextSlots.push({
        id: s.id,
        lat,
        lng,
        targetLat: s.targetLat,
        targetLng: s.targetLng,
        lastGoodLat,
        lastGoodLng,
        heading,
        speedMps: s.speedMps,
        coastElapsedMs,
        lastStoreAtMs: s.lastStoreAtMs,
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
    shapeSv.value = buildGeoJson(nextSlots, bounds);
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
  };
}
