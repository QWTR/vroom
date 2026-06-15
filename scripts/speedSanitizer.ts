import { TRIP_PIPELINE_SIMPLE } from '../lib/tripPipelineConfig';
import { haversineKm } from './navigationUtils';

/** HUD: nigdy 360 — artefakt GPS; realna autostrada mieści się w 200. */
export const MAX_SPEED_HUD_KMH = 200;
export const MAX_SPEED_BROWSE_KMH = 150;
/** Statystyki trasy: osobny sufit (peak z kilku próbek). */
export const MAX_SPEED_TRIP_STATS_KMH = 200;
/** Powyżej tej prędkości wymagamy dokładnego GPS (metry). */
export const GPS_ACCURACY_HIGH_SPEED_MAX_M = 30;
/** Doppler powyżej tego progu odrzucamy przy słabej dokładności. */
export const GPS_DOPPLER_HIGH_SPEED_TRUST_KMH = 150;

function rejectHighSpeedWithPoorAccuracy(
  kmh: number,
  accuracyM: number | null | undefined,
): boolean {
  if (!Number.isFinite(kmh) || kmh <= GPS_DOPPLER_HIGH_SPEED_TRUST_KMH) return false;
  if (accuracyM == null || !Number.isFinite(accuracyM)) return false;
  return accuracyM > GPS_ACCURACY_HIGH_SPEED_MAX_M;
}

export type TripMoveSample = { lat: number; lng: number; t: number };

export type SanitizeSpeedInput = {
  gpsSpeedMs: number | null;
  prevLat?: number | null;
  prevLng?: number | null;
  newLat?: number | null;
  newLng?: number | null;
  dtMs?: number;
  isTripActive?: boolean;
  /** Przemieszczenie netto (m) w oknie ~3 s — postój < ~12 m. */
  netMoveM?: number;
  /** Suma odcinków w oknie (m) — wykrywa jitter „w kółko”. */
  pathMoveM?: number;
  /** Prędkość z całego okna (km/h), nie z jednego ticka GPS. */
  sustainedKmh?: number;
  /** Trigger ruchu fizycznego (>3m raw delta) z pipeline'u. */
  rawMotionDetected?: boolean;
  /** Dokładność GPS (metry) dla noise clampu niskich prędkości. */
  accuracyM?: number | null;
};

const TRIP_SPEED_WINDOW_MS = 1000;
const TRIP_STANDSTILL_NET_M = 10;
/** net/path — poniżej = GPS skacze tam-z powrotem bez realnego jazdy. */
const TRIP_MIN_PATH_EFFICIENCY = 0.38;

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
  if (dtMs < 500) {
    return { netMoveM, pathMoveM, sustainedKmh: 0 };
  }
  const pathKmh = (pathMoveM / 1000) / (dtMs / 3_600_000);
  if (netMoveM < TRIP_STANDSTILL_NET_M) {
    return { netMoveM, pathMoveM, sustainedKmh: 0 };
  }
  const efficiency = netMoveM / Math.max(pathMoveM, 0.5);
  if (efficiency < 0.18 && pathKmh > 16) {
    return { netMoveM, pathMoveM, sustainedKmh: 0 };
  }
  const sustainedKmh = Math.min(pathKmh, pathKmh * efficiency);
  return { netMoveM, pathMoveM, sustainedKmh: Number.isFinite(sustainedKmh) ? sustainedKmh : 0 };
}

function derivedSpeedKmh(
  prevLat: number,
  prevLng: number,
  newLat: number,
  newLng: number,
  dtMs: number,
): number {
  if (dtMs < 40) return 0;
  const distKm = haversineKm(prevLat, prevLng, newLat, newLng);
  let kmh = distKm / (dtMs / 3_600_000);
  if (!Number.isFinite(kmh)) return 0;
  if (dtMs < 200 && kmh > 200) return 0;
  return kmh;
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
  const rawWake = !!input.rawMotionDetected;
  const accM = input.accuracyM != null && Number.isFinite(input.accuracyM) ? input.accuracyM : null;

  if (!TRIP_PIPELINE_SIMPLE) {
    if (input.isTripActive && !rawWake) {
      return 0;
    }
    if (input.isTripActive && gpsKmh < 5 && accM != null && accM > 10) {
      return 0;
    }
  } else if (input.isTripActive) {
    const netM = input.netMoveM ?? 0;
    const sustained = input.sustainedKmh ?? 0;
    if (gpsKmh < 2 && netM < 3 && sustained < 2) {
      return 0;
    }
  }

  // Driving/navigation: trust Doppler quickly, but never on pure standstill jitter.
  if (input.isTripActive && gpsKmh >= 6) {
    const netM = input.netMoveM ?? 0;
    const pathM = input.pathMoveM ?? 0;
    const sustained = input.sustainedKmh ?? 0;
    const hasPhysicalMotion = netM >= 6 || pathM >= 8 || sustained >= 3;
    if (hasPhysicalMotion) {
      if (rejectHighSpeedWithPoorAccuracy(gpsKmh, accM)) return 0;
      return Math.min(gpsKmh, maxKmh);
    }
  }

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

  // Tryb jazdy / nawigacja: HUD = max(Doppler, geometria), ale Doppler NIGDY sam
  // nie może pokazać 100+ km/h bez potwierdzenia ruchem (net/sustained).
  if (input.isTripActive) {
    const netM = input.netMoveM ?? 0;
    const sustained = input.sustainedKmh ?? 0;
    const geoKmh = Math.max(sustained, derivedKmh > 0 ? derivedKmh * 0.92 : 0);
    const slowCrawl = (derivedKmh >= 3 || sustained >= 3) && netM >= 4;
    const standstillNetM = slowCrawl || derivedKmh < 15 || sustained < 15 ? 4 : 12;
    const stationaryEvidence = netM < standstillNetM && sustained < 4.5;

    if (stationaryEvidence) {
      const pathM = input.pathMoveM ?? 0;
      const motionKmh = Math.max(geoKmh, derivedKmh);
      // Wolna jazda / rondo: path rośnie, net w oknie mały — nie zeruj (wymaga net ≥ 6 m).
      if (netM >= 6 && pathM >= 8 && (derivedKmh >= 2.5 || gpsKmh >= 2)) {
        return Math.min(
          maxKmh,
          Math.max(derivedKmh, gpsKmh, motionKmh, 4),
        );
      }
      // P1: brak paczek GPS, ale Doppler / skok punktów wskazuje jazdę.
      if (gpsKmh >= 10 || motionKmh >= 15) {
        if (netM < 6 && pathM < 10 && sustained < 3) {
          return 0;
        }
        return Math.min(Math.max(gpsKmh, motionKmh), maxKmh);
      }
      const frozenCoordsDriving =
        gpsKmh >= 15
        && netM < 22
        && pathM >= 8
        && geoKmh < 8
        && sustained >= 2.5;
      if (frozenCoordsDriving) {
        if (rejectHighSpeedWithPoorAccuracy(gpsKmh, accM)) return 0;
        return Math.min(gpsKmh, maxKmh);
      }
      if (derivedKmh >= 3 && derivedKmh <= 24 && netM >= 4 && sustained >= 2.5) {
        return Math.min(derivedKmh, maxKmh);
      }
      return 0;
    }

    if (gpsKmh >= 1) {
      const geoCap = Math.min(maxKmh, geoKmh * 1.18 + 8);
      // iOS/Android: lat/lng stoi, Doppler żywy (100+ km/h) — nie zeruj HUD.
      const dopplerLiveCoordsFrozen =
        gpsKmh >= 15
        && netM < 22
        && (input.pathMoveM ?? 0) < 35
        && geoKmh < 8
        && sustained < 8;
      if (dopplerLiveCoordsFrozen) {
        if (rejectHighSpeedWithPoorAccuracy(gpsKmh, accM)) return 0;
        return Math.min(gpsKmh, maxKmh);
      }
      if (netM < 22 && geoKmh < 5 && sustained < 5 && !slowCrawl) {
        const pathM = input.pathMoveM ?? 0;
        const dopplerWithoutGeometry =
          gpsKmh >= 15
          && netM < 10
          && pathM >= 8
          && (input.pathMoveM ?? 0) / Math.max(netM, 0.5) >= 0.35;
        if (dopplerWithoutGeometry) {
          if (rejectHighSpeedWithPoorAccuracy(gpsKmh, accM)) return 0;
          return Math.min(gpsKmh, maxKmh);
        }
        if (pathM >= 6 && (gpsKmh >= 2.5 || derivedKmh >= 2.5)) {
          return Math.min(maxKmh, Math.max(gpsKmh, derivedKmh, sustained, 4));
        }
        return 0;
      }
      if (netM < 22) {
        return Math.min(gpsKmh, geoCap);
      }
      if (gpsKmh > geoCap + 18) {
        return geoCap;
      }
      if (sustained > 0) {
        return Math.min(gpsKmh, maxKmh, sustained * 1.2 + 10, geoCap + 12);
      }
      return Math.min(gpsKmh, maxKmh, geoCap + 12);
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
        if (netM > 12) {
          return Math.min(derivedKmh, maxKmh);
        }
        return 0;
      }
      if (derivedKmh >= 8) {
        return Math.min(derivedKmh, maxKmh);
      }
      if (derivedKmh >= 4 && netM >= 6) {
        return Math.min(derivedKmh, maxKmh);
      }
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

  const browseNetM = input.netMoveM ?? 0;
  if (gpsKmh > 22 && browseNetM < 12 && derivedKmh < 8) {
    return 0;
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
  if (input.isTripActive && !input.rawMotionDetected) {
    return 0;
  }
  const kmh = sanitizeSpeedKmh(input);
  const gpsKmh = input.gpsSpeedMs != null && input.gpsSpeedMs > 0 ? input.gpsSpeedMs * 3.6 : 0;
  const accelLagDetected =
    !!input.isTripActive
    && gpsKmh >= 10
    && kmh > 0
    && gpsKmh >= kmh * 1.55
    && ((input.netMoveM ?? 0) >= 4 || (input.pathMoveM ?? 0) >= 6 || (input.sustainedKmh ?? 0) >= 2.5);
  if (accelLagDetected) {
    if (rejectHighSpeedWithPoorAccuracy(gpsKmh, input.accuracyM)) {
      return kmh > 0 ? kmh / 3.6 : null;
    }
    const boostedKmh = Math.max(kmh, gpsKmh * 0.92, (input.sustainedKmh ?? 0) * 1.08);
    return Math.min(boostedKmh, MAX_SPEED_HUD_KMH) / 3.6;
  }
  if (kmh > 0) return kmh / 3.6;
  if (
    input.isTripActive
    && input.gpsSpeedMs != null
    && input.gpsSpeedMs <= 0
    && (input.sustainedKmh ?? 0) >= 3
  ) {
    return Math.min(input.sustainedKmh!, MAX_SPEED_HUD_KMH) / 3.6;
  }
  if (
    input.isTripActive
    && input.gpsSpeedMs != null
    && input.gpsSpeedMs <= 0
    && input.prevLat != null
    && input.newLat != null
    && (input.netMoveM ?? 0) >= 3.5
    && (input.dtMs ?? 0) >= 400
  ) {
    const derived = derivedSpeedKmh(
      input.prevLat!,
      input.prevLng!,
      input.newLat!,
      input.newLng!,
      input.dtMs!,
    );
    if (derived >= 3 && derived <= 25) return derived / 3.6;
  }
  return null;
}

/** Ostatnia linia obrony HUD — Doppler bez ruchu geometrycznego. */
export function clampSpeedKmhToGeometry(
  kmh: number,
  opts: {
    netMoveM: number;
    sustainedKmh: number;
    motionKmh: number;
    rawGpsKmh: number;
    isTripActive?: boolean;
  },
): number {
  if (!opts.isTripActive || !Number.isFinite(kmh)) return Math.max(0, kmh);
  const netM = opts.netMoveM;
  const geo = Math.max(opts.sustainedKmh, opts.motionKmh * 0.88);
  const parkedLike =
    netM < 6
    && opts.sustainedKmh < 4
    && opts.motionKmh < 5;
  if (kmh <= 0) return 0;
  if (netM < 12 && opts.motionKmh < 5 && opts.sustainedKmh < 4) {
    return 0;
  }
  if (netM < 14) {
    if (opts.motionKmh >= 5 || opts.sustainedKmh >= 4) {
      const motionCap = Math.max(opts.motionKmh, opts.sustainedKmh) * 1.08 + 2;
      if (kmh > motionCap) return motionCap < 2.5 ? 0 : motionCap;
      return kmh;
    }
    const cap = Math.min(22, geo * 1.12 + 4);
    if (kmh > cap) return cap < 2.5 ? 0 : cap;
  }
  return kmh;
}
