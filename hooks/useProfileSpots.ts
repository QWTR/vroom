import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { SpotPreview } from '../constants/profile';

const getToken = async (): Promise<string | null> => {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
};

export function useProfileSpots() {
  const [spots, setSpots]     = useState<SpotPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetchUserSpots = useCallback(async (userId: number) => {
    setLoading(true);
    setError(null);
    try {
      const token   = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/profile/${userId}/spots`, { headers });
      if (!res.ok) throw new Error('Błąd pobierania spotów');
      setSpots(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { spots, loading, error, fetchUserSpots };
}