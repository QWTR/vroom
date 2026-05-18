import Mapbox from '@rnmapbox/maps';
type OfflinePackOptions = {
  name: string;
  styleURL: string;
  bounds: [[number, number], [number, number]];
  tilesets?: string[];
  minZoom?: number;
  maxZoom?: number;
  metadata?: Record<string, unknown>;
};
import { boundsAroundCenter, boundsFromPoints, type LatLng } from './mapTileBounds';

const NAV_PACK_PREFIX = 'vroom-nav-';
const DRIVE_PACK_NAME = 'vroom-drive-corridor';
const MAX_ACTIVE_PACKS = 4;

const inflight = new Set<string>();

function packExists(name: string, packs: { name?: string }[]): boolean {
  return packs.some((p) => p.name === name);
}

async function safeCreatePack(options: OfflinePackOptions): Promise<void> {
  if (inflight.has(options.name)) return;
  inflight.add(options.name);

  try {
    const packs = await Mapbox.offlineManager.getPacks();
    if (packExists(options.name, packs)) {
      return;
    }

    await Mapbox.offlineManager.createPack(
      options,
      () => {},
      (pack, err) => {
        if (__DEV__) {
          console.warn('[MapTilePrefetch] pack error', pack?.name ?? options.name, err?.message);
        }
      },
    );
  } catch (e) {
    if (__DEV__) {
      console.warn('[MapTilePrefetch] createPack failed', options.name, e);
    }
  } finally {
    inflight.delete(options.name);
  }
}

async function pruneOldPacks(keepNames: Set<string>): Promise<void> {
  try {
    const packs = await Mapbox.offlineManager.getPacks();
    const navPacks = packs.filter((p) => p.name?.startsWith(NAV_PACK_PREFIX));
    if (navPacks.length <= MAX_ACTIVE_PACKS) return;

    const toDelete = navPacks
      .filter((p) => p.name && !keepNames.has(p.name))
      .slice(0, navPacks.length - MAX_ACTIVE_PACKS);

    for (const p of toDelete) {
      if (p.name) {
        await Mapbox.offlineManager.deletePack(p.name).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

export async function prefetchNavigationPack(
  routeKey: string,
  styleURL: string,
  routePoints: LatLng[],
): Promise<void> {
  const bounds = boundsFromPoints(routePoints, 0.05);
  if (!bounds) return;

  const name = `${NAV_PACK_PREFIX}${routeKey}`;
  await safeCreatePack({
    name,
    styleURL,
    bounds,
    minZoom: 10,
    maxZoom: 16,
    metadata: { kind: 'navigation' },
  });
  await pruneOldPacks(new Set([name, DRIVE_PACK_NAME]));
}

export async function prefetchDriveCorridorPack(
  styleURL: string,
  center: LatLng,
): Promise<void> {
  if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) return;

  await safeCreatePack({
    name: DRIVE_PACK_NAME,
    styleURL,
    bounds: boundsAroundCenter(center.latitude, center.longitude, 0.07),
    minZoom: 11,
    maxZoom: 16,
    metadata: { kind: 'driving' },
  });
}

export async function deleteDriveCorridorPack(): Promise<void> {
  await Mapbox.offlineManager.deletePack(DRIVE_PACK_NAME).catch(() => {});
}
