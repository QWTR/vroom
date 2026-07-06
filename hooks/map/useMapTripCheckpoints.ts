import type { MutableRefObject } from 'react';
import { useEffect } from 'react';
import { LIVE_ACHIEVEMENT_PERIODIC_MS, MAP_PERF } from '../../constants/mapPerformance';
import { useMapTick, MAP_TICK } from '../useMapTick';
import { flushTracePendingKmToStorage } from '../useBackgroundTracking';

export type UseMapTripCheckpointsParams = {
  enabled: boolean;
  checkpointEnabled: boolean;
  liveDistanceKm: number;
  flushTripDistanceCheckpoint: (opts?: {
    reason?: string;
    minKm?: number;
    forceAll?: boolean;
  }) => Promise<boolean>;
  flushTripDistanceCheckpointRef: MutableRefObject<UseMapTripCheckpointsParams['flushTripDistanceCheckpoint']>;
  tripCheckpointSavedKmRef: MutableRefObject<number>;
  checkLiveAchievements: (reason: string) => Promise<void>;
  appStateRef: MutableRefObject<string>;
  isMapFocusedRef: MutableRefObject<boolean>;
};

/** Trip distance checkpoints + periodic achievement checks during active trip. */
export function useMapTripCheckpoints(params: UseMapTripCheckpointsParams) {
  const {
    enabled,
    checkpointEnabled,
    liveDistanceKm,
    flushTripDistanceCheckpoint,
    flushTripDistanceCheckpointRef,
    tripCheckpointSavedKmRef,
    checkLiveAchievements,
    appStateRef,
    isMapFocusedRef,
  } = params;

  useEffect(() => {
    if (!checkpointEnabled) {
      tripCheckpointSavedKmRef.current = 0;
      return;
    }
    if (!enabled) return;
    void flushTripDistanceCheckpoint({ reason: 'live_distance' });
  }, [liveDistanceKm, enabled, checkpointEnabled, flushTripDistanceCheckpoint, tripCheckpointSavedKmRef]);

  useMapTick(
    MAP_TICK.tripCheckpoint,
    [
      () => { void flushTracePendingKmToStorage(); },
      () => {
        void flushTripDistanceCheckpointRef.current({
          minKm: 0.05,
          forceAll: true,
          reason: 'periodic_safety',
        });
      },
    ],
    enabled && checkpointEnabled,
  );

  useMapTick(
    LIVE_ACHIEVEMENT_PERIODIC_MS,
    [
      () => {
        if (appStateRef.current !== 'active') return;
        if (!isMapFocusedRef.current) return;
        void checkLiveAchievements('periodic');
      },
    ],
    enabled,
  );
}
