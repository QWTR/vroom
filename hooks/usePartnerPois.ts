import { useState, useRef, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export interface PartnerPoi {
  id: number;
  name: string;
  brandSlug: string | null;
  lat: number;
  lng: number;
  logoUrl: string | null;
  websiteUrl: string | null;
  priorityRank: number;
  source: 'partner';
}

interface LocationState {
  latitude: number;
  longitude: number;
}

const THROTTLE_MS = 90_000;
const THROTTLE_M = 1200;

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

export function usePartnerPois(userLocation: LocationState | null) {
  const [pois, setPois] = useState<PartnerPoi[]>([]);
  const lastFetchRef = useRef<{ at: number; lat: number; lng: number } | null>(null);

  const fetchForLocation = useCallback(async (loc: LocationState) => {
    const token = await getToken();
    if (!token) return;

    const delta = 0.06;
    const cosLat = Math.cos((loc.latitude * Math.PI) / 180);
    const lngDelta = cosLat > 0 ? delta / cosLat : delta;
    const params = new URLSearchParams({
      minLat: String(loc.latitude - delta),
      maxLat: String(loc.latitude + delta),
      minLng: String(loc.longitude - lngDelta),
      maxLng: String(loc.longitude + lngDelta),
    });

    const res = await fetch(`${API_URL}/api/partner-pois?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setPois(Array.isArray(data?.pois) ? data.pois : []);
  }, []);

  const onLocationChange = useCallback((loc: LocationState | null) => {
    if (!loc) return;
    const prev = lastFetchRef.current;
    const now = Date.now();
    if (prev) {
      if (now - prev.at < THROTTLE_MS) return;
      if (haversineM(prev.lat, prev.lng, loc.latitude, loc.longitude) < THROTTLE_M) return;
    }
    lastFetchRef.current = { at: now, lat: loc.latitude, lng: loc.longitude };
    void fetchForLocation(loc);
  }, [fetchForLocation]);

  useEffect(() => {
    if (userLocation) onLocationChange(userLocation);
  }, [userLocation?.latitude, userLocation?.longitude, onLocationChange, userLocation]);

  return { pois, onLocationChange, refetch: () => userLocation && fetchForLocation(userLocation) };
}
