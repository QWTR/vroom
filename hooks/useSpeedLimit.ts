import { useState, useRef, useCallback } from 'react';
import { vroomGpsLog, vroomGpsLogNow } from '../lib/vroomGpsLog';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// Minimum distance (degrees) before re-fetching the speed limit.
const REFETCH_DIST_DEG = 0.0018;      // ~200 m — browsing
const REFETCH_DIST_NAV_DEG = 0.00045; // ~50 m — nawigacja / jazda
// Minimum time between Overpass requests regardless of movement.
const MIN_INTERVAL_MS = 20_000;       // 20 s — browsing
const MIN_INTERVAL_NAV_MS = 6_000;    // 6 s — nawigacja / jazda
const SEARCH_RADIUS_M = 140;

type OverpassElement = {
  tags?: { maxspeed?: string; highway?: string };
  center?: { lat: number; lon: number };
};

export type SpeedLimitUpdateOpts = {
  /** Krótszy throttle przy nawigacji / trybie jazdy. */
  nav?: boolean;
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
  if (normalized === 'signals' || normalized === 'variable') return null;
  const n = parseInt(normalized, 10);
  if (!isNaN(n) && n > 0 && n <= 250) return n;
  if (normalized.includes('mph')) {
    const mph = parseInt(normalized.replace(/[^\d]/g, ''), 10);
    if (!isNaN(mph)) return Math.round(mph * 1.60934);
  }
  if (normalized === 'pl:urban') return 50;
  if (normalized === 'pl:rural') return 90;
  if (normalized === 'pl:motorway') return 140;
  if (normalized === 'pl:expressway') return 120;
  if (normalized === 'pl:living_street') return 20;
  return null;
}

function highwayFallback(highway: string | undefined): number | null {
  switch (highway) {
    case 'motorway':
    case 'motorway_link':
      return 140;
    case 'trunk':
    case 'trunk_link':
      return 120;
    case 'primary':
    case 'primary_link':
      return 90;
    case 'secondary':
    case 'secondary_link':
      return 90;
    case 'tertiary':
    case 'tertiary_link':
      return 70;
    case 'residential':
      return 30;
    case 'living_street':
      return 20;
    case 'service':
      return 20;
    default:
      return null;
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
  try {
    const postRes = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json',
      },
      body: `data=${encodeURIComponent(query)}`,
    }, 9000);
    if (postRes.ok) {
      return await postRes.json();
    }
  } catch {
    // fallback below
  }

  try {
    const join = endpoint.includes('?') ? '&' : '?';
    const getUrl = `${endpoint}${join}data=${encodeURIComponent(query)}`;
    const getRes = await fetchWithTimeout(getUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, 9000);
    if (getRes.ok) {
      return await getRes.json();
    }
  } catch {
    // no-op
  }
  return null;
}

function resolveLimitFromElements(
  lat: number,
  lng: number,
  els: OverpassElement[],
): { limit: number | null; highway: string | null } {
  const withCenter = els
    .filter((el) => Number.isFinite(el.center?.lat) && Number.isFinite(el.center?.lon))
    .sort((a, b) =>
      haversineMeters(lat, lng, a.center!.lat, a.center!.lon) -
      haversineMeters(lat, lng, b.center!.lat, b.center!.lon)
    );
  const ordered = withCenter.length > 0 ? withCenter : els;

  for (const el of ordered) {
    const limit = parseLimit(el.tags?.maxspeed);
    if (limit != null) {
      return { limit, highway: el.tags?.highway ?? null };
    }
  }
  for (const el of ordered) {
    const limit = highwayFallback(el.tags?.highway);
    if (limit != null) {
      return { limit, highway: el.tags?.highway ?? null };
    }
  }
  return { limit: null, highway: ordered[0]?.tags?.highway ?? null };
}

export function useSpeedLimit(isActive: boolean) {
  const [speedLimit, setSpeedLimit] = useState<number | null>(null);
  const lastFetchRef = useRef(0);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const fetchingRef = useRef(false);

  const update = useCallback(async (lat: number, lng: number, opts?: SpeedLimitUpdateOpts) => {
    if (!isActive) return;

    const nav = !!opts?.nav;
    const minIntervalMs = nav ? MIN_INTERVAL_NAV_MS : MIN_INTERVAL_MS;
    const refetchDeg = nav ? REFETCH_DIST_NAV_DEG : REFETCH_DIST_DEG;

    const now = Date.now();
    if (lastFetchRef.current > 0 && now - lastFetchRef.current < minIntervalMs) {
      vroomGpsLog('SPEED_LIMIT_SKIP', {
        reason: 'interval',
        nav,
        ageMs: now - lastFetchRef.current,
        minIntervalMs,
      }, 8000);
      return;
    }

    if (lastPosRef.current) {
      const dLat = Math.abs(lat - lastPosRef.current.lat);
      const dLng = Math.abs(lng - lastPosRef.current.lng);
      if (dLat < refetchDeg && dLng < refetchDeg) {
        vroomGpsLog('SPEED_LIMIT_SKIP', {
          reason: 'distance',
          nav,
          dLatM: Math.round(dLat * 111000),
          dLngM: Math.round(dLng * 71000),
        }, 8000);
        return;
      }
    }

    if (fetchingRef.current) {
      vroomGpsLog('SPEED_LIMIT_SKIP', { reason: 'in_flight', nav }, 8000);
      return;
    }
    fetchingRef.current = true;
    const fetchGuard = setTimeout(() => {
      if (fetchingRef.current) {
        fetchingRef.current = false;
        vroomGpsLogNow('SPEED_LIMIT_FAIL', {
          lat: Number(lat.toFixed(5)),
          lng: Number(lng.toFixed(5)),
          nav,
          reason: 'timeout_guard',
        });
      }
    }, 12_000);

    vroomGpsLogNow('SPEED_LIMIT_FETCH', {
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      nav,
    });

    try {
      const query = `
        [out:json][timeout:10];
        way(around:${SEARCH_RADIUS_M},${lat},${lng})[highway~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|living_street|service|unclassified)$"];
        out center tags 80;
      `;

      let data: any = null;
      let endpointUsed: string | null = null;
      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          data = await queryOverpass(endpoint, query);
          if (!data) continue;
          endpointUsed = endpoint;
          break;
        } catch {
          // spróbuj kolejny endpoint
        }
      }

      if (!data) {
        vroomGpsLogNow('SPEED_LIMIT_FAIL', {
          lat: Number(lat.toFixed(5)),
          lng: Number(lng.toFixed(5)),
          nav,
          reason: 'no_data',
        });
        return;
      }

      const els: OverpassElement[] = data.elements ?? [];
      const { limit, highway } = resolveLimitFromElements(lat, lng, els);

      if (limit != null) {
        setSpeedLimit(limit);
        lastFetchRef.current = now;
        lastPosRef.current = { lat, lng };
        vroomGpsLogNow('SPEED_LIMIT_OK', {
          limit,
          highway,
          elements: els.length,
          nav,
          endpoint: endpointUsed,
        });
      } else {
        vroomGpsLogNow('SPEED_LIMIT_FAIL', {
          lat: Number(lat.toFixed(5)),
          lng: Number(lng.toFixed(5)),
          nav,
          reason: 'no_limit',
          elements: els.length,
          highway,
          endpoint: endpointUsed,
        });
      }
    } catch (err) {
      vroomGpsLogNow('SPEED_LIMIT_FAIL', {
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        nav,
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(fetchGuard);
      fetchingRef.current = false;
    }
  }, [isActive]);

  return { speedLimit, updateSpeedLimit: update };
}
