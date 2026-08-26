/** Gorąca flota publikuje GeoJSON maksymalnie 30 razy na sekundę. */
export const FLEET_PUBLISH_INTERVAL_MS = 33;
/** Cel renderu jest cofnięty o mały bufor, aby interpolować między prawdziwymi fixami. */
export const FLEET_INTERPOLATION_BUFFER_MS = 350;
const SOFT_CORRECTION_MIN_MS = 450;
const SOFT_CORRECTION_MAX_MS = 1_200;
const SMALL_CORRECTION_M = 3;
const SNAP_CORRECTION_M = 80;
/** Pełna animacja floty w tym promieniu od widza; znajomi bez limitu. */
export const FLEET_FULL_ANIMATION_RADIUS_KM = 10;
/** Histereza: wyjście z animacji dopiero powyżej tego promienia (km). */
export const FLEET_FULL_ANIMATION_EXIT_KM = 11;
/** Maks. punktów drogi/trailu w slocie animacji. */
export const FLEET_SLOT_MAX_POINTS = 8;
/** Dead reckoning po ostatnim fixie — wypełnia luki między pakietami socket (np. snapshot 12 s). */
export const FLEET_EXTRAPOLATE_DECAY_START_MS = 1_000;
export const FLEET_EXTRAPOLATE_MAX_MS = 2_000;
/** Dalecy nieznajomi przyjmują wyłącznie najnowszy fix w tym interwale. */
export const FLEET_REDUCED_UPDATE_MS = 10_000;
/** V3-Lite pushTarget: min/max czas segmentu lerp origin→target. */
export const FLEET_PUSH_MIN_MS = 400;
export const FLEET_PUSH_MAX_MS = 5_000;
export const FLEET_PUSH_DEFAULT_MS = 900;
/** Minimalny czas segmentu w syntetycznym trailu. */
export const FLEET_MIN_SEGMENT_MS = 200;
/** @deprecated aliasy — używaj FLEET_PUSH_* */
export const FLEET_CLIENT_SEG_MIN_MS = FLEET_PUSH_MIN_MS;
export const FLEET_CLIENT_SEG_MAX_MS = FLEET_PUSH_MAX_MS;
export const FLEET_CLIENT_SEG_DEFAULT_MS = FLEET_PUSH_DEFAULT_MS;
/** Minimalny dystans do zapisu incremental / force flush (spójne z serwerem). */
export const FLEET_MIN_SNAP_DIST_M = 35;

export function shouldPublishFleetFrame(
  nowMs: number,
  lastPublishAtMs: number,
  intervalMs = FLEET_PUBLISH_INTERVAL_MS,
): boolean {
  'worklet';
  return lastPublishAtMs <= 0 || nowMs - lastPublishAtMs >= intervalMs;
}

export function shouldRenderFleet2dPin(slotTier: 0 | 1, targetTier: 0 | 1): boolean {
  'worklet';
  return slotTier === targetTier;
}

export function shouldExtrapolatePastTrailTail(renderAtMs: number, tailAtMs: number): boolean {
  'worklet';
  return Number.isFinite(renderAtMs) && Number.isFinite(tailAtMs) && renderAtMs > tailAtMs;
}

export function correctionDurationForDistance(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= SMALL_CORRECTION_M) {
    return SOFT_CORRECTION_MIN_MS;
  }
  if (distanceM >= SNAP_CORRECTION_M) {
    return 0;
  }
  const t = Math.min(1, distanceM / 80);
  return SOFT_CORRECTION_MIN_MS + (SOFT_CORRECTION_MAX_MS - SOFT_CORRECTION_MIN_MS) * t;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function shouldAcceptFleetMotionUpdate(input: {
  isFriend?: boolean;
  hasPreviousPosition: boolean;
  viewerLat?: number | null;
  viewerLng?: number | null;
  incomingLat: number;
  incomingLng: number;
  fullRadiusKm?: number;
}): boolean {
  if (!input.hasPreviousPosition) return true;
  if (input.isFriend === true) return true;
  if (
    !Number.isFinite(input.viewerLat)
    || !Number.isFinite(input.viewerLng)
    || !Number.isFinite(input.incomingLat)
    || !Number.isFinite(input.incomingLng)
  ) {
    return true;
  }
  const radiusKm = Number.isFinite(input.fullRadiusKm)
    ? Number(input.fullRadiusKm)
    : FLEET_FULL_ANIMATION_RADIUS_KM;
  const distKm = haversineKm(
    Number(input.viewerLat),
    Number(input.viewerLng),
    input.incomingLat,
    input.incomingLng,
  );
  return Number.isFinite(distKm) && distKm <= radiusKm;
}

export type FleetMotionTier = 'full' | 'reduced';

export function resolveFleetMotionTier(input: {
  serverTier?: string | null;
  isFriend?: boolean;
  viewerLat?: number | null;
  viewerLng?: number | null;
  incomingLat: number;
  incomingLng: number;
  fullRadiusKm?: number;
}): FleetMotionTier {
  if (input.isFriend === true) return 'full';
  if (input.serverTier === 'full') return 'full';
  if (input.serverTier === 'reduced') return 'reduced';
  if (
    !Number.isFinite(input.viewerLat)
    || !Number.isFinite(input.viewerLng)
    || !Number.isFinite(input.incomingLat)
    || !Number.isFinite(input.incomingLng)
  ) {
    return 'reduced';
  }
  const radiusKm = Number.isFinite(input.fullRadiusKm)
    ? Number(input.fullRadiusKm)
    : FLEET_FULL_ANIMATION_RADIUS_KM;
  const distKm = haversineKm(
    Number(input.viewerLat),
    Number(input.viewerLng),
    input.incomingLat,
    input.incomingLng,
  );
  return Number.isFinite(distKm) && distKm <= radiusKm ? 'full' : 'reduced';
}

export function shouldApplyReducedFleetUpdate(
  nowMs: number,
  lastAppliedAtMs: number,
  intervalMs = FLEET_REDUCED_UPDATE_MS,
): boolean {
  return lastAppliedAtMs <= 0 || nowMs - lastAppliedAtMs >= intervalMs;
}
