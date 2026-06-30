import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { NavMode } from './navigationV3/types';

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

async function gamificationFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type GeoDropNearby = {
  id: number;
  lat: number;
  lng: number;
  radiusM: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  type: 'auto_local' | 'manual' | 'event';
  expiresAt: string;
  distanceM: number;
  notificationRadiusKm?: number;
};

export type GamificationReward = {
  id: number;
  type: string;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type GeoDropRewardPreview = {
  id?: number | null;
  rarity?: string;
  rewardType: string;
  rewardAmount?: number | null;
  rewardItemId?: string | null;
  label?: string | null;
  weight?: number;
  previewUrl?: string | null;
  assetUrl?: string | null;
  assetKind?: string | null;
};

export type AsphaltDistrict = {
  slug: string;
  name: string;
  type?: string;
  cellsRevealed: number;
  totalCells: number;
  percentComplete: number;
  lastDrivenAt?: string | null;
};

export type CoverageCell = {
  cellId: string;
  center: { lat: number; lng: number };
  polygon: [number, number][];
  firstSeenAt: string;
};

export async function syncGamificationDriveMode(mode: NavMode): Promise<void> {
  await gamificationFetch('/api/gamification/drive-mode', {
    method: 'PATCH',
    body: JSON.stringify({ mode }),
  });
}

export async function ingestGamificationPing(input: {
  lat: number;
  lng: number;
  mode: NavMode;
  headingDeg?: number | null;
  speedKmh?: number | null;
  ts?: number;
}): Promise<void> {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return;
  if (input.mode !== 'freeDrive' && input.mode !== 'navigation') return;
  await gamificationFetch('/api/gamification/ingest', {
    method: 'POST',
    body: JSON.stringify({
      lat: input.lat,
      lng: input.lng,
      mode: input.mode,
      headingDeg: input.headingDeg,
      speedKmh: input.speedKmh,
      ts: input.ts ?? Date.now(),
    }),
  });
}

export async function fetchNearbyDrops(
  lat: number,
  lng: number,
  radiusKm = 15,
): Promise<GeoDropNearby[]> {
  const data = await gamificationFetch<{ drops?: GeoDropNearby[]; hidden?: boolean }>(
    `/api/gamification/drops/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`,
  );
  if (!data || data.hidden) return [];
  return data.drops ?? [];
}

export async function fetchDropStatus(dropId: number): Promise<{
  available: boolean;
  status?: string;
  expiresAt?: string;
  rarity?: string;
} | null> {
  return gamificationFetch(`/api/gamification/drops/${dropId}/status`);
}

export async function claimGeoDrop(
  dropId: number,
  ping: {
    lat: number;
    lng: number;
    mode?: NavMode;
    headingDeg?: number | null;
    speedKmh?: number | null;
    ts?: number;
  },
): Promise<{
  ok: boolean;
  error?: string;
  nitroGranted?: number;
  rarity?: string;
  dropId?: number;
  wonReward?: GeoDropRewardPreview;
  rewardPool?: GeoDropRewardPreview[];
  rollSeed?: string | null;
}> {
  const token = await getToken();
  if (!token) return { ok: false, error: 'NO_TOKEN' };
  try {
    const res = await fetch(`${API_URL}/api/gamification/drops/${dropId}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        relaxed: true,
        lat: ping.lat,
        lng: ping.lng,
        mode: ping.mode,
        headingDeg: ping.headingDeg,
        speedKmh: ping.speedKmh,
        ts: ping.ts ?? Date.now(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data as { error?: string })?.error || `HTTP_${res.status}` };
    }
    return { ok: true, ...(data as object) } as {
      ok: boolean;
      nitroGranted?: number;
      rarity?: string;
      dropId?: number;
      wonReward?: GeoDropRewardPreview;
      rewardPool?: GeoDropRewardPreview[];
      rollSeed?: string | null;
    };
  } catch {
    return { ok: false, error: 'NETWORK_ERROR' };
  }
}

export async function sendDropNavigateIntent(input: {
  dropId: number;
  lat?: number | null;
  lng?: number | null;
  mode?: NavMode;
}): Promise<boolean> {
  const data = await gamificationFetch<{ ok?: boolean }>(
    `/api/gamification/drops/${input.dropId}/navigate-intent`,
    {
      method: 'POST',
      body: JSON.stringify({
        lat: input.lat,
        lng: input.lng,
        mode: input.mode,
      }),
    },
  );
  return !!data?.ok;
}

export async function fetchPendingGamificationRewards(): Promise<GamificationReward[]> {
  const data = await gamificationFetch<{ rewards?: GamificationReward[] }>(
    '/api/gamification/rewards/pending',
  );
  return data?.rewards ?? [];
}

export async function ackGamificationReward(rewardId: number): Promise<void> {
  await gamificationFetch(`/api/gamification/rewards/${rewardId}/ack`, {
    method: 'POST',
  });
}

export async function fetchAsphaltSummary(): Promise<AsphaltDistrict[]> {
  const data = await gamificationFetch<{ districts?: AsphaltDistrict[] }>(
    '/api/gamification/asphalt',
  );
  return data?.districts ?? [];
}

export async function fetchCoverageCells(options: {
  userId?: number;
  bbox?: string;
  limit?: number;
} = {}): Promise<CoverageCell[]> {
  const params = new URLSearchParams();
  if (options.userId != null) params.set('userId', String(options.userId));
  if (options.bbox) params.set('bbox', options.bbox);
  if (options.limit != null) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await gamificationFetch<{ cells?: CoverageCell[] }>(
    `/api/gamification/coverage${suffix}`,
  );
  return data?.cells ?? [];
}

export async function fetchTurfCrowns(): Promise<
  {
    regionSlug: string;
    regionName: string;
    regionType?: string;
    username: string;
    distanceKm: number;
    year?: number;
    month?: number;
  }[]
> {
  const data = await gamificationFetch<{
    crowns?: {
      regionSlug: string;
      regionName: string;
      regionType?: string;
      username: string;
      distanceKm: number;
      year?: number;
      month?: number;
    }[];
  }>('/api/gamification/turf/crowns');
  return data?.crowns ?? [];
}

export async function fetchPassport(): Promise<{
  totalStamps: number;
  voivodeshipCount: number;
  cityCount: number;
  stamps: { slug: string; name: string; type: string; firstSeenAt: string }[];
} | null> {
  return gamificationFetch('/api/gamification/passport');
}

export async function fetchGamificationStatus(): Promise<{
  activeDrops: number;
  buffers: number;
  bufferedPings: number;
  cachedModes: number;
  lastFlushAt: number;
  lastFlushUserId: number | null;
  lastFlushPingCount: number;
  geoCache: {
    loadedAt: number;
    ageMs: number | null;
    cells: number;
    regions: number;
    bboxRegions: number;
  };
} | null> {
  return gamificationFetch('/api/gamification/status');
}
