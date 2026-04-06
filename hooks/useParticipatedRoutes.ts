import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export interface ParticipatedRoute {
  id:           number;
  name:         string;
  description:  string | null;
  distance:     number;
  duration:     number | null;
  isPublic:     boolean;
  authorId:     number;
  createdAt:    string;
  author:       { id: number; username: string; avatarUrl: string | null };
  points:       { latitude: number; longitude: number; order: number }[];
  likesCount:   number;
  totalRuns:    number;
  myBestTime:   number | null;
  myPosition:   number;
  totalRunners: number;
  lastRunAt:    string;
  isOwn:        boolean;
}

export function useParticipatedRoutes() {
  const [routes,  setRoutes]  = useState<ParticipatedRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const fetchParticipated = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem('token');
      const res   = await fetch(`${API_URL}/api/routes/participated`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ParticipatedRoute[] = await res.json();
      setRoutes(data);
      return data;
    } catch (e: any) {
      setError(e.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return { routes, loading, error, fetchParticipated };
}