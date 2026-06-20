import { bearingBetween, haversineKm } from '../../scripts/navigationUtils';

/** Mapbox bearings: kierunek ± zakres (°) — preferuj jazdę do przodu bez zawracania. */
export const REROUTE_BEARING_RANGE_DEG = 60;
export const REROUTE_HEADING_QUANTIZE_DEG = 12;

export function routeStartsWithUTurn(route: any): boolean {
  const steps = route?.legs?.[0]?.steps;
  if (!Array.isArray(steps)) return false;
  let distanceFromOriginM = 0;
  for (const step of steps) {
    if (step?.maneuver?.type === 'arrive') continue;
    if (distanceFromOriginM > 180) break;
    const maneuver = step?.maneuver ?? {};
    const modifier = String(maneuver.modifier ?? '').toLowerCase();
    const instruction = String(maneuver.instruction ?? '').toLowerCase();
    if (modifier === 'uturn' || modifier === 'u-turn' || /u-turn|zawr[oó]ć/.test(instruction)) {
      return true;
    }
    const before = Number(maneuver.bearing_before);
    const after = Number(maneuver.bearing_after);
    if (Number.isFinite(before) && Number.isFinite(after) && maneuver.type !== 'depart') {
      const delta = Math.abs(((after - before + 540) % 360) - 180);
      if (delta >= 150) return true;
    }
    distanceFromOriginM += Math.max(0, Number(step?.distance) || 0);
  }
  return false;
}

export function quantizeHeading(headingDeg: number, stepDeg = REROUTE_HEADING_QUANTIZE_DEG): number {
  const h = ((headingDeg % 360) + 360) % 360;
  return Math.round(h / stepDeg) * stepDeg % 360;
}

/**
 * Kierunek jazdy do bearings w Directions — wektor ruchu (COG/bearing z surowego GPS)
 * ma pierwszeństwo przed kompasem / snapped heading.
 */
export function resolveRerouteTravelHeadingDeg(
  lat: number,
  lng: number,
  fallbackHeadingDeg: number,
  motionAnchor?: { lat: number; lng: number } | null,
  minMoveM = 6,
): number {
  if (
    motionAnchor
    && Number.isFinite(motionAnchor.lat)
    && Number.isFinite(motionAnchor.lng)
  ) {
    const movedM = haversineKm(motionAnchor.lat, motionAnchor.lng, lat, lng) * 1000;
    if (movedM >= minMoveM) {
      return bearingBetween(motionAnchor.lat, motionAnchor.lng, lat, lng);
    }
  }
  const h = Number(fallbackHeadingDeg);
  return Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
}

export type RerouteOriginInput = {
  lat: number;
  lng: number;
  name?: string;
};

/** Origin reroute = faktyczna pozycja pojazdu (nie rzut na starą polilinię). */
export function buildRerouteOrigin(input: RerouteOriginInput): {
  latitude: number;
  longitude: number;
  name: string;
} {
  return {
    latitude: input.lat,
    longitude: input.lng,
    name: input.name ?? 'Moja pozycja',
  };
}

/**
 * Heading do Directions API — TYLKO tu: fizyczny kompas urządzenia,
 * ewentualnie wektor z ostatnich ~10 m jazdy.
 */
export function resolveRerouteApiHeadingDeg(
  deviceHeadingDeg: number | null | undefined,
  vehicleLat: number,
  vehicleLng: number,
  motionAnchor: { lat: number; lng: number } | null | undefined,
  fallbackHeadingDeg: number,
): number {
  // Course over ground is the direction of the vehicle. Device heading often
  // reflects how the phone is mounted and can point sideways or backwards.
  if (
    motionAnchor
    && Number.isFinite(motionAnchor.lat)
    && Number.isFinite(motionAnchor.lng)
  ) {
    const movedM = haversineKm(motionAnchor.lat, motionAnchor.lng, vehicleLat, vehicleLng) * 1000;
    if (movedM >= 6) {
      return quantizeHeading(
        bearingBetween(motionAnchor.lat, motionAnchor.lng, vehicleLat, vehicleLng),
      );
    }
  }
  if (
    deviceHeadingDeg != null
    && Number.isFinite(deviceHeadingDeg)
    && deviceHeadingDeg >= 0
  ) {
    return quantizeHeading(deviceHeadingDeg);
  }
  return quantizeHeading(
    resolveRerouteTravelHeadingDeg(
      vehicleLat,
      vehicleLng,
      fallbackHeadingDeg,
      motionAnchor ?? null,
      10,
    ),
  );
}
