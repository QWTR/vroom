import { buffer, featureCollection, lineString, point, union } from '@turf/turf';
import VroomOfflineNavigation, {
  type OfflineNavigationCapabilities,
  type OfflineNavigationDownload,
  type OfflineNavigationPack,
  type OfflineNavigationRoute,
  type OfflineNavigationRouteRequest,
} from '../modules/vroom-offline-navigation';

export const OFFLINE_NATIVE_BUILD_MESSAGE =
  'Prawdziwa nawigacja offline wymaga nowej wersji VROOM zainstalowanej ze sklepu. EAS Update nie może dodać Navigation SDK.';

export type OfflineRoutePoint = { latitude: number; longitude: number };

export function validOfflineRoutePoints(input: unknown): OfflineRoutePoint[] {
  if (!Array.isArray(input)) return [];
  return input.map((raw: any) => ({ latitude: Number(raw?.latitude), longitude: Number(raw?.longitude) }))
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && Math.abs(item.latitude) <= 90 && Math.abs(item.longitude) <= 180);
}

export function createOfflineCorridor(points: OfflineRoutePoint[], bufferKm: 5 | 10 | 20): { type: 'Polygon'; coordinates: number[][][] } {
  if (points.length < 2) throw new Error('Trasa nie zawiera poprawnego przebiegu.');
  const coordinates = points.map((item) => [item.longitude, item.latitude]);
  const routeArea = buffer(lineString(coordinates), bufferKm, { units: 'kilometers', steps: 12 });
  const startArea = buffer(point(coordinates[0]), 15, { units: 'kilometers', steps: 12 });
  const endArea = buffer(point(coordinates.at(-1)!), 15, { units: 'kilometers', steps: 12 });
  const merged = union(featureCollection([routeArea!, startArea!, endArea!]));
  if (!merged || merged.geometry.type !== 'Polygon') throw new Error('Nie udało się przygotować korytarza tej trasy.');
  return merged.geometry;
}

export async function getOfflineNavigationCapabilities(): Promise<OfflineNavigationCapabilities> {
  if (!VroomOfflineNavigation) return {
    available: false,
    sdkVersion: 'missing',
    supportsOfflineRouting: false,
    supportsVoiceGuidance: false,
    supportsRerouting: false,
    reason: OFFLINE_NATIVE_BUILD_MESSAGE,
  };
  try {
    return await VroomOfflineNavigation.getCapabilities();
  } catch {
    return {
      available: false,
      sdkVersion: 'unavailable',
      supportsOfflineRouting: false,
      supportsVoiceGuidance: false,
      supportsRerouting: false,
      reason: 'Navigation SDK nie uruchomił się na tym urządzeniu.',
    };
  }
}

export function buildOfflineNavigationDownload(route: any, bufferKm: 5 | 10 | 20, styleURI: string): OfflineNavigationDownload {
  const routePoints = validOfflineRoutePoints(route?.points ?? route?.routePoints ?? route?.geometry);
  return {
    id: `vroom-nav-${Number(route.id)}`,
    routeId: Number(route.id),
    routeName: String(route.name || 'Trasa').slice(0, 120),
    geometry: createOfflineCorridor(routePoints, bufferKm),
    routeGeoJson: { type: 'LineString', coordinates: routePoints.map((item) => [item.longitude, item.latitude]) },
    styleURI,
    bufferKm,
    minZoom: 8,
    maxZoom: 16,
    instructions: Array.isArray(route.instructions) ? route.instructions : [],
    savedPlaces: Array.isArray(route.savedPlaces) ? route.savedPlaces : [],
  };
}

export async function requestOfflineNavigationRoute(
  request: OfflineNavigationRouteRequest,
): Promise<OfflineNavigationRoute | null> {
  if (!VroomOfflineNavigation) return null;
  const values = [
    request.origin.latitude,
    request.origin.longitude,
    request.destination.latitude,
    request.destination.longitude,
  ];
  if (!values.every(Number.isFinite)) return null;
  try {
    const capabilities = await VroomOfflineNavigation.getCapabilities();
    if (!capabilities.available || !capabilities.supportsOfflineRouting) return null;
    const packs = await VroomOfflineNavigation.listPacks();
    if (!packs.some((pack) => pack.status === 'ready')) return null;
    const route = await VroomOfflineNavigation.requestOfflineRoute(request);
    return route?.points?.length >= 2 ? route : null;
  } catch {
    return null;
  }
}

export { VroomOfflineNavigation };
export type { OfflineNavigationCapabilities, OfflineNavigationDownload, OfflineNavigationPack, OfflineNavigationRoute, OfflineNavigationRouteRequest };
