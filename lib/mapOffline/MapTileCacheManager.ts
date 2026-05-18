import Mapbox from '@rnmapbox/maps';

/** Ambient cache — tiles already viewed on device. */
export const AMBIENT_CACHE_BYTES = 2_000_000_000;
/** Soft budget for explicit offline packs (nav / drive corridor). */
export const OFFLINE_PACK_BUDGET_BYTES = 1_000_000_000;

let initialized = false;

export async function initMapTileCache(): Promise<void> {
  if (initialized) return;

  const om = Mapbox.offlineManager;
  if (!om) {
    if (__DEV__) console.warn('[MapTileCache] offlineManager unavailable');
    return;
  }

  try {
    if (typeof om.migrateOfflineCache === 'function') {
      await om.migrateOfflineCache();
    }
  } catch {
    // non-fatal
  }

  try {
    if (typeof om.setMaximumAmbientCacheSize === 'function') {
      await om.setMaximumAmbientCacheSize(AMBIENT_CACHE_BYTES);
    }
    if (typeof om.setTileCountLimit === 'function') {
      om.setTileCountLimit(7500);
    }
  } catch (e) {
    if (__DEV__) console.warn('[MapTileCache] init failed', e);
    return;
  }

  initialized = true;

  if (__DEV__) {
    const packs = await Mapbox.offlineManager.getPacks().catch(() => []);
    console.log('[MapTileCache] ambient max', AMBIENT_CACHE_BYTES, 'packs', packs.length);
  }
}

export function isMapTileCacheInitialized(): boolean {
  return initialized;
}
