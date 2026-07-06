import { useEffect, useRef } from 'react';
import { MAP_PERF } from '../constants/mapPerformance';

type TickHandler = () => void;

/**
 * Single interval for map subsystems — reduces duplicate setInterval timers / battery drain.
 * Handlers run sequentially; keep each handler lightweight.
 */
export function useMapTick(intervalMs: number, handlers: TickHandler[], enabled = true) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return undefined;
    const id = setInterval(() => {
      for (const fn of handlersRef.current) {
        try {
          fn();
        } catch {
          /* non-blocking */
        }
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}

/** Shared map polling intervals (ms) — synced with constants/mapPerformance.ts */
export const MAP_TICK = {
  navigationProgress: MAP_PERF.navProgressUi,
  liveLocationRest: MAP_PERF.geoDropRefreshIdle,
  geoDropCheck: MAP_PERF.geoDropClaimPoll,
  cameraSpeed: MAP_PERF.cameraSpeedFast,
  fuelRefresh: 60_000,
  tripCheckpoint: MAP_PERF.tripCheckpointPeriodic,
  heartbeat: MAP_PERF.heartbeat,
  anchorSync: MAP_PERF.anchorSync,
} as const;
