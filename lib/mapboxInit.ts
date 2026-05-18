import Mapbox from '@rnmapbox/maps';
import { MAPBOX_TOKEN } from '../constants/mapConfig';
import { initMapTileCache } from './mapOffline/MapTileCacheManager';

let mapboxReady = false;

/** Token + offline tile cache — call once at app startup. */
export async function initMapbox(): Promise<void> {
  if (mapboxReady) return;
  Mapbox.setAccessToken(MAPBOX_TOKEN);
  await initMapTileCache();
  mapboxReady = true;
}

export function ensureMapboxToken(): void {
  if (!mapboxReady) {
    Mapbox.setAccessToken(MAPBOX_TOKEN);
  }
}
