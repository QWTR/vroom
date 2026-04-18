import { useState, useRef, useCallback } from 'react';

const OVERPASS         = 'https://overpass-api.de/api/interpreter';
// Minimum distance (degrees, ~330 m) the user must move before re-fetching the
// speed limit.  Raise to reduce Overpass API requests while driving on a straight road.
const REFETCH_DIST_DEG = 0.003;   // ~330 m (was 0.0004 / ~44 m)
// Minimum time between Overpass requests regardless of movement.
// Raise to cap query frequency on stop-and-go or oscillating GPS.
const MIN_INTERVAL_MS  = 20_000;  // 20 s (was 6 s)

function parseLimit(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw);
  if (!isNaN(n)) return n;
  if (raw === 'PL:urban')      return 50;
  if (raw === 'PL:rural')      return 90;
  if (raw === 'PL:motorway')   return 140;
  if (raw === 'PL:expressway') return 120;
  if (raw === 'PL:living_street') return 20;
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
        [out:json][timeout:5];
        way(around:25,${lat},${lng})[highway][maxspeed];
        out tags 1;
        way(around:25,${lat},${lng})[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|service|unclassified)$"];
        out tags 1;
      `;

      const res  = await fetch(OVERPASS, {
        method: 'POST',
        body:   `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      const els  = data.elements ?? [];

      // Priorytet: maxspeed jawny
      let limit: number | null = null;
      for (const el of els) {
        limit = parseLimit(el.tags?.maxspeed);
        if (limit) break;
      }
      // Fallback: typ drogi
      if (!limit) {
        for (const el of els) {
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