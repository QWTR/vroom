import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return { storage };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { mocks.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { mocks.storage.delete(key); }),
  },
}));

vi.mock('../constants/config', () => ({ API_URL: 'https://api.test', REQUEST_TIMEOUT_MS: 10_000 }));

import {
  buildOwnGamificationProfileSummary,
  fetchCityTerritories,
  fetchCityTerritoryDetail,
  flushGamificationPingOutbox,
  ingestGamificationPing,
  isIdempotentGeoDropClaim,
} from './gamificationClient';
import { clearAuthTokenMemory } from './api/authTokenMemory';

const OUTBOX_KEY = '@vroom/gamification-ping-outbox/v1';

describe('gamification discovery ping outbox', () => {
  beforeEach(() => {
    clearAuthTokenMemory();
    mocks.storage.clear();
    mocks.storage.set('userToken', 'token');
    vi.unstubAllGlobals();
  });

  it('keeps an offline discovery ping and delivers it after connectivity returns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    await expect(ingestGamificationPing({
      lat: 51.1,
      lng: 19.4,
      mode: 'freeDrive',
      ts: 123,
    })).resolves.toBe('queued');

    expect(JSON.parse(mocks.storage.get(OUTBOX_KEY) ?? '[]')).toHaveLength(1);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    await flushGamificationPingOutbox();

    expect(mocks.storage.has(OUTBOX_KEY)).toBe(false);
  });

  it('does not lose discovery when the server is temporarily unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ retryable: true }) })));

    await expect(ingestGamificationPing({
      lat: 51.2,
      lng: 19.5,
      mode: 'navigation',
      ts: 456,
    })).resolves.toBe('queued');

    expect(JSON.parse(mocks.storage.get(OUTBOX_KEY) ?? '[]')).toHaveLength(1);
  });

  it('flushes a bounded live batch instead of blocking on the whole backlog', async () => {
    mocks.storage.set(OUTBOX_KEY, JSON.stringify(Array.from({ length: 20 }, (_, index) => ({
      lat: 51.2 + index * 0.0001,
      lng: 19.5,
      mode: 'freeDrive',
      ts: Date.now() + index,
    }))));
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    await flushGamificationPingOutbox();

    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(JSON.parse(mocks.storage.get(OUTBOX_KEY) ?? '[]')).toHaveLength(8);
  });

});

describe('geo drop claim presentation', () => {
  it('recognizes an idempotent replay so the reward modal is not shown twice', () => {
    expect(isIdempotentGeoDropClaim({ ok: true, alreadyClaimed: true })).toBe(true);
    expect(isIdempotentGeoDropClaim({ ok: true })).toBe(false);
    expect(isIdempotentGeoDropClaim({ ok: false, alreadyClaimed: true })).toBe(false);
  });
});

describe('own profile gamification summary', () => {
  it('uses the country percentage and only crowns owned by the profile user', () => {
    const summary = buildOwnGamificationProfileSummary(7, [
      { slug: 'poland', name: 'Polska', type: 'country', cellsRevealed: 46, totalCells: 230_000, percentComplete: 0.02 },
      { slug: 'mazowieckie', name: 'Mazowieckie', type: 'voivodeship', cellsRevealed: 46, totalCells: 20_000, percentComplete: 0.23 },
    ], {
      totalStamps: 1,
      cityCount: 1,
      unlockedCityCount: 1,
      voivodeshipCount: 1,
      stamps: [{ slug: 'warsaw', name: 'Warszawa', type: 'city', firstSeenAt: '2026-07-14T10:00:00Z' }],
      unlockedCities: [{ slug: 'warsaw', name: 'Warszawa', unlockedAt: '2026-07-14T10:00:00Z' }],
    }, [
      { userId: 7, regionSlug: 'warsaw', regionName: 'Warszawa', username: 'me', distanceKm: 12 },
      { userId: 9, regionSlug: 'krakow', regionName: 'Kraków', username: 'other', distanceKm: 20 },
    ]);

    expect(summary.explorationMap?.averagePercent).toBe(0.02);
    expect(summary.explorationMap?.totalRevealedCells).toBe(46);
    expect(summary.turf.crownCount).toBe(1);
    expect(summary.turf.activeCount).toBe(1);
    expect(summary.passport.unlockedCityCount).toBe(1);
    expect(summary.passport.latestCities?.[0].name).toBe('Warszawa');
  });
});

describe('city territory API contract', () => {
  beforeEach(() => {
    clearAuthTokenMemory();
    mocks.storage.clear();
    mocks.storage.set('userToken', 'token');
    vi.unstubAllGlobals();
  });

  it('loads all city cards and a detail ranking without changing compatibility aliases', async () => {
    const cities = Array.from({ length: 50 }, (_, index) => ({
      slug: `city-${index + 1}`,
      name: `Miasto ${index + 1}`,
      center: { lat: 52, lng: 19 },
      cellsRevealed: index,
      totalCells: 100,
      percentComplete: index,
      unlocked: index >= 20,
      myDistanceKm: 0,
      myRank: null,
      owner: null,
    }));
    const detail = {
      period: { year: 2026, month: 8, timeZone: 'Europe/Warsaw' },
      unlockPercent: 20,
      city: cities[20],
      leaderboard: [{ rank: 1, userId: 2, username: 'Lider', distanceKm: 33, percentComplete: 44 }],
      history: [],
    };
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith('/cities/city-21')
        ? detail
        : { period: detail.period, unlockPercent: 20, cities },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCityTerritories()).resolves.toMatchObject({ unlockPercent: 20, cities });
    await expect(fetchCityTerritoryDetail('city-21')).resolves.toMatchObject({
      city: { unlocked: true },
      leaderboard: [{ username: 'Lider' }],
    });
  });
});
