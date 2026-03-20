import { Step } from '../hooks/useGoogleDirections';

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
 * Sprawdza który krok jest aktualny na podstawie pozycji użytkownika.
 * Zwraca indeks kroku lub null jeśli bez zmian.
 */
export function detectCurrentStep(
  userLat: number,
  userLon: number,
  steps: Step[],
  currentStep: number,
): number {
  // Sprawdź czy dotarliśmy do punktu końcowego obecnego kroku
  if (currentStep >= steps.length) return currentStep;

  const step = steps[currentStep];
  const endLat = step.end_location.lat;
  const endLon = step.end_location.lng;

  const distToEnd = haversineKm(userLat, userLon, endLat, endLon) * 1000; // metry

  // Jeśli jesteśmy w promieniu 30m od końca kroku → następny krok
  if (distToEnd < 30 && currentStep < steps.length - 1) {
    return currentStep + 1;
  }

  return currentStep;
}

/**
 * Zwraca indeks punktu na trasie najbliższego do pozycji użytkownika.
 * Używane do przycinania trasy — pokazujemy tylko "resztę do celu".
 */
export function findClosestPointIndex(
  userLat: number,
  userLng: number,
  points: { latitude: number; longitude: number }[],
): number {
  let minDist = Infinity;
  let minIdx  = 0;

  for (let i = 0; i < points.length; i++) {
    const d = haversineKm(userLat, userLng, points[i].latitude, points[i].longitude);
    if (d < minDist) {
      minDist = d;
      minIdx  = i;
    }
  }
  return minIdx;
}

/**
 * Sprawdza czy użytkownik jest na trasie (max 50m odchylenia).
 * Zwraca true jeśli na trasie.
 */
export function isOnRoute(
  userLat: number,
  userLon: number,
  routePoints: { latitude: number; longitude: number }[],
  thresholdMeters = 50,
): boolean {
  for (const point of routePoints) {
    const dist = haversineKm(userLat, userLon, point.latitude, point.longitude) * 1000;
    if (dist <= thresholdMeters) return true;
  }
  return false;
}

/**
 * Ikona manewru na podstawie pola `maneuver` z Google Directions
 */
export function getManeuverIcon(maneuver?: string): string {
  switch (maneuver) {
    case 'turn-left':              return 'turn-left';
    case 'turn-right':             return 'turn-right';
    case 'turn-slight-left':       return 'turn-slight-left';
    case 'turn-slight-right':      return 'turn-slight-right';
    case 'turn-sharp-left':        return 'turn-sharp-left';
    case 'turn-sharp-right':       return 'turn-sharp-right';
    case 'uturn-left':             return 'u-turn-left';
    case 'uturn-right':            return 'u-turn-right';
    case 'roundabout-left':        return 'rotate-left';
    case 'roundabout-right':       return 'rotate-right';
    case 'ramp-left':              return 'turn-left';
    case 'ramp-right':             return 'turn-right';
    case 'merge':                  return 'merge';
    case 'fork-left':              return 'turn-left';
    case 'fork-right':             return 'turn-right';
    case 'ferry':                  return 'directions-boat';
    case 'straight':               return 'straight';
    default:                       return 'navigation';
  }
}