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

vi.mock('../constants/config', () => ({ API_URL: 'https://api.test' }));

import {
  flushGamificationPingOutbox,
  ingestGamificationPing,
  queueGamificationRouteCoverage,
} from './gamificationClient';

const OUTBOX_KEY = '@vroom/gamification-ping-outbox/v1';

describe('gamification discovery ping outbox', () => {
  beforeEach(() => {
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

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    await flushGamificationPingOutbox();

    expect(mocks.storage.has(OUTBOX_KEY)).toBe(false);
  });

  it('does not lose discovery when the server is temporarily unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

    await expect(ingestGamificationPing({
      lat: 51.2,
      lng: 19.5,
      mode: 'navigation',
      ts: 456,
    })).resolves.toBe('queued');

    expect(JSON.parse(mocks.storage.get(OUTBOX_KEY) ?? '[]')).toHaveLength(1);
  });

  it('uses a saved trip trace as a one-time discovery fallback', async () => {
    await queueGamificationRouteCoverage({
      tripSessionId: 'trip-history-fallback',
      mode: 'freeDrive',
      routePoints: [
        { latitude: 51.1, longitude: 19.4 },
        { latitude: 51.2, longitude: 19.5 },
      ],
    });
    await queueGamificationRouteCoverage({
      tripSessionId: 'trip-history-fallback',
      mode: 'freeDrive',
      routePoints: [
        { latitude: 51.1, longitude: 19.4 },
        { latitude: 51.2, longitude: 19.5 },
      ],
    });

    expect(JSON.parse(mocks.storage.get(OUTBOX_KEY) ?? '[]')).toHaveLength(2);
  });
});
