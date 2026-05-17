import { useState, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { fetchSearchCategoryViaProxy } from '../scripts/mapboxProxyClient';

export interface FuelPrice {
  pb95:      number | null;
  pb98:      number | null;
  diesel:    number | null;
  lpg:       number | null;
  updatedAt: string | null;
  updatedBy: { id: number; username: string } | null;
}

export interface FuelStation {
  /** Unique display ID — Mapbox mapbox_id or "db_{id}" for DB-only entries */
  id:       string;
  /** Backend DB id — set only when the station exists in the DB */
  dbId?:    number;
  name:     string;
  brand:    string | null;
  lat:      number;
  lng:      number;
  address?: string;
  prices:   FuelPrice[];
}

interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface LocationState {
  latitude:  number;
  longitude: number;
}

const THROTTLE_MS    = 120_000; // don't re-fetch within 120 s
const THROTTLE_M     = 1500;    // don't re-fetch unless moved 1.5 km
const MATCH_RADIUS_M = 100;    // max distance to consider a Mapbox station == a DB station

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bboxFromLocation(loc: LocationState, deltaDeg = 0.05): BBox {
  const cosLat   = Math.cos((loc.latitude * Math.PI) / 180);
  const lngDelta = cosLat > 0 ? deltaDeg / cosLat : deltaDeg;
  return {
    minLat: loc.latitude  - deltaDeg,
    maxLat: loc.latitude  + deltaDeg,
    minLng: loc.longitude - lngDelta,
    maxLng: loc.longitude + lngDelta,
  };
}

export function useFuelStations(userLocation: LocationState | null) {
  const [stations, setStations] = useState<FuelStation[]>([]);
  const [loading,  setLoading]  = useState(false);

  const lastFetchTimeRef = useRef<number>(0);
  const lastFetchLocRef  = useRef<LocationState | null>(null);
  const fetchingRef      = useRef(false);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const fetchStations = useCallback(async (loc: LocationState) => {
    if (fetchingRef.current) return;

    const now       = Date.now();
    const lastLoc   = lastFetchLocRef.current;
    const timeDelta = now - lastFetchTimeRef.current;

    if (timeDelta < THROTTLE_MS && lastLoc) {
      const dist = haversineM(lastLoc.latitude, lastLoc.longitude, loc.latitude, loc.longitude);
      if (dist < THROTTLE_M) return;
    }

    fetchingRef.current = true;
    setLoading(true);

    try {
      const token = await getToken();
      const bbox  = bboxFromLocation(loc);

      // 2. Backend DB — stations that already have user-submitted prices
      const params = new URLSearchParams({
        minLat: String(bbox.minLat),
        maxLat: String(bbox.maxLat),
        minLng: String(bbox.minLng),
        maxLng: String(bbox.maxLng),
      });
      const dbUrl = `${API_URL}/api/fuel-stations?${params}`;

      const [mapboxData, dbRes] = await Promise.all([
        fetchSearchCategoryViaProxy<any>({
          category: 'gas_station',
          proximityLng: loc.longitude,
          proximityLat: loc.latitude,
          limit: 25,
          language: 'pl',
        }),
        fetch(dbUrl, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      // Parse Mapbox results
      let mapboxStations: FuelStation[] = [];
      if (mapboxData?.features) {
          mapboxStations = (mapboxData.features as any[]).map(f => ({
            id:      String(f.properties.mapbox_id ?? f.id),
            name:    f.properties.name ?? 'Stacja paliw',
            brand:   f.properties.name ?? null,
            lat:     f.geometry.coordinates[1] as number,
            lng:     f.geometry.coordinates[0] as number,
            address: (f.properties.full_address ?? f.properties.address ?? '') as string,
            prices:  [] as FuelPrice[],
          }));
      }

      // Parse DB results
      let dbStations: any[] = [];
      if (dbRes.ok) {
        const dbData = await dbRes.json();
        dbStations = Array.isArray(dbData) ? dbData : (dbData.stations ?? []);
      }

      // Merge: attach DB prices to matching Mapbox stations (proximity-based)
      const merged: FuelStation[] = mapboxStations.map(ms => {
        let bestMatch: any = null;
        let bestDist       = Infinity;
        for (const db of dbStations) {
          const d = haversineM(ms.lat, ms.lng, db.lat, db.lng);
          if (d < bestDist && d <= MATCH_RADIUS_M) { bestDist = d; bestMatch = db; }
        }
        if (bestMatch) {
          return { ...ms, dbId: bestMatch.id as number, prices: bestMatch.prices ?? [] };
        }
        return ms;
      });

      // Also include DB stations that didn't match any Mapbox result (edge case)
      const matchedDbIds = new Set(merged.filter(s => s.dbId != null).map(s => s.dbId));
      for (const db of dbStations) {
        if (!matchedDbIds.has(db.id)) {
          merged.push({
            id:     `db_${db.id}`,
            dbId:   db.id as number,
            name:   db.name,
            brand:  db.brand ?? null,
            lat:    db.lat,
            lng:    db.lng,
            prices: db.prices ?? [],
          });
        }
      }

      setStations(merged);
      lastFetchTimeRef.current = Date.now();
      lastFetchLocRef.current  = loc;
    } catch (e: any) {
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
    prices:  { pb95?: number; pb98?: number; diesel?: number; lpg?: number },
  ) => {
    try {
      const token = await getToken();
      let dbId    = station.dbId;

      // Station not in DB yet — create it first (upsert pattern)
      if (!dbId) {
        const createRes = await fetch(`${API_URL}/api/fuel-stations`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:    station.name,
            brand:   station.brand ?? undefined,
            lat:     station.lat,
            lng:     station.lng,
            address: station.address ?? undefined,
          }),
        });
        if (!createRes.ok) throw new Error('Failed to create station');
        const created = await createRes.json();
        dbId = created.id as number;
        // Persist the new dbId in local state
        setStations(prev => prev.map(s => s.id === station.id ? { ...s, dbId } : s));
      }

      const r = await fetch(`${API_URL}/api/fuel-stations/${dbId}/prices`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(prices),
      });
      if (!r.ok) throw new Error('Failed to update prices');
      const updated = await r.json();

      setStations(prev => prev.map(s =>
        s.dbId === dbId ? { ...s, prices: [updated] } : s,
      ));
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
        {
          id: `db_${created.id}`,
          dbId: created.id as number,
          name: created.name,
          brand: created.brand ?? null,
          lat: created.lat,
          lng: created.lng,
          address: created.address,
          prices: [],
        },
      ]);
      return true;
    } catch (e) {
      console.error('createStation:', e);
      return false;
    }
  }, []);

  return { stations, loading, refetch, updatePrices, onLocationChange, createStation };
}
