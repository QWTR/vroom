import { haversineKm } from './navigationUtils';

/** Fizyczny sufit (superauta / tor) — nie ogranicza legalnej jazdy 300+ km/h. */
export const MAX_SPEED_HUD_KMH = 360;
export const MAX_SPEED_BROWSE_KMH = 150;
export const MAX_SPEED_TRIP_STATS_KMH = 360;

export type TripMoveSample = { lat: number; lng: number; t: number };

export type SanitizeSpeedInput = {
  gpsSpeedMs: number | null;
  prevLat?: number | null;
  prevLng?: number | null;
  newLat?: number | null;
  newLng?: number | null;
  dtMs?: number;
  isTripActive?: boolean;
  /** Przemieszczenie netto (m) w oknie ~4 s — postój < 12 m. */
  netMoveM?: number;
  /** Prędkość z całego okna (km/h), nie z jednego ticka GPS. */
  sustainedKmh?: number;
};

const TRIP_SPEED_WINDOW_MS = 4500;
const TRIP_STANDSTILL_NET_M = 7;

/** Prędkość i netto dystans z ostatnich próbek (odcina jitter 30+ km/h na postoju). */
export function sustainedTripSpeedFromSamples(
  samples: TripMoveSample[],
  now: number,
  windowMs = TRIP_SPEED_WINDOW_MS,
): { netMoveM: number; pathMoveM: number; sustainedKmh: number } {
  const recent = samples.filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) {
    return { netMoveM: 0, pathMoveM: 0, sustainedKmh: 0 };
  }
  let pathMoveM = 0;
  for (let i = 1; i < recent.length; i++) {
    pathMoveM += haversineKm(
      recent[i - 1].lat, recent[i - 1].lng,
      recent[i].lat, recent[i].lng,
    ) * 1000;
  }
  const first = recent[0];
  const last = recent[recent.length - 1];
  const netMoveM = haversineKm(first.lat, first.lng, last.lat, last.lng) * 1000;
  const dtMs = Math.max(0, last.t - first.t);
  if (dtMs < 2000) {
    return { netMoveM, pathMoveM, sustainedKmh: 0 };
  }
  const pathKmh = (pathMoveM / 1000) / (dtMs / 3_600_000);
  if (netMoveM < TRIP_STANDSTILL_NET_M) {
    return { netMoveM, pathMoveM, sustainedKmh: 0 };
  }
  const sustainedKmh = Math.min(pathKmh, pathKmh * (netMoveM / Math.max(pathMoveM, 1)));
  return { netMoveM, pathMoveM, sustainedKmh: Number.isFinite(sustainedKmh) ? sustainedKmh : 0 };
}

function derivedSpeedKmh(
  prevLat: number,
  prevLng: number,
  newLat: number,
  newLng: number,
  dtMs: number,
): number {
  if (dtMs < 400) return 0;
  const distKm = haversineKm(prevLat, prevLng, newLat, newLng);
  const kmh = (distKm / (dtMs / 1000)) * 3600;
  return Number.isFinite(kmh) ? kmh : 0;
}

/**
 * Wiarygodna prędkość: odrzuca spike GPS (postój / teleport), nie tnie legalnej jazdy 300+ km/h.
 */
export function sanitizeSpeedKmh(input: SanitizeSpeedInput): number {
  const maxKmh = input.isTripActive ? MAX_SPEED_HUD_KMH : MAX_SPEED_BROWSE_KMH;
  const gpsKmh =
    input.gpsSpeedMs != null && input.gpsSpeedMs > 0
      ? input.gpsSpeedMs * 3.6
      : 0;

  let derivedKmh = 0;
  const {
    prevLat,
    prevLng,
    newLat,
    newLng,
    dtMs = 0,
  } = input;
  if (
    prevLat != null &&
    prevLng != null &&
    newLat != null &&
    newLng != null &&
    Number.isFinite(prevLat) &&
    Number.isFinite(prevLng) &&
    Number.isFinite(newLat) &&
    Number.isFinite(newLng) &&
    dtMs > 0
  ) {
    derivedKmh = derivedSpeedKmh(prevLat, prevLng, newLat, newLng, dtMs);
  }

  let kmh = gpsKmh;

  // Tryb jazdy / nawigacja: prędkość tylko przy realnym przemieszczeniu (okno + netto).
  if (input.isTripActive) {
    const netM = input.netMoveM ?? 0;
    const sustained = input.sustainedKmh ?? 0;
    if (netM < TRIP_STANDSTILL_NET_M && sustained < 3.5) {
      return 0;
    }
    kmh = sustained;
    if (gpsKmh > 0) {
      kmh = Math.min(kmh, gpsKmh, sustained * 1.15);
    }
    if (derivedKmh > 0 && derivedKmh < sustained * 0.5) {
      kmh = Math.min(kmh, derivedKmh * 1.1);
    }
    if (!Number.isFinite(kmh) || kmh < 0) return 0;
    return Math.min(kmh, maxKmh);
  }

  if (derivedKmh > 0) {
    if (gpsKmh <= 0) {
      kmh = derivedKmh;
    } else if (derivedKmh < 3 && gpsKmh > 40) {
      // Postój + fałszywy odczyt Doppler (np. 250 km/h na kanapie)
      kmh = 0;
    } else if (gpsKmh > 100 && derivedKmh < gpsKmh * 0.4) {
      kmh = derivedKmh;
    } else if (gpsKmh > 200 && derivedKmh < 30) {
      kmh = derivedKmh;
    } else if (derivedKmh < gpsKmh * 0.55) {
      kmh = derivedKmh;
    } else if (derivedKmh >= gpsKmh * 0.85) {
      // GPS i pozycja się zgadzają — pełna prędkość (także 300+ km/h)
      kmh = Math.max(gpsKmh, derivedKmh);
    } else {
      kmh = Math.min(gpsKmh, derivedKmh * 1.35);
    }
  }

  if (derivedKmh > 0 && derivedKmh < 2 && kmh < 4) {
    return 0;
  }

  if (!Number.isFinite(kmh) || kmh < 0) return 0;
  return Math.min(kmh, maxKmh);
}

/** Konwersja km/h → m/s do feedSpeed / publishSpeed. */
export function sanitizeSpeedMs(input: SanitizeSpeedInput): number | null {
  const kmh = sanitizeSpeedKmh(input);
  if (kmh <= 0) return null;
  return kmh / 3.6;
}
