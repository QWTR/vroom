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

const TRIP_SPEED_WINDOW_MS = 3000;
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

  // Tryb jazdy / nawigacja: Doppler GPS jest głównym źródłem prędkości.
  // iOS potrafi przez kilka sekund trzymać tę samą lat/lng lub snap, mimo że
  // `coords.speed` jest poprawny. Dlatego brak przesunięcia nie może zerować HUD/DR.
  if (input.isTripActive) {
    const netM = input.netMoveM ?? 0;
    const sustained = input.sustainedKmh ?? 0;
    const stationaryEvidence = netM < 5.5 && sustained < 1.8;
    if (gpsKmh >= 1) {
      // Ghost Doppler guard: część telefonów raportuje 2-12 km/h na postoju.
      // Nie ufamy niskiemu gpsKmh dopóki długoterminowy ruch (net/sustained)
      // tego nie potwierdzi.
      if (gpsKmh <= 12 && stationaryEvidence) {
        // derivedKmh bywa zatrute jitterem, ale jeżeli jest spójne i netto ruch rośnie,
        // pozwalamy na bardzo wolny start z miejsca.
        if (!(derivedKmh >= 4 && derivedKmh <= 25 && netM >= 6)) {
          return 0;
        }
      }
      return Math.min(gpsKmh, maxKmh);
    }

    // ── KRYTYCZNE: GPS JITTER PROTECTION ─────────────────────────────────
    // Gdy Doppler GPS = 0 (auto stoi) ale słaby sygnał (Android w garażu / pod
    // wieżowcem) podaje lat/lng skaczące o 30–50m co tick, derivedKmh wybucha
    // do 100–200 km/h MIMO POSTOJU. Stare zachowanie zwracało te 140 km/h jako
    // prawdziwą prędkość → bridge w map.tsx projektował marker 40m do przodu
    // co tick → marker uciekał po mapie mimo że auto stoi.
    //
    // Reguła generalna: bez Dopplera (gpsKmh = 0) NIGDY nie ufamy derivedKmh
    // z pojedynczego ticka — używamy sustained (3s okno path, jitter immune).
    //
    // 1) Brak długoterminowego ruchu (sustained < 2.5) + duża delta = jitter:
    if (sustained < 2.5) {
      if (derivedKmh > 25) {
        return 0;
      }
      // Bardzo wolny ruch (start z miejsca): derivedKmh ≤ 25 i netMoveM ≥ 3.5.
      // Wtedy ufamy derivedKmh (max 25 km/h — fizyka startu z miejsca).
      if (derivedKmh >= 3 && netM >= 3.5) {
        return Math.min(derivedKmh, maxKmh);
      }
      return 0;
    }

    // 2) Sustained ≥ 2.5: długoterminowy ruch potwierdzony. UFAMY TYLKO sustained.
    //    derivedKmh z pojedynczego ticka jest zatruty przez GPS jitter (Android
    //    przy słabym sygnale dorzuca ±20m do każdego fixu → derivedKmh skacze
    //    o 70 km/h). Bridge potrzebuje stabilnej prędkości żeby nie teleportować
    //    markera; sustained jest dokładnie tym co potrzebne.
    return Math.min(sustained, maxKmh);
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
