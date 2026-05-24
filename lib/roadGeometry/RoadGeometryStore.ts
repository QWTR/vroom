import { NativeModules } from 'react-native';
import type { RoadPoint } from './RoadGeometryStore.types';
import { asyncFindInBbox, asyncFindNearest, asyncInsert } from './roadGeometryAsyncStorage';

export type { RoadPoint } from './RoadGeometryStore.types';

type Backend = 'sqlite' | 'asyncStorage';

let backend: Backend | null = null;
let sqliteModule: typeof import('./roadGeometrySqlite') | null = null;

function nativeSqliteAvailable(): boolean {
  return Boolean((NativeModules as Record<string, unknown>).ExpoSQLite);
}

async function resolveBackend(): Promise<Backend> {
  if (backend) return backend;

  if (nativeSqliteAvailable()) {
    try {
      sqliteModule = await import('./roadGeometrySqlite');
      backend = 'sqlite';
      if (__DEV__) console.log('[RoadGeometryStore] using expo-sqlite');
      return backend;
    } catch (e) {
      if (__DEV__) console.warn('[RoadGeometryStore] sqlite init failed, fallback AsyncStorage', e);
    }
  }

  backend = 'asyncStorage';
  if (__DEV__) {
    console.log('[RoadGeometryStore] using AsyncStorage (install native build for SQLite)');
  }
  return backend;
}

class RoadGeometryStoreImpl {
  async insert(points: RoadPoint[]): Promise<void> {
    const mode = await resolveBackend();
    if (mode === 'sqlite' && sqliteModule) {
      await sqliteModule.sqliteInsert(points);
    } else {
      await asyncInsert(points);
    }
  }

  async findNearest(
    lat: number,
    lng: number,
    radiusM: number,
  ): Promise<{ points: RoadPoint[]; ageMs: number } | null> {
    const mode = await resolveBackend();
    if (mode === 'sqlite' && sqliteModule) {
      return sqliteModule.sqliteFindNearest(lat, lng, radiusM);
    }
    return asyncFindNearest(lat, lng, radiusM);
  }

  /** Segmenty drogi z lokalnego cache (SQLite / AsyncStorage) w bbox trasy. */
  async findInBbox(
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
    limit = 24,
  ): Promise<RoadPoint[][]> {
    const mode = await resolveBackend();
    if (mode === 'sqlite' && sqliteModule) {
      return sqliteModule.sqliteFindInBbox(minLat, maxLat, minLng, maxLng, limit);
    }
    return asyncFindInBbox(minLat, maxLat, minLng, maxLng, limit);
  }

  /**
   * v10: Prefetch geometrii calej trasy do cache - jednorazowo przy starcie nav.
   * Dzieli route na segmenty po N punktow i persistuje kazdy do cache (z drobnym
   * overlap). Pozniej w czasie jazdy findNearest na tych obszarach trafia od razu
   * w cache zamiast wolac Map Matching API.
   *
   * Bezpieczne do wywolania wielokrotnie - jesli segmenty juz w cache, insert
   * sie zduplicuje ale TTL/CAP eviction sobie z tym poradzi.
   */
  async prefetchAroundRoute(routePts: RoadPoint[]): Promise<void> {
    if (!Array.isArray(routePts) || routePts.length < 4) return;
    const CHUNK_SIZE = 80; // ~80 punktow = ~800-2000m segmentu zaleznie od densitu
    const OVERLAP = 5;
    try {
      for (let i = 0; i < routePts.length; i += CHUNK_SIZE - OVERLAP) {
        const chunk = routePts.slice(i, Math.min(routePts.length, i + CHUNK_SIZE));
        if (chunk.length >= 2) {
          await this.insert(chunk);
        }
      }
    } catch (e) {
      if (__DEV__) console.warn('[RoadGeometryStore] prefetchAroundRoute failed', e);
    }
  }
}

export const roadGeometryStore = new RoadGeometryStoreImpl();

export async function isRoadGeometryCacheAvailable(): Promise<boolean> {
  const mode = await resolveBackend();
  return mode === 'sqlite';
}
