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
const DRIVE_PACK_PREFIX = 'vroom-drive-corridor-';
const MAX_ACTIVE_PACKS = 4;

const inflight = new Set<string>();
let mutationQueue: Promise<void> = Promise.resolve();

function enqueueMutation(work: () => Promise<void>): Promise<void> {
  const next = mutationQueue.then(work, work);
  mutationQueue = next.catch(() => {});
  return next;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function drivePackName(styleURL: string, center: LatLng): string {
  const cell = `${center.latitude.toFixed(2)}:${center.longitude.toFixed(2)}:${styleURL}`;
  return `${DRIVE_PACK_PREFIX}${shortHash(cell)}`;
}

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
  await enqueueMutation(async () => {
    await safeCreatePack({
      name,
      styleURL,
      bounds,
      minZoom: 11,
      maxZoom: 15,
      metadata: { kind: 'navigation', touchedAt: Date.now() },
    });
    await pruneOldPacks(new Set([name]));
  });
}

export async function prefetchDriveCorridorPack(
  styleURL: string,
  center: LatLng,
): Promise<void> {
  if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) return;

  const name = drivePackName(styleURL, center);
  await enqueueMutation(async () => {
    await safeCreatePack({
      name,
      styleURL,
      bounds: boundsAroundCenter(center.latitude, center.longitude, 0.09),
      minZoom: 11,
      maxZoom: 16,
      metadata: { kind: 'driving', touchedAt: Date.now() },
    });
    const packs = await Mapbox.offlineManager.getPacks().catch(() => []);
    for (const pack of packs) {
      if (pack.name?.startsWith(DRIVE_PACK_PREFIX) && pack.name !== name) {
        await Mapbox.offlineManager.deletePack(pack.name).catch(() => {});
      }
    }
  });
}

export async function deleteDriveCorridorPack(): Promise<void> {
  await enqueueMutation(async () => {
    const packs = await Mapbox.offlineManager.getPacks().catch(() => []);
    for (const pack of packs) {
      if (pack.name?.startsWith(DRIVE_PACK_PREFIX)) {
        await Mapbox.offlineManager.deletePack(pack.name).catch(() => {});
      }
    }
  });
}
