import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueSpeedLimitReport,
  flushSpeedLimitReportOutbox,
  isTransientSpeedLimitFailure,
  readSpeedLimitReportOutbox,
} from './reportOutbox';
import type { SpeedLimitResolution } from './types';

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
  },
}));

const resolution: SpeedLimitResolution = {
  limitKmh: null,
  source: 'unknown',
  status: 'unknown',
  roadKey: 'osm:way:7',
  roadName: 'Testowa',
  direction: 'forward',
  votes: 0,
  roadRecognized: true,
  roadContextToken: 'signed-road',
};

describe('speed limit report outbox', () => {
  beforeEach(() => storage.clear());

  it('survives storage and exposes an optimistic queued resolution', async () => {
    const item = await enqueueSpeedLimitReport({
      lat: 50,
      lng: 20,
      accuracy: 8,
      limitKmh: 70,
      roadContextToken: 'signed-road',
    }, resolution);
    expect(item.optimisticResolution).toMatchObject({
      limitKmh: 70,
      source: 'community_queued',
      status: 'queued',
    });
    expect(await readSpeedLimitReportOutbox()).toHaveLength(1);
  });

  it('keeps a transient failure and removes a synchronized vote', async () => {
    await enqueueSpeedLimitReport({ lat: 50, lng: 20, accuracy: 8, limitKmh: 70 }, resolution);
    await flushSpeedLimitReportOutbox(async () => ({ kind: 'retry' }));
    expect((await readSpeedLimitReportOutbox())[0].attempts).toBe(1);

    const delivered = await flushSpeedLimitReportOutbox(async () => ({
      kind: 'sent',
      resolution: { ...resolution, limitKmh: 70, source: 'community_pending', status: 'pending' },
    }));
    expect(delivered).toHaveLength(1);
    expect(await readSpeedLimitReportOutbox()).toHaveLength(0);
  });

  it('classifies only retryable HTTP and transport failures as transient', () => {
    expect(isTransientSpeedLimitFailure(null)).toBe(true);
    expect(isTransientSpeedLimitFailure(408)).toBe(true);
    expect(isTransientSpeedLimitFailure(429)).toBe(true);
    expect(isTransientSpeedLimitFailure(503)).toBe(true);
    expect(isTransientSpeedLimitFailure(422)).toBe(false);
  });
});
