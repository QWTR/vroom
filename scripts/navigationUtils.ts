import { Step } from '../hooks/useGoogleDirections';

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

export type NavigationSpeechPhase = 'far' | 'near' | 'now';

function isMinorManeuver(maneuver?: string, instruction = ''): boolean {
  const m = (maneuver ?? '').toLowerCase();
  if (!m || m === 'straight' || m === 'continue' || m === 'merge') return true;
  if (m.includes('new name') || m.includes('notification')) return true;
  const text = instruction.toLowerCase();
  if (/\bjedź prosto\b/.test(text) || /\bkontynuuj\b/.test(text)) return true;
  return false;
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
  if (m.includes('uturn')) return 'zawróć';
  if (m.includes('roundabout')) return 'na rondzie zjedź odpowiednim zjazdem';
  if (m.includes('sharp-left') || m === 'turn-sharp-left') return 'ostro w lewo';
  if (m.includes('sharp-right') || m === 'turn-sharp-right') return 'ostro w prawo';
  if (m.includes('slight-left') || m === 'fork-left' || m === 'ramp-left') return 'łagodnie w lewo';
  if (m.includes('slight-right') || m === 'fork-right' || m === 'ramp-right') return 'łagodnie w prawo';
  if (m.includes('left')) return 'w lewo';
  if (m.includes('right')) return 'w prawo';
  return null;
}

/**
 * Wybiera krok do zapowiedzi: jeśli bieżący to „jedź prosto”, a blisko końca —
 * zapowiedz następny manewr (żeby nie mówić złej nazwy ulicy).
 */
export function resolveAnnouncementTarget(
  steps: Step[],
  currentStep: number,
  userLat: number,
  userLon: number,
): { step: Step; stepIndex: number; distanceM: number } {
  const idx = Math.min(Math.max(currentStep, 0), steps.length - 1);
  const step = steps[idx];
  const distToEndM = haversineKm(
    userLat,
    userLon,
    step.end_location.lat,
    step.end_location.lng,
  ) * 1000;

  const baseInstruction = cleanInstruction(step.html_instructions);
  if (
    isMinorManeuver(step.maneuver, baseInstruction)
    && idx < steps.length - 1
    && distToEndM < 220
  ) {
    const upcoming = steps[idx + 1];
    const upcomingText = cleanInstruction(upcoming.html_instructions);
    if (!isMinorManeuver(upcoming.maneuver, upcomingText)) {
      return { step: upcoming, stepIndex: idx + 1, distanceM: distToEndM };
    }
  }

  return { step, stepIndex: idx, distanceM: distToEndM };
}

/** Faza zapowiedzi wg odległości do manewru (wąskie pasma — jedna zapowiedź na fazę). */
export function getNavigationSpeechPhase(distanceM: number): NavigationSpeechPhase | null {
  if (distanceM <= 40) return 'now';
  if (distanceM >= 88 && distanceM <= 112) return 'near';
  if (distanceM >= 235 && distanceM <= 265) return 'far';
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

function humanizeInstruction(text: string): string {
  return text
    .replace(/\bjedź prosto\b/i, 'kontynuuj prosto')
    .replace(/\bkieruj się\b/i, 'jedź')
    .replace(/\bna skrzyżowaniu\b/i, 'na najbliższym skrzyżowaniu')
    .trim();
}

export function buildNavigationSpeech(
  step: Step,
  distanceM: number,
  phase: NavigationSpeechPhase = 'near',
): string {
  const rawInstruction = cleanInstruction(step.html_instructions);
  const baseInstruction = humanizeInstruction(normalizeForSpeech(rawInstruction));
  const maneuver = (step.maneuver ?? '').toLowerCase();
  const isRoundabout =
    maneuver.includes('roundabout')
    || /\brondo\b/i.test(baseInstruction)
    || /\brondzie\b/i.test(baseInstruction);

  if (isRoundabout) {
    const exitNo = extractRoundaboutExit(baseInstruction);
    const roundaboutInstruction = exitNo != null
      ? `na rondzie zjedź ${exitOrdinalWord(exitNo)} zjazdem`
      : 'na rondzie zjedź odpowiednim zjazdem';
    if (phase === 'now') return `teraz ${roundaboutInstruction}`;
    const distPrefix = phase === 'near'
      ? 'za 100 metrów'
      : formatDistanceForSpeech(Math.max(distanceM, 250));
    return `${distPrefix}, ${roundaboutInstruction}`;
  }

  const turn = maneuverPhrase(step);
  const street = extractStreetName(rawInstruction);

  if (phase === 'now') {
    if (turn && street) return `teraz skręć ${turn} na ${street}`;
    if (turn) return `teraz skręć ${turn}`;
    return `teraz ${lowerFirst(baseInstruction)}`;
  }

  const distPrefix = phase === 'near'
    ? 'za 100 metrów'
    : formatDistanceForSpeech(Math.max(distanceM, 250));

  if (turn) {
    return `${distPrefix}, skręć ${turn}`;
  }
  return `${distPrefix}, ${lowerFirst(baseInstruction)}`;
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
 * Oblicza odległość punktu od odcinka (nie od punktu końcowego!).
 * To kluczowa funkcja dla snap-to-road i isOnRoute.
 */
export function distanceToSegmentMeters(
  userLat: number,
  userLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  // Konwertuj na pseudometryczne współrzędne (wystarczy dla małych dystansów)
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const ax = R * Math.cos(toRad(aLat)) * toRad(aLon);
  const ay = R * toRad(aLat);
  const bx = R * Math.cos(toRad(bLat)) * toRad(bLon);
  const by = R * toRad(bLat);
  const px = R * Math.cos(toRad(userLat)) * toRad(userLon);
  const py = R * toRad(userLat);

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }

  const nearestX = ax + t * dx;
  const nearestY = ay + t * dy;

  return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
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
export function snapToRoute(
  userLat: number,
  userLon: number,
  points: { latitude: number; longitude: number }[],
  maxSnapMeters = 35,
): { latitude: number; longitude: number } {
  if (points.length < 2) return { latitude: userLat, longitude: userLon };

  let minDist = Infinity;
  let bestLat = userLat;
  let bestLon = userLon;

  for (let i = 0; i < points.length - 1; i++) {
    const aLat = points[i].latitude;
    const aLon = points[i].longitude;
    const bLat = points[i + 1].latitude;
    const bLon = points[i + 1].longitude;

    const dist = distanceToSegmentMeters(userLat, userLon, aLat, aLon, bLat, bLon);

    if (dist < minDist) {
      minDist = dist;

      // Oblicz dokładny punkt na odcinku
      const R = 6371000;
      const toRad = (d: number) => (d * Math.PI) / 180;

      const ax = R * Math.cos(toRad(aLat)) * toRad(aLon);
      const ay = R * toRad(aLat);
      const bx = R * Math.cos(toRad(bLat)) * toRad(bLon);
      const by = R * toRad(bLat);
      const px = R * Math.cos(toRad(userLat)) * toRad(userLon);
      const py = R * toRad(userLat);

      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;

      let t = 0;
      if (lenSq > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }

      // Interpolacja współrzędnych geograficznych
      bestLat = aLat + t * (bLat - aLat);
      bestLon = aLon + t * (bLon - aLon);
    }
  }

  // Snap tylko jeśli jesteśmy wystarczająco blisko trasy
  if (minDist <= maxSnapMeters) {
    return { latitude: bestLat, longitude: bestLon };
  }

  // Za daleko od trasy — zwróć oryginalną pozycję (rerouting się zajmie)
  return { latitude: userLat, longitude: userLon };
}

/**
 * Sprawdza który krok jest aktualny.
 * Ulepszona wersja — sprawdza odległość od odcinków, nie tylko punktów.
 */
export function detectCurrentStep(
  userLat: number,
  userLon: number,
  steps: Step[],
  currentStep: number,
): number {
  if (!steps.length) return 0;
  if (currentStep >= steps.length) return steps.length - 1;

  // 1) Szybki awans po minięciu końca bieżącego kroku.
  let resolved = currentStep;
  while (resolved < steps.length - 1) {
    const endDistM = haversineKm(
      userLat,
      userLon,
      steps[resolved].end_location.lat,
      steps[resolved].end_location.lng,
    ) * 1000;
    if (endDistM > 45) break;
    resolved += 1;
  }

  // 2) Lookahead: wybierz najbliższy segment kroku w krótkim oknie do przodu.
  // Dzięki temu manewr nie "wisi" na poprzednim kroku po szybkich skrzyżowaniach.
  const LOOKAHEAD_STEPS = 10;
  let bestStep = resolved;
  let bestDist = Number.POSITIVE_INFINITY;

  const lastCandidate = Math.min(steps.length - 1, resolved + LOOKAHEAD_STEPS);
  for (let i = resolved; i <= lastCandidate; i++) {
    const step = steps[i];
    const distM = distanceToStepMeters(userLat, userLon, step);
    if (distM < bestDist) {
      bestDist = distM;
      bestStep = i;
    }
  }

  if (bestStep > resolved && bestDist <= 45) {
    return bestStep;
  }
  return resolved;
}

/**
 * Zwraca indeks punktu na trasie najbliższego do pozycji użytkownika.
 * Ulepszona — bierze pod uwagę odcinki, nie tylko punkty.
 */
export function findClosestPointIndex(
  userLat: number,
  userLng: number,
  points: { latitude: number; longitude: number }[],
): number {
  if (!points.length) return 0;

  let minDist = Infinity;
  let minIdx = 0;

  for (let i = 0; i < points.length; i++) {
    const d = haversineKm(userLat, userLng, points[i].latitude, points[i].longitude);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }

  // Cofnij się trochę żeby nie ucinać za agresywnie
  return Math.max(0, minIdx - 2);
}

/**
 * Sprawdza czy użytkownik jest na trasie.
 * ULEPSZONA — sprawdza odległość od ODCINKÓW (nie punktów).
 */
export function isOnRoute(
  userLat: number,
  userLon: number,
  routePoints: { latitude: number; longitude: number }[],
  thresholdMeters = 40,
): boolean {
  if (routePoints.length < 2) return true;

  for (let i = 0; i < routePoints.length - 1; i++) {
    const dist = distanceToSegmentMeters(
      userLat, userLon,
      routePoints[i].latitude,     routePoints[i].longitude,
      routePoints[i + 1].latitude, routePoints[i + 1].longitude,
    );
    if (dist <= thresholdMeters) return true;
  }
  return false;
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
    default:                 return 'navigation';
  }
}