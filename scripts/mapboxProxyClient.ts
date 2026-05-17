import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, MAPBOX_TOKEN } from '../constants/mapConfig';
import { NativeModules } from 'react-native';

const { UsersModule } = NativeModules;

let cachedAuthToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 60_000;
let matchingFallbackTimes: number[] = [];
let lastMatchingFallbackAt = 0;
const MATCHING_FALLBACK_WINDOW_MS = 60 * 60 * 1000;
// Driving/navigation need frequent road snaps; very strict fallback throttling
// caused prolonged "no snap" windows when proxy was temporarily unavailable.
const MATCHING_FALLBACK_MAX_PER_WINDOW = 120;
const MATCHING_FALLBACK_COOLDOWN_MS = 4_000;

async function getAuthToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAuthToken && now - tokenFetchedAt < TOKEN_TTL_MS) return cachedAuthToken;
  const token =
    (await AsyncStorage.getItem('token')) ??
    (await AsyncStorage.getItem('userToken'));
  if (token) {
    UsersModule?.saveAuthTokenForAuto?.(token);
  }
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
    UsersModule?.saveAuthTokenForAuto?.(json.token);
    return json.token;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(300, timeoutMs));
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callProxy<T>(
  path: string,
  init: RequestInit,
  opts?: { timeoutMs?: number },
): Promise<T | null> {
  try {
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
    }, timeoutMs);

    let res = await makeRequest(token);
    if (res.status === 401) {
      const refreshed = await refreshAuthToken(token);
      if (!refreshed) return null;
      token = refreshed;
      res = await makeRequest(token);
    }
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export async function fetchDirectionsViaProxy<T>(payload: Record<string, unknown>, fallbackUrl: string): Promise<T> {
  const viaProxy = await callProxy<T>('/api/mapbox/directions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (viaProxy != null) return viaProxy;
  const res = await fetch(fallbackUrl);
  return await res.json() as T;
}

export async function fetchMatchingViaProxy<T>(
  payload: Record<string, unknown>,
  fallbackUrl: string,
  opts?: {
    allowFallback?: boolean;
    /** Skip fallback cooldown for critical entry/recovery snaps. */
    forceFallback?: boolean;
    /** Optional custom cooldown for this call. */
    cooldownMs?: number;
    /** Timeout for proxy matching request. */
    proxyTimeoutMs?: number;
    /** Timeout for direct fallback matching request. */
    fallbackTimeoutMs?: number;
  },
): Promise<T | null> {
  const viaProxy = await callProxy<T>('/api/mapbox/matching', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, { timeoutMs: opts?.proxyTimeoutMs ?? 3500 });
  if (viaProxy != null) return viaProxy;
  if (opts?.allowFallback === false) return null;
  const now = Date.now();
  const cooldownMs = Math.max(0, opts?.cooldownMs ?? MATCHING_FALLBACK_COOLDOWN_MS);
  matchingFallbackTimes = matchingFallbackTimes.filter((t) => now - t < MATCHING_FALLBACK_WINDOW_MS);
  if (!opts?.forceFallback && matchingFallbackTimes.length >= MATCHING_FALLBACK_MAX_PER_WINDOW) return null;
  if (!opts?.forceFallback && now - lastMatchingFallbackAt < cooldownMs) return null;
  lastMatchingFallbackAt = now;
  matchingFallbackTimes.push(now);
  try {
    const res = await fetchWithTimeout(
      fallbackUrl,
      {},
      Math.max(500, opts?.fallbackTimeoutMs ?? 3000),
    );
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
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
}): Promise<T> {
  const viaProxy = await callProxy<T>('/api/mapbox/geocode', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (viaProxy != null) return viaProxy;
  const proximity =
    Number.isFinite(params.proximityLng) && Number.isFinite(params.proximityLat)
      ? `&proximity=${params.proximityLng},${params.proximityLat}`
      : '';
  const country = params.country ? `&country=${encodeURIComponent(params.country)}` : '&country=pl';
  const types = params.types
    ? `&types=${encodeURIComponent(params.types)}`
    : '&types=address,poi,place,locality,neighborhood';
  const fallbackUrl =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(params.query)}.json` +
    `?access_token=${MAPBOX_TOKEN}&language=${params.language ?? 'pl'}&limit=${params.limit ?? 5}` +
    `${proximity}${country}${types}`;
  const res = await fetch(fallbackUrl);
  return await res.json() as T;
}

export async function fetchSearchSuggestViaProxy<T>(params: {
  query: string;
  sessionToken: string;
  limit?: number;
  language?: string;
  proximityLng?: number;
  proximityLat?: number;
  country?: string;
}): Promise<T> {
  const viaProxy = await callProxy<T>('/api/mapbox/search/suggest', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (viaProxy != null) return viaProxy;
  const proximity =
    Number.isFinite(params.proximityLng) && Number.isFinite(params.proximityLat)
      ? `&proximity=${params.proximityLng},${params.proximityLat}`
      : '';
  const country = params.country ? `&country=${encodeURIComponent(params.country)}` : '&country=pl';
  const fallbackUrl =
    `https://api.mapbox.com/search/searchbox/v1/suggest` +
    `?q=${encodeURIComponent(params.query)}` +
    `&session_token=${encodeURIComponent(params.sessionToken)}` +
    `&language=${params.language ?? 'pl'}` +
    `&limit=${params.limit ?? 8}` +
    `${proximity}${country}` +
    `&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(fallbackUrl);
  return await res.json() as T;
}

export async function fetchSearchRetrieveViaProxy<T>(params: {
  mapboxId: string;
  sessionToken: string;
  language?: string;
}): Promise<T> {
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
}

export async function fetchSearchCategoryViaProxy<T>(params: {
  category: string;
  proximityLng: number;
  proximityLat: number;
  limit?: number;
  language?: string;
}): Promise<T> {
  const viaProxy = await callProxy<T>('/api/mapbox/search/category', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (viaProxy != null) return viaProxy;
  const fallbackUrl =
    `https://api.mapbox.com/search/searchbox/v1/category/${params.category}` +
    `?proximity=${params.proximityLng},${params.proximityLat}` +
    `&limit=${params.limit ?? 20}&language=${params.language ?? 'pl'}&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(fallbackUrl);
  return await res.json() as T;
}

