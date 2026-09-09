import type { Feature, LineString } from 'geojson';
import type { LineLayerStyle } from '@rnmapbox/maps';

type Expression = Exclude<LineLayerStyle['lineGradient'], string | undefined>;

export type TripRoutePoint = { longitude: number; latitude: number; speedKmh?: number | null };
export type SpeedPalette = readonly (readonly [number, string])[];
export const SUMMARY_SPEED_PALETTE: SpeedPalette = [[0, '#22c55e'], [60, '#FFD447'], [120, '#f97316'], [180, '#ef4444']];
export const REPLAY_SPEED_PALETTE: SpeedPalette = [[0, '#4de926'], [70, '#FFD447'], [140, '#e33835']];

// Mapbox line-progress measures distance in Web Mercator, not GPS point count.
function project(point: TripRoutePoint) {
  const latitude = Math.max(-85.051129, Math.min(85.051129, point.latitude)) * Math.PI / 180;
  return [point.longitude * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + latitude / 2))];
}

export function buildTripRouteLine(points: readonly TripRoutePoint[], palette: SpeedPalette) {
  const valid = points.filter((p) => Number.isFinite(p.longitude) && Number.isFinite(p.latitude)
    && Math.abs(p.longitude) <= 180 && Math.abs(p.latitude) <= 90);
  if (valid.length < 2) return null;
  const shape: Feature<LineString> = {
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: valid.map((p) => [p.longitude, p.latitude]) },
  };
  const distances = [0];
  let previous = project(valid[0]);
  for (let i = 1; i < valid.length; i += 1) {
    const current = project(valid[i]);
    distances.push(distances[i - 1] + Math.hypot(current[0] - previous[0], current[1] - previous[1]));
    previous = current;
  }
  const total = distances[distances.length - 1];
  const stops: (number | string | Expression)[] = [];
  // Bound paint-expression size without removing any of the route geometry.
  const stride = Math.max(1, Math.ceil((valid.length - 1) / 255));
  let lastProgress = -1;
  for (let i = 0; i < valid.length; i += 1) {
    if (i % stride !== 0 && i !== valid.length - 1) continue;
    const progress = total > 0 ? distances[i] / total : 0;
    if (progress <= lastProgress) continue;
    const speed = valid[i].speedKmh;
    const color: string | Expression = speed != null && Number.isFinite(speed)
      ? ['interpolate', ['linear'], speed, ...palette.flatMap(([value, hex]) => [value, hex])]
      : '#FFD447';
    stops.push(progress, color);
    lastProgress = progress;
  }
  const gradient: string | Expression = stops.length >= 4
    ? ['interpolate', ['linear'], ['line-progress'], ...stops]
    : '#FFD447';
  return { shape, gradient };
}
