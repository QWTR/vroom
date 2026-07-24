import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useRef, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '../constants/mapConfig';
import type { SpeedLimitResolution } from '../lib/speedLimits/types';
import {
  enqueueSpeedLimitReport,
  flushSpeedLimitReportOutbox,
  isTransientSpeedLimitFailure,
  readSpeedLimitReportOutbox,
  type SpeedLimitDeliveryResult,
  type SpeedLimitOutboxItem,
  type SpeedLimitReportInput,
} from '../lib/speedLimits/reportOutbox';
import { vroomGpsLog, vroomGpsLogNow } from '../lib/vroomGpsLog';
import {
  parseOsmMaxSpeed,
  sanitizeDisplaySpeedLimit,
} from '../lib/navigation/osmMaxSpeed';

export type { SpeedLimitResolution } from '../lib/speedLimits/types';

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
const SEARCH_RADIUS_M = 25;
/** Sticky: trzymaj ostatni limit gdy OSM chwilowo nie zwraca segmentu. */
const STICKY_LIMIT_MS = 20_000;
const STICKY_LIMIT_DISTANCE_M = 400;
/** Dłuższy sticky w nawigacji — bez mrugania między throttled fetchami. */
const STICKY_LIMIT_MS_NAV = 120_000;
const STICKY_LIMIT_DISTANCE_M_NAV = 800;

type OverpassElement = {
  type: string;
  id: number;
  tags?: { maxspeed?: string; highway?: string };
  geometry?: { lat: number; lon: number }[];
};

export type SpeedLimitUpdateOpts = {
  /** Krótszy throttle przy nawigacji / trybie jazdy. */
  nav?: boolean;
  heading?: number | null;
};

const UNKNOWN_RESOLUTION: SpeedLimitResolution = {
  limitKmh: null,
  source: 'unknown',
  status: 'unknown',
  roadKey: null,
  roadName: null,
  direction: null,
  votes: 0,
};

type StickyLimitState = {
  limit: number;
  sinceMs: number;
  anchorLat: number;
  anchorLng: number;
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
  const elementsWithDistance = els
    .filter(el => el.geometry && el.geometry.length > 0)
    .map(el => {
      let minDist = Infinity;
      for (let i = 0; i < el.geometry!.length - 1; i++) {
        const p1 = el.geometry![i];
        const p2 = el.geometry![i + 1];
        
        // Approximate point-to-segment distance
        const lat1R = p1.lat * Math.PI / 180;
        
        const dx = (p2.lon - p1.lon) * Math.cos(lat1R);
        const dy = (p2.lat - p1.lat);
        const lenSq = dx * dx + dy * dy;
        
        let projLat, projLon;
        if (lenSq === 0) {
          projLat = p1.lat;
          projLon = p1.lon;
        } else {
          const px = (lng - p1.lon) * Math.cos(lat1R);
          const py = (lat - p1.lat);
          const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
          projLat = p1.lat + t * dy;
          projLon = p1.lon + t * (p2.lon - p1.lon);
        }
        
        const distM = haversineMeters(lat, lng, projLat, projLon);
        if (distM < minDist) minDist = distM;
      }
      return { el, minDist };
    })
    .sort((a, b) => a.minDist - b.minDist);

  const ordered = elementsWithDistance.length > 0 
    ? elementsWithDistance.map(item => item.el) 
    : els;

  for (const el of ordered) {
    const limit = parseOsmMaxSpeed(el.tags?.maxspeed).kmh;
    if (limit != null) {
      return { limit, highway: el.tags?.highway ?? null };
    }
  }
  return { limit: null, highway: ordered[0]?.tags?.highway ?? null };
}

export function useSpeedLimit(isActive: boolean) {
  const [speedLimit, setSpeedLimit] = useState<number | null>(null);
  const [resolution, setResolution] = useState<SpeedLimitResolution>(UNKNOWN_RESOLUTION);
  const lastFetchRef = useRef(0);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const fetchingRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const stickyRef = useRef<StickyLimitState | null>(null);
  const queuedResolutionRef = useRef<SpeedLimitResolution | null>(null);

  const isStickyValid = useCallback((
    lat: number,
    lng: number,
    nav: boolean,
    now = Date.now(),
  ): boolean => {
    const sticky = stickyRef.current;
    if (!sticky) return false;
    const ageMs = now - sticky.sinceMs;
    const distM = haversineMeters(lat, lng, sticky.anchorLat, sticky.anchorLng);
    const maxAgeMs = nav ? STICKY_LIMIT_MS_NAV : STICKY_LIMIT_MS;
    const maxDistM = nav ? STICKY_LIMIT_DISTANCE_M_NAV : STICKY_LIMIT_DISTANCE_M;
    return ageMs <= maxAgeMs && distM <= maxDistM;
  }, []);

  const commitSpeedLimit = useCallback((
    rawLimit: number | null,
    lat: number,
    lng: number,
    nav: boolean,
  ) => {
    const limit = sanitizeDisplaySpeedLimit(rawLimit);
    const now = Date.now();

    if (limit != null) {
      stickyRef.current = {
        limit,
        sinceMs: now,
        anchorLat: lat,
        anchorLng: lng,
      };
      setSpeedLimit(limit);
      return;
    }

    if (isStickyValid(lat, lng, nav, now)) {
      const sticky = stickyRef.current!;
      setSpeedLimit(sticky.limit);
      return;
    }

    stickyRef.current = null;
    setSpeedLimit(null);
  }, [isStickyValid]);

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
        sticky: stickyRef.current?.limit ?? null,
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
          sticky: stickyRef.current?.limit ?? null,
        }, 8000);
        return;
      }
    }

    if (fetchingRef.current) {
      vroomGpsLog('SPEED_LIMIT_SKIP', { reason: 'in_flight', nav }, 8000);
      return;
    }
    fetchingRef.current = true;
    const fetchSeq = ++fetchSeqRef.current;
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
      const token = await AsyncStorage.getItem('token');
      if (token) {
        try {
          const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
          if (Number.isFinite(opts?.heading)) params.set('heading', String(opts?.heading));
          const serverRes = await fetchWithTimeout(`${API_URL}/api/speed-limits/resolve?${params.toString()}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          }, 7000);
          if (serverRes.ok) {
            const serverResolution = await serverRes.json() as SpeedLimitResolution;
            if (fetchSeq !== fetchSeqRef.current) return;
            lastFetchRef.current = now;
            lastPosRef.current = { lat, lng };
            const queuedForRoad = queuedResolutionRef.current;
            const keepQueued = queuedForRoad?.status === 'queued'
              && serverResolution.status === 'unknown'
              && queuedForRoad.roadKey === serverResolution.roadKey;
            if (!keepQueued) {
              queuedResolutionRef.current = null;
              setResolution(serverResolution);
            }
            if (serverResolution.limitKmh != null) {
              commitSpeedLimit(serverResolution.limitKmh, lat, lng, nav);
            } else {
              stickyRef.current = null;
              setSpeedLimit(null);
            }
            return;
          }
        } catch {
          // Awaryjny odczyt jawnego maxspeed z OSM poniżej.
        }
      }

      const query = `
        [out:json][timeout:10];
        way(around:${SEARCH_RADIUS_M},${lat},${lng})[highway~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|living_street|service|unclassified)$"];
        out geom tags 80;
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

      if (fetchSeq !== fetchSeqRef.current) return;

      if (!data) {
        if (!queuedResolutionRef.current) {
          setResolution({ ...UNKNOWN_RESOLUTION, temporarilyUnavailable: true });
          stickyRef.current = null;
          setSpeedLimit(null);
        }
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

      if (fetchSeq !== fetchSeqRef.current) return;

      lastFetchRef.current = now;
      lastPosRef.current = { lat, lng };

      if (limit != null) {
        queuedResolutionRef.current = null;
        setResolution({
          ...UNKNOWN_RESOLUTION,
          limitKmh: limit,
          source: 'osm_explicit',
          status: 'known',
          roadRecognized: true,
        });
        commitSpeedLimit(limit, lat, lng, nav);
        vroomGpsLogNow('SPEED_LIMIT_OK', {
          limit,
          highway,
          elements: els.length,
          nav,
          endpoint: endpointUsed,
          sticky: false,
        });
      } else {
        if (!queuedResolutionRef.current) {
          setResolution({
            ...UNKNOWN_RESOLUTION,
            roadRecognized: els.length > 0,
            temporarilyUnavailable: true,
          });
          stickyRef.current = null;
          setSpeedLimit(null);
        }
        vroomGpsLogNow('SPEED_LIMIT_FAIL', {
          lat: Number(lat.toFixed(5)),
          lng: Number(lng.toFixed(5)),
          nav,
          reason: 'no_limit',
          elements: els.length,
          highway,
          endpoint: endpointUsed,
          stickyHeld: null,
        });
      }
    } catch (err) {
      if (fetchSeq !== fetchSeqRef.current) return;
      if (!queuedResolutionRef.current) {
        setResolution({ ...UNKNOWN_RESOLUTION, temporarilyUnavailable: true });
        stickyRef.current = null;
        setSpeedLimit(null);
      }
      vroomGpsLogNow('SPEED_LIMIT_FAIL', {
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        nav,
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
        stickyHeld: null,
      });
    } finally {
      clearTimeout(fetchGuard);
      if (fetchSeq === fetchSeqRef.current) {
        fetchingRef.current = false;
      }
    }
  }, [isActive, commitSpeedLimit]);

  const submitSpeedLimit = useCallback(async (input: {
    lat: number;
    lng: number;
    heading?: number | null;
    accuracy: number;
    limitKmh: number;
  }): Promise<SpeedLimitResolution> => {
    if (!Number.isFinite(input.accuracy) || input.accuracy <= 0 || input.accuracy > 50) {
      throw new Error('Sygnał GPS jest zbyt słaby. Wymagana dokładność do 50 m.');
    }
    await flushSpeedLimitReportOutbox(deliverQueuedSpeedLimit);
    const reportInput: SpeedLimitReportInput = {
      ...input,
      direction: resolution.direction,
      roadContextToken: resolution.roadContextToken ?? null,
    };
    const request = await postSpeedLimitReport(reportInput);
    if (request.kind === 'error') throw new Error(request.message);
    if (request.kind === 'retry') {
      const queued = await enqueueSpeedLimitReport(reportInput, resolution);
      const next = queued.optimisticResolution;
      queuedResolutionRef.current = next;
      setResolution(next);
      commitSpeedLimit(input.limitKmh, input.lat, input.lng, true);
      return next;
    }
    const next = request.resolution;
    setResolution(next);
    commitSpeedLimit(next.limitKmh, input.lat, input.lng, true);
    return next;
  }, [commitSpeedLimit, resolution]);

  const flushQueuedSpeedLimits = useCallback(async (): Promise<SpeedLimitResolution | null> => {
    const delivered = await flushSpeedLimitReportOutbox(deliverQueuedSpeedLimit);
    const latest = delivered.at(-1) ?? null;
    if (latest) {
      queuedResolutionRef.current = null;
      setResolution(latest);
      const lastPos = lastPosRef.current;
      if (lastPos) commitSpeedLimit(latest.limitKmh, lastPos.lat, lastPos.lng, true);
      else setSpeedLimit(sanitizeDisplaySpeedLimit(latest.limitKmh));
    }
    return latest;
  }, [commitSpeedLimit]);

  const hydrateQueuedSpeedLimit = useCallback(async () => {
    const items = await readSpeedLimitReportOutbox();
    const latest = items.at(-1)?.optimisticResolution ?? null;
    if (!latest) return;
    queuedResolutionRef.current = latest;
    setResolution(latest);
    setSpeedLimit(sanitizeDisplaySpeedLimit(latest.limitKmh));
  }, []);

  useEffect(() => {
    if (!isActive) return undefined;
    void hydrateQueuedSpeedLimit().then(flushQueuedSpeedLimits);
    const interval = setInterval(() => void flushQueuedSpeedLimits(), 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flushQueuedSpeedLimits();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [flushQueuedSpeedLimits, hydrateQueuedSpeedLimit, isActive]);

  return { speedLimit, resolution, updateSpeedLimit: update, submitSpeedLimit, flushQueuedSpeedLimits };
}

type ReportRequestResult =
  | { kind: 'sent'; resolution: SpeedLimitResolution }
  | { kind: 'retry' }
  | { kind: 'error'; message: string };

function safeReportErrorMessage(data: any, status: number): string {
  const code = String(data?.errorCode ?? '');
  if (code === 'GPS_ACCURACY') return 'Sygnał GPS jest zbyt słaby. Spróbuj ponownie.';
  if (code === 'ROAD_CONTEXT_EXPIRED') return 'Rozpoznanie drogi wygasło. Otwórz dodawanie limitu ponownie.';
  if (code === 'ROAD_NOT_RECOGNIZED') return 'Nie udało się rozpoznać drogi. Spróbuj ponownie.';
  if (code === 'OSM_LIMIT_EXISTS') return 'Ta droga ma już oficjalne ograniczenie.';
  if (code === 'CONFLICTING_VOTE') return 'Dla tej drogi oddałeś już inny głos.';
  if (status === 401 || status === 403) return 'Zaloguj się ponownie, aby dodać limit.';
  return typeof data?.error === 'string' && !/abort|network|fetch/i.test(data.error)
    ? data.error
    : 'Nie udało się zapisać limitu.';
}

async function postSpeedLimitReport(input: SpeedLimitReportInput): Promise<ReportRequestResult> {
  const authToken = await AsyncStorage.getItem('token');
  if (!authToken) return { kind: 'error', message: 'Zaloguj się, aby dodać limit.' };
  try {
    const response = await fetchWithTimeout(`${API_URL}/api/speed-limits/reports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
    }, 8_000);
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.resolution) {
      return { kind: 'sent', resolution: data.resolution as SpeedLimitResolution };
    }
    if (response.status === 409 && data?.errorCode === 'LIMIT_VERIFIED' && data?.resolution) {
      return { kind: 'sent', resolution: data.resolution as SpeedLimitResolution };
    }
    if (isTransientSpeedLimitFailure(response.status)) return { kind: 'retry' };
    return { kind: 'error', message: safeReportErrorMessage(data, response.status) };
  } catch {
    // AbortError, timeout and transport errors are deliberately hidden from UI.
    return { kind: 'retry' };
  }
}

async function deliverQueuedSpeedLimit(item: SpeedLimitOutboxItem): Promise<SpeedLimitDeliveryResult> {
  const result = await postSpeedLimitReport(item.input);
  if (result.kind === 'sent') return result;
  if (result.kind === 'retry') return result;
  return { kind: 'discard' };
}
