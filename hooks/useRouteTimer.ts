import { useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/mapConfig';

export function useRouteTimer() {
  const [isRunning,    setIsRunning]    = useState(false);
  const [elapsedSec,   setElapsedSec]   = useState(0);
  const [routeId,      setRouteId]      = useState<number | null>(null);
  const [routeName,    setRouteName]    = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const startTimer = useCallback((id: number, name: string) => {
    setRouteId(id);
    setRouteName(name);
    setElapsedSec(0);
    startTimeRef.current = Date.now();
    setIsRunning(true);
  }, []);

  const stopTimer = useCallback(async (): Promise<number> => {
    setIsRunning(false);
    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    setElapsedSec(elapsed);
    if (intervalRef.current) clearInterval(intervalRef.current);
    return elapsed;
  }, []);

  const resetTimer = useCallback(() => {
    setIsRunning(false);
    setElapsedSec(0);
    setRouteId(null);
    setRouteName('');
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  // Tick
  useEffect(() => {
    if (!isRunning) return;
    intervalRef.current = setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning]);

  // Formatowanie
  const formatElapsed = useCallback((sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, []);

  return {
    isRunning, elapsedSec, routeId, routeName,
    startTimer, stopTimer, resetTimer, formatElapsed,
  };
}