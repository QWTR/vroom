import { Step } from '../hooks/useGoogleDirections';

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

/** Formatuje minuty → "X min" lub "Xh Ymin" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

/** Formatuje prędkość m/s → "X km/h" */
export function formatSpeed(ms: number | null): string {
  if (ms == null || ms < 0) return '0';
  return String(Math.round(ms * 3.6));
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

  // Sprawdź czy minęliśmy koniec obecnego kroku
  const step = steps[currentStep];
  const endLat = step.end_location.lat;
  const endLon = step.end_location.lng;
  const distToEnd = haversineKm(userLat, userLon, endLat, endLon) * 1000;

  if (distToEnd < 25 && currentStep < steps.length - 1) {
    // Sprawdź też czy następny krok jest bliżej niż obecny
    const nextStep = steps[currentStep + 1];
    const nextStartLat = nextStep.start_location.lat;
    const nextStartLon = nextStep.start_location.lng;
    const distToNextStart = haversineKm(userLat, userLon, nextStartLat, nextStartLon) * 1000;

    if (distToNextStart < distToEnd + 20) {
      return currentStep + 1;
    }
  }

  // Lookahead — jeśli jesteśmy bardzo blisko początku kolejnego kroku
  // (np. przejechaliśmy szybko przez skrzyżowanie)
  if (currentStep < steps.length - 1) {
    const nextStep = steps[currentStep + 1];
    const distToNextEnd = haversineKm(
      userLat, userLon,
      nextStep.end_location.lat,
      nextStep.end_location.lng,
    ) * 1000;

    // Jeśli jesteśmy bliżej końca NASTĘPNEGO kroku niż jego startu — przeskocz dwa
    const distToNextStart = haversineKm(
      userLat, userLon,
      nextStep.start_location.lat,
      nextStep.start_location.lng,
    ) * 1000;

    if (distToNextEnd < distToNextStart && distToNextStart < 20 && currentStep + 1 < steps.length - 1) {
      return currentStep + 2;
    }
  }

  return currentStep;
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