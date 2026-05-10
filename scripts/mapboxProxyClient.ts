import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, MAPBOX_TOKEN } from '../constants/mapConfig';

let cachedAuthToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 60_000;

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

async function callProxy<T>(path: string, init: RequestInit): Promise<T | null> {
  try {
    const token = await getAuthToken();
    if (!token) return null;
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
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

