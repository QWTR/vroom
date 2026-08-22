import { useEffect, useRef } from 'react';
import {
  prefetchDriveCorridorPack,
  prefetchNavigationPack,
} from '../lib/mapOffline/mapTilePrefetch';
import type { LatLng } from '../lib/mapOffline/mapTileBounds';
import { haversineKm } from '../scripts/navigationUtils';

type Options = {
  isNavigating: boolean;
  navigationReady?: boolean;
  isDriving: boolean;
  mapStyleURL: string;
  routePoints: LatLng[];
  routeKey: string | null;
  userLocation: LatLng | null;
};

const DRIVE_PREFETCH_MOVE_KM = 3;
const NAVIGATION_PREFETCH_KM = 6;

function navigationCorridor(points: LatLng[], location: LatLng | null): LatLng[] {
  if (points.length < 2 || !location) return points.slice(0, 96);
  let nearestIndex = 0;
  let nearestKm = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const distanceKm = haversineKm(location.latitude, location.longitude, point.latitude, point.longitude);
    if (distanceKm < nearestKm) {
      nearestKm = distanceKm;
      nearestIndex = index;
    }
  }
  const corridor = [points[nearestIndex]!];
  let coveredKm = 0;
  for (let index = nearestIndex + 1; index < points.length && coveredKm < NAVIGATION_PREFETCH_KM; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    coveredKm += haversineKm(previous.latitude, previous.longitude, point.latitude, point.longitude);
    corridor.push(point);
  }
  return corridor.length >= 2 ? corridor : points.slice(nearestIndex, nearestIndex + 2);
}

export function useMapTilePrefetch({
  isNavigating,
  navigationReady = true,
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
    if (!isNavigating || !navigationReady || !routeKey || routePoints.length < 2) return;
    if (navPrefetchedRef.current === routeKey) return;
    navPrefetchedRef.current = routeKey;

    const corridor = navigationCorridor(routePoints, userLocation);
    prefetchNavigationPack(routeKey, mapStyleURL, corridor).catch(() => {});
  }, [isNavigating, navigationReady, routeKey, mapStyleURL, routePoints, userLocation]);

  useEffect(() => {
    if (isNavigating) return;

    if (!isDriving) {
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
