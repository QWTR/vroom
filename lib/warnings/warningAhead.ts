import type { LiveWarning } from './warningCatalog';

type Coord = { latitude: number; longitude: number };
type DriverPose = Coord & { heading: number; speedKmh: number };

export type UpcomingWarning = {
  warning: LiveWarning;
  distanceM: number;
  additionalCount: number;
};

const R = 6_371_000;
const toRad = (value: number) => value * Math.PI / 180;

export function distanceMeters(a: Coord, b: Coord): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function bearing(a: Coord, b: Coord): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function headingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function projectToRoute(point: Coord, route: Coord[]): { arcM: number; crossTrackM: number } | null {
  if (route.length < 2) return null;
  const cosLat = Math.max(0.1, Math.cos(toRad(point.latitude)));
  let cumulative = 0;
  let best: { arcM: number; crossTrackM: number } | null = null;
  for (let index = 0; index < route.length - 1; index += 1) {
    const a = route[index];
    const b = route[index + 1];
    const ax = toRad(a.longitude) * R * cosLat;
    const ay = toRad(a.latitude) * R;
    const bx = toRad(b.longitude) * R * cosLat;
    const by = toRad(b.latitude) * R;
    const px = toRad(point.longitude) * R * cosLat;
    const py = toRad(point.latitude) * R;
    const vx = bx - ax;
    const vy = by - ay;
    const lengthSq = vx * vx + vy * vy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq)) : 0;
    const dx = px - (ax + vx * t);
    const dy = py - (ay + vy * t);
    const crossTrackM = Math.hypot(dx, dy);
    const segmentM = Math.sqrt(lengthSq);
    if (!best || crossTrackM < best.crossTrackM) best = { arcM: cumulative + segmentM * t, crossTrackM };
    cumulative += segmentM;
  }
  return best;
}

function isRelevantDirection(warning: LiveWarning): boolean {
  return warning.direction !== 'opposite';
}

export function warningHorizonMeters(speedKmh: number): number {
  if (speedKmh >= 90) return 5_000;
  if (speedKmh >= 50) return 3_500;
  return 2_000;
}

export function selectUpcomingWarning(input: {
  warnings: LiveWarning[];
  pose: DriverPose | null;
  isNavigating: boolean;
  isDriving: boolean;
  route: Coord[];
}): UpcomingWarning | null {
  const { warnings, pose, isNavigating, isDriving, route } = input;
  if (!pose || (!isNavigating && !isDriving)) return null;
  const candidates: { warning: LiveWarning; distanceM: number }[] = [];

  if (isNavigating && route.length >= 2) {
    const driverProjection = projectToRoute(pose, route);
    if (!driverProjection) return null;
    for (const warning of warnings) {
      if (!isRelevantDirection(warning)) continue;
      const projected = projectToRoute({ latitude: Number(warning.lat), longitude: Number(warning.lng) }, route);
      if (!projected || projected.crossTrackM > 150) continue;
      const aheadM = projected.arcM - driverProjection.arcM;
      if (aheadM >= 0 && aheadM <= 5_000) candidates.push({ warning, distanceM: aheadM });
    }
  } else {
    const horizonM = warningHorizonMeters(pose.speedKmh);
    for (const warning of warnings) {
      if (!isRelevantDirection(warning)) continue;
      const point = { latitude: Number(warning.lat), longitude: Number(warning.lng) };
      const distanceM = distanceMeters(pose, point);
      if (distanceM > horizonM || headingDelta(bearing(pose, point), pose.heading) > 60) continue;
      candidates.push({ warning, distanceM });
    }
  }

  candidates.sort((a, b) => a.distanceM - b.distanceM);
  return candidates[0]
    ? { ...candidates[0], additionalCount: Math.max(0, candidates.length - 1) }
    : null;
}

export function formatWarningDistance(distanceM: number): string {
  if (distanceM < 1_000) return `${Math.max(10, Math.round(distanceM / 10) * 10)} m`;
  return `${(distanceM / 1_000).toFixed(1)} km`;
}

