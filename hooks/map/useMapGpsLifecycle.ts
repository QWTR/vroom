import type { MutableRefObject } from 'react';
import { useCallback, useRef } from 'react';
import { GPS_WATCHDOG_TICK_MS } from '../../constants/mapPerformance';
import { useMapTick } from '../useMapTick';

export type GpsWatchdogRefs = {
  appStateRef: MutableRefObject<string>;
  isDrivingRef: MutableRefObject<boolean>;
  isNavigatingRef: MutableRefObject<boolean>;
  isMapFocusedRef: MutableRefObject<boolean>;
  lastAcceptedFixWallClockRef: MutableRefObject<number>;
  lastGpsTickAtRef: MutableRefObject<number>;
  lastDriveMarkerPushAtRef: MutableRefObject<number>;
  speedKmhRef: MutableRefObject<number>;
  rawGpsKmhRef: MutableRefObject<number>;
  currentLocRef: MutableRefObject<{ latitude: number; longitude: number } | null>;
  lastSetLocRef: MutableRefObject<{ lat: number; lng: number } | null>;
  drLatRef: MutableRefObject<number>;
  drLngRef: MutableRefObject<number>;
  drivingManuallyDisabledRef: MutableRefObject<boolean>;
  tripResumeFreezeUntilRef: MutableRefObject<number>;
  tripResumeAnchorRef: MutableRefObject<{ lat: number; lng: number } | null>;
  tripResumeConfirmRef: MutableRefObject<unknown>;
  tripResumeMotionWakeHitsRef: MutableRefObject<number>;
  drivingMarkerStallRef: MutableRefObject<{
    at: number;
    rawLat: number;
    rawLng: number;
    drLat: number;
    drLng: number;
  }>;
  gpsRejectStreakRef: MutableRefObject<number>;
  lastGpsRestartAtRef: MutableRefObject<number>;
};

export type UseMapGpsWatchdogParams = {
  tick: () => void;
};

/** GPS health watchdog — stale fixes, marker stall recovery (2.5s tick). */
export function useMapGpsWatchdog({ tick }: UseMapGpsWatchdogParams) {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useMapTick(GPS_WATCHDOG_TICK_MS, [() => tickRef.current()], true);
}

/** Map tab focus — start/stop GPS when leaving map (battery). */
export type UseMapTabFocusGpsParams = {
  onFocus: () => void;
  onBlur: () => void;
};

export function useMapTabFocusHandlers({ onFocus, onBlur }: UseMapTabFocusGpsParams) {
  const focusRef = useRef(onFocus);
  const blurRef = useRef(onBlur);
  focusRef.current = onFocus;
  blurRef.current = onBlur;

  return useCallback(() => {
    focusRef.current();
    return () => blurRef.current();
  }, []);
}
