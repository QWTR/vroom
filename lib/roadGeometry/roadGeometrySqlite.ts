import * as SQLite from 'expo-sqlite';
import type { RoadPoint } from './RoadGeometryStore.types';

type SegmentRow = {
  id: number;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  points_json: string;
  updated_at: number;
};

const DB_NAME = 'vroom_road_geometry.db';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SEGMENTS = 800;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS road_segments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          min_lat REAL NOT NULL,
          max_lat REAL NOT NULL,
          min_lng REAL NOT NULL,
          max_lng REAL NOT NULL,
          points_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_road_bbox ON road_segments (min_lat, max_lat, min_lng, max_lng);
      `);
      return db;
    })();
  }
  return dbPromise;
}

function simplifyPolyline(points: RoadPoint[], maxPoints: number): RoadPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: RoadPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1]?.latitude !== last.latitude) out.push(last);
  return out;
}

function parsePoints(json: string): RoadPoint[] {
  try {
    const raw = JSON.parse(json) as RoadPoint[];
    return Array.isArray(raw)
      ? raw.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      : [];
  } catch {
    return [];
  }
}

export async function sqliteInsert(points: RoadPoint[]): Promise<void> {
  if (points.length < 2) return;
  const db = await getDb();
  const simplified = simplifyPolyline(points, 500);
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of simplified) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  }
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO road_segments (min_lat, max_lat, min_lng, max_lng, points_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [minLat, maxLat, minLng, maxLng, JSON.stringify(simplified), now],
  );
  await db.runAsync(`DELETE FROM road_segments WHERE updated_at < ?`, [now - TTL_MS]);
  const count = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM road_segments`);
  if ((count?.c ?? 0) > MAX_SEGMENTS) {
    const excess = (count?.c ?? 0) - MAX_SEGMENTS;
    await db.runAsync(
      `DELETE FROM road_segments WHERE id IN (
        SELECT id FROM road_segments ORDER BY updated_at ASC LIMIT ?
      )`,
      [excess],
    );
  }
}

export async function sqliteFindNearest(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<{ points: RoadPoint[]; ageMs: number } | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const db = await getDb();
  const deg = radiusM / 111_000;
  const now = Date.now();
  const rows = await db.getAllAsync<SegmentRow>(
    `SELECT * FROM road_segments
     WHERE updated_at >= ?
       AND min_lat <= ? AND max_lat >= ?
       AND min_lng <= ? AND max_lng >= ?
     ORDER BY updated_at DESC
     LIMIT 12`,
    [now - TTL_MS, lat + deg, lat - deg, lng + deg, lng - deg],
  );

  let best: { points: RoadPoint[]; distM: number; ageMs: number } | null = null;
  for (const row of rows) {
    const pts = parsePoints(row.points_json);
    if (pts.length < 2) continue;
    let minDist = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const midLat = (pts[i].latitude + pts[i + 1].latitude) / 2;
      const midLng = (pts[i].longitude + pts[i + 1].longitude) / 2;
      const dLat = (midLat - lat) * 111_000;
      const dLng = (midLng - lng) * 111_000 * Math.cos((lat * Math.PI) / 180);
      minDist = Math.min(minDist, Math.sqrt(dLat * dLat + dLng * dLng));
    }
    if (minDist <= radiusM && (!best || minDist < best.distM)) {
      best = { points: pts, distM: minDist, ageMs: now - row.updated_at };
    }
  }
  return best ? { points: best.points, ageMs: best.ageMs } : null;
}
