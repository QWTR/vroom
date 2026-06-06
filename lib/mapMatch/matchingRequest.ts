/**
 * Shared Map Matching request normalization + client-side response cache.
 * Prevents duplicate Mapbox calls for nearby coordinates / identical batches.
 */

import { haversineKm } from '../../scripts/navigationUtils';

export type MatchingPoint = { lat: number; lng: number };

/** ~11 m at equator — stable cache buckets without merging distant roads. */
const CACHE_BUCKET_DECIMALS = 4;
const MATCHING_CLIENT_CACHE_TTL_MS = 10 * 60_000;
const MATCHING_CLIENT_CACHE_MAX = 96;
const MATCHING_ANCHOR_HIT_RADIUS_M = 55;

type CacheEntry = {
  at: number;
  anchor: MatchingPoint;
  data: unknown;
};

const clientCache = new Map<string, CacheEntry>();
let inflightByKey = new Map<string, Promise<unknown>>();

function bucketCoord(value: number, decimals = CACHE_BUCKET_DECIMALS): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function normalizeMatchingPoints(input: unknown): MatchingPoint[] | null {
  if (!input || typeof input !== 'object') return null;

  const body = input as Record<string, unknown>;
  const rawPoints = Array.isArray(body.points)
    ? body.points
    : Array.isArray(body.coordinates)
      ? body.coordinates
      : null;
  if (!rawPoints || rawPoints.length < 2) return null;

  const normalized: MatchingPoint[] = [];
  for (const p of rawPoints) {
    let lat: number;
    let lng: number;
    if (Array.isArray(p) && p.length >= 2) {
      lng = Number(p[0]);
      lat = Number(p[1]);
    } else if (p && typeof p === 'object') {
      lat = Number((p as { lat?: number }).lat);
      lng = Number((p as { lng?: number }).lng);
    } else {
      return null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    normalized.push({ lat, lng });
  }
  return normalized;
}

export function buildMatchingProxyBody(input: Record<string, unknown>): {
  points: MatchingPoint[];
  profile: string;
  radiuses: number[] | null;
} | null {
  const points = normalizeMatchingPoints(input);
  if (!points) return null;

  const profile = typeof input.profile === 'string' ? input.profile : 'driving';
  const radiusesRaw = input.radiuses;
  let radiuses: number[] | null = null;
  if (Array.isArray(radiusesRaw) && radiusesRaw.length === points.length) {
    radiuses = radiusesRaw.map((r) => {
      const n = Number(r);
      return Number.isFinite(n) ? Math.min(50, Math.max(0, n)) : 50;
    });
  }

  return { points, profile, radiuses };
}

function bucketPoints(points: MatchingPoint[]): MatchingPoint[] {
  return points.map((p) => ({
    lat: bucketCoord(p.lat),
    lng: bucketCoord(p.lng),
  }));
}

export function buildMatchingCacheKey(
  points: MatchingPoint[],
  profile: string,
  radiuses: number[] | null,
): string {
  const bucketed = bucketPoints(points);
  const radiiKey = radiuses ? radiuses.join(',') : 'default';
  return `${profile}|${radiiKey}|${bucketed.map((p) => `${p.lat},${p.lng}`).join(';')}`;
}

export function anchorFromMatchingPoints(points: MatchingPoint[]): MatchingPoint {
  return points[points.length - 1];
}

function pruneClientCache(now: number): void {
  if (clientCache.size <= MATCHING_CLIENT_CACHE_MAX) return;
  for (const [key, entry] of clientCache) {
    if (now - entry.at > MATCHING_CLIENT_CACHE_TTL_MS) {
      clientCache.delete(key);
    }
    if (clientCache.size <= MATCHING_CLIENT_CACHE_MAX) break;
  }
}

export function readMatchingClientCache<T>(
  cacheKey: string,
  nearLat: number,
  nearLng: number,
): T | null {
  const entry = clientCache.get(cacheKey);
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.at > MATCHING_CLIENT_CACHE_TTL_MS) {
    clientCache.delete(cacheKey);
    return null;
  }
  const movedM = haversineKm(entry.anchor.lat, entry.anchor.lng, nearLat, nearLng) * 1000;
  if (movedM > MATCHING_ANCHOR_HIT_RADIUS_M) return null;
  return entry.data as T;
}

export function writeMatchingClientCache(
  cacheKey: string,
  anchor: MatchingPoint,
  data: unknown,
): void {
  const now = Date.now();
  clientCache.set(cacheKey, { at: now, anchor, data });
  pruneClientCache(now);
}

export async function withMatchingClientCache<T>(
  cacheKey: string,
  anchor: MatchingPoint,
  factory: () => Promise<T | null>,
): Promise<T | null> {
  const cached = readMatchingClientCache<T>(cacheKey, anchor.lat, anchor.lng);
  if (cached != null) return cached;

  const inflight = inflightByKey.get(cacheKey);
  if (inflight) {
    return (await inflight) as T | null;
  }

  const task = (async () => {
    const data = await factory();
    if (data != null) {
      writeMatchingClientCache(cacheKey, anchor, data);
    }
    return data;
  })();

  inflightByKey.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflightByKey.delete(cacheKey);
  }
}

export function resetMatchingClientCacheForTests(): void {
  clientCache.clear();
  inflightByKey = new Map();
}
