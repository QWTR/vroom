import type { SmoothTarget } from './smoothPositionFeed';
import { markerLogCritical } from '../markerPipelineLog';

const R = 6371000;

export function haversineFeedM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Null island / poza globusem / NaN. */
export function isAbsurdGlobeCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return true;
  if (Math.abs(lat) < 1e-4 && Math.abs(lng) < 1e-4) return true;
  return false;
}

function isStationaryFeedTarget(target: SmoothTarget): boolean {
  const src = String(target.source ?? '');
  if (src === 'v10_stationary_hold') return true;
  return (target.speedMs ?? 0) < 0.55;
}

function isBootstrapFeed(source: string, durationMs?: number): boolean {
  if (durationMs !== 0) return false;
  return (
    source.includes('bootstrap')
    || source.includes('instant')
    || source === 'recovery'
    || source === 'stall_recovery'
  );
}

/**
 * Ostatnia linia obrony przed „drugim końcem świata” w worklecie / MarkerView.
 * Zwraca powód odrzucenia lub null gdy OK.
 */
export function feedJumpRejectReason(
  target: SmoothTarget,
  last: SmoothTarget | null,
): string | null {
  if (isAbsurdGlobeCoordinate(target.latitude, target.longitude)) {
    return 'absurd_coordinate';
  }
  if (!last) return null;

  const movedM = haversineFeedM(
    last.latitude,
    last.longitude,
    target.latitude,
    target.longitude,
  );
  const src = String(target.source ?? '');
  const stationary = isStationaryFeedTarget(target);
  const bootstrap = isBootstrapFeed(src, target.durationMs);
  const startupWake = !!target.rawMotionDetected || (target.rawMotionM ?? 0) >= 3.0;

  if (movedM > 800) return 'mega_jump_800m';
  if (movedM > 250 && (target.speedMs ?? 0) < 2.5) return 'idle_mega_jump';
  if (!startupWake && stationary && movedM > 6) return 'stationary_jump';
  if (!startupWake && (target.speedMs ?? 0) < 1.2 && movedM > 32) return 'low_speed_jump';
  if (target.durationMs === 0 && !bootstrap && movedM > 48) return 'instant_far_jump';
  return null;
}

export function logFeedJumpReject(
  reason: string,
  target: SmoothTarget,
  last: SmoothTarget | null,
): void {
  const movedM = last
    ? haversineFeedM(last.latitude, last.longitude, target.latitude, target.longitude)
    : null;
  markerLogCritical('WORKLET_FEED_COORD_REJECT', {
    reason,
    source: target.source ?? 'unknown',
    movedM: movedM != null ? Math.round(movedM) : null,
    lat: Number(target.latitude.toFixed(6)),
    lng: Number(target.longitude.toFixed(6)),
    speedMs: target.speedMs ?? null,
    durationMs: target.durationMs ?? null,
  });
}
