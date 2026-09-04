import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GamificationProfileSummary } from '../constants/profile';
import type { NavMode } from './navigationV3/types';
import { apiRequest, ApiRequestError, type ApiRequestOptions } from './api/client';

async function gamificationFetch<T>(
  path: string,
  init?: ApiRequestOptions,
): Promise<T | null> {
  try {
    return await apiRequest<T>(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      timeoutMs: 10_000,
      priority: String(init?.method || 'GET').toUpperCase() === 'GET' ? 'background' : 'mutation',
    });
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

export type GeoDropHistoryItem = {
  id: number;
  dropId: number;
  claimedAt: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  type: string;
  region?: { slug: string; name: string } | null;
  reward: {
    rewardType: string;
    rewardAmount?: number | null;
    rewardItemId?: string | null;
    label: string;
    previewUrl?: string | null;
  };
  grantStatus: 'granted' | 'repaired' | 'requires_review' | 'not_applicable';
  balanceAfter?: number | null;
};

export type GeoDropHistoryPage = {
  items: GeoDropHistoryItem[];
  total: number;
  nextCursor: string | null;
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

export type CityTerritoryOwner = {
  rank: number;
  userId: number;
  username: string;
  avatarUrl?: string | null;
  distanceKm: number;
  percentComplete: number;
};

export type CityTerritory = {
  slug: string;
  name: string;
  teryt?: string | null;
  populationRank?: number | null;
  voivodeship?: { slug: string; name: string } | null;
  center: { lat?: number | null; lng?: number | null };
  cellsRevealed: number;
  totalCells: number;
  percentComplete: number;
  unlocked: boolean;
  unlockedAt?: string | null;
  myDistanceKm: number;
  myRank?: number | null;
  owner?: CityTerritoryOwner | null;
};

export type CityTerritoriesResponse = {
  period: { year: number; month: number; timeZone: string };
  unlockPercent: number;
  cities: CityTerritory[];
};

export type CityTerritoryDetail = {
  period: CityTerritoriesResponse['period'];
  unlockPercent: number;
  city: CityTerritory;
  leaderboard: CityTerritoryOwner[];
  history: (Omit<CityTerritoryOwner, 'rank'> & { year: number; month: number; crownedAt: string })[];
};

export type CoverageCell = {
  cellId: string;
  center: { lat: number; lng: number };
  polygon: [number, number][];
  firstSeenAt: string;
};

export type CoverageCellsPage = {
  cells: CoverageCell[];
  nextCursor: string | null;
  hasMore: boolean;
  totalInViewport: number;
  totalRevealed: number;
};

type GamificationPing = {
  lat: number;
  lng: number;
  mode: NavMode;
  headingDeg?: number | null;
  speedKmh?: number | null;
  ts: number;
  force?: boolean;
};

const GAMIFICATION_PING_OUTBOX_KEY = '@vroom/gamification-ping-outbox/v1';
const MAX_GAMIFICATION_QUEUED_PINGS = 720;
const GAMIFICATION_OUTBOX_FLUSH_BATCH = 12;
let gamificationOutboxLock: Promise<void> = Promise.resolve();

function serializeGamificationOutbox<T>(operation: () => Promise<T>): Promise<T> {
  const next = gamificationOutboxLock.then(operation, operation);
  gamificationOutboxLock = next.then(() => undefined, () => undefined);
  return next;
}

async function readGamificationPingOutbox(): Promise<GamificationPing[]> {
  try {
    const raw = await AsyncStorage.getItem(GAMIFICATION_PING_OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((ping): ping is GamificationPing => (
      Number.isFinite(Number(ping?.lat))
      && Number.isFinite(Number(ping?.lng))
      && (ping?.mode === 'freeDrive' || ping?.mode === 'navigation')
      && Number.isFinite(Number(ping?.ts))
    ));
  } catch {
    return [];
  }
}

async function writeGamificationPingOutbox(pings: GamificationPing[]): Promise<boolean> {
  try {
    if (!pings.length) {
      await AsyncStorage.removeItem(GAMIFICATION_PING_OUTBOX_KEY);
      return true;
    }
    await AsyncStorage.setItem(
      GAMIFICATION_PING_OUTBOX_KEY,
      JSON.stringify(pings.slice(-MAX_GAMIFICATION_QUEUED_PINGS)),
    );
    return true;
  } catch {
    // The regular drive ledger remains independent when storage is unavailable.
    return false;
  }
}

async function postGamificationPing(ping: GamificationPing): Promise<'sent' | 'retry' | 'discard'> {
  try {
    await apiRequest('/gamification/ingest', {
      method: 'POST',
      body: ping,
      priority: 'mutation',
    });
    return 'sent';
  } catch (error) {
    if (error instanceof ApiRequestError && [400, 401, 409, 422].includes(error.status)) return 'discard';
    return 'retry';
  }
}

async function flushGamificationPingOutboxLocked(): Promise<void> {
  const queued = await readGamificationPingOutbox();
  if (!queued.length) return;

  const batchSize = Math.min(GAMIFICATION_OUTBOX_FLUSH_BATCH, queued.length);
  for (let index = 0; index < batchSize; index += 1) {
    const outcome = await postGamificationPing(queued[index]);
    if (outcome === 'retry') {
      await writeGamificationPingOutbox(queued.slice(index));
      return;
    }
  }
  await writeGamificationPingOutbox(queued.slice(batchSize));
}

export async function flushGamificationPingOutbox(): Promise<void> {
  await serializeGamificationOutbox(flushGamificationPingOutboxLocked);
}

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
  force?: boolean;
}): Promise<'sent' | 'queued' | 'discarded'> {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return 'discarded';
  if (input.mode !== 'freeDrive' && input.mode !== 'navigation') return 'discarded';
  const ping: GamificationPing = {
    lat: input.lat,
    lng: input.lng,
    mode: input.mode,
    headingDeg: input.headingDeg,
    speedKmh: input.speedKmh,
    ts: input.ts ?? Date.now(),
    force: input.force === true,
  };

  return serializeGamificationOutbox(async () => {
    await flushGamificationPingOutboxLocked();
    const outcome = await postGamificationPing(ping);
    if (outcome === 'sent') return 'sent';
    if (outcome === 'retry') {
      const queued = await readGamificationPingOutbox();
      queued.push(ping);
      await writeGamificationPingOutbox(queued);
      return 'queued';
    }
    return 'discarded';
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
  lat?: number;
  lng?: number;
  radiusM?: number;
  type?: GeoDropNearby['type'];
  notificationRadiusKm?: number;
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
  alreadyClaimed?: boolean;
  error?: string;
  nitroGranted?: number;
  rarity?: string;
  dropId?: number;
  wonReward?: GeoDropRewardPreview;
  rewardPool?: GeoDropRewardPreview[];
  rollSeed?: string | null;
  wallet?: { nitroBalance: number };
}> {
  try {
    const data = await apiRequest<Record<string, unknown>>(`/gamification/drops/${dropId}/claim`, {
      method: 'POST',
      body: {
        relaxed: true,
        lat: ping.lat,
        lng: ping.lng,
        mode: ping.mode,
        headingDeg: ping.headingDeg,
        speedKmh: ping.speedKmh,
        ts: ping.ts ?? Date.now(),
      },
    });
    return { ok: true, ...(data as object) } as {
      ok: boolean;
      alreadyClaimed?: boolean;
      nitroGranted?: number;
      rarity?: string;
      dropId?: number;
      wonReward?: GeoDropRewardPreview;
      rewardPool?: GeoDropRewardPreview[];
      rollSeed?: string | null;
      wallet?: { nitroBalance: number };
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiRequestError ? error.code || error.message : 'NETWORK_ERROR',
    };
  }
}

export function isIdempotentGeoDropClaim(result: {
  ok: boolean;
  alreadyClaimed?: boolean;
}): boolean {
  return result.ok && result.alreadyClaimed === true;
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

export async function fetchGeoDropHistory(cursor?: string | null, limit = 20): Promise<GeoDropHistoryPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const data = await apiRequest<Partial<GeoDropHistoryPage>>(
    `/api/gamification/drops/history/mine?${params.toString()}`,
    { timeoutMs: 10_000, priority: 'background' },
  );
  return {
    items: data?.items ?? [],
    total: Number(data?.total) || 0,
    nextCursor: data?.nextCursor ? String(data.nextCursor) : null,
  };
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

export async function fetchCityTerritories(): Promise<CityTerritoriesResponse> {
  const data = await gamificationFetch<Partial<CityTerritoriesResponse>>('/api/gamification/cities');
  return {
    period: data?.period ?? { year: new Date().getFullYear(), month: new Date().getMonth() + 1, timeZone: 'Europe/Warsaw' },
    unlockPercent: Number(data?.unlockPercent ?? 20),
    cities: data?.cities ?? [],
  };
}

export async function fetchCityTerritoryDetail(slug: string): Promise<CityTerritoryDetail | null> {
  return gamificationFetch<CityTerritoryDetail>(`/api/gamification/cities/${encodeURIComponent(slug)}`);
}

export async function fetchCoverageCells(options: {
  userId?: number;
  bbox?: string;
  cursor?: string | null;
  limit?: number;
} = {}): Promise<CoverageCellsPage> {
  // The server repairs coverage from saved activities. Live ping retries stay
  // best-effort and must never block opening the discovery map.
  void flushGamificationPingOutbox().catch(() => undefined);
  const params = new URLSearchParams();
  if (options.userId != null) params.set('userId', String(options.userId));
  if (options.bbox) params.set('bbox', options.bbox);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit != null) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await gamificationFetch<Partial<CoverageCellsPage>>(
    `/api/gamification/coverage${suffix}`,
  );
  return {
    cells: data?.cells ?? [],
    nextCursor: data?.nextCursor ? String(data.nextCursor) : null,
    hasMore: Boolean(data?.hasMore),
    totalInViewport: Number(data?.totalInViewport ?? data?.cells?.length ?? 0),
    totalRevealed: Number(data?.totalRevealed ?? data?.cells?.length ?? 0),
  };
}

export async function fetchTurfCrowns(): Promise<
  {
    userId?: number;
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
      userId?: number;
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
  unlockedCityCount?: number;
  stamps: { slug: string; name: string; type: string; firstSeenAt: string }[];
  unlockedCities?: { slug: string; name: string; unlockedAt: string }[];
} | null> {
  return gamificationFetch('/api/gamification/passport');
}

type PassportResponse = NonNullable<Awaited<ReturnType<typeof fetchPassport>>>;
type TurfCrown = Awaited<ReturnType<typeof fetchTurfCrowns>>[number];

export function buildOwnGamificationProfileSummary(
  userId: number,
  districts: AsphaltDistrict[],
  passport: PassportResponse | null,
  crowns: TurfCrown[],
): GamificationProfileSummary {
  const countryDistrict = districts.find((district) => (
    district.type === 'country' || district.slug === 'poland' || district.slug === 'polska'
  )) ?? null;
  const regions = districts.filter((district) => district !== countryDistrict);
  const country = countryDistrict ? {
    slug: countryDistrict.slug,
    name: countryDistrict.name,
    percentComplete: Number(countryDistrict.percentComplete) || 0,
    cellsRevealed: Number(countryDistrict.cellsRevealed) || 0,
    totalCells: Number(countryDistrict.totalCells) || 0,
  } : null;
  const totalRevealedCells = country?.cellsRevealed
    ?? regions.reduce((sum, district) => sum + (Number(district.cellsRevealed) || 0), 0);
  const averagePercent = country?.percentComplete
    ?? (regions.length
      ? regions.reduce((sum, district) => sum + (Number(district.percentComplete) || 0), 0) / regions.length
      : 0);
  const topRegions = [...regions]
    .sort((a, b) => b.percentComplete - a.percentComplete)
    .slice(0, 5)
    .map((district) => ({
      slug: district.slug,
      name: district.name,
      type: district.type ?? 'region',
      cellsRevealed: Number(district.cellsRevealed) || 0,
      totalCells: Number(district.totalCells) || 0,
      percentComplete: Number(district.percentComplete) || 0,
      lastDrivenAt: district.lastDrivenAt ?? null,
    }));
  const fogOfWar = {
    averagePercent,
    country,
    startedRegions: regions.filter((district) => district.cellsRevealed > 0).length,
    completedRegions: regions.filter((district) => district.percentComplete >= 100).length,
    totalRevealedCells,
    totalCells: country?.totalCells ?? regions.reduce((sum, district) => sum + (Number(district.totalCells) || 0), 0),
    topRegions,
  };
  const ownCrowns = crowns.filter((crown) => Number(crown.userId) === Number(userId));
  const activeTerritories = ownCrowns.map((crown) => ({
    regionSlug: crown.regionSlug,
    regionName: crown.regionName,
    regionType: crown.regionType,
    distanceKm: Number(crown.distanceKm) || 0,
    year: crown.year,
    month: crown.month,
  }));
  const latestStamps = [...(passport?.stamps ?? [])]
    .sort((a, b) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt))
    .slice(0, 5);
  return {
    explorationMap: fogOfWar,
    fogOfWar,
    turf: {
      crownCount: ownCrowns.length,
      activeCount: ownCrowns.length,
      crowns: activeTerritories,
      activeTerritories,
      history: [],
      historyCount: 0,
    },
    passport: {
      totalStamps: Number(passport?.totalStamps) || 0,
      cityCount: Number(passport?.cityCount) || 0,
      unlockedCityCount: Number(passport?.unlockedCityCount ?? passport?.cityCount) || 0,
      voivodeshipCount: Number(passport?.voivodeshipCount) || 0,
      latest: latestStamps,
      latestStamps,
      latestCities: (passport?.unlockedCities ?? []).slice(0, 5).map((city) => ({
        slug: city.slug,
        name: city.name,
        type: 'city',
        firstSeenAt: city.unlockedAt,
      })),
    },
  };
}

export async function fetchOwnGamificationProfileSummary(
  userId: number,
): Promise<GamificationProfileSummary> {
  const [districts, passport, crowns] = await Promise.all([
    fetchAsphaltSummary(),
    fetchPassport(),
    fetchTurfCrowns(),
  ]);
  return buildOwnGamificationProfileSummary(userId, districts, passport, crowns);
}

export async function fetchGamificationStatus(): Promise<{
  activeDrops: number;
  buffers: number;
  bufferedPings: number;
  cachedModes: number;
  activeDrivers?: number;
  lastFlushAt: number;
  lastFlushUserId: number | null;
  lastFlushPingCount: number;
  activityCoverageSync?: {
    pending: number;
    lastRunAt?: string | null;
    lastActivityId?: number | null;
    lastProcessed?: number;
    lastFailed?: number;
    lastError?: string | null;
  };
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
