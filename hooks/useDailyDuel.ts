import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../constants/config';
import type {
  DailyDuelCarSide,
  DailyDuelData,
  DailyDuelSubmission,
} from '../components/community/dailyDuelTypes';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

const showToast = (type: 'success' | 'error', text1: string) => {
  Toast.show({ type, text1 } as Parameters<typeof Toast.show>[0]);
};

export function useDailyDuel(pollMs = 30000) {
  const [duel, setDuel] = useState<DailyDuelData | null>(null);
  const [history, setHistory] = useState<DailyDuelData[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [submission, setSubmission] = useState<DailyDuelSubmission | null>(null);
  const [eligibleCars, setEligibleCars] = useState<DailyDuelCarSide[]>([]);
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
          if (prev.myVoteCarId === next.myVoteCarId) {
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

  const fetchSubmission = useCallback(async () => {
    setSubmissionLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/daily-duel/submission`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!mounted.current) return;
      setSubmission(data?.submission ?? null);
      setEligibleCars(Array.isArray(data?.cars) ? data.cars : []);
    } catch {
      /* ignore */
    } finally {
      if (mounted.current) setSubmissionLoading(false);
    }
  }, []);

  const submitCar = useCallback(async (carId: number) => {
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/daily-duel/submission`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ carId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', data?.error ?? 'Nie udało się zgłosić auta');
        return false;
      }
      setSubmission(data.submission ?? null);
      showToast('success', 'Auto zgłoszone do pojedynku!');
      return true;
    } catch {
      showToast('error', 'Błąd połączenia');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const cancelSubmission = useCallback(async () => {
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/daily-duel/submission`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      setSubmission(null);
      showToast('success', 'Zgłoszenie wycofane');
      return true;
    } catch {
      showToast('error', 'Błąd połączenia');
      return false;
    } finally {
      setSubmitting(false);
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
        showToast('error', data?.error ?? 'Nie udało się zagłosować');
        return false;
      }
      setDuel(data.duel ?? null);
      showToast('success', 'Głos oddany!');
      return true;
    } catch {
      showToast('error', 'Błąd połączenia');
      return false;
    } finally {
      setVoting(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void fetchDuel();
    void fetchHistory();
    void fetchSubmission();
    const id = setInterval(() => { void fetchDuel(true); }, pollMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [fetchDuel, fetchHistory, fetchSubmission, pollMs]);

  return {
    duel,
    history,
    historyLoading,
    loading,
    voting,
    submission,
    eligibleCars,
    submissionLoading,
    submitting,
    refresh: fetchDuel,
    refreshHistory: fetchHistory,
    refreshSubmission: fetchSubmission,
    vote,
    submitCar,
    cancelSubmission,
  };
}
