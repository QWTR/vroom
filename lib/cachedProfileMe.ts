import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/mapConfig';

const CACHE_TTL_MS = 30_000;

type ProfileMePayload = Record<string, unknown>;

let cache: { at: number; data: ProfileMePayload } | null = null;
let inflight: Promise<ProfileMePayload | null> | null = null;

async function resolveToken(explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

/** Deduped GET /api/profile/me with short TTL — safe for map + tabs. */
export async function fetchProfileMeCached(options?: {
  token?: string | null;
  fresh?: boolean;
}): Promise<ProfileMePayload | null> {
  const fresh = options?.fresh === true;
  const now = Date.now();
  if (!fresh && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const token = await resolveToken(options?.token);
      if (!token) return null;
      const res = await fetch(`${API_URL}/api/profile/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return cache?.data ?? null;
      const data = (await res.json()) as ProfileMePayload;
      cache = { at: Date.now(), data };
      return data;
    } catch {
      return cache?.data ?? null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function invalidateProfileMeClientCache() {
  cache = null;
}
