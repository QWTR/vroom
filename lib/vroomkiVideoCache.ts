import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}vroomki-videos/`;
const INDEX_KEY = 'vroom.vroomkiVideoCache.index.v1';
const MAX_ENTRIES = 14;
const MAX_BYTES = 280 * 1024 * 1024;

type CacheEntry = {
  url: string;
  localUri: string;
  bytes: number;
  cachedAt: number;
};

const inflight = new Map<string, Promise<string>>();
const memoryCache = new Map<string, string>();

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function extensionForUrl(url: string): string {
  const clean = url.split('?')[0] ?? '';
  const ext = clean.split('.').pop()?.toLowerCase();
  if (ext === 'mp4' || ext === 'mov' || ext === 'm4v' || ext === 'webm') return ext;
  return 'mp4';
}

async function ensureCacheDir() {
  if (!CACHE_DIR) return;
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

async function readIndex(): Promise<CacheEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CacheEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: CacheEntry[]) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

async function readValidEntry(url: string): Promise<string | null> {
  const mem = memoryCache.get(url);
  if (mem) return mem;

  const entries = await readIndex();
  const hit = entries.find((e) => e.url === url);
  if (!hit?.localUri) return null;
  const info = await FileSystem.getInfoAsync(hit.localUri);
  if (!info.exists) return null;
  memoryCache.set(url, hit.localUri);
  return hit.localUri;
}

async function trimIndex(entries: CacheEntry[]) {
  let total = entries.reduce((sum, e) => sum + (e.bytes || 0), 0);
  const sorted = [...entries].sort((a, b) => b.cachedAt - a.cachedAt);
  const kept: CacheEntry[] = [];

  for (const entry of sorted) {
    if (kept.length >= MAX_ENTRIES || total > MAX_BYTES) {
      try {
        await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
        memoryCache.delete(entry.url);
      } catch {
        /* ignore */
      }
      total -= entry.bytes || 0;
      continue;
    }
    kept.push(entry);
  }

  await writeIndex(kept);
  return kept;
}

export function getMemoryCachedVroomkiVideoUri(url: string): string | null {
  if (!url || url.startsWith('file://')) return url;
  return memoryCache.get(url) ?? null;
}

export async function peekCachedVroomkiVideoUri(url: string): Promise<string | null> {
  if (!url || url.startsWith('file://')) return url;
  return readValidEntry(url);
}

export async function cacheVroomkiVideoUri(url: string): Promise<string> {
  if (!url) throw new Error('Brak URL wideo');
  if (url.startsWith('file://')) return url;

  const mem = memoryCache.get(url);
  if (mem) return mem;

  const existing = await readValidEntry(url);
  if (existing) return existing;

  const pending = inflight.get(url);
  if (pending) return pending;

  const job = (async () => {
    await ensureCacheDir();
    const localUri = `${CACHE_DIR}${hashString(url)}.${extensionForUrl(url)}`;
    const downloaded = await FileSystem.downloadAsync(url, localUri);
    if (!downloaded?.uri) throw new Error('Nie udało się pobrać wideo');

    const info = await FileSystem.getInfoAsync(downloaded.uri);
    const bytes = Number((info as { size?: number }).size ?? 0);
    const entries = await readIndex();
    const next: CacheEntry = {
      url,
      localUri: downloaded.uri,
      bytes,
      cachedAt: Date.now(),
    };
    const merged = [next, ...entries.filter((e) => e.url !== url)];
    await trimIndex(merged);
    memoryCache.set(url, downloaded.uri);
    return downloaded.uri;
  })();

  inflight.set(url, job);
  try {
    return await job;
  } finally {
    inflight.delete(url);
  }
}

export function prefetchVroomkiVideo(url: string | null | undefined): void {
  if (!url || url.startsWith('file://')) return;
  if (memoryCache.has(url)) return;
  void cacheVroomkiVideoUri(url).catch(() => {});
}

export function priorityPrefetchVroomkiVideo(url: string | null | undefined): void {
  if (!url || url.startsWith('file://')) return;
  if (memoryCache.has(url)) return;
  void cacheVroomkiVideoUri(url).catch(() => {});
}

export function warmFeedVideos(urls: Array<string | null | undefined>) {
  const unique = Array.from(new Set(urls.filter((u): u is string => !!u && !u.startsWith('file://'))));
  unique.forEach((url, index) => {
    if (index === 0) priorityPrefetchVroomkiVideo(url);
    else prefetchVroomkiVideo(url);
  });
}

export async function resolveVroomkiVideoUri(url: string): Promise<string> {
  if (!url || url.startsWith('file://')) return url;
  const cached = await peekCachedVroomkiVideoUri(url);
  return cached ?? url;
}
