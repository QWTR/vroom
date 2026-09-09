import { parseOsmMaxSpeed } from '../navigation/osmMaxSpeed';

export type SpeedLimitWay = {
  type?: string;
  id: number;
  tags?: Record<string, string | undefined>;
  geometry?: { lat: number; lon: number }[];
};
export type SpeedLimitPosition = { lat: number; lng: number; heading?: number | null };

export function speedLimitDistance(a: SpeedLimitPosition, b: SpeedLimitPosition): number {
  const y = (a.lat - b.lat) * 111195;
  const x = (a.lng - b.lng) * 111195 * Math.cos((a.lat + b.lat) * Math.PI / 360);
  return Math.hypot(x, y);
}

export function headingDifference(a: number, b: number): number {
  return Math.abs(((a - b) % 360 + 540) % 360 - 180);
}

/** Choose the road first, never the nearest road that happens to have a limit. */
export function matchSpeedLimitRoad(position: SpeedLimitPosition, ways: SpeedLimitWay[]) {
  const heading = position.heading != null && Number.isFinite(position.heading) && position.heading >= 0
    ? position.heading % 360 : null;
  const candidates = ways.flatMap(way => {
    const tags = way.tags ?? {};
    if (!/^(motorway|trunk|primary|secondary|tertiary)(_link)?$|^(residential|living_street|service|unclassified|road)$/.test(tags.highway ?? '')) return [];
    if (tags.area === 'yes' || tags.motor_vehicle === 'no' || tags.vehicle === 'no' || tags.access === 'no') return [];
    const geometry = way.geometry ?? [];
    let nearest: { distance: number; bearing: number } | null = null;
    for (let i = 1; i < geometry.length; i++) {
      const a = geometry[i - 1], b = geometry[i];
      if (![a.lat, a.lon, b.lat, b.lon].every(Number.isFinite)) continue;
      const scale = Math.cos(position.lat * Math.PI / 180);
      const dx = (b.lon - a.lon) * scale, dy = b.lat - a.lat;
      const length = dx * dx + dy * dy;
      if (length < 1e-16) continue;
      const t = Math.max(0, Math.min(1, ((position.lng - a.lon) * scale * dx + (position.lat - a.lat) * dy) / length));
      const distance = speedLimitDistance(position, { lat: a.lat + t * dy, lng: a.lon + t * (b.lon - a.lon) });
      if (!nearest || distance < nearest.distance) nearest = { distance, bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
    }
    if (!nearest || nearest.distance > 35) return [];
    const forwardAngle = heading == null ? 0 : headingDifference(heading, nearest.bearing);
    const oneWay = tags.oneway === '-1' ? -1 : /^(yes|1|true)$/.test(tags.oneway ?? '') || (tags.junction === 'roundabout' && tags.oneway !== 'no') ? 1 : 0;
    const angle = heading == null ? 0 : oneWay === 1 ? forwardAngle : oneWay === -1 ? 180 - forwardAngle : Math.min(forwardAngle, 180 - forwardAngle);
    if (heading != null && angle > 65) return [];
    const direction = heading == null ? (oneWay === 1 ? 'forward' : oneWay === -1 ? 'backward' : null) : forwardAngle <= 90 ? 'forward' : 'backward';
    return [{ way, direction, distance: nearest.distance, score: nearest.distance + angle * 0.3 }];
  }).sort((a, b) => a.score - b.score);
  const best = candidates[0];
  if (!best) return null;
  const tags = best.way.tags ?? {};
  const directional = best.direction ? tags[`maxspeed:${best.direction}`] : undefined;
  // An explicit dynamic/unlimited tag must not fall through to a static limit.
  let raw = directional ?? tags.maxspeed;
  if (!best.direction && (tags['maxspeed:forward'] != null || tags['maxspeed:backward'] != null)) {
    const forward = tags['maxspeed:forward'] ?? tags.maxspeed;
    const backward = tags['maxspeed:backward'] ?? tags.maxspeed;
    raw = forward === backward ? forward : undefined;
  }
  if (tags['maxspeed:conditional'] || (best.direction && tags[`maxspeed:${best.direction}:conditional`])) raw = undefined;
  const limit = parseOsmMaxSpeed(raw).kmh;
  const runnerUp = candidates[1];
  // At an unresolved junction / parallel carriageways, suppress an ambiguous sign.
  const ambiguous = !!runnerUp && runnerUp.score - best.score < 3 && runnerUp.way.id !== best.way.id;
  return {
    roadKey: `osm:way:${best.way.id}`,
    roadName: tags.name ?? tags.ref ?? null,
    direction: best.direction,
    limitKmh: ambiguous ? null : limit,
    ambiguous,
    hasExplicitRule: raw != null || !!tags['maxspeed:conditional'] || !!tags['maxspeed:forward'] || !!tags['maxspeed:backward'],
  };
}
