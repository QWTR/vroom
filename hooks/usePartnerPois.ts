import { useState, useRef, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { MAP_POI_MIN_ZOOM, viewportCacheKey, viewportQueryBoxes, type MapViewport } from '../lib/mapViewport';

export interface PartnerPoi {
  id: number;
  name: string;
  brandSlug: string | null;
  lat: number;
  lng: number;
  logoUrl: string | null;
  websiteUrl: string | null;
  category?: string | null;
  description?: string | null;
  markerAccentColor?: string | null;
  address?: string | null;
  businessLocationId?: number | null;
  priorityRank: number;
  source: 'partner';
  hasActiveOffer?: boolean;
}

const CACHE_TTL_MS = 300_000;
const viewportCache = new Map<string, { at: number; rows: PartnerPoi[] }>();

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

export async function fetchPartnerPoisSearch(
  query: string,
  signal?: AbortSignal,
): Promise<PartnerPoi[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const token = await getToken();
  if (!token) return [];

  const res = await fetch(
    `${API_URL}/api/partner-pois/search?q=${encodeURIComponent(q)}&limit=5`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

export function usePartnerPois(viewport: MapViewport | null) {
  const [pois, setPois] = useState<PartnerPoi[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const requestRevisionRef = useRef(0);

  const fetchForViewport = useCallback(async (nextViewport: MapViewport, force = false) => {
    const key = viewportCacheKey(nextViewport);
    const cached = viewportCache.get(key);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setPois(cached.rows);
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
        const params = new URLSearchParams({ minLat: String(box.south), maxLat: String(box.north), minLng: String(box.west), maxLng: String(box.east), limit: '160' });
        const res = await fetch(`${API_URL}/api/partner-pois?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!res.ok) throw new Error(`partner-pois bbox HTTP ${res.status}`);
        const data = await res.json();
        return Array.isArray(data?.pois) ? data.pois as PartnerPoi[] : [];
      }));
      if (controller.signal.aborted || requestRevision !== requestRevisionRef.current) return;
      const unique = new Map<number, PartnerPoi>();
      batches.flat().forEach((row) => unique.set(row.id, row));
      const rows = [...unique.values()];
      viewportCache.set(key, { at: Date.now(), rows });
      if (viewportCache.size > 12) viewportCache.delete(viewportCache.keys().next().value!);
      setPois(rows);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') console.error('usePartnerPois fetch:', e);
    }
  }, []);

  useEffect(() => {
    if (!viewport || viewport.zoom < MAP_POI_MIN_ZOOM) {
      abortRef.current?.abort();
      requestRevisionRef.current += 1;
      setPois([]);
      return;
    }
    void fetchForViewport(viewport);
    return () => abortRef.current?.abort();
  }, [viewport?.revision, viewport?.zoom, fetchForViewport]);

  return { pois, refetch: () => viewport && fetchForViewport(viewport, true) };
}
