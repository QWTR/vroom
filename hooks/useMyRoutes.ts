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
  points?:     { latitude: number; longitude: number; order: number }[];
};

export function useMyRoutes() {
  const [routes,  setRoutes]  = useState<MyRoute[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMyRoutes = useCallback(async (opts?: { includeGeometry?: boolean }) => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;
      const includeGeometry = opts?.includeGeometry === true;
      const res  = await fetch(`${API_URL}/api/routes/my${includeGeometry ? '' : '?lite=1'}`, {
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

  const fetchRouteGeometry = useCallback(async (id: number): Promise<MyRoute | null> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return null;
      const res = await fetch(`${API_URL}/api/routes/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
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

  return { routes, loading, fetchMyRoutes, fetchRouteGeometry, deleteRoute };
}