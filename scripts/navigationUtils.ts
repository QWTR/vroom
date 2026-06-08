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

export type NavigationSpeechPhase = 'far300' | 'far' | 'near' | 'now';

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
  if (distanceM >= 285 && distanceM <= 315) return 'far300';
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
    const exitNo = step.maneuverExit ?? extractRoundaboutExit(baseInstruction);
    const roundaboutInstruction = exitNo != null
      ? `na rondzie zjedź ${exitOrdinalWord(exitNo)} zjazdem`
      : 'na rondzie zjedź odpowiednim zjazdem';
    if (phase === 'now') return `teraz ${roundaboutInstruction}`;
    const distPrefix = phase === 'near'
      ? 'za 100 metrów'
      : phase === 'far300'
        ? 'za 300 metrów'
        : formatDistanceForSpeech(Math.max(distanceM, 250));
    return `${distPrefix}, ${roundaboutInstruction}`;
  }

  const turn = maneuverPhrase(step);
  const street = step.streetName?.trim() || extractStreetName(rawInstruction);

  if (phase === 'now') {
    if (turn && street) return `teraz skręć ${turn} na ${street}`;
    if (turn) return `teraz skręć ${turn}`;
    return `teraz ${lowerFirst(baseInstruction)}`;
  }

  const distPrefix = phase === 'near'
    ? 'za 100 metrów'
    : phase === 'far300'
      ? 'za 300 metrów'
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

export type PolylineProjection = {
  latitude: number;
  longitude: number;
  segmentIndex: number;
  distM: number;
};

/** Rzut punktu na polilinię z indeksem segmentu (do arc-length / sub-kotwic). */
export function projectOntoPolylineWithIndex(
  userLat: number,
  userLng: number,
  pts: { latitude: number; longitude: number }[],
  maxRadiusM = 120,
): PolylineProjection | null {
  if (pts.length < 2) return null;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let minDist = Infinity;
  let bestLat = userLat;
  let bestLng = userLng;
  let bestSegIdx = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const aLat = pts[i].latitude;
    const aLon = pts[i].longitude;
    const bLat = pts[i + 1].latitude;
    const bLon = pts[i + 1].longitude;
    const dist = distanceToSegmentMeters(userLat, userLng, aLat, aLon, bLat, bLon);
    if (dist >= minDist) continue;
    minDist = dist;
    bestSegIdx = i;
    const ax = R * Math.cos(toRad(aLat)) * toRad(aLon);
    const ay = R * toRad(aLat);
    const bx = R * Math.cos(toRad(bLat)) * toRad(bLon);
    const by = R * toRad(bLat);
    const px = R * Math.cos(toRad(userLat)) * toRad(userLng);
    const py = R * toRad(userLat);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    bestLat = aLat + t * (bLat - aLat);
    bestLng = aLon + t * (bLon - aLon);
  }
  if (!Number.isFinite(minDist) || minDist > maxRadiusM) return null;
  return {
    latitude: bestLat,
    longitude: bestLng,
    segmentIndex: bestSegIdx,
    distM: minDist,
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
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
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
  for (let i = 1; i < path.length; i++) {
    total += haversineKm(
      path[i - 1].latitude,
      path[i - 1].longitude,
      path[i].latitude,
      path[i].longitude,
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
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
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
  const moveM = haversineKm(lat, lng, snapped.latitude, snapped.longitude) * 1000;
  if (moveM < 0.3 || moveM > maxSnapMeters) return null;
  if (moveM <= maxStepM) return snapped;
  const t = maxStepM / moveM;
  return {
    latitude: lat + (snapped.latitude - lat) * t,
    longitude: lng + (snapped.longitude - lng) * t,
  };
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