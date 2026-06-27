import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const CACHE_DIR = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''}vroom-vehicle-models/`;
const STORAGE_PREFIX = 'vroom.vehicleModelCache.v1.';

type CacheEntry = {
  url: string;
  localUri: string;
  cachedAt: number;
};

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function safeId(id: string): string {
  return String(id || 'vehicle').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 64) || 'vehicle';
}

function extensionForUrl(url: string): 'glb' | 'gltf' {
  return /\.gltf(\?|$)/i.test(url) ? 'gltf' : 'glb';
}

function storageKey(id: string, url: string): string {
  return `${STORAGE_PREFIX}${safeId(id)}.${hashString(url)}`;
}

async function ensureCacheDir() {
  if (!CACHE_DIR) throw new Error('Brak katalogu cache modelu 3D');
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

async function readValidEntry(id: string, url: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(id, url));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CacheEntry>;
    if (entry.url !== url || !entry.localUri) return null;
    const info = await FileSystem.getInfoAsync(entry.localUri);
    return info.exists ? entry.localUri : null;
  } catch {
    return null;
  }
}

export async function getCachedVehicleModelUri(id: string, url: string): Promise<string | null> {
  if (!url) return null;
  return readValidEntry(id, url);
}

/** Szybki odczyt z AsyncStorage bez weryfikacji pliku (cold start). */
export async function peekCachedVehicleModelUri(id: string, url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const raw = await AsyncStorage.getItem(storageKey(id, url));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CacheEntry>;
    if (entry.url !== url || !entry.localUri) return null;
    return entry.localUri;
  } catch {
    return null;
  }
}

export async function cacheVehicleModelUri(id: string, url: string): Promise<string> {
  const existing = await readValidEntry(id, url);
  if (existing) return existing;

  await ensureCacheDir();
  const localUri = `${CACHE_DIR}${safeId(id)}-${hashString(url)}.${extensionForUrl(url)}`;
  const downloaded = await FileSystem.downloadAsync(url, localUri);
  if (!downloaded?.uri) throw new Error('Nie udalo sie pobrac modelu 3D');

  const entry: CacheEntry = {
    url,
    localUri: downloaded.uri,
    cachedAt: Date.now(),
  };
  await AsyncStorage.setItem(storageKey(id, url), JSON.stringify(entry));
  return downloaded.uri;
}

/** Preload w tle po equip/zakupie. */
export function preloadVehicleModel(id: string, url: string): void {
  if (!id || !url) return;
  void cacheVehicleModelUri(id, url).catch(() => {});
}
