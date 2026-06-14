import { bearingBetween, haversineKm } from '../../scripts/navigationUtils';

/** Mapbox bearings: kierunek ± zakres (°) — preferuj jazdę do przodu bez zawracania. */
export const REROUTE_BEARING_RANGE_DEG = 60;
export const REROUTE_HEADING_QUANTIZE_DEG = 12;

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
