import * as turf from '@turf/turf';
import { Step } from '../hooks/useGoogleDirections';

type LatLngPoint = { latitude: number; longitude: number };

function toTurfLineString(points: LatLngPoint[]): turf.helpers.Feature<turf.helpers.LineString> {
  return turf.lineString(points.map((p) => [p.longitude, p.latitude]));
}

function turfPoint(lon: number, lat: number): turf.helpers.Feature<turf.helpers.Point> {
  return turf.point([lon, lat]);
}

const polylineCache = new Map<string, { latitude: number; longitude: number }[]>();

/** Oblicza azymut (bearing) z punktu 1 do punktu 2 w stopniach 0..360 */
export function bearingBetween(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng  = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) -
            Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360;
}

/** Segment polyline może wskazywać przód lub tył — wybierz zgodny z kierunkiem jazdy. */
export function alignBearingToReference(
  segmentBearing: number,
  referenceBearing: number,
): number {
  const reversed = (segmentBearing + 180) % 360;
  const fwdDiff  = Math.abs(((segmentBearing - referenceBearing + 540) % 360) - 180);
  const revDiff  = Math.abs(((reversed - referenceBearing + 540) % 360) - 180);
  return revDiff < fwdDiff ? reversed : segmentBearing;
}

/** Oblicza odległość między dwoma punktami (Haversine, km) */
export function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
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

/**
 * Twardy sufit (m) na skok markera między fixami GPS, gdy użytkownik nie jedzie
 * w trybie nawigacji ani driving mode — ogranicza „teleporty” z cache OS
 * (sieć/Wi‑Fi) po staniu w miejscu lub powrocie z tła.
 */
/** @param motionKmh — max(reported GPS, prędkość z delty pozycji); bez tego przy speed=0 sufit był ~14 km/h. */
export function maxIdleBrowsingJumpM(
  deltaMs: number,
  reportedSpeedKmh: number,
  accuracyM: number,
  motionKmh?: number,
): number {
  const effectiveKmh = Math.max(reportedSpeedKmh, motionKmh ?? 0);
  if (effectiveKmh >= 22) return 1e7;
  const dtS = Math.min(Math.max(deltaMs / 1000, 0.15), 180);
  const acc = Math.min(Math.max(accuracyM || 32, 8), 100);
  const v = Math.min(Math.max(effectiveKmh, 0), 150);
  const expected = (v / 3.6) * dtS;
  const sedentary = effectiveKmh < 6.5;
  if (sedentary) {
    // Stojąc w miejscu: małe skoki (sieć/Wi‑Fi) — sufit ~12 m zależny od accuracy.
    const accCap = Math.max(5, Math.min(acc * 0.4 + 4, 14));
    return Math.max(6, Math.min(12, expected * 1.0 + accCap + dtS * 0.6));
  }
  return Math.max(18, Math.min(60, expected * 1.7 + acc * 0.7 + 12 + dtS * 3));
}

/** Czyści HTML z instrukcji Google */
export function cleanInstruction(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\/b>/g, ' ')
    .replace(/<\/u>/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s\s+/g, ' ')
    .trim();
}

function normalizeForSpeech(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\bul\.\s*/gi, 'ulica ')
    .replace(/\bal\.\s*/gi, 'aleja ')
    .replace(/\bpl\.\s*/gi, 'plac ')
    .replace(/\bdr\.\s*/gi, 'droga ')
    .replace(/\bim\.\s*/gi, 'imienia ')
    .replace(/\bna\s+skrzyżowaniu\s+o\s+ruchu\s+okrężnym\b/gi, 'na rondzie')
    .replace(/\brondo im\./gi, 'rondo imienia')
    .replace(/\s+,/g, ',')
    .trim();
}

function extractRoundaboutExit(text: string): number | null {
  const patterns = [
    /(\d+)\.?\s*zjazd(?:em|u|)/i,
    /(\d+)\.?\s*wyjazd(?:em|u|)/i,
    /take the (\d+)(?:st|nd|rd|th) exit/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const exitNo = Number(match[1]);
    if (Number.isFinite(exitNo) && exitNo > 0) return exitNo;
  }
  return null;
}

function formatDistanceForSpeech(distanceM: number): string {
  if (distanceM < 35) return 'teraz';
  if (distanceM < 1000) {
    const rounded = distanceM >= 150
      ? Math.round(distanceM / 50) * 50
      : Math.round(distanceM / 10) * 10;
    const meters = Math.max(50, Math.min(950, rounded));
    return `za ${meters} metrów`;
  }
  const km = Math.round((distanceM / 1000) * 10) / 10;
  const kmTxt = Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ',');
  const unit = km === 1 ? 'kilometr' : (Number.isInteger(km) ? 'kilometry' : 'kilometra');
  return `za ${kmTxt} ${unit}`;
}

export type NavigationSpeechPhase = 'far1000' | 'far400' | 'far150' | 'far50' | 'now';

function isMinorManeuver(maneuver?: string, instruction = ''): boolean {
  const m = (maneuver ?? '').toLowerCase();
  if (!m || m === 'straight' || m === 'continue' || m === 'merge') return true;
  if (
    m === 'continue-straight'
    || m === 'depart'
    || m.includes('new-name')
    || m.includes('new name')
    || m.includes('end-of-road')
    || m.includes('end of road')
    || m.includes('notification')
  ) return true;
  const text = instruction.toLowerCase();
  if (/\bjedź prosto\b/.test(text) || /\bkontynuuj\b/.test(text)) return true;
  if (/\bruszaj\b/.test(text) || /\bhead\b/.test(text)) return true;
  return false;
}

/** Whether TTS should fire for this step (skip depart/continue/new-name). */
export function shouldSpeakForStep(step: Step, distanceM?: number): boolean {
  const instruction = cleanInstruction(step.html_instructions);
  if (isMinorManeuver(step.maneuver, instruction)) return false;
  const m = (step.maneuver ?? '').toLowerCase();
  if (m === 'depart' || m.includes('depart')) return false;
  if (m === 'arrive' || m.includes('arrive')) {
    return distanceM == null || distanceM <= 120;
  }
  return true;
}

function extractStreetName(instruction: string): string | null {
  const patterns = [
    /\bna\s+(?:ul\.?\s*|ulicę\s+|ulicy\s+)([^,]+)/i,
    /\bna\s+(?:aleję\s+|alei\s+|aleja\s+)([^,]+)/i,
    /\bna\s+(?:droga\s+|drogę\s+)([^,]+)/i,
    /\bonto\s+([^,]+)/i,
    /\bw\s+([^,]+)/i,
  ];
  for (const pattern of patterns) {
    const match = instruction.match(pattern);
    if (!match?.[1]) continue;
    const street = match[1].trim().replace(/\s+/g, ' ');
    if (street.length >= 2) return street;
  }
  return null;
}

function maneuverPhrase(step: Step): string | null {
  const m = (step.maneuver ?? '').toLowerCase();
  const mod = (step.maneuverModifier ?? '').toLowerCase().replace(/\s+/g, '-');
  const combined = mod && !m.includes(mod) ? `${m}-${mod}` : m;

  if (combined.includes('uturn')) return 'zawróć';
  if (combined.includes('roundabout')) {
    if (step.maneuverExit != null && step.maneuverExit > 0) {
      return `na rondzie zjedź ${exitOrdinalWord(step.maneuverExit)} zjazdem`;
    }
    const exitFromText = extractRoundaboutExit(cleanInstruction(step.html_instructions));
    if (exitFromText != null) {
      return `na rondzie zjedź ${exitOrdinalWord(exitFromText)} zjazdem`;
    }
    return 'na rondzie zjedź odpowiednim zjazdem';
  }
  if (combined.includes('sharp-left') || mod === 'sharp-left') return 'ostro w lewo';
  if (combined.includes('sharp-right') || mod === 'sharp-right') return 'ostro w prawo';
  if (combined.includes('slight-left') || mod === 'slight-left' || combined.includes('fork-left') || combined.includes('ramp-left')) {
    return 'łagodnie w lewo';
  }
  if (combined.includes('slight-right') || mod === 'slight-right' || combined.includes('fork-right') || combined.includes('ramp-right')) {
    return 'łagodnie w prawo';
  }
  if (combined.includes('keep-left') || mod === 'keep-left') return 'trzymaj się lewego pasa';
  if (combined.includes('keep-right') || mod === 'keep-right') return 'trzymaj się prawego pasa';
  if (combined.includes('merge')) return 'włącz się do ruchu';
  if (combined.includes('left') || mod === 'left') return 'w lewo';
  if (combined.includes('right') || mod === 'right') return 'w prawo';
  return null;
}

/** Polska instrukcja manewru do wyświetlenia w UI (bez dystansu). */
export function formatNavigationInstruction(step: Step): string {
  const rawInstruction = cleanInstruction(step.html_instructions);
  const maneuverKey = (step.maneuver ?? '').toLowerCase();

  if (isMinorManeuver(maneuverKey, rawInstruction)) {
    const street = step.streetName?.trim()
      || extractStreetName(rawInstruction);
    if (street) return `Kontynuuj na ${street}`;
    return 'Kontynuuj prosto';
  }

  const isRoundabout =
    maneuverKey.includes('roundabout')
    || /\brondo\b/i.test(rawInstruction)
    || /\brondzie\b/i.test(rawInstruction);

  if (isRoundabout) {
    const exitNo = step.maneuverExit
      ?? extractRoundaboutExit(rawInstruction);
    if (exitNo != null) {
      return `Na rondzie zjedź ${exitOrdinalWord(exitNo)} zjazdem`;
    }
    return 'Na rondzie zjedź odpowiednim zjazdem';
  }

  const turn = maneuverPhrase(step);
  const street = step.streetName?.trim()
    || extractStreetName(rawInstruction);

  if (turn && street) return `Skręć ${turn} w ulicę ${street}`;
  if (turn) return `Skręć ${turn}`;

  const fallback = humanizeInstruction(normalizeForSpeech(rawInstruction));
  if (fallback) return fallback.charAt(0).toUpperCase() + fallback.slice(1);
  return 'Kontynuuj prosto';
}

/** Pełny baner nawigacji: dystans + instrukcja po polsku. */
export function formatNavigationBanner(step: Step, distanceM: number | null): string {
  const instruction = formatNavigationInstruction(step);
  if (distanceM == null || distanceM <= 40) {
    return `Teraz ${lowerFirst(instruction)}`;
  }

  const distText = distanceM < 1000
    ? `Za ${Math.round(distanceM / 10) * 10} m`
    : `Za ${(distanceM / 1000).toFixed(1)} km`;
  return `${distText} ${lowerFirst(instruction)}`;
}

/**
 * Wybiera krok do zapowiedzi: jeśli bieżący to „jedź prosto”, a blisko końca —
 * zapowiedz następny manewr (żeby nie mówić złej nazwy ulicy).
 */
export function resolveAnnouncementTarget(
  steps: Step[],
  activeStep: number,
  userArcM: number,
  userLat: number,
  userLng: number,
  stepArcIndex: StepArcIndex[],
  routePoints: LatLngPoint[] = [],
  forwardPrefix?: number[],
): { step: Step; stepIndex: number; distanceM: number } {
  if (!steps.length || !stepArcIndex.length) {
    const idx = Math.min(Math.max(activeStep, 0), steps.length - 1);
    return { step: steps[idx], stepIndex: idx, distanceM: Number.POSITIVE_INFINITY };
  }

  const geoStep = findStepIndexForArcM(userArcM, stepArcIndex);
  const idx = Math.min(geoStep, steps.length - 1);
  let step = steps[idx];
  const arc = stepArcIndex[idx];
  const baseInstruction = cleanInstruction(step.html_instructions);
  const isMinor = isMinorManeuver(step.maneuver, baseInstruction);
  const maneuverArcM = isMinor ? arc.endArcM : arc.startArcM;
  let distToManeuverM = distanceToManeuverHybrid(
    userLat,
    userLng,
    userArcM,
    maneuverArcM,
    isMinor ? undefined : step,
  );

  if (
    isMinor
    && idx < steps.length - 1
    && distToManeuverM <= 180
  ) {
    const upcoming = steps[idx + 1];
    const upcomingText = cleanInstruction(upcoming.html_instructions);
    const upcomingManeuver = (upcoming.maneuver ?? '').toLowerCase();
    const isArrive = upcomingManeuver === 'arrive' || upcomingManeuver.includes('arrive');
    if (!isMinorManeuver(upcoming.maneuver, upcomingText) && !isArrive) {
      const upcomingArc = stepArcIndex[idx + 1];
      const distM = distanceToManeuverHybrid(
        userLat,
        userLng,
        userArcM,
        upcomingArc.startArcM,
        upcoming,
      );
      if (distM <= 500 && distM > 15) {
        step = routePoints.length >= 2
          ? applyGeometryTurnToStep(upcoming, routePoints, upcomingArc, forwardPrefix)
          : upcoming;
        return { step, stepIndex: idx + 1, distanceM: distM };
      }
    }
  }

  if (routePoints.length >= 2 && !isMinor) {
    step = applyGeometryTurnToStep(step, routePoints, arc, forwardPrefix);
  }

  return { step, stepIndex: idx, distanceM: distToManeuverM };
}

/** Faza zapowiedzi — 3 progi, mniej gadania. */
export function getNavigationSpeechPhase(
  distanceM: number,
  previousDistanceM?: number,
): NavigationSpeechPhase | null {
  if (previousDistanceM != null && Number.isFinite(previousDistanceM)) {
    const thresholds: [number, NavigationSpeechPhase][] = [
      [40, 'now'],
      [150, 'far150'],
      [400, 'far400'],
    ];
    for (const [threshold, phase] of thresholds) {
      if (previousDistanceM > threshold && distanceM <= threshold) return phase;
    }
    return null;
  }
  if (distanceM <= 40) return 'now';
  if (distanceM > 120 && distanceM <= 180) return 'far150';
  if (distanceM > 350 && distanceM <= 450) return 'far400';
  return null;
}

function exitOrdinalWord(exitNo: number): string {
  switch (exitNo) {
    case 1: return 'pierwszym';
    case 2: return 'drugim';
    case 3: return 'trzecim';
    case 4: return 'czwartym';
    case 5: return 'piątym';
    case 6: return 'szóstym';
    case 7: return 'siódmym';
    case 8: return 'ósmym';
    case 9: return 'dziewiątym';
    case 10: return 'dziesiątym';
    default: return `${exitNo}.`;
  }
}

function lowerFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const PL_FALLBACK_DICTIONARY: Record<string, string> = {
  depart: 'Ruszaj',
  'turn straight': 'Jedź prosto',
  'continue straight': 'Kontynuuj prosto',
  merge: 'Włącz się do ruchu',
  'head north': 'Jedź na północ',
  'head south': 'Jedź na południe',
  'head east': 'Jedź na wschód',
  'head west': 'Jedź na zachód',
  'turn left': 'Skręć w lewo',
  'turn right': 'Skręć w prawo',
  'slight left': 'Skręć lekko w lewo',
  'slight right': 'Skręć lekko w prawo',
  'sharp left': 'Skręć ostro w lewo',
  'sharp right': 'Skręć ostro w prawo',
  'u-turn': 'Zawróć',
  uturn: 'Zawróć',
  'keep left': 'Trzymaj się lewej',
  'keep right': 'Trzymaj się prawej',
  'take the ramp': 'Wjedź na rampę',
  'take the exit': 'Zjedź zjazdem',
  arrive: 'Dotrzyj do celu',
  'you have arrived': 'Dotarłeś do celu',
  roundabout: 'rondo',
  'enter the roundabout': 'Wjedź na rondo',
  'exit the roundabout': 'Zjedź z ronda',
  fork: 'na rozwidleniu',
  ramp: 'wjazd',
  ferry: 'prom',
  destination: 'cel',
};

function humanizeInstruction(text: string): string {
  if (!text) return '';
  let out = text;
  const entries = Object.entries(PL_FALLBACK_DICTIONARY)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [en, pl] of entries) {
    const pattern = new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(pattern, pl);
  }
  return out
    .replace(/\bjedź prosto\b/i, 'kontynuuj prosto')
    .replace(/\bkieruj się\b/i, 'jedź')
    .replace(/\bna skrzyżowaniu\b/i, 'na najbliższym skrzyżowaniu')
    .trim();
}

function speechDistancePrefix(distanceM: number, phase: NavigationSpeechPhase): string {
  if (phase === 'now') return 'teraz';
  if (phase === 'far1000') return 'Za kilometr';
  if (phase === 'far400') return 'Za 400 metrów';
  if (phase === 'far150') return 'Za 150 metrów';
  if (phase === 'far50') return 'Za 50 metrów';
  if (distanceM > 50) {
    const rounded = Math.max(50, Math.round(distanceM / 50) * 50);
    return `Za ${rounded} metrów`;
  }
  return 'za chwilę';
}

export function buildNavigationSpeech(
  step: Step,
  distanceM: number,
  phase: NavigationSpeechPhase = 'far150',
): string {
  if (!shouldSpeakForStep(step, distanceM)) return '';

  const rawInstruction = cleanInstruction(step.html_instructions);
  const baseInstruction = humanizeInstruction(normalizeForSpeech(rawInstruction));
  const maneuver = (step.maneuver ?? '').toLowerCase();
  const isRoundabout =
    maneuver.includes('roundabout')
    || /\brondo\b/i.test(baseInstruction)
    || /\brondzie\b/i.test(baseInstruction);

  if (isRoundabout) {
    const exitNo = step.maneuverExit ?? extractRoundaboutExit(baseInstruction);
    const roundaboutInstruction = exitNo != null
      ? `na rondzie zjedź ${exitOrdinalWord(exitNo)} zjazdem`
      : 'na rondzie zjedź odpowiednim zjazdem';
    if (phase === 'now') return `Teraz ${roundaboutInstruction}`;
    const distPrefix = speechDistancePrefix(distanceM, phase);
    return `${distPrefix}, ${roundaboutInstruction}`;
  }

  const turn = maneuverPhrase(step);
  const street = step.streetName?.trim() || extractStreetName(rawInstruction);

  if (phase === 'now') {
    if (turn && street) return `Teraz skręć ${turn} na ${street}`;
    if (turn) return `Teraz skręć ${turn}`;
    if (maneuver.includes('arrive')) return 'Teraz dotrzyj do celu';
    return '';
  }

  const distPrefix = speechDistancePrefix(distanceM, phase);

  if (turn) {
    if (street) return `${distPrefix}, skręć ${turn} na ${street}`;
    return `${distPrefix}, skręć ${turn}`;
  }
  if (maneuver.includes('arrive')) return `${distPrefix}, dotrzyj do celu`;
  return '';
}

/** Formatuje minuty → "X min" lub "Xh Ymin" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

/** Formatuje prędkość m/s → "X km/h" */
export function formatSpeed(ms: number | null): string {
  if (ms == null || ms < 0) return '00';
  const kmh = Math.max(0, Math.round(ms * 3.6));
  return kmh < 10 ? `0${kmh}` : String(kmh);
}

/**
 * Geoprzestrzenna odległość punktu od odcinka (Haversine via Turf).
 * Używana przez snap-to-road, isOnRoute i driveCore/geo.
 */
export function distanceToSegmentMeters(
  userLat: number,
  userLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  return nearestPointOnSegmentMeters(userLat, userLon, aLat, aLon, bLat, bLon).distM;
}

/** Najbliższy punkt na odcinku + dystans cross-track (metry). (Brak Turf) */
export function nearestPointOnSegmentMeters(
  userLat: number,
  userLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): { latitude: number; longitude: number; distM: number } {
  if (
    !Number.isFinite(userLat) || !Number.isFinite(userLon)
    || !Number.isFinite(aLat) || !Number.isFinite(aLon)
    || !Number.isFinite(bLat) || !Number.isFinite(bLon)
  ) {
    return { latitude: userLat, longitude: userLon, distM: Number.POSITIVE_INFINITY };
  }

  const d2r = Math.PI / 180;
  // Flat earth approximation centered on the segment
  const midLat = (aLat + bLat) / 2;
  const cosLat = Math.cos(midLat * d2r);

  const dx = (bLon - aLon) * cosLat;
  const dy = (bLat - aLat);
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return { latitude: aLat, longitude: aLon, distM: haversineKm(userLat, userLon, aLat, aLon) * 1000 };
  }

  const px = (userLon - aLon) * cosLat;
  const py = (userLat - aLat);

  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));

  const projLat = aLat + t * dy;
  const projLon = aLon + t * (bLon - aLon);

  return {
    latitude: projLat,
    longitude: projLon,
    distM: haversineKm(userLat, userLon, projLat, projLon) * 1000,
  };
}

function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const cached = polylineCache.get(encoded);
  if (cached) return cached;
  const poly: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    poly.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  polylineCache.set(encoded, poly);
  return poly;
}

function distanceToStepMeters(userLat: number, userLon: number, step: Step): number {
  const encoded = step.polyline?.points;
  if (encoded) {
    const decoded = decodePolyline(encoded);
    if (decoded.length >= 2) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < decoded.length - 1; i++) {
        const d = distanceToSegmentMeters(
          userLat,
          userLon,
          decoded[i].latitude,
          decoded[i].longitude,
          decoded[i + 1].latitude,
          decoded[i + 1].longitude,
        );
        if (d < best) best = d;
      }
      if (Number.isFinite(best)) return best;
    }
  }
  return distanceToSegmentMeters(
    userLat,
    userLon,
    step.start_location.lat,
    step.start_location.lng,
    step.end_location.lat,
    step.end_location.lng,
  );
}

/**
 * Snap-to-road: przyciąga pozycję użytkownika do najbliższego odcinka trasy.
 * Eliminuje "jazdę po polu" bez potrzeby Roads API.
 */
/**
 * Snap-to-route via turf.nearestPointOnLine — marker na polilinii, nie na surowym GPS.
 */
export function snapToRoute(
  userLat: number,
  userLon: number,
  points: { latitude: number; longitude: number }[],
  maxSnapMeters = 35,
  hintIndex?: number,
): { latitude: number; longitude: number } {
  if (points.length < 2) return { latitude: userLat, longitude: userLon };
  if (!Number.isFinite(userLat) || !Number.isFinite(userLon)) {
    return { latitude: userLat, longitude: userLon };
  }

  let bestDist = Infinity;
  let bestLat = userLat;
  let bestLng = userLon;

  const hint = hintIndex != null && hintIndex >= 0 ? hintIndex : 0;
  const windowSeg = 150; 
  const startSeg = hintIndex != null ? Math.max(0, Math.min(hint - 30, points.length - 2)) : 0;
  const endSeg = hintIndex != null ? Math.min(points.length - 2, hint + windowSeg) : Math.min(points.length - 2, 400);

  for (let i = startSeg; i <= endSeg; i++) {
    const a = points[i];
    const b = points[i + 1];
    const nearest = nearestPointOnSegmentMeters(
      userLat, userLon,
      a.latitude, a.longitude,
      b.latitude, b.longitude
    );
    if (nearest.distM < bestDist) {
      bestDist = nearest.distM;
      bestLat = nearest.latitude;
      bestLng = nearest.longitude;
    }
  }

  if (bestDist > maxSnapMeters) {
    return { latitude: userLat, longitude: userLon };
  }
  return { latitude: bestLat, longitude: bestLng };
}

export type PolylineProjection = {
  latitude: number;
  longitude: number;
  segmentIndex: number;
  distM: number;
};

export type RouteWindowProjection = PolylineProjection & {
  segmentProgress: number;
};

/**
 * Projection constrained around the last route segment. It is cheap enough for
 * live navigation and cannot jump to a distant, parallel part of the route.
 */
export function projectPointToRouteWindow(
  userLat: number,
  userLng: number,
  pts: { latitude: number; longitude: number }[],
  hintIndex = -1,
  maxRadiusM = 120,
): RouteWindowProjection | null {
  if (pts.length < 2 || !Number.isFinite(userLat) || !Number.isFinite(userLng)) return null;

  const hasHint = hintIndex >= 0 && hintIndex < pts.length - 1;
  const start = hasHint ? Math.max(0, hintIndex - 20) : 0;
  const end = hasHint
    ? Math.min(pts.length - 2, hintIndex + 180)
    : Math.min(pts.length - 2, 400);
  let best: RouteWindowProjection | null = null;

  for (let i = start; i <= end; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const nearest = nearestPointOnSegmentMeters(
      userLat,
      userLng,
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude,
    );
    if (best && nearest.distM >= best.distM) continue;
    const segmentM = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
    const toProjectionM = haversineKm(
      a.latitude,
      a.longitude,
      nearest.latitude,
      nearest.longitude,
    ) * 1000;
    best = {
      latitude: nearest.latitude,
      longitude: nearest.longitude,
      segmentIndex: i,
      segmentProgress: segmentM > 0.01 ? Math.max(0, Math.min(1, toProjectionM / segmentM)) : 0,
      distM: nearest.distM,
    };
  }

  return best && best.distM <= maxRadiusM ? best : null;
}

/** Remaining distance along the step geometry, not a straight-line shortcut. */
function distanceToStepEndMeters(userLat: number, userLon: number, step: Step): number {
  const encoded = step.polyline?.points;
  if (!encoded) {
    return haversineKm(userLat, userLon, step.end_location.lat, step.end_location.lng) * 1000;
  }
  const decoded = decodePolyline(encoded);
  if (decoded.length < 2) {
    return haversineKm(userLat, userLon, step.end_location.lat, step.end_location.lng) * 1000;
  }

  let bestIndex = 0;
  let bestProjection = nearestPointOnSegmentMeters(
    userLat,
    userLon,
    decoded[0].latitude,
    decoded[0].longitude,
    decoded[1].latitude,
    decoded[1].longitude,
  );
  for (let i = 1; i < decoded.length - 1; i += 1) {
    const candidate = nearestPointOnSegmentMeters(
      userLat,
      userLon,
      decoded[i].latitude,
      decoded[i].longitude,
      decoded[i + 1].latitude,
      decoded[i + 1].longitude,
    );
    if (candidate.distM < bestProjection.distM) {
      bestProjection = candidate;
      bestIndex = i;
    }
  }

  let remainingM = 0;
  remainingM += haversineKm(
    bestProjection.latitude,
    bestProjection.longitude,
    decoded[bestIndex + 1].latitude,
    decoded[bestIndex + 1].longitude,
  ) * 1000;
  for (let i = bestIndex + 1; i < decoded.length - 1; i += 1) {
    remainingM += haversineKm(
      decoded[i].latitude,
      decoded[i].longitude,
      decoded[i + 1].latitude,
      decoded[i + 1].longitude,
    ) * 1000;
  }
  return remainingM;
}

/** Rzut punktu na polilinię z indeksem segmentu (do arc-length / sub-kotwic). */
export function projectOntoPolylineWithIndex(
  userLat: number,
  userLng: number,
  pts: { latitude: number; longitude: number }[],
  maxRadiusM = 120,
): PolylineProjection | null {
  if (pts.length < 2) return null;
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) return null;

  let bestDist = Infinity;
  let bestLat = userLat;
  let bestLng = userLng;
  let bestIdx = 0;

  // Reduced max iteration cap to prevent freezes on large polylines during project
  const maxSegments = Math.min(pts.length - 1, 400);

  for (let i = 0; i < maxSegments; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const nearest = nearestPointOnSegmentMeters(
      userLat, userLng,
      a.latitude, a.longitude,
      b.latitude, b.longitude
    );
    if (nearest.distM < bestDist) {
      bestDist = nearest.distM;
      bestLat = nearest.latitude;
      bestLng = nearest.longitude;
      bestIdx = i;
    }
  }

  if (bestDist > maxRadiusM) return null;

  return {
    latitude: bestLat,
    longitude: bestLng,
    segmentIndex: bestIdx,
    distM: bestDist,
  };
}

/**
 * Gęstsza polilinia — eliminuje „chord defect” przy 2 punktach API (marker tnąc po skosie).
 */
export function densifyPolyline(
  pts: { latitude: number; longitude: number }[],
  maxSegmentM = 8,
): { latitude: number; longitude: number }[] {
  if (!Array.isArray(pts) || pts.length < 2) return pts;
  const capM = Math.max(4, maxSegmentM);
  const out: { latitude: number; longitude: number }[] = [
    { latitude: pts[0].latitude, longitude: pts[0].longitude },
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segM = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
    if (segM > capM) {
      const steps = Math.min(48, Math.ceil(segM / capM));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push({
          latitude: a.latitude + (b.latitude - a.latitude) * t,
          longitude: a.longitude + (b.longitude - a.longitude) * t,
        });
      }
    }
    out.push({ latitude: b.latitude, longitude: b.longitude });
  }
  return out.length >= 2 ? out : pts;
}

function polylinePathLengthM(path: { latitude: number; longitude: number }[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += haversineKm(
      path[i].latitude,
      path[i].longitude,
      path[i + 1].latitude,
      path[i + 1].longitude,
    ) * 1000;
  }
  return total;
}

/** Punkt w odległości distanceM od początku ścieżki (łuk po wierzchołkach). */
export function getPointAtDistanceAlongPath(
  path: { latitude: number; longitude: number }[],
  distanceM: number,
): { latitude: number; longitude: number } {
  if (path.length === 0) return { latitude: 0, longitude: 0 };
  if (path.length === 1 || distanceM <= 0) {
    return { latitude: path[0].latitude, longitude: path[0].longitude };
  }
  let remaining = distanceM;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segM = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
    if (segM <= 0) continue;
    if (remaining <= segM) {
      const t = remaining / segM;
      return {
        latitude: a.latitude + (b.latitude - a.latitude) * t,
        longitude: a.longitude + (b.longitude - a.longitude) * t,
      };
    }
    remaining -= segM;
  }
  const last = path[path.length - 1];
  return { latitude: last.latitude, longitude: last.longitude };
}

/**
 * Sub-kotwice równomiernie wzdłuż łuku drogi między poprzednim a bieżącym snap (arc-length).
 */
export function generateSubAnchorsAlongPolyline(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
  polyline: { latitude: number; longitude: number }[],
  count: number,
): { latitude: number; longitude: number }[] {
  if (polyline.length < 2 || count < 1) return [];
  const startProj = projectOntoPolylineWithIndex(start.latitude, start.longitude, polyline, 150);
  const endProj = projectOntoPolylineWithIndex(end.latitude, end.longitude, polyline, 150);
  if (!startProj || !endProj) return [];

  let fromIdx = startProj.segmentIndex;
  let toIdx = endProj.segmentIndex;
  if (toIdx < fromIdx) {
    const swap = fromIdx;
    fromIdx = toIdx;
    toIdx = swap;
  }

  const path: { latitude: number; longitude: number }[] = [
    { latitude: startProj.latitude, longitude: startProj.longitude },
  ];
  for (let i = fromIdx + 1; i <= toIdx; i++) {
    path.push({ latitude: polyline[i].latitude, longitude: polyline[i].longitude });
  }
  const last = { latitude: endProj.latitude, longitude: endProj.longitude };
  const lastInPath = path[path.length - 1];
  if (
    haversineKm(lastInPath.latitude, lastInPath.longitude, last.latitude, last.longitude) * 1000 > 0.3
  ) {
    path.push(last);
  }

  const totalM = polylinePathLengthM(path);
  if (totalM < 1.5) return [last];

  const anchors: { latitude: number; longitude: number }[] = [];
  for (let step = 1; step <= count; step++) {
    const targetDist = (totalM / (count + 1)) * step;
    anchors.push(getPointAtDistanceAlongPath(path, targetDist));
  }
  anchors.push(last);
  return anchors;
}

/**
 * Krok w stronę celu wzdłuż polilinii drogi (nie po skosie mapy).
 * Używane przy zakrętach zamiast clampCoordStep.
 */
export function stepTowardSnapOnPolyline(
  fromLat: number,
  fromLng: number,
  targetLat: number,
  targetLng: number,
  points: { latitude: number; longitude: number }[],
  maxStepM: number,
  maxSnapMeters = 85,
): { latitude: number; longitude: number } {
  if (
    points.length < 2
    || !Number.isFinite(maxStepM)
    || maxStepM <= 0
  ) {
    const distM = haversineKm(fromLat, fromLng, targetLat, targetLng) * 1000;
    if (!Number.isFinite(distM) || distM <= maxStepM) {
      return { latitude: targetLat, longitude: targetLng };
    }
    const t = maxStepM / distM;
    return {
      latitude: fromLat + (targetLat - fromLat) * t,
      longitude: fromLng + (targetLng - fromLng) * t,
    };
  }

  const fromProj = projectOntoPolylineWithIndex(fromLat, fromLng, points, maxSnapMeters);
  const targetProj = projectOntoPolylineWithIndex(targetLat, targetLng, points, maxSnapMeters);
  if (!fromProj || !targetProj) {
    const onRoad = snapStepTowardRoad(fromLat, fromLng, points, maxSnapMeters, maxStepM);
    if (onRoad) return onRoad;
    const distM = haversineKm(fromLat, fromLng, targetLat, targetLng) * 1000;
    if (!Number.isFinite(distM) || distM <= maxStepM) {
      return { latitude: targetLat, longitude: targetLng };
    }
    const t = maxStepM / distM;
    return {
      latitude: fromLat + (targetLat - fromLat) * t,
      longitude: fromLng + (targetLng - fromLng) * t,
    };
  }

  let fromIdx = fromProj.segmentIndex;
  const toIdx = targetProj.segmentIndex;
  if (toIdx < fromIdx) {
    const onRoad = snapStepTowardRoad(fromLat, fromLng, points, maxSnapMeters, maxStepM);
    if (onRoad) return onRoad;
    const distM = haversineKm(fromLat, fromLng, targetLat, targetLng) * 1000;
    if (!Number.isFinite(distM) || distM <= maxStepM) {
      return { latitude: targetLat, longitude: targetLng };
    }
    const t = maxStepM / distM;
    return {
      latitude: fromLat + (targetLat - fromLat) * t,
      longitude: fromLng + (targetLng - fromLng) * t,
    };
  }

  const path: { latitude: number; longitude: number }[] = [
    { latitude: fromProj.latitude, longitude: fromProj.longitude },
  ];
  for (let i = fromIdx + 1; i <= toIdx; i++) {
    path.push({ latitude: points[i].latitude, longitude: points[i].longitude });
  }
  const endPt = { latitude: targetProj.latitude, longitude: targetProj.longitude };
  const pathEnd = path[path.length - 1];
  if (
    haversineKm(pathEnd.latitude, pathEnd.longitude, endPt.latitude, endPt.longitude) * 1000 > 0.3
  ) {
    path.push(endPt);
  }

  const pathLenM = polylinePathLengthM(path);
  if (pathLenM <= maxStepM) {
    return endPt;
  }
  return getPointAtDistanceAlongPath(path, maxStepM);
}

/** Krokowe dociąganie pozycji do drogi — bez gwałtownego skoku (frame-level snap). */
export function snapStepTowardRoad(
  lat: number,
  lng: number,
  points: { latitude: number; longitude: number }[],
  maxSnapMeters: number,
  maxStepM: number,
): { latitude: number; longitude: number } | null {
  if (points.length < 2 || !Number.isFinite(maxStepM) || maxStepM <= 0) return null;
  const snapped = snapToRoute(lat, lng, points, maxSnapMeters);
  // Using haversineKm directly rather than point distance
  const moveM = haversineKm(lat, lng, snapped.latitude, snapped.longitude) * 1000;
  if (moveM < 0.3 || moveM > maxSnapMeters) return null;
  if (moveM <= maxStepM) return snapped;
  const t = maxStepM / moveM;
  return {
    latitude: lat + (snapped.latitude - lat) * t,
    longitude: lng + (snapped.longitude - lng) * t,
  };
}

/** Arc distance threshold before advancing to the next step. */
export const STEP_ADVANCE_THRESHOLD_M = 25;

export type StepArcIndex = {
  startArcM: number;
  endArcM: number;
  maneuverArcM: number;
};

/** Cumulative arc distance (m) at each route vertex from the start. */
export function buildRouteForwardArcPrefix(
  routePoints: LatLngPoint[],
): number[] {
  if (routePoints.length === 0) return [];
  const prefix = new Array<number>(routePoints.length).fill(0);
  for (let i = 1; i < routePoints.length; i += 1) {
    prefix[i] = prefix[i - 1] + haversineKm(
      routePoints[i - 1].latitude,
      routePoints[i - 1].longitude,
      routePoints[i].latitude,
      routePoints[i].longitude,
    ) * 1000;
  }
  return prefix;
}

export function distanceToManeuverArcM(userArcM: number, targetArcM: number): number {
  if (!Number.isFinite(userArcM) || !Number.isFinite(targetArcM)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, targetArcM - userArcM);
}

function arcMFromProjection(
  routePoints: LatLngPoint[],
  forwardPrefix: number[],
  projection: RouteWindowProjection,
): number {
  const idx = projection.segmentIndex;
  if (idx >= routePoints.length - 1) {
    return forwardPrefix[routePoints.length - 1] ?? 0;
  }
  const segM = haversineKm(
    routePoints[idx].latitude,
    routePoints[idx].longitude,
    routePoints[idx + 1].latitude,
    routePoints[idx + 1].longitude,
  ) * 1000;
  return forwardPrefix[idx] + projection.segmentProgress * segM;
}

/** Maps each OSRM step to arc bounds by walking merged step polylines on the route. */
export function buildStepArcIndex(
  routePoints: LatLngPoint[],
  steps: Step[],
): StepArcIndex[] {
  if (!steps.length) return [];

  const prefix = routePoints.length >= 2
    ? buildRouteForwardArcPrefix(routePoints)
    : [];
  let vertexIdx = 0;

  return steps.map((step, i) => {
    const encoded = step.polyline?.points ?? '';
    const decoded = encoded ? decodePolyline(encoded) : [];
    const segCount = decoded.length > 1 ? decoded.length - 1 : 0;
    const startArcM = prefix[Math.min(vertexIdx, Math.max(0, prefix.length - 1))] ?? 0;
    if (segCount > 0) {
      vertexIdx += segCount;
    } else {
      vertexIdx += 1;
    }
    const endIdx = Math.min(vertexIdx, Math.max(0, prefix.length - 1));
    let endArcM = prefix[endIdx] ?? startArcM;
    if (i === steps.length - 1 && prefix.length) {
      endArcM = prefix[prefix.length - 1];
    }
    if (endArcM < startArcM) endArcM = startArcM;
    return {
      startArcM,
      endArcM,
      maneuverArcM: startArcM,
    };
  });
}

function getPointAtArcM(
  routePoints: LatLngPoint[],
  prefix: number[],
  arcM: number,
): { lat: number; lng: number } {
  if (!routePoints.length) return { lat: 0, lng: 0 };
  if (arcM <= 0) {
    return { lat: routePoints[0].latitude, lng: routePoints[0].longitude };
  }
  const total = prefix[prefix.length - 1] ?? 0;
  if (arcM >= total) {
    const last = routePoints[routePoints.length - 1];
    return { lat: last.latitude, lng: last.longitude };
  }
  let i = 0;
  while (i < prefix.length - 2 && (prefix[i + 1] ?? 0) < arcM) i += 1;
  const segStart = prefix[i] ?? 0;
  const segEnd = prefix[i + 1] ?? segStart;
  const segM = segEnd - segStart;
  const t = segM > 0.01 ? Math.max(0, Math.min(1, (arcM - segStart) / segM)) : 0;
  const a = routePoints[i];
  const b = routePoints[Math.min(i + 1, routePoints.length - 1)];
  return {
    lat: a.latitude + (b.latitude - a.latitude) * t,
    lng: a.longitude + (b.longitude - a.longitude) * t,
  };
}

/** Turn direction from route geometry at a maneuver point. */
export function inferGeometryTurnModifier(
  routePoints: LatLngPoint[],
  maneuverArcM: number,
  forwardPrefix?: number[],
): 'left' | 'right' | 'straight' | null {
  if (routePoints.length < 2) return null;
  const prefix = forwardPrefix ?? buildRouteForwardArcPrefix(routePoints);
  const total = prefix[prefix.length - 1] ?? 0;
  if (total <= 0) return null;

  const beforeM = Math.max(0, maneuverArcM - 40);
  const afterM = Math.min(total, maneuverArcM + 40);
  const beforePt = getPointAtArcM(routePoints, prefix, beforeM);
  const atPt = getPointAtArcM(routePoints, prefix, maneuverArcM);
  const afterPt = getPointAtArcM(routePoints, prefix, afterM);

  const bearingBefore = bearingBetween(beforePt.lat, beforePt.lng, atPt.lat, atPt.lng);
  const bearingAfter = bearingBetween(atPt.lat, atPt.lng, afterPt.lat, afterPt.lng);
  let delta = bearingAfter - bearingBefore;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;

  if (Math.abs(delta) < 25) return 'straight';
  return delta > 0 ? 'right' : 'left';
}

/** Override OSRM left/right when it disagrees with the route polyline. */
export function applyGeometryTurnToStep(
  step: Step,
  routePoints: LatLngPoint[],
  stepArc: StepArcIndex,
  forwardPrefix?: number[],
): Step {
  const geomTurn = inferGeometryTurnModifier(routePoints, stepArc.startArcM, forwardPrefix);
  if (!geomTurn || geomTurn === 'straight') return step;

  const m = (step.maneuver ?? '').toLowerCase();
  const mod = (step.maneuverModifier ?? '').toLowerCase();
  const osrmLeft = m.includes('left') || mod.includes('left');
  const osrmRight = m.includes('right') || mod.includes('right');
  if (!osrmLeft && !osrmRight) return step;

  if ((geomTurn === 'left' && osrmRight) || (geomTurn === 'right' && osrmLeft)) {
    const newMod = geomTurn;
    let newManeuver = `turn-${newMod}`;
    if (m.includes('sharp')) newManeuver = `turn-sharp-${newMod}`;
    else if (m.includes('slight')) newManeuver = `turn-slight-${newMod}`;
    return {
      ...step,
      maneuver: newManeuver,
      maneuverModifier: newMod,
    };
  }
  return step;
}

/** Arc distance validated against geographic distance to the maneuver point. */
export function distanceToManeuverHybrid(
  userLat: number,
  userLng: number,
  userArcM: number,
  targetArcM: number,
  step?: Step,
): number {
  const arcDist = distanceToManeuverArcM(userArcM, targetArcM);
  if (!step) return arcDist;
  const geoDist = haversineKm(
    userLat,
    userLng,
    step.start_location.lat,
    step.start_location.lng,
  ) * 1000;
  if (geoDist > 80 && geoDist > arcDist + 60) return geoDist;
  return Math.max(arcDist, geoDist > 300 ? geoDist : arcDist);
}

/** One-shot step index for session restore (no +1 cap). */
export function findStepIndexForArcM(
  userArcM: number,
  stepArcIndex: StepArcIndex[],
): number {
  if (!stepArcIndex.length) return 0;
  for (let i = 0; i < stepArcIndex.length; i += 1) {
    if (userArcM < stepArcIndex[i].endArcM - STEP_ADVANCE_THRESHOLD_M) return i;
  }
  return stepArcIndex.length - 1;
}

export function computeUserArcM(
  routePoints: LatLngPoint[],
  projection: RouteWindowProjection,
  forwardPrefix?: number[],
): number {
  const prefix = forwardPrefix ?? buildRouteForwardArcPrefix(routePoints);
  return arcMFromProjection(routePoints, prefix, projection);
}

/**
 * Step index from arc position on the route polyline.
 */
export function detectCurrentStep(
  userArcM: number,
  steps: Step[],
  _currentStep: number,
  stepArcIndex: StepArcIndex[],
): number {
  if (!steps.length) return 0;
  if (!stepArcIndex.length) return 0;
  return findStepIndexForArcM(userArcM, stepArcIndex);
}

/**
 * Zwraca indeks punktu na trasie najbliższego do pozycji użytkownika.
 * Ulepszona — bierze pod uwagę odcinki, nie tylko punkty.
 */
export function findClosestPointIndex(
  userLat: number,
  userLng: number,
  points: { latitude: number; longitude: number }[],
  hintIndex?: number,
): number {
  if (points.length < 2) return 0;
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) return 0;

  let bestDist = Infinity;
  let bestIdx = 0;

  const hint = hintIndex != null && hintIndex >= 0 ? hintIndex : 0;
  const windowSeg = 150; 
  const startSeg = hintIndex != null ? Math.max(0, Math.min(hint - 30, points.length - 2)) : 0;
  const endSeg = hintIndex != null ? Math.min(points.length - 2, hint + windowSeg) : Math.min(points.length - 2, 400);

  for (let i = startSeg; i <= endSeg; i++) {
    const a = points[i];
    const b = points[i + 1];
    const d = distanceToSegmentMeters(
      userLat, userLng,
      a.latitude, a.longitude,
      b.latitude, b.longitude
    );
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  return Math.max(0, bestIdx);
}

/**
 * Cross-track w oknie ±~1 km wokół hintIndex (O(window) zamiast O(n)).
 */
export function distanceToPolylineWindowM(
  userLat: number,
  userLon: number,
  routePoints: { latitude: number; longitude: number }[],
  hintIndex?: number,
): number {
  if (routePoints.length < 2) return 0;
  if (!Number.isFinite(userLat) || !Number.isFinite(userLon)) return 0;

  const hint = hintIndex != null && hintIndex >= 0 ? hintIndex : 0;
  const windowSeg = 150; // Increased window from 120 to 150
  const startSeg = Math.max(0, Math.min(hint - 30, routePoints.length - 2)); // look backwards less
  const endSeg = Math.min(routePoints.length - 2, hint + windowSeg);

  let best = Number.POSITIVE_INFINITY;
  for (let i = startSeg; i <= endSeg; i += 1) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const d = distanceToSegmentMeters(
      userLat,
      userLon,
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude,
    );
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : Number.POSITIVE_INFINITY;
}

/**
 * Off-route detection — geoprzestrzenna odległość od polilinii (Turf Haversine).
 * Skanuje okno wokół ostatniego indeksu; pełna polilinia tylko jako fallback.
 */
export function isOnRoute(
  userLat: number,
  userLon: number,
  routePoints: { latitude: number; longitude: number }[],
  thresholdMeters = 35,
  hintIndex?: number,
): boolean {
  if (routePoints.length < 2) return true;
  if (!Number.isFinite(userLat) || !Number.isFinite(userLon)) return true;

  const windowDistM = distanceToPolylineWindowM(
    userLat,
    userLon,
    routePoints,
    hintIndex,
  );
  if (Number.isFinite(windowDistM) && windowDistM <= thresholdMeters) {
    return true;
  }

  // Instead of scanning the entire polyline, scan up to ~300 segments ahead
  // If we don't find it within 300 segments, the user is almost certainly off-route.
  const lookaheadDistM = distanceToPolylineWindowM(
    userLat,
    userLon,
    routePoints,
    hintIndex != null ? hintIndex + 150 : 150
  );

  return Number.isFinite(lookaheadDistM) && lookaheadDistM <= thresholdMeters;
}

/** Dystans cross-track od polilinii (m) — do diagnostyki reroute. */
export function distanceToPolylineMeters(
  userLat: number,
  userLon: number,
  routePoints: { latitude: number; longitude: number }[],
  hintIndex?: number,
): number {
  if (routePoints.length < 2) return 0;
  
  if (hintIndex != null) {
    const wDist = distanceToPolylineWindowM(userLat, userLon, routePoints, hintIndex);
    if (wDist < 100) return wDist;
    const fwDist = distanceToPolylineWindowM(userLat, userLon, routePoints, hintIndex + 150);
    return Math.min(wDist, fwDist);
  }

  let bestDist = Infinity;
  // Fallback limits to 400 segments instead of full route to prevent extreme lag
  const maxSegments = Math.min(routePoints.length - 1, 400);
  for (let i = 0; i < maxSegments; i++) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const d = distanceToSegmentMeters(
      userLat, userLon,
      a.latitude, a.longitude,
      b.latitude, b.longitude
    );
    if (d < bestDist) {
      bestDist = d;
    }
  }
  return bestDist;
}

/**
 * Ikona manewru na podstawie pola `maneuver` z Google Directions
 */
export function getManeuverIcon(maneuver?: string): string {
  switch (maneuver) {
    case 'turn-left':        return 'turn-left';
    case 'turn-right':       return 'turn-right';
    case 'turn-slight-left': return 'turn-slight-left';
    case 'turn-slight-right':return 'turn-slight-right';
    case 'turn-sharp-left':  return 'turn-sharp-left';
    case 'turn-sharp-right': return 'turn-sharp-right';
    case 'uturn-left':       return 'u-turn-left';
    case 'uturn-right':      return 'u-turn-right';
    case 'roundabout-left':  return 'rotate-left';
    case 'roundabout-right': return 'rotate-right';
    case 'roundabout':       return 'rotate-right';
    case 'ramp-left':        return 'turn-left';
    case 'ramp-right':       return 'turn-right';
    case 'merge':            return 'merge';
    case 'fork-left':        return 'turn-left';
    case 'fork-right':       return 'turn-right';
    case 'ferry':            return 'directions-boat';
    case 'straight':         return 'straight';
    case 'continue-straight': return 'straight';
    case 'on-ramp-left':     return 'turn-left';
    case 'on-ramp-right':    return 'turn-right';
    case 'off-ramp-left':    return 'turn-left';
    case 'off-ramp-right':   return 'turn-right';
    default:                 return 'navigation';
  }
}
