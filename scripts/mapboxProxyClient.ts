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
const MATCHING_FALLBACK_MAX_PER_WINDOW = 3;
const MATCHING_FALLBACK_COOLDOWN_MS = 10 * 60 * 1000;

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

async function callProxy<T>(path: string, init: RequestInit): Promise<T | null> {
  try {
    let token = await getAuthToken();
    if (!token) return null;

    const makeRequest = (authToken: string) => fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        ...(init.headers ?? {}),
      },
    });

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
  opts?: { allowFallback?: boolean },
): Promise<T | null> {
  const viaProxy = await callProxy<T>('/api/mapbox/matching', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (viaProxy != null) return viaProxy;
  if (opts?.allowFallback === false) return null;
  const now = Date.now();
  matchingFallbackTimes = matchingFallbackTimes.filter((t) => now - t < MATCHING_FALLBACK_WINDOW_MS);
  if (matchingFallbackTimes.length >= MATCHING_FALLBACK_MAX_PER_WINDOW) return null;
  if (now - lastMatchingFallbackAt < MATCHING_FALLBACK_COOLDOWN_MS) return null;
  lastMatchingFallbackAt = now;
  matchingFallbackTimes.push(now);
  const res = await fetch(fallbackUrl);
  return await res.json() as T;
}

export async function fetchGeocodingViaProxy<T>(params: {
  query: string;
  limit?: number;
  language?: string;
  proximityLng?: number;
  proximityLat?: number;
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
  const fallbackUrl =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(params.query)}.json` +
    `?access_token=${MAPBOX_TOKEN}&language=${params.language ?? 'pl'}&limit=${params.limit ?? 5}${proximity}`;
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

