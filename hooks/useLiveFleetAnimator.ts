import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { normalizeMediaUri } from '../lib/mediaUri';
import { calculateDistance } from '../scripts/distance';
import type { LiveMapStore } from './liveMapStore';

const GEOJSON_PUSH_MS = 33;
/** Wykładnicza stała czasowa LERP [1/s] — niezależna od FPS. */
const LERP_RATE = 10;
const MAX_DT_SEC = 0.05;
const ARRIVE_EPS_M = 0.4;
/** Dead reckoning: maks. czas „sunania” bez nowego pakietu z serwera. */
const COAST_MAX_MS = 2000;
const MIN_COAST_SPEED_MPS = 0.8;
const MAX_SPEED_MPS = 55;

type FleetSlot = {
  id: number;
  lat: number;
  lng: number;
  targetLat: number;
  targetLng: number;
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

function buildGeoJson(slots: FleetSlot[]): LiveFleetGeoJson {
  'worklet';
  const features: LiveFleetFeature[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    features.push({
      type: 'Feature',
      id: s.id,
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
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

export function useLiveFleetAnimator(
  store: LiveMapStore,
  visibleUserIds: number[],
  enabled: boolean,
  anchor: { latitude: number; longitude: number } | null,
) {
  const [revision, setRevision] = useState(0);
  const [geoJson, setGeoJson] = useState<LiveFleetGeoJson>(EMPTY_FC);

  const visibleKey = useMemo(
    () => visibleUserIds.slice().sort((a, b) => a - b).join(','),
    [visibleUserIds],
  );

  const anchorKey = anchor
    ? `${anchor.latitude.toFixed(4)},${anchor.longitude.toFixed(4)}`
    : 'none';

  useEffect(() => {
    if (!enabled) return;
    return store.subscribeUserIds(() => setRevision((r) => r + 1));
  }, [store, enabled]);

  useEffect(() => {
    if (!enabled || visibleUserIds.length === 0) return;
    const unsubs = visibleUserIds.map((id) =>
      store.subscribePosition(id, () => setRevision((r) => r + 1)),
    );
    return () => unsubs.forEach((u) => u());
  }, [store, visibleKey, enabled, visibleUserIds]);

  const fleetSv = useSharedValue<FleetSlot[]>([]);
  const lastPushMsSv = useSharedValue(0);

  const pushGeoJson = useCallback((fc: LiveFleetGeoJson) => {
    setGeoJson(fc);
  }, []);

  useEffect(() => {
    if (!enabled || visibleUserIds.length === 0) {
      fleetSv.value = [];
      setGeoJson(EMPTY_FC);
      return;
    }

    const now = Date.now();
    const prevById = new Map(fleetSv.value.map((s) => [s.id, s]));
    const next: FleetSlot[] = [];

    for (const id of visibleUserIds) {
      const pos = store.getPosition(id);
      const meta = store.getMeta(id);
      if (!pos || !meta) continue;

      const prev = prevById.get(id);
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

      next.push({
        id,
        lat: isNew ? pos.lat : prev.lat,
        lng: isNew ? pos.lng : prev.lng,
        targetLat: pos.lat,
        targetLng: pos.lng,
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
      });
    }

    fleetSv.value = next;
  }, [store, visibleKey, revision, enabled, visibleUserIds, fleetSv, anchorKey, anchor]);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    const slots = fleetSv.value;
    if (!slots.length) return;

    const dtMs = frame.timeSincePreviousFrame ?? 16.67;
    const dtSec = Math.min(dtMs / 1000, MAX_DT_SEC);
    const alpha = 1 - Math.exp(-LERP_RATE * dtSec);

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

      nextSlots.push({
        id: s.id,
        lat,
        lng,
        targetLat: s.targetLat,
        targetLng: s.targetLng,
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

    const now = frame.timestamp;
    if (now - lastPushMsSv.value < GEOJSON_PUSH_MS) return;
    lastPushMsSv.value = now;
    runOnJS(pushGeoJson)(buildGeoJson(nextSlots));
  }, false);

  useEffect(() => {
    frameCallback.setActive(enabled && visibleUserIds.length > 0);
    return () => frameCallback.setActive(false);
  }, [enabled, visibleUserIds.length, frameCallback]);

  return geoJson;
}
