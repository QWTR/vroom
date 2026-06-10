/**
 * Centralny koordynator wymuszonych żądań Map Matching (force match).
 * Jedna ścieżka decyzyjna: cooldown per reason, inflight, gate, metryki.
 */

import { canRequestMapMatch } from '../mapboxNetworkGate';
import { haversineKm } from '../../scripts/navigationUtils';
import { vroomGpsLog } from '../vroomGpsLog';
import { shouldAllowNetworkMapMatch } from './clientFirstRoadGeometry';
import { shouldCoordinatorAllowNetwork } from './coordinatorNetworkPolicy';

export type MapMatchRecoveryReason =
  | 'DR_DRIFT'
  | 'NO_ROAD'
  | 'HARD_RESCUE'
  | 'MANUAL'
  | 'PRE_DRIVE'
  | 'SPARSE_GEOM'
  | 'SOFT_REFRESH'
  | 'STALE_GEOM'
  | 'SNAP_RECOVERY'
  | 'SNAP_RECOVERY_MANUAL'
  | 'STALE_ANCHOR'
  | 'MARKER_STUCK'
  | 'AUTO_ENTRY'
  | 'GPS_RESUME'
  | 'INTERSECTION_TURN';

export type MatchedRoadPoint = { latitude: number; longitude: number };

export type MapMatchRecoveryRequest = {
  reason: MapMatchRecoveryReason;
  lat: number;
  lng: number;
  speedKmh?: number;
  headingDeg?: number;
  /** Map Matching trace gate — bypass przy stale geometrii. */
  staleSnap?: boolean;
  forceImmediate?: boolean;
  /** Dodatkowe warunki kontekstowe (np. NO_ROAD z map.tsx). */
  context?: {
    movedForSnapM?: number;
    movedRecoverM?: number;
    roadPtsSparse?: number;
    rawToSnapForSparseM?: number;
    movedSoftM?: number;
    canForceAutoEntry?: boolean;
  };
};

type ForceMatchOpts = {
  manual?: boolean;
  refresh?: boolean;
  forceImmediate?: boolean;
  intersectionTurn?: boolean;
  speedKmh?: number;
  headingDeg?: number;
};

type ReasonConfig = {
  cooldownMs: number;
  minMoveM: number;
  priority: number;
  matchOpts: ForceMatchOpts;
  bypassSpeedGate?: boolean;
  bypassMapboxGate?: boolean;
  scheduleRetryMs?: number;
  retryAsRefresh?: boolean;
};

export const MAP_MATCH_COORD_NO_ROAD_GAP_MS = 45_000;
export const MAP_MATCH_COORD_NO_ROAD_MIN_MOVE_M = 25;
export const MAP_MATCH_COORD_NO_ROAD_MIN_REC_M = 40;
export const MAP_MATCH_COORD_AUTO_ENTRY_COOLDOWN_MS = 180_000;
export const MAP_MATCH_COORD_AUTO_ENTRY_MIN_MOVE_M = 180;

const REASON_CONFIG: Record<MapMatchRecoveryReason, ReasonConfig> = {
  DR_DRIFT: {
    cooldownMs: 90_000,
    minMoveM: 40,
    priority: 55,
    matchOpts: { manual: true, forceImmediate: true },
  },
  NO_ROAD: {
    cooldownMs: MAP_MATCH_COORD_NO_ROAD_GAP_MS,
    minMoveM: MAP_MATCH_COORD_NO_ROAD_MIN_MOVE_M,
    priority: 72,
    matchOpts: { refresh: true },
  },
  HARD_RESCUE: {
    cooldownMs: 60_000,
    minMoveM: 25,
    priority: 92,
    matchOpts: { manual: true, forceImmediate: true },
    scheduleRetryMs: 60_000,
    retryAsRefresh: true,
  },
  MANUAL: {
    cooldownMs: 20_000,
    minMoveM: 35,
    priority: 100,
    matchOpts: { manual: true, forceImmediate: true },
    bypassSpeedGate: true,
    bypassMapboxGate: true,
  },
  PRE_DRIVE: {
    cooldownMs: 45_000,
    minMoveM: 40,
    priority: 40,
    matchOpts: { refresh: true },
  },
  SPARSE_GEOM: {
    cooldownMs: 45_000,
    minMoveM: 35,
    priority: 65,
    matchOpts: { refresh: true },
  },
  SOFT_REFRESH: {
    cooldownMs: 180_000,
    minMoveM: 180,
    priority: 35,
    matchOpts: { refresh: true },
  },
  STALE_GEOM: {
    cooldownMs: 60_000,
    minMoveM: 35,
    priority: 68,
    matchOpts: { refresh: true },
  },
  SNAP_RECOVERY: {
    cooldownMs: 45_000,
    minMoveM: 30,
    priority: 60,
    matchOpts: { refresh: true },
  },
  SNAP_RECOVERY_MANUAL: {
    cooldownMs: 60_000,
    minMoveM: 35,
    priority: 75,
    matchOpts: { manual: true },
  },
  STALE_ANCHOR: {
    cooldownMs: 60_000,
    minMoveM: 30,
    priority: 62,
    matchOpts: { refresh: true },
  },
  MARKER_STUCK: {
    cooldownMs: 45_000,
    minMoveM: 20,
    priority: 88,
    matchOpts: { manual: true, forceImmediate: true },
  },
  AUTO_ENTRY: {
    cooldownMs: MAP_MATCH_COORD_AUTO_ENTRY_COOLDOWN_MS,
    minMoveM: MAP_MATCH_COORD_AUTO_ENTRY_MIN_MOVE_M,
    priority: 95,
    matchOpts: { manual: true, forceImmediate: true },
  },
  GPS_RESUME: {
    cooldownMs: 60_000,
    minMoveM: 50,
    priority: 85,
    matchOpts: { refresh: true, forceImmediate: true },
  },
  INTERSECTION_TURN: {
    cooldownMs: 6_000,
    minMoveM: 10,
    priority: 97,
    matchOpts: { refresh: true, forceImmediate: true, intersectionTurn: true },
  },
};

export type MapMatchCoordinatorMetrics = {
  requested: Partial<Record<MapMatchRecoveryReason, number>>;
  succeeded: number;
  failed: number;
  rejected_by_cooldown: number;
  rejected_by_inflight: number;
  rejected_by_speed: number;
  rejected_by_gate: number;
  rejected_by_context: number;
  rejected_by_invalid: number;
  rejected_by_priority: number;
  rejected_by_client_first: number;
  inflight_reason: MapMatchRecoveryReason | null;
  last_success_reason: MapMatchRecoveryReason | null;
};

type ReasonAnchor = { at: number; lat: number; lng: number };

export type MapMatchCoordinatorDeps = {
  forceMapMatch: (
    lat: number,
    lng: number,
    opts?: ForceMatchOpts,
  ) => Promise<MatchedRoadPoint[] | null>;
  getMatchedPoints: () => MatchedRoadPoint[] | null;
  getSpeedKmh: () => number;
  getHeading: () => number | null;
  isDriving: () => boolean;
  minStationarySpeedKmh: number;
  applySeqRef: { current: number };
  onLog?: (event: string, payload?: Record<string, unknown>) => void;
};

export class MapMatchCoordinator {
  private deps: MapMatchCoordinatorDeps;

  private inflight = false;

  private inflightReason: MapMatchRecoveryReason | null = null;

  private inflightPriority = 0;

  private reasonAnchors = new Map<MapMatchRecoveryReason, ReasonAnchor>();

  private hardRescueRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private metrics: MapMatchCoordinatorMetrics = {
    requested: {},
    succeeded: 0,
    failed: 0,
    rejected_by_cooldown: 0,
    rejected_by_inflight: 0,
    rejected_by_speed: 0,
    rejected_by_gate: 0,
    rejected_by_context: 0,
    rejected_by_invalid: 0,
    rejected_by_priority: 0,
    rejected_by_client_first: 0,
    inflight_reason: null,
    last_success_reason: null,
  };

  constructor(deps: MapMatchCoordinatorDeps) {
    this.deps = deps;
  }

  setDeps(deps: MapMatchCoordinatorDeps): void {
    this.deps = deps;
  }

  allocRequestId(): number {
    return ++this.deps.applySeqRef.current;
  }

  isStaleRequest(requestId: number): boolean {
    return requestId !== this.deps.applySeqRef.current;
  }

  invalidateRequests(): void {
    this.deps.applySeqRef.current += 1;
    this.clearHardRescueRetry();
  }

  reset(): void {
    this.invalidateRequests();
    this.inflight = false;
    this.inflightReason = null;
    this.inflightPriority = 0;
    this.reasonAnchors.clear();
    this.metrics.inflight_reason = null;
  }

  getCoordinatorMetrics(): MapMatchCoordinatorMetrics {
    return {
      ...this.metrics,
      requested: { ...this.metrics.requested },
      inflight_reason: this.inflightReason,
    };
  }

  private bumpRequested(reason: MapMatchRecoveryReason): void {
    this.metrics.requested[reason] = (this.metrics.requested[reason] ?? 0) + 1;
  }

  private reject(kind: keyof Omit<MapMatchCoordinatorMetrics, 'requested' | 'inflight_reason' | 'last_success_reason'>): void {
    const key = kind as keyof MapMatchCoordinatorMetrics;
    if (typeof this.metrics[key] === 'number') {
      (this.metrics[key] as number) += 1;
    }
  }

  private log(event: string, payload?: Record<string, unknown>): void {
    this.deps.onLog?.(event, payload);
  }

  private movedM(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return haversineKm(lat1, lng1, lat2, lng2) * 1000;
  }

  private passesContextGate(req: MapMatchRecoveryRequest, cfg: ReasonConfig): boolean {
    const ctx = req.context;
    if (!ctx) return true;

    if (req.reason === 'NO_ROAD') {
      const movedSnap = ctx.movedForSnapM ?? 0;
      const movedRec = ctx.movedRecoverM ?? Infinity;
      if (movedSnap < MAP_MATCH_COORD_NO_ROAD_MIN_MOVE_M) return false;
      if (movedRec < MAP_MATCH_COORD_NO_ROAD_MIN_REC_M) return false;
      return true;
    }

    if (req.reason === 'SPARSE_GEOM') {
      const pts = ctx.roadPtsSparse ?? 0;
      if (pts <= 0 || pts >= 8) return false;
      return true;
    }

    if (req.reason === 'SOFT_REFRESH') {
      const moved = ctx.movedSoftM ?? 0;
      if (moved < cfg.minMoveM) return false;
      return true;
    }

    if (req.reason === 'AUTO_ENTRY') {
      return ctx.canForceAutoEntry !== false;
    }

    return true;
  }

  private passesCooldown(
    reason: MapMatchRecoveryReason,
    lat: number,
    lng: number,
    cfg: ReasonConfig,
    forceImmediate: boolean,
  ): boolean {
    if (forceImmediate && (reason === 'MANUAL' || reason === 'AUTO_ENTRY')) {
      return true;
    }
    const anchor = this.reasonAnchors.get(reason);
    if (!anchor) return true;
    const now = Date.now();
    const moved = this.movedM(anchor.lat, anchor.lng, lat, lng);
    if (now - anchor.at < cfg.cooldownMs && moved < cfg.minMoveM) {
      return false;
    }
    return true;
  }

  private recordSuccess(reason: MapMatchRecoveryReason, lat: number, lng: number): void {
    this.reasonAnchors.set(reason, { at: Date.now(), lat, lng });
    this.metrics.last_success_reason = reason;
  }

  private clearHardRescueRetry(): void {
    if (this.hardRescueRetryTimer != null) {
      clearTimeout(this.hardRescueRetryTimer);
      this.hardRescueRetryTimer = null;
    }
  }

  /**
   * Jedyny punkt wejścia dla wymuszonego dopasowania drogi z map.tsx.
   */
  async requestRecovery(req: MapMatchRecoveryRequest): Promise<MatchedRoadPoint[] | null> {
    const { reason, lat, lng } = req;
    this.bumpRequested(reason);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      this.reject('rejected_by_invalid');
      return this.deps.getMatchedPoints();
    }

    if (!shouldCoordinatorAllowNetwork(reason)) {
      this.reject('rejected_by_client_first');
      this.log('COORD_V2_SKIP', { reason });
      return this.deps.getMatchedPoints();
    }

    const cfg = REASON_CONFIG[reason];
    const speedKmh = req.speedKmh ?? this.deps.getSpeedKmh();
    const forceImmediate = !!req.forceImmediate || !!cfg.matchOpts.forceImmediate;
    const staleSnap = !!req.staleSnap;

    if (!this.passesContextGate(req, cfg)) {
      this.reject('rejected_by_context');
      return this.deps.getMatchedPoints();
    }

    const clientFirstBypass =
      reason === 'MANUAL'
      || reason === 'AUTO_ENTRY'
      || reason === 'PRE_DRIVE'
      || reason === 'GPS_RESUME'
      || reason === 'INTERSECTION_TURN';
    if (!clientFirstBypass) {
      const critical =
        reason === 'HARD_RESCUE'
        || reason === 'MARKER_STUCK'
        || reason === 'DR_DRIFT';
      if (
        !shouldAllowNetworkMapMatch({
          manualEntry: false,
          critical,
          noRoad: reason === 'NO_ROAD',
          staleSnap,
        })
      ) {
        this.reject('rejected_by_client_first');
        this.log('COORD_CLIENT_FIRST', { reason });
        return this.deps.getMatchedPoints();
      }
    }

    if (
      !cfg.bypassSpeedGate
      && !forceImmediate
      && speedKmh < this.deps.minStationarySpeedKmh
      && reason !== 'MANUAL'
    ) {
      this.reject('rejected_by_speed');
      return this.deps.getMatchedPoints();
    }

    if (!cfg.bypassMapboxGate && !forceImmediate) {
      const gate = canRequestMapMatch({
        lat,
        lng,
        speedKmh,
        manual: false,
        staleSnap,
      });
      if (!gate.ok) {
        this.reject('rejected_by_gate');
        this.log('COORD_GATE', { reason, gateReason: gate.reason });
        return this.deps.getMatchedPoints();
      }
    }

    if (!this.passesCooldown(reason, lat, lng, cfg, forceImmediate)) {
      this.reject('rejected_by_cooldown');
      return this.deps.getMatchedPoints();
    }

    if (this.inflight) {
      if (cfg.priority <= this.inflightPriority) {
        this.reject('rejected_by_inflight');
        return this.deps.getMatchedPoints();
      }
      this.reject('rejected_by_priority');
      return this.deps.getMatchedPoints();
    }

    this.inflight = true;
    this.inflightReason = reason;
    this.inflightPriority = cfg.priority;
    this.metrics.inflight_reason = reason;

    const matchOpts: ForceMatchOpts = {
      ...cfg.matchOpts,
      speedKmh,
      headingDeg: req.headingDeg ?? this.deps.getHeading() ?? undefined,
      forceImmediate: forceImmediate || cfg.matchOpts.forceImmediate,
      manual: cfg.matchOpts.manual,
      refresh: cfg.matchOpts.refresh,
    };

    if (reason === 'HARD_RESCUE' && staleSnap && cfg.retryAsRefresh) {
      matchOpts.manual = false;
      matchOpts.refresh = true;
      matchOpts.forceImmediate = false;
    }

    if (reason === 'GPS_RESUME' && forceImmediate) {
      matchOpts.manual = true;
      matchOpts.refresh = true;
    }

  try {
      const matched = await this.deps.forceMapMatch(lat, lng, matchOpts);
      if (matched && matched.length >= 2) {
        this.metrics.succeeded += 1;
        this.recordSuccess(reason, lat, lng);
        return matched;
      }
      this.metrics.failed += 1;
      return matched ?? this.deps.getMatchedPoints();
    } catch {
      this.metrics.failed += 1;
      return this.deps.getMatchedPoints();
    } finally {
      this.inflight = false;
      this.inflightReason = null;
      this.inflightPriority = 0;
      this.metrics.inflight_reason = null;
    }
  }

  /**
   * HARD_RESCUE retry z warunkiem „nadal stale” — wołane z map.tsx po snap check.
   */
  scheduleHardRescueStaleRetry(
    resolveCoords: () => { lat: number; lng: number } | null,
    speedKmh: number,
    isStillStale: () => boolean,
  ): void {
    const cfg = REASON_CONFIG.HARD_RESCUE;
    if (!cfg.scheduleRetryMs) return;
    this.clearHardRescueRetry();
    this.hardRescueRetryTimer = setTimeout(() => {
      this.hardRescueRetryTimer = null;
      if (!this.deps.isDriving() || !isStillStale()) return;
      const coords = resolveCoords();
      if (!coords) return;
      vroomGpsLog('SNAP_STALE_ANCHOR_RETRY', {
        rawLat: Number(coords.lat.toFixed(5)),
        rawLng: Number(coords.lng.toFixed(5)),
      }, 0);
      void this.requestRecovery({
        reason: 'HARD_RESCUE',
        lat: coords.lat,
        lng: coords.lng,
        speedKmh,
        staleSnap: true,
      });
    }, cfg.scheduleRetryMs);
  }
}
