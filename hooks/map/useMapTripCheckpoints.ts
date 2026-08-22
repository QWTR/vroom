import type { MutableRefObject } from 'react';
import { useEffect } from 'react';
import { useMapTick, MAP_TICK } from '../useMapTick';
import { flushTracePendingKmToStorage } from '../useBackgroundTracking';

export type UseMapTripCheckpointsParams = {
  enabled: boolean;
  checkpointEnabled: boolean;
  tripActiveRef: MutableRefObject<boolean>;
  liveDistanceKm: number;
  flushTripDistanceCheckpoint: (opts?: {
    reason?: string;
    minKm?: number;
    forceAll?: boolean;
  }) => Promise<boolean>;
  flushTripDistanceCheckpointRef: MutableRefObject<UseMapTripCheckpointsParams['flushTripDistanceCheckpoint']>;
  tripCheckpointSavedKmRef: MutableRefObject<number>;
};

function isTripActiveNow(
  enabled: boolean,
  tripActiveRef: MutableRefObject<boolean>,
): boolean {
  return enabled || tripActiveRef.current;
}

/** Trip distance checkpoints + periodic achievement checks during active trip. */
export function useMapTripCheckpoints(params: UseMapTripCheckpointsParams) {
  const {
    enabled,
    checkpointEnabled,
    tripActiveRef,
    liveDistanceKm,
    flushTripDistanceCheckpoint,
    flushTripDistanceCheckpointRef,
    tripCheckpointSavedKmRef,
  } = params;

  useEffect(() => {
    if (!checkpointEnabled) {
      tripCheckpointSavedKmRef.current = 0;
      return;
    }
    if (!isTripActiveNow(enabled, tripActiveRef)) return;
    void flushTripDistanceCheckpoint({ reason: 'live_distance' });
  }, [liveDistanceKm, enabled, checkpointEnabled, flushTripDistanceCheckpoint, tripCheckpointSavedKmRef, tripActiveRef]);

  useMapTick(
    MAP_TICK.tripCheckpoint,
    [
      () => { void flushTracePendingKmToStorage(); },
      () => {
        if (!checkpointEnabled || !tripActiveRef.current) return;
        void flushTripDistanceCheckpointRef.current({
          minKm: 0.05,
          forceAll: true,
          reason: 'periodic_safety',
        });
      },
    ],
    checkpointEnabled,
  );
}
