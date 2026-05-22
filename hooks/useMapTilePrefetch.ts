import { useEffect, useRef } from 'react';
import {
  prefetchDriveCorridorPack,
  prefetchNavigationPack,
  deleteDriveCorridorPack,
} from '../lib/mapOffline/mapTilePrefetch';
import type { LatLng } from '../lib/mapOffline/mapTileBounds';
import { haversineKm } from '../scripts/navigationUtils';

type Options = {
  isNavigating: boolean;
  isDriving: boolean;
  mapStyleURL: string;
  routePoints: LatLng[];
  routeKey: string | null;
  userLocation: LatLng | null;
};

const DRIVE_PREFETCH_MOVE_KM = 4;

export function useMapTilePrefetch({
  isNavigating,
  isDriving,
  mapStyleURL,
  routePoints,
  routeKey,
  userLocation,
}: Options): void {
  const lastDrivePrefetchRef = useRef<{ lat: number; lng: number } | null>(null);
  const navPrefetchedRef = useRef<string | null>(null);
  const bootstrapPrefetchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isNavigating || !routeKey || routePoints.length < 2) return;
    if (navPrefetchedRef.current === routeKey) return;
    navPrefetchedRef.current = routeKey;

    prefetchNavigationPack(routeKey, mapStyleURL, routePoints).catch(() => {});
  }, [isNavigating, routeKey, mapStyleURL, routePoints]);

  useEffect(() => {
    if (isNavigating) return;

    if (!isDriving) {
      deleteDriveCorridorPack().catch(() => {});
      lastDrivePrefetchRef.current = null;
      return;
    }

    if (!userLocation) return;

    const prev = lastDrivePrefetchRef.current;
    if (prev) {
      const movedKm = haversineKm(
        prev.lat,
        prev.lng,
        userLocation.latitude,
        userLocation.longitude,
      );
      if (movedKm < DRIVE_PREFETCH_MOVE_KM) return;
    }

    lastDrivePrefetchRef.current = {
      lat: userLocation.latitude,
      lng: userLocation.longitude,
    };

    prefetchDriveCorridorPack(mapStyleURL, userLocation).catch(() => {});
  }, [isDriving, isNavigating, mapStyleURL, userLocation]);

  useEffect(() => {
    if (isNavigating) return;
    if (!userLocation) return;
    if (!Number.isFinite(userLocation.latitude) || !Number.isFinite(userLocation.longitude)) return;
    const coarseCell = `${mapStyleURL}|${userLocation.latitude.toFixed(2)}|${userLocation.longitude.toFixed(2)}`;
    if (bootstrapPrefetchKeyRef.current === coarseCell) return;
    bootstrapPrefetchKeyRef.current = coarseCell;
    // Warm tiles early after first GPS lock so map does not start on empty/black blocks.
    prefetchDriveCorridorPack(mapStyleURL, userLocation).catch(() => {});
  }, [isNavigating, mapStyleURL, userLocation]);
}
