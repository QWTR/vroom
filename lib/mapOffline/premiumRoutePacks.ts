import Mapbox from '@rnmapbox/maps';
import * as SQLite from 'expo-sqlite';
import { corridorRegions, estimateCorridorDownload, PREMIUM_OFFLINE_GEOMETRY, type OfflineRoutePoint } from './premiumRoutePackGeometry';

export type { OfflineRoutePoint } from './premiumRoutePackGeometry';
export type OfflineInstruction = { distance?: number; duration?: number; text?: string; maneuver?: string };
export type PremiumOfflinePackStatus = 'queued' | 'downloading' | 'paused' | 'ready' | 'error';

export type PremiumOfflineRoutePack = {
  routeId: number;
  routeName: string;
  styleURL: string;
  status: PremiumOfflinePackStatus;
  progress: number;
  estimatedBytes: number;
  downloadedBytes: number;
  regionNames: string[];
  routePoints: OfflineRoutePoint[];
  instructions: OfflineInstruction[];
  error: string | null;
  updatedAt: number;
};

const DB_NAME = 'vroom_premium_offline.db';
const PACK_PREFIX = 'vroom-premium-route-';
const MAX_LOGICAL_PACKS = 3;
const TILE_LIMIT = PREMIUM_OFFLINE_GEOMETRY.tileLimit;
const BUFFER_KM = PREMIUM_OFFLINE_GEOMETRY.bufferKm;
const MIN_ZOOM = PREMIUM_OFFLINE_GEOMETRY.minZoom;
const MAX_ZOOM = PREMIUM_OFFLINE_GEOMETRY.maxZoom;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let mutationQueue: Promise<unknown> = Promise.resolve();

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (database) => {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS premium_route_packs (
          route_id INTEGER PRIMARY KEY NOT NULL,
          route_name TEXT NOT NULL,
          style_url TEXT NOT NULL,
          status TEXT NOT NULL,
          progress REAL NOT NULL DEFAULT 0,
          estimated_bytes INTEGER NOT NULL DEFAULT 0,
          downloaded_bytes INTEGER NOT NULL DEFAULT 0,
          region_names_json TEXT NOT NULL,
          route_points_json TEXT NOT NULL,
          instructions_json TEXT NOT NULL,
          error TEXT,
          updated_at INTEGER NOT NULL
        );
      `);
      return database;
    });
  }
  return dbPromise;
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(work, work) as Promise<T>;
  mutationQueue = next.catch(() => undefined);
  return next;
}

function json<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function validPoints(points: OfflineRoutePoint[]): OfflineRoutePoint[] {
  return (Array.isArray(points) ? points : []).filter((point) =>
    Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
      && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180,
  );
}

function rowToPack(row: any): PremiumOfflineRoutePack {
  return {
    routeId: row.route_id,
    routeName: row.route_name,
    styleURL: row.style_url,
    status: row.status,
    progress: row.progress,
    estimatedBytes: row.estimated_bytes,
    downloadedBytes: row.downloaded_bytes,
    regionNames: json(row.region_names_json, []),
    routePoints: json(row.route_points_json, []),
    instructions: json(row.instructions_json, []),
    error: row.error ?? null,
    updatedAt: row.updated_at,
  };
}

export { corridorRegions, estimateCorridorDownload } from './premiumRoutePackGeometry';

export async function listPremiumOfflinePacks(): Promise<PremiumOfflineRoutePack[]> {
  const database = await db();
  const rows = await database.getAllAsync<any>('SELECT * FROM premium_route_packs ORDER BY updated_at DESC');
  return rows.map(rowToPack);
}

async function updateStatus(routeId: number, status: PremiumOfflinePackStatus, patch: { progress?: number; downloadedBytes?: number; error?: string | null } = {}) {
  const database = await db();
  await database.runAsync(
    `UPDATE premium_route_packs SET status = ?, progress = COALESCE(?, progress), downloaded_bytes = COALESCE(?, downloaded_bytes), error = ?, updated_at = ? WHERE route_id = ?`,
    [status, patch.progress ?? null, patch.downloadedBytes ?? null, patch.error ?? null, Date.now(), routeId],
  );
}

export async function downloadPremiumRoutePack(input: {
  routeId: number;
  routeName: string;
  styleURL: string;
  routePoints: OfflineRoutePoint[];
  instructions?: OfflineInstruction[];
  isPremium: boolean;
  networkType?: 'wifi' | 'cellular' | 'unknown';
  allowCellular?: boolean;
}): Promise<PremiumOfflineRoutePack> {
  return enqueue(async () => {
    if (!input.isPremium) throw new Error('PREMIUM_REQUIRED');
    if (input.networkType === 'cellular' && !input.allowCellular) throw new Error('WIFI_REQUIRED');
    const points = validPoints(input.routePoints);
    const regions = corridorRegions(points);
    if (!Number.isInteger(input.routeId) || input.routeId <= 0 || regions.length === 0) throw new Error('INVALID_ROUTE');
    const estimate = estimateCorridorDownload(points);
    if (estimate.tiles > TILE_LIMIT) throw new Error('MAPBOX_TILE_LIMIT');
    const database = await db();
    const existing = await database.getFirstAsync<{ route_id: number }>('SELECT route_id FROM premium_route_packs WHERE route_id = ?', [input.routeId]);
    const count = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM premium_route_packs');
    if (!existing && (count?.count ?? 0) >= MAX_LOGICAL_PACKS) throw new Error('OFFLINE_PACK_LIMIT');
    if (existing) await deletePremiumRoutePackNow(input.routeId);

    const regionNames = regions.map((_, index) => `${PACK_PREFIX}${input.routeId}-${index}`);
    await database.runAsync(
      `INSERT OR REPLACE INTO premium_route_packs
       (route_id, route_name, style_url, status, progress, estimated_bytes, downloaded_bytes, region_names_json, route_points_json, instructions_json, error, updated_at)
       VALUES (?, ?, ?, 'queued', 0, ?, 0, ?, ?, ?, NULL, ?)`,
      [input.routeId, input.routeName.slice(0, 120), input.styleURL, estimate.bytes, JSON.stringify(regionNames), JSON.stringify(points), JSON.stringify(input.instructions ?? []), Date.now()],
    );
    Mapbox.offlineManager.setTileCountLimit(TILE_LIMIT);

    let totalProgress = 0;
    let totalBytes = 0;
    const progressByName = new Map<string, { progress: number; bytes: number }>();
    for (let index = 0; index < regions.length; index += 1) {
      const name = regionNames[index];
      await Mapbox.offlineManager.createPack({
        name,
        styleURL: input.styleURL,
        bounds: regions[index],
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        metadata: { kind: 'premium-route', routeId: input.routeId, index, updatedAt: Date.now() },
      }, (_pack, status) => {
        progressByName.set(name, { progress: status.percentage || 0, bytes: status.completedResourceSize || status.completedTileSize || 0 });
        totalProgress = [...progressByName.values()].reduce((sum, item) => sum + item.progress, 0) / regions.length;
        totalBytes = [...progressByName.values()].reduce((sum, item) => sum + item.bytes, 0);
        updateStatus(input.routeId, totalProgress >= 100 ? 'ready' : 'downloading', { progress: totalProgress, downloadedBytes: totalBytes }).catch(() => {});
      }, (_pack, error) => updateStatus(input.routeId, 'error', { error: error.message }).catch(() => {}));
    }
    await updateStatus(input.routeId, totalProgress >= 100 ? 'ready' : 'downloading', { progress: totalProgress, downloadedBytes: totalBytes });
    return (await listPremiumOfflinePacks()).find((pack) => pack.routeId === input.routeId)!;
  });
}

export async function pausePremiumRoutePack(routeId: number): Promise<void> {
  const pack = (await listPremiumOfflinePacks()).find((item) => item.routeId === routeId);
  if (!pack) throw new Error('NOT_FOUND');
  await Promise.all(pack.regionNames.map(async (name) => (await Mapbox.offlineManager.getPack(name))?.pause()));
  await updateStatus(routeId, 'paused');
}

export async function resumePremiumRoutePack(routeId: number, isPremium: boolean): Promise<void> {
  if (!isPremium) throw new Error('PREMIUM_REQUIRED');
  const pack = (await listPremiumOfflinePacks()).find((item) => item.routeId === routeId);
  if (!pack) throw new Error('NOT_FOUND');
  await Promise.all(pack.regionNames.map(async (name) => (await Mapbox.offlineManager.getPack(name))?.resume()));
  await updateStatus(routeId, 'downloading');
}

export async function updatePremiumRoutePack(routeId: number, isPremium: boolean): Promise<void> {
  if (!isPremium) throw new Error('PREMIUM_REQUIRED');
  const pack = (await listPremiumOfflinePacks()).find((item) => item.routeId === routeId);
  if (!pack) throw new Error('NOT_FOUND');
  await Promise.all(pack.regionNames.map((name) => Mapbox.offlineManager.invalidatePack(name)));
  await updateStatus(routeId, 'downloading');
}

async function deletePremiumRoutePackNow(routeId: number): Promise<void> {
  const database = await db();
  const row = await database.getFirstAsync<any>('SELECT * FROM premium_route_packs WHERE route_id = ?', [routeId]);
  if (!row) return;
  const names = json<string[]>(row.region_names_json, []);
  for (const name of names) await Mapbox.offlineManager.deletePack(name).catch(() => {});
  await database.runAsync('DELETE FROM premium_route_packs WHERE route_id = ?', [routeId]);
}

export async function deletePremiumRoutePack(routeId: number): Promise<void> {
  return enqueue(() => deletePremiumRoutePackNow(routeId));
}

export async function enforcePremiumOfflineEntitlement(isPremium: boolean): Promise<void> {
  if (isPremium) return;
  const packs = await listPremiumOfflinePacks();
  for (const pack of packs) await deletePremiumRoutePack(pack.routeId);
  const native = await Mapbox.offlineManager.getPacks().catch(() => []);
  for (const pack of native) {
    if (pack.name?.startsWith(PACK_PREFIX)) await Mapbox.offlineManager.deletePack(pack.name).catch(() => {});
  }
}

export const PREMIUM_OFFLINE_LIMITS = { maxPacks: MAX_LOGICAL_PACKS, bufferKm: BUFFER_KM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, tileLimit: TILE_LIMIT } as const;
