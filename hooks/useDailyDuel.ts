import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../constants/config';
import type { DailyDuelData } from '../components/community/dailyDuelTypes';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

export function useDailyDuel(pollMs = 30000) {
  const [duel, setDuel] = useState<DailyDuelData | null>(null);
  const [history, setHistory] = useState<DailyDuelData[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const mounted = useRef(true);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/daily-duel/history?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (mounted.current) setHistory(Array.isArray(data.history) ? data.history : []);
    } catch {
      /* ignore */
    } finally {
      if (mounted.current) setHistoryLoading(false);
    }
  }, []);

  const fetchDuel = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/daily-duel/current`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (mounted.current) {
        const next = data.duel ?? null;
        setDuel(prev => {
          if (!next) return null;
          if (!prev || prev.id !== next.id) return next;
          if (
            prev.totalVotes === next.totalVotes
            && prev.percentA === next.percentA
            && prev.percentB === next.percentB
            && prev.myVoteCarId === next.myVoteCarId
          ) {
            return prev;
          }
          return next;
        });
      }
    } catch {
      /* ignore */
    } finally {
      if (mounted.current && !silent) setLoading(false);
    }
  }, []);

  const vote = useCallback(async (carId: number) => {
    setVoting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/daily-duel/vote`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ carId }),
      });
      const data = await res.json();
      if (!res.ok) {
        Toast.show({ type: 'error', text1: data?.error ?? 'Nie udało się zagłosować' });
        return false;
      }
      setDuel(data.duel ?? null);
      Toast.show({ type: 'success', text1: 'Głos oddany!' });
      return true;
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      return false;
    } finally {
      setVoting(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void fetchDuel();
    void fetchHistory();
    const id = setInterval(() => { void fetchDuel(true); }, pollMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [fetchDuel, fetchHistory, pollMs]);

  return { duel, history, historyLoading, loading, voting, refresh: fetchDuel, refreshHistory: fetchHistory, vote };
}
