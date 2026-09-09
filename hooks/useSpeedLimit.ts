import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useRef, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '../constants/mapConfig';
import type { SpeedLimitResolution } from '../lib/speedLimits/types';
import { enqueueSpeedLimitReport, flushSpeedLimitReportOutbox, readSpeedLimitReportOutbox, isTransientSpeedLimitFailure,
  type SpeedLimitDeliveryResult, type SpeedLimitOutboxItem, type SpeedLimitReportInput } from '../lib/speedLimits/reportOutbox';
import { sanitizeDisplaySpeedLimit } from '../lib/navigation/osmMaxSpeed';
import { matchSpeedLimitRoad, speedLimitDistance, headingDifference,
  type SpeedLimitPosition, type SpeedLimitWay } from '../lib/speedLimits/roadMatch';
export type { SpeedLimitResolution } from '../lib/speedLimits/types';
export type SpeedLimitUpdateOpts = { nav?: boolean; heading?: number | null };
const UNKNOWN: SpeedLimitResolution = { limitKmh: null, source: 'unknown', status: 'unknown',
  roadKey: null, roadName: null, direction: null, votes: 0 };
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const CACHE_RADIUS = 500;
type Sample = SpeedLimitPosition & { at: number; nav: boolean };
type ServerSample = { position: Sample; at: number; value: SpeedLimitResolution };

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export function useSpeedLimit(isActive: boolean) {
  // The number and its provenance are one state: a queued report cannot overwrite another road.
  const [resolution, setResolution] = useState<SpeedLimitResolution>(UNKNOWN);
  const currentResolution = useRef(resolution);
  const latest = useRef<Sample | null>(null);
  const server = useRef<ServerSample | null>(null);
  const queued = useRef<SpeedLimitResolution[]>([]);
  const area = useRef<{ position: Sample; at: number; ways: SpeedLimitWay[] } | null>(null);
  const serverBusy = useRef(false);
  const reportRevision = useRef(0);
  const areaBusy = useRef(false);
  const serverAttempt = useRef(0);
  const areaAttempt = useRef(0);
  const endpointIndex = useRef(0);
  const mounted = useRef(true);

  const commit = useCallback((value: SpeedLimitResolution) => {
    if (!mounted.current) return;
    const next = { ...value, limitKmh: sanitizeDisplaySpeedLimit(value.limitKmh) };
    if (JSON.stringify(currentResolution.current) === JSON.stringify(next)) return;
    currentResolution.current = next;
    setResolution(next);
  }, []);

  const resolveCurrent = useCallback(() => {
    const position = latest.current;
    if (!position || Date.now() - position.at > 15_000) { commit(UNKNOWN); return; }
    const cached = area.current;
    const covered = cached && Date.now() - cached.at < 120_000
      && speedLimitDistance(position, cached.position) < CACHE_RADIUS - 60;
    const road = covered ? matchSpeedLimitRoad(position, cached.ways) : null;
    const remote = server.current;
    const sameDirection = (a: string | null, b: string | null) => a === b || a === 'both';
    const closeHeading = remote && (position.heading == null || remote.position.heading == null
      || headingDifference(position.heading, remote.position.heading) < 35);
    const remoteValid = remote && Date.now() - remote.at < 15_000 && closeHeading
      && (road ? road.roadKey === remote.value.roadKey && sameDirection(remote.value.direction, road.direction)
        : speedLimitDistance(position, remote.position) < 30);
    if (covered) {
      if (!road || road.ambiguous) { commit(UNKNOWN); return; }
      if (road.limitKmh != null) {
        commit({ ...UNKNOWN, ...road, limitKmh: road.limitKmh, source: 'osm_explicit', status: 'known', roadRecognized: true });
        return;
      }
      const pending = queued.current.find(value => value.roadKey === road.roadKey
        && (value.direction === road.direction || value.direction === 'both'));
      if (!road.hasExplicitRule && pending && (!remoteValid || remote.value.status === 'unknown')) {
        commit(pending); return;
      }
      if (remoteValid && !road.hasExplicitRule) { commit(remote.value); return; }
      commit({ ...UNKNOWN, roadKey: road.roadKey, roadName: road.roadName, direction: road.direction,
        roadRecognized: true, temporarilyUnavailable: true });
      return;
    }
    if (remoteValid) { commit(remote.value); return; }
    commit({ ...UNKNOWN, temporarilyUnavailable: true });
  }, [commit]);

  const update = useCallback(async (lat: number, lng: number, opts?: SpeedLimitUpdateOpts) => {
    if (!isActive || !mounted.current || !Number.isFinite(lat) || !Number.isFinite(lng)
      || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const now = Date.now();
    const position: Sample = { lat, lng, nav: !!opts?.nav, at: now,
      heading: opts?.heading != null && Number.isFinite(opts.heading) && opts.heading >= 0 ? opts.heading % 360 : null };
    const previous = latest.current;
    if (position.heading == null && previous?.heading != null && speedLimitDistance(position, previous) < 8
      && now - previous.at < 10_000) position.heading = previous.heading;
    latest.current = position;
    resolveCurrent();
    const cached = area.current;
    const needsArea = !cached || now - cached.at > 60_000 || speedLimitDistance(position, cached.position) > 300;
    if (needsArea && !areaBusy.current && now - areaAttempt.current >= 12_000) {
      areaBusy.current = true;
      areaAttempt.current = now;
      // Fetch surrounding geometry once; reselect the actual segment on every GPS update.
      const query = '[out:json][timeout:7];way(around:' + CACHE_RADIUS + ',' + lat + ',' + lng
        + ')[highway~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|living_street|service|unclassified|road)$"];out geom tags;';
      void (async () => {
        try {
          const endpoint = ENDPOINTS[endpointIndex.current % ENDPOINTS.length];
          const response = await fetchWithTimeout(endpoint, { method: 'POST', headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' },
            body: 'data=' + encodeURIComponent(query) }, 8_000);
          if (!response.ok) throw new Error('Road lookup unavailable');
          const data = await response.json();
          if (!Array.isArray(data.elements) || data.remark) throw new Error('Incomplete road lookup');
          if (!mounted.current) return;
          area.current = { position, at: Date.now(), ways: data.elements };
          resolveCurrent();
        } catch { endpointIndex.current += 1; }
        finally { areaBusy.current = false; }
      })();
    }
    if (area.current && Date.now() - area.current.at < 120_000
      && speedLimitDistance(position, area.current.position) < CACHE_RADIUS - 60
      && currentResolution.current.source === 'osm_explicit') return;
    // Unknown results are retried even while stopped; never permanently gated by distance.
    if (serverBusy.current || now - serverAttempt.current < (position.nav ? 3_000 : 8_000)) return;
    serverBusy.current = true;
    serverAttempt.current = now;
    const revision = reportRevision.current;
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token || !mounted.current) return;
      const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      if (position.heading != null) params.set('heading', String(position.heading));
      const response = await fetchWithTimeout(API_URL + '/api/speed-limits/resolve?' + params.toString(), {
        method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }, 6_000);
      if (!response.ok) return;
      const value = await response.json() as SpeedLimitResolution;
      if (!mounted.current || revision !== reportRevision.current || !value || !['known', 'unknown', 'pending', 'queued'].includes(value.status)) return;
      server.current = { position, at: Date.now(), value };
      // Evaluate against the newest position, not the position before the request.
      resolveCurrent();
    } catch { /* Retain only geographically valid data until the next bounded retry. */ }
    finally { serverBusy.current = false; }
  }, [isActive, resolveCurrent]);

  const submitSpeedLimit = useCallback(async (input: {
    lat: number; lng: number; heading?: number | null; accuracy: number; limitKmh: number;
  }): Promise<SpeedLimitResolution> => {
    if (!Number.isFinite(input.accuracy) || input.accuracy <= 0 || input.accuracy > 50)
      throw new Error('Sygnał GPS jest zbyt słaby. Wymagana dokładność do 50 m.');
    const context = currentResolution.current;
    const reportInput: SpeedLimitReportInput = { ...input, direction: context.direction, roadContextToken: context.roadContextToken ?? null };
    const request = await postSpeedLimitReport(reportInput);
    if (request.kind === 'error') throw new Error(request.message);
    const next = request.kind === 'retry'
      ? (await enqueueSpeedLimitReport(reportInput, context)).optimisticResolution : request.resolution;
    if (next.status === 'queued') queued.current = [...queued.current.filter(value => value.roadKey !== next.roadKey || value.direction !== next.direction), next];
    if (mounted.current && context.roadKey && context.roadKey === currentResolution.current.roadKey
      && context.direction === currentResolution.current.direction) {
      reportRevision.current += 1;
      server.current = { position: { ...input, nav: true, at: Date.now() }, at: Date.now(), value: next };
      resolveCurrent();
    }
    return next;
  }, [resolveCurrent]);

  const flushQueuedSpeedLimits = useCallback(async (): Promise<SpeedLimitResolution | null> => {
    const delivered = await flushSpeedLimitReportOutbox(deliverQueuedSpeedLimit);
    const outstanding = await readSpeedLimitReportOutbox();
    if (mounted.current) queued.current = outstanding.map(item => item.optimisticResolution);
    const current = currentResolution.current;
    const matching = [...delivered].reverse().find(value => value.roadKey != null && value.roadKey === current.roadKey
      && (value.direction === current.direction || value.direction === 'both'));
    if (matching && latest.current && mounted.current) {
      reportRevision.current += 1;
      server.current = { position: latest.current, at: Date.now(), value: matching };
      resolveCurrent();
    }
    return delivered.at(-1) ?? null;
  }, [resolveCurrent]);

  useEffect(() => {
    mounted.current = true;
    if (!isActive) { commit(UNKNOWN); return () => { mounted.current = false; }; }
    // Outbox delivery never restores an old sign until its current road is identified.
    void flushQueuedSpeedLimits();
    const flushInterval = setInterval(() => void flushQueuedSpeedLimits(), 30_000);
    const retryInterval = setInterval(() => {
      const sample = latest.current;
      if (sample && Date.now() - sample.at < 10_000) {
        // Preserve GPS sample age when retrying from the timer.
        void update(sample.lat, sample.lng, sample);
        if (latest.current) latest.current.at = sample.at;
      } else resolveCurrent();
    }, 2_000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { serverAttempt.current = 0; void flushQueuedSpeedLimits(); }
    });
    return () => { mounted.current = false; clearInterval(flushInterval); clearInterval(retryInterval); subscription.remove(); };
  }, [isActive, commit, update, resolveCurrent, flushQueuedSpeedLimits]);

  return { speedLimit: resolution.limitKmh, resolution, updateSpeedLimit: update, submitSpeedLimit, flushQueuedSpeedLimits };
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
