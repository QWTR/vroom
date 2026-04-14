import { useState, useRef, useCallback } from 'react';
import AsyncStorage                       from '@react-native-async-storage/async-storage';
import { API_URL }                        from '../constants/mapConfig';

export interface SpeedCamera {
  id:           number;
  lat:          number;
  lng:          number;
  latitude:     number;
  longitude:    number;
  maxspeed:     number | null;
  type:         'fixed' | 'section' | 'mobile' | 'bump';
  description:  string | null;
  confirmCount: number;
  distanceM:    number;
  addedBy:      { id: number; username: string; avatarUrl: string | null };
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let cacheRef: {
  cameras:   SpeedCamera[];
  lat:       number;
  lng:       number;
  fetchedAt: number;
} | null = null;

const CACHE_TTL_MS   = 5 * 60 * 1000;
const REFETCH_DIST_M = 500;
const SHOW_RADIUS_KM = 10;

async function getToken(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem('token');
    return raw ?? '';
  } catch { return ''; }
}

export function useSpeedCameras() {
  const [cameras,       setCameras]       = useState<SpeedCamera[]>([]);
  const [nearestCamera, setNearestCamera] = useState<SpeedCamera | null>(null);

  const lastPosRef  = useRef<{ lat: number; lng: number } | null>(null);
  const fetchingRef = useRef(false);
  const alertedRef  = useRef<Set<number>>(new Set());

  const recalc = useCallback((userLat: number, userLng: number) => {
    const raw = cacheRef?.cameras ?? [];
    const result = raw
      .map(c => ({
        ...c,
        distanceM: haversineM(userLat, userLng, c.lat, c.lng),
      }))
      .filter(c => c.distanceM <= SHOW_RADIUS_KM * 1000)
      .sort((a, b) => a.distanceM - b.distanceM);
    setCameras(result);
    setNearestCamera(result[0] ?? null);
  }, []);

  const updateCameras = useCallback(async (userLat: number, userLng: number) => {
    recalc(userLat, userLng);

    if (lastPosRef.current) {
      const moved = haversineM(
        userLat, userLng,
        lastPosRef.current.lat, lastPosRef.current.lng,
      );
      if (moved < REFETCH_DIST_M) return;
    }
    lastPosRef.current = { lat: userLat, lng: userLng };

    if (
      cacheRef &&
      Date.now() - cacheRef.fetchedAt < CACHE_TTL_MS &&
      haversineM(userLat, userLng, cacheRef.lat, cacheRef.lng) < SHOW_RADIUS_KM * 500
    ) return;

    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const token = await getToken();
      const res   = await fetch(
        `${API_URL}/api/speed-cameras?lat=${userLat}&lng=${userLng}&radius=${SHOW_RADIUS_KM}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: any[] = await res.json();

      const mapped: SpeedCamera[] = data.map(c => ({
        ...c,
        latitude:  c.lat,
        longitude: c.lng,
        distanceM: haversineM(userLat, userLng, c.lat, c.lng),
      }));

      cacheRef = { cameras: mapped, lat: userLat, lng: userLng, fetchedAt: Date.now() };
      recalc(userLat, userLng);
    } catch (e) {
      console.warn('📷 Speed camera fetch error:', e);
    } finally {
      fetchingRef.current = false;
    }
  }, [recalc]);

  const addCamera = useCallback(async (params: {
    lat:         number;
    lng:         number;
    maxspeed:    number | null;
    type:        'fixed' | 'section' | 'mobile'| 'bump';
    description: string | null;
  }): Promise<SpeedCamera | null> => {
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/speed-cameras`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });

      if (res.status === 409) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const camera = await res.json();
      const mapped: SpeedCamera = {
        ...camera,
        latitude:  camera.lat,
        longitude: camera.lng,
        distanceM: 0,
      };

      if (cacheRef) {
        cacheRef.cameras = [...cacheRef.cameras, mapped];
      }
      recalc(params.lat, params.lng);
      return mapped;
    } catch (e) {
      console.warn('📷 addCamera error:', e);
      return null;
    }
  }, [recalc]);

  const confirmCamera = useCallback(async (cameraId: number): Promise<boolean> => {
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/speed-cameras/${cameraId}/confirm`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (cacheRef) {
        cacheRef.cameras = cacheRef.cameras.map(c =>
          c.id === cameraId
            ? { ...c, confirmCount: c.confirmCount + (data.confirmed ? 1 : -1) }
            : c,
        );
      }
      return data.confirmed;
    } catch (e) {
      console.warn('📷 confirmCamera error:', e);
      return false;
    }
  }, []);
  const deleteCamera = useCallback(async (cameraId: number): Promise<boolean> => {
    try {
        const token = await getToken();
        const res   = await fetch(`${API_URL}/api/speed-cameras/${cameraId}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Usuń z cache
        if (cacheRef) {
        cacheRef.cameras = cacheRef.cameras.filter(c => c.id !== cameraId);
        }
        return true;
    } catch (e) {
        console.warn('📷 deleteCamera error:', e);
        return false;
    }
    }, []);
  const checkAlert = useCallback((
    camera: SpeedCamera,
    alertDistM: number,
  ): boolean => {
    if (camera.distanceM > alertDistM) return false;
    if (alertedRef.current.has(camera.id)) return false;
    return true;
  }, []);

  const markAlerted = useCallback((id: number) => {
    alertedRef.current.add(id);
    setTimeout(() => alertedRef.current.delete(id), 90000);
  }, []);

  const invalidate = useCallback(() => {
    cacheRef = null;
    lastPosRef.current = null;
  }, []);

  return {
    cameras,
    nearestCamera,
    updateCameras,
    addCamera,
    confirmCamera,
    checkAlert,
    markAlerted,
    deleteCamera,
    invalidate,
  };
}