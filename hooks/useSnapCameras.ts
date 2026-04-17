import { useRef, useCallback } from 'react';
import type { SpeedCamera }    from './useSpeedCameras';

// Cache snap — żeby nie snappować za każdym razem
const snapCache = new Map<number, { lat: number; lng: number }>();

async function snapPointToRoad(
  lat: number,
  lng: number,
  cameraId: number,
): Promise<{ lat: number; lng: number }> {
  if (snapCache.has(cameraId)) return snapCache.get(cameraId)!;
  // Brak Google Roads API — używamy oryginalnej pozycji z GPS
  const orig = { lat, lng };
  snapCache.set(cameraId, orig);
  return orig;
}

export function useSnapCameras() {
  const snappingRef   = useRef<Set<number>>(new Set());
  const snappedMapRef = useRef<Map<number, { lat: number; lng: number }>>(new Map());

  // Snap pojedynczej kamery (jeśli jeszcze nie snapped)
  const snapCamera = useCallback(async (camera: SpeedCamera): Promise<SpeedCamera> => {
    const cached = snappedMapRef.current.get(camera.id);
    if (cached) {
      return { ...camera, lat: cached.lat, lng: cached.lng, latitude: cached.lat, longitude: cached.lng };
    }

    if (snappingRef.current.has(camera.id)) return camera;
    snappingRef.current.add(camera.id);

    const snapped = await snapPointToRoad(camera.lat, camera.lng, camera.id);
    snappedMapRef.current.set(camera.id, snapped);
    snappingRef.current.delete(camera.id);

    return {
      ...camera,
      lat:       snapped.lat,
      lng:       snapped.lng,
      latitude:  snapped.lat,
      longitude: snapped.lng,
    };
  }, []);

  // Snap tablicy kamer (batch, w tle)
  const snapCameras = useCallback(async (
    cameras: SpeedCamera[],
    onUpdate: (snapped: SpeedCamera[]) => void,
  ) => {
    if (!cameras.length) return;

    // Zwróć od razu z cache gdzie możliwe
    const withCache = cameras.map(c => {
      const cached = snappedMapRef.current.get(c.id);
      if (!cached) return c;
      return { ...c, lat: cached.lat, lng: cached.lng, latitude: cached.lat, longitude: cached.lng };
    });
    onUpdate(withCache);

    // Snap tych których nie ma w cache — max 10 na raz żeby nie zasypać API
    const toSnap = cameras
      .filter(c => !snappedMapRef.current.has(c.id) && !snappingRef.current.has(c.id))
      .slice(0, 10);

    if (!toSnap.length) return;

    // Batch snap
    const results = await Promise.allSettled(
      toSnap.map(c => snapPointToRoad(c.lat, c.lng, c.id)),
    );

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        snappedMapRef.current.set(toSnap[i].id, result.value);
      }
      snappingRef.current.delete(toSnap[i].id);
    });

    // Zaktualizuj z nowym snappem
    const updated = cameras.map(c => {
      const cached = snappedMapRef.current.get(c.id);
      if (!cached) return c;
      return { ...c, lat: cached.lat, lng: cached.lng, latitude: cached.lat, longitude: cached.lng };
    });
    onUpdate(updated);
  }, []);

  const clearSnapCache = useCallback(() => {
    snapCache.clear();
    snappedMapRef.current.clear();
  }, []);

  return { snapCameras, snapCamera, clearSnapCache };
}