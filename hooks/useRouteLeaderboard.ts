import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

const API = API_URL;

export interface LeaderboardEntry {
  position:  number;
  userId:    number;
  username:  string;
  avatarUrl: string | null;
  duration:  number;
  avgSpeed:  number | null;
  maxSpeed:  number | null;
  createdAt: string;
  isMe:      boolean;
}

export interface LeaderboardData {
  leaderboard:  LeaderboardEntry[];
  myBest: {
    position:  number;
    duration:  number;
    avgSpeed:  number | null;
    createdAt: string;
  } | null;
  totalRunners: number;
}

export interface RunEntry {
  id:        number;
  userId:    number;
  username:  string;
  avatarUrl: string | null;
  duration:  number;
  avgSpeed:  number | null;
  maxSpeed:  number | null;
  createdAt: string;
  isMe:      boolean;
}

export interface RunsData {
  runs: RunEntry[];
  stats: {
    uniqueUsers:    number;
    totalAttempts:  number;
    bestTime:       number | null;
    avgTime:        number | null;
  };
}

export function useRouteLeaderboard() {
  const [data,     setData]     = useState<LeaderboardData | null>(null);
  const [runsData, setRunsData] = useState<RunsData | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async (routeId: number) => {
    setLoading(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem('token');
      const url   = `${API}/api/routes/${routeId}/leaderboard`;
      console.log('📡 fetchLeaderboard →', url);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log('   status:', res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: LeaderboardData = await res.json();
      setData(json);
      return json;
    } catch (e: any) {
      console.error('fetchLeaderboard error:', e.message);
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRuns = useCallback(async (routeId: number) => {
    try {
      const token = await AsyncStorage.getItem('token');
      const url   = `${API}/api/routes/${routeId}/runs`;
      console.log('📡 fetchRuns →', url);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log('   status:', res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: RunsData = await res.json();
      setRunsData(json);
      return json;
    } catch (e: any) {
      console.error('fetchRuns error:', e.message);
      return null;
    }
  }, []);

  const saveRun = useCallback(async (
    routeId:  number,
    duration: number,
    avgSpeed?: number | null,
    maxSpeed?: number | null,
  ) => {
    try {
      const token = await AsyncStorage.getItem('token');
      const url   = `${API}/api/routes/${routeId}/run`;

      console.log('📡 saveRun →', url);
      console.log('   API const:', API);
      console.log('   token:', token ? `${token.slice(0, 20)}...` : 'NULL ❌');
      console.log('   body:', JSON.stringify({ duration, avgSpeed, maxSpeed }));

      const res = await fetch(url, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ duration, avgSpeed, maxSpeed }),
      });

      console.log('   HTTP status:', res.status);
      const text = await res.text();
      console.log('   response:', text);

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
      return JSON.parse(text);
    } catch (e: any) {
      console.error('saveRun error:', e.message);
      return null;
    }
  }, []);

  return { data, runsData, loading, error, fetchLeaderboard, fetchRuns, saveRun };
}