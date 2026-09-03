import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { MAP_POI_MIN_ZOOM, viewportCacheKey, viewportQueryBoxes, type MapViewport } from '../lib/mapViewport';

export interface OfficialMapMeet {
  id: number;
  title: string;
  locationName: string;
  lat: number;
  lng: number;
  date: string;
  coverImage: string | null;
  status: string | null;
  category: string;
  ticketPrice: number | null;
  ticketCurrency: string;
  maxParticipants: number;
  participantsCount: number;
  source: 'official_meet';
}

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

const CACHE_TTL_MS = 300_000;
const viewportCache = new Map<string, { at: number; rows: OfficialMapMeet[] }>();

export function useOfficialMapMeets(viewport: MapViewport | null) {
  const [meets, setMeets] = useState<OfficialMapMeet[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const requestRevisionRef = useRef(0);

  const fetchAll = useCallback(async (nextViewport: MapViewport, force = false) => {
    const key = viewportCacheKey(nextViewport);
    const cached = viewportCache.get(key);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setMeets(cached.rows);
      return;
    }
    const token = await getToken();
    if (!token) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestRevision = ++requestRevisionRef.current;
    try {
      const batches = await Promise.all(viewportQueryBoxes(nextViewport).map(async (box) => {
        const params = new URLSearchParams({ minLat: String(box.south), maxLat: String(box.north), minLng: String(box.west), maxLng: String(box.east), limit: '120' });
        const res = await fetch(`${API_URL}/api/meets/map?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!res.ok) throw new Error(`meets/map bbox HTTP ${res.status}`);
        const data = await res.json();
        return Array.isArray(data?.meets) ? data.meets as OfficialMapMeet[] : [];
      }));
      if (controller.signal.aborted || requestRevision !== requestRevisionRef.current) return;
      const unique = new Map<number, OfficialMapMeet>();
      batches.flat().forEach((row) => unique.set(row.id, row));
      const rows = [...unique.values()];
      viewportCache.set(key, { at: Date.now(), rows });
      if (viewportCache.size > 12) viewportCache.delete(viewportCache.keys().next().value!);
      setMeets(rows);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') console.error('useOfficialMapMeets fetch:', e);
    }
  }, []);

  useEffect(() => {
    if (!viewport || viewport.zoom < MAP_POI_MIN_ZOOM) {
      abortRef.current?.abort();
      requestRevisionRef.current += 1;
      setMeets([]);
      return;
    }
    void fetchAll(viewport);
    return () => abortRef.current?.abort();
  }, [viewport?.revision, viewport?.zoom, fetchAll]);

  return { meets, refetch: () => viewport && fetchAll(viewport, true) };
}
