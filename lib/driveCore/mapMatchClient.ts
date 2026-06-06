import { MAPBOX_TOKEN } from '../../constants/mapConfig';
import { fetchMatchingViaProxy } from '../../scripts/mapboxProxyClient';
import { canRequestMapMatch, recordMapMatchNetwork } from '../mapboxNetworkGate';
import { readMatchingClientCache, buildMatchingCacheKey } from '../mapMatch/matchingRequest';
import { roadGeometryStore } from '../roadGeometry/RoadGeometryStore';
import { MAP_MATCH_TRAFFIC_LIGHT_KMH, MATCH_RADIUS_M, GPS_BATCH_MAX_POINTS } from './config';
import type { BufferedGpsPoint, RoadPoint } from './types';

const MAP_MATCH_URL = 'https://api.mapbox.com/matching/v5/mapbox/driving';
const FORCE_OFFSET_DEG = 0.00005;

type MapMatchResponse = {
  code?: string;
  matchings?: Array<{
    geometry?: { coordinates?: [number, number][] };
  }>;
};

export type FlushMapMatchOptions = {
  /** Background historical sync — skips traffic-light speed gate. */
  background?: boolean;
  speedKmh?: number;
};

function ensureMinTwoPoints(points: BufferedGpsPoint[]): BufferedGpsPoint[] {
  if (points.length >= 2) return points.slice(-GPS_BATCH_MAX_POINTS);
  if (points.length === 1) {
    const p = points[0];
    return [
      p,
      {
        lat: p.lat + FORCE_OFFSET_DEG,
        lng: p.lng + FORCE_OFFSET_DEG,
        timestamp: p.timestamp + 1,
      },
    ];
  }
  return points;
}

async function tryLocalGeometry(lat: number, lng: number): Promise<RoadPoint[] | null> {
  const hit = await roadGeometryStore.findNearest(lat, lng, 90);
  if (!hit || hit.points.length < 2) return null;
  return hit.points;
}

export async function flushMapMatchBatch(
  points: BufferedGpsPoint[],
  opts?: FlushMapMatchOptions,
): Promise<RoadPoint[] | null> {
  const batch = ensureMinTwoPoints(points);
  if (batch.length < 2) return null;

  const last = batch[batch.length - 1];
  const speedKmh = Math.max(0, opts?.speedKmh ?? 0);
  const background = !!opts?.background;

  if (!background && speedKmh < MAP_MATCH_TRAFFIC_LIGHT_KMH) {
    return null;
  }

  const gate = canRequestMapMatch({
    lat: last.lat,
    lng: last.lng,
    speedKmh: background ? Math.max(speedKmh, MAP_MATCH_TRAFFIC_LIGHT_KMH) : speedKmh,
    manual: false,
  });
  if (!gate.ok) return null;

  const proxyPoints = batch.map((p) => ({ lat: p.lat, lng: p.lng }));
  const cacheKey = buildMatchingCacheKey(proxyPoints, 'driving', batch.map(() => MATCH_RADIUS_M));
  const cached = readMatchingClientCache<MapMatchResponse>(cacheKey, last.lat, last.lng);
  if (cached?.matchings?.[0]?.geometry?.coordinates?.length) {
    const line = cached.matchings[0].geometry!.coordinates!;
    return line.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  }

  if (!background) {
    const local = await tryLocalGeometry(last.lat, last.lng);
    if (local) return local;
  }

  const radiuses = batch.map(() => MATCH_RADIUS_M);
  const coordsPath = batch.map((p) => `${p.lng},${p.lat}`).join(';');
  const radiusesParam = radiuses.map((r) => String(r)).join(';');
  const fallbackUrl =
    `${MAP_MATCH_URL}/${coordsPath}` +
    `?geometries=geojson&tidy=true&radiuses=${radiusesParam}` +
    `&access_token=${MAPBOX_TOKEN}`;

  recordMapMatchNetwork(
    last.lat,
    last.lng,
    background ? 'drive_core_batch_bg' : 'drive_core_batch',
  );
  const data = await fetchMatchingViaProxy<MapMatchResponse>(
    {
      points: proxyPoints,
      profile: 'driving',
      radiuses,
    },
    fallbackUrl,
    { allowFallback: false, proxyTimeoutMs: background ? 6500 : 4500 },
  );

  const line = data?.matchings?.[0]?.geometry?.coordinates;
  if (!Array.isArray(line) || line.length < 2) return null;

  const road = line.map(([lng, lat]) => ({
    latitude: lat,
    longitude: lng,
  }));
  if (road.length >= 2) {
    await roadGeometryStore.insert(road);
  }
  return road;
}
