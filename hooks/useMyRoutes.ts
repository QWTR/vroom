import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/mapConfig';

export type MyRoute = {
  id:          number;
  name:        string;
  description: string | null;
  distance:    number;
  isPublic:    boolean;
  isOffroad:   boolean;   // ← NOWE
  createdAt:   string;
  _count:      { likes: number };
  points:      { latitude: number; longitude: number; order: number }[];
};

export function useMyRoutes() {
  const [routes,  setRoutes]  = useState<MyRoute[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMyRoutes = useCallback(async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;
      const res  = await fetch(`${API_URL}/api/routes/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (Array.isArray(json)) setRoutes(json);
    } catch (e) {
      console.log('fetchMyRoutes error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteRoute = useCallback(async (id: number) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return false;
      const res = await fetch(`${API_URL}/api/routes/${id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setRoutes(prev => prev.filter(r => r.id !== id));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  return { routes, loading, fetchMyRoutes, deleteRoute };
}