import AsyncStorage from '@react-native-async-storage/async-storage';

const MAP_LAST_LOCATION_KEY = 'map_last_good_location';
const BG_LAST_LOC_KEY = 'bg_last_location';
/** Maks. wiek cache do pokazania na mapie (7 dni). */
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** bg_last_location tylko jako awaryjny fallback (inny pipeline niż mapa). */
const BG_MAP_FALLBACK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type MapLastLocation = {
  latitude: number;
  longitude: number;
  at: number;
  accuracy?: number;
};

/** Sync cache — przetrwa szybkie przełączanie zakładek bez remountu stanu React. */
let memoryCache: MapLastLocation | null = null;

function parseRecord(raw: string | null, maxAgeMs = MAX_CACHE_AGE_MS): MapLastLocation | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const latitude = Number(p.latitude);
    const longitude = Number(p.longitude);
    const at = Number(p.at ?? p.timestamp ?? p.time ?? 0);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) < 1e-6 && Math.abs(longitude) < 1e-6) return null;
    if (!Number.isFinite(at) || Date.now() - at > maxAgeMs) return null;
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

export function peekMapLastLocation(): MapLastLocation | null {
  return memoryCache;
}

export function rememberMapLastLocation(
  latitude: number,
  longitude: number,
  accuracy?: number,
): MapLastLocation | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) < 1e-6 && Math.abs(longitude) < 1e-6) return null;
  memoryCache = {
    latitude,
    longitude,
    at: Date.now(),
    accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
  };
  return memoryCache;
}

export async function loadMapLastLocation(): Promise<MapLastLocation | null> {
  if (memoryCache) return memoryCache;

  const own = parseRecord(await AsyncStorage.getItem(MAP_LAST_LOCATION_KEY));
  if (own) {
    memoryCache = own;
    return own;
  }

  const bg = parseRecord(await AsyncStorage.getItem(BG_LAST_LOC_KEY), BG_MAP_FALLBACK_MAX_AGE_MS);
  if (bg) {
    memoryCache = bg;
  }
  return bg;
}

export async function saveMapLastLocation(
  latitude: number,
  longitude: number,
  accuracy?: number,
): Promise<void> {
  const payload = rememberMapLastLocation(latitude, longitude, accuracy);
  if (!payload) return;
  try {
    await AsyncStorage.setItem(MAP_LAST_LOCATION_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
