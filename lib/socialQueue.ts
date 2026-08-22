import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { queryClient } from './query/client';
import { apiRequest, ApiRequestError, type ApiRequestOptions } from './api/client';

export type SocialQueueStatus = 'pending' | 'sending' | 'completed' | 'failed';
export type SocialQueueEvent = {
  operationId: string;
  type: string;
  entityKey: string;
  status: SocialQueueStatus;
  response?: unknown;
  error?: string;
};

type QueuedMultipartFile = {
  fieldName: string;
  uri: string;
  name: string;
  type: string;
};

export type QueuedRequest = {
  path: string;
  method: ApiRequestOptions['method'];
  body?: unknown;
  multipart?: {
    fields?: Record<string, string>;
    files: QueuedMultipartFile[];
  };
  optimisticEntity?: unknown;
  invalidateKeys?: unknown[][];
};

type QueueRow = {
  operationId: string;
  userId: number;
  type: string;
  entityKey: string;
  requestJson: string;
  status: SocialQueueStatus;
  attempts: number;
  nextAttemptAt: number;
};

const DB_NAME = 'vroom-social-queue-v2.db';
const listeners = new Set<(event: SocialQueueEvent) => void>();
let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;
let draining: Promise<void> | null = null;

function emit(event: SocialQueueEvent) {
  listeners.forEach((listener) => {
    try { listener(event); } catch { /* one listener cannot block the queue */ }
  });
}

function createOperationId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function database() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS social_queue (
          operationId TEXT PRIMARY KEY NOT NULL,
          userId INTEGER NOT NULL,
          type TEXT NOT NULL,
          entityKey TEXT NOT NULL,
          requestJson TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          nextAttemptAt INTEGER NOT NULL,
          lastError TEXT,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS social_queue_status_next_idx
          ON social_queue(status, nextAttemptAt, createdAt);
        CREATE INDEX IF NOT EXISTS social_queue_user_entity_idx
          ON social_queue(userId, entityKey, createdAt);
      `);
      await db.runAsync(
        `UPDATE social_queue SET status = 'pending', nextAttemptAt = ?, updatedAt = ? WHERE status = 'sending'`,
        Date.now(), Date.now(),
      );
      return db;
    });
  }
  return databasePromise;
}

export async function enqueueSocialOperation(input: {
  userId: number;
  type: string;
  entityKey: string;
  request: QueuedRequest;
  coalesce?: boolean;
  operationId?: string;
}): Promise<string> {
  const db = await database();
  const now = Date.now();
  const operationId = input.operationId || createOperationId(input.type);
  await db.withTransactionAsync(async () => {
    if (input.coalesce) {
      await db.runAsync(
        `DELETE FROM social_queue
         WHERE userId = ? AND entityKey = ? AND status IN ('pending', 'failed')`,
        input.userId,
        input.entityKey,
      );
    }
    await db.runAsync(
      `INSERT INTO social_queue
       (operationId, userId, type, entityKey, requestJson, status, attempts, nextAttemptAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
      operationId,
      input.userId,
      input.type,
      input.entityKey,
      JSON.stringify(input.request),
      now,
      now,
      now,
    );
  });
  emit({ operationId, type: input.type, entityKey: input.entityKey, status: 'pending' });
  void drainSocialQueue(input.userId);
  return operationId;
}

function retryDelay(attempt: number): number {
  return Math.min(15 * 60_000, 1000 * 2 ** Math.min(attempt, 9));
}

async function processRow(db: Awaited<ReturnType<typeof database>>, row: QueueRow) {
  const request = JSON.parse(row.requestJson) as QueuedRequest;
  await db.runAsync(
    `UPDATE social_queue SET status = 'sending', attempts = attempts + 1, updatedAt = ? WHERE operationId = ?`,
    Date.now(),
    row.operationId,
  );
  emit({ operationId: row.operationId, type: row.type, entityKey: row.entityKey, status: 'sending' });
  try {
    let body = request.body;
    if (request.multipart) {
      const form = new FormData();
      for (const [key, value] of Object.entries(request.multipart.fields || {})) {
        form.append(key, value);
      }
      if (!request.multipart.fields?.clientRequestId) {
        form.append('clientRequestId', row.operationId);
      }
      for (const file of request.multipart.files) {
        form.append(file.fieldName, {
          uri: file.uri,
          name: file.name,
          type: file.type,
        } as any);
      }
      body = form;
    }
    const response = await apiRequest(request.path, {
      method: request.method,
      body,
      idempotencyKey: row.operationId,
      priority: 'mutation',
    });
    await db.runAsync(
      `UPDATE social_queue SET status = 'completed', lastError = NULL, updatedAt = ? WHERE operationId = ?`,
      Date.now(),
      row.operationId,
    );
    for (const key of request.invalidateKeys || []) {
      await queryClient.invalidateQueries({ queryKey: key });
    }
    emit({ operationId: row.operationId, type: row.type, entityKey: row.entityKey, status: 'completed', response });
    if (request.multipart?.files.length) {
      await Promise.all(request.multipart.files.map(async (file) => {
        try { await FileSystem.deleteAsync(file.uri, { idempotent: true }); } catch { /* cache cleanup is best-effort */ }
      }));
    }
  } catch (error) {
    const retryable = !(error instanceof ApiRequestError) || error.retryable;
    const message = error instanceof Error ? error.message : String(error);
    const attempts = row.attempts + 1;
    await db.runAsync(
      `UPDATE social_queue
       SET status = ?, nextAttemptAt = ?, lastError = ?, updatedAt = ?
       WHERE operationId = ?`,
      retryable ? 'pending' : 'failed',
      Date.now() + retryDelay(attempts),
      message.slice(0, 1000),
      Date.now(),
      row.operationId,
    );
    emit({ operationId: row.operationId, type: row.type, entityKey: row.entityKey, status: retryable ? 'pending' : 'failed', error: message });
    if (retryable) throw error;
  }
}

export async function drainSocialQueue(userId?: number): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    const db = await database();
    await db.runAsync(
      `DELETE FROM social_queue WHERE status = 'completed' AND updatedAt < ?`,
      Date.now() - 24 * 60 * 60_000,
    );
    for (;;) {
      const row = await db.getFirstAsync<QueueRow>(
        `SELECT operationId, userId, type, entityKey, requestJson, status, attempts, nextAttemptAt
         FROM social_queue
         WHERE status = 'pending' AND nextAttemptAt <= ? ${userId ? 'AND userId = ?' : ''}
         ORDER BY createdAt ASC LIMIT 1`,
        ...(userId ? [Date.now(), userId] : [Date.now()]),
      );
      if (!row) return;
      try {
        await processRow(db, row);
      } catch {
        return;
      }
    }
  })().finally(() => { draining = null; });
  return draining;
}

export async function retrySocialOperation(operationId: string): Promise<void> {
  const db = await database();
  await db.runAsync(
    `UPDATE social_queue SET status = 'pending', nextAttemptAt = ?, lastError = NULL, updatedAt = ? WHERE operationId = ?`,
    Date.now(), Date.now(), operationId,
  );
  void drainSocialQueue();
}

export async function removeSocialOperation(operationId: string): Promise<void> {
  const db = await database();
  await db.runAsync(`DELETE FROM social_queue WHERE operationId = ?`, operationId);
}

export async function listSocialOperations(input: {
  userId?: number;
  entityKey?: string;
  statuses?: SocialQueueStatus[];
} = {}): Promise<Array<{
  operationId: string;
  userId: number;
  type: string;
  entityKey: string;
  status: SocialQueueStatus;
  request: QueuedRequest;
}>> {
  const db = await database();
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (input.userId) { conditions.push('userId = ?'); params.push(input.userId); }
  if (input.entityKey) { conditions.push('entityKey = ?'); params.push(input.entityKey); }
  const statuses = input.statuses?.length ? input.statuses : ['pending', 'sending', 'failed'];
  conditions.push(`status IN (${statuses.map(() => '?').join(',')})`);
  params.push(...statuses);
  const rows = await db.getAllAsync<QueueRow>(
    `SELECT operationId, userId, type, entityKey, requestJson, status, attempts, nextAttemptAt
     FROM social_queue WHERE ${conditions.join(' AND ')} ORDER BY createdAt ASC`,
    ...params,
  );
  return rows.map(row => ({
    operationId: row.operationId,
    userId: row.userId,
    type: row.type,
    entityKey: row.entityKey,
    status: row.status,
    request: JSON.parse(row.requestJson) as QueuedRequest,
  }));
}

export async function clearSocialQueue(): Promise<void> {
  const db = await database();
  await db.execAsync('DELETE FROM social_queue;');
  const root = `${FileSystem.documentDirectory}social-queue-v2/`;
  await FileSystem.deleteAsync(root, { idempotent: true }).catch(() => {});
}

export async function copyMediaToSocialQueue(uri: string): Promise<string> {
  const root = `${FileSystem.documentDirectory}social-queue-v2/`;
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  const extension = uri.split('?')[0].split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const destination = `${root}${createOperationId('media')}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

export function subscribeSocialQueue(listener: (event: SocialQueueEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
