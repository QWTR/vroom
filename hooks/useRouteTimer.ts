import { useState, useRef, useCallback } from 'react';

interface TimerState {
  isRunning:  boolean;
  elapsedSec: number;
  routeName:  string;
  routeId:    number | null;
}

export function useRouteTimer() {
  const [state, setState] = useState<TimerState>({
    isRunning:  false,
    elapsedSec: 0,
    routeName:  '',
    routeId:    null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef    = useRef<number>(0);

  const startTimer = useCallback((routeId: number, routeName: string) => {
    startRef.current = Date.now();
    intervalRef.current && clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setState(prev => ({
        ...prev,
        elapsedSec: Math.floor((Date.now() - startRef.current) / 1000),
      }));
    }, 1000);
    setState({ isRunning: true, elapsedSec: 0, routeName, routeId });
  }, []);

  // Zwraca finalny czas w sekundach
  const stopTimer = useCallback((): number => {
    intervalRef.current && clearInterval(intervalRef.current);
    const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
    setState(prev => ({ ...prev, isRunning: false, elapsedSec: elapsed }));
    return elapsed;
  }, []);

  const resetTimer = useCallback(() => {
    intervalRef.current && clearInterval(intervalRef.current);
    setState({ isRunning: false, elapsedSec: 0, routeName: '', routeId: null });
  }, []);

  const formatElapsed = useCallback((sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, []);

  return {
    isRunning:  state.isRunning,
    elapsedSec: state.elapsedSec,
    routeName:  state.routeName,
    routeId:    state.routeId,      // ← nowe pole
    startTimer,
    stopTimer,
    resetTimer,
    formatElapsed,
  };
}