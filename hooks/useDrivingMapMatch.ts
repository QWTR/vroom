import { useRef, useCallback } from 'react';
import { MAPBOX_TOKEN }        from '../constants/mapConfig';
import { haversineKm }         from '../scripts/navigationUtils';

// ─────────────────────────────────────────────────────────────────────────────
// Mapbox Map Matching — DAP to Road
// Snaps driving position to the nearest road using Mapbox's matching API.
// Called at most every MIN_INTERVAL_MS to avoid rate-limiting.
// ─────────────────────────────────────────────────────────────────────────────

const MAP_MATCH_URL   = 'https://api.mapbox.com/matching/v5/mapbox/driving';
const MIN_INTERVAL_MS = 4000;   // call API at most every 4 s
const BUFFER_SIZE     = 5;      // number of GPS points sent to API
const MATCH_RADIUS_M  = 50;     // snap radius (m) — how far GPS may deviate from road
const EXPIRE_MS       = 30_000; // discard cached segment after 30 s
const MIN_POINT_DIST_KM = 0.005; // ~5 m — skip points that haven't moved

interface GpsPoint {
  lat:  number;
  lng:  number;
  time: number;
}

/**
 * Maintains a small rolling buffer of GPS positions and periodically calls
 * the Mapbox Map Matching API to obtain a road-snapped polyline.
 *
 * The returned `addPosition` should be called on every GPS update while in
 * (or approaching) Driving Mode.  `getMatchedPoints` returns the latest
 * matched road segment (or null when unavailable / expired).
 */
export function useDrivingMapMatch() {
  const bufferRef      = useRef<GpsPoint[]>([]);
  const lastCallRef    = useRef<number>(0);
  const isFetchingRef  = useRef<boolean>(false);
  const matchedPtsRef  = useRef<{ latitude: number; longitude: number }[] | null>(null);
  const matchedTimeRef = useRef<number>(0);

  const addPosition = useCallback(async (lat: number, lng: number): Promise<void> => {
    const now  = Date.now();

    // Skip duplicate / near-duplicate points
    const last = bufferRef.current[bufferRef.current.length - 1];
    if (last && haversineKm(last.lat, last.lng, lat, lng) < MIN_POINT_DIST_KM) return;

    bufferRef.current.push({ lat, lng, time: now });
    if (bufferRef.current.length > BUFFER_SIZE) {
      bufferRef.current = bufferRef.current.slice(-BUFFER_SIZE);
    }

    if (now - lastCallRef.current < MIN_INTERVAL_MS) return;
    if (isFetchingRef.current)                       return;
    if (bufferRef.current.length < 2)                return;

    lastCallRef.current   = now;
    isFetchingRef.current = true;

    try {
      const pts     = bufferRef.current;
      const coords  = pts.map(p => `${p.lng},${p.lat}`).join(';');
      const radii   = pts.map(() => String(MATCH_RADIUS_M)).join(';');
      const url     = `${MAP_MATCH_URL}/${coords}?geometries=geojson&radiuses=${radii}&access_token=${MAPBOX_TOKEN}`;

      const res  = await fetch(url);
      if (!res.ok) {
        console.warn('[DrivingMapMatch] HTTP error:', res.status);
        return;
      }

      interface MapMatchResponse {
        code:      string;
        matchings: Array<{
          geometry: {
            coordinates: [number, number][];
          };
        }>;
      }

      const json = await res.json() as MapMatchResponse;

      if (Array.isArray(json.matchings) && json.matchings[0]?.geometry?.coordinates?.length) {
        const matched = json.matchings[0].geometry.coordinates.map(
          ([lng, lat]) => ({ latitude: lat, longitude: lng }),
        );
        matchedPtsRef.current  = matched;
        matchedTimeRef.current = Date.now();
        console.log('[DrivingMapMatch] Matched', matched.length, 'points to road');
      } else {
        console.log('[DrivingMapMatch] No match found (code:', json.code, ')');
      }
    } catch (e) {
      console.warn('[DrivingMapMatch] API error:', e);
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  /**
   * Returns the latest map-matched road segment, or null if unavailable /
   * expired.  Safe to call on every render / GPS update (cheap ref read).
   */
  const getMatchedPoints = useCallback(
    (): { latitude: number; longitude: number }[] | null => {
      if (!matchedPtsRef.current) return null;
      if (Date.now() - matchedTimeRef.current > EXPIRE_MS) {
        matchedPtsRef.current = null;
        return null;
      }
      return matchedPtsRef.current;
    },
    [],
  );

  const reset = useCallback((): void => {
    bufferRef.current     = [];
    matchedPtsRef.current = null;
    lastCallRef.current   = 0;
    isFetchingRef.current = false;
    console.log('[DrivingMapMatch] reset');
  }, []);

  return { addPosition, getMatchedPoints, reset };
}
