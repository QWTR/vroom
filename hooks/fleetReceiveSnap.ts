import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/mapConfig';
import type { FleetLatLng, FleetTrailPoint } from './fleetTrailInterpolation';
import type { LiveMapStore } from './liveMapStore';

const MAX_IN_FLIGHT = 4;
const MIN_SAME_USER_MS = 3_000;
const GLOBAL_MAX_PER_WINDOW = 6;
const GLOBAL_WINDOW_MS = 10_000;
const DEDUP_BUCKET_M = 0.0001;
const DEDUP_TTL_MS = 20_000;

type SnapRequest = {
  userId: number;
  points: { lat: number; lng: number; t?: number }[];
  priority: number;
  enqueuedAt: number;
};

type CacheEntry = { at: number; bucketKey: string };

let inFlight = 0;
const queue: SnapRequest[] = [];
const lastSnapAtByUser = new Map<number, number>();
const dedupCache = new Map<number, CacheEntry>();
const globalTimestamps: number[] = [];

function bucketKey(lat: number, lng: number): string {
  return `${Math.round(lat / DEDUP_BUCKET_M)}:${Math.round(lng / DEDUP_BUCKET_M)}`;
}

function pruneGlobal(now: number) {
  while (globalTimestamps.length && now - globalTimestamps[0] > GLOBAL_WINDOW_MS) {
    globalTimestamps.shift();
  }
}

function canIssueGlobal(now: number): boolean {
  pruneGlobal(now);
  return globalTimestamps.length < GLOBAL_MAX_PER_WINDOW;
}

async function getAuthToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem('token');
  } catch {
    return null;
  }
}

function computePriority(isFriend: boolean, distKm: number): number {
  if (isFriend) return 0;
  if (distKm < 3) return 1;
  if (distKm < 10) return 2;
  return 3;
}

async function runSnap(req: SnapRequest, store: LiveMapStore): Promise<void> {
  const token = await getAuthToken();
  if (!token) return;

  try {
    const res = await fetch(`${API_URL}/api/live/fleet-match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: req.userId,
        points: req.points,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const polyline = Array.isArray(data?.polyline)
      ? data.polyline
        .map((p: FleetLatLng) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
        .filter((p: FleetLatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      : [];
    if (polyline.length < 1) return;
    store.setOsrmPolyline(req.userId, polyline);
    const snapped = data?.snapped;
    if (snapped && Number.isFinite(Number(snapped.lat)) && Number.isFinite(Number(snapped.lng))) {
      const pos = store.getPosition(req.userId);
      if (pos) {
        store.setPosition(req.userId, Number(snapped.lat), Number(snapped.lng), true, {
          heading: pos.heading,
          speedMps: pos.speedMps,
          trail: pos.trail,
          serverAt: pos.lastServerAt ?? null,
        });
      }
    }
  } catch {
    /* ignore */
  }
}

function pumpQueue(store: LiveMapStore) {
  if (inFlight >= MAX_IN_FLIGHT || queue.length === 0) return;
  const now = Date.now();
  if (!canIssueGlobal(now)) return;

  queue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
  const idx = queue.findIndex((req) => {
    const last = lastSnapAtByUser.get(req.userId) ?? 0;
    return now - last >= MIN_SAME_USER_MS;
  });
  if (idx < 0) return;

  const [req] = queue.splice(idx, 1);
  inFlight += 1;
  globalTimestamps.push(now);
  lastSnapAtByUser.set(req.userId, now);

  void runSnap(req, store).finally(() => {
    inFlight -= 1;
    pumpQueue(store);
  });
}

export function maybeEnqueueFleetOsrmSnap(opts: {
  store: LiveMapStore;
  userId: number;
  isFriend: boolean;
  distKm: number;
  animationTier: 'full' | 'static';
  trail?: FleetTrailPoint[];
  speedMps: number | null;
  lat: number;
  lng: number;
  prevLat?: number | null;
  prevLng?: number | null;
}): void {
  const {
    store,
    userId,
    isFriend,
    distKm,
    animationTier,
    trail,
    speedMps,
    lat,
    lng,
    prevLat,
    prevLng,
  } = opts;

  if (animationTier !== 'full') return;
  if (trail && trail.length >= 2) return;

  const speedKmh = speedMps != null ? speedMps * 3.6 : 0;
  const movedM = prevLat != null && prevLng != null
    ? Math.hypot((lat - prevLat) * 111_320, (lng - prevLng) * 111_320 * Math.cos((lat * Math.PI) / 180))
    : Infinity;
  if (speedKmh < 5 && movedM < 35) return;

  const now = Date.now();
  const key = bucketKey(lat, lng);
  const cached = dedupCache.get(userId);
  if (cached && cached.bucketKey === key && now - cached.at < DEDUP_TTL_MS) return;
  dedupCache.set(userId, { at: now, bucketKey: key });

  const points: { lat: number; lng: number; t?: number }[] = [];
  if (prevLat != null && prevLng != null && Number.isFinite(prevLat) && Number.isFinite(prevLng)) {
    points.push({ lat: prevLat, lng: prevLng, t: now - 5000 });
  }
  points.push({ lat, lng, t: now });
  if (points.length < 2) return;

  queue.push({
    userId,
    points,
    priority: computePriority(isFriend, distKm),
    enqueuedAt: now,
  });
  pumpQueue(store);
}

export function resetFleetReceiveSnapState(): void {
  queue.length = 0;
  inFlight = 0;
  lastSnapAtByUser.clear();
  dedupCache.clear();
  globalTimestamps.length = 0;
}
