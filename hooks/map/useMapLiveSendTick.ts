import type { MutableRefObject } from 'react';
import { useEffect, useRef } from 'react';
import { MAP_PERF } from '../../constants/mapPerformance';
import { useMapTick } from '../useMapTick';

export type UseMapLiveSendTickParams = {
  enabled: boolean;
  send: () => void;
  intervalMs?: number;
};

/** LIVE location broadcast interval (consolidated via useMapTick). */
export function useMapLiveSendTick({
  enabled,
  send,
  intervalMs = MAP_PERF.liveSendTick,
}: UseMapLiveSendTickParams) {
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (!enabled) return;
    sendRef.current();
  }, [enabled]);

  useMapTick(intervalMs, [() => sendRef.current()], enabled);
}
