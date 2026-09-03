import { useState, useRef, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import {
  MAP_POI_MIN_ZOOM,
  viewportCacheKey,
  viewportQueryBoxes,
  type MapViewport,
} from '../lib/mapViewport';

export interface FuelPrice {
  pb95:      number | null;
  pb98:      number | null;
  diesel:    number | null;
  lpg:       number | null;
  updatedAt: string | null;
  updatedBy: { id: number; username: string } | null;
}

export type FuelStationAmenities = {
  lpg?: boolean;
  diesel?: boolean;
  octane95?: boolean;
  octane98?: boolean;
  opening_hours?: string | null;
};

export interface FuelStation {
  /** Stable UI id — db primary key */
  id:       string;
  dbId:     number;
  name:     string;
  brand:    string | null;
  brandLogoUrl?: string | null;
  lat:      number;
  lng:      number;
  address?: string;
  distance?: number;
  amenities?: FuelStationAmenities | null;
  prices:   FuelPrice[];
}

interface LocationState {
  latitude:  number;
  longitude: number;
}

type NearbyStationDto = {
  id: number;
  name: string;
  brand: string | null;
  brandLogoUrl?: string | null;
  lat: number;
  lng: number;
  address?: string | null;
  distance?: number;
  amenities?: FuelStationAmenities | null;
  prices?: Array<{
    pb95?: number | null;
    pb98?: number | null;
    diesel?: number | null;
    lpg?: number | null;
    updatedAt?: string;
    updatedBy?: { id: number; username: string } | null;
  }>;
};

const CACHE_TTL_MS = 300_000;
export const PRICE_UPDATE_RADIUS_M = 500;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapPriceRow(p: NonNullable<NearbyStationDto['prices']>[number]): FuelPrice {
  return {
    pb95: p.pb95 ?? null,
    pb98: p.pb98 ?? null,
    diesel: p.diesel ?? null,
    lpg: p.lpg ?? null,
    updatedAt: p.updatedAt ?? null,
    updatedBy: p.updatedBy
      ? { id: p.updatedBy.id, username: p.updatedBy.username }
      : null,
  };
}

function mapNearbyStation(row: NearbyStationDto): FuelStation {
  const dbId = row.id;
  return {
    id: String(dbId),
    dbId,
    name: row.name,
    brand: row.brand,
    brandLogoUrl: row.brandLogoUrl ?? null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    address: row.address ?? undefined,
    distance: row.distance,
    amenities: row.amenities ?? null,
    prices: Array.isArray(row.prices) ? row.prices.map(mapPriceRow) : [],
  };
}

const viewportCache = new Map<string, { at: number; rows: FuelStation[] }>();

export function useFuelStations(viewport: MapViewport | null, userLocation: LocationState | null) {
  const [stations, setStations] = useState<FuelStation[]>([]);
  const [loading, setLoading] = useState(false);
  const requestRevisionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const fetchStations = useCallback(async (nextViewport: MapViewport, force = false) => {
    const key = viewportCacheKey(nextViewport);
    const cached = viewportCache.get(key);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setStations(cached.rows);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestRevision = ++requestRevisionRef.current;
    setLoading(true);
    try {
      const token = await getToken();
      const batches = await Promise.all(viewportQueryBoxes(nextViewport).map(async (box) => {
        const params = new URLSearchParams({
          minLat: String(box.south), maxLat: String(box.north),
          minLng: String(box.west), maxLng: String(box.east), limit: '180',
        });
        const res = await fetch(`${API_URL}/api/fuel-stations?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`fuel-stations bbox HTTP ${res.status}`);
        return (await res.json()) as NearbyStationDto[];
      }));
      if (controller.signal.aborted || requestRevision !== requestRevisionRef.current) return;
      const unique = new Map<number, FuelStation>();
      batches.flat().forEach((row) => unique.set(row.id, mapNearbyStation(row)));
      const mapped = [...unique.values()];
      viewportCache.set(key, { at: Date.now(), rows: mapped });
      if (viewportCache.size > 12) viewportCache.delete(viewportCache.keys().next().value!);
      setStations(mapped);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') console.error('useFuelStations fetch:', e);
    } finally {
      if (requestRevision === requestRevisionRef.current) setLoading(false);
    }
  }, []);

  const refetch = useCallback(() => {
    if (viewport && viewport.zoom >= MAP_POI_MIN_ZOOM) void fetchStations(viewport, true);
  }, [viewport, fetchStations]);

  const onLocationChange = useCallback((_loc: LocationState) => {}, []);

  useEffect(() => {
    if (!viewport || viewport.zoom < MAP_POI_MIN_ZOOM) {
      abortRef.current?.abort();
      requestRevisionRef.current += 1;
      setStations([]);
      setLoading(false);
      return;
    }
    void fetchStations(viewport);
    return () => abortRef.current?.abort();
  }, [viewport?.revision, viewport?.zoom, fetchStations]);

  const updatePrices = useCallback(async (
    station: FuelStation,
    prices: { pb95?: number; pb98?: number; diesel?: number; lpg?: number },
  ) => {
    try {
      const token = await getToken();
      const dbId = station.dbId;
      if (!userLocation) {
        throw new Error('Brak lokalizacji GPS — włącz lokalizację, aby zaktualizować ceny.');
      }

      const distM = haversineM(
        userLocation.latitude,
        userLocation.longitude,
        station.lat,
        station.lng,
      );
      if (distM > PRICE_UPDATE_RADIUS_M) {
        throw new Error(
          `Jesteś zbyt daleko od stacji (${Math.round(distM)} m). Podejdź bliżej (max ${PRICE_UPDATE_RADIUS_M} m).`,
        );
      }

      const r = await fetch(`${API_URL}/api/fuel-stations/${dbId}/prices`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...prices,
          lat: userLocation.latitude,
          lng: userLocation.longitude,
        }),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error(errBody?.error || 'Failed to update prices');
      }
      const updated = await r.json();

      setStations((prev) =>
        prev.map((s) =>
          s.dbId === dbId ? { ...s, prices: [mapPriceRow(updated)] } : s,
        ),
      );
      return true;
    } catch (e) {
      console.error('updatePrices:', e);
      throw e;
    }
  }, [userLocation]);

  const createStation = useCallback(async (data: {
    name: string;
    brand?: string;
    lat: number;
    lng: number;
    address?: string;
  }): Promise<boolean> => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/fuel-stations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return false;
      const created = await res.json();
      setStations((prev) => [
        ...prev,
        mapNearbyStation({
          ...created,
          prices: [],
        }),
      ]);
      return true;
    } catch (e) {
      console.error('createStation:', e);
      return false;
    }
  }, []);

  return { stations, loading, refetch, updatePrices, onLocationChange, createStation };
}
