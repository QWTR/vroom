import Mapbox from '@rnmapbox/maps';
import { MAPBOX_TOKEN } from '../constants/mapConfig';
import { initMapTileCache } from './mapOffline/MapTileCacheManager';

let mapboxReady = false;

/** Token + offline tile cache — call once at app startup. */
export async function initMapbox(): Promise<void> {
  if (mapboxReady) return;
  Mapbox.setAccessToken(MAPBOX_TOKEN);
  mapboxReady = true;
  // Rendering a map must never wait for cache migration/housekeeping. On a
  // few Android devices that native operation can take a long time, which
  // previously left Route Studio and Offline Navigation as an empty panel.
  void initMapTileCache().catch((error) => {
    if (__DEV__) console.warn('[MapboxInit] tile cache unavailable', error);
  });
}

export function ensureMapboxToken(): void {
  if (!mapboxReady) {
    Mapbox.setAccessToken(MAPBOX_TOKEN);
  }
}
