import { useState, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

// Set to false to disable debug popups in production
const DEBUG_ALERTS = true;

export interface FuelPrice {
  pb95:    number | null;
  pb98:    number | null;
  diesel:  number | null;
  lpg:     number | null;
  updatedAt: string | null;
  updatedBy: { id: number; username: string } | null;
}

export interface FuelStation {
  id:     number;
  name:   string;
  brand:  string | null;
  lat:    number;
  lng:    number;
  prices: FuelPrice[];
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

const THROTTLE_MS  = 30_000; // don't re-fetch within 30s
const THROTTLE_M   = 500;    // don't re-fetch unless moved 500m

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

// ~5.5 km radius at the equator; longitude delta is adjusted by cos(lat) for accuracy
function bboxFromLocation(loc: LocationState, deltaDeg = 0.05): BBox {
  const cosLat = Math.cos((loc.latitude * Math.PI) / 180);
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

  const dbg = (title: string, msg: string) => {
    if (DEBUG_ALERTS) Alert.alert(`[Stacje] ${title}`, msg);
  };

  const fetchStations = useCallback(async (loc: LocationState) => {
    if (fetchingRef.current) {
      dbg('Pomijam', 'Fetch już w toku');
      return;
    }

    const now       = Date.now();
    const lastLoc   = lastFetchLocRef.current;
    const timeDelta = now - lastFetchTimeRef.current;

    // Throttle: skip if recently fetched AND user hasn't moved enough
    if (timeDelta < THROTTLE_MS && lastLoc) {
      const dist = haversineM(lastLoc.latitude, lastLoc.longitude, loc.latitude, loc.longitude);
      if (dist < THROTTLE_M) {
        dbg('Throttle', `Pominięto — ${Math.round(timeDelta / 1000)}s temu, przesunięcie ${Math.round(dist)}m`);
        return;
      }
    }

    dbg('Fetch start', `Lokalizacja: ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`);

    fetchingRef.current = true;
    setLoading(true);

    try {
      const token = await getToken();
      dbg('Token', token ? `OK (${token.substring(0, 12)}…)` : '❌ BRAK TOKENU');

      const bbox  = bboxFromLocation(loc);
      const params = new URLSearchParams({
        minLat: String(bbox.minLat),
        maxLat: String(bbox.maxLat),
        minLng: String(bbox.minLng),
        maxLng: String(bbox.maxLng),
      });

      const url = `${API_URL}/api/fuel-stations?${params}`;
      dbg('Request URL', url);

      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      dbg('HTTP Status', `${r.status} ${r.statusText}`);

      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`HTTP ${r.status}: ${body}`);
      }

      const data = await r.json();
      const list: FuelStation[] = data.stations ?? data ?? [];
      dbg('Wynik', `Znaleziono ${list.length} stacji`);
      setStations(list);
      lastFetchTimeRef.current = Date.now();
      lastFetchLocRef.current  = loc;
    } catch (e: any) {
      console.error('useFuelStations fetch:', e);
      dbg('BŁĄD', String(e?.message ?? e));
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  const refetch = useCallback(() => {
    if (userLocation) {
      lastFetchTimeRef.current = 0; // force re-fetch
      fetchStations(userLocation);
    }
  }, [userLocation, fetchStations]);

  // Expose a method to trigger fetch when location changes (called from map.tsx)
  const onLocationChange = useCallback((loc: LocationState) => {
    fetchStations(loc);
  }, [fetchStations]);

  const updatePrices = useCallback(async (
    stationId: number,
    prices: { pb95?: number; pb98?: number; diesel?: number; lpg?: number },
  ) => {
    try {
      const token = await getToken();
      const r     = await fetch(`${API_URL}/api/fuel-stations/${stationId}/prices`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(prices),
      });
      if (!r.ok) throw new Error('Failed to update prices');
      const updated = await r.json();

      // Update the station in local state
      setStations(prev => prev.map(s =>
        s.id === stationId ? { ...s, prices: [updated] } : s,
      ));
      return true;
    } catch (e) {
      console.error('updatePrices:', e);
      return false;
    }
  }, []);

  return { stations, loading, refetch, updatePrices, onLocationChange };
}
