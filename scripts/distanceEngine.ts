export interface DistanceFix {
  latitude: number;
  longitude: number;
  timestampMs: number;
  speedKmh?: number | null;
  accuracyM?: number | null;
}

export interface DistanceGateConfig {
  minSegmentKm: number;
  maxSegmentKm: number;
  maxFixGapSec: number;
  maxPlausibleKmh: number;
  minSpeedKmh?: number;
  maxAccuracyM?: number;
}

export interface DistanceSegmentResult {
  accepted: boolean;
  distanceKm: number;
  reason:
    | 'ok'
    | 'invalid_time'
    | 'stale_gap'
    | 'min_speed'
    | 'accuracy'
    | 'jitter'
    | 'jump'
    | 'impossible_speed';
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluateDistanceSegment(
  prev: DistanceFix,
  next: DistanceFix,
  cfg: DistanceGateConfig,
): DistanceSegmentResult {
  const dtSec = Math.max(0, (next.timestampMs - prev.timestampMs) / 1000);
  if (dtSec <= 0) return { accepted: false, distanceKm: 0, reason: 'invalid_time' };
  if (dtSec > cfg.maxFixGapSec) return { accepted: false, distanceKm: 0, reason: 'stale_gap' };

  const nextSpeed = next.speedKmh ?? null;
  if (cfg.minSpeedKmh != null && nextSpeed != null && nextSpeed < cfg.minSpeedKmh) {
    return { accepted: false, distanceKm: 0, reason: 'min_speed' };
  }

  if (cfg.maxAccuracyM != null) {
    if (next.accuracyM != null && next.accuracyM > cfg.maxAccuracyM) {
      return { accepted: false, distanceKm: 0, reason: 'accuracy' };
    }
    if (prev.accuracyM != null && prev.accuracyM > cfg.maxAccuracyM) {
      return { accepted: false, distanceKm: 0, reason: 'accuracy' };
    }
  }

  const distanceKm = haversineKm(prev.latitude, prev.longitude, next.latitude, next.longitude);
  if (distanceKm < cfg.minSegmentKm) return { accepted: false, distanceKm, reason: 'jitter' };
  if (distanceKm > cfg.maxSegmentKm) return { accepted: false, distanceKm, reason: 'jump' };

  const maxByTimeKm = (cfg.maxPlausibleKmh / 3600) * dtSec;
  if (distanceKm > maxByTimeKm) return { accepted: false, distanceKm, reason: 'impossible_speed' };

  return { accepted: true, distanceKm, reason: 'ok' };
}
