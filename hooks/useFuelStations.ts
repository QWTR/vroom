import { useState, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

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

const THROTTLE_MS = 300_000;
const THROTTLE_M = 2500;
const NEARBY_RADIUS_M = 12_000;

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
    lat: row.lat,
    lng: row.lng,
    address: row.address ?? undefined,
    distance: row.distance,
    amenities: row.amenities ?? null,
    prices: Array.isArray(row.prices) ? row.prices.map(mapPriceRow) : [],
  };
}

export function useFuelStations(userLocation: LocationState | null) {
  const [stations, setStations] = useState<FuelStation[]>([]);
  const [loading, setLoading] = useState(false);

  const lastFetchTimeRef = useRef<number>(0);
  const lastFetchLocRef = useRef<LocationState | null>(null);
  const fetchingRef = useRef(false);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const fetchStations = useCallback(async (loc: LocationState) => {
    if (fetchingRef.current) return;

    const now = Date.now();
    const lastLoc = lastFetchLocRef.current;
    const timeDelta = now - lastFetchTimeRef.current;

    if (timeDelta < THROTTLE_MS && lastLoc) {
      const dist = haversineM(lastLoc.latitude, lastLoc.longitude, loc.latitude, loc.longitude);
      if (dist < THROTTLE_M) return;
    }

    fetchingRef.current = true;
    setLoading(true);

    try {
      const token = await getToken();
      const params = new URLSearchParams({
        lat: String(loc.latitude),
        lng: String(loc.longitude),
        radiusM: String(NEARBY_RADIUS_M),
      });
      const url = `${API_URL}/api/fuel-stations/nearby?${params}`;

      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error(`fuel-stations/nearby HTTP ${res.status}`);
      }

      const data = (await res.json()) as NearbyStationDto[];
      const mapped = Array.isArray(data) ? data.map(mapNearbyStation) : [];

      setStations(mapped);
      lastFetchTimeRef.current = Date.now();
      lastFetchLocRef.current = loc;
    } catch (e) {
      console.error('useFuelStations fetch:', e);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  const refetch = useCallback(() => {
    if (userLocation) {
      lastFetchTimeRef.current = 0;
      fetchStations(userLocation);
    }
  }, [userLocation, fetchStations]);

  const onLocationChange = useCallback((loc: LocationState) => {
    fetchStations(loc);
  }, [fetchStations]);

  const updatePrices = useCallback(async (
    station: FuelStation,
    prices: { pb95?: number; pb98?: number; diesel?: number; lpg?: number },
  ) => {
    try {
      const token = await getToken();
      const dbId = station.dbId;

      const r = await fetch(`${API_URL}/api/fuel-stations/${dbId}/prices`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(prices),
      });
      if (!r.ok) throw new Error('Failed to update prices');
      const updated = await r.json();

      setStations((prev) =>
        prev.map((s) =>
          s.dbId === dbId ? { ...s, prices: [mapPriceRow(updated)] } : s,
        ),
      );
      return true;
    } catch (e) {
      console.error('updatePrices:', e);
      return false;
    }
  }, []);

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
