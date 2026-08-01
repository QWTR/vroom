import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { CAMERA_SPEED_POLL_MS } from '../../constants/mapPerformance';
import { useMapTick } from '../useMapTick';

export type UseMapCameraSpeedPollParams = {
  /** Trip mode — poll on interval. When false, runs once if `runOnce` is true. */
  tripActive: boolean;
  runOnce: boolean;
  poll: () => void;
};

/** Camera + speed-limit refresh — interval during trip, one-shot while browsing. */
export function useMapCameraSpeedPoll({ tripActive, runOnce, poll }: UseMapCameraSpeedPollParams) {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (tripActive) return;
    if (!runOnce) return;
    pollRef.current();
  }, [tripActive, runOnce]);

  useMapTick(
    CAMERA_SPEED_POLL_MS,
    [() => {
      if (AppState.currentState !== 'active') return;
      pollRef.current();
    }],
    tripActive,
  );
}
