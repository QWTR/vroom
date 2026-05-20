import { fetchMatchingViaProxy } from './mapboxProxyClient';
import { MAPBOX_TOKEN } from '../constants/mapConfig';
import { haversineKm, snapToRoute } from './navigationUtils';
import { roadGeometryStore, type RoadPoint } from '../lib/roadGeometry/RoadGeometryStore';

const MAX_MATCH_INPUT = 85;
const CACHE_SNAP_MAX_M = 110;
const MIN_CACHE_COVERAGE = 0.52;
const BBOX_PAD_DEG = 0.002;

type MapMatchResponse = {
  code: string;
  matchings: Array<{ geometry: { coordinates: [number, number][] } }>;
};

function downsampleForMatch(points: [number, number][]): [number, number][] {
  if (points.length <= MAX_MATCH_INPUT) return points;
  const step = Math.ceil(points.length / MAX_MATCH_INPUT);
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i += step) {
    out.push(points[i]);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) {
    out.push(last);
  }
  return out;
}

function bboxFromRoute(points: [number, number][]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return {
    minLat: minLat - BBOX_PAD_DEG,
    maxLat: maxLat + BBOX_PAD_DEG,
    minLng: minLng - BBOX_PAD_DEG,
    maxLng: maxLng + BBOX_PAD_DEG,
  };
}

function dedupePolylines(polylines: RoadPoint[][]): RoadPoint[][] {
  const seen = new Set<string>();
  const out: RoadPoint[][] = [];
  for (const pts of polylines) {
    if (pts.length < 2) continue;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const key = `${a.latitude.toFixed(4)},${a.longitude.toFixed(4)}|${b.latitude.toFixed(4)},${b.longitude.toFixed(4)}|${pts.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pts);
  }
  return out;
}

function snapPointToCachedRoads(
  lat: number,
  lng: number,
  polylines: RoadPoint[][],
): { coord: [number, number]; distM: number } | null {
  let bestDist = Infinity;
  let best: [number, number] | null = null;

  for (const pts of polylines) {
    const snapped = snapToRoute(lat, lng, pts, CACHE_SNAP_MAX_M);
    const distM = haversineKm(lat, lng, snapped.latitude, snapped.longitude) * 1000;
    if (distM <= CACHE_SNAP_MAX_M && distM < bestDist) {
      bestDist = distM;
      best = [snapped.longitude, snapped.latitude];
    }
  }

  if (!best) return null;
  return { coord: best, distM: bestDist };
}

/** Snap historii do lokalnego cache geometrii drogi (bez API). */
async function snapHistoryRouteFromCache(
  points: [number, number][],
): Promise<[number, number][] | null> {
  if (points.length < 2) return null;

  const box = bboxFromRoute(points);
  if (!Number.isFinite(box.minLat)) return null;

  const cached = dedupePolylines(await roadGeometryStore.findInBbox(
    box.minLat,
    box.maxLat,
    box.minLng,
    box.maxLng,
    32,
  ));
  if (cached.length === 0) return null;

  const snapped: [number, number][] = [];
  let hitCount = 0;

  for (const [lng, lat] of points) {
    const hit = snapPointToCachedRoads(lat, lng, cached);
    if (hit) {
      snapped.push(hit.coord);
      hitCount += 1;
    } else {
      snapped.push([lng, lat]);
    }
  }

  const coverage = hitCount / points.length;
  if (coverage < MIN_CACHE_COVERAGE) {
    if (__DEV__) {
      console.log('[HistorySnap] cache miss — coverage', (coverage * 100).toFixed(0) + '%', 'segments', cached.length);
    }
    return null;
  }

  if (__DEV__) {
    console.log('[HistorySnap] cache hit — coverage', (coverage * 100).toFixed(0) + '%', 'segments', cached.length);
  }
  return snapped;
}

async function snapHistoryRouteViaMapbox(
  points: [number, number][],
): Promise<[number, number][]> {
  const sampled = downsampleForMatch(points);
  const coordPath = sampled.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const radii = sampled.map(() => '25').join(';');
  const fallbackUrl =
    `https://api.mapbox.com/matching/v5/mapbox/driving/${coordPath}`
    + `?geometries=geojson&steps=false&overview=full&radiuses=${radii}`
    + `&access_token=${MAPBOX_TOKEN}`;

  const data = await fetchMatchingViaProxy<MapMatchResponse>(
    {
      coordinates: sampled.map(([lng, lat]) => [lng, lat]),
      radiuses: sampled.map(() => 25),
      profile: 'driving',
    },
    fallbackUrl,
    { forceFallback: true, cooldownMs: 0, proxyTimeoutMs: 8000, fallbackTimeoutMs: 8000 },
  );
  if (!data || data.code !== 'Ok' || !data.matchings?.length) return points;
  const matched = data.matchings[0]?.geometry?.coordinates;
  if (!matched || matched.length < 2) return points;
  return matched.map(([lng, lat]) => [lng, lat] as [number, number]);
}

/**
 * Dopasuj trasę historii do drogi: najpierw lokalny cache Mapbox (SQLite),
 * dopiero potem jednorazowy Mapbox Matching (wynik trafia do cache).
 */
export async function snapHistoryRouteToRoad(
  points: [number, number][],
): Promise<[number, number][]> {
  if (points.length < 2) return points;

  try {
    const fromCache = await snapHistoryRouteFromCache(points);
    if (fromCache && fromCache.length >= 2) {
      return fromCache;
    }

    const matched = await snapHistoryRouteViaMapbox(points);
    if (matched.length >= 2) {
      await roadGeometryStore.insert(
        matched.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
      );
      if (__DEV__) console.log('[HistorySnap] mapbox match cached', matched.length, 'pts');
    }
    return matched;
  } catch {
    return points;
  }
}
