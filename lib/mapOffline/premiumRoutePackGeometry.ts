export type OfflineRoutePoint = { latitude: number; longitude: number };
const BUFFER_KM = 3;
const MIN_ZOOM = 8;
const MAX_ZOOM = 16;
const POINTS_PER_REGION = 36;

function validPoints(points: OfflineRoutePoint[]): OfflineRoutePoint[] {
  return (Array.isArray(points) ? points : []).filter((point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180);
}

export function corridorRegions(pointsInput: OfflineRoutePoint[]): [[number, number], [number, number]][] {
  const points = validPoints(pointsInput);
  if (points.length < 2) return [];
  const regions: [[number, number], [number, number]][] = [];
  for (let start = 0; start < points.length - 1; start += POINTS_PER_REGION - 1) {
    const slice = points.slice(start, Math.min(points.length, start + POINTS_PER_REGION));
    if (slice.length < 2) break;
    const avgLat = slice.reduce((sum, point) => sum + point.latitude, 0) / slice.length;
    const latPad = BUFFER_KM / 111;
    const lngPad = BUFFER_KM / Math.max(20, 111 * Math.cos((avgLat * Math.PI) / 180));
    regions.push([[
      Math.max(...slice.map((point) => point.longitude)) + lngPad,
      Math.max(...slice.map((point) => point.latitude)) + latPad,
    ], [
      Math.min(...slice.map((point) => point.longitude)) - lngPad,
      Math.min(...slice.map((point) => point.latitude)) - latPad,
    ]]);
  }
  return regions;
}

const longitudeToTileX = (longitude: number, zoom: number) => ((longitude + 180) / 360) * (2 ** zoom);
const latitudeToTileY = (latitude: number, zoom: number) => { const latRad = Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI / 180; return (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * (2 ** zoom); };

export function estimateCorridorDownload(points: OfflineRoutePoint[]): { tiles: number; bytes: number; regions: number } {
  const bounds = corridorRegions(points); let tiles = 0;
  for (const [[neLng, neLat], [swLng, swLat]] of bounds) for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 1) {
    const width = Math.max(1, Math.ceil(Math.abs(longitudeToTileX(neLng, zoom) - longitudeToTileX(swLng, zoom))));
    const height = Math.max(1, Math.ceil(Math.abs(latitudeToTileY(neLat, zoom) - latitudeToTileY(swLat, zoom))));
    tiles += width * height;
  }
  return { tiles, bytes: tiles * 36_000, regions: bounds.length };
}

export const PREMIUM_OFFLINE_GEOMETRY = { bufferKm: BUFFER_KM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, tileLimit: 7500 } as const;
