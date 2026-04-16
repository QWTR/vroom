import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export type PollData = {
  id:         number;
  question:   string;
  options:    string[];
  voteCounts: number[];
  totalVotes: number;
  myVote:     number | null;
};

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export function usePolls() {
  const [poll,    setPoll]    = useState<PollData | null>(null);
  const [loading, setLoading] = useState(false);
  const [voted,   setVoted]   = useState(false);

  const fetchActivePoll = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res  = await fetch(`${API_URL}/api/polls/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!data) {
        setPoll(null);
        setVoted(false);  // ← reset gdy brak ankiety
        return;
      }

      // Sprawdź per ID ankiety — nie globalnie
      const localVoted = await AsyncStorage.getItem(`poll_voted_${data.id}`);
      const hasVoted   = !!localVoted || data.myVote !== null;

      setPoll(data);
      setVoted(hasVoted);  // ← zależy od konkretnej ankiety
    } catch (e) {
      console.log('fetchActivePoll error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const vote = useCallback(async (pollId: number, optionIdx: number) => {
    try {
      const token = await getToken();
      if (!token) return false;

      const res  = await fetch(`${API_URL}/api/polls/${pollId}/vote`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ optionIdx }),
      });
      const data = await res.json();
      if (!res.ok) return false;

      await AsyncStorage.setItem(`poll_voted_${pollId}`, '1');
      setPoll(prev => prev ? { ...prev, ...data } : null);
      setVoted(true);
      return true;
    } catch (e) {
      console.log('vote error:', e);
      return false;
    }
  }, []);

  return { poll, loading, voted, fetchActivePoll, vote };
}