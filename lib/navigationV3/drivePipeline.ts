import { haversineKm } from '../../scripts/navigationUtils';
import { NAV_V3 } from './config';
import { filterGpsFix } from './gpsFilter';
import {
  createSnapEngine,
  makeRoadPolyline,
  type SnapEngineConfig,
} from './snapEngine';
import { buildNavigationTarget } from './targetBuilder';
import type {
  DrivePipelineInput,
  DrivePipelineOutput,
  NavMode,
  RawGpsFix,
  RoadPolyline,
} from './types';

export type DrivePipelineConfig = {
  snap?: Partial<SnapEngineConfig>;
};

export type DrivePipelineGeometry = {
  /** Polilinie drogi (map-match, cache L2). */
  roadPolylines: RoadPolyline[];
  /** Trasa nawigacyjna — SSOT w trybie navigation. */
  routePolyline: { lat: number; lng: number }[] | null;
};

type PipelineInternalState = {
  mode: NavMode;
  prevAccepted: RawGpsFix | null;
  displayPrev: { lat: number; lng: number } | null;
  lastHudSpeedKmh: number;
  sessionFirstFix: boolean;
  hardResetPending: boolean;
};

function normalizeHeading(h: number): number {
  return ((h % 360) + 360) % 360;
}

function resolveFeedSpeedMs(
  fix: RawGpsFix,
  prev: RawGpsFix | null,
  hudSpeedKmh: number,
): number {
  const dopplerMs = fix.speedMs != null && fix.speedMs >= 0 ? fix.speedMs : 0;
  if (dopplerMs >= NAV_V3.GPS_MIN_MOVING_SPEED_MS) {
    return dopplerMs;
  }
  if (prev && hudSpeedKmh >= NAV_V3.PIPELINE_MOVING_KMH) {
    return hudSpeedKmh / 3.6;
  }
  return 0;
}

function resolveHudSpeedKmh(fix: RawGpsFix, prev: RawGpsFix | null): number {
  const dopplerKmh = fix.speedMs != null && fix.speedMs >= 0 ? fix.speedMs * 3.6 : 0;
  if (dopplerKmh >= 1) {
    return Math.min(220, dopplerKmh);
  }
  if (!prev) return 0;
  const dtMs = Math.max(50, fix.timestampMs - prev.timestampMs);
  const distM = haversineKm(prev.lat, prev.lng, fix.lat, fix.lng) * 1000;
  const derivedKmh = (distM / (dtMs / 1000)) * 3.6;
  if (!Number.isFinite(derivedKmh) || derivedKmh > 220) return 0;
  return derivedKmh;
}

function isMovingEvidence(
  fix: RawGpsFix,
  prev: RawGpsFix | null,
  hudSpeedKmh: number,
): boolean {
  if (hudSpeedKmh >= NAV_V3.PIPELINE_MOVING_KMH) return true;
  if (fix.speedMs != null && fix.speedMs >= NAV_V3.GPS_MIN_MOVING_SPEED_MS) return true;
  if (!prev) return false;
  const stepM = haversineKm(prev.lat, prev.lng, fix.lat, fix.lng) * 1000;
  return stepM >= NAV_V3.GPS_MOVING_MIN_STEP_M;
}

function collectPolylines(geometry: DrivePipelineGeometry, mode: NavMode): RoadPolyline[] {
  if (mode === 'navigation') {
    const route = geometry.routePolyline;
    if (route && route.length >= 2) {
      const packed = makeRoadPolyline('route', route);
      return packed ? [packed] : [];
    }
    return [];
  }
  return geometry.roadPolylines.filter((p) => p.points.length >= 2);
}

export function createDrivePipeline(config?: DrivePipelineConfig) {
  const snapEngine = createSnapEngine(config?.snap);
  let geometry: DrivePipelineGeometry = {
    roadPolylines: [],
    routePolyline: null,
  };

  const state: PipelineInternalState = {
    mode: 'idle',
    prevAccepted: null,
    displayPrev: null,
    lastHudSpeedKmh: 0,
    sessionFirstFix: true,
    hardResetPending: false,
  };

  return {
    reset(anchor?: { lat: number; lng: number; headingDeg?: number }): void {
      snapEngine.reset();
      state.prevAccepted = null;
      state.displayPrev = anchor
        ? { lat: anchor.lat, lng: anchor.lng }
        : null;
      state.lastHudSpeedKmh = 0;
      state.sessionFirstFix = true;
      state.hardResetPending = false;
    },

    hardReset(lat: number, lng: number, _headingDeg?: number): void {
      snapEngine.reset();
      state.prevAccepted = {
        lat,
        lng,
        accuracyM: 12,
        timestampMs: Date.now(),
        speedMs: 0,
        headingDeg: _headingDeg ?? null,
      };
      state.displayPrev = { lat, lng };
      state.sessionFirstFix = true;
      state.hardResetPending = true;
    },

    setMode(mode: NavMode): void {
      state.mode = mode;
      if (mode === 'idle') {
        state.sessionFirstFix = true;
      }
    },

    getMode(): NavMode {
      return state.mode;
    },

    setGeometry(next: Partial<DrivePipelineGeometry>): void {
      geometry = {
        roadPolylines: next.roadPolylines ?? geometry.roadPolylines,
        routePolyline: next.routePolyline !== undefined
          ? next.routePolyline
          : geometry.routePolyline,
      };
    },

    setRoadPolylines(polylines: RoadPolyline[]): void {
      geometry = { ...geometry, roadPolylines: polylines };
    },

    setRoutePolyline(points: { lat: number; lng: number }[] | null): void {
      geometry = { ...geometry, routePolyline: points };
    },

    /**
     * Jedyny punkt wejścia surowego GPS w V3.
     * Zwraca null w trybie idle lub po odrzuceniu filtra.
     */
    processGpsFix(input: DrivePipelineInput): DrivePipelineOutput | null {
      if (state.mode === 'idle') return null;

      const raw: RawGpsFix = {
        lat: input.lat,
        lng: input.lng,
        accuracyM: Number.isFinite(input.accuracyM) ? input.accuracyM : 20,
        timestampMs: input.timestampMs,
        speedMs: input.speedMs,
        headingDeg: input.headingDeg != null && Number.isFinite(input.headingDeg)
          ? normalizeHeading(input.headingDeg)
          : null,
      };

      const filtered = filterGpsFix(raw, state.prevAccepted);
      if (filtered.verdict === 'reject') {
        return {
          target: buildNavigationTarget(
            {
              lat: state.displayPrev?.lat ?? raw.lat,
              lng: state.displayPrev?.lng ?? raw.lng,
              rawLat: raw.lat,
              rawLng: raw.lng,
              headingDeg: state.prevAccepted?.headingDeg ?? 0,
              crossTrackM: 999,
              pathMode: 'offRoad',
              roadBlend: 0,
              segmentIndex: 0,
              arcM: null,
              polylineKey: null,
              arcWindow: null,
            },
            0,
            false,
          ),
          snap: {
            lat: state.displayPrev?.lat ?? raw.lat,
            lng: state.displayPrev?.lng ?? raw.lng,
            rawLat: raw.lat,
            rawLng: raw.lng,
            headingDeg: 0,
            crossTrackM: 999,
            pathMode: 'offRoad',
            roadBlend: 0,
            segmentIndex: 0,
            arcM: null,
            polylineKey: null,
            arcWindow: null,
          },
          hudSpeedKmh: state.lastHudSpeedKmh,
          isMoving: false,
          rejected: true,
          rejectReason: filtered.reason,
        };
      }

      const fix = filtered.fix;
      const hudSpeedKmh = resolveHudSpeedKmh(fix, state.prevAccepted);
      const isMoving = isMovingEvidence(fix, state.prevAccepted, hudSpeedKmh);
      state.lastHudSpeedKmh = hudSpeedKmh;

      const polylines = collectPolylines(geometry, state.mode);
      const isNavigating = state.mode === 'navigation';
      const tripActive = state.mode === 'navigation' || state.mode === 'freeDrive';

      const { result: snap } = snapEngine.resolve({
        raw: fix,
        prev: state.displayPrev,
        polylines,
        isNavigating,
        tripActive,
        travelHeadingDeg: fix.headingDeg ?? undefined,
      });

      const feedSpeedMs = resolveFeedSpeedMs(fix, state.prevAccepted, hudSpeedKmh);
      const allowInstant = state.sessionFirstFix || state.hardResetPending;
      const target = buildNavigationTarget(snap, feedSpeedMs, allowInstant);

      state.prevAccepted = fix;
      state.displayPrev = { lat: snap.lat, lng: snap.lng };
      state.sessionFirstFix = false;
      state.hardResetPending = false;

      return {
        target,
        snap,
        hudSpeedKmh,
        isMoving,
        rejected: false,
      };
    },
  };
}

export type DrivePipeline = ReturnType<typeof createDrivePipeline>;
