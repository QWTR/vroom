import { haversineKm } from '../../scripts/navigationUtils';
import { NAV_V3 } from './config';
import type { GpsFilterResult, RawGpsFix } from './types';

export type GpsFilterConfig = {
  impossibleJumpM: number;
  impossibleJumpMaxKmh: number;
  maxAccuracyRejectM: number;
};

const DEFAULT_CFG: GpsFilterConfig = {
  impossibleJumpM: NAV_V3.GPS_IMPOSSIBLE_JUMP_M,
  impossibleJumpMaxKmh: NAV_V3.GPS_IMPOSSIBLE_JUMP_MAX_KMH,
  maxAccuracyRejectM: NAV_V3.GPS_MAX_ACCURACY_REJECT_M,
};

function isNullIsland(lat: number, lng: number): boolean {
  return Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6;
}

function isAbsurdCoordinate(lat: number, lng: number): boolean {
  return !Number.isFinite(lat)
    || !Number.isFinite(lng)
    || Math.abs(lat) > 90
    || Math.abs(lng) > 180
    || isNullIsland(lat, lng);
}

/** Explicit mock-location samples (for example Lockito) bypass strict gates. */
export function shouldBypassGpsFilters(fix?: Pick<RawGpsFix, 'isMocked'>): boolean {
  return fix?.isMocked === true;
}

/**
 * Odrzuca absurdalne / nierealne skoki GPS. Nie modyfikuje współrzędnych —
 * clampowanie zostawiamy pipeline'owi (opcjonalnie w przyszłości).
 */
export function filterGpsFix(
  fix: RawGpsFix,
  prev: RawGpsFix | null,
  cfg: GpsFilterConfig = DEFAULT_CFG,
): GpsFilterResult {
  if (isAbsurdCoordinate(fix.lat, fix.lng)) {
    return { verdict: 'reject', reason: 'absurd_coordinate', fix };
  }

  if (shouldBypassGpsFilters(fix)) {
    return { verdict: 'accept', fix };
  }

  if (Number.isFinite(fix.accuracyM) && fix.accuracyM > cfg.maxAccuracyRejectM) {
    return { verdict: 'reject', reason: 'accuracy_too_poor', fix };
  }

  if (!prev) {
    return { verdict: 'accept', fix };
  }

  const dtMs = Math.max(50, fix.timestampMs - prev.timestampMs);
  const jumpM = haversineKm(prev.lat, prev.lng, fix.lat, fix.lng) * 1000;

  if (jumpM <= cfg.impossibleJumpM) {
    return { verdict: 'accept', fix };
  }

  const dopplerKmh = fix.speedMs != null && fix.speedMs >= 0 ? fix.speedMs * 3.6 : 0;
  const impliedKmh = Math.max(dopplerKmh, (jumpM / (dtMs / 1000)) * 3.6);

  if (impliedKmh > cfg.impossibleJumpMaxKmh) {
    return { verdict: 'reject', reason: 'impossible_jump', fix };
  }

  return { verdict: 'accept', fix };
}
