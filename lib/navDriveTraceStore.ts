/**
 * Trwały zapis logów jazdy na telefonie (SQLite + plik w Download/).
 *
 * Bez kabla: jedź w trybie jazdy — logi lecą do vroom_nav_drive.log.
 * Po jeździe podłącz USB:  vroom\scripts\adb-dump-vroom-logs.ps1
 *   (ten sam flow co wcześniej: logcat -d | findstr "[VROOM-TEL]")
 * Zapasowo plik: adb-pull-nav-logs.ps1
 *
 * Opcjonalnie: przytrzymaj panel KM/H → Udostępnij.
 */
import * as SQLite from 'expo-sqlite';
import { Share, Alert, Platform } from 'react-native';
import type { VroomGpsLogEntry } from './vroomGpsLog';
import { subscribeVroomGpsLog } from './vroomGpsLog';
import {
  finalizeNavTraceMirrorOnDrivingEnd,
  mirrorNavTraceEntries,
  resetNavTraceMirrorForDrivingStart,
} from './navDriveTraceFileMirror';
import { clearTelemetry, logTelemetry } from './telemetryLogger';
/** Zapis + eksport logów jazdy (wyłącz po diagnozie). */
import { TRIP_PIPELINE_SIMPLE } from './tripPipelineConfig';

export const NAV_DRIVE_TRACE_ENABLED = true;

const DB_NAME = 'vroom_nav_trace.db';
const MAX_ROWS = 15_000;
const FLUSH_MS = 800;
const FLUSH_BATCH_MAX = 80;
const EXPORT_ROW_LIMIT = 4000;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initDone = false;
let unsubscribe: (() => void) | null = null;
const pending: VroomGpsLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function shouldPersistTag(tag: string): boolean {
  if (tag.startsWith('NAV_TRACE_')) return true;
  if (tag.startsWith('SNAP_')) return true;
  if (tag.includes('TELEPORT')) return true;
  if (tag.includes('WORKLET_FEED')) return true;
  if (tag.includes('GPS_TELEPORT')) return true;
  if (tag.startsWith('RESUME_')) return true;
  if (tag.startsWith('SPEED_GHOST') || tag.startsWith('SPEED_ABRUPT')) return true;
  if (tag === 'GHOST_JUMP_HOLD' || tag === 'STATIONARY_HOLD') return true;
  return false;
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS nav_trace (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          t INTEGER NOT NULL,
          tag TEXT NOT NULL,
          payload TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_nav_trace_t ON nav_trace(t);
      `);
      return db;
    })();
  }
  return dbPromise;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, FLUSH_MS);
}

async function flushPending(): Promise<void> {
  if (flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending.splice(0, FLUSH_BATCH_MAX);
  try {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const e of batch) {
        await db.runAsync(
          'INSERT INTO nav_trace (t, tag, payload) VALUES (?, ?, ?)',
          [e.t, e.tag, JSON.stringify(e.payload ?? {})],
        );
      }
    });
    await pruneOldRows(db);
    mirrorNavTraceEntries(batch);
    if (pending.length > 0) scheduleFlush();
  } catch (err) {
    console.warn('[navDriveTraceStore] flush failed', err);
    pending.unshift(...batch);
  } finally {
    flushing = false;
  }
}

async function pruneOldRows(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM nav_trace',
  );
  const count = row?.c ?? 0;
  if (count <= MAX_ROWS) return;
  const drop = count - MAX_ROWS + 400;
  await db.runAsync(
    `DELETE FROM nav_trace WHERE id IN (
      SELECT id FROM nav_trace ORDER BY t ASC LIMIT ?
    )`,
    [drop],
  );
}

export async function initNavDriveTraceStore(): Promise<void> {
  if (!NAV_DRIVE_TRACE_ENABLED || initDone) return;
  initDone = true;
  await getDb();
  if (unsubscribe) return;
  unsubscribe = subscribeVroomGpsLog((entry) => {
    if (!shouldPersistTag(entry.tag)) return;
    pending.push(entry);
    if (pending.length >= FLUSH_BATCH_MAX) {
      void flushPending();
    } else {
      scheduleFlush();
    }
  });
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO nav_trace (t, tag, payload) VALUES (?, ?, ?)',
    [
      Date.now(),
      'NAV_TRACE_SESSION',
      JSON.stringify({
        event: 'app_trace_store_ready',
        platform: Platform.OS,
        tripPipelineSimple: TRIP_PIPELINE_SIMPLE,
      }),
    ],
  ).catch(() => {});
}

export async function getNavTraceStats(): Promise<{
  count: number;
  firstAt: number | null;
  lastAt: number | null;
}> {
  await initNavDriveTraceStore();
  const db = await getDb();
  const countRow = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM nav_trace',
  );
  const span = await db.getFirstAsync<{ firstAt: number | null; lastAt: number | null }>(
    'SELECT MIN(t) as firstAt, MAX(t) as lastAt FROM nav_trace',
  );
  return {
    count: countRow?.c ?? 0,
    firstAt: span?.firstAt ?? null,
    lastAt: span?.lastAt ?? null,
  };
}

export async function buildNavTraceExportText(rowLimit = EXPORT_ROW_LIMIT): Promise<string> {
  await flushPending();
  const db = await getDb();
  const stats = await getNavTraceStats();
  const rows = await db.getAllAsync<{ t: number; tag: string; payload: string | null }>(
    `SELECT t, tag, payload FROM nav_trace ORDER BY t DESC LIMIT ?`,
    [rowLimit],
  );
  rows.reverse();
  const header = [
    '=== VROOM NAV TRACE EXPORT ===',
    `exportedAt: ${new Date().toISOString()}`,
    `platform: ${Platform.OS}`,
    `rows: ${rows.length} (total in db: ${stats.count})`,
    stats.firstAt ? `from: ${new Date(stats.firstAt).toISOString()}` : 'from: —',
    stats.lastAt ? `to: ${new Date(stats.lastAt).toISOString()}` : 'to: —',
    '===',
    '',
  ].join('\n');
  const body = rows.map((r) => {
    const iso = new Date(r.t).toISOString();
    const pl = r.payload ?? '{}';
    return `${iso} [${r.tag}] ${pl}`;
  }).join('\n');
  return `${header}${body}\n`;
}

export async function clearNavTraceLog(): Promise<void> {
  await flushPending();
  const db = await getDb();
  await db.runAsync('DELETE FROM nav_trace');
  pending.length = 0;
}

export async function shareNavTraceLog(): Promise<boolean> {
  if (!NAV_DRIVE_TRACE_ENABLED) {
    Alert.alert('Logi wyłączone', 'NAV_DRIVE_TRACE_ENABLED jest false w kodzie.');
    return false;
  }
  await initNavDriveTraceStore();
  const stats = await getNavTraceStats();
  if (stats.count < 2) {
    Alert.alert(
      'Brak logów jazdy',
      'Zrób krótką jazdę w trybie jazdy, potem przytrzymaj panel prędkości (KM/H) i wybierz udostępnienie.',
    );
    return false;
  }
  const text = await buildNavTraceExportText();
  const from = stats.firstAt ? new Date(stats.firstAt).toLocaleString('pl-PL') : '?';
  const to = stats.lastAt ? new Date(stats.lastAt).toLocaleString('pl-PL') : '?';
  await Share.share({
    title: `VROOM logi jazdy ${from} – ${to}`,
    message: text,
  });
  return true;
}

export async function markNavTraceDrivingSession(event: string, extra?: Record<string, unknown>): Promise<void> {
  if (!NAV_DRIVE_TRACE_ENABLED) return;
  await initNavDriveTraceStore();
  const db = await getDb();
  const row = { event, ...extra };
  await db.runAsync(
    'INSERT INTO nav_trace (t, tag, payload) VALUES (?, ?, ?)',
    [Date.now(), 'NAV_TRACE_SESSION', JSON.stringify(row)],
  );
  if (event === 'driving_start') {
    await clearTelemetry();
    void logTelemetry('DRIVING_START', row);
    await resetNavTraceMirrorForDrivingStart(row);
  } else if (event === 'driving_end') {
    void logTelemetry('DRIVING_END', row);
    await finalizeNavTraceMirrorOnDrivingEnd(row);
  } else {
    mirrorNavTraceEntries([{ t: Date.now(), tag: 'NAV_TRACE_SESSION', payload: row }]);
  }
}

export { NAV_TRACE_ADB_PULL_PATHS, NAV_TRACE_FILE_NAME } from './navDriveTraceFileMirror';
