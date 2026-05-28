import { MAPBOX_TOKEN } from '../../constants/mapConfig';
import { fetchMatchingViaProxy } from '../../scripts/mapboxProxyClient';
import { MATCH_RADIUS_M, GPS_BATCH_MAX_POINTS } from './config';
import type { BufferedGpsPoint, RoadPoint } from './types';

const MAP_MATCH_URL = 'https://api.mapbox.com/matching/v5/mapbox/driving';
const FORCE_OFFSET_DEG = 0.00005;

type MapMatchResponse = {
  code?: string;
  matchings?: Array<{
    geometry?: { coordinates?: [number, number][] };
  }>;
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

export async function flushMapMatchBatch(
  points: BufferedGpsPoint[],
): Promise<RoadPoint[] | null> {
  const batch = ensureMinTwoPoints(points);
  if (batch.length < 2) return null;

  const coords = batch.map((p) => [p.lng, p.lat] as [number, number]);
  const radiuses = batch.map(() => String(MATCH_RADIUS_M)).join(';');
  const coordsPath = coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const fallbackUrl =
    `${MAP_MATCH_URL}/${coordsPath}` +
    `?geometries=geojson&tidy=true&radiuses=${radiuses}` +
    `&access_token=${MAPBOX_TOKEN}`;

  const data = await fetchMatchingViaProxy<MapMatchResponse>(
    {
      coordinates: coords,
      radiuses: batch.map(() => MATCH_RADIUS_M),
      tidy: true,
      geometries: 'geojson',
    },
    fallbackUrl,
    { allowFallback: false, proxyTimeoutMs: 4500 },
  );

  const line = data?.matchings?.[0]?.geometry?.coordinates;
  if (!Array.isArray(line) || line.length < 2) return null;

  return line.map(([lng, lat]) => ({
    latitude: lat,
    longitude: lng,
  }));
}
