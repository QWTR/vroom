import { useState, useRef, useCallback } from 'react';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// Minimum distance (degrees, ~90 m) the user must move before re-fetching the
// speed limit. Smaller value is needed for dense urban roads.
const REFETCH_DIST_DEG = 0.0018;  // ~200 m
// Minimum time between Overpass requests regardless of movement.
// Raise to cap query frequency on stop-and-go or oscillating GPS.
const MIN_INTERVAL_MS  = 20_000;  // 20 s
const SEARCH_RADIUS_M  = 140;

type OverpassElement = {
  tags?: { maxspeed?: string; highway?: string };
  center?: { lat: number; lon: number };
};

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseLimit(raw: string | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  const n = parseInt(normalized, 10);
  if (!isNaN(n)) return n;
  if (normalized.includes('mph')) {
    const mph = parseInt(normalized.replace(/[^\d]/g, ''), 10);
    if (!isNaN(mph)) return Math.round(mph * 1.60934);
  }
  if (normalized === 'pl:urban')      return 50;
  if (normalized === 'pl:rural')      return 90;
  if (normalized === 'pl:motorway')   return 140;
  if (normalized === 'pl:expressway') return 120;
  if (normalized === 'pl:living_street') return 20;
  return null;
}

function highwayFallback(highway: string | undefined): number | null {
  switch (highway) {
    case 'motorway':      return 140;
    case 'trunk':         return 120;
    case 'primary':       return 90;
    case 'secondary':     return 90;
    case 'tertiary':      return 70;
    case 'residential':   return 30;
    case 'living_street': return 20;
    case 'service':       return 20;
    default:              return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function queryOverpass(endpoint: string, query: string): Promise<any | null> {
  // 1) Preferred: POST form body
  try {
    const postRes = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json',
      },
      body: `data=${encodeURIComponent(query)}`,
    }, 7000);
    if (postRes.ok) {
      return await postRes.json();
    }
  } catch {
    // fallback below
  }

  // 2) Fallback: GET with query string
  try {
    const join = endpoint.includes('?') ? '&' : '?';
    const getUrl = `${endpoint}${join}data=${encodeURIComponent(query)}`;
    const getRes = await fetchWithTimeout(getUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    }, 7000);
    if (getRes.ok) {
      return await getRes.json();
    }
  } catch {
    // no-op
  }
  return null;
}

export function useSpeedLimit(isActive: boolean) {
  const [speedLimit, setSpeedLimit] = useState<number | null>(null);
  const lastFetchRef  = useRef(0);
  const lastPosRef    = useRef<{ lat: number; lng: number } | null>(null);
  const fetchingRef   = useRef(false);

  const update = useCallback(async (lat: number, lng: number) => {
    if (!isActive) return;

    // Throttle — nie fetchuj zbyt często
    const now = Date.now();
    if (now - lastFetchRef.current < MIN_INTERVAL_MS) return;

    // Nie fetchuj jeśli za mało się przesunęliśmy
    if (lastPosRef.current) {
      const dLat = Math.abs(lat - lastPosRef.current.lat);
      const dLng = Math.abs(lng - lastPosRef.current.lng);
      if (dLat < REFETCH_DIST_DEG && dLng < REFETCH_DIST_DEG) return;
    }

    if (fetchingRef.current) return;
    fetchingRef.current   = true;
    lastFetchRef.current  = now;
    lastPosRef.current    = { lat, lng };

    try {
      const query = `
        [out:json][timeout:8];
        way(around:${SEARCH_RADIUS_M},${lat},${lng})[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|service|unclassified)$"];
        out center tags 80;
      `;

      let data: any = null;
      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          data = await queryOverpass(endpoint, query);
          if (!data) continue;
          break;
        } catch {
          // spróbuj kolejny endpoint
        }
      }
      if (!data) return;
      const els: OverpassElement[]  = data.elements ?? [];

      const withCenter = els
        .filter((el) => Number.isFinite(el.center?.lat) && Number.isFinite(el.center?.lon))
        .sort((a, b) =>
          haversineMeters(lat, lng, a.center!.lat, a.center!.lon) -
          haversineMeters(lat, lng, b.center!.lat, b.center!.lon)
        );
      const ordered = withCenter.length > 0 ? withCenter : els;

      let limit: number | null = null;
      // Priorytet 1: najbliższe drogi z jawnym maxspeed.
      for (const el of ordered) {
        limit = parseLimit(el.tags?.maxspeed);
        if (limit) break;
      }
      // Priorytet 2: fallback po klasie drogi (najbliższe drogi).
      if (!limit) {
        for (const el of ordered) {
          limit = highwayFallback(el.tags?.highway);
          if (limit) break;
        }
      }

      setSpeedLimit(limit);
    } catch {
      // cicho
    } finally {
      fetchingRef.current = false;
    }
  }, [isActive]);

  return { speedLimit, updateSpeedLimit: update };
}