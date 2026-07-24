import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SpeedLimitResolution } from './types';

const STORAGE_KEY = '@vroom/speed-limit-report-outbox/v1';

export type SpeedLimitReportInput = {
  lat: number;
  lng: number;
  heading?: number | null;
  accuracy: number;
  limitKmh: number;
  direction?: string | null;
  roadContextToken?: string | null;
};

export type SpeedLimitOutboxItem = {
  id: string;
  createdAt: number;
  attempts: number;
  input: SpeedLimitReportInput;
  optimisticResolution: SpeedLimitResolution;
};

export type SpeedLimitDeliveryResult =
  | { kind: 'sent'; resolution: SpeedLimitResolution }
  | { kind: 'retry' }
  | { kind: 'discard' };

let storageLock: Promise<unknown> = Promise.resolve();

function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageLock.then(operation, operation);
  storageLock = result.then(() => undefined, () => undefined);
  return result;
}

function isOutboxItem(value: unknown): value is SpeedLimitOutboxItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SpeedLimitOutboxItem>;
  return typeof item.id === 'string'
    && Number.isFinite(item.createdAt)
    && !!item.input
    && Number.isFinite(item.input.lat)
    && Number.isFinite(item.input.lng)
    && Number.isFinite(item.input.limitKmh)
    && !!item.optimisticResolution;
}

async function readUnsafe(): Promise<SpeedLimitOutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOutboxItem) : [];
  } catch {
    return [];
  }
}

async function writeUnsafe(items: SpeedLimitOutboxItem[]): Promise<void> {
  if (items.length === 0) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function sameVote(a: SpeedLimitOutboxItem, b: SpeedLimitOutboxItem): boolean {
  const aRoad = a.optimisticResolution.roadKey;
  const bRoad = b.optimisticResolution.roadKey;
  if (aRoad && bRoad) {
    return aRoad === bRoad
      && a.optimisticResolution.direction === b.optimisticResolution.direction
      && a.input.limitKmh === b.input.limitKmh;
  }
  return a.input.roadContextToken === b.input.roadContextToken
    && a.input.limitKmh === b.input.limitKmh;
}

export async function enqueueSpeedLimitReport(
  input: SpeedLimitReportInput,
  current: SpeedLimitResolution,
): Promise<SpeedLimitOutboxItem> {
  const queuedResolution: SpeedLimitResolution = {
    ...current,
    limitKmh: input.limitKmh,
    source: 'community_queued',
    status: 'queued',
    temporarilyUnavailable: false,
    roadRecognized: true,
    roadContextToken: input.roadContextToken ?? current.roadContextToken ?? null,
  };
  const item: SpeedLimitOutboxItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: Date.now(),
    attempts: 0,
    input,
    optimisticResolution: queuedResolution,
  };

  return locked(async () => {
    const items = await readUnsafe();
    const existingIndex = items.findIndex((candidate) => sameVote(candidate, item));
    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      items[existingIndex] = { ...item, id: existing.id, createdAt: existing.createdAt };
    } else {
      items.push(item);
    }
    await writeUnsafe(items);
    return existingIndex >= 0 ? items[existingIndex] : item;
  });
}

export async function flushSpeedLimitReportOutbox(
  deliver: (item: SpeedLimitOutboxItem) => Promise<SpeedLimitDeliveryResult>,
): Promise<SpeedLimitResolution[]> {
  return locked(async () => {
    const items = await readUnsafe();
    const remaining: SpeedLimitOutboxItem[] = [];
    const delivered: SpeedLimitResolution[] = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const result = await deliver(item);
      if (result.kind === 'sent') {
        delivered.push(result.resolution);
        continue;
      }
      if (result.kind === 'discard') continue;
      remaining.push({ ...item, attempts: item.attempts + 1 });
      remaining.push(...items.slice(index + 1));
      break;
    }

    await writeUnsafe(remaining);
    return delivered;
  });
}

export async function readSpeedLimitReportOutbox(): Promise<SpeedLimitOutboxItem[]> {
  return locked(readUnsafe);
}

export function isTransientSpeedLimitFailure(status: number | null): boolean {
  return status == null || status === 408 || status === 429 || status >= 500;
}

