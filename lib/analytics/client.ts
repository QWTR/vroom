import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { API_URL } from '../../constants/config';
import type { AnalyticsEnvelope, AnalyticsEventInput } from './types';

const DATABASE_NAME = 'vroom_analytics.db';
const MAX_QUEUE_BYTES = 5 * 1024 * 1024;
const MAX_QUEUE_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_BATCH_BYTES = 128 * 1024;
const MAX_BATCH_EVENTS = 50;
const FLUSH_MS = 30_000;
const ACTOR_KEY = '@vroom/analytics/actor';

type QueueRow = { id: string; payload: string; priority: number; createdAt: number; bytes: number; batchId: string | null };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initialized = false;
let collectionEnabled = true;
let eligibilityResolved = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistPromise: Promise<void> | null = null;
let flushing = false;
let sessionId = uuid();
const memoryQueue: QueueRow[] = [];
const sessionImpressions = new Set<string>();

function uuid(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function priorityNumber(priority: AnalyticsEventInput['priority']): number {
  return priority === 'high' ? 2 : priority === 'low' ? 0 : 1;
}

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS analytics_queue (
          id TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          priority INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          bytes INTEGER NOT NULL,
          batchId TEXT
        );
        CREATE INDEX IF NOT EXISTS analytics_queue_created_idx ON analytics_queue(createdAt);
      `);
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(analytics_queue)');
      if (!columns.some((column) => column.name === 'batchId')) {
        await db.execAsync('ALTER TABLE analytics_queue ADD COLUMN batchId TEXT;');
      }
      await db.execAsync('CREATE INDEX IF NOT EXISTS analytics_queue_batch_idx ON analytics_queue(batchId);');
      return db;
    });
  }
  return dbPromise;
}

async function persistMemory(): Promise<void> {
  if (persistPromise) return persistPromise;
  persistPromise = (async () => {
    const rows = memoryQueue.splice(0, memoryQueue.length);
    if (!rows.length) return;
    const db = await database();
    await db.withTransactionAsync(async () => {
      for (const row of rows) {
        await db.runAsync(
          'INSERT OR IGNORE INTO analytics_queue (id, payload, priority, createdAt, bytes) VALUES (?, ?, ?, ?, ?)',
          row.id, row.payload, row.priority, row.createdAt, row.bytes,
        );
      }
    });
    await enforceLocalLimits(db);
  })().finally(() => { persistPromise = null; });
  return persistPromise;
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistMemory();
  }, 750);
}

async function enforceLocalLimits(db: SQLite.SQLiteDatabase): Promise<void> {
  const cutoff = Date.now() - MAX_QUEUE_AGE_MS;
  await db.runAsync('DELETE FROM analytics_queue WHERE createdAt < ?', cutoff);
  let size = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(bytes), 0) AS total FROM analytics_queue');
  while (Number(size?.total || 0) > MAX_QUEUE_BYTES) {
    await db.runAsync(`
      DELETE FROM analytics_queue WHERE id IN (
        SELECT id FROM analytics_queue ORDER BY priority ASC, createdAt ASC LIMIT 100
      )
    `);
    size = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(bytes), 0) AS total FROM analytics_queue');
  }
}

async function anonymousActor(): Promise<string> {
  const existing = await AsyncStorage.getItem(ACTOR_KEY);
  if (existing) return existing;
  const actor = uuid();
  await AsyncStorage.setItem(ACTOR_KEY, actor);
  return actor;
}

async function rolloutEnabled(): Promise<boolean> {
  const forced = await AsyncStorage.getItem('@vroom/analytics/force_enabled');
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  const percent = Math.max(0, Math.min(100, Number(process.env.EXPO_PUBLIC_ANALYTICS_ROLLOUT_PERCENT ?? 100)));
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  const actor = await anonymousActor();
  const bucket = Number.parseInt(actor.replace(/-/g, '').slice(-8), 16) % 100;
  return bucket < percent;
}

export function startAnalyticsSession(): void {
  sessionId = uuid();
  sessionImpressions.clear();
  track({ eventName: 'session_started', priority: 'medium' });
}

export function track(input: AnalyticsEventInput): void {
  if (!collectionEnabled) return;
  const event: AnalyticsEnvelope = {
    ...input,
    eventId: uuid(),
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    sessionId,
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version || 'unknown',
    entityId: input.entityId == null ? undefined : String(input.entityId),
  };
  const payload = JSON.stringify(event);
  const encodedBytes = new TextEncoder().encode(payload).length;
  if (encodedBytes > 4096) return;
  memoryQueue.push({
    id: event.eventId,
    payload,
    priority: priorityNumber(input.priority),
    createdAt: Date.now(),
    bytes: encodedBytes,
  });
  if (eligibilityResolved) schedulePersist();
}

export function trackContentImpression(input: Omit<AnalyticsEventInput, 'eventName'>): void {
  const key = `${input.surface || ''}:${input.entityType || ''}:${input.entityId || ''}`;
  if (sessionImpressions.has(key)) return;
  sessionImpressions.add(key);
  track({ ...input, eventName: 'content_impression', priority: 'low' });
}

export async function flushAnalytics(): Promise<void> {
  if (!eligibilityResolved || !collectionEnabled) return;
  if (flushing) return;
  flushing = true;
  try {
    await persistMemory();
    const db = await database();
    const pendingBatch = await db.getFirstAsync<{ batchId: string }>(
      'SELECT batchId FROM analytics_queue WHERE batchId IS NOT NULL ORDER BY createdAt ASC LIMIT 1',
    );
    const candidates = pendingBatch?.batchId
      ? await db.getAllAsync<QueueRow>(
        'SELECT id, payload, priority, createdAt, bytes, batchId FROM analytics_queue WHERE batchId = ? ORDER BY createdAt ASC LIMIT ?',
        pendingBatch.batchId, MAX_BATCH_EVENTS,
      )
      : await db.getAllAsync<QueueRow>(
        'SELECT id, payload, priority, createdAt, bytes, batchId FROM analytics_queue WHERE batchId IS NULL ORDER BY priority DESC, createdAt ASC LIMIT ?',
        MAX_BATCH_EVENTS,
      );
    if (!candidates.length) return;

    const events: AnalyticsEnvelope[] = [];
    const ids: string[] = [];
    for (const row of candidates) {
      const candidate = JSON.parse(row.payload) as AnalyticsEnvelope;
      const bodySize = new TextEncoder().encode(JSON.stringify({ batchId: uuid(), events: [...events, candidate] })).length;
      if (bodySize > MAX_BATCH_BYTES - 1024) break;
      events.push(candidate);
      ids.push(row.id);
    }
    if (!events.length) return;

    const batchId = pendingBatch?.batchId || uuid();
    if (!pendingBatch?.batchId) {
      const placeholders = ids.map(() => '?').join(',');
      await db.runAsync(`UPDATE analytics_queue SET batchId = ? WHERE id IN (${placeholders})`, batchId, ...ids);
    }
    const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
    const response = await fetch(`${API_URL}/api/analytics/v1/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ batchId, actorKey: token ? undefined : await anonymousActor(), events }),
    });
    if (response.ok || response.status === 400 || response.status === 413) {
      const placeholders = ids.map(() => '?').join(',');
      await db.runAsync(`DELETE FROM analytics_queue WHERE id IN (${placeholders})`, ...ids);
    }
  } catch {
    // Telemetria nigdy nie blokuje funkcji aplikacji ani nie generuje własnej lawiny logów.
  } finally {
    flushing = false;
  }
}

export async function initAnalytics(): Promise<void> {
  if (initialized) return;
  initialized = true;
  collectionEnabled = await rolloutEnabled();
  eligibilityResolved = true;
  if (!collectionEnabled) {
    memoryQueue.splice(0, memoryQueue.length);
    const db = await database();
    await db.runAsync('DELETE FROM analytics_queue');
    return;
  }
  schedulePersist();
  const db = await database();
  await enforceLocalLimits(db);
  startAnalyticsSession();
  flushTimer = setInterval(() => { void flushAnalytics(); }, FLUSH_MS);
  void flushAnalytics();
}

export async function shutdownAnalytics(): Promise<void> {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  await flushAnalytics();
}
