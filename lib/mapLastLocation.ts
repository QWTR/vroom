import AsyncStorage from '@react-native-async-storage/async-storage';

const MAP_LAST_LOCATION_KEY = 'map_last_good_location';
const BG_LAST_LOC_KEY = 'bg_last_location';
/** Maks. wiek cache do pokazania na mapie (7 dni). */
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type MapLastLocation = {
  latitude: number;
  longitude: number;
  at: number;
  accuracy?: number;
};

function parseRecord(raw: string | null): MapLastLocation | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const latitude = Number(p.latitude);
    const longitude = Number(p.longitude);
    const at = Number(p.at ?? p.timestamp ?? 0);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) < 1e-6 && Math.abs(longitude) < 1e-6) return null;
    if (!Number.isFinite(at) || Date.now() - at > MAX_CACHE_AGE_MS) return null;
    const accuracy = p.accuracy != null ? Number(p.accuracy) : undefined;
    return {
      latitude,
      longitude,
      at,
      accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
    };
  } catch {
    return null;
  }
}

export async function loadMapLastLocation(): Promise<MapLastLocation | null> {
  const own = parseRecord(await AsyncStorage.getItem(MAP_LAST_LOCATION_KEY));
  if (own) return own;

  const bg = parseRecord(await AsyncStorage.getItem(BG_LAST_LOC_KEY));
  if (!bg) return null;
  return bg;
}

export async function saveMapLastLocation(
  latitude: number,
  longitude: number,
  accuracy?: number,
): Promise<void> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  if (Math.abs(latitude) < 1e-6 && Math.abs(longitude) < 1e-6) return;
  const payload: MapLastLocation = {
    latitude,
    longitude,
    at: Date.now(),
    accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
  };
  try {
    await AsyncStorage.setItem(MAP_LAST_LOCATION_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
