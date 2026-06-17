import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, MAPBOX_TOKEN } from '../constants/mapConfig';
import { NativeModules } from 'react-native';
import {
  anchorFromMatchingPoints,
  buildMatchingCacheKey,
  buildMatchingProxyBody,
  withMatchingClientCache,
} from '../lib/mapMatch/matchingRequest';

let cachedAuthToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 60_000;

type SearchCacheEntry = { at: number; data: unknown };
const searchCache = new Map<string, SearchCacheEntry>();
const inflightSearch = new Map<string, Promise<unknown>>();
const MAX_SEARCH_CACHE_ENTRIES = 220;
const SUGGEST_CACHE_TTL_MS = 10 * 60_000;
const CATEGORY_CACHE_TTL_MS = 8 * 60_000;
const RETRIEVE_CACHE_TTL_MS = 30 * 60_000;
const SUGGEST_MAX_PER_SESSION = 60;
const SUGGEST_MAX_PER_MINUTE = 12;

type SuggestBudget = { total: number; windowStart: number; windowCount: number };
const suggestBudgetBySession = new Map<string, SuggestBudget>();

export function resetSearchSuggestBudget(sessionToken: string): void {
  if (sessionToken) suggestBudgetBySession.delete(sessionToken);
}

export function isSearchBoxBudgetError(e: unknown): boolean {
  return e instanceof Error && e.name === 'SearchBoxBudgetError';
}

function canIssueSearchSuggest(sessionToken: string): boolean {
  const token = String(sessionToken ?? '').trim();
  if (!token) return false;
  const now = Date.now();
  let b = suggestBudgetBySession.get(token);
  if (!b) {
    b = { total: 0, windowStart: now, windowCount: 0 };
    suggestBudgetBySession.set(token, b);
  }
  if (now - b.windowStart >= 60_000) {
    b.windowStart = now;
    b.windowCount = 0;
  }
  if (b.total >= SUGGEST_MAX_PER_SESSION) return false;
  if (b.windowCount >= SUGGEST_MAX_PER_MINUTE) return false;
  return true;
}

function recordSearchSuggest(sessionToken: string): void {
  const token = String(sessionToken ?? '').trim();
  if (!token) return;
  const now = Date.now();
  let b = suggestBudgetBySession.get(token);
  if (!b) {
    b = { total: 0, windowStart: now, windowCount: 0 };
    suggestBudgetBySession.set(token, b);
  }
  if (now - b.windowStart >= 60_000) {
    b.windowStart = now;
    b.windowCount = 0;
  }
  b.total += 1;
  b.windowCount += 1;
}

/** RN/Hermes nie ma globalnego DOMException — używamy Error z name AbortError. */
function createAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name;
  return name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function pruneSearchCache(now: number) {
  if (searchCache.size <= MAX_SEARCH_CACHE_ENTRIES) return;
  for (const [key, value] of searchCache) {
    if (now - value.at > 2 * 60_000) {
      searchCache.delete(key);
    }
    if (searchCache.size <= MAX_SEARCH_CACHE_ENTRIES) break;
  }
}

function makeCoordBucket(value?: number, precision = 3): string {
  if (!Number.isFinite(value)) return 'na';
  const p = Math.max(0, Math.min(6, precision));
  return Number(value).toFixed(p);
}

async function withCachedSearch<T>(
  cacheKey: string,
  ttlMs: number,
  factory: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const now = Date.now();
  const cached = searchCache.get(cacheKey);
  if (cached && now - cached.at < ttlMs) {
    return cached.data as T;
  }
  const inflight = inflightSearch.get(cacheKey);
  if (inflight) {
    return (await inflight) as T;
  }
  const task = (async () => {
    throwIfAborted(signal);
    const data = await factory();
    throwIfAborted(signal);
    searchCache.set(cacheKey, { at: Date.now(), data });
    pruneSearchCache(Date.now());
    return data;
  })();
  inflightSearch.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflightSearch.delete(cacheKey);
  }
}

async function getAuthToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAuthToken && now - tokenFetchedAt < TOKEN_TTL_MS) return cachedAuthToken;
  const token =
    (await AsyncStorage.getItem('token')) ??
    (await AsyncStorage.getItem('userToken'));
  cachedAuthToken = token ?? null;
  tokenFetchedAt = now;
  return cachedAuthToken;
}

async function refreshAuthToken(currentToken: string | null): Promise<string | null> {
  if (!currentToken) return null;
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`,
      },
    });
    if (!res.ok) return null;
    const json = await res.json() as { token?: string };
    if (!json?.token) return null;
    cachedAuthToken = json.token;
    tokenFetchedAt = Date.now();
    await AsyncStorage.setItem('token', json.token);
    return json.token;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  throwIfAborted(externalSignal);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(300, timeoutMs));
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort);
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

async function callProxy<T>(
  path: string,
  init: RequestInit,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<T | null> {
  try {
    throwIfAborted(opts?.signal);
    let token = await getAuthToken();
    if (!token) return null;
    const timeoutMs = Math.max(500, opts?.timeoutMs ?? 8000);

    const makeRequest = (authToken: string) => fetchWithTimeout(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        ...(init.headers ?? {}),
      },
    }, timeoutMs, opts?.signal);

    let res = await makeRequest(token);
    if (res.status === 401) {
      throwIfAborted(opts?.signal);
      const refreshed = await refreshAuthToken(token);
      if (!refreshed) return null;
      token = refreshed;
      res = await makeRequest(token);
    }
    if (!res.ok) return null;
    return await res.json() as T;
  } catch (e) {
    if (isAbortError(e)) throw e;
    return null;
  }
}

export async function fetchDirectionsViaProxy<T>(payload: Record<string, unknown>, fallbackUrl: string): Promise<T> {
  const viaProxy = await callProxy<T>('/api/mapbox/directions', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, { timeoutMs: 12_000 });
  if (viaProxy != null) return viaProxy;
  const res = await fetchWithTimeout(fallbackUrl, {}, 12_000);
  if (!res.ok) throw new Error(`DIRECTIONS_FALLBACK_${res.status}`);
  return await res.json() as T;
}

export async function fetchMatchingViaProxy<T>(
  payload: Record<string, unknown>,
  _fallbackUrl: string,
  opts?: {
    /** @deprecated Direct Mapbox fallback removed — proxy-only. */
    allowFallback?: boolean;
    forceFallback?: boolean;
    cooldownMs?: number;
    proxyTimeoutMs?: number;
    fallbackTimeoutMs?: number;
    signal?: AbortSignal;
    /** Skip client memory cache (manual entry refresh). */
    skipClientCache?: boolean;
  },
): Promise<T | null> {
  const normalized = buildMatchingProxyBody(payload);
  if (!normalized) return null;

  const proxyBody: Record<string, unknown> = {
    points: normalized.points,
    profile: normalized.profile,
    radiuses: normalized.radiuses,
  };
  if (normalized.timestamps && normalized.timestamps.length === normalized.points.length) {
    proxyBody.timestamps = normalized.timestamps;
  }
  const cacheKey = buildMatchingCacheKey(
    normalized.points,
    normalized.profile,
    normalized.radiuses,
  );
  const anchor = anchorFromMatchingPoints(normalized.points);

  const fetchOnce = async (): Promise<T | null> => {
    return callProxy<T>('/api/mapbox/matching', {
      method: 'POST',
      body: JSON.stringify(proxyBody),
    }, { timeoutMs: opts?.proxyTimeoutMs ?? 3500, signal: opts?.signal });
  };

  if (opts?.skipClientCache) {
    return fetchOnce();
  }

  return withMatchingClientCache<T | null>(cacheKey, anchor, fetchOnce);
}

export function createMapboxSearchSessionToken(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function fetchGeocodingViaProxy<T>(params: {
  query: string;
  limit?: number;
  language?: string;
  proximityLng?: number;
  proximityLat?: number;
  country?: string;
  types?: string;
  signal?: AbortSignal;
}): Promise<T> {
  const { signal, ...rest } = params;
  const normalizedQuery = rest.query.trim().toLowerCase();
  const cacheKey = [
    'geocode',
    normalizedQuery,
    rest.limit ?? 5,
    rest.language ?? 'pl',
    rest.country ?? '',
    rest.types ?? 'address,poi,place,locality,neighborhood',
    makeCoordBucket(rest.proximityLng, 2),
    makeCoordBucket(rest.proximityLat, 2),
  ].join('|');
  return withCachedSearch<T>(cacheKey, 5 * 60_000, async () => {
    const viaProxy = await callProxy<T>('/api/mapbox/geocode', {
      method: 'POST',
      body: JSON.stringify(rest),
    }, { signal });
    if (viaProxy != null) return viaProxy;
    throwIfAborted(signal);
    const proximity =
      Number.isFinite(rest.proximityLng) && Number.isFinite(rest.proximityLat)
        ? `&proximity=${rest.proximityLng},${rest.proximityLat}`
        : '';
    const country = rest.country
      ? `&country=${encodeURIComponent(rest.country)}`
      : '&country=pl';
    const types = rest.types
      ? `&types=${encodeURIComponent(rest.types)}`
      : '&types=address,poi,place,locality,neighborhood';
    const fallbackUrl =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(rest.query)}.json` +
      `?access_token=${MAPBOX_TOKEN}&language=${rest.language ?? 'pl'}&limit=${rest.limit ?? 5}` +
      `${proximity}${country}${types}`;
    const res = await fetchWithTimeout(fallbackUrl, {}, 12_000, signal);
    return await res.json() as T;
  }, signal);
}

export async function fetchSearchSuggestViaProxy<T>(params: {
  query: string;
  sessionToken: string;
  limit?: number;
  language?: string;
  types?: string;
  proximityLng?: number;
  proximityLat?: number;
  country?: string;
  signal?: AbortSignal;
}): Promise<T> {
  const { signal, ...rest } = params;
  const normalizedQuery = rest.query.trim().toLowerCase();
  const cacheKey = [
    'suggest',
    normalizedQuery,
    rest.limit ?? 6,
    rest.language ?? 'pl',
    rest.types ?? '',
    rest.country ?? '',
    makeCoordBucket(rest.proximityLng, 2),
    makeCoordBucket(rest.proximityLat, 2),
  ].join('|');
  return withCachedSearch<T>(cacheKey, SUGGEST_CACHE_TTL_MS, async () => {
    if (!canIssueSearchSuggest(rest.sessionToken)) {
      const err = new Error('SEARCH_SUGGEST_BUDGET');
      err.name = 'SearchBoxBudgetError';
      throw err;
    }
    recordSearchSuggest(rest.sessionToken);
    const viaProxy = await callProxy<T>('/api/mapbox/search/suggest', {
      method: 'POST',
      body: JSON.stringify(rest),
    }, { signal });
    if (viaProxy != null) return viaProxy;
    throwIfAborted(signal);
    const proximity =
      Number.isFinite(rest.proximityLng) && Number.isFinite(rest.proximityLat)
        ? `&proximity=${rest.proximityLng},${rest.proximityLat}`
        : '';
    const country = rest.country
      ? `&country=${encodeURIComponent(rest.country)}`
      : '&country=pl';
    const types = rest.types ? `&types=${encodeURIComponent(rest.types)}` : '';
    const fallbackUrl =
      `https://api.mapbox.com/search/searchbox/v1/suggest` +
      `?q=${encodeURIComponent(rest.query)}` +
      `&session_token=${encodeURIComponent(rest.sessionToken)}` +
      `&language=${rest.language ?? 'pl'}` +
      `&limit=${rest.limit ?? 6}` +
      `${proximity}${country}${types}` +
      `&access_token=${MAPBOX_TOKEN}`;
    const res = await fetchWithTimeout(fallbackUrl, {}, 12_000, signal);
    return await res.json() as T;
  }, signal);
}

export async function fetchSearchRetrieveViaProxy<T>(params: {
  mapboxId: string;
  sessionToken: string;
  language?: string;
}): Promise<T> {
  const cacheKey = [
    'retrieve',
    String(params.mapboxId ?? '').trim(),
    params.language ?? 'pl',
  ].join('|');
  return withCachedSearch<T>(cacheKey, RETRIEVE_CACHE_TTL_MS, async () => {
    const viaProxy = await callProxy<T>('/api/mapbox/search/retrieve', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (viaProxy != null) return viaProxy;
    const fallbackUrl =
      `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(params.mapboxId)}` +
      `?session_token=${encodeURIComponent(params.sessionToken)}` +
      `&language=${params.language ?? 'pl'}` +
      `&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(fallbackUrl);
    return await res.json() as T;
  });
}

export async function fetchSearchCategoryViaProxy<T>(params: {
  category: string;
  proximityLng: number;
  proximityLat: number;
  limit?: number;
  language?: string;
  signal?: AbortSignal;
}): Promise<T> {
  const { signal, ...rest } = params;
  const cacheKey = [
    'category',
    rest.category,
    rest.limit ?? 20,
    rest.language ?? 'pl',
    makeCoordBucket(rest.proximityLng, 2),
    makeCoordBucket(rest.proximityLat, 2),
  ].join('|');
  return withCachedSearch<T>(cacheKey, CATEGORY_CACHE_TTL_MS, async () => {
    const viaProxy = await callProxy<T>('/api/mapbox/search/category', {
      method: 'POST',
      body: JSON.stringify(rest),
    }, { signal });
    if (viaProxy != null) return viaProxy;
    throwIfAborted(signal);
    const fallbackUrl =
      `https://api.mapbox.com/search/searchbox/v1/category/${rest.category}` +
      `?proximity=${rest.proximityLng},${rest.proximityLat}` +
      `&limit=${rest.limit ?? 20}&language=${rest.language ?? 'pl'}&access_token=${MAPBOX_TOKEN}`;
    const res = await fetchWithTimeout(fallbackUrl, {}, 12_000, signal);
    return await res.json() as T;
  }, signal);
}

export { isAbortError as isMapboxProxyAbortError };
